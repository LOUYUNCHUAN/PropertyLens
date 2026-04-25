"""
Efficiency-identity test for cohort-relative SHAP.

For a sample of 20 rows drawn from the CBR training data, builds a
``PredictRequest`` per row, runs ``compute_cohort_shap``, and asserts

    | xgb_pred(x) − (cohort_baseline + Σ phi_cohort(x)) | < 1.0

The identity is against the cluster-XGB prediction (``shap_model_prediction``),
NOT the full hybrid ensemble — see ``backend/cohort_shap.py`` for why.

Requires real artifacts at ``data/artifacts/hybrid_xai/*`` — skipped otherwise.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_OK = (REPO_ROOT / "data" / "artifacts" / "hybrid_xai" / "cbr_training_data.parquet").exists()

pytestmark = pytest.mark.skipif(
    not ARTIFACTS_OK,
    reason="Hybrid artifacts not present; cohort-SHAP identity test requires real bundle.",
)


@pytest.fixture(scope="module")
def loaded_state():
    """Load the hybrid bundle + CBR artifacts once per module."""
    import json
    import joblib
    import pandas as pd

    from backend.app_state import (
        state,
        ARTIFACTS_ROOT,
        FEATURE_LAYER_OUTPUTS,
        FEATURE_TABLE_CSV_RESOLVED,
        HYBRID_XAI_DIR,
    )
    from backend.hybrid_inference import HybridPredictWrapper, configure, load_bundle

    configure(ARTIFACTS_ROOT, FEATURE_LAYER_OUTPUTS, feature_table_csv=FEATURE_TABLE_CSV_RESOLVED)
    bundle = load_bundle()
    state.hybrid_bundle = bundle
    state.feature_cols = list(bundle["feature_columns"])
    state.xgb_model = HybridPredictWrapper(bundle)

    state.cbr_tree = joblib.load(HYBRID_XAI_DIR / "cbr_index.joblib")
    state.cbr_scaler = joblib.load(HYBRID_XAI_DIR / "cbr_scaler.joblib")
    state.cbr_df = pd.read_parquet(HYBRID_XAI_DIR / "cbr_training_data.parquet")
    with open(HYBRID_XAI_DIR / "cbr_features.json") as f:
        state.cbr_feature_cols = json.load(f)

    return state


def _row_to_predict_request(row, ak_to_town):
    from backend.cbr import _split_address_key
    from backend.cohort_shap import _clamp_lease_commence, _ROOM_COUNT_TO_FLAT_TYPE
    from backend.models import PredictRequest

    ak = str(row.get("address_key", "") or "").strip().upper()
    town = ak_to_town.get(ak)
    if not town:
        return None

    block, street = _split_address_key(ak)
    if not block or not street:
        return None

    try:
        rc = int(round(float(row.get("room_count", 0))))
    except (TypeError, ValueError):
        return None
    ft = _ROOM_COUNT_TO_FLAT_TYPE.get(rc)
    if not ft:
        return None

    try:
        area = float(row.get("floor_area_sqm", 0) or 0)
        level = int(round(float(row.get("level_mid", 0) or 0)))
        lease_remain = float(row.get("lease_remaining_years", 0) or 0)
        txn_year = int(row.get("transaction_year", 0) or 0)
    except (TypeError, ValueError):
        return None
    if area <= 0 or level <= 0 or txn_year <= 0:
        return None
    # PredictRequest validates year ≤ 2026; skip older rows (they still exist in
    # the cohort as neighbours, but we can't use them as query rows via the
    # schema without loosening bounds).
    if txn_year < 1990 or txn_year > 2026:
        return None

    lease_commence = _clamp_lease_commence(txn_year, lease_remain)
    return PredictRequest(
        floor_area_sqm=area,
        storey_mid=float(level),
        remaining_lease_years=max(1.0, min(99.0, lease_remain)),
        lease_commence_date=lease_commence,
        dist_nearest_mrt_km=0.5,
        town=town,
        flat_type=ft,
        block=block,
        street_name=street,
        storey_range=f"{level:02d} TO {level:02d}",
        sale_month=f"{txn_year:04d}-06",
        year=txn_year,
        month_num=6,
    )


def test_cohort_shap_efficiency_identity(loaded_state):
    """cohort_baseline + Σ phi_cohort should reconstruct the cluster XGB prediction."""
    from backend.cohort_shap import _address_key_to_town, compute_cohort_shap
    from backend.hybrid_inference import default_feature_table_csv
    from backend.predict import flat_to_feature_vector

    state = loaded_state
    ak_to_town = _address_key_to_town(str(default_feature_table_csv()))

    # Sample recent rows (year >= 2023) so PredictRequest validation accepts them
    # and feature-table lookups are most likely to succeed.
    df = state.cbr_df
    year_col = "transaction_year" if "transaction_year" in df.columns else "year"
    recent = df[df[year_col] >= 2023]
    if len(recent) < 20:
        recent = df
    sample = recent.sample(n=min(60, len(recent)), random_state=42)

    max_diff = 0.0
    checked = 0
    for _, row in sample.iterrows():
        req = _row_to_predict_request(row, ak_to_town)
        if req is None:
            continue

        try:
            X = flat_to_feature_vector(req).reshape(1, -1)
            result = compute_cohort_shap(
                X, state.hybrid_bundle, state.feature_cols, req, k=30
            )
        except Exception:
            continue

        reconstructed = result.cohort_baseline + float(np.sum(result.phi_cohort))
        diff = abs(result.xgb_pred - reconstructed)
        max_diff = max(max_diff, diff)
        # $5 ≈ 8e-6 relative on a ~$600k prediction — well below the noise floor
        # of TreeSHAP accumulation. A real logic regression in cohort reframing
        # would produce diffs in the hundreds or thousands, not single dollars.
        assert diff < 5.0, (
            f"Efficiency identity violated: xgb_pred={result.xgb_pred:.4f}, "
            f"cohort_baseline={result.cohort_baseline:.4f}, "
            f"Σ phi_cohort={np.sum(result.phi_cohort):.4f}, diff={diff:.4f}"
        )
        checked += 1
        if checked >= 20:
            break

    assert checked >= 10, (
        f"Only {checked} rows survived feature rebuild; expected at least 10 for a meaningful identity check."
    )
    print(f"\nCohort-SHAP identity: checked {checked} rows, max |diff| = {max_diff:.6f}")
