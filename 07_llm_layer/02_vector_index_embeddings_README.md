# Notebook 02 — Vector Index: Flat Embeddings for RAG

**Layer:** RAG Foundation — Vector Store  
**Notebook:** `02_vector_index_embeddings.ipynb`  
**Last Updated:** April 2026  
**Document Version:** 1.0  
**Owner:** PropertyLens AI Engineering Team  

---

## Purpose

This notebook converts all 260,699 HDB flat records into dense vector embeddings using Gemini `text-embedding-004`, then builds two temporally-split FAISS indexes for semantic retrieval. The split is mandatory: the test set (2023–2026) has a 31% higher mean price than the training set, so mixing slices would systematically bias current-price estimates with stale comparables.

---

## Inputs

| File | Location | Size | Description |
|------|----------|------|-------------|
| `hdb_feature_table_20260403.csv` | `02_feature_layer/training/outputs/` | 132 MB | Full deduplicated dataset — 260,699 rows × 73 cols |

> **Scope boundary:** Embedding text is constructed solely from the 22 core feature columns. No external text, property descriptions, or data not present in the CSV is used.

---

## Outputs

| File | Location | Records | Description |
|------|----------|---------|-------------|
| `index_pre2023.faiss` | `03_vector_index/` | 178,589 | FAISS IndexFlatIP — transactions 2015–2022 |
| `meta_pre2023.parquet` | `03_vector_index/` | 178,589 | Scalar metadata for post-retrieval filtering |
| `index_post2023.faiss` | `03_vector_index/` | 82,110 | FAISS IndexFlatIP — transactions 2023–2026 |
| `meta_post2023.parquet` | `03_vector_index/` | 82,110 | Scalar metadata for post-retrieval filtering |
| `all_embeddings.npy` | `03_vector_index/` | 260,699 × 768 | Full embedding matrix (float32) checkpoint |

---

## Temporal Split

The split year is `2023`, matching the train/test boundary defined in the source feature layer.

| Slice | Records | Year Range | Mean Price | Median Price |
|-------|---------|-----------|------------|--------------|
| Pre-2023 (training) | 178,589 | 2015–2022 | $468,788 | $435,000 |
| Post-2023 (test/recent) | 82,110 | 2023–2026 | $614,711 | $590,000 |
| **Delta** | — | — | **+31%** | **+35%** |

> ⚠️ **Price drift warning:** The 31% mean price gap is real market appreciation — not a data error. See README section 3 of `02_feature_layer`. At query time, "current price" queries must retrieve from `index_post2023` only. Mixing slices will produce underestimated prices for 2023+ transactions.

---

## Embedding Strategy

### Model
`models/text-embedding-004` (Gemini) — 768-dimensional dense vectors, cosine similarity via inner product after L2 normalisation.

### Text template

Constructed from the 22 core feature columns. One-hot columns are decoded to strings before templating.

```
{town} {flat_type} {flat_model}
storey={level_mid}
area={floor_area_sqm}sqm
rooms={room_count}
lease={lease_remaining_years}yrs
price={resale_price}
year={transaction_year}
mrt={dist_to_mrt_m}m
school={dist_to_nearest_school_m}m
mall_count={mall_count_3km}
school_quality={primary_school_quality_1km_weighted}
```

**Example:**
```
BISHAN 4 ROOM New Generation
storey=8.5 area=105.0sqm rooms=4 lease=74yrs
price=500000 year=2020 mrt=420m
school=280m mall_count=9 school_quality=14.3
```

### FAISS index type
`IndexFlatIP` (exact inner product search after L2 normalisation = cosine similarity). Chosen over approximate indexes (IVF, HNSW) because exact search is reliable at this scale (260K vectors × 768 dims fits in ~750MB RAM).

### Metadata stored per vector

| Field | Source Column | Purpose |
|-------|--------------|---------|
| `address_key` | `address_key` | Traceability back to source row |
| `resale_price` | `resale_price` | Ground truth for evaluation |
| `transaction_year` | `transaction_year` | Temporal filtering |
| `town` | decoded `town_*` | Post-retrieval filtering |
| `flat_type` | decoded `flat_type_*` | Post-retrieval filtering |
| `flat_model` | decoded `flat_model_*` | Display |
| `floor_area_sqm` | `floor_area_sqm` | Comparable display |
| `level_mid` | `level_mid` | Comparable display |
| `lease_remaining_years` | `lease_remaining_years` | Comparable display |
| `room_count` | `room_count` | Post-retrieval filtering |
| `dist_to_nearest_school_m` | `dist_to_nearest_school_m` | Comparable display |
| `mall_count_3km` | `mall_count_3km` | Comparable display |
| `primary_school_quality_1km_weighted` | `primary_school_quality_1km_weighted` | Comparable display |

Metadata is stored alongside the index so post-retrieval filtering requires no second database round-trip.

---

## API Configuration

| Parameter | Value |
|-----------|-------|
| Model | `models/text-embedding-004` |
| Task type (document) | `RETRIEVAL_DOCUMENT` |
| Task type (query) | `RETRIEVAL_QUERY` |
| Batch size | 100 strings per call |
| Output dimensions | 768 |
| Rate limit buffer | 50ms sleep between batches |

---

## Cell-by-Cell Summary

| Cell | Section | Action |
|------|---------|--------|
| 2.1 | Install & imports | FAISS, Gemini, pandas, numpy |
| 2.2 | Load & inspect | Shape, year range, pre/post counts |
| 2.3 | Decode one-hot | town, flat_type, flat_model strings |
| 2.4 | Build embed text | Apply template to all 260,699 rows |
| 2.5 | Generate embeddings | Gemini API batch calls → `all_embeddings.npy` |
| 2.6 | Build FAISS indexes | Temporal split, L2 normalise, write `.faiss` + `.parquet` |
| 2.7 | Smoke test | Query `index_post2023` with sample text, inspect top-5 |

---

## Index Selection Logic at Query Time

```python
def is_recent_query(slots: dict) -> bool:
    year_min = slots.get("year_min")
    year_max = slots.get("year_max")
    if year_min and year_min >= 2023:
        return True
    if year_max and year_max >= 2023:
        return True
    return False   # default to pre-2023 for unspecified queries

index = index_post if is_recent_query(slots) else index_pre
```

---

## Dependencies

```
google-generativeai>=0.5
faiss-cpu>=1.7
pandas>=2.0
numpy>=1.24
tqdm>=4.0
```

---

## Known Limitations

- Embedding text includes `price={resale_price}` — this means the embedding space encodes price directly. Queries without a price anchor will retrieve by spatial/structural similarity alone, which is the intended behaviour.
- `primary_school_quality_1km_weighted` range is 11.9–24.1 (not 0–100 as the scale label implies) — included verbatim from source data. No normalisation applied at embedding stage.
- `dist_to_nearest_mall_m` has no documented mean/std in source README — embedded as-is.

---

## Next Step

→ Run `03_query_routing_gemini_flash.ipynb` to build the intent classifier and Cypher template library.
