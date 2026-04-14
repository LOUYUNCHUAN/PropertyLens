# Notebook 01 — Neo4j Knowledge Graph: Data Ingestion

**Layer:** Foundation — Knowledge Graph  
**Notebook:** `01_neo4j_ingestion.ipynb`  
**Last Updated:** April 2026  
**Document Version:** 1.0  
**Owner:** PropertyLens AI Engineering Team  

---

## Purpose

This notebook ingests the HDB feature engineering outputs into a Neo4j graph database, creating the knowledge graph that powers structured multi-hop queries in the RAG pipeline. It transforms the flat CSV rows into a connected graph of nodes and relationships, enabling Cypher queries that vector similarity alone cannot answer (e.g. "flats in Bishan within 500m of MRT, school quality > 80, under $700K").

---

## Inputs

| File | Location | Size | Description |
|------|----------|------|-------------|
| `hdb_feature_table_20260403.csv` | `02_feature_layer/training/outputs/` | 132 MB | Full deduplicated dataset — 260,699 rows × 73 cols |
| `feature_metadata_20260403.json` | `02_feature_layer/training/outputs/` | — | Feature schema and factor definitions |

> **Scope boundary:** No external data sources are used. All node properties and relationship values are derived strictly from the 22 core feature columns documented in `feature_metadata_20260403.json`.

---

## Outputs

| Output | Count | Description |
|--------|-------|-------------|
| `:Flat` nodes | 260,699 | One node per deduplicated HDB transaction |
| `:Block` nodes | 9,710 | One node per unique `address_key` block prefix |
| `:Town` nodes | 26 | One node per Singapore HDB town |
| `IN_BLOCK` relationships | 260,699 | `:Flat → :Block` |
| `IN_TOWN` relationships | 9,710 | `:Block → :Town` |
| `NEAR_MRT` relationships | 260,699 | `:Flat` self-ref with `distance_m` property |
| `NEAR_MALL` relationships | 260,699 | `:Flat` self-ref with `distance_m`, `count_3km`, `weighted_access` |
| `NEAR_SCHOOL` relationships | 260,699 | `:Flat` self-ref with `distance_m`, `quality_weighted`, `count_1km` |
| `NEAR_HAWKER` relationships | 260,699 | `:Flat` self-ref with `distance_m` |

---

## Node Schema

### `:Flat` — properties

All properties are sourced directly from the 22 core engineered features. One-hot encoded columns (`town_*`, `flat_type_*`, `flat_model_*`) are decoded back to string values before storage.

| Property | Source Column | Type | Notes |
|----------|--------------|------|-------|
| `address_key` | `address_key` | string | Unique node identifier |
| `resale_price` | `resale_price` | float | SGD — range $140K–$1.7M |
| `transaction_year` | `transaction_year` | int | 2015–2026 |
| `level_mid` | `level_mid` | float | Storey midpoint, range 2.0–50.0 |
| `lease_remaining_years` | `lease_remaining_years` | float | Range 39–98 years |
| `floor_area_sqm` | `floor_area_sqm` | float | Range 31–366.7 sqm |
| `room_count` | `room_count` | float | Range 1–6 |
| `dist_to_mrt_m` | `dist_to_mrt_m` | float | Metres — range 23–8,275 |
| `orientation_score` | `orientation_score` | float | Range −1.0 to +1.0 |
| `dist_to_highway_m` | `dist_to_highway_m` | float | Metres — range 47–10,656 |
| `dist_to_foodcourt_m` | `dist_to_foodcourt_m` | float | Metres — range 35–2,919 |
| `dist_to_nearest_mall_m` | `dist_to_nearest_mall_m` | float | Metres |
| `mall_count_3km` | `mall_count_3km` | float | Count — range 0–60 |
| `mall_weighted_access_3km` | `mall_weighted_access_3km` | float | Score — range 0–54.4 |
| `dist_to_nearest_school_m` | `dist_to_nearest_school_m` | float | Metres — range 38–3,297 |
| `school_count_1km` | `school_count_1km` | float | Count — range 0–14 |
| `primary_school_quality_1km_weighted` | `primary_school_quality_1km_weighted` | float | Score 0–100 |
| `primary_school_top_quality_1km` | `primary_school_top_quality_1km` | float | Score 0–100 |
| `primary_school_count_1km` | `primary_school_count_1km` | float | Count |
| `flat_type` | decoded from `flat_type_*` | string | 7 values (see below) |
| `flat_model` | decoded from `flat_model_*` | string | 21 values |
| `town` | decoded from `town_*` | string | 26 valid towns |

### `:Block` — properties

| Property | Type | Notes |
|----------|------|-------|
| `block_id` | string | Prefix of `address_key` |
| `address_key` | string | Representative address |
| `town` | string | Decoded town name |

### `:Town` — properties

| Property | Type | Notes |
|----------|------|-------|
| `name` | string | One of 26 valid HDB towns (uppercase) |

---

## Relationship Schema

### `NEAR_*` relationship design

> **Important:** No named POI nodes (`:MRTStation`, `:Mall`, `:School`, `:HawkerCentre`) are created. The source CSV contains distance values only — not POI names or coordinates. `NEAR_*` relationships are self-referential on `:Flat` nodes, carrying distance as a relationship property.

| Relationship | Properties | Source Columns |
|-------------|-----------|----------------|
| `IN_BLOCK` | — | `address_key` |
| `IN_TOWN` | — | decoded `town_*` |
| `NEAR_MRT` | `distance_m` | `dist_to_mrt_m` |
| `NEAR_HAWKER` | `distance_m` | `dist_to_foodcourt_m` |
| `NEAR_MALL` | `distance_m`, `count_3km`, `weighted_access` | `dist_to_nearest_mall_m`, `mall_count_3km`, `mall_weighted_access_3km` |
| `NEAR_SCHOOL` | `distance_m`, `count_1km`, `quality_weighted`, `top_quality`, `count_primary_1km` | all school distance/quality columns |

---

## Reference Cypher Queries

```cypher
-- Count all nodes
MATCH (f:Flat)  RETURN count(f) AS flat_count;
MATCH (b:Block) RETURN count(b) AS block_count;
MATCH (t:Town)  RETURN count(t) AS town_count;

-- Validate relationship coverage
MATCH ()-[:NEAR_MRT]->() RETURN count(*) AS near_mrt_count;

-- Sample price query by town and flat type
MATCH (f:Flat)-[:IN_TOWN]->(t:Town {name: 'BISHAN'})
WHERE f.flat_type = '4 ROOM'
RETURN avg(f.resale_price) AS avg_price,
       percentileCont(f.resale_price, 0.5) AS median_price,
       count(f) AS tx_count;

-- Lease band analysis
MATCH (f:Flat)
RETURN
  CASE
    WHEN f.lease_remaining_years < 50 THEN '<50 years'
    WHEN f.lease_remaining_years < 70 THEN '50–69 years'
    ELSE '70+ years'
  END AS lease_band,
  avg(f.resale_price) AS avg_price,
  count(f) AS count
ORDER BY lease_band;
```

---

## Valid Categorical Values

### Flat types (7)
`1 ROOM` · `2 ROOM` · `3 ROOM` · `4 ROOM` · `5 ROOM` · `EXECUTIVE` · `MULTI-GENERATION`

### Towns (26)
`ANG MO KIO` · `BEDOK` · `BISHAN` · `BUKIT BATOK` · `BUKIT MERAH` · `BUKIT PANJANG` · `BUKIT TIMAH` · `CENTRAL AREA` · `CHOA CHU KANG` · `CLEMENTI` · `GEYLANG` · `HOUGANG` · `JURONG EAST` · `JURONG WEST` · `KALLANG/WHAMPOA` · `MARINE PARADE` · `PASIR RIS` · `PUNGGOL` · `QUEENSTOWN` · `SEMBAWANG` · `SENGKANG` · `SERANGOON` · `TAMPINES` · `TOA PAYOH` · `WOODLANDS` · `YISHUN`

---

## Dependencies

```
neo4j>=5.0
pandas>=2.0
tqdm>=4.0
```

Neo4j version: 5.x+. Bolt connection on `localhost:7687`.

---

## Cell-by-Cell Summary

| Cell | Section | Action |
|------|---------|--------|
| 1.1 | Install & imports | Dependencies, path constants, driver init |
| 1.2 | Load & preview | Read 5-row sample, inspect columns |
| 1.3 | Decoder helpers | `decode_onehot()` for town/flat_type/flat_model |
| 1.4 | Neo4j constraints | Uniqueness on `address_key`, `block_id`, `name` |
| 1.5 | Batch ingest | Chunked CSV read (5,000 rows), MERGE nodes |
| 1.6 | Relationships | `NEAR_*` rels from distance columns |
| 1.7 | Validation | Count queries against expected values |

---

## Known Limitations

- `NEAR_*` relationships do not have named POI destination nodes — source data provides distances only, not station/mall/school names
- `dist_to_nearest_mall_m` has no mean/std in source README (listed as N/A) — treat as present but unvalidated
- OneMap geocoding accuracy is ±10–50m per README section 6 caveats
- POI data (malls, food courts) reflects March 2026 state; older transactions assume static POI

---

## Next Step

→ Run `02_vector_index_embeddings.ipynb` to generate Gemini text-embedding-004 vectors for all 260,699 flats.
