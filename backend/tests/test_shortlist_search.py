"""Unit tests for shortlist NL plan application (no Ollama)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from backend.shortlist_plan_apply import apply_plan, merge_nl_constraint_overrides


def _feat(
    id_: int,
    *,
    town: str = "BEDOK",
    street: str = "BEDOK NORTH ST 1",
    addr: str = "BLK 123 BEDOK NORTH ST 1 SINGAPORE",
    mrt: float | None = 400,
    hwy: float | None = 600,
    smart: int = 70,
) -> dict:
    return {
        "id": id_,
        "town": town,
        "street": street,
        "address": addr,
        "nearest_mrt_m": mrt,
        "nearest_highway_m": hwy,
        "smart_score": smart,
        "created_ts": datetime(2026, 1, 1, tzinfo=timezone.utc),
    }


class TestApplyPlan(unittest.TestCase):
    def test_filter_town_bedok(self) -> None:
        feats = [_feat(1, town="BEDOK"), _feat(2, town="TAMPINES")]
        plan = {"area": {"town": "BEDOK"}, "constraints": {}, "sort": "created_at_desc"}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])

    def test_mrt_max_sort(self) -> None:
        feats = [
            _feat(1, mrt=900),
            _feat(2, mrt=400),
        ]
        plan = {
            "area": {},
            "constraints": {"mrt_max_dist_m": 800},
            "sort": "nearest_mrt_asc",
        }
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_highway_min_and_sort_desc(self) -> None:
        feats = [
            _feat(1, hwy=200),
            _feat(2, hwy=800),
            _feat(3, hwy=500),
        ]
        plan = {
            "area": {},
            "constraints": {"highway_min_dist_m": 400},
            "sort": "nearest_highway_desc",
        }
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2, 3])

    def test_bedok_north_street(self) -> None:
        feats = [
            _feat(1, street="FOO ROAD", town="BEDOK", addr="BLK 1 FOO ROAD"),
            _feat(2, street="BEDOK NORTH AVE 1", town="BEDOK", addr="BLK 2 BEDOK NORTH AVE 1"),
        ]
        plan = {
            "area": {"town": "BEDOK", "street_contains": "BEDOK NORTH"},
            "constraints": {},
            "sort": "created_at_desc",
        }
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_merge_nl_overrides_mrt(self) -> None:
        plan = {
            "area": {"town": "HOUGANG"},
            "constraints": {"mrt_max_dist_m": 800},
            "sort": "nearest_mrt_asc",
        }
        merged = merge_nl_constraint_overrides(plan, mrt_max_dist_m=1500)
        self.assertEqual(merged["constraints"]["mrt_max_dist_m"], 1500)
        self.assertEqual(merged["area"]["town"], "HOUGANG")


if __name__ == "__main__":
    unittest.main()
