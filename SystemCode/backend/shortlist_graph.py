"""
shortlist_graph.py — project user shortlists from SQLite into Neo4j as a thin
graph view, then read them back enriched with the historical-transaction graph.

SQLite remains the source of truth for shortlist storage (`wishlist_listing`
table). This module mirrors a scalar projection into Neo4j so the chatbot can
walk `(:User)-[:SAVED]->(:UserShortlistItem)-[:OF_PROPERTY]->(:Property)` and
compare each saved listing against the historical sale at the same address.

Failure modes are intentional: every Neo4j call is wrapped so that a missing or
unreachable Neo4j leaves the SQL store unaffected and the chatbot falls back to
the legacy SQL render in ``property_search_chat.py``.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)


# ============================================================================
# Driver helpers — copied from property_search_rag.py:172-349 to keep this
# module self-contained and consistent with the existing per-call pattern.
# ============================================================================


def _neo4j_creds() -> dict[str, str | None]:
    return {
        "uri": os.environ.get("NEO4J_URI"),
        "user": os.environ.get("NEO4J_USERNAME") or os.environ.get("NEO4J_USER"),
        "password": os.environ.get("NEO4J_PASSWORD"),
        "database": os.environ.get("NEO4J_DATABASE"),
    }


class ShortlistGraphUnavailable(RuntimeError):
    """Raised when the chatbot's read path can't reach Neo4j; caller falls back to SQL."""


def _neo4j_driver():
    """Open a fresh driver. Raises ShortlistGraphUnavailable if creds incomplete or import fails."""
    try:
        from neo4j import GraphDatabase
    except ImportError as e:
        raise ShortlistGraphUnavailable(f"neo4j driver not installed: {e}") from e
    creds = _neo4j_creds()
    if not creds["uri"] or not creds["user"] or not creds["password"]:
        raise ShortlistGraphUnavailable(
            "Neo4j credentials missing. Set NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD."
        )
    return GraphDatabase.driver(creds["uri"], auth=(creds["user"], creds["password"]))


def _session_kwargs() -> dict:
    db = _neo4j_creds().get("database")
    return {"database": db} if db else {}


# ============================================================================
# Cypher templates — module-level constants, mirrors the _CYPHER_SEARCH style
# at property_search_rag.py:55-102. No LLM-generated Cypher.
# ============================================================================

_CYPHER_MERGE_USER = """
MERGE (u:User {username: $username})
ON CREATE SET u.first_seen = datetime()
"""

_CYPHER_MERGE_ITEM = """
MERGE (i:UserShortlistItem {sql_id: $sql_id})
SET i.listing_url     = $listing_url,
    i.listing_price   = $listing_price,
    i.predicted_price = $predicted_price,
    i.town            = $town,
    i.flat_type       = $flat_type,
    i.address_key     = $address_key,
    i.created_at_iso  = $created_at_iso,
    i.source          = $source
WITH i
MATCH (u:User {username: $username})
MERGE (u)-[:SAVED]->(i)
WITH i
FOREACH (_ IN CASE WHEN $town IS NULL OR $town = "" THEN [] ELSE [1] END |
  MERGE (t:Town {name: $town})
  MERGE (i)-[:IN_TOWN]->(t))
WITH i
OPTIONAL MATCH (p:Property {address_key: $address_key})
FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END |
  MERGE (i)-[r:OF_PROPERTY]->(p)
  SET r.match_quality = "exact")
"""

_CYPHER_DELETE_ITEM = """
MATCH (i:UserShortlistItem {sql_id: $sql_id})
DETACH DELETE i
"""

_CYPHER_FETCH_USER_SHORTLIST = """
MATCH (u:User {username: $username})-[:SAVED]->(i:UserShortlistItem)
OPTIONAL MATCH (i)-[:OF_PROPERTY]->(p:Property)
OPTIONAL MATCH (p)-[r:NEAREST_FAMOUS_SCHOOL]->(s:FamousSchool)
RETURN i.sql_id            AS sql_id,
       i.address_key       AS address_key,
       i.listing_url       AS listing_url,
       i.listing_price     AS listing_price,
       i.predicted_price   AS predicted_price,
       i.town              AS town,
       i.flat_type         AS flat_type,
       i.created_at_iso    AS created_at_iso,
       p.resale_price      AS historical_sale_price,
       p.transaction_year  AS historical_sale_year,
       p.dist_to_mrt_m     AS dist_to_mrt_m,
       p.score_value       AS score_value,
       s.name              AS nearest_famous_school,
       r.distance_km       AS dist_to_famous_school_km,
       (p IS NOT NULL)     AS in_historical_graph
ORDER BY coalesce(r.distance_km, 99.0) ASC, i.created_at_iso DESC
LIMIT $limit
"""

_CYPHER_TOWN_OVERLAP_VS_HISTORY = """
MATCH (u:User {username: $username})-[:SAVED]->(i:UserShortlistItem)-[:IN_TOWN]->(t:Town)
WITH t, count(i) AS saved_count, avg(i.listing_price) AS your_listing_avg
OPTIONAL MATCH (p:Property)-[:LOCATED_IN]->(t)
WITH t, saved_count, your_listing_avg,
     count(p) AS historical_sales_in_town,
     percentileCont(p.resale_price, 0.5) AS historical_median_price,
     avg(p.resale_price) AS historical_mean_price
RETURN t.name                   AS town,
       saved_count,
       your_listing_avg,
       historical_sales_in_town,
       historical_median_price,
       historical_mean_price
ORDER BY saved_count DESC
"""

_CYPHER_SAVES_NEAR_SCHOOL = """
MATCH (u:User {username: $username})-[:SAVED]->(i:UserShortlistItem)
      -[:OF_PROPERTY]->(p:Property)
      -[r:NEAR_FAMOUS_SCHOOL|NEAREST_FAMOUS_SCHOOL]->(:FamousSchool {name: $school_name})
WITH i, min(r.distance_km) AS dist_km
RETURN i.sql_id          AS sql_id,
       i.address_key     AS address_key,
       i.town            AS town,
       i.flat_type       AS flat_type,
       i.listing_price   AS listing_price,
       i.predicted_price AS predicted_price,
       dist_km
ORDER BY dist_km ASC
LIMIT 10
"""


# ============================================================================
# Address-key derivation — must match the graph's `Property.address_key` form.
#
# Per yc_property_search.py:380-383 the key is "<BLOCK> <STREET_NAME>" upper-
# cased. The Layer 02 feature pipeline (and the geocode CSV it joins) uses HDB-
# canonical street suffix abbreviations (`STREET → ST`, `AVENUE → AVE`, etc.).
# Wishlist payloads scraped from listings or typed by users tend to spell those
# out, so we abbreviate at projection time. The map below was derived empirically
# from the deployed graph (see top-30 suffix histogram in
# scripts/regenerate_composite_shap.py probes).
# ============================================================================

_STREET_SUFFIX_ABBREV = {
    "STREET": "ST",
    "AVENUE": "AVE",
    "ROAD": "RD",
    "DRIVE": "DR",
    "CRESCENT": "CRES",
    "CENTRAL": "CTRL",
    "CLOSE": "CL",
    "PLACE": "PL",
    "TERRACE": "TER",
    "HEIGHTS": "HTS",
    "GARDENS": "GDNS",
    "NORTH": "NTH",
    "SOUTH": "STH",  # rare but safer to map; harmless if graph stores SOUTH verbatim
}


def _normalise_street_tokens(street: str) -> str:
    """Apply HDB suffix abbreviations token-wise; idempotent on pre-abbreviated input."""
    out = []
    for tok in street.split():
        out.append(_STREET_SUFFIX_ABBREV.get(tok, tok))
    return " ".join(out)


def _compute_address_key(payload: dict | None) -> str | None:
    """Canonical address_key for matching Property nodes in the historical graph.

    Returns "<BLOCK> <STREET_NAME>" uppercased and with HDB street-suffix
    abbreviations applied. Returns None if block or street_name is missing.
    """
    if not payload:
        return None
    block = str(payload.get("block") or "").strip().upper()
    street = str(payload.get("street_name") or "").strip().upper()
    if not block or not street:
        return None
    street = _normalise_street_tokens(" ".join(street.split()))
    return f"{block} {street}"


def _row_to_projection_params(row) -> dict | None:
    """Extract the scalar projection of a WishlistListing row for MERGE."""
    if row is None:
        return None
    payload = getattr(row, "payload_json", None) or {}
    address_key = _compute_address_key(payload)
    created_at = getattr(row, "created_at", None)
    if isinstance(created_at, datetime):
        created_at_iso = created_at.isoformat()
    elif created_at is None:
        created_at_iso = None
    else:
        created_at_iso = str(created_at)
    return {
        "username": str(getattr(row, "username", "") or "").strip().lower(),
        "sql_id": int(getattr(row, "id", 0)),
        "listing_url": getattr(row, "listing_url", None),
        "listing_price": (
            float(row.listing_price) if getattr(row, "listing_price", None) is not None else None
        ),
        "predicted_price": float(getattr(row, "predicted_price", 0.0) or 0.0),
        "town": (payload.get("town") or "").strip().upper() or None,
        "flat_type": (payload.get("flat_type") or "").strip().upper() or None,
        "address_key": address_key,
        "created_at_iso": created_at_iso,
        "source": getattr(row, "source", None) or "extension",
    }


# ============================================================================
# Write path — projection helpers (best-effort, swallow failures)
# ============================================================================


def project_shortlist_item(row) -> bool:
    """MERGE one WishlistListing row into Neo4j. Returns True on success.

    Logs and swallows any Neo4j failure — SQLite has already committed by the
    time this runs (called from FastAPI BackgroundTasks).
    """
    params = _row_to_projection_params(row)
    if params is None:
        return False
    if not params["username"]:
        logger.warning("shortlist projection skipped: empty username (sql_id=%s)", params["sql_id"])
        return False
    try:
        driver = _neo4j_driver()
    except ShortlistGraphUnavailable as e:
        logger.warning("shortlist projection unavailable: %s (sql_id=%s)", e, params["sql_id"])
        return False
    try:
        with driver.session(**_session_kwargs()) as session:
            session.run(_CYPHER_MERGE_USER, username=params["username"])
            session.run(_CYPHER_MERGE_ITEM, **params)
        return True
    except Exception as e:
        logger.warning(
            "shortlist projection failed: %s (sql_id=%s, address_key=%s)",
            e, params["sql_id"], params["address_key"],
        )
        return False
    finally:
        try:
            driver.close()
        except Exception:
            pass


def project_shortlist_item_by_sql_id(sql_id: int) -> bool:
    """Re-fetch a row by id and project. Used as FastAPI BackgroundTask."""
    from backend.db import SessionLocal
    from backend.sql_models import WishlistListing

    db = SessionLocal()
    try:
        row = db.query(WishlistListing).filter(WishlistListing.id == int(sql_id)).first()
        if row is None:
            logger.warning("shortlist projection: sql_id=%s not found", sql_id)
            return False
        return project_shortlist_item(row)
    finally:
        db.close()


def delete_shortlist_item(sql_id: int) -> bool:
    """DETACH DELETE the projected node. Safe when Neo4j is down."""
    try:
        driver = _neo4j_driver()
    except ShortlistGraphUnavailable as e:
        logger.warning("shortlist delete unavailable: %s (sql_id=%s)", e, sql_id)
        return False
    try:
        with driver.session(**_session_kwargs()) as session:
            session.run(_CYPHER_DELETE_ITEM, sql_id=int(sql_id))
        return True
    except Exception as e:
        logger.warning("shortlist delete failed: %s (sql_id=%s)", e, sql_id)
        return False
    finally:
        try:
            driver.close()
        except Exception:
            pass


def ensure_user_projected(username: str, rows: Iterable) -> int:
    """Lazy self-heal — MERGE all supplied rows for a user. Idempotent.

    Called from the chatbot read path before fetch, so the graph view stays
    correct even if a prior async projection was dropped or Neo4j was down at
    save time. Raises ShortlistGraphUnavailable so the caller can fall back
    to the SQL-only render.
    """
    rows = list(rows or [])
    if not rows:
        return 0
    username = (username or "").strip().lower()
    if not username:
        return 0
    driver = _neo4j_driver()  # may raise ShortlistGraphUnavailable
    projected = 0
    try:
        with driver.session(**_session_kwargs()) as session:
            session.run(_CYPHER_MERGE_USER, username=username)
            for row in rows:
                params = _row_to_projection_params(row)
                if params is None or not params["username"]:
                    continue
                try:
                    session.run(_CYPHER_MERGE_ITEM, **params)
                    projected += 1
                except Exception as e:  # noqa: BLE001 — keep self-heal best-effort per row
                    logger.warning(
                        "self-heal MERGE failed: %s (sql_id=%s)", e, params["sql_id"]
                    )
    except Exception as e:
        raise ShortlistGraphUnavailable(f"self-heal failed: {e}") from e
    finally:
        try:
            driver.close()
        except Exception:
            pass
    return projected


# ============================================================================
# Read path — chatbot consumers
# ============================================================================


def fetch_user_shortlist_graph(username: str, *, limit: int = 40) -> list[dict[str, Any]]:
    """Saves enriched with their historical sale (when address is in graph).

    Raises ShortlistGraphUnavailable on any driver failure — the chatbot
    catches this and falls back to the legacy SQL render.
    """
    username = (username or "").strip().lower()
    if not username:
        return []
    driver = _neo4j_driver()
    try:
        with driver.session(**_session_kwargs()) as session:
            result = session.run(
                _CYPHER_FETCH_USER_SHORTLIST,
                username=username,
                limit=int(limit),
            )
            return [dict(r) for r in result]
    except Exception as e:
        raise ShortlistGraphUnavailable(f"fetch failed: {e}") from e
    finally:
        try:
            driver.close()
        except Exception:
            pass


def fetch_town_overlap_vs_history(username: str) -> list[dict[str, Any]]:
    """Per-town aggregate: how many saves vs historical median price."""
    username = (username or "").strip().lower()
    if not username:
        return []
    driver = _neo4j_driver()
    try:
        with driver.session(**_session_kwargs()) as session:
            result = session.run(_CYPHER_TOWN_OVERLAP_VS_HISTORY, username=username)
            return [dict(r) for r in result]
    except Exception as e:
        raise ShortlistGraphUnavailable(f"town overlap failed: {e}") from e
    finally:
        try:
            driver.close()
        except Exception:
            pass


def fetch_user_saves_near_school(username: str, school_name: str) -> list[dict[str, Any]]:
    """User's saved flats within 2 km of a specific famous primary school.

    Used by the chatbot to cross-reference a "near SCHOOL" search against the
    user's own shortlist — surfaces matches like "you already saved 864
    Tampines St 83 which is 0.3 km from POI CHING SCHOOL".
    """
    username = (username or "").strip().lower()
    school_name = (school_name or "").strip().upper()
    if not username or not school_name:
        return []
    driver = _neo4j_driver()
    try:
        with driver.session(**_session_kwargs()) as session:
            result = session.run(
                _CYPHER_SAVES_NEAR_SCHOOL,
                username=username,
                school_name=school_name,
            )
            return [dict(r) for r in result]
    except Exception as e:
        raise ShortlistGraphUnavailable(f"saves-near-school failed: {e}") from e
    finally:
        try:
            driver.close()
        except Exception:
            pass


# ============================================================================
# Markdown formatters — match the section style used by chat_tools.format_shortlist_rows
# ============================================================================


def _fmt_price(v: Optional[float]) -> str:
    if v is None:
        return "—"
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return "—"


def _fmt_pct_gap(asking: Optional[float], reference: Optional[float]) -> str:
    if asking is None or reference is None or reference == 0:
        return ""
    try:
        gap = (float(asking) - float(reference)) / float(reference) * 100.0
    except (TypeError, ValueError, ZeroDivisionError):
        return ""
    sign = "+" if gap >= 0 else ""
    return f" ({sign}{gap:.1f}% vs hist)"


def format_shortlist_graph_rows(rows: list[dict[str, Any]]) -> str:
    """Render the graph-fetched rows as markdown.

    Each row line shows: address · town · flat_type · listing_price · ai_pred ·
    historical_sale (year) · nearest famous school. Off-graph saves get a
    trailing flag.
    """
    if not rows:
        return "_No saved listings yet._"

    on_graph = [r for r in rows if r.get("in_historical_graph")]
    off_graph = [r for r in rows if not r.get("in_historical_graph")]

    lines: list[str] = []
    for idx, r in enumerate(rows, 1):
        addr = r.get("address_key") or "(no address)"
        town = r.get("town") or "—"
        flat = r.get("flat_type") or "—"
        listing = r.get("listing_price")
        ai = r.get("predicted_price")
        hist = r.get("historical_sale_price")
        hist_year = r.get("historical_sale_year")
        school = r.get("nearest_famous_school")
        school_dist = r.get("dist_to_famous_school_km")

        bits: list[str] = [
            f"**{idx}. {addr}**",
            f"{town} · {flat}",
            f"asking { _fmt_price(listing) }",
            f"AI { _fmt_price(ai) }",
        ]
        if r.get("in_historical_graph"):
            hist_label = f"hist { _fmt_price(hist) }"
            if hist_year:
                hist_label += f" ({int(hist_year)})"
            hist_label += _fmt_pct_gap(listing, hist)
            bits.append(hist_label)
        else:
            bits.append("_(no historical sale on record)_")
        if school:
            dist_str = f" ({float(school_dist):.1f} km)" if school_dist is not None else ""
            bits.append(f"nearest famous school: {school}{dist_str}")
        lines.append("- " + " · ".join(bits))

    md = "\n".join(lines)
    if off_graph and on_graph:
        md += (
            f"\n\n_{len(off_graph)} of {len(rows)} saves are at addresses with no "
            "historical sale data — only town-level comparison available for those._"
        )
    return md


def format_saves_near_school_rows(rows: list[dict[str, Any]], school_name: str) -> str:
    """Render the user's saves that are within 2 km of a specific famous school."""
    if not rows:
        return f"_None of your saves are within 2 km of {school_name}._"
    lines: list[str] = []
    for r in rows:
        addr = r.get("address_key") or "(no address)"
        town = r.get("town") or "—"
        ft = r.get("flat_type") or "—"
        ask = _fmt_price(r.get("listing_price"))
        ai = _fmt_price(r.get("predicted_price"))
        dist = r.get("dist_km")
        if dist is not None:
            try:
                dist_str = f"{float(dist):.1f} km from {school_name}"
            except (TypeError, ValueError):
                dist_str = f"near {school_name}"
        else:
            dist_str = f"near {school_name}"
        lines.append(
            f"- **{addr}** · {town} · {ft} · asking {ask} · AI {ai} · {dist_str}"
        )
    return "\n".join(lines)


def format_town_overlap_vs_history(rows: list[dict[str, Any]]) -> str:
    """Per-town aggregate as a markdown table."""
    if not rows:
        return "_No saved listings yet._"
    header = (
        "| Town | Saves | Your avg ask | Historical median | Historical mean | Historical sales |\n"
        "| :--- | ---: | ---: | ---: | ---: | ---: |"
    )
    body = []
    for r in rows:
        town = r.get("town") or "—"
        body.append(
            f"| {town} | {int(r.get('saved_count') or 0)} | {_fmt_price(r.get('your_listing_avg'))} "
            f"| {_fmt_price(r.get('historical_median_price'))} | {_fmt_price(r.get('historical_mean_price'))} "
            f"| {int(r.get('historical_sales_in_town') or 0)} |"
        )
    return header + "\n" + "\n".join(body)
