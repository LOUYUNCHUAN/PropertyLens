"""
Natural-language shortlist search: Ollama compiles query → JSON plan; Python applies filters.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import requests
from pydantic import BaseModel, Field

from backend.hybrid_inference import _parse_storey_mid
from backend.location import nearest_highway_dist_m
from backend.shortlist_plan_apply import FLAT_TYPES_UC, TOWNS_UC
from backend.shortlist_smart_score import sum_smart_score, wishlist_row_to_snap

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3").strip() or "gemma3"


class NLSearchRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    query: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(default=80, ge=1, le=200)
    mrt_max_dist_m: int | None = Field(
        default=None,
        ge=100,
        le=15000,
        description="If set, overrides compiled plan proximity.mrt_max_dist_m (meters).",
    )
    highway_min_dist_m: int | None = Field(
        default=None,
        ge=0,
        le=8000,
        description="If set, overrides compiled plan proximity.highway_min_dist_m (meters).",
    )


class NLSearchResponse(BaseModel):
    filters_applied: dict[str, Any]
    sorted_ids: list[int]
    row_notes: list[dict[str, Any]] = Field(default_factory=list)
    ollama_error: str | None = None


def _nearest_of(nearby: dict[str, Any] | None, keys: tuple[str, ...]) -> tuple[float | None, dict[str, Any] | None]:
    """Minimum dist_m across combined amenity lists; also return the nearest item for tier lookup."""
    if not nearby:
        return None, None
    best_d: float | None = None
    best_item: dict[str, Any] | None = None
    for k in keys:
        arr = nearby.get(k) or []
        for item in arr:
            try:
                d = float(item.get("dist_m"))
            except (TypeError, ValueError):
                continue
            if best_d is None or d < best_d:
                best_d = d
                best_item = item
    return best_d, best_item


def _nearest_mrt_m(map_snap: dict[str, Any] | None) -> float | None:
    if not map_snap:
        return None
    d, _ = _nearest_of(map_snap.get("nearby") or {}, ("mrt", "lrt"))
    return d


def _nearest_highway_m(map_snap: dict[str, Any] | None) -> float | None:
    if not map_snap:
        return None
    nh = map_snap.get("nearest_highway_dist_m")
    if nh is not None:
        try:
            return float(nh)
        except (TypeError, ValueError):
            pass
    g = map_snap.get("geocode") or {}
    if g.get("found") and g.get("lat") is not None and g.get("lng") is not None:
        d = nearest_highway_dist_m(float(g["lat"]), float(g["lng"]))
        return float(d) if d is not None else None
    return None


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _row_features(row_dict: dict[str, Any]) -> dict[str, Any]:
    payload = row_dict.get("payload_json") or {}
    town = str(payload.get("town") or "").strip().upper()
    street = str(payload.get("street_name") or "").strip().upper()
    ms = row_dict.get("map_snapshot_json") or {}
    geo = ms.get("geocode") or {}
    addr = str(geo.get("address") or "").upper()

    detail_for_score = {
        "listing_price": row_dict.get("listing_price"),
        "predicted_price": row_dict.get("predicted_price"),
        "confidence_low": row_dict.get("confidence_low"),
        "confidence_high": row_dict.get("confidence_high"),
        "payload_json": payload,
        "cbr_snapshot_json": row_dict.get("cbr_snapshot_json") or [],
    }
    snap = wishlist_row_to_snap(detail_for_score)
    smart = sum_smart_score(snap)

    listing_price = _safe_float(row_dict.get("listing_price"))
    predicted_price = _safe_float(row_dict.get("predicted_price"))
    vs_model_pct: float | None = None
    if listing_price is not None and predicted_price and predicted_price > 0:
        vs_model_pct = (listing_price - predicted_price) / predicted_price * 100.0

    storey_mid: float | None = None
    sr = payload.get("storey_range")
    if sr:
        try:
            storey_mid = float(_parse_storey_mid(str(sr)))
        except Exception:
            storey_mid = None
    if storey_mid is None:
        storey_mid = _safe_float(payload.get("storey_mid"))

    nearby = ms.get("nearby") or {}
    school_d, school_item = _nearest_of(nearby, ("school",))
    school_tier = None
    if school_item and school_item.get("tier"):
        school_tier = str(school_item.get("tier")).strip().lower() or None
    hawker_d, _ = _nearest_of(nearby, ("hawker",))
    mall_d, _ = _nearest_of(nearby, ("mall",))

    return {
        "id": row_dict["id"],
        "town": town,
        "street": street,
        "address": addr,
        "flat_type": str(payload.get("flat_type") or "").strip().upper() or None,
        "floor_area_sqm": _safe_float(payload.get("floor_area_sqm")),
        "storey_mid": storey_mid,
        "remaining_lease_years": _safe_float(payload.get("remaining_lease_years")),
        "listing_price": listing_price,
        "predicted_price": predicted_price,
        "vs_model_pct": vs_model_pct,
        "nearest_mrt_m": _nearest_mrt_m(ms),
        "nearest_highway_m": _nearest_highway_m(ms),
        "nearest_school_m": school_d,
        "nearest_school_tier": school_tier,
        "nearest_hawker_m": hawker_d,
        "nearest_mall_m": mall_d,
        "smart_score": smart,
        "created_ts": row_dict.get("created_at"),
    }


_NUM_RE = r"(\d+(?:\.\d+)?)"


def _parse_price_amount(txt: str) -> float | None:
    """Parse '650k', '$700,000', '1.2m' → float dollars."""
    s = txt.lower().replace(",", "").replace("$", "").strip()
    m = re.match(rf"^{_NUM_RE}\s*([km])?$", s)
    if not m:
        return None
    num = float(m.group(1))
    suf = (m.group(2) or "").lower()
    if suf == "k":
        return num * 1_000
    if suf == "m":
        return num * 1_000_000
    # bare number: if small, assume thousands (e.g., "650" ≈ 650k)
    if num < 10_000:
        return num * 1_000
    return num


def _fallback_plan_from_keywords(q: str) -> dict[str, Any]:
    """Cheap fallback when Ollama is down — substring + regex heuristics. Returns canonical nested plan."""
    ql = q.lower()
    plan: dict[str, Any] = {
        "area": {"towns": [], "street_contains": None},
        "price": {"min": None, "max": None, "vs_model_pct_max": None},
        "unit": {
            "flat_types": [], "floor_area_min_sqm": None, "floor_area_max_sqm": None,
            "storey_min": None, "storey_max": None,
            "lease_min_years": None, "lease_max_years": None,
        },
        "proximity": {
            "mrt_max_dist_m": None, "highway_min_dist_m": None,
            "school_max_dist_m": None, "school_min_tier": None,
            "hawker_max_dist_m": None, "mall_max_dist_m": None,
        },
        "sort": [{"key": "created_at", "dir": "desc"}],
        "limit": None,
    }

    for t in TOWNS_UC:
        tl = t.lower()
        if tl in ql or tl.replace("/", " ") in ql:
            plan["area"]["towns"].append(t)
    # dedupe preserving order
    plan["area"]["towns"] = list(dict.fromkeys(plan["area"]["towns"]))

    if "bedok north" in ql:
        plan["area"]["street_contains"] = "BEDOK NORTH"

    for raw in re.findall(rf"(?:^|[^a-z])([1-5])\s*[- ]?\s*room\b", ql):
        ft = f"{raw} ROOM"
        if ft not in plan["unit"]["flat_types"]:
            plan["unit"]["flat_types"].append(ft)
    if "executive" in ql and "EXECUTIVE" not in plan["unit"]["flat_types"]:
        plan["unit"]["flat_types"].append("EXECUTIVE")

    m_between = re.search(
        rf"between\s+\$?{_NUM_RE}\s*([km])?\s*(?:and|-|to)\s+\$?{_NUM_RE}\s*([km])?",
        ql,
    )
    if m_between:
        lo = _parse_price_amount(f"{m_between.group(1)}{m_between.group(2) or ''}")
        hi = _parse_price_amount(f"{m_between.group(3)}{m_between.group(4) or ''}")
        plan["price"]["min"] = lo
        plan["price"]["max"] = hi
    else:
        m_under = re.search(rf"(?:under|below|<=?|at most)\s+\$?{_NUM_RE}\s*([km])?", ql)
        if m_under:
            plan["price"]["max"] = _parse_price_amount(f"{m_under.group(1)}{m_under.group(2) or ''}")
        m_over = re.search(rf"(?:over|above|>=?|at least)\s+\$?{_NUM_RE}\s*([km])?", ql)
        if m_over:
            plan["price"]["min"] = _parse_price_amount(f"{m_over.group(1)}{m_over.group(2) or ''}")

    m_lease = re.search(rf"(?:at least|>=?|minimum)\s+{_NUM_RE}\s*(?:year|yr)s?\s*(?:left|lease|remaining)?", ql)
    if m_lease:
        plan["unit"]["lease_min_years"] = float(m_lease.group(1))
    elif "newer lease" in ql or "longer lease" in ql:
        plan["sort"] = [{"key": "remaining_lease_years", "dir": "desc"}]

    m_storey = re.search(rf"(?:above|at least|>=?)\s+{_NUM_RE}(?:st|nd|rd|th)?\s*(?:floor|storey|story)", ql)
    if m_storey:
        plan["unit"]["storey_min"] = float(m_storey.group(1))
    elif "high floor" in ql or "higher floor" in ql:
        plan["unit"]["storey_min"] = 10.0

    m_area = re.search(rf"(?:bigger than|larger than|>=?|at least)\s+{_NUM_RE}\s*(?:sqm|sq m|sq\. m)", ql)
    if m_area:
        plan["unit"]["floor_area_min_sqm"] = float(m_area.group(1))

    mrt_hit = "mrt" in ql or "train" in ql or "near the station" in ql
    if mrt_hit:
        plan["proximity"]["mrt_max_dist_m"] = 800
        plan["sort"] = [{"key": "nearest_mrt", "dir": "asc"}]

    if "highway" in ql or "expressway" in ql or " pie" in f" {ql}" or " cte" in f" {ql}":
        if "far from" in ql or "not near" in ql or "avoid" in ql:
            plan["proximity"]["highway_min_dist_m"] = 500
            plan["sort"] = [{"key": "nearest_highway", "dir": "desc"}]

    if "school" in ql:
        plan["proximity"]["school_max_dist_m"] = 800
        if "high-demand" in ql or "high demand" in ql or "popular school" in ql:
            plan["proximity"]["school_min_tier"] = "high"
    if "hawker" in ql:
        plan["proximity"]["hawker_max_dist_m"] = 800
    if "mall" in ql or "shopping" in ql:
        plan["proximity"]["mall_max_dist_m"] = 1000

    if "best deal" in ql or "value" in ql or "below model" in ql or "under model" in ql:
        plan["sort"] = [{"key": "smart_score", "dir": "desc"}]
        if "below model" in ql or "under model" in ql:
            plan["price"]["vs_model_pct_max"] = 0.0

    return plan


_PLAN_SCHEMA_HINT = """{
  "area": { "towns": ["BEDOK"], "street_contains": null },
  "price": { "min": null, "max": null, "vs_model_pct_max": null },
  "unit": {
    "flat_types": [],
    "floor_area_min_sqm": null, "floor_area_max_sqm": null,
    "storey_min": null, "storey_max": null,
    "lease_min_years": null, "lease_max_years": null
  },
  "proximity": {
    "mrt_max_dist_m": null, "highway_min_dist_m": null,
    "school_max_dist_m": null, "school_min_tier": null,
    "hawker_max_dist_m": null, "mall_max_dist_m": null
  },
  "sort": [{"key": "created_at", "dir": "desc"}],
  "limit": null
}"""

_FEW_SHOT = """Examples:

Q: "4 room under 650k in bedok close to mrt"
A: {
  "area": {"towns": ["BEDOK"], "street_contains": null},
  "price": {"min": null, "max": 650000, "vs_model_pct_max": null},
  "unit": {"flat_types": ["4 ROOM"], "floor_area_min_sqm": null, "floor_area_max_sqm": null,
           "storey_min": null, "storey_max": null, "lease_min_years": null, "lease_max_years": null},
  "proximity": {"mrt_max_dist_m": 800, "highway_min_dist_m": null,
                "school_max_dist_m": null, "school_min_tier": null,
                "hawker_max_dist_m": null, "mall_max_dist_m": null},
  "sort": [{"key": "nearest_mrt", "dir": "asc"}],
  "limit": null
}

Q: "at least 80 years lease above 10th storey"
A: {
  "area": {"towns": [], "street_contains": null},
  "price": {"min": null, "max": null, "vs_model_pct_max": null},
  "unit": {"flat_types": [], "floor_area_min_sqm": null, "floor_area_max_sqm": null,
           "storey_min": 10, "storey_max": null, "lease_min_years": 80, "lease_max_years": null},
  "proximity": {"mrt_max_dist_m": null, "highway_min_dist_m": null,
                "school_max_dist_m": null, "school_min_tier": null,
                "hawker_max_dist_m": null, "mall_max_dist_m": null},
  "sort": [{"key": "remaining_lease_years", "dir": "desc"}],
  "limit": null
}

Q: "within 500m of a high-demand school and a hawker"
A: {
  "area": {"towns": [], "street_contains": null},
  "price": {"min": null, "max": null, "vs_model_pct_max": null},
  "unit": {"flat_types": [], "floor_area_min_sqm": null, "floor_area_max_sqm": null,
           "storey_min": null, "storey_max": null, "lease_min_years": null, "lease_max_years": null},
  "proximity": {"mrt_max_dist_m": null, "highway_min_dist_m": null,
                "school_max_dist_m": 500, "school_min_tier": "high",
                "hawker_max_dist_m": 500, "mall_max_dist_m": null},
  "sort": [{"key": "nearest_school", "dir": "asc"}],
  "limit": null
}

Q: "best deal not near highway"
A: {
  "area": {"towns": [], "street_contains": null},
  "price": {"min": null, "max": null, "vs_model_pct_max": null},
  "unit": {"flat_types": [], "floor_area_min_sqm": null, "floor_area_max_sqm": null,
           "storey_min": null, "storey_max": null, "lease_min_years": null, "lease_max_years": null},
  "proximity": {"mrt_max_dist_m": null, "highway_min_dist_m": 500,
                "school_max_dist_m": null, "school_min_tier": null,
                "hawker_max_dist_m": null, "mall_max_dist_m": null},
  "sort": [{"key": "smart_score", "dir": "desc"}],
  "limit": null
}

Q: "tampines or pasir ris 5 room or executive, top 5 best deals"
A: {
  "area": {"towns": ["TAMPINES", "PASIR RIS"], "street_contains": null},
  "price": {"min": null, "max": null, "vs_model_pct_max": null},
  "unit": {"flat_types": ["5 ROOM", "EXECUTIVE"], "floor_area_min_sqm": null, "floor_area_max_sqm": null,
           "storey_min": null, "storey_max": null, "lease_min_years": null, "lease_max_years": null},
  "proximity": {"mrt_max_dist_m": null, "highway_min_dist_m": null,
                "school_max_dist_m": null, "school_min_tier": null,
                "hawker_max_dist_m": null, "mall_max_dist_m": null},
  "sort": [{"key": "smart_score", "dir": "desc"}],
  "limit": 5
}"""


def compile_nl_plan_with_ollama(user_query: str) -> tuple[dict[str, Any], str | None]:
    """
    Returns (plan_dict, error_string_or_none).

    On success returns the LLM's canonical nested plan. On any failure returns the
    keyword-based fallback plan plus the error string for UI display.
    """
    towns_str = ", ".join(TOWNS_UC)
    flat_types_str = ", ".join(FLAT_TYPES_UC)
    prompt = f"""You convert Singapore HDB shortlist search questions into a JSON filter plan.

Valid towns (uppercase, exact): {towns_str}.
Valid flat_types (uppercase, exact): {flat_types_str}.
Valid sort keys: smart_score, listing_price, predicted_price, vs_model_pct,
remaining_lease_years, floor_area_sqm, storey_mid, nearest_mrt, nearest_school,
nearest_hawker, nearest_mall, nearest_highway, created_at. dir is "asc" or "desc".

Rules:
- Always emit the full schema. Use null / [] for dimensions the user didn't mention.
- Prices in SGD dollars (650k → 650000, 1.2m → 1200000).
- "close to MRT" → proximity.mrt_max_dist_m = 800 (400–1200 range), sort nearest_mrt asc.
- "far from highway" / "not near expressway" → proximity.highway_min_dist_m = 500 (300–800 range), sort nearest_highway desc.
- "high floor" without number → unit.storey_min = 10.
- "best deal" / "value" → sort smart_score desc (add vs_model_pct_max = 0 if "below model").
- Combine filters AND sort in the same output when query implies both.
- Towns and flat_types are lists (support "bedok or tampines" and "4 or 5 room").
- "top N" / "first N" → limit = N.

{_FEW_SHOT}

Output schema (JSON only, no markdown, fill with nulls where unspecified):
{_PLAN_SCHEMA_HINT}

User question: {user_query!r}
"""

    try:
        resp = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.1},
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        text = ((data.get("message") or {}).get("content") or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        plan = json.loads(text)
        if not isinstance(plan, dict):
            raise ValueError("plan is not an object")
        return plan, None
    except requests.exceptions.ConnectionError:
        return _fallback_plan_from_keywords(user_query), "Smart parsing offline. Using basic keywords."
    except requests.exceptions.Timeout:
        return _fallback_plan_from_keywords(user_query), "Smart parsing timed out. Using basic keywords."
    except (ValueError, json.JSONDecodeError):
        return _fallback_plan_from_keywords(user_query), "Couldn't parse request — using keyword fallback. Try rewording."
    except Exception as e:
        return _fallback_plan_from_keywords(user_query), f"Smart parsing error ({type(e).__name__}). Using basic keywords."
