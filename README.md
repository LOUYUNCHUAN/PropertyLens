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
| Kumar Bhuvesh      | A0243823H  | See individual reflection in `ProjectReport/` | A0243823H@u.nus.edu |
| Lou Yunchuan       | A0340534M  | See individual reflection in `ProjectReport/` | A0340534M@u.nus.edu |
| Chi Thra Rekha     | A0103372U  | See individual reflection in `ProjectReport/` | A0103372U@u.nus.edu |

Detailed per-member contributions are documented in the individual reflection appendices of the group report (`ProjectReport/`).

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
