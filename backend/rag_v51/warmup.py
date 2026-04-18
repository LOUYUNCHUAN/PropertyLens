"""Optional startup warmup: load Pinecone handle + encoders before first /api/rag-chat."""

from __future__ import annotations

import os


def should_warm_rag_v51_on_startup() -> bool:
    if not os.environ.get("PINECONE_API_KEY", "").strip():
        return False
    if os.environ.get("RAG_V51_ENABLED", "1").strip().lower() not in (
        "1",
        "true",
        "yes",
        "on",
    ):
        return False
    return os.environ.get("RAG_V51_WARMUP", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def warm_rag_v51_encoders() -> None:
    """
    Touch Pinecone index + dense/BM25/cross-encoder so first RAG request does not
    spend minutes loading weights after HTTP 200 (confusing in logs).
    """
    from backend.rag_v51.encoders import get_bm25_encoder, get_cross_encoder, get_dense_encoder
    from backend.rag_v51.pinecone_index import get_pinecone_index

    print("Loading RAG v5.1 retrieval stack (Pinecone + encoders, warmup)...")
    get_pinecone_index()
    get_dense_encoder()
    get_bm25_encoder()
    get_cross_encoder()
    print("✅ RAG v5.1 retrieval stack ready")
