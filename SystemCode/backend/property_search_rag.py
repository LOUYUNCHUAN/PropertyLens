"""
backend/property_search_rag.py
------------------------------
Layer 06-style natural-language property search for the production backend.

This is intentionally self-contained (no notebook sys.path hacks). It reuses:
  - Ollama (Gemma) for:
      Stage 1: NL -> {weights, filters, special_query_type}
      Stage 3: results -> concise answer
  - Neo4j for:
      Stage 2: weighted ranking query (or near-famous-school traversal)

The beta Ask AI endpoint (/api/rag-chat) is NOT touched by this module.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

import requests


SCORE_DIMS: list[str] = [
    "score_mrt",
    "score_food",
    "score_shopping",
    "score_school_proximity",
    "score_school_quality",
    "score_famous_school",
    "score_size",
    "score_floor",
    "score_lease",
    "score_quietness",
    "score_value",
    "score_orientation",
]

_FILTER_KEYS = {
    "flat_type",
    "town",
    "flat_model",
    "min_floor_area",
    "max_resale_price",
    "min_lease_years",
    "max_dist_mrt_m",
    "require_famous_school",
    "school_name",  # for near_famous_school
}


_CYPHER_SEARCH = """\
MATCH (p:Property)
WHERE ($flat_type    IS NULL OR p.flat_type    IN $flat_type)
  AND ($town         IS NULL OR p.town         IN $town)
  AND ($flat_model   IS NULL OR p.flat_model   IN $flat_model)
  AND ($min_floor_area   IS NULL OR p.floor_area_sqm       >= $min_floor_area)
  AND ($max_resale_price IS NULL OR p.resale_price          <= $max_resale_price)
  AND ($min_lease_years  IS NULL OR p.lease_remaining_years >= $min_lease_years)
  AND ($max_dist_mrt_m   IS NULL OR p.dist_to_mrt_m         <= $max_dist_mrt_m)
  AND (NOT $require_famous_school OR p.famous_school_count_1km > 0)
WITH p,
  round(
    (
      $w_score_mrt              * coalesce(p.score_mrt, 5.0) +
      $w_score_food             * coalesce(p.score_food, 5.0) +
      $w_score_shopping         * coalesce(p.score_shopping, 5.0) +
      $w_score_school_proximity * coalesce(p.score_school_proximity, 5.0) +
      $w_score_school_quality   * coalesce(p.score_school_quality, 5.0) +
      $w_score_famous_school    * coalesce(p.score_famous_school, 5.0) +
      $w_score_size             * coalesce(p.score_size, 5.0) +
      $w_score_floor            * coalesce(p.score_floor, 5.0) +
      $w_score_lease            * coalesce(p.score_lease, 5.0) +
      $w_score_quietness        * coalesce(p.score_quietness, 5.0) +
      $w_score_value            * coalesce(p.score_value, 5.0) +
      $w_score_orientation      * coalesce(p.score_orientation, 5.0)
    ) / $total_weight,
  4) AS composite_score
ORDER BY composite_score DESC
LIMIT $top_k
RETURN p {.*} AS props, composite_score
"""

_NEAR_SCHOOL_CYPHER = """\
MATCH (p:Property)-[r:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool {name: $school_name})
RETURN p.address_key       AS address_key,
       p.town               AS town,
       p.flat_type          AS flat_type,
       p.flat_model         AS flat_model,
       p.floor_area_sqm     AS floor_area_sqm,
       p.resale_price       AS resale_price,
       p.lease_remaining_years AS lease_remaining_years,
       p.dist_to_mrt_m      AS dist_to_mrt_m,
       p.score_famous_school AS score_famous_school,
       r.distance_km        AS dist_to_nearest_famous_school_km,
       s.name               AS nearest_famous_school_name
ORDER BY r.distance_km ASC
LIMIT $top_k
"""


_STAGE1_SYSTEM = """\
You are a parameter extractor for a Singapore HDB property search engine.
Given a user query, output a JSON object with EXACTLY these keys:

"weights": dict mapping score dimensions to importance (0-10). Only include dimensions the user cares about.
  Valid dimensions: score_mrt, score_food, score_shopping, score_school_proximity,
  score_school_quality, score_famous_school, score_size, score_floor,
  score_lease, score_quietness, score_value, score_orientation

"filters": dict of hard constraints. Valid keys:
  flat_type (e.g. "4 ROOM"), town (e.g. "BISHAN"),
  flat_model (e.g. "Model A"), min_floor_area (number, sqm),
  max_resale_price (number, SGD), min_lease_years (number),
  max_dist_mrt_m (number, metres), require_famous_school (true/false),
  school_name (only for near_famous_school queries)

"special_query_type": null OR "near_famous_school" (when user asks about a specific school)

Output ONLY the JSON object. No explanation. No markdown fences."""

_STAGE1_EXAMPLES = """\
Examples:

Query: "Find a 4-room flat in Bishan near famous schools under $900k"
Output: {"weights": {"score_famous_school": 10, "score_mrt": 5, "score_value": 7}, "filters": {"flat_type": "4 ROOM", "town": "BISHAN", "max_resale_price": 900000}, "special_query_type": null}

Query: "I want a quiet large flat with good lease left, not too expensive"
Output: {"weights": {"score_quietness": 9, "score_size": 8, "score_lease": 8, "score_value": 7}, "filters": {}, "special_query_type": null}

Query: "Show me flats near Nanyang Primary School"
Output: {"weights": {"score_famous_school": 10}, "filters": {"school_name": "NANYANG PRIMARY SCHOOL"}, "special_query_type": "near_famous_school"}

Query: "5-room flat in Tampines, at least 90sqm, close to MRT, budget $700k"
Output: {"weights": {"score_mrt": 9, "score_size": 6, "score_value": 7}, "filters": {"flat_type": "5 ROOM", "town": "TAMPINES", "min_floor_area": 90, "max_resale_price": 700000}, "special_query_type": null}

Now extract parameters for this query:
"""

_STAGE3_SYSTEM = """\
You are a Singapore HDB market analyst.

The "Search results" below are HISTORICAL COMPARABLE SALES from the HDB
resale registry — NOT current listings for sale. Each entry shows the most
recent transaction at that address, with the year of sale. Treat them as
price evidence and pattern signals, not as inventory the user can purchase.

Answer the user's question in 2-3 sentences:
 - Reference specific past sales by address, year, and price (not generic
   placeholders).
 - When prices come up, always pair them with the year of the sale
   ("sold in 2024 for $828,000").
 - If the user asks "where can I buy" or "are these for sale", clarify that
   these are historical comps and suggest they browse PropertyGuru or 99.co
   for live listings.
 - NEVER invent addresses, blocks, prices, or years not present in the
   results below. If the results are empty, say so plainly.
 - Be concise. No marketing language."""

_STAGE3_USER = """\
Search results:
{context}

User question: {query}

Answer:"""


@dataclass(frozen=True)
class PropertySearchRagResult:
    answer: str
    params: dict[str, Any]
    rows: list[dict[str, Any]]
    raw_stage1: str


def _ollama_base_url() -> str:
    # Match backend/chat.py defaults and allow overriding.
    return os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL", "gemma3").strip() or "gemma3"


def _neo4j_creds() -> dict[str, str | None]:
    # Support both naming conventions used across the repo and notebooks.
    return {
        "uri": os.environ.get("NEO4J_URI"),
        "user": os.environ.get("NEO4J_USERNAME") or os.environ.get("NEO4J_USER"),
        "password": os.environ.get("NEO4J_PASSWORD"),
        "database": os.environ.get("NEO4J_DATABASE"),
    }


def _build_gemma_prompt(system: str, user: str) -> str:
    return f"[INST] {system.strip()}\n\n{user.strip()} [/INST]"


def _ollama_generate(prompt: str, *, timeout_s: int = 120) -> str:
    url = f"{_ollama_base_url()}/api/generate"
    payload = {
        "model": _ollama_model(),
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3},
    }
    resp = requests.post(url, json=payload, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json() or {}
    return (data.get("response") or "").strip()


_JSON_OBJ_RE = re.compile(r"\{[\s\S]*\}")


def _safe_parse_json_object(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    m = _JSON_OBJ_RE.search(raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _last_params_from_history(history: list[dict] | None) -> dict[str, Any] | None:
    """Extract the most recent assistant params object from UI-sent history."""
    if not history:
        return None
    for turn in reversed(history):
        if not isinstance(turn, dict):
            continue
        if (turn.get("role") or "").lower() != "assistant":
            continue
        params = turn.get("params")
        if isinstance(params, dict) and ("weights" in params or "filters" in params):
            return params
    return None


def _history_snippet(history: list[dict] | None, *, max_turns: int = 6, max_chars: int = 1200) -> str:
    if not history:
        return ""
    turns: list[str] = []
    for t in history[-max_turns:]:
        if not isinstance(t, dict):
            continue
        role = (t.get("role") or "").lower()
        content = t.get("content") or t.get("text") or ""
        if not isinstance(content, str):
            continue
        content = " ".join(content.split()).strip()
        if not content:
            continue
        if role not in ("user", "assistant"):
            role = "user"
        turns.append(f"{role}: {content}")
    s = "\n".join(turns).strip()
    return s[:max_chars]


def extract_search_params(query: str, history: list[dict] | None = None) -> tuple[dict[str, Any], str]:
    prior = _last_params_from_history(history)
    hist_snip = _history_snippet(history)
    extra = ""
    if prior:
        try:
            extra += f"\n\nPrevious params (carry over unless user changes them):\n{json.dumps(prior)}"
        except Exception:
            pass
    if hist_snip:
        extra += f"\n\nConversation (most recent turns):\n{hist_snip}"

    prompt = _build_gemma_prompt(_STAGE1_SYSTEM, _STAGE1_EXAMPLES + (query or "") + extra)
    raw = _ollama_generate(prompt, timeout_s=120)
    obj = _safe_parse_json_object(raw)
    if not obj:
        # fallback to a sensible default; keep shape stable
        return (
            {
                "weights": {"score_mrt": 5.0, "score_value": 5.0, "score_size": 5.0},
                "filters": {},
                "special_query_type": None,
            },
            raw,
        )

    weights_in = obj.get("weights") if isinstance(obj.get("weights"), dict) else {}
    filters_in = obj.get("filters") if isinstance(obj.get("filters"), dict) else {}
    sqt = obj.get("special_query_type")
    special_query_type = sqt if sqt in (None, "near_famous_school") else None

    weights: dict[str, float] = {}
    for k, v in (weights_in or {}).items():
        if k not in SCORE_DIMS:
            continue
        try:
            weights[k] = float(_clamp(float(v), 0.0, 10.0))
        except Exception:
            continue

    filters: dict[str, Any] = {}
    for k, v in (filters_in or {}).items():
        if k not in _FILTER_KEYS:
            continue
        if v is None:
            continue
        filters[k] = v

    # Normalize casing for Cypher equality / IN comparisons
    for key in ("town", "flat_type", "flat_model", "school_name"):
        if key in filters and isinstance(filters[key], str):
            filters[key] = filters[key].strip().upper()

    # Type normalization for numeric filters
    for key in ("min_floor_area", "max_resale_price", "min_lease_years", "max_dist_mrt_m"):
        if key in filters:
            try:
                filters[key] = float(filters[key])
            except Exception:
                filters.pop(key, None)

    if "require_famous_school" in filters:
        filters["require_famous_school"] = bool(filters["require_famous_school"])

    return (
        {"weights": weights, "filters": filters, "special_query_type": special_query_type},
        raw,
    )


def _to_list_or_none(val: Any) -> list[str] | None:
    if val is None:
        return None
    if isinstance(val, (list, tuple)):
        return [str(v).upper() for v in val]
    return [str(val).upper()]


def _neo4j_driver():
    from neo4j import GraphDatabase

    creds = _neo4j_creds()
    if not creds["uri"] or not creds["user"] or not creds["password"]:
        raise ValueError(
            "Neo4j credentials missing. Set NEO4J_URI, NEO4J_USER/NEO4J_USERNAME, NEO4J_PASSWORD."
        )
    return GraphDatabase.driver(creds["uri"], auth=(creds["user"], creds["password"]))


def retrieve_properties(params: dict[str, Any], *, top_k: int = 5) -> list[dict[str, Any]]:
    from neo4j.exceptions import Neo4jError

    filters = params.get("filters") or {}
    weights_in = params.get("weights") or {}
    special_query_type = params.get("special_query_type")

    driver = _neo4j_driver()
    creds = _neo4j_creds()
    database = creds.get("database")

    try:
        # Neo4j python driver accepts session(database=...) only when non-empty.
        # AuraDB often uses the default database, so keep it optional.
        sess_kwargs = {"database": database} if database else {}
        with driver.session(**sess_kwargs) as session:
            if special_query_type == "near_famous_school":
                school_name = filters.get("school_name")
                if not school_name:
                    return []
                result = session.run(_NEAR_SCHOOL_CYPHER, school_name=str(school_name), top_k=int(top_k))
                return [dict(r) for r in result]

            active = {
                k: float(v)
                for k, v in weights_in.items()
                if k in SCORE_DIMS and float(v) > 0
            }
            total_w = sum(active.values()) if active else 1.0
            weight_params = {f"w_{s}": active.get(s, 0.0) for s in SCORE_DIMS}
            cypher_params = {
                **weight_params,
                "total_weight": float(total_w),
                "top_k": int(top_k),
                "flat_type": _to_list_or_none(filters.get("flat_type")),
                "town": _to_list_or_none(filters.get("town")),
                "flat_model": _to_list_or_none(filters.get("flat_model")),
                "min_floor_area": filters.get("min_floor_area"),
                "max_resale_price": filters.get("max_resale_price"),
                "min_lease_years": filters.get("min_lease_years"),
                "max_dist_mrt_m": filters.get("max_dist_mrt_m"),
                "require_famous_school": bool(filters.get("require_famous_school", False)),
            }
            result = session.run(_CYPHER_SEARCH, **cypher_params)
            rows: list[dict[str, Any]] = []
            for r in result:
                props = dict(r.get("props") or {})
                props["composite_score"] = r.get("composite_score")
                rows.append(props)
            return rows
    except Neo4jError:
        raise
    finally:
        driver.close()


def _format_rows_for_context(rows: list[dict[str, Any]], limit: int = 5) -> str:
    if not rows:
        return "(no results)"
    lines: list[str] = []
    for r in rows[:limit]:
        addr = r.get("address_key") or f"BLK {r.get('block','')} {r.get('street_name','')}".strip()
        town = r.get("town") or ""
        flat_type = r.get("flat_type") or ""
        price = r.get("resale_price")
        area = r.get("floor_area_sqm")
        lease = r.get("lease_remaining_years")
        mrt = r.get("dist_to_mrt_m")
        school = r.get("nearest_famous_school_name") or ""
        dist_school = r.get("dist_to_nearest_famous_school_km")
        score = r.get("composite_score")
        bits = [
            f"address={addr}",
            f"town={town}",
            f"type={flat_type}",
        ]
        if price is not None:
            bits.append(f"price={price}")
        if area is not None:
            bits.append(f"area_sqm={area}")
        if lease is not None:
            bits.append(f"lease_years={lease}")
        if mrt is not None:
            bits.append(f"mrt_m={mrt}")
        if school:
            bits.append(f"famous_school={school}")
        if dist_school is not None:
            bits.append(f"school_km={dist_school}")
        if score is not None:
            bits.append(f"composite={score}")
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def summarize_results(query: str, rows: list[dict[str, Any]]) -> str:
    context = _format_rows_for_context(rows, limit=5)
    user = _STAGE3_USER.format(context=context, query=query)
    prompt = _build_gemma_prompt(_STAGE3_SYSTEM, user)
    return _ollama_generate(prompt, timeout_s=180)


def format_rows_markdown(
    rows: list[dict[str, Any]],
    limit: int = 5,
    *,
    searched_school: str | None = None,
) -> str:
    """Render Cypher rows as historical-comparable-sale lines.

    Every row is a past transaction (the most recent sale per address). The
    formatter makes that explicit by leading with `sold YYYY for $X` rather
    than a bare price (which reads as a current asking price). The composite
    `score` field is intentionally omitted — surfacing it to the LLM
    encourages "ranked listings" framing; the comp evidence stands on its own.

    When `searched_school` is provided (special "near famous school" path),
    every row's school tag explicitly anchors on that searched school so the
    user sees "0.3 km from POI CHING SCHOOL" instead of the property's
    truly-nearest school which may be a different one. If the property's
    `nearest_famous_school_name` differs from the searched school, that's
    appended as a small qualifier so the user retains the secondary signal.
    """
    if not rows:
        return "_No matching historical sales found with the inferred filters._"
    lines: list[str] = []
    for i, r in enumerate(rows[:limit], start=1):
        addr = r.get("address_key") or f"BLK {r.get('block','')} {r.get('street_name','')}".strip()
        town = r.get("town") or ""
        flat_type = r.get("flat_type") or ""
        price = r.get("resale_price")
        year = r.get("transaction_year")
        area = r.get("floor_area_sqm")
        lease = r.get("lease_remaining_years")
        mrt = r.get("dist_to_mrt_m")
        school = r.get("nearest_famous_school_name")
        dk = r.get("dist_to_nearest_famous_school_km")

        # Headline: address + the past sale event
        sale_label = None
        if price is not None and year is not None:
            try:
                sale_label = f"sold {int(year)} for ${float(price):,.0f}"
            except (TypeError, ValueError):
                sale_label = f"sold {year} for ${price}"
        elif price is not None:
            try:
                sale_label = f"last sale ${float(price):,.0f}"
            except (TypeError, ValueError):
                sale_label = f"last sale ${price}"

        parts = [f"- **{i}. {addr}**"]
        if sale_label:
            parts.append(f" — _{sale_label}_")

        meta = []
        if town:
            meta.append(town)
        if flat_type:
            meta.append(flat_type)
        if area is not None:
            try:
                meta.append(f"{int(round(float(area)))} sqm")
            except (TypeError, ValueError):
                meta.append(f"{area} sqm")
        if lease is not None:
            try:
                meta.append(f"lease {int(round(float(lease)))}y")
            except (TypeError, ValueError):
                meta.append(f"lease {lease}y")
        if mrt is not None:
            try:
                meta.append(f"MRT {int(round(float(mrt)))}m")
            except (TypeError, ValueError):
                meta.append(f"MRT {mrt}m")
        if searched_school:
            # Special path: anchor on the searched school explicitly. dk in
            # this path is the distance to the SEARCHED school (per the
            # _NEAR_SCHOOL_CYPHER `r.distance_km AS dist_to_nearest_famous_school_km`),
            # not necessarily the property's overall nearest.
            if dk is not None:
                try:
                    meta.append(f"{float(dk):.1f} km from {searched_school}")
                except (TypeError, ValueError):
                    meta.append(f"near {searched_school}")
            else:
                meta.append(f"near {searched_school}")
            # If the property's truly-nearest famous school is a different
            # one, surface it as a small secondary signal.
            if school and school.strip().upper() != searched_school.strip().upper():
                meta.append(f"closest fam. school: {school}")
        elif school:
            if dk is not None:
                try:
                    meta.append(f"near {school} ({float(dk):.1f} km)")
                except (TypeError, ValueError):
                    meta.append(f"near {school} ({dk} km)")
            else:
                meta.append(f"near {school}")
        if meta:
            parts.append("  \n  " + " · ".join(meta))
        lines.append("".join(parts))
    return "\n".join(lines)


def run_property_search_rag(query: str, history: list[dict] | None = None, *, top_k: int = 5) -> PropertySearchRagResult:
    params, raw_stage1 = extract_search_params(query, history)
    rows = retrieve_properties(params, top_k=top_k)
    answer = summarize_results(query, rows) if rows else "I couldn’t find matching properties in the database for that query."
    return PropertySearchRagResult(answer=answer, params=params, rows=rows, raw_stage1=raw_stage1)


_GRAPH_COUNTS_CYPHER = {
    "property_count": "MATCH (p:Property) RETURN count(p) AS n",
    "town_count": "MATCH (t:Town) RETURN count(t) AS n",
    "famous_school_count": "MATCH (s:FamousSchool) RETURN count(s) AS n",
    "nearest_rel_count": "MATCH ()-[r:NEAREST_FAMOUS_SCHOOL]->() RETURN count(r) AS n",
    "near_rel_count": "MATCH ()-[r:NEAR_FAMOUS_SCHOOL]->() RETURN count(r) AS n",
}

_GRAPH_TOWNS_CYPHER = """\
MATCH (t:Town)
OPTIONAL MATCH (t)<-[:LOCATED_IN]-(p:Property)
RETURN t.name AS town,
       count(p) AS property_count,
       avg(p.resale_price) AS avg_resale_price,
       avg(p.dist_to_mrt_m) AS avg_dist_to_mrt_m
ORDER BY property_count DESC
"""

_GRAPH_SCHOOLS_CYPHER = """\
MATCH (s:FamousSchool)
OPTIONAL MATCH (s)<-[:NEAREST_FAMOUS_SCHOOL]-(np:Property)
OPTIONAL MATCH (s)<-[:NEAR_FAMOUS_SCHOOL]-(near:Property)
RETURN s.name AS school,
       count(DISTINCT np)   AS nearest_property_count,
       count(DISTINCT near) AS near_property_count
ORDER BY near_property_count DESC
"""

_GRAPH_EDGES_CYPHER = """\
MATCH (t:Town)<-[:LOCATED_IN]-(p:Property)-[:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool)
WITH t.name AS town, s.name AS school, count(p) AS weight
ORDER BY weight DESC
LIMIT 200
RETURN town, school, weight
"""

_GRAPH_SAMPLE_CYPHER = """\
MATCH (p:Property)
RETURN p.address_key AS address_key,
       p.town        AS town,
       p.flat_type   AS flat_type,
       p.resale_price AS resale_price,
       p.lease_remaining_years AS lease_remaining_years,
       p.dist_to_mrt_m AS dist_to_mrt_m,
       p.score_mrt          AS score_mrt,
       p.score_famous_school AS score_famous_school,
       p.score_value        AS score_value
LIMIT 20
"""


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f


def _as_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def get_property_search_graph_data() -> dict[str, Any]:
    """Aggregate a schema-level view of the Property Search Neo4j graph.

    Returns Town + FamousSchool nodes with counts, Town↔FamousSchool edges
    weighted by how many flats share each (town, school) pair, and a small
    sample of Property rows. Property nodes themselves are NOT returned
    individually — at ~9.7k rows they would swamp the force-graph.
    """
    driver = _neo4j_driver()
    creds = _neo4j_creds()
    database = creds.get("database")
    sess_kwargs = {"database": database} if database else {}

    try:
        with driver.session(**sess_kwargs) as session:
            stats: dict[str, int] = {}
            for key, cypher in _GRAPH_COUNTS_CYPHER.items():
                row = session.run(cypher).single()
                stats[key] = _as_int(row["n"]) if row else 0

            town_rows = list(session.run(_GRAPH_TOWNS_CYPHER))
            school_rows = list(session.run(_GRAPH_SCHOOLS_CYPHER))
            edge_rows = list(session.run(_GRAPH_EDGES_CYPHER))
            sample_rows = list(session.run(_GRAPH_SAMPLE_CYPHER))
    finally:
        driver.close()

    nodes: list[dict[str, Any]] = []
    for r in town_rows:
        name = r["town"]
        if not name:
            continue
        nodes.append({
            "id": f"town:{name}",
            "type": "Town",
            "label": str(name),
            "property_count": _as_int(r["property_count"]),
            "avg_resale_price": _as_float(r["avg_resale_price"]),
            "avg_dist_to_mrt_m": _as_float(r["avg_dist_to_mrt_m"]),
        })
    for r in school_rows:
        name = r["school"]
        if not name:
            continue
        nodes.append({
            "id": f"school:{name}",
            "type": "FamousSchool",
            "label": str(name),
            "nearest_property_count": _as_int(r["nearest_property_count"]),
            "near_property_count": _as_int(r["near_property_count"]),
        })

    links: list[dict[str, Any]] = []
    for r in edge_rows:
        town = r["town"]
        school = r["school"]
        if not town or not school:
            continue
        links.append({
            "source": f"town:{town}",
            "target": f"school:{school}",
            "type": "NEAR",
            "weight": _as_int(r["weight"]),
        })

    sample_properties: list[dict[str, Any]] = []
    for r in sample_rows:
        sample_properties.append({
            "address_key": r["address_key"],
            "town": r["town"],
            "flat_type": r["flat_type"],
            "resale_price": _as_float(r["resale_price"]),
            "lease_remaining_years": _as_float(r["lease_remaining_years"]),
            "dist_to_mrt_m": _as_float(r["dist_to_mrt_m"]),
            "score_mrt": _as_float(r["score_mrt"]),
            "score_famous_school": _as_float(r["score_famous_school"]),
            "score_value": _as_float(r["score_value"]),
        })

    return {
        "ok": True,
        "stats": stats,
        "nodes": nodes,
        "links": links,
        "sample_properties": sample_properties,
    }

