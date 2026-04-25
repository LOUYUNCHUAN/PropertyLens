"""
counterfactual.py — /api/counterfactual
Seller What-If optimiser: compare asking price vs model estimate.
Returns fair value gap + negotiation range + top SHAP factors.
"""

from fastapi import APIRouter
import numpy as np

from backend.models import CounterfactualRequest, CounterfactualResponse, SHAPFeature
from backend.app_state import state

router = APIRouter()


def _top3_shap_from_global(X: np.ndarray) -> list[SHAPFeature]:
    if not state.global_shap:
        return []
    cols = state.feature_cols
    sorted_feats = sorted(
        state.global_shap.items(), key=lambda kv: abs(kv[1]), reverse=True
    )
    out = []
    for k, v in sorted_feats[:3]:
        try:
            idx = cols.index(k)
            fv = round(float(X[0, idx]), 4)
        except ValueError:
            fv = 0.0
        out.append(
            SHAPFeature(feature=k, shap_value=round(float(v), 2), feature_value=fv)
        )
    return out


@router.post("/counterfactual", response_model=CounterfactualResponse)
def counterfactual(req: CounterfactualRequest):
    from backend.predict import flat_to_feature_vector, predict_hybrid
    from backend.shap_local import compute_cluster_xgb_shap

    X = flat_to_feature_vector(req.flat).reshape(1, -1)
    raw = predict_hybrid(X)
    predicted = round(float(raw), -2)

    gap = req.asking_price - predicted
    gap_pct = (gap / predicted) * 100 if predicted > 0 else 0.0

    top3: list[SHAPFeature] = []
    try:
        shap_arr, _base, _cid, _xgb = compute_cluster_xgb_shap(
            X, state.hybrid_bundle, state.feature_cols
        )
        top3_idx = np.argsort(np.abs(shap_arr))[::-1][:3]
        top3 = [
            SHAPFeature(
                feature=state.feature_cols[i],
                shap_value=round(float(shap_arr[i]), 2),
                feature_value=round(float(X[0, i]), 4),
            )
            for i in top3_idx
        ]
    except Exception:
        top3 = _top3_shap_from_global(X)

    return CounterfactualResponse(
        current_prediction=round(predicted, 0),
        asking_price=round(req.asking_price, 0),
        fair_value_gap=round(gap, 0),
        fair_value_gap_pct=round(gap_pct, 2),
        negotiation_walk_away=round(predicted * 0.95, 0),
        negotiation_open_offer=round(predicted * 0.98, 0),
        negotiation_fair=round(predicted, 0),
        shap_top3=top3,
    )

