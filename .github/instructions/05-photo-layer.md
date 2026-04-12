---
applyTo: "05_photo_layer/**/*.ipynb"
---

# Photo Layer Instructions

**Scope:** `05_photo_layer/` photo-based furnishing condition scoring and price adjustment  
**Key Notebooks (run in order):**
- [`01_photo_data_prep.ipynb`](../../05_photo_layer/01_photo_data_prep.ipynb) — Image dataset preparation and labelling
- [`02_photo_model_train.ipynb`](../../05_photo_layer/02_photo_model_train.ipynb) — Fine-tune EfficientNet-B0 condition scorer
- [`03_photo_adjusted_predict.ipynb`](../../05_photo_layer/03_photo_adjusted_predict.ipynb) — Inference with photo-adjusted price output

**Support Module:** [`yc_photo_condition.py`](../../05_photo_layer/yc_photo_condition.py) — Condition scoring and price adjustment API

**Artefacts:** `05_photo_layer/artifacts/` — trained model weights and training metadata

---

## 1. Role & Purpose

**Purpose:** Enhance base price predictions from `03_ml_layer_hybrid` with a furnishing-condition adjustment derived from a single interior photo. The layer is **optional** — without a photo the pipeline returns the unmodified ML prediction.

| Component | Output | Use Case |
|-----------|--------|----------|
| **EfficientNet-B0** | Condition score 0–10 | "How well-furnished/maintained is this unit?" |
| **Adjustment tiers** | ±% price modifier | "Translate condition score to SGD price delta" |
| **`predict_with_photo()`** | Adjusted prediction dict | End-to-end inference from user input + photo |

### Adjustment Tiers

| Tier | Score Range | Adjustment |
|------|-------------|-----------|
| Excellent | 8.0 – 10.0 | +10 % |
| Good      | 6.0 – 8.0  | +5 %  |
| Average   | 4.0 – 6.0  | 0 %   |
| Poor      | 2.0 – 4.0  | −5 %  |
| Very Poor | 0.0 – 2.0  | −10 % |

Linear formula: `pct = (score − 5.0) × 2.0`, clamped to `[−10, +10]`.

---

## 2. Workflow

### Step 1: Data Preparation (`01_photo_data_prep.ipynb`)

**Goal:** Assemble labelled images (interior photos with condition scores 0–10) for training.

**Inputs:** Raw property photos (local directory or downloaded dataset)  
**Outputs:** Train/validation image directories structured for PyTorch `ImageFolder` or a custom CSV manifest

**Key conventions:**
- Image manifest CSV: `artifacts/photo_manifest_YYYYMMDD.csv` with columns `image_path`, `condition_score`
- Train/val split: 80/20 by default; split must be **random** (not temporal), as photos are not time-ordered
- Resize images to ≥ 256px on the short side before saving — the model's `preprocess_image()` handles final crop

### Step 2: Model Training (`02_photo_model_train.ipynb`)

**Goal:** Fine-tune EfficientNet-B0 as a regression head predicting condition score 0–10.

**Architecture:**
```python
import torchvision.models as tv_models
import torch.nn as nn

model = tv_models.efficientnet_b0(weights="IMAGENET1K_V1")
in_features = model.classifier[1].in_features
model.classifier = nn.Sequential(
    nn.Dropout(p=0.3, inplace=True),
    nn.Linear(in_features, 1),  # single regression output
)
```

**Training strategy (two-stage):**
- **Stage 1** (5 epochs): Freeze backbone, train classifier head only. `lr=1e-3`
- **Stage 2** (10 epochs): Unfreeze all layers, fine-tune end-to-end. `lr=1e-4`

**Loss:** `MSELoss`; monitor `MAE` on validation set.  
**Current benchmark:** `val_mae ≈ 0.48` (score-point error on 0–10 scale, from `condition_model_meta_20260412.json`)

**Saving artefacts:**
```python
from pathlib import Path
from datetime import datetime
import torch, json

stamp = datetime.now().strftime("%Y%m%d")
artifacts_dir = Path("artifacts")
artifacts_dir.mkdir(exist_ok=True)

# Weights
torch.save(model.state_dict(), artifacts_dir / f"condition_model_{stamp}.pth")

# Metadata
meta = {
    "training_date": stamp,
    "architecture": "efficientnet_b0",
    "score_scale": "0–10",
    "stage1_epochs": 5,
    "stage2_epochs": 10,
    "batch_size": 32,
    "lr_stage1": 1e-3,
    "lr_stage2": 1e-4,
    "val_mae": best_val_mae,
    "train_samples": len(train_dataset),
    "val_samples": len(val_dataset),
}
with open(artifacts_dir / f"condition_model_meta_{stamp}.json", "w") as f:
    json.dump(meta, f, indent=2)
print(f"✓ Model saved: condition_model_{stamp}.pth  (val_mae={best_val_mae:.3f})")
```

### Step 3: Photo-Adjusted Prediction (`03_photo_adjusted_predict.ipynb`)

**Goal:** Run end-to-end inference — ML base price + optional photo condition adjustment.

**Quick usage:**
```python
from yc_photo_condition import predict_with_photo, load_condition_model
from yc_hybrid_inference import load_bundle

bundle = load_bundle()               # from 03_ml_layer_hybrid/artifacts/
model  = load_condition_model()      # picks latest condition_model_*.pth automatically

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

print(f"Base price    : ${result['base_predicted_price']:,.0f}")
print(f"Condition     : {result['tier_label']} (score {result['condition_score']:.2f})")
print(f"Adjustment    : {result['adjustment_pct']:+.1f}%")
print(f"Adjusted price: ${result['adjusted_price']:,.0f}")
```

**Without a photo (passthrough):**
```python
result = predict_with_photo(user_input={...}, bundle=bundle)
assert result["photo_adjusted"] is False
# result["base_predicted_price"] == result from ML layer unchanged
```

---

## 3. Standard Patterns

### Path Resolution
```python
from pathlib import Path
_HERE = Path(__file__).resolve().parent      # 05_photo_layer/
_REPO_ROOT = _HERE.parent                    # repo root
```
Or in notebooks:
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
PHOTO_LAYER = REPO_ROOT / "05_photo_layer"
ML_LAYER = REPO_ROOT / "03_ml_layer_hybrid"
```

### ML Layer Import
`yc_photo_condition.py` inserts `03_ml_layer_hybrid` into `sys.path` automatically. In notebooks, do it explicitly:
```python
import sys
sys.path.insert(0, str(REPO_ROOT / "03_ml_layer_hybrid"))
from yc_hybrid_inference import load_bundle
```

### Latest-Artefact Loading
Always use glob + sort instead of hard-coding dates:
```python
candidates = sorted((PHOTO_LAYER / "artifacts").glob("condition_model_*.pth"))
model_path = candidates[-1]   # most recent by name (YYYYMMDD sorts lexicographically)
```

---

## 4. Quality Standards

### Model Validation
- **Target:** `val_mae ≤ 0.6` (score-point error on 0–10 scale)
- Check training curves for overfitting: Stage 2 `val_loss` should keep decreasing or plateau — not diverge
- Verify score distribution on validation set is not collapsed (all predictions near 5.0)

### Condition Score Sanity Checks
```python
# After predicting on a diverse test set:
scores = [result["condition_score"] for result in results]
import numpy as np
print(f"Score range : {np.min(scores):.2f} – {np.max(scores):.2f}")
print(f"Score mean  : {np.mean(scores):.2f}")
assert np.min(scores) >= 0.0 and np.max(scores) <= 10.0, "Scores out of range!"
assert np.std(scores) > 0.5, "Score distribution collapsed — check model"
```

### Adjustment Sanity Checks
```python
# Ensure adjustment is monotonically related to score
from yc_photo_condition import adjustment_pct_for_score
for s in [0, 2, 4, 5, 6, 8, 10]:
    print(f"Score {s:2d} → {adjustment_pct_for_score(s):+.1f}%")
# Expected: 0→-10%, 5→0%, 10→+10%
```

### Image Pre-processing Checks
```python
from yc_photo_condition import preprocess_image
tensor = preprocess_image("sample.jpg")
assert tensor.shape == (1, 3, 224, 224), f"Unexpected tensor shape: {tensor.shape}"
assert abs(tensor.mean().item()) < 1.0, "Tensor values seem unnormalised"
```

---

## 5. Artefact Reference

| File | Description |
|------|-------------|
| `artifacts/condition_model_YYYYMMDD.pth` | EfficientNet-B0 weights (PyTorch state dict) |
| `artifacts/condition_model_meta_YYYYMMDD.json` | Training metadata (date, epochs, val_mae, sample counts) |
| `artifacts/training_curves_YYYYMMDD.png` | Loss/MAE curves for Stage 1 and Stage 2 |

---

## 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| `FileNotFoundError: No condition_model_*.pth` | Run `02_photo_model_train.ipynb` first; check `artifacts/` exists |
| `val_mae` not improving in Stage 2 | Verify backbone is unfrozen; reduce `lr_stage2` to `5e-5` |
| Score predictions all near 5.0 | Check regression head output range; verify MSELoss is applied (not CrossEntropy) |
| `ImportError: yc_hybrid_inference` | Ensure `03_ml_layer_hybrid` is in `sys.path`; run from repo root or `05_photo_layer/` |
| Adjustment is 0% for all photos | Confirm `condition_model_*.pth` is the fine-tuned version, not random-init weights |
| Image tensor shape mismatch | Confirm PIL opens the image in RGB mode (`.convert("RGB")` is in `preprocess_image`) |

---

## 7. See Also

- [ML Layer](../../03_ml_layer_hybrid/) — Provides the base price prediction consumed by this layer
- [XAI Layer](../../04_xai_layer/) — Per-feature attributions for the base price (independent of photo)
- [Inference Module](../../03_ml_layer_hybrid/yc_hybrid_inference.py) — `predict_from_user_input()`, `load_bundle()`
- [Workspace Instructions](../../.github/copilot-instructions.md) — General conventions
