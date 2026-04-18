"""Metadata filter extraction, namespace routing, sub-queries (Ollama)."""

from __future__ import annotations

import json
import re
import time

import requests

from backend.rag_v51.config import (
    NS_AMENITIES,
    NS_TRANSACTIONS,
    NS_TRENDS,
    NS_XAI,
    N_SUBQUERIES,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
)


def _ollama_chat_once(user_prompt: str, timeout: float = 90.0) -> str:
    url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": user_prompt}],
        "stream": False,
        "options": {"temperature": 0.1, "num_predict": 512},
    }
    r = requests.post(url, json=payload, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return (data.get("message") or {}).get("content") or ""


ollama_chat_once = _ollama_chat_once


def extract_filters_from_query(query: str) -> tuple[dict | None, str]:
    """Use LLM to extract Pinecone metadata filters from a free-text query.
    Returns (filters_or_None, log_note). Gated by RAG_LLM_FILTER; callers
    should check ENABLE_LLM_FILTER before invoking.
    """
    prompt = f"""Extract structured fields from this Singapore HDB property query.
Return ONLY a valid JSON object with these optional keys:
  - "town": ALL CAPS HDB town e.g. "TAMPINES", "BEDOK", "SERANGOON"
  - "flat_type": one of "2 ROOM","3 ROOM","4 ROOM","5 ROOM","EXECUTIVE"
  - "sale_year": integer year if mentioned
Omit any field you are not sure about. Return {{}} if nothing is clear.
Return ONLY JSON, no explanation.

Query: {query}
"""
    t0 = time.perf_counter()
    try:
        raw = _ollama_chat_once(prompt)
        raw = re.sub(r"```[\w]*", "", raw).strip()
        parsed = json.loads(raw)
        ms = int((time.perf_counter() - t0) * 1000)
        if parsed:
            return parsed, f"filter_extract: {parsed} in {ms}ms"
        return None, f"filter_extract: empty in {ms}ms"
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return None, f"filter_extract failed in {ms}ms: {type(e).__name__}: {e}"


def route_namespaces(query: str) -> list[str]:
    q = query.lower()
    ns = [NS_TRANSACTIONS]
    if any(
        kw in q
        for kw in [
            "mrt",
            "school",
            "mall",
            "hawker",
            "near",
            "amenity",
            "transport",
            "good school",
            "competitive",
            "top school",
            "primary school",
            "quality school",
            "very_high",
            "high tier",
            "best school",
        ]
    ):
        ns.append(NS_AMENITIES)
    if any(
        kw in q
        for kw in [
            "trend",
            "rising",
            "falling",
            "increase",
            "decrease",
            "history",
            "recent",
            "last year",
            "past",
            "over time",
            "appreciation",
        ]
    ):
        ns.append(NS_TRENDS)
    if any(
        kw in q
        for kw in [
            "explain",
            "shap",
            "feature",
            "why",
            "reason",
            "driver",
            "factor",
            "importan",
            "predict",
            "model say",
        ]
    ):
        ns.append(NS_XAI)
    return ns


def generate_subqueries(query: str, n: int = N_SUBQUERIES) -> tuple[list[str], str]:
    """Generate n alternative queries for RRF-fusion via Ollama.
    Returns (list, log_note). Gated by RAG_SUBQUERIES; callers should check
    ENABLE_SUBQUERIES before invoking.
    """
    if n <= 0:
        return [], "subqueries: disabled (N_SUBQUERIES=0)"
    prompt = f"""You are a search query generator for Singapore HDB property data.
Generate {n} alternative search queries to help retrieve relevant data from a vector
database of HDB transactions, amenities, price trends, and SHAP features.
Return ONLY a numbered list. No explanations.

Original: {query}
"""
    t0 = time.perf_counter()
    try:
        raw = _ollama_chat_once(prompt)
        lines = re.findall(r"^\s*\d+\.\s*(.+)$", raw, re.MULTILINE)
        out = [l.strip().strip('"') for l in lines[:n]]
        ms = int((time.perf_counter() - t0) * 1000)
        return out, f"subqueries: {len(out)} generated in {ms}ms"
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return [], f"subqueries failed in {ms}ms: {type(e).__name__}: {e}"
