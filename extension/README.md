# PropertyLens — Chrome extension (PropertyGuru)

Unpacked extension from the IRS/HDB ResaleXAI project, wired to this repo’s **FastAPI** (`backend/`) and **Vite** buyer UI (`frontend/`).

## Install (Chrome)

1. Start the backend: `cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000`
2. Start the frontend: `cd frontend && npm run dev` (default `http://localhost:5173`)
3. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this `extension/` folder.

## Behaviour

- On PropertyGuru HDB listing pages, scrapes listing fields and POSTs to `http://localhost:8000/api/predict` and `/api/explain/shap`.
- Sends **`block`**, **`street_name`**, **`sale_month`** (YYYY-MM), and **`storey_range`** when detected so the backend can use the **hybrid feature-table** path (same idea as the Buyer view).
- **Open in Buyer** opens `http://localhost:5173/buyer?…` with query prefill.

## Custom ports / hosts

Edit `content.js`: `API_BASE` and `BUYER_STUDIO_ORIGIN`.  
Edit `manifest.json` → `host_permissions` if the API is not on `localhost:8000`.
