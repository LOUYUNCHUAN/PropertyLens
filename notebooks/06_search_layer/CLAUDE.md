# Layer 06 — Property Knowledge Base & Weighted Search

## Purpose

Converts the Layer 02 feature table into a **normalized property knowledge base** and provides a **weighted multi-criteria search** interface. Buyers assign 0–10 weights to lifestyle dimensions (education, transit, size, value, etc.) and receive ranked property recommendations.

---

## Run Order

```
01_build_knowledge_base.ipynb   ← builds KB, pushes to Neo4j
02_property_search_demo.ipynb   ← demo of weighted search via Neo4j Cypher
```

```python
from yc_property_search import PropertyKnowledgeBase, Neo4jPropertySearch

# 1. Build KB and push to Neo4j (run once)
kb = PropertyKnowledgeBase.build()
kb.push_to_neo4j()                     # reads credentials from .env

# 2. Query via Neo4j (primary interface)
with Neo4jPropertySearch() as neo4j:
    results = neo4j.search(
        weights={"score_famous_school": 10, "score_mrt": 7},
        filters={"flat_type": "4 ROOM"},
        top_k=10,
    )

# 3. Local parquet search (no Neo4j required)
kb = PropertyKnowledgeBase()
results = kb.search(weights={"score_famous_school": 10}, top_k=10)
```

## Neo4j Graph Model

```
(:Property)  ─[:LOCATED_IN]───────────────────►  (:Town)
(:Property)  ─[:NEAREST_FAMOUS_SCHOOL {dist}]──►  (:FamousSchool)
(:Property)  ─[:NEAR_FAMOUS_SCHOOL {dist}]─────►  (:FamousSchool)  ← within 2 km
```

**Credentials** — stored in `.env` at repo root:
```
NEO4J_URI=neo4j+s://975e5751.databases.neo4j.io
NEO4J_USERNAME=975e5751
NEO4J_PASSWORD=...
NEO4J_DATABASE=975e5751
```

---

## Artefacts

| File | Description |
|------|-------------|
| `artifacts/property_knowledge_base_YYYYMMDD.parquet` | Unique-property KB with all scores (9,710 rows) |
| `artifacts/search_norm_params_YYYYMMDD.json` | p5/p95 normalization bounds per score dimension |

---

## Score Dimensions (12 total)

| Score | Direction | Source Feature | Interpretation |
|-------|-----------|---------------|----------------|
| `score_mrt` | inverse | `dist_to_mrt_m` | Closer MRT = higher |
| `score_food` | inverse | `dist_to_foodcourt_m` | Closer hawker = higher |
| `score_shopping` | inverse | `dist_to_nearest_mall_m` | Closer mall = higher |
| `score_school_proximity` | inverse | `dist_to_nearest_school_m` | Closer school = higher |
| `score_school_quality` | direct | `primary_school_quality_1km_weighted` | Better schools = higher |
| `score_famous_school` | inverse | `dist_to_nearest_famous_school_km` *(new)* | Closer famous school = higher |
| `score_size` | direct | `floor_area_sqm` | Larger = higher |
| `score_floor` | direct | `level_mid` | Higher floor = higher |
| `score_lease` | direct | `lease_remaining_years` | More lease = higher |
| `score_quietness` | direct | `dist_to_highway_m` | Farther from highway = higher |
| `score_value` | inverse | `resale_price` | Lower price = higher |
| `score_orientation` | direct | `orientation_score` | Better facing = higher |

**Famous primary schools** are identified from MOE data using:
`mainlevel_code == PRIMARY` AND (`autonomous_ind == Yes` OR `gifted_ind == Yes` OR `sap_ind == Yes`)

As of 2026-04-12: 17 schools including ACS Primary, Nanyang Primary, Raffles Girls', Tao Nan, Henry Park, etc.

---

## Data Inputs

| Source | File | Used For |
|--------|------|---------|
| Layer 02 | `hf_data/02_feature_layer/training/outputs/hdb_feature_table_*.csv` | All features |
| Layer 01 | `01_data_layer/raw/schools/moe_general_information_of_schools_*.csv` | School flags |
| Layer 01 | `01_data_layer/raw/google_geo/moe_school_geocode_*.csv` | School lat/lon |
| Layer 01 | `01_data_layer/raw/google_geo/hdb_geo_accessibility_noise_features_*.csv` | Property lat/lon |

---

## Key Implementation Notes

- **Deduplication**: 263k transactions → 9,710 unique properties (latest transaction per `address_key`)
- **Normalization**: p5–p95 percentile clipping → `[0, 10]` scale; avoids outlier dominance
- **Geocode join**: `address_key` matches `requested_address` after stripping `, Singapore` (100% match rate)
- **Haversine computation**: Vectorised (N×M matrix for all property × famous-school pairs)
- **Fallback**: Properties with no geocode match (none expected) get Singapore centroid coordinates

---

## `yc_property_search.py` API

```python
PropertyKnowledgeBase(kb_path=None, norm_params_path=None)
    .build(feature_csv, school_info_csv, school_geocode_csv, hdb_geocode_csv, output_dir)
    .search(weights, filters, top_k)   → pd.DataFrame
    .describe_scores()                 → dict
    .score_summary()                   → pd.DataFrame
    .famous_schools_list()             → pd.Series
```

**Supported filters in `.search()`:**

| Filter key | Effect |
|-----------|--------|
| `flat_type` | Exact match (e.g. `"4 ROOM"`) |
| `town` | Exact match (e.g. `"BISHAN"`) |
| `flat_model` | Exact match |
| `min_floor_area` | `floor_area_sqm >= value` |
| `max_resale_price` | `resale_price <= value` |
| `min_lease_years` | `lease_remaining_years >= value` |
| `max_dist_mrt_m` | `dist_to_mrt_m <= value` |
| `require_famous_school` | `famous_school_count_1km > 0` |
