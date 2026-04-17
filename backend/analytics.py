"""
analytics.py — /api/analytics/global-shap, /api/analytics/trends, /api/rules
"""

from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
import pandas as pd

from models import TrendsResponse, TrendPoint, RulesResponse
from main import state, ARTIFACTS_ROOT, FEATURE_LAYER_OUTPUTS, REPO_ROOT
from constraints import CONDITION_LABELS

router = APIRouter()

CACHE_MAX_AGE = 3600


def _market_transactions_df() -> pd.DataFrame:
    """
    Build a frame with columns: year, resale_price, town (str).
    Prefers parquet; falls back to latest hdb_feature_table_*.csv under feature_data.
    """
    for pq in (
        ARTIFACTS_ROOT / "hdb_features.parquet",
        REPO_ROOT / "data" / "processed" / "hdb_features.parquet",
    ):
        if pq.exists():
            df = pd.read_parquet(pq)
            if "year" not in df.columns and "transaction_year" in df.columns:
                df = df.rename(columns={"transaction_year": "year"})
            return df[["year", "resale_price", "town"]].copy()

    tables = sorted(FEATURE_LAYER_OUTPUTS.glob("hdb_feature_table_*.csv"))
    if not tables:
        raise FileNotFoundError(
            f"No trend data: add hdb_features.parquet under {ARTIFACTS_ROOT} "
            f"or hdb_feature_table_*.csv under {FEATURE_LAYER_OUTPUTS}"
        )
    path = tables[-1]
    peek = pd.read_csv(path, nrows=0)
    town_cols = [c for c in peek.columns if c.startswith("town_")]
    need = ["resale_price", "transaction_year"] + town_cols
    missing = [c for c in need if c not in peek.columns]
    if missing:
        raise ValueError(f"{path.name} missing columns: {missing}")
    df = pd.read_csv(path, usecols=need)
    df["town"] = df[town_cols].idxmax(axis=1).str.replace("town_", "", regex=False)
    df = df.rename(columns={"transaction_year": "year"})
    return df[["year", "resale_price", "town"]]


def _ensure_hdb_df() -> pd.DataFrame:
    if state.hdb_df is None:
        state.hdb_df = _market_transactions_df()
    return state.hdb_df


@router.get("/analytics/global-shap")
def global_shap(cluster_id: Optional[int] = Query(default=None, ge=0)):
    """
    Return pre-computed global SHAP importance for Analyst view.

    - No cluster_id: overall mean(|SHAP|) for all rows.
    - With cluster_id: cluster-specific mean(|SHAP|) and (optional) SHAP base_value.
    """

    # Overall (backwards compatible)
    if cluster_id is None:
        by_cluster = (state.global_shap_by_cluster or {}).get("clusters") or {}
        cluster_counts = state.model_meta.get("cluster_counts_train") or {}

        weighted_num = 0.0
        weighted_den = 0.0
        unweighted = []
        for cid, c in by_cluster.items():
            bv = (c or {}).get("base_value")
            if bv is None:
                continue
            unweighted.append(float(bv))
            w = float(cluster_counts.get(str(cid), cluster_counts.get(cid, 0)) or 0)
            if w > 0:
                weighted_num += float(bv) * w
                weighted_den += w
        if weighted_den > 0:
            overall_base = weighted_num / weighted_den
        elif unweighted:
            overall_base = sum(unweighted) / len(unweighted)
        else:
            overall_base = None

        return {
            "scope": "overall",
            "cluster_id": None,
            "base_value": overall_base,
            "shap_importance": state.global_shap,
            "top_features": list(state.global_shap.keys())[:20],
            "available_clusters": sorted(
                [int(k) for k in by_cluster.keys() if str(k).isdigit()]
            ),
        }

    # Cluster-specific (requires optional artifact)
    payload = state.global_shap_by_cluster or {}
    clusters = payload.get("clusters") or {}
    key = str(cluster_id)
    if key not in clusters:
        raise HTTPException(
            status_code=404,
            detail="Cluster-specific global SHAP not available. Generate HYBRID_XAI_DIR/global_shap_by_cluster.json.",
        )
    c = clusters[key] or {}
    shap_imp = c.get("shap_importance") or {}
    return {
        "scope": "cluster",
        "cluster_id": cluster_id,
        "base_value": c.get("base_value"),
        "shap_importance": shap_imp,
        "top_features": list(shap_imp.keys())[:20],
        "available_clusters": sorted(
            [int(k) for k in clusters.keys() if str(k).isdigit()]
        ),
    }


@router.get("/analytics/trends", response_model=TrendsResponse)
def trends(town: Optional[str] = Query(default=None)):
    """
    Return median resale price per year.
    National (no town filter) is cached at startup; per-town is computed lazily.
    """
    if not town and state.cached_trends is not None:
        return state.cached_trends

    df = _ensure_hdb_df().copy()
    if town:
        df = df[df["town"].str.upper() == town.upper()]

    agg = (
        df.groupby("year")
        .agg(
            median_price=("resale_price", "median"),
            transaction_count=("resale_price", "count"),
        )
        .reset_index()
        .sort_values("year")
    )

    result = TrendsResponse(
        trends=[
            TrendPoint(
                year=int(row["year"]),
                median_price=round(float(row["median_price"]), 0),
                transaction_count=int(row["transaction_count"]),
            )
            for _, row in agg.iterrows()
        ],
        town_filter=town,
    )

    if not town:
        state.cached_trends = result

    return result


@router.get("/analytics/town-summary")
def get_town_summary():
    """
    Returns median price, YoY % change, and transaction count for all towns.
    Years are derived from the data (latest full year and its predecessor).
    """
    if state.cached_town_summary is not None:
        return state.cached_town_summary

    df = _ensure_hdb_df()
    all_years = sorted(df["year"].dropna().unique())

    current_year = int(all_years[-1]) if len(all_years) > 0 else 2024
    prev_year = int(all_years[-2]) if len(all_years) > 1 else current_year - 1
    next_year = current_year + 1

    df_cur = (
        df[df["year"] == current_year]
        .groupby("town")
        .agg(price_current=("resale_price", "median"), txn_current=("resale_price", "count"))
        .reset_index()
    )
    df_prev = (
        df[df["year"] == prev_year]
        .groupby("town")
        .agg(price_prev=("resale_price", "median"))
        .reset_index()
    )
    df_next = (
        df[df["year"] == next_year]
        .groupby("town")
        .agg(price_next=("resale_price", "median"))
        .reset_index()
    )

    merged = df_cur.merge(df_prev, on="town", how="left")
    merged = merged.merge(df_next, on="town", how="left")
    merged["yoy_pct"] = (
        (merged["price_current"] - merged["price_prev"]) / merged["price_prev"] * 100
    ).round(1)

    total_transactions = int(len(df))
    towns = []
    for _, row in merged.iterrows():
        towns.append(
            {
                "town": row["town"],
                "price_current": round(row["price_current"]),
                "price_prev": round(row["price_prev"])
                if pd.notna(row["price_prev"])
                else None,
                "price_next": round(row["price_next"])
                if pd.notna(row["price_next"])
                else None,
                "txn_current": int(row["txn_current"]),
                "yoy_pct": float(row["yoy_pct"]) if pd.notna(row["yoy_pct"]) else None,
            }
        )

    towns.sort(key=lambda x: x["price_current"], reverse=True)
    result = {
        "towns": towns,
        "year": current_year,
        "comparison_year": prev_year,
        "total_transactions": total_transactions,
    }
    state.cached_town_summary = result
    return result


@router.get("/rules", response_model=RulesResponse)
def get_rules():
    """Return Apriori + Surrogate rules for Rules Explorer."""
    return RulesResponse(
        apriori=state.rules["apriori"],
        surrogate=state.rules["surrogate"],
        metadata={
            **(state.rules.get("metadata") or {}),
            "condition_labels": CONDITION_LABELS,
            "binning": {
                "mrt": {"walking": "<0.5km", "near": "0.5–0.8km", "far": ">0.8km"},
                "lease": {"short": "<50yr", "medium": "50–70yr (55–70yr preferred)", "long": ">70yr"},
                "area": {"small": "<70sqm", "medium": "70–100sqm", "large": ">100sqm"},
                "storey": {"low": "1–5", "mid": "6–12", "high": ">12"},
                "price": {"budget": "<350k", "mid": "350–550k", "premium": ">550k"},
            },
        },
    )
