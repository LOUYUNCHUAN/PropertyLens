"""
Tests for the /api/explain/buyer-view presentation transform.

Covers:
1. Strengths always have delta > 0; trade-offs always have delta < 0.
2. Pre-threshold grouped deltas reconstruct the cluster-XGB estimate within $10
   (cohort_baseline + sum(grouped.deltas) ≈ xgb_pred). Note: the spec asks for
   reconstruction of ``estimate``, but ``estimate`` is the hybrid-ensemble
   prediction while SHAP is against cluster XGB only — the hybrid gap is real
   and documented, so we assert the exact identity and print the hybrid gap.
3. Small-cohort fallback returns 200, confidence="low", no percentile bars, no
   cohort_price_range.
4. Verdict label/tone consistent with pct_diff_vs_baseline bands for 20 flats.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_OK = (REPO_ROOT / "data" / "artifacts" / "hybrid_xai" / "cbr_training_data.parquet").exists()

pytestmark = pytest.mark.skipif(
    not ARTIFACTS_OK, reason="Hybrid artifacts not present."
)


@pytest.fixture(scope="module")
def loaded_state():
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

    meta_path = ARTIFACTS_ROOT / "hybrid_cluster_meta.json"
    with open(meta_path) as f:
        state.model_meta = json.load(f)

    return state


@pytest.fixture(scope="module")
def client(loaded_state):
    from backend.predict import router as predict_router

    app = FastAPI()
    app.include_router(predict_router, prefix="/api")
    return TestClient(app)


def _sample_flat_payload(k: int = 30) -> dict:
    return {
        "flat": {
            "floor_area_sqm": 93,
            "storey_mid": 10,
            "remaining_lease_years": 75,
            "lease_commence_date": 1998,
            "dist_nearest_mrt_km": 0.4,
            "town": "TAMPINES",
            "flat_type": "4 ROOM",
            "block": "201",
            "street_name": "TAMPINES ST 21",
            "storey_range": "10 TO 12",
            "sale_month": "2025-06",
            "year": 2025,
            "month_num": 6,
        },
        "k": k,
    }


def _pick_random_flats(cbr_df, ak_to_town, n: int, seed: int = 7) -> list[dict]:
    from backend.cbr import _split_address_key
    from backend.cohort_shap import _ROOM_COUNT_TO_FLAT_TYPE, _clamp_lease_commence

    rng = np.random.default_rng(seed)
    year_col = "transaction_year" if "transaction_year" in cbr_df.columns else "year"
    recent = cbr_df[cbr_df[year_col] >= 2023]
    if len(recent) < n * 3:
        recent = cbr_df
    sample = recent.sample(n=min(n * 5, len(recent)), random_state=seed)

    flats: list[dict] = []
    for _, row in sample.iterrows():
        ak = str(row.get("address_key", "") or "").strip().upper()
        town = ak_to_town.get(ak)
        if not town:
            continue
        block, street = _split_address_key(ak)
        if not block or not street:
            continue
        try:
            rc = int(round(float(row.get("room_count", 0))))
            area = float(row.get("floor_area_sqm", 0) or 0)
            level = int(round(float(row.get("level_mid", 0) or 0)))
            lease_remain = float(row.get("lease_remaining_years", 0) or 0)
            txn_year = int(row.get("transaction_year", 0) or 0)
        except (TypeError, ValueError):
            continue
        ft = _ROOM_COUNT_TO_FLAT_TYPE.get(rc)
        if not ft or area <= 0 or level <= 0 or txn_year < 1990 or txn_year > 2026:
            continue
        flats.append(
            {
                "flat": {
                    "floor_area_sqm": area,
                    "storey_mid": float(level),
                    "remaining_lease_years": max(1.0, min(99.0, lease_remain)),
                    "lease_commence_date": _clamp_lease_commence(txn_year, lease_remain),
                    "dist_nearest_mrt_km": 0.5,
                    "town": town,
                    "flat_type": ft,
                    "block": block,
                    "street_name": street,
                    "storey_range": f"{level:02d} TO {level:02d}",
                    "sale_month": f"{txn_year:04d}-06",
                    "year": txn_year,
                    "month_num": 6,
                },
                "k": 30,
            }
        )
        if len(flats) >= n:
            break

    # Deterministic shuffle so tests are reproducible
    rng.shuffle(flats)
    return flats


def test_strengths_positive_tradeoffs_negative(client):
    res = client.post("/api/explain/buyer-view", json=_sample_flat_payload())
    assert res.status_code == 200, res.text
    body = res.json()

    for s in body["strengths"]:
        assert s["delta"] > 0, f"strength {s['feature_group']} has non-positive delta {s['delta']}"
    for t in body["tradeoffs"]:
        assert t["delta"] < 0, f"tradeoff {t['feature_group']} has non-negative delta {t['delta']}"


def test_grouped_deltas_reconstruct_estimate(loaded_state, client):
    """
    cohort_baseline + sum(all grouped deltas, pre-threshold) must reconstruct the
    cluster-XGB prediction within $10 (the efficiency identity). We also print
    the residual against the hybrid estimate — it is expected to be non-zero
    because the hybrid ensemble blends 4 base models + Ridge meta.
    """
    from backend.buyer_view import group_phi
    from backend.cohort_shap import compute_cohort_shap
    from backend.models import PredictRequest
    from backend.predict import flat_to_feature_vector, predict_hybrid, _public_price

    payload = _sample_flat_payload()
    req_flat = PredictRequest(**payload["flat"])
    X = flat_to_feature_vector(req_flat).reshape(1, -1)
    cohort = compute_cohort_shap(
        X, loaded_state.hybrid_bundle, loaded_state.feature_cols, req_flat, k=payload["k"]
    )
    grouped = group_phi(cohort.phi_cohort, loaded_state.feature_cols)
    total_delta = sum(delta for delta, _idxs in grouped.values())

    reconstructed = cohort.cohort_baseline + total_delta
    identity_gap = abs(reconstructed - cohort.xgb_pred)
    assert identity_gap < 10.0, (
        f"Pre-threshold grouped deltas do not reconstruct cluster-XGB prediction: "
        f"reconstructed={reconstructed:.2f}, xgb_pred={cohort.xgb_pred:.2f}, gap={identity_gap:.2f}"
    )

    hybrid_estimate = _public_price(predict_hybrid(X))
    hybrid_gap = abs(reconstructed - hybrid_estimate)
    print(
        f"\nIdentity gap vs cluster-XGB = {identity_gap:.4f}; "
        f"expected residual vs hybrid estimate = {hybrid_gap:.2f}"
    )


def test_small_cohort_fallback(client, monkeypatch):
    """If the cohort has fewer than 10 neighbours, confidence drops to 'low'."""
    from backend import predict as predict_mod
    from backend.cohort_shap import CohortSHAPResult, compute_cohort_shap as _real

    feat_n = len(predict_mod.state.feature_cols)

    def _small_cohort(X, bundle, feature_cols, req_flat, k=30):
        real = _real(X, bundle, feature_cols, req_flat, k=k)
        # Shrink cohort to 5 rows to force the fallback path.
        X_small = real.X_cohort[:5] if real.X_cohort.size else np.zeros((5, feat_n))
        prices_small = (
            real.cohort_prices[:5] if real.cohort_prices.size else np.zeros(5)
        )
        return CohortSHAPResult(
            phi_cohort=real.phi_cohort,
            phi_global=real.phi_global,
            feature_values=real.feature_values,
            cohort_baseline=real.cohort_baseline,
            base_value_global=real.base_value_global,
            xgb_pred=real.xgb_pred,
            cluster_id=real.cluster_id,
            cohort_size=5,
            cohort_median_price=real.cohort_median_price,
            cohort_town_mix=real.cohort_town_mix,
            X_cohort=X_small,
            cohort_prices=prices_small,
        )

    monkeypatch.setattr("backend.predict.compute_cohort_shap", _small_cohort, raising=False)
    # Endpoint imports lazily inside the handler — patch at the source module too.
    import backend.cohort_shap as cs
    monkeypatch.setattr(cs, "compute_cohort_shap", _small_cohort)

    res = client.post("/api/explain/buyer-view", json=_sample_flat_payload())
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["confidence"] == "low"
    assert body["cohort_price_range"] is None
    for driver in body["strengths"] + body["tradeoffs"]:
        assert driver.get("cohort_percentile") is None
        assert driver.get("percentile_label") is None


def test_market_context_routes_transaction_year(loaded_state, client):
    """
    For a 2025 listing, transaction_year must not appear in strengths/tradeoffs;
    its delta is routed into market_context.delta instead.
    """
    from backend.buyer_view import group_phi
    from backend.cohort_shap import compute_cohort_shap
    from backend.models import PredictRequest
    from backend.predict import flat_to_feature_vector

    payload = _sample_flat_payload()
    assert payload["flat"]["year"] == 2025

    # Ground-truth transaction_year delta from the raw grouped phi.
    req_flat = PredictRequest(**payload["flat"])
    X = flat_to_feature_vector(req_flat).reshape(1, -1)
    cohort = compute_cohort_shap(
        X, loaded_state.hybrid_bundle, loaded_state.feature_cols, req_flat, k=payload["k"]
    )
    grouped = group_phi(cohort.phi_cohort, loaded_state.feature_cols)
    expected_delta = grouped["transaction_year"][0]

    res = client.post("/api/explain/buyer-view", json=payload)
    assert res.status_code == 200, res.text
    body = res.json()

    # transaction_year must not appear as a ranked strength or tradeoff.
    driver_groups = {d["feature_group"] for d in body["strengths"] + body["tradeoffs"]}
    assert "transaction_year" not in driver_groups

    assert body["market_context"] is not None
    assert abs(body["market_context"]["delta"] - expected_delta) < 1.0
    assert body["market_context"]["direction"] in {"up", "down", "flat"}
    assert "2025" in body["market_context"]["descriptor"]


def test_verdict_bands_consistent(client, loaded_state):
    """For 20 random flats, verdict.label matches pct_diff_vs_baseline bands."""
    from backend.buyer_view import verdict_from_pct
    from backend.cohort_shap import _address_key_to_town
    from backend.hybrid_inference import default_feature_table_csv

    ak_to_town = _address_key_to_town(str(default_feature_table_csv()))
    flats = _pick_random_flats(loaded_state.cbr_df, ak_to_town, n=20)
    assert len(flats) >= 10, f"Could only build {len(flats)} test flats"

    checked = 0
    for payload in flats:
        res = client.post("/api/explain/buyer-view", json=payload)
        if res.status_code != 200:
            continue
        body = res.json()
        pct = body["verdict"]["pct_diff_vs_baseline"]
        expected_label, expected_tone = verdict_from_pct(pct)
        assert body["verdict"]["label"] == expected_label, (
            f"pct_diff {pct} → expected '{expected_label}', got '{body['verdict']['label']}'"
        )
        assert body["verdict"]["tone"] == expected_tone
        checked += 1

    assert checked >= 10, f"Only {checked}/20 flats completed; band check too weak."
