# YC HDB exploration (PropertyLens)

This folder trains and runs **resale price models** on the YC-style HDB feature table (`hdb_feature_table_*.csv` under `../YC_data/` at the repo root). Notebooks are **numbered in run order**.

## Run order

| Step | File | Purpose |
|------|------|---------|
| 1 | `01_yc_xgb_lgb_ensemble.ipynb` | Baseline **XGBoost + LightGBM** ensemble on the YC dataset; temporal train/test split; saves column list and base models under `artifacts/`. |
| 2 | `02_yc_hybrid_ensemble.ipynb` | **Cluster-routed hybrid** (k-means clusters + per-cluster stacks / global blend); same temporal split idea as step 1; writes `hybrid_cluster_bundle.joblib` and related JSON. |
| 3 | `03_yc_hybrid_prediction.ipynb` | **Inference demo**: load the hybrid bundle, optional single-listing and bulk listing predictions. |

**Supporting module (not numbered):** `yc_hybrid_inference.py` — imported by step 3. It is not prefixed with `01`/`02` because Python module names cannot start with a digit and stay easy to import.

Run steps **1 → 2** before relying on hybrid artifacts; run **3** after **2** (or anytime, if `artifacts/hybrid_cluster_bundle.joblib` already exists).

## Data layout

- **Feature CSV:** `../YC_data/hdb_feature_table_<date>.csv` (path is resolved from the notebook working directory: `exploration-on-yc-data/` or repo root, depending on the notebook’s path cells).
- **Outputs:** `artifacts/` — models, `feature_columns.json`, `hybrid_cluster_*.joblib`, `hybrid_cluster_feature_columns.json`, plots, etc.

## Artifacts (high level)

- From **01:** e.g. `feature_columns.json`, `xgb_model.joblib`, `lgb_model.joblib`, `ensemble_weights.joblib`.
- From **02:** e.g. `hybrid_cluster_bundle.joblib`, `hybrid_cluster_kmeans.joblib`, `hybrid_cluster_models.joblib`, `hybrid_cluster_meta.json`, `hybrid_cluster_feature_columns.json`, `hybrid_cluster_mape_comparison.png`.

Step 3 loads the **hybrid** bundle and uses `yc_hybrid_inference.build_yc_hybrid_vector` to align user inputs with the trained feature columns (address lookup in the YC CSV, then overrides).

## Notes

- Listing **asking prices** (e.g. PropertyGuru) are not the same label as **HDB resale transactions** used in training; use external prices only as rough checks, not as a substitute for a proper test set.
- If an address does not match the YC table, inference falls back to **town-level medians** for POI-style fields; see `imputation_note` in the API result.
