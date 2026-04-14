# Notebook 04 — Context Assembly & Gemini 1.5 Pro Generation

**Layer:** Generation  
**Notebook:** `04_context_assembly_generation.ipynb`  
**Last Updated:** April 2026  
**Document Version:** 1.0  
**Owner:** PropertyLens AI Engineering Team  

---

## Purpose

This notebook implements the core generation layer. It runs the dual-path retrieval (Cypher graph query + FAISS vector search) in parallel, assembles the results into a structured 4-section context block, and passes it to Gemini 1.5 Pro for final answer generation. The system prompt strictly constrains the model to answer only from the provided context — preventing hallucination of POI names, school names, or price figures not present in the data.

---

## Inputs

| Input | Source | Description |
|-------|--------|-------------|
| User natural language query | Runtime | Free-text query |
| Intent + slots | Notebook 03 | Classified intent type and extracted slot values |
| Neo4j graph database | Notebook 01 | Cypher query execution |
| FAISS vector indexes | Notebook 02 | `index_pre2023.faiss` and `index_post2023.faiss` |
| `meta_pre2023.parquet` | Notebook 02 | Scalar metadata for pre-2023 vectors |
| `meta_post2023.parquet` | Notebook 02 | Scalar metadata for post-2023 vectors |
| `feature_metadata_20260403.json` | `02_feature_layer/training/outputs/` | Feature definitions for context injection |

---

## Outputs

Structured JSON answer with the following schema:

```json
{
  "estimate_sgd":           <integer or null>,
  "low_sgd":                <integer or null>,
  "high_sgd":               <integer or null>,
  "basis_count":            <integer>,
  "key_factors": [
    {
      "factor_name":  <string>,
      "value":        <string>,
      "impact":       <string>
    }
  ],
  "caveats":                [<string>],
  "comparable_years_range": "<year_min>-<year_max>",
  "narrative":              "<2–3 sentence plain English summary>"
}
```

`estimate_sgd`, `low_sgd`, `high_sgd` are `null` for non-price intent types (neighbourhood, school, investment, lease). `basis_count` reflects the number of transactions the Cypher aggregate was computed from.

---

## Dual-Path Retrieval Architecture

Both paths run for every query. Results are merged before context assembly.

```
User query
    │
    ├─── [Path A] Vector retrieval ────────────────────────────┐
    │    embed query → cosine search FAISS index (top-20)      │
    │    → return comparable flat records with metadata        │
    │                                                           ▼
    │                                               Context assembler
    │                                                           ▲
    └─── [Path B] Graph retrieval ────────────────────────────┘
         intent + slots → fill Cypher template → Neo4j
         → return aggregate JSON (median, avg, stDev, count)
```

### Path A — Vector retrieval

- Embeds user query text using `models/text-embedding-004` with `task_type=RETRIEVAL_QUERY`
- Searches the appropriate FAISS index slice (pre-2023 or post-2023)
- Returns top-20 comparable flats with scalar metadata fields
- Only top-5 comparables are included in the Gemini 1.5 Pro context (reduce token cost)

### Path B — Graph retrieval

- Receives intent type and validated `cypher_params` from Notebook 03
- Executes the appropriate Cypher template against Neo4j
- Returns aggregate result records (median, avg, stDev, count, etc.)
- Capped at top 10 rows in context for `INVESTMENT_TEMPORAL` queries

---

## Context Assembly — 4 Sections

The assembled context string passed to Gemini 1.5 Pro follows this fixed structure:

### Section 1 — Graph aggregates

```
=== GRAPH AGGREGATES (from Neo4j) ===
{cypher_result_json}
```

Contains the structured aggregate statistics from the Cypher query: `median_price`, `avg_price`, `std_price`, `tx_count`, relevant distance averages, or school quality scores depending on intent type.

### Section 2 — Comparable transactions

```
=== COMPARABLE TRANSACTIONS (top-5 from vector index) ===
address_key | town | flat_type | floor_area_sqm | level_mid | lease_remaining_years | resale_price | transaction_year
```

Top-5 rows from the vector retrieval. These are real transactions from the dataset, providing the model with concrete evidence for price reasoning. All 5 include `address_key` for traceability.

### Section 3 — Feature definitions

```
=== FEATURE DEFINITIONS (from feature_metadata_20260403.json) ===
{relevant factor definitions only}
```

Only the feature definitions relevant to the active intent type are injected. For example, a `SCHOOL_CATCHMENT` query injects only factors 10–11 definitions. This reduces token usage and focuses the model's reasoning.

**Factor-to-intent mapping:**

| Intent | Factors injected |
|--------|-----------------|
| `PRICE_ESTIMATION` | level_mid, lease_remaining_years, floor_area_sqm, room_count, dist_to_mrt_m, orientation_score |
| `NEIGHBOURHOOD` | dist_to_mrt_m, dist_to_highway_m, dist_to_foodcourt_m, mall_count_3km, mall_weighted_access_3km |
| `SCHOOL_CATCHMENT` | dist_to_nearest_school_m, school_count_1km, primary_school_quality_1km_weighted, primary_school_top_quality_1km, primary_school_count_1km |
| `INVESTMENT_TEMPORAL` | transaction_year, resale_price |
| `LEASE_ADVISORY` | lease_remaining_years, resale_price |

### Section 4 — Temporal context (conditional)

Injected only when `is_recent_query()` returns `True` (query uses post-2023 index):

```
=== TEMPORAL CONTEXT ===
Query uses post-2023 transactions.
Mean price post-2023: $614,711 vs pre-2023: $468,788
(31% higher — Singapore property appreciation 2023–2026).
Reflect this in any price estimate caveats.
```

---

## Gemini 1.5 Pro System Prompt — Key Constraints

1. Answer **only** using data in `GRAPH AGGREGATES` and `COMPARABLE TRANSACTIONS` sections
2. Do **not** introduce price figures, school names, MRT station names, or locations not present in the provided context
3. Cite the `transaction_year` range of the comparables used
4. Include the price drift caveat if post-2023 data is used
5. Output **only** valid JSON matching the output schema — no markdown, no explanation

---

## Index Selection Logic

```python
def is_recent_query(slots: dict) -> bool:
    year_min = slots.get("year_min")
    year_max = slots.get("year_max")
    if year_min and year_min >= 2023:
        return True
    if year_max and year_max >= 2023:
        return True
    return False   # default to pre-2023 for unspecified queries
```

Queries without explicit year constraints default to the pre-2023 index (training slice). This is conservative — if recency is uncertain, historical comparables are used and the model is not exposed to the 31% price-inflated post-2023 slice.

---

## Price Drift Constants

These constants from the source README are embedded directly in the context assembly code and in the conditional temporal context section:

| Constant | Value | Source |
|----------|-------|--------|
| `TRAIN_MEAN_PRICE` | $468,788 | README section 3 — training set mean |
| `TEST_MEAN_PRICE` | $614,711 | README section 3 — test set mean |
| `TRAIN_MEDIAN_PRICE` | $435,000 | README section 2B |
| `TEST_MEDIAN_PRICE` | $590,000 | README section 2C |
| `TEMPORAL_SPLIT` | 2023 | README section 5 |

---

## Cell-by-Cell Summary

| Cell | Section | Action |
|------|---------|--------|
| 4.1 | Install & imports | Gemini, FAISS, Neo4j, asyncio, constants |
| 4.2 | Load indexes | Read `.faiss` and `.parquet` files from NB02 |
| 4.3 | Import routing helpers | Re-declare routing functions from NB03 |
| 4.4 | Vector retrieval | `vector_retrieve()` — embed + FAISS search |
| 4.5 | Context assembly | `assemble_context()` — 4-section builder |
| 4.6 | Generation call | `generate_answer()` — Gemini 1.5 Pro with strict system prompt |
| 4.7 | Full pipeline | `run_pipeline()` — orchestrates all steps end-to-end |
| 4.8 | Batch test | All 5 intent types exercised |

---

## Dependencies

```
google-generativeai>=0.5
faiss-cpu>=1.7
neo4j>=5.0
pandas>=2.0
numpy>=1.24
```

---

## Traceability Requirements

Every price figure in the final response must be traceable to one of:
- A specific Cypher aggregate value (median, avg, percentile)
- A specific comparable transaction `address_key`

The `address_key` values of top-5 comparables are included in the response. In production, these should be stored with each query log for audit purposes.

---

## Known Limitations

- This notebook re-declares routing helpers from Notebook 03. In production, refactor shared logic into `hdb_router.py` and import from there.
- Gemini 1.5 Pro occasionally wraps JSON output in markdown code fences — `generate_answer()` strips these with a regex before parsing.
- No named MRT station or school node exists in the graph (Notebook 01 limitation). The system prompt must explicitly state this to prevent the model from inventing station names when describing NEAR_MRT relationship data.
- Concurrent async retrieval (asyncio) is defined in the notebook but may require event loop configuration in Jupyter — use `nest_asyncio` if running in standard Jupyter environments.

---

## Next Step

→ Run `05_validation_test_set.ipynb` to evaluate the full pipeline against `hdb_feature_test_20260403.csv`.
