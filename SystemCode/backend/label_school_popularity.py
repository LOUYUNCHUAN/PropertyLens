"""
Label Singapore primary schools as high / medium / low by popularity.

Popularity signal: Phase 2C oversubscription ratio from P1 registration data
(sgschooling_2015plus_20260412.csv), averaged across a recent year window.

Ported from notebooks/05_chatbot/v2/04_propertylens_build_index_v51.ipynb —
the parsing + oversubscription math are identical, the tier function is
collapsed from 4 tiers (very_high/high/medium/low) to 3 (high/medium/low).
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


DEFAULT_INPUT  = Path("data/amenities/sgschooling_2015plus_20260412.csv")
DEFAULT_OUTPUT = Path("data/amenities/school_popularity.csv")
DEFAULT_YEAR_START = 2020
DEFAULT_YEAR_END   = 2025


def _parse_school_flat_rows(df: pd.DataFrame) -> pd.DataFrame:
    """One row per school-year from the flat-format rows (table_index == 1)."""
    flat = df[df["table_index"] == 1].copy()
    flat = flat[flat["school"].notna()]
    flat = flat[~flat["school"].astype(str).str.startswith("↳")]

    def _to_float(col: pd.Series) -> pd.Series:
        return pd.to_numeric(col, errors="coerce")

    out = pd.DataFrame()
    out["school"]        = flat["school"].astype(str).str.strip()
    out["year"]          = pd.to_numeric(flat["year_int"], errors="coerce")
    out["phase_1"]       = _to_float(flat["phase_1"])
    out["phase_2a"]      = _to_float(flat["2a"]).fillna(
                              _to_float(flat.get("2a(1)", pd.Series(dtype=float)))
                          )
    out["phase_2b"]      = _to_float(flat["2b"])
    out["phase_2c"]      = _to_float(flat["2c"])
    out["phase_2cs"]     = _to_float(flat["2c(s)"])
    out["total_vacancy"] = _to_float(flat["total_vacancy"])
    return out.dropna(subset=["school", "year"]).reset_index(drop=True)


def _compute_oversubscription(df: pd.DataFrame) -> pd.DataFrame:
    """
    Phase columns are cumulative totals by end of each phase.
        2C_applied   = phase_2c - phase_2b
        2C_remaining = total_vacancy - phase_2b
        ratio        = applied / remaining
    Ratio > 1 means more kids applied at 2C than spots left — oversubscribed.
    """
    df = df.copy()
    phase_2b_cum = df["phase_2b"].fillna(0)
    phase_2c_cum = df["phase_2c"].fillna(0)

    applied_at_2c   = (phase_2c_cum - phase_2b_cum).clip(lower=0)
    remaining_at_2c = (df["total_vacancy"] - phase_2b_cum).clip(lower=1)

    df["oversubscription_ratio"] = applied_at_2c / remaining_at_2c
    return df


def _quality_tier_3(score: float) -> str:
    if score >= 1.0:
        return "high"
    if score >= 0.5:
        return "medium"
    return "low"


def build_school_popularity(
    csv_path: Path,
    year_range: tuple[int, int] = (DEFAULT_YEAR_START, DEFAULT_YEAR_END),
) -> pd.DataFrame:
    """Return a DataFrame sorted by mean_oversubscription desc."""
    raw = pd.read_csv(csv_path, low_memory=False)
    flat = _parse_school_flat_rows(raw)
    flat = flat[(flat["year"] >= year_range[0]) & (flat["year"] <= year_range[1])]
    if flat.empty:
        raise ValueError(
            f"No flat-format rows in year range {year_range} for {csv_path}"
        )

    scored = _compute_oversubscription(flat)
    summary = (
        scored.groupby("school")
        .agg(
            mean_oversubscription=("oversubscription_ratio", "mean"),
            num_years=("year", "nunique"),
        )
        .reset_index()
    )
    summary["tier"] = summary["mean_oversubscription"].apply(_quality_tier_3)
    summary = summary.sort_values(
        "mean_oversubscription", ascending=False, kind="mergesort"
    ).reset_index(drop=True)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input",  type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--year-start", type=int, default=DEFAULT_YEAR_START)
    parser.add_argument("--year-end",   type=int, default=DEFAULT_YEAR_END)
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input CSV not found: {args.input}")

    summary = build_school_popularity(
        args.input, year_range=(args.year_start, args.year_end)
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    summary.to_csv(args.output, index=False)

    tier_counts = summary["tier"].value_counts().to_dict()
    print(f"Wrote {len(summary):,} schools → {args.output}")
    print(f"Year range  : {args.year_start}–{args.year_end}")
    print(f"Tier counts : {tier_counts}")
    print("\nTop 10 most competitive schools:")
    for _, row in summary.head(10).iterrows():
        print(
            f"  {row['school']:<40s} "
            f"score={row['mean_oversubscription']:.3f}  "
            f"years={int(row['num_years'])}  "
            f"tier={row['tier']}"
        )


if __name__ == "__main__":
    main()
