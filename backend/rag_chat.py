"""
POST /api/rag-chat — Pinecone hybrid RAG (v5.1) + optional tools (predict, CBR, SHAP, shortlist).
"""

from __future__ import annotations

import json
import os
import re
from typing import Annotated, Iterator, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.auth_deps import resolve_effective_username
from backend.chat_tools import (
    extract_flat_from_message as _extract_flat_from_message,
    format_cbr as _format_cbr,
    format_shap as _format_shap,
    format_shortlist_rows as _format_shortlist_rows,
    resolve_flat_from_rag_body as _resolve_flat,
    run_cbr_tool as _run_cbr_tool,
    run_predict_tool as _run_predict_tool,
    run_shap_tool as _run_shap_tool,
    wants_cbr as _wants_cbr,
    wants_predict as _wants_predict,
    wants_shap as _wants_shap,
    wants_shortlist as _wants_shortlist,
)
from backend.db import get_db
from backend.hdb_towns import TOWNS as _HDB_TOWNS, STREET_PREFIX_TO_TOWN, infer_town_from_street
from backend.models import RagChatRequest
from backend.sql_models import WishlistListing

router = APIRouter()


def _rag_v51_enabled() -> bool:
    return os.environ.get("RAG_V51_ENABLED", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _sse_text_chunk(text: str) -> str:
    safe = (text or "").replace("\r\n", " ").replace("\r", " ").replace("\n", " ")
    return f"data: {safe}\n\n"


def _sse_log(level: str, text: str) -> str:
    """Emit a structured log line for the UI's tail-style panel.
    Wire format: data: [LOG]<level>|<text>[/LOG]\n\n   (level: info|warn|error|debug)
    """
    safe = (text or "").replace("\n", " ").replace("|", "¦")
    return f"data: [LOG]{level}|{safe}[/LOG]\n\n"


#
# Tool triggers + helpers were extracted to backend/chat_tools.py.
# Keep the rest of this module behavior unchanged.
#


_SMALLTALK_ACKS = frozenset({
    "ok", "okay", "k", "kk", "thanks", "thank you", "thx", "ty", "cheers",
    "got it", "noted", "alright", "cool", "nice", "great", "perfect",
    "sounds good", "makes sense", "bye",
})

_SMALLTALK_SOCIAL_PATTERNS = (
    r"^(hi|hello|hey|hola|yo)\b",
    r"good (morning|afternoon|evening|night)",
    r"how (are|r) (you|u)\b",
    r"(what's|whats) up|how's it going",
    r"who are you|what can you do|what do you do|what are you|what is this|help me",
)


_SMALLTALK_DOMAIN_GUARD = re.compile(
    r"\b(\$|sgd|price|fair|valuation|estimate|predict|how much|worth|cheap|expensive|"
    r"trend|amenit|mrt|school|transaction|near|around|similar|comp|sold|history|"
    r"tampines|bedok|hougang|jurong|punggol|sengkang|woodlands|yishun|bishan|"
    r"ang mo|toa payoh|clementi|queenstown|shortlist|wishlist|save)\b"
)


def classify_intent(msg: str, has_flat: bool, has_shortlist_rows: bool) -> str:
    """Pick ONE primary intent per turn. Used to label the turn for the UI
    (emitted as [INTENT]...[/INTENT]) and to gate retrieval for shortlist-only
    and small-talk flows. Priority order matters — first match wins.

    Returns one of:
      smalltalk_ack | smalltalk_social | predict_price | explain_shap |
      cbr_lookup | amenities_near | trends_query | shortlist_only | rag_general
    """
    st = _classify_smalltalk(msg)
    if st == "ack":
        return "smalltalk_ack"
    if st == "social":
        return "smalltalk_social"

    m = msg.lower()

    shortlist_hit = _wants_shortlist(msg) and has_shortlist_rows
    # For the shortlist_only branch, we only care whether the user ALSO
    # reaches for something Pinecone/prediction-driven. Shortlist/wishlist
    # terms are expected here and do NOT count as "domain hit".
    shortlist_domain_hit = bool(
        re.search(
            r"\b(\$|sgd|price|fair|valuation|estimate|predict|how much|worth|"
            r"trend|amenit|mrt|school|transaction|near|similar|comp|sold|history|mall|hawker|"
            r"tampines|bedok|hougang|jurong|punggol|sengkang|woodlands|yishun|bishan|"
            r"ang mo|toa payoh|clementi|queenstown)\b",
            m,
        )
    )
    if shortlist_hit and not shortlist_domain_hit:
        return "shortlist_only"

    if _wants_shap(msg) and has_flat:
        return "explain_shap"
    if _wants_cbr(msg) and has_flat:
        return "cbr_lookup"
    if _wants_predict(msg):
        return "predict_price"
    if re.search(r"\b(amenit|near|around|school|mrt|mall|hawker|market)\b", m):
        return "amenities_near"
    if re.search(r"\b(trend|by year|over time|historical|timeline|yoy)\b", m):
        return "trends_query"
    return "rag_general"


def _classify_smalltalk(msg: str) -> str | None:
    """Returns 'ack' | 'social' | None — used to bypass Pinecone + (optionally) Ollama.

    A greeting that also mentions a property keyword (e.g. "hi, is 580k fair?")
    is NOT small-talk — fall through to the full pipeline.
    """
    clean = msg.strip().lower().rstrip(".!?")
    if not clean:
        return None
    if clean in _SMALLTALK_ACKS:
        return "ack"
    tokens = clean.split()
    if len(tokens) <= 3 and all(tok in _SMALLTALK_ACKS for tok in tokens):
        return "ack"
    if _SMALLTALK_DOMAIN_GUARD.search(clean):
        return None
    if len(tokens) <= 8 and any(re.search(p, clean) for p in _SMALLTALK_SOCIAL_PATTERNS):
        return "social"
    return None


_CONTEXT_WANT_RE = re.compile(
    r"\b(amenit\w*|near\w*|school\w*|mrt\w*|mall\w*|hawker\w*|market\w*|"
    r"trend\w*|histor\w*|similar|comp\w*|neighbo\w*|area|surrounding\w*)\b",
    re.I,
)


def _wants_context(msg: str) -> bool:
    """True when the user also asks for neighborhood/amenity/trend context
    on top of a pure predict/explain tool call — in which case Pinecone is
    still worth the latency."""
    return bool(_CONTEXT_WANT_RE.search(msg or ""))


def _needs_pinecone_retrieval(
    msg: str, shortlist_context: str, prediction_result: str = ""
) -> bool:
    """
    Skip Pinecone when another tool already produced the answer:
      - `prediction_result` is non-empty AND user didn't also ask for context
      - pure shortlist question (shortlist SQLite rows are enough)

    Skipping avoids 30-60s of encoder warmup + hybrid search + cross-encoder
    rerank on questions the vector DB wouldn't improve anyway.
    """
    if prediction_result.strip() and not _wants_context(msg):
        return False
    if not shortlist_context.strip():
        return True
    if not _wants_shortlist(msg):
        return True
    m = msg.lower()
    if re.search(
        r"\b(trend|amenit|transaction|near|school|mrt|fair|market|price|bedok|tampines|"
        r"ang mo|boon|compare|valuation|estimate|how much|similar|comp|sold|history)\b",
        m,
    ):
        return True
    return False


#
# _resolve_flat / _extract_flat_from_message / _format_* now come from chat_tools.
#


@router.post("/rag-chat")
def rag_chat(
    body: RagChatRequest,
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    if not _rag_v51_enabled():
        raise HTTPException(status_code=503, detail="Vector RAG chat is disabled (RAG_V51_ENABLED).")

    if not os.environ.get("PINECONE_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="PINECONE_API_KEY is not configured.")

    try:
        eff_username = resolve_effective_username(authorization, body.username or "")
    except HTTPException:
        raise

    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="message is required")

    flat = _resolve_flat(db, eff_username, body)
    flat_source = "structured" if flat is not None else None
    if flat is None and _wants_predict(msg):
        extracted = _extract_flat_from_message(msg)
        if extracted is not None:
            flat = extracted
            flat_source = "nl_extract"

    prediction_result = ""
    if flat and _wants_predict(msg):
        try:
            prediction_result = _run_predict_tool(flat)
        except Exception as e:
            prediction_result = f"(prediction unavailable: {type(e).__name__}: {e})"

    shortlist_context = ""
    if _wants_shortlist(msg) and eff_username:
        rows = (
            db.query(WishlistListing)
            .filter(WishlistListing.username == eff_username)
            .order_by(WishlistListing.created_at.desc())
            .limit(40)
            .all()
        )
        if rows:
            shortlist_context = _format_shortlist_rows(rows)

    cbr_context = ""
    if flat and _wants_cbr(msg):
        try:
            cbr_context = _run_cbr_tool(flat, k=8)
        except Exception as e:
            cbr_context = f"(CBR unavailable: {type(e).__name__}: {e})"

    shap_context = ""
    if flat and _wants_shap(msg):
        try:
            shap_context = _run_shap_tool(flat)
        except Exception as e:
            shap_context = f"(SHAP unavailable: {type(e).__name__}: {e})"

    from backend.rag_v51.contextualize import contextualize_query
    from backend.rag_v51.generate import stream_rag_answer
    from backend.rag_v51.pinecone_index import get_pinecone_index
    from backend.rag_v51.retrieve import retrieve_and_rerank

    pred_for_stream = prediction_result
    shortlist_for_stream = shortlist_context

    intent = classify_intent(
        msg,
        has_flat=flat is not None,
        has_shortlist_rows=bool(shortlist_for_stream),
    )

    import time as _time

    def stream_response() -> Iterator[str]:
        # Send headers + a tiny SSE comment before any slow work. If Pinecone retrieval
        # runs before StreamingResponse was returned, the proxy saw no HTTP response for
        # minutes and could close with "socket hang up".
        yield ": ok\n\n"
        t0 = _time.perf_counter()
        yield _sse_log("info", f"POST /api/rag-chat  msg={msg[:60]!r}")
        yield f"data: [INTENT]{intent}[/INTENT]\n\n"
        yield _sse_log("info", f"intent={intent}  flat={flat is not None}  shortlist_rows={bool(shortlist_for_stream)}")
        if flat_source == "nl_extract" and flat is not None:
            yield _sse_log(
                "info",
                f"nl_extract: block={flat.block} street={flat.street_name} town={flat.town} "
                f"type={flat.flat_type} area={flat.floor_area_sqm}sqm lease={int(flat.remaining_lease_years)}y",
            )
        elif _wants_predict(msg) and flat is None:
            yield _sse_log("warn", "predict intent but no flat extracted from message — RAG only")
        if prediction_result:
            yield _sse_log("info", "tool: prediction ran")
        if cbr_context:
            yield _sse_log("info", "tool: CBR ran")
        if shap_context:
            yield _sse_log("info", "tool: SHAP ran")

        # Fast path — pleasantries skip retrieval (and acks skip Ollama entirely).
        if intent == "smalltalk_ack":
            yield "data: [STATUS]no_retrieval[/STATUS]\n\n"
            yield _sse_log("info", "smalltalk_ack → canned reply, no Ollama")
            yield "data: [STATUS]generating[/STATUS]\n\n"
            yield _sse_text_chunk(
                "You're welcome — anything else about HDB pricing, amenities, or your shortlist?"
            )
            yield _sse_log("info", f"DONE in {(_time.perf_counter()-t0)*1000:.0f} ms")
            yield "data: [DONE]\n\n"
            return
        provider = (body.llm or "ollama").strip().lower()
        if provider not in ("ollama", "gemini"):
            provider = "ollama"

        if intent == "smalltalk_social":
            yield "data: [STATUS]no_retrieval[/STATUS]\n\n"
            yield _sse_log("info", f"smalltalk_social → skip retrieval, {provider} with empty context")
            yield "data: [STATUS]generating[/STATUS]\n\n"
            try:
                tokens = 0
                finish: dict = {}
                for piece in stream_rag_answer(
                    msg, body.history or [], [],
                    prediction_result="",
                    shortlist_context="",
                    cbr_context="",
                    shap_context="",
                    provider=provider,
                    finish_info=finish,
                ):
                    tokens += 1
                    yield _sse_text_chunk(piece)
                yield _sse_log("info", f"{provider}: {tokens} tokens, DONE in {(_time.perf_counter()-t0)*1000:.0f} ms")
                if finish.get("reason") is not None:
                    yield _sse_log(
                        "info",
                        f"{provider}: finish_reason={finish.get('reason')} "
                        f"in={finish.get('input_tokens')} out={finish.get('output_tokens')}",
                    )
                yield "data: [DONE]\n\n"
            except Exception as e:
                import traceback
                traceback.print_exc()
                yield _sse_log("error", f"{provider}: {type(e).__name__}: {e}")
                yield _sse_text_chunk(f"[{provider} error] {type(e).__name__}: {e}")
                yield "data: [DONE]\n\n"
            return

        pred_local = pred_for_stream
        short_local = shortlist_for_stream
        context_chunks: list = []
        if _needs_pinecone_retrieval(msg, short_local, pred_local):
            yield "data: [STATUS]retrieving[/STATUS]\n\n"
            retrieval_query, ctx_notes = contextualize_query(msg, body.history or [])
            for note in ctx_notes:
                yield _sse_log("info", note)
            yield _sse_log("info", "pinecone: hybrid retrieve (dense + BM25)")
            tr0 = _time.perf_counter()
            index = get_pinecone_index()
            try:
                context_chunks, retrieve_notes = retrieve_and_rerank(retrieval_query, index, verbose=False)
                for note in retrieve_notes:
                    yield _sse_log("info", note)
                yield _sse_log(
                    "info",
                    f"retrieve: {len(context_chunks)} chunks in {(_time.perf_counter()-tr0)*1000:.0f} ms",
                )
            except Exception as e:
                import traceback
                traceback.print_exc()
                context_chunks = []
                yield _sse_log("error", f"retrieve failed: {type(e).__name__}: {e}")
                err_note = f"[Retrieval warning: {type(e).__name__}: {e}]"
                if not any([pred_local, short_local, cbr_context, shap_context]):
                    pred_local = err_note
                else:
                    short_local = (short_local + "\n" + err_note).strip()
        else:
            yield "data: [STATUS]no_retrieval[/STATUS]\n\n"
            yield _sse_log("info", "retrieval skipped (shortlist-only path)")

        def _full_text(meta: dict) -> str:
            for k in ("parent_text", "text", "content", "chunk", "summary"):
                v = meta.get(k)
                if isinstance(v, str) and v.strip():
                    return v.strip()[:1500]
            return ""

        sources_meta = []
        for i, c in enumerate(context_chunks[:10]):
            meta = c.get("metadata") or {}
            full = _full_text(meta)
            sources_meta.append({
                "i": i + 1,
                "source": meta.get("source"),
                "town": meta.get("town"),
                "score": round(float(c.get("ce_score") or c.get("score") or 0), 4),
                "snippet": full[:220],
                "text": full,
            })
        if sources_meta:
            yield f"data: [SOURCES]{json.dumps(sources_meta)}[/SOURCES]\n\n"
            yield _sse_log("info", f"sources: {len(sources_meta)} chunks emitted to UI")

        yield "data: [STATUS]generating[/STATUS]\n\n"
        yield _sse_log("info", f"{provider}: streaming reply")
        tg0 = _time.perf_counter()
        try:
            tokens = 0
            finish: dict = {}
            for piece in stream_rag_answer(
                msg,
                body.history or [],
                context_chunks,
                prediction_result=pred_local,
                shortlist_context=short_local,
                cbr_context=cbr_context,
                shap_context=shap_context,
                provider=provider,
                finish_info=finish,
            ):
                tokens += 1
                yield _sse_text_chunk(piece)
            yield _sse_log(
                "info",
                f"{provider}: {tokens} tokens in {(_time.perf_counter()-tg0)*1000:.0f} ms, "
                f"total {(_time.perf_counter()-t0)*1000:.0f} ms",
            )
            if finish.get("reason") is not None:
                level = "warn" if str(finish.get("reason")).lower() in ("length", "max_tokens") else "info"
                yield _sse_log(
                    level,
                    f"{provider}: finish_reason={finish.get('reason')} "
                    f"in={finish.get('input_tokens')} out={finish.get('output_tokens')}",
                )
            yield "data: [DONE]\n\n"
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield _sse_log("error", f"{provider}: {type(e).__name__}: {e}")
            yield _sse_text_chunk(f"[{provider} error] {type(e).__name__}: {e}")
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
