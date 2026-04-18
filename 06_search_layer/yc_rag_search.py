"""
yc_rag_search.py
----------------
RAG-based Property Search Module — PropertyLens Layer 06.

Implements a 3-stage pipeline on top of the existing Neo4j weighted search:

  Stage 1 — NL → Search Params:
    TinyLlama extracts { weights, filters, special_query_type } as a validated
    JSON struct from the user's free-text query.

  Stage 2 — Search Execution:
    Routes to Neo4jPropertySearch.search() (standard) or graph_query()
    (graph-traversal for specific famous-school queries).

  Stage 3 — Results → NL Answer:
    TinyLlama summarises the top-k property results into a plain-English answer.

Usage
-----
    from yc_rag_search import PropertyRAGSearch

    # Option A: let the class load TinyLlama internally
    with PropertyRAGSearch() as rag:
        result = rag.ask("Find a 4-room flat near MRT in Bishan under $900k")
        print(result["answer"])
        print(result["results"])

    # Option B: pass a pre-loaded HuggingFacePipeline (avoids double-loading)
    from langchain_huggingface import HuggingFacePipeline
    local_llm = HuggingFacePipeline(pipeline=hf_pipeline)  # already loaded
    with PropertyRAGSearch(llm=local_llm) as rag:
        result = rag.ask("Quiet large flat with long lease")
        print(result["answer"])

Return value of ask()
---------------------
    {
        "query":         str   — original user query
        "raw_llm_output": str  — raw Stage 1 LLM output (for debugging)
        "params":        dict  — validated { weights, filters, special_query_type }
        "results":       pd.DataFrame — top-k properties (may be empty)
        "answer":        str   — plain-English answer from Stage 3
        "fallback_used": bool  — True if JSON parse failed in Stage 1
        "error":         str | None — non-fatal error message (if any)
    }
"""

from __future__ import annotations

import json
import os
import re
import warnings
from pathlib import Path
from typing import Any

import pandas as pd

# ---------------------------------------------------------------------------
# Validation constants
# ---------------------------------------------------------------------------

VALID_TOWNS: list[str] = [
    "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH",
    "BUKIT PANJANG", "BUKIT TIMAH", "CENTRAL AREA", "CHOA CHU KANG",
    "CLEMENTI", "GEYLANG", "HOUGANG", "JURONG EAST", "JURONG WEST",
    "KALLANG/WHAMPOA", "MARINE PARADE", "PASIR RIS", "PUNGGOL",
    "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON", "TAMPINES",
    "TOA PAYOH", "WOODLANDS", "YISHUN",
]

VALID_FLAT_TYPES: list[str] = [
    "1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM",
    "EXECUTIVE", "MULTI-GENERATION",
]

SCORE_DIMS: list[str] = [
    "score_mrt", "score_food", "score_shopping", "score_school_proximity",
    "score_school_quality", "score_famous_school", "score_size", "score_floor",
    "score_lease", "score_quietness", "score_value", "score_orientation",
]

# Hardcoded famous school names (matches Neo4j FamousSchool nodes)
FAMOUS_SCHOOL_NAMES: list[str] = [
    "AI TONG SCHOOL",
    "ACS PRIMARY",
    "CATHOLIC HIGH SCHOOL",
    "HENRY PARK PRIMARY SCHOOL",
    "KONG HWA SCHOOL",
    "MAHA BODHI SCHOOL",
    "MGS PRIMARY",
    "NAN HUA PRIMARY SCHOOL",
    "NANYANG PRIMARY SCHOOL",
    "PEI HWA PRESBYTERIAN PRIMARY SCHOOL",
    "RAFFLES GIRLS PRIMARY SCHOOL",
    "ROSYTH SCHOOL",
    "ST HILDA'S PRIMARY SCHOOL",
    "TAO NAN SCHOOL",
    "RIVER VALLEY PRIMARY SCHOOL",
    "PAYA LEBAR METHODIST GIRLS' SCHOOL (PRIMARY)",
    "CHIJ (KELLOCK)",
]

# Default search params used when Stage 1 JSON parsing fails
_DEFAULT_PARAMS: dict[str, Any] = {
    "weights": {"score_mrt": 5.0, "score_value": 5.0, "score_size": 5.0},
    "filters": {},
    "special_query_type": None,
    "cypher_hint": None,
}

# Cypher for graph-traversal "near famous school" queries
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

# ---------------------------------------------------------------------------
# Prompt templates (TinyLlama-Chat format)
# ---------------------------------------------------------------------------

_STAGE1_SYSTEM = """\
You are a parameter extractor for a Singapore HDB property search engine.
Given a user query, output a JSON object with EXACTLY these keys:

"weights": dict mapping score dimensions to importance (0-10). Only include dimensions the user cares about.
  Valid dimensions: score_mrt, score_food, score_shopping, score_school_proximity,
  score_school_quality, score_famous_school, score_size, score_floor,
  score_lease, score_quietness, score_value, score_orientation

"filters": dict of hard constraints. Valid keys:
  flat_type (e.g. "4 ROOM"), town (e.g. "BISHAN"),
  address_key (free-text address keywords, e.g. "1 Lorong Lew Serangoon"),
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

Query: "Show me flats around 1 Lorong Lew Serangoon"
Output: {"weights": {"score_value": 5}, "filters": {"address_key": "1 Lorong Lew Serangoon", "town": "SERANGOON"}, "special_query_type": null}

Now extract parameters for this query:
"""

_STAGE3_SYSTEM = """\
You are a helpful Singapore HDB property advisor. Given property search results, answer the user's question in 2-3 clear sentences. Mention specific properties by address if helpful. Be concise and factual."""

_STAGE3_USER = """\
Search results:
{context}

User question: {query}

Answer:"""


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    """Resolve repository root using the standard PropertyLens pattern."""
    cwd = Path.cwd()
    return cwd if (cwd / "hf_data").exists() else cwd.parent


def _build_tinyllama_prompt(system: str, user: str) -> str:
    """Format a prompt using TinyLlama-Chat's ChatML template."""
    return (
        f"<|system|>\n{system.strip()}\n</s>\n"
        f"<|user|>\n{user.strip()}\n</s>\n"
        f"<|assistant|>\n"
    )


def _fresh_default_params() -> dict[str, Any]:
    """Return a fresh copy of the fallback params structure."""
    return {
        "weights": dict(_DEFAULT_PARAMS["weights"]),
        "filters": dict(_DEFAULT_PARAMS["filters"]),
        "special_query_type": _DEFAULT_PARAMS["special_query_type"],
        "cypher_hint": _DEFAULT_PARAMS["cypher_hint"],
    }


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class PropertyRAGSearch:
    """
    RAG-based property search using TinyLlama and Neo4j.

    Pipeline
    --------
    1. Stage 1 — NL → JSON params  (TinyLlama parameter extraction)
    2. Stage 2 — JSON → Results    (existing Neo4jPropertySearch)
    3. Stage 3 — Results → Answer  (TinyLlama NL generation)

    Parameters
    ----------
    neo4j_uri, neo4j_username, neo4j_password, neo4j_database :
        Neo4j connection credentials. Read from .env if omitted.
    model_id : str
        Hugging Face model ID for the local LLM. Default: TinyLlama-1.1B-Chat.
    max_new_tokens : int
        Max tokens for LLM generation stages. Default: 256.
    temperature, top_p, repetition_penalty :
        Sampling parameters for the HuggingFace pipeline.
    device_map : str
        Passed to AutoModelForCausalLM.from_pretrained. Default: "auto".
    top_k_results : int
        Default number of properties to retrieve per query. Default: 5.
    llm : optional
        Pre-loaded LangChain-compatible LLM instance (e.g. HuggingFacePipeline).
        If provided, skips internal TinyLlama loading — useful in notebooks
        where the model is already in memory.
    """

    def __init__(
        self,
        neo4j_uri: str | None = None,
        neo4j_username: str | None = None,
        neo4j_password: str | None = None,
        neo4j_database: str | None = None,
        model_id: str = "TinyLlama/TinyLlama-1.1B-Chat-v1.0",
        max_new_tokens: int = 256,
        temperature: float = 0.7,
        top_p: float = 0.95,
        repetition_penalty: float = 1.15,
        device_map: str = "auto",
        top_k_results: int = 5,
        llm: Any = None,
    ) -> None:
        # Load .env credentials
        try:
            from dotenv import load_dotenv
            load_dotenv(_repo_root() / ".env")
        except ImportError:
            pass

        self._model_id = model_id
        self._max_new_tokens = max_new_tokens
        self._temperature = temperature
        self._top_p = top_p
        self._repetition_penalty = repetition_penalty
        self._device_map = device_map
        self._top_k_results = top_k_results

        # Neo4j connection
        from yc_property_search import Neo4jPropertySearch
        self._neo4j = Neo4jPropertySearch(
            uri=neo4j_uri or os.getenv("NEO4J_URI"),
            username=neo4j_username or os.getenv("NEO4J_USERNAME"),
            password=neo4j_password or os.getenv("NEO4J_PASSWORD"),
            database=neo4j_database or os.getenv("NEO4J_DATABASE"),
        )

        # LLM — reuse passed instance or load TinyLlama
        if llm is not None:
            self._llm = llm
        else:
            self._load_llm()

    # ------------------------------------------------------------------
    # LLM loading
    # ------------------------------------------------------------------

    def _load_llm(self) -> None:
        """Load TinyLlama and wrap in LangChain HuggingFacePipeline."""
        try:
            from transformers import pipeline, AutoTokenizer, AutoModelForCausalLM
            import torch
            from langchain_huggingface import HuggingFacePipeline
        except ImportError as exc:
            raise ImportError(
                "Missing dependencies. Install: transformers torch accelerate langchain-huggingface"
            ) from exc

        print(f"Loading {self._model_id} ...")
        tokenizer = AutoTokenizer.from_pretrained(self._model_id)
        import torch
        model = AutoModelForCausalLM.from_pretrained(
            self._model_id,
            torch_dtype=torch.bfloat16,
            device_map=self._device_map,
        )
        hf_pipeline = pipeline(
            "text-generation",
            model=model,
            tokenizer=tokenizer,
            max_new_tokens=self._max_new_tokens,
            temperature=self._temperature,
            top_p=self._top_p,
            repetition_penalty=self._repetition_penalty,
        )
        from langchain_huggingface import HuggingFacePipeline
        self._llm = HuggingFacePipeline(pipeline=hf_pipeline)
        print(f"{self._model_id} loaded.")

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def ask(
        self,
        query: str,
        top_k: int | None = None,
    ) -> dict[str, Any]:
        """
        Full 3-stage RAG pipeline.

        Parameters
        ----------
        query : str
            Natural-language property search query.
        top_k : int, optional
            Number of properties to retrieve. Defaults to ``top_k_results``
            set in the constructor.

        Returns
        -------
        dict with keys:
            query          — original query string
            raw_llm_output — raw Stage 1 LLM output (for debugging)
            params         — validated search params dict
            results        — pd.DataFrame of top-k properties
            answer         — plain-English answer string
            fallback_used  — True if Stage 1 JSON parse failed
            error          — error message string, or None
        """
        top_k = top_k or self._top_k_results
        out: dict[str, Any] = {
            "query": query,
            "raw_llm_output": "",
            "params": _fresh_default_params(),
            "results": pd.DataFrame(),
            "answer": "",
            "fallback_used": False,
            "error": None,
        }

        # Stage 1 — NL → params
        params, fallback_used, raw_output = self._stage1_extract_params(query)
        out["params"] = params
        out["fallback_used"] = fallback_used
        out["raw_llm_output"] = raw_output
        if fallback_used:
            out["error"] = f"Stage 1 JSON parse failed. Raw output: {raw_output[:120]!r}"

        # Stage 2 — params → results
        results = self._stage2_search(params, top_k)
        out["results"] = results

        # Stage 3 — results → NL answer
        out["answer"] = self._stage3_generate_answer(query, results)

        return out

    # ------------------------------------------------------------------
    # Stage 1 — parameter extraction
    # ------------------------------------------------------------------

    def _stage1_extract_params(
        self,
        query: str,
    ) -> tuple[dict[str, Any], bool, str]:
        """
        Use TinyLlama to extract search parameters from a natural-language query.

        Returns
        -------
        (params_dict, fallback_used, raw_output)
        """
        user_content = _STAGE1_EXAMPLES + query
        prompt = _build_tinyllama_prompt(_STAGE1_SYSTEM, user_content)

        try:
            raw_output: str = self._llm.invoke(prompt)
        except Exception as exc:
            warnings.warn(f"LLM invocation failed in Stage 1: {exc}")
            return self._heuristic_extract_params(query), True, ""

        # Strip the echoed prompt — TinyLlama often echoes the input
        assistant_marker = "<|assistant|>"
        if assistant_marker in raw_output:
            raw_output = raw_output.split(assistant_marker)[-1].strip()

        # Extract JSON substring
        json_str = self._extract_json_str(raw_output)
        if json_str is None:
            return self._heuristic_extract_params(query), True, raw_output

        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError:
            return self._heuristic_extract_params(query), True, raw_output

        # Validate and normalise
        params = self._validate_params(parsed)
        params = self._reconcile_params_with_query(params, query)
        return params, False, raw_output

    def _extract_json_str(self, text: str) -> str | None:
        """Extract the first complete JSON object from a string."""
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        return text[start: end + 1]

    def _validate_params(self, raw: dict) -> dict[str, Any]:
        """Validate and clean the parsed JSON from Stage 1."""
        params: dict[str, Any] = {
            "weights": {},
            "filters": {},
            "special_query_type": None,
            "cypher_hint": None,
        }

        # weights — keep only valid score dims, clamp to [0, 10]
        raw_weights = raw.get("weights", {})
        if isinstance(raw_weights, dict):
            for k, v in raw_weights.items():
                if k in SCORE_DIMS:
                    try:
                        params["weights"][k] = float(max(0.0, min(10.0, float(v))))
                    except (TypeError, ValueError):
                        pass

        # filters — validate each key
        raw_filters = raw.get("filters", {})
        if isinstance(raw_filters, dict):
            for k, v in raw_filters.items():
                if k == "flat_type":
                    v_up = str(v).upper()
                    if v_up in VALID_FLAT_TYPES:
                        params["filters"]["flat_type"] = v_up
                elif k == "town":
                    v_up = str(v).upper()
                    if v_up in VALID_TOWNS:
                        params["filters"]["town"] = v_up
                elif k == "address_key":
                    address_text = " ".join(str(v).split()).strip()
                    if address_text:
                        params["filters"]["address_key"] = address_text
                elif k == "flat_model":
                    params["filters"]["flat_model"] = str(v)
                elif k in ("min_floor_area", "max_resale_price",
                           "min_lease_years", "max_dist_mrt_m"):
                    try:
                        fv = float(v)
                        if fv > 0:
                            params["filters"][k] = fv
                    except (TypeError, ValueError):
                        pass
                elif k == "require_famous_school":
                    params["filters"]["require_famous_school"] = bool(v)
                elif k == "school_name":
                    # Used for graph-traversal queries — validate against known schools
                    v_up = str(v).upper()
                    matched = self._fuzzy_match_school(v_up)
                    if matched:
                        params["filters"]["school_name"] = matched

        # special_query_type
        sqt = raw.get("special_query_type")
        if sqt in (None, "near_famous_school", "graph_traversal"):
            params["special_query_type"] = sqt

        return params

    def _fuzzy_match_school(self, name_upper: str) -> str | None:
        """
        Match a user-provided school name to the canonical list.
        Returns the canonical name on a substring match, or None.
        """
        # Exact match first
        if name_upper in FAMOUS_SCHOOL_NAMES:
            return name_upper
        # Substring match — check if any word from user input appears in a school name
        for canonical in FAMOUS_SCHOOL_NAMES:
            if name_upper in canonical or canonical in name_upper:
                return canonical
        # Token overlap — at least 2 significant words match
        user_tokens = set(re.split(r"\s+", name_upper)) - {"THE", "OF", "AND", "A"}
        for canonical in FAMOUS_SCHOOL_NAMES:
            canon_tokens = set(re.split(r"\s+", canonical))
            if len(user_tokens & canon_tokens) >= 2:
                return canonical
        return None

    def _query_mentions_specific_school(self, query: str) -> str | None:
        """
        Return a canonical school name only when the user explicitly mentions one.
        This prevents the LLM from inventing a school for address-based queries.
        """
        q_upper = query.upper()
        for canonical in FAMOUS_SCHOOL_NAMES:
            if canonical in q_upper:
                return canonical
        return None

    def _strip_town_from_address(self, address_text: str, town: str | None) -> str:
        """Keep the location filter focused on the address phrase, not the broad town."""
        if not town:
            return address_text
        cleaned = address_text
        for variant in (town, town.replace("/", " ")):
            cleaned = re.sub(rf"\b{re.escape(variant)}\b", " ", cleaned, flags=re.IGNORECASE)
        return re.sub(r"\s+", " ", cleaned).strip()

    def _extract_address_filter(self, query: str) -> str | None:
        """
        Pull out address-like phrases so we can match ``address_key`` as
        keywords instead of relying on town-only filtering.
        """
        q_upper = re.sub(r"\s+", " ", query.upper()).strip()
        if not re.search(r"\d", q_upper):
            return None

        street_markers = (
            "LORONG", "LOR", "JALAN", "JLN", "ROAD", "RD", "STREET", "ST",
            "AVENUE", "AVE", "DRIVE", "DR", "CRESCENT", "CRES", "VIEW",
            "CENTRAL", "CTRL", "NORTH", "NTH", "TERRACE", "TER", "PLACE", "PL",
        )
        if not any(marker in q_upper for marker in street_markers):
            return None

        q_compact = re.sub(r"[^A-Z0-9 ]+", " ", q_upper)
        q_compact = re.sub(r"\s+", " ", q_compact).strip()
        tokens = q_compact.split()
        stop_tokens = {
            "WHAT", "ARE", "THE", "TOP", "PRIMARY", "SCHOOLS", "SCHOOL",
            "NEAR", "WHICH", "MOST", "COMPETITIVE", "AND", "THEIR",
            "QUALITY", "TIERS", "WITH", "UNDER", "BUDGET", "IN", "AT",
            "LEAST", "CLOSE", "TO", "A", "AN", "OF", "SHOW", "ME",
            "FIND", "FLATS", "FLAT", "ROOM", "PRICE",
        }

        location_words = {
            "SERANGOON", "TAMPINES", "BEDOK", "BISHAN", "PAYOH", "HOUGANG",
            "PUNGGOL", "SENGKANG", "WOODLANDS", "YISHUN", "ANG", "MO", "KIO",
        }

        for idx, token in enumerate(tokens):
            if token not in street_markers:
                continue

            if idx > 0 and re.fullmatch(r"\d+[A-Z]?", tokens[idx - 1]):
                start = idx - 1
            elif idx + 1 < len(tokens) and re.fullmatch(r"\d+[A-Z]?", tokens[idx + 1]):
                start = idx
                while start > 0 and tokens[start - 1] not in stop_tokens:
                    start -= 1
            else:
                continue

            end = idx + 1
            while end < len(tokens) and tokens[end] not in stop_tokens:
                end += 1

            candidate = " ".join(tokens[start:end]).strip()
            while candidate:
                candidate_tokens = candidate.split()
                if candidate_tokens and candidate_tokens[-1] in location_words:
                    break
                if candidate_tokens and candidate_tokens[-1] in stop_tokens:
                    candidate = " ".join(candidate_tokens[:-1]).strip()
                    continue
                break
            if candidate and len(candidate.split()) >= 2:
                return candidate
        return None

    def _reconcile_params_with_query(
        self,
        params: dict[str, Any],
        query: str,
    ) -> dict[str, Any]:
        """
        Align LLM-extracted params with what the user actually said.
        For address-based school queries, prefer address_key + town and
        reject hallucinated school_name values.
        """
        explicit_school = self._query_mentions_specific_school(query)
        heuristic_params = self._heuristic_extract_params(query)

        if explicit_school:
            params["filters"]["school_name"] = explicit_school
        else:
            params["filters"].pop("school_name", None)
            if params.get("special_query_type") == "near_famous_school":
                params["special_query_type"] = None

        for key in ("town", "address_key"):
            if heuristic_params["filters"].get(key):
                params["filters"][key] = heuristic_params["filters"][key]

        # Drop LLM-hallucinated filters that the heuristic extractor did not also detect.
        # town/address_key/school_name are already handled above; all other filter keys
        # (flat_type, min_floor_area, max_resale_price, etc.) must be confirmed by the
        # deterministic heuristic or they are discarded.
        heuristic_filter_keys = set(heuristic_params["filters"].keys())
        for key in list(params["filters"].keys()):
            if key not in ("town", "address_key", "school_name") and key not in heuristic_filter_keys:
                del params["filters"][key]

        if params["filters"].get("address_key"):
            params["filters"]["address_key"] = self._strip_town_from_address(
                params["filters"]["address_key"],
                params["filters"].get("town"),
            )
            params["filters"]["address_key"] = re.sub(
                r"^\d+[A-Z]?\s+", "* ", params["filters"]["address_key"].strip().upper()
            )

        if not params["weights"] and heuristic_params.get("weights"):
            params["weights"] = heuristic_params["weights"]

        if (
            not explicit_school
            and params["filters"].get("address_key")
            and "SCHOOL" in query.upper()
        ):
            params["weights"]["score_school_quality"] = max(
                params["weights"].get("score_school_quality", 0.0),
                8.0,
            )
            params["weights"]["score_school_proximity"] = max(
                params["weights"].get("score_school_proximity", 0.0),
                8.0,
            )

        return params

    def _heuristic_extract_params(self, query: str) -> dict[str, Any]:
        """
        Deterministic fallback for common property-search phrasing when
        TinyLlama fails to emit valid JSON.
        """
        params = _fresh_default_params()
        params["weights"] = {}
        params["filters"] = {}

        q = query.strip()
        q_upper = q.upper()
        q_compact = re.sub(r"[^A-Z0-9 ]+", " ", q_upper)
        q_compact = re.sub(r"\s+", " ", q_compact).strip()

        if not q_compact or q_compact in {"?", "??", "???"}:
            return _fresh_default_params()

        flat_match = re.search(r"\b([1-5])\s*[- ]?ROOM\b", q_upper)
        if flat_match:
            params["filters"]["flat_type"] = f"{flat_match.group(1)} ROOM"
        elif "EXECUTIVE" in q_upper:
            params["filters"]["flat_type"] = "EXECUTIVE"
        elif "MULTI GENERATION" in q_compact or "MULTI-GENERATION" in q_upper:
            params["filters"]["flat_type"] = "MULTI-GENERATION"

        for town in VALID_TOWNS:
            town_variants = {
                town,
                town.replace("/", " "),
            }
            if any(variant in q_compact for variant in town_variants):
                params["filters"]["town"] = town
                break

        address_filter = self._extract_address_filter(q)
        if address_filter:
            params["filters"]["address_key"] = self._strip_town_from_address(
                address_filter,
                params["filters"].get("town"),
            )

        budget_match = re.search(
            r"\b(?:UNDER|BELOW|BUDGET(?: OF)?|MAX(?:IMUM)?(?: PRICE)?(?: OF)?)\s*\$?\s*([\d,.]+)\s*([KM]?)\b",
            q_upper,
        )
        if budget_match:
            amount = float(budget_match.group(1).replace(",", ""))
            suffix = budget_match.group(2)
            if suffix == "K":
                amount *= 1_000
            elif suffix == "M":
                amount *= 1_000_000
            params["filters"]["max_resale_price"] = amount

        area_match = re.search(
            r"\b(?:AT LEAST|MIN(?:IMUM)?|OVER)\s*([\d.]+)\s*(?:SQM|M2|SQ METERS?|SQUARE METERS?)\b",
            q_upper,
        )
        if area_match:
            params["filters"]["min_floor_area"] = float(area_match.group(1))

        lease_years_match = re.search(
            r"\b(?:AT LEAST|MIN(?:IMUM)?|WITH)\s*(\d{2})\s*(?:YEARS?|YRS?)\s*(?:LEASE)?\b",
            q_upper,
        )
        if lease_years_match:
            params["filters"]["min_lease_years"] = float(lease_years_match.group(1))

        within_school_match = re.search(
            r"\bWITHIN\s*([\d.]+)\s*KM\b.*?\b([A-Z][A-Z'() .-]*SCHOOL)\b",
            q_upper,
        )
        if within_school_match:
            matched_school = self._fuzzy_match_school(within_school_match.group(2).strip())
            if matched_school:
                params["filters"]["school_name"] = matched_school
                params["special_query_type"] = "near_famous_school"

        if "school_name" not in params["filters"]:
            school_match = re.search(r"\b([A-Z][A-Z'() .-]*SCHOOL)\b", q_upper)
            if school_match:
                matched_school = self._fuzzy_match_school(school_match.group(1).strip())
                if matched_school:
                    params["filters"]["school_name"] = matched_school
                    if any(word in q_upper for word in ("NEAR ", "WITHIN ", "CLOSE TO ")):
                        params["special_query_type"] = "near_famous_school"

        keyword_weights = {
            "score_mrt": ("MRT", "TRAIN", "COMMUTE", "COMMUTER", "STATION"),
            "score_famous_school": ("FAMOUS SCHOOL", "GOOD SCHOOL", "PRIMARY SCHOOL", "SCHOOL"),
            "score_quietness": ("QUIET", "AWAY FROM HIGHWAY", "NOISE", "NOISY"),
            "score_size": ("LARGE", "SPACIOUS", "BIG"),
            "score_lease": ("LONG LEASE", "GOOD LEASE", "LEASE LEFT"),
            "score_value": ("AFFORDABLE", "CHEAP", "BUDGET", "VALUE", "NOT TOO EXPENSIVE"),
        }
        for score_dim, markers in keyword_weights.items():
            if any(marker in q_upper for marker in markers):
                params["weights"][score_dim] = 8.0

        if params["filters"].get("school_name"):
            params["weights"]["score_famous_school"] = 10.0
        if "NEAR MRT" in q_upper or "CLOSE TO MRT" in q_upper:
            params["weights"]["score_mrt"] = max(params["weights"].get("score_mrt", 0.0), 9.0)
        if "UNDER" in q_upper or "BUDGET" in q_upper or "AFFORDABLE" in q_upper:
            params["weights"]["score_value"] = max(params["weights"].get("score_value", 0.0), 7.0)

        if not params["weights"]:
            return _fresh_default_params()

        return params

    # ------------------------------------------------------------------
    # Stage 2 — search execution
    # ------------------------------------------------------------------

    def _stage2_search(
        self,
        params: dict[str, Any],
        top_k: int,
    ) -> pd.DataFrame:
        """
        Execute the search using Neo4j.

        Routes graph-traversal queries to ``graph_query()`` and standard
        queries to ``Neo4jPropertySearch.search()``.

        When both ``town`` and ``address_key`` filters are present, they are
        applied with OR semantics: properties matching either condition are
        returned, and those matching both rank first (match_tier=2 > 1).
        """
        sqt = params.get("special_query_type")

        if sqt == "near_famous_school":
            return self._search_near_famous_school(params, top_k)

        # Separate location filters for OR logic; drop school_name (graph-traversal only)
        base_filters = {k: v for k, v in params["filters"].items() if k != "school_name"}
        town = base_filters.pop("town", None)
        address_key = base_filters.pop("address_key", None)

        def _run(extra_filters: dict) -> pd.DataFrame:
            try:
                return self._neo4j.search(
                    weights=params["weights"],
                    filters={**base_filters, **extra_filters},
                    top_k=top_k * 3,
                )
            except Exception as exc:
                warnings.warn(f"Neo4j search failed in Stage 2: {exc}")
                return pd.DataFrame()

        # No location filters — plain weighted search
        if not town and not address_key:
            return _run({}).head(top_k).reset_index(drop=True)

        # Only one location filter — no OR needed
        if town and not address_key:
            return _run({"town": town}).head(top_k).reset_index(drop=True)
        if address_key and not town:
            return _run({"address_key": address_key}).head(top_k).reset_index(drop=True)

        # Both filters present: OR semantics with tier-based ranking
        addr_results = _run({"address_key": address_key})
        town_results = _run({"town": town})

        if addr_results.empty and town_results.empty:
            return pd.DataFrame()
        if addr_results.empty:
            return town_results.head(top_k).reset_index(drop=True)
        if town_results.empty:
            return addr_results.head(top_k).reset_index(drop=True)

        both_keys = set(addr_results["address_key"]) & set(town_results["address_key"])
        merged = (
            pd.concat([addr_results, town_results])
            .drop_duplicates(subset="address_key", keep="first")
        )
        merged["_match_tier"] = merged["address_key"].apply(
            lambda k: 2 if k in both_keys else 1
        )
        return (
            merged
            .sort_values(["_match_tier", "composite_score"], ascending=[False, False])
            .drop(columns=["_match_tier"])
            .head(top_k)
            .reset_index(drop=True)
        )

    def _search_near_famous_school(
        self,
        params: dict[str, Any],
        top_k: int,
    ) -> pd.DataFrame:
        """Execute a graph-traversal query for properties near a specific school."""
        school_name = params["filters"].get("school_name")
        if not school_name:
            # No valid school name — fall back to standard search with famous school weight
            fallback_weights = params["weights"].copy()
            if not fallback_weights:
                fallback_weights = {"score_famous_school": 10.0}
            else:
                fallback_weights["score_famous_school"] = 10.0
            try:
                return self._neo4j.search(
                    weights=fallback_weights,
                    filters={k: v for k, v in params["filters"].items()
                              if k != "school_name"},
                    top_k=top_k,
                )
            except Exception as exc:
                warnings.warn(f"Fallback famous-school search failed: {exc}")
                return pd.DataFrame()

        try:
            records = self._neo4j.graph_query(
                _NEAR_SCHOOL_CYPHER,
                school_name=school_name,
                top_k=top_k,
            )
            if not records:
                return pd.DataFrame()
            return pd.DataFrame(records)
        except Exception as exc:
            warnings.warn(f"graph_query near famous school failed: {exc}")
            return pd.DataFrame()

    # ------------------------------------------------------------------
    # Stage 3 — NL answer generation
    # ------------------------------------------------------------------

    def _stage3_generate_answer(
        self,
        query: str,
        results: pd.DataFrame,
    ) -> str:
        """Generate a plain-English answer from the search results."""
        if results is None or results.empty:
            return (
                "No matching properties were found. "
                "Consider broadening your search — try relaxing the town filter, "
                "increasing the price limit, or removing room-type constraints."
            )

        context = self._format_results_as_context(results)
        user_content = _STAGE3_USER.format(context=context, query=query)
        prompt = _build_tinyllama_prompt(_STAGE3_SYSTEM, user_content)

        try:
            raw_output: str = self._llm.invoke(prompt)
        except Exception as exc:
            warnings.warn(f"LLM invocation failed in Stage 3: {exc}")
            return self._fallback_answer(results)

        # Extract the assistant's reply
        assistant_marker = "<|assistant|>"
        if assistant_marker in raw_output:
            answer = raw_output.split(assistant_marker)[-1].strip()
        else:
            # Take the last 400 chars — usually the answer portion
            answer = raw_output[-400:].strip()

        # Strip any trailing incomplete sentence and cap length
        answer = answer[:500]
        answer_lower = answer.lower()
        if (
            not answer
            or "<|system|>" in answer
            or "Search results:" in answer
            or "User question:" in answer
            or answer.startswith("{")
            or "to provide a response" in answer_lower
            or "here are two possible options" in answer_lower
            or "option 1" in answer_lower
            or "option 2" in answer_lower
            or answer_lower.startswith("yes, i can")
            or answer_lower.startswith("response:")
            or answer_lower.startswith("sure!")
            or answer_lower.startswith("certainly!")
            or "based on your query" in answer_lower
            or "meet your criteria" in answer_lower
            or "walking distance" in answer_lower
            or "excellent option" in answer_lower
            or "ample storage" in answer_lower
        ):
            return self._fallback_answer(results)
        if not self._answer_is_grounded(answer, results):
            return self._fallback_answer(results)
        return answer if answer else self._fallback_answer(results)

    def _answer_is_grounded(self, answer: str, results: pd.DataFrame) -> bool:
        """Require the summary to mention actual top-result addresses and prices."""
        if results is None or results.empty:
            return False

        answer_lower = answer.lower()
        top = results.head(3)

        addresses = [
            str(addr).lower()
            for addr in top.get("address_key", pd.Series(dtype=object)).dropna().tolist()
        ]
        prices = [
            f"{float(price):,.0f}"
            for price in top.get("resale_price", pd.Series(dtype=float)).dropna().tolist()
        ]

        mentions_address = any(addr and addr in answer_lower for addr in addresses)
        mentions_price = any(price in answer for price in prices)
        return mentions_address and mentions_price

    def _format_results_as_context(self, results: pd.DataFrame) -> str:
        """
        Format top-5 properties as a compact numbered list for the Stage 3 prompt.
        Uses only columns that are always present.
        """
        lines: list[str] = []
        display_cols = {
            "address_key": "address",
            "town": "town",
            "flat_type": "type",
            "floor_area_sqm": "sqm",
            "resale_price": "price",
            "dist_to_nearest_famous_school_km": "km_to_school",
            "nearest_famous_school_name": "school",
            "dist_to_mrt_m": "mrt_m",
            "composite_score": "score",
        }

        for i, (_, row) in enumerate(results.head(5).iterrows(), start=1):
            parts: list[str] = []
            for col, label in display_cols.items():
                if col not in row or pd.isna(row[col]):
                    continue
                val = row[col]
                if col == "resale_price":
                    parts.append(f"SGD {val:,.0f}")
                elif col == "floor_area_sqm":
                    parts.append(f"{val:.0f}sqm")
                elif col == "dist_to_nearest_famous_school_km":
                    parts.append(f"{val:.2f}km to famous school")
                elif col == "dist_to_mrt_m":
                    parts.append(f"{val:.0f}m to MRT")
                elif col == "composite_score":
                    parts.append(f"score={val:.2f}")
                elif col in ("address_key", "nearest_famous_school_name"):
                    parts.append(str(val))
                else:
                    parts.append(f"{label}={val}")
            lines.append(f"{i}. {' | '.join(parts)}")

        return "\n".join(lines)

    def _fallback_answer(self, results: pd.DataFrame) -> str:
        """Generate a minimal text answer without the LLM (fallback)."""
        if results.empty:
            return "No matching properties found."
        top = results.head(3)
        summaries: list[str] = []
        for _, row in top.iterrows():
            addr = row.get("address_key", "Unknown")
            town = row.get("town", "")
            ftype = row.get("flat_type", "")
            price = row.get("resale_price", 0)
            summaries.append(f"{addr} ({town}, {ftype}, SGD {price:,.0f})")
        return "Top matches: " + "; ".join(summaries) + "."

    # ------------------------------------------------------------------
    # Context manager + cleanup
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the Neo4j driver connection."""
        self._neo4j.close()

    def __enter__(self) -> "PropertyRAGSearch":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    def __repr__(self) -> str:
        return (
            f"PropertyRAGSearch("
            f"model={self._model_id!r}, "
            f"top_k={self._top_k_results})"
        )
