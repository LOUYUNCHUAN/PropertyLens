"""System and user prompts for grounded RAG."""

from __future__ import annotations

from typing import Any


MAX_CHUNK_CHARS = 900
_TRUNCATE_MARKER = " …[truncated]"


def _clip_chunk_text(text: str) -> str:
    if len(text) <= MAX_CHUNK_CHARS:
        return text
    return text[:MAX_CHUNK_CHARS].rstrip() + _TRUNCATE_MARKER


def build_system_prompt() -> str:
    return """You are a Singapore HDB property pricing assistant for PropertyLens.
Help buyers and sellers make informed decisions about HDB resale prices.

Rules:
1. Answer ONLY using the provided context or tool sections. No outside knowledge.
2. Cite every specific claim — use [Context N] for retrieved chunks, or the
   tool section name (Model prediction / CBR / SHAP / User shortlist).
3. If evidence is thin or contradictory, say so clearly.
4. Keep answers to 3-5 sentences unless detail is requested.
5. Give a Fair / Above market / Below market verdict ONLY when the user asked
   about price fairness AND a prediction or asking price is present.
6. For price-statistics queries, report the exact numbers given (median,
   average, count). Do not invent prices not in the context.
7. For school-quality queries, list school names with their quality tier
   (very_high / high / medium / low), ranked most→least competitive, and
   do NOT give a price verdict. Also skip the verdict for amenity, trend,
   and explanation questions.
"""


def build_rag_prompt(
    query: str,
    context_chunks: list[dict[str, Any]],
    prediction_result: str = "",
    shortlist_context: str = "",
    cbr_context: str = "",
    shap_context: str = "",
) -> str:
    # Small-talk / social path — no retrieved context, no tool outputs. Keep
    # the reply short and on-brand; don't let the model hallucinate numbers.
    if not context_chunks and not any(
        [prediction_result, shortlist_context, cbr_context, shap_context]
    ):
        return (
            "You are PropertyLens — a Singapore HDB resale pricing and explainability assistant. "
            "Reply in one or two friendly sentences. Do not mention 'provided context'. "
            "Do not cite sources. Do not give a price verdict. "
            "If the user is greeting or asking who you are, say hi and briefly mention what you can help with "
            "(price fairness, amenities, comparable sales, and their shortlist).\n\n"
            f"User: {query}"
        )

    # Tool-first path — a backend tool (predict / CBR / SHAP / shortlist) produced
    # the answer and we skipped Pinecone. Drop the "Retrieved context" framing so
    # the model doesn't cite [Context N] labels that don't exist.
    if not context_chunks and any(
        [prediction_result, shortlist_context, cbr_context, shap_context]
    ):
        parts = [
            "You are PropertyLens — a Singapore HDB resale pricing assistant.",
            "The backend tools below produced the answer. Summarize the result "
            "clearly in 3-5 sentences. If a prediction and an asking price are "
            "both given, compare them and say Fair / Above market / Below market. "
            "Do NOT mention 'provided context'. Do NOT cite [Context N] — those "
            "don't exist on this path. You may cite tool sections by name "
            "(e.g. 'from CBR', 'from SHAP').",
        ]
        if prediction_result:
            parts.extend(["", "## Model prediction", prediction_result])
        if shortlist_context:
            parts.extend(["", "## User shortlist", shortlist_context])
        if cbr_context:
            parts.extend(["", "## Similar past transactions (CBR)", cbr_context])
        if shap_context:
            parts.extend(["", "## Local SHAP explanation", shap_context])
        parts.extend(["", "## Question", query])
        return "\n".join(parts).strip()

    parts: list[str] = ["## Retrieved context"]
    for i, c in enumerate(context_chunks, 1):
        md_ = c.get("metadata") or {}
        txt = _clip_chunk_text(str(md_.get("parent_text") or "").strip())
        hdr = (
            f"[Context {i}] source={md_.get('source')} town={md_.get('town')} "
            f"year={md_.get('sale_year')}"
        )
        parts.extend([hdr, txt, ""])
    if prediction_result:
        parts.extend(["## Model prediction", prediction_result, ""])
    if shortlist_context:
        parts.extend(["## User shortlist", shortlist_context, ""])
    if cbr_context:
        parts.extend(["## Similar past transactions (CBR)", cbr_context, ""])
    if shap_context:
        parts.extend(["## Local SHAP explanation", shap_context, ""])
    parts.extend(["## Question", query])
    return "\n".join(parts).strip()
