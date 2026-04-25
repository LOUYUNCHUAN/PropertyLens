"""Refresh data/amenities/malls.csv with a curated list of Singapore malls.

Cosmetic-only refresh (Option A from the amenities verification).
Does NOT touch the feature pipeline or retrain the model — the live
buyer/seller map will show real malls but model features are unchanged.

Usage:
    python scripts/refresh_malls.py
"""
from __future__ import annotations

import csv
import sys
import time
from pathlib import Path

import requests

ONEMAP_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "amenities" / "malls.csv"

# Curated list of operational Singapore shopping malls (~150).
# Sourced from Wikipedia "List of shopping malls in Singapore" (2026)
# and cross-checked against major mall operators (CapitaLand, Frasers,
# Lendlease, Far East). Closed/demolished malls (Big Box, Liang Court,
# original Funan before reopening) are excluded. JCube is excluded as
# it closed Aug 2023 for redevelopment.
MALLS: list[str] = [
    # Orchard belt
    "ION Orchard",
    "Ngee Ann City",
    "Takashimaya Singapore",
    "Paragon Singapore",
    "313@Somerset",
    "Wisma Atria",
    "Tang Plaza",
    "Mandarin Gallery",
    "Plaza Singapura",
    "Orchard Central",
    "Orchard Gateway",
    "Lucky Plaza",
    "Far East Plaza",
    "Wheelock Place",
    "Forum The Shopping Mall",
    "Shaw House Orchard",
    "The Centrepoint",
    "Knightsbridge Orchard",
    "The Heeren",
    "Palais Renaissance",
    "Delfi Orchard",
    "Liat Towers",
    "Tanglin Mall",
    "Tanglin Shopping Centre",
    "Cathay Cineleisure Orchard",
    # Marina Bay / CBD / Bugis
    "Marina Bay Sands Shoppes",
    "Marina Square",
    "Suntec City Mall",
    "Raffles City Shopping Centre",
    "Funan Singapore",
    "Millenia Walk",
    "CityLink Mall",
    "Capitol Singapore",
    "Bugis Junction",
    "Bugis+",
    "Sim Lim Square",
    "Sim Lim Tower",
    "100 AM Mall",
    "Tanjong Pagar Centre",
    "Icon Village",
    # HarbourFront / Tiong Bahru / Alexandra
    "VivoCity",
    "HarbourFront Centre",
    "Tiong Bahru Plaza",
    "Great World City",
    "Valley Point Shopping Centre",
    "Anchorpoint Shopping Centre",
    "Alexandra Retail Centre",
    "Queensway Shopping Centre",
    "IKEA Alexandra",
    # East
    "Parkway Parade",
    "Katong V",
    "i12 Katong",
    "Kallang Wave Mall",
    "Leisure Park Kallang",
    "City Plaza Singapore",
    "Tampines Mall",
    "Tampines 1",
    "Century Square",
    "Our Tampines Hub",
    "Eastpoint Mall",
    "Bedok Mall",
    "Djitsun Mall Bedok",
    "Changi City Point",
    "Jewel Changi Airport",
    "Downtown East",
    "White Sands",
    "Loyang Point",
    # North-East
    "NEX Serangoon",
    "Hougang Mall",
    "Heartland Mall Kovan",
    "Hougang 1",
    "Hougang Green Shopping Mall",
    "myVillage at Serangoon Garden",
    "Compass One",
    "Sengkang Grand Mall",
    "Waterway Point",
    "Punggol Plaza",
    "Punggol Coast Mall",
    "Northshore Plaza",
    "Oasis Terraces Punggol",
    # North
    "AMK Hub",
    "Junction 8 Bishan",
    "Bishan North Shopping Mall",
    "Thomson Plaza",
    "Djitsun Mall Ang Mo Kio",
    "Broadway Plaza Ang Mo Kio",
    "Toa Payoh HDB Hub",
    "Toa Payoh Central",
    # North-West
    "Causeway Point",
    "Northpoint City",
    "Sembawang Shopping Centre",
    "Sun Plaza Sembawang",
    "Vista Point Sembawang",
    "Wisteria Mall",
    "Junction Nine Yishun",
    "Canberra Plaza",
    "Marsiling Mall",
    # West
    "JEM Jurong",
    "Westgate Singapore",
    "IMM Building",
    "Jurong Point",
    "Pioneer Mall",
    "Gek Poh Shopping Centre",
    "Boon Lay Shopping Centre",
    "Taman Jurong Shopping Centre",
    "West Mall Bukit Batok",
    "Lot One Shoppers Mall",
    "Hillion Mall",
    "Bukit Panjang Plaza",
    "Junction 10 Choa Chu Kang",
    "Greenwich V",
    "The Rail Mall",
    # Central-West
    "HillV2",
    "Beauty World Centre",
    "Beauty World Plaza",
    "Bukit Timah Plaza",
    "Sixth Avenue Centre",
    "Cluny Court",
    "The Star Vista",
    "Rochester Mall",
    "Holland Road Shopping Centre",
    # Other / pockets
    "Aperia Mall",
    "City Square Mall",
    "MacPherson Mall",
    "United Square",
    "Velocity @ Novena Square",
    "Square 2",
    "Goldhill Plaza",
    "Balestier Plaza",
    "Shaw Plaza Balestier",
    "Zhongshan Mall",
    "The Poiz Centre",
    "The Venue Shoppes",
    "The Clementi Mall",
    "321 Clementi",
    "Rivervale Mall",
    "Rivervale Plaza",
    "Buangkok Square",
    "Kang Kar Mall",
    "Kensington Square",
    "PLQ Mall",
    "Singpost Centre",
    "KINEX Singapore",
    "Paya Lebar Square",
    "One KM Mall",
    "Joo Chiat Complex",
    "Tekka Centre",
    "Mustafa Centre",
    "Albert Mall",
    "Burlington Square",
    "Holiday Inn Atrium Mall",
    "Concorde Hotel and Shopping Mall",
    "Forum The Shopping Mall Orchard",
    "Tan Boon Liat Building",
]


def geocode_one(query: str, session: requests.Session) -> dict | None:
    try:
        resp = session.get(
            ONEMAP_URL,
            params={
                "searchVal": query,
                "returnGeom": "Y",
                "getAddrDetails": "Y",
                "pageNum": 1,
            },
            timeout=10,
        )
        data = resp.json()
        results = data.get("results", [])
        if not results:
            return None
        best = results[0]
        return {
            "name": query.upper(),
            "lat": float(best.get("LATITUDE", 0)),
            "lng": float(best.get("LONGITUDE", 0)),
            "address": (best.get("ADDRESS") or "").strip(),
        }
    except Exception as exc:  # noqa: BLE001
        print(f"  ! error geocoding {query!r}: {exc}", file=sys.stderr)
        return None


def main() -> int:
    print(f"Geocoding {len(MALLS)} malls via OneMap…")
    session = requests.Session()
    rows: list[dict] = []
    seen_keys: set[tuple[float, float]] = set()
    misses: list[str] = []

    for i, name in enumerate(MALLS, 1):
        row = geocode_one(name, session)
        if row is None:
            misses.append(name)
            print(f"  [{i:3d}/{len(MALLS)}] MISS {name}")
        else:
            key = (round(row["lat"], 5), round(row["lng"], 5))
            if key in seen_keys:
                print(f"  [{i:3d}/{len(MALLS)}] dup  {name}")
            else:
                seen_keys.add(key)
                rows.append(row)
                print(f"  [{i:3d}/{len(MALLS)}] ok   {name}")
        time.sleep(0.15)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["name", "lat", "lng", "address"])
        writer.writeheader()
        writer.writerows(rows)

    print()
    print(f"Wrote {len(rows)} unique malls -> {OUT_PATH}")
    if misses:
        print(f"\n{len(misses)} not found via OneMap:")
        for m in misses:
            print(f"  - {m}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
