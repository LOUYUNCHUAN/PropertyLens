"""Environment and paths for rag_v51 (matches 05_propertylens_rag_inference_v51 notebook)."""

from __future__ import annotations

import os
from pathlib import Path


def _repo_root() -> Path:
    p = Path(__file__).resolve()
    for anc in [p.parent, *p.parents]:
        if (anc / "notebooks").is_dir() and (anc / "data").is_dir():
            return anc
    return p.parents[2]


REPO_ROOT = _repo_root()

PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY", "").strip()
PINECONE_INDEX = os.environ.get("PINECONE_INDEX", "propertylens-rag").strip()

NS_TRANSACTIONS = "transactions"
NS_AMENITIES = "amenities"
NS_XAI = "xai"
NS_TRENDS = "trends"

DENSE_MODEL_NAME = os.environ.get("RAG_DENSE_MODEL", "BAAI/bge-m3").strip()
RERANKER_MODEL = os.environ.get("RAG_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3").strip()

_bm25_env = os.environ.get("BM25_CACHE_PATH", "").strip()
BM25_CACHE_PATH = Path(_bm25_env) if _bm25_env else REPO_ROOT / "notebooks" / "05_chatbot" / "bm25_encoder_v3.pkl"

TOP_K_RETRIEVAL = int(os.environ.get("RAG_TOP_K_RETRIEVAL", "20"))
TOP_K_RERANK = int(os.environ.get("RAG_TOP_K_RERANK", "10"))
TOP_K_MMR = int(os.environ.get("RAG_TOP_K_MMR", "5"))
TOP_K_FINAL = int(os.environ.get("RAG_TOP_K_FINAL", "5"))
MMR_LAMBDA = float(os.environ.get("RAG_MMR_LAMBDA", "0.7"))
RRF_K = int(os.environ.get("RAG_RRF_K", "60"))
N_SUBQUERIES = int(os.environ.get("RAG_N_SUBQUERIES", "0"))


def _env_bool(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in ("1", "true", "yes", "on")


ENABLE_LLM_FILTER = _env_bool("RAG_LLM_FILTER", "0")
ENABLE_SUBQUERIES = _env_bool("RAG_SUBQUERIES", "0")
ENABLE_CONTEXTUALIZE = _env_bool("RAG_CONTEXTUALIZE", "1")
ENABLE_CONTEXTUALIZE_LLM = _env_bool("RAG_CONTEXTUALIZE_LLM", "0")

SOURCE_WEIGHTS: dict[str, float] = {
    "transaction": 1.0,
    "amenity": 2.5,
    "trend": 1.0,
    "xai": 2.5,
}

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma3").strip() or "gemma3"
OLLAMA_NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "8192"))
OLLAMA_NUM_PREDICT = int(os.environ.get("OLLAMA_NUM_PREDICT", "1024"))

CROSS_ENCODER_DEVICE = os.environ.get("RAG_CROSS_ENCODER_DEVICE", "cpu").strip() or "cpu"
