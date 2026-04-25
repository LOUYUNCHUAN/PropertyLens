# PropertyLens Chatbot — `/api/rag-chat` Logic

## 1. Request contract

**Input** (`RagChatRequest`):
- `message: str` — current user turn
- `history: list[{role, content}]` — prior turns (LLM sees last 6)
- `username: Optional[str]` / `Authorization` header — resolves shortlist rows
- `shortlist_item_id: Optional[int]` — pins a saved flat as the anchor
- `flat_overrides: Optional[PredictRequest]` — explicit flat struct from the UI
- `llm: "ollama" | "gemini"` — provider selector (defaults `ollama`)

**Output**: `text/event-stream` (SSE) with framed envelopes:
- `[INTENT]<name>[/INTENT]` — the classified turn intent (once, early)
- `[STATUS]retrieving | no_retrieval | generating[/STATUS]` — UI stage indicator
- `[SOURCES]<json>[/SOURCES]` — ≤10 chunks shown in the Sources panel
- `[LOG]<level>|<text>[/LOG]` — log-tab entries (`info | warn | error | debug`)
- `data: <token>` — LLM output pieces (newlines stripped)
- `[DONE]` — terminal marker

**Guards** (`backend/rag_chat.py:391`): `RAG_V51_ENABLED` must be on; `PINECONE_API_KEY` must be set — otherwise `503`.

---

## 2. High-level pipeline

```
message ──► intent classify ──► flat resolve ──► tools (predict / CBR / SHAP / shortlist)
                │                                   │
                ├──► smalltalk_ack   → canned reply, no LLM
                ├──► smalltalk_social → LLM only, no retrieval
                └──► else: skip-pinecone? ── no ──► contextualize → retrieve+rerank
                                                                     │
                                                                     ▼
                                                     prompt assembly (3 templates)
                                                                     │
                                                                     ▼
                                                     stream Ollama or Gemini
                                                                     │
                                                                     ▼
                                                  finish_reason / tokens → [LOG]
```

---

## 3. Intent classification (`classify_intent`, `backend/rag_chat.py:135`)

Priority-ordered, first match wins:

| Intent | Trigger | Effect |
|---|---|---|
| `smalltalk_ack` | message is 1–3 ack tokens ("ok", "thanks", "cheers"…) | canned reply, no LLM |
| `smalltalk_social` | greeting ≤ 8 tokens AND no domain keyword | LLM with empty context |
| `shortlist_only` | shortlist keyword hit AND user has saved rows AND no domain terms | retrieval skipped |
| `explain_shap` | has flat + "why / explain / shap / driver …" | SHAP tool runs |
| `cbr_lookup` | has flat + "similar / comparable / past sales …" | CBR tool runs |
| `predict_price` | "predict / estimate / how much / fair price / worth / is $ …" | prediction tool runs |
| `amenities_near` | "amenit\|near\|school\|mrt\|mall\|hawker\|market" | full retrieval |
| `trends_query` | "trend / by year / over time / yoy …" | full retrieval |
| `rag_general` | default fallthrough | full retrieval |

The **domain guard** (`_SMALLTALK_DOMAIN_GUARD`) prevents greetings that also mention a domain token ("hi, is 580k fair?") from being mis-classified as social.

---

## 4. Flat resolution (`_resolve_flat`, `backend/rag_chat.py:243`)

Three sources, in order:
1. **`body.flat_overrides`** — UI sends a full `PredictRequest` (Buyer / Seller view).
2. **`body.shortlist_item_id`** + authenticated user → load `WishlistListing.payload_json` from SQLite.
3. **NL fallback** (`_extract_flat_from_message`, only if `_wants_predict(msg)` is true): regex-parse `"BLK 123 BEDOK NORTH 1, 4 room, 90 sqm, 07 floor, 60 year lease"` into a synthesized `PredictRequest`. Requires address + flat_type + area to succeed; `flat_source="nl_extract"` is logged. **Known gap**: the address regex requires a leading block number, so "predict price of a property in hougang …" falls through and goes down the pure-RAG path.

---

## 5. Tool routing (`backend/rag_chat.py:418–454`)

Each tool runs conditionally and populates a context string, which is later injected as a labelled section in the prompt:

| Tool | Condition | Section label | Module |
|---|---|---|---|
| **Prediction** | `flat` resolved AND `_wants_predict(msg)` | `## Model prediction` | `backend.predict.predict` |
| **Shortlist** | `_wants_shortlist(msg)` AND authed | `## User shortlist` | SQLite `WishlistListing` query |
| **CBR** | `flat` AND `_wants_cbr(msg)` | `## Similar past transactions (CBR)` | `backend.cbr.run_cbr_similar` |
| **SHAP** | `flat` AND `_wants_shap(msg)` | `## Local SHAP explanation` | `backend.predict.run_explain_shap` |

Each tool is `try/except` wrapped — failures degrade to `"(X unavailable: …)"` and the chat continues. This is how the chatbot is **tool-augmented** without being agentic: the backend decides which tools to run deterministically from keywords, not from an LLM.

---

## 6. Skipping Pinecone (`_needs_pinecone_retrieval`, `backend/rag_chat.py:216`)

Retrieval is expensive (20–60s cold). It's skipped when:
- A prediction already ran AND the user didn't also ask for neighborhood context (`_wants_context` regex: "amenit\|near\|school\|trend\|similar\|…"), **or**
- Pure shortlist question (the SQLite rows are enough).

Intent `shortlist_only` and `smalltalk_ack/social` also skip retrieval.

---

## 7. Contextualize — follow-up rewrite (`backend/rag_v51/contextualize.py`)

Only the **retrieval query** is rewritten; the LLM still sees the original message. Gated by `RAG_CONTEXTUALIZE=1`.

1. **`extract_slots(history[-6:])`** — walks newest-first across user and assistant turns; fills `{town, flat_type}` from the first match in each slot.
2. **`looks_like_followup(msg, slots)`** — true iff slots exist AND (msg names no explicit town AND (≤5 tokens OR contains anaphora like "this/there/the area/nearby")).
3. **`rewrite_with_slots`** — deterministic substitution: "best schools in this area" + slot TAMPINES → "best schools in TAMPINES". If no anaphora match, appends `" in <town>"`.
4. **LLM fallback** — if `RAG_CONTEXTUALIZE_LLM=1` and the deterministic rewrite is a no-op, Ollama is prompted to rewrite (timeout 10s).

Log note: `contextualize: slots={'town': 'TAMPINES'}, 'best schools there' → 'best schools in TAMPINES'`.

---

## 8. Retrieval (`retrieve_and_rerank`, `backend/rag_v51/retrieve.py:204`)

Pipeline stages with Pinecone hybrid index `propertylens-rag`:

1. **Metadata filter extract** (optional, `RAG_LLM_FILTER=1`) — Ollama extracts `{town, flat_type, sale_year}` → passed to Pinecone only on the `transactions` namespace.
2. **Namespace routing** (`route_namespaces`) — keyword-based union over `transactions` (always) + `amenities` (schools/MRT/mall) + `trends` (yoy, appreciation) + `xai` (why, drivers).
3. **Sub-queries** (optional, `RAG_SUBQUERIES=1`) — Ollama fans the query into N paraphrases.
4. **Hybrid query per (namespace × sub-query)** — dense `BAAI/bge-m3` + sparse BM25 (alpha-weighted: `alpha=1.0` for dense pass, `alpha=0.0` for sparse pass).
5. **Reciprocal Rank Fusion** (`k=60`) with **source weights**: `amenity` and `xai` at 2.5×, `transaction` and `trend` at 1.0× (promotes high-signal chunks).
6. **Cross-encoder rerank** — top-20 fused → `BAAI/bge-reranker-v2-m3` → top-10.
7. **MMR** (λ=0.7) — redundancy-penalising pick of top-5 over the dense-embedded top-10.
8. **Reorder-for-context-window** — "lost in the middle" mitigation: strongest chunk first, weakest in the middle, 2nd-strongest last.

Returns `(final_chunks, log_notes)`; notes are streamed as `[LOG]` lines.

---

## 9. Prompt assembly (`backend/rag_v51/prompts.py:build_rag_prompt`)

Three templates, chosen by what's available:

| Template | Trigger | Shape |
|---|---|---|
| **Smalltalk** | no chunks AND no tool outputs | one-liner social system + `User: <query>`; bans `[Context N]` citations and verdicts |
| **Tool-first** | tool outputs AND no chunks | no "Retrieved context" framing; tool sections only; explicit "don't cite `[Context N]`" |
| **Full RAG** | chunks present | `## Retrieved context` with `[Context N]` headers + per-chunk metadata + tool sections + `## Question` |

Each chunk's `parent_text` is **clipped at `MAX_CHUNK_CHARS = 900`** and suffixed with ` …[truncated]` so the model knows the tail was cut. This caps the input well inside `OLLAMA_NUM_CTX`.

System prompt (`build_system_prompt`) enforces: cite `[Context N]` or tool section name; no outside knowledge; 3–5 sentences; Fair/Above/Below verdict **only** when user asked about fairness AND a price signal is present; no verdict for school/amenity/trend/explanation questions.

---

## 10. LLM streaming (`backend/rag_v51/generate.py:stream_rag_answer`)

- Builds `messages = [system, *history[-6:], user]`.
- Dispatches on `provider`:
  - **Ollama** (`_stream_ollama`): pre-flight GET `/api/tags` (2s timeout) so a down Ollama fails fast instead of hanging the 180s stream. POST `/api/chat` with `{temperature: 0.3, num_predict: 1024, num_ctx: 8192}`. Iterates NDJSON; yields `message.content` pieces; on `done=true` captures `done_reason`, `eval_count`, `prompt_eval_count` into `finish_info`.
  - **Gemini** (`_stream_gemini`): `GEMINI_API_KEY` + `gemini-2.5-flash`. Flattens messages to Gemini's `{role: user|model, parts:[…]}` history + a single trailing user prompt. On the last chunk, captures `candidates[0].finish_reason` and `usage_metadata`.

`finish_info` is threaded back to the endpoint so the log line `ollama: finish_reason=length in=2040 out=29` surfaces chopped replies as a diagnosable event instead of a mystery.

---

## 11. End-of-turn log line

After streaming, the endpoint emits:

```
[LOG] info | ollama: 320 tokens in 4120 ms, total 5980 ms
[LOG] warn | ollama: finish_reason=length in=7950 out=320
```

`warn` level is used when `finish_reason ∈ {length, max_tokens}` — the UI highlights these so the user can widen `OLLAMA_NUM_CTX` or shorten history.

---

## 12. Feature flags (env)

| Flag | Default | Effect |
|---|---|---|
| `RAG_V51_ENABLED` | `1` | master kill switch |
| `RAG_CONTEXTUALIZE` | `1` | slot-based follow-up rewrite |
| `RAG_CONTEXTUALIZE_LLM` | `0` | Ollama fallback when deterministic rewrite is a no-op |
| `RAG_LLM_FILTER` | `0` | Ollama-extracted Pinecone metadata filter |
| `RAG_SUBQUERIES` | `0` | Ollama sub-query fan-out |
| `OLLAMA_NUM_CTX` | `8192` | input window — raise for XAI-heavy chats |
| `OLLAMA_NUM_PREDICT` | `1024` | max output tokens |
| `GEMINI_API_KEY` | — | enables the Gemini provider |
