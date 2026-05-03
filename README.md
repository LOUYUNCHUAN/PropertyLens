## SECTION 1 : PROJECT TITLE



## PropertyLens — Explainable HDB Resale Price Prediction

---

## SECTION 2 : EXECUTIVE SUMMARY

PropertyLens helps Singapore HDB resale buyers and sellers value and analyse flats, with explainability built into every step. The system combines a hybrid cluster stack regressor, four complementary explainability methods, a photo condition CNN, a Neo4j backed conversational interface, a React web application with eleven views, and a Chrome extension that bridges PropertyGuru into the valuation flow.

The hybrid model reaches **3.92% MAPE** on a temporal hold out test set, a **68% reduction over a single XGBoost baseline of 12.18% MAPE**. Composite TreeSHAP attributions are exact at machine precision across 100 validation cases. The chatbot was evaluated against two complementary test suites. A 25 case category cross validation achieved 80% strict pass on natural language search under stress, and an 11 case end to end capability validation achieved 100% pass across every chatbot branch including tool dispatch and shortlist composition. The photo CNN scores furnishing conditions within plus or minus 0.5 points on a held out validation set.

This report documents the business case, market positioning, system design, implementation approach, validation methodology, and measured findings. The system meets every functional and non-functional objective defined for the project.

---

## SECTION 3 : PROJECT CONTRIBUTION


| Official Full Name | Student ID | Work Items (Who Did What)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Email                                             |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Kumar Bhuvesh | A0243823H | • Developed the Hybrid ML model: K-means routing, per-cluster XGB/LGB/RF/Ridge, stacking meta-learner<br>• Model exploration: trial of various models on data<br>• Developed the XAI layer: Composite TreeSHAP plus 3 supporting techniques (LIME, CBR, Apriori rules)<br>• Built the web app: FastAPI backend, React/Vite frontend, and Chrome extension<br>• Designed the UI/UX for the web app<br>• Chatbot testing and added chatbot tool functions<br>• Explored Pinecone vector-RAG chatbot as an alternative retrieval approach<br>• Team time management and delivery coordination<br>• Report, video, and deck contributions | [A0243823H@u.nus.edu](mailto:A0243823H@u.nus.edu) |
| Lou Yunchuan | A0340534M | • Data pipeline: data.gov.sg ingestion, OneMap geocoding, MOE school data, amenity CSVs<br>• Feature engineering: amenity proximity features, school-quality scoring, lease-remaining derivation, mature-estate flags<br>• Data preparation and train/validation/test splitting for modelling<br>• Model exploration: trial of various models on data<br>• Photo-condition CNN: EfficientNet-B0 training and inference for furnishing-quality adjustment<br>• RAG evaluation: assessed retrieval quality and answer faithfulness of the Pinecone-based chatbot prototype<br>• Report, video, and deck contributions | [A0340534M@u.nus.edu](mailto:A0340534M@u.nus.edu) |
| Chi Thra Rekha | A0103372U | • Chatbot stack: Ollama/Gemini integration, RAG with Pinecone, three chat endpoints (legacy, RAG, property-search)<br>• Neo4j knowledge graph: schema design and population (Property, Town, FamousSchool nodes and relationships)<br>• Model exploration: trial of various models on data<br>• Model evaluation: comparing the hybrid stack against baseline regressors (linear, single-XGB, single-LGB) on RMSE / MAE / R²<br>• Report, video, and deck contributions | [A0103372U@u.nus.edu](mailto:A0103372U@u.nus.edu) |


## SECTION 4 : VIDEO OF SYSTEM MODELLING & USE CASE DEMO

**Promotional video:** [Video/IRS-PM-2026-05-03-AIS08PT-GRP15-TransparentAI_Promotion.mp4](Video/IRS-PM-2026-05-03-AIS08PT-GRP15-TransparentAI_Promotion.mp4)

**Technical walkthrough video:** [Video/IRS-PM-2026-05-03-AIS08PT-GRP15-TransparentAI_System.mov](Video/IRS-PM-2026-05-03-AIS08PT-GRP15-TransparentAI_System.mov)

---

## SECTION 5 : USER GUIDE

`Refer to appendix <Installation & User Guide> in project report at Github Folder: ProjectReport`

A complete, step-by-step setup guide for a fresh clone — including Hugging Face artifact download, Neo4j seeding, Ollama setup, and starting backend + frontend on the correct ports for the Chrome extension — is in [SystemCode/HOW_TO_RUN.md](SystemCode/HOW_TO_RUN.md).

Demo login: **user** / **1234** at [http://localhost:5173](http://localhost:5173).

> See also: [SystemCode/HOW_TO_RUN.md](SystemCode/HOW_TO_RUN.md) — full end-to-end run instructions (prerequisites, `.env` setup, artifact download, Neo4j + SQLite seeding, Ollama, backend + frontend startup, Chrome extension install, and troubleshooting).

---

## SECTION 6 : PROJECT REPORT

`Refer to project report at Github Folder: ProjectReport`

The final group report PDF is available at [ProjectReport/IRS-PM-2026-03-29-GRP-TransparentAI-Proposal.pdf](ProjectReport/IRS-PM-2026-03-29-GRP-TransparentAI-Proposal.pdf).

---

## SECTION 7 : MISCELLANEOUS

`Refer to Github Folder: Miscellaneous`

- **Miscellaneous/images/** — screenshots of the system used in the report and slides.

**This [Intelligent Reasoning Systems (IRS)](https://www.iss.nus.edu.sg/stackable-certificate-programmes/intelligent-systems) Practice Module is part of the Graduate Certificate offered by [NUS-ISS](https://www.iss.nus.edu.sg).**