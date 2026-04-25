#!/usr/bin/env python3
"""
Retrain the PropertyLens hybrid_cluster ensemble from the latest feature table.

This script is a standalone replacement for notebooks/03_ml_layer_hybrid/
02_hybrid_ensemble.ipynb — useful when you want to refresh the model
without opening Jupyter (e.g. on-the-fly retrain after a feature-table
update).

What this rebuilds:
  data/artifacts/
    hybrid_cluster_bundle.joblib      (used by backend/hybrid_inference.py)
    hybrid_cluster_feature_columns.json
    hybrid_cluster_kmeans.joblib
    hybrid_cluster_models.joblib
    hybrid_cluster_meta.json          (must contain "test_metrics" — backend
                                       crashes at startup without it)

What this DOES NOT rebuild — re-run the corresponding notebooks afterwards
if you want them to reflect the new model:
  notebooks/04_xai_layer/04_hybrid_xai_train.ipynb
      → SHAP/LIME caches in data/artifacts/hybrid_xai/
  scripts/rebuild_cbr_parquet.py
      → cbr_training_data.parquet (also re-fits scaler if you wire it in)

Usage
-----
  # Defaults: latest CSV, train < val_year, val == val_year, test >= test_year
  python scripts/retrain_hybrid_model.py

  # Bump the year split (e.g. when 2027 data arrives)
  python scripts/retrain_hybrid_model.py --val-year 2026 --test-year 2027

  # Pin the source CSV explicitly
  python scripts/retrain_hybrid_model.py --feature-snapshot 20260406

  # Different cluster count
  python scripts/retrain_hybrid_model.py --n-clusters 4
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    mean_squared_error,
    r2_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import lightgbm as lgb
import xgboost as xgb

warnings.filterwarnings("ignore")

REPO_ROOT = Path(__file__).resolve().parents[1]
FEATURE_DIR = REPO_ROOT / "data" / "feature_data" / "02_feature_layer" / "training" / "outputs"
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "artifacts"

TARGET = "resale_price"
YEAR_COL = "transaction_year"
META_COLS = ["address_key"]

# Schema additions in newer feature-table versions that the existing 77-column
# inference path was not trained on. Drop them so the produced bundle stays
# compatible with `backend/hybrid_inference.py` and the SHAP / LIME caches
# until those are also regenerated.
DROP_NEW_SCHEMA_FEATURES = (
    "years_since_transaction",
    "recency_normalized",
    "years_since_transaction_sq",
    "recency_x_school_quality",
    "recency_x_mall_access",
    "biz_shops_eating_rented",
    "biz_offices_rented",
    "biz_commercial_rented_total",
    "biz_childcare_rented",
    "biz_eldercare_rented",
    "biz_community_rented",
    "biz_social_rented_total",
    "market_flats_sold_national",
    "market_flats_rented_national",
)

# Continuous segmentation features used to fit KMeans (no price, no year).
CLUSTER_COLS_CANDIDATES = [
    "level_mid", "lease_remaining_years", "floor_area_sqm", "room_count",
    "dist_to_mrt_m", "orientation_score", "dist_to_highway_m", "dist_to_foodcourt_m",
    "dist_to_nearest_mall_m", "mall_count_3km", "mall_weighted_access_3km",
    "dist_to_nearest_school_m", "school_count_1km",
    "primary_school_quality_1km_weighted", "primary_school_top_quality_1km",
]


def latest_snapshot_date() -> str:
    """YYYYMMDD suffix of the most recent hdb_feature_table_*.csv."""
    tables = sorted(FEATURE_DIR.glob("hdb_feature_table_*.csv"))
    if not tables:
        raise FileNotFoundError(f"No hdb_feature_table_*.csv under {FEATURE_DIR}")
    return tables[-1].stem.split("_")[-1]


def evaluate(name: str, y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "model": name,
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mape": float(mean_absolute_percentage_error(y_true, y_pred) * 100),
        "r2": float(r2_score(y_true, y_pred)),
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument(
        "--feature-snapshot",
        default=None,
        help="YYYYMMDD suffix of hdb_feature_table_*.csv (default: latest).",
    )
    p.add_argument(
        "--val-year", type=int, default=2025,
        help="Year used as the validation cohort (train is < this, default 2025).",
    )
    p.add_argument(
        "--test-year", type=int, default=2026,
        help="Year-onwards used as the test cohort (default 2026).",
    )
    p.add_argument(
        "--n-clusters", type=int, default=3,
        help="KMeans cluster count (default 3, matches the shipped artifact).",
    )
    p.add_argument(
        "--min-cluster-train", type=int, default=5000,
        help="Below this train size a cluster falls back to the global blend (default 5000).",
    )
    p.add_argument(
        "--out-dir", type=Path, default=DEFAULT_OUT_DIR,
        help=f"Where to write the bundle (default: {DEFAULT_OUT_DIR.relative_to(REPO_ROOT)}).",
    )
    p.add_argument(
        "--xgb-search-iters", type=int, default=12,
        help="Per-cluster XGB random-search iterations (default 12).",
    )
    return p.parse_args()


def load_data(snapshot: str) -> pd.DataFrame:
    csv_path = FEATURE_DIR / f"hdb_feature_table_{snapshot}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Missing feature table: {csv_path}")
    df = pd.read_csv(csv_path)

    drop_cols = [c for c in DROP_NEW_SCHEMA_FEATURES if c in df.columns]
    if drop_cols:
        df = df.drop(columns=drop_cols)
        print(f"  Dropped new-schema cols ({len(drop_cols)}): {drop_cols}")

    print(f"  Source: {csv_path.name}")
    print(f"  Rows: {len(df):,} | Years: {df[YEAR_COL].min()}–{df[YEAR_COL].max()}")
    return df


def build_feature_columns(df: pd.DataFrame) -> list[str]:
    drop = [TARGET] + META_COLS
    return [c for c in df.columns if c not in drop and pd.api.types.is_numeric_dtype(df[c])]


def split_masks(df: pd.DataFrame, val_year: int, test_year: int):
    train_mask = df[YEAR_COL] < val_year
    val_mask = df[YEAR_COL] == val_year
    test_mask = df[YEAR_COL] >= test_year
    return train_mask, val_mask, test_mask


def fit_clusters(df, feature_cols, train_mask, val_mask, test_mask, n_clusters):
    cluster_cols = [c for c in CLUSTER_COLS_CANDIDATES if c in df.columns]
    Xc = df[cluster_cols].fillna(0).astype(float).values
    cluster_scaler = StandardScaler().fit(Xc[train_mask.values])
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    kmeans.fit(cluster_scaler.transform(Xc[train_mask.values]))
    cluster_all = kmeans.predict(cluster_scaler.transform(Xc))
    df = df.assign(cluster_id=cluster_all)
    return df, kmeans, cluster_scaler, cluster_cols


def fit_global_models(X_train, y_train, X_val, y_val, X_test, y_test, rng):
    print("\n[Global stack]")
    best_alpha, best_mape = None, np.inf
    for alpha in np.logspace(-1, 4, 25):
        ridge = Pipeline([("sc", StandardScaler()), ("r", Ridge(alpha=alpha, random_state=42))])
        ridge.fit(X_train, y_train)
        m = mean_absolute_percentage_error(y_val, ridge.predict(X_val)) * 100
        if m < best_mape:
            best_mape, best_alpha = m, alpha
    global_ridge = Pipeline([("sc", StandardScaler()), ("r", Ridge(alpha=best_alpha, random_state=42))])
    global_ridge.fit(X_train, y_train)
    print(f"  Ridge: best alpha={best_alpha:.4f}, val MAPE={best_mape:.2f}%")

    global_xgb = xgb.XGBRegressor(
        n_estimators=800, learning_rate=0.05, max_depth=8, subsample=0.8, colsample_bytree=0.8,
        min_child_weight=5, reg_alpha=0.1, reg_lambda=1.0, n_jobs=-1, random_state=42,
        early_stopping_rounds=50, eval_metric="rmse", verbosity=0,
    )
    global_xgb.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    global_lgb = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.05, num_leaves=63, max_depth=-1,
        subsample=0.8, colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=1.0,
        random_state=42, n_jobs=-1, verbose=-1,
    )
    global_lgb.fit(X_train, y_train, eval_set=[(X_val, y_val)],
                   callbacks=[lgb.early_stopping(50, verbose=False)])

    global_rf = RandomForestRegressor(
        n_estimators=120, max_depth=16, min_samples_leaf=5, random_state=42, n_jobs=-1,
    )
    global_rf.fit(X_train, y_train)

    P_val = np.column_stack([
        global_ridge.predict(X_val), global_xgb.predict(X_val),
        global_lgb.predict(X_val), global_rf.predict(X_val),
    ])
    P_test = np.column_stack([
        global_ridge.predict(X_test), global_xgb.predict(X_test),
        global_lgb.predict(X_test), global_rf.predict(X_test),
    ])

    meta_global = Ridge(alpha=1.0, random_state=42)
    meta_global.fit(P_val, y_val)

    def blend_mape(w, P, y):
        return mean_absolute_percentage_error(y, P @ np.array(w)) * 100

    best = None
    for _ in range(40):
        x0 = rng.random(4) * 2
        res = minimize(lambda w: blend_mape(w, P_val, y_val), x0=x0,
                       method="Nelder-Mead", options={"maxiter": 3000})
        if best is None or res.fun < best.fun:
            best = res
    w_blend = best.x if best is not None else np.ones(4) / 4

    blend_test = P_test @ w_blend
    print(f"  Test  blend: ", evaluate("blend", y_test, blend_test))
    return {
        "ridge": global_ridge, "xgb": global_xgb, "lgb": global_lgb, "rf": global_rf,
        "meta": meta_global, "blend_weights": w_blend,
    }, P_val, P_test, blend_test


def fit_cluster_models(
    df, X_all, y_all, X_train, y_train, X_val, y_val, X_test, y_test,
    train_mask, val_mask, cl_train, cl_val, cl_test,
    n_clusters, min_cluster_train, blend_test_global, rng, xgb_search_iters,
):
    print("\n[Per-cluster]")
    cluster_bundle: dict = {}
    hybrid_test = np.zeros(len(y_test))
    use_fallback = np.zeros(len(y_test), dtype=bool)
    tv_mask = np.logical_or(train_mask.values, val_mask.values)

    for k in range(n_clusters):
        tr_idx = np.where(cl_train == k)[0]
        va_idx = np.where(cl_val == k)[0]
        te_idx = np.where(cl_test == k)[0]
        n_tr = len(tr_idx)

        if n_tr < min_cluster_train:
            print(f"  Cluster {k}: train={n_tr} < {min_cluster_train} → global fallback")
            cluster_bundle[k] = {"fallback": True}
            if len(te_idx):
                hybrid_test[te_idx] = blend_test_global[te_idx]
                use_fallback[te_idx] = True
            continue
        if len(va_idx) == 0:
            print(f"  Cluster {k}: val=0 → global fallback")
            cluster_bundle[k] = {"fallback": True, "reason": "no_val_rows"}
            if len(te_idx):
                hybrid_test[te_idx] = blend_test_global[te_idx]
                use_fallback[te_idx] = True
            continue

        Xtr_k, ytr_k = X_train[tr_idx], y_train[tr_idx]
        Xva_k, yva_k = X_val[va_idx], y_val[va_idx]
        pos_tv = np.where((df["cluster_id"].values == k) & tv_mask)[0]
        Xtv_k = X_all.values[pos_tv]
        ytv_k = y_all.values[pos_tv]
        if len(Xtv_k) == 0:
            print(f"  Cluster {k}: train+val empty → global fallback")
            cluster_bundle[k] = {"fallback": True, "reason": "no_trainval_rows"}
            if len(te_idx):
                hybrid_test[te_idx] = blend_test_global[te_idx]
                use_fallback[te_idx] = True
            continue

        # XGB random search on validation MAPE
        best_xgb, best_mape = None, np.inf
        for _ in range(xgb_search_iters):
            mdl = xgb.XGBRegressor(
                n_estimators=int(rng.choice([400, 600, 800])),
                learning_rate=float(rng.choice([0.03, 0.04, 0.05])),
                max_depth=int(rng.choice([6, 8, 10])),
                subsample=0.8, colsample_bytree=0.8,
                min_child_weight=int(rng.choice([3, 5, 7])),
                reg_alpha=0.1, reg_lambda=1.0, n_jobs=-1, random_state=42,
                early_stopping_rounds=40, eval_metric="rmse", verbosity=0,
            )
            mdl.fit(Xtr_k, ytr_k, eval_set=[(Xva_k, yva_k)], verbose=False)
            mape = mean_absolute_percentage_error(yva_k, mdl.predict(Xva_k)) * 100
            if mape < best_mape:
                best_mape, best_xgb = mape, mdl

        ridge_k = Pipeline([("sc", StandardScaler()), ("r", Ridge(alpha=10.0, random_state=42))])
        ridge_k.fit(Xtr_k, ytr_k)
        lgb_k = lgb.LGBMRegressor(
            n_estimators=500, learning_rate=0.05, num_leaves=63, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=1.0, random_state=42, n_jobs=-1, verbose=-1,
        )
        lgb_k.fit(Xtr_k, ytr_k, eval_set=[(Xva_k, yva_k)],
                  callbacks=[lgb.early_stopping(40, verbose=False)])
        rf_k = RandomForestRegressor(n_estimators=100, max_depth=14, min_samples_leaf=8,
                                     random_state=42, n_jobs=-1)
        rf_k.fit(Xtr_k, ytr_k)

        Pr_v = np.column_stack([
            ridge_k.predict(Xva_k), best_xgb.predict(Xva_k),
            lgb_k.predict(Xva_k), rf_k.predict(Xva_k),
        ])
        meta_k = Ridge(alpha=1.0, random_state=42)
        meta_k.fit(Pr_v, yva_k)

        # Refit base learners on train+val for test-time predictions
        ridge_k2 = Pipeline([("sc", StandardScaler()), ("r", Ridge(alpha=10.0, random_state=42))])
        ridge_k2.fit(Xtv_k, ytv_k)
        bx2 = xgb.XGBRegressor(
            n_estimators=best_xgb.n_estimators, learning_rate=best_xgb.learning_rate,
            max_depth=best_xgb.max_depth, subsample=0.8, colsample_bytree=0.8,
            min_child_weight=best_xgb.min_child_weight, reg_alpha=0.1, reg_lambda=1.0,
            n_jobs=-1, random_state=42, verbosity=0,
        )
        bx2.fit(Xtv_k, ytv_k)
        lgb_k2 = lgb.LGBMRegressor(
            n_estimators=500, learning_rate=0.05, num_leaves=63, subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=1.0, random_state=42, n_jobs=-1, verbose=-1,
        )
        lgb_k2.fit(Xtv_k, ytv_k)
        rf_k2 = RandomForestRegressor(n_estimators=100, max_depth=14, min_samples_leaf=8,
                                      random_state=42, n_jobs=-1)
        rf_k2.fit(Xtv_k, ytv_k)

        cluster_bundle[k] = {
            "fallback": False, "meta": meta_k,
            "ridge": ridge_k2, "xgb": bx2, "lgb": lgb_k2, "rf": rf_k2,
        }

        if len(te_idx):
            Xt_k = X_test[te_idx]
            Pt_k = np.column_stack([
                ridge_k2.predict(Xt_k), bx2.predict(Xt_k),
                lgb_k2.predict(Xt_k), rf_k2.predict(Xt_k),
            ])
            hybrid_test[te_idx] = meta_k.predict(Pt_k)

        print(f"  Cluster {k}: train={n_tr}, val_MAPE_xgb={best_mape:.2f}%, test_rows={len(te_idx)}")

    return cluster_bundle, hybrid_test, use_fallback


def main() -> None:
    args = parse_args()
    snapshot = args.feature_snapshot or latest_snapshot_date()
    rng = np.random.default_rng(42)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Retrain hybrid_cluster_bundle ===")
    print(f"Output dir: {args.out_dir.relative_to(REPO_ROOT)}")
    print(f"Year split: train < {args.val_year} | val == {args.val_year} | test >= {args.test_year}")
    print(f"Clusters: {args.n_clusters}  |  min_cluster_train: {args.min_cluster_train}")
    print()

    df = load_data(snapshot)
    feature_cols = build_feature_columns(df)
    print(f"  Feature columns: {len(feature_cols)}")

    train_mask, val_mask, test_mask = split_masks(df, args.val_year, args.test_year)
    n_tr, n_va, n_te = int(train_mask.sum()), int(val_mask.sum()), int(test_mask.sum())
    print(f"  Train/val/test rows: {n_tr:,} / {n_va:,} / {n_te:,}")
    if n_tr == 0 or n_va == 0 or n_te == 0:
        sys.exit("ERROR: at least one split is empty — check --val-year and --test-year against the source CSV.")

    X_all = df[feature_cols].fillna(0).astype(float)
    y_all = df[TARGET].astype(float)
    X_train, y_train = X_all.loc[train_mask].values, y_all.loc[train_mask].values
    X_val, y_val = X_all.loc[val_mask].values, y_all.loc[val_mask].values
    X_test, y_test = X_all.loc[test_mask].values, y_all.loc[test_mask].values

    df, kmeans, cluster_scaler, cluster_cols = fit_clusters(
        df, feature_cols, train_mask, val_mask, test_mask, args.n_clusters,
    )
    cl_train = df.loc[train_mask, "cluster_id"].values
    cl_val = df.loc[val_mask, "cluster_id"].values
    cl_test = df.loc[test_mask, "cluster_id"].values
    print(f"  Train cluster counts: {pd.Series(cl_train).value_counts().sort_index().to_dict()}")

    global_models, P_val_g, P_test_g, blend_test_g = fit_global_models(
        X_train, y_train, X_val, y_val, X_test, y_test, rng,
    )

    cluster_bundle, hybrid_test, use_fallback = fit_cluster_models(
        df, X_all, y_all, X_train, y_train, X_val, y_val, X_test, y_test,
        train_mask, val_mask, cl_train, cl_val, cl_test,
        args.n_clusters, args.min_cluster_train, blend_test_g, rng, args.xgb_search_iters,
    )

    r_hybrid = evaluate("Cluster hybrid", y_test, hybrid_test)
    print("\n[Test metrics — cluster hybrid]")
    print(f"  RMSE: ${r_hybrid['rmse']:>10,.0f}  MAE: ${r_hybrid['mae']:>10,.0f}  "
          f"MAPE: {r_hybrid['mape']:.2f}%  R²: {r_hybrid['r2']:.4f}")

    bundle = {
        "kmeans": kmeans, "cluster_scaler": cluster_scaler, "cluster_cols": cluster_cols,
        "n_clusters": args.n_clusters, "min_cluster_train": args.min_cluster_train,
        "global_models": global_models, "cluster_bundles": cluster_bundle,
        "feature_columns": feature_cols, "target": TARGET, "year_col": YEAR_COL,
    }
    bundle_path = args.out_dir / "hybrid_cluster_bundle.joblib"
    joblib.dump(bundle, bundle_path)
    print(f"\nSaved {bundle_path.relative_to(REPO_ROOT)}")

    with open(args.out_dir / "hybrid_cluster_feature_columns.json", "w") as f:
        json.dump(feature_cols, f, indent=2)
    joblib.dump(
        {"kmeans": kmeans, "cluster_scaler": cluster_scaler,
         "cluster_cols": cluster_cols, "n_clusters": args.n_clusters},
        args.out_dir / "hybrid_cluster_kmeans.joblib",
    )
    joblib.dump(cluster_bundle, args.out_dir / "hybrid_cluster_models.joblib")

    # Meta — must include test_metrics or backend/main.py refuses to start.
    meta = {
        "model_name": "Hybrid Cluster Ensemble",
        "model_type": "cluster_routed_meta_stack",
        "base_models": ["Ridge", "XGBoost", "LightGBM", "RandomForest"],
        "meta_learner": "Ridge",
        "n_clusters": args.n_clusters,
        "min_cluster_train": args.min_cluster_train,
        "n_features": len(feature_cols),
        "feature_snapshot": snapshot,
        "year_split": {"val": args.val_year, "test_from": args.test_year},
        "test_metrics": {
            "rmse": int(round(r_hybrid["rmse"])),
            "mae": int(round(r_hybrid["mae"])),
            "mape_pct": round(r_hybrid["mape"], 2),
            "r2": round(r_hybrid["r2"], 4),
        },
        "train_size": n_tr,
        "val_size": n_va,
        "test_size": n_te,
        "cluster_counts_train": pd.Series(cl_train).value_counts().sort_index().to_dict(),
        "cluster_counts_val": pd.Series(cl_val).value_counts().sort_index().to_dict(),
        "cluster_counts_test": pd.Series(cl_test).value_counts().sort_index().to_dict(),
        "n_test_rows_using_global_fallback": int(use_fallback.sum()),
    }
    with open(args.out_dir / "hybrid_cluster_meta.json", "w") as f:
        json.dump(meta, f, indent=2)
    print(f"Saved {(args.out_dir / 'hybrid_cluster_meta.json').relative_to(REPO_ROOT)}")

    print("\nNext steps (NOT done by this script):")
    print("  1. Re-run notebooks/04_xai_layer/04_hybrid_xai_train.ipynb to refresh SHAP/LIME caches")
    print("  2. Re-run scripts/rebuild_cbr_parquet.py to refresh the CBR pool")
    print("  3. Restart the backend so it loads the new bundle")


if __name__ == "__main__":
    main()
