"""Stream answers from Ollama or Gemini (same framing as /api/chat)."""

from __future__ import annotations

import json
import os
from typing import Iterator, List

import requests

from backend.rag_v51.config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_NUM_CTX,
    OLLAMA_NUM_PREDICT,
)
from backend.rag_v51.prompts import build_rag_prompt, build_system_prompt


def _build_messages(
    query: str,
    history: List[dict],
    context_chunks: list[dict],
    prediction_result: str = "",
    shortlist_context: str = "",
    cbr_context: str = "",
    shap_context: str = "",
) -> list[dict]:
    user_content = build_rag_prompt(
        query,
        context_chunks,
        prediction_result=prediction_result,
        shortlist_context=shortlist_context,
        cbr_context=cbr_context,
        shap_context=shap_context,
    )
    messages: list[dict] = [{"role": "system", "content": build_system_prompt()}]
    for msg in history[-6:]:
        role = "user" if msg.get("role") == "user" else "assistant"
        content = (msg.get("content") or "").strip()
        if content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_content})
    return messages


def _stream_ollama(
    messages: list[dict],
    *,
    finish_info: dict | None = None,
) -> Iterator[str]:
    # Pre-flight: fail fast if Ollama isn't reachable. Without this, the
    # streaming POST waits the full 180 s before surfacing a connection error.
    try:
        requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=2).raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(
            f"Ollama not reachable at {OLLAMA_BASE_URL} — is `ollama serve` running? ({e})"
        ) from e

    url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": 0.3,
            "num_predict": OLLAMA_NUM_PREDICT,
            "num_ctx": OLLAMA_NUM_CTX,
        },
    }
    with requests.post(url, json=payload, stream=True, timeout=180) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = data.get("message") or {}
            piece = msg.get("content") or ""
            if piece:
                yield piece
            if data.get("done"):
                if finish_info is not None:
                    finish_info["reason"] = data.get("done_reason")
                    finish_info["output_tokens"] = data.get("eval_count")
                    finish_info["input_tokens"] = data.get("prompt_eval_count")
                break


def _gemini_available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def _stream_gemini(
    messages: list[dict],
    *,
    finish_info: dict | None = None,
) -> Iterator[str]:
    """Stream a response from Gemini 2.5 Flash. Uses the messages array built
    for Ollama: flattens the system + user turns into Gemini's
    role/parts history + final user content shape."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")

    import google.generativeai as genai

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
        or "gemini-2.5-flash",
        generation_config=genai.GenerationConfig(
            temperature=0.3,
            max_output_tokens=1024,
        ),
    )

    system_text = ""
    gem_history: list[dict] = []
    final_user = ""
    for m in messages:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if not content:
            continue
        if role == "system":
            system_text = content
            continue
        if role in ("user", "assistant"):
            gem_history.append(
                {"role": "user" if role == "user" else "model", "parts": [content]}
            )

    if gem_history and gem_history[-1]["role"] == "user":
        final_user = gem_history.pop()["parts"][0]
    else:
        final_user = messages[-1].get("content") or ""

    session = model.start_chat(history=gem_history)
    prompt = f"{system_text}\n\n{final_user}" if system_text else final_user
    response = session.send_message(prompt, stream=True)
    last_chunk = None
    for chunk in response:
        last_chunk = chunk
        text = getattr(chunk, "text", "") or ""
        if text:
            yield text
    if finish_info is not None and last_chunk is not None:
        try:
            cand = (getattr(last_chunk, "candidates", None) or [None])[0]
            reason = getattr(cand, "finish_reason", None)
            finish_info["reason"] = (
                reason.name if hasattr(reason, "name") else str(reason) if reason else None
            )
            usage = getattr(last_chunk, "usage_metadata", None)
            if usage is not None:
                finish_info["input_tokens"] = getattr(usage, "prompt_token_count", None)
                finish_info["output_tokens"] = getattr(usage, "candidates_token_count", None)
        except Exception:
            pass


def stream_rag_answer(
    query: str,
    history: List[dict],
    context_chunks: list[dict],
    *,
    prediction_result: str = "",
    shortlist_context: str = "",
    cbr_context: str = "",
    shap_context: str = "",
    provider: str = "ollama",
    finish_info: dict | None = None,
) -> Iterator[str]:
    messages = _build_messages(
        query,
        history,
        context_chunks,
        prediction_result=prediction_result,
        shortlist_context=shortlist_context,
        cbr_context=cbr_context,
        shap_context=shap_context,
    )
    provider = (provider or "ollama").lower()
    if provider == "gemini":
        if not _gemini_available():
            raise RuntimeError("Gemini selected but GEMINI_API_KEY is not set in .env")
        yield from _stream_gemini(messages, finish_info=finish_info)
        return
    yield from _stream_ollama(messages, finish_info=finish_info)
