"""Tests for /api/property-search-chat (Layer 06 property search RAG endpoint)."""

from __future__ import annotations

from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _make_app() -> FastAPI:
    from backend.property_search_chat import router as property_router

    app = FastAPI()
    app.include_router(property_router, prefix="/api")
    return app


def test_property_search_chat_streams_sse():
    app = _make_app()
    client = TestClient(app)

    fake = type(
        "FakeResult",
        (),
        {
            "answer": "Here are a few options in Bishan.",
            "params": {"weights": {"score_mrt": 8}, "filters": {"town": "BISHAN"}, "special_query_type": None},
            "rows": [
                {"address_key": "BISHAN ST 12", "town": "BISHAN", "flat_type": "4 ROOM", "resale_price": 880000, "composite_score": 8.7},
            ],
        },
    )()

    with (
        patch("backend.property_search_chat.resolve_effective_username", return_value="demo"),
        patch("backend.property_search_chat.run_property_search_rag", return_value=fake),
    ):
        res = client.post(
            "/api/property-search-chat",
            json={"message": "find me a flat", "history": []},
            headers={"Authorization": "Bearer test"},
        )
        assert res.status_code == 200
        body = res.text
        assert "data:" in body
        assert "[DONE]" in body
        assert "Here are a few options" in body


def test_property_search_chat_appends_tool_sections():
    app = _make_app()
    client = TestClient(app)

    from backend.models import PredictRequest

    fake = type(
        "FakeResult",
        (),
        {"answer": "answer", "params": {"weights": {}, "filters": {}, "special_query_type": None}, "rows": []},
    )()

    # Minimal shortlist row stub
    row = type(
        "Row",
        (),
        {
            "id": 1,
            "display_label": "Listing",
            "payload_json": {"town": "BISHAN"},
            "listing_price": None,
            "predicted_price": 500000.0,
            "created_at": 0,
        },
    )()

    # Patch DB query chain and tool runners
    class _Q:
        def filter(self, *_, **__):
            return self

        def order_by(self, *_, **__):
            return self

        def limit(self, *_):
            return self

        def all(self):
            return [row]

    class _DB:
        def query(self, *_):
            return _Q()

    flat = PredictRequest(
        floor_area_sqm=90.0,
        storey_mid=8.0,
        remaining_lease_years=70.0,
        lease_commence_date=1999,
        dist_nearest_mrt_km=0.5,
        town="BISHAN",
        flat_type="4 ROOM",
        block="25",
        street_name="SIN MING RD",
        year=2024,
        month_num=6,
    )

    with (
        patch("backend.property_search_chat.resolve_effective_username", return_value="demo"),
        patch("backend.property_search_chat.extract_flat_from_message", return_value=flat),
        patch("backend.property_search_chat.run_predict_tool", return_value="pred"),
        patch("backend.property_search_chat.run_cbr_tool", return_value="cbr"),
        patch("backend.property_search_chat.run_shap_tool", return_value="shap"),
        patch("backend.property_search_chat.run_property_search_rag", return_value=fake),
    ):
        # Override dependency injection for get_db to return our stub DB.
        import backend.property_search_chat as mod
        app.dependency_overrides[mod.get_db] = lambda: _DB()
        res = client.post(
            "/api/property-search-chat",
            json={"message": "show my shortlist and predict", "history": []},
            headers={"Authorization": "Bearer test"},
        )
        assert res.status_code == 200
        body = res.text
        assert "### Your shortlist" in body
        assert "### Price estimate" in body


def test_property_search_chat_tool_only_skips_top_matches():
    app = _make_app()
    client = TestClient(app)

    from backend.models import PredictRequest

    flat = PredictRequest(
        floor_area_sqm=90.0,
        storey_mid=8.0,
        remaining_lease_years=70.0,
        lease_commence_date=1999,
        dist_nearest_mrt_km=0.5,
        town="TAMPINES",
        flat_type="4 ROOM",
        block="864",
        street_name="TAMPINES STREET 83",
        year=2024,
        month_num=6,
    )

    with (
        patch("backend.property_search_chat.resolve_effective_username", return_value="demo"),
        patch("backend.property_search_chat.extract_flat_from_message", return_value=flat),
        patch("backend.property_search_chat.run_predict_tool", return_value="pred"),
        patch("backend.property_search_chat.run_property_search_rag") as mock_search,
    ):
        res = client.post(
            "/api/property-search-chat",
            json={"message": "Predict price for BLK 864 Tampines Street 83, 4 room, 90 sqm", "history": []},
            headers={"Authorization": "Bearer test"},
        )
        assert res.status_code == 200
        body = res.text
        assert "### Price estimate" in body
        assert "Top matches" not in body
        mock_search.assert_not_called()


def test_property_search_chat_rejects_empty_message():
    app = _make_app()
    client = TestClient(app)
    res = client.post("/api/property-search-chat", json={"message": "   ", "history": []})
    assert res.status_code == 400


def test_property_search_chat_smalltalk_ack_fast_path():
    app = _make_app()
    client = TestClient(app)
    with patch("backend.property_search_chat.resolve_effective_username", return_value="demo"):
        res = client.post("/api/property-search-chat", json={"message": "thanks", "history": []})
        assert res.status_code == 200
        assert "You're welcome" in res.text


# ---------- shortlist graph view branches --------------------------------


def _shortlist_app_with_db():
    """Helper: build the chat app with one stub WishlistListing row for username 'demo'."""
    app = _make_app()
    fake = type(
        "FakeResult",
        (),
        {"answer": "answer", "params": {"weights": {}, "filters": {}, "special_query_type": None}, "rows": []},
    )()
    row = type(
        "Row",
        (),
        {
            "id": 99,
            "display_label": "Listing",
            "payload_json": {"block": "201", "street_name": "TAMPINES ST 21",
                              "town": "TAMPINES", "flat_type": "4 ROOM"},
            "listing_url": None,
            "listing_price": 600000.0,
            "predicted_price": 580000.0,
            "created_at": 0,
            "username": "demo",
            "source": "buyer",
        },
    )()

    class _Q:
        def filter(self, *_, **__): return self
        def order_by(self, *_, **__): return self
        def limit(self, *_): return self
        def all(self): return [row]
    class _DB:
        def query(self, *_): return _Q()

    import backend.property_search_chat as mod
    app.dependency_overrides[mod.get_db] = lambda: _DB()
    return app, fake


def test_property_search_chat_uses_graph_view_when_available():
    app, fake = _shortlist_app_with_db()
    client = TestClient(app)

    graph_rows = [
        {"sql_id": 99, "address_key": "201 TAMPINES ST 21", "town": "TAMPINES",
         "flat_type": "4 ROOM", "listing_price": 600000, "predicted_price": 580000,
         "historical_sale_price": 570000, "historical_sale_year": 2023,
         "in_historical_graph": True, "nearest_famous_school": "TAO NAN PRIMARY",
         "dist_to_famous_school_km": 1.2, "dist_to_mrt_m": 420, "score_value": 7.5,
         "listing_url": None, "created_at_iso": "2026-04-15T10:00:00"},
    ]
    with (
        patch("backend.property_search_chat.resolve_effective_username", return_value="demo"),
        patch("backend.property_search_chat.run_property_search_rag", return_value=fake),
        patch("backend.property_search_chat.ensure_user_projected", return_value=1),
        patch("backend.property_search_chat.fetch_user_shortlist_graph", return_value=graph_rows),
    ):
        res = client.post(
            "/api/property-search-chat",
            json={"message": "what's in my shortlist vs historical sales", "history": []},
            headers={"Authorization": "Bearer test"},
        )
        assert res.status_code == 200
        body = res.text
        # Graph view header replaces the legacy "### Your shortlist" exactly when graph fires
        assert "Your shortlist (graph view" in body
        assert "201 TAMPINES ST 21" in body
        # Legacy SQL-only header should NOT appear when graph render succeeded
        assert "### Your shortlist\\n" not in body  # SSE-escaped newline form


def test_property_search_chat_falls_back_to_sql_when_graph_unavailable():
    from backend.shortlist_graph import ShortlistGraphUnavailable

    app, fake = _shortlist_app_with_db()
    client = TestClient(app)
    with (
        patch("backend.property_search_chat.resolve_effective_username", return_value="demo"),
        patch("backend.property_search_chat.run_property_search_rag", return_value=fake),
        patch("backend.property_search_chat.ensure_user_projected",
              side_effect=ShortlistGraphUnavailable("neo4j down")),
    ):
        res = client.post(
            "/api/property-search-chat",
            json={"message": "show my shortlist", "history": []},
            headers={"Authorization": "Bearer test"},
        )
        assert res.status_code == 200
        body = res.text
        # Falls back to legacy SQL render
        assert "### Your shortlist" in body
        assert "graph view" not in body

