# PropertyLens

**Explainable AI for Singapore HDB resale price transparency** — NUS-ISS Intelligent Reasoning Systems Practice Module (Group: **Transparent AI**).

This repository implements a layered pipeline: public and geospatial data → engineered features → hybrid ML models → post-hoc explainability (SHAP, LIME, surrogate rules, CBR, etc.).

---

## How to run this repo (order matters)

### Step 0 — Download feature snapshots from Hugging Face (do this first)

**Run:** [`00_download_data_from_HF.ipynb`](00_download_data_from_HF.ipynb) from the **repository root** (so paths resolve correctly).

- **Purpose:** Pulls the latest published **feature-layer** artefacts from the Hugging Face dataset into your local tree.
- **Credentials:** Set `HF_TOKEN` in a root [`.env`](.env) file (see notebook; it uses `python-dotenv`).
- **Default dataset:** `PropertyLens/Resealeflats` (dataset repo).
- **Local output:** files land under **`hf_data/`**, mirroring the layout expected downstream, e.g.  
  **`hf_data/02_feature_layer/training/outputs/`**  
  (CSV tables such as `hdb_feature_table_*.csv`, `hdb_feature_train_*.csv`, `hdb_feature_test_*.csv`, plus metadata).

The **modelling** and **inference** notebooks in [`03_ml_layer_hybrid/`](03_ml_layer_hybrid/) are wired to resolve the **latest** `hdb_feature_table_*.csv` date suffix under that folder and matching train/test files — so keeping `hf_data` up to date via Step 0 is the recommended way to stay aligned with published snapshots.

### Step 1 — (Optional) Refresh raw data and rebuild features locally

If you are **not** using only the HF snapshots, use the data and feature layers documented below to collect raw inputs and regenerate `02_feature_layer/training/outputs/` yourself.

### Step 2 — Train / evaluate models

Open and run the notebooks in [`03_ml_layer_hybrid/`](03_ml_layer_hybrid/) in logical order (see [§4 Modelling](#4-modelling-hybrid-ml-layer)).

### Step 3 — Train / run XAI artefacts

After the hybrid bundle exists under `03_ml_layer_hybrid/artifacts/`, run [`04_xai_layer/04_hybrid_xai_train.ipynb`](04_xai_layer/04_hybrid_xai_train.ipynb) then [`04_xai_layer/05_hybrid_xai_explain.ipynb`](04_xai_layer/05_hybrid_xai_explain.ipynb).

---

## 1. Introduction (project vision)

*Summarised from the group proposal: **PropertyLens — Explainable AI for Singapore HDB Resale Price Transparency** (IRS Practice Module, 2026).*

Singapore’s HDB resale market is highly active, but listing portals (e.g. [PropertyGuru](https://www.propertyguru.com.sg/)) typically show only basic attributes — floor area, town, storey band, remaining lease, etc. Actual transacted prices are influenced by many **additional** factors: distance to MRT, school quality, malls, food centres, highway proximity (noise/access), and broader neighbourhood signals.

**PropertyLens** aims to:

1. **Predict** HDB resale prices using a **rich, engineered feature set** grounded in **government transaction records** ([data.gov.sg](https://data.gov.sg/)) rather than volatile asking prices alone.
2. **Explain** predictions with **XAI**: per-listing attributions (e.g. SHAP, LIME), interpretable surrogates (e.g. decision-tree rules), association patterns (e.g. Apriori), and case-based comparables — so a buyer can see **which factors drive a given price**.
3. **Support discovery** (roadmap in the proposal): intelligent listing search with trade-off explanations, and a **conversational layer** (tool-calling) to ask questions such as why one flat trades higher than another.

**Gaps the proposal highlights vs typical portals:** limited **search granularity** on derived signals; lack of **per-listing** (not only global) **price explainability**; commercial AVMs often remain **black-box** relative to per-feature decomposition.

**Group (proposal):** Transparent AI — Kumar Bhuvesh, Lou Yunchuan, Chi Thra Rekha (NUS-ISS).

---

## 2. Data layer

**Path:** [`01_data_layer/`](01_data_layer/) — full checkpoint documentation: [`01_data_layer/README.md`](01_data_layer/README.md).

### Role

Stores **raw**, versioned inputs for the rest of the pipeline: HDB resale transactions, MOE school metadata, and **geospatial / POI** enrichment (OneMap and related exports).

### Layout (high level)

| Area | Purpose |
|------|---------|
| `01_data_layer/raw/ResaleFlatPrices/` | HDB resale CSVs from data.gov.sg (registration-date series), merged/cleaned with date suffixes |
| `01_data_layer/raw/schools/` | MOE general information of schools (+ supporting competition datasets) |
| `01_data_layer/raw/google_geo/` | Geocoded HDB blocks, highway distances, accessibility/noise features, transit nodes, malls, hawkers, school coordinates |

### Notebooks

| Notebook | Role |
|----------|------|
| [`pipelines/raw_data_collection.ipynb`](01_data_layer/pipelines/raw_data_collection.ipynb) | End-to-end collection: HDB refresh, OneMap geocoding (batched, checkpointed), POI pulls, derived geo features |
| [`pipelines/raw_data_sanity_check.ipynb`](01_data_layer/pipelines/raw_data_sanity_check.ipynb) | Validation, duplicates, missing lease imputation, backups |

### Quality practices (see layer README)

- Date-stamped filenames (`*_YYYYMMDD`) for lineage.
- Duplicate removal and **remaining lease** derivation where the source omits it.
- OneMap token handling via `.env` (`ONEMAP_API_KEY`, etc.).

---

## 3. Feature layer

**Path:** [`02_feature_layer/`](02_feature_layer/) — full specification: [`02_feature_layer/README.md`](02_feature_layer/README.md).

### Role

Turns raw transactions + geo/school inputs into **ML-ready tables**: deduplication, **11-factor** engineering (floor/lease/size/rooms, MRT, highways, food, malls, schools/primary quality signals), **one-hot** encodings for town / flat type / flat model, and **temporal** train/test exports.

### Main notebooks

| Notebook | Role |
|----------|------|
| [`training/FeatureDealing.ipynb`](02_feature_layer/training/FeatureDealing.ipynb) | Primary feature engineering pipeline |
| [`training/FeatureValidation.ipynb`](02_feature_layer/training/FeatureValidation.ipynb) | Quality checks and diagnostics |

### Typical outputs (`training/outputs/`)

| Artefact | Description |
|----------|-------------|
| `hdb_feature_table_*.csv` | Full deduplicated feature matrix |
| `hdb_feature_train_*.csv` | Training split (time-based; see layer README) |
| `hdb_feature_test_*.csv` | Hold-out split |
| `feature_metadata_*.json` | Export metadata |

**Downstream contract:** hybrid notebooks and `yc_hybrid_inference.py` expect the **feature-layer schema** (numeric + one-hot columns, target `resale_price`, time via `transaction_year`, id via `address_key`). When you use **HF downloads**, these files live under **`hf_data/02_feature_layer/training/outputs/`** with the same naming pattern.

---

## 4. Modelling (hybrid ML layer)

**Path:** [`03_ml_layer_hybrid/`](03_ml_layer_hybrid/)

### Role

Trains and packages **ensemble** and **cluster-routed hybrid** models on the feature tables, saves artefacts under `03_ml_layer_hybrid/artifacts/`, and provides **inference** helpers for a small set of user-facing fields.

### Notebooks (recommended flow)

| Order | Notebook | Purpose |
|-------|----------|---------|
| 1 | [`01_xgb_lgb_ensemble.ipynb`](03_ml_layer_hybrid/01_xgb_lgb_ensemble.ipynb) | XGBoost + LightGBM ensemble baseline; temporal train/val/test; saves weights and models under `artifacts/` |
| 2 | [`02_hybrid_ensemble.ipynb`](03_ml_layer_hybrid/02_hybrid_ensemble.ipynb) | K-Means segmentation (time-safe), per-cluster stacked models + global baselines; writes **`hybrid_cluster_bundle.joblib`** and related cluster artefacts |
| 3 | [`03_hybrid_prediction.ipynb`](03_ml_layer_hybrid/03_hybrid_prediction.ipynb) | Load bundle + [`yc_hybrid_inference.py`](03_ml_layer_hybrid/yc_hybrid_inference.py) for **8-field** listing input and bulk evaluation |
| — | [`04_publish_hf.ipynb`](03_ml_layer_hybrid/06_publish_hf.ipynb) | Optional: upload selected artefacts to Hugging Face |

### Key artefacts (under `03_ml_layer_hybrid/artifacts/`)

Examples: `hybrid_cluster_bundle.joblib`, `hybrid_cluster_feature_columns.json`, `feature_columns.json`, optional `hybrid_xai/` after the XAI train notebook.

### Data paths in notebooks

Training notebooks resolve **`REPO_ROOT`** (repo root vs `03_ml_layer_hybrid/` cwd) and load the **latest** `hdb_feature_table_*.csv` (and aligned train/test) from **`hf_data/02_feature_layer/training/outputs/`** unless you change paths.

### Inference module

[`yc_hybrid_inference.py`](03_ml_layer_hybrid/yc_hybrid_inference.py) — loads the hybrid bundle, builds feature vectors from address lookup + overrides, and runs `predict_price`. Default feature table path uses the same **`hf_data`** outputs.

---

## 5. Explainability (XAI layer)

**Path:** [`04_xai_layer/`](04_xai_layer/)

### Role

Builds **explanation artefacts** for the cluster hybrid (SHAP TreeExplainers per cluster + global XGB, LIME tabular explainer, surrogate tree + rules JSON, Apriori-related exports, CBR index + training parquet). Consumes the bundle from **`03_ml_layer_hybrid/artifacts/`** and writes under **`03_ml_layer_hybrid/artifacts/hybrid_xai/`** (same artefact tree as training).

### Notebooks

| Notebook | Purpose |
|----------|---------|
| [`04_hybrid_xai_train.ipynb`](04_xai_layer/04_hybrid_xai_train.ipynb) | Train/save XAI payloads (requires bundle from **02** hybrid ensemble) |
| [`05_hybrid_xai_explain.ipynb`](04_xai_layer/05_hybrid_xai_explain.ipynb) | Load artefacts; SHAP/LIME/surrogate/CBR plots and tables for edited listings |

### Helper

[`feature_labels.py`](04_xai_layer/feature_labels.py) — human-readable names for feature columns in plots and printed explanations.

---

## Repository layout (active paths)

```text
PropertyLens/
├── readme.md                          # This file
├── .env                               # HF_TOKEN, OneMap keys (not committed)
├── 00_download_data_from_HF.ipynb    # Step 0: populate hf_data/ from HF
├── hf_data/                           # Downloaded / mirrored feature outputs (gitignored if large)
│   └── 02_feature_layer/training/outputs/
├── 01_data_layer/                     # Raw data + collection notebooks
├── 02_feature_layer/                  # Feature engineering notebooks + local outputs
├── 03_ml_layer_hybrid/                # Hybrid ML + inference + artifacts/
├── 04_xai_layer/                      # XAI train + explain notebooks
└── …                                  # Other docs / legacy folders as present
```

---

## Environment notes

- **Python:** use a virtualenv; notebooks assume common scientific stack (`pandas`, `numpy`, `scikit-learn`, `xgboost`, `lightgbm`, `shap`, `lime`, etc. — see individual notebooks’ `%pip` cells).
- **Secrets:** keep tokens in **`.env`** at repo root; do not commit secrets.

---

## Acknowledgements

- **Data:** [data.gov.sg](https://data.gov.sg/), MOE / NEA / OneMap-related open data as described in [`01_data_layer/README.md`](01_data_layer/README.md).
- **Proposal framing:** NUS-ISS IRS Practice Module — PropertyLens / Transparent AI (2026).

---

## References (from proposal)

- Hedonic pricing and gradient-boosted models on tabular property data; Singapore HDB-related open projects cited in the proposal (e.g. teyang-lau/HDB_Resale_Prices, JackFongNew/Singapore-HDB-Resale-Price-Prediction, hengbl/HDB-Resale-Price-Prediction).
- **XAI:** SHAP, LIME; surrogate trees; Apriori-style pattern summaries; CSP framing for search (roadmap).
- **Embeddings / “vibe”:** proposal discusses block-level embeddings as a direction; current hybrid notebooks in this repo focus on the **engineered tabular** feature set unless extended separately.
