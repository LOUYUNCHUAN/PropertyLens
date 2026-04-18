"""Lazy-loaded dense encoder, BM25, and cross-encoder (heavy)."""

from __future__ import annotations

import pickle
import threading
from typing import Any, Tuple

from pinecone_text.sparse import BM25Encoder
from sentence_transformers import SentenceTransformer
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from backend.rag_v51.config import (
    BM25_CACHE_PATH,
    CROSS_ENCODER_DEVICE,
    DENSE_MODEL_NAME,
    RERANKER_MODEL,
)

_lock = threading.Lock()
_dense_encoder: SentenceTransformer | None = None
_bm25_encoder: BM25Encoder | None = None
_ce_tokenizer: Any = None
_ce_model: Any = None


def get_dense_encoder() -> SentenceTransformer:
    global _dense_encoder
    with _lock:
        if _dense_encoder is None:
            _dense_encoder = SentenceTransformer(DENSE_MODEL_NAME)
    return _dense_encoder


def load_bm25_from_cache(cache_path) -> BM25Encoder:
    if not cache_path.exists():
        raise FileNotFoundError(
            f"BM25 cache not found: {cache_path}\n"
            "Run Notebook A (04_propertylens_build_index) or place bm25_encoder_v3.pkl under notebooks/05_chatbot/."
        )
    with cache_path.open("rb") as f:
        return pickle.load(f)


def get_bm25_encoder() -> BM25Encoder:
    global _bm25_encoder
    with _lock:
        if _bm25_encoder is None:
            _bm25_encoder = load_bm25_from_cache(BM25_CACHE_PATH)
    return _bm25_encoder


def load_cross_encoder(model_name: str, device: str) -> Tuple[Any, Any]:
    tok = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name)
    model.to(device)
    model.eval()
    return tok, model


def get_cross_encoder() -> Tuple[Any, Any]:
    global _ce_tokenizer, _ce_model
    with _lock:
        if _ce_tokenizer is None or _ce_model is None:
            _ce_tokenizer, _ce_model = load_cross_encoder(RERANKER_MODEL, CROSS_ENCODER_DEVICE)
    return _ce_tokenizer, _ce_model


def torch_module():
    return torch
