# Data Layer Instructions

**Scope:** `01_data_layer/` raw data collection, validation, and versioning  
**Key Notebooks:**
- `pipelines/raw_data_collection.ipynb` — End-to-end collection
- `pipelines/raw_data_sanity_check.ipynb` — Validation & backup

**Reference:** [Data Layer README](README.md) | [Root Instructions](../CLAUDE.md)

---

## 1. Role & Outputs

**Purpose:** Maintain versioned raw datasets from public sources (data.gov.sg, OneMap, MOE) that feed into feature engineering.

**Output Artefacts:**
- `raw/ResaleFlatPrices/*.csv` — HDB transaction history (3 datasets, ~315k rows total)
- `raw/schools/*.csv` — MOE school metadata, rankings, geocoding
- `raw/google_geo/*.csv` — Geocoded HDB blocks, MRT/transit nodes, malls, hawkers, schools, highway distances, accessibility/noise
- `raw_collection_metadata_*.json` — Lineage metadata (source, collection date, record counts)

**File Naming:** All outputs use `YYYYMMDD` suffixes for versioning (e.g. `raw_collection_metadata_20260316.json`)

---

## 2. Data Collection Workflow

### HDB Resale Data (`ResaleFlatPrices/`)
- **Source:** data.gov.sg (public download, no auth required)
- **3 datasets merged:**
  1. Mar 2012 — Dec 2014 (~52k rows)
  2. Jan 2015 — Dec 2016 (~37k rows)
  3. Jan 2017+ (~226k rows)
- **Columns:** month, town, block, street_name, storey_range, flat_type, flat_model, lease_commence_date, resale_price, floor_area_sqm, remaining_lease
- **Key corrections:**
  - Remove duplicates (~668 per batch)
  - Restore missing `remaining_lease` via formula: `99 - (transaction_year - lease_commence_date)`

### School Data (`schools/`)
- **Primary:** `moe_general_information_of_schools_*.csv` — Official MOE dataset
- **Secondary:** `sgschooling_2015plus_*.csv` — School allocation history, cutoff points, rankings
  - **Known data sparsity (2026-04-12):** ~98% null `competition_ratio_extracted`, ~97.8% null `applicants_extracted`/`vacancies_extracted`. This causes downstream school quality features to have very low variability. Monitor when refreshing data.
- **Geocoding:** `moe_schools_geocode_*.csv` — Latitude/longitude (via OneMap batch lookup)

### Geospatial & POI Data (`google_geo/`)
- **HDB Geocoding:** `onemap_hdb_geocode_with_highway_dist_*.csv` — Block centroids + highway proximity features
- **Transit/MRT:** `onemap_mrt_lrt_nodes_*.csv` — MRT/LRT stations with distances
- **Accessibility:** `hdb_geo_accessibility_noise_features_*.csv` — Derived features (distance to freeways, noise estimates)
- **Hawkers:** `nea_hawker_centres_*.csv` — Hawker centre locations + distances
- **Malls:** `onemap_mall_nodes_*.csv` — Shopping centre locations
- **Parks:** `onemap_parks_playgrounds_*.csv` — Recreation facilities

---

## 3. Standard Patterns

### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
DATA_RAW = REPO_ROOT / '01_data_layer/raw'
```

### Checkpoint Metadata
When exporting data, **always create metadata JSON:**
```python
import json
from datetime import datetime

metadata = {
    "collection_date": datetime.now().isoformat(),
    "dataset_name": "raw_hdb_resale",
    "row_count": len(df),
    "columns": df.columns.tolist(),
    "duplicates_removed": 668,
    "lease_imputed_count": 277915,
    "sources": [
        "data.gov.sg/HDB-Resale",
        "data.gov.sg/MOE-Schools",
        "OneMap API (batch geocoding)"
    ]
}
with open(f"raw_collection_metadata_{datetime.now().strftime('%Y%m%d')}.json", "w") as f:
    json.dump(metadata, f, indent=2)
```

### Data Validation Checklist

Before exporting any raw dataset, verify these checks pass:

1. **No Empty Values** — All key columns must be complete
   ```python
   critical_cols = ['block', 'street_name', 'town', 'resale_price', 'month_dt', 'lease_commence_date']
   empty_check = df[critical_cols].isnull().sum()
   assert empty_check.sum() == 0, f"Found empty values: {empty_check[empty_check > 0]}"
   ```

2. **No Duplicate Records** — Exact duplicates should be removed
   ```python
   # IMPORTANT: Always filter out backup files when globbing CSVs
   hdb_files = [f for f in Path(hdb_dir).glob('*.csv') if 'backup' not in f.name.lower()]
   before = len(df)
   df = df.drop_duplicates()
   after = len(df)
   print(f"Duplicates removed: {before - after} ({100*(before-after)/before:.1f}%)")
   ```

3. **Address Uniqueness** — Different transactions may share same address (multiple years is normal)
   ```python
   addr_key = df['block'].astype(str) + ' ' + df['street_name'].astype(str)
   avg_trans_per_addr = len(df) / addr_key.nunique()
   print(f"Avg transactions/address: {avg_trans_per_addr:.1f}")
   # Expected: ~1-10 transactions per address — this is NORMAL
   ```

4. **Price Range Validation** — Flag suspect prices
   ```python
   valid_price_range = (df['resale_price'] >= 80000) & (df['resale_price'] <= 2000000)
   outliers = (~valid_price_range).sum()
   print(f"Price outliers (outside 80k-2M): {outliers}")
   ```

5. **Temporal Consistency** — Transactions should span expected date range
   ```python
   df['month_dt'] = pd.to_datetime(df['month'], errors='coerce')
   years = df['month_dt'].dt.year
   assert years.min() >= 2012, f"Unexpected old transactions: {years.min()}"
   ```

#### Data Leakage Prevention
- **Never mix train/test data during collection** — Raw data is collected as-is; train/test split happens only in **02_feature_layer**
- **Time ordering:** If refreshing datasets, append new data (don't overwrite historical)
- **Address keys:** Use consistent hashing: `hashlib.md5(f"{block}|{street}|{town}".encode()).hexdigest()`

#### Standard Checks
- [ ] Duplicates: Check for exact row matches; log count removed
- [ ] Missing Values: Verify `remaining_lease` is imputed; target 0% nulls in critical fields
- [ ] Date Parsing: Ensure `month` and `month_dt` are consistent (e.g. "2015-01" → datetime(2015, 1, 1))
- [ ] Price Outliers: Verify range ~$140k–$1.7M; flag and document any outside range
- [ ] Lease Sanity: remaining_lease should be 39–98 years; mean ~74 years
- [ ] Geocoding: Check lat/lon ranges for Singapore (1.2°–1.5°N, 103.6°–104.1°E)
- [ ] OneMap Rate Limit: If batch geocoding, implement 500ms sleep between requests

### OneMap Batch Geocoding
- **Auth:** Use `ONEMAP_API_KEY` from `.env`
- **Rate limit:** ~2–3 requests/sec (add `time.sleep(0.5)` between batches)
- **Checkpoint:** Save intermediate results every 500 records to handle network failures
  ```python
  checkpoint_file = "onemap_geocode_checkpoint.csv"
  if Path(checkpoint_file).exists():
      existing = pd.read_csv(checkpoint_file, index_col='block_street_id')
      to_geocode = addresses[~addresses.index.isin(existing.index)]
  ```

---

## 4. Quality Standards

### Duplicate Removal
```python
before = len(df)
df = df.drop_duplicates()
after = len(df)
print(f"Duplicates removed: {before - after}")
assert after > 0, "All data was duplicates!"
```

### Lease Imputation
```python
missing_mask = df['remaining_lease'].isna()
df.loc[missing_mask, 'remaining_lease'] = (
    99 - (df.loc[missing_mask, 'transaction_year'] -
          df.loc[missing_mask, 'lease_commence_date'])
)
print(f"Lease imputed: {missing_mask.sum()} rows")
assert df['remaining_lease'].isna().sum() == 0, "Still missing remaining_lease!"
```

### Temporal Consistency
```python
df['inferred_year'] = pd.to_datetime(df['month']).dt.year
assert (df['inferred_year'] == df['transaction_year']).all(), "Month/year mismatch!"
```

---

## 5. Backup Protocol

- **When:** After each major collection run or correction batch
- **Format:** Copy output CSVs with suffix `_backup_YYYYMMDD.csv`

---

## 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| OneMap API 429 (rate limit) | Reduce batch size; add `time.sleep(1)` between requests; check `ONEMAP_API_KEY` in `.env` |
| Missing school geocoding | Verify school names match MOE dataset exactly; use fuzzy match if needed |
| Highway distance calculation slow | Cache geocoded coords; use vectorized haversine via numpy |
| Lease remaining is negative | Check `lease_commence_date` > transaction year; may indicate source data entry error |
| Duplicate rows across versions | Merge strategy: take latest version by transaction_year; document in metadata |
| Backup CSVs inflating row counts | Filter `*_backup_*.csv` out of globs (see Data Validation step 2) |
