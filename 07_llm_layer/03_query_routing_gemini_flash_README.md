# Notebook 03 — Query Routing: Gemini Flash Classifier & Cypher Generator

**Layer:** Retrieval Routing  
**Notebook:** `03_query_routing_gemini_flash.ipynb`  
**Last Updated:** April 2026  
**Document Version:** 1.0  
**Owner:** PropertyLens AI Engineering Team  

---

## Purpose

This notebook implements the query routing layer — the fast, cheap stage that runs before any expensive retrieval or generation. Given a natural language user query, Gemini Flash classifies intent into one of 5 types, extracts structured slots (town, flat type, budget, year range), and fills those slots into a pre-built Cypher template. The template is then executed against the Neo4j graph from Notebook 01.

Gemini Flash is used here intentionally — not Gemini 1.5 Pro. Classification and slot extraction are structured, deterministic tasks that do not require long-context reasoning. Using Flash reduces per-query cost and latency on the routing path.

---

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| User natural language query | Runtime | Free-text query from end user |
| Neo4j graph database | Notebook 01 | `:Flat`, `:Block`, `:Town` nodes + `NEAR_*` rels |

---

## Outputs

| Output | Type | Description |
|--------|------|-------------|
| `intent_type` | string | One of 5 defined intent types |
| `slots` | JSON dict | Extracted parameter values (town, flat_type, budget, etc.) |
| `cypher_params` | dict | Validated, type-safe parameters for Neo4j |
| `cypher_result` | list[dict] | Query result records from Neo4j |

---

## Intent Type Taxonomy

Intent types are derived exclusively from the 11-factor feature set. No intent type exists outside these 5.

| Intent Type | Description | Feature Factors Used |
|-------------|-------------|---------------------|
| `PRICE_ESTIMATION` | User wants a price estimate or valuation | Factors 1–11 (all core features) |
| `NEIGHBOURHOOD` | User wants nearby amenity information | Factors 5 (MRT), 6 (orientation), 7 (highway), 8 (food court), 9 (mall) |
| `SCHOOL_CATCHMENT` | User wants school proximity or quality | Factors 10 (school proximity), 11 (school quality) |
| `INVESTMENT_TEMPORAL` | User wants historical price trends | `transaction_year`, `resale_price`, `town` |
| `LEASE_ADVISORY` | User wants guidance on remaining lease | Factor 2 (lease remaining) |

---

## Slot Schema

Slots are extracted by the Gemini Flash classifier. Only values that exist as columns or categories in the dataset are accepted. Invalid values are silently rejected (set to `null`) by `slots_to_params()`.

| Slot | Valid Values | Source |
|------|-------------|--------|
| `town` | 26 uppercase town names | decoded `town_*` columns |
| `flat_type` | 7 flat type strings | decoded `flat_type_*` columns |
| `room_count` | integer 1–6 | `room_count` column |
| `budget_sgd_min` | integer | `resale_price` range $140K–$1.7M |
| `budget_sgd_max` | integer | `resale_price` range $140K–$1.7M |
| `year_min` | integer 2015–2026 | `transaction_year` range |
| `year_max` | integer 2015–2026 | `transaction_year` range |
| `lease_years_max` | integer | `lease_remaining_years` range 39–98 |

---

## Cypher Template Library

One parameterised Cypher template per intent type. Gemini Flash fills slot values into the template — it does not write free-form Cypher. All property names in the templates are verified against `feature_metadata_20260403.json`.

### `PRICE_ESTIMATION`

```cypher
MATCH (f:Flat)-[:IN_TOWN]->(t:Town)
WHERE ($town IS NULL OR t.name = $town)
  AND ($flat_type IS NULL OR f.flat_type = $flat_type)
  AND ($room_count IS NULL OR f.room_count = $room_count)
  AND ($budget_sgd_min IS NULL OR f.resale_price >= $budget_sgd_min)
  AND ($budget_sgd_max IS NULL OR f.resale_price <= $budget_sgd_max)
RETURN
  percentileCont(f.resale_price, 0.5)  AS median_price,
  avg(f.resale_price)                  AS avg_price,
  stDev(f.resale_price)                AS std_price,
  min(f.resale_price)                  AS min_price,
  max(f.resale_price)                  AS max_price,
  count(f)                             AS tx_count,
  avg(f.lease_remaining_years)         AS avg_lease,
  avg(f.floor_area_sqm)               AS avg_area,
  min(f.transaction_year)              AS year_min,
  max(f.transaction_year)              AS year_max
```

### `NEIGHBOURHOOD`

```cypher
MATCH (f:Flat)-[:IN_TOWN]->(t:Town)
WHERE ($town IS NULL OR t.name = $town)
RETURN
  t.name                              AS town,
  avg(f.dist_to_mrt_m)               AS avg_mrt_dist_m,
  avg(f.dist_to_foodcourt_m)         AS avg_foodcourt_dist_m,
  avg(f.dist_to_nearest_mall_m)      AS avg_mall_dist_m,
  avg(f.mall_count_3km)              AS avg_mall_count_3km,
  avg(f.mall_weighted_access_3km)    AS avg_mall_access_score,
  avg(f.dist_to_highway_m)           AS avg_highway_dist_m,
  count(f)                           AS flat_count
```

### `SCHOOL_CATCHMENT`

```cypher
MATCH (f:Flat)-[:IN_TOWN]->(t:Town)
WHERE ($town IS NULL OR t.name = $town)
  AND ($budget_sgd_max IS NULL OR f.resale_price <= $budget_sgd_max)
  AND ($flat_type IS NULL OR f.flat_type = $flat_type)
RETURN
  t.name                                          AS town,
  avg(f.primary_school_quality_1km_weighted)     AS avg_school_quality,
  avg(f.primary_school_top_quality_1km)          AS avg_top_school_quality,
  avg(f.school_count_1km)                        AS avg_schools_in_1km,
  avg(f.dist_to_nearest_school_m)                AS avg_school_dist_m,
  avg(f.resale_price)                            AS avg_price,
  count(f)                                       AS flat_count
ORDER BY avg_school_quality DESC
```

### `INVESTMENT_TEMPORAL`

```cypher
MATCH (f:Flat)-[:IN_TOWN]->(t:Town)
WHERE ($town IS NULL OR t.name = $town)
  AND ($year_min IS NULL OR f.transaction_year >= $year_min)
  AND ($year_max IS NULL OR f.transaction_year <= $year_max)
RETURN
  t.name                               AS town,
  f.transaction_year                   AS year,
  avg(f.resale_price)                  AS avg_price,
  percentileCont(f.resale_price, 0.5) AS median_price,
  count(f)                             AS tx_count
ORDER BY t.name, f.transaction_year
```

### `LEASE_ADVISORY`

```cypher
MATCH (f:Flat)-[:IN_TOWN]->(t:Town)
WHERE ($town IS NULL OR t.name = $town)
  AND ($lease_years_max IS NULL OR f.lease_remaining_years <= $lease_years_max)
RETURN
  CASE
    WHEN f.lease_remaining_years < 50 THEN '<50 years'
    WHEN f.lease_remaining_years < 70 THEN '50–69 years'
    ELSE '70+ years'
  END                                   AS lease_band,
  avg(f.resale_price)                  AS avg_price,
  percentileCont(f.resale_price, 0.5) AS median_price,
  count(f)                             AS tx_count
ORDER BY lease_band
```

---

## Classifier System Prompt Design

The Gemini Flash system prompt enforces:
1. Output is **JSON only** — no explanation, no markdown fences
2. `town` must be one of the 26 valid HDB town names (uppercase)
3. `flat_type` must be one of the 7 valid flat type values
4. Unrecognised or ambiguous slots are returned as `null`
5. Exactly one `intent` per response — no multi-label classification

---

## Slot Validation — `slots_to_params()`

Before executing any Cypher template, slot values pass through `slots_to_params()`, which:
- Uppercases and validates `town` against the 26-town allowlist
- Uppercases and validates `flat_type` against the 7-type allowlist
- Passes numeric slots through without range-clamping (Neo4j WHERE clauses handle bounds naturally)
- Returns `None` for any slot that fails validation — `None` slots are treated as "no filter" in parameterised Cypher (`$param IS NULL OR ...`)

---

## Cell-by-Cell Summary

| Cell | Section | Action |
|------|---------|--------|
| 3.1 | Install & imports | Gemini, Neo4j driver, JSON, regex |
| 3.2 | Intent type definitions | 5 types mapped to feature factors |
| 3.3 | Flash classifier prompt | System prompt + `classify_query()` function |
| 3.4 | Cypher template library | 5 templates, all property names validated |
| 3.5 | Slot mapper | `slots_to_params()` with allowlist validation |
| 3.6 | End-to-end routing test | All 5 intent types tested against live Neo4j |

---

## Valid Categorical Values

### Towns (26)
`ANG MO KIO` · `BEDOK` · `BISHAN` · `BUKIT BATOK` · `BUKIT MERAH` · `BUKIT PANJANG` · `BUKIT TIMAH` · `CENTRAL AREA` · `CHOA CHU KANG` · `CLEMENTI` · `GEYLANG` · `HOUGANG` · `JURONG EAST` · `JURONG WEST` · `KALLANG/WHAMPOA` · `MARINE PARADE` · `PASIR RIS` · `PUNGGOL` · `QUEENSTOWN` · `SEMBAWANG` · `SENGKANG` · `SERANGOON` · `TAMPINES` · `TOA PAYOH` · `WOODLANDS` · `YISHUN`

### Flat types (7)
`1 ROOM` · `2 ROOM` · `3 ROOM` · `4 ROOM` · `5 ROOM` · `EXECUTIVE` · `MULTI-GENERATION`

---

## Dependencies

```
google-generativeai>=0.5
neo4j>=5.0
```

---

## Known Limitations

- Gemini Flash may occasionally wrap JSON in markdown fences (` ```json `) — `classify_query()` strips these with a regex before parsing
- Multi-intent queries (e.g. "schools AND price under $700K") are classified as a single intent; the lower-priority intent's slots are still extracted and passed as filter parameters
- `INVESTMENT_TEMPORAL` template returns one row per (town, year) pair — result sets can be large for broad queries; Notebook 04 context assembly truncates to top 10 rows

---

## Next Step

→ Run `04_context_assembly_generation.ipynb` to merge Cypher results with vector retrieval and call Gemini 1.5 Pro for final answer generation.
