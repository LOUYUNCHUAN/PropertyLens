"""
Buyer-view transform: reshape cohort-relative SHAP into a buyer-facing payload
(grouped, thresholded, ranked, with percentile context and verdict).

Pure presentation logic on top of ``backend.cohort_shap``. The raw
``/api/explain/cohort-shap`` endpoint is untouched — this module feeds the
separate ``/api/explain/buyer-view`` endpoint.

Extending:
- Add a new one-hot family by adding one entry to ``FEATURE_GROUP_PREFIXES``.
- Add a pretty label by dropping a key into ``DISPLAY_NAMES``.
- Add a raw-value descriptor by dropping a callable into ``VALUE_DESCRIPTORS``.
"""

from __future__ import annotations

from typing import Any, Callable

import numpy as np

from backend.cohort_shap import CohortSHAPResult


# ── Grouping config ───────────────────────────────────────────────
FEATURE_GROUP_PREFIXES: dict[str, str] = {
    "town": "town_",
    "flat_model": "flat_model_",
    "flat_type": "flat_type_",
    "storey_range": "storey_range_",
}

# Features whose SHAP value is dominated by when the sale happened, not the
# flat itself. They are folded into a single ``market_context`` bucket so
# strengths/tradeoffs surface characteristics the buyer can actually act on.
MARKET_CONTEXT_GROUPS: set[str] = {"transaction_year", "sale_month", "year", "month_num"}

# ── Human-readable labels ─────────────────────────────────────────
DISPLAY_NAMES: dict[str, str] = {
    "town": "Town",
    "flat_model": "Flat model",
    "flat_type": "Flat type",
    "storey_range": "Storey range",
    "mall_count_3km": "Mall access",
    "mall_weighted_access_3km": "Mall access (weighted)",
    "dist_to_mrt_m": "MRT proximity",
    "dist_to_nearest_mall_m": "Mall proximity",
    "dist_to_nearest_school_m": "School proximity",
    "dist_to_foodcourt_m": "Hawker / foodcourt proximity",
    "dist_to_highway_m": "Highway proximity",
    "lease_remaining_years": "Remaining lease",
    "floor_area_sqm": "Floor area",
    "level_mid": "Floor level",
    "primary_school_count_1km": "Primary schools nearby",
    "primary_school_top_quality_1km": "Top school access",
    "primary_school_quality_1km_weighted": "School quality (weighted)",
    "school_count_1km": "Schools within 1km",
    "transaction_year": "Transaction recency",
    "recency_normalized": "Recency",
    "room_count": "Room count",
    "orientation_score": "Orientation",
    "market_activity_score": "Market activity",
    "market_flats_sold_national": "Market demand (national)",
    "market_flats_rented_national": "Rental demand (national)",
}


def _prettify(name: str) -> str:
    return name.replace("_", " ").strip().capitalize()


def display_name_for(key: str) -> str:
    return DISPLAY_NAMES.get(key) or _prettify(key)


# ── Raw-value descriptors (ungrouped features) ────────────────────
ValueFn = Callable[[float, np.ndarray], str]


def _qualitative_band(value: float, cohort: np.ndarray, label: str) -> str:
    """
    Render engineered-score continuous features as a qualitative cohort band
    instead of a raw float. Buyers can't interpret a 0.483217-style score.
    """
    if cohort.size == 0:
        return label
    pct = compute_raw_percentile(cohort, float(value))
    if pct >= 66:
        return f"strong {label} vs cohort"
    if pct >= 33:
        return f"typical {label} for cohort"
    return f"limited {label} vs cohort"


VALUE_DESCRIPTORS: dict[str, ValueFn] = {
    "mall_count_3km": lambda v, _c: f"{int(round(v))} malls within 3km",
    "mall_weighted_access_3km": lambda v, c: _qualitative_band(v, c, "mall access"),
    "school_count_1km": lambda v, _c: f"{int(round(v))} schools within 1km",
    "primary_school_count_1km": lambda v, _c: f"{int(round(v))} primary schools within 1km",
    "primary_school_quality_1km_weighted": lambda v, c: _qualitative_band(v, c, "school quality"),
    "primary_school_top_quality_1km": lambda v, _c: (
        "top-tier primary school within 1km" if v >= 0.5 else "no top-tier school within 1km"
    ),
    "orientation_score": lambda v, c: _qualitative_band(v, c, "orientation"),
    "market_activity_score": lambda v, c: _qualitative_band(v, c, "market activity"),
    "market_flats_sold_national": lambda v, c: _qualitative_band(v, c, "national demand"),
    "market_flats_rented_national": lambda v, c: _qualitative_band(v, c, "rental demand"),
    "recency_normalized": lambda v, c: _qualitative_band(v, c, "recency"),
    "lease_remaining_years": lambda v, c: (
        f"{int(round(v))} years · cohort avg {int(round(float(np.mean(c))))}"
        if c.size
        else f"{int(round(v))} years"
    ),
    "dist_to_mrt_m": lambda v, _c: f"{v/1000:.1f} km to MRT",
    "dist_to_nearest_mall_m": lambda v, _c: f"{v/1000:.1f} km to mall",
    "dist_to_nearest_school_m": lambda v, _c: f"{v/1000:.1f} km to school",
    "dist_to_foodcourt_m": lambda v, _c: f"{v/1000:.1f} km to hawker",
    "dist_to_highway_m": lambda v, _c: f"{v/1000:.1f} km to highway",
    "floor_area_sqm": lambda v, _c: f"{int(round(v))} sqm",
    "level_mid": lambda v, _c: f"floor {int(round(v))}",
    "transaction_year": lambda v, _c: f"sold {int(round(v))}",
    "room_count": lambda v, _c: f"{int(round(v))}-room",
}


def _format_raw_value(feature: str, value: float, cohort_values: np.ndarray) -> str:
    fn = VALUE_DESCRIPTORS.get(feature)
    if fn is not None:
        return fn(value, cohort_values)
    try:
        return f"{float(value):.1f}"
    except (TypeError, ValueError):
        return str(value)


# ── Percentile helpers ────────────────────────────────────────────
def compute_raw_percentile(
    cohort_values: np.ndarray, query_value: float
) -> float:
    """
    Rank of ``query_value`` inside ``cohort_values`` on a 0–100 scale.
    Uses the mid-rank convention so ties get a central percentile.
    """
    if cohort_values.size == 0:
        return 50.0
    lt = float(np.sum(cohort_values < query_value))
    eq = float(np.sum(cohort_values == query_value))
    pct = (lt + 0.5 * eq) / cohort_values.size * 100.0
    return max(0.0, min(100.0, pct))


def percentile_band(pct: float) -> str:
    if pct <= 15:
        return "bottom quintile"
    if pct <= 40:
        return "below median"
    if pct <= 60:
        return "typical"
    if pct <= 85:
        return "above median"
    return "top quartile"


# ── Verdict bands ─────────────────────────────────────────────────
def verdict_from_pct(pct_diff: float) -> tuple[str, str]:
    if pct_diff > 8:
        return "Premium-priced", "warning"
    if pct_diff > 3:
        return "Slightly above cohort", "neutral"
    if pct_diff >= -3:
        return "Fairly priced", "neutral"
    if pct_diff >= -8:
        return "Slightly below cohort", "neutral"
    return "Below market", "info"


# ── Grouping ──────────────────────────────────────────────────────
def group_phi(
    phi: np.ndarray, feature_cols: list[str]
) -> dict[str, tuple[float, list[int]]]:
    """
    Fold one-hot families listed in FEATURE_GROUP_PREFIXES by summing their phi
    values; ungrouped features map to themselves with a single-element index.

    Returns {group_or_feature: (delta_sum, [col_index, ...])}.
    """
    groups: dict[str, tuple[float, list[int]]] = {}
    for i, col in enumerate(feature_cols):
        matched_group = None
        for group, prefix in FEATURE_GROUP_PREFIXES.items():
            if col.startswith(prefix):
                matched_group = group
                break
        key = matched_group if matched_group else col
        prev = groups.get(key)
        if prev is None:
            groups[key] = (float(phi[i]), [i])
        else:
            groups[key] = (prev[0] + float(phi[i]), prev[1] + [i])
    return groups


def _dominant_col_idx(indices: list[int], x_query: np.ndarray) -> int:
    """For a grouped one-hot family, the column whose value is 1 (or max)."""
    if len(indices) == 1:
        return indices[0]
    sub = x_query[indices]
    return indices[int(np.argmax(sub))]


# ── Cohort descriptor ─────────────────────────────────────────────
def _lease_bucket(years: float) -> str:
    y = int(round(years))
    bucket_lo = (y // 5) * 5
    return f"{bucket_lo}-{bucket_lo + 5} yrs lease"


def build_cohort_descriptor(
    flat, cohort_result: CohortSHAPResult, feature_cols: list[str]
) -> str:
    """
    One-line string like "4 ROOM · 70-75 yrs lease · TAMPINES". Town is the
    modal town of the cohort (falls back to the query flat's town).
    """
    flat_type = str(getattr(flat, "flat_type", "") or "").strip()
    lease_remain = float(getattr(flat, "remaining_lease_years", 0) or 0)
    lease = _lease_bucket(lease_remain) if lease_remain > 0 else ""

    town = ""
    if cohort_result.cohort_town_mix:
        town = max(cohort_result.cohort_town_mix.items(), key=lambda kv: kv[1])[0]
    if not town:
        town = str(getattr(flat, "town", "") or "").strip()

    parts = [p for p in (flat_type, lease, town) if p]
    return " · ".join(parts) if parts else "similar flats"


# ── Price range ───────────────────────────────────────────────────
def build_price_range(
    prices: np.ndarray, estimate: float
) -> dict[str, float]:
    if prices.size == 0:
        return {"min": 0.0, "max": 0.0, "estimate_percentile": 50.0}
    return {
        "min": round(float(np.min(prices)), 2),
        "max": round(float(np.max(prices)), 2),
        "estimate_percentile": round(compute_raw_percentile(prices, float(estimate)), 1),
    }


# ── Main assembler ────────────────────────────────────────────────
MIN_CONFIDENT_COHORT = 10
TOP_N_PER_SIDE = 2


def _group_raw_value_descriptor(
    group: str,
    indices: list[int],
    feature_cols: list[str],
    x_query: np.ndarray,
    X_cohort: np.ndarray,
) -> str:
    """For grouped one-hot families: active category + share of cohort."""
    dom = _dominant_col_idx(indices, x_query)
    dom_name = feature_cols[dom]
    # Strip prefix so 'town_TAMPINES' → 'TAMPINES'
    label = dom_name
    for _, prefix in FEATURE_GROUP_PREFIXES.items():
        if dom_name.startswith(prefix):
            label = dom_name[len(prefix):]
            break
    if X_cohort.size:
        share = float(np.mean(X_cohort[:, dom] > 0.5)) * 100.0
        return f"{label} ({share:.0f}% of cohort)"
    return label


def build_buyer_view(
    flat,
    X_query: np.ndarray,
    cohort_result: CohortSHAPResult,
    estimate: float,
    feature_cols: list[str],
) -> dict[str, Any]:
    """
    Assemble the BuyerViewResponse-shaped dict.

    ``X_query`` shape (1, n_features) or (n_features,). ``estimate`` is the
    hybrid-ensemble prediction (what the buyer sees on /predict). ``cohort_baseline``
    is reused from the cohort-SHAP reframe.
    """
    x_query = np.asarray(X_query, dtype=float).ravel()
    cohort_baseline = float(cohort_result.cohort_baseline)

    # Small-cohort fallback — signal "low" confidence and strip percentile context.
    low_confidence = cohort_result.cohort_size < MIN_CONFIDENT_COHORT

    threshold = max(1000.0, 0.005 * cohort_baseline)

    grouped = group_phi(cohort_result.phi_cohort, feature_cols)

    # Pull market-context groups out of the candidate pool before ranking so
    # transaction-year effects don't crowd out actionable drivers.
    market_delta_sum = 0.0
    market_keys_present: list[str] = []
    for key in list(grouped.keys()):
        if key in MARKET_CONTEXT_GROUPS:
            delta, _idxs = grouped.pop(key)
            market_delta_sum += delta
            market_keys_present.append(key)

    if abs(market_delta_sum) >= threshold:
        year_val = getattr(flat, "year", None)
        if year_val:
            descriptor = f"broad {int(year_val)} market timing"
        else:
            descriptor = "broad market timing"
        if market_delta_sum > 0:
            direction = "up"
        elif market_delta_sum < 0:
            direction = "down"
        else:
            direction = "flat"
        market_context: dict[str, Any] | None = {
            "delta": round(float(market_delta_sum), 2),
            "descriptor": descriptor,
            "direction": direction,
        }
    else:
        market_context = None

    strengths_raw: list[tuple[str, float, list[int]]] = []
    tradeoffs_raw: list[tuple[str, float, list[int]]] = []
    absorbed: list[str] = []

    for key, (delta, indices) in grouped.items():
        if abs(delta) < threshold:
            absorbed.append(key)
            continue
        (strengths_raw if delta > 0 else tradeoffs_raw).append((key, delta, indices))

    strengths_raw.sort(key=lambda t: abs(t[1]), reverse=True)
    tradeoffs_raw.sort(key=lambda t: abs(t[1]), reverse=True)

    def _build_driver(key: str, delta: float, indices: list[int]) -> dict[str, Any]:
        is_grouped = key in FEATURE_GROUP_PREFIXES
        dom_idx = _dominant_col_idx(indices, x_query)
        dom_name = feature_cols[dom_idx]

        driver: dict[str, Any] = {
            "feature_group": key,
            "display_name": display_name_for(key),
            "delta": round(float(delta), 2),
        }

        if is_grouped:
            driver["raw_value_descriptor"] = _group_raw_value_descriptor(
                key, indices, feature_cols, x_query, cohort_result.X_cohort
            )
        else:
            cohort_col = (
                cohort_result.X_cohort[:, dom_idx]
                if cohort_result.X_cohort.size
                else np.array([], dtype=float)
            )
            driver["raw_value_descriptor"] = _format_raw_value(
                dom_name, float(x_query[dom_idx]), cohort_col
            )

        if not low_confidence and cohort_result.X_cohort.size:
            cohort_col = cohort_result.X_cohort[:, dom_idx]
            pct = compute_raw_percentile(cohort_col, float(x_query[dom_idx]))
            driver["cohort_percentile"] = round(pct, 1)
            driver["percentile_label"] = percentile_band(pct)

        return driver

    strengths = [_build_driver(k, d, idx) for k, d, idx in strengths_raw[:TOP_N_PER_SIDE]]
    tradeoffs = [_build_driver(k, d, idx) for k, d, idx in tradeoffs_raw[:TOP_N_PER_SIDE]]

    pct_diff = (
        (estimate - cohort_baseline) / cohort_baseline * 100.0 if cohort_baseline else 0.0
    )
    label, tone = verdict_from_pct(pct_diff)

    price_range: dict[str, float] | None = None
    if not low_confidence and cohort_result.cohort_prices.size:
        price_range = build_price_range(cohort_result.cohort_prices, estimate)

    return {
        "estimate": round(float(estimate), 2),
        "cohort_baseline": round(cohort_baseline, 2),
        "cohort_size": int(cohort_result.cohort_size),
        "cohort_descriptor": build_cohort_descriptor(flat, cohort_result, feature_cols),
        "cohort_price_range": price_range,
        "verdict": {
            "label": label,
            "tone": tone,
            "pct_diff_vs_baseline": round(float(pct_diff), 2),
        },
        "strengths": strengths,
        "tradeoffs": tradeoffs,
        "market_context": market_context,
        "absorbed_factors": absorbed,
        "explained_model": "cluster_xgb",
        "confidence": "low" if low_confidence else "high",
    }
