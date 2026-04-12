"""
location.py — /api/geocode and /api/nearby endpoints.

Geocode proxies to OneMap Search API (free, no key required).
Nearby loads precomputed amenity CSVs and filters by haversine distance.
"""

import math
from pathlib import Path

import pandas as pd
import requests
from fastapi import APIRouter, Query

router = APIRouter()

ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"

_geocode_cache: dict[str, dict] = {}

REPO_ROOT = Path(__file__).parent.parent
AMENITIES_DIR = REPO_ROOT / "data" / "amenities"

_amenity_frames: dict[str, pd.DataFrame] = {}


def _load_amenities():
    """Load amenity CSVs into memory (called once at import or first request)."""
    if _amenity_frames:
        return
    for category, filename in [
        ("mrt", "mrt_stations.csv"),
        ("hawker", "hawker_centres.csv"),
        ("school", "schools.csv"),
        ("mall", "malls.csv"),
    ]:
        path = AMENITIES_DIR / filename
        if path.exists():
            df = pd.read_csv(path)
            df = df.dropna(subset=["lat", "lng"])
            _amenity_frames[category] = df
            print(f"  Amenities loaded: {category} ({len(df)} records)")
        else:
            print(f"  ⚠️ Amenity file missing: {path}")


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/geocode")
def geocode(q: str = Query(..., min_length=2, description="Block + street name, e.g. '18C LOR LEW LIAN'")):
    q_key = q.strip().upper()
    if q_key in _geocode_cache:
        return _geocode_cache[q_key]

    try:
        resp = requests.get(
            ONEMAP_SEARCH_URL,
            params={"searchVal": q, "returnGeom": "Y", "getAddrDetails": "Y", "pageNum": 1},
            timeout=8,
        )
        data = resp.json()
        results = data.get("results", [])
    except Exception:
        results = []

    if not results:
        result = {"found": False, "lat": None, "lng": None, "address": None, "postal_code": None}
        _geocode_cache[q_key] = result
        return result

    best = results[0]
    result = {
        "found": True,
        "lat": float(best.get("LATITUDE", 0)),
        "lng": float(best.get("LONGITUDE", 0)),
        "address": best.get("ADDRESS", "").strip(),
        "postal_code": best.get("POSTAL", "").strip(),
    }
    _geocode_cache[q_key] = result
    return result


def compute_nearby(lat: float, lng: float, radius_m: float = 2000.0) -> dict[str, list]:
    """Core nearby logic — used by /api/nearby and wishlist snapshot."""
    _load_amenities()

    result: dict[str, list] = {}
    for category, df in _amenity_frames.items():
        items = []
        for _, row in df.iterrows():
            dist = _haversine_m(lat, lng, float(row["lat"]), float(row["lng"]))
            if dist <= radius_m:
                item = {
                    "name": str(row["name"]),
                    "lat": float(row["lat"]),
                    "lng": float(row["lng"]),
                    "dist_m": round(dist),
                }
                if "address" in row and pd.notna(row.get("address")):
                    item["address"] = str(row["address"])
                if "type" in row and pd.notna(row.get("type")):
                    item["type"] = str(row["type"])
                items.append(item)
        items.sort(key=lambda x: x["dist_m"])
        result[category] = items

    return result


@router.get("/nearby")
def nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(default=2000, ge=100, le=10000),
):
    return compute_nearby(lat, lng, radius_m)
