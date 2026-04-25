from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


DEFAULT_SCHOOLS_CSV = Path("data/amenities/schools.csv")
DEFAULT_POPULARITY_CSV = Path("data/amenities/school_popularity.csv")
DEFAULT_ALIASES_CSV = Path("data/amenities/school_popularity_aliases.csv")
DEFAULT_OUTPUT_CSV = Path("data/amenities/school_popularity_combined.csv")


def _require_columns(df: pd.DataFrame, required: set[str], *, label: str) -> None:
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"{label} missing columns: {sorted(missing)}")


def _read_csv(path: Path, *, label: str) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"{label} not found: {path}")
    return pd.read_csv(path)


def build_school_popularity_combined(
    schools_csv: Path,
    popularity_csv: Path,
    aliases_csv: Path,
) -> tuple[pd.DataFrame, dict[str, object]]:
    schools = _read_csv(schools_csv, label="schools_csv")
    popularity = _read_csv(popularity_csv, label="popularity_csv")
    aliases = _read_csv(aliases_csv, label="aliases_csv")

    _require_columns(
        schools, {"name", "lat", "lng", "address", "postal_code", "type"}, label="schools_csv"
    )
    _require_columns(popularity, {"school", "mean_oversubscription", "num_years", "tier"}, label="popularity_csv")
    _require_columns(aliases, {"popularity_school", "schools_name"}, label="aliases_csv")

    if popularity["school"].astype(str).duplicated().any():
        dup = popularity.loc[popularity["school"].astype(str).duplicated(), "school"].astype(str).unique().tolist()
        raise ValueError(
            "popularity_csv.school must be unique; duplicates found: " + ", ".join(map(str, dup[:25]))
            + (" ..." if len(dup) > 25 else "")
        )

    aliases = aliases.copy()
    aliases["popularity_school"] = aliases["popularity_school"].astype(str).str.strip()
    aliases["schools_name"] = aliases["schools_name"].astype(str).str.strip()
    if "notes" in aliases.columns:
        aliases["notes"] = aliases["notes"].astype(str).str.strip()

    # Drop empty mapping rows (common when keeping a template in version control).
    aliases = aliases[(aliases["popularity_school"] != "") & (aliases["schools_name"] != "")]

    popularity_schools = set(popularity["school"].astype(str))
    schools_names = set(schools["name"].astype(str))

    unknown_popularity = sorted(set(aliases["popularity_school"]) - popularity_schools)
    unknown_schools = sorted(set(aliases["schools_name"]) - schools_names)
    if unknown_popularity:
        raise ValueError(
            "aliases_csv has popularity_school values not found in popularity_csv.school: "
            + ", ".join(unknown_popularity[:25])
            + (" ..." if len(unknown_popularity) > 25 else "")
        )
    if unknown_schools:
        raise ValueError(
            "aliases_csv has schools_name values not found in schools_csv.name: "
            + ", ".join(unknown_schools[:25])
            + (" ..." if len(unknown_schools) > 25 else "")
        )

    dup_pop = aliases["popularity_school"][aliases["popularity_school"].duplicated()].unique().tolist()
    if dup_pop:
        raise ValueError(
            "aliases_csv has duplicate popularity_school (must be unique): " + ", ".join(map(str, dup_pop))
        )

    dup_school_name = aliases["schools_name"][aliases["schools_name"].duplicated()].unique().tolist()
    if dup_school_name:
        raise ValueError(
            "aliases_csv maps multiple popularity_school rows to the same schools_name (ambiguous): "
            + ", ".join(map(str, dup_school_name))
        )

    popularity_join = aliases.merge(
        popularity,
        left_on="popularity_school",
        right_on="school",
        how="left",
        validate="one_to_one",
    ).drop(columns=["school"])

    combined = schools.merge(
        popularity_join[["schools_name", "popularity_school", "mean_oversubscription", "num_years", "tier"]],
        left_on="name",
        right_on="schools_name",
        how="left",
        validate="many_to_one",
    ).drop(columns=["schools_name"])

    if len(combined) != len(schools):
        raise RuntimeError(
            f"Left-join invariant failed: combined rows {len(combined)} != schools rows {len(schools)}"
        )

    # Simple reporting to help extend the alias map.
    total_rows = int(len(combined))
    matched_rows = int(combined["tier"].notna().sum())
    popularity_unmapped = sorted(popularity_schools - set(aliases["popularity_school"]))

    primary_mask = combined["type"].astype(str).str.upper().eq("PRIMARY")
    primary_total = int(primary_mask.sum())
    primary_matched = int(combined.loc[primary_mask, "tier"].notna().sum())

    report = {
        "total_rows": total_rows,
        "matched_rows": matched_rows,
        "primary_total": primary_total,
        "primary_matched": primary_matched,
        "popularity_unmapped": popularity_unmapped,
    }
    return combined, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Join schools.csv with school_popularity.csv via explicit alias mapping.")
    parser.add_argument("--schools", type=Path, default=DEFAULT_SCHOOLS_CSV)
    parser.add_argument("--popularity", type=Path, default=DEFAULT_POPULARITY_CSV)
    parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES_CSV)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_CSV)
    args = parser.parse_args()

    combined, report = build_school_popularity_combined(
        schools_csv=args.schools,
        popularity_csv=args.popularity,
        aliases_csv=args.aliases,
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(args.output, index=False)

    print(f"Wrote combined schools+popularity → {args.output}")
    print(f"Matched rows: {report['matched_rows']:,} / {report['total_rows']:,}")
    print(f"Matched PRIMARY rows: {report['primary_matched']:,} / {report['primary_total']:,}")
    if report["popularity_unmapped"]:
        print("\nPopularity schools not yet mapped (top 50):")
        for s in report["popularity_unmapped"][:50]:
            print(f"  - {s}")


if __name__ == "__main__":
    main()

