# Feature Layer Instructions

**Scope:** `02_feature_layer/training/` feature engineering, validation, and export  
**Key Notebooks:**
- `training/FeatureDealing.ipynb` — Engineering pipeline
- `training/FeatureValidation.ipynb` — Quality diagnostics

**Reference:** [Feature Layer README](README.md) | [Root Instructions](../CLAUDE.md)

---

## 1. Role & Data Contract

**Purpose:** Transform raw HDB data + geospatial/school enrichment into **ML-ready feature tables** with strict deduplication, categorical encoding, and temporal train/test splits.

**Output Contract (as of 2026-04-15):**
- **`hdb_feature_table_*.csv`** (263,004 rows × 86 cols) — Full deduplicated dataset
- **`hdb_feature_train_*.csv`** (180,195 rows × 86 cols) — Train split (year < 2023)
- **`hdb_feature_test_*.csv`** (82,809 rows × 86 cols) — Test split (year ≥ 2023)
- **`feature_metadata_*.json`** — Schema/stats export (includes `dropped_features` key)

**Location:** `training/outputs/` (or `hf_data/02_feature_layer/training/outputs/` if downloaded from HF)

**Note:** Downstream ML notebooks use **latest-date snapshot** logic; keep date suffixes consistent across all 4 files.

---

## 2. Feature Schema (86 total as of 2026-04-15)

### Target
- `resale_price` — SGD (numeric, no nulls)

### Time & ID
- `transaction_year` — Year of transaction (2015–2026)
- `month_dt` — Parsed datetime (YYYY-MM-DD)
- `address_key` — Unique HDB block identifier

### Core Engineered Features (27)
**Lease & Age:**
- `lease_remaining_years` — Years on 99-year HDB lease at transaction
- `flat_age_at_transaction` — Years since lease commencement

**Property Characteristics:**
- `floor_area_sqm` — Floor area in m²
- `level_min`, `level_max`, `level_mid` — Storey band extracted from 'XX TO YY' range

**Proximity Features (distances in km):**
- `dist_nearest_mrt_km`, `dist_nearest_primary_school_km`, `dist_nearest_food_centre_km`
- `dist_nearest_shopping_mall_km`, `dist_nearest_park_km`, `dist_highway_km`

**School Quality (derived from MOE data):**
- `primary_school_quality_1km_weighted` — Weighted average quality score within 1 km
- `primary_school_count_1km` — Count of primary schools within 1 km
- `school_count_1km` — Total count of all school types within 1 km
- `school_cluster` — Derived school clustering rank

**Recency Interaction Features (5) — added 2026-04-15:**
- `years_since_transaction` — Years elapsed from transaction month to reference date (2026-04)
- `years_since_transaction_sq` — Squared recency (captures non-linear depreciation)
- `recency_normalized` — `years_since_transaction` scaled to [0, 1] by dividing by max
- `recency_x_mall_access` — `years_since_transaction × mall_count_3km` (interaction)
- `recency_x_school_quality` — `years_since_transaction × primary_school_quality_1km_weighted` (interaction)

> **Note on removed features (2026-04-12):** `primary_school_top_quality_1km` was removed — only 3 unique values (97.1% same). Root cause: `sgschooling_2015plus_20260316.csv` has 98% null `competition_ratio_extracted`. Do NOT re-add without fixing the data source.
>
> **Note on school quality fix (2026-04-15):** `primary_school_quality_1km_weighted` now correctly reflects Phase 2B/2C competition ratios from sgschooling data (range 1.85–100.0, std=13.09, 8,438 unique values). Previously was near-constant ~14.134 due to ROOT path pointing to stale iCloud data.

### One-Hot Encoded Categorical (51)
- **Town (26):** ANG_MO_KIO, BEDOK, BISHAN, ... (all HDB towns)
- **Flat Type (7):** 1-ROOM through MULTI_GEN
- **Flat Model (~18):** Model A, Improved, New Generation, etc.

---

## 3. Feature Engineering Pipeline

### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
DATA_RAW = REPO_ROOT / '01_data_layer/raw'
FEATURE_OUTPUT = REPO_ROOT / 'hf_data/02_feature_layer/training/outputs'
```

### Deduplication
```python
before = len(df)
df = df.drop_duplicates()
df_dedup = df.sort_values('month_dt').drop_duplicates(
    subset=['address_key', 'month_dt'], keep='last'
)
print(f"Deduplication: {before} → {len(df_dedup)} rows ({100*len(df_dedup)/before:.1f}% retained)")
```

### One-Hot Encoding
```python
categorical_cols = ['town', 'flat_type', 'flat_model']
df_encoded = pd.get_dummies(
    df, columns=categorical_cols,
    prefix=['town', 'flat_type', 'flat_model'],
    drop_first=False  # Keep all categories; no collinearity issues for tree models
)
```

### Temporal Train/Test Split
```python
train = df_final[df_final['transaction_year'] < 2023].copy()
test  = df_final[df_final['transaction_year'] >= 2023].copy()
assert len(train) + len(test) == len(df_final), "Rows lost in split!"
```

---

## 4. Validation Checklist

**CRITICAL:** Before exporting feature tables, verify the following. If any fail, **STOP** and fix in `FeatureDealing.ipynb`.

### Feature Variability Validation

**Rule 1: No Empty Values**
```python
null_summary = feature_table[core_features].isnull().sum()
assert null_summary.sum() == 0, f"Features with nulls: {null_summary[null_summary > 0].to_dict()}"
```

**Rule 2: Sufficient Variability — Quality Gate**
```python
zero_var_features = []
for col in feature_table.columns:
    if feature_table[col].nunique() <= 1:
        zero_var_features.append(col)
        print(f"ZERO VARIABILITY: '{col}'")

if zero_var_features:
    feature_table = feature_table.drop(columns=zero_var_features)
    print(f"Removed {len(zero_var_features)} zero-variability features")
```

**Removed Features (2026-04-12) — do NOT re-add without fixing root cause:**

| Feature | Reason | Root Cause |
|---|---|---|
| `trans_sold_count` | constant = 0.0 | Transaction join failed |
| `trans_rented_count` | constant = 0.0 | Transaction join failed |
| `trans_total_count` | constant = 0.0 | Transaction join failed |
| `trans_rental_ratio` | constant = 0.0 | Transaction join failed |
| `market_activity_score` | constant = 50 | Transaction join failed |
| `yoy_volume_change` | constant = 0.0 | Transaction join failed |
| `primary_school_top_quality_1km` | 3 unique values, 97.1% same | sgschooling data 98% null |

**Rule 3: OHE Validity**
```python
town_cols = [c for c in feature_table.columns if c.startswith('town_')]
assert (feature_table[town_cols].sum(axis=1) == 1).all(), "Invalid one-hot encoding!"
```

### Additional Checks
```python
# No nulls in critical columns
critical_cols = ['resale_price', 'transaction_year', 'address_key', 'floor_area_sqm', 'lease_remaining_years']
assert df_final[critical_cols].isna().sum().sum() == 0

# Price range
assert df_final['resale_price'].min() >= 100_000
assert df_final['resale_price'].max() <= 2_000_000

# Lease sanity
assert df_final['lease_remaining_years'].min() >= 35

# Temporal split
assert train['transaction_year'].max() < 2023
assert test['transaction_year'].min() >= 2023

# Schema consistency across splits
assert set(train.columns) == set(test.columns) == set(df_final.columns)
```

---

## 5. Export & Metadata

```python
from datetime import datetime
date_suffix = datetime.now().strftime('%Y%m%d')

df_final.to_csv(f'outputs/hdb_feature_table_{date_suffix}.csv', index=False)
train.to_csv(f'outputs/hdb_feature_train_{date_suffix}.csv', index=False)
test.to_csv(f'outputs/hdb_feature_test_{date_suffix}.csv', index=False)

metadata = {
    'export_date': date_suffix,
    'total_rows': len(df_final),
    'train_rows': len(train),
    'test_rows': len(test),
    'num_columns': len(df_final.columns),
    'columns': df_final.columns.tolist(),
    'dropped_features': zero_var_features,
    'price_range_sgd': [float(df_final['resale_price'].min()), float(df_final['resale_price'].max())],
    'year_range': [int(df_final['transaction_year'].min()), int(df_final['transaction_year'].max())]
}
import json
with open(f'outputs/feature_metadata_{date_suffix}.json', 'w') as f:
    json.dump(metadata, f, indent=2)
print(f"Exported 4 artefacts: _{date_suffix}")
```

---

## 6. Troubleshooting

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Feature has zero variability | Feature engineering produced same value for all rows | Review feature logic; check data source join |
| Missing values in core feature | Raw data incomplete | Impute using median/mode; drop rows only if target missing |
| OHE invalid | Categorical encoding error | Verify no row has > 1 "1" value per category |
| Train/test leakage | Temporal anomaly | Check: `max(train_year) < 2023`, `min(test_year) >= 2023` |
| OOM loading raw data | Large dataset | Use `pd.read_csv(..., chunksize=50000)` |
| OHE creates too many columns | Unexpected categories in source | Expected 51 OHE features; investigate if > 60 |
