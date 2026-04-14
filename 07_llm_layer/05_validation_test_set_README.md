# Notebook 05 — Validation Against Test Set (2023–2026)

**Layer:** Quality Assurance & Validation  
**Notebook:** `05_validation_test_set.ipynb`  
**Last Updated:** April 2026  
**Document Version:** 1.0  
**Owner:** PropertyLens AI Engineering Team  

---

## Purpose

This notebook is the final quality gate for the entire pipeline. It constructs a structured evaluation suite of 25 queries (5 per intent type) using only values drawn from `hdb_feature_test_20260403.csv`, runs them through the full pipeline, and measures three dimensions of quality: intent classification accuracy, price estimation RMSE%, and hallucination compliance.

> ⚠️ **Critical constraint:** This notebook uses `hdb_feature_test_20260403.csv` exclusively for evaluation. The training file (`hdb_feature_train_20260403.csv`) is never loaded here. Per README section 6: *"Do NOT train models on test set"* and *"Reserve for final performance assessment."*

---

## Inputs

| File | Location | Description |
|------|----------|-------------|
| `hdb_feature_test_20260403.csv` | `02_feature_layer/training/outputs/` | 82,110 rows, year 2023–2026, mean $614,711 |
| Full pipeline | Notebooks 01–04 | Neo4j, FAISS indexes, Flash classifier, Pro generator |

> **Scope boundary:** All evaluation query values (towns, flat types, price bounds, year ranges) are drawn only from the test CSV. No invented place names, price figures, or categories are used.

---

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| Intent accuracy | float (%) | % of queries classified to correct intent type |
| RMSE% | float (%) | Root mean square percentage error for price estimation queries |
| Mean absolute % error | float (%) | Average price estimation % error |
| Retrieval recall@20 | proxy metric | Average vector hits returned per query |
| Hallucination audit | pass/fail + report | Zero-tolerance check on all 25 responses |

---

## Test Set Statistics

These values are computed at runtime from `hdb_feature_test_20260403.csv` and used as ground truth anchors for evaluation query construction.

| Metric | Value | Source |
|--------|-------|--------|
| Row count | 82,110 | README section 2C |
| Year range | 2023–2026 | README section 5 |
| Mean price | $614,711 | README section 2C |
| Median price | $590,000 | README section 2C |
| Min price | $140,000 (approx) | Dataset bounds |
| Max price | $1,700,000 (approx) | Dataset bounds |
| Lease remaining range | 39–98 years | Feature data dictionary |
| Unique towns | 26 | One-hot encoded |
| Unique flat types | 7 | One-hot encoded |

---

## Evaluation Query Set — 25 Queries

### Construction rules

1. All `town` values must be one of the 26 towns present in the test CSV
2. All `flat_type` values must be one of the 7 valid types
3. All `room_count` values must be integers 1–6
4. All price bounds must be within the dataset range ($140K–$1.7M)
5. All year ranges must be within 2023–2026 (test set bounds)
6. No MRT station names, school names, mall names, or street names are used — these are not present as discrete values in the dataset

### Distribution

| Intent Type | Query count | Ground truth available |
|-------------|-------------|----------------------|
| `PRICE_ESTIMATION` | 5 | Yes — median from test CSV per town/type |
| `NEIGHBOURHOOD` | 5 | No (qualitative output) |
| `SCHOOL_CATCHMENT` | 5 | No (qualitative output) |
| `INVESTMENT_TEMPORAL` | 5 | No (trend output) |
| `LEASE_ADVISORY` | 5 | No (advisory output) |

Ground truth for `PRICE_ESTIMATION` is computed as: `df_test[(df_test.town==T) & (df_test.room_count==R)].resale_price.median()`

---

## Metrics

### 1. Intent classification accuracy

```
accuracy = correct_intent_count / total_queries × 100
```

Acceptable threshold: ≥ 90% (23/25 queries correctly classified).

### 2. RMSE% — price estimation

Used instead of absolute RMSE per README section 6 guidance, because the test set mean is 31% higher than the training set. Absolute RMSE would be misleading.

```python
pct_error = abs(estimated_sgd - actual_median_sgd) / actual_median_sgd × 100
rmse_pct  = sqrt(mean(pct_errors²))
```

Acceptable threshold: RMSE% ≤ 15% (indicative — set by team before launch).

### 3. Retrieval recall@20

Proxy metric: counts how many comparable flats were returned by the FAISS vector search. Full recall@20 (checking if correct town's transactions appear in retrieved set) requires comparing retrieved `address_key` values against the test set — implemented in production logging.

### 4. Hallucination audit

Zero-tolerance check. Every response is parsed for strings not derivable from the dataset.

**Allowlists used in audit:**

| Allowlist | Values |
|-----------|--------|
| Valid towns | 26 uppercase town strings |
| Valid flat types | 7 type strings |
| Valid flat models | 21 flat model strings from feature README appendix |
| Valid price range | $140,000 – $1,700,000 |
| Valid year range | 2015 – 2026 |
| Valid lease range | 39 – 98 years |
| Valid feature names | All 22 core feature column names from feature_metadata |

**What triggers a flag:**

- Any uppercase token ≥ 5 characters in the response narrative not present in the town/type/model allowlists (catches invented MRT station names, school names, mall names)
- Any `estimate_sgd` value outside the dataset price range
- Any `key_factor.factor_name` not present in the 22 known feature column names

**Fail threshold:** 0 hallucinations. Any flagged response requires tightening the Gemini 1.5 Pro system prompt (see Notebook 04, cell 4.6).

---

## Cell-by-Cell Summary

| Cell | Section | Action |
|------|---------|--------|
| 5.1 | Install & imports | Load test CSV, print shape and price stats |
| 5.2 | Decode one-hot | Recover town, flat_type, flat_model strings |
| 5.3 | Build 25 queries | Construct evaluation set from test CSV values only |
| 5.4 | Run pipeline | Execute all 25 queries through `run_pipeline()` |
| 5.5 | Intent accuracy | Compare predicted vs expected intent type |
| 5.6 | RMSE% | Price estimation error against test set ground truth |
| 5.7 | Recall@20 | Count vector hits per query |
| 5.8 | Hallucination audit | Parse responses against allowlists |
| 5.9 | Summary report | Print final pass/fail validation table |

---

## Validation Summary Report Format

```
=======================================================
VALIDATION SUMMARY
=======================================================
Total queries run:          25
Pipeline errors:            0
Successful runs:            25
Intent accuracy:            24/25 (96.0%)
Hallucinations detected:    0
Hallucination pass:         YES
Price RMSE%:               8.4%
=======================================================
```

---

## Dependencies

```
pandas>=2.0
numpy>=1.24
```

All other dependencies inherited from Notebooks 01–04.

---

## Important: Do Not Cross-Contaminate

| Action | Allowed |
|--------|---------|
| Load `hdb_feature_test_20260403.csv` for evaluation | ✓ Yes |
| Load `hdb_feature_train_20260403.csv` for evaluation | ✗ No |
| Use test set mean/median as query anchors | ✓ Yes |
| Use training set mean/median as query anchors | ✗ No |
| Adjust pipeline hyperparameters based on test results | ✗ No — use training set for tuning |

---

## Known Limitations

- The hallucination audit uses regex token extraction and a fixed allowlist. It may miss hallucinations that happen to spell a valid town name (e.g. model says "BISHAN MRT" — "BISHAN" is valid, "MRT" is flagged only if it appears as an unknown capitalised token). Production audit should use a stricter named-entity checker.
- Ground truth for non-price intents (neighbourhood, school, lease, investment) is not computed — these are verified manually by domain review, not automated metrics.
- `primary_school_quality_1km_weighted` range in the dataset is 11.9–24.1 (not 0–100 as labelled). The audit permits any float in [0, 100] for this field — a narrower check (11–25) would be more precise.
- Recall@20 is a proxy only. Full precision/recall requires a labelled ground-truth retrieval set, which is not provided in the current feature layer outputs.

---

## Next Steps After Validation

If all checks pass (intent accuracy ≥ 90%, RMSE% ≤ 15%, hallucinations = 0):

1. Log the 25-query evaluation results as a versioned artefact alongside `hdb_feature_test_20260403.csv`
2. Lock the system prompt version used in Notebook 04
3. Schedule re-evaluation when new feature data is available (next review: Q3 2026 per feature layer README section 9)

If any check fails:

- **Intent accuracy < 90%:** Revise the Flash classifier system prompt (Notebook 03, cell 3.3)
- **RMSE% > 15%:** Increase `top_k` in vector retrieval, or re-weight context section ordering in Notebook 04
- **Hallucinations detected:** Tighten Gemini 1.5 Pro system prompt constraints (Notebook 04, cell 4.6)
