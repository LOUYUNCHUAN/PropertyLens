"""
Shared backend state and path configuration.

This module must not import router modules (to avoid circular imports).
"""

from __future__ import annotations

from pathlib import Path
import os
import sys

from dotenv import load_dotenv


# ── Paths ─────────────────────────────────────────────────────────
BACKEND_DIR = Path(__file__).parent
REPO_ROOT = BACKEND_DIR.parent

# Ensure `import backend.*` works whether the process starts in repo root or `backend/`.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)

_art = os.environ.get("PROPERTYLENS_ARTIFACTS_DIR", "").strip()
_feat = os.environ.get("PROPERTYLENS_FEATURE_LAYER_OUTPUTS", "").strip()
ARTIFACTS_ROOT = Path(_art) if _art else REPO_ROOT / "data" / "artifacts"
FEATURE_LAYER_OUTPUTS = (
    Path(_feat)
    if _feat
    else REPO_ROOT / "data" / "feature_data" / "02_feature_layer" / "training" / "outputs"
)
_ft_csv_env = os.environ.get("PROPERTYLENS_FEATURE_TABLE_CSV", "").strip()
FEATURE_TABLE_CSV_RESOLVED: Path | None = None
if _ft_csv_env:
    _p_ft = Path(_ft_csv_env)
    FEATURE_TABLE_CSV_RESOLVED = (
        _p_ft.resolve() if _p_ft.is_absolute() else (REPO_ROOT / _p_ft).resolve()
    )

HYBRID_XAI_DIR = ARTIFACTS_ROOT / "hybrid_xai"
# Legacy alias for analytics (parquet / trend sources)
DATA_PROCESSED = ARTIFACTS_ROOT


# ── Shared app state ──────────────────────────────────────────────
class AppState:
    hybrid_bundle = None
    xgb_model = None  # HybridPredictWrapper — LIME / predict.predict compatibility
    lime_explainer = None
    cbr_tree = None
    cbr_scaler = None
    cbr_df = None
    feature_cols = None
    cbr_feature_cols = None
    global_shap = None
    global_shap_by_cluster = None
    composite_global_shap = None  # composite_treeshap_global_importance.json
    cluster_profiles = None  # cluster_profiles.json — human-readable cluster labels
    rules = None
    hdb_df = None  # loaded lazily for trends endpoint
    hdb_recent_df = None  # richer-column frame for /analytics/recent-transactions
    model_meta = None  # hybrid_cluster_meta.json loaded at startup
    cached_town_summary = None  # computed once at startup
    cached_trends = None  # computed once at startup
    condition_model_meta = None  # sidecar JSON (training_date, val_mae, ...)
    # NOTE: the condition model itself lives in backend.photo_condition._MODEL_STATUS
    # and is loaded lazily on the first /api/predict/condition-photo request.


state = AppState()

