# PropertyLens

PropertyLens is a layered project for Singapore HDB resale price prediction, location-aware ranking, and interpretable model outputs.

## Current Goals

- Predict HDB resale prices using transaction history, geographic POIs, school competition signals, and accessibility features.
- Support preference-aware property search and ranking through configurable feature weights.
- Provide local explanation outputs that break predicted price into feature-level contributions.

## Current Working Structure

```text
PropertyLens/
	00_project_docs/
		architecture_overview.md
	01_data_layer/
		README.md
		graphInfo.mmd
		pipelines/
			raw_data_collection.ipynb
		raw/
			ResaleFlatPrices/
			google_geo/
			schools/
	02_feature_layer/
		training/
			FeatureDealing.ipynb
			outputs/
	03_ml_layer/
		README.md
		graphInfo.mmd
		training/
			hybrid_price_prediction_20260316.ipynb
			outputs/
		test/
			unit_price_predict_shap.ipynb
			outputs/
	backup/
	common/
		config/
			feature_weights.example.yaml
		schemas/
			pricing_request.schema.json
			search_request.schema.json
```

## Active Pipeline

1. Data collection
   - [01_data_layer/pipelines/raw_data_collection.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/pipelines/raw_data_collection.ipynb) collects or refreshes raw public datasets.
   - Raw inputs are stored under [01_data_layer/raw](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/01_data_layer/raw).

2. Feature engineering
   - [02_feature_layer/training/FeatureDealing.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/FeatureDealing.ipynb) builds the training-ready feature tables.
   - Outputs are written to [02_feature_layer/training/outputs](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/02_feature_layer/training/outputs).

3. Model training
   - [03_ml_layer/training/hybrid_price_prediction_20260316.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/training/hybrid_price_prediction_20260316.ipynb) trains and evaluates the price model.
   - Model artifacts are written to [03_ml_layer/training/outputs](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/training/outputs).

4. Inference and explanation
   - [03_ml_layer/test/unit_price_predict_shap.ipynb](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/test/unit_price_predict_shap.ipynb) performs single-unit inference and SHAP-style explanation using the latest saved model.
   - Unit-level outputs are written to [03_ml_layer/test/outputs](/Users/lorenzolou/Library/Mobile Documents/com~apple~CloudDocs/NUS/PropertyLens/03_ml_layer/test/outputs).

## Notes

- The `backup/` folder stores archived scripts, staging files, and exploratory notebooks that are no longer part of the active pipeline.
- The current implementation is notebook-driven. Earlier Python scripts and staging artifacts have been archived to reduce workspace noise.
- The active notebooks follow a latest-artifact pattern and load the newest dated file that matches each expected dataset.

## Recommended Next Steps

- Add a lightweight service layer for price prediction and search requests.
- Replace notebook-only orchestration with reusable Python modules once the pipeline stabilizes.
- Add validation checks for POI completeness, especially for malls, schools, and transport features.
