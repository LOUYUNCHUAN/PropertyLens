from typing import Optional, List, Dict

from pydantic import BaseModel, ConfigDict, Field


class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Predict ───────────────────────────────────────────────────────
class PredictRequest(BaseSchema):
    # Core flat features — all required
    floor_area_sqm: float = Field(..., gt=0, le=400, description="Floor area in sqm")
    storey_mid: float = Field(..., ge=1, le=50)
    remaining_lease_years: float = Field(..., ge=1, le=99)
    lease_commence_date: int = Field(..., ge=1960, le=2035)

    # Location features
    dist_nearest_mrt_km: float = Field(..., ge=0, le=10)
    dist_to_cbd_km: float = Field(..., ge=0, le=40)
    dist_nearest_primary_school_km: float = Field(default=0.5)
    dist_nearest_top_school_km: float = Field(default=1.5)
    dist_nearest_hawker_km: float = Field(default=0.3)
    dist_nearest_market_km: float = Field(default=0.5)

    # Count features
    mrt_count_within_1km: int = Field(default=1, ge=0)
    primary_schools_within_1km: int = Field(default=2, ge=0)
    primary_schools_within_2km: int = Field(default=5, ge=0)
    top_school_within_1km: int = Field(default=0, ge=0, le=1)
    top_school_within_2km: int = Field(default=0, ge=0, le=1)
    hawkers_within_500m: int = Field(default=1, ge=0)

    # Flat characteristics
    town: Optional[str] = None
    flat_type: str = Field(default="4 ROOM")
    is_mature_estate: int = Field(default=0, ge=0, le=1)
    age_at_sale: Optional[float] = None

    # Optional — when block + street + town are set, backend uses feature-table lookup (preferred)
    block: Optional[str] = None
    street_name: Optional[str] = None
    storey_range: Optional[str] = None  # e.g. "07 TO 09"; else derived from storey_mid
    sale_month: Optional[str] = None  # "YYYY-MM"; else derived from year + month_num

    # Temporal — auto-derived if not provided
    year: int = Field(default=2024, ge=1990, le=2026)
    month_num: int = Field(default=6, ge=1, le=12)


class CbrCheck(BaseSchema):
    cbr_median: Optional[float]
    cbr_sample_size: int
    divergence_pct: Optional[float]
    direction: Optional[str]
    flag: bool
    flag_reason: Optional[str]


class HybridPredictionDebug(BaseSchema):
    """Notebook-style diagnostics for hybrid address lookup and cluster routing."""

    lookup_matched: Optional[bool] = None
    matched_address_key: Optional[str] = None
    imputation_note: Optional[str] = None
    cluster_id: Optional[int] = None
    feature_table_csv: Optional[str] = None


class LocationContext(BaseSchema):
    """Real POI distances from the feature table lookup — drives the map."""

    dist_to_mrt_m: float = 0
    dist_to_school_m: float = 0
    dist_to_hawker_m: float = 0
    dist_to_mall_m: float = 0
    school_count_1km: int = 0
    top_school_within_1km: bool = False
    mall_count_3km: int = 0
    is_mature_estate: bool = False


class PredictResponse(BaseSchema):
    predicted_price: float
    confidence_low: float
    confidence_high: float
    price_per_sqm: float
    model_used: str = "hybrid_cluster_ensemble"
    rmse: float = 37791.0
    r2: float = 0.9658
    calibration_applied: bool = False
    ensemble_detail: Optional[Dict] = None
    cbr_check: Optional[CbrCheck] = None
    debug: Optional[HybridPredictionDebug] = None
    location_context: Optional[LocationContext] = None


# ── SHAP ──────────────────────────────────────────────────────────
class SHAPRequest(BaseSchema):
    flat: PredictRequest


class SHAPFeature(BaseSchema):
    feature: str
    shap_value: float
    feature_value: float


class SHAPResponse(BaseSchema):
    shap_values: List[SHAPFeature]
    base_value: float
    predicted_price: float = Field(
        ...,
        description="Hybrid ensemble price; SHAP values explain the cluster XGB component only.",
    )
    explanation_type: str = Field(default="local", description='"local" or "global" fallback cache')
    fallback_reason: Optional[str] = None
    shap_model_prediction: Optional[float] = Field(
        default=None,
        description="Cluster XGB prediction; base_value + sum(SHAP) ≈ this.",
    )


# ── LIME ──────────────────────────────────────────────────────────
class LIMERequest(BaseSchema):
    flat: PredictRequest


class LIMEFeature(BaseSchema):
    condition: str
    coefficient: float
    direction: str  # "positive" | "negative"


class LIMEResponse(BaseSchema):
    lime_explanation: List[LIMEFeature]
    predicted_price: float
    intercept: float


# ── CBR ───────────────────────────────────────────────────────────
class CBRRequest(BaseSchema):
    flat: PredictRequest
    k: int = Field(default=5, ge=1, le=20)


class CBRCase(BaseSchema):
    block: str
    street_name: str
    town: str
    flat_type: str
    floor_area_sqm: float
    storey_mid: float
    remaining_lease_years: float
    resale_price: float
    year: int
    month: Optional[int] = None
    similarity_pct: float
    # Normalised within the returned k neighbours (better bar UX than raw 1/(1+d) scale).
    similarity_display_pct: Optional[float] = None


class CBRResponse(BaseSchema):
    comparables: List[CBRCase]
    query_features: Dict[str, float]


# ── Counterfactual ────────────────────────────────────────────────
class CounterfactualRequest(BaseSchema):
    flat: PredictRequest
    asking_price: float = Field(..., gt=0)
    target_price: Optional[float] = None  # if None, use asking_price


class CounterfactualResponse(BaseSchema):
    current_prediction: float
    asking_price: float
    fair_value_gap: float        # asking - predicted
    fair_value_gap_pct: float    # gap as % of predicted
    negotiation_walk_away: float  # predicted - 5%
    negotiation_open_offer: float # predicted - 2%
    negotiation_fair: float       # predicted
    shap_top3: List[SHAPFeature]  # top 3 most impactful features


# ── Analytics ─────────────────────────────────────────────────────
class TrendPoint(BaseSchema):
    year: int
    median_price: float
    transaction_count: int


class TrendsResponse(BaseSchema):
    trends: List[TrendPoint]
    town_filter: Optional[str] = None


class RulesResponse(BaseSchema):
    apriori: List[Dict]
    surrogate: List[Dict]
    metadata: Dict


# ── Chat / RAG ────────────────────────────────────────────────────
class ChatRequest(BaseSchema):
    message: str
    history: List[Dict] = []  # [{role: "user"|"assistant", content: "..."}]


class ChatResponse(BaseSchema):
    answer: str
    sources: List[str] = []
    cypher_used: Optional[str] = None
    price_estimate: Optional[float] = None

