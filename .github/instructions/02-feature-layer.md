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

**Output Contract (as of 2026-04-12):**
- **`hdb_feature_table_*.csv`** (263,004 rows × 77 cols) — Full deduplicated dataset
- **`hdb_feature_train_*.csv`** (180,195 rows × 77 cols) — Train split (year < 2023)
- **`hdb_feature_test_*.csv`** (82,809 rows × 77 cols) — Test split (year ≥ 2023)
- **`feature_metadata_*.json`** — Schema/stats export (includes `dropped_features` key listing any removed columns)

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
- `primary_school_quality_1km_weighted` — Weighted average quality score of primary schools within 1 km (398 unique values, CV=0.036)
- `primary_school_count_1km` — Count of primary schools within 1 km
- `school_count_1km` — Total count of all school types within 1 km
- `school_cluster` — Derived school clustering rank

> **Note on school quality data sparsity:** `sgschooling_2015plus_20260316.csv` has ~98% null `competition_ratio_extracted` entries. Downstream quality features therefore have low variability. `primary_school_top_quality_1km` was **removed** (2026-04-12) because it had only 3 unique values with 97.1% identical. If better school quality data becomes available, this feature can be reintroduced.

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

**CRITICAL:** Before exporting feature tables, verify the following checks pass. If any fail, **STOP** and fix the issues in `FeatureDealing.ipynb` before proceeding.

### Feature Variability Validation (NEW — CRITICAL)

**Rule 1: No Empty Values in Core Features**
- Every engineered feature must have a value for every property (0% nulls per feature)
- Check:
  ```python
  core_features = ['level_mid', 'lease_remaining_years', 'floor_area_sqm', 'room_count', ... ]
  null_summary = feature_table[core_features].isnull().sum()
  assert null_summary.sum() == 0, f"Features with nulls: {null_summary[null_summary > 0].to_dict()}"
  ```
- **Action if fails:** Impute missing values before export
  - **Numeric:** Use median (robust to outliers)
  - **Categorical:** Use mode (most common value)
  - **Last resort:** Drop rows with missing target (`resale_price`)

**Rule 2: Sufficient Feature Variability**
- Different properties must have different feature values
- **Zero Variability (FAIL):** Feature has ≤1 unique value → **MUST REMOVE** immediately
  - These features have no discriminative power and degrade model fitting
  - Common cause: Unfinished feature engineering or failed computation
  - Example: If all 263,004 rows have `market_activity_score = 50`, the feature is broken
- **Low Variability (WARNING):** Feature has <1% unique values
  - Monitor but may be acceptable (e.g., `room_count` naturally has few values)
  - Check: Does the feature make domain sense?

**Implementation in FeatureDealing.ipynb:**
```python
# QUALITY GATE: After engineering all features, scan for problems
zero_var_features = []
for col in feature_table.columns:
    unique_count = feature_table[col].nunique()
    if unique_count <= 1:
        zero_var_features.append(col)
        print(f"❌ ZERO VARIABILITY: '{col}' ({unique_count} unique)")

# Remove zero-variability features if detected
if zero_var_features:
    print(f"🔧 Removing {len(zero_var_features)} zero-variability features...")
    for col in zero_var_features:
        if col in base_cols:
            base_cols.remove(col)
    feature_table = feature_table.drop(columns=zero_var_features)
```

**Removed Features (2026-04-12) — do NOT re-add without fixing root cause:**

| Feature | Reason | Root Cause |
|---|---|---|
| `trans_sold_count` | constant = 0.0 | Transaction join failed in April 6 pipeline run |
| `trans_rented_count` | constant = 0.0 | Transaction join failed |
| `trans_total_count` | constant = 0.0 | Transaction join failed |
| `trans_rental_ratio` | constant = 0.0 | Transaction join failed |
| `market_activity_score` | constant = 50 | Transaction join failed |
| `yoy_volume_change` | constant = 0.0 | Transaction join failed |
| `primary_school_top_quality_1km` | 3 unique values, 97.1% same | sgschooling data 98% null |

The **post-export gate** in `FeatureDealing.ipynb` (cell after the export cell) will raise `ValueError` if any of these (or any other constant column) appear in a future export.
- If fails: Review feature engineering logic or raw data source

**Rule 3: One-Hot Encoding Validity**
- Each row should have exactly 1 value = 1 for each categorical (mutual exclusivity)
- Check:
  ```python
  town_cols = [c for c in feature_table.columns if c.startswith('town_')]
  row_sums = feature_table[town_cols].sum(axis=1)
  assert (row_sums == 1).all(), "Invalid one-hot encoding!"
  ```
- If fails: Fix categorical encoding in `FeatureDealing.ipynb`

### Additional Checks

#### Null & Uniqueness
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
### Additional Checks

#### 1. Null & Uniqueness
```python
# No missing values in critical columns
critical_cols = ['resale_price', 'transaction_year', 'address_key', 'floor_area_sqm', 'lease_remaining_years']
assert df_final[critical_cols].isna().sum().sum() == 0, "Found nulls in critical columns!"

# No duplicate address-months
assert ~df_final.duplicated(subset=['address_key', 'month_dt'], keep=False).any(), "Duplicate address-months!"

# Transaction years within valid range
assert df_final['transaction_year'].min() >= 2015, "Year too early!"
assert df_final['transaction_year'].max() <= 2026, "Year too recent!"
```

#### 2. Feature Distributions
```python
# Price range sanity
assert df_final['resale_price'].min() >= 100_000, "Price too low!"
assert df_final['resale_price'].max() <= 2_000_000, "Price too high!"
print(f"Price: ${df_final['resale_price'].min():,.0f} — ${df_final['resale_price'].max():,.0f}")

# Lease sanity
assert df_final['lease_remaining_years'].min() >= 35, "Lease too short!"
print(f"Lease: {df_final['lease_remaining_years'].min():.0f} — {df_final['lease_remaining_years'].max():.0f} years")

# Floor area sanity
assert df_final['floor_area_sqm'].min() >= 30, "Floor area too small!"
assert df_final['floor_area_sqm'].max() <= 300, "Floor area too large!"
print(f"Floor area: {df_final['floor_area_sqm'].min():.0f} — {df_final['floor_area_sqm'].max():.0f} m²")
```

#### 3. Train/Test Leakage
```python
# No temporal leakage
assert train['transaction_year'].max() < 2023, "Train has 2023+ data!"
assert test['transaction_year'].min() >= 2023, "Test has pre-2023 data!"
print(f"✓ Temporal split: train {train['transaction_year'].max()} | test {test['transaction_year'].min()}")
```

#### 4. Schema Consistency
```python
# Column consistency across splits
assert set(train.columns) == set(test.columns), "Column mismatch between train/test!"
assert set(train.columns) == set(df_final.columns), "Column mismatch with full table!"
print(f"✓ Schema: {len(train.columns)} columns consistent across all 3 datasets")
```

---

## 5. Export & Metadata

### Standard Export
```python
from datetime import datetime
date_suffix = datetime.now().strftime('%Y%m%d')

# Export all 3 tables
df_final.to_csv(f'outputs/hdb_feature_table_{date_suffix}.csv', index=False)
train.to_csv(f'outputs/hdb_feature_train_{date_suffix}.csv', index=False)
test.to_csv(f'outputs/hdb_feature_test_{date_suffix}.csv', index=False)

# Export metadata
metadata = {
    'export_date': date_suffix,
    'total_rows': len(df_final),
    'train_rows': len(train),
    'test_rows': len(test),
    'num_columns': len(df_final.columns),
    'price_range_usd': [float(df_final['resale_price'].min()), float(df_final['resale_price'].max())],
    'year_range': [int(df_final['transaction_year'].min()), int(df_final['transaction_year'].max())]
}
import json
with open(f'outputs/feature_metadata_{date_suffix}.json', 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"✓ Exported 4 artefacts: _{date_suffix}")
```

---

## 6. Quality Standards

### Deduplication Logging
```python
# Always log dedup impact
print(f"Deduplication: {initial} → {len(df_final)} rows ({100*len(df_final)/initial:.1f}% retained)")
```

### Feature Distribution Reporting
```python
# Summary statistics for key features
for col in ['resale_price', 'floor_area_sqm', 'lease_remaining_years']:
    if col in df_final.columns:
        print(f"{col}: μ={df_final[col].mean():.1f}, σ={df_final[col].std():.1f}")
```

### Post-Export Validation
```python
# Quick sanity check
train_check = pd.read_csv(f'outputs/hdb_feature_train_{date_suffix}.csv')
assert len(train_check) == len(train), "Train CSV row count mismatch!"
print(f"✓ Post-export validation: {len(train_check)} rows in train CSV")
```

---

## 7. Troubleshooting

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| Feature has zero variability | Feature engineering produced same value for all rows | Review feature logic in `FeatureDealing.ipynb`; check data source |
| Missing values in core feature | Raw data incomplete | Impute using mean/median/forward-fill or drop affected rows |
| One-hot encoding invalid | Categorical encoding error | Verify no row has > 1 "1" value per category |
| Train/test leakage | Temporal anomaly | Check year splits: train < 2023, test ≥ 2023 |
| Low correlation with price | Feature not predictive | Feature may be valid but weak; validate with ML model |

---

## 8. See Also

- [Feature Layer README](../../02_feature_layer/README.md) — Full schema & engineering details
- [Validation Notebook](../../02_feature_layer/training/FeatureValidation.ipynb) — Run automated checks
- [Workspace Instructions](../../.github/copilot-instructions.md) — General conventions

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
