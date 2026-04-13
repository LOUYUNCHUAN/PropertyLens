# XAI Layer — Explainability Artifacts & Per-Listing Explanations

Builds post-hoc explainability for the hybrid cluster model: SHAP feature attributions, LIME local rules, surrogate decision trees, Apriori association rules, and case-based reasoning (CBR) neighbours.

---

## Quick Start

> **Requires Layer 03 to be complete first** — `03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib` must exist.

**STEP 1.** Open `04_hybrid_xai_train.ipynb` — kernel: `.venv/bin/python` — Run All Cells *(~15–30 min)*
→ Trains SHAP explainers, LIME samples, surrogate trees, Apriori rules, and CBR index
→ Saves everything to `03_ml_layer_hybrid/artifacts/hybrid_xai/`

**STEP 2.** Open `05_hybrid_xai_explain.ipynb` — Run All Cells *(~1–2 min)*
→ Edit the listing input in the notebook, then run to get a full explanation:
SHAP drivers · LIME local rule · surrogate decision path · CBR neighbours

**Done.** Re-run Step 2 any time with a different listing — Step 1 only needs to run once.

---

## How to Run

### Prerequisites

1. **Layer 03 artifacts present** — `03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib` must exist (run Layer 03 notebooks 1 and 2 first)
2. **Feature tables available** — in `hf_data/02_feature_layer/training/outputs/` or `02_feature_layer/training/outputs/`
3. Python environment: `.venv/bin/python` (set as the notebook kernel)

### Notebooks (run in order)

| # | Notebook | What it does | Runtime |
|---|----------|--------------|---------|
| 1 | `04_hybrid_xai_train.ipynb` | Trains all XAI artifacts: SHAP TreeExplainers (per cluster), LIME surrogate samples, decision tree surrogates, Apriori rules, CBR index | ~15–30 min |
| 2 | `05_hybrid_xai_explain.ipynb` | Generates full explanation for a single listing: SHAP attribution, LIME rule, surrogate decision path, matching Apriori rules, CBR neighbours, what-if deltas | ~1–2 min |

**How to run in VS Code / JupyterLab:**
1. Open each notebook from `04_xai_layer/`
2. Select kernel: `.venv/bin/python`
3. Run All Cells

> Notebook 1 only needs to run once (or after retraining Layer 03). Notebook 2 can be re-run interactively for any listing.

### Expected outputs

All artifacts are written into `03_ml_layer_hybrid/artifacts/hybrid_xai/`:

```
03_ml_layer_hybrid/artifacts/hybrid_xai/
├── shap_explainer_cluster_<n>.joblib    # SHAP TreeExplainer per K-Means cluster
├── lime_training_sample.csv             # Background data sample for LIME
├── surrogate_tree_cluster_<n>.joblib    # Decision tree surrogate per cluster
├── apriori_rules_YYYYMMDD.json          # Association rules (price tier → feature combos)
└── cbr_index_YYYYMMDD.joblib            # Case-based reasoning lookup index
```

### Reading explanation output (notebook 2)

Notebook 2 prints a structured explanation for each listing:

```
Predicted price    : SGD 550,000
Cluster assigned   : 3

SHAP top drivers:
  floor_area_sqm        +$42,300   (larger flat → higher)
  dist_nearest_mrt_km   −$18,100   (far from MRT → lower)
  lease_remaining_years  +$12,400

LIME local rule:
  floor_area_sqm > 85 AND dist_mrt < 0.8 → predicted ≈ $550k

Surrogate path:
  floor_area > 85 → town_BEDOK = 1 → lease > 60 → $552k

CBR neighbours (3 most similar):
  Block 45 Bedok N Rd, 4-room, 88sqm, $548k (2024-03)
  Block 67 Bedok N Rd, 4-room, 91sqm, $561k (2024-02)
```

### Common issues

| Issue | Fix |
|-------|-----|
| `FileNotFoundError: hybrid_cluster_bundle.joblib` | Run `03_ml_layer_hybrid/02_hybrid_ensemble.ipynb` first |
| `ModuleNotFoundError: shap` | Install: `.venv/bin/pip install shap lime mlxtend` |
| SHAP explainer very slow | Normal for first run — explainers are then cached in `hybrid_xai/` |
| Apriori produces no rules | Lower `min_support` threshold in notebook 1 (default 0.05) |
| CBR returns wrong neighbours | Verify feature columns match those used in model training (`hybrid_cluster_feature_columns.json`) |
