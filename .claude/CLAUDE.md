# Project PropertyLens

## Overview

PropertyLens is an **NUS-ISS IRS Practice Module** project: **explainable AI for Singapore HDB resale price transparency**. The codebase is organized as a **layered pipeline** (not a monolithic app):

1. **Data layer** — raw HDB transactions, schools, geospatial / POI enrichment (`01_data_layer/`).
2. **Feature layer** — engineered ML tables, train/test splits (`02_feature_layer/`; snapshots also under `hf_data/02_feature_layer/training/outputs/`).
3. **Modelling layer** — XGB/LGB ensemble, cluster hybrid, inference (`03_ml_layer_hybrid/`).
4. **XAI layer** — SHAP, LIME, surrogate rules, Apriori, CBR (`04_xai_layer/`).

Orchestration is **notebook-driven**; [`yc_hybrid_inference.py`](03_ml_layer_hybrid/yc_hybrid_inference.py) is the main **Python module** for hybrid inference. See [`readme.md`](readme.md) for run order (including `00_download_data_from_HF.ipynb` first).

---

## Tech Stack

- **Language:** Python 3.10+ (typical for current notebooks).
- **Notebooks:** Jupyter / VS Code / Cursor notebook execution.
- **Core libs:** `pandas`, `numpy`, `scikit-learn`, `xgboost`, `lightgbm`, `joblib`, `matplotlib`.
- **XAI:** `shap`, `lime`, `mlxtend` (where used in XAI notebooks).
- **Data / env:** `python-dotenv`, `huggingface-hub` (HF downloads), `pathlib`.
- **Frontend / Backend / Database:** *Not applicable* — no web app or DB layer in this repo.
- **Testing:** No unified automated test suite; validation is primarily **notebooks** and layer READMEs. Prefer **small, explicit checks** (e.g. `python -c "…"`) when verifying paths or imports after changes.

---

## Coding Conventions & Rules

- Use **Python** with **PEP 8**-aligned style; **`snake_case`** for functions/variables, **`PascalCase`** for classes if any.
- **Match the surrounding file:** imports, spacing, and comment density should look like the existing notebook or `yc_hybrid_inference.py` author.
- Prefer **`pathlib.Path`** for filesystem paths; resolve **`REPO_ROOT`** as `cwd` if `hf_data/` exists **else** `cwd.parent` (pattern used across hybrid/XAI notebooks).
- **Feature data contract:** downstream code expects **`hf_data/02_feature_layer/training/outputs/`** with `hdb_feature_table_YYYYMMDD.csv` and aligned `hdb_feature_train_*` / `hdb_feature_test_*` (same date suffix). Prefer **latest-table snapshot** logic when adding loaders, not hard-coded dates.
- **Scoped changes only:** fix or extend what the user asked for; avoid drive-by refactors, unrelated file edits, or renaming public API symbols without updating **all** importers.
- **NEVER** commit **secrets** (`.env`, `HF_TOKEN`, OneMap keys). **NEVER** paste tokens into notebooks or markdown.
- **NEVER** delete or rewrite large notebook outputs / binary artefacts unless the user explicitly wants that cleanup.
- **NEVER** assume a **frontend** or **npm** workflow — this project does not use it.

---

## Project Structure (high level)

| Path | Role |
|------|------|
| `readme.md` | Human-facing overview and run order |
| `.env` | Local secrets (gitignored); not in repo |
| `00_download_data_from_HF.ipynb` | Populate `hf_data/` from Hugging Face |
| `hf_data/` | Downloaded feature-layer outputs (may be gitignored) |
| `01_data_layer/` | Raw data, `pipelines/*.ipynb`, `raw/` |
| `02_feature_layer/training/` | `FeatureDealing.ipynb`, `FeatureValidation.ipynb`, `outputs/` |
| `03_ml_layer_hybrid/` | Training notebooks, `yc_hybrid_inference.py`, `artifacts/` |
| `04_xai_layer/` | `04_hybrid_xai_train.ipynb`, `05_hybrid_xai_explain.ipynb`, `feature_labels.py` |
| `_backup_*` / other dirs | Legacy or backup; treat as **out of active pipeline** unless the user says otherwise |

---

## Commands (typical)

- **Install deps (per notebook):** run the notebook’s `%pip install …` cell, or  
  `pip install pandas numpy scikit-learn xgboost lightgbm shap lime joblib python-dotenv huggingface-hub` (adjust to task).
- **HF download:** open and run **`00_download_data_from_HF.ipynb`** from **repo root** with `HF_TOKEN` set.
- **Quick sanity check (example):**  
  `cd 03_ml_layer_hybrid && python -c "from yc_hybrid_inference import default_feature_table_csv; print(default_feature_table_csv())"`
- **Jupyter:** `jupyter lab` or `jupyter notebook` from repo root or the relevant subfolder (be aware **cwd** affects `Path.cwd()` in notebooks).

---

## Agent Workflow Hints

- **Read before editing:** open the target notebook cell or Python file; align with existing patterns (`load_bundle`, `predict_price`, `build_yc_hybrid_vector`, etc.).
- **Cross-layer edits:** changing artefact paths or filenames may require updates in **03** and **04** and **`readme.md`**; grep for old names.
- **Markdown / docs:** do not create new `.md` files unless the user asks; **`readme.md`** is the main project doc.
- **Git:** use clear commit messages; do not commit `.env` or huge CSV/joblib unless the repo policy allows.

---

## Quality Bar

- **Correctness over volume:** small, reviewable diffs; no unrelated formatting sweeps across notebooks.
- **Paths:** after path changes, verify from both **repo root** and **`03_ml_layer_hybrid/`** cwd where notebooks support both.
- **Reproducibility:** when suggesting new dependencies, pin or note versions if the user cares about strict replay.
- **Tests:** if you add **pytest** or scripts later, document the command here; until then, rely on notebook runs and explicit smoke checks.
