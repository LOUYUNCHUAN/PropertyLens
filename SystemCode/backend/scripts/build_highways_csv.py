#!/usr/bin/env python3
"""
Build data/amenities/highways.csv from sampled waypoints along major Singapore roads.

Source approach (documented): full fidelity would use OpenStreetMap Overpass API
(motorway, trunk, primary) clipped to Singapore bounds, then simplify and sample.
This script ships a **representative** set of linearly interpolated points so
nearest-highway distance is meaningful without a network fetch at build time.

Regenerate:
  python backend/scripts/build_highways_csv.py
"""

from __future__ import annotations

import csv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "data" / "amenities" / "highways.csv"


def _interp(a: tuple[float, float], b: tuple[float, float], n: int) -> list[tuple[float, float]]:
    if n < 2:
        return [a]
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def build_rows() -> list[dict[str, str]]:
    """(name, type) segments as (start_lat, start_lng) -> (end_lat, end_lng)."""
    segments: list[tuple[str, str, tuple[float, float], tuple[float, float], int]] = [
        # East–west / radial expressways (approximate anchors)
        ("PIE", "expressway", (1.348, 103.742), (1.332, 103.965), 45),
        ("AYE", "expressway", (1.27, 103.78), (1.29, 103.87), 35),
        ("CTE", "expressway", (1.30, 103.84), (1.42, 103.82), 30),
        ("BKE", "expressway", (1.45, 103.76), (1.43, 103.79), 20),
        ("KJE", "expressway", (1.34, 103.69), (1.32, 103.74), 25),
        ("SLE", "expressway", (1.42, 103.78), (1.40, 103.87), 25),
        ("TPE", "expressway", (1.37, 103.90), (1.36, 103.98), 30),
        ("KPE", "expressway", (1.31, 103.87), (1.35, 103.90), 25),
        ("ECP", "expressway", (1.29, 103.87), (1.31, 103.95), 25),
        ("MCE", "expressway", (1.28, 103.85), (1.29, 103.87), 15),
        # Major arterials (primary/trunk proxies)
        ("Bukit Timah Rd", "primary", (1.32, 103.78), (1.34, 103.76), 20),
        ("Upper Serangoon Rd", "primary", (1.35, 103.87), (1.37, 103.90), 18),
        ("Bedok North Ave 1 corridor", "primary", (1.33, 103.92), (1.34, 103.94), 15),
    ]

    rows: list[dict[str, str]] = []
    for name, rtype, start, end, n in segments:
        for i, (lat, lng) in enumerate(_interp(start, end, n)):
            rows.append(
                {
                    "name": f"{name}",
                    "lat": f"{lat:.6f}",
                    "lng": f"{lng:.6f}",
                    "type": rtype,
                }
            )
    return rows


def main() -> None:
    rows = build_rows()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["name", "lat", "lng", "type"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} highway sample points → {OUT}")


if __name__ == "__main__":
    main()
