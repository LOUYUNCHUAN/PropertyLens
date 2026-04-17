"""
location.py — /api/geocode and /api/nearby endpoints.

Geocode proxies to OneMap Search API (free, no key required).
Nearby loads precomputed amenity CSVs and filters by haversine distance.
"""

import copy
import math
from pathlib import Path
from typing import Any

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
        ("mall", "malls.csv"),
        ("highway", "highways.csv"),
    ]:
        path = AMENITIES_DIR / filename
        if path.exists():
            df = pd.read_csv(path)
            df = df.dropna(subset=["lat", "lng"])
            _amenity_frames[category] = df
            print(f"  Amenities loaded: {category} ({len(df)} records)")
        else:
            print(f"  ⚠️ Amenity file missing: {path}")

    school_path = AMENITIES_DIR / "school_popularity_combined.csv"
    if not school_path.exists():
        school_path = AMENITIES_DIR / "schools.csv"
    if school_path.exists():
        df = pd.read_csv(school_path)
        df = df.dropna(subset=["lat", "lng"])
        _amenity_frames["school"] = df
        print(f"  Amenities loaded: school ({len(df)} records) from {school_path.name}")
    else:
        print(f"  ⚠️ Amenity file missing: {AMENITIES_DIR / 'schools.csv'}")


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def nearest_highway_dist_m(lat: float, lng: float) -> float | None:
    """
    Minimum distance (m) from a point to any sampled highway/major-road point.
    Highways are not included in compute_nearby() POI lists (too dense for map pins).
    """
    _load_amenities()
    df = _amenity_frames.get("highway")
    if df is None or len(df) == 0:
        return None
    best = float("inf")
    for _, row in df.iterrows():
        d = _haversine_m(lat, lng, float(row["lat"]), float(row["lng"]))
        if d < best:
            best = d
    if best == float("inf"):
        return None
    return round(best)


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
        # Highway samples are dense; use nearest_highway_dist_m instead of map pins.
        if category == "highway":
            continue
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
                if category == "school" and "tier" in df.columns and pd.notna(row.get("tier")):
                    t = str(row["tier"]).strip()
                    if t:
                        item["tier"] = t.lower()
                if category == "school" and "mean_oversubscription" in df.columns and pd.notna(
                    row.get("mean_oversubscription")
                ):
                    try:
                        item["mean_oversubscription"] = float(row["mean_oversubscription"])
                    except (TypeError, ValueError):
                        pass
                items.append(item)
        items.sort(key=lambda x: x["dist_m"])
        result[category] = items

    return result


def _norm_school_name(name: str) -> str:
    return " ".join(str(name).strip().lower().split())


def _school_csv_row_for_poi(df: pd.DataFrame, lat: float, lng: float, name: str) -> pd.Series | None:
    """Match a saved POI to the canonical school row (name + nearby coordinates)."""
    nn = _norm_school_name(name)
    if not nn:
        return None
    best_row: pd.Series | None = None
    best_d = float("inf")
    for _, row in df.iterrows():
        if _norm_school_name(str(row.get("name", ""))) != nn:
            continue
        d = _haversine_m(lat, lng, float(row["lat"]), float(row["lng"]))
        if d < best_d:
            best_d = d
            best_row = row
    if best_row is not None and best_d <= 300:
        return best_row
    return None


def enrich_map_snapshot_json(map_snap: dict[str, Any] | None) -> dict[str, Any] | None:
    """
    Merge tier / mean_oversubscription from the current school CSV into saved nearby.school POIs.

    Wishlist rows store frozen map_snapshot_json; re-read enrichment keeps shortlist maps aligned
    with data/amenities/school_popularity_combined.csv without DB migrations.
    """
    if not map_snap or not isinstance(map_snap, dict):
        return map_snap
    out = copy.deepcopy(map_snap)
    nearby = out.get("nearby")
    if not isinstance(nearby, dict):
        return out
    schools = nearby.get("school")
    if not isinstance(schools, list) or not schools:
        return out
    _load_amenities()
    df = _amenity_frames.get("school")
    if df is None or len(df) == 0:
        return out
    for item in schools:
        if not isinstance(item, dict):
            continue
        try:
            lat = float(item["lat"])
            lng = float(item["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        row = _school_csv_row_for_poi(df, lat, lng, str(item.get("name", "")))
        if row is None:
            continue
        if "tier" in df.columns and pd.notna(row.get("tier")):
            t = str(row["tier"]).strip()
            if t:
                item["tier"] = t.lower()
        if "mean_oversubscription" in df.columns and pd.notna(row.get("mean_oversubscription")):
            try:
                item["mean_oversubscription"] = float(row["mean_oversubscription"])
            except (TypeError, ValueError):
                pass
    return out


@router.get("/nearby")
def nearby(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_m: float = Query(default=2000, ge=100, le=10000),
):
    return compute_nearby(lat, lng, radius_m)
