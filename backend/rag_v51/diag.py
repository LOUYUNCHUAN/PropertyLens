"""Diagnostic probe for the rag-chat dependency graph.

Checks Ollama reachability + model list, Pinecone index stats, BM25 cache
presence, and whether the in-process dense/cross encoders are warm. Avoids
triggering any download — safe to hit cold.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import requests

from backend.rag_v51 import encoders
from backend.rag_v51.config import (
    BM25_CACHE_PATH,
    DENSE_MODEL_NAME,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    PINECONE_API_KEY,
    PINECONE_INDEX,
    RERANKER_MODEL,
)


def _check_ollama() -> dict:
    try:
        t0 = time.perf_counter()
        r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2)
        r.raise_for_status()
        tags = r.json().get("models", []) or []
        names = [m.get("name") or m.get("model") for m in tags]
        return {
            "ok": True,
            "base_url": OLLAMA_BASE_URL,
            "configured_model": OLLAMA_MODEL,
            "model_available": any((n or "").startswith(OLLAMA_MODEL) for n in names),
            "models": names,
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        return {"ok": False, "base_url": OLLAMA_BASE_URL, "error": f"{type(e).__name__}: {e}"}


def _check_pinecone() -> dict:
    if not PINECONE_API_KEY:
        return {"ok": False, "error": "PINECONE_API_KEY not set"}
    try:
        from backend.rag_v51.pinecone_index import get_pinecone_index

        t0 = time.perf_counter()
        index = get_pinecone_index()
        stats = index.describe_index_stats()
        # stats objects vary by client version — coerce to dict best-effort
        stats_dict: Any = getattr(stats, "to_dict", lambda: stats)()
        return {
            "ok": True,
            "index": PINECONE_INDEX,
            "total_vectors": stats_dict.get("total_vector_count") if isinstance(stats_dict, dict) else None,
            "namespaces": list((stats_dict.get("namespaces") or {}).keys()) if isinstance(stats_dict, dict) else None,
            "elapsed_ms": int((time.perf_counter() - t0) * 1000),
        }
    except Exception as e:
        return {"ok": False, "index": PINECONE_INDEX, "error": f"{type(e).__name__}: {e}"}


def _check_bm25() -> dict:
    path = Path(BM25_CACHE_PATH)
    if not path.exists():
        return {"ok": False, "path": str(path), "error": "BM25 cache file not found"}
    return {"ok": True, "path": str(path), "size_bytes": path.stat().st_size}


def _check_encoders() -> dict:
    return {
        "dense_model": DENSE_MODEL_NAME,
        "dense_warm": encoders._dense_encoder is not None,
        "cross_model": RERANKER_MODEL,
        "cross_warm": encoders._ce_model is not None,
        "bm25_warm": encoders._bm25_encoder is not None,
    }


def run_diagnostics() -> dict:
    return {
        "rag_v51_enabled": os.environ.get("RAG_V51_ENABLED", "1") != "0",
        "ollama": _check_ollama(),
        "pinecone": _check_pinecone(),
        "bm25_cache": _check_bm25(),
        "encoders": _check_encoders(),
    }
