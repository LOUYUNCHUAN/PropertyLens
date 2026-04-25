"""
Cohort-relative SHAP for the cluster-routed XGBoost component.

Reframes the SHAP baseline from the global training mean to the mean SHAP over a
cohort of k nearest neighbours drawn from the existing CBR BallTree index.
Efficiency identity at the cluster-XGB level is preserved:

    xgb_pred(x) = cohort_baseline + Σ phi_cohort(x)

where
    phi_cohort(x)   = phi_global(x) − mean_{x' ∈ cohort}[ phi_global(x') ]
    cohort_baseline = base_value_global + mean_{x' ∈ cohort}[ phi_global(x') ].sum()

Caveats (also surfaced on the endpoint response as ``explained_model``):

- This does NOT explain the full hybrid ensemble. The Ridge/XGB/LGB/RF stack +
  Ridge meta-learner has no single booster, so SHAP applies to the cluster XGB
  only — same caveat as ``/api/explain/shap``.
- ``state.cbr_df`` is not row-ordered with ``X_train``; we therefore rebuild each
  neighbour's 77-column feature vector via ``build_yc_hybrid_vector`` instead of
  reading from a training matrix.
- Cohort neighbours may belong to different clusters than the query. We
  intentionally explain all neighbours with the **query's** cluster booster so
  the SHAP values are commensurable for reframing.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.neighbors import BallTree

from backend.cbr import _filter_cbr_df_for_k, _cbr_year_series, _split_address_key
from backend.hybrid_inference import (
    build_yc_hybrid_vector,
    default_feature_table_csv,
)
from backend.shap_local import compute_cluster_xgb_shap, xgb_model_for_cluster_shap


_ROOM_COUNT_TO_FLAT_TYPE = {
    1: "1 ROOM",
    2: "2 ROOM",
    3: "3 ROOM",
    4: "4 ROOM",
    5: "5 ROOM",
}


@dataclass
class CohortSHAPResult:
    phi_cohort: np.ndarray          # reframed SHAP (n_features,)
    phi_global: np.ndarray          # original query SHAP (n_features,)
    feature_values: np.ndarray      # query feature values (n_features,)
    cohort_baseline: float
    base_value_global: float
    xgb_pred: float                 # cluster XGB prediction for the query
    cluster_id: int
    cohort_size: int
    cohort_median_price: float
    cohort_town_mix: dict[str, int]
    # Neighbour-level data retained for downstream buyer-view transforms that
    # need percentiles on raw features and a true cohort price range (vs just
    # the median). Not serialized by /explain/cohort-shap.
    X_cohort: np.ndarray            # (m, n_features) surviving neighbour rows
    cohort_prices: np.ndarray       # (m,) resale_price of surviving neighbours


@lru_cache(maxsize=4)
def _address_key_to_town(feature_table_csv: str) -> dict[str, str]:
    """Build {ADDRESS_KEY_UPPER: 'TOWN NAME'} once from the feature table."""
    df = pd.read_csv(feature_table_csv, usecols=lambda c: c == "address_key" or c.startswith("town_"))
    town_cols = [c for c in df.columns if c.startswith("town_")]
    # Each row has exactly one town one-hot == 1.
    town_series = df[town_cols].idxmax(axis=1).str.replace("town_", "", regex=False)
    ak = df["address_key"].astype(str).str.upper().str.strip()
    return dict(zip(ak, town_series))


def _cohort_rows_from_cbr(req_flat, k: int):
    """
    Query the CBR BallTree with the same tier logic as ``run_cbr_similar`` but
    with a larger k (default 30) so the cohort mean is stable. Returns the
    filtered + nearest-k slice of ``state.cbr_df``.
    """
    from backend.app_state import state
    from backend.predict import flat_to_feature_vector
    from datetime import datetime

    full_X = flat_to_feature_vector(req_flat)
    feat_indices = [
        list(state.feature_cols).index(f)
        for f in state.cbr_feature_cols
        if f in state.feature_cols
    ]
    cbr_X = full_X[feat_indices].reshape(1, -1)
    cbr_X_norm = state.cbr_scaler.transform(cbr_X)

    df = state.cbr_df
    k_requested = max(1, min(k, len(df)))

    flat_year = getattr(req_flat, "year", None) or datetime.now().year
    town_val = (getattr(req_flat, "town", None) or "").upper()
    ys = _cbr_year_series(df)
    has_town_col = "town" in df.columns

    df_filtered = _filter_cbr_df_for_k(
        df,
        ys,
        k_requested=k_requested,
        flat_year=int(flat_year),
        town_val=town_val,
        has_town_col=has_town_col,
    )

    feature_cols = list(state.cbr_feature_cols)
    feature_matrix = df_filtered[feature_cols].values
    feature_matrix_scaled = state.cbr_scaler.transform(feature_matrix)
    tree = BallTree(feature_matrix_scaled, metric="euclidean")

    actual_k = min(k_requested, len(df_filtered))
    _dists, idxs = tree.query(cbr_X_norm, k=actual_k)
    return df_filtered.iloc[idxs[0]].copy()


def _clamp_lease_commence(transaction_year: int, lease_remaining_years: float) -> int:
    """Back out lease_commence_date assuming 99-year HDB leases; clamp to PredictRequest bounds."""
    commence = int(round(transaction_year - (99.0 - float(lease_remaining_years))))
    return max(1960, min(2035, commence))


def _neighbours_to_X(
    cohort_df: pd.DataFrame,
    feature_cols: list[str],
) -> tuple[np.ndarray, pd.DataFrame]:
    """
    Rebuild a 77-column feature vector for each cohort neighbour by calling
    ``build_yc_hybrid_vector`` with inputs reconstructed from the CBR row
    (address_key + room_count + level_mid + lease_remaining_years + year).

    Returns (X_cohort of shape (m, n_features), surviving_rows). Rows whose town
    cannot be resolved from the feature table are dropped.
    """
    yc_csv_path = str(default_feature_table_csv())
    ak_to_town = _address_key_to_town(yc_csv_path)

    kept_rows = []
    vectors = []
    for _, row in cohort_df.iterrows():
        ak_raw = str(row.get("address_key", "") or "").strip()
        if not ak_raw:
            continue
        town = ak_to_town.get(ak_raw.upper())
        if not town:
            continue

        block, street = _split_address_key(ak_raw)
        if not block or not street:
            continue

        rc = row.get("room_count")
        try:
            ft = _ROOM_COUNT_TO_FLAT_TYPE.get(int(round(float(rc))))
        except (TypeError, ValueError):
            ft = None
        if not ft:
            continue

        try:
            area = float(row.get("floor_area_sqm", 0) or 0)
            level = int(round(float(row.get("level_mid", 0) or 0)))
            lease_remain = float(row.get("lease_remaining_years", 0) or 0)
            txn_year = int(row.get("transaction_year", 0) or 0)
        except (TypeError, ValueError):
            continue
        if area <= 0 or level <= 0 or txn_year <= 0:
            continue

        storey_range = f"{level:02d} TO {level:02d}"
        sale_month = f"{txn_year:04d}-06"
        lease_commence = _clamp_lease_commence(txn_year, lease_remain)

        try:
            built = build_yc_hybrid_vector(
                block,
                street,
                town,
                ft,
                area,
                storey_range,
                lease_commence,
                sale_month,
                feature_columns=feature_cols,
            )
        except Exception:
            continue

        vectors.append(built["vector"].ravel())
        kept_rows.append(row)

    if not vectors:
        raise RuntimeError(
            "No cohort neighbours could be resolved to full feature vectors — "
            "feature-table address_key lookups all failed."
        )

    X_cohort = np.asarray(vectors, dtype=float)
    surviving = pd.DataFrame(kept_rows)
    return X_cohort, surviving


def compute_cohort_shap(
    X_query: np.ndarray,
    bundle: dict[str, Any],
    feature_cols: list[str],
    req_flat,
    k: int = 30,
) -> CohortSHAPResult:
    """
    Main entry point. See module docstring for the math and caveats.
    """
    X_query = np.asarray(X_query, dtype=float).reshape(1, -1)

    # 1. Global SHAP for the query
    phi_global_q, base_val, cluster_id, xgb_pred_q = compute_cluster_xgb_shap(
        X_query, bundle, feature_cols
    )

    # 2. Cohort construction
    cohort_df = _cohort_rows_from_cbr(req_flat, k=k)
    X_cohort, surviving = _neighbours_to_X(cohort_df, feature_cols)

    # 3. Batched SHAP over the cohort using the QUERY cluster's booster
    model = xgb_model_for_cluster_shap(bundle, cluster_id)
    dm = xgb.DMatrix(
        pd.DataFrame(X_cohort, columns=feature_cols),
        feature_names=feature_cols,
    )
    contribs = np.asarray(
        model.get_booster().predict(dm, pred_contribs=True), dtype=float
    )
    if contribs.ndim != 2 or contribs.shape[1] != len(feature_cols) + 1:
        raise RuntimeError(
            f"pred_contribs shape {contribs.shape} unexpected; "
            f"expected (m, {len(feature_cols) + 1})"
        )
    phi_cohort_mean = contribs[:, :-1].mean(axis=0)

    # 4. Reframe
    phi_cohort_q = phi_global_q - phi_cohort_mean
    cohort_baseline = float(base_val + phi_cohort_mean.sum())

    # 5. Cohort description for the UI
    if "town" in surviving.columns:
        town_mix = surviving["town"].astype(str).value_counts().to_dict()
    else:
        yc_csv_path = str(default_feature_table_csv())
        ak_to_town = _address_key_to_town(yc_csv_path)
        towns = [
            ak_to_town.get(str(ak or "").upper().strip(), "UNKNOWN")
            for ak in surviving.get("address_key", [])
        ]
        town_mix = pd.Series(towns).value_counts().to_dict()

    if "resale_price" in surviving.columns:
        prices = surviving["resale_price"].astype(float).to_numpy()
    else:
        prices = np.array([], dtype=float)
    median_price = float(np.median(prices)) if prices.size else 0.0

    return CohortSHAPResult(
        phi_cohort=phi_cohort_q,
        phi_global=phi_global_q,
        feature_values=X_query.ravel(),
        cohort_baseline=cohort_baseline,
        base_value_global=float(base_val),
        xgb_pred=float(xgb_pred_q),
        cluster_id=int(cluster_id),
        cohort_size=int(len(surviving)),
        cohort_median_price=median_price,
        cohort_town_mix={str(k): int(v) for k, v in town_mix.items()},
        X_cohort=X_cohort,
        cohort_prices=prices,
    )
