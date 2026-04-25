"""
Regenerate composite TreeSHAP global importance + cluster_profiles against
the bundle currently deployed at SystemCode/data/artifacts/hybrid_cluster_bundle.joblib.

Run from repo root:
    SystemCode/backend/.venv/bin/python SystemCode/scripts/regenerate_composite_shap.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "SystemCode"))

ART = ROOT / "SystemCode" / "data" / "artifacts"
HXAI = ART / "hybrid_xai"
FEAT_DIR = ROOT / "SystemCode" / "data" / "feature_data" / "02_feature_layer" / "training" / "outputs"

N_SAMPLES = 2000
RNG = np.random.RandomState(42)


def latest_feature_table() -> Path:
    cands = sorted(FEAT_DIR.glob("hdb_feature_table_*.csv"))
    if not cands:
        raise FileNotFoundError(f"No hdb_feature_table_*.csv under {FEAT_DIR}")
    return cands[-1]


def town_from_onehots(row, town_cols):
    for c in town_cols:
        if row.get(c, 0) >= 0.5:
            return c.replace("town_", "")
    return None


def decode_top_towns(df_cluster: pd.DataFrame, town_cols, k: int = 5) -> list[str]:
    sums = {c: float(df_cluster[c].sum()) for c in town_cols if c in df_cluster.columns}
    return [c.replace("town_", "") for c, _ in sorted(sums.items(), key=lambda x: x[1], reverse=True)[:k]]


def label_from_stats(stats: dict, global_stats: dict) -> tuple[str, str]:
    """Heuristic label + summary from cluster vs global means."""
    sqm = stats["floor_area_sqm"]
    lease = stats["lease_remaining_years"]
    level = stats["level_mid"]
    rooms = stats["room_count"]
    dist_mrt = stats["dist_to_mrt_m"]
    price = stats["resale_price_mean"]

    g_price = global_stats["resale_price_mean"]
    g_dist = global_stats["dist_to_mrt_m"]
    g_lease = global_stats["lease_remaining_years"]

    # Pick a primary descriptor
    if price >= g_price * 1.10:
        head = "Premium central flats"
    elif lease >= g_lease + 8 and dist_mrt <= g_dist:
        head = "Newer suburban larger flats"
    elif lease <= g_lease - 8 and rooms <= 3.5:
        head = "Older compact mature-estate flats"
    elif dist_mrt >= g_dist * 1.20:
        head = "Outlying flats farther from MRT"
    elif sqm >= 100:
        head = "Larger flats"
    elif sqm <= 80:
        head = "Compact flats"
    else:
        head = "Mid-size flats"

    summary = (
        f"~{sqm:.0f} sqm · ~{lease:.0f}yr lease · {rooms:.1f}-room avg · "
        f"~{dist_mrt/1000:.1f}km to MRT · avg ${price:,.0f}"
    )
    return head, summary


def imp_records(features, values):
    """Flat dict {feature: mean_abs_shap}, ordered by importance descending.
    Matches the shape backend/analytics.py:200 expects (calls .keys()).
    """
    pairs = sorted(zip(features, values), key=lambda x: x[1], reverse=True)
    return {f: float(v) for f, v in pairs}


def main() -> None:
    bundle_path = ART / "hybrid_cluster_bundle.joblib"
    print(f"Loading bundle: {bundle_path}")
    bundle = joblib.load(bundle_path)
    feature_cols = list(bundle["feature_columns"])
    cluster_cols = list(bundle["cluster_cols"])
    n_clusters = int(bundle["n_clusters"])
    print(f"  n_clusters={n_clusters}, n_features={len(feature_cols)}, cluster_cols={len(cluster_cols)}")

    table_csv = latest_feature_table()
    print(f"Feature table: {table_csv.name}")
    df = pd.read_csv(table_csv)

    # Drop columns the bundle does not know about; fill missing
    X_full = df.reindex(columns=feature_cols, fill_value=0.0).fillna(0).astype(float)
    Xc = df.reindex(columns=cluster_cols, fill_value=0.0).fillna(0).astype(float).values

    # Route every row to its cluster
    Xc_s = bundle["cluster_scaler"].transform(Xc)
    cluster_ids = bundle["kmeans"].predict(Xc_s).astype(int)
    print(f"  Population cluster counts: {pd.Series(cluster_ids).value_counts().sort_index().to_dict()}")

    # Stratified sample (cluster-balanced) for SHAP
    per_cluster = N_SAMPLES // n_clusters
    sample_idx = []
    for k in range(n_clusters):
        cand = np.where(cluster_ids == k)[0]
        take = min(per_cluster, len(cand))
        if take == 0:
            continue
        sample_idx.append(RNG.choice(cand, take, replace=False))
    sample_idx = np.concatenate(sample_idx)
    RNG.shuffle(sample_idx)
    X_sample = X_full.values[sample_idx]
    sample_clusters = cluster_ids[sample_idx]
    print(f"  Sampled rows for SHAP: {len(sample_idx)}")

    # Compute composite SHAP per row, batched by cluster so explainers are
    # built once per cluster (the runtime function rebuilds them per call).
    from backend.composite_treeshap import (
        _build_explainer_set,
        _scalar_expected,
    )

    F = len(feature_cols)
    shap_values = np.zeros((len(sample_idx), F), dtype=float)

    t0 = time.time()
    for k in range(n_clusters):
        idx_k = np.where(sample_clusters == k)[0]
        if len(idx_k) == 0:
            continue
        exp = _build_explainer_set(bundle, k, feature_cols)
        Xk = X_sample[idx_k]
        sv_xgb = np.asarray(exp["xgb"](Xk).values, dtype=float)
        sv_lgb = np.asarray(exp["lgb"](Xk).values, dtype=float)
        sv_rf = np.asarray(exp["rf"](Xk).values, dtype=float)
        composite = exp["w_xgb"] * sv_xgb + exp["w_lgb"] * sv_lgb + exp["w_rf"] * sv_rf
        shap_values[idx_k] = composite
        print(
            f"  cluster {k}: {len(idx_k)} rows | "
            f"weights ridge={exp['w_ridge']:.3f} xgb={exp['w_xgb']:.3f} "
            f"lgb={exp['w_lgb']:.3f} rf={exp['w_rf']:.3f}"
        )
    elapsed = time.time() - t0
    print(f"Composite SHAP done in {elapsed:.1f}s ({elapsed*1000/len(sample_idx):.1f} ms/row)")

    # Aggregate global + per-cluster mean(|SHAP|)
    abs_shap = np.abs(shap_values)
    global_imp = abs_shap.mean(axis=0)
    per_cluster_imp = {}
    for k in range(n_clusters):
        mask = sample_clusters == k
        if mask.sum() == 0:
            continue
        per_cluster_imp[str(k)] = imp_records(feature_cols, abs_shap[mask].mean(axis=0))

    out = {
        "method": "CompositeTreeSHAP",
        "model": "full_hybrid_ensemble",
        "n_samples": int(len(sample_idx)),
        "global_feature_importance": imp_records(feature_cols, global_imp),
        "per_cluster_importance": per_cluster_imp,
    }
    out_path = HXAI / "composite_treeshap_global_importance.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"Wrote {out_path}")

    # Cluster profiles (use full population; not the sample)
    town_cols = [c for c in df.columns if c.startswith("town_")]
    overall_stats = {
        "floor_area_sqm": float(df["floor_area_sqm"].mean()),
        "lease_remaining_years": float(df["lease_remaining_years"].mean()),
        "level_mid": float(df["level_mid"].mean()),
        "room_count": float(df["room_count"].mean()),
        "dist_to_mrt_m": float(df["dist_to_mrt_m"].mean()),
        "resale_price_mean": float(df["resale_price"].mean()),
    }
    profiles = {}
    for k in range(n_clusters):
        mask = cluster_ids == k
        sub = df.loc[mask]
        if len(sub) == 0:
            continue
        stats = {
            "floor_area_sqm": round(float(sub["floor_area_sqm"].mean()), 1),
            "lease_remaining_years": round(float(sub["lease_remaining_years"].mean()), 1),
            "level_mid": round(float(sub["level_mid"].mean()), 1),
            "room_count": round(float(sub["room_count"].mean()), 1),
            "dist_to_mrt_m": round(float(sub["dist_to_mrt_m"].mean()), 1),
            "resale_price_mean": int(round(float(sub["resale_price"].mean()))),
        }
        label, summary = label_from_stats(stats, overall_stats)
        profiles[str(k)] = {
            "label": label,
            "summary": summary,
            "top_towns": decode_top_towns(sub, town_cols, k=5),
            "share": round(float(mask.sum()) / len(df), 3),
            "n_rows": int(mask.sum()),
            "stats": stats,
        }

    profiles_out = {
        "n_clusters": n_clusters,
        "_note": (
            "Derived from currently-deployed hybrid_cluster_bundle.joblib. "
            "Regenerate via SystemCode/scripts/regenerate_composite_shap.py "
            "after every bundle change."
        ),
        "clusters": profiles,
    }
    profiles_path = HXAI / "cluster_profiles.json"
    profiles_path.write_text(json.dumps(profiles_out, indent=2))
    print(f"Wrote {profiles_path}")

    print("\nCluster summary:")
    for k, p in profiles.items():
        print(
            f"  {k}: {p['label']} | n={p['n_rows']:,} ({p['share']*100:.1f}%) | "
            f"top={','.join(p['top_towns'][:3])}"
        )


if __name__ == "__main__":
    main()
