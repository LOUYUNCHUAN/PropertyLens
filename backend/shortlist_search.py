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

from backend.location import nearest_highway_dist_m
from backend.shortlist_plan_apply import TOWNS_UC
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
        description="If set, overrides compiled plan mrt_max_dist_m (meters).",
    )
    highway_min_dist_m: int | None = Field(
        default=None,
        ge=0,
        le=8000,
        description="If set, overrides compiled plan highway_min_dist_m (meters).",
    )


class NLSearchResponse(BaseModel):
    filters_applied: dict[str, Any]
    sorted_ids: list[int]
    row_notes: list[dict[str, Any]] = Field(default_factory=list)
    ollama_error: str | None = None


def _nearest_mrt_m(map_snap: dict[str, Any] | None) -> float | None:
    if not map_snap:
        return None
    nearby = map_snap.get("nearby") or {}
    mrt = nearby.get("mrt") or []
    if not mrt:
        return None
    return min(float(x.get("dist_m") or 1e12) for x in mrt)


def _nearest_highway_m(map_snap: dict[str, Any] | None) -> float | None:
    if not map_snap:
        return None
    nh = map_snap.get("nearest_highway_dist_m")
    if nh is not None:
        return float(nh)
    g = map_snap.get("geocode") or {}
    if g.get("found") and g.get("lat") is not None and g.get("lng") is not None:
        d = nearest_highway_dist_m(float(g["lat"]), float(g["lng"]))
        return float(d) if d is not None else None
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
    return {
        "id": row_dict["id"],
        "town": town,
        "street": street,
        "address": addr,
        "nearest_mrt_m": _nearest_mrt_m(ms),
        "nearest_highway_m": _nearest_highway_m(ms),
        "smart_score": smart,
        "created_ts": row_dict.get("created_at"),
    }


def _fallback_plan_from_keywords(q: str) -> dict[str, Any]:
    """Cheap fallback when Ollama is down — substring heuristics."""
    ql = q.lower()
    plan: dict[str, Any] = {
        "area": {},
        "constraints": {},
        "sort": "created_at_desc",
    }
    for t in TOWNS_UC:
        if t.lower() in ql or t.lower().replace("/", " ") in ql:
            plan["area"]["town"] = t
            break
    if "bedok north" in ql:
        plan["area"]["street_contains"] = "BEDOK NORTH"
    if "mrt" in ql or "train" in ql:
        plan["constraints"]["mrt_max_dist_m"] = 800
        plan["sort"] = "nearest_mrt_asc"
    if "highway" in ql or "expressway" in ql or "pie" in ql or "cte" in ql:
        plan["constraints"]["highway_min_dist_m"] = 400
        plan["sort"] = "nearest_highway_desc"
    return plan


def compile_nl_plan_with_ollama(user_query: str) -> tuple[dict[str, Any], str | None]:
    """
    Returns (plan_dict, error_string_or_none).
    Plan schema:
      area: { town?: str, street_contains?: str }
      constraints: { mrt_max_dist_m?: number, highway_min_dist_m?: number }
      sort: nearest_mrt_asc | nearest_highway_desc | smart_score_desc | created_at_desc
    """
    schema_hint = """{
  "area": { "town": "BEDOK or null", "street_contains": "substring for STREET_NAME/address or null" },
  "constraints": {
    "mrt_max_dist_m": 800,
    "highway_min_dist_m": 400
  },
  "sort": "nearest_mrt_asc"
}
Only output valid JSON, no markdown."""
    prompt = f"""You convert Singapore HDB shortlist search questions into a JSON filter plan.

Towns must be one of these uppercase names when applicable: {", ".join(TOWNS_UC[:15])} ... (use exact HDB town names).

Rules:
- "near Bedok" / Bedok area => area.town = "BEDOK"
- "Bedok North" => area.town = "BEDOK", area.street_contains = "BEDOK NORTH"
- "close to MRT" => constraints.mrt_max_dist_m between 400 and 1200 (pick 800 if unspecified), sort nearest_mrt_asc
- "far from highway/expressway" => constraints.highway_min_dist_m between 300 and 800 (pick 500 if unspecified), sort nearest_highway_desc
- If user asks best deal / value => sort smart_score_desc
- If unclear => sort created_at_desc and minimal constraints

User question: {user_query!r}

{schema_hint}"""

    err: str | None = None
    try:
        resp = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1},
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        text = (data.get("message") or {}).get("content") or ""
        text = text.strip()
        # strip markdown fences if any
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        plan = json.loads(text)
        if not isinstance(plan, dict):
            raise ValueError("plan is not an object")
        return plan, None
    except Exception as e:
        err = str(e)
        return _fallback_plan_from_keywords(user_query), err
