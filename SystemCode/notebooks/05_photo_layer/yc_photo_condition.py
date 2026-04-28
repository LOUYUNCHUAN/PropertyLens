"""
Photo-based furnishing condition scorer and price adjuster (Layer 05).

Uses a fine-tuned EfficientNet-B0 to output a continuous condition score (0–10)
from a single interior photo, then applies a rule-based adjustment table to the
base price predicted by the ML layer (03_ml_layer_hybrid).

Usage
-----
from yc_photo_condition import predict_with_photo, load_condition_model

# Load models
bundle = load_bundle()                           # from 03_ml_layer_hybrid
model  = load_condition_model("artifacts/condition_model_20260412.pth")

# Predict with photo
result = predict_with_photo(
    user_input={
        "block": "123",
        "street_name": "BEDOK NORTH AVE 1",
        "town": "BEDOK",
        "flat_type": "4 ROOM",
        "floor_area_sqm": 90.0,
        "storey_range": "07 TO 09",
        "lease_commence_date": 1990,
        "sale_month": "2024-01",
    },
    image_path="path/to/living_room.jpg",
    bundle=bundle,
    condition_model=model,
)
print(result["base_predicted_price"])
print(result["adjusted_price"])
print(result["tier_label"])

# Without photo – passthrough
result_no_photo = predict_with_photo(user_input={...}, bundle=bundle)
assert result_no_photo["photo_adjusted"] is False
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

# ── Path resolution ────────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent          # 05_photo_layer/
_REPO_ROOT = _HERE.parent                        # repo root

# Make 03_ml_layer_hybrid importable when called from this layer's folder
_ML_LAYER = _REPO_ROOT / "03_ml_layer_hybrid"
if str(_ML_LAYER) not in sys.path:
    sys.path.insert(0, str(_ML_LAYER))

from yc_hybrid_inference import predict_from_user_input, load_bundle  # noqa: E402

# ── Adjustment tiers ───────────────────────────────────────────────────────────
# Tier boundaries are inclusive-low, exclusive-high (except the last bin).
# Adjustment is linear: pct = (score - 5.0) * 2.0, clamped to [-10, +10].
ADJUSTMENT_TIERS: list[dict[str, Any]] = [
    {"label": "Excellent",  "min": 8.0,  "max": 10.0, "pct": +10.0},
    {"label": "Good",       "min": 6.0,  "max": 8.0,  "pct":  +5.0},
    {"label": "Average",    "min": 4.0,  "max": 6.0,  "pct":   0.0},
    {"label": "Poor",       "min": 2.0,  "max": 4.0,  "pct":  -5.0},
    {"label": "Very Poor",  "min": 0.0,  "max": 2.0,  "pct": -10.0},
]

_DEFAULT_MODEL_GLOB = "condition_model_*.pth"


# ── Tier helpers ───────────────────────────────────────────────────────────────

def tier_label_for_score(score: float) -> str:
    """Map a 0–10 condition score to its human-readable tier label."""
    score = float(np.clip(score, 0.0, 10.0))
    for tier in ADJUSTMENT_TIERS:
        if tier["min"] <= score <= tier["max"]:
            return tier["label"]
    return ADJUSTMENT_TIERS[-1]["label"]  # fallback


def adjustment_pct_for_score(score: float) -> float:
    """
    Linear adjustment percentage for a given score (0–10).

    Formula: pct = (score - 5.0) * 2.0, clamped to [-10, +10].
    Score 5.0 → 0 %, Score 10.0 → +10 %, Score 0.0 → -10 %.
    """
    score = float(np.clip(score, 0.0, 10.0))
    return float(np.clip((score - 5.0) * 2.0, -10.0, 10.0))


# Calibration: the AVA-derived training labels (ava_indoor_labels.csv) span
# only ~3.0–5.15 (mean ~4.27, std ~0.36) despite the nominal "0–10" naming.
# Scores from the model therefore live in the same compressed range, and
# downstream `(score - 5) * 2` adjustments never reach Good/Excellent tiers.
# Stretch the model's actual output range onto the displayed 0–10 scale so the
# tier ladder is usable. This is a presentation calibration — it does not
# improve the model's discriminative power, it just stops the bottom-half UI
# clamping. Replace with a domain-labelled retrain (Option 2) for a real fix.
_CALIBRATION_RAW_MIN = 3.0
_CALIBRATION_RAW_MAX = 5.15


def calibrate_raw_score(raw: float) -> float:
    """Map a raw model output (~3.0–5.15) onto the displayed 0–10 scale."""
    span = _CALIBRATION_RAW_MAX - _CALIBRATION_RAW_MIN
    stretched = (float(raw) - _CALIBRATION_RAW_MIN) / span * 10.0
    return float(np.clip(stretched, 0.0, 10.0))


# ── Model loading ──────────────────────────────────────────────────────────────

def load_condition_model(model_path: str | Path | None = None):
    """
    Load the fine-tuned EfficientNet-B0 condition scorer.

    Parameters
    ----------
    model_path : path to the .pth weights file. If None, the latest
                 ``condition_model_*.pth`` is auto-discovered in this order:
                 1. ``<repo_root>/hf_data/05_photo_layer/artifacts/``  (downloaded cache)
                 2. ``05_photo_layer/artifacts/``                       (local training output)

    Returns
    -------
    torch.nn.Module in eval mode.
    """
    import torch
    import torchvision.models as tv_models

    if model_path is None:
        # Search hf_data mirror first (conventional downloaded path), then local artifacts
        _search_dirs = [
            _REPO_ROOT / "hf_data" / "05_photo_layer" / "artifacts",
            _HERE / "artifacts",
        ]
        candidates = []
        for d in _search_dirs:
            candidates = sorted(d.glob(_DEFAULT_MODEL_GLOB))
            if candidates:
                break
        if not candidates:
            raise FileNotFoundError(
                f"No condition_model_*.pth found. Searched:\n"
                + "\n".join(f"  {d}" for d in _search_dirs)
                + "\nRun 02_photo_model_train.ipynb or 00_download_data_from_HF.ipynb first."
            )
        model_path = candidates[-1]
        print(f"Loading condition model from: {model_path}")

    model_path = Path(model_path)
    if not model_path.exists():
        raise FileNotFoundError(f"Model weights not found: {model_path}")

    model = tv_models.efficientnet_b0(weights=None)
    # Replace classifier with regression head (matches training architecture)
    in_features = model.classifier[1].in_features
    model.classifier = torch.nn.Sequential(
        torch.nn.Dropout(p=0.3, inplace=True),
        torch.nn.Linear(in_features, 1),
    )
    state = torch.load(model_path, map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval()
    return model


# ── Image pre-processing ───────────────────────────────────────────────────────

def preprocess_image(image_path: str | Path):
    """
    Load and preprocess an image for EfficientNet-B0 inference.

    Returns a (1, 3, 224, 224) float32 tensor normalised with ImageNet stats.
    """
    from PIL import Image
    import torch
    from torchvision import transforms

    _transform = transforms.Compose([
        transforms.Resize(256),
        transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])

    img = Image.open(image_path).convert("RGB")
    tensor = _transform(img).unsqueeze(0)  # (1, 3, 224, 224)
    return tensor


# ── Condition scoring ──────────────────────────────────────────────────────────

def predict_condition_score(
    image_path: str | Path,
    model,
) -> dict[str, Any]:
    """
    Predict the furnishing condition score for a single interior photo.

    Parameters
    ----------
    image_path : path to the image file (JPEG / PNG recommended).
    model      : loaded EfficientNet (from :func:`load_condition_model`).

    Returns
    -------
    dict with keys:
        score      : float, 0–10 (clamped)
        tier_label : str, e.g. "Good"
    """
    import torch

    tensor = preprocess_image(image_path)
    with torch.no_grad():
        raw = float(model(tensor).item())
    score = calibrate_raw_score(raw)
    return {
        "score": score,
        "tier_label": tier_label_for_score(score),
        "raw_model_output": raw,
        "calibration": {
            "raw_min": _CALIBRATION_RAW_MIN,
            "raw_max": _CALIBRATION_RAW_MAX,
            "note": "Score linearly stretched from training-distribution range to 0–10.",
        },
    }


# ── Price adjustment ───────────────────────────────────────────────────────────

def apply_price_adjustment(
    base_price: float,
    condition_score: float,
) -> dict[str, Any]:
    """
    Apply rule-based price adjustment from a condition score.

    Parameters
    ----------
    base_price       : ML model predicted price (SGD float).
    condition_score  : 0–10 float from :func:`predict_condition_score`.

    Returns
    -------
    dict with keys:
        adjusted_price  : float, SGD
        adjustment_pct  : float, e.g. +5.0 or -10.0
        tier_label      : str
        base_price      : float (echo)
    """
    pct = adjustment_pct_for_score(condition_score)
    adjusted = base_price * (1.0 + pct / 100.0)
    return {
        "adjusted_price": round(adjusted, 2),
        "adjustment_pct": pct,
        "tier_label": tier_label_for_score(condition_score),
        "base_price": round(base_price, 2),
    }


# ── Combined prediction ────────────────────────────────────────────────────────

def predict_with_photo(
    user_input: dict[str, Any],
    image_path: str | Path | None = None,
    *,
    bundle: dict[str, Any] | None = None,
    condition_model=None,
    model_path: str | Path | None = None,
) -> dict[str, Any]:
    """
    Full prediction pipeline: ML price prediction + optional photo adjustment.

    Parameters
    ----------
    user_input      : dict with the 8 listing fields (block, street_name, town,
                      flat_type, floor_area_sqm, storey_range,
                      lease_commence_date, sale_month).
    image_path      : optional path to interior photo. If None, the base ML
                      prediction is returned unchanged (photo_adjusted=False).
    bundle          : hybrid model bundle (loaded via load_bundle() if None).
    condition_model : loaded EfficientNet (loaded from artifacts if None and
                      image_path is provided).
    model_path      : explicit path to .pth file (used only when
                      condition_model is None and image_path is provided).

    Returns
    -------
    dict with keys:
        All keys from predict_from_user_input() result, plus:
        base_predicted_price : float, SGD (same as predicted_resale_price)
        photo_adjusted       : bool
        --- if photo_adjusted is True ---
        condition_score      : float, 0–10
        tier_label           : str
        adjustment_pct       : float
        adjusted_price       : float, SGD
    """
    bundle = bundle or load_bundle()

    ml_result = predict_from_user_input(
        **{k: user_input[k] for k in (
            "block", "street_name", "town", "flat_type",
            "floor_area_sqm", "storey_range", "lease_commence_date", "sale_month",
        )},
        bundle=bundle,
    )

    base_price = ml_result["predicted_resale_price"]
    out: dict[str, Any] = {**ml_result, "base_predicted_price": base_price}

    if image_path is None:
        out["photo_adjusted"] = False
        return out

    # Load model on demand (lazy)
    if condition_model is None:
        condition_model = load_condition_model(model_path)

    condition = predict_condition_score(image_path, condition_model)
    adjustment = apply_price_adjustment(base_price, condition["score"])

    out.update({
        "photo_adjusted": True,
        "condition_score": condition["score"],
        "tier_label": condition["tier_label"],
        "adjustment_pct": adjustment["adjustment_pct"],
        "adjusted_price": adjustment["adjusted_price"],
    })
    return out


# ── Metadata helpers ───────────────────────────────────────────────────────────

def load_model_meta(model_path: str | Path | None = None) -> dict[str, Any]:
    """Load the JSON metadata sidecar for a trained condition model."""
    if model_path is None:
        _search_dirs = [
            _REPO_ROOT / "hf_data" / "05_photo_layer" / "artifacts",
            _HERE / "artifacts",
        ]
        candidates = []
        for d in _search_dirs:
            candidates = sorted(d.glob(_DEFAULT_MODEL_GLOB))
            if candidates:
                break
        if not candidates:
            raise FileNotFoundError("No condition_model_*.pth found under artifacts/")
        model_path = candidates[-1]
    meta_path = Path(str(model_path).replace(".pth", "_meta.json"))
    if not meta_path.exists():
        raise FileNotFoundError(f"Metadata file not found: {meta_path}")
    with open(meta_path, encoding="utf-8") as f:
        return json.load(f)
