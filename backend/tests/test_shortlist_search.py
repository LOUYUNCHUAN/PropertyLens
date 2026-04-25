"""Unit tests for shortlist NL plan application (no Ollama)."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from backend.shortlist_plan_apply import (
    apply_plan,
    merge_nl_constraint_overrides,
    normalize_plan,
)


def _feat(
    id_: int,
    *,
    town: str = "BEDOK",
    street: str = "BEDOK NORTH ST 1",
    addr: str = "BLK 123 BEDOK NORTH ST 1 SINGAPORE",
    flat_type: str | None = "4 ROOM",
    floor_area: float | None = 95.0,
    storey_mid: float | None = 8.0,
    lease: float | None = 75.0,
    listing_price: float | None = 620_000.0,
    predicted_price: float | None = 650_000.0,
    vs_model_pct: float | None = None,
    mrt: float | None = 400,
    hwy: float | None = 600,
    school: float | None = 350,
    school_tier: str | None = "medium",
    hawker: float | None = 500,
    mall: float | None = 900,
    smart: int = 70,
    created: datetime | None = None,
) -> dict:
    if vs_model_pct is None and listing_price is not None and predicted_price:
        vs_model_pct = (listing_price - predicted_price) / predicted_price * 100.0
    return {
        "id": id_,
        "town": town,
        "street": street,
        "address": addr,
        "flat_type": flat_type,
        "floor_area_sqm": floor_area,
        "storey_mid": storey_mid,
        "remaining_lease_years": lease,
        "listing_price": listing_price,
        "predicted_price": predicted_price,
        "vs_model_pct": vs_model_pct,
        "nearest_mrt_m": mrt,
        "nearest_highway_m": hwy,
        "nearest_school_m": school,
        "nearest_school_tier": school_tier,
        "nearest_hawker_m": hawker,
        "nearest_mall_m": mall,
        "smart_score": smart,
        "created_ts": created or datetime(2026, 1, 1, tzinfo=timezone.utc),
    }


class TestLegacyPlanBackwardCompat(unittest.TestCase):
    """Original plan shape must still work."""

    def test_filter_town_bedok_legacy(self) -> None:
        feats = [_feat(1, town="BEDOK"), _feat(2, town="TAMPINES")]
        plan = {"area": {"town": "BEDOK"}, "constraints": {}, "sort": "created_at_desc"}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])

    def test_mrt_max_sort_legacy(self) -> None:
        feats = [_feat(1, mrt=900), _feat(2, mrt=400)]
        plan = {"area": {}, "constraints": {"mrt_max_dist_m": 800}, "sort": "nearest_mrt_asc"}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_highway_min_and_sort_desc_legacy(self) -> None:
        feats = [_feat(1, hwy=200), _feat(2, hwy=800), _feat(3, hwy=500)]
        plan = {"area": {}, "constraints": {"highway_min_dist_m": 400}, "sort": "nearest_highway_desc"}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2, 3])

    def test_bedok_north_street_legacy(self) -> None:
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

    def test_merge_nl_overrides_legacy(self) -> None:
        plan = {
            "area": {"town": "HOUGANG"},
            "constraints": {"mrt_max_dist_m": 800},
            "sort": "nearest_mrt_asc",
        }
        merged = merge_nl_constraint_overrides(plan, mrt_max_dist_m=1500)
        self.assertEqual(merged["proximity"]["mrt_max_dist_m"], 1500)
        self.assertEqual(merged["area"]["towns"], ["HOUGANG"])

    def test_normalize_legacy_to_canonical(self) -> None:
        legacy = {
            "area": {"town": "BEDOK", "street_contains": "north"},
            "constraints": {"mrt_max_dist_m": 800, "highway_min_dist_m": 400},
            "sort": "smart_score_desc",
        }
        norm = normalize_plan(legacy)
        self.assertEqual(norm["area"]["towns"], ["BEDOK"])
        self.assertEqual(norm["area"]["street_contains"], "NORTH")
        self.assertEqual(norm["proximity"]["mrt_max_dist_m"], 800.0)
        self.assertEqual(norm["proximity"]["highway_min_dist_m"], 400.0)
        self.assertEqual(norm["sort"], [{"key": "smart_score", "dir": "desc"}])


class TestPriceFilters(unittest.TestCase):
    def test_price_max_filters_out(self) -> None:
        feats = [_feat(1, listing_price=580_000), _feat(2, listing_price=720_000)]
        plan = {"price": {"max": 650_000}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])

    def test_price_range_between(self) -> None:
        feats = [
            _feat(1, listing_price=500_000),
            _feat(2, listing_price=650_000),
            _feat(3, listing_price=850_000),
        ]
        plan = {"price": {"min": 600_000, "max": 800_000}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_vs_model_pct_max_filter(self) -> None:
        feats = [
            _feat(1, listing_price=600_000, predicted_price=650_000),  # -7.7%
            _feat(2, listing_price=680_000, predicted_price=650_000),  # +4.6%
        ]
        plan = {"price": {"vs_model_pct_max": -5}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])


class TestUnitFilters(unittest.TestCase):
    def test_flat_type_filter(self) -> None:
        feats = [_feat(1, flat_type="3 ROOM"), _feat(2, flat_type="4 ROOM"), _feat(3, flat_type="5 ROOM")]
        plan = {"unit": {"flat_types": ["4 ROOM", "5 ROOM"]}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(sorted(ids), [2, 3])

    def test_floor_area_min(self) -> None:
        feats = [_feat(1, floor_area=75), _feat(2, floor_area=110)]
        plan = {"unit": {"floor_area_min_sqm": 90}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_storey_min(self) -> None:
        feats = [_feat(1, storey_mid=3), _feat(2, storey_mid=14)]
        plan = {"unit": {"storey_min": 10}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])

    def test_lease_min(self) -> None:
        feats = [_feat(1, lease=65), _feat(2, lease=85)]
        plan = {"unit": {"lease_min_years": 80}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])


class TestProximityFilters(unittest.TestCase):
    def test_school_max_dist(self) -> None:
        feats = [_feat(1, school=250), _feat(2, school=900)]
        plan = {"proximity": {"school_max_dist_m": 500}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])

    def test_school_min_tier_filters_lower(self) -> None:
        feats = [
            _feat(1, school_tier="low"),
            _feat(2, school_tier="medium"),
            _feat(3, school_tier="high"),
        ]
        plan = {"proximity": {"school_min_tier": "medium"}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(sorted(ids), [2, 3])

    def test_hawker_max_dist(self) -> None:
        feats = [_feat(1, hawker=400), _feat(2, hawker=1200)]
        plan = {"proximity": {"hawker_max_dist_m": 800}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])

    def test_mall_max_dist(self) -> None:
        feats = [_feat(1, mall=500), _feat(2, mall=1500)]
        plan = {"proximity": {"mall_max_dist_m": 1000}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [1])


class TestMissingDataIsUnknown(unittest.TestCase):
    """Missing data must keep the row (with 'unknown' tag), NOT drop it silently."""

    def test_missing_mrt_is_kept_with_unknown(self) -> None:
        feats = [_feat(1, mrt=None), _feat(2, mrt=400)]
        plan = {"proximity": {"mrt_max_dist_m": 800}}
        ids, notes = apply_plan(feats, plan)
        self.assertEqual(sorted(ids), [1, 2])
        tag_by_id = {n["id"]: n.get("unknown", []) for n in notes}
        self.assertIn("nearest_mrt", tag_by_id[1])
        self.assertEqual(tag_by_id[2], [])

    def test_missing_highway_is_kept_with_unknown(self) -> None:
        feats = [_feat(1, hwy=None), _feat(2, hwy=800)]
        plan = {"proximity": {"highway_min_dist_m": 500}}
        ids, notes = apply_plan(feats, plan)
        self.assertEqual(sorted(ids), [1, 2])
        tag_by_id = {n["id"]: n.get("unknown", []) for n in notes}
        self.assertIn("nearest_highway", tag_by_id[1])

    def test_present_but_failing_data_is_dropped(self) -> None:
        feats = [_feat(1, mrt=2000), _feat(2, mrt=300)]
        plan = {"proximity": {"mrt_max_dist_m": 800}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2])


class TestMultiSort(unittest.TestCase):
    def test_compound_sort_smart_then_mrt(self) -> None:
        feats = [
            _feat(1, smart=80, mrt=700),
            _feat(2, smart=80, mrt=400),  # tied smart, closer MRT → ranks first
            _feat(3, smart=90, mrt=900),  # best smart → ranks first overall
        ]
        plan = {
            "sort": [
                {"key": "smart_score", "dir": "desc"},
                {"key": "nearest_mrt", "dir": "asc"},
            ]
        }
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [3, 2, 1])

    def test_missing_sort_value_goes_last(self) -> None:
        feats = [_feat(1, mrt=None), _feat(2, mrt=500), _feat(3, mrt=900)]
        plan = {"sort": [{"key": "nearest_mrt", "dir": "asc"}]}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(ids, [2, 3, 1])


class TestLimit(unittest.TestCase):
    def test_limit_caps_results(self) -> None:
        feats = [_feat(i, smart=100 - i) for i in range(1, 11)]
        plan = {"sort": [{"key": "smart_score", "dir": "desc"}], "limit": 3}
        ids, notes = apply_plan(feats, plan)
        self.assertEqual(ids, [1, 2, 3])
        self.assertEqual(len(notes), 3)


class TestMultiTownAndFlatType(unittest.TestCase):
    def test_towns_list_matches_any(self) -> None:
        feats = [
            _feat(1, town="BEDOK"),
            _feat(2, town="TAMPINES"),
            _feat(3, town="HOUGANG"),
        ]
        plan = {"area": {"towns": ["BEDOK", "TAMPINES"]}}
        ids, _ = apply_plan(feats, plan)
        self.assertEqual(sorted(ids), [1, 2])


if __name__ == "__main__":
    unittest.main()
