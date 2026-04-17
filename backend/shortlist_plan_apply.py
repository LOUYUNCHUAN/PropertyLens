"""
Deterministic filter + sort for NL shortlist plans (no FastAPI / no location imports).
"""

from __future__ import annotations

import copy
from typing import Any

# HDB towns (uppercase) — align with chat.py list where possible
TOWNS_UC = [
    "ANG MO KIO",
    "BEDOK",
    "BISHAN",
    "BUKIT BATOK",
    "BUKIT MERAH",
    "BUKIT PANJANG",
    "BUKIT TIMAH",
    "CENTRAL AREA",
    "CHOA CHU KANG",
    "CLEMENTI",
    "GEYLANG",
    "HOUGANG",
    "JURONG EAST",
    "JURONG WEST",
    "KALLANG",
    "KALLANG/WHAMPOA",
    "MARINE PARADE",
    "PASIR RIS",
    "PUNGGOL",
    "QUEENSTOWN",
    "SEMBAWANG",
    "SENGKANG",
    "SERANGOON",
    "TAMPINES",
    "TOA PAYOH",
    "WOODLANDS",
    "YISHUN",
]


def _normalize_town(s: str | None) -> str | None:
    if not s:
        return None
    u = s.strip().upper()
    if u in TOWNS_UC:
        return u
    for t in TOWNS_UC:
        if u in t or t in u:
            return t
    return u


def _match_area(feat: dict[str, Any], area: dict[str, Any]) -> bool:
    if not area:
        return True
    town_raw = area.get("town")
    town = _normalize_town(str(town_raw)) if town_raw else None
    st_sub = (area.get("street_contains") or area.get("streetContains") or "").strip().upper()
    if town:
        ft = feat["town"] or ""
        if ft != town and town not in ft and ft not in town:
            return False
    if st_sub:
        blob = f"{feat['street']} {feat['address']}"
        if st_sub not in blob:
            return False
    return True


def merge_nl_constraint_overrides(
    plan: dict[str, Any],
    *,
    mrt_max_dist_m: int | None = None,
    highway_min_dist_m: int | None = None,
) -> dict[str, Any]:
    """Deep-merge optional distance overrides into the compiled JSON plan (NL shortlist search)."""
    p = copy.deepcopy(plan) if isinstance(plan, dict) else {}
    cons = p.get("constraints")
    if not isinstance(cons, dict):
        cons = {}
    if mrt_max_dist_m is not None:
        cons["mrt_max_dist_m"] = mrt_max_dist_m
    if highway_min_dist_m is not None:
        cons["highway_min_dist_m"] = highway_min_dist_m
    p["constraints"] = cons
    return p


def _match_constraints(feat: dict[str, Any], cons: dict[str, Any]) -> bool:
    if not cons:
        return True
    max_mrt = cons.get("mrtMaxDistM") or cons.get("mrt_max_dist_m")
    if max_mrt is not None:
        d = feat["nearest_mrt_m"]
        if d is None:
            return False
        if d > float(max_mrt):
            return False
    min_hwy = cons.get("highwayMinDistM") or cons.get("highway_min_dist_m")
    if min_hwy is not None:
        h = feat["nearest_highway_m"]
        if h is None:
            return False
        if h < float(min_hwy):
            return False
    return True


def apply_plan(
    features: list[dict[str, Any]], plan: dict[str, Any]
) -> tuple[list[int], list[dict[str, Any]]]:
    area = plan.get("area") if isinstance(plan.get("area"), dict) else {}
    cons = plan.get("constraints") if isinstance(plan.get("constraints"), dict) else {}
    sort_key = str(plan.get("sort") or "created_at_desc").strip()

    filtered: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []
    for feat in features:
        ok = _match_area(feat, area) and _match_constraints(feat, cons)
        if ok:
            filtered.append(feat)
            notes.append(
                {
                    "id": feat["id"],
                    "nearest_mrt_m": feat["nearest_mrt_m"],
                    "nearest_highway_m": feat["nearest_highway_m"],
                    "smart_score": feat["smart_score"],
                }
            )

    def _key_mrt_asc(f: dict[str, Any]) -> tuple:
        d = f["nearest_mrt_m"]
        if d is None:
            return (1, 0.0)
        return (0, float(d))

    def _key_hwy_desc(f: dict[str, Any]) -> tuple:
        h = f["nearest_highway_m"]
        if h is None:
            return (1, 0.0)
        return (0, -float(h))

    reverse = False
    key_fn = lambda f: f["id"]
    if sort_key == "nearest_mrt_asc":
        key_fn = _key_mrt_asc
    elif sort_key == "nearest_highway_desc":
        key_fn = _key_hwy_desc
    elif sort_key == "smart_score_desc":
        key_fn = lambda f: f["smart_score"]
        reverse = True
    elif sort_key == "created_at_desc":
        key_fn = lambda f: f.get("created_ts")
        reverse = True

    filtered.sort(key=key_fn, reverse=reverse)
    return [f["id"] for f in filtered], notes
