"""
Constraint Satisfaction for HDB ResaleXAI.

Apriori: discrete bins vs rules.json association rules.
Surrogate: optional path using the same hybrid feature row as /api/predict.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator

from backend.models import PredictRequest

logger = logging.getLogger(__name__)


def _processed_dir() -> Path:
    env = os.environ.get("PROPERTYLENS_ARTIFACTS_DIR", "").strip()
    root = Path(env) if env else Path(__file__).resolve().parent.parent / "data" / "artifacts"
    return root / "hybrid_xai"


# ── Rule mining (used by scripts/regenerate_rules.py) ────────────────────────

def discretise(df):
    """Convert continuous HDB columns into boolean item columns for apriori."""
    import pandas as pd

    d = pd.DataFrame(index=df.index)

    d["area=small(<70sqm)"] = df["floor_area_sqm"] < 70
    d["area=medium(70-100sqm)"] = (df["floor_area_sqm"] >= 70) & (df["floor_area_sqm"] < 100)
    d["area=large(>100sqm)"] = df["floor_area_sqm"] >= 100

    d["storey=low(1-5)"] = df["storey_mid"] <= 5
    d["storey=mid(6-12)"] = (df["storey_mid"] > 5) & (df["storey_mid"] <= 12)
    d["storey=high(>12)"] = df["storey_mid"] > 12

    d["mrt=walking(<0.5km)"] = df["dist_nearest_mrt_km"] < 0.5
    d["mrt=near(0.5-1km)"] = (df["dist_nearest_mrt_km"] >= 0.5) & (df["dist_nearest_mrt_km"] < 1.0)
    d["mrt=far(>1km)"] = df["dist_nearest_mrt_km"] >= 1.0

    d["lease=short(<50yr)"] = df["remaining_lease_years"] < 50
    d["lease=medium(50-70yr)"] = (df["remaining_lease_years"] >= 50) & (df["remaining_lease_years"] <= 70)
    d["lease=long(>70yr)"] = df["remaining_lease_years"] > 70

    d["mature_estate=yes"] = df["is_mature_estate"] == 1
    d["mature_estate=no"] = df["is_mature_estate"] == 0

    d["price=budget(<350k)"] = df["resale_price"] < 350_000
    d["price=mid(350-550k)"] = (df["resale_price"] >= 350_000) & (df["resale_price"] < 550_000)
    d["price=premium(>550k)"] = df["resale_price"] >= 550_000

    return d.astype(int)


def build_rules(parquet_path: str, min_support: float = 0.02, min_confidence: float = 0.60) -> dict:
    """
    Mine apriori association rules from post-2015 HDB transactions.
    Returns a dict in the same shape as rules.json so it can be merged and saved.
    """
    import pandas as pd
    from mlxtend.frequent_patterns import apriori, association_rules

    needed = [
        "year",
        "floor_area_sqm",
        "storey_mid",
        "dist_nearest_mrt_km",
        "remaining_lease_years",
        "is_mature_estate",
        "resale_price",
    ]
    df = pd.read_parquet(parquet_path, columns=needed)

    df_recent = df[df["year"] >= 2015].copy()

    df_disc = discretise(df_recent)

    frequent = apriori(df_disc, min_support=min_support, use_colnames=True, low_memory=True)
    rules_df = association_rules(
        frequent, metric="confidence", min_threshold=min_confidence, num_itemsets=len(frequent)
    )

    price_bins = {"price=budget(<350k)", "price=mid(350-550k)", "price=premium(>550k)"}
    rules_df = rules_df[
        rules_df["consequents"].apply(lambda x: len(x) == 1 and list(x)[0] in price_bins)
    ]

    rules_df = rules_df.sort_values("confidence", ascending=False).head(60)

    apriori_rules = []
    for _, row in rules_df.iterrows():
        apriori_rules.append(
            {
                "source": "apriori",
                "if_conditions": sorted(row["antecedents"]),
                "then": sorted(row["consequents"]),
                "support": round(float(row["support"]), 4),
                "confidence": round(float(row["confidence"]), 4),
                "lift": round(float(row["lift"]), 4),
            }
        )

    return {
        "apriori": apriori_rules,
        "metadata": {
            "apriori_count": len(apriori_rules),
            "min_support": min_support,
            "min_confidence": min_confidence,
            "source_years": "2015+",
        },
    }


# ── Load rules once at import time ────────────────────────────────────────────
_rules_path = _processed_dir() / "rules.json"
with open(_rules_path) as f:
    _all_rules = json.load(f)

_meta = _all_rules.get("metadata", {}) or {}

# Data-driven price tertiles — written by scripts/regenerate_rules.py. Falls
# back to the legacy 350/550 thresholds if this is a pre-regeneration rules
# file.
_price_thresh = _meta.get("price_thresholds") or {}
_PRICE_BUDGET_UPPER = int(_price_thresh.get("budget_upper", 350_000))
_PRICE_PREMIUM_LOWER = int(_price_thresh.get("premium_lower", 550_000))
_PRICE_BUDGET_TOKEN = f"price=budget(<{_PRICE_BUDGET_UPPER // 1000}k)"
_PRICE_MID_TOKEN = f"price=mid({_PRICE_BUDGET_UPPER // 1000}-{_PRICE_PREMIUM_LOWER // 1000}k)"
_PRICE_PREMIUM_TOKEN = f"price=premium(>={_PRICE_PREMIUM_LOWER // 1000}k)"

APRIORI_RULES = [r for r in _all_rules.get("apriori", []) if r.get("confidence", 0) >= 0.60]

# Freshness guard on surrogate: skip leaves that split on a stale
# ``transaction_year <= N`` threshold. If N is older than today minus
# ``_STALE_YEAR_WINDOW`` the leaf's reference price can't be compared to a
# fresh listing without the comparison being dominated by market drift rather
# than the flat's own attributes.
_STALE_YEAR_WINDOW = int(os.environ.get("PROPERTYLENS_SURROGATE_STALE_WINDOW_YEARS", "3"))
_MIN_SURROGATE_YEAR = datetime.utcnow().year - _STALE_YEAR_WINDOW


def _is_surrogate_fresh(rule: dict) -> bool:
    """False if the leaf's conditions constrain ``transaction_year`` to a
    window that ends before the freshness horizon."""
    for cond in rule.get("conditions") or []:
        m = re.match(
            r"^\s*transaction_year\s*(<=|<)\s*([-+]?\d*\.?\d+)\s*$", str(cond)
        )
        if m:
            ceiling = float(m.group(2))
            if ceiling < _MIN_SURROGATE_YEAR - 0.5:
                return False
    return True


SURROGATE_RULES = [
    r
    for r in _all_rules.get("surrogate", [])
    if r.get("confidence", 0) >= 0.50 and _is_surrogate_fresh(r)
]

# ── Domain binning (tokens are derived from rules.json metadata so the binner
# can never drift from what the miner produced) ───────────────────────────────


def bin_price(price: float) -> str:
    if price < _PRICE_BUDGET_UPPER:
        return _PRICE_BUDGET_TOKEN
    if price < _PRICE_PREMIUM_LOWER:
        return _PRICE_MID_TOKEN
    return _PRICE_PREMIUM_TOKEN


def bin_mrt(dist_km: float) -> str:
    """Tokens MUST match scripts/regenerate_rules.py::discretise()."""
    if dist_km < 0.5:
        return "mrt=walking(<0.5km)"
    if dist_km < 0.8:
        return "mrt=near(0.5-0.8km)"
    return "mrt=far(>0.8km)"


def bin_lease(years: float) -> str:
    if years < 55:
        return "lease=short(<55yr)"
    if years < 80:
        return "lease=medium(55-80yr)"
    return "lease=long(>=80yr)"


def bin_area(sqm: float) -> str:
    if sqm < 70:
        return "area=small(<70sqm)"
    if sqm < 100:
        return "area=medium(70-100sqm)"
    return "area=large(>=100sqm)"


def bin_storey(storey: float) -> str:
    if storey <= 5:
        return "storey=low(1-5)"
    if storey <= 12:
        return "storey=mid(6-12)"
    return "storey=high(>12)"


def bin_mature(is_mature: bool) -> str:
    return "mature_estate=yes" if is_mature else "mature_estate=no"


def bin_rooms(flat_type: str) -> str:
    """Map flat_type → rooms token used by the miner (rooms=2-3 / 4 / 5+)."""
    ft = (flat_type or "4 ROOM").strip().upper().replace("MULTI GENERATION", "MULTI-GENERATION")
    if ft in ("1 ROOM", "2 ROOM", "3 ROOM"):
        return "rooms=2-3"
    if ft == "4 ROOM":
        return "rooms=4"
    return "rooms=5+"


# ── Pydantic models ───────────────────────────────────────────────────────────


class ValidateRequest(BaseModel):
    asking_price: float
    flat_type: str = "4 ROOM"
    flat: Optional[PredictRequest] = None
    floor_area_sqm: Optional[float] = None
    storey_mid: Optional[float] = None
    remaining_lease_years: Optional[float] = None
    dist_nearest_mrt_km: Optional[float] = None
    is_mature_estate: Optional[bool] = None
    # When provided, validate_listing also runs the model_band check that flags
    # asking prices falling outside the AI estimate's 95% confidence interval.
    predicted_price: Optional[float] = None
    confidence_low: Optional[float] = None
    confidence_high: Optional[float] = None

    @model_validator(mode="after")
    def _require_scalars_without_flat(self) -> ValidateRequest:
        if self.flat is not None:
            return self
        for name in (
            "floor_area_sqm",
            "storey_mid",
            "remaining_lease_years",
            "dist_nearest_mrt_km",
            "is_mature_estate",
        ):
            if getattr(self, name) is None:
                raise ValueError(f"When 'flat' is omitted, '{name}' is required")
        return self


class ConstraintViolation(BaseModel):
    severity: str
    message: str
    rule_confidence: float
    expected: str
    actual: str
    suggestion: str
    source: str = "apriori"


class CspSubsystemResult(BaseModel):
    violations: list[ConstraintViolation] = Field(default_factory=list)
    satisfied: list[str] = Field(default_factory=list)
    csp_status: str = "CONSISTENT"
    violation_count: int = 0


class ValidateResponse(BaseModel):
    violations: list[ConstraintViolation]
    satisfied: list[str]
    csp_status: str
    violation_count: int
    apriori: Optional[CspSubsystemResult] = None
    surrogate: Optional[CspSubsystemResult] = None
    model_band: Optional[CspSubsystemResult] = None


# Pull tokens → human labels from the rules file when present. The miner
# writes this map whenever it regenerates rules.json, so the backend never
# has to know the current buckets ahead of time. Falls back to a small legacy
# hardcoded set for older rules.json payloads that don't have ``label_map``.
_LEGACY_LABELS = {
    "mrt=walking(<0.5km)": "walking distance to MRT",
    "mrt=near(0.5-1km)": "near an MRT (0.5–0.8 km)",
    "mrt=far(>800m)": "far from MRT (>800 m)",
    "mrt=far(>1km)": "far from MRT (>1 km)",
    "lease=long(>70yr)": "long remaining lease (>70 yrs)",
    "lease=medium(55-70yr)": "medium lease (55–70 yrs)",
    "lease=medium(50-70yr)": "medium lease (50–70 yrs)",
    "lease=short(<50yr)": "short lease (<50 yrs)",
    "area=small(<70sqm)": "small flat (<70 sqm)",
    "area=medium(70-100sqm)": "medium flat (70–100 sqm)",
    "area=large(>100sqm)": "large flat (>100 sqm)",
    "storey=low(1-5)": "low floor (1–5)",
    "storey=mid(6-12)": "mid floor (6–12)",
    "storey=high(>12)": "high floor (>12)",
    "mature_estate=yes": "mature estate",
    "mature_estate=no": "non-mature estate",
    "rooms=3": "3-room profile",
    "rooms=4": "4+ room profile",
}
CONDITION_LABELS: dict[str, str] = {
    **_LEGACY_LABELS,
    **(_meta.get("label_map") or {}),
    # Ensure price tokens always have labels matching the current thresholds:
    _PRICE_BUDGET_TOKEN: f"budget range (<${_PRICE_BUDGET_UPPER // 1000}k)",
    _PRICE_MID_TOKEN: f"mid range (${_PRICE_BUDGET_UPPER // 1000}k–${_PRICE_PREMIUM_LOWER // 1000}k)",
    _PRICE_PREMIUM_TOKEN: f"premium range (≥${_PRICE_PREMIUM_LOWER // 1000}k)",
}

PRICE_SUGGESTIONS = {
    _PRICE_BUDGET_TOKEN: f"Consider pricing below ${_PRICE_BUDGET_UPPER // 1000}k to align with current market patterns.",
    _PRICE_MID_TOKEN: f"Market patterns suggest ${_PRICE_BUDGET_UPPER // 1000}k–${_PRICE_PREMIUM_LOWER // 1000}k for this flat profile.",
    _PRICE_PREMIUM_TOKEN: f"This flat profile supports premium pricing above ${_PRICE_PREMIUM_LOWER // 1000}k.",
}

_SURR_COND_RE = re.compile(
    r"^([a-zA-Z_][a-zA-Z0-9_]*)\s*(<=|>=|<|>)\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*$"
)

SURROGATE_PRICE_TOLERANCE = 0.20
MAX_SURROGATE_VIOLATIONS = 3


def _resolved_listing(req: ValidateRequest) -> dict[str, Any]:
    if req.flat is not None:
        f = req.flat
        return {
            "asking_price": req.asking_price,
            "floor_area_sqm": f.floor_area_sqm,
            "storey_mid": f.storey_mid,
            "remaining_lease_years": f.remaining_lease_years,
            "dist_nearest_mrt_km": f.dist_nearest_mrt_km,
            "is_mature_estate": bool(f.is_mature_estate),
            "flat_type": (f.flat_type or req.flat_type or "4 ROOM").strip(),
        }
    return {
        "asking_price": req.asking_price,
        "floor_area_sqm": req.floor_area_sqm,
        "storey_mid": req.storey_mid,
        "remaining_lease_years": req.remaining_lease_years,
        "dist_nearest_mrt_km": req.dist_nearest_mrt_km,
        "is_mature_estate": bool(req.is_mature_estate),
        "flat_type": (req.flat_type or "4 ROOM").strip(),
    }


def _eval_surrogate_condition(cond: str, features: dict[str, float]) -> bool:
    m = _SURR_COND_RE.match(cond.strip())
    if not m:
        return False
    name, op, val_s = m.group(1), m.group(2), m.group(3)
    if name not in features:
        return False
    try:
        left = float(features[name])
        right = float(val_s)
    except (TypeError, ValueError):
        return False
    if op == "<=":
        return left <= right
    if op == ">=":
        return left >= right
    if op == "<":
        return left < right
    if op == ">":
        return left > right
    return False


def _run_apriori(li: dict[str, Any]) -> CspSubsystemResult:
    assignment = {
        bin_price(li["asking_price"]),
        bin_mrt(li["dist_nearest_mrt_km"]),
        bin_lease(li["remaining_lease_years"]),
        bin_area(li["floor_area_sqm"]),
        bin_storey(li["storey_mid"]),
        bin_mature(li["is_mature_estate"]),
        bin_rooms(li["flat_type"]),
    }

    violations: list[ConstraintViolation] = []
    satisfied: list[str] = []

    for rule in APRIORI_RULES:
        if_conditions = set(rule.get("if_conditions", []))
        then_outcomes = set(rule.get("then", []))

        if not if_conditions.issubset(assignment):
            continue

        price_outcomes = {o for o in then_outcomes if o.startswith("price=")}
        if not price_outcomes:
            continue

        violated_any = False
        for outcome in price_outcomes:
            if outcome not in assignment:
                violated_any = True
                if_labels = [CONDITION_LABELS.get(c, c) for c in if_conditions]
                actual_price_bin = bin_price(li["asking_price"])
                severity = "warning" if rule["confidence"] >= 0.80 else "info"
                violations.append(
                    ConstraintViolation(
                        severity=severity,
                        message=(
                            f"Flats with {', '.join(if_labels)} are typically priced "
                            f"in the {CONDITION_LABELS.get(outcome, outcome)} range."
                        ),
                        rule_confidence=rule["confidence"],
                        expected=CONDITION_LABELS.get(outcome, outcome),
                        actual=CONDITION_LABELS.get(actual_price_bin, actual_price_bin),
                        suggestion=PRICE_SUGGESTIONS.get(outcome, "Review your asking price."),
                        source="apriori",
                    )
                )

        if not violated_any:
            if_labels = [CONDITION_LABELS.get(c, c) for c in if_conditions]
            then_labels = [CONDITION_LABELS.get(o, o) for o in then_outcomes]
            satisfied.append(f"Flats with {', '.join(if_labels)} → {', '.join(then_labels)} ✓")

    seen: set[str] = set()
    unique_violations: list[ConstraintViolation] = []
    for v in violations:
        if v.message not in seen:
            seen.add(v.message)
            unique_violations.append(v)

    unique_violations.sort(key=lambda v: (0 if v.severity == "warning" else 1, -v.rule_confidence))
    top = unique_violations[:5]

    return CspSubsystemResult(
        violations=top,
        satisfied=satisfied[:3],
        csp_status="VIOLATIONS_FOUND" if unique_violations else "CONSISTENT",
        violation_count=len(unique_violations),
    )


def _run_surrogate(asking_price: float, features: dict[str, float]) -> CspSubsystemResult:
    violations: list[ConstraintViolation] = []
    satisfied: list[str] = []
    skipped = 0

    for rule in SURROGATE_RULES:
        conds = rule.get("conditions") or []
        if not conds:
            skipped += 1
            continue
        all_ok = True
        for c in conds:
            if not _eval_surrogate_condition(str(c), features):
                all_ok = False
                break
        if not all_ok:
            continue

        then_p = float(rule.get("then_price") or 0)
        conf = float(rule.get("confidence") or 0)
        if then_p <= 0:
            continue

        rel = abs(asking_price - then_p) / then_p
        if rel > SURROGATE_PRICE_TOLERANCE:
            direction = "above" if asking_price > then_p else "below"
            violations.append(
                ConstraintViolation(
                    severity="warning" if conf >= 0.55 else "info",
                    message=(
                        f"A surrogate decision path for this profile suggests a reference level near "
                        f"${then_p:,.0f}; your ask is {direction} that band ({rel * 100:.0f}% off reference)."
                    ),
                    rule_confidence=conf,
                    expected=f"~${then_p:,.0f} (surrogate leaf)",
                    actual=f"${asking_price:,.0f} asking",
                    suggestion=(
                        "Compare with the AI estimate and CBR medians; adjust if you need faster liquidity."
                    ),
                    source="surrogate",
                )
            )
        else:
            satisfied.append(
                f"Surrogate rule (conf {conf * 100:.0f}%) aligns with your ask vs reference ${then_p:,.0f} ✓"
            )

    violations.sort(key=lambda v: (-v.rule_confidence, v.severity == "info"))
    top = violations[:MAX_SURROGATE_VIOLATIONS]

    return CspSubsystemResult(
        violations=top,
        satisfied=satisfied[:3],
        csp_status="VIOLATIONS_FOUND" if violations else "CONSISTENT",
        violation_count=len(violations),
    )


# Above this gap (asking vs predicted, %) a model_band overshoot is flagged
# as "warning" rather than the softer "info". Tuned to fire on the kind of
# 30%+ overshoot that surfaces an "Above ceiling" widget elsewhere in the UI.
_MODEL_BAND_WARN_GAP_PCT = 5.0


def _run_model_band(
    asking_price: float,
    predicted: Optional[float],
    low: Optional[float],
    high: Optional[float],
) -> Optional[CspSubsystemResult]:
    """Compare the asking price against the AI estimate's 95% confidence band.

    Returns None when the caller didn't supply a prediction (so the response
    omits the field entirely instead of showing an empty section in the UI).
    """
    if predicted is None or predicted <= 0 or high is None:
        return None

    violations: list[ConstraintViolation] = []
    satisfied: list[str] = []

    if asking_price > high:
        gap_pct = ((asking_price - predicted) / predicted) * 100
        severity = "warning" if gap_pct > _MODEL_BAND_WARN_GAP_PCT else "info"
        violations.append(
            ConstraintViolation(
                severity=severity,
                message=(
                    f"Asking ${asking_price:,.0f} is above the AI estimate's confidence "
                    f"ceiling of ${high:,.0f} ({gap_pct:+.1f}% vs estimate ${predicted:,.0f})."
                ),
                rule_confidence=0.95,
                expected=f"≤ ${high:,.0f}",
                actual=f"${asking_price:,.0f}",
                suggestion=(
                    f"Listings priced near or below the AI estimate (${predicted:,.0f}) "
                    "typically attract more viewings and shorter time on market."
                ),
                source="model_band",
            )
        )
    elif low is not None and asking_price < low:
        gap_pct = ((predicted - asking_price) / predicted) * 100
        violations.append(
            ConstraintViolation(
                severity="info",
                message=(
                    f"Asking ${asking_price:,.0f} is below the AI estimate's confidence "
                    f"floor of ${low:,.0f} ({gap_pct:.1f}% under estimate ${predicted:,.0f})."
                ),
                rule_confidence=0.95,
                expected=f"≥ ${low:,.0f}",
                actual=f"${asking_price:,.0f}",
                suggestion=(
                    f"Cross-check with comparable sales — pricing this far below the model's "
                    f"estimate of ${predicted:,.0f} may leave value on the table."
                ),
                source="model_band",
            )
        )
    else:
        band_text = (
            f"${low:,.0f}–${high:,.0f}" if low is not None else f"≤ ${high:,.0f}"
        )
        satisfied.append(
            f"Asking ${asking_price:,.0f} is inside the AI estimate's 95% confidence band ({band_text}). ✓"
        )

    return CspSubsystemResult(
        violations=violations,
        satisfied=satisfied,
        csp_status="VIOLATIONS_FOUND" if violations else "CONSISTENT",
        violation_count=len(violations),
    )


def validate_listing(req: ValidateRequest) -> ValidateResponse:
    li = _resolved_listing(req)
    apriori_res = _run_apriori(li)

    surrogate_res: Optional[CspSubsystemResult] = None
    if req.flat is not None:
        try:
            from backend.hybrid_inference import features_dict_for_surrogate_rules

            features_dict = features_dict_for_surrogate_rules(req.flat)
            surrogate_res = _run_surrogate(li["asking_price"], features_dict)
        except Exception as exc:
            logger.warning("Surrogate CSP skipped: %s", exc)
            surrogate_res = None

    model_band_res = _run_model_band(
        li["asking_price"],
        req.predicted_price,
        req.confidence_low,
        req.confidence_high,
    )

    merged_violations = list(apriori_res.violations)
    merged_satisfied = list(apriori_res.satisfied)
    if surrogate_res:
        merged_violations.extend(surrogate_res.violations)
        merged_satisfied.extend(surrogate_res.satisfied)
    if model_band_res:
        merged_violations.extend(model_band_res.violations)
        merged_satisfied.extend(model_band_res.satisfied)

    total_violations = (
        apriori_res.violation_count
        + (surrogate_res.violation_count if surrogate_res else 0)
        + (model_band_res.violation_count if model_band_res else 0)
    )
    status = "VIOLATIONS_FOUND" if total_violations > 0 else "CONSISTENT"

    return ValidateResponse(
        violations=merged_violations[: 5 + MAX_SURROGATE_VIOLATIONS + 1],
        satisfied=merged_satisfied[:7],
        csp_status=status,
        violation_count=total_violations,
        apriori=apriori_res,
        surrogate=surrogate_res,
        model_band=model_band_res,
    )
