"""Rewrite follow-up queries into standalone retrieval queries.

The LLM already sees `history[-6:]` in `backend/rag_v51/generate.py`, so it
handles conversational coreference fine when generating the answer. The
retriever, however, sees only the raw current message — so a follow-up like
"best schools in this area" embeds as six context-free words and pulls
chunks from whichever towns happen to share surface tokens with it.

This module adds a deterministic slot-based rewrite step between intent
classification and retrieval. It walks `history[-6:]` for the most-recent
town / flat-type anchor and substitutes it into the current message when the
message looks like a follow-up.

An optional Ollama rewrite (gated by RAG_CONTEXTUALIZE_LLM) can handle the
cases the deterministic path misses.
"""
from __future__ import annotations

import re
import time

from backend.hdb_towns import TOWNS
from backend.rag_v51.config import ENABLE_CONTEXTUALIZE, ENABLE_CONTEXTUALIZE_LLM


_ANAPHORA_RE = re.compile(
    r"\b(this|that|there|here|same|these|those|nearby|around|"
    r"the area|the town|the neighbo\w+)\b",
    re.I,
)

_FLAT_TYPE_RE = re.compile(
    r"\b(?:([2-5])[\s-]?ROOM|EXECUTIVE)\b",
    re.I,
)

_TOWNS_SORTED = tuple(sorted(TOWNS, key=len, reverse=True))


def _find_town(text: str) -> str | None:
    up = (text or "").upper()
    for t in _TOWNS_SORTED:
        if re.search(rf"\b{re.escape(t)}\b", up):
            return t
    return None


def _find_flat_type(text: str) -> str | None:
    m = _FLAT_TYPE_RE.search(text or "")
    if not m:
        return None
    if m.group(0).upper().startswith("EXECUTIVE"):
        return "EXECUTIVE"
    return f"{m.group(1)} ROOM"


def extract_slots(history: list[dict]) -> dict:
    """Walk `history[-6:]` newest-first across both user and assistant turns.
    Returns the most-recent town and flat_type mentioned, if any.
    """
    slots: dict[str, str] = {}
    for turn in reversed((history or [])[-6:]):
        content = (turn.get("content") or "")
        if "town" not in slots:
            town = _find_town(content)
            if town:
                slots["town"] = town
        if "flat_type" not in slots:
            ft = _find_flat_type(content)
            if ft:
                slots["flat_type"] = ft
        if "town" in slots and "flat_type" in slots:
            break
    return slots


def looks_like_followup(msg: str, slots: dict) -> bool:
    """Heuristic: only rewrite when we have something to substitute AND the
    message looks dependent on prior context."""
    if not slots:
        return False
    m = (msg or "").strip()
    if not m:
        return False
    # If the message anchors itself with an explicit town, trust it — even
    # if it's short. Prevents wrongly rewriting "schools in TAMPINES" with
    # a stale BEDOK slot.
    if _find_town(m) is not None:
        return False
    # Short messages tend to be follow-ups ("any schools?", "and trends?")
    if len(m.split()) <= 5:
        return True
    # Anaphora/deictic words in longer messages.
    if _ANAPHORA_RE.search(m):
        return True
    return False


def rewrite_with_slots(msg: str, slots: dict) -> str:
    """Deterministic substitution. Only touches the retrieval query — the
    user-visible message is unchanged."""
    town = slots.get("town")
    if not town:
        return msg
    out = msg
    out = re.sub(r"\b(this area|the area|the neighbo\w+|the town)\b", town, out, flags=re.I)
    out = re.sub(r"\b(there|here)\b", f"in {town}", out, flags=re.I)
    if _find_town(out) is None:
        out = f"{out.rstrip()} in {town}"
    return out


def _llm_rewrite(msg: str, history: list[dict]) -> tuple[str, str]:
    """Last-resort Ollama rewrite. Returns (rewrite_or_msg, log_note)."""
    from backend.rag_v51.routing import ollama_chat_once

    # Compact conversation transcript, newest-last.
    lines: list[str] = []
    for turn in (history or [])[-6:]:
        role = turn.get("role") or "user"
        content = (turn.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content[:400]}")
    transcript = "\n".join(lines) if lines else "(no prior turns)"

    prompt = f"""You rewrite follow-up questions into self-contained search queries
for a Singapore HDB property retrieval system. Use the conversation to resolve
pronouns ("this area", "there") into the concrete town / flat type / block
mentioned earlier. Keep it under 20 words. Return ONLY the rewritten query,
no explanation, no quotes.

Conversation:
{transcript}

Follow-up: {msg}

Rewritten query:"""
    t0 = time.perf_counter()
    try:
        raw = ollama_chat_once(prompt, timeout=10.0).strip()
        raw = raw.strip('"').strip("'").splitlines()[0].strip() if raw else ""
        ms = int((time.perf_counter() - t0) * 1000)
        if raw and raw.lower() != msg.strip().lower():
            return raw, f"contextualize_llm: '{msg}' → '{raw}' in {ms}ms"
        return msg, f"contextualize_llm: no change in {ms}ms"
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return msg, f"contextualize_llm failed in {ms}ms: {type(e).__name__}: {e}"


def contextualize_query(msg: str, history: list[dict]) -> tuple[str, list[str]]:
    """Returns (retrieval_query, log_notes). retrieval_query may equal msg
    when the message is already standalone or contextualization is disabled.
    """
    if not ENABLE_CONTEXTUALIZE:
        return msg, ["contextualize: disabled (RAG_CONTEXTUALIZE=0)"]
    slots = extract_slots(history or [])
    if not looks_like_followup(msg, slots):
        return msg, [f"contextualize: standalone (slots={slots or {}})"]
    rewritten = rewrite_with_slots(msg, slots)
    if rewritten != msg:
        return rewritten, [f"contextualize: slots={slots}, '{msg}' → '{rewritten}'"]
    if ENABLE_CONTEXTUALIZE_LLM:
        llm_out, note = _llm_rewrite(msg, history or [])
        return llm_out, [note]
    return msg, [f"contextualize: followup but no slot substitution (slots={slots})"]
