"""
Composite TreeSHAP for the full hybrid cluster ensemble.

Strategy (mirrors notebooks/04_xai_layer/07_composite_treeshap.ipynb):
  1. Route the row to a cluster via the bundled k-means.
  2. Run TreeSHAP on each tree base-learner (XGB via native pred_contribs to
     side-step the base_score string-encoding bug on newer XGBoost versions;
     LGB and RF via shap.TreeExplainer).
  3. Linearly combine per-model SHAP values using the meta-learner's
     coefficients ``[w_ridge, w_xgb, w_lgb, w_rf]``. The Ridge component is
     intentionally dropped — it is a linear model whose tree-SHAP analogue is
     not meaningful; its contribution appears as a small reconciliation gap
     between ``base_value + sum(shap)`` and the hybrid prediction.

Composite SHAP is exact for the tree portion of the stack when the meta-learner
is linear. The reconciliation gap is reported back to the client so the UI can
surface it as "ignored Ridge contribution".

Explainers are built lazily per (bundle-id, cluster-id) and cached in-process.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
import shap
import xgboost as xgb

from backend.hybrid_inference import cluster_label_for_X


# ── XGB shim: avoid shap.TreeExplainer's broken base_score parse ──────────────
class _XGBPredContribsExplainer:
    """Drop-in replacement for ``shap.TreeExplainer`` on XGBoost models.

    Uses ``Booster.predict(..., pred_contribs=True)``; the last column is the bias
    (expected value). Matches ``backend/shap_local.py``.
    """

    def __init__(self, model: Any, feature_names: list[str]) -> None:
        self.model = model
        self.booster = model.get_booster()
        self.feature_names = list(feature_names)
        zero = pd.DataFrame(np.zeros((1, len(feature_names))), columns=feature_names)
        contribs = np.asarray(
            self.booster.predict(
                xgb.DMatrix(zero, feature_names=feature_names), pred_contribs=True
            )
        ).ravel()
        self.expected_value = float(contribs[-1])

    def __call__(self, X: np.ndarray) -> shap.Explanation:
        arr = np.asarray(X, dtype=float)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        df = pd.DataFrame(arr, columns=self.feature_names)
        contribs = np.asarray(
            self.booster.predict(
                xgb.DMatrix(df, feature_names=self.feature_names), pred_contribs=True
            )
        )
        values = contribs[:, :-1]
        base_values = np.full(len(arr), self.expected_value)
        return shap.Explanation(
            values=values,
            base_values=base_values,
            data=arr,
            feature_names=self.feature_names,
        )


# ── Per-(bundle, cluster) explainer cache ─────────────────────────────────────
_EXPLAINER_CACHE: dict[tuple[int, int | str], dict[str, Any]] = {}

# Cache of per-cluster per-feature means over the training feature table.
_TYPICAL_CACHE: dict[int, dict[int, dict[str, float]]] = {}


def _cluster_typical_values(
    bundle: dict[str, Any], feature_cols: list[str]
) -> dict[int, dict[str, float]]:
    """Return ``{cluster_id: {feature_name: mean_value}}`` computed once from the
    training feature table and cached per bundle. Gives the UI an explicit
    "typical flat in this cluster" value to compare each driver against."""
    key = id(bundle)
    cached = _TYPICAL_CACHE.get(key)
    if cached is not None:
        return cached

    from backend.hybrid_inference import default_feature_table_csv

    csv_path = default_feature_table_csv()
    df = pd.read_csv(csv_path)
    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        raise ValueError(
            f"Feature table missing columns (need {len(feature_cols)} total): {missing[:5]}..."
        )
    X_all = df[feature_cols].fillna(0).astype(float).values

    cluster_cols = bundle["cluster_cols"]
    idx = [feature_cols.index(c) for c in cluster_cols]
    Xc_scaled = bundle["cluster_scaler"].transform(X_all[:, idx])
    cluster_ids = np.asarray(bundle["kmeans"].predict(Xc_scaled), dtype=int)

    result: dict[int, dict[str, float]] = {}
    for k in np.unique(cluster_ids):
        mask = cluster_ids == k
        if not mask.any():
            continue
        means = X_all[mask].mean(axis=0)
        result[int(k)] = {
            feat: float(means[i]) for i, feat in enumerate(feature_cols)
        }

    _TYPICAL_CACHE[key] = result
    return result


def _cluster_bundle(bundle: dict[str, Any], cluster_id: int) -> dict[str, Any]:
    cb = bundle["cluster_bundles"].get(cluster_id)
    if cb is None:
        cb = bundle["cluster_bundles"].get(str(cluster_id))
    if cb is None:
        raise KeyError(f"No cluster bundle for id {cluster_id}")
    return cb


def _scalar_expected(explainer: Any) -> float:
    ev = getattr(explainer, "expected_value", 0.0)
    if hasattr(ev, "__iter__"):
        return float(np.asarray(ev, dtype=float).ravel()[0])
    return float(ev)


def _build_explainer_set(
    bundle: dict[str, Any], cluster_id: int, feature_cols: list[str]
) -> dict[str, Any]:
    """Build (or return cached) TreeExplainers for XGB/LGB/RF and the meta weights
    for the given cluster. Falls back to ``global_models`` when the cluster is
    marked fallback."""
    key = (id(bundle), cluster_id)
    cached = _EXPLAINER_CACHE.get(key)
    if cached is not None:
        return cached

    cb = _cluster_bundle(bundle, cluster_id)
    if cb.get("fallback"):
        group = bundle["global_models"]
        source = "global"
    else:
        group = cb
        source = "cluster"

    xgb_exp = _XGBPredContribsExplainer(group["xgb"], feature_cols)
    lgb_exp = shap.TreeExplainer(group["lgb"])
    rf_exp = shap.TreeExplainer(group["rf"])

    meta = group["meta"]
    coefs = np.asarray(meta.coef_, dtype=float).ravel()
    # Expected layout: [w_ridge, w_xgb, w_lgb, w_rf]
    if coefs.size != 4:
        raise ValueError(
            f"Meta-learner has {coefs.size} coefficients, expected 4 [ridge, xgb, lgb, rf]"
        )

    entry = {
        "xgb": xgb_exp,
        "lgb": lgb_exp,
        "rf": rf_exp,
        "w_ridge": float(coefs[0]),
        "w_xgb": float(coefs[1]),
        "w_lgb": float(coefs[2]),
        "w_rf": float(coefs[3]),
        "meta_intercept": float(np.asarray(meta.intercept_, dtype=float).ravel()[0]),
        "source": source,  # "cluster" | "global"
    }
    _EXPLAINER_CACHE[key] = entry
    return entry


# ── Public API ────────────────────────────────────────────────────────────────
@dataclass
class CompositeSHAPResult:
    shap_values: np.ndarray  # (n_features,)
    base_value: float  # w_xgb*E_xgb + w_lgb*E_lgb + w_rf*E_rf + meta_intercept
    cluster_id: int
    explainer_source: str  # "cluster" | "global"
    composite_prediction: float  # base_value + sum(shap_values)
    meta_weights: dict[str, float]  # {"ridge","xgb","lgb","rf"}
    per_model_totals: dict[str, float]  # weighted per-model contribution totals
    typical_values: dict[str, float]  # cluster-mean per feature for UI comparison


def compute_composite_treeshap(
    X: np.ndarray,
    bundle: dict[str, Any],
    feature_cols: list[str],
) -> CompositeSHAPResult:
    X = np.asarray(X, dtype=float).reshape(1, -1)
    if X.shape[1] != len(feature_cols):
        raise ValueError(
            f"Expected {len(feature_cols)} features, got {X.shape[1]}"
        )

    cluster_id = cluster_label_for_X(X, bundle)
    exp = _build_explainer_set(bundle, cluster_id, feature_cols)

    sv_xgb = np.asarray(exp["xgb"](X).values, dtype=float).reshape(-1)
    sv_lgb = np.asarray(exp["lgb"](X).values, dtype=float).reshape(-1)
    sv_rf = np.asarray(exp["rf"](X).values, dtype=float).reshape(-1)

    w_xgb = exp["w_xgb"]
    w_lgb = exp["w_lgb"]
    w_rf = exp["w_rf"]

    composite = w_xgb * sv_xgb + w_lgb * sv_lgb + w_rf * sv_rf

    e_xgb = _scalar_expected(exp["xgb"])
    e_lgb = _scalar_expected(exp["lgb"])
    e_rf = _scalar_expected(exp["rf"])
    base_value = (
        w_xgb * e_xgb + w_lgb * e_lgb + w_rf * e_rf + exp["meta_intercept"]
    )

    composite_pred = float(base_value + composite.sum())

    per_model = {
        "xgb": float(w_xgb * sv_xgb.sum()),
        "lgb": float(w_lgb * sv_lgb.sum()),
        "rf": float(w_rf * sv_rf.sum()),
    }

    # Cluster typicals for UI comparison — falls back to any available cluster
    # (or an empty dict) when the routed cluster has no training rows at all.
    try:
        typicals_by_cluster = _cluster_typical_values(bundle, feature_cols)
        typicals = typicals_by_cluster.get(int(cluster_id))
        if typicals is None and typicals_by_cluster:
            typicals = next(iter(typicals_by_cluster.values()))
    except Exception:
        typicals = {}

    return CompositeSHAPResult(
        shap_values=composite,
        base_value=float(base_value),
        cluster_id=int(cluster_id),
        explainer_source=exp["source"],
        composite_prediction=composite_pred,
        meta_weights={
            "ridge": exp["w_ridge"],
            "xgb": w_xgb,
            "lgb": w_lgb,
            "rf": w_rf,
        },
        per_model_totals=per_model,
        typical_values=typicals or {},
    )
