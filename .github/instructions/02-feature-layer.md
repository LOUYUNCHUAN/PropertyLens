---
applyTo: "02_feature_layer/**/*.ipynb"
---

# Feature Layer Instructions

**Scope:** `02_feature_layer/training/` feature engineering, validation, and export  
**Key Notebooks:**  
- [`FeatureDealing.ipynb`](../../02_feature_layer/training/FeatureDealing.ipynb) — Engineering pipeline
- [`FeatureValidation.ipynb`](../../02_feature_layer/training/FeatureValidation.ipynb) — Quality diagnostics

**Reference:** [Feature Layer README](../../02_feature_layer/README.md)

---

## 1. Role & Data Contract

**Purpose:** Transform raw HDB data + geospatial/school enrichment into **ML-ready feature tables** with strict deduplication, categorical encoding, and temporal train/test splits.

**Output Contract:**
- **`hdb_feature_table_*.csv`** (260,699 rows × 73 cols) — Full deduplicated dataset
- **`hdb_feature_train_*.csv`** (178,589 rows × 73 cols) — Train split (year < 2023)
- **`hdb_feature_test_*.csv`** (82,110 rows × 73 cols) — Test split (year ≥ 2023)
- **`feature_metadata_*.json`** — Schema/stats export

**Location:** `02_feature_layer/training/outputs/` (or `hf_data/02_feature_layer/training/outputs/` if downloaded from HF)

**Note:** Downstream ML notebooks (03_ml_layer_hybrid) use **latest-date snapshot** logic; keep date suffixes consistent across all 4 files.

---

## 2. Feature Schema (73 total)

### Target
- `resale_price` — SGD (numeric, no nulls)

### Time & ID
- `transaction_year` — Year of transaction (2015–2026)
- `month_dt` — Parsed datetime (YYYY-MM-DD)
- `address_key` — Unique HDB block identifier

### Core Engineered Features (22)
**Location:**
- `town_*` — One-hot encoded town names (e.g., 'town_ANG_MO_KIO', 'town_BEDOK', ...)

**Lease & Age:**
- `lease_remaining_years` — Years on 99-year HDB lease at transaction
- `flat_age_at_transaction` — Years since lease commencement

**Property Characteristics:**
- `flat_type_*` — One-hot: 1-ROOM, 2-ROOM, 3-ROOM, 4-ROOM, 5-ROOM, EXECUTIVE, MULTI_GEN
- `flat_model_*` — One-hot: Model A, Improved, New Generation, etc.
- `floor_area_sqm` — Floor area in m²
- `level_min`, `level_max`, `level_mid` — Storey band extracted from 'XX TO YY' range

**Proximity Features (distances in km):**
- `dist_nearest_mrt_km` — Closest MRT/LRT station
- `dist_nearest_primary_school_km` — Primary school distance
- `dist_nearest_food_centre_km` — Hawker centre distance
- `dist_nearest_shopping_mall_km` — Mall distance
- `dist_nearest_park_km` — Park/playground distance
- `dist_highway_km` — Closest expressway (ER, PIE, CTE, etc.)

**School Quality (derived from MOE data):**
- `school_cluster` — Derived school clustering rank

### One-Hot Encoded Categorical (51)
- **Town (26):** ANG_MO_KIO, BEDOK, BISHAN, BUKIT BATOK, ... (all HDB towns)
- **Flat Type (7):** 1-ROOM, 2-ROOM, ..., MULTI_GEN
- **Flat Model (~18):** Model A, Improved, New Generation, etc.

---

## 3. Feature Engineering Pipeline

### Standard Patterns

#### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
DATA_RAW = REPO_ROOT / '01_data_layer/raw'
FEATURE_OUTPUT = REPO_ROOT / 'hf_data/02_feature_layer/training/outputs'
```

#### Load Raw Data
```python
# Locate latest feature data or raw source
import glob
raw_hdb = sorted(glob.glob(str(DATA_RAW / 'ResaleFlatPrices/*.csv')))[-1]
df = pd.read_csv(raw_hdb)
print(f"Loaded {len(df)} rows from {raw_hdb}")
```

#### Deduplication
```python
# Remove exact duplicates first
before = len(df)
df = df.drop_duplicates()
after = len(df)
print(f"Duplicates removed: {before - after} ({100*(before-after)/before:.1f}%)")

# Remove address-level duplicates (keep latest transaction per address per month)
df_dedup = df.sort_values('month_dt').drop_duplicates(
    subset=['address_key', 'month_dt'], keep='last'
)
print(f"Address-level dedup: {before} → {len(df_dedup)} rows")
```

#### One-Hot Encoding
```python
# Create OHE for categorical columns
categorical_cols = ['town', 'flat_type', 'flat_model']
df_encoded = pd.get_dummies(
    df, 
    columns=categorical_cols, 
    prefix=['town', 'flat_type', 'flat_model'],
    drop_first=False  # Keep all categories, no collinearity issues for tree models
)
print(f"After OHE: {df_encoded.shape[1]} columns ({df_encoded.shape[1] - len(categorical_cols)} new)")
```

#### Temporal Train/Test Split
```python
# Split by year: train < 2023, test >= 2023 (NO TEMPORAL LEAKAGE)
train = df_final[df_final['transaction_year'] < 2023].copy()
test = df_final[df_final['transaction_year'] >= 2023].copy()

assert len(train) + len(test) == len(df_final), "Rows lost in split!"
print(f"Train: {len(train)} rows, {train['transaction_year'].min()}-{train['transaction_year'].max()}")
print(f"Test:  {len(test)} rows, {test['transaction_year'].min()}-{test['transaction_year'].max()}")
```

---

## 4. Validation Checklist

Before exporting feature tables, verify:

### Null & uniqueness checks
```python
# 1. No missing values in critical columns
critical_cols = ['resale_price', 'transaction_year', 'address_key', 'floor_area_sqm', 'lease_remaining_years']
assert df_final[critical_cols].isna().sum().sum() == 0, "Found nulls in critical columns!"

# 2. Unique entries per address-month
assert ~df_final.duplicated(subset=['address_key', 'month_dt'], keep=False).any(), "Duplicate address-months!"

# 3. Transaction years within valid range
assert df_final['transaction_year'].min() >= 2015, "Year too early!"
assert df_final['transaction_year'].max() <= 2026, "Year too recent!"
```

### Feature distributions
```python
# 4. Price range sanity
print(f"Price stats: min=${df_final['resale_price'].min()}, max=${df_final['resale_price'].max()}, mean=${df_final['resale_price'].mean():.0f}")
assert df_final['resale_price'].min() >= 100_000, "Price too low!"
assert df_final['resale_price'].max() <= 2_000_000, "Price too high!"

# 5. Lease sanity
print(f"Lease stats: min={df_final['lease_remaining_years'].min()}, max={df_final['lease_remaining_years'].max()}, mean={df_final['lease_remaining_years'].mean():.1f}")
assert df_final['lease_remaining_years'].min() >= 35, "Lease too short!"

# 6. Floor area sanity
print(f"Floor area stats: min={df_final['floor_area_sqm'].min()}, max={df_final['floor_area_sqm'].max()}, mean={df_final['floor_area_sqm'].mean():.0f}")
assert df_final['floor_area_sqm'].min() >= 30, "Floor area too small!"
assert df_final['floor_area_sqm'].max() <= 300, "Floor area too large!"
```

### Train/test leakage
```python
# 7. No temporal leakage
assert train['transaction_year'].max() < 2023, "Train has 2023+ data!"
assert test['transaction_year'].min() >= 2023, "Test has pre-2023 data!"
print(f"✓ Temporal split clean: train {train['transaction_year'].max()} < test {test['transaction_year'].min()}")
```

### Schema consistency
```python
# 8. Column consistency across splits
assert set(train.columns) == set(test.columns), "Column mismatch between train/test!"
assert set(train.columns) == set(df_final.columns), "Column mismatch with full table!"
print(f"✓ Schema consistent: {len(train.columns)} columns in all 3 datasets")
```

---

## 5. Export & Metadata

### Standard Export
```python
from datetime import datetime
date_suffix = datetime.now().strftime('%Y%m%d')

# Export all 3 tables + metadata
df_final.to_csv(f'outputs/hdb_feature_table_{date_suffix}.csv', index=False)
train.to_csv(f'outputs/hdb_feature_train_{date_suffix}.csv', index=False)
test.to_csv(f'outputs/hdb_feature_test_{date_suffix}.csv', index=False)

# Export metadata
metadata = {
    'export_date': date_suffix,
    'total_rows': len(df_final),
    'train_rows': len(train),
    'test_rows': len(test),
    'columns': df_final.columns.tolist(),
    'num_columns': len(df_final.columns),
    'core_features': 22,
    'ohe_features': len(df_final.columns) - 22 - 3,  # -3 for target/time/id
    'price_range_usd': [
        float(df_final['resale_price'].min()),
        float(df_final['resale_price'].max())
    ],
    'year_range': [
        int(df_final['transaction_year'].min()),
        int(df_final['transaction_year'].max())
    ],
    'train_year_range': [
        int(train['transaction_year'].min()),
        int(train['transaction_year'].max())
    ],
    'test_year_range': [
        int(test['transaction_year'].min()),
        int(test['transaction_year'].max())
    ]
}

import json
with open(f'outputs/feature_metadata_{date_suffix}.json', 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"✓ Exported 4 artefacts with suffix _{date_suffix}")
```

---

## 6. Quality Standards

### Deduplication Logging
```python
# Always log dedup impact
initial = 314961  # From raw data
post_dedup = len(df_final)
print(f"Deduplication: {initial} → {post_dedup} ({100*post_dedup/initial:.1f}% retained)")
```

### Feature Distribution Reporting
```python
# Print summary statistics for key features
for col in ['resale_price', 'floor_area_sqm', 'lease_remaining_years', 'dist_nearest_mrt_km']:
    if col in df_final.columns:
        print(f"{col}: μ={df_final[col].mean():.1f}, σ={df_final[col].std():.1f}, "
              f"min={df_final[col].min():.1f}, max={df_final[col].max():.1f}")
```

### Downstream Validation (Post-Export)
```python
# Quick sanity check that exported files load correctly
train_check = pd.read_csv(f'outputs/hdb_feature_train_{date_suffix}.csv')
assert len(train_check) == len(train), "Train CSV row count mismatch!"
print(f"✓ Post-export validation passed: {len(train_check)} rows in train CSV")
```

---

## 7. Troubleshooting

| Issue | Solution |
|-------|----------|
| OOM when loading raw data | Iterate in chunks; use `pd.read_csv(..., chunksize=50000)` |
| Date parsing errors | Use `pd.to_datetime(df['month'], format='%Y-%m')` |
| Duplicate lease_remaining_years after merge | Check merge keys; ensure no cross-joins |
| Train/test distributions skewed | Verify temporal split is correctly applied; check max(train_year) < min(test_year) |
| OHE creates too many columns | Expected 51 OHE features; if > 60, check for unexpected categories |
| Nulls appear after feature engineering | Check merges (school data, geo data); use `.fillna(offset_value)` if intentional |

---

## 8. See Also

- [Feature Layer README](../../02_feature_layer/README.md) — Full schema & metrics
- [Data Layer](../../01_data_layer/) — Raw data source
- [ML Layer](../../03_ml_layer_hybrid/) — Consumes feature tables
- [Workspace Instructions](../../.github/copilot-instructions.md) — General conventions
