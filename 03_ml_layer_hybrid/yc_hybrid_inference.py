"""
YC cluster-hybrid inference and 8-field feature builder.

Loads artefacts from exploration-on-yc-data/artifacts/hybrid_cluster_*.joblib
and predicts resale_price from a 77-column feature matrix aligned with
hybrid_cluster_feature_columns.json.

The 8-input builder matches 07b's user fields but targets the YC schema via
lookup on the latest ``hdb_feature_table_*.csv`` under
``hf_data/02_feature_layer/training/outputs/`` (same snapshot as training notebooks),
unless ``yc_csv`` is passed explicitly.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

import joblib
import numpy as np
import pandas as pd

# ── Paths (module lives in 03_ml_layer_hybrid/ or similar) ───────────────────
_HERE = Path(__file__).resolve().parent
_ART = _HERE / "artifacts"
_DEFAULT_BUNDLE = _ART / "hybrid_cluster_bundle.joblib"
_DEFAULT_FEAT_JSON = _ART / "hybrid_cluster_feature_columns.json"
_REPO_ROOT = _HERE.parent
_HF_FEATURE_OUTPUTS = (
    _REPO_ROOT / "hf_data" / "02_feature_layer" / "training" / "outputs"
)


def default_feature_table_csv() -> Path:
    """Latest ``hdb_feature_table_YYYYMMDD.csv`` under feature-layer outputs."""
    tables = sorted(_HF_FEATURE_OUTPUTS.glob("hdb_feature_table_*.csv"))
    if not tables:
        raise FileNotFoundError(
            f"No hdb_feature_table_*.csv under {_HF_FEATURE_OUTPUTS}"
        )
    return tables[-1]


def bundle_feature_table_csv(bundle: dict[str, Any] | None) -> Path:
    """
    Return the feature CSV path appropriate for a given bundle.

    Prefers ``bundle["feature_csv"]`` (set at training time so the correct
    snapshot is used for address lookup, especially for bundles trained on
    older snapshots with different feature sets).  Falls back to the latest
    snapshot if the saved path is absent or the file no longer exists.
    """
    if bundle is not None:
        saved = bundle.get("feature_csv")
        if saved:
            p = Path(saved)
            if not p.is_absolute():
                p = _REPO_ROOT / p
            if p.exists():
                return p
    return default_feature_table_csv()

# Eight fields matching 07b / predict_from_user_input
USER_INPUT_KEYS = (
    "block",
    "street_name",
    "town",
    "flat_type",
    "floor_area_sqm",
    "storey_range",
    "lease_commence_date",
    "sale_month",
)


def load_bundle(path: Path | str | None = None) -> dict[str, Any]:
    """Load the saved hybrid payload (k-means, globals, per-cluster models, columns)."""
    p = Path(path) if path else _DEFAULT_BUNDLE
    if not p.exists():
        raise FileNotFoundError(f"Bundle not found: {p}")
    return joblib.load(p)


def load_feature_columns(path: Path | str | None = None) -> list[str]:
    p = Path(path) if path else _DEFAULT_FEAT_JSON
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _inv_transform(y: np.ndarray, log_target: bool) -> np.ndarray:
    """Back-transform log-space predictions to price space."""
    return np.exp(y) if log_target else y


def _collect_global_blend_row(
    x_row: np.ndarray,
    gm: dict[str, Any],
    log_target: bool = False,
) -> np.ndarray:
    """
    Single row (1, n_feat) → scalar blend prediction (price space).
    Supports bundles with or without 'ridge'/'meta' keys (v4+ uses XGB/LGB/RF only).
    """
    preds = []
    if "ridge" in gm:
        preds.append(_inv_transform(gm["ridge"].predict(x_row), log_target))
    if "xgb" in gm:
        preds.append(_inv_transform(gm["xgb"].predict(x_row), log_target))
    if "lgb" in gm:
        preds.append(_inv_transform(gm["lgb"].predict(x_row), log_target))
    if "rf" in gm:
        preds.append(_inv_transform(gm["rf"].predict(x_row), log_target))
    P = np.column_stack(preds)
    w = np.asarray(gm["blend_weights"], dtype=float).ravel()
    return (P @ w).ravel()


def _collect_global_stack_row(
    x_row: np.ndarray,
    gm: dict[str, Any],
    log_target: bool = False,
) -> np.ndarray:
    """Legacy stack path (uses 'meta' key if present, else falls back to blend)."""
    if "meta" in gm:
        preds = []
        if "ridge" in gm:
            preds.append(_inv_transform(gm["ridge"].predict(x_row), log_target))
        for key in ("xgb", "lgb", "rf"):
            if key in gm:
                preds.append(_inv_transform(gm[key].predict(x_row), log_target))
        P = np.column_stack(preds)
        return gm["meta"].predict(P).ravel()
    return _collect_global_blend_row(x_row, gm, log_target)


def predict_price(
    X: np.ndarray,
    bundle: dict[str, Any] | None = None,
    *,
    use_blend_for_fallback: bool = True,
) -> np.ndarray:
    """
    Predict resale price for feature matrix X (n_samples, n_features).

    Column order must match bundle['feature_columns'].

    Supports bundles trained with log_target=True (models predict log(price);
    this function automatically applies exp() to return SGD prices).

    Supports two bundle formats:
    - Legacy (v1–v3): per-cluster bundles with 'ridge', 'xgb', 'lgb', 'rf', 'meta'
    - v4+: per-cluster bundles with 'xgb', 'lgb', 'rf', 'blend_weights' (no meta/ridge)
    """
    if bundle is None:
        bundle = load_bundle()
    feature_columns: list[str] = bundle["feature_columns"]
    cluster_cols: list[str] = bundle["cluster_cols"]
    log_target: bool = bool(bundle.get("log_target", False))

    if X.ndim != 2 or X.shape[1] != len(feature_columns):
        raise ValueError(
            f"Expected X shape (n, {len(feature_columns)}), got {getattr(X, 'shape', None)}"
        )

    idx = [feature_columns.index(c) for c in cluster_cols]
    Xc = X[:, idx]
    km = bundle["kmeans"]
    sc = bundle["cluster_scaler"]
    labels = km.predict(sc.transform(Xc))

    cluster_bundles: dict = bundle["cluster_bundles"]
    gm = bundle["global_models"]
    n = X.shape[0]
    out = np.zeros(n, dtype=float)

    for i in range(n):
        x_row = X[i : i + 1]
        k = int(labels[i])
        cb = cluster_bundles[k] if k in cluster_bundles else cluster_bundles[str(k)]
        if cb.get("fallback"):
            if use_blend_for_fallback:
                out[i] = _collect_global_blend_row(x_row, gm, log_target)[0]
            else:
                out[i] = _collect_global_stack_row(x_row, gm, log_target)[0]
        elif "meta" in cb:
            # Legacy format (v1-v3): ridge + xgb + lgb + rf → Ridge/LGB meta
            preds = []
            for key in ("ridge", "xgb", "lgb", "rf"):
                if key in cb:
                    preds.append(_inv_transform(cb[key].predict(x_row), log_target))
            P = np.column_stack(preds)
            out[i] = float(cb["meta"].predict(P)[0])
        else:
            # v4+ format: xgb + lgb + rf → MAPE-optimal blend weights
            preds = []
            for key in ("xgb", "lgb", "rf"):
                if key in cb:
                    preds.append(_inv_transform(cb[key].predict(x_row), log_target))
            P = np.column_stack(preds)
            w = np.asarray(cb["blend_weights"], dtype=float).ravel()
            out[i] = float(np.maximum((P @ w).item(), 1))
    return out


# ── 8-input feature builder ─────────────────────────────────────────────────

_FLAT_TO_ROOMS = {
    "1 ROOM": 1,
    "2 ROOM": 2,
    "3 ROOM": 3,
    "4 ROOM": 4,
    "5 ROOM": 5,
    "EXECUTIVE": 5,
    "MULTI-GENERATION": 4,
}


def _parse_storey_mid(storey_range: str) -> float:
    s = str(storey_range).strip().upper()
    if " TO " in s:
        parts = s.replace(" TO ", " ").split()
        return (int(parts[0]) + int(parts[1])) / 2.0
    return float(s)


def _normalize_street_for_yc(street_name: str) -> str:
    """YC address_key uses e.g. LOR instead of LORONG."""
    s = str(street_name).strip().upper()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"^LORONG\s+", "LOR ", s)
    s = re.sub(r"\bLORONG\b", "LOR", s)
    return s.strip()


def _candidate_address_keys(block: str, street_name: str) -> list[str]:
    b = str(block).strip()
    raw = str(street_name).strip().upper()
    raw = re.sub(r"\s+", " ", raw)
    keys = [f"{b} {raw}", f"{b} {_normalize_street_for_yc(street_name)}"]
    # de-dup preserving order
    seen = set()
    out = []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


@lru_cache(maxsize=8)
def _load_yc_dataframe(yc_csv: str | None) -> pd.DataFrame:
    path = Path(yc_csv) if yc_csv else default_feature_table_csv()
    if not path.exists():
        raise FileNotFoundError(f"Feature table not found: {path}")
    return pd.read_csv(path)


def _town_dummy_column(town: str) -> str:
    return f"town_{town.strip().upper()}"


def _flat_type_dummy_column(flat_type: str) -> str:
    ft = flat_type.strip().upper().replace("MULTI GENERATION", "MULTI-GENERATION")
    return f"flat_type_{ft}"


def build_yc_hybrid_vector(
    block: str,
    street_name: str,
    town: str,
    flat_type: str,
    floor_area_sqm: float,
    storey_range: str,
    lease_commence_date: int,
    sale_month: str,
    *,
    yc_csv: str | Path | None = None,
    feature_columns: list[str] | None = None,
) -> dict[str, Any]:
    """
    Build one row aligned to hybrid_cluster_feature_columns.

    Returns dict with:
      - ``vector``: np.ndarray shape (1, n_features)
      - ``features_dict``: column -> float
      - ``lookup_matched``: bool — True if a YC row was matched for POI/market fields
      - ``matched_address_key``: str or None
      - ``imputation_note``: str — empty if lookup ok, else explains cold-start
    """
    if feature_columns is None:
        feature_columns = load_feature_columns()

    town_u = town.strip().upper()
    ft_u = flat_type.strip().upper().replace("MULTI GENERATION", "MULTI-GENERATION")

    dt = pd.to_datetime(sale_month, format="%Y-%m")
    year = int(dt.year)

    level_mid = _parse_storey_mid(storey_range)
    remaining_lease_years = max(0, min(99, 99 - (year - int(lease_commence_date))))
    room_count = float(_FLAT_TO_ROOMS.get(ft_u, 3))

    df = _load_yc_dataframe(str(yc_csv) if yc_csv else None)

    town_col = _town_dummy_column(town_u)
    if town_col not in df.columns:
        raise ValueError(f"Unknown town for YC schema: {town_u!r} (expected column {town_col})")

    candidates = _candidate_address_keys(block, street_name)
    sub = df[df[town_col] == True]  # noqa: E712
    if len(sub) == 0:
        sub = df

    matched = pd.DataFrame()
    matched_key = None
    for key in candidates:
        m = sub[sub["address_key"].astype(str).str.upper().str.strip() == key]
        if len(m) > 0:
            matched = m.sort_values("transaction_year", ascending=False)
            matched_key = key
            break

    if len(matched) == 0:
        # prefix match: block + street contains
        b = str(block).strip()
        st = _normalize_street_for_yc(street_name)
        pat = sub["address_key"].astype(str).str.upper()
        tok = st.split()[0] if st else ""
        mask = pat.str.startswith(b + " ")
        if tok:
            mask = mask & pat.str.contains(re.escape(tok), regex=True, na=False)
        m2 = sub[mask]
        if len(m2) > 0:
            matched = m2.sort_values("transaction_year", ascending=False)
            matched_key = str(matched.iloc[0]["address_key"])

    imputation_note = ""
    lookup_matched = len(matched) > 0
    feats: dict[str, float] = {}

    if lookup_matched:
        row = matched.iloc[0]
        for c in feature_columns:
            if c in row.index:
                v = row[c]
                if isinstance(v, (bool, np.bool_)):
                    feats[c] = 1.0 if v else 0.0
                elif pd.isna(v):
                    feats[c] = 0.0
                else:
                    feats[c] = float(v)
            else:
                feats[c] = 0.0
    else:
        imputation_note = (
            "No address_key match; using town-level medians for continuous POI/market fields."
        )
        sub_town = df[df[town_col] == True]  # noqa: E712
        if len(sub_town) == 0:
            sub_town = df
            imputation_note += " (town column empty — using full-table medians.)"
        for c in feature_columns:
            if c not in sub_town.columns:
                feats[c] = 0.0
                continue
            if c.startswith("town_") or c.startswith("flat_type_"):
                feats[c] = 0.0
            elif c.startswith("flat_model_") or c in (
                "transaction_year",
                "level_mid",
                "lease_remaining_years",
                "floor_area_sqm",
                "room_count",
            ):
                feats[c] = float(sub_town[c].median())
            else:
                try:
                    feats[c] = float(sub_town[c].median())
                except (TypeError, ValueError):
                    feats[c] = 0.0

    # Overrides (user-specific)
    feats["transaction_year"] = float(year)
    feats["level_mid"] = float(level_mid)
    feats["lease_remaining_years"] = float(remaining_lease_years)
    feats["floor_area_sqm"] = float(floor_area_sqm)
    feats["room_count"] = float(room_count)

    ft_dummy = _flat_type_dummy_column(ft_u)
    for c in feature_columns:
        if c.startswith("town_"):
            feats[c] = 1.0 if c == town_col else 0.0
        elif c.startswith("flat_type_"):
            feats[c] = 1.0 if c == ft_dummy else 0.0

    vec = np.array([[float(feats.get(col, 0.0)) for col in feature_columns]], dtype=float)

    return {
        "vector": vec,
        "features_dict": feats,
        "lookup_matched": lookup_matched,
        "matched_address_key": matched_key,
        "imputation_note": imputation_note,
    }


def predict_from_user_input(
    block: str,
    street_name: str,
    town: str,
    flat_type: str,
    floor_area_sqm: float,
    storey_range: str,
    lease_commence_date: int,
    sale_month: str,
    *,
    bundle: dict[str, Any] | None = None,
    yc_csv: str | Path | None = None,
) -> dict[str, Any]:
    """Convenience: build vector + run predict_price."""
    bundle = bundle or load_bundle()
    if yc_csv is None:
        yc_csv = bundle_feature_table_csv(bundle)
    built = build_yc_hybrid_vector(
        block,
        street_name,
        town,
        flat_type,
        floor_area_sqm,
        storey_range,
        lease_commence_date,
        sale_month,
        yc_csv=yc_csv,
        feature_columns=bundle["feature_columns"],
    )
    X = built["vector"]
    price = float(predict_price(X, bundle)[0])
    return {**built, "predicted_resale_price": price}


def predict_bulk_listings(
    listings: Sequence[dict[str, Any]],
    *,
    bundle: dict[str, Any] | None = None,
    yc_csv: str | Path | None = None,
) -> pd.DataFrame:
    """
    Predict resale prices for many listings in one pass (single batched ``predict_price`` call).

    Each dict must include all keys in ``USER_INPUT_KEYS``. Extra keys (e.g. ``listing_id``,
    ``label``) are copied into the output rows.

    Optional per row: ``actual_price`` — if set, adds ``abs_error_sgd``,
    ``pct_error_vs_actual`` (signed % vs actual), and ``mape_row_pct`` (absolute % error).

    Returns a DataFrame with inputs, ``predicted_resale_price``, ``lookup_matched``,
    ``matched_address_key``, ``imputation_note``, and optional error columns.
    """
    if len(listings) == 0:
        return pd.DataFrame()

    missing_any: list[str] = []
    for i, rec in enumerate(listings):
        miss = [k for k in USER_INPUT_KEYS if k not in rec]
        if miss:
            missing_any.append(f"row {i}: missing {miss}")
    if missing_any:
        raise ValueError("; ".join(missing_any))

    bundle = bundle or load_bundle()
    if yc_csv is None:
        yc_csv = bundle_feature_table_csv(bundle)
    built_list: list[dict[str, Any]] = []
    for rec in listings:
        b = build_yc_hybrid_vector(
            rec["block"],
            rec["street_name"],
            rec["town"],
            rec["flat_type"],
            float(rec["floor_area_sqm"]),
            rec["storey_range"],
            int(rec["lease_commence_date"]),
            rec["sale_month"],
            yc_csv=yc_csv,
            feature_columns=bundle["feature_columns"],
        )
        built_list.append(b)

    X = np.vstack([b["vector"] for b in built_list])
    preds = predict_price(X, bundle)

    rows: list[dict[str, Any]] = []
    for rec, b, pred in zip(listings, built_list, preds):
        pred_f = float(pred)
        row: dict[str, Any] = {k: rec[k] for k in USER_INPUT_KEYS}
        row["predicted_resale_price"] = pred_f
        row["lookup_matched"] = b["lookup_matched"]
        row["matched_address_key"] = b["matched_address_key"]
        row["imputation_note"] = b["imputation_note"] or ""

        for k, v in rec.items():
            if k in USER_INPUT_KEYS or k == "actual_price":
                continue
            row[k] = v

        if "actual_price" in rec and rec["actual_price"] is not None:
            ap = float(rec["actual_price"])
            row["actual_price"] = ap
            row["abs_error_sgd"] = abs(pred_f - ap)
            row["pct_error_vs_actual"] = (pred_f - ap) / ap * 100.0
            row["mape_row_pct"] = abs(pred_f - ap) / ap * 100.0

        rows.append(row)

    return pd.DataFrame(rows)


def per_listing_evaluation_table(df: pd.DataFrame) -> pd.DataFrame:
    """
    One row per listing with readable evaluation columns (requires ``actual_price``).

    Uses ``listing_id`` if present, else the dataframe index.
    """
    if df.empty or "actual_price" not in df.columns:
        return pd.DataFrame()
    sub = df.dropna(subset=["actual_price"]).copy()
    if sub.empty:
        return pd.DataFrame()
    rows = []
    for i, r in sub.iterrows():
        lid = r["listing_id"] if "listing_id" in sub.columns and pd.notna(r.get("listing_id")) else i
        block = r.get("block", "")
        street = r.get("street_name", "")
        rows.append(
            {
                "listing_id": lid,
                "address_short": f"{block} {street}".strip(),
                "actual_sgd": float(r["actual_price"]),
                "predicted_sgd": float(r["predicted_resale_price"]),
                "abs_error_sgd": float(r["abs_error_sgd"]),
                "mape_pct": float(r.get("mape_row_pct", abs(r["predicted_resale_price"] - r["actual_price"]) / r["actual_price"] * 100)),
                "bias_pct": float(r["pct_error_vs_actual"]),
            }
        )
    return pd.DataFrame(rows)


def bulk_evaluation_summary(df: pd.DataFrame) -> pd.Series:
    """
    If ``df`` has ``actual_price`` and ``predicted_resale_price``, return MAE, RMSE, MAPE, mean bias %.
    Otherwise returns an empty Series.
    """
    if df.empty or "actual_price" not in df.columns or "predicted_resale_price" not in df.columns:
        return pd.Series(dtype=float)
    y_t = df["actual_price"].astype(float).values
    y_p = df["predicted_resale_price"].astype(float).values
    err = y_p - y_t
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err**2)))
    mape = float(np.mean(np.abs(err / y_t)) * 100)
    bias = float(np.mean(err / y_t) * 100)
    return pd.Series(
        {"n": len(df), "MAE_SGD": mae, "RMSE_SGD": rmse, "MAPE_pct": mape, "mean_bias_pct": bias}
    )
