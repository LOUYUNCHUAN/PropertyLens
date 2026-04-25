"""
yc_property_search.py
---------------------
Property Knowledge Base and Weighted Search Module — PropertyLens Layer 06.

Provides:
  - PropertyKnowledgeBase: loads / builds a normalized property knowledge base,
    supports local (parquet) search, and pushes the KB to Neo4j AuraDB.
  - Neo4jPropertySearch: Cypher-based weighted search against the Neo4j graph.
  - 12 scoring dimensions derived from Layer 02 feature data (0–10 scale, higher = better).
  - Haversine-based famous primary school proximity enrichment using MOE school flags.

Graph model (Neo4j)
-------------------
  (:Property {address_key, town, flat_type, ..., score_mrt, ..., score_famous_school})
  (:FamousSchool {name, lat, lng})
  (:Town {name})
  (Property)-[:LOCATED_IN]->(Town)
  (Property)-[:NEAREST_FAMOUS_SCHOOL {distance_km}]->(FamousSchool)
  (Property)-[:NEAR_FAMOUS_SCHOOL {distance_km}]->(FamousSchool)  # within 2 km

Usage
-----
    from yc_property_search import PropertyKnowledgeBase, Neo4jPropertySearch

    # Build KB from source data and push to Neo4j
    kb = PropertyKnowledgeBase.build()
    kb.push_to_neo4j()                     # credentials from .env

    # Query Neo4j (same interface as parquet search)
    with Neo4jPropertySearch() as neo4j:
        results = neo4j.search(
            weights={"score_famous_school": 10, "score_mrt": 7},
            filters={"flat_type": "4 ROOM", "town": "BISHAN"},
            top_k=10,
        )
    print(results[["address_key", "town", "nearest_famous_school_name", "composite_score"]])

    # Local parquet search (no Neo4j required)
    kb = PropertyKnowledgeBase()
    results = kb.search(weights={"score_famous_school": 10}, top_k=10)
"""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Score dimension definitions
# ---------------------------------------------------------------------------

SCORE_DIMENSIONS: dict[str, dict[str, Any]] = {
    "score_mrt": {
        "source": "dist_to_mrt_m",
        "direction": "inverse",
        "label": "MRT Accessibility",
        "description": "Proximity to nearest MRT/LRT station. Higher score = closer station.",
    },
    "score_food": {
        "source": "dist_to_foodcourt_m",
        "direction": "inverse",
        "label": "Food Centre Access",
        "description": "Proximity to nearest hawker centre or food court. Higher score = closer.",
    },
    "score_shopping": {
        "source": "dist_to_nearest_mall_m",
        "direction": "inverse",
        "label": "Mall Proximity",
        "description": "Proximity to nearest shopping mall. Higher score = closer.",
    },
    "score_school_proximity": {
        "source": "dist_to_nearest_school_m",
        "direction": "inverse",
        "label": "Nearest School (any)",
        "description": "Proximity to nearest primary school (any type). Higher score = closer.",
    },
    "score_school_quality": {
        "source": "primary_school_quality_1km_weighted",
        "direction": "direct",
        "label": "School Quality (1km)",
        "description": "Weighted quality of primary schools within 1 km. Higher score = better schools nearby.",
    },
    "score_famous_school": {
        "source": "dist_to_nearest_famous_school_km",
        "direction": "inverse",
        "label": "Famous Primary School Access",
        "description": (
            "Proximity to nearest autonomous/gifted/SAP primary school — "
            "the competitive schools in Singapore's Phase 2A/2B registration. "
            "Higher score = closer to a famous school."
        ),
    },
    "score_size": {
        "source": "floor_area_sqm",
        "direction": "direct",
        "label": "Property Size",
        "description": "Floor area in sqm. Higher score = larger flat.",
    },
    "score_floor": {
        "source": "level_mid",
        "direction": "direct",
        "label": "Floor Level",
        "description": "Mid-point of storey range. Higher score = higher floor.",
    },
    "score_lease": {
        "source": "lease_remaining_years",
        "direction": "direct",
        "label": "Remaining Lease",
        "description": "Remaining lease in years. Higher score = more lease remaining.",
    },
    "score_quietness": {
        "source": "dist_to_highway_m",
        "direction": "direct",
        "label": "Quietness",
        "description": "Distance from nearest expressway. Higher score = farther from highway = quieter.",
    },
    "score_value": {
        "source": "resale_price",
        "direction": "inverse",
        "label": "Value for Money",
        "description": "Resale price in SGD. Higher score = lower price = better value for money.",
    },
    "score_orientation": {
        "source": "orientation_score",
        "direction": "direct",
        "label": "Unit Orientation",
        "description": "Unit facing direction score. Higher score = more favourable orientation.",
    },
}

# Famous school criteria: primary schools with any of these MOE flags
_FAMOUS_FLAGS = ("autonomous_ind", "gifted_ind", "sap_ind")

# Columns exposed in search results
_RESULT_COLS = [
    "address_key",
    "block",
    "street_name",
    "town",
    "flat_type",
    "flat_model",
    "floor_area_sqm",
    "level_mid",
    "room_count",
    "lease_remaining_years",
    "resale_price",
    "transaction_year",
    "dist_to_mrt_m",
    "dist_to_nearest_school_m",
    "dist_to_nearest_famous_school_km",
    "famous_school_count_1km",
    "nearest_famous_school_name",
] + list(SCORE_DIMENSIONS.keys()) + ["composite_score"]


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _repo_root() -> Path:
    """Resolve repository root using the standard PropertyLens pattern."""
    cwd = Path.cwd()
    return cwd if (cwd / "hf_data").exists() else cwd.parent


def default_kb_path() -> Path:
    """Return the path to the latest saved knowledge base parquet."""
    layer_dir = _repo_root() / "06_search_layer" / "artifacts"
    candidates = sorted(layer_dir.glob("property_knowledge_base_*.parquet"))
    if not candidates:
        raise FileNotFoundError(
            f"No knowledge base found in {layer_dir}. "
            "Run 01_build_knowledge_base.ipynb first."
        )
    return candidates[-1]


def default_norm_params_path() -> Path:
    """Return path to the latest normalization parameters JSON."""
    layer_dir = _repo_root() / "06_search_layer" / "artifacts"
    candidates = sorted(layer_dir.glob("search_norm_params_*.json"))
    if not candidates:
        raise FileNotFoundError(
            f"No normalization params found in {layer_dir}. "
            "Run 01_build_knowledge_base.ipynb first."
        )
    return candidates[-1]


def _normalize_series(
    values: pd.Series, p5: float, p95: float, direction: str
) -> pd.Series:
    """Clip values to [p5, p95] range and scale to [0, 10]."""
    span = p95 - p5
    if span < 1e-9:
        # Degenerate feature — assign neutral mid-score
        return pd.Series(5.0, index=values.index)
    clipped = np.clip((values - p5) / span, 0.0, 1.0)
    if direction == "inverse":
        return pd.Series((10.0 * (1.0 - clipped)).round(4), index=values.index)
    return pd.Series((10.0 * clipped).round(4), index=values.index)


def _decode_ohe(df: pd.DataFrame, prefix: str) -> pd.Series:
    """Decode a group of one-hot-encoded columns back to the original label."""
    cols = [c for c in df.columns if c.startswith(prefix)]
    if not cols:
        return pd.Series("UNKNOWN", index=df.index)
    return df[cols].idxmax(axis=1).str[len(prefix):]


def _pairwise_haversine_km(
    lats1: np.ndarray,
    lngs1: np.ndarray,
    lats2: np.ndarray,
    lngs2: np.ndarray,
) -> np.ndarray:
    """
    Vectorised Haversine distances.

    Parameters
    ----------
    lats1, lngs1 : (N,) arrays — property coordinates
    lats2, lngs2 : (M,) arrays — school coordinates

    Returns
    -------
    (N, M) distance matrix in km
    """
    R = 6371.0
    dlat = np.radians(lats2[np.newaxis, :] - lats1[:, np.newaxis])
    dlon = np.radians(lngs2[np.newaxis, :] - lngs1[:, np.newaxis])
    cos_p = np.cos(np.radians(lats1))[:, np.newaxis]
    cos_s = np.cos(np.radians(lats2))[np.newaxis, :]
    a = np.sin(dlat / 2) ** 2 + cos_p * cos_s * np.sin(dlon / 2) ** 2
    return R * 2 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class PropertyKnowledgeBase:
    """
    Normalized property knowledge base with weighted multi-criteria search.

    Each property (unique HDB address) is scored 0–10 across 12 dimensions.
    Users assign weights to dimensions; a weighted composite score ranks results.

    Quick start
    -----------
    >>> kb = PropertyKnowledgeBase()          # load latest saved KB
    >>> kb.describe_scores()                  # see all scoring dimensions
    >>> results = kb.search(
    ...     weights={"score_famous_school": 10, "score_mrt": 7},
    ...     filters={"flat_type": "4 ROOM"},
    ...     top_k=10,
    ... )
    """

    def __init__(
        self,
        kb_path: str | Path | None = None,
        norm_params_path: str | Path | None = None,
    ) -> None:
        if kb_path is None:
            kb_path = default_kb_path()
        if norm_params_path is None:
            norm_params_path = default_norm_params_path()

        self._kb_path = Path(kb_path)
        self.kb = pd.read_parquet(self._kb_path)
        with open(norm_params_path) as f:
            self.norm_params: dict = json.load(f)
        self._score_cols = list(SCORE_DIMENSIONS.keys())

    # ------------------------------------------------------------------
    # Build pipeline
    # ------------------------------------------------------------------

    @classmethod
    def build(
        cls,
        feature_csv: str | Path | None = None,
        school_info_csv: str | Path | None = None,
        school_geocode_csv: str | Path | None = None,
        hdb_geocode_csv: str | Path | None = None,
        output_dir: str | Path | None = None,
    ) -> "PropertyKnowledgeBase":
        """
        Build the property knowledge base from source data.

        Steps
        -----
        1. Load feature table; deduplicate to unique properties (most recent transaction).
        2. Decode OHE → human-readable town, flat_type, flat_model labels.
        3. Identify famous primary schools from MOE data (autonomous/gifted/SAP flags).
        4. Vectorised Haversine distances to famous schools per property.
        4b. Recompute primary_school_quality_1km_weighted from sgschooling Phase 2B/2C
            vacancy+applied data (replaces the feature-CSV value which is ~98% null).
        5. Normalise all source features to 0–10 scores (p5–p95 clipping).
        6. Save KB as .parquet + normalization params as .json.

        All path arguments default to the standard PropertyLens directory layout.

        Returns
        -------
        PropertyKnowledgeBase
            Loaded instance pointing to the newly saved KB.
        """
        repo_root = _repo_root()

        # --- resolve default paths ---
        if feature_csv is None:
            feat_dir = repo_root / "hf_data" / "02_feature_layer" / "training" / "outputs"
            if not feat_dir.exists():
                feat_dir = repo_root / "02_feature_layer" / "training" / "outputs"
            candidates = [
                p for p in sorted(feat_dir.glob("hdb_feature_table_*.csv"))
                if "_backup_" not in p.name
            ]
            if not candidates:
                raise FileNotFoundError(f"No hdb_feature_table_*.csv in {feat_dir}")
            feature_csv = candidates[-1]

        if school_info_csv is None:
            school_dir = repo_root / "01_data_layer" / "raw" / "schools"
            candidates = sorted(school_dir.glob("moe_general_information_of_schools_*.csv"))
            if not candidates:
                raise FileNotFoundError(f"No moe_general_information_of_schools_*.csv in {school_dir}")
            school_info_csv = candidates[-1]

        if school_geocode_csv is None:
            geo_dir = repo_root / "01_data_layer" / "raw" / "google_geo"
            candidates = sorted(geo_dir.glob("moe_school_geocode_*.csv"))
            if not candidates:
                raise FileNotFoundError(f"No moe_school_geocode_*.csv in {geo_dir}")
            school_geocode_csv = candidates[-1]

        if hdb_geocode_csv is None:
            geo_dir = repo_root / "01_data_layer" / "raw" / "google_geo"
            candidates = sorted(geo_dir.glob("*hdb*geocode*.csv"))
            if not candidates:
                # Try the accessibility features file which also has lat/lng
                candidates = sorted(geo_dir.glob("hdb_geo_accessibility_noise_features_*.csv"))
            if not candidates:
                raise FileNotFoundError(f"No HDB geocode CSV found in {geo_dir}")
            hdb_geocode_csv = candidates[-1]

        if output_dir is None:
            output_dir = repo_root / "06_search_layer" / "artifacts"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # ----------------------------------------------------------------
        # Step 1: Load and deduplicate feature table
        # ----------------------------------------------------------------
        print(f"[1/6] Loading feature table: {Path(feature_csv).name}")
        df = pd.read_csv(feature_csv)
        print(f"      {len(df):,} rows × {len(df.columns)} cols loaded")

        df = df.sort_values("transaction_year", ascending=False)
        df = df.drop_duplicates(subset="address_key", keep="first").reset_index(drop=True)
        print(f"      {len(df):,} unique properties after deduplication")

        # ----------------------------------------------------------------
        # Step 2: Decode OHE columns
        # ----------------------------------------------------------------
        print("[2/6] Decoding OHE columns → town, flat_type, flat_model...")
        df["town"] = _decode_ohe(df, "town_")
        df["flat_type"] = _decode_ohe(df, "flat_type_")
        df["flat_model"] = _decode_ohe(df, "flat_model_")
        # Split address_key into block + street for readability
        split = df["address_key"].str.split(" ", n=1)
        df["block"] = split.str[0]
        df["street_name"] = split.str[1].fillna("")

        # ----------------------------------------------------------------
        # Step 3: Identify famous primary schools
        # ----------------------------------------------------------------
        print("[3/6] Identifying famous primary schools from MOE data...")
        school_info = pd.read_csv(school_info_csv)
        school_geo = pd.read_csv(school_geocode_csv)

        is_primary = school_info["mainlevel_code"].str.upper().str.contains("PRIMARY", na=False)
        is_famous = (
            school_info["autonomous_ind"].str.upper().eq("YES")
            | school_info["gifted_ind"].str.upper().eq("YES")
            | school_info["sap_ind"].str.upper().eq("YES")
        )
        famous_schools = (
            school_info[is_primary & is_famous][["school_name"]]
            .merge(school_geo[["school_name", "lat", "lng"]], on="school_name", how="inner")
            .drop_duplicates("school_name")
            .reset_index(drop=True)
        )
        print(f"      {len(famous_schools)} famous primary schools identified:")
        for name in famous_schools["school_name"].tolist():
            print(f"        • {name}")

        if len(famous_schools) < 5:
            raise ValueError(
                f"Only {len(famous_schools)} famous schools found — check MOE data and flag columns."
            )

        # ----------------------------------------------------------------
        # Step 4: Vectorised Haversine distances to famous schools
        # ----------------------------------------------------------------
        print("[4/6] Computing distances to famous primary schools (vectorised Haversine)...")

        hdb_geo = pd.read_csv(hdb_geocode_csv, usecols=["requested_address", "lat", "lng"])
        hdb_geo["address_key"] = (
            hdb_geo["requested_address"]
            .str.replace(r",\s*Singapore\s*$", "", regex=True)
            .str.strip()
        )
        hdb_geo = hdb_geo.drop_duplicates("address_key").set_index("address_key")[["lat", "lng"]]

        # Join to get coordinates per property
        df = df.join(hdb_geo, on="address_key", how="left")
        n_matched = df["lat"].notna().sum()
        print(f"      Geocode match rate: {n_matched / len(df) * 100:.1f}% ({n_matched:,}/{len(df):,})")

        # Fill missing coords with Singapore centroid (fallback)
        df["lat"] = df["lat"].fillna(1.3521)
        df["lng"] = df["lng"].fillna(103.8198)

        prop_lats = df["lat"].values
        prop_lngs = df["lng"].values
        fs_lats = famous_schools["lat"].values
        fs_lngs = famous_schools["lng"].values
        fs_names = famous_schools["school_name"].values

        all_dists = _pairwise_haversine_km(prop_lats, prop_lngs, fs_lats, fs_lngs)  # (N, M)
        min_idx = np.argmin(all_dists, axis=1)

        df["dist_to_nearest_famous_school_km"] = all_dists[np.arange(len(df)), min_idx].round(4)
        df["famous_school_count_1km"] = (all_dists < 1.0).sum(axis=1).astype(int)
        df["nearest_famous_school_name"] = fs_names[min_idx]

        # Save pairwise distances (within 2 km) for Neo4j relationship creation
        ii, jj = np.where(all_dists < 2.0)
        distances_df = pd.DataFrame({
            "address_key": df["address_key"].values[ii],
            "school_name": fs_names[jj],
            "distance_km": all_dists[ii, jj].round(4),
        })
        # Stored separately — used by push_to_neo4j()
        # Save it alongside KB artefacts (same date stamp, set after output_dir is known)
        _distances_df = distances_df  # captured for save after output_dir is resolved

        # ----------------------------------------------------------------
        # Step 4b: Recompute primary_school_quality_1km_weighted from
        #          sgschooling Phase 2B/2C vacancy+applied data.
        #
        # The feature CSV carries `primary_school_quality_1km_weighted` computed
        # from `competition_ratio_extracted`, which is ~98% null → locks the score
        # at a constant 5.0 after normalisation.  We replace it here using the
        # richer vacancy/applied rows in sgschooling_2015plus_*.csv.
        # ----------------------------------------------------------------
        print("[4b/6] Recomputing primary_school_quality_1km_weighted from sgschooling data...")
        try:
            sg_dir = Path(school_info_csv).parent.parent / "schools"
            sg_candidates = sorted(sg_dir.glob("sgschooling_2015plus_*.csv"))
            if not sg_candidates:
                raise FileNotFoundError(f"No sgschooling_2015plus_*.csv in {sg_dir}")
            sg_csv = sg_candidates[-1]

            sg = pd.read_csv(sg_csv)
            # Normalise column names
            sg.columns = sg.columns.str.strip().str.lower().str.replace(" ", "_", regex=False)
            # Detect year column (may be "year" or "year_int")
            year_col = "year" if "year" in sg.columns else sg.columns[sg.columns.str.contains("year")][0]
            sg["year_int"] = pd.to_numeric(sg[year_col], errors="coerce")

            # Apostrophe normaliser (sgschooling uses U+2019 curly quotes)
            def _na(s):
                return str(s).replace("\u2019", "'").replace("\u2018", "'")

            school_col = "school" if "school" in sg.columns else sg.columns[0]
            sg["school"] = sg[school_col].astype(str).str.strip()
            sg = sg[sg["school"].str.len() > 0].copy()

            is_school_row = ~sg["school"].str.startswith("↳", na=False)
            is_vacancy    =  sg["school"].str.startswith("↳ Vacancy", na=False)
            is_applied    =  sg["school"].str.startswith("↳ Applied", na=False)

            sg["school_name_sg"] = sg["school"].where(is_school_row, np.nan).ffill()
            sg["school_upper"]   = sg["school_name_sg"].apply(lambda x: _na(x).upper())

            # Extract numeric phase columns
            for _col in ["2b", "2c", "2c(s)"]:
                if _col in sg.columns:
                    sg[_col + "_num"] = pd.to_numeric(
                        sg[_col].astype(str).str.extract(r"^(\d+(?:\.\d+)?)")[0], errors="coerce"
                    )
                else:
                    sg[_col + "_num"] = np.nan

            _vc = ["school_upper", "year_int", "2b_num", "2c_num", "2c(s)_num"]
            vac = sg.loc[is_vacancy, _vc].copy()
            app = sg.loc[is_applied, _vc].copy()
            vac.columns = ["school_upper", "year_int", "vac_2b", "vac_2c", "vac_2cs"]
            app.columns = ["school_upper", "year_int", "app_2b", "app_2c", "app_2cs"]

            pa = vac.merge(app, on=["school_upper", "year_int"], how="inner")
            for _ph in ["2b", "2c", "2cs"]:
                _v, _a = f"vac_{_ph}", f"app_{_ph}"
                _has_v = pa[_v].fillna(0) > 0
                pa[f"ratio_{_ph}"] = np.where(
                    _has_v, (pa[_a].fillna(0) / pa[_v].replace(0, np.nan)).clip(upper=5.0), np.nan
                )
            pa["max_ratio"] = pa[["ratio_2b", "ratio_2c", "ratio_2cs"]].max(axis=1)

            recent = pa[pa["year_int"] >= 2020]
            if recent["school_upper"].nunique() < 10:
                recent = pa

            quality_df = recent.groupby("school_upper", as_index=False)["max_ratio"].mean()
            quality_df.columns = ["school_upper", "competition_score"]
            _qmin, _qmax = quality_df["competition_score"].min(), quality_df["competition_score"].max()
            quality_df["school_quality_score"] = 100.0 * (
                (quality_df["competition_score"] - _qmin) / (_qmax - _qmin + 1e-9)
            )
            print(f"      Competition scores computed for {len(quality_df):,} schools "
                  f"({recent['year_int'].min():.0f}–{recent['year_int'].max():.0f})")

            # --- Map MOE school_name → sgschooling school_upper ---
            _sg_names_set = set(quality_df["school_upper"])

            def _norm_moe(name):
                n = _na(name.strip().upper())
                for _sfx in [" PRIMARY SCHOOL", " SCHOOL (PRIMARY)", " SCHOOL (JUNIOR)",
                              " SCHOOL", " PRIMARY", " (PRIMARY)", " (JUNIOR)"]:
                    if n.endswith(_sfx):
                        _cand = n[: -len(_sfx)].strip()
                        if _cand in _sg_names_set:
                            return _cand
                n2 = n.replace(" SCHOOL ", " ").strip()
                if n2 in _sg_names_set:
                    return n2
                for _sfx in [" PRIMARY SCHOOL", " SCHOOL (PRIMARY)", " SCHOOL (JUNIOR)",
                              " SCHOOL", " PRIMARY"]:
                    if n.endswith(_sfx):
                        return n[: -len(_sfx)].strip()
                return n

            # Build geocoded primary schools table with quality scores
            school_info_df = pd.read_csv(school_info_csv)
            school_info_df.columns = school_info_df.columns.str.strip().str.lower()
            school_info_df["school_short"] = school_info_df["school_name"].apply(_norm_moe)
            school_info_df["school_upper_moe"] = school_info_df["school_name"].apply(
                lambda x: _na(x.strip().upper())
            )

            school_geo_df = pd.read_csv(school_geocode_csv)
            school_geo_df.columns = school_geo_df.columns.str.strip().str.lower()

            is_prim = school_info_df["mainlevel_code"].str.upper().str.contains("PRIMARY", na=False)
            prim_df = (
                school_info_df[is_prim][["school_name", "school_short"]]
                .merge(school_geo_df[["school_name", "lat", "lng"]], on="school_name", how="inner")
                .merge(quality_df[["school_upper", "school_quality_score"]],
                       left_on="school_short", right_on="school_upper", how="left")
                .drop_duplicates("school_name")
                .reset_index(drop=True)
            )
            matched = prim_df["school_quality_score"].notna().sum()
            print(f"      {matched}/{len(prim_df)} primary schools matched to quality scores")

            # BallTree within 1 km → inverse-distance-weighted quality
            from sklearn.neighbors import BallTree
            _RAD = np.radians(prim_df[["lat", "lng"]].values)
            _PROP_RAD = np.radians(df[["lat", "lng"]].values)
            _tree = BallTree(_RAD, metric="haversine")
            _earth_km = 6371.0
            _1km_rad = 1.0 / _earth_km

            _idx_list, _dist_list = _tree.query_radius(
                _PROP_RAD, r=_1km_rad, return_distance=True, sort_results=True
            )

            _new_qual = np.full(len(df), np.nan)
            for _i, (_idxs, _dists) in enumerate(zip(_idx_list, _dist_list)):
                if len(_idxs) == 0:
                    continue
                _scores = prim_df["school_quality_score"].values[_idxs]
                _valid = ~np.isnan(_scores)
                if not _valid.any():
                    continue
                _dists_km = _dists[_valid] * _earth_km
                _weights = 1.0 / np.where(_dists_km < 0.05, 0.05, _dists_km)
                _new_qual[_i] = np.average(_scores[_valid], weights=_weights)

            df["primary_school_quality_1km_weighted"] = _new_qual
            _cov = (~np.isnan(_new_qual)).sum()
            _mean = np.nanmean(_new_qual)
            _std  = np.nanstd(_new_qual)
            print(f"      Coverage: {_cov:,}/{len(df):,} properties have ≥1 primary school within 1 km")
            print(f"      Score range: {np.nanmin(_new_qual):.1f} – {np.nanmax(_new_qual):.1f}  "
                  f"mean={_mean:.2f}  std={_std:.2f}")

        except Exception as _e4b:
            print(f"      WARNING: Step 4b failed ({_e4b!r}) — keeping feature-CSV values.")

        # Drop temporary lat/lng columns
        df = df.drop(columns=["lat", "lng"])

        pct_within_1km = (df["famous_school_count_1km"] > 0).mean() * 100
        print(f"      {pct_within_1km:.1f}% of properties are within 1km of a famous primary school")

        # ----------------------------------------------------------------
        # Step 5: Normalize features to 0–10 scores
        # ----------------------------------------------------------------
        print("[5/6] Normalising features to 0–10 scores (p5–p95 clipping)...")
        norm_params: dict[str, dict] = {}
        for score_name, dim in SCORE_DIMENSIONS.items():
            src = dim["source"]
            if src not in df.columns:
                print(f"      WARNING: '{src}' not in feature table — {score_name} set to 5.0")
                df[score_name] = 5.0
                norm_params[score_name] = {
                    "source": src, "p5": 5.0, "p95": 5.0, "direction": dim["direction"]
                }
                continue

            vals = df[src].fillna(df[src].median())
            p5 = float(np.percentile(vals, 5))
            p95 = float(np.percentile(vals, 95))
            norm_params[score_name] = {
                "source": src,
                "direction": dim["direction"],
                "p5": p5,
                "p95": p95,
            }
            df[score_name] = _normalize_series(vals, p5, p95, dim["direction"])

        # ----------------------------------------------------------------
        # Step 6: Save KB and normalization params
        # ----------------------------------------------------------------
        print("[6/6] Saving knowledge base...")

        # Drop OHE and auxiliary columns that are no longer needed
        ohe_cols = [c for c in df.columns if c.startswith(("town_", "flat_type_", "flat_model_"))]
        aux_cols = [
            c for c in df.columns
            if c.startswith(("biz_", "market_", "years_since", "recency_"))
        ]
        df = df.drop(columns=[c for c in ohe_cols + aux_cols if c in df.columns])

        today = date.today().strftime("%Y%m%d")
        kb_path = output_dir / f"property_knowledge_base_{today}.parquet"
        params_path = output_dir / f"search_norm_params_{today}.json"

        df.to_parquet(kb_path, index=False)
        with open(params_path, "w") as f:
            json.dump(norm_params, f, indent=2)

        distances_path = output_dir / f"famous_school_distances_{today}.parquet"
        _distances_df.to_parquet(distances_path, index=False)

        print(f"      KB saved:              {kb_path}  ({len(df):,} properties)")
        print(f"      Norm params saved:      {params_path}")
        print(f"      School distances saved: {distances_path}  ({len(_distances_df):,} pairs within 2 km)")
        print("\nDone. PropertyKnowledgeBase ready.")

        return cls(kb_path=kb_path, norm_params_path=params_path)

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search(
        self,
        weights: dict[str, float],
        filters: dict | None = None,
        top_k: int = 10,
    ) -> pd.DataFrame:
        """
        Rank properties by weighted composite score.

        Parameters
        ----------
        weights : dict
            ``{score_dimension: weight}`` where weight is 0–10.
            Only dimensions with weight > 0 contribute to the composite score.
            Example::

                {"score_famous_school": 10, "score_mrt": 7, "score_size": 5}

        filters : dict, optional
            Hard filters applied before scoring. Supported keys:

            =======================  ==================================
            Key                      Effect
            =======================  ==================================
            ``flat_type``            Exact match (e.g. ``"4 ROOM"``)
            ``town``                 Exact match (e.g. ``"BISHAN"``)
            ``flat_model``           Exact match (e.g. ``"Model A"``)
            ``min_floor_area``       ``floor_area_sqm >= value``
            ``max_resale_price``     ``resale_price <= value``
            ``min_lease_years``      ``lease_remaining_years >= value``
            ``max_dist_mrt_m``       ``dist_to_mrt_m <= value``
            ``require_famous_school``  ``famous_school_count_1km > 0``
            =======================  ==================================

        top_k : int
            Number of results to return. Default 10.

        Returns
        -------
        pd.DataFrame
            Top-k properties sorted by ``composite_score`` descending.
        """
        df = self.kb.copy()
        filters = filters or {}

        # --- Apply hard filters ---
        def _str_filter(col, val):
            """Accept either a single string or a list of strings for exact-match filtering."""
            if isinstance(val, (list, tuple)):
                return df[col].str.upper().isin([str(v).upper() for v in val])
            return df[col].str.upper() == str(val).upper()

        if "flat_type" in filters:
            df = df[_str_filter("flat_type", filters["flat_type"])]
        if "town" in filters:
            df = df[_str_filter("town", filters["town"])]
        if "flat_model" in filters:
            df = df[_str_filter("flat_model", filters["flat_model"])]
        if "min_floor_area" in filters:
            df = df[df["floor_area_sqm"] >= float(filters["min_floor_area"])]
        if "max_resale_price" in filters:
            df = df[df["resale_price"] <= float(filters["max_resale_price"])]
        if "min_lease_years" in filters:
            df = df[df["lease_remaining_years"] >= float(filters["min_lease_years"])]
        if "max_dist_mrt_m" in filters:
            df = df[df["dist_to_mrt_m"] <= float(filters["max_dist_mrt_m"])]
        if filters.get("require_famous_school"):
            df = df[df["famous_school_count_1km"] > 0]

        if df.empty:
            print("WARNING: No properties match the given filters.")
            return pd.DataFrame(columns=[c for c in _RESULT_COLS if c != "composite_score"])

        # --- Weighted composite score ---
        active = {k: float(v) for k, v in weights.items() if k in self._score_cols and float(v) > 0}
        if not active:
            print("WARNING: No valid score dimensions in weights. Returning unranked results.")
            df["composite_score"] = 0.0
        else:
            total_w = sum(active.values())
            df["composite_score"] = sum(
                (w / total_w) * df[score] for score, w in active.items()
            ).round(4)

        df = df.sort_values("composite_score", ascending=False).head(top_k)

        result_cols = [c for c in _RESULT_COLS if c in df.columns]
        return df[result_cols].reset_index(drop=True)

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def describe_scores(self) -> dict[str, dict]:
        """Return human-readable descriptions of all 12 scoring dimensions."""
        out = {}
        for name, dim in SCORE_DIMENSIONS.items():
            params = self.norm_params.get(name, {})
            out[name] = {
                "label": dim["label"],
                "description": dim["description"],
                "direction": dim["direction"],
                "source_feature": dim["source"],
                "p5": params.get("p5"),
                "p95": params.get("p95"),
                "scale": "0 (worst) → 10 (best)",
            }
        return out

    def score_summary(self) -> pd.DataFrame:
        """Return distribution statistics for all score dimensions."""
        score_cols = [c for c in self._score_cols if c in self.kb.columns]
        stats = self.kb[score_cols].describe().T.round(3)
        stats.index.name = "score_dimension"
        return stats

    def famous_schools_list(self) -> pd.Series:
        """Return the famous primary schools represented in the KB."""
        if "nearest_famous_school_name" not in self.kb.columns:
            return pd.Series([], dtype=str, name="famous_school")
        return pd.Series(
            self.kb["nearest_famous_school_name"].unique(), name="famous_school"
        ).sort_values().reset_index(drop=True)

    # ------------------------------------------------------------------
    # Neo4j push
    # ------------------------------------------------------------------

    def push_to_neo4j(
        self,
        uri: str | None = None,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
        batch_size: int = 500,
        distances_path: str | Path | None = None,
    ) -> None:
        """
        Load the knowledge base into a Neo4j graph database.

        Graph model created
        -------------------
        (:Property)             — one node per unique HDB flat (all scores as properties)
        (:FamousSchool)         — 17 famous primary school nodes
        (:Town)                 — 26 HDB town nodes
        (Property)-[:LOCATED_IN]->(Town)
        (Property)-[:NEAREST_FAMOUS_SCHOOL {distance_km}]->(FamousSchool)
        (Property)-[:NEAR_FAMOUS_SCHOOL {distance_km}]->(FamousSchool)  (within 2 km)

        Credentials are read from environment / .env if not passed explicitly.
        """
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise ImportError("Install the neo4j driver: pip install neo4j") from exc

        try:
            from dotenv import load_dotenv
            load_dotenv()
        except ImportError:
            pass  # dotenv optional

        uri = uri or os.getenv("NEO4J_URI")
        username = username or os.getenv("NEO4J_USERNAME")
        password = password or os.getenv("NEO4J_PASSWORD")
        database = database or os.getenv("NEO4J_DATABASE")

        if not all([uri, username, password]):
            raise ValueError("Neo4j credentials missing. Set NEO4J_URI/USERNAME/PASSWORD in .env.")

        # Resolve pairwise distances file
        if distances_path is None:
            artifact_dir = self._kb_path.parent
            candidates = sorted(artifact_dir.glob("famous_school_distances_*.parquet"))
            distances_path = candidates[-1] if candidates else None

        print(f"Connecting to Neo4j: {uri}")
        driver = GraphDatabase.driver(uri, auth=(username, password))

        try:
            with driver.session(database=database) as session:
                # --- Constraints & indexes ---
                print("[1/6] Creating constraints and indexes...")
                session.run(
                    "CREATE CONSTRAINT property_key IF NOT EXISTS "
                    "FOR (p:Property) REQUIRE p.address_key IS UNIQUE"
                )
                session.run(
                    "CREATE CONSTRAINT town_name IF NOT EXISTS "
                    "FOR (t:Town) REQUIRE t.name IS UNIQUE"
                )
                session.run(
                    "CREATE CONSTRAINT school_name IF NOT EXISTS "
                    "FOR (s:FamousSchool) REQUIRE s.name IS UNIQUE"
                )
                # Index for common filter columns
                for prop in ("flat_type", "town", "flat_model"):
                    session.run(
                        f"CREATE INDEX property_{prop} IF NOT EXISTS "
                        f"FOR (p:Property) ON (p.{prop})"
                    )

                # --- Town nodes ---
                print("[2/6] Creating Town nodes...")
                towns = self.kb["town"].dropna().unique().tolist()
                session.run(
                    "UNWIND $towns AS name MERGE (:Town {name: name})",
                    towns=towns,
                )
                print(f"      {len(towns)} towns")

                # --- Famous school nodes ---
                print("[3/6] Creating FamousSchool nodes...")
                famous_names = self.kb["nearest_famous_school_name"].dropna().unique().tolist()
                # Store name only (lat/lng not carried in KB)
                session.run(
                    "UNWIND $schools AS name MERGE (:FamousSchool {name: name})",
                    schools=famous_names,
                )
                print(f"      {len(famous_names)} famous schools")

                # --- Property nodes (batched) ---
                print("[4/6] Creating Property nodes...")
                # Prepare records — convert numpy types to Python native for Neo4j
                prop_records = (
                    self.kb
                    .fillna({"nearest_famous_school_name": "", "street_name": "", "flat_model": ""})
                    .fillna(0)
                    .to_dict("records")
                )
                def _to_native(v: Any) -> Any:
                    """Convert numpy scalars to Python native types for Neo4j."""
                    if hasattr(v, "item"):          # numpy scalar
                        return v.item()
                    if isinstance(v, float) and (v != v):  # NaN check
                        return None
                    return v

                total = len(prop_records)
                loaded = 0
                for start in range(0, total, batch_size):
                    batch = [
                        {k: _to_native(v) for k, v in rec.items()}
                        for rec in prop_records[start: start + batch_size]
                    ]
                    session.run(
                        "UNWIND $props AS row "
                        "MERGE (p:Property {address_key: row.address_key}) "
                        "SET p += row",
                        props=batch,
                    )
                    loaded += len(batch)
                    print(f"      {loaded:,}/{total:,} properties", end="\r")
                print(f"      {total:,} properties loaded        ")

                # --- LOCATED_IN relationships ---
                print("[5/6] Creating LOCATED_IN relationships...")
                loc_data = self.kb[["address_key", "town"]].dropna().to_dict("records")
                for start in range(0, len(loc_data), batch_size):
                    session.run(
                        "UNWIND $rows AS row "
                        "MATCH (p:Property {address_key: row.address_key}) "
                        "MATCH (t:Town {name: row.town}) "
                        "MERGE (p)-[:LOCATED_IN]->(t)",
                        rows=loc_data[start: start + batch_size],
                    )
                print(f"      {len(loc_data):,} LOCATED_IN relationships")

                # --- NEAREST_FAMOUS_SCHOOL relationships ---
                print("[6/6] Creating NEAREST/NEAR_FAMOUS_SCHOOL relationships...")
                nearest_data = (
                    self.kb[["address_key", "nearest_famous_school_name", "dist_to_nearest_famous_school_km"]]
                    .dropna(subset=["nearest_famous_school_name"])
                    .rename(columns={
                        "nearest_famous_school_name": "school_name",
                        "dist_to_nearest_famous_school_km": "distance_km",
                    })
                    .to_dict("records")
                )
                for start in range(0, len(nearest_data), batch_size):
                    session.run(
                        "UNWIND $rows AS row "
                        "MATCH (p:Property {address_key: row.address_key}) "
                        "MATCH (s:FamousSchool {name: row.school_name}) "
                        "MERGE (p)-[r:NEAREST_FAMOUS_SCHOOL]->(s) "
                        "SET r.distance_km = row.distance_km",
                        rows=nearest_data[start: start + batch_size],
                    )
                print(f"      {len(nearest_data):,} NEAREST_FAMOUS_SCHOOL relationships")

                # NEAR_FAMOUS_SCHOOL (all within 2 km) — from pairwise distances file
                if distances_path and Path(distances_path).exists():
                    dist_df = pd.read_parquet(distances_path)
                    near_data = dist_df.to_dict("records")
                    for start in range(0, len(near_data), batch_size):
                        session.run(
                            "UNWIND $rows AS row "
                            "MATCH (p:Property {address_key: row.address_key}) "
                            "MATCH (s:FamousSchool {name: row.school_name}) "
                            "MERGE (p)-[r:NEAR_FAMOUS_SCHOOL]->(s) "
                            "SET r.distance_km = row.distance_km",
                            rows=near_data[start: start + batch_size],
                        )
                    print(f"      {len(near_data):,} NEAR_FAMOUS_SCHOOL relationships (within 2 km)")
                else:
                    print("      Skipped NEAR_FAMOUS_SCHOOL (distances file not found)")

        finally:
            driver.close()

        print("\nNeo4j load complete.")

    def __repr__(self) -> str:
        return (
            f"PropertyKnowledgeBase("
            f"properties={len(self.kb):,}, "
            f"score_dims={len(self._score_cols)}, "
            f"kb={self._kb_path.name})"
        )


# ---------------------------------------------------------------------------
# Neo4j search class
# ---------------------------------------------------------------------------

# Cypher query — all weight params default to 0.0; NULL filter params = no filter
_CYPHER_SEARCH = """\
MATCH (p:Property)
WHERE ($flat_type    IS NULL OR p.flat_type    IN $flat_type)
  AND ($town         IS NULL OR p.town         IN $town)
  AND ($flat_model   IS NULL OR p.flat_model   IN $flat_model)
  AND ($min_floor_area   IS NULL OR p.floor_area_sqm      >= $min_floor_area)
  AND ($max_resale_price IS NULL OR p.resale_price         <= $max_resale_price)
  AND ($min_lease_years  IS NULL OR p.lease_remaining_years >= $min_lease_years)
  AND ($max_dist_mrt_m   IS NULL OR p.dist_to_mrt_m        <= $max_dist_mrt_m)
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


class Neo4jPropertySearch:
    """
    Weighted property search backed by Neo4j AuraDB.

    Provides the same ``search()`` interface as ``PropertyKnowledgeBase`` but
    executes Cypher queries against the graph, enabling graph traversal on top
    of weighted ranking.

    Credentials are loaded from environment variables / .env file by default:
    NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE.

    Usage
    -----
    >>> with Neo4jPropertySearch() as neo4j:
    ...     results = neo4j.search(
    ...         weights={"score_famous_school": 10, "score_mrt": 7},
    ...         filters={"flat_type": "4 ROOM"},
    ...         top_k=10,
    ...     )
    """

    def __init__(
        self,
        uri: str | None = None,
        username: str | None = None,
        password: str | None = None,
        database: str | None = None,
    ) -> None:
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise ImportError("Install the neo4j driver: pip install neo4j") from exc

        try:
            from dotenv import load_dotenv
            load_dotenv()
        except ImportError:
            pass

        self._uri = uri or os.getenv("NEO4J_URI")
        self._username = username or os.getenv("NEO4J_USERNAME")
        self._password = password or os.getenv("NEO4J_PASSWORD")
        self._database = database or os.getenv("NEO4J_DATABASE")

        if not all([self._uri, self._username, self._password]):
            raise ValueError(
                "Neo4j credentials missing. "
                "Set NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD in .env."
            )

        from neo4j import GraphDatabase
        self._driver = GraphDatabase.driver(
            self._uri, auth=(self._username, self._password)
        )
        self._score_cols = list(SCORE_DIMENSIONS.keys())

    def search(
        self,
        weights: dict[str, float],
        filters: dict | None = None,
        top_k: int = 10,
    ) -> pd.DataFrame:
        """
        Rank properties by weighted composite score using Cypher.

        Parameters and filter keys are identical to ``PropertyKnowledgeBase.search()``.
        """
        filters = filters or {}
        active = {k: float(v) for k, v in weights.items() if k in self._score_cols and float(v) > 0}
        total_w = sum(active.values()) if active else 1.0

        # Build weight params — zero for unspecified dimensions
        weight_params = {f"w_{s}": active.get(s, 0.0) for s in self._score_cols}

        def _to_list_or_none(val):
            """Normalise string or list filter values for Cypher IN operator."""
            if val is None:
                return None
            if isinstance(val, (list, tuple)):
                return [str(v).upper() for v in val]
            return [str(val).upper()]

        params = {
            **weight_params,
            "total_weight": total_w,
            "top_k": int(top_k),
            # Filters — None means no filter in Cypher; lists used with IN operator
            "flat_type": _to_list_or_none(filters.get("flat_type")),
            "town": _to_list_or_none(filters.get("town")),
            "flat_model": _to_list_or_none(filters.get("flat_model")),
            "min_floor_area": filters.get("min_floor_area"),
            "max_resale_price": filters.get("max_resale_price"),
            "min_lease_years": filters.get("min_lease_years"),
            "max_dist_mrt_m": filters.get("max_dist_mrt_m"),
            "require_famous_school": bool(filters.get("require_famous_school", False)),
        }

        with self._driver.session(database=self._database) as session:
            result = session.run(_CYPHER_SEARCH, **params)
            records = [
                {**dict(r["props"]), "composite_score": r["composite_score"]}
                for r in result
            ]

        if not records:
            print("WARNING: No properties match the given filters.")
            return pd.DataFrame()

        df = pd.DataFrame(records)
        result_cols = [c for c in _RESULT_COLS if c in df.columns]
        return df[result_cols].reset_index(drop=True)

    def graph_query(self, cypher: str, **params) -> list[dict]:
        """
        Run a raw Cypher query and return results as a list of dicts.

        Useful for graph traversal queries, e.g.:
            neo4j.graph_query(
                "MATCH (p:Property)-[:NEAR_FAMOUS_SCHOOL]->(s:FamousSchool {name: $name}) "
                "RETURN p.address_key, p.town ORDER BY p.score_famous_school DESC LIMIT 20",
                name="NANYANG PRIMARY SCHOOL"
            )
        """
        with self._driver.session(database=self._database) as session:
            result = session.run(cypher, **params)
            return [dict(r) for r in result]

    def node_counts(self) -> dict[str, int]:
        """Return count of each node label in the graph."""
        counts = {}
        for label in ("Property", "Town", "FamousSchool"):
            with self._driver.session(database=self._database) as session:
                result = session.run(f"MATCH (n:{label}) RETURN count(n) AS c")
                counts[label] = result.single()["c"]
        return counts

    def close(self) -> None:
        self._driver.close()

    def __enter__(self) -> "Neo4jPropertySearch":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"Neo4jPropertySearch(uri={self._uri}, database={self._database})"
