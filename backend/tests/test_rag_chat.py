"""Tests for /api/rag-chat — mocked retrieval and generation (no Pinecone/Ollama)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.rag_v51.prompts import MAX_CHUNK_CHARS, build_rag_prompt


class TestBuildRagPrompt(unittest.TestCase):
    def test_tool_sections(self) -> None:
        chunks = [{"metadata": {"parent_text": "ctx", "source": "transaction", "town": "X"}}]
        p = build_rag_prompt(
            "q?",
            chunks,
            prediction_result="pred",
            shortlist_context="sl",
            cbr_context="cbr",
            shap_context="shap",
        )
        self.assertIn("## Model prediction", p)
        self.assertIn("## User shortlist", p)
        self.assertIn("## Similar past transactions (CBR)", p)
        self.assertIn("## Local SHAP explanation", p)
        self.assertIn("## Question", p)

    def test_oversized_chunk_is_truncated(self) -> None:
        long_text = "x" * (MAX_CHUNK_CHARS + 500)
        chunks = [{"metadata": {"parent_text": long_text, "source": "xai", "town": "BEDOK"}}]
        p = build_rag_prompt("q?", chunks)
        self.assertIn("[truncated]", p)
        self.assertNotIn("x" * (MAX_CHUNK_CHARS + 1), p)


class TestRagChatEndpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from backend.rag_chat import router as rag_chat_router

        mini = FastAPI()
        mini.include_router(rag_chat_router, prefix="/api")
        cls.client = TestClient(mini)

    @patch("backend.rag_v51.generate.stream_rag_answer")
    @patch("backend.rag_v51.retrieve.retrieve_and_rerank")
    @patch("backend.rag_v51.pinecone_index.get_pinecone_index")
    def test_sse_shape_and_done(
        self,
        mock_idx: MagicMock,
        mock_ret: MagicMock,
        mock_stream: MagicMock,
    ) -> None:
        mock_idx.return_value = object()
        mock_ret.return_value = (
            [{"metadata": {"parent_text": "hello", "source": "transaction", "town": "TAMPINES"}}],
            ["namespaces: ['hdb-transactions']"],
        )
        mock_stream.return_value = iter(["ok", " answer"])

        env = {
            "PINECONE_API_KEY": "test",
            "RAG_V51_ENABLED": "1",
        }
        with patch.dict(os.environ, env, clear=False):
            res = self.client.post(
                "/api/rag-chat",
                json={"message": "What is HDB pricing like?", "history": []},
            )
        self.assertEqual(res.status_code, 200)
        raw = res.text
        self.assertIn("data: ", raw)
        self.assertIn("[DONE]", raw)
        self.assertIn("[SOURCES]", raw)

    def test_disabled_returns_503(self) -> None:
        env = {
            "RAG_V51_ENABLED": "0",
            "PINECONE_API_KEY": "test",
        }
        with patch.dict(os.environ, env, clear=False):
            res = self.client.post(
                "/api/rag-chat",
                json={"message": "hi", "history": []},
            )
        self.assertEqual(res.status_code, 503)


if __name__ == "__main__":
    unittest.main()
