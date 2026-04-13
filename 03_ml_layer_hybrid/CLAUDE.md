# ML Layer (Hybrid) Instructions

**Scope:** `03_ml_layer_hybrid/` ensemble model training, hybrid cluster routing, and inference  
**Key Notebooks (run in order):**
- `01_xgb_lgb_ensemble.ipynb` — XGB + LGB baseline
- `02_hybrid_ensemble.ipynb` — K-Means + cluster-routed stacking
- `03_hybrid_prediction.ipynb` — Inference & bulk evaluation
- `04_publish_hf.ipynb` — Optional HF upload

**Inference Module:** `yc_hybrid_inference.py`  
**Reference:** Artefacts under `artifacts/` | [Root Instructions](../CLAUDE.md)

---

## 1. Role & Artefacts

**Purpose:** Train ensemble models (XGB + LGB), segment with K-Means clustering, build per-cluster stacked models, and provide inference helpers for 8-field HDB listing inputs.

**Key Artefacts:**
- `artifacts/xgb_model_*.joblib` — XGBoost trained weights
- `artifacts/lgb_model_*.joblib` — LightGBM trained weights
- `artifacts/hybrid_cluster_bundle.joblib` — K-Means + per-cluster ridge/regression models
- `artifacts/hybrid_cluster_feature_columns.json` — Feature column list for inference
- `artifacts/feature_columns.json` — Original feature list from feature layer
- `artifacts/hybrid_xai/` — XAI artefacts (created after 04_xai_layer runs)

**Benchmark Targets:**
- **Baseline (XGB ensemble):** MAPE ≤ 3.5% on test set
- **Hybrid (cluster-routed):** MAPE ≤ 3.2% on test set

---

## 2. Notebook Sequence & Workflow

### Step 1: XGB/LGB Ensemble Baseline (`01_xgb_lgb_ensemble.ipynb`)

**Inputs:** Feature tables from `hf_data/02_feature_layer/training/outputs/`

**Outputs:** `artifacts/feature_columns.json`, `artifacts/xgb_model_*.joblib`, `artifacts/lgb_model_*.joblib`

```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
feature_path = REPO_ROOT / 'hf_data/02_feature_layer/training/outputs'

# Load latest feature tables (never hard-code dates)
latest_table = sorted(feature_path.glob('hdb_feature_table_*.csv'))[-1]
date_part = latest_table.stem.split('_')[-1]
df_train = pd.read_csv(feature_path / f'hdb_feature_train_{date_part}.csv')
df_test  = pd.read_csv(feature_path / f'hdb_feature_test_{date_part}.csv')

feature_cols = [c for c in df_train.columns
                if c not in ['resale_price', 'transaction_year', 'month_dt', 'address_key']]

from xgboost import XGBRegressor
from lightgbm import LGBMRegressor
from sklearn.metrics import mean_absolute_percentage_error

xgb = XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)
lgb = LGBMRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)

xgb.fit(df_train[feature_cols], df_train['resale_price'])
lgb.fit(df_train[feature_cols], df_train['resale_price'])

print(f"XGB MAPE: {mean_absolute_percentage_error(df_test['resale_price'], xgb.predict(df_test[feature_cols])):.4f}")
print(f"LGB MAPE: {mean_absolute_percentage_error(df_test['resale_price'], lgb.predict(df_test[feature_cols])):.4f}")
```

**Validation:**
- [ ] MAPE ≤ 3.5%
- [ ] No train/test data leakage
- [ ] Feature columns exported to JSON
- [ ] Models saved under `artifacts/`

---

### Step 2: Hybrid Ensemble with K-Means (`02_hybrid_ensemble.ipynb`)

**Outputs:** `artifacts/hybrid_cluster_bundle.joblib`, `artifacts/hybrid_cluster_feature_columns.json`

```python
from sklearn.cluster import KMeans
from sklearn.linear_model import Ridge
import joblib

kmeans = KMeans(n_clusters=5, random_state=42, n_init=10)
cluster_labels = kmeans.fit_predict(df_train[feature_cols])

cluster_models = {}
for cid in range(5):
    mask = cluster_labels == cid
    model = Ridge(alpha=1.0)
    model.fit(df_train.loc[mask, feature_cols], df_train.loc[mask, 'resale_price'])
    cluster_models[cid] = model

bundle = {
    'kmeans_model': kmeans,
    'cluster_models': cluster_models,
    'feature_columns': feature_cols,
    'xgb_model': xgb,
    'lgb_model': lgb
}
joblib.dump(bundle, 'artifacts/hybrid_cluster_bundle.joblib')
```

**Validation:**
- [ ] 5 clusters; inspect size balance (15–30% each)
- [ ] Hybrid MAPE ≤ 3.2%
- [ ] Bundle loads: `joblib.load('artifacts/hybrid_cluster_bundle.joblib')`

---

### Step 3: Inference & Evaluation (`03_hybrid_prediction.ipynb`)

```python
from yc_hybrid_inference import load_bundle, predict_price

bundle = load_bundle('artifacts/hybrid_cluster_bundle.joblib')
predicted_price = predict_price(bundle, {
    'address_key': '123_ANG_MO_KIO_AVE_4',
    'flat_type': '4 ROOM',
    'floor_area_sqm': 105.5,
    'lease_remaining_years': 74,
    'transaction_year': 2024,
    'dist_nearest_mrt_km': 0.5,
    'dist_nearest_primary_school_km': 1.2,
    'town': 'ANG MO KIO'
})
print(f"Predicted price: ${predicted_price:,.0f}")
```

**Validation:**
- [ ] `predict_price()` returns valid prices on single and bulk inputs
- [ ] MAPE ≤ 3.2% on test set

---

## 3. Standard Patterns

### Metrics Logging
```python
def log_metrics(y_true, y_pred, model_name):
    from sklearn.metrics import mean_absolute_percentage_error, mean_absolute_error
    import numpy as np
    mape = mean_absolute_percentage_error(y_true, y_pred)
    mae  = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(np.mean((y_true - y_pred)**2))
    print(f"{model_name}: MAPE={mape:.4f}  MAE=${mae:,.0f}  RMSE=${rmse:,.0f}")
    return {'mape': mape, 'mae': mae, 'rmse': rmse}
```

### Model Serialization
```python
import joblib
from datetime import datetime
date_suffix = datetime.now().strftime('%Y%m%d')
joblib.dump(model, f'artifacts/xgb_model_{date_suffix}.joblib')
```

### Train/Test Leakage Guard
```python
assert df_train['transaction_year'].max() < 2023, "Train has 2023+ data!"
assert df_test['transaction_year'].min() >= 2023, "Test has pre-2023 data!"
```

---

## 4. Inference Module (`yc_hybrid_inference.py`)

**Public API:**
- `default_feature_table_csv()` — Returns path to latest feature table
- `load_bundle(path)` — Loads hybrid model bundle
- `build_yc_hybrid_vector(listing_dict)` — Converts 8-field input to feature vector
- `predict_price(bundle, listing_dict)` — Returns predicted SGD price

---

## 5. Troubleshooting

| Issue | Solution |
|-------|----------|
| Feature table not found | Run `00_download_data_from_HF.ipynb`; check `hf_data/` exists |
| Hybrid MAPE > 3.2% | Increase cluster count; check cluster balance; verify feature scaling |
| Memory OOM | Use `pd.read_csv(..., chunksize=50000)` |
| Bundle load error | Check joblib version matches; ensure path is absolute |
| Inference returns unrealistic prices | Validate input features against test set distributions |
