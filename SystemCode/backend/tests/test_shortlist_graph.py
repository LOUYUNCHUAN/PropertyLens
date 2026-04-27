"""Tests for the Neo4j shortlist projection layer (no live driver required)."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from backend import shortlist_graph as sg


# ---------- pure helpers (no I/O) ----------------------------------------


def test_compute_address_key_canonicalises_block_and_street():
    # Already-abbreviated input passes through untouched
    assert sg._compute_address_key({"block": "201", "street_name": "Tampines St 21"}) == "201 TAMPINES ST 21"


def test_compute_address_key_abbreviates_street_suffixes():
    # Spelled-out STREET → ST so saves match the graph's address_key form
    assert (
        sg._compute_address_key({"block": " 864 ", "street_name": "  TAMPINES   STREET   83 "})
        == "864 TAMPINES ST 83"
    )
    # AVENUE → AVE
    assert (
        sg._compute_address_key({"block": "578", "street_name": "Hougang Avenue 4"})
        == "578 HOUGANG AVE 4"
    )
    # ROAD → RD, multi-word street name preserved
    assert (
        sg._compute_address_key({"block": "43", "street_name": "Bedok South Road"})
        == "43 BEDOK STH RD"
    )


def test_compute_address_key_returns_none_when_missing():
    assert sg._compute_address_key({"town": "BISHAN"}) is None
    assert sg._compute_address_key({"block": "201"}) is None
    assert sg._compute_address_key({"street_name": "Sin Ming Rd"}) is None
    assert sg._compute_address_key(None) is None
    assert sg._compute_address_key({}) is None


def test_row_to_projection_params_extracts_expected_fields():
    row = SimpleNamespace(
        id=42,
        username="USER",
        listing_url="https://example/listing",
        listing_price=580000.0,
        predicted_price=562000.0,
        source="extension",
        created_at=datetime(2026, 4, 15, 10, 30, 0),
        payload_json={
            "block": "201",
            "street_name": "Tampines St 21",
            "town": "TAMPINES",
            "flat_type": "4 ROOM",
        },
    )
    params = sg._row_to_projection_params(row)
    assert params == {
        "username": "user",
        "sql_id": 42,
        "listing_url": "https://example/listing",
        "listing_price": 580000.0,
        "predicted_price": 562000.0,
        "town": "TAMPINES",
        "flat_type": "4 ROOM",
        "address_key": "201 TAMPINES ST 21",  # 'St' already abbreviated; passes through
        "created_at_iso": "2026-04-15T10:30:00",
        "source": "extension",
    }


def test_row_to_projection_params_handles_missing_address():
    row = SimpleNamespace(
        id=7, username="rekha", listing_url=None, listing_price=None,
        predicted_price=400000.0, source="buyer", created_at=None,
        payload_json={"town": "BISHAN", "flat_type": "3 ROOM"},
    )
    params = sg._row_to_projection_params(row)
    assert params["address_key"] is None
    assert params["created_at_iso"] is None
    assert params["listing_price"] is None


# ---------- mock the Neo4j driver ---------------------------------------


def _mock_driver_capturing_runs(run_side_effect=None):
    """Return (driver_mock, session_mock, run_mock). run_mock captures every call."""
    session_mock = MagicMock()
    if run_side_effect is not None:
        session_mock.run.side_effect = run_side_effect
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session_mock
    session_cm.__exit__.return_value = False
    driver_mock = MagicMock()
    driver_mock.session.return_value = session_cm
    return driver_mock, session_mock


def test_project_shortlist_item_emits_user_then_item_cypher():
    row = SimpleNamespace(
        id=11, username="user", listing_url=None, listing_price=600000.0,
        predicted_price=590000.0, source="buyer",
        created_at=datetime(2026, 4, 1, 12, 0, 0),
        payload_json={"block": "201", "street_name": "Tampines St 21",
                      "town": "TAMPINES", "flat_type": "4 ROOM"},
    )
    driver_mock, session_mock = _mock_driver_capturing_runs()
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        ok = sg.project_shortlist_item(row)
    assert ok is True
    assert session_mock.run.call_count == 2
    # First call: MERGE_USER with the username param
    user_call = session_mock.run.call_args_list[0]
    assert user_call.args[0] == sg._CYPHER_MERGE_USER
    assert user_call.kwargs == {"username": "user"}
    # Second call: MERGE_ITEM with the full param dict
    item_call = session_mock.run.call_args_list[1]
    assert item_call.args[0] == sg._CYPHER_MERGE_ITEM
    assert item_call.kwargs["sql_id"] == 11
    assert item_call.kwargs["address_key"] == "201 TAMPINES ST 21"
    assert item_call.kwargs["town"] == "TAMPINES"
    driver_mock.close.assert_called_once()


def test_project_shortlist_item_returns_false_on_neo4j_failure():
    row = SimpleNamespace(
        id=12, username="user", listing_url=None, listing_price=None,
        predicted_price=500000.0, source="buyer",
        created_at=datetime(2026, 4, 1, 12, 0, 0),
        payload_json={"block": "1", "street_name": "Lor Lew Lian", "town": "SERANGOON", "flat_type": "3 ROOM"},
    )
    driver_mock, _ = _mock_driver_capturing_runs(run_side_effect=RuntimeError("AuraDB down"))
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        ok = sg.project_shortlist_item(row)
    assert ok is False
    driver_mock.close.assert_called_once()


def test_project_shortlist_item_returns_false_when_driver_unavailable():
    row = SimpleNamespace(
        id=13, username="user", listing_url=None, listing_price=None,
        predicted_price=400000.0, source="buyer",
        created_at=datetime(2026, 4, 1, 12, 0, 0),
        payload_json={"block": "1", "street_name": "X", "town": "BEDOK", "flat_type": "3 ROOM"},
    )
    with patch.object(sg, "_neo4j_driver", side_effect=sg.ShortlistGraphUnavailable("creds missing")):
        ok = sg.project_shortlist_item(row)
    assert ok is False


def test_delete_shortlist_item_runs_detach_delete():
    driver_mock, session_mock = _mock_driver_capturing_runs()
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        ok = sg.delete_shortlist_item(42)
    assert ok is True
    session_mock.run.assert_called_once_with(sg._CYPHER_DELETE_ITEM, sql_id=42)
    driver_mock.close.assert_called_once()


def test_fetch_user_shortlist_graph_raises_unavailable_on_driver_error():
    driver_mock, _ = _mock_driver_capturing_runs(run_side_effect=RuntimeError("connection reset"))
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        with pytest.raises(sg.ShortlistGraphUnavailable):
            sg.fetch_user_shortlist_graph("user")


def test_fetch_user_shortlist_graph_returns_dict_rows():
    fake_records = [
        {"sql_id": 1, "address_key": "201 TAMPINES ST 21", "town": "TAMPINES",
         "flat_type": "4 ROOM", "listing_price": 600000, "predicted_price": 580000,
         "historical_sale_price": 570000, "historical_sale_year": 2023,
         "in_historical_graph": True, "nearest_famous_school": "TAO NAN PRIMARY",
         "dist_to_famous_school_km": 1.2, "dist_to_mrt_m": 420, "score_value": 7.5,
         "listing_url": None, "created_at_iso": "2026-04-15T10:00:00"},
        {"sql_id": 2, "address_key": "1 LOR LEW LIAN", "town": "SERANGOON",
         "flat_type": "3 ROOM", "listing_price": 480000, "predicted_price": 462000,
         "historical_sale_price": None, "historical_sale_year": None,
         "in_historical_graph": False, "nearest_famous_school": None,
         "dist_to_famous_school_km": None, "dist_to_mrt_m": None, "score_value": None,
         "listing_url": None, "created_at_iso": "2026-04-14T09:00:00"},
    ]
    driver_mock, session_mock = _mock_driver_capturing_runs()
    session_mock.run.return_value = iter(fake_records)
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        rows = sg.fetch_user_shortlist_graph("user", limit=10)
    assert len(rows) == 2
    assert rows[0]["address_key"] == "201 TAMPINES ST 21"
    assert rows[1]["in_historical_graph"] is False
    driver_mock.close.assert_called_once()


def test_format_shortlist_graph_rows_marks_off_graph_saves():
    rows = [
        {"sql_id": 1, "address_key": "201 TAMPINES ST 21", "town": "TAMPINES",
         "flat_type": "4 ROOM", "listing_price": 600000, "predicted_price": 580000,
         "historical_sale_price": 570000, "historical_sale_year": 2023,
         "in_historical_graph": True, "nearest_famous_school": "TAO NAN PRIMARY",
         "dist_to_famous_school_km": 1.2},
        {"sql_id": 2, "address_key": "999 NEW BTO", "town": "PUNGGOL",
         "flat_type": "4 ROOM", "listing_price": 700000, "predicted_price": 680000,
         "historical_sale_price": None, "historical_sale_year": None,
         "in_historical_graph": False, "nearest_famous_school": None,
         "dist_to_famous_school_km": None},
    ]
    md = sg.format_shortlist_graph_rows(rows)
    assert "201 TAMPINES ST 21" in md
    assert "hist $570,000 (2023)" in md
    # Off-graph row gets the explicit flag
    assert "(no historical sale on record)" in md
    # Footer summary present when mixed
    assert "1 of 2 saves are at addresses with no historical sale data" in md


def test_format_shortlist_graph_rows_handles_empty():
    assert sg.format_shortlist_graph_rows([]) == "_No saved listings yet._"


def test_format_town_overlap_vs_history_renders_markdown_table():
    rows = [
        {"town": "TAMPINES", "saved_count": 3, "your_listing_avg": 620000.0,
         "historical_median_price": 540000.0, "historical_mean_price": 555000.0,
         "historical_sales_in_town": 1320},
        {"town": "BEDOK", "saved_count": 1, "your_listing_avg": 480000.0,
         "historical_median_price": 440000.0, "historical_mean_price": 455000.0,
         "historical_sales_in_town": 980},
    ]
    md = sg.format_town_overlap_vs_history(rows)
    assert "| Town | Saves" in md
    assert "TAMPINES" in md and "BEDOK" in md
    assert "$540,000" in md  # historical median
    assert "$620,000" in md  # your avg ask


def test_ensure_user_projected_merges_each_row():
    rows = [
        SimpleNamespace(
            id=i, username="user", listing_url=None, listing_price=500000.0,
            predicted_price=480000.0, source="buyer",
            created_at=datetime(2026, 4, 1, 12, 0, 0),
            payload_json={"block": str(i), "street_name": "X RD", "town": "BEDOK", "flat_type": "3 ROOM"},
        )
        for i in (1, 2, 3)
    ]
    driver_mock, session_mock = _mock_driver_capturing_runs()
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        n = sg.ensure_user_projected("user", rows)
    assert n == 3
    # First call MERGE_USER, then 3 MERGE_ITEM calls
    assert session_mock.run.call_count == 4
    assert session_mock.run.call_args_list[0].args[0] == sg._CYPHER_MERGE_USER
    for c in session_mock.run.call_args_list[1:]:
        assert c.args[0] == sg._CYPHER_MERGE_ITEM


def test_fetch_user_saves_near_school_runs_correct_cypher():
    fake_records = [
        {"sql_id": 2, "address_key": "864 TAMPINES ST 83", "town": "TAMPINES",
         "flat_type": "4 ROOM", "listing_price": 816666, "predicted_price": 685200,
         "dist_km": 0.3},
    ]
    driver_mock, session_mock = _mock_driver_capturing_runs()
    session_mock.run.return_value = iter(fake_records)
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        rows = sg.fetch_user_saves_near_school("user", "POI CHING SCHOOL")
    assert len(rows) == 1
    assert rows[0]["address_key"] == "864 TAMPINES ST 83"
    # Confirm we ran the saves-near-school template with both params
    call = session_mock.run.call_args_list[0]
    assert call.args[0] == sg._CYPHER_SAVES_NEAR_SCHOOL
    assert call.kwargs["username"] == "user"
    assert call.kwargs["school_name"] == "POI CHING SCHOOL"
    driver_mock.close.assert_called_once()


def test_fetch_user_saves_near_school_returns_empty_for_blank_inputs():
    # No driver call should happen when username or school_name is empty.
    with patch.object(sg, "_neo4j_driver") as drv:
        assert sg.fetch_user_saves_near_school("", "POI CHING") == []
        assert sg.fetch_user_saves_near_school("user", "") == []
        drv.assert_not_called()


def test_fetch_user_saves_near_school_raises_on_driver_error():
    driver_mock, _ = _mock_driver_capturing_runs(run_side_effect=RuntimeError("AuraDB down"))
    with patch.object(sg, "_neo4j_driver", return_value=driver_mock):
        with pytest.raises(sg.ShortlistGraphUnavailable):
            sg.fetch_user_saves_near_school("user", "POI CHING SCHOOL")


def test_format_saves_near_school_rows_renders_distance_and_school():
    rows = [
        {"sql_id": 2, "address_key": "864 TAMPINES ST 83", "town": "TAMPINES",
         "flat_type": "4 ROOM", "listing_price": 816666, "predicted_price": 685200,
         "dist_km": 0.3},
    ]
    md = sg.format_saves_near_school_rows(rows, "POI CHING SCHOOL")
    assert "864 TAMPINES ST 83" in md
    assert "0.3 km from POI CHING SCHOOL" in md
    assert "asking $816,666" in md
    assert "AI $685,200" in md


def test_format_saves_near_school_rows_handles_empty():
    md = sg.format_saves_near_school_rows([], "POI CHING SCHOOL")
    assert "None of your saves are within 2 km of POI CHING SCHOOL" in md


def test_ensure_user_projected_raises_unavailable_on_driver_error():
    rows = [SimpleNamespace(
        id=1, username="user", listing_url=None, listing_price=None,
        predicted_price=400000.0, source="buyer",
        created_at=datetime(2026, 4, 1), payload_json={"block": "1", "street_name": "X", "town": "BEDOK", "flat_type": "3 ROOM"},
    )]
    with patch.object(sg, "_neo4j_driver", side_effect=sg.ShortlistGraphUnavailable("down")):
        with pytest.raises(sg.ShortlistGraphUnavailable):
            sg.ensure_user_projected("user", rows)
