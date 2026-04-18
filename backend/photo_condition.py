"""
photo_condition.py — /api/predict/condition-photo

Thin FastAPI wrapper around the photo layer's condition scorer
(notebooks/05_photo_layer/yc_photo_condition.py). Takes a base price produced
by /api/predict and an uploaded interior photo, returns a rule-based
±10% price adjustment driven by a fine-tuned EfficientNet-B0.
"""

from __future__ import annotations

import sys
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

# Reuse the photo-layer module without duplicating code.
_PHOTO_LAYER = Path(__file__).resolve().parent.parent / "notebooks" / "05_photo_layer"
if str(_PHOTO_LAYER) not in sys.path:
    sys.path.insert(0, str(_PHOTO_LAYER))

from yc_photo_condition import (  # noqa: E402
    apply_price_adjustment,
    load_condition_model,
    load_model_meta,
    predict_condition_score,
)

__all__ = [
    "router",
    "load_condition_model",
    "load_model_meta",
    "resolve_condition_meta",
    "get_condition_model",
    "predict_condition_score",
    "apply_price_adjustment",
]


_LOAD_LOCK = threading.Lock()
_MODEL_STATUS: dict = {"model": None, "error": None}


def get_condition_model():
    """
    Lazily load the condition model on first call, cache for the process
    lifetime. Concurrent first-callers are serialised by _LOAD_LOCK so we
    never double-import torchvision. Failures are cached — repeated requests
    to a broken install don't re-pay the torchvision import cost each time.

    Raises
    ------
    HTTPException(503)
        If weights are missing or load fails. Message is cached.
    """
    model = _MODEL_STATUS["model"]
    if model is not None:
        return model
    err = _MODEL_STATUS["error"]
    if err is not None:
        raise HTTPException(status_code=503, detail=err)

    with _LOAD_LOCK:
        model = _MODEL_STATUS["model"]
        if model is not None:
            return model
        err = _MODEL_STATUS["error"]
        if err is not None:
            raise HTTPException(status_code=503, detail=err)
        try:
            model = load_condition_model()
        except Exception as e:
            _MODEL_STATUS["error"] = f"Photo condition model failed to load: {e}"
            raise HTTPException(status_code=503, detail=_MODEL_STATUS["error"]) from e
        _MODEL_STATUS["model"] = model
        return model


_META_SEARCH_DIRS = [
    Path(__file__).resolve().parent.parent / "hf_data" / "05_photo_layer" / "artifacts",
    _PHOTO_LAYER / "artifacts",
]


def resolve_condition_meta() -> dict | None:
    """
    Robust meta loader — accepts either naming convention seen in the wild:
      - ``condition_model_YYYYMMDD_meta.json``  (sibling of the .pth)
      - ``condition_model_meta_YYYYMMDD.json``  (historical layout)
    Picks the latest matching JSON across both search dirs; returns None if nothing found.
    """
    import json as _json

    for d in _META_SEARCH_DIRS:
        if not d.exists():
            continue
        candidates = sorted(
            list(d.glob("condition_model_*_meta.json"))
            + list(d.glob("condition_model_meta_*.json"))
        )
        if candidates:
            with open(candidates[-1], encoding="utf-8") as f:
                return _json.load(f)
    return None

router = APIRouter()

_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


class _ModelMeta(BaseModel):
    training_date: str | None = None
    val_mae: float | None = None
    architecture: str | None = None


class ConditionPhotoResponse(BaseModel):
    condition_score: float
    tier_label: str
    adjustment_pct: float
    base_price: float
    adjusted_price: float
    model_meta: _ModelMeta


class _AppStateProxy:
    def __getattr__(self, name: str):
        from backend.main import state as _s

        return getattr(_s, name)


state = _AppStateProxy()


def _meta_payload() -> _ModelMeta:
    meta = getattr(state, "condition_model_meta", None) or {}
    return _ModelMeta(
        training_date=meta.get("training_date"),
        val_mae=meta.get("val_mae"),
        architecture=meta.get("architecture"),
    )


@router.post("/predict/condition-photo", response_model=ConditionPhotoResponse)
async def predict_condition_photo(
    image: UploadFile = File(...),
    base_price: float = Form(...),
):
    mime = (image.content_type or "").lower()
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image upload, got content-type '{mime}'.")

    contents = await image.read()
    if len(contents) > _MAX_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 10 MB limit.")
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file.")

    model = get_condition_model()  # lazy first-call pays torchvision import cost

    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(contents)
        tmp.flush()
        try:
            cond = predict_condition_score(tmp.name, model)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to score image: {e}") from e

    adjustment = apply_price_adjustment(float(base_price), cond["score"])

    return ConditionPhotoResponse(
        condition_score=cond["score"],
        tier_label=cond["tier_label"],
        adjustment_pct=adjustment["adjustment_pct"],
        base_price=adjustment["base_price"],
        adjusted_price=adjustment["adjusted_price"],
        model_meta=_meta_payload(),
    )
