"""
rebuild_schools_amenity_from_moe.py
====================================
Rebuild SystemCode/data/amenities/schools.csv from the MOE raw registry that
Neo4j also uses, so the map UI and the chatbot's `nearest_famous_school`
field reference the same set of schools with the same canonical names.

Sources:
  - notebooks/01_data_layer/raw/schools/moe_general_information_of_schools_*.csv
  - notebooks/01_data_layer/raw/google_geo/moe_school_geocode_*.csv

Picks PRIMARY only (matches the persona/tier/popularity columns that are
P1-only). Drops student-care centres, U/C builds, international schools by
construction (none of those are in the MOE registry).

Output schema matches the existing schools.csv shape so the downstream
`backend.join_school_popularity` script keeps working unchanged:

    name, lat, lng, address, postal_code, type

Usage:
  SystemCode/backend/.venv/bin/python SystemCode/scripts/rebuild_schools_amenity_from_moe.py [--dry-run] [--out PATH]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW_SCHOOLS_DIR = ROOT / "SystemCode" / "notebooks" / "01_data_layer" / "raw" / "schools"
RAW_GEO_DIR = ROOT / "SystemCode" / "notebooks" / "01_data_layer" / "raw" / "google_geo"
OUT_DEFAULT = ROOT / "SystemCode" / "data" / "amenities" / "schools.csv"


def _latest(dir_: Path, glob: str) -> Path:
    matches = sorted(p for p in dir_.glob(glob) if "_backup_" not in p.name)
    if not matches:
        raise SystemExit(f"No file matching {glob} under {dir_}")
    return matches[-1]


def build_dataframe() -> tuple[pd.DataFrame, dict]:
    """Return (rebuilt schools DataFrame, summary stats dict)."""
    info_path = _latest(RAW_SCHOOLS_DIR, "moe_general_information_of_schools_*.csv")
    geo_path = _latest(RAW_GEO_DIR, "moe_school_geocode_*.csv")
    print(f"  info file : {info_path.name} ({info_path.stat().st_size//1024} KB)")
    print(f"  geo file  : {geo_path.name} ({geo_path.stat().st_size//1024} KB)")

    info = pd.read_csv(info_path)
    geo = pd.read_csv(geo_path)
    geo = geo[["school_name", "lat", "lng"]].copy()

    # Filter to PRIMARY only (matches yc_property_search.py:392 famous-school filter)
    is_primary = info["mainlevel_code"].astype(str).str.upper().str.contains("PRIMARY", na=False)
    primaries = info.loc[is_primary, ["school_name", "address", "postal_code"]].copy()

    # Inner join on school_name to attach lat/lng
    merged = primaries.merge(geo, on="school_name", how="left")
    missing_geo = merged[merged["lat"].isna() | merged["lng"].isna()]
    if len(missing_geo) > 0:
        for n in missing_geo["school_name"].tolist()[:10]:
            print(f"  WARN: no geocode for {n!r} — dropped")
    merged = merged.dropna(subset=["lat", "lng"]).reset_index(drop=True)

    # Normalise the address whitespace + zero-pad postal_code to 6 digits.
    merged["address"] = merged["address"].astype(str).str.strip()
    merged["postal_code"] = (
        merged["postal_code"].astype("Int64").astype(str).str.zfill(6).where(merged["postal_code"].notna(), other="")
    )
    merged["type"] = "PRIMARY"

    out = merged.rename(columns={"school_name": "name"})[
        ["name", "lat", "lng", "address", "postal_code", "type"]
    ].sort_values("name").reset_index(drop=True)

    summary = {
        "info_total": int(len(info)),
        "info_primary": int(is_primary.sum()),
        "missing_geo": int(len(missing_geo)),
        "out_rows": int(len(out)),
    }
    return out, summary


def diff_against_existing(new_df: pd.DataFrame, current_path: Path) -> None:
    """Print add/drop diff against the existing schools.csv."""
    if not current_path.exists():
        print(f"\nNo existing {current_path.name}; cannot diff. (Will be created on apply.)")
        return
    cur = pd.read_csv(current_path)
    new_names = set(new_df["name"].astype(str))
    cur_names = set(cur["name"].astype(str))

    added = sorted(new_names - cur_names)
    dropped = sorted(cur_names - new_names)
    kept = new_names & cur_names

    print(f"\nDiff vs current {current_path.name}:")
    print(f"  current rows : {len(cur)}")
    print(f"  new rows     : {len(new_df)}")
    print(f"  kept         : {len(kept)}")
    print(f"  added        : {len(added)}")
    print(f"  dropped      : {len(dropped)}")

    famous = [
        "POI CHING SCHOOL", "ROSYTH SCHOOL", "MAHA BODHI SCHOOL", "AI TONG SCHOOL",
        "KONG HWA SCHOOL", "HONG WEN SCHOOL", "TAO NAN SCHOOL", "RED SWASTIKA SCHOOL",
        "ST. HILDA'S PRIMARY SCHOOL", "PEI CHUN PUBLIC SCHOOL",
    ]
    famous_added = [n for n in famous if n in added]
    famous_kept = [n for n in famous if n in kept]
    print(f"  famous primaries newly added : {len(famous_added)}")
    for n in famous_added:
        print(f"    + {n}")
    if famous_kept:
        print(f"  famous primaries already there: {len(famous_kept)}")
        for n in famous_kept:
            print(f"    = {n}")

    noise_keywords = ("STUDENT CARE", "ENRICHMENT", "U/C", "AVONDALE", "JAPANESE PRIMARY")
    noise_dropped = [n for n in dropped if any(k in n.upper() for k in noise_keywords)]
    print(f"  noise rows dropped: {len(noise_dropped)}")
    for n in noise_dropped[:15]:
        print(f"    - {n}")
    if len(noise_dropped) > 15:
        print(f"    ... and {len(noise_dropped) - 15} more")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="Compute and diff but don't write the CSV.")
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT, help=f"Output path (default {OUT_DEFAULT}).")
    args = parser.parse_args()

    print(f"Repo root: {ROOT}")
    print(f"Mode     : {'DRY RUN' if args.dry_run else 'WRITE'}")
    print(f"Output   : {args.out}")
    print()

    print("Loading MOE raw...")
    new_df, summary = build_dataframe()
    print(f"  PRIMARY rows in MOE info : {summary['info_primary']}")
    print(f"  Missing geocode (dropped): {summary['missing_geo']}")
    print(f"  Output rows              : {summary['out_rows']}")

    diff_against_existing(new_df, args.out)

    if args.dry_run:
        print("\nDRY RUN — no file written.")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    new_df.to_csv(args.out, index=False)
    print(f"\nWrote {len(new_df):,} rows to {args.out}")
    print("Next: re-run `python -m backend.join_school_popularity` from SystemCode/ to refresh school_popularity_combined.csv.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
