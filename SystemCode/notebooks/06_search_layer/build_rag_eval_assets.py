from __future__ import annotations

import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

import nbformat as nbf
import pandas as pd

from yc_property_search import Neo4jPropertySearch, default_kb_path


ARTIFACT_DATE = date.today().strftime("%Y%m%d")
LAYER_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = LAYER_DIR / "artifacts"
GOLDEN_SET_PATH = ARTIFACT_DIR / f"rag_search_gemma_golden_set_{ARTIFACT_DATE}.json"
NOTEBOOK_PATH = LAYER_DIR / "04_rag_search_gemma_verification.ipynb"
TOP_K = 5


def _title_case_town(town: str) -> str:
    town = town.replace("/", " / ")
    town = " ".join(part.capitalize() if part != "/" else "/" for part in town.split())
    return town.replace(" / ", "/")


def _budget_phrase(value: float) -> str:
    return f"${int(round(value / 1000.0))}k"


def _score_result_rows(results: pd.DataFrame) -> list[dict[str, Any]]:
    if results.empty:
        return []

    cols = [
        "address_key",
        "town",
        "flat_type",
        "resale_price",
        "floor_area_sqm",
        "lease_remaining_years",
        "dist_to_mrt_m",
        "dist_to_nearest_famous_school_km",
        "nearest_famous_school_name",
        "composite_score",
    ]
    keep = [col for col in cols if col in results.columns]
    rows = results[keep].head(TOP_K).copy()
    cleaned: list[dict[str, Any]] = []
    for record in rows.to_dict(orient="records"):
        cleaned.append(
            {
                key: (round(val, 4) if isinstance(val, float) else val)
                for key, val in record.items()
            }
        )
    return cleaned


def _graph_result_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for record in records[:TOP_K]:
        cleaned.append(
            {
                key: (round(val, 4) if isinstance(val, float) else val)
                for key, val in record.items()
            }
        )
    return cleaned


def _positive_case_payload(
    *,
    case_id: str,
    category: str,
    question: str,
    params: dict[str, Any],
    expected_rows: list[dict[str, Any]],
    search_mode: str,
    notes: str,
) -> dict[str, Any]:
    top_addresses = [row["address_key"] for row in expected_rows if row.get("address_key")]
    top_towns = list(dict.fromkeys(row["town"] for row in expected_rows if row.get("town")))
    top_schools = list(
        dict.fromkeys(
            row["nearest_famous_school_name"]
            for row in expected_rows
            if row.get("nearest_famous_school_name")
        )
    )

    answer_anchors = []
    if top_towns:
        answer_anchors.append(top_towns[0])
    if top_schools:
        answer_anchors.append(top_schools[0])
    answer_anchors.extend(top_addresses[:2])

    return {
        "id": case_id,
        "category": category,
        "question": question,
        "top_k": TOP_K,
        "search_mode": search_mode,
        "query_type": "positive",
        "params": params,
        "expected": {
            "result_count": len(expected_rows),
            "top_addresses": top_addresses,
            "top_towns": top_towns,
            "top_schools": top_schools,
            "top_rows": expected_rows,
            "answer_anchors": answer_anchors,
        },
        "notes": notes,
    }


def _negative_case_payload(
    *,
    case_id: str,
    category: str,
    question: str,
    params: dict[str, Any],
    search_mode: str,
    notes: str,
) -> dict[str, Any]:
    return {
        "id": case_id,
        "category": category,
        "question": question,
        "top_k": TOP_K,
        "search_mode": search_mode,
        "query_type": "negative",
        "params": params,
        "expected": {
            "result_count": 0,
            "top_addresses": [],
            "top_towns": [],
            "top_schools": [],
            "top_rows": [],
            "answer_anchors": ["No matching properties were found"],
        },
        "notes": notes,
    }


def _run_standard_case(
    neo: Neo4jPropertySearch,
    *,
    weights: dict[str, float],
    filters: dict[str, Any],
) -> pd.DataFrame:
    return neo.search(weights=weights, filters=filters, top_k=TOP_K)


def _run_school_case(
    neo: Neo4jPropertySearch,
    *,
    school_name: str,
) -> list[dict[str, Any]]:
    cypher = """\
MATCH (p:Property)-[r:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool {name: $school_name})
RETURN p.address_key AS address_key,
       p.town AS town,
       p.flat_type AS flat_type,
       p.resale_price AS resale_price,
       p.floor_area_sqm AS floor_area_sqm,
       p.lease_remaining_years AS lease_remaining_years,
       p.dist_to_mrt_m AS dist_to_mrt_m,
       p.nearest_famous_school_name AS nearest_famous_school_name,
       r.distance_km AS dist_to_nearest_famous_school_km
ORDER BY r.distance_km ASC, p.resale_price ASC
LIMIT $top_k
"""
    return neo.graph_query(cypher, school_name=school_name, top_k=TOP_K)


def _append_case(cases: list[dict[str, Any]], case: dict[str, Any]) -> None:
    seen_ids = {item["id"] for item in cases}
    if case["id"] in seen_ids:
        raise ValueError(f"Duplicate golden case id: {case['id']}")
    seen_questions = {item["question"] for item in cases}
    if case["question"] in seen_questions:
        raise ValueError(f"Duplicate golden question: {case['question']}")
    cases.append(case)


def build_golden_cases(kb: pd.DataFrame, neo: Neo4jPropertySearch) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    case_index = 1

    group_counts = (
        kb.groupby(["town", "flat_type"])
        .size()
        .rename("property_count")
        .reset_index()
        .sort_values(["property_count", "town", "flat_type"], ascending=[False, True, True])
    )
    large_groups = [row for row in group_counts.to_dict("records") if row["property_count"] >= 20]
    school_groups = []
    for row in large_groups:
        subset = kb[
            (kb["town"] == row["town"])
            & (kb["flat_type"] == row["flat_type"])
            & (kb["famous_school_count_1km"] > 0)
        ]
        if len(subset) >= 10:
            row = dict(row)
            row["school_ready_count"] = int(len(subset))
            school_groups.append(row)

    for row in large_groups[:20]:
        subset = kb[(kb["town"] == row["town"]) & (kb["flat_type"] == row["flat_type"])]
        budget = float(subset["resale_price"].quantile(0.65))
        budget = max(250_000.0, round(budget / 10_000.0) * 10_000.0)
        question = (
            f"Find a {row['flat_type'].lower()} flat in {_title_case_town(row['town'])} "
            f"near MRT under {_budget_phrase(budget)}"
        )
        params = {
            "weights": {"score_mrt": 9.0, "score_value": 7.0},
            "filters": {
                "town": row["town"],
                "flat_type": row["flat_type"],
                "max_resale_price": budget,
            },
            "special_query_type": None,
        }
        results = _run_standard_case(neo, weights=params["weights"], filters=params["filters"])
        if results.empty:
            continue
        _append_case(
            cases,
            _positive_case_payload(
                case_id=f"Q{case_index:03d}",
                category="mrt_budget",
                question=question,
                params=params,
                expected_rows=_score_result_rows(results),
                search_mode="standard",
                notes="Weighted retrieval focused on MRT access and affordability.",
            ),
        )
        case_index += 1

    for row in school_groups[:20]:
        subset = kb[
            (kb["town"] == row["town"])
            & (kb["flat_type"] == row["flat_type"])
            & (kb["famous_school_count_1km"] > 0)
        ]
        budget = float(subset["resale_price"].quantile(0.70))
        budget = max(300_000.0, round(budget / 10_000.0) * 10_000.0)
        question = (
            f"Find a {row['flat_type'].lower()} flat in {_title_case_town(row['town'])} "
            f"with famous school access under {_budget_phrase(budget)}"
        )
        params = {
            "weights": {"score_famous_school": 10.0, "score_value": 6.0, "score_mrt": 4.0},
            "filters": {
                "town": row["town"],
                "flat_type": row["flat_type"],
                "require_famous_school": True,
                "max_resale_price": budget,
            },
            "special_query_type": None,
        }
        results = _run_standard_case(neo, weights=params["weights"], filters=params["filters"])
        if results.empty:
            continue
        _append_case(
            cases,
            _positive_case_payload(
                case_id=f"Q{case_index:03d}",
                category="famous_school_budget",
                question=question,
                params=params,
                expected_rows=_score_result_rows(results),
                search_mode="standard",
                notes="Weighted retrieval focused on famous school proximity with a budget cap.",
            ),
        )
        case_index += 1

    for row in large_groups[:20]:
        subset = kb[(kb["town"] == row["town"]) & (kb["flat_type"] == row["flat_type"])]
        min_area = float(subset["floor_area_sqm"].quantile(0.55))
        min_lease = float(subset["lease_remaining_years"].quantile(0.45))
        question = (
            f"I want a quiet {row['flat_type'].lower()} flat in {_title_case_town(row['town'])} "
            f"with at least {int(round(min_area))} sqm and at least {int(round(min_lease))} years lease left"
        )
        params = {
            "weights": {
                "score_quietness": 9.0,
                "score_size": 8.0,
                "score_lease": 7.0,
            },
            "filters": {
                "town": row["town"],
                "flat_type": row["flat_type"],
                "min_floor_area": max(40.0, round(min_area)),
                "min_lease_years": max(40.0, round(min_lease)),
            },
            "special_query_type": None,
        }
        results = _run_standard_case(neo, weights=params["weights"], filters=params["filters"])
        if results.empty:
            continue
        _append_case(
            cases,
            _positive_case_payload(
                case_id=f"Q{case_index:03d}",
                category="quiet_size_lease",
                question=question,
                params=params,
                expected_rows=_score_result_rows(results),
                search_mode="standard",
                notes="Weighted retrieval balancing quietness, size, and lease remaining.",
            ),
        )
        case_index += 1

    commuter_candidates = []
    for row in large_groups:
        subset = kb[(kb["town"] == row["town"]) & (kb["flat_type"] == row["flat_type"])]
        if subset["dist_to_mrt_m"].notna().sum() < 20:
            continue
        commuter_candidates.append(row)
        if len(commuter_candidates) == 20:
            break

    for row in commuter_candidates:
        subset = kb[(kb["town"] == row["town"]) & (kb["flat_type"] == row["flat_type"])]
        min_area = float(subset["floor_area_sqm"].quantile(0.35))
        max_mrt = float(subset["dist_to_mrt_m"].quantile(0.50))
        budget = float(subset["resale_price"].quantile(0.75))
        max_mrt = max(150.0, round(max_mrt / 50.0) * 50.0)
        budget = max(250_000.0, round(budget / 10_000.0) * 10_000.0)
        question = (
            f"Show me a {row['flat_type'].lower()} flat in {_title_case_town(row['town'])} "
            f"with at least {int(round(min_area))} sqm, within {int(max_mrt)}m of MRT, "
            f"and under {_budget_phrase(budget)}"
        )
        params = {
            "weights": {"score_mrt": 9.0, "score_size": 7.0, "score_value": 6.0},
            "filters": {
                "town": row["town"],
                "flat_type": row["flat_type"],
                "min_floor_area": max(40.0, round(min_area)),
                "max_dist_mrt_m": max_mrt,
                "max_resale_price": budget,
            },
            "special_query_type": None,
        }
        results = _run_standard_case(neo, weights=params["weights"], filters=params["filters"])
        if results.empty:
            continue
        _append_case(
            cases,
            _positive_case_payload(
                case_id=f"Q{case_index:03d}",
                category="mrt_size_budget",
                question=question,
                params=params,
                expected_rows=_score_result_rows(results),
                search_mode="standard",
                notes="Filter-heavy commuter query with area, MRT distance, and budget constraints.",
            ),
        )
        case_index += 1

    school_rows = neo.graph_query(
        """
MATCH (p:Property)-[r:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool)
RETURN s.name AS school, count(*) AS near_count
ORDER BY near_count DESC, school ASC
"""
    )
    for row in school_rows[:15]:
        school_name = row["school"]
        question = f"Show me flats near {school_name}"
        params = {
            "weights": {"score_famous_school": 10.0},
            "filters": {"school_name": school_name},
            "special_query_type": "near_famous_school",
        }
        records = _run_school_case(neo, school_name=school_name)
        if not records:
            continue
        _append_case(
            cases,
            _positive_case_payload(
                case_id=f"Q{case_index:03d}",
                category="near_school_graph",
                question=question,
                params=params,
                expected_rows=_graph_result_rows(records),
                search_mode="near_famous_school",
                notes="Graph traversal query using the NEAR_FAMOUS_SCHOOL relationship.",
            ),
        )
        case_index += 1

    negative_specs = [
        {
            "question": "Find a 3 room flat in Bishan under $100k",
            "params": {
                "weights": {"score_value": 9.0, "score_mrt": 5.0},
                "filters": {"town": "BISHAN", "flat_type": "3 ROOM", "max_resale_price": 100000.0},
                "special_query_type": None,
            },
        },
        {
            "question": "Find a 5 room flat in Bukit Timah under $200k",
            "params": {
                "weights": {"score_value": 9.0, "score_size": 7.0},
                "filters": {"town": "BUKIT TIMAH", "flat_type": "5 ROOM", "max_resale_price": 200000.0},
                "special_query_type": None,
            },
        },
        {
            "question": "Find an executive flat in Marine Parade under $250k",
            "params": {
                "weights": {"score_value": 8.0, "score_size": 8.0},
                "filters": {"town": "MARINE PARADE", "flat_type": "EXECUTIVE", "max_resale_price": 250000.0},
                "special_query_type": None,
            },
        },
        {
            "question": "Find a 4 room flat in Central Area with at least 120 sqm and under $300k",
            "params": {
                "weights": {"score_size": 8.0, "score_value": 8.0},
                "filters": {
                    "town": "CENTRAL AREA",
                    "flat_type": "4 ROOM",
                    "min_floor_area": 120.0,
                    "max_resale_price": 300000.0,
                },
                "special_query_type": None,
            },
        },
        {
            "question": "Find a 2 room flat in Bukit Timah within 200m of MRT and under $250k",
            "params": {
                "weights": {"score_mrt": 9.0, "score_value": 8.0},
                "filters": {
                    "town": "BUKIT TIMAH",
                    "flat_type": "2 ROOM",
                    "max_dist_mrt_m": 200.0,
                    "max_resale_price": 250000.0,
                },
                "special_query_type": None,
            },
        },
    ]

    for spec in negative_specs:
        results = _run_standard_case(
            neo,
            weights=spec["params"]["weights"],
            filters=spec["params"]["filters"],
        )
        if not results.empty:
            raise RuntimeError(f"Negative case unexpectedly returned results: {spec['question']}")
        _append_case(
            cases,
            _negative_case_payload(
                case_id=f"Q{case_index:03d}",
                category="no_result",
                question=spec["question"],
                params=spec["params"],
                search_mode="standard",
                notes="Intentionally impossible constraint combination for empty-result handling.",
            ),
        )
        case_index += 1

    if len(cases) != 100:
        raise RuntimeError(f"Expected exactly 100 cases, found {len(cases)}")

    return cases


def build_metadata(neo: Neo4jPropertySearch, cases: list[dict[str, Any]]) -> dict[str, Any]:
    node_counts = neo.node_counts()
    schools = [row["name"] for row in neo.graph_query("MATCH (s:FamousSchool) RETURN s.name AS name ORDER BY name")]
    towns = neo.graph_query(
        """
MATCH (p:Property)
RETURN p.town AS town, count(*) AS property_count
ORDER BY property_count DESC, town ASC
"""
    )
    return {
        "generated_on": str(date.today()),
        "source": "live_neo4j_snapshot",
        "top_k": TOP_K,
        "node_counts": node_counts,
        "famous_schools": schools,
        "town_property_counts": towns,
        "category_counts": dict(Counter(case["category"] for case in cases)),
    }


def create_notebook() -> nbf.NotebookNode:
    nb = nbf.v4.new_notebook()
    nb.metadata["kernelspec"] = {
        "display_name": ".venv/bin/python",
        "language": "python",
        "name": "python3",
    }
    nb.metadata["language_info"] = {
        "name": "python",
        "version": "3.10",
    }

    cells = [
        nbf.v4.new_markdown_cell(
            "# Layer 06 - RAG Search Verification\n\n"
            "This notebook verifies the current `03_rag_search_gemma.ipynb` flow with a fixed 100-case golden set.\n\n"
            "Scope:\n"
            "- Search verification compares stored expected Neo4j retrieval results against fresh Neo4j retrieval results.\n"
            "- Chat verification is an optional groundedness pass that runs only when local Ollama/Gemma is available.\n\n"
            "Rules used for this notebook:\n"
            "- Keep work inside `06_search_layer`\n"
            "- Use `.venv/bin/python`\n"
            "- Treat the golden set as a snapshot baseline of the live graph on the generation date"
        ),
        nbf.v4.new_code_cell(
            "from __future__ import annotations\n\n"
            "import json\n"
            "import re\n"
            "import sys\n"
            "from pathlib import Path\n\n"
            "import pandas as pd\n"
            "from IPython.display import display\n\n"
            "from yc_property_search import Neo4jPropertySearch\n"
            "from yc_rag_search_gemma import PropertyRAGSearchGemma\n\n"
            "print('Python executable:', sys.executable)\n"
            "print('Python version   :', sys.version.split()[0])"
        ),
        nbf.v4.new_code_cell(
            "LAYER_DIR = Path.cwd()\n"
            "if LAYER_DIR.name != '06_search_layer':\n"
            "    LAYER_DIR = LAYER_DIR / '06_search_layer'\n"
            "ARTIFACT_DIR = LAYER_DIR / 'artifacts'\n"
            "golden_paths = sorted(ARTIFACT_DIR.glob('rag_search_gemma_golden_set_*.json'))\n"
            "if not golden_paths:\n"
            "    raise FileNotFoundError(f'No golden set found in {ARTIFACT_DIR}')\n"
            "golden_path = golden_paths[-1]\n"
            "payload = json.loads(golden_path.read_text())\n"
            "golden_cases = payload['cases']\n"
            "golden_meta = payload['metadata']\n"
            "print('Golden set:', golden_path.name)\n"
            "print('Generated :', golden_meta['generated_on'])\n"
            "print('Case count :', len(golden_cases))\n"
            "pd.DataFrame(golden_meta['category_counts'].items(), columns=['category', 'count']).sort_values('category')"
        ),
        nbf.v4.new_markdown_cell(
            "## 1. Neo4j KG Overview\n\n"
            "Use the live graph to confirm that the current database still matches the snapshot used to build the golden set."
        ),
        nbf.v4.new_code_cell(
            "with Neo4jPropertySearch() as neo:\n"
            "    live_node_counts = neo.node_counts()\n"
            "    live_schools = neo.graph_query('MATCH (s:FamousSchool) RETURN s.name AS name ORDER BY name')\n"
            "    live_towns = neo.graph_query('MATCH (p:Property) RETURN p.town AS town, count(*) AS property_count ORDER BY property_count DESC, town ASC')\n\n"
            "print('Golden node counts:', golden_meta['node_counts'])\n"
            "print('Live node counts  :', live_node_counts)\n"
            "print('Node counts match :', golden_meta['node_counts'] == live_node_counts)\n\n"
            "display(pd.DataFrame(live_towns).head(10))\n"
            "display(pd.DataFrame(live_schools, columns=['name']))"
        ),
        nbf.v4.new_markdown_cell(
            "## 2. Search Evaluation\n\n"
            "This section bypasses the LLM and compares expected Stage 2 Neo4j retrieval results with fresh Neo4j retrieval results.\n\n"
            "Metrics:\n"
            "- `exact_top1_match`: first expected address equals first actual address\n"
            "- `top3_recall`: overlap between expected top 3 and actual top 3\n"
            "- `top5_recall`: overlap between expected top 5 and actual top 5\n"
            "- `pass`: strict regression pass for the stored snapshot"
        ),
        nbf.v4.new_code_cell(
            "def run_case(neo: Neo4jPropertySearch, case: dict) -> pd.DataFrame:\n"
            "    params = case['params']\n"
            "    if case['search_mode'] == 'near_famous_school':\n"
            "        school_name = params['filters']['school_name']\n"
            "        cypher = '''\\\n"
            "MATCH (p:Property)-[r:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool {name: $school_name})\n"
            "RETURN p.address_key AS address_key,\n"
            "       p.town AS town,\n"
            "       p.flat_type AS flat_type,\n"
            "       p.resale_price AS resale_price,\n"
            "       p.floor_area_sqm AS floor_area_sqm,\n"
            "       p.lease_remaining_years AS lease_remaining_years,\n"
            "       p.dist_to_mrt_m AS dist_to_mrt_m,\n"
            "       p.nearest_famous_school_name AS nearest_famous_school_name,\n"
            "       r.distance_km AS dist_to_nearest_famous_school_km\n"
            "ORDER BY r.distance_km ASC, p.resale_price ASC\n"
            "LIMIT $top_k\n"
            "'''\n"
            "        rows = neo.graph_query(cypher, school_name=school_name, top_k=case['top_k'])\n"
            "        return pd.DataFrame(rows)\n"
            "    return neo.search(\n"
            "        weights=params['weights'],\n"
            "        filters=params['filters'],\n"
            "        top_k=case['top_k'],\n"
            "    )\n\n"
            "def overlap_ratio(expected: list[str], actual: list[str]) -> float:\n"
            "    if not expected:\n"
            "        return 1.0 if not actual else 0.0\n"
            "    return len(set(expected) & set(actual)) / len(expected)\n\n"
            "def compare_case(neo: Neo4jPropertySearch, case: dict) -> dict:\n"
            "    actual = run_case(neo, case)\n"
            "    expected_addresses = case['expected']['top_addresses']\n"
            "    actual_addresses = actual['address_key'].tolist() if 'address_key' in actual.columns else []\n"
            "    exact_top1_match = (expected_addresses[:1] == actual_addresses[:1])\n"
            "    top3_recall = overlap_ratio(expected_addresses[:3], actual_addresses[:3])\n"
            "    top5_recall = overlap_ratio(expected_addresses[:5], actual_addresses[:5])\n"
            "    expected_empty = case['query_type'] == 'negative'\n"
            "    pass_flag = ((expected_empty and actual.empty) or (not expected_empty and exact_top1_match and top3_recall == 1.0 and top5_recall == 1.0))\n"
            "    return {\n"
            "        'id': case['id'],\n"
            "        'category': case['category'],\n"
            "        'question': case['question'],\n"
            "        'search_mode': case['search_mode'],\n"
            "        'expected_empty': expected_empty,\n"
            "        'actual_count': len(actual),\n"
            "        'expected_top1': expected_addresses[0] if expected_addresses else None,\n"
            "        'actual_top1': actual_addresses[0] if actual_addresses else None,\n"
            "        'exact_top1_match': exact_top1_match,\n"
            "        'top3_recall': top3_recall,\n"
            "        'top5_recall': top5_recall,\n"
            "        'pass': pass_flag,\n"
            "    }\n"
        ),
        nbf.v4.new_code_cell(
            "with Neo4jPropertySearch() as neo:\n"
            "    search_eval = pd.DataFrame(compare_case(neo, case) for case in golden_cases)\n\n"
            "summary = pd.DataFrame([\n"
            "    {\n"
            "        'total_cases': len(search_eval),\n"
            "        'strict_pass_rate': round(search_eval['pass'].mean(), 4),\n"
            "        'top1_accuracy': round(search_eval['exact_top1_match'].mean(), 4),\n"
            "        'avg_top3_recall': round(search_eval['top3_recall'].mean(), 4),\n"
            "        'avg_top5_recall': round(search_eval['top5_recall'].mean(), 4),\n"
            "        'negative_cases': int(search_eval['expected_empty'].sum()),\n"
            "        'positive_cases': int((~search_eval['expected_empty']).sum()),\n"
            "    }\n"
            "])\n"
            "display(summary)\n"
            "display(search_eval.groupby('category')[['pass', 'exact_top1_match', 'top3_recall', 'top5_recall']].mean().reset_index())"
        ),
        nbf.v4.new_code_cell(
            "search_failures = search_eval.loc[~search_eval['pass']].copy()\n"
            "display(search_failures.head(20))\n"
            "print('Failure count:', len(search_failures))"
        ),
        nbf.v4.new_markdown_cell(
            "## 3. Optional Chat Evaluation\n\n"
            "This section verifies the chat layer only. It reuses the evaluated Neo4j search results from Section 2 and calls the Gemma Stage 3 answer generator.\n\n"
            "Groundedness checks are intentionally lightweight because answer wording is generative:\n"
            "- non-empty answer\n"
            "- empty-result cases should use the standard no-match response\n"
            "- positive-result answers should mention at least one stored answer anchor such as the town, school, or top address"
        ),
        nbf.v4.new_code_cell(
            "def ollama_available() -> bool:\n"
            "    try:\n"
            "        import requests\n"
            "        response = requests.get('http://localhost:11434/api/tags', timeout=3)\n"
            "        return response.ok\n"
            "    except Exception:\n"
            "        return False\n\n"
            "OLLAMA_READY = ollama_available()\n"
            "print('Ollama ready:', OLLAMA_READY)"
        ),
        nbf.v4.new_code_cell(
            "def evaluate_chat_case(neo: Neo4jPropertySearch, rag: PropertyRAGSearchGemma, case: dict) -> dict:\n"
            "    actual_results = run_case(neo, case)\n"
            "    answer = rag._stage3_generate_answer(case['question'], actual_results) or ''\n"
            "    anchors = [anchor for anchor in case['expected']['answer_anchors'] if anchor]\n"
            "    anchor_hit = any(anchor.lower() in answer.lower() for anchor in anchors)\n"
            "    empty_case = case['query_type'] == 'negative'\n"
            "    empty_response_ok = ('no matching properties were found' in answer.lower()) if empty_case else None\n"
            "    return {\n"
            "        'id': case['id'],\n"
            "        'category': case['category'],\n"
            "        'results_empty': bool(actual_results.empty),\n"
            "        'answer_non_empty': bool(answer.strip()),\n"
            "        'anchor_hit': anchor_hit,\n"
            "        'empty_response_ok': empty_response_ok,\n"
            "        'pass': (bool(answer.strip()) and ((empty_case and bool(empty_response_ok)) or ((not empty_case) and anchor_hit))),\n"
            "        'answer': answer,\n"
            "    }\n\n"
            "if OLLAMA_READY:\n"
            "    neo = Neo4jPropertySearch()\n"
            "    rag = PropertyRAGSearchGemma(ollama_base_url='http://localhost:11434', top_k_results=5)\n"
            "    try:\n"
            "        chat_eval = pd.DataFrame(evaluate_chat_case(neo, rag, case) for case in golden_cases)\n"
            "    finally:\n"
            "        neo.close()\n"
            "        rag.close()\n"
            "    display(pd.DataFrame([{\n"
            "        'total_cases': len(chat_eval),\n"
            "        'chat_pass_rate': round(chat_eval['pass'].mean(), 4),\n"
            "        'anchor_hit_rate': round(chat_eval['anchor_hit'].mean(), 4),\n"
            "    }]))\n"
            "    display(chat_eval.loc[~chat_eval['pass'], ['id', 'category', 'results_empty', 'anchor_hit', 'empty_response_ok', 'answer']].head(20))\n"
            "else:\n"
            "    print('Ollama/Gemma is not available in this environment, so chat evaluation is skipped.')"
        ),
    ]

    nb.cells = cells
    return nb


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    kb = pd.read_parquet(default_kb_path())

    with Neo4jPropertySearch() as neo:
        cases = build_golden_cases(kb, neo)
        metadata = build_metadata(neo, cases)

    payload = {"metadata": metadata, "cases": cases}
    GOLDEN_SET_PATH.write_text(json.dumps(payload, indent=2))

    notebook = create_notebook()
    NOTEBOOK_PATH.write_text(nbf.writes(notebook))

    print(f"Wrote golden set: {GOLDEN_SET_PATH}")
    print(f"Wrote notebook  : {NOTEBOOK_PATH}")
    print(f"Category counts : {metadata['category_counts']}")


if __name__ == "__main__":
    main()
