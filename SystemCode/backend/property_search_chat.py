"""
backend/property_search_chat.py
-------------------------------
New endpoint for Layer 06-style property search RAG.

Important: This is NOT the beta Ask AI (/api/rag-chat). It is a separate feature.
"""

from __future__ import annotations

import json
import time
from typing import Iterator

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.auth_deps import resolve_effective_username
from backend.chat_tools import (
    classify_smalltalk,
    extract_flat_from_message,
    format_shortlist_rows,
    run_cbr_tool,
    run_predict_tool,
    run_shap_tool,
    wants_cbr,
    wants_predict,
    wants_shap,
    wants_shortlist,
)
from backend.db import get_db
from backend.models import ChatRequest, PredictRequest
from backend.property_search_rag import (
    format_rows_markdown,
    get_property_search_graph_data,
    run_property_search_rag,
)
from backend.shortlist_graph import (
    ShortlistGraphUnavailable,
    ensure_user_projected,
    fetch_town_overlap_vs_history,
    fetch_user_saves_near_school,
    fetch_user_shortlist_graph,
    format_saves_near_school_rows,
    format_shortlist_graph_rows,
    format_town_overlap_vs_history,
)
from backend.sql_models import WishlistListing


def _wants_town_overlap(msg: str) -> bool:
    """Secondary trigger for the per-town aggregate query."""
    m = (msg or "").lower()
    if "town" not in m:
        return False
    keys = (
        "overlap", "by town", "vs history", "historical median",
        "town comparison", "compare town", "median price",
    )
    return any(k in m for k in keys)


router = APIRouter()


def _sse_text_chunk(text: str) -> str:
    # SSE is line-oriented: literal newlines would break the "data:" framing.
    # Preserve markdown structure by escaping newlines as \\n and decoding client-side.
    safe = (text or "")
    safe = safe.replace("\\", "\\\\")
    safe = safe.replace("\r\n", "\n").replace("\r", "\n")
    safe = safe.replace("\n", "\\n")
    return f"data: {safe}\n\n"


def _sse_log(level: str, text: str) -> str:
    safe = (text or "").replace("\n", " ").replace("|", "¦")
    return f"data: [LOG]{level}|{safe}[/LOG]\n\n"


@router.post("/property-search-chat")
def property_search_chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
    authorization: Annotated[Optional[str], Header()] = None,
):
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="message is required")

    hist = body.history or []
    try:
        eff_username = resolve_effective_username(authorization, "")
    except HTTPException:
        raise

    def stream_response() -> Iterator[str]:
        yield ": ok\n\n"
        t0 = time.perf_counter()
        yield _sse_log("info", f"POST /api/property-search-chat msg={msg[:80]!r}")

        # --------------------------------------------
        # Small-talk fast path
        # --------------------------------------------
        st = classify_smalltalk(msg)
        if st == "ack":
            yield _sse_text_chunk(
                "You're welcome — want to search for flats, predict a listing price, "
                "or compare similar past sales?"
            )
            yield "data: [DONE]\n\n"
            return
        if st == "social":
            yield _sse_text_chunk(
                "Hi — I can help you search for HDB flats, estimate a listing price, "
                "or explain price drivers. Try: “Find a 4-room in Bishan under $900k near MRT”."
            )
            yield "data: [DONE]\n\n"
            return

        # --------------------------------------------
        # Tool sections (reused from /api/rag-chat)
        # --------------------------------------------
        tool_sections: list[str] = []
        flat_for_tools: PredictRequest | None = None

        # Shortlist section — prefer the Neo4j graph view (saves enriched with
        # historical-sale comparison) and fall back to the legacy SQL render
        # when Neo4j is unavailable.
        if wants_shortlist(msg) and eff_username:
            try:
                sql_rows = (
                    db.query(WishlistListing)
                    .filter(WishlistListing.username == eff_username)
                    .order_by(WishlistListing.created_at.desc())
                    .limit(40)
                    .all()
                )
            except Exception as e:
                sql_rows = []
                tool_sections.append(
                    f"### Your shortlist\n\n(shortlist unavailable: {type(e).__name__}: {e})"
                )

            graph_section_md: str | None = None
            town_overlap_md: str | None = None
            if sql_rows:
                try:
                    ensure_user_projected(eff_username, sql_rows)  # idempotent self-heal
                    graph_rows = fetch_user_shortlist_graph(eff_username, limit=40)
                    if graph_rows:
                        graph_section_md = (
                            "### Your shortlist (graph view — vs historical sales)\n\n"
                            + format_shortlist_graph_rows(graph_rows)
                        )
                    if _wants_town_overlap(msg):
                        overlap_rows = fetch_town_overlap_vs_history(eff_username)
                        if overlap_rows:
                            town_overlap_md = (
                                "### Your saves by town vs historical median\n\n"
                                + format_town_overlap_vs_history(overlap_rows)
                            )
                except ShortlistGraphUnavailable:
                    graph_section_md = None
                    town_overlap_md = None

            if graph_section_md:
                tool_sections.append(graph_section_md)
                if town_overlap_md:
                    tool_sections.append(town_overlap_md)
            elif sql_rows:
                # Strict fallback to today's behaviour when the graph view is unreachable.
                tool_sections.append("### Your shortlist\n\n" + format_shortlist_rows(sql_rows))

            # Fallback flat for tools (predict/CBR/SHAP) — uses the most recent
            # wishlist payload regardless of which render path fired above.
            if flat_for_tools is None:
                for r in sql_rows:
                    if r.payload_json:
                        try:
                            flat_for_tools = PredictRequest.model_validate(r.payload_json)
                            break
                        except Exception:
                            continue

        # Extract flat from message (predict/CBR/SHAP)
        if flat_for_tools is None and (wants_predict(msg) or wants_cbr(msg) or wants_shap(msg)):
            flat_for_tools = extract_flat_from_message(msg)

        # Decide whether we should also run property search.
        # If the user provided a specific flat (parsed) and is asking for a tool output
        # like prediction/CBR/SHAP, skip Top matches to avoid confusing “extra” recommendations.
        msg_l = msg.lower()
        looks_like_property_search = any(
            k in msg_l
            for k in (
                "find",
                "recommend",
                "suggest",
                "show me flats",
                "near ",
                "nearby",
                "under $",
                "under s$",
                "budget",
                "top matches",
                "rank",
                "best ",
                "options",
                "which flat",
            )
        )
        tool_only_mode = bool(flat_for_tools) and (
            wants_predict(msg) or wants_cbr(msg) or wants_shap(msg)
        ) and not looks_like_property_search

        # Shortlist queries: when we already rendered the user's saves (graph or SQL)
        # and the message doesn't also ask for a generic property search, skip RAG so
        # the LLM doesn't invent unrelated "top matches" alongside the real shortlist.
        shortlist_rendered = wants_shortlist(msg) and any(
            sec.startswith("### Your shortlist") for sec in tool_sections
        )
        if shortlist_rendered and not looks_like_property_search:
            tool_only_mode = True

        if flat_for_tools is not None and wants_predict(msg):
            try:
                tool_sections.append("### Price estimate\n\n" + run_predict_tool(flat_for_tools))
            except Exception as e:
                tool_sections.append(f"### Price estimate\n\n(prediction unavailable: {type(e).__name__}: {e})")

        if flat_for_tools is not None and wants_cbr(msg):
            try:
                tool_sections.append("### Similar past sales\n\n" + run_cbr_tool(flat_for_tools, k=8))
            except Exception as e:
                tool_sections.append(f"### Similar past sales\n\n(CBR unavailable: {type(e).__name__}: {e})")

        if flat_for_tools is not None and wants_shap(msg):
            try:
                tool_sections.append("### SHAP drivers\n\n" + run_shap_tool(flat_for_tools))
            except Exception as e:
                tool_sections.append(f"### SHAP drivers\n\n(SHAP unavailable: {type(e).__name__}: {e})")

        md_parts: list[str] = []
        if tool_sections:
            md_parts.append("\n\n".join(tool_sections).strip())

        if not tool_only_mode:
            try:
                yield "data: [STATUS]extracting[/STATUS]\n\n"
                result = run_property_search_rag(msg, hist, top_k=5)
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                yield _sse_log("error", f"property-search failed: {err}")
                yield _sse_text_chunk(
                    "Property search is unavailable right now. "
                    "Checklist: Ollama running (OLLAMA_BASE_URL), model pulled (OLLAMA_MODEL), "
                    "Neo4j configured (NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD), "
                    "and Neo4j contains Layer 06 nodes (:Property, :Town, :FamousSchool). "
                    f"Server error: {err}"
                )
                yield "data: [DONE]\n\n"
                return

            elapsed_ms = int((time.perf_counter() - t0) * 1000)
            yield _sse_log("info", f"done in {elapsed_ms}ms rows={len(result.rows)}")

            # Emit params for debug (non-breaking: UI ignores unknown tags)
            try:
                yield "data: [PARAMS]" + json.dumps(result.params) + "[/PARAMS]\n\n"
            except Exception:
                pass

            # When the search is "near a famous school", anchor the section
            # header on the school AND cross-reference the user's own
            # shortlist so they see "you already saved BLK X near this school"
            # before the historical comps. The rows themselves are then
            # rendered with the searched school explicitly tagged on each line
            # (so the user never confuses "near AI TONG" with "0.3 km from the
            # school I asked about").
            params_obj = result.params or {}
            searched_school: str | None = None
            if params_obj.get("special_query_type") == "near_famous_school":
                school_val = (params_obj.get("filters") or {}).get("school_name")
                if school_val:
                    searched_school = str(school_val).strip()

            # Cross-reference the user's saves against the searched school —
            # only when logged in AND the special-school path fired.
            if searched_school and eff_username:
                try:
                    save_rows = fetch_user_saves_near_school(eff_username, searched_school)
                    if save_rows:
                        md_parts.append(
                            f"### From your shortlist near {searched_school}\n\n"
                            + format_saves_near_school_rows(save_rows, searched_school)
                        )
                except ShortlistGraphUnavailable:
                    pass  # silent — graph view is best-effort, comps still render

            # Surface the structured comp rows BEFORE the LLM narrative so the
            # user always sees the factual table — even if the LLM drifts. Rows
            # are framed as historical comparable sales, not current listings.
            if result.rows:
                if searched_school:
                    header = f"### Historical comparables near {searched_school}"
                else:
                    header = "### Historical comparables matching your criteria"
                md_parts.append(
                    f"{header}\n\n"
                    "_Past resale transactions, most recent sale per address — not current listings._\n\n"
                    + format_rows_markdown(result.rows, limit=5, searched_school=searched_school)
                )

            answer = (result.answer or "").strip()
            if answer:
                md_parts.append(answer.strip())

        md = "\n\n".join(p for p in md_parts if p).strip()
        yield _sse_text_chunk(md)

        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@router.get("/debug/property-search-graph")
def debug_property_search_graph():
    """GET /api/debug/property-search-graph — schema + aggregate view
    of the Neo4j graph that backs the Property Search AI chatbot.

    Returns `{ ok: true, stats, nodes, links, sample_properties }` when the
    database is reachable, or `{ ok: false, error: "..." }` otherwise.
    """
    try:
        return get_property_search_graph_data()
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        return {
            "ok": False,
            "error": (
                "Property search graph unavailable. "
                "Checklist: Neo4j configured (NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD), "
                "and Neo4j contains Layer 06 nodes (:Property, :Town, :FamousSchool). "
                f"Server error: {err}"
            ),
        }

