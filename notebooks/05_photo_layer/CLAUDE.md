# Photo Layer Instructions

**Scope:** `05_photo_layer/` photo-based furnishing condition scoring and price adjustment  
**Key Notebooks (run in order):**
- `01_photo_data_prep.ipynb` — Image dataset preparation and labelling
- `02_photo_model_train.ipynb` — Fine-tune EfficientNet-B0 condition scorer
- `03_photo_adjusted_predict.ipynb` — Inference with photo-adjusted price output

**Support Module:** `yc_photo_condition.py` — Condition scoring and price adjustment API  
**Reference:** Artefacts under `artifacts/` | [Root Instructions](../CLAUDE.md)

---

## 1. Role & Purpose

**Purpose:** Enhance base price predictions from `03_ml_layer_hybrid` with a furnishing-condition adjustment derived from a single interior photo. The layer is **optional** — without a photo the pipeline returns the unmodified ML prediction.

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

**Outputs:** `artifacts/photo_manifest_YYYYMMDD.csv` with columns `image_path`, `condition_score`

**Key conventions:**
- Train/val split: 80/20 by default; split must be **random** (not temporal)
- Resize images to ≥ 256px on the short side before saving — `preprocess_image()` handles final crop

### Step 2: Model Training (`02_photo_model_train.ipynb`)

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
**Current benchmark:** `val_mae ≈ 0.48` (from `condition_model_meta_20260412.json`)

**Saving artefacts:**
```python
from pathlib import Path
from datetime import datetime
import torch, json

stamp = datetime.now().strftime("%Y%m%d")
artifacts_dir = Path("artifacts")
artifacts_dir.mkdir(exist_ok=True)

torch.save(model.state_dict(), artifacts_dir / f"condition_model_{stamp}.pth")

meta = {
    "training_date": stamp,
    "architecture": "efficientnet_b0",
    "score_scale": "0–10",
    "stage1_epochs": 5, "stage2_epochs": 10,
    "batch_size": 32, "lr_stage1": 1e-3, "lr_stage2": 1e-4,
    "val_mae": best_val_mae,
    "train_samples": len(train_dataset),
    "val_samples": len(val_dataset),
}
with open(artifacts_dir / f"condition_model_meta_{stamp}.json", "w") as f:
    json.dump(meta, f, indent=2)
print(f"Model saved: condition_model_{stamp}.pth  (val_mae={best_val_mae:.3f})")
```

### Step 3: Photo-Adjusted Prediction (`03_photo_adjusted_predict.ipynb`)

```python
from yc_photo_condition import predict_with_photo, load_condition_model
from yc_hybrid_inference import load_bundle

bundle = load_bundle()
model  = load_condition_model()   # auto-selects latest condition_model_*.pth

result = predict_with_photo(
    user_input={
        "block": "123", "street_name": "BEDOK NORTH AVE 1", "town": "BEDOK",
        "flat_type": "4 ROOM", "floor_area_sqm": 90.0,
        "storey_range": "07 TO 09", "lease_commence_date": 1990, "sale_month": "2024-01",
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
```

---

## 3. Standard Patterns

### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
PHOTO_LAYER = REPO_ROOT / "05_photo_layer"
ML_LAYER = REPO_ROOT / "03_ml_layer_hybrid"
```

### ML Layer Import (in notebooks)
```python
import sys
sys.path.insert(0, str(REPO_ROOT / "03_ml_layer_hybrid"))
from yc_hybrid_inference import load_bundle
```

### Latest-Artefact Loading
```python
candidates = sorted((PHOTO_LAYER / "artifacts").glob("condition_model_*.pth"))
model_path = candidates[-1]   # most recent by name (YYYYMMDD sorts lexicographically)
```

---

## 4. Quality Standards

### Model Validation
- **Target:** `val_mae ≤ 0.6` on 0–10 scale
- Watch training curves in Stage 2 for divergence (not just plateau)
- Verify score distribution is not collapsed (all predictions near 5.0)

### Score Sanity Checks
```python
scores = [result["condition_score"] for result in results]
assert np.min(scores) >= 0.0 and np.max(scores) <= 10.0, "Scores out of range!"
assert np.std(scores) > 0.5, "Score distribution collapsed — check model"
```

### Adjustment Sanity
```python
from yc_photo_condition import adjustment_pct_for_score
for s in [0, 2, 4, 5, 6, 8, 10]:
    print(f"Score {s:2d} → {adjustment_pct_for_score(s):+.1f}%")
# Expected: 0→-10%, 5→0%, 10→+10%
```

### Image Pre-processing
```python
from yc_photo_condition import preprocess_image
tensor = preprocess_image("sample.jpg")
assert tensor.shape == (1, 3, 224, 224), f"Unexpected tensor shape: {tensor.shape}"
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
| `FileNotFoundError: No condition_model_*.pth` | Run `02_photo_model_train.ipynb` first |
| `val_mae` not improving in Stage 2 | Verify backbone is unfrozen; reduce `lr_stage2` to `5e-5` |
| Score predictions all near 5.0 | Verify MSELoss (not CrossEntropy); check regression head output |
| `ImportError: yc_hybrid_inference` | Ensure `03_ml_layer_hybrid` is in `sys.path` |
| Adjustment is 0% for all photos | Confirm model is fine-tuned, not random-init weights |
| Image tensor shape mismatch | Confirm PIL opens in RGB mode (`.convert("RGB")` in `preprocess_image`) |
