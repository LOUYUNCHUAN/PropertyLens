---
applyTo: "03_ml_layer_hybrid/**/*.ipynb"
---

# ML Layer (Hybrid) Instructions

**Scope:** `03_ml_layer_hybrid/` ensemble model training, hybrid cluster routing, and inference  
**Key Notebooks (run in order):**  
- [`01_xgb_lgb_ensemble.ipynb`](../../03_ml_layer_hybrid/01_xgb_lgb_ensemble.ipynb) — XGB + LGB baseline
- [`02_hybrid_ensemble.ipynb`](../../03_ml_layer_hybrid/02_hybrid_ensemble.ipynb) — K-Means + cluster-routed stacking
- [`03_hybrid_prediction.ipynb`](../../03_ml_layer_hybrid/03_hybrid_prediction.ipynb) — Inference & bulk evaluation
- [`04_publish_hf.ipynb`](../../03_ml_layer_hybrid/04_publish_hf.ipynb) — Optional HF upload

**Inference Module:** [`yc_hybrid_inference.py`](../../03_ml_layer_hybrid/yc_hybrid_inference.py)

**Reference:** Layer artefacts under `03_ml_layer_hybrid/artifacts/`

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
- **Hybrid (cluster-routed):** MAPE ≤ 3.2% on test set (improvement expected)

---

## 2. Notebook Sequence & Workflow

### Step 1: XGB/LGB Ensemble Baseline (`01_xgb_lgb_ensemble.ipynb`)

**Inputs:**
- Feature tables from `hf_data/02_feature_layer/training/outputs/hdb_feature_table_*.csv`
- Train/test splits `hdb_feature_train_*.csv`, `hdb_feature_test_*.csv`

**Outputs:**
- `artifacts/feature_columns.json` — List of model input columns
- `artifacts/xgb_model_*.joblib` — Fitted XGBoost model
- `artifacts/lgb_model_*.joblib` — Fitted LightGBM model
- Benchmark metrics in notebook cell output (MAPE, MAE, RMSE)

**Key Steps:**
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
feature_path = REPO_ROOT / 'hf_data/02_feature_layer/training/outputs'

# Load latest feature tables
import glob
latest_table = sorted(glob.glob(str(feature_path / 'hdb_feature_table_*.csv')))[-1]
train_file = latest_table.replace('hdb_feature_table', 'hdb_feature_train')
test_file = latest_table.replace('hdb_feature_table', 'hdb_feature_test')

df_train = pd.read_csv(train_file)
df_test = pd.read_csv(test_file)
print(f"Train: {df_train.shape}, Test: {df_test.shape}")

# Feature selection: drop ID, time, target
feature_cols = [c for c in df_train.columns 
                 if c not in ['resale_price', 'transaction_year', 'month_dt', 'address_key']]

# Train XGB + LGB
from xgboost import XGBRegressor
from lightgbm import LGBMRegressor
from sklearn.metrics import mean_absolute_percentage_error

xgb = XGBRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)
lgb = LGBMRegressor(n_estimators=100, max_depth=6, learning_rate=0.1, random_state=42)

xgb.fit(df_train[feature_cols], df_train['resale_price'])
lgb.fit(df_train[feature_cols], df_train['resale_price'])

# Evaluate
xgb_pred = xgb.predict(df_test[feature_cols])
lgb_pred = lgb.predict(df_test[feature_cols])
xgb_mape = mean_absolute_percentage_error(df_test['resale_price'], xgb_pred)
lgb_mape = mean_absolute_percentage_error(df_test['resale_price'], lgb_pred)

print(f"XGB MAPE: {xgb_mape:.4f}")
print(f"LGB MAPE: {lgb_mape:.4f}")
```

**Validation:**
- [ ] MAPE ≤ 3.5%
- [ ] No train/test data leakage (temporal split maintained)
- [ ] Feature columns exported to JSON
- [ ] Models saved under `artifacts/`

---

### Step 2: Hybrid Ensemble with K-Means (`02_hybrid_ensemble.ipynb`)

**Inputs:**
- XGB/LGB models from Step 1
- Train/test feature data
- Clustering objective: segment HDB market by price/location/characteristics

**Outputs:**
- `artifacts/hybrid_cluster_bundle.joblib` — Dict containing:
  - `kmeans_model` — Fitted K-Means (e.g., 5 clusters)
  - `cluster_models` — Per-cluster ridge/regression models
  - `global_baseline` — Fallback model for new homes
  - `cluster_assignments` — Training data cluster labels
- `artifacts/hybrid_cluster_feature_columns.json` — Feature list
- Performance comparison (ensemble vs hybrid)

**Key Steps:**
```python
from sklearn.cluster import KMeans
from sklearn.linear_model import Ridge, LinearRegression
import joblib

# Cluster on training data (time-safe: no future data leaks)
kmeans = KMeans(n_clusters=5, random_state=42, n_init=10)
cluster_labels = kmeans.fit_predict(df_train[feature_cols])

# Train per-cluster models
cluster_models = {}
for cluster_id in range(5):
    mask = cluster_labels == cluster_id
    X_cluster = df_train.loc[mask, feature_cols]
    y_cluster = df_train.loc[mask, 'resale_price']
    
    model = Ridge(alpha=1.0)
    model.fit(X_cluster, y_cluster)
    cluster_models[cluster_id] = model
    print(f"Cluster {cluster_id}: {mask.sum()} samples, train RMSE={np.sqrt(np.mean((model.predict(X_cluster) - y_cluster)**2)):.0f}")

# Save bundle
bundle = {
    'kmeans_model': kmeans,
    'cluster_models': cluster_models,
    'feature_columns': feature_cols,
    'xgb_model': xgb,
    'lgb_model': lgb
}
joblib.dump(bundle, 'artifacts/hybrid_cluster_bundle.joblib')
print("✓ Hybrid bundle saved")

# Evaluate on test set
test_clusters = kmeans.predict(df_test[feature_cols])
predictions = np.array([
    cluster_models[test_clusters[i]].predict(df_test[feature_cols].iloc[i:i+1])[0]
    for i in range(len(df_test))
])
hybrid_mape = mean_absolute_percentage_error(df_test['resale_price'], predictions)
print(f"Hybrid MAPE: {hybrid_mape:.4f} (vs XGB {xgb_mape:.4f}, LGB {lgb_mape:.4f})")
```

**Validation:**
- [ ] K clusters created; inspect cluster sizes (e.g., 5 clusters with 15–30% each)
- [ ] Per-cluster models train without data leakage
- [ ] Hybrid MAPE ≤ 3.2% (should improve on baseline)
- [ ] Bundle loads successfully: `bundle = joblib.load('artifacts/hybrid_cluster_bundle.joblib')`

---

### Step 3: Inference & Evaluation (`03_hybrid_prediction.ipynb`)

**Inputs:**
- Hybrid bundle from Step 2
- Test feature data
- 8-field user listing (optional: address, flat_type, floor_area_sqm, rooms, lease_remaining_years, etc.)

**Outputs:**
- Predicted price for test listings
- Bulk evaluation metrics (MAPE, MAE, RMSE)
- Inference code example for production use

**Key Steps:**
```python
from yc_hybrid_inference import load_bundle, predict_price, build_yc_hybrid_vector

# Load bundle
bundle = load_bundle('artifacts/hybrid_cluster_bundle.joblib')

# 8-field input (minimal listing data)
listing = {
    'address_key': '123_ANG_MO_KIO_AVE_4',
    'flat_type': '4 ROOM',
    'floor_area_sqm': 105.5,
    'lease_remaining_years': 74,
    'transaction_year': 2024,
    'dist_nearest_mrt_km': 0.5,
    'dist_nearest_primary_school_km': 1.2,
    'town': 'ANG MO KIO'
}

# Predict price
predicted_price = predict_price(bundle, listing)
print(f"Predicted price: ${predicted_price:,.0f}")

# Bulk evaluation on test set
from sklearn.metrics import mean_absolute_percentage_error, mean_absolute_error
test_predictions = []
for idx, row in df_test.iterrows():
    listing_dict = row.to_dict()
    price = predict_price(bundle, listing_dict)
    test_predictions.append(price)

test_predictions = np.array(test_predictions)
mape = mean_absolute_percentage_error(df_test['resale_price'], test_predictions)
mae = mean_absolute_error(df_test['resale_price'], test_predictions)
rmse = np.sqrt(np.mean((df_test['resale_price'] - test_predictions)**2))

print(f"Test Set Evaluation:")
print(f"  MAPE: {mape:.4f}")
print(f"  MAE:  ${mae:,.0f}")
print(f"  RMSE: ${rmse:,.0f}")
```

**Validation:**
- [ ] Bundle loads and `predict_price()` returns valid prices
- [ ] Inference works on single listings and bulk data
- [ ] MAPE, MAE, RMSE logged and reasonable (MAPE ≤ 3.2%)

---

## 3. Standard Patterns

### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
```

### Latest Feature Table Discovery
```python
import glob
feature_dir = REPO_ROOT / 'hf_data/02_feature_layer/training/outputs'
latest_date = sorted([
    p.stem.split('_')[-1] 
    for p in feature_dir.glob('hdb_feature_table_*.csv')
])[-1]
print(f"Using feature snapshot from {latest_date}")

train_path = feature_dir / f'hdb_feature_train_{latest_date}.csv'
test_path = feature_dir / f'hdb_feature_test_{latest_date}.csv'
```

### Model Serialization
```python
import joblib
from datetime import datetime

# Save
date_suffix = datetime.now().strftime('%Y%m%d')
joblib.dump(model, f'artifacts/xgb_model_{date_suffix}.joblib')

# Load
model = joblib.load('artifacts/xgb_model_20260403.joblib')
```

### Metrics Logging
```python
from sklearn.metrics import mean_absolute_percentage_error, mean_absolute_error

def log_metrics(y_true, y_pred, model_name):
    mape = mean_absolute_percentage_error(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(np.mean((y_true - y_pred)**2))
    print(f"{model_name}:")
    print(f"  MAPE: {mape:.4f}")
    print(f"  MAE:  ${mae:,.0f}")
    print(f"  RMSE: ${rmse:,.0f}")
    return {'mape': mape, 'mae': mae, 'rmse': rmse}
```

---

## 4. Quality Standards

### Train/Test Leakage Prevention
```python
# Before model training, verify no temporal leakage
assert df_train['transaction_year'].max() < 2023, "Train has 2023+ data!"
assert df_test['transaction_year'].min() >= 2023, "Test has pre-2023 data!"
print(f"✓ Temporal split clean: train ≤ {df_train['transaction_year'].max()}, test ≥ {df_test['transaction_year'].min()}")
```

### Benchmark Reporting
```python
# Always report both individual and ensemble MAPE
print("=" * 50)
print("MODEL PERFORMANCE ON TEST SET")
print("=" * 50)
print(f"XGB MAPE:   {xgb_mape:.4f}")
print(f"LGB MAPE:   {lgb_mape:.4f}")
print(f"Ensemble:   {ensemble_mape:.4f}")
print(f"Hybrid:     {hybrid_mape:.4f}")
print("=" * 50)
if hybrid_mape <= 0.032:
    print("✓ HYBRID MEETS QUALITY BAR (MAPE ≤ 3.2%)")
else:
    print("⚠ HYBRID MAPE ABOVE TARGET (MAPE > 3.2%)")
```

### Feature Importance Inspection
```python
# Log top features per model type
xgb_importance = pd.DataFrame({
    'feature': feature_cols,
    'importance': xgb.feature_importances_
}).sort_values('importance', ascending=False)

print("Top 10 XGB Features:")
print(xgb_importance.head(10))
```

---

## 5. Inference Module (`yc_hybrid_inference.py`)

**Public API:**
- `default_feature_table_csv()` — Returns path to latest feature table
- `load_bundle(path)` — Loads hybrid model bundle
- `build_yc_hybrid_vector(listing_dict)` — Converts 8-field input to feature vector
- `predict_price(bundle, listing_dict)` — Returns predicted SGD price

**Expected Usage:**
```python
from yc_hybrid_inference import load_bundle, predict_price

bundle = load_bundle('03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib')
price = predict_price(bundle, {'address_key': '123_AMK_AVE_4', ...})
print(f"Predicted: ${price:,.0f}")
```

---

## 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| Feature table not found | Check `hf_data/02_feature_layer/training/outputs/` exists; run Step 0 (`00_download_data_from_HF.ipynb`) |
| Train/test leakage detected | Verify temporal split: `max(train_year) < min(test_year)` |
| Hybrid MAPE > 3.2% | Increase cluster count; check cluster balance; verify feature scaling |
| Memory OOM loading features | Use `pd.read_csv(..., chunksize=50000)` or reduce dataset |
| Bundle load error | Ensure paths are absolute; check joblib file is valid (not corrupted) |
| Inference returns unrealistic prices | Validate input features against test set distributions; check feature scaling |

---

## 7. See Also

- [ML Layer README](../../03_ml_layer_hybrid/) — Architecture details
- [Inference Module](../../03_ml_layer_hybrid/yc_hybrid_inference.py) — Public API
- [XAI Layer](../../04_xai_layer/) — Consumes bundle for explanations
- [Feature Layer](../../02_feature_layer/) — Feature tables source
- [Workspace Instructions](../../.github/copilot-instructions.md) — General conventions
