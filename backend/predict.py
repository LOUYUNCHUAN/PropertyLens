"""
predict.py — /api/predict, /api/explain/shap, /api/explain/lime
Uses PropertyLens hybrid cluster bundle under data/artifacts/.
"""

from fastapi import APIRouter
import numpy as np

from backend.models import (
    PredictRequest,
    PredictResponse,
    LocationContext,
    CbrCheck,
    HybridPredictionDebug,
    SHAPRequest,
    SHAPResponse,
    SHAPFeature,
    LIMERequest,
    LIMEResponse,
    LIMEFeature,
    CohortSHAPRequest,
    CohortSHAPResponse,
    CohortSHAPFeature,
    CompositeSHAPRequest,
    CompositeSHAPResponse,
    CompositeSHAPFeature,
    BuyerViewRequest,
    BuyerViewResponse,
)
router = APIRouter()


from backend.app_state import state  # noqa: E402

def _public_price(raw: float) -> float:
    """Same rounding as POST /api/predict — nearest S$100."""
    return round(float(raw), -2)


def _hybrid_test_metrics() -> tuple[float, float]:
    """Pull live RMSE/R² from hybrid_cluster_meta.json (loaded at startup)."""
    test = state.model_meta["test_metrics"]
    return float(test["rmse"]), float(test["r2"])

_FLAT_TO_ROOMS = {
    "1 ROOM": 1,
    "2 ROOM": 2,
    "3 ROOM": 3,
    "4 ROOM": 4,
    "5 ROOM": 5,
    "EXECUTIVE": 5,
    "MULTI-GENERATION": 4,
    "MULTI GENERATION": 4,
}


def _use_address_feature_builder(req: PredictRequest) -> bool:
    """Same eight fields as notebooks/03_ml_layer_hybrid (block, street, town, type, area, storey range, lease start, sale month)."""
    return bool(
        req.block
        and str(req.block).strip()
        and req.street_name
        and str(req.street_name).strip()
        and req.town
        and str(req.town).strip()
        and req.sale_month
        and str(req.sale_month).strip()
    )


def _legacy_ir_to_hybrid_vector(req: PredictRequest) -> np.ndarray:
    """
    Map legacy API fields into the 77 hybrid columns (no feature-table lookup).
    Many POI / market fields stay 0 — prefer passing block, street_name, town for full vectors.
    """
    feat: dict[str, float] = {c: 0.0 for c in state.feature_cols}
    ft_u = req.flat_type.strip().upper().replace("MULTI GENERATION", "MULTI-GENERATION")

    feat["transaction_year"] = float(req.year)
    feat["level_mid"] = float(req.storey_mid)
    feat["lease_remaining_years"] = float(req.remaining_lease_years)
    feat["floor_area_sqm"] = float(req.floor_area_sqm)
    feat["room_count"] = float(_FLAT_TO_ROOMS.get(ft_u, 3))

    feat["dist_to_mrt_m"] = float(req.dist_nearest_mrt_km * 1000.0)
    feat["dist_to_nearest_school_m"] = float(req.dist_nearest_primary_school_km * 1000.0)
    feat["school_count_1km"] = float(req.primary_schools_within_1km)
    feat["primary_school_count_1km"] = float(req.primary_schools_within_1km)
    feat["primary_school_top_quality_1km"] = float(req.top_school_within_1km)
    feat["dist_to_foodcourt_m"] = float(req.dist_nearest_hawker_km * 1000.0)
    feat["dist_to_nearest_mall_m"] = float(req.dist_nearest_market_km * 1000.0)

    if req.town:
        town_col = f"town_{req.town.strip().upper()}"
        if town_col in feat:
            feat[town_col] = 1.0

    ft_dummy = f"flat_type_{ft_u}"
    for c in state.feature_cols:
        if c.startswith("flat_type_"):
            feat[c] = 1.0 if c == ft_dummy else 0.0

    return np.array([feat.get(c, 0.0) for c in state.feature_cols], dtype=np.float64)


def flat_to_feature_vector_with_debug(req: PredictRequest) -> tuple[np.ndarray, HybridPredictionDebug, dict]:
    """Returns (feature_vector, debug_info, features_dict)."""
    from backend.hybrid_inference import (
        build_yc_hybrid_vector,
        cluster_label_for_X,
        default_feature_table_csv,
    )

    ft_path = str(default_feature_table_csv())
    use_addr = _use_address_feature_builder(req)

    if use_addr:
        storey_range = (req.storey_range or "").strip()
        if not storey_range:
            sm = int(req.storey_mid)
            storey_range = f"{sm:02d} TO {sm:02d}"
        sale_month = (req.sale_month or "").strip() or f"{req.year}-{req.month_num:02d}"
        built = build_yc_hybrid_vector(
            str(req.block).strip(),
            str(req.street_name).strip(),
            str(req.town).strip(),
            req.flat_type,
            float(req.floor_area_sqm),
            storey_range,
            int(req.lease_commence_date),
            sale_month,
        )
        X = built["vector"].ravel()
        note = (built["imputation_note"] or "").strip()
        dbg = HybridPredictionDebug(
            lookup_matched=built["lookup_matched"],
            matched_address_key=built["matched_address_key"],
            imputation_note=note if note else None,
            cluster_id=cluster_label_for_X(built["vector"], state.hybrid_bundle),
            feature_table_csv=ft_path,
        )
        return X, dbg, built["features_dict"]

    X = _legacy_ir_to_hybrid_vector(req)
    feat = {c: float(X[i]) for i, c in enumerate(state.feature_cols)}
    dbg = HybridPredictionDebug(
        lookup_matched=False,
        matched_address_key=None,
        imputation_note="Legacy field mapping (no address lookup in feature table).",
        cluster_id=cluster_label_for_X(X.reshape(1, -1), state.hybrid_bundle),
        feature_table_csv=ft_path,
    )
    return X, dbg, feat


def flat_to_feature_vector(req: PredictRequest) -> np.ndarray:
    v, _, _ = flat_to_feature_vector_with_debug(req)
    return v


def predict_hybrid(X: np.ndarray) -> float:
    return float(state.xgb_model.predict(X.reshape(1, -1))[0])


def _lime_intercept_to_float(intercept) -> float:
    """LIME 0.2.x may expose intercept as float, list, ndarray, or dict (label -> value)."""
    if intercept is None:
        return 0.0
    if isinstance(intercept, dict):
        vals = list(intercept.values())
        return float(vals[0]) if vals else 0.0
    if isinstance(intercept, (list, tuple, np.ndarray)):
        return float(np.asarray(intercept, dtype=float).ravel()[0])
    return float(intercept)


def _build_location_context(feat: dict, req: PredictRequest) -> LocationContext:
    town_u = (req.town or "").strip().upper()
    town_col = f"town_{town_u}"
    is_mature = bool(feat.get(town_col, 0)) and town_u in {
        "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT MERAH", "BUKIT TIMAH",
        "CENTRAL AREA", "CLEMENTI", "GEYLANG", "KALLANG/WHAMPOA",
        "MARINE PARADE", "PASIR RIS", "QUEENSTOWN", "SERANGOON",
        "TAMPINES", "TOA PAYOH",
    }
    return LocationContext(
        dist_to_mrt_m=round(feat.get("dist_to_mrt_m", 0), 1),
        dist_to_school_m=round(feat.get("dist_to_nearest_school_m", 0), 1),
        dist_to_hawker_m=round(feat.get("dist_to_foodcourt_m", 0), 1),
        dist_to_mall_m=round(feat.get("dist_to_nearest_mall_m", 0), 1),
        school_count_1km=int(feat.get("school_count_1km", 0)),
        top_school_within_1km=bool(feat.get("primary_school_top_quality_1km", 0)),
        mall_count_3km=int(feat.get("mall_count_3km", 0)),
        is_mature_estate=is_mature,
    )


@router.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    from backend.cbr import compute_cbr_median

    X_flat, pred_debug, feat_dict = flat_to_feature_vector_with_debug(req)
    X = X_flat.reshape(1, -1)
    raw = predict_hybrid(X)
    predicted_price = _public_price(raw)

    hybrid_rmse, hybrid_r2 = _hybrid_test_metrics()
    confidence_low = max(0, predicted_price - 1.5 * hybrid_rmse)
    confidence_high = predicted_price + 1.5 * hybrid_rmse

    cbr_check = None
    try:
        from backend.cbr import run_cbr_similar
        from backend.models import CBRRequest

        cbr_req = CBRRequest(flat=req, k=5)
        cbr_resp = run_cbr_similar(cbr_req)
        comparables_raw = [{"resale_price": c.resale_price} for c in cbr_resp.comparables]
        cbr_median = compute_cbr_median(comparables_raw)
        sample_size = len(cbr_resp.comparables)

        if cbr_median and predicted_price > 0:
            divergence_pct = round(((cbr_median - predicted_price) / predicted_price) * 100, 1)
            direction = "cbr_higher" if cbr_median > predicted_price else "cbr_lower"
            flag = abs(divergence_pct) > 30
            if flag and direction == "cbr_higher":
                flag_reason = (
                    "Recent comparable sales are significantly higher than the model "
                    "estimate. The model may be underestimating current market prices "
                    "for this area."
                )
            elif flag and direction == "cbr_lower":
                flag_reason = (
                    "Recent comparable sales are significantly lower than the model "
                    "estimate. Check if this flat has unusual features."
                )
            else:
                flag_reason = None
        else:
            divergence_pct = None
            direction = None
            flag = False
            flag_reason = None

        cbr_check = CbrCheck(
            cbr_median=cbr_median,
            cbr_sample_size=sample_size,
            divergence_pct=divergence_pct,
            direction=direction,
            flag=flag,
            flag_reason=flag_reason,
        )
    except Exception:
        pass

    loc_ctx = _build_location_context(feat_dict, req)

    return PredictResponse(
        predicted_price=predicted_price,
        confidence_low=confidence_low,
        confidence_high=confidence_high,
        price_per_sqm=round(predicted_price / req.floor_area_sqm),
        model_used="hybrid_cluster",
        rmse=hybrid_rmse,
        r2=hybrid_r2,
        calibration_applied=True,
        ensemble_detail=None,
        cbr_check=cbr_check,
        debug=pred_debug,
        location_context=loc_ctx,
    )


def run_explain_shap(req: SHAPRequest) -> SHAPResponse:
    from fastapi import HTTPException

    from backend.shap_local import compute_cluster_xgb_shap

    X = flat_to_feature_vector(req.flat).reshape(1, -1)
    predicted = predict_hybrid(X)
    pred_public = _public_price(predicted)

    try:
        shap_arr, base_val, _cid, xgb_pred = compute_cluster_xgb_shap(
            X, state.hybrid_bundle, state.feature_cols
        )
    except Exception as e:
        if state.global_shap:
            cols = state.feature_cols
            sorted_feats = sorted(state.global_shap.items(), key=lambda kv: abs(kv[1]), reverse=True)
            features = []
            for k, v in sorted_feats[:15]:
                try:
                    idx = cols.index(k)
                    fv = round(float(X[0, idx]), 4)
                except ValueError:
                    fv = 0.0
                features.append(SHAPFeature(feature=k, shap_value=round(float(v), 2), feature_value=fv))
            return SHAPResponse(
                shap_values=features,
                base_value=0.0,
                predicted_price=pred_public,
                explanation_type="global",
                fallback_reason=f"{type(e).__name__}: {e}",
                shap_model_prediction=None,
            )
        raise HTTPException(status_code=503, detail=f"Local SHAP failed and no global cache: {e}") from e

    features = [
        SHAPFeature(
            feature=state.feature_cols[i],
            shap_value=round(float(shap_arr[i]), 2),
            feature_value=round(float(X[0, i]), 4),
        )
        for i in range(len(state.feature_cols))
    ]
    features.sort(key=lambda x: abs(x.shap_value), reverse=True)

    return SHAPResponse(
        shap_values=features,
        base_value=round(base_val, 2),
        predicted_price=pred_public,
        explanation_type="local",
        fallback_reason=None,
        shap_model_prediction=round(float(xgb_pred), 2),
    )


@router.post("/explain/shap", response_model=SHAPResponse)
def explain_shap(req: SHAPRequest):
    return run_explain_shap(req)


@router.post("/explain/cohort-shap", response_model=CohortSHAPResponse)
def explain_cohort_shap(req: CohortSHAPRequest):
    """
    Cohort-relative SHAP for the cluster-routed XGBoost component.

    Reframes the baseline from the global training mean to the mean SHAP over
    the k nearest CBR neighbours (default k=30). Efficiency identity holds for
    cluster XGB: ``cohort_baseline + Σ phi_cohort ≈ shap_model_prediction``.
    """
    from fastapi import HTTPException

    from backend.cohort_shap import compute_cohort_shap

    X = flat_to_feature_vector(req.flat).reshape(1, -1)

    try:
        result = compute_cohort_shap(
            X, state.hybrid_bundle, state.feature_cols, req.flat, k=req.k
        )
    except Exception as e:
        raise HTTPException(
            status_code=503, detail=f"Cohort SHAP failed: {type(e).__name__}: {e}"
        ) from e

    features = [
        CohortSHAPFeature(
            feature=state.feature_cols[i],
            phi_cohort=round(float(result.phi_cohort[i]), 2),
            phi_global=round(float(result.phi_global[i]), 2),
            feature_value=round(float(result.feature_values[i]), 4),
        )
        for i in range(len(state.feature_cols))
    ]
    features.sort(key=lambda f: abs(f.phi_cohort), reverse=True)

    return CohortSHAPResponse(
        shap_values=features,
        cohort_baseline=round(result.cohort_baseline, 2),
        base_value_global=round(result.base_value_global, 2),
        cohort_size=result.cohort_size,
        cohort_median_price=round(result.cohort_median_price, 2),
        cohort_town_mix=result.cohort_town_mix,
        cluster_id=result.cluster_id,
        explained_model="cluster_xgb",
        shap_model_prediction=round(result.xgb_pred, 2),
    )


@router.post("/explain/buyer-view", response_model=BuyerViewResponse)
def explain_buyer_view(req: BuyerViewRequest):
    """
    Buyer-facing presentation transform over cohort-relative SHAP.

    Groups one-hot families, drops noise-level contributions, ranks top
    strengths / trade-offs, and attaches cohort percentile context. ``estimate``
    uses the hybrid ensemble (same as /predict); ``explained_model`` is still
    ``cluster_xgb`` because the SHAP values come from the XGB booster — same
    caveat as /api/explain/shap.
    """
    from fastapi import HTTPException

    from backend.cohort_shap import compute_cohort_shap
    from backend.buyer_view import build_buyer_view

    X = flat_to_feature_vector(req.flat).reshape(1, -1)
    estimate = _public_price(predict_hybrid(X))

    try:
        cohort_result = compute_cohort_shap(
            X, state.hybrid_bundle, state.feature_cols, req.flat, k=req.k
        )
    except Exception as e:
        raise HTTPException(
            status_code=503, detail=f"Cohort SHAP failed: {type(e).__name__}: {e}"
        ) from e

    payload = build_buyer_view(
        req.flat, X, cohort_result, estimate, state.feature_cols
    )
    return BuyerViewResponse(**payload)


@router.post("/explain/composite-shap", response_model=CompositeSHAPResponse)
def explain_composite_shap(req: CompositeSHAPRequest):
    """
    Composite TreeSHAP for the full hybrid cluster ensemble.

    Runs TreeSHAP on each tree base-learner (XGB/LGB/RF) and linearly combines
    the per-feature attributions using the cluster's meta-learner coefficients.
    The Ridge base-learner is excluded — its residual shows up as
    ``approximation_error`` on the response and is typically small.
    """
    from fastapi import HTTPException

    from backend.composite_treeshap import compute_composite_treeshap

    X = flat_to_feature_vector(req.flat).reshape(1, -1)
    hybrid_raw = predict_hybrid(X)
    hybrid_pred = _public_price(hybrid_raw)

    try:
        result = compute_composite_treeshap(X, state.hybrid_bundle, state.feature_cols)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Composite TreeSHAP failed: {type(e).__name__}: {e}",
        ) from e

    features = [
        CompositeSHAPFeature(
            feature=state.feature_cols[i],
            shap_value=round(float(result.shap_values[i]), 2),
            feature_value=round(float(X[0, i]), 4),
        )
        for i in range(len(state.feature_cols))
    ]
    features.sort(key=lambda f: abs(f.shap_value), reverse=True)

    approx_err = round(float(hybrid_pred) - float(result.composite_prediction), 2)

    return CompositeSHAPResponse(
        shap_values=features,
        base_value=round(result.base_value, 2),
        predicted_price=hybrid_pred,
        composite_prediction=round(result.composite_prediction, 2),
        approximation_error=approx_err,
        cluster_id=result.cluster_id,
        explainer_source=result.explainer_source,
        meta_weights={k: round(float(v), 6) for k, v in result.meta_weights.items()},
        per_model_totals={
            k: round(float(v), 2) for k, v in result.per_model_totals.items()
        },
        typical_values={
            k: round(float(v), 4) for k, v in (result.typical_values or {}).items()
        },
    )


@router.post("/explain/lime", response_model=LIMEResponse)
def explain_lime(req: LIMERequest):
    X = flat_to_feature_vector(req.flat)
    predicted = predict_hybrid(X.reshape(1, -1))
    pred_public = _public_price(predicted)

    exp = state.lime_explainer.explain_instance(
        X,
        state.xgb_model.predict,
        num_features=15,
        num_samples=300,
    )

    features = [
        LIMEFeature(
            condition=cond,
            coefficient=round(float(coef), 2),
            direction="positive" if coef > 0 else "negative",
        )
        for cond, coef in sorted(exp.as_list(), key=lambda x: abs(x[1]), reverse=True)
    ]

    intercept = _lime_intercept_to_float(exp.intercept)

    return LIMEResponse(
        lime_explanation=features,
        predicted_price=pred_public,
        intercept=round(intercept, 2),
    )
