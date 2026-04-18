"""
cbr.py — /api/cbr/similar
Returns top-k most similar past transactions using BallTree.
Case pool: same calendar year as the query first; if fewer than k rows, widens
to the 3-year recency window, then the previous town / all-rows relaxations.
"""

from datetime import datetime

from fastapi import APIRouter
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from backend.models import CBRRequest, CBRResponse, CBRCase

router = APIRouter()


def _cbr_year_series(df):
    if "year" in df.columns:
        return df["year"]
    if "transaction_year" in df.columns:
        return df["transaction_year"]
    raise ValueError("CBR training data needs 'year' or 'transaction_year'")


def _filter_cbr_df_for_k(
    df: pd.DataFrame,
    ys: pd.Series,
    *,
    k_requested: int,
    flat_year: int,
    min_year: int,
    town_val: str,
    has_town_col: bool,
) -> pd.DataFrame:
    """Prefer same calendar year, then widen to the 3-year floor window and prior relaxations."""
    if town_val and has_town_col:
        town_mask = df["town"].str.upper() == town_val
        tiers = [
            df[town_mask & (ys == flat_year)],
            df[town_mask & (ys >= min_year)],
            df[town_mask],
            df[ys >= min_year],
            df,
        ]
    else:
        tiers = [
            df[ys == flat_year],
            df[ys >= min_year],
            df,
        ]

    df_filtered = tiers[0]
    for wider in tiers[1:]:
        if len(df_filtered) >= k_requested:
            break
        df_filtered = wider

    return df if df_filtered.empty else df_filtered


def _split_address_key(key) -> tuple[str, str]:
    s = str(key or "").strip()
    if not s:
        return "", ""
    parts = s.split(None, 1)
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _room_count_to_flat_type(rc) -> str:
    try:
        n = int(round(float(rc)))
    except (TypeError, ValueError):
        return ""
    return {1: "1 ROOM", 2: "2 ROOM", 3: "3 ROOM", 4: "4 ROOM", 5: "5 ROOM"}.get(
        n, f"{n} ROOM"
    )


def compute_cbr_median(comparables: list) -> float | None:
    """Return median resale_price from CBR comparables list."""
    prices = [c["resale_price"] for c in comparables if c.get("resale_price")]
    if not prices:
        return None
    prices.sort()
    mid = len(prices) // 2
    return prices[mid]


def run_cbr_similar(req: CBRRequest) -> CBRResponse:
    from backend.main import state
    from backend.predict import flat_to_feature_vector

    # Build full feature vector and aligned subset used for CBR
    full_X = flat_to_feature_vector(req.flat)
    feature_index_pairs = [
        (f, list(state.feature_cols).index(f))
        for f in state.cbr_feature_cols
        if f in state.feature_cols
    ]
    feat_indices = [idx for _, idx in feature_index_pairs]
    cbr_X = full_X[feat_indices].reshape(1, -1)

    # Normalise using saved scaler for the query vector
    cbr_X_norm = state.cbr_scaler.transform(cbr_X)

    # ── Stage 1: filter training data by town and year ───────────────
    df = state.cbr_df
    k_requested = max(1, min(req.k, len(df)))

    # Determine current year from request (preferred) or system clock
    flat_year = getattr(req.flat, "year", None) or datetime.now().year
    min_year = max(flat_year - 3, 2022)

    town_val = (getattr(req.flat, "town", None) or "").upper()
    ys = _cbr_year_series(df)
    has_town_col = "town" in df.columns

    df_filtered = _filter_cbr_df_for_k(
        df,
        ys,
        k_requested=k_requested,
        flat_year=int(flat_year),
        min_year=min_year,
        town_val=town_val,
        has_town_col=has_town_col,
    )

    # ── Stage 2: BallTree on filtered subset ────────────────────────
    feature_cols = list(state.cbr_feature_cols)
    feature_matrix = df_filtered[feature_cols].values
    feature_matrix_scaled = state.cbr_scaler.transform(feature_matrix)

    temp_tree = BallTree(feature_matrix_scaled, metric="euclidean")

    actual_k = min(k_requested, len(df_filtered))
    dists, idxs = temp_tree.query(cbr_X_norm, k=actual_k)

    comparables = df_filtered.iloc[idxs[0]].copy()

    # Similarity: absolute score — 1/(1+d)*100, independent of other results
    sim = (1 / (1 + dists[0])) * 100.0
    comparables["similarity_pct"] = np.round(sim, 1)
    d_row = dists[0]
    d_max = float(np.max(d_row)) if len(d_row) else 0.0
    if d_max > 1e-12:
        display_sim = 100.0 * (1.0 - d_row / d_max)
    else:
        display_sim = np.full_like(d_row, 100.0)
    comparables["similarity_display_pct"] = np.round(display_sim, 1)

    cases = []
    for _, row in comparables.iterrows():
        month_raw = row.get("month", None)
        try:
            month_val = int(month_raw) if month_raw is not None else None
        except (TypeError, ValueError):
            month_val = None

        blk = row.get("block", "")
        st = row.get("street_name", "")
        if (not blk and not st) and "address_key" in row.index:
            blk, st = _split_address_key(row.get("address_key", ""))

        tw = str(row.get("town", "") or "")
        ft = str(row.get("flat_type", "") or "")
        if not ft and "room_count" in row.index:
            ft = _room_count_to_flat_type(row.get("room_count"))

        smid = row.get("storey_mid", None)
        if smid is None or pd.isna(smid):
            smid = row.get("level_mid", 0)

        yr = row.get("year", None)
        if yr is None or pd.isna(yr):
            yr = row.get("transaction_year", 0)

        cases.append(
            CBRCase(
                block=str(blk),
                street_name=str(st),
                town=tw,
                flat_type=ft,
                floor_area_sqm=float(row.get("floor_area_sqm", 0)),
                storey_mid=float(smid or 0),
                remaining_lease_years=float(row.get("remaining_lease_years", 0)),
                resale_price=float(row.get("resale_price", 0)),
                year=int(yr or 0),
                month=month_val,
                similarity_pct=float(row.get("similarity_pct", 0)),
                similarity_display_pct=(
                    float(row["similarity_display_pct"])
                    if "similarity_display_pct" in row.index
                    and pd.notna(row.get("similarity_display_pct"))
                    else None
                ),
            )
        )

    query_features = {
        name: round(float(full_X[idx]), 3) for name, idx in feature_index_pairs
    }

    return CBRResponse(comparables=cases, query_features=query_features)


@router.post("/cbr/similar", response_model=CBRResponse)
def cbr_similar(req: CBRRequest):
    return run_cbr_similar(req)
