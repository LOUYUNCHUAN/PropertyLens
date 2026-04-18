"""Hybrid retrieval, RRF, cross-encoder rerank, MMR — notebook parity."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from backend.rag_v51.config import (
    CROSS_ENCODER_DEVICE,
    ENABLE_LLM_FILTER,
    ENABLE_SUBQUERIES,
    NS_TRANSACTIONS,
    RRF_K,
    SOURCE_WEIGHTS,
    TOP_K_FINAL,
    TOP_K_MMR,
    TOP_K_RERANK,
    TOP_K_RETRIEVAL,
    MMR_LAMBDA,
)
from backend.rag_v51.routing import extract_filters_from_query, generate_subqueries, route_namespaces


def _scale_sparse(sparse: dict, scale: float) -> dict:
    return {"indices": sparse["indices"], "values": [v * scale for v in sparse["values"]]}


def _hybrid_query(
    index,
    query: str,
    alpha: float,
    top_k: int,
    namespace: str,
    metadata_filter: Optional[dict] = None,
) -> list[dict[str, Any]]:
    from backend.rag_v51.encoders import get_bm25_encoder, get_dense_encoder

    dense_encoder = get_dense_encoder()
    bm25_encoder = get_bm25_encoder()
    dense = dense_encoder.encode(query, normalize_embeddings=True).tolist()
    dense = (np.array(dense, dtype=np.float32) * float(alpha)).tolist()
    sparse = bm25_encoder.encode_queries([query])[0]
    sparse = _scale_sparse(sparse, 1.0 - float(alpha))
    res = index.query(
        vector=dense,
        sparse_vector=sparse,
        top_k=int(top_k),
        namespace=namespace,
        include_metadata=True,
        filter=metadata_filter or None,
    )
    matches = res.get("matches") if isinstance(res, dict) else getattr(res, "matches", [])
    return [
        {
            "id": getattr(m, "id", m.get("id")),
            "score": getattr(m, "score", m.get("score")),
            "metadata": getattr(m, "metadata", m.get("metadata", {})),
        }
        for m in (matches or [])
    ]


def retrieve_from_namespace(
    index,
    query: str,
    namespace: str,
    top_k: int,
    metadata_filter: Optional[dict] = None,
) -> tuple[list[dict], list[dict]]:
    dense = _hybrid_query(index, query, alpha=1.0, top_k=top_k, namespace=namespace, metadata_filter=metadata_filter)
    sparse = _hybrid_query(index, query, alpha=0.0, top_k=top_k, namespace=namespace, metadata_filter=metadata_filter)
    return dense, sparse


def reciprocal_rank_fusion(
    ranked_lists: list[list[dict[str, Any]]],
    k: int = 60,
    source_weights: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    weights = source_weights or SOURCE_WEIGHTS
    scores: dict[str, float] = {}
    best: dict[str, dict] = {}
    for lst in ranked_lists:
        for rank, r in enumerate(lst, start=1):
            rid = str(r.get("id", ""))
            if not rid:
                continue
            source = str((r.get("metadata") or {}).get("source", "transaction"))
            weight = weights.get(source, 1.0)
            scores[rid] = scores.get(rid, 0.0) + weight * (1.0 / (float(k) + float(rank)))
            if rid not in best:
                best[rid] = r
    fused = [{**best[rid], "rrf_score": sc} for rid, sc in scores.items()]
    fused.sort(key=lambda x: x.get("rrf_score", 0.0), reverse=True)
    return fused


def multi_query_retrieve(
    query: str,
    index,
    namespaces: list[str],
    top_k: int,
    metadata_filter: dict | None = None,
    *,
    use_subqueries: bool = False,
) -> tuple[list[dict], list[str]]:
    notes: list[str] = []
    if use_subqueries:
        subqs, note = generate_subqueries(query)
        notes.append(note)
        all_queries = [query] + subqs
    else:
        all_queries = [query]
        notes.append("subqueries: disabled (RAG_SUBQUERIES=0)")
    all_lists: list[list[dict]] = []
    for q in all_queries:
        for ns in namespaces:
            filt = metadata_filter if ns == NS_TRANSACTIONS else None
            dense, sparse = retrieve_from_namespace(index, q, ns, top_k, filt)
            all_lists.extend([dense, sparse])
    return reciprocal_rank_fusion(all_lists, k=RRF_K), notes


def _get_text(candidate: dict, field: str = "parent_text") -> str:
    md = candidate.get("metadata") or {}
    return str(md.get(field) or md.get("parent_text") or "")


def rerank_cross_encoder(
    query: str,
    candidates: list[dict[str, Any]],
    tokenizer: Any,
    model: Any,
    top_k: int,
    device: str,
) -> list[dict[str, Any]]:
    from backend.rag_v51.encoders import torch_module

    if not candidates:
        return []
    pairs = [(query, _get_text(c)) for c in candidates]
    inputs = tokenizer(pairs, padding=True, truncation=True, max_length=512, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}
    torch = torch_module()
    with torch.no_grad():
        logits = model(**inputs).logits.squeeze(-1).tolist()
    if isinstance(logits, float):
        logits = [logits]
    scored = [{**c, "ce_score": float(s)} for c, s in zip(candidates, logits)]
    scored.sort(key=lambda x: x["ce_score"], reverse=True)
    return scored[:top_k]


def _cosine(u: np.ndarray, v: np.ndarray) -> float:
    denom = np.linalg.norm(u) * np.linalg.norm(v)
    return float(np.dot(u, v) / denom) if denom > 1e-12 else 0.0


def mmr_filter(
    candidates: list[dict[str, Any]],
    query: str,
    top_k: int,
    lambda_param: float = 0.7,
) -> list[dict[str, Any]]:
    from backend.rag_v51.encoders import get_dense_encoder

    if not candidates:
        return []
    dense_encoder = get_dense_encoder()
    texts = [_get_text(c) for c in candidates]
    doc_emb = np.asarray(dense_encoder.encode(texts, normalize_embeddings=True), dtype=np.float32)
    selected: list[int] = []
    remaining: list[int] = list(range(len(candidates)))
    best0 = int(np.argmax([c.get("ce_score", -1e9) for c in candidates]))
    selected.append(best0)
    remaining.remove(best0)
    while remaining and len(selected) < int(top_k):
        best_idx, best_val = None, -1e18
        for i in remaining:
            rel = float(candidates[i].get("ce_score", 0.0))
            max_sim = max(_cosine(doc_emb[i], doc_emb[j]) for j in selected)
            score = lambda_param * rel - (1.0 - lambda_param) * max_sim
            if score > best_val:
                best_val, best_idx = score, i
        if best_idx is None:
            break
        selected.append(best_idx)
        remaining.remove(best_idx)
    return [candidates[i] for i in selected]


def reorder_for_context_window(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(candidates) <= 2:
        return list(candidates)
    ordered = sorted(
        candidates,
        key=lambda x: x.get("ce_score", x.get("rrf_score", 0.0)),
        reverse=True,
    )
    return [ordered[0], *ordered[2:], ordered[1]]


def retrieve_and_rerank(
    query: str, index, verbose: bool = False
) -> tuple[list[dict], list[str]]:
    """Returns (final_chunks, log_notes). Notes are emitted as [LOG] events
    by the caller so the UI can see which optional stages actually ran.
    """
    from backend.rag_v51.encoders import get_cross_encoder

    _ = verbose
    notes: list[str] = []

    metadata_filter = None
    if ENABLE_LLM_FILTER:
        metadata_filter, note = extract_filters_from_query(query)
        notes.append(note)
    else:
        notes.append("filter_extract: disabled (RAG_LLM_FILTER=0)")

    namespaces = route_namespaces(query)
    notes.append(f"namespaces: {namespaces}")

    fused, sq_notes = multi_query_retrieve(
        query=query,
        index=index,
        namespaces=namespaces,
        top_k=TOP_K_RETRIEVAL,
        metadata_filter=metadata_filter,
        use_subqueries=ENABLE_SUBQUERIES,
    )
    notes.extend(sq_notes)
    notes.append(f"rrf_fused: {len(fused)} candidates")

    ce_tokenizer, ce_model = get_cross_encoder()

    reranked = rerank_cross_encoder(
        query=query,
        candidates=fused[:TOP_K_RETRIEVAL],
        tokenizer=ce_tokenizer,
        model=ce_model,
        top_k=TOP_K_RERANK,
        device=CROSS_ENCODER_DEVICE,
    )
    notes.append(f"rerank: top {len(reranked)} via cross-encoder")

    diverse = mmr_filter(
        candidates=reranked,
        query=query,
        top_k=TOP_K_MMR,
        lambda_param=MMR_LAMBDA,
    )

    final = reorder_for_context_window(diverse)[:TOP_K_FINAL]
    return final, notes
