"""Tests for backend.rag_v51.contextualize — slot-based follow-up rewrite."""

from __future__ import annotations

import importlib
import os
import unittest
from unittest.mock import patch


def _reload_contextualize():
    """Re-import config + contextualize so env changes take effect."""
    from backend.rag_v51 import config, contextualize

    importlib.reload(config)
    importlib.reload(contextualize)
    return contextualize


class TestExtractSlots(unittest.TestCase):
    def test_picks_up_town_from_assistant_turn(self) -> None:
        from backend.rag_v51.contextualize import extract_slots

        history = [
            {"role": "user", "content": "what amenities are near Bedok North?"},
            {
                "role": "assistant",
                "content": "Bedok North has hawker centres and an MRT in BEDOK.",
            },
        ]
        slots = extract_slots(history)
        self.assertEqual(slots.get("town"), "BEDOK")

    def test_picks_up_flat_type(self) -> None:
        from backend.rag_v51.contextualize import extract_slots

        history = [
            {"role": "assistant", "content": "Your 4-ROOM flat in TAMPINES is ~$580k."},
        ]
        slots = extract_slots(history)
        self.assertEqual(slots.get("town"), "TAMPINES")
        self.assertEqual(slots.get("flat_type"), "4 ROOM")

    def test_most_recent_wins(self) -> None:
        from backend.rag_v51.contextualize import extract_slots

        history = [
            {"role": "user", "content": "tell me about BEDOK"},
            {"role": "assistant", "content": "BEDOK is a mature estate."},
            {"role": "user", "content": "what about TAMPINES?"},
            {"role": "assistant", "content": "TAMPINES is also mature."},
        ]
        slots = extract_slots(history)
        self.assertEqual(slots.get("town"), "TAMPINES")

    def test_empty_history(self) -> None:
        from backend.rag_v51.contextualize import extract_slots

        self.assertEqual(extract_slots([]), {})
        self.assertEqual(extract_slots(None), {})  # type: ignore[arg-type]


class TestLooksLikeFollowup(unittest.TestCase):
    def test_no_slots_never_followup(self) -> None:
        from backend.rag_v51.contextualize import looks_like_followup

        self.assertFalse(looks_like_followup("best schools in this area", {}))

    def test_short_message_is_followup(self) -> None:
        from backend.rag_v51.contextualize import looks_like_followup

        self.assertTrue(looks_like_followup("any schools?", {"town": "BEDOK"}))

    def test_anaphora_is_followup(self) -> None:
        from backend.rag_v51.contextualize import looks_like_followup

        self.assertTrue(
            looks_like_followup("best schools in this area please", {"town": "BEDOK"})
        )

    def test_explicit_different_town_not_followup(self) -> None:
        from backend.rag_v51.contextualize import looks_like_followup

        self.assertFalse(
            looks_like_followup("best schools in TAMPINES please", {"town": "BEDOK"})
        )


class TestRewriteWithSlots(unittest.TestCase):
    def test_this_area_substitution(self) -> None:
        from backend.rag_v51.contextualize import rewrite_with_slots

        out = rewrite_with_slots("best schools in this area", {"town": "BEDOK"})
        self.assertIn("BEDOK", out)
        self.assertNotIn("this area", out)

    def test_there_here_substitution(self) -> None:
        from backend.rag_v51.contextualize import rewrite_with_slots

        out = rewrite_with_slots("what trends there?", {"town": "TAMPINES"})
        self.assertIn("TAMPINES", out)
        self.assertNotIn(" there", out.lower())

    def test_append_when_missing(self) -> None:
        from backend.rag_v51.contextualize import rewrite_with_slots

        out = rewrite_with_slots("any schools?", {"town": "BEDOK"})
        self.assertIn("BEDOK", out)

    def test_no_town_returns_unchanged(self) -> None:
        from backend.rag_v51.contextualize import rewrite_with_slots

        self.assertEqual(rewrite_with_slots("hi", {}), "hi")


class TestContextualizeQuery(unittest.TestCase):
    def test_followup_rewrite_this_area(self) -> None:
        from backend.rag_v51.contextualize import contextualize_query

        history = [
            {"role": "user", "content": "what amenities are near Bedok North?"},
            {"role": "assistant", "content": "Bedok North amenities in BEDOK..."},
        ]
        out, notes = contextualize_query("best schools in this area", history)
        self.assertIn("BEDOK", out)
        self.assertNotIn("this area", out)
        self.assertTrue(any("BEDOK" in n for n in notes))

    def test_standalone_query_unchanged(self) -> None:
        from backend.rag_v51.contextualize import contextualize_query

        history = [{"role": "assistant", "content": "pricing info in BEDOK"}]
        out, notes = contextualize_query("best schools in TAMPINES", history)
        self.assertEqual(out, "best schools in TAMPINES")
        self.assertTrue(any("standalone" in n for n in notes))

    def test_empty_history_no_rewrite(self) -> None:
        from backend.rag_v51.contextualize import contextualize_query

        out, _ = contextualize_query("best schools in this area", [])
        self.assertEqual(out, "best schools in this area")

    def test_flag_off_disables(self) -> None:
        with patch.dict(os.environ, {"RAG_CONTEXTUALIZE": "0"}, clear=False):
            ctx = _reload_contextualize()
            history = [{"role": "assistant", "content": "in BEDOK"}]
            out, notes = ctx.contextualize_query("best schools in this area", history)
            self.assertEqual(out, "best schools in this area")
            self.assertTrue(any("disabled" in n for n in notes))
        # Restore default-on state for any later tests.
        with patch.dict(os.environ, {"RAG_CONTEXTUALIZE": "1"}, clear=False):
            _reload_contextualize()


if __name__ == "__main__":
    unittest.main()
