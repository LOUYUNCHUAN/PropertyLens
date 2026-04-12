"""
Per-prediction SHAP for the cluster-routed XGBoost component using XGBoost native
``pred_contribs`` (avoids shap.TreeExplainer + malformed base_score in saved boosters).

``base_value + sum(shap_i)`` equals the cluster XGBoost prediction (not the full hybrid stack).
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import xgboost as xgb

from hybrid_inference import cluster_label_for_X


def _cluster_bundle(bundle: dict[str, Any], cluster_id: int) -> dict[str, Any]:
    cb = bundle["cluster_bundles"].get(cluster_id)
    if cb is None:
        cb = bundle["cluster_bundles"].get(str(cluster_id))
    if cb is None:
        raise KeyError(f"No cluster bundle for id {cluster_id}")
    return cb


def xgb_model_for_cluster_shap(bundle: dict[str, Any], cluster_id: int) -> Any:
    """XGBoost regressor used for SHAP: per-cluster model, or global XGB when cluster uses fallback routing."""
    cb = _cluster_bundle(bundle, cluster_id)
    if cb.get("fallback"):
        return bundle["global_models"]["xgb"]
    return cb["xgb"]


def compute_cluster_xgb_shap(
    X: np.ndarray,
    bundle: dict[str, Any],
    feature_cols: list[str],
) -> tuple[np.ndarray, float, int, float]:
    """
    Returns (shap_values length n_features, base_value, cluster_id, xgb_prediction).
    Uses Booster.predict(..., pred_contribs=True); last column is bias / expected value.
    """
    X = np.asarray(X, dtype=float).reshape(1, -1)
    if X.shape[1] != len(feature_cols):
        raise ValueError(f"Expected {len(feature_cols)} features, got {X.shape[1]}")

    cluster_id = cluster_label_for_X(X, bundle)
    model = xgb_model_for_cluster_shap(bundle, cluster_id)
    df = pd.DataFrame(X, columns=feature_cols)
    dm = xgb.DMatrix(df, feature_names=feature_cols)
    contribs = np.asarray(model.get_booster().predict(dm, pred_contribs=True), dtype=float).ravel()
    n = len(feature_cols)
    if contribs.size != n + 1:
        raise ValueError(f"pred_contribs length {contribs.size}, expected {n + 1}")

    base_value = float(contribs[-1])
    shap_vals = contribs[:-1].copy()
    xgb_pred = float(model.predict(df)[0])
    return shap_vals, base_value, cluster_id, xgb_pred
