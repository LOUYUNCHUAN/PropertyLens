# Layer 06 — Property search layer (knowledge base + RAG)

This folder is a **research / notebook prototype** for **natural-language HDB property search**. Your classmate built it as a small **RAG-style** pipeline on top of a **weighted multi-criteria search** over a property knowledge base (KB), with optional storage in **Neo4j**.

It is **not** the same subsystem as the production app’s document RAG (`backend/rag_v51/`, Pinecone chunks). Think of Layer 06 as **“structured retrieval”** (scores + graph) plus **LLM glue** (turn a question into search params, then summarise rows). The main chatbot in the repo still uses `rag_v51` for policy/document Q&A; this layer is the place to experiment with **ranking flats** from free text.

---

## What it does (one paragraph)

1. **Build a KB** from the Layer 02 feature table: one row per unique HDB address, **12 interpretable scores** (0–10) for things like MRT distance, value, famous-school proximity, etc., plus filters like town and flat type.
2. **Optionally load that KB into Neo4j** as `Property` / `Town` / `FamousSchool` nodes and relationships (for fast graph queries and “near this school” paths).
3. **RAG notebooks** run a 3-stage loop: **natural language → JSON search params → Neo4j (or parquet) search → natural language answer** using either **TinyLlama** (Hugging Face) or **Gemma via Ollama**.

---

## How it fits the “RAG” name

| Stage | Role |
|--------|------|
| **1. NL → params** | LLM outputs `{ weights, filters, special_query_type }` (structured JSON). |
| **2. Retrieve** | **Not** vector search over chunks — it runs **`Neo4jPropertySearch.search()`** (or local parquet `PropertyKnowledgeBase.search()`) using those weights/filters. |
| **3. Generate** | LLM reads the top-k result rows and writes a short grounded answer. |

So “RAG” here means **retrieve structured rows, then generate text**, not Pinecone embedding retrieval.

---

## Notebook and script map

| Order | File | Purpose |
|------|------|--------|
| 1 | `01_build_knowledge_base.ipynb` | Build parquet KB + norm params + school-distance file; **push graph to Neo4j**. |
| 2 | `02_property_search_demo.ipynb` | Demo **weighted search** only (Neo4j), no LLM. |
| 3 | `03_rag_search.ipynb` | End-to-end RAG with **TinyLlama** (GPU/transformers stack). |
| 3b | `03_rag_search_gemma.ipynb` | Same idea with **Ollama + Gemma**. |
| 4 | `04_rag_search_gemma_verification.ipynb` | Regression-style checks against a **golden JSON** (Neo4j retrieval; optional LLM groundedness if Ollama is up). |

**Python modules** (imported from the same directory after `sys.path` setup):

| Module | Responsibility |
|--------|------------------|
| `yc_property_search.py` | `PropertyKnowledgeBase` (build/load parquet, local search), `Neo4jPropertySearch` (Cypher), `push_to_neo4j`. |
| `yc_rag_search.py` | `PropertyRAGSearch` — TinyLlama stages 1 & 3. |
| `yc_rag_search_gemma.py` | `PropertyRAGSearchGemma` — Ollama Gemma stages 1 & 3. |
| `build_rag_eval_assets.py` | Builds golden-set JSON under `artifacts/` for notebook 04. |

`CLAUDE.md` in this folder is a concise duplicate of norms, scores, and API notes — useful as a **cheat sheet**.

---

## Artifacts you need

Paths are under **`notebooks/06_search_layer/artifacts/`** in this repo.

| Artifact | Produced by | Needed for |
|----------|----------------|------------|
| `property_knowledge_base_YYYYMMDD.parquet` | `01` … `PropertyKnowledgeBase.build()` | Local search without Neo4j; debugging. **If missing**, run `01` or obtain from your teammate. |
| `search_norm_params_YYYYMMDD.json` | `01` | Normalisation bounds (p5/p95) per score dimension. |
| `famous_school_distances_YYYYMMDD.parquet` | `01` | Pairwise property–school distances (for Neo4j relationships). |
| `rag_search_gemma_golden_set_YYYYMMDD.json` | `build_rag_eval_assets.py` | Notebook `04` verification baseline. |

The repo may only ship **some** of these (for example norm params + golden set). A **full Neo4j** setup is separate: you need a database that was loaded with **`kb.push_to_neo4j()`** from `01` (or equivalent). Empty or stale Neo4j → RAG notebooks return no rows.

---

## Data and environment prerequisites

### 1. Layer 02 feature table (to rebuild from scratch)

`01` expects CSVs such as:

- `hf_data/02_feature_layer/training/outputs/hdb_feature_table_*.csv`  
  (notebook also tries `02_feature_layer/...` relative to the resolved “repo root”.)

Plus Layer 01 raw files for schools and geocodes (see `CLAUDE.md`). **Large CSVs are often gitignored** — if you see `IndexError` on `feature_csvs[-1]`, you do not have the feature export in the expected path yet.

### 2. Neo4j (for graph-backed search and RAG notebooks)

Set in **project root** `.env` (same variables the notebooks load via `python-dotenv` when `REPO_ROOT` points at the repo root):

- `NEO4J_URI`
- `NEO4J_USERNAME`
- `NEO4J_PASSWORD`
- `NEO4J_DATABASE`

### 3. LLMs

- **TinyLlama path** (`03_rag_search.ipynb`, `yc_rag_search.py`): PyTorch + `transformers` + `langchain-huggingface` (see notebook header for versions).
- **Gemma path** (`03_rag_search_gemma.ipynb`, `yc_rag_search_gemma.py`): **[Ollama](https://ollama.com/)** running locally, model pulled (e.g. `ollama pull gemma3`), default base URL `http://localhost:11434`.

---

## How to run it (recommended order)

1. **Use a virtualenv** that has `pandas`, `numpy`, `neo4j`, `python-dotenv`, and either the HF stack or Ollama client stack as needed.
2. **Working directory / imports**  
   Notebooks prepend `LAYER_DIR` to `sys.path` so `import yc_property_search` works. They resolve `REPO_ROOT` with:

   `REPO_ROOT = cwd if (cwd / "hf_data").exists() else cwd.parent`  
   `LAYER_DIR = REPO_ROOT / "06_search_layer"`

   In this repository the layer lives at **`notebooks/06_search_layer`**, not `06_search_layer` at the repo root. **Practical approach:** open Jupyter with **current directory = `notebooks/06_search_layer`**, so `REPO_ROOT` becomes `notebooks/` and `LAYER_DIR` becomes `notebooks/06_search_layer`.  
   If you launch from the **repo root** instead, `LAYER_DIR` would wrongly resolve to `<repo>/06_search_layer` — fix the notebook’s first path cell to set `LAYER_DIR` to `Path("notebooks/06_search_layer").resolve()` or similar.

3. **`.env` location**  
   `load_dotenv(REPO_ROOT / ".env")` only finds `.env` at the resolved `REPO_ROOT`. If `REPO_ROOT` is `notebooks/`, it will **not** see `<repo>/.env`. Either start Jupyter from the **repository root** (so `hf_data` exists and `REPO_ROOT` is the real project root) or load dotenv from an absolute path to the root `.env`.

4. Run **`01_build_knowledge_base.ipynb`** end-to-end if you have the CSVs (creates artifacts and loads Neo4j).

5. Run **`02_property_search_demo.ipynb`** to validate Neo4j counts and weighted search.

6. Run **`03_rag_search.ipynb`** or **`03_rag_search_gemma.ipynb`** for the full NL pipeline.

7. Optionally run **`04_rag_search_gemma_verification.ipynb`** after generating a fresh golden set.

---

## Minimal Python usage (after artifacts + path setup)

**Parquet-only (no Neo4j):**

```python
from pathlib import Path
import sys
sys.path.insert(0, "notebooks/06_search_layer")  # adjust if needed

from yc_property_search import PropertyKnowledgeBase

kb = PropertyKnowledgeBase(
    kb_path=Path("notebooks/06_search_layer/artifacts/property_knowledge_base_YYYYMMDD.parquet"),
    norm_params_path=Path("notebooks/06_search_layer/artifacts/search_norm_params_YYYYMMDD.json"),
)
df = kb.search(
    weights={"score_mrt": 8, "score_value": 7},
    filters={"flat_type": "4 ROOM", "town": "BISHAN"},
    top_k=10,
)
```

**Neo4j (same weight/filters API):**

```python
from yc_property_search import Neo4jPropertySearch

with Neo4jPropertySearch() as neo:
    df = neo.search(weights={"score_famous_school": 10}, filters={}, top_k=5)
```

**Full RAG (Gemma + Ollama):**

```python
from yc_rag_search_gemma import PropertyRAGSearchGemma

with PropertyRAGSearchGemma() as rag:
    out = rag.ask("4-room in Tampines under $700k near MRT")
print(out["answer"])
print(out["params"])
print(out["results"])
```

---

## Relationship to the PropertyLens backend chatbot

- **`backend/rag_chat.py` + `backend/rag_v51/`**: document retrieval (e.g. Pinecone), routing, streaming answers — this is what the **web chat** uses when RAG v5.1 is enabled.
- **This folder (`06_search_layer`)**: prototype for **structured property listing search** from natural language. Wiring it into FastAPI would be a **new integration** (new endpoint or tool-calling path), not a drop-in replacement for `rag_v51`.

---

## Summary

| Question | Answer |
|----------|--------|
| What is Layer 06? | KB builder + Neo4j graph + weighted search + optional LLM to parse and explain queries. |
| What must I have to “use it”? | At minimum: **parquet KB + norm JSON** for local search; for notebooks 02–04: **Neo4j loaded from 01** + **`.env`** + **TinyLlama or Ollama**. |
| What if I have no CSVs? | Ask your teammate for **`property_knowledge_base_*.parquet`** (and norm JSON), or use their Neo4j Aura instance credentials — you cannot rebuild `01` without Layer 02 exports. |

For score definitions, filters, and graph schema details, see **`CLAUDE.md`** in this directory.
