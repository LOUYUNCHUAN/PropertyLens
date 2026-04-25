"""Tests for /api/debug/property-search-graph (Neo4j schema + aggregate view)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


def _make_app() -> FastAPI:
    from backend.property_search_chat import router as property_router

    app = FastAPI()
    app.include_router(property_router, prefix="/api")
    return app


def _fake_session_runner(canned: dict):
    """Build a fake session where session.run(cypher, ...) dispatches on
    substrings of the Cypher query to canned iterables.

    Each canned value is a list of dict-rows (which the neo4j driver exposes
    as mapping-like Record objects; a plain dict works for our dict(r) usage).
    """

    def run(cypher, **_kwargs):
        result = MagicMock()
        # Pick the first matching key whose substring appears in the query.
        matched = None
        for key, rows in canned.items():
            if key in cypher:
                matched = rows
                break
        rows = matched if matched is not None else []
        result.__iter__ = lambda self: iter(rows)
        result.single = lambda: (rows[0] if rows else None)
        return result

    session = MagicMock()
    session.run.side_effect = run
    session.__enter__ = lambda self: session
    session.__exit__ = lambda self, *a: None
    return session


def test_debug_property_search_graph_happy_path():
    app = _make_app()
    client = TestClient(app)

    canned = {
        "MATCH (p:Property) RETURN count(p)": [{"n": 9710}],
        "MATCH (t:Town) RETURN count(t)": [{"n": 26}],
        "MATCH (s:FamousSchool) RETURN count(s)": [{"n": 17}],
        "NEAREST_FAMOUS_SCHOOL]->() RETURN count(r)": [{"n": 9710}],
        "NEAR_FAMOUS_SCHOOL]->() RETURN count(r)": [{"n": 41234}],
        "MATCH (t:Town)\nOPTIONAL MATCH (t)<-[:LOCATED_IN]": [
            {"town": "BISHAN",   "property_count": 412, "avg_resale_price": 780000.0, "avg_dist_to_mrt_m": 520.0},
            {"town": "TAMPINES", "property_count": 900, "avg_resale_price": 620000.0, "avg_dist_to_mrt_m": 710.0},
        ],
        "MATCH (s:FamousSchool)\nOPTIONAL MATCH (s)<-[:NEAREST_FAMOUS_SCHOOL]": [
            {"school": "ACS PRIMARY",       "nearest_property_count": 88, "near_property_count": 412},
            {"school": "NANYANG PRIMARY",   "nearest_property_count": 120, "near_property_count": 340},
        ],
        "MATCH (t:Town)<-[:LOCATED_IN]-(p:Property)-[:NEAR_FAMOUS_SCHOOL]": [
            {"town": "BISHAN",   "school": "ACS PRIMARY",     "weight": 34},
            {"town": "TAMPINES", "school": "NANYANG PRIMARY", "weight": 10},
        ],
        "LIMIT 20": [
            {
                "address_key": "BLK 123 BISHAN ST 12",
                "town": "BISHAN",
                "flat_type": "4 ROOM",
                "resale_price": 780000.0,
                "lease_remaining_years": 72.0,
                "dist_to_mrt_m": 520.0,
                "score_mrt": 8.0,
                "score_famous_school": 9.0,
                "score_value": 6.0,
            },
        ],
    }

    session = _fake_session_runner(canned)
    driver = MagicMock()
    driver.session.return_value = session

    with (
        patch("backend.property_search_rag._neo4j_driver", return_value=driver),
        patch(
            "backend.property_search_rag._neo4j_creds",
            return_value={"uri": "bolt://x", "user": "u", "password": "p", "database": None},
        ),
    ):
        res = client.get("/api/debug/property-search-graph")

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["stats"]["property_count"] == 9710
    assert body["stats"]["town_count"] == 26
    assert body["stats"]["famous_school_count"] == 17
    assert body["stats"]["nearest_rel_count"] == 9710
    assert body["stats"]["near_rel_count"] == 41234

    towns = [n for n in body["nodes"] if n["type"] == "Town"]
    schools = [n for n in body["nodes"] if n["type"] == "FamousSchool"]
    assert len(towns) == 2
    assert towns[0]["id"] == "town:BISHAN"
    assert towns[0]["property_count"] == 412
    assert len(schools) == 2
    assert schools[0]["id"] == "school:ACS PRIMARY"
    assert schools[0]["near_property_count"] == 412

    assert len(body["links"]) == 2
    assert body["links"][0] == {
        "source": "town:BISHAN",
        "target": "school:ACS PRIMARY",
        "type": "NEAR",
        "weight": 34,
    }

    assert len(body["sample_properties"]) == 1
    assert body["sample_properties"][0]["address_key"] == "BLK 123 BISHAN ST 12"


def test_debug_property_search_graph_neo4j_unavailable():
    app = _make_app()
    client = TestClient(app)

    def _raise():
        raise ValueError(
            "Neo4j credentials missing. Set NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD."
        )

    with patch("backend.property_search_rag._neo4j_driver", side_effect=_raise):
        res = client.get("/api/debug/property-search-graph")

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert "Neo4j credentials missing" in body["error"]
    assert "Layer 06 nodes" in body["error"]
