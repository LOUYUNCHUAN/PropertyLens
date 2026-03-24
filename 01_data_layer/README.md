# Data Layer

The data layer is responsible for collecting, normalizing, and storing the raw public datasets used by the feature and model layers.

## Inputs

- data.gov.sg HDB resale transaction data
- Geographic POI datasets such as MRT/LRT nodes, hawker centres, malls, and road-accessibility proxies
- School metadata and school competition datasets used to derive school-quality features

## Current Raw Data Layout

- [raw/ResaleFlatPrices](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/raw/ResaleFlatPrices): historical HDB transaction CSV files
- [raw/google_geo](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/raw/google_geo): geocoded HDB coordinates, mall nodes, hawker centres, MRT/LRT nodes, and accessibility-derived tables
- [raw/schools](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/raw/schools): school metadata and school competition datasets

## Active Entry Point

- [pipelines/raw_data_collection.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/pipelines/raw_data_collection.ipynb)

This notebook is the active collection workflow for refreshing public datasets before feature engineering.

## Downstream Consumers

- [02_feature_layer/training/FeatureDealing.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/FeatureDealing.ipynb) reads the raw HDB, POI, and school datasets and produces the engineered feature tables.
- [03_ml_layer/test/unit_price_predict_shap.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/test/unit_price_predict_shap.ipynb) reads the latest geospatial raw files during live single-unit inference.

## Data Products Produced Indirectly

The data layer now keeps raw assets only. Engineered and model-ready outputs are produced in later layers:

- Feature tables: [02_feature_layer/training/outputs](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/outputs)
- Trained models and evaluation outputs: [03_ml_layer/training/outputs](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/training/outputs)

## Operational Notes

- The active notebooks rely on latest-date file matching, so refreshed raw files should keep a date suffix.
- Deprecated scripts, staging files, and exploratory utilities have been moved under [backup/20260317_cleanup](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/backup/20260317_cleanup).
- The `features/` directory is currently unused and can remain empty unless a file-based feature export step is reintroduced.
