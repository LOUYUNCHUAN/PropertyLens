### [ Practice Module ] Project Submission Template: Github Repository & Zip File

**[ Naming Convention ]** CourseCode-StartDate-BatchCode-TeamName-ProjectName.zip

* **[ MTech Stackable Group Project Submission Name ]** IRS-PM-2026-05-03-GRP-TransparentAI-PropertyLens.zip

---

### <<<<<<<<<<<<<<<<<<<< Start of Template >>>>>>>>>>>>>>>>>>>>

---

## SECTION 1 : PROJECT TITLE
## PropertyLens — Explainable HDB Resale Price Prediction

---

## SECTION 2 : EXECUTIVE SUMMARY / PAPER ABSTRACT

Singapore HDB resale buyers, sellers, and analysts routinely face opaque pricing: listed asking prices on PropertyGuru rarely come with a defensible "fair value" figure or any account of *why* a flat should be priced where it is. PropertyLens addresses this by combining a hybrid cluster-stack regressor (K-means routing into per-cluster Ridge + XGBoost + LightGBM + RandomForest, blended by a linear meta-learner) with a multi-method explainability layer — Composite TreeSHAP (exact for the tree portion of the stack), LIME, Case-Based Reasoning over a BallTree of past transactions, and Apriori-mined surrogate rules — exposed through a FastAPI backend, a Vite/React frontend with Buyer/Seller/Shortlist/Analytics views, and a Chrome extension that deep-links PropertyGuru listings into the Buyer flow. A Neo4j knowledge graph plus a local Ollama LLM power natural-language property search. On the held-out test set the hybrid model reaches **MAPE 3.95%** and **R² 0.9664**, a **68% error reduction** over the linear-regression baseline.

---

## SECTION 3 : CREDITS / PROJECT CONTRIBUTION

| Official Full Name | Student ID | Work Items (Who Did What) | Email |
| :----------------- | :--------: | :------------------------ | :---- |
| Kumar Bhuvesh | A0243823H | • FastAPI backend: prediction, auth, history, wishlist, SHAP/LIME/CBR endpoints<br>• XAI layer: Composite TreeSHAP, Kernel SHAP, LIME, surrogate trees, Apriori rules, CBR/BallTree<br>• React/Vite frontend: Buyer, Seller, Shortlist, Dashboard, Analysis, Discover views<br>• Chrome extension: PropertyGuru content script and popup<br>• Hybrid ML model (co-developed): K-means routing, per-cluster XGB/LGB/RF/Ridge, stacking meta-learner<br>• Report, video, and deck contributions | A0243823H@u.nus.edu |
| Lou Yunchuan | A0340534M | • Data pipeline: data.gov.sg ingestion, OneMap geocoding, MOE school data, amenity CSVs, feature engineering<br>• Photo-condition CNN: EfficientNet-B0 training and inference for furnishing-quality adjustment<br>• Hybrid ML model (co-developed): K-means routing, per-cluster XGB/LGB/RF/Ridge, stacking meta-learner<br>• Report, video, and deck contributions | A0340534M@u.nus.edu |
| Chi Thra Rekha | A0103372U | • Chatbot stack: Ollama/Gemini integration, RAG with Pinecone, three chat endpoints (legacy, RAG, property-search)<br>• Neo4j knowledge graph: schema design and population (Property, Town, FamousSchool nodes and relationships)<br>• Hybrid ML model (co-developed): K-means routing, per-cluster XGB/LGB/RF/Ridge, stacking meta-learner<br>• Report, video, and deck contributions | A0103372U@u.nus.edu |

Detailed per-member contributions are documented in the individual reflection appendices of the group report (`ProjectReport/`).

### Exploratory Work (Not in Final System)

Beyond the shipped system, the team explored several alternatives whose trade-offs informed the final design choices. These are preserved in the repository for traceability and to document the team's reasoning process.

- **Pinecone vector-RAG chatbot** (Bhuvesh) — built and evaluated as an alternative retrieval approach for the chatbot. The final system retained the Neo4j knowledge-graph + weighted-Cypher approach for stronger explainability and deterministic retrieval. Notebooks: `SystemCode/notebooks/05_chatbot/04_propertylens_build_index.ipynb`, `SystemCode/notebooks/05_chatbot/05_propertylens_rag_inference.ipynb`, `SystemCode/notebooks/05_chatbot/06_propertylens_rag_eval.ipynb`, `SystemCode/notebooks/05_chatbot/v2/04_propertylens_build_index_v51.ipynb`, `SystemCode/notebooks/05_chatbot/v2/05_propertylens_rag_inference_v51.ipynb`.
- **Alternative CNN architectures for modelling** (Yunchuan) — _[TODO: Yunchuan to add the details]_ . Notebook: `SystemCode/notebooks/xyz`.
- **Alternative ensemble configurations** (Rekha) — explored simpler XGBoost + LightGBM linear ensembles (without cluster routing) and earlier hybrid model revisions before the team converged on the per-cluster XGB/LGB/RF/Ridge stack with a linear meta-learner. Notebooks: `SystemCode/notebooks/03_ml_layer_hybrid/01_xgb_lgb_ensemble.ipynb`, `SystemCode/notebooks/_backup_03_ml_layer/training/hybrid_price_prediction_20260316.ipynb`, `SystemCode/notebooks/_backup_03_ml_layer/training/hybrid_price_prediction_updated.ipynb`.

Notebooks documenting these explorations remain under `SystemCode/notebooks/` and are not wired into the production backend.

---

## SECTION 4 : VIDEO OF SYSTEM MODELLING & USE CASE DEMO

**System modelling video:** [link added on submission day]

**Use case demo video:** [link added on submission day]

Note: It is not mandatory for every project member to appear in the video presentation; presentation by one project member is acceptable.

---

## SECTION 5 : USER GUIDE

`Refer to appendix <Installation & User Guide> in project report at Github Folder: ProjectReport`

A complete, step-by-step setup guide for a fresh clone — including Hugging Face artifact download, Neo4j seeding, Ollama setup, and starting backend + frontend on the correct ports for the Chrome extension — is in [`SystemCode/HOW_TO_RUN.md`](SystemCode/HOW_TO_RUN.md).

Demo login: **`user`** / **`1234`** at <http://localhost:5173>.

---

## SECTION 6 : PROJECT REPORT / PAPER

`Refer to project report at Github Folder: ProjectReport`

Final group report PDF and individual reflections will be added to `ProjectReport/` on submission day.

**Recommended sections (per IRS-PM template):**
- Executive Summary / Paper Abstract
- Business Problem Background
- Market Research
- Project Objectives & Success Measurements
- Project Solution (domain modelling & system design)
- Project Implementation (system development & testing)
- Project Performance & Validation
- Project Conclusions: Findings & Recommendation
- Appendix: Project Proposal
- Appendix: Mapped System Functionalities against MR / RS / CGS modular courses
- Appendix: Installation and User Guide
- Appendix: Individual Project Reflections (per member)
- Appendix: List of Abbreviations
- Appendix: References

---

## SECTION 7 : MISCELLANEOUS

`Refer to Github Folder: Miscellaneous`

- **`Miscellaneous/docs/`** — internal architecture and methodology notes accumulated during development (chatbot logic, demo report, XAI / SHAP methods comparison, views developer guide, LLM context). Retained for reference; the authoritative deliverable is the report under `ProjectReport/`.
- **`Miscellaneous/images/`** — screenshots of the system used in the report and slides.

---

### <<<<<<<<<<<<<<<<<<<< End of Template >>>>>>>>>>>>>>>>>>>>

---

**This [Intelligent Reasoning Systems (IRS)](https://www.iss.nus.edu.sg/stackable-certificate-programmes/intelligent-systems "IRS") Practice Module is part of the Graduate Certificate offered by [NUS-ISS](https://www.iss.nus.edu.sg "Institute of Systems Science, National University of Singapore").**
