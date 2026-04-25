"""Tests for /api/analytics/recent-transactions."""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    from backend import analytics as mod
    from backend.app_state import state

    df = pd.DataFrame(
        [
            {"year": 2024, "month": 3, "town": "BISHAN",   "flat_type": "4 ROOM",  "floor_area_sqm": 93.0,  "block": "101", "street_name": "BISHAN ST 12",  "resale_price": 820000.0},
            {"year": 2025, "month": 8, "town": "BISHAN",   "flat_type": "4 ROOM",  "floor_area_sqm": 95.0,  "block": "102", "street_name": "BISHAN ST 12",  "resale_price": 860000.0},
            {"year": 2026, "month": 1, "town": "TAMPINES", "flat_type": "5 ROOM",  "floor_area_sqm": 112.0, "block": "770", "street_name": "TAMPINES ST 71","resale_price": 720000.0},
            {"year": 2026, "month": 4, "town": "TAMPINES", "flat_type": "4 ROOM",  "floor_area_sqm": 92.0,  "block": "771", "street_name": "TAMPINES ST 71","resale_price": 690000.0},
            {"year": 2023, "month": 6, "town": "BEDOK",    "flat_type": "3 ROOM",  "floor_area_sqm": 67.0,  "block": "55",  "street_name": "BEDOK NTH RD",   "resale_price": 430000.0},
        ]
    )

    state.hdb_recent_df = df.copy()

    app = FastAPI()
    app.include_router(mod.router, prefix="/api")
    try:
        yield TestClient(app)
    finally:
        state.hdb_recent_df = None


def test_recent_transactions_sort_and_limit(client):
    res = client.get("/api/analytics/recent-transactions?limit=3")
    assert res.status_code == 200
    body = res.json()
    assert body["as_of_year"] == 2026
    assert body["has_month"] is True
    assert len(body["rows"]) == 3
    assert body["rows"][0]["year"] == 2026
    assert body["rows"][0]["month"] == 4
    assert body["rows"][1]["year"] == 2026
    assert body["rows"][1]["month"] == 1
    assert body["rows"][2]["year"] == 2025


def test_recent_transactions_limit_clamp(client):
    res = client.get("/api/analytics/recent-transactions?limit=999")
    assert res.status_code == 422


def test_recent_transactions_town_filter(client):
    res = client.get("/api/analytics/recent-transactions?town=tampines&limit=10")
    assert res.status_code == 200
    body = res.json()
    assert body["town_filter"] == "tampines"
    assert {r["town"] for r in body["rows"]} == {"TAMPINES"}
    assert len(body["rows"]) == 2


def test_recent_transactions_falls_back_when_no_month(monkeypatch):
    from backend import analytics as mod
    from backend.app_state import state

    df = pd.DataFrame(
        [
            {"year": 2024, "month": pd.NA, "town": "BISHAN",   "flat_type": "4 ROOM", "floor_area_sqm": 93.0,  "block": pd.NA, "street_name": pd.NA, "resale_price": 820000.0},
            {"year": 2026, "month": pd.NA, "town": "TAMPINES", "flat_type": "4 ROOM", "floor_area_sqm": 92.0,  "block": pd.NA, "street_name": pd.NA, "resale_price": 690000.0},
            {"year": 2026, "month": pd.NA, "town": "BISHAN",   "flat_type": "5 ROOM", "floor_area_sqm": 110.0, "block": pd.NA, "street_name": pd.NA, "resale_price": 950000.0},
        ]
    )
    state.hdb_recent_df = df.copy()

    app = FastAPI()
    app.include_router(mod.router, prefix="/api")
    tc = TestClient(app)
    try:
        res = tc.get("/api/analytics/recent-transactions?limit=5")
        assert res.status_code == 200
        body = res.json()
        assert body["has_month"] is False
        # year desc, then price desc
        assert body["rows"][0]["year"] == 2026
        assert body["rows"][0]["resale_price"] == 950000.0
        assert body["rows"][1]["year"] == 2026
        assert body["rows"][1]["resale_price"] == 690000.0
        assert body["rows"][2]["year"] == 2024
    finally:
        state.hdb_recent_df = None
