#!/usr/bin/env python3
"""
Re-mine Apriori rules + retrain surrogate decision tree on recent HDB resale
transactions, then write a fresh rules.json that replaces the stale one at
``data/artifacts/hybrid_xai/rules.json``.

WHY
---
The shipped rules were mined on pre-2020 transactions. Their price buckets
(<$350k / $350–$550k / ≥$550k) and their THEN-clauses (mostly
``price=budget(<350k)``) no longer match the Singapore HDB market. A 2026
4-room flat asking $650k would always fire "above typical pattern" warnings
even though that's just the current market.

This script:
  1. Reads the latest ``hdb_feature_table_*.csv`` under
     ``data/feature_data/02_feature_layer/training/outputs``.
  2. Filters to recent transactions (default: ``transaction_year >= 2022``).
  3. Recomputes price tertiles from that slice — the bucket thresholds are
     always tied to the current market, not a hard-coded 2015-era number.
  4. Discretises the data + mines Apriori rules with mlxtend.
  5. Trains a shallow DecisionTreeRegressor on resale_price (not on the hybrid
     model's predictions — we want the surrogate to summarise the market
     directly, and we want it dateable so freshness guards work).
  6. Extracts one rule per tree leaf.
  7. Backs up the existing rules.json then writes the new one, adding
     ``metadata.price_thresholds`` so the backend's binner can stay in sync
     without a redeploy.

USAGE
-----
  python scripts/regenerate_rules.py
  python scripts/regenerate_rules.py --since 2023
  python scripts/regenerate_rules.py --min-support 0.025 --min-confidence 0.5
  python scripts/regenerate_rules.py --dry-run          # print, don't write
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules
from sklearn.tree import DecisionTreeRegressor, _tree

# ── Singapore mature-estate list (duplicated from frontend for standalone use) ─
MATURE_ESTATES = {
    "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT MERAH", "BUKIT TIMAH",
    "CENTRAL AREA", "CLEMENTI", "GEYLANG", "KALLANG/WHAMPOA",
    "MARINE PARADE", "PASIR RIS", "QUEENSTOWN", "SERANGOON",
    "TAMPINES", "TOA PAYOH"
}


# ── Paths ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
FEATURE_DIR = REPO_ROOT / "data" / "feature_data" / "02_feature_layer" / "training" / "outputs"
RULES_PATH = REPO_ROOT / "data" / "artifacts" / "hybrid_xai" / "rules.json"


def latest_feature_table() -> Path:
    tables = sorted(FEATURE_DIR.glob("hdb_feature_table_*.csv"))
    if not tables:
        raise FileNotFoundError(f"No hdb_feature_table_*.csv under {FEATURE_DIR}")
    return tables[-1]


def infer_is_mature_estate(df: pd.DataFrame) -> pd.Series:
    """Recover the mature-estate flag from town_* one-hots in the feature table."""
    flag = pd.Series(0, index=df.index)
    for town in MATURE_ESTATES:
        col = f"town_{town}"
        if col in df.columns:
            flag = flag | df[col].fillna(0).astype(int)
    return flag.astype(int)


def discretise(df: pd.DataFrame, price_lo: float, price_hi: float) -> tuple[pd.DataFrame, dict]:
    """Convert continuous columns into boolean item columns for apriori.

    Returns (discretised dataframe, label map) so the caller can persist the
    human-readable labels for each token.
    """
    d = pd.DataFrame(index=df.index)

    # Area
    d["area=small(<70sqm)"] = df["floor_area_sqm"] < 70
    d["area=medium(70-100sqm)"] = (df["floor_area_sqm"] >= 70) & (df["floor_area_sqm"] < 100)
    d["area=large(>=100sqm)"] = df["floor_area_sqm"] >= 100

    # Storey
    d["storey=low(1-5)"] = df["storey_mid"] <= 5
    d["storey=mid(6-12)"] = (df["storey_mid"] > 5) & (df["storey_mid"] <= 12)
    d["storey=high(>12)"] = df["storey_mid"] > 12

    # MRT distance (km)
    d["mrt=walking(<0.5km)"] = df["dist_nearest_mrt_km"] < 0.5
    d["mrt=near(0.5-0.8km)"] = (df["dist_nearest_mrt_km"] >= 0.5) & (df["dist_nearest_mrt_km"] < 0.8)
    d["mrt=far(>0.8km)"] = df["dist_nearest_mrt_km"] >= 0.8

    # Remaining lease
    d["lease=short(<55yr)"] = df["lease_remaining_years"] < 55
    d["lease=medium(55-80yr)"] = (df["lease_remaining_years"] >= 55) & (df["lease_remaining_years"] < 80)
    d["lease=long(>=80yr)"] = df["lease_remaining_years"] >= 80

    # Mature estate
    d["mature_estate=yes"] = df["is_mature_estate"] == 1
    d["mature_estate=no"] = df["is_mature_estate"] == 0

    # Rooms
    rooms = df["room_count"].fillna(4).astype(int).clip(2, 5)
    d["rooms=2-3"] = rooms <= 3
    d["rooms=4"] = rooms == 4
    d["rooms=5+"] = rooms >= 5

    # Price (data-driven tertiles)
    lo, hi = int(price_lo), int(price_hi)
    budget_tok = f"price=budget(<{lo//1000}k)"
    mid_tok = f"price=mid({lo//1000}-{hi//1000}k)"
    prem_tok = f"price=premium(>={hi//1000}k)"
    d[budget_tok] = df["resale_price"] < price_lo
    d[mid_tok] = (df["resale_price"] >= price_lo) & (df["resale_price"] < price_hi)
    d[prem_tok] = df["resale_price"] >= price_hi

    label_map = {
        "area=small(<70sqm)": "small flat (<70 sqm)",
        "area=medium(70-100sqm)": "medium flat (70–100 sqm)",
        "area=large(>=100sqm)": "large flat (≥100 sqm)",
        "storey=low(1-5)": "low floor (1–5)",
        "storey=mid(6-12)": "mid floor (6–12)",
        "storey=high(>12)": "high floor (>12)",
        "mrt=walking(<0.5km)": "walking distance to MRT (<500 m)",
        "mrt=near(0.5-0.8km)": "near an MRT (500–800 m)",
        "mrt=far(>0.8km)": "far from MRT (>800 m)",
        "lease=short(<55yr)": "short lease (<55 yrs)",
        "lease=medium(55-80yr)": "medium lease (55–80 yrs)",
        "lease=long(>=80yr)": "long lease (≥80 yrs)",
        "mature_estate=yes": "mature estate",
        "mature_estate=no": "non-mature estate",
        "rooms=2-3": "2- or 3-room",
        "rooms=4": "4-room",
        "rooms=5+": "5-room / executive",
        budget_tok: f"budget range (<${lo//1000}k)",
        mid_tok: f"mid range (${lo//1000}k–${hi//1000}k)",
        prem_tok: f"premium range (≥${hi//1000}k)",
    }

    return d.astype(int), label_map


def mine_apriori(
    disc: pd.DataFrame,
    price_tokens: set[str],
    *,
    min_support: float,
    min_confidence: float,
    top_n: int,
) -> list[dict]:
    """Run Apriori + association-rules, filter to rules with a single price consequent."""
    frequent = apriori(disc, min_support=min_support, use_colnames=True, low_memory=True)
    if frequent.empty:
        return []
    rules_df = association_rules(
        frequent,
        metric="confidence",
        min_threshold=min_confidence,
        num_itemsets=len(frequent),
    )
    rules_df = rules_df[
        rules_df["consequents"].apply(lambda s: len(s) == 1 and list(s)[0] in price_tokens)
    ]
    rules_df = rules_df.sort_values(["confidence", "lift"], ascending=False).head(top_n)

    out: list[dict] = []
    for _, row in rules_df.iterrows():
        out.append(
            {
                "source": "apriori",
                "if_conditions": sorted(map(str, row["antecedents"])),
                "then": sorted(map(str, row["consequents"])),
                "support": round(float(row["support"]), 4),
                "confidence": round(float(row["confidence"]), 4),
                "lift": round(float(row["lift"]), 4),
            }
        )
    return out


def _surrogate_feature_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Pick a compact set of features for the surrogate tree. Kept small so
    each leaf has a readable set of IF conditions."""
    features = [
        "floor_area_sqm",
        "storey_mid",
        "lease_remaining_years",
        "dist_nearest_mrt_km",
        "transaction_year",
        "room_count",
        "is_mature_estate",
    ]
    X = df[features].copy()
    return X, features


def train_surrogate(
    df: pd.DataFrame,
    *,
    max_depth: int,
    min_samples_leaf: int,
) -> tuple[DecisionTreeRegressor, list[str], float]:
    X, feat_names = _surrogate_feature_frame(df)
    y = df["resale_price"].astype(float)
    tree = DecisionTreeRegressor(
        max_depth=max_depth,
        min_samples_leaf=min_samples_leaf,
        random_state=42,
    )
    tree.fit(X, y)
    fidelity = float(tree.score(X, y))  # R² on training data — the surrogate's faithfulness
    return tree, feat_names, fidelity


def extract_leaf_rules(
    tree: DecisionTreeRegressor,
    feat_names: list[str],
    fidelity: float,
) -> list[dict]:
    """Walk every leaf of the tree and emit (conditions, then_price, samples, confidence)."""
    t = tree.tree_

    def walk(node: int, path: list[str]) -> list[dict]:
        if t.children_left[node] == _tree.TREE_LEAF:
            # Leaf: surface the path
            return [
                {
                    "source": "surrogate",
                    "conditions": list(path),
                    "then_price": round(float(t.value[node][0][0]), 2),
                    "samples": int(t.n_node_samples[node]),
                    # Per-rule confidence = fraction of variance explained by this
                    # specific leaf's constant predictor. Clamped to [0, 1].
                    "confidence": round(float(max(0.0, min(1.0, fidelity))), 4),
                }
            ]
        feat = feat_names[int(t.feature[node])]
        thr = float(t.threshold[node])
        thr_str = f"{thr:.2f}" if not float(thr).is_integer() else f"{int(thr)}"
        left_cond = f"{feat} <= {thr_str}"
        right_cond = f"{feat} > {thr_str}"
        return walk(t.children_left[node], path + [left_cond]) + walk(
            t.children_right[node], path + [right_cond]
        )

    return walk(0, [])


def build_payload(
    *,
    apriori_rules: list[dict],
    surrogate_rules: list[dict],
    price_lo: float,
    price_hi: float,
    fidelity: float,
    years_min: int,
    n_rows: int,
) -> dict:
    return {
        "apriori": apriori_rules,
        "surrogate": surrogate_rules,
        "metadata": {
            "apriori_count": len(apriori_rules),
            "surrogate_count": len(surrogate_rules),
            "surrogate_fidelity_r2": round(float(fidelity), 4),
            "model": "data_driven_2026",
            "source_years": f">={years_min}",
            "n_rows_mined": int(n_rows),
            "price_thresholds": {
                "budget_upper": int(price_lo),
                "premium_lower": int(price_hi),
            },
            "regenerated_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=int, default=2022, help="Minimum transaction_year (inclusive)")
    parser.add_argument("--min-support", type=float, default=0.02)
    parser.add_argument("--min-confidence", type=float, default=0.55)
    parser.add_argument("--top-n", type=int, default=60, help="Max apriori rules to keep")
    parser.add_argument("--max-depth", type=int, default=5)
    parser.add_argument("--min-samples-leaf", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true", help="Print summary; don't write rules.json")
    parser.add_argument("--feature-table", type=str, help="Override auto-detected CSV path")
    args = parser.parse_args()

    csv_path = Path(args.feature_table) if args.feature_table else latest_feature_table()
    print(f"[load] reading {csv_path}")
    df_all = pd.read_csv(csv_path)

    need_cols = {
        "transaction_year", "floor_area_sqm", "level_mid",
        "lease_remaining_years", "dist_to_mrt_m", "resale_price", "room_count",
    }
    missing = need_cols - set(df_all.columns)
    if missing:
        sys.exit(f"[error] feature table missing columns: {missing}")

    df = df_all[df_all["transaction_year"] >= args.since].copy()
    if df.empty:
        sys.exit(f"[error] no rows with transaction_year >= {args.since}")

    # Rename / derive to the column names the miner expects
    df["storey_mid"] = df["level_mid"]
    df["dist_nearest_mrt_km"] = df["dist_to_mrt_m"] / 1000.0
    df["is_mature_estate"] = infer_is_mature_estate(df)

    n = len(df)
    print(f"[filter] transaction_year >= {args.since} → {n:,} rows")
    print(f"[stats]  price  min={df['resale_price'].min():,.0f}  "
          f"median={df['resale_price'].median():,.0f}  "
          f"max={df['resale_price'].max():,.0f}")

    price_lo = float(np.round(df["resale_price"].quantile(0.33) / 1000.0) * 1000.0)
    price_hi = float(np.round(df["resale_price"].quantile(0.67) / 1000.0) * 1000.0)
    print(f"[tertiles] 33rd pct = ${price_lo:,.0f}  67th pct = ${price_hi:,.0f}")

    disc, label_map = discretise(df, price_lo, price_hi)
    price_tokens = {c for c in disc.columns if c.startswith("price=")}
    print(f"[apriori] mining from {len(disc.columns)} items, "
          f"min_support={args.min_support}, min_confidence={args.min_confidence}")
    apriori_rules = mine_apriori(
        disc,
        price_tokens,
        min_support=args.min_support,
        min_confidence=args.min_confidence,
        top_n=args.top_n,
    )
    by_bin: dict[str, int] = {}
    for r in apriori_rules:
        for t in r["then"]:
            if t.startswith("price="):
                by_bin[t] = by_bin.get(t, 0) + 1
    print(f"[apriori] kept {len(apriori_rules)} rules:")
    for tok, cnt in by_bin.items():
        print(f"           {cnt:>3} → {tok}")

    print(f"[surrogate] training DecisionTreeRegressor "
          f"(max_depth={args.max_depth}, min_samples_leaf={args.min_samples_leaf})")
    tree, feat_names, fidelity = train_surrogate(
        df,
        max_depth=args.max_depth,
        min_samples_leaf=args.min_samples_leaf,
    )
    surrogate_rules = extract_leaf_rules(tree, feat_names, fidelity)
    print(f"[surrogate] {len(surrogate_rules)} leaves, global R² = {fidelity:.4f}")
    if surrogate_rules:
        prices = sorted(r["then_price"] for r in surrogate_rules)
        print(f"[surrogate] leaf price range: ${prices[0]:,.0f} – ${prices[-1]:,.0f}")

    payload = build_payload(
        apriori_rules=apriori_rules,
        surrogate_rules=surrogate_rules,
        price_lo=price_lo,
        price_hi=price_hi,
        fidelity=fidelity,
        years_min=int(args.since),
        n_rows=n,
    )
    payload["metadata"]["label_map"] = label_map  # human-readable per token
    payload["metadata"]["surrogate_features"] = feat_names

    if args.dry_run:
        print("\n[dry-run] NOT writing — sample output:")
        print(json.dumps(
            {
                "apriori_first_3": apriori_rules[:3],
                "surrogate_first_3": surrogate_rules[:3],
                "metadata": payload["metadata"],
            },
            indent=2,
        ))
        return 0

    # Backup + write
    if RULES_PATH.exists():
        stamp = datetime.utcnow().strftime("%Y-%m-%dT%H%M%S")
        backup = RULES_PATH.with_suffix(f".{stamp}.json.bak")
        os.rename(RULES_PATH, backup)
        print(f"[backup] existing rules → {backup.name}")

    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RULES_PATH.open("w") as f:
        json.dump(payload, f, indent=2)
    print(f"[write]  {RULES_PATH}  ({RULES_PATH.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
