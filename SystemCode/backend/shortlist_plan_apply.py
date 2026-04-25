"""
Deterministic filter + sort for NL shortlist plans (no FastAPI / no location imports).

Plan schema (nested; legacy flat shape is normalised on entry):

    {
      "area":      { "towns": [str], "street_contains": str|None },
      "price":     { "min": n|None, "max": n|None, "vs_model_pct_max": n|None },
      "unit":      { "flat_types": [str], "floor_area_min_sqm": n|None, "floor_area_max_sqm": n|None,
                     "storey_min": n|None, "storey_max": n|None,
                     "lease_min_years": n|None, "lease_max_years": n|None },
      "proximity": { "mrt_max_dist_m": n|None, "highway_min_dist_m": n|None,
                     "school_max_dist_m": n|None, "school_min_tier": "high"|"medium"|"low"|None,
                     "hawker_max_dist_m": n|None, "mall_max_dist_m": n|None },
      "sort":      [{"key": str, "dir": "asc"|"desc"}, ...],
      "limit":     int|None,
    }
"""

from __future__ import annotations

import copy
from typing import Any

TOWNS_UC = [
    "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH",
    "BUKIT PANJANG", "BUKIT TIMAH", "CENTRAL AREA", "CHOA CHU KANG",
    "CLEMENTI", "GEYLANG", "HOUGANG", "JURONG EAST", "JURONG WEST",
    "KALLANG", "KALLANG/WHAMPOA", "MARINE PARADE", "PASIR RIS",
    "PUNGGOL", "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON",
    "TAMPINES", "TOA PAYOH", "WOODLANDS", "YISHUN",
]

FLAT_TYPES_UC = [
    "1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM",
    "EXECUTIVE", "MULTI-GENERATION",
]

SCHOOL_TIERS = {"high", "medium", "low"}

LEGACY_SORT_MAP = {
    "nearest_mrt_asc":       [{"key": "nearest_mrt",       "dir": "asc"}],
    "nearest_highway_desc":  [{"key": "nearest_highway",   "dir": "desc"}],
    "smart_score_desc":      [{"key": "smart_score",       "dir": "desc"}],
    "created_at_desc":       [{"key": "created_at",        "dir": "desc"}],
}

SUPPORTED_SORT_KEYS = {
    "smart_score", "listing_price", "predicted_price", "vs_model_pct",
    "remaining_lease_years", "floor_area_sqm", "storey_mid",
    "nearest_mrt", "nearest_school", "nearest_hawker", "nearest_mall",
    "nearest_highway", "created_at",
}


def _normalize_town(s: str | None) -> str | None:
    if not s:
        return None
    u = str(s).strip().upper()
    if u in TOWNS_UC:
        return u
    for t in TOWNS_UC:
        if u in t or t in u:
            return t
    return u


def _normalize_flat_type(s: str | None) -> str | None:
    if not s:
        return None
    u = str(s).strip().upper().replace("-ROOM", " ROOM").replace("ROOM", " ROOM")
    u = " ".join(u.split())
    u = u.replace("  ", " ")
    if u in FLAT_TYPES_UC:
        return u
    for ft in FLAT_TYPES_UC:
        if u == ft.replace(" ", "") or u.replace(" ", "") == ft.replace(" ", ""):
            return ft
    return u


def normalize_plan(plan: dict[str, Any] | None) -> dict[str, Any]:
    """
    Accept legacy flat plan OR new nested plan; return canonical nested plan.

    Legacy:  { area: {town, street_contains}, constraints: {mrt_max_dist_m, highway_min_dist_m}, sort: "str" }
    Canonical: nested per module docstring.
    """
    p = copy.deepcopy(plan) if isinstance(plan, dict) else {}

    area = p.get("area") if isinstance(p.get("area"), dict) else {}
    towns_raw = area.get("towns")
    if towns_raw is None and area.get("town"):
        towns_raw = [area.get("town")]
    towns = [t for t in (_normalize_town(x) for x in (towns_raw or [])) if t]

    out_area = {
        "towns": towns,
        "street_contains": (
            str(area.get("street_contains") or area.get("streetContains") or "").strip().upper()
            or None
        ),
    }

    legacy_cons = p.get("constraints") if isinstance(p.get("constraints"), dict) else {}
    prox = p.get("proximity") if isinstance(p.get("proximity"), dict) else {}

    def _num_or_none(*vals: Any) -> float | None:
        for v in vals:
            if v is None:
                continue
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
        return None

    out_prox = {
        "mrt_max_dist_m": _num_or_none(
            prox.get("mrt_max_dist_m"), prox.get("mrtMaxDistM"),
            legacy_cons.get("mrt_max_dist_m"), legacy_cons.get("mrtMaxDistM"),
        ),
        "highway_min_dist_m": _num_or_none(
            prox.get("highway_min_dist_m"), prox.get("highwayMinDistM"),
            legacy_cons.get("highway_min_dist_m"), legacy_cons.get("highwayMinDistM"),
        ),
        "school_max_dist_m": _num_or_none(prox.get("school_max_dist_m")),
        "school_min_tier": (
            str(prox.get("school_min_tier")).strip().lower()
            if prox.get("school_min_tier") else None
        ),
        "hawker_max_dist_m": _num_or_none(prox.get("hawker_max_dist_m")),
        "mall_max_dist_m": _num_or_none(prox.get("mall_max_dist_m")),
    }
    if out_prox["school_min_tier"] not in SCHOOL_TIERS:
        out_prox["school_min_tier"] = None

    price_in = p.get("price") if isinstance(p.get("price"), dict) else {}
    out_price = {
        "min": _num_or_none(price_in.get("min")),
        "max": _num_or_none(price_in.get("max")),
        "vs_model_pct_max": _num_or_none(price_in.get("vs_model_pct_max")),
    }

    unit_in = p.get("unit") if isinstance(p.get("unit"), dict) else {}
    flat_types = [
        ft for ft in (_normalize_flat_type(x) for x in (unit_in.get("flat_types") or []))
        if ft
    ]
    out_unit = {
        "flat_types": flat_types,
        "floor_area_min_sqm": _num_or_none(unit_in.get("floor_area_min_sqm")),
        "floor_area_max_sqm": _num_or_none(unit_in.get("floor_area_max_sqm")),
        "storey_min": _num_or_none(unit_in.get("storey_min")),
        "storey_max": _num_or_none(unit_in.get("storey_max")),
        "lease_min_years": _num_or_none(unit_in.get("lease_min_years")),
        "lease_max_years": _num_or_none(unit_in.get("lease_max_years")),
    }

    sort_in = p.get("sort")
    sort_list: list[dict[str, str]] = []
    if isinstance(sort_in, str):
        sort_list = copy.deepcopy(LEGACY_SORT_MAP.get(sort_in.strip(), []))
    elif isinstance(sort_in, list):
        for s in sort_in:
            if not isinstance(s, dict):
                continue
            k = str(s.get("key") or "").strip()
            d = str(s.get("dir") or "desc").strip().lower()
            if k in SUPPORTED_SORT_KEYS and d in ("asc", "desc"):
                sort_list.append({"key": k, "dir": d})
    if not sort_list:
        sort_list = [{"key": "created_at", "dir": "desc"}]

    limit_raw = p.get("limit")
    try:
        limit = int(limit_raw) if limit_raw is not None else None
    except (TypeError, ValueError):
        limit = None
    if limit is not None and limit <= 0:
        limit = None

    return {
        "area": out_area,
        "price": out_price,
        "unit": out_unit,
        "proximity": out_prox,
        "sort": sort_list,
        "limit": limit,
    }


def merge_nl_constraint_overrides(
    plan: dict[str, Any],
    *,
    mrt_max_dist_m: int | None = None,
    highway_min_dist_m: int | None = None,
) -> dict[str, Any]:
    """Deep-merge optional distance overrides into the plan. Works on legacy or canonical input."""
    norm = normalize_plan(plan)
    if mrt_max_dist_m is not None:
        norm["proximity"]["mrt_max_dist_m"] = float(mrt_max_dist_m)
    if highway_min_dist_m is not None:
        norm["proximity"]["highway_min_dist_m"] = float(highway_min_dist_m)
    return norm


MATCH = "match"
FAIL = "fail"
UNKNOWN = "unknown"


def _area_verdict(feat: dict[str, Any], area: dict[str, Any]) -> tuple[str, str | None]:
    towns = area.get("towns") or []
    street_sub = area.get("street_contains") or ""
    if towns:
        ft = feat.get("town") or ""
        if ft:
            matches_any = any(t == ft or t in ft or ft in t for t in towns)
            if not matches_any:
                return FAIL, None
        else:
            return UNKNOWN, "town"
    if street_sub:
        blob = f"{feat.get('street') or ''} {feat.get('address') or ''}".upper()
        if not blob.strip():
            return UNKNOWN, "address"
        if street_sub not in blob:
            return FAIL, None
    return MATCH, None


def _range_verdict(
    value: float | None, *, gte: float | None = None, lte: float | None = None, missing_tag: str
) -> tuple[str, str | None]:
    if gte is None and lte is None:
        return MATCH, None
    if value is None:
        return UNKNOWN, missing_tag
    v = float(value)
    if gte is not None and v < float(gte):
        return FAIL, None
    if lte is not None and v > float(lte):
        return FAIL, None
    return MATCH, None


def _price_verdict(feat: dict[str, Any], price: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    out.append(_range_verdict(
        feat.get("listing_price"), gte=price.get("min"), lte=price.get("max"),
        missing_tag="listing_price",
    ))
    vs_cap = price.get("vs_model_pct_max")
    if vs_cap is not None:
        out.append(_range_verdict(
            feat.get("vs_model_pct"), lte=vs_cap, missing_tag="vs_model_pct",
        ))
    return out


def _unit_verdict(feat: dict[str, Any], unit: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    flat_types = unit.get("flat_types") or []
    if flat_types:
        ft = feat.get("flat_type")
        if not ft:
            out.append((UNKNOWN, "flat_type"))
        elif str(ft).strip().upper() not in flat_types:
            out.append((FAIL, "flat_type"))
        else:
            out.append((MATCH, "flat_type"))
    out.append(_range_verdict(
        feat.get("floor_area_sqm"),
        gte=unit.get("floor_area_min_sqm"), lte=unit.get("floor_area_max_sqm"),
        missing_tag="floor_area_sqm",
    ))
    out.append(_range_verdict(
        feat.get("storey_mid"),
        gte=unit.get("storey_min"), lte=unit.get("storey_max"),
        missing_tag="storey_mid",
    ))
    out.append(_range_verdict(
        feat.get("remaining_lease_years"),
        gte=unit.get("lease_min_years"), lte=unit.get("lease_max_years"),
        missing_tag="remaining_lease_years",
    ))
    return out


def _proximity_verdict(feat: dict[str, Any], prox: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    out.append(_range_verdict(
        feat.get("nearest_mrt_m"), lte=prox.get("mrt_max_dist_m"),
        missing_tag="nearest_mrt",
    ))
    out.append(_range_verdict(
        feat.get("nearest_highway_m"), gte=prox.get("highway_min_dist_m"),
        missing_tag="nearest_highway",
    ))
    out.append(_range_verdict(
        feat.get("nearest_school_m"), lte=prox.get("school_max_dist_m"),
        missing_tag="nearest_school",
    ))
    tier_req = prox.get("school_min_tier")
    if tier_req:
        tier = feat.get("nearest_school_tier")
        if not tier:
            out.append((UNKNOWN, "nearest_school_tier"))
        else:
            order = {"low": 1, "medium": 2, "high": 3}
            if order.get(str(tier).lower(), 0) < order.get(tier_req, 0):
                out.append((FAIL, "nearest_school_tier"))
            else:
                out.append((MATCH, "nearest_school_tier"))
    out.append(_range_verdict(
        feat.get("nearest_hawker_m"), lte=prox.get("hawker_max_dist_m"),
        missing_tag="nearest_hawker",
    ))
    out.append(_range_verdict(
        feat.get("nearest_mall_m"), lte=prox.get("mall_max_dist_m"),
        missing_tag="nearest_mall",
    ))
    return out


def _evaluate(feat: dict[str, Any], plan: dict[str, Any]) -> tuple[bool, list[str]]:
    """Return (keep_row, unknown_tags). Drop only on FAIL; UNKNOWN keeps + tags."""
    unknown_tags: list[str] = []

    area_v, area_tag = _area_verdict(feat, plan["area"])
    if area_v == FAIL:
        return False, []
    if area_v == UNKNOWN and area_tag:
        unknown_tags.append(area_tag)

    for verdicts in (
        _price_verdict(feat, plan["price"]),
        _unit_verdict(feat, plan["unit"]),
        _proximity_verdict(feat, plan["proximity"]),
    ):
        for v, tag in verdicts:
            if v == FAIL:
                return False, []
            if v == UNKNOWN and tag:
                unknown_tags.append(tag)

    return True, unknown_tags


_SORT_EXTRACTORS: dict[str, str] = {
    "smart_score": "smart_score",
    "listing_price": "listing_price",
    "predicted_price": "predicted_price",
    "vs_model_pct": "vs_model_pct",
    "remaining_lease_years": "remaining_lease_years",
    "floor_area_sqm": "floor_area_sqm",
    "storey_mid": "storey_mid",
    "nearest_mrt": "nearest_mrt_m",
    "nearest_school": "nearest_school_m",
    "nearest_hawker": "nearest_hawker_m",
    "nearest_mall": "nearest_mall_m",
    "nearest_highway": "nearest_highway_m",
    "created_at": "created_ts",
}


def _dim_sort_key(feat: dict[str, Any], key: str, direction: str) -> tuple:
    field = _SORT_EXTRACTORS.get(key)
    val = feat.get(field) if field else None
    if val is None:
        # Missing always sorts last regardless of dir.
        return (1, 0.0)
    if key == "created_at":
        ts = val.timestamp() if hasattr(val, "timestamp") else 0.0
        return (0, -ts if direction == "desc" else ts)
    try:
        v = float(val)
    except (TypeError, ValueError):
        return (1, 0.0)
    return (0, -v if direction == "desc" else v)


def apply_plan(
    features: list[dict[str, Any]], plan: dict[str, Any]
) -> tuple[list[int], list[dict[str, Any]]]:
    norm = normalize_plan(plan)

    kept: list[dict[str, Any]] = []
    notes: list[dict[str, Any]] = []
    for feat in features:
        keep, unknown_tags = _evaluate(feat, norm)
        if not keep:
            continue
        kept.append(feat)
        notes.append({
            "id": feat["id"],
            "nearest_mrt_m": feat.get("nearest_mrt_m"),
            "nearest_highway_m": feat.get("nearest_highway_m"),
            "nearest_school_m": feat.get("nearest_school_m"),
            "nearest_school_tier": feat.get("nearest_school_tier"),
            "nearest_hawker_m": feat.get("nearest_hawker_m"),
            "nearest_mall_m": feat.get("nearest_mall_m"),
            "smart_score": feat.get("smart_score"),
            "vs_model_pct": feat.get("vs_model_pct"),
            "unknown": unknown_tags,
        })

    def _compound(f: dict[str, Any]) -> tuple:
        return tuple(_dim_sort_key(f, s["key"], s["dir"]) for s in norm["sort"])

    kept.sort(key=_compound)
    id_order = [f["id"] for f in kept]

    limit = norm.get("limit")
    if isinstance(limit, int) and limit > 0:
        id_order = id_order[:limit]
        note_by_id = {n["id"]: n for n in notes}
        notes = [note_by_id[i] for i in id_order if i in note_by_id]
    else:
        note_by_id = {n["id"]: n for n in notes}
        notes = [note_by_id[i] for i in id_order if i in note_by_id]

    return id_order, notes
