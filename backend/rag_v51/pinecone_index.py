"""Lazy Pinecone index handle."""

from __future__ import annotations

import threading

from backend.rag_v51.config import PINECONE_API_KEY, PINECONE_INDEX

_lock = threading.Lock()
_index = None


def get_pinecone_index():
    global _index
    with _lock:
        if _index is None:
            if not PINECONE_API_KEY:
                raise RuntimeError("PINECONE_API_KEY is not set")
            from pinecone import Pinecone

            pc = Pinecone(api_key=PINECONE_API_KEY)
            _index = pc.Index(PINECONE_INDEX)
    return _index
