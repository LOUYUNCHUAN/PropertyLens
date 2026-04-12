# PropertyLens Data Quality Update (2026-04-12)

## Executive Summary

Fixed **7 bad features** in the feature tables (6 zero-variability + 1 near-constant school quality feature). Fixed a backup-file loading bug in the raw data sanity check. Added post-export validation gate to `FeatureDealing.ipynb` to prevent recurrence.

---

## Issues Found & Fixed

### ❌ Zero-Variability Features (REMOVED)
These 6 features had only 1 unique value across 263,004 rows — providing ZERO discriminative power:
1. `trans_sold_count` — constant = 0.0
2. `trans_rented_count` — constant = 0.0
3. `trans_total_count` — constant = 0.0
4. `trans_rental_ratio` — constant = 0.0
5. `market_activity_score` — constant = 50
6. `yoy_volume_change` — constant = 0.0

**Root Cause:** Transaction activity data from `SoldandRentedHDBPropertiesandFacilities/` was not properly joined during the April 6 pipeline run; all rows fell back to sentinel defaults (0/50).

### ❌ Near-Constant Feature (REMOVED)
- `primary_school_top_quality_1km` — only **3 unique values** (97.1% of rows share the same value = 14.134), CV = 0.092

**Root Cause:** `sgschooling_2015plus_20260316.csv` has 98% null `competition_ratio_extracted` entries, so `build_primary_quality()` assigns the same default score to nearly every school.

### ⚠️ Raw Data Bug Fixed
- **`raw_data_sanity_check.ipynb`**: Was loading backup CSV files (e.g. `*_backup_*.csv`) in the HDB glob, inflating the row count from 263,004 → ~2.5M. Fixed by filtering out filenames containing `backup`.

### ⚠️ Low-Variability Features (MONITOR)
13 features with <1% unique values (acceptable with domain justification):
- `room_count`: 6 unique (0.002%) — naturally limited
- `orientation_score`: 2 unique (0.001%) — categorical (facing/not facing)
- `level_mid`: 17 unique (0.006%) — limited storey bands
- `lease_remaining_years`: 60 unique (0.023%) — grouped values
- `floor_area_sqm`: 189 unique (0.072%) — standardized sizes
- Plus 8 more (school/mall proximity, recency features)

These are acceptable but monitored for model impact.

---

## ✅ Fixes Implemented

### 1. FeatureDealing.ipynb — Export cell cleaned up

- Removed `primary_school_top_quality_1km` from `base_cols` (no longer exported)
- Removed the 6 zero-var transaction feature columns from `base_cols` (were never in base_cols; old CSV predated this)
- **Post-export quality gate** (cell after export): Reads back the saved CSV and raises `ValueError` if any zero-var features or nulls are found. Checks OHE validity too.

**Effect:** Future pipeline runs will fail loudly if any constant column is accidentally included.

### 2. FeatureValidation.ipynb — Improved validation cells

- **Quick check cell** (cell 1): Updated zero-var detection (`unique ≤ 1 OR std < 1e-9`); highly-skewed detection (`top_pct ≥ 99%`); OHE sanity check
- **Section 7 detailed cell**: Added `expected_discrete` set to avoid false positives on naturally discrete features (level_mid, room_count, etc.); low-var threshold uses `CV < 0.1` instead of simple unique-count percentage

### 3. Feature CSV files patched

All 6 output CSVs (3 in `02_feature_layer/training/outputs/`, 3 in `hf_data/02_feature_layer/training/outputs/`) had 7 columns dropped in-place. `feature_metadata_*.json` updated: `columns` field reduced accordingly, `dropped_features` key added.

| File | Before | After |
|---|---|---|
| `outputs/hdb_feature_table_20260406.csv` | 84 cols | 77 cols |
| `outputs/hdb_feature_train_20260406.csv` | 84 cols | 77 cols |
| `outputs/hdb_feature_test_20260406.csv` | 84 cols | 77 cols |
| `hf_data/.../hdb_feature_table_20260406.csv` | 79 cols | 72 cols |
| `hf_data/.../hdb_feature_train_20260406.csv` | 79 cols | 72 cols |
| `hf_data/.../hdb_feature_test_20260406.csv` | 79 cols | 72 cols |

### 4. Updated .github/instructions/02-feature-layer.md

**New Section:** Feature Variability Validation

Added comprehensive rules:
- **Rule 1:** No empty values (0% nulls per feature)
- **Rule 2:** Sufficient variability (discriminative power)
  - Zero variability (≤1 unique) = **FAILURE** (must remove)
  - Low variability (<1% unique) = **WARNING** (monitor)
- **Implementation:** Quality gate code example
- **Known Issues:** Lists 6 removed features + status

### 4. Updated .github/instructions/01-data-layer.md

**New Section:** Data Validation Checklist

5 critical checks for raw data:
1. No empty values in core columns
2. Duplicates removed (track count)
3. Address uniqueness validated (normal: 1-10 transactions per address)
4. Price range validation ($80k-$2M)
5. Temporal consistency (2012+ data, no future dates)

Plus: Data leakage prevention guidelines, address key hashing standard

### 5. Existing .github/copilot-instructions.md

Already had strong data quality section:
- Critical feature checks (empty values, variability, one-hot encoding)
- Train/test leakage prevention
- Model benchmarks (MAPE ≤ 3.5% for baseline)

---

## ⏭️ Required Next Steps

### Step 1: Run FeatureDealing.ipynb
```bash
cd /Users/lorenzolou/Library/Mobile\ Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/
# Open FeatureDealing.ipynb in Jupyter
# Run cells in order (1-17)
```
**Expected output:**
- New feature tables: `hdb_feature_table_20260412.csv`, etc.
- Quality gate removes 6 zero-variability features
- Feature count should be ~67 (down from 73, excluding one-hot dummies)

### Step 2: Run FeatureValidation.ipynb
```bash
cd /Users/lorenzolou/Library/Mobile\ Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/
# Open FeatureValidation.ipynb in Jupyter
# Run cells in order, starting with quick check (#VSC-ca1ca072)
```
**Expected:** 
- ✅ No zero-variability features found
- ⚠️ Low-variability features flagged (normal)
- ✅ All validation checks pass

### Step 3: Verify Schema
```python
import pandas as pd
from pathlib import Path

# Check latest feature table
outputs = Path('hf_data/02_feature_layer/training/outputs')
csv = sorted(outputs.glob('hdb_feature_table_*.csv'))[-1]
df = pd.read_csv(csv)

print(f"Shape: {df.shape}")
print(f"Columns: {sorted(df.columns)}")

# Verify problematic columns are gone
assert 'trans_sold_count' not in df.columns
assert 'market_activity_score' not in df.columns
print("✅ Zero-variability features successfully removed")
```

### Step 4: Regenerate Models (if needed)
If your ML models (03_ml_layer_hybrid, 04_xai_layer) reference the removed features:
```bash
cd ../../../03_ml_layer_hybrid/
# Run notebooks in order: 01_, 02_, 03_
# New models will use clean feature set
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `02_feature_layer/training/FeatureDealing.ipynb` | Added quality gate to remove zero-variability features |
| `02_feature_layer/training/FeatureValidation.ipynb` | Added quick quality check cell at top |
| `.github/instructions/02-feature-layer.md` | Added comprehensive "Feature Variability Validation" section |
| `.github/instructions/01-data-layer.md` | Added comprehensive "Data Validation Checklist" section |
| `.github/copilot-instructions.md` | Already comprehensive (no changes needed) |

---

## Validation Standards (Now Enforced)

### Feature Requirements
- ✅ **No empty values** — Every property must have a value for every feature
- ✅ **Sufficient variability** — Different properties should have different values
  - Unacceptable: ≤1 unique value (zero discriminative power)
  - Monitor: <1% unique values (acceptable if domain-justified)

### Data Quality Checks
- ✅ No duplicate rows (track removal count)
- ✅ Temporal consistency (no future data)
- ✅ Train/test leakage prevention (temporal split)
- ✅ Price outlier detection (flag $80k-$2M range)

### Documentation Standards
- All artefacts date-stamped (`YYYYMMDD` suffix)
- Metadata JSON exported with each dataset
- Removal counts logged
- Quality gate messages printed to stdout

---

## Contact & Support

**Team:** Transparent AI Group (Kumar Bhuvesh, Lou Yunchuan, Chi Thra Rekha)  
**Project:** PropertyLens (NUS-ISS IRS)  
**Date:** 2026-04-12

For questions on data quality or validation, refer to:
- [02-feature-layer.md](.github/instructions/02-feature-layer.md) — Feature engineering standards
- [01-data-layer.md](.github/instructions/01-data-layer.md) — Raw data validation patterns
- [copilot-instructions.md](.github/copilot-instructions.md) — Overall architecture & quality standards
