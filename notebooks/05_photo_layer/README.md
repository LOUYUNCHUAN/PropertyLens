# Photo Layer — Furnishing Condition Scoring & Price Adjustment

Uses a fine-tuned EfficientNet-B0 to score interior photos (0–10) and apply a rule-based price adjustment (±10%) on top of the hybrid model prediction. The photo is **optional** — the pipeline passes through the base ML price unchanged when no image is provided.

---

## Quick Start

Choose the path that fits your situation:

### Path A — Use the pre-trained model *(fastest, recommended)*

**STEP 1.** From the **repo root**, open `00_download_data_from_HF.ipynb` — kernel: `.venv/bin/python` — Run All Cells
→ Downloads the trained model to `hf_data/05_photo_layer/artifacts/`

**STEP 2.** Open `05_photo_layer/03_photo_adjusted_predict.ipynb` — Run All Cells
→ Scores a sample interior photo, prints condition score + adjusted price

**Done.**

---

### Path B — Train the model yourself

**STEP 1.** From the **repo root**, open `00_download_data_from_HF.ipynb` — Run All Cells
→ Downloads photo training data (`data/indoor_images/`, label CSVs)

**STEP 2.** Open `01_photo_data_prep.ipynb` — Run All Cells *(only if `data/indoor_images/` is empty)*
→ Streams AVA dataset, classifies rooms, samples 1,000 indoor images, builds train/val CSVs

**STEP 3.** Open `02_photo_model_train.ipynb` — Run All Cells *(~2 min on MPS/GPU, ~10 min on CPU)*
→ Fine-tunes EfficientNet-B0; saves weights to `artifacts/` and `hf_data/05_photo_layer/artifacts/`

**STEP 4.** Open `03_photo_adjusted_predict.ipynb` — Run All Cells
→ Loads the freshly trained model, scores a photo, prints condition score + adjusted price

**Done.** Upload your new model to HF by running `00_upload_data_to_HF.ipynb` from the repo root.

---

## How to Run

### Two paths — choose one

**Path A — Download pre-trained model (recommended for most teammates)**
```bash
# From repo root — also downloads the trained model to hf_data/05_photo_layer/artifacts/
# Run 00_download_data_from_HF.ipynb
```
Then jump straight to **notebook 3** (`03_photo_adjusted_predict.ipynb`).

**Path B — Train the model yourself**
Run all three notebooks in order (see below).

---

### Prerequisites

- Python environment: `.venv/bin/python` (set as the notebook kernel)
- For **Path B only:**
  - `03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib` (Layer 03 complete)
  - `data/indoor_images/` already populated (1,000 images from notebook 1), **or** run notebook 1 to rebuild it
  - GPU recommended for notebook 2 — MPS (Apple Silicon) or CUDA; falls back to CPU (~5× slower)

### Notebooks

| # | Notebook | What it does | When to run |
|---|----------|--------------|-------------|
| 1 | `01_photo_data_prep.ipynb` | Streams AVA dataset from HF, classifies rooms with ResNet18-Places365, samples 1,000 indoor images, builds train/val CSVs | Path B only — skip if `data/indoor_images/` already populated |
| 2 | `02_photo_model_train.ipynb` | Fine-tunes EfficientNet-B0 on the 1,000-image dataset (two-stage: head-only → full fine-tune); saves weights to `artifacts/` and `hf_data/` | Path B only |
| 3 | `03_photo_adjusted_predict.ipynb` | Loads hybrid bundle + condition model; scores an image; shows adjusted price | Always — this is the end-to-end demo |

**How to run in VS Code / JupyterLab:**
1. Open the notebook from `05_photo_layer/`
2. Select kernel: `.venv/bin/python`
3. Run All Cells

### Expected outputs

```
05_photo_layer/
├── data/
│   ├── indoor_images/              # 1,000 interior JPEGs (from notebook 1)
│   ├── photo_labels_train.csv      # 800-row training labels
│   ├── photo_labels_val.csv        # 200-row validation labels
│   └── photo_split_meta_YYYYMMDD.json
└── artifacts/
    ├── condition_model_YYYYMMDD.pth       # EfficientNet-B0 weights
    ├── condition_model_meta_YYYYMMDD.json # Training metadata (val_mae, epochs, etc.)
    └── training_curves_YYYYMMDD.png       # Loss + MAE curves
```

After training, weights are **also mirrored** to `hf_data/05_photo_layer/artifacts/` — this is the path used by the inference module by default.

### Model load priority

`yc_photo_condition.load_condition_model()` searches in this order:
1. `hf_data/05_photo_layer/artifacts/condition_model_*.pth` — downloaded cache
2. `05_photo_layer/artifacts/condition_model_*.pth` — local training output

### Training benchmarks

| Stage | Target val MAE | Epochs |
|-------|---------------|--------|
| Stage 1 (head only) | ≤ 1.5 | 5 |
| Stage 2 (fine-tune) | ≤ 0.6 | 10 |

Current model (20260413): **val MAE = 0.49** on 0–10 scale.

### Adjustment tiers

| Score | Tier | Price adjustment |
|-------|------|-----------------|
| 8–10 | Excellent | +10% |
| 6–8  | Good      | +5%  |
| 4–6  | Average   | 0%   |
| 2–4  | Poor      | −5%  |
| 0–2  | Very Poor | −10% |

### Using the inference API

```python
import sys
sys.path.insert(0, 'path/to/05_photo_layer')
sys.path.insert(0, 'path/to/03_ml_layer_hybrid')

from yc_photo_condition import load_condition_model, predict_with_photo
from yc_hybrid_inference import load_bundle

bundle  = load_bundle()
model   = load_condition_model()   # auto-picks latest .pth from hf_data/ first

result = predict_with_photo(
    user_input={
        'block': '123', 'street_name': 'BEDOK NORTH AVE 1', 'town': 'BEDOK',
        'flat_type': '4 ROOM', 'floor_area_sqm': 90.0,
        'storey_range': '07 TO 09', 'lease_commence_date': 1990,
        'sale_month': '2024-01',
    },
    image_path='path/to/living_room.jpg',
    bundle=bundle,
    condition_model=model,
)
print(f"Base price     : SGD {result['base_predicted_price']:,.0f}")
print(f"Condition      : {result['tier_label']} ({result['condition_score']:.1f}/10)")
print(f"Adjustment     : {result['adjustment_pct']:+.1f}%")
print(f"Adjusted price : SGD {result['adjusted_price']:,.0f}")
```

### Common issues

| Issue | Fix |
|-------|-----|
| `No condition_model_*.pth found` | Run `00_download_data_from_HF.ipynb` (Path A) or `02_photo_model_train.ipynb` (Path B) |
| `ModuleNotFoundError: xgboost` | ML bundle needs xgboost; install `.venv/bin/pip install xgboost lightgbm` — or notebook 3 will fall back to photo-only mode |
| Notebook 2 training slow | Expected on CPU (~5 min); MPS (Apple Silicon) reduces to ~2 min; CUDA fastest |
| `val R²` is negative | Expected — AVA scores cluster in a narrow range (3–5). MAE is the reliable metric; negative R² does not mean a bad model |
| Notebook 1 streams 5+ GB from HF | Notebook 1 streams and never saves the full AVA dataset; only 1,000 images (~150 MB) are kept locally |
