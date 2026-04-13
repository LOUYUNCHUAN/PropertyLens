# ML Layer (Hybrid) — Ensemble Models & Inference

Trains an XGBoost + LightGBM ensemble, then routes predictions through K-Means cluster-specific stacked models for improved accuracy. Provides an 8-field inference API for live price prediction.

---

## Quick Start

**STEP 1.** From the **repo root**, open `00_download_data_from_HF.ipynb` — kernel: `.venv/bin/python` — Run All Cells
→ Downloads feature tables into `hf_data/02_feature_layer/training/outputs/`

**STEP 2.** Open `01_xgb_lgb_ensemble.ipynb` — Run All Cells *(~10–15 min)*
→ Trains XGBoost + LightGBM baseline; saves models to `artifacts/`

**STEP 3.** Open `02_hybrid_ensemble.ipynb` — Run All Cells *(~30–60 min)*
→ K-Means clustering + per-cluster stacked ensemble; saves `hybrid_cluster_bundle.joblib`

**STEP 4.** Open `03_hybrid_prediction.ipynb` — Run All Cells *(~2 min)*
→ Loads the bundle, runs inference on a sample listing, prints predicted price

**STEP 5.** *(Optional)* Open `04_publish_hf.ipynb` — Run All Cells
→ Uploads trained artifacts to Hugging Face

**Done.** The model is ready. Proceed to Layer 04 (XAI) or Layer 05 (Photo).

---

## How to Run

### Prerequisites

1. **Feature tables available** — either downloaded from Hugging Face or rebuilt locally:
   ```bash
   # From repo root — downloads to hf_data/02_feature_layer/training/outputs/
   # Run 00_download_data_from_HF.ipynb
   ```
2. `.env` file with `HF_TOKEN` (only needed for notebook 4 — HF publish)
3. Python environment: `.venv/bin/python` (set as the notebook kernel)

### Notebooks (run in order)

| # | Notebook | What it does | Runtime (CPU) |
|---|----------|--------------|---------------|
| 1 | `01_xgb_lgb_ensemble.ipynb` | Trains XGBoost + LightGBM baseline; exports individual model files and ensemble weights | ~10–15 min |
| 2 | `02_hybrid_ensemble.ipynb` | K-Means clustering (8 segments) + per-cluster stacked Ridge/XGB/LGB/RF ensemble; hyperparameter search | ~30–60 min |
| 3 | `03_hybrid_prediction.ipynb` | Loads `hybrid_cluster_bundle.joblib`; runs inference on 8-field user input; bulk evaluation on test set | ~2 min |
| 4 | `04_publish_hf.ipynb` | *(Optional)* Uploads trained artifacts to Hugging Face | ~5 min |

> Notebook 3 is also the **sanity check** — it loads the saved bundle and scores a sample listing. Run it after notebook 2 to confirm the pipeline is working end-to-end before proceeding to the XAI layer.

**How to run in VS Code / JupyterLab:**
1. Open each notebook in order from `03_ml_layer_hybrid/`
2. Select kernel: `.venv/bin/python`
3. Run All Cells

### Expected outputs

```
03_ml_layer_hybrid/artifacts/
├── hybrid_cluster_bundle.joblib          # Main bundle: K-Means + all per-cluster models
├── hybrid_cluster_kmeans.joblib          # Fitted K-Means object
├── hybrid_cluster_models.joblib          # Per-cluster Ridge/XGB/LGB/RF models
├── hybrid_cluster_feature_columns.json   # 77-column feature list (used by inference)
├── hybrid_cluster_meta.json              # Training metadata, MAPE per cluster
├── hybrid_cluster_mape_comparison.png    # Visualization: baseline vs hybrid MAPE
├── xgb_model.joblib                      # Global XGBoost model (from notebook 1)
├── lgb_model.joblib                      # Global LightGBM model (from notebook 1)
├── ensemble_weights.joblib               # XGB/LGB blend weights
└── feature_columns.json                  # Feature list from notebook 1
```

### Quality benchmarks

| Model | Target MAPE | Indicator of success |
|-------|------------|----------------------|
| XGB/LGB ensemble (notebook 1) | ≤ 3.5% | Printed at end of notebook 1 |
| Hybrid cluster-routed (notebook 2) | ≤ 3.2% | Printed at end of notebook 2 |

If MAPE exceeds target, check that the latest feature table is being loaded (glob logic picks newest `YYYYMMDD` file).

### Using the inference API

```python
import sys
sys.path.insert(0, 'path/to/03_ml_layer_hybrid')
from yc_hybrid_inference import load_bundle, predict_from_user_input

bundle = load_bundle()   # auto-loads hybrid_cluster_bundle.joblib

result = predict_from_user_input(
    block='123', street_name='BEDOK NORTH AVE 1', town='BEDOK',
    flat_type='4 ROOM', floor_area_sqm=90.0,
    storey_range='07 TO 09', lease_commence_date=1990,
    sale_month='2024-01',
    bundle=bundle,
)
print(f"Predicted price: SGD {result['predicted_resale_price']:,.0f}")
```

### Common issues

| Issue | Fix |
|-------|-----|
| `FileNotFoundError` on feature CSVs | Run `00_download_data_from_HF.ipynb` to populate `hf_data/02_feature_layer/training/outputs/` |
| `ModuleNotFoundError: xgboost` | Install: `.venv/bin/pip install xgboost lightgbm` |
| Bundle not found in notebook 3 | Notebook 2 must complete successfully first; check `artifacts/hybrid_cluster_bundle.joblib` exists |
| MAPE much worse than benchmark | Verify temporal split (train year < 2023) and no data leakage |
