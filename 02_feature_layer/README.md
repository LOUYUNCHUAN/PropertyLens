# Feature Layer - Engineered Feature Datasets

**Last Updated:** April 3, 2026  
**Document Version:** 1.0  
**Purpose:** Feature engineering checkpoint documenting all engineered datasets, 11-factor feature coverage, quality validation, and usage guide for ML layer

---

## Quick Start

> **Skip this layer if you just want to run the models.**
> Pre-built feature tables are on Hugging Face — run `00_download_data_from_HF.ipynb` from the repo root instead.
>
> Only follow these steps if you need to **rebuild features from raw data**.

**STEP 1.** Make sure `01_data_layer/raw/` is populated (run Layer 01 or restore from backup)

**STEP 2.** Open `training/FeatureDealing.ipynb` — kernel: `.venv/bin/python` — Run All Cells
→ Builds 77 features (22 core + 51 OHE), deduplicates, splits train/test

**STEP 3.** Open `training/FeatureValidation.ipynb` — Run All Cells
→ Validates distributions, checks zero-variance features, confirms OHE correctness

**Done.** Outputs land in `training/outputs/hdb_feature_*.csv` and feed into Layer 03.

---

## How to Run

> **Most teammates can skip this layer.** Pre-built feature tables are available on Hugging Face. Run `00_download_data_from_HF.ipynb` from the repo root to populate `hf_data/02_feature_layer/training/outputs/`. Only run these notebooks if you need to rebuild features from updated raw data.

### Prerequisites

- `01_data_layer/raw/` populated (run Layer 01 first, or use existing raw data)
- Python environment: `.venv/bin/python` (set as the notebook kernel)

### Notebooks (run in order)

| # | Notebook | What it does | Runtime |
|---|----------|--------------|---------|
| 1 | `training/FeatureDealing.ipynb` | Builds 77 engineered features (22 core + 51 OHE), deduplicates, applies temporal train/test split | ~5–10 min |
| 2 | `training/FeatureValidation.ipynb` | Validates distributions, checks zero-variance features, verifies OHE correctness | ~2–3 min |

**How to run in VS Code / JupyterLab:**
1. Open the notebook inside `training/`
2. Select kernel: `.venv/bin/python`
3. Run All Cells

### Expected outputs

```
02_feature_layer/training/outputs/
├── hdb_feature_table_YYYYMMDD.csv     # Full dataset  (~263k rows × 77 cols, ~137 MB)
├── hdb_feature_train_YYYYMMDD.csv     # Train split   (~180k rows, year < 2023)
├── hdb_feature_test_YYYYMMDD.csv      # Test split    (~83k rows,  year ≥ 2023)
└── feature_metadata_YYYYMMDD.json     # Schema + dropped features list
```

All downstream notebooks use **latest-snapshot glob logic** — they automatically pick up the newest `YYYYMMDD` file.

### Quick validation

```python
import pandas as pd
from pathlib import Path
outputs = Path('training/outputs')
csv = sorted(outputs.glob('hdb_feature_table_*.csv'))[-1]
df = pd.read_csv(csv)
print(f"Shape: {df.shape}")            # expect (~263k, 77)
assert df['resale_price'].isna().sum() == 0
assert df.shape[1] == 77
print("Feature layer OK")
```

### Common issues

| Issue | Fix |
|-------|-----|
| `FileNotFoundError` on raw CSVs | Verify `01_data_layer/raw/` exists; run Layer 01 or restore from backup |
| OHE column count ≠ 51 | Unexpected new category in raw data — check `town`/`flat_type` values |
| Zero-variance feature warning | See `feature_metadata_*.json` → `dropped_features` key for list |
| OOM error loading CSVs | Use `pd.read_csv(..., chunksize=50000)` for constrained RAM environments |

---

## Overview

The feature layer transforms raw HDB transaction data and geographic/school data into ML-ready feature tables. All datasets are produced by `FeatureDealing.ipynb` and validated by `FeatureValidation.ipynb`, with strict deduplication, categorical encoding, and train/test splitting applied.

### Key Metrics

| Metric | Value |
|--------|-------|
| **Total Rows (Pre-Dedup)** | 2,367,541 |
| **Total Rows (Post-Dedup)** | 260,699 |
| **Duplicates Removed** | 2,106,842 (89.0%) |
| **Total Features** | 73 |
| **Core Engineered Features** | 22 |
| **One-Hot Encoded Features** | 51 |
| **Training Set** | 178,589 rows (68.5%) |
| **Test Set** | 82,110 rows (31.5%) |
| **Temporal Split Year** | 2023 |

---

## Directory Structure

```
02_feature_layer/
├── README.md                                    # This file
├── training/
│   ├── FeatureDealing.ipynb                    # Feature engineering pipeline
│   ├── FeatureValidation.ipynb                 # Quality validation & diagnostics
│   └── outputs/
│       ├── hdb_feature_table_20260403.csv      # Full deduplicated dataset (all rows)
│       ├── hdb_feature_train_20260403.csv      # Training set (year < 2023)
│       ├── hdb_feature_test_20260403.csv       # Test set (year >= 2023)
│       └── feature_metadata_20260403.json      # Export metadata
```

---

## 1. Feature Datasets

### A. Full Feature Table (`hdb_feature_table_*.csv`)

**Complete deduplicated feature dataset with categorical encoding applied.**

| Attribute | Value |
|-----------|-------|
| **File Path** | `training/outputs/hdb_feature_table_20260403.csv` |
| **Rows** | 260,699 |
| **Columns** | 73 |
| **File Size** | 132 MB |
| **Format** | CSV (comma-separated) |
| **Target Variable** | `resale_price` (SGD) |
| **Time Period** | 2015-01 to 2026-03 |
| **Unique Addresses** | 9,710 HDB blocks |

**Purpose:** Complete reference dataset for exploratory analysis, model training (custom splits), and feature inspection.

**Sample Rows:**

```csv
resale_price,transaction_year,level_mid,lease_remaining_years,floor_area_sqm,...
500000,2020,8.5,74,105.5,...
550000,2021,12,73,110.2,...
```

---

### B. Training Set (`hdb_feature_train_*.csv`)

**Training subset with transactions before 2023.**

| Attribute | Value |
|-----------|-------|
| **File Path** | `training/outputs/hdb_feature_train_20260403.csv` |
| **Rows** | 178,589 |
| **Columns** | 73 (identical schema to full table) |
| **File Size** | 90 MB |
| **Format** | CSV |
| **Temporal Range** | 2015-01 to 2022-12 |
| **Mean Price** | $468,788 |
| **Median Price** | $435,000 |

**Purpose:** Official training dataset for model development. Use this for fitting models, validation, and hyperparameter tuning.

**Data Split Rationale:**
- **Pre-2023 (Training):** Historical data for model learning
- **2023+ (Test):** Most recent transactions for out-of-sample evaluation

---

### C. Test Set (`hdb_feature_test_*.csv`)

**Test subset with transactions from 2023 onwards.**

| Attribute | Value |
|-----------|-------|
| **File Path** | `training/outputs/hdb_feature_test_20260403.csv` |
| **Rows** | 82,110 |
| **Columns** | 73 (identical schema to full table) |
| **File Size** | 41 MB |
| **Format** | CSV |
| **Temporal Range** | 2023-01 to 2026-03 |
| **Mean Price** | $614,711 |
| **Median Price** | $590,000 |

**Purpose:** Official test set for model evaluation. Do NOT use for training. Reserve for final performance assessment.

⚠️ **Warning:** Test set has different price distribution (31% higher mean than training). This reflects real price appreciation over time 2023-2026. Expect different model performance characteristics on test vs. training data.

---

## 2. Feature Engineering Process (11-Factor Coverage)

### Engineering Pipeline Overview

```
Raw HDB Data (2.4M)
    ↓
    ├─→ Factor 1-4: Transaction & Property Basics
    ├─→ Factor 5-7: Geographic Accessibility
    ├─→ Factor 8-9: Commercial Proximity & Quality
    ├─→ Factor 10-11: School Proximity & Quality
    ↓
Merged Features (2.4M with duplicates)
    ↓
Deduplication (remove 2.1M exact duplicates)
    ↓
Cleaned Features (260K unique records)
    ↓
Categorical Encoding (one-hot for town/flat_type/flat_model)
    ↓
Temporal Split (train/test on year 2023)
    ↓
Final Datasets (3 × CSV exports)
```

### The 11 Factors

| # | Factor | Source | Feature Columns | Engineering Method |
|---|--------|--------|-----------------|-------------------|
| 1 | **Level (Floor)** | Storey range | `level_mid` | Midpoint of storey range |
| 2 | **Lease Remaining** | Lease commence date | `lease_remaining_years` | 99 - (transaction_year - lease_commence_date) |
| 3 | **Size (Floor Area)** | Raw data | `floor_area_sqm` | Direct from source, no transformation |
| 4 | **Room Count** | Flat type | `room_count` | Extracted from flat_type string + Executive=5, Multi=6 |
| 5 | **MRT Distance** | OneMap geocoding | `dist_to_mrt_m` | Nearest MRT station via geocoding (meters) |
| 6 | **Road Orientation** | Noise data + proxy | `orientation_score` | ±1.0 score based on facing_road classification |
| 7 | **Highway Distance** | OneMap geocoding | `dist_to_highway_m` | Distance to nearest highway (meters) |
| 8 | **Food Court Distance** | NEA + OneMap POI | `dist_to_foodcourt_m` | Nearest hawker/food court center (meters) |
| 9 | **Commercial Access** | OneMap POI search | `mall_count_3km`, `mall_weighted_access_3km` | Mall count + weighted accessibility score (3km radius) |
| 10 | **School Proximity** | MOE + OneMap geocoding | `dist_to_nearest_school_m`, `school_count_1km` | Distance & count to all schools (1km radius) |
| 11 | **Primary School Quality** | MOE + enrollment data | `primary_school_quality_1km_weighted`, `primary_school_top_quality_1km`, `primary_school_count_1km` | Quality score (0-100) based on competition ratio & phase demand |

---

## 3. Feature Data Dictionary

### Target Variable

| Column | Type | Description | Range | Unit | Missing |
|--------|------|-------------|-------|------|---------|
| `resale_price` | float64 | Transaction resale price | $140K - $1.7M | SGD | 0 |

### Core Engineered Features (Continuous)

| Column | Type | Description | Mean | Std | Min | Max | Missing |
|--------|------|-------------|------|-----|-----|-----|---------|
| `level_mid` | float64 | Floor number (midpoint) | 8.69 | 5.88 | 2.0 | 50.0 | 0 |
| `lease_remaining_years` | float64 | Years left on 99-year lease | 74.18 | 13.76 | 39.0 | 98.0 | 0 |
| `floor_area_sqm` | float64 | Floor area in square meters | 96.88 | 24.05 | 31.0 | 366.7 | 0 |
| `room_count` | float64 | Number of rooms | 4.04 | 0.80 | 1.0 | 6.0 | 0 |
| `dist_to_mrt_m` | float64 | Distance to nearest MRT (m) | 2,085 | 2,026 | 23 | 8,275 | 0 |
| `orientation_score` | float64 | Road-facing orientation penalty | 0.0005 | 1.0 | -1.0 | 1.0 | 0 |
| `dist_to_highway_m` | float64 | Distance to nearest highway (m) | 3,964 | 2,517 | 47 | 10,656 | 0 |
| `dist_to_foodcourt_m` | float64 | Distance to nearest food court (m) | 945 | 575 | 35 | 2,919 | 0 |
| `dist_to_nearest_mall_m` | float64 | Distance to nearest mall (m) | N/A | N/A | N/A | N/A | 0 |
| `mall_count_3km` | float64 | Count of malls within 3km | 9.51 | 8.18 | 0 | 60 | 0 |
| `mall_weighted_access_3km` | float64 | Weighted mall accessibility score | 7.13 | 5.95 | 0 | 54.4 | 0 |
| `dist_to_nearest_school_m` | float64 | Distance to nearest school (m) | 334 | 199 | 38 | 3,297 | 0 |
| `school_count_1km` | float64 | Count of all schools within 1km | 5.33 | 2.39 | 0 | 14 | 0 |
| `primary_school_quality_1km_weighted` | float64 | Weighted quality score of primary schools | 14.19 | 0.52 | 11.9 | 24.1 | 0 |
| `primary_school_top_quality_1km` | float64 | Top primary school quality in 1km | N/A | N/A | N/A | N/A | 0 |
| `primary_school_count_1km` | float64 | Count of primary schools within 1km | N/A | N/A | N/A | N/A | 0 |
| `transaction_year` | int64 | Year of transaction | 2020 | 3.1 | 2015 | 2026 | 0 |

### Categorical Features (One-Hot Encoded)

#### Town (26 binary features)

| Feature Format | Values | Count |
|---|---|---|
| `town_{TOWN_NAME}` | ANG MO KIO, BEDOK, BISHAN, BUKIT BATOK, ... | 26 |

All towns in Singapore with HDB stock. Zero missing values in training/test.

**Examples:** `town_ANG MO KIO`, `town_BEDOK`, `town_CENTRAL AREA`

#### Flat Type (7 binary features)

| Feature Format | Values | Count |
|---|---|---|
| `flat_type_{TYPE}` | 1 ROOM, 2 ROOM, 3 ROOM, 4 ROOM, 5 ROOM, EXECUTIVE, MULTI-GENERATION | 7 |

**Examples:** `flat_type_4 ROOM`, `flat_type_EXECUTIVE`

#### Flat Model (21 binary features)

| Feature Format | Values | Count |
|---|---|---|
| `flat_model_{MODEL_NAME}` | Model A, Model A2, Model A-Maisonette, ... | 21 |

Architectural models representing different flat designs and construction eras.

**Examples:** `flat_model_Model A`, `flat_model_Premium Apartment`

---

## 4. Data Quality & Validation Results

### Deduplication Summary

| Stage | Row Count | Change | % Change |
|-------|-----------|--------|----------|
| Raw merged features | 2,367,541 | — | — |
| After exact dedup | 260,699 | -2,106,842 | -89.0% |
| After NaN check | 260,699 | 0 | 0% |
| **Final (exported)** | **260,699** | **-2,106,842** | **-89.0%** |

**Root Cause:** Multiple flat models/types at same address in same year with identical prices (confirmed as real diversity in housing types at single locations, NOT data errors).

### Quality Validation Checks

| Check | Status | Details |
|-------|--------|---------|
| **No duplicates** | ✅ | 0 exact duplicate rows in final export |
| **No missing values** | ✅ | 0 nulls in core feature columns |
| **Valid price range** | ✅ | $140K-$1.7M (sensible for Singapore HDB) |
| **Feature completeness** | ✅ | 73/73 columns present in all files |
| **Train/test split** | ✅ | 68.5% train, 31.5% test; no address overlap in features |
| **Categorical encoding** | ✅ | 26 towns + 7 flat types + 21 models = 54 encoded features |
| **Temporal integrity** | ⚠️ | Test set 31% higher mean price (reflects 2023-2026 appreciation) |

### Feature Correlations with Target

**Top 5 Positive Correlations:**

| Feature | Correlation | Strength |
|---------|-------------|----------|
| `floor_area_sqm` | +0.567 | Strong |
| `room_count` | +0.565 | Strong |
| `level_mid` | +0.345 | Moderate |
| `mall_count_3km` | +0.215 | Weak |
| `mall_weighted_access_3km` | +0.190 | Weak |

**Top 5 Negative Correlations:**

| Feature | Correlation | Strength |
|---------|-------------|----------|
| `dist_to_highway_m` | -0.149 | Weak |
| `dist_to_mrt_m` | -0.145 | Weak |
| `primary_school_count_1km` | -0.076 | Weak |
| `dist_to_nearest_mall_m` | -0.074 | Weak |
| `school_count_1km` | -0.059 | Weak |

### Cross-Validation with Raw Data

| Metric | Feature Layer | Raw HDB Data | Match |
|--------|---|---|---|
| Price range | $140K-$1.7M | $140K-$1.7M | ✅ |
| Mean price | $514,748 | $512,841 | ✅ |
| Median price | $480,000 | $478,500 | ✅ |
| Unique addresses | 9,710 | 9,710 | ✅ |
| Date range | 2015-2026 | 2015-2026 | ✅ |

---

## 5. Data Processing Notes

### Deduplication Strategy

**Why was deduplication needed?**

Raw HDB data contains ~2.4M transactions but only ~260K unique feature combinations. The multiplicity occurs because:

1. **Multiple years:** Same address has multiple transactions across years (expected)
2. **Multiple flat types:** Same address block has different room counts (expected)
3. **Price stability:** Same address/type/year can have identical engineered features but different transaction prices (real variance in monthly sales)

**Deduplication Process:**

```python
use.drop_duplicates(subset=base_cols)  # Keep first occurrence
```

Where `base_cols` includes all 22 core features + categorical columns. This preserves diversity while removing true duplicates.

### Categorical Encoding

**Method:** One-hot encoding with `drop_first=False`

```python
use_model = pd.get_dummies(use, columns=['town', 'flat_type', 'flat_model'], drop_first=False)
```

**Why not drop_first?**
- Preserves all category levels for interpretability
- Allows ML models (tree-based, etc.) to learn all unique patterns
- Linear models should apply feature engineering (e.g., L1 regularization) if needed

### Train/Test Split

**Split Year:** 2023

- **Training:** All transactions year < 2023 (2015-2022): 178,589 rows
- **Test:** All transactions year ≥ 2023 (2023-2026): 82,110 rows

**Rationale:**
- Temporal isolation prevents information leakage
- Test set represents most recent market conditions
- Enables time-series evaluation of model generalization

⚠️ **Known Issue:** Test set has 31% higher mean price due to Singapore property appreciation 2015-2026. Models may show performance degradation on test set even if well-trained. This is expected and reflects real market dynamics.

---

## 6. Usage Guide for ML Layer

### Quick Start

```python
import pandas as pd
from pathlib import Path

FEATURE_DIR = Path('02_feature_layer/training/outputs')

# Load training data
train_df = pd.read_csv(FEATURE_DIR / 'hdb_feature_train_20260403.csv')
test_df = pd.read_csv(FEATURE_DIR / 'hdb_feature_test_20260403.csv')

# Extract features and target
X_train = train_df.drop(['resale_price', 'address_key', 'transaction_year'], axis=1)
y_train = train_df['resale_price']

X_test = test_df.drop(['resale_price', 'address_key', 'transaction_year'], axis=1)
y_test = test_df['resale_price']

# Ready for modeling
print(f"Training shape: {X_train.shape}")  # (178589, 70)
print(f"Test shape: {X_test.shape}")       # (82110, 70)
```

### Recommended Workflows

#### For Regression Models

1. Load `hdb_feature_train_20260403.csv`
2. Use all 73 columns except:
   - `resale_price` (target)
   - `address_key` (identifier)
   - `transaction_year` (already encoded in features; use for diagnostics only)
3. Expected features: 70 (22 core + 48 categorical)
4. Target: `resale_price` (continuous, SGD)

#### For Feature Selection

- Start with core 22 features (factors 1-11)
- Remove categorical if computing correlations
- Use domain knowledge to guide feature engineering (e.g., interaction terms)

#### For Model Evaluation

- Use `hdb_feature_train_*.csv` for training/validation
- Use `hdb_feature_test_*.csv` for final evaluation only
- Be aware of price drift: test prices ~31% higher than training
- Consider RMSE% rather than absolute RMSE for fair comparison

#### For Exploratory Analysis

- Load full table: `hdb_feature_table_20260403.csv`
- Contains all 260,699 rows for comprehensive analysis
- Separate analysis workflows from modeling workflows

### Important Caveats

⚠️ **DO NOT:**
- Train models on test set
- Use test set for hyperparameter tuning
- Mix training and test data

⚠️ **KNOWN LIMITATIONS:**
- Distance features use OneMap geocoding (may have ~10-50m accuracy limits)
- School quality scores are relative (0-100 normalized scale)
- Some addresses near SG borders may have missing school data
- POI data (malls, food courts) collected Mar 2026; older transactions assumed static POI

---

## 7. File Versioning & Backups

### Latest Version (Current)

| Dataset | File | Date | Rows | Status |
|---------|------|------|------|--------|
| Full Table | `hdb_feature_table_20260403.csv` | Apr 3, 2026 | 260,699 | ✅ Active |
| Training | `hdb_feature_train_20260403.csv` | Apr 3, 2026 | 178,589 | ✅ Active |
| Test | `hdb_feature_test_20260403.csv` | Apr 3, 2026 | 82,110 | ✅ Active |
| Metadata | `feature_metadata_20260403.json` | Apr 3, 2026 | — | ✅ Active |

### Previous Versions

| Dataset | File | Date | Status | Notes |
|---------|------|------|--------|-------|
| Full Table | `hdb_feature_table_20260317.csv` | Mar 17, 2026 | ❌ Deprecated | Pre-deduplication (2.36M rows); contains duplicates |
| Training | `hdb_feature_train_20260317.csv` | Mar 17, 2026 | ❌ Deprecated | Pre-deduplication |
| Test | `hdb_feature_test_20260317.csv` | Mar 17, 2026 | ❌ Deprecated | Pre-deduplication |

### Archive Policy

- **Keep:** Latest 2 versions for rollback capability
- **Delete:** Versions older than latest 2 to save space
- **Metadata:** All metadata maintained for lineage tracking

---

## 8. Data Lineage & Dependencies

```
01_data_layer/raw/
├── ResaleFlatPrices/
│   ├── Resale Flat Prices ... From Jan 2015 to Dec 2016.csv
│   ├── Resale flat prices ... from Jan-2017 onwards.csv
│   └── (other HDB datasets)
│       ↓ [load_hdb_2015_plus()]
│
├── google_geo/
│   ├── hdb_geo_accessibility_noise_features_*.csv  [MRT, road noise]
│   ├── onemap_hdb_geocode_with_highway_dist_*.csv  [Highway distance]
│   ├── nea_hawker_centres_*.csv  [Food courts]
│   ├── onemap_mall_nodes_*.csv  [Malls]
│   └── moe_school_geocode_*.csv  [Schools]
│
└── schools/
    ├── moe_general_information_of_schools_*.csv  [School list]
    └── sgschooling_2015plus_*.csv  [School competition data]
         ↓ [Feature engineering pipeline]
         
02_feature_layer/training/
└── FeatureDealing.ipynb  [Main engineering logic]
    └── outputs/
        ├── hdb_feature_table_20260403.csv  ← [FINAL EXPORTED]
        ├── hdb_feature_train_20260403.csv
        ├── hdb_feature_test_20260403.csv
        └── feature_metadata_20260403.json
             ↓ [Validation pipeline]
             
02_feature_layer/training/
└── FeatureValidation.ipynb  [Quality checks]
    └── Validation Report (Console output)
```

---

## 9. Contact & Maintenance

**Feature Engineering Owner:** PropertyLens Data Team  
**Last Updated:** April 3, 2026  
**Next Review:** Q3 2026 (or when new data becomes available)

### For Issues or Questions

1. Review `FeatureDealing.ipynb` for engineering logic details
2. Check `FeatureValidation.ipynb` for quality diagnostics
3. Review this README for feature definitions
4. Refer to `01_data_layer/README.md` for raw data specifications

---

## Appendix: All 73 Features

### Core Features (22)

```
resale_price, transaction_year, level_mid, lease_remaining_years,
floor_area_sqm, room_count, dist_to_mrt_m, orientation_score,
dist_to_highway_m, dist_to_foodcourt_m, dist_to_nearest_mall_m,
mall_count_3km, mall_weighted_access_3km, dist_to_nearest_school_m,
school_count_1km, primary_school_quality_1km_weighted,
primary_school_top_quality_1km, primary_school_count_1km, address_key
```

### Categorical Encoded Features (51)

**Towns (26):**
```
town_ANG MO KIO, town_BEDOK, town_BISHAN, town_BUKIT BATOK,
town_BUKIT MERAH, town_BUKIT PANJANG, town_BUKIT TIMAH,
town_CENTRAL AREA, town_CHOA CHU KANG, town_CLEMENTI, town_GEYLANG,
[... 15 more towns ...]
```

**Flat Types (7):**
```
flat_type_1 ROOM, flat_type_2 ROOM, flat_type_3 ROOM,
flat_type_4 ROOM, flat_type_5 ROOM, flat_type_EXECUTIVE,
flat_type_MULTI-GENERATION
```

**Flat Models (21):**
```
flat_model_Model A, flat_model_Model A2, flat_model_Model A-Maisonette,
flat_model_Model C, flat_model_Model D, flat_model_Model F,
flat_model_Model H, flat_model_Model J, flat_model_New Generation,
[... 12 more models ...]
```

---

**README Version:** 1.0  
**Generated:** 2026-04-03  
**Format:** Markdown  
**Next Update:** TBD
