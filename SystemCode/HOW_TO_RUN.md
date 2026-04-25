# How to run PropertyLens

End-to-end setup for a fresh clone — from `git clone` to a running app you can log into.

> **TL;DR order:** `cd SystemCode/` → venv → `.env` → download artifacts → seed Neo4j + SQLite → start Ollama → `npm install` → run backend → run frontend on **port 5173** → log in as `user` / `1234` → (optional) install Chrome extension.

---

## Prerequisites (install once)


| Tool                   | Why                                                                                                                                                                                                        | Install                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Python 3.11+**       | `scikit-learn 1.8` requirement; hybrid model pickles depend on it                                                                                                                                          | `brew install python@3.11` (mac), or `pyenv install 3.11`                                                          |
| **Node.js 18+**        | Vite + React frontend                                                                                                                                                                                      | `brew install node` (mac), or `nvm install 18`                                                                     |
| **Neo4j**              | Required for `/api/property-search-chat` (Ask AI) and `/api/chat`. Backend skips chat features gracefully if it's missing.                                                                                 | [Neo4j AuraDB Free](https://neo4j.com/cloud/aura) (hosted) or [Neo4j Desktop](https://neo4j.com/download/) (local) |
| **Ollama**             | **Required** — runs the local LLM (`gemma3`) that powers the chatbot, Ask AI, and property-search chat. The chatbot will not work without it (unless you set `CHAT_PROVIDER=gemini` and `GEMINI_API_KEY`). | `brew install ollama` then `ollama pull gemma3`                                                                    |
| **Hugging Face token** | Pulls ~1.5 GB of model + dataset artifacts on first setup                                                                                                                                                  | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) — read scope is enough                    |


---

## 1. Clone and create a Python virtual env

```bash
git clone <repo-url>
cd PropertyLens/SystemCode                 # ← all setup commands assume cwd = SystemCode/

python3.11 -m venv .venv
source .venv/bin/activate                  # Windows: .venv\Scripts\activate

pip install -r backend/requirements.txt
pip install jupyter notebook ipykernel huggingface_hub
```

The Jupyter packages are needed to run the three setup notebooks at the top of `SystemCode/`.

> **Why `SystemCode/`?** This repo follows the NUS-ISS IRS-PM submission template, which puts all source code under a top-level `SystemCode/` folder. The backend, setup notebooks, and `data/` all sit inside `SystemCode/` and resolve paths relative to it — running setup from anywhere else will write artifacts to the wrong directory.

---

## 2. Create your `.env` inside `SystemCode/`

Copy `.env.example` → `.env` (both inside `SystemCode/`) and fill in real values. The backend's `app_state.py` loads `.env` from `BACKEND_DIR.parent`, which resolves to `SystemCode/` after this restructure. The template lists every variable the backend reads, with safe defaults pre-filled where possible:

```bash
cp .env.example .env
# then edit .env in your editor — at minimum, set:
#   HF_TOKEN, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD
```


| Variable                                                             | Required?  | Notes                                                                                                                                                  |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HF_TOKEN`                                                           | ✅          | Read-scoped Hugging Face token for downloads                                                                                                           |
| `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` / `NEO4J_DATABASE` | ✅ for chat | E.g. `neo4j+s://xxxx.databases.neo4j.io` for AuraDB                                                                                                    |
| `CHAT_PROVIDER`                                                      | ✅          | `ollama` (default), `gemini`, or `auto`. Pick the LLM backend the chatbot uses.                                                                        |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL`                                   | ✅ for chat | Ollama itself is **required** for chat (see step 5). Env vars are optional only because the defaults `http://127.0.0.1:11434` / `gemma3` already work. |
| `GEMINI_API_KEY`                                                     | optional   | Required only if you set `CHAT_PROVIDER=gemini` instead of using Ollama.                                                                               |
| `JWT_SECRET` / `JWT_EXPIRE_MINUTES`                                  | optional   | Auth signing key — change for prod, anything works for local                                                                                           |
| `DATABASE_URL`                                                       | optional   | Defaults to `sqlite:///data/propertylens.db`                                                                                                           |


---

## 3. Download artifacts from Hugging Face

From `SystemCode/`, open and **run all cells** in:

```
jupyter notebook download_artifacts_from_hf.ipynb
```

This pulls everything that lives outside git into the exact folder layout the backend expects (paths are relative to `SystemCode/`):


| HF source                                                              | Drops into                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `PropertyLens/final-propertylens-models / artifacts/**`                | `data/artifacts/**` (~660 MB)                  |
| `PropertyLens/final-propertylens-models / 05_photo_layer/artifacts/**` | `hf_data/05_photo_layer/artifacts/**` (~16 MB) |
| `PropertyLens/final-dataset / feature_data/**`                         | `data/feature_data/**` (~870 MB)               |
| `PropertyLens/final-dataset / amenities/**`                            | `data/amenities/**`                            |


The final cell verifies every required file is present (`✅`/`❌ MISSING`). **If it prints any `❌`, fix that before moving on** — the backend won't start without those files.

---

## 4. Seed Neo4j knowledge graph + SQLite app DB

From `SystemCode/`, open and **run all cells** in:

```
jupyter notebook setup_neo4j_and_db.ipynb
```

What it does:

- Loads (or rebuilds) the layer-06 property knowledge base
- Pushes ~9,710 `Property`, 26 `Town`, ~17 `FamousSchool` nodes + relationships into Neo4j (uses `MERGE`, idempotent)
- Creates SQLite tables under `data/propertylens.db`
- Seeds three demo users (idempotent — existing usernames are skipped):

  | Username  | Password | Display name |
  |-----------|----------|--------------|
  | `user`    | `1234`   | Bhuvesh      |
  | `rekha`   | `1234`   | Rekha        |
  | `yunchuan`| `1234`   | Yun Chuan    |
- Runs a smoke-test Cypher query so you know the graph is wired up

> If the property KB parquet doesn't exist locally yet, this notebook rebuilds it from the feature table — adds ~5 minutes the first time.

---

## 5. Start Ollama (required for chatbot)

The chatbot, Ask AI, and property-search chat all call Ollama for inference.
**Skip this step only if you've set `CHAT_PROVIDER=gemini` with a valid `GEMINI_API_KEY` in your `.env`.**

In a separate terminal:

```bash
ollama serve              # leave running
ollama pull gemma3        # one-time, ~3 GB download
```

Verify it's reachable:

```bash
curl http://127.0.0.1:11434/api/tags    # should list installed models
```

---

## 6. Install frontend deps

From `SystemCode/`:

```bash
cd frontend
npm install
cd ..
```

---

## 7. Start the backend

From `SystemCode/`:

```bash
source .venv/bin/activate
cd backend
uvicorn main:app --reload --port 8000
```

You should see startup logs confirming successful loads of:

- Hybrid bundle, CBR, SHAP cache, rules, LIME explainer
- Composite SHAP, cluster profiles
- Neo4j connection
- Optional photo-condition model warning if `condition_model_*.pth` is missing

---

## 8. Start the frontend (new terminal)

The Chrome extension expects the Vite dev server on **port 5173 exactly** (it deep-links to `http://localhost:5173/buyer?...`). Pin the port to avoid Vite auto-bumping to 5174 when something else is running. From `SystemCode/`:

```bash
cd frontend
npm run dev -- --port 5173 --strictPort
```

Vite serves at **[http://localhost:5173](http://localhost:5173)**. `--strictPort` makes Vite fail loudly instead of silently switching ports — you'll know immediately if 5173 is already in use.

---

## 9. Log in and use the app

- Open **[http://localhost:5173](http://localhost:5173)**
- Login with `**user`** / `**1234`**
- Try:
  - **Buyer** → enter an HDB address, see prediction + SHAP + comparables + map
  - **Seller** → asking-price recommendations + offer planner
  - **Shortlist** → save listings, compare head-to-head with the Versus view
  - **Insights → Analytics** → composite SHAP, cluster profiles, market trends
  - **Insights → Ask AI** → natural-language property search (needs Neo4j + Ollama/Gemini)

---

## 10. (Optional) Install the Chrome extension

The PropertyLens browser extension scrapes a PropertyGuru HDB listing and sends it to your local backend, then either shows the fair-value estimate inline or deep-links you into the Buyer view with the asking price pre-filled.

**Prereq**: backend on `http://localhost:8000` and frontend on `http://localhost:5173` must already be running (steps 7 & 8). The extension is hard-wired to those ports unless you edit it.

### Install steps

1. Open `**chrome://extensions`** in Chrome (paste it into the address bar).
2. Toggle **Developer mode** **ON** (top-right of the page).
3. Click **Load unpacked** (top-left).
4. In the file picker, navigate to your repo and select the `**SystemCode/extension/`** folder, then click **Select**.
5. The "PropertyLens — HDB listing insight" extension card appears with a green ON toggle. Confirm:
  - **Manifest version**: 3
  - **Host permissions**: `https://www.propertyguru.com.sg/`* and `http://localhost:8000/`*
6. Pin it for quick access: click the **🧩 puzzle icon** in Chrome's toolbar → **📌 pin** next to "PropertyLens".

### Try it

1. Visit any HDB listing on PropertyGuru, e.g.:
  `https://www.propertyguru.com.sg/listing/hdb-for-sale/...`
2. The content script auto-runs at page idle and posts the listing to `/api/predict` and `/api/explain/shap` on your local backend.
3. Click the pinned PropertyLens icon → **Open in Buyer** to deep-link the Buyer view at `http://localhost:5173/buyer?…` with the listing pre-filled.

### Custom ports / hosts

If you can't run the backend on `:8000` or the frontend on `:5173`, edit two files in the `SystemCode/extension/` folder and reload the unpacked extension:


| File                                 | Edit                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| `SystemCode/extension/content.js`    | `API_BASE` → backend URL · `BUYER_STUDIO_ORIGIN` → frontend origin |
| `SystemCode/extension/manifest.json` | `host_permissions` → add your custom backend URL                   |


After editing, return to `chrome://extensions` and click the **🔄 reload** button on the PropertyLens card.

### Troubleshooting


| Problem                                                              | Fix                                                                                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension card greyed-out / "Manifest file is missing or unreadable" | You selected a parent dir, not `extension/`. Re-select with the folder picker.                                                                |
| Inline insight doesn't appear on PropertyGuru                        | Open DevTools → Console → look for fetch errors. Most common: backend not on `:8000` (run step 7) or CORS blocked (check `host_permissions`). |
| "Open in Buyer" opens a blank page                                   | Frontend not on `:5173`. Re-run step 8 with `--port 5173 --strictPort`.                                                                       |
| Extension stops working after `git pull`                             | Reload it: `chrome://extensions` → 🔄 button on the PropertyLens card.                                                                        |


---

## Quick health checks

```bash
curl http://localhost:8000/health                                # liveness probe
curl http://localhost:8000/api/analytics/global-shap | head      # confirms artifacts loaded
curl -X POST http://localhost:8000/api/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"user","password":"1234"}'                  # confirms SQLite seeded
```

---

## Common snags


| Problem                                                          | Likely cause                               | Fix                                                               |
| ---------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `FileNotFoundError: ... hybrid_cluster_bundle.joblib` at startup | Skipped step 3                             | Run `download_artifacts_from_hf.ipynb`                            |
| `⚠️ Neo4j not available: ...` at startup                         | Skipped step 4 or wrong creds              | Check `.env`, run `setup_neo4j_and_db.ipynb`                      |
| Ask AI panel returns empty / errors                              | Ollama not running, or no `GEMINI_API_KEY` | Run `ollama serve` (step 5) or set `CHAT_PROVIDER=gemini`         |
| Login rejected                                                   | SQLite tables not created                  | Re-run `setup_neo4j_and_db.ipynb`                                 |
| `port 8000 already in use`                                       | Another uvicorn / process                  | Add `--port 8001` and update `VITE_API_BASE_URL` in `.env`        |
| Photo-condition card doesn't work                                | `condition_model_*.pth` missing            | Re-run step 3 — it pulls into `hf_data/05_photo_layer/artifacts/` |
| Old `notebooks/00_project_setup_environment.ipynb` references    | Legacy combined notebook                   | Use the three setup notebooks at the top of `SystemCode/`         |
| Backend can't find artifacts / `.env` / `data/...`               | Started backend from the wrong cwd         | Activate venv from `SystemCode/`, then `cd backend` before uvicorn |


---

## Project layout (post-setup)

This repo follows the NUS-ISS IRS-PM submission template:

```
PropertyLens/
├── README.md                            # IRS-PM 7-section project README
├── ProjectReport/                       # final group-report PDF + user guide PDF
├── Video/                               # system modelling + use-case demo MP4s
├── Miscellaneous/
│   ├── docs/                            # internal architecture / methodology notes
│   └── images/                          # screenshots used in report and slides
└── SystemCode/                          # ← all source code lives here
    ├── HOW_TO_RUN.md                    # this file
    ├── .env                             # ← you create this in step 2
    ├── .env.example                     # env-var template
    ├── backend/                         # FastAPI app (uvicorn entry: backend/main.py)
    ├── frontend/                        # Vite + React (npm run dev)
    ├── extension/                       # Chrome extension for PropertyGuru
    ├── notebooks/                       # Training pipelines, RAG/search builders
    ├── scripts/                         # Standalone CLI tools
    ├── data/
    │   ├── artifacts/                   # ← from HF (model bundle + XAI caches)
    │   ├── feature_data/                # ← from HF (HDB feature CSVs)
    │   ├── amenities/                   # in-git fixtures + raw schooling extract from HF
    │   └── propertylens.db              # SQLite (auth, history, wishlist) — created by setup
    ├── hf_data/
    │   └── 05_photo_layer/              # ← from HF (condition model)
    ├── download_artifacts_from_hf.ipynb # ⬅ step 3
    ├── setup_neo4j_and_db.ipynb         # ⬅ step 4
    └── upload_artifacts_to_hf.ipynb     # publish artifacts (admin)
```

---

## Re-running setup

All three setup notebooks (at the top of `SystemCode/`) are **idempotent**:

- `download_artifacts_from_hf.ipynb` — `snapshot_download` skips up-to-date files
- `setup_neo4j_and_db.ipynb` — Neo4j uses `MERGE`, demo user is `if not exists`
- `upload_artifacts_to_hf.ipynb` — only run this when you've trained new models or refreshed feature tables

You can safely re-run any of them after a `git pull` if artifacts or schemas have changed.