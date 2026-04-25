"""
analytics.py — /api/analytics/global-shap, /api/analytics/trends, /api/rules
"""

from typing import Optional

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
import pandas as pd

from backend.models import TrendsResponse, TrendPoint, RulesResponse
from backend.app_state import state, ARTIFACTS_ROOT, FEATURE_LAYER_OUTPUTS, REPO_ROOT
from backend.constraints import CONDITION_LABELS

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


def _recent_transactions_df() -> pd.DataFrame:
    """
    Build a richer transactions frame for /analytics/recent-transactions.

    Returned columns (any may be NaN when the source lacks them):
      year (int), month (int|NaN), town (str), flat_type (str|NaN),
      floor_area_sqm (float|NaN), block (str|NaN), street_name (str|NaN),
      resale_price (float).

    Data caveat: the Layer-02 feature table only exposes year (not month) and
    one-hot town/flat_type — block and street_name are absent. We reconstruct
    town and flat_type from the one-hot columns and return NaN for month/block/
    street when unavailable. Callers must sort on what exists.
    """
    for pq in (
        ARTIFACTS_ROOT / "hdb_features.parquet",
        REPO_ROOT / "data" / "processed" / "hdb_features.parquet",
    ):
        if pq.exists():
            df = pd.read_parquet(pq)
            if "year" not in df.columns and "transaction_year" in df.columns:
                df = df.rename(columns={"transaction_year": "year"})
            for col in ("month", "flat_type", "floor_area_sqm", "block", "street_name"):
                if col not in df.columns:
                    df[col] = pd.NA
            return df[
                [
                    "year",
                    "month",
                    "town",
                    "flat_type",
                    "floor_area_sqm",
                    "block",
                    "street_name",
                    "resale_price",
                ]
            ].copy()

    tables = sorted(FEATURE_LAYER_OUTPUTS.glob("hdb_feature_table_*.csv"))
    if not tables:
        raise FileNotFoundError(
            f"No recent-transactions data: add hdb_features.parquet under {ARTIFACTS_ROOT} "
            f"or hdb_feature_table_*.csv under {FEATURE_LAYER_OUTPUTS}"
        )
    path = tables[-1]
    peek = pd.read_csv(path, nrows=0)
    town_cols = [c for c in peek.columns if c.startswith("town_")]
    flat_cols = [c for c in peek.columns if c.startswith("flat_type_")]
    base = ["resale_price", "transaction_year"]
    optional = [c for c in ("floor_area_sqm", "month", "block", "street_name") if c in peek.columns]
    use_cols = base + optional + town_cols + flat_cols
    df = pd.read_csv(path, usecols=use_cols)
    df = df.rename(columns={"transaction_year": "year"})
    df["town"] = df[town_cols].idxmax(axis=1).str.replace("town_", "", regex=False)
    if flat_cols:
        df["flat_type"] = df[flat_cols].idxmax(axis=1).str.replace("flat_type_", "", regex=False)
    else:
        df["flat_type"] = pd.NA
    for col in ("month", "floor_area_sqm", "block", "street_name"):
        if col not in df.columns:
            df[col] = pd.NA
    return df[
        [
            "year",
            "month",
            "town",
            "flat_type",
            "floor_area_sqm",
            "block",
            "street_name",
            "resale_price",
        ]
    ].copy()


def _ensure_hdb_recent_df() -> pd.DataFrame:
    if state.hdb_recent_df is None:
        state.hdb_recent_df = _recent_transactions_df()
    return state.hdb_recent_df


@router.get("/analytics/global-shap")
def global_shap(
    cluster_id: Optional[int] = Query(default=None, ge=0),
    source: str = Query(default="composite", pattern="^(composite|tree-only)$"),
):
    """
    Return pre-computed global SHAP importance for Analyst view.

    - ``source=composite`` (default): mean(|SHAP|) from full hybrid stack
      (XGB+LGB+RF blended via meta-learner). Falls back to ``tree-only`` if
      the artifact is missing.
    - ``source=tree-only``: legacy mean(|SHAP|) from the routed XGB
      explainer alone.

    - No cluster_id: overall mean(|SHAP|) for all sampled rows.
    - With cluster_id: cluster-specific mean(|SHAP|) and (optional) base_value.
    """

    composite = state.composite_global_shap
    use_composite = source == "composite" and composite is not None
    cluster_profiles = (state.cluster_profiles or {}).get("clusters") or {}

    if use_composite:
        if cluster_id is None:
            by_cluster = (state.global_shap_by_cluster or {}).get("clusters") or {}
            cluster_counts = state.model_meta.get("cluster_counts_train") or {}

            # Re-use the legacy artifact's per-cluster base_values weighted by
            # training-cluster counts so the UI can still show a baseline chip.
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

            shap_imp = composite.get("global_feature_importance") or {}
            per_cluster = composite.get("per_cluster_importance") or {}
            return {
                "scope": "overall",
                "cluster_id": None,
                "method": composite.get("method", "CompositeTreeSHAP"),
                "n_samples": composite.get("n_samples"),
                "ridge_gap_mean_abs": composite.get("ridge_gap_mean_abs"),
                "ridge_gap_pct_of_pred": composite.get("ridge_gap_pct_of_pred"),
                "base_value": overall_base,
                "shap_importance": shap_imp,
                "top_features": list(shap_imp.keys())[:20],
                "available_clusters": sorted(
                    int(k) for k in per_cluster.keys() if str(k).isdigit()
                ),
                "cluster_profiles": cluster_profiles,
            }

        # Composite per-cluster
        per_cluster = composite.get("per_cluster_importance") or {}
        key = str(cluster_id)
        if key not in per_cluster:
            raise HTTPException(
                status_code=404,
                detail=f"Composite SHAP not available for cluster {cluster_id}.",
            )
        shap_imp = per_cluster[key] or {}
        # Reuse legacy base_value if present.
        legacy_clusters = (state.global_shap_by_cluster or {}).get("clusters") or {}
        base_val = (legacy_clusters.get(key) or {}).get("base_value")
        return {
            "scope": "cluster",
            "cluster_id": cluster_id,
            "method": composite.get("method", "CompositeTreeSHAP"),
            "n_samples": composite.get("n_samples"),
            "ridge_gap_mean_abs": composite.get("ridge_gap_mean_abs"),
            "ridge_gap_pct_of_pred": composite.get("ridge_gap_pct_of_pred"),
            "base_value": base_val,
            "shap_importance": shap_imp,
            "top_features": list(shap_imp.keys())[:20],
            "available_clusters": sorted(
                int(k) for k in per_cluster.keys() if str(k).isdigit()
            ),
            "cluster_profiles": cluster_profiles,
            "active_cluster_profile": cluster_profiles.get(str(cluster_id)),
        }

    # ── Legacy tree-only path (XGB explainer only) ────────────────────
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
            "method": "TreeSHAP (XGB only)",
            "base_value": overall_base,
            "shap_importance": state.global_shap,
            "top_features": list(state.global_shap.keys())[:20],
            "available_clusters": sorted(
                int(k) for k in by_cluster.keys() if str(k).isdigit()
            ),
        }

    # Cluster-specific tree-only (requires optional artifact)
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
        "method": "TreeSHAP (XGB only)",
        "base_value": c.get("base_value"),
        "shap_importance": shap_imp,
        "top_features": list(shap_imp.keys())[:20],
        "available_clusters": sorted(
            int(k) for k in clusters.keys() if str(k).isdigit()
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


@router.get("/analytics/recent-transactions")
def recent_transactions(
    limit: int = Query(default=15, ge=1, le=50),
    town: Optional[str] = Query(default=None),
):
    """
    Recent HDB resale transactions for the dashboard feed.

    Sorts by (year desc, month desc) when `month` is available; otherwise by
    (year desc, resale_price desc) as a stable secondary.

    Data caveat: when the source is the Layer-02 feature table, `month`,
    `block`, and `street_name` are not available and are returned as null.
    """
    df = _ensure_hdb_recent_df()
    if town:
        df = df[df["town"].str.upper() == town.upper()]

    has_month = df["month"].notna().any()
    sort_cols = ["year"] + (["month"] if has_month else ["resale_price"])
    df = df.sort_values(sort_cols, ascending=[False] * len(sort_cols)).head(int(limit))

    def _row(r):
        return {
            "year": int(r["year"]) if pd.notna(r["year"]) else None,
            "month": int(r["month"]) if pd.notna(r["month"]) else None,
            "town": r["town"] if pd.notna(r["town"]) else None,
            "flat_type": r["flat_type"] if pd.notna(r["flat_type"]) else None,
            "floor_area_sqm": float(r["floor_area_sqm"]) if pd.notna(r["floor_area_sqm"]) else None,
            "block": r["block"] if pd.notna(r["block"]) else None,
            "street_name": r["street_name"] if pd.notna(r["street_name"]) else None,
            "resale_price": float(r["resale_price"]) if pd.notna(r["resale_price"]) else None,
        }

    rows = [_row(r) for _, r in df.iterrows()]
    full = _ensure_hdb_recent_df()
    as_of_year = int(full["year"].max()) if len(full) else None
    return {
        "rows": rows,
        "as_of_year": as_of_year,
        "has_month": bool(has_month),
        "town_filter": town,
    }


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
