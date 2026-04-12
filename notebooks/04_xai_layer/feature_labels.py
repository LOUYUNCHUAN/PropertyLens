"""
Human-readable labels for hybrid-cluster feature columns (SHAP, LIME, surrogate rules).

Used by 05_hybrid_xai_explain.ipynb.
"""

from __future__ import annotations

import re
from typing import Iterable

# Longer separators first so ">=" wins over ">"
_COND_SPLITS: tuple[tuple[str, str], ...] = (
    (" <= ", "<="),
    (" >= ", ">="),
    (" > ", ">"),
    (" < ", "<"),
)

_PRETTY: dict[str, str] = {
    "transaction_year": "Transaction year",
    "level_mid": "Storey (mid)",
    "lease_remaining_years": "Lease remaining (years)",
    "floor_area_sqm": "Floor area (m²)",
    "room_count": "Room count",
    "dist_to_mrt_m": "Distance to MRT (m)",
    "orientation_score": "Orientation score",
    "dist_to_highway_m": "Distance to highway (m)",
    "dist_to_foodcourt_m": "Distance to food court (m)",
    "dist_to_nearest_mall_m": "Distance to nearest mall (m)",
    "mall_count_3km": "Mall count (3 km)",
    "mall_weighted_access_3km": "Mall weighted access (3 km)",
    "dist_to_nearest_school_m": "Distance to nearest school (m)",
    "school_count_1km": "School count (1 km)",
    "primary_school_quality_1km_weighted": "Primary school quality (1 km, weighted)",
    "primary_school_top_quality_1km": "Primary top-quality schools (1 km)",
    "primary_school_count_1km": "Primary school count (1 km)",
    "trans_sold_count": "Resale transaction count (sold)",
    "trans_rented_count": "Rental transaction count",
    "trans_total_count": "Transaction count (total)",
    "trans_rental_ratio": "Rental ratio",
    "market_activity_score": "Market activity score",
    "yoy_volume_change": "YoY volume change",
}


def feature_label(col: str) -> str:
    """Map a model column name to a short display string."""
    col = str(col).strip()
    if col in _PRETTY:
        return _PRETTY[col]
    if col.startswith("town_"):
        return "Town · " + col[5:].strip()
    if col.startswith("flat_type_"):
        return "Flat type · " + col[10:].strip()
    if col.startswith("flat_model_"):
        return "Flat model · " + col[11:].strip()
    return _snake_fallback(col)


def _snake_fallback(col: str) -> str:
    s = re.sub(r"_+", " ", col).strip()
    if not s:
        return col
    parts = s.split()
    out: list[str] = []
    for p in parts:
        pl = p.lower()
        if pl == "sqm":
            out.append("(m²)")
        elif pl == "m" and out:
            out.append("(m)")
        elif pl in ("mrt", "hdb"):
            out.append(p.upper())
        elif pl == "yoy":
            out.append("YoY")
        else:
            out.append(p[:1].upper() + p[1:].lower() if len(p) > 1 else p.upper())
    return " ".join(out)


def labels_for_columns(cols: Iterable[str]) -> list[str]:
    return [feature_label(c) for c in cols]


def label_rule_text(c: str) -> str:
    """Format a surrogate-tree condition like ``floor_area_sqm <= 85.5`` for display."""
    c = str(c).strip()
    for raw, op in _COND_SPLITS:
        if raw in c:
            left, right = c.split(raw, 1)
            return f"{feature_label(left.strip())} {op} {right.strip()}"
    return feature_label(c)


def label_lime_line(feat: str) -> str:
    """Format a LIME feature string (often same shape as surrogate conditions)."""
    return label_rule_text(feat)
