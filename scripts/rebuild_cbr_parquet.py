#!/usr/bin/env python3
"""
Regenerate data/artifacts/hybrid_xai/cbr_training_data.parquet from the
latest hdb_feature_table_*.csv that still contains every column listed in
cbr_features.json (the BallTree feature schema is fixed by cbr_scaler.joblib,
so we cannot use a CSV that has dropped any of those features).

Output schema (consumed by backend/cbr.py):
  BallTree features  : as listed in cbr_features.json
  Identity / display : resale_price, transaction_year, address_key,
                       town, flat_type, block, street_name,
                       remaining_lease_years, month, storey_mid

Run:  python scripts/rebuild_cbr_parquet.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
FEATURE_DIR = REPO_ROOT / "data" / "feature_data" / "02_feature_layer" / "training" / "outputs"
ARTIFACTS_DIR = REPO_ROOT / "data" / "artifacts" / "hybrid_xai"
PARQUET_PATH = ARTIFACTS_DIR / "cbr_training_data.parquet"
CBR_FEATURES_PATH = ARTIFACTS_DIR / "cbr_features.json"


def pick_source_csv(required_cols: list[str]) -> Path:
    """Latest CSV by filename (sorted descending) that has every required column."""
    candidates = sorted(FEATURE_DIR.glob("hdb_feature_table_*.csv"), reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No hdb_feature_table_*.csv under {FEATURE_DIR}")
    for path in candidates:
        cols = pd.read_csv(path, nrows=0).columns.tolist()
        missing = [c for c in required_cols if c not in cols]
        if not missing:
            return path
        print(f"  skip {path.name}: missing {missing}", file=sys.stderr)
    raise RuntimeError(
        f"No CSV under {FEATURE_DIR} has all CBR columns: {required_cols}"
    )


def main() -> None:
    cbr_feature_cols: list[str] = json.loads(CBR_FEATURES_PATH.read_text())
    base_cols = ["resale_price", "transaction_year", "address_key"]
    required = base_cols + cbr_feature_cols

    src = pick_source_csv(required)
    print(f"Source CSV: {src.name}")

    src_cols = pd.read_csv(src, nrows=0).columns.tolist()
    town_oh = [c for c in src_cols if c.startswith("town_")]
    flat_oh = [c for c in src_cols if c.startswith("flat_type_")]
    if not town_oh or not flat_oh:
        raise RuntimeError(f"{src.name} is missing town_* / flat_type_* one-hots")

    df = pd.read_csv(src, usecols=required + town_oh + flat_oh)

    # Recover town and flat_type from the one-hots (idxmax works because each
    # row sets exactly one of these columns to 1).
    df["town"] = df[town_oh].idxmax(axis=1).str.replace("town_", "", regex=False)
    df["flat_type"] = df[flat_oh].idxmax(axis=1).str.replace("flat_type_", "", regex=False)

    # Split address_key (e.g. "174 ANG MO KIO AVE 4") into block + street.
    addr = df["address_key"].astype(str).str.split(n=1, expand=True)
    df["block"] = addr[0].fillna("")
    df["street_name"] = addr[1].fillna("")

    # Alias under the name backend/cbr.py reads for the response field.
    df["remaining_lease_years"] = df["lease_remaining_years"]

    # Feature table doesn't carry sale-month or storey_mid; cbr.py falls back
    # to year-only and to level_mid respectively, but we keep the columns so
    # row.get(...) doesn't raise.
    df["month"] = pd.NA
    df["storey_mid"] = pd.NA

    keep = (
        cbr_feature_cols
        + base_cols
        + [
            "town", "flat_type", "block", "street_name",
            "remaining_lease_years", "month", "storey_mid",
        ]
    )
    out = df[keep].copy()

    PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(PARQUET_PATH, index=False)

    yc = out["transaction_year"]
    print(f"Wrote: {PARQUET_PATH.relative_to(REPO_ROOT)}")
    print(f"  rows         : {len(out):,}")
    print(f"  cols         : {len(out.columns)}  → {list(out.columns)}")
    print(f"  year range   : {int(yc.min())}–{int(yc.max())}")
    print(f"  rows ≥ 2024  : {(yc >= 2024).sum():,}")
    print(f"  towns        : {out['town'].nunique()}")
    print(f"  flat types   : {out['flat_type'].nunique()}")


if __name__ == "__main__":
    main()
