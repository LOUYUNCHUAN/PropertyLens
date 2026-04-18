# Chatbot module audit — `/api/chat` + `/api/rag-chat`

Audit date: 2026-04-18. Scope: the chatbot module end-to-end — intent
routing, the tool layer (predict / CBR / SHAP / shortlist), the vector
RAG stack (`rag_v51/*`), the legacy Neo4j chat, and the streaming UI
(`ChatVectorDbView.jsx`). Goal: list concrete bugs, design issues, and
prioritised improvements.

## 1. Architecture today

Two parallel chat stacks ship behind the UI:

| Surface          | Route             | Pipeline                                                   |
|------------------|-------------------|------------------------------------------------------------|
| Debug/KG chat    | `POST /api/chat`  | Neo4j KG + Apriori + global SHAP → Ollama (Gemini fallback)|
| Ask-AI VectorDB  | `POST /api/rag-chat` | Pinecone hybrid + cross-encoder + MMR → Ollama + tools  |

Both use `_sse_text_chunk` / `[DONE]` framing. The RAG surface also emits
`[STATUS]`, `[SOURCES]`, `[INTENT]`, `[LOG]` frames consumed by
`streamRagChat` in `frontend/src/api/client.js`.

Inside `rag-chat`:

```
classify_intent ─► (smalltalk ack/social fast paths)
                └► structured flat (body or NL extract)
                    │
        parallel ───┼── run_predict  (if wants_predict)
        tools       ├── run_cbr_similar (if wants_cbr)
                    ├── run_explain_shap (if wants_shap)
                    └── WishlistListing query (if wants_shortlist)
                            │
_needs_pinecone_retrieval ──┘
    │
    ├─ skip (shortlist-only or prediction succeeded)
    └─ retrieve_and_rerank → stream_rag_answer (Ollama)
```

---

## 2. Critical bugs (fix first)

### 2.1 Duplicate rule numbers in the system prompt
`backend/rag_v51/prompts.py:12-26` — the numbered rule list has TWO rules
labelled `5.` and TWO labelled `6.`, and rule 6 appears with two different
bodies. Gemma reads it verbatim and the behaviour is unpredictable.

```
5. Give a Fair / Above market / Below market verdict …
5. For school quality queries: list school names …   ← duplicate #
6. For price statistics queries: report the exact numbers …
6. For school quality queries: mention school name …  ← duplicate #, contradicts 5b
```

Fix: renumber 1–7 cleanly, dedupe the two "school quality" rules into one.

### 2.2 LLM-based sub-query generation happens on every turn
`backend/rag_v51/routing.py:116-129` — `generate_subqueries` calls Ollama
with a 90 s timeout for **every** query that reaches retrieval, and so
does `extract_filters_from_query` (lines 35-53). Each RAG turn pays
**three Ollama round-trips**:
1. Filter extraction (sync, 90 s max)
2. Sub-query generation (sync, 90 s max)
3. Final streaming answer

Your logs show 40 s just in `retrieve`, most of which is likely those two
synchronous calls queued behind each other on a cold Ollama.

Fix options (pick one):
- **Cheap**: lower `N_SUBQUERIES` from 3 to 0 by default (env flag); use
  only the original query. The hybrid dense+BM25+rerank already handles
  paraphrasing well — sub-queries add marginal recall at huge latency
  cost.
- **Targeted**: only invoke sub-query generation for `rag_general` intent,
  not for tool-paired queries.
- **Cached**: memoise `(query → filters)` and `(query → sub-queries)` with
  an LRU + TTL so retries and near-duplicates skip Ollama.

### 2.3 Cross-encoder reranks 50 pairs on CPU — 5–20 s hidden cost
`retrieve.py:119-141` + `config.py:33` (`TOP_K_RETRIEVAL=50`). On CPU the
bge-reranker-v2-m3 processes 50 (query, doc) pairs serially. Even with
`KMP_DUPLICATE_LIB_OK=TRUE` and `OMP_NUM_THREADS=1` this is the dominant
cost after the sub-query calls.

Fix: `TOP_K_RETRIEVAL=20` by default (still comfortable for RRF fusion),
or batch the tokenizer call with `padding='max_length'` so torch reuses
its BLAS kernel instead of allocating per pair.

### 2.4 `extract_filters_from_query` never returns its log
If the LLM JSON parse fails or Ollama times out, the function silently
returns `None` (line 52) — no log in the SSE log panel. Combined with #2.2
this masks multi-second failures.

Fix: emit `[LOG]warn|filter_extract: ollama timeout` when it fails, and
`[LOG]info|filters={"town":"TAMPINES"}` when it succeeds. Same treatment
for `generate_subqueries`.

### 2.5 Cross-module town-list divergence
Three places in the repo keep their own list of HDB towns:

| File | Line | What it's used for |
|------|------|--------------------|
| `backend/chat.py:102-130` | KG intent matching | 26 towns, mixed casing |
| `backend/rag_chat.py:266-273` | NL extractor | 26 towns |
| `backend/rag_chat.py:126-131` | smalltalk domain guard | partial |
| `backend/rag_chat.py:155-160` | shortlist domain hit | partial |
| `backend/rag_v51/routing.py:56-113` | namespace routing | none — uses keywords |

Any new town (or a rename) has to be updated in **four** places. Bugs
waiting to happen.

Fix: single module `backend/hdb_towns.py` exporting `TOWNS`,
`MATURE_ESTATES`, `STREET_PREFIX_TO_TOWN`. Import from everywhere.

---

## 3. Important issues (design)

### 3.1 `_wants_*` keyword detectors have false positives
- `_wants_predict` matches `"is $"` — fires on the phrase "is $580k fair
  for a 4-room", which is actually a **price-fairness** question, not a
  raw prediction. Result: the predict tool runs even when the user wanted
  CBR context.
- `_wants_shap` matches `"why "` — fires on "why did Toa Payoh trend up"
  (a **trend** question), so SHAP runs on an irrelevant flat.
- `_wants_cbr` matches `"comp transaction"` with a space — won't match
  the plural `"comparable transactions"` (missing `\b` + stemming).

Fix: promote `classify_intent` to the authoritative router and gate tool
runs off the intent label, not free keyword scans. Example:

```python
if intent == "predict_price" and flat:
    prediction_result = ...
elif intent == "cbr_lookup" and flat:
    cbr_context = ...
elif intent == "explain_shap" and flat:
    shap_context = ...
```

Today the keyword scans and the intent classifier both run independently
and can disagree (e.g., intent=`amenities_near` but `_wants_predict`
still returns True).

### 3.2 Smalltalk regex `^(hi|hello|hey|hola|yo)\b` matches `hola amigo`
`rag_chat.py:118`. `^hola\b` matches the start of any sentence beginning
with "hola". That's fine, but combined with the 8-token ceiling it still
matches messages like `"hola can you tell me about tampines 4-room"`
(9 tokens breaks it, but 8 tokens doesn't). The domain guard catches
"tampines" so it's currently fine — but if someone greets in a novel
language ("bonjour can you help"), no domain guard trips and smalltalk
fires.

Fix: require smalltalk patterns to match the **whole** cleaned string,
not just anchor at start. e.g. `^(hi|hello|hey)[\s!,\.]*$`.

### 3.3 Shortlist SQL `limit(40)` — silent truncation
`rag_chat.py:482`. Users with >40 saved listings get a quietly truncated
context. No log, no warning. Tops of recent lists bias toward recent
saves.

Fix: emit `[LOG]warn|shortlist truncated to 40 of N` when `len(rows) == 40`.

### 3.4 `body.history` is blindly trusted
`rag_chat.py:558, 635` pass `body.history or []` straight to
`stream_rag_answer`, which takes `history[-6:]` and includes it in the
Ollama prompt. The UI sends whatever client-side state has. There's no
server-side validation that the role field is one of `{user, assistant}`
and no length cap per message. An attacker can smuggle arbitrary system
instructions into the prompt through `history[*].content`.

Fix: clamp each history message to `len(content) <= 2000`, drop roles
outside the allowlist, and consider trimming prior turns server-side from
a separate session store rather than trusting the client.

### 3.5 `/api/chat` and `/api/rag-chat` share zero code
Two separate implementations of:
- SSE framing (`_sse_text_chunk` duplicated in both files)
- Ollama streaming (`_ollama_chat_stream` in `chat.py`, `stream_rag_answer`
  in `generate.py`)
- System prompt building
- History truncation (`history[-6:]` in both)

`/api/chat` also carries dead fallback logic (Gemini) that `/api/rag-chat`
doesn't, and its `collect_sources` returns generic labels like
`"Neo4j Knowledge Graph"` rather than concrete node IDs.

Fix: if `/api/chat` is the "debug" surface and `/api/rag-chat` is the
production Ask-AI, either (a) extract a shared `backend/llm_stream.py` with
the common helpers, or (b) deprecate `/api/chat` once Neo4j KG facts can
be surfaced as a tool in the RAG pipeline.

### 3.6 The Pinecone skip path still emits `[SOURCES]` when it shouldn't
`rag_chat.py:612-626` — when retrieval is skipped, `context_chunks` is
empty, so `sources_meta` is `[]` and the `if sources_meta` guard prevents
emission. Good. But the **frontend's Sources tab** still shows the stale
source count from the previous turn because `liveSources` is reset only
on send, and no empty `[SOURCES]` frame is emitted to clear it.

Fix: emit `[SOURCES][]` explicitly on the skip path, or have the frontend
reset `liveSources` to `[]` when it sees `[STATUS]no_retrieval`.

### 3.7 `prediction_result` is a human-readable string, not structured
`rag_chat.py:468-472`. The Ollama prompt gets `"Hybrid model predicted
SGD 520,000 (approx range 480,000–560,000). Test RMSE ≈ $55,000."` as
free text. The LLM then:
- sometimes re-formats the number and introduces commas/periods mistakes,
- can't reliably extract the range for "Fair / Above / Below market"
  decisions without re-parsing.

Fix: keep a structured section in the prompt, e.g.:

```
## Model prediction (JSON)
{"predicted": 520000, "low": 480000, "high": 560000, "rmse": 55000}
```

The current LLM setup (Gemma 3) will happily read JSON.

### 3.8 Asking price is never propagated to the prompt
The NL extractor captures block/street/type/area but **ignores** "ask
S$430k". The predict tool runs, gets $261k, but the LLM is told only the
prediction, not the asking price. So "Is $430k fair?" returns a generic
verdict instead of `Above market (asking 430k vs predicted 261k — 65% above)`.

Fix: extract asking price in `_extract_flat_from_message` (regex
`(?:ask|asking|list(?:ed|ing)?)\s*(?:price)?\s*s?\$?\s*([\d,]+\.?\d*)\s*(k|thousand|m|million)?`),
stash it on the request, and add it to `prediction_result`.

### 3.9 CBR/SHAP are never triggered by NL-extracted flats
Today the extractor fires only when `_wants_predict(msg)` (line 454). A
message like `"comparable sales for 629 Hougang Ave 8 3-room 64sqm"` has
`_wants_cbr=True` but `_wants_predict=False` → no extraction → no flat
→ no CBR.

Fix: try extraction when **any** flat-requiring tool is wanted:
```python
if flat is None and (_wants_predict(msg) or _wants_cbr(msg) or _wants_shap(msg)):
```

### 3.10 Neo4j driver never closed
`backend/chat.py:91` opens a driver at module import and never calls
`.close()`. Fine for dev; will leak sockets over hot reloads.

Fix: `@router.on_event("shutdown")` in `main.py` to close the driver.

---

## 4. Minor bugs

### 4.1 `stream_rag_answer` pre-flight calls `/api/tags`, but the error path doesn't tell the UI how to fix it
`generate.py:62-67`. The RuntimeError message says "is `ollama serve` running?"
but the UI just shows `[Ollama error] RuntimeError: …`. The link to
`/api/rag-chat/diag` (the diag endpoint you already built) isn't surfaced.

Fix: frontend `onError` can show a hint linking to diag, or backend can
include `diag_url` in the error payload.

### 4.2 Cross-encoder warmup downloads ~1.2 GB at startup
`warmup.py:26-39` triggers `from_pretrained` on both the dense encoder
(BAAI/bge-m3, ~600 MB) and the reranker (~600 MB) on every cold start.
First-ever start on a fresh machine hangs for 2–5 min with no log.

Fix: add `print("downloading dense model…")` before each
`from_pretrained`, and skip warmup when `HF_HUB_OFFLINE=1`.

### 4.3 `_SMALLTALK_ACKS` contains `"k"` and `"kk"`
`rag_chat.py:112`. Any message that happens to be a single `k` (typo,
not a smalltalk ack) triggers the canned response. Low-probability but
annoying.

Fix: drop bare `k` from the set; keep `kk` only if you really want it.

### 4.4 `_extract_flat_from_message` regex matches spurious numbers
Test case: `"is 580k fair in bedok?"` — the `\d{1,4}` block regex
matches `580` and `street = "K FAIR IN BEDOK"`, which then fails town
inference and returns None. Correct, but only by accident.

Fix: require street starts with a capital letter and has at least one
space, not just "anything after a number".

### 4.5 `_wants_shortlist` misses `"my list"` and `"saved"`
`rag_chat.py:46-58`. Users often say "what's in my list" or
"saved flats" — both unmatched.

Fix: add `"my list"`, `"my flats"`, `"saved flat"`, `"saved prop"`.

### 4.6 Streaming bubble color hardcoded to `var(--sage-pale)` + no dark mode
`ChatVectorDbView.jsx:194-203`. The assistant bubble doesn't respond to
`prefers-color-scheme: dark` or the project's theme toggle. Low priority
for this app but worth noting.

### 4.7 Log panel maxes out around 1000 lines and stutters
`ChatVectorDbView.jsx:55,68-70`. On a long session, `logs` array grows
unbounded and each append triggers a full re-render + autoscroll.

Fix: cap at 500 (`setLogs(prev => [...prev.slice(-499), newLine])`) and
virtualise with `react-window` when >200 lines.

### 4.8 `formatSource` is dead code on the RAG path
`ChatVectorDbView.jsx:35-43`. It was written for the plain-string source
list from `/api/chat`; the RAG path always emits objects with `{i, source,
town, score, snippet, text}`.

Fix: delete; use the inline source chip renderer in `history.map` for
assistant messages with sources.

### 4.9 `onError` path discards the partial answer
`ChatVectorDbView.jsx:128-140`. If Ollama dies mid-stream, the
`answerBuf` accumulated so far is overwritten with `"**Error:** ..."`
instead of being shown alongside the error.

Fix: push `answerBuf + "\n\n[stream interrupted: <msg>]"` on error.

### 4.10 `diag.py` doesn't expose the route
`rag_v51/diag.py:87-94` defines `run_diagnostics()` but I couldn't find
`/api/rag-chat/diag` wired in `main.py`. The prior plan
(`smalltalk-fast-path.md` sibling plan) referenced it.

Fix: verify or add:
```python
@router.get("/rag-chat/diag")
def rag_diag():
    return run_diagnostics()
```

---

## 5. Performance wins (ranked by ROI)

| # | Change | Latency saved (cold) | Effort |
|---|--------|----------------------|--------|
| 1 | Drop `N_SUBQUERIES` to 0 (§2.2) | ~15-30 s | 1 line |
| 2 | Skip `extract_filters_from_query` for tool-paired queries | ~5-15 s | 5 lines |
| 3 | `TOP_K_RETRIEVAL=20` instead of 50 (§2.3) | ~2-4 s | 1 line |
| 4 | Cache `(query → filters, subqueries)` LRU | ~5-20 s on retries | ~20 lines |
| 5 | Batch tokenise cross-encoder pairs (§2.3) | ~1-3 s | ~10 lines |
| 6 | Move Pinecone + encoder cold-start behind `/api/rag-chat/warm` button | perceived latency | ~40 lines |

Tool-first short-circuit (already implemented this session) saves ~40 s
per `predict_price` turn on top of the above.

---

## 6. Test coverage gaps

No tests exist for the chatbot module. Minimum useful set:

- `test_classify_intent_*`: 20 phrasings mapping to each of the 9 intents.
- `test_extract_flat_*`: the examples in this conversation
  (Hougang, Lorong Lew Lian, Telok Blangah, Boon Lay, Commonwealth) plus
  negatives ("how are you", "is 580k fair").
- `test_needs_pinecone_retrieval`: tool-paired vs unpaired matrix.
- `test_smalltalk_domain_guard`: ensure "hi, is 580k fair?" routes to
  predict, not smalltalk.

Target file: `tests/test_rag_chat.py`. Mock `run_predict`, `run_cbr_similar`,
`run_explain_shap` with fakes; no Pinecone or Ollama needed for router tests.

---

## 7. Recommended sequence

1. §2.1 duplicate rules — 2 min, zero risk.
2. §2.2 disable sub-queries by default — biggest latency win for the
   current demo.
3. §3.1 intent-first tool gating — reduces accidental tool runs.
4. §3.8 pipe asking price into the prompt — fixes the Hougang "430k vs
   predicted 261k" case you showed.
5. §2.5 consolidate town lists.
6. §3.9 extract-on-any-flat-tool.
7. Unit tests from §6.

Total estimated cost of 1–4: half a day. Expected latency improvement on
`predict_price` turns: **40 s → 4 s** (cold), **15 s → 2 s** (warm).
