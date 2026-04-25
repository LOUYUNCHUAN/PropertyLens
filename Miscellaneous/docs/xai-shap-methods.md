# SHAP for the Hybrid Model — Three Approaches

PropertyLens uses a **Hybrid Cluster Ensemble** (Ridge + XGBoost + LightGBM + RandomForest, stacked via a linear meta-learner, trained per k-means cluster). Because no single SHAP technique is both fast *and* faithful to the whole stack, the repo ships three, each for a different job.

This doc explains how the **Composite TreeSHAP** approach works, then compares it against the two alternatives we tried.

---

## 1. The model being explained

```
           ┌─── Ridge ────┐
           ├─── XGB ──────┤
  input ──►│              ├──► meta-learner (Ridge) ──► price
           ├─── LGB ──────┤
           └─── RF ───────┘
```

- 4 base learners per cluster, routed via k-means on `cluster_cols`.
- Meta-learner coefficients `[w_ridge, w_xgb, w_lgb, w_rf]` and an intercept.
- Per-cluster bundles in `hybrid_cluster_bundle.joblib`; fallback to global models when a cluster is underpopulated.

Because the final prediction is a *linear* combination of four sub-models, the SHAP values of the whole ensemble equal the same linear combination of each sub-model's SHAP values — for the sub-models where SHAP is defined.

---

## 2. Composite TreeSHAP — how it works

Source: `notebooks/04_xai_layer/07_composite_treeshap.ipynb` (build) and `07b_composite_treeshap_explain.ipynb` (interactive).

### Step 1 — route the row to a cluster

```python
Xc = X_row[:, cluster_feat_idx]
Xc_scaled = bundle["cluster_scaler"].transform(Xc)
k = bundle["kmeans"].predict(Xc_scaled)[0]
```

Pick that cluster's `(xgb, lgb, rf, meta)` bundle, or fall back to the global bundle if the cluster was marked fallback at training time.

### Step 2 — exact TreeSHAP per tree learner

For each of XGB, LGB, RF, run **TreeSHAP** (`shap.TreeExplainer`) to get per-feature attributions for this row:

```python
sv_xgb = exp["xgb"](X_row).values[0]   # shape (n_features,)
sv_lgb = exp["lgb"](X_row).values[0]
sv_rf  = exp["rf"](X_row).values[0]
```

TreeSHAP is exact for tree models and runs in milliseconds because it traverses tree structure directly instead of sampling coalitions.

> **XGB caveat:** newer XGBoost versions serialize `base_score` as a string that trips `shap.TreeExplainer`. The notebook uses a custom `XGBPredContribsExplainer` that calls `Booster.predict(..., pred_contribs=True)` — XGBoost's native SHAP — sidestepping the parse issue. Same fix lives in `backend/shap_local.py`.

### Step 3 — linearly combine using meta-learner weights

The meta-learner is a `Ridge` regressor whose `coef_` array is `[w_ridge, w_xgb, w_lgb, w_rf]`. Composite SHAP drops the Ridge term and weights the three tree-model attributions:

```python
composite_shap = w_xgb * sv_xgb + w_lgb * sv_lgb + w_rf * sv_rf
base_value     = w_xgb * E_xgb  + w_lgb * E_lgb  + w_rf * E_rf  + meta_intercept
```

Because the meta-learner is linear, this combination is mathematically correct *for the tree part of the ensemble*. The residual error is exactly the Ridge base learner's contribution (plus any off-linear behavior), which is typically small.

### Example output (from `07b`)

```
Prediction:              $434,376
Base + SHAP sum:         $439,143
Approximation error:     $4,767   (~1.1%)
Compute time:            53.5 ms
```

The ~$4.7k gap is the Ridge component's contribution — intentionally ignored for speed. When the meta-learner's Ridge coefficient is close to 0 (as it is for cluster 1: `w_ridge = -0.0113`), the error is negligible.

---

## 3. The three methods, side by side

| | **TreeSHAP (XGB only)** | **Composite TreeSHAP** | **KernelSHAP (full hybrid)** |
|---|---|---|---|
| Notebook | `05_hybrid_xai_explain` | `07_composite_treeshap` / `07b` | `06_kernel_shap` / `06b` |
| What it explains | only the XGB base learner | XGB + LGB + RF weighted by meta-learner (Ridge excluded) | the entire hybrid, treated as a black box |
| Exactness | exact for XGB; **ignores the other 3 models** | exact per tree; **exact for the tree part** of the linear meta combo | approximate — sampling-based |
| Time per row | ~1 ms | **~5–50 ms** | **~400 s** at `nsamples=500` |
| `base + Σshap == prediction`? | no (off by LGB+RF+Ridge contribution) | near-equal (off by Ridge contribution only) | yes (within sampling noise) |
| Handles Ridge | ignored | ignored | included |
| Handles nonlinear meta-learner | n/a | **breaks** — composite only holds if meta is linear | handles any meta-learner |
| Artifacts consumed | `shap_explainers.joblib` (XGB only) | `shap_explainers.joblib` (per-cluster XGB+LGB+RF) | `kernel_shap_values.joblib` (background + expected value) |
| Good for | quick single-tree sanity check | **production UI, backend `/api/explain/shap`, batch jobs** | validation / ground truth, debugging unexpected predictions |

### Coverage claim in plain numbers

On the example property in `07b`:

```
XGBoost total SHAP    × w_xgb  =  $25,827 × 0.9709  =  $25,076
LightGBM total SHAP   × w_lgb  =  $26,360 × 0.3581  =   $9,441
RandomForest total    × w_rf   =  $32,180 × -0.2137 =  -$6,876
                                                      --------
Composite total                                      =  $27,641
```

The composite is dominated by XGB (`w_xgb ≈ 0.97`), so naïve "TreeSHAP on XGB only" (`05`) captures most of the signal for *this* cluster — but the RF term has a **negative** meta weight, meaning XGB-only explanations will systematically overstate positive contributions. That's the kind of drift Composite TreeSHAP fixes.

---

## 4. When to use which

- **Serving live explanations in the Buyer/Seller UI** → Composite TreeSHAP. Milliseconds per call, exact for the tree stack, fits inside a FastAPI request.
- **"Did my fast SHAP implementation lie?"** → KernelSHAP on a batch of rows, offline. If `06`'s output and `07`'s output agree within a few percent across many rows, the composite approach is validated for that model version.
- **Quick one-off or debugging a single XGB tree path** → TreeSHAP on XGB only. Fastest, but remember it's explaining one of four base learners, not the ensemble.
- **Whenever you swap the meta-learner for something non-linear** → Composite TreeSHAP's math no longer holds. Either keep the meta-learner linear or fall back to KernelSHAP.

---

## 5. Known gotchas

- **Two bundles on disk.** `notebooks/03_ml_layer_hybrid/artifacts/` has a 70-feature bundle; `data/artifacts/` has a 77-feature bundle used by the FastAPI backend. SHAP artifacts must be computed against the same bundle that serves predictions, or the feature vector and the SHAP values will silently misalign. Pick one canonical bundle.
- **Cluster routing must match.** If training-time k-means and inference-time k-means disagree on cluster assignment (e.g., due to a scaler mismatch), the row will get SHAP from the wrong cluster's trees. The bundle stores both `cluster_scaler` and `kmeans` — use them together.
- **XGB `base_score` string bug.** Use the `XGBPredContribsExplainer` shim (or `backend/shap_local.py`) on XGBoost ≥ 2.x; don't call `shap.TreeExplainer(xgb_model)` directly.
- **Approximation error ≠ bug.** `base + Σshap ≠ prediction` by up to a few percent is expected for Composite TreeSHAP — that gap *is* the ignored Ridge component. If the gap is large (>5%), check the meta-learner weights: a high `|w_ridge|` cluster should use KernelSHAP instead.
