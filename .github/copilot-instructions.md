# PropertyLens — Workspace Instructions

**Project:** Explainable AI for Singapore HDB Resale Price Transparency (NUS-ISS IRS Practice Module)  
**Timezone:** SGT (Singapore) | **Codebase Date:** 2026-04-12  
**Contact:** Transparent AI Group (Kumar Bhuvesh, Lou Yunchuan, Chi Thra Rekha)

---

## 1. Project Overview

PropertyLens is a **layered, notebook-driven pipeline** that transforms public HDB transaction data and geospatial enrichment into **explainable price predictions**. The architecture follows a **strict execution order** and uses **date-stamped artefacts** for versioning and reproducibility.

### 4-Layer Architecture

```
┌─────────────────────────────────────────────────────┐
│ 04_xai_layer/                                       │
│ Explainability (SHAP, LIME, surrogate rules, CBR)  │
└──────────────────-────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│ 03_ml_layer_hybrid/                                 │
│ Models (XGB/LGB ensemble, K-Means cluster routing) │
└─────────────────────────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│ 02_feature_layer/                                   │
│ Feature Engineering (73 total, 22 core + 51 OHE)   │
└─────────────────────────────────────────────────────┘
                         ↑
┌─────────────────────────────────────────────────────┐
│ 01_data_layer/                                      │
│ Raw Data (HDB transactions, schools, geo/POI)      │
└─────────────────────────────────────────────────────┘
```

---

## 2. Recommended Run Sequence

**First time setup:**
1. **Step 0:** [`00_download_data_from_HF.ipynb`](00_download_data_from_HF.ipynb) — Download feature snapshots from Hugging Face (run from **repo root**)
   - Requires: `HF_TOKEN` in `.env`
   - Populates: `hf_data/02_feature_layer/training/outputs/` with latest feature tables

2. **Step 1** (optional): Refresh raw data via [`01_data_layer/pipelines/`](01_data_layer/pipelines/)
   - [`raw_data_collection.ipynb`](01_data_layer/pipelines/raw_data_collection.ipynb) — OneMap geocoding, POI enrichment
   - [`raw_data_sanity_check.ipynb`](01_data_layer/pipelines/raw_data_sanity_check.ipynb) — Validation, deduplication, lease imputation

3. **Step 2** (optional): Rebuild features via [`02_feature_layer/training/`](02_feature_layer/training/)
   - [`FeatureDealing.ipynb`](02_feature_layer/training/FeatureDealing.ipynb) — Engineering pipeline
   - [`FeatureValidation.ipynb`](02_feature_layer/training/FeatureValidation.ipynb) — Quality diagnostics

4. **Step 3:** Train models via [`03_ml_layer_hybrid/`](03_ml_layer_hybrid/) **in order**:
   - [`01_xgb_lgb_ensemble.ipynb`](03_ml_layer_hybrid/01_xgb_lgb_ensemble.ipynb) — XGB + LGB baseline
   - [`02_hybrid_ensemble.ipynb`](03_ml_layer_hybrid/02_hybrid_ensemble.ipynb) — K-Means cluster routing, stacked models
   - [`03_hybrid_prediction.ipynb`](03_ml_layer_hybrid/03_hybrid_prediction.ipynb) — Inference, bulk evaluation

5. **Step 4:** Train XAI artefacts via [`04_xai_layer/`](04_xai_layer/) **in order**:
   - [`04_hybrid_xai_train.ipynb`](04_xai_layer/04_hybrid_xai_train.ipynb) — Train surrogate models, Apriori rules
   - [`05_hybrid_xai_explain.ipynb`](04_xai_layer/05_hybrid_xai_explain.ipynb) — Per-listing attributions

---

## 3. Core Coding Conventions

### Path Resolution
- **Always use `pathlib.Path`** for filesystem operations.
- **Resolve `REPO_ROOT`** as:
  ```python
  from pathlib import Path
  cwd = Path.cwd()
  REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
  ```
- This pattern works whether you run from **repo root** or a **subfolder** (e.g. `03_ml_layer_hybrid/`).

### Naming & Versioning
- **Date-stamped artefacts:** Use `YYYYMMDD` suffix (e.g. `hdb_feature_table_20260403.csv`)
- **Variable names:** `snake_case` for functions/variables; `PascalCase` for classes (rare in this codebase)
- **Imports:** Organize as `stdlib`, `third-party`, `local` (per PEP 8)

### Secrets Management
- **Never commit `.env` or tokens** to version control.
- **Required `.env` keys:**
  ```
  HF_TOKEN=<your_hugging_face_api_token>
  ONEMAP_API_KEY=<your_onemap_credentials>
  ```
- Use `python-dotenv`: `from dotenv import load_dotenv; load_dotenv()`

### Feature Data Contract
Downstream code expects **`hf_data/02_feature_layer/training/outputs/`** with:
- `hdb_feature_table_*.csv` — Full deduplicated dataset (260,699 rows × 73 columns)
- `hdb_feature_train_*.csv` — Training split, year < 2023 (178,589 rows)
- `hdb_feature_test_*.csv` — Test split, year ≥ 2023 (82,110 rows)
- `feature_metadata_*.json` — Metadata export

**Schema overview:**
- **Target:** `resale_price` (SGD)
- **Time:** `transaction_year`, `month_dt`
- **ID:** `address_key`
- **Core features (22):** location, lease, floor area, rooms, level, distances to MRT/highways/schools/food/malls, etc.
- **One-hot encoded (51):** town, flat_type, flat_model, school_cluster, etc.

### Artefact Locations
| Layer | Key Artefacts | Location |
|-------|---------------|----------|
| **01_data_layer** | Raw CSVs (HDB, schools, geo) | `01_data_layer/raw/` |
| **02_feature_layer** | Feature tables, metadata | `02_feature_layer/training/outputs/` or `hf_data/02_feature_layer/training/outputs/` |
| **03_ml_layer_hybrid** | Models, bundles, inference module | `03_ml_layer_hybrid/artifacts/`, `yc_hybrid_inference.py` |
| **04_xai_layer** | SHAP values, surrogate models, rules | `04_xai_layer/artifacts/` (created after training) |

---

## 4. Common Workflows

### Running a Single Notebook
```bash
cd /path/to/notebook
jupyter notebook notebook_name.ipynb
```

### Checking Paths Are Correct
```bash
python -c "from pathlib import Path; cwd = Path.cwd(); REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent; print(REPO_ROOT / 'hf_data/02_feature_layer/training/outputs')"
```

### Quick Import Test (ML Layer)
```bash
cd 03_ml_layer_hybrid
python -c "from yc_hybrid_inference import default_feature_table_csv, load_bundle; print(default_feature_table_csv())"
```

### Validating Feature Schema
```bash
python -c "
import pandas as pd
from pathlib import Path
df = pd.read_csv('hf_data/02_feature_layer/training/outputs/hdb_feature_table_20260403.csv')
print(f'Shape: {df.shape}')
print(f'Columns: {df.columns.tolist()}')
print(f'Target stats: {df[\"resale_price\"].describe()}')
"
```

---

## 5. Quality & Testing Standards

### Data Validation

#### Critical Feature Checks (NEW)
- **No Empty Values:** All engineered features must have values for every property (0% nulls in core features)
- **Sufficient Variability:** Different properties must have different feature values
  - Red flag: If a feature has < 1% unique values, it's almost all the same value (zero discriminative power)
  - Red flag: If a feature has only 1 unique value, remove it or investigate
- **One-Hot Encoding:** Each categorical must have exactly 1 = 1 per row (mutual exclusivity)

#### Standard Checks
- **Train/Test Leakage:** Ensure temporal split (year < 2023 for train, ≥ 2023 for test). Never mix.
- **Duplicates:** Check for duplicate rows and addresses; log removal counts.
- **Nulls:** Verify zero missing values in critical columns (`resale_price`, `transaction_year`, `address_key`).
- **Price Outliers:** Expected range ~$140k–$1.7M; flag anomalies.

### Model Benchmarks
- **Baseline (XGB ensemble):** MAPE ≤ 3.5% on test set
- **Hybrid (cluster-routed):** MAPE ≤ 3.2% on test set (improvement expected)
- **Log:** Report metrics in notebook cells (markdown + code cell with `print(f"MAPE: {mape:.4f}")`)

### XAI Validation
- **SHAP:** Consistency (same feature, same direction across similar listings)
- **LIME:** Local rule stability (repeat runs should yield similar rules for same listing)
- **Surrogates:** Decision tree max depth ≤ 5 for interpretability; report fidelity to original model
- **CBR:** Case distance metric should align with feature importance

### Reproducibility
- **Pin versions** in notebooks if critical (e.g. `xgboost==2.0.3`)
- **Document data cutoff date** (e.g. "Feature table as of 2026-04-03")
- **Save artefacts with metadata:** Include training date, feature schema version, hyperparameters

---

## 6. Layer-Specific Guidance

See layer-specific instructions for deeper workflows:
- [01_data_layer/](01_data_layer/) — [`.github/instructions/01-data-layer.md`](.github/instructions/01-data-layer.md)
- [02_feature_layer/](02_feature_layer/) — [`.github/instructions/02-feature-layer.md`](.github/instructions/02-feature-layer.md)
- [03_ml_layer_hybrid/](03_ml_layer_hybrid/) — [`.github/instructions/03-ml-layer-hybrid.md`](.github/instructions/03-ml-layer-hybrid.md)
- [04_xai_layer/](04_xai_layer/) — [`.github/instructions/04-xai-layer.md`](.github/instructions/04-xai-layer.md)

---

## 7. Critical Reminders

⚠️ **DO NOT:**
- Commit `.env` or API tokens to the repo
- Delete or rewrite large notebook outputs without explicit user request
- Assume a frontend or npm workflow (this is a data/ML pipeline only)
- Make unrelated refactors (scoped changes only)
- Hard-code artefact dates; use **latest-table snapshot logic** instead
- create python virtual environments.

✅ **DO:**
- Match the surrounding file's style (imports, spacing, comments)
- Use **date-stamped filenames** for all new artefacts
- Cross-reference layer READMEs when changing artefact paths
- Verify paths from both **repo root** and **layer subdirectory** cwd
- Log key metrics and sample outputs in notebook cells
- ask me which python virtual environment to use if you need to run code locally.

---

## 8. References

- [Project README](readme.md)
- [Data Layer README](01_data_layer/README.md)
- [Feature Layer README](02_feature_layer/README.md)
- [Inference Module](03_ml_layer_hybrid/yc_hybrid_inference.py)
- [Architecture Overview](00_project_docs/architecture_overview.md)
