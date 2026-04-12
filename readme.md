# PropertyLens

PropertyLens predicts Singapore HDB resale prices, ranks listings with location-aware signals, and surfaces interpretable model outputs (SHAP, LIME, CBR comparables) in a FastAPI backend and Vite/React frontend.

## Prerequisites

- **Python 3.11+** (recommended; hybrid model pickles expect sklearn 1.8 / XGBoost 3.2 — see `backend/.env.example`).
- **Node.js 18+** (for the web UI).
- A **Hugging Face account and token** (`HF_TOKEN`) to download model artefacts and datasets on first setup. Create a read token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).

Large generated files under `data/` are **gitignored**. After cloning, you must populate `data/` using the setup notebook (below) or copy artefacts from someone who already has them.

## Quick start: run locally

### 1. Clone and virtual environment

```bash
git clone <repository-url>
cd PropertyLens
python3.11 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
```

Optional: `pip install jupyter ipywidgets` if you will run setup notebooks from this venv.

### 2. Download data (models, features, amenities, DB)

Open and run **`notebooks/00_project_setup_environment.ipynb`** top to bottom. It:

- Creates `data/` layout (`artifacts`, feature tables, `amenities`).
- Expects a repo-root **`.env`** with **`HF_TOKEN=...`** (the notebook can create an empty `.env` if missing).
- Pulls from Hugging Face: model bundle (`PropertyLens/propertylens-models`), feature CSVs and amenity CSVs (`PropertyLens/Resealeflats`).
- Initializes **`data/propertylens.db`** (SQLite) for auth, prediction history, and wishlist.

Copy **`backend/.env.example`** → **`backend/.env`** and adjust if needed (JWT, `DATABASE_URL`, chat, Neo4j — all optional for a minimal local run).

### 3. Run the API

From the repo root, with the venv active:

```bash
cd backend
uvicorn main:app --reload --port 8000
```

- API: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Interactive docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- Health check: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

```bash
curl -s http://127.0.0.1:8000/health
```

### 4. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to the backend (see `frontend/vite.config.js`). Open the URL printed in the terminal (typically [http://localhost:5173](http://localhost:5173)).

Optional: **`frontend/.env.example`** → **`.env`** if you need a fixed API origin (e.g. production build).

## Project layout

```text
PropertyLens/
  backend/           # FastAPI app (predict, explain, CBR, analytics, …)
  frontend/          # Vite + React UI
  data/              # Artefacts and CSVs (gitignored when large — filled by setup notebook)
  notebooks/         # Setup, data pulls, ML pipelines, HF upload helpers
  docs/              # Developer guides (e.g. views)
  extension/         # Browser extension (optional)
```

## ML pipeline and notebooks

Training and feature engineering live under **`notebooks/`** (hybrid ensemble, XAI, etc.). You do **not** need to retrain to run the app locally if you completed **`00_project_setup_environment.ipynb`**.

- Regenerate amenity CSVs from public APIs: `notebooks/00_download_amenity_data.ipynb`
- Upload amenities to Hugging Face: `notebooks/00_test_upload_amenities_to_hf.ipynb`

## Documentation

- **`backend/README.md`** — backend details, troubleshooting (e.g. `libomp` on macOS, LIME import errors).
- **`docs/views-developer-guide.md`** — Buyer / Seller / Shortlist behaviour and API usage from the frontend.

## Goals (product)

- Predict HDB resale prices using transaction history, POIs, schools, and accessibility features.
- Support preference-aware search and ranking where feature weights matter.
- Expose local explanations (SHAP-style drivers, LIME, comparables) alongside point estimates.
