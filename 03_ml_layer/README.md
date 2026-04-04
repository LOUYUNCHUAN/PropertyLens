# ML Layer

## Overview

The ML layer is responsible for building, evaluating, and deploying price prediction models from engineered features.

**Inputs**: 
- Feature sets from `02_feature_layer/training/outputs/` (train/test split, 71-D)

**Outputs**: 
- Versioned models and evaluation reports in `training/outputs/`
- Prediction results + feature contributions (SHAP)
- Feature importance analysis

---

## Current Approach (Approach 1: Baseline Unified Feature Model) ✅

### Architecture
```
71-D Features → [Multiple Regressors] → Best Model by MAPE
├─ LightGBM (tuned)
├─ XGBoost (tuned)
├─ RandomForest
├─ ExtraTreesRegressor
├─ HistGradientBoosting
└─ ElasticNet (Log-transformed)
```

### Key Features
- **Two-Stage Hyperparameter Optimization**: 
  1. Random Search Stage (Stage-1): 12 iterations for quick filtering
  2. Focused Search Stage (Stage-2): Fine-tuning around optimal parameters (10 iterations)
  
- **Model Evaluation Metrics** (Test Set):
  - **Test MAPE**: Primary optimization metric (target ≤ 8.5%)
  - Test MAE: Absolute error (Singapore Dollars)
  - Test RMSE: Root Mean Squared Error
  - Test R²: Coefficient of Determination

- **Explainability**: 
  - Feature importance ranking (XGBoost/LightGBM/ExtraTree comparison)
  - SHAP value decomposition (prediction decision chain for individual transaction)
  - School factor specialized analysis

### Latest Run Results
- Data version: `hdb_feature_train/test_20260403.csv` (71-D, 178.6K training + 82.1K test samples)
- Model output directory: `training/outputs/` 
- File naming: `{artifact_type}_{RUN_DATE}.{ext}`
  - `model_mape_leaderboard_20260403.csv` - Model leaderboard
  - `best_price_model_20260403.joblib` - Serialized best model
  - `best_model_predictions_20260403.csv` - Predictions + error stats
  - `feature_importance_comparison_20260403.csv` - Feature weight comparison
  - `feature_dictionary_20260403.csv` - Feature explanation document

### Usage Flow
1. After feature layer completes new data processing, run `hybrid_price_prediction_20260316.ipynb`
2. Notebook automatically picks the latest feature file (`hdb_feature_train_*.csv`)
3. Generate model and evaluation reports to `outputs/`
4. Support SHAP explanation for individual properties

---

## Planned Alternative Approaches

See **[ML_ARCHITECTURE_DESIGN.md](./ML_ARCHITECTURE_DESIGN.md)** - Complete architecture design and benchmarking.

### Approach Overview

| Approach | Cycle | Expected MAPE Improvement | Inference Latency | Explainability | Recommended Deployment |
|----------|-------|--------------------------|------------------|-----------------|------------------------|
| **Approach 1: Unified Model** | - | - | 1-2ms | ⭐⭐ | ✅ **Current** |
| **Approach 2: Two-Stage Location Stratification** | 1 week | +2-4% | 2-4ms | ⭐⭐⭐ | Within 6 weeks |
| **Approach 3: Feature Group Stacking** | 2 weeks | +1-3% | 5-10ms | ⭐⭐ | Within 8 weeks |
| **Approach 4: Hybrid Model (Tree+NN)** | 3-4 weeks | +3-6% | 10-20ms | ⭐ | Within 12 weeks |
| **Approach 5: Time-Location Joint Factor** | 4-5 weeks | +2-5% | 3-5ms | ⭐⭐ | Q3 2026 |

#### Approach 2: Two-Stage Location Stratification
- Use Case: Price variance across towns > 20-25%
- Architecture: Stage-1 (town baseline) + Stage-2 (individual deviation)
- Strengths: High explainability, good stability, easy to customize
- Status: To Implement

#### Approach 3: Feature Group Stacking
- Use Case: Complex feature interactions, need fine-grained control
- Architecture: 4 groups (Physical|Geo|Education|Location) sub-models + Meta-Learner
- Strengths: Decoupled feature engineering, flexible component replacement
- Status: To Implement

#### Approach 4: Hybrid Model (Tree + Neural Network)
- Use Case: Long-term transfer learning, expand to new markets
- Architecture: XGBoost encodes discrete features + NN encodes continuous + fusion network
- Strengths: Automatic feature extraction, end-to-end optimization
- Status: To Implement (requires GPU resources)

#### Approach 5: Time-Location Joint Factor
- Use Case: Capture market dynamics, long-term forecasting
- Architecture: Time gridding + location transfer learning + dynamic fusion
- Strengths: Strong cycle adaptation, fast new market launch
- Status: To Implement (planned Q3 2026)

---

## Feature Descriptions

### Physical Features (5-D)
- `transaction_year`: Transaction year, captures market cycles and inflation
- `level_mid`: Floor mid-value (1-30 levels)
- `lease_remaining_years`: Remaining lease years (under 99-year scheme)
- `floor_area_sqm`: Interior floor area (square meters)
- `room_count`: Number of rooms (derived from flat type)

### Geography & Amenities (15-D)
- `dist_to_mrt_m`: Distance to nearest MRT station
- `dist_to_highway_m`: Distance to expressway (noise/pollution indicator)
- `dist_to_foodcourt_m`, `dist_to_nearest_mall_m`: Living facility distances
- `mall_count_3km`, `mall_weighted_access_3km`: 3km commercial hub indicators
- `orientation_score`: Orientation/roadside score (roadside negative, otherwise positive)

### Education Features (5-D)
- `dist_to_nearest_school_m`: Distance to nearest school
- `school_count_1km`: School count within 1km (all levels)
- `primary_school_quality_1km_weighted`: Primary school quality weighted score (competition-derived)
- `primary_school_top_quality_1km`: Best primary school quality score
- `primary_school_count_1km`: Primary school count within 1km

### Location Encoding (46-D)
- `town_*`: Town dummies (~25 towns, one-hot)
- `flat_type_*`: Flat type dummies (1R~5R+, one-hot)
- `flat_model_*`: Building model dummies (multi-level, HDB types, one-hot)

---

## Output File Inventory

```
03_ml_layer/training/outputs/
├── model_mape_leaderboard_{DATE}.csv          # All models ranked by MAPE
├── best_price_model_{DATE}.joblib             # Serialized best model
├── best_model_predictions_{DATE}.csv          # Predictions + error statistics
├── model_metadata_{DATE}.json                 # Model metadata (config, hyperparams)
├── feature_importance_comparison_{DATE}.csv   # Feature weight comparison
├── feature_dictionary_{DATE}.csv              # Feature explanations (EN/CN)
├── shap_contribution_raw_{DATE}_{ADDRESS}.csv          # Individual SHAP raw decomposition
└── shap_contribution_grouped_{DATE}_{ADDRESS}.csv      # Individual SHAP grouped aggregation

Where {DATE} = YYYYMMDD format (e.g., 20260403, auto-generated)
```

---

## Quick Start Guide

### Getting Started
1. Ensure `02_feature_layer/training/outputs/` has the latest feature file
2. Open `hybrid_price_prediction_20260316.ipynb`
3. Run all cells (notebook auto-finds latest data)
4. Check `outputs/` for latest evaluation reports

### Single Property Explanation
- Modify `unit_address_input` variable in notebook cell 5
- Run to get predicted price + SHAP feature contribution ranking
- Positive SHAP = price increase factor, negative = price decrease factor

### Monitoring & Maintenance
- **Regular Checks**: 
  - Is latest feature file auto-detected
  - Test MAPE drift (>+1% requires re-tuning)
- **Feature Engineering Iteration**:
  - New dimensions auto-supported (notebook adaptive)
  - Update feature dictionary if needed
- **Model Version Management**:
  - Keep historical models for backtesting
  - Log hyperparams and performance each run

---

## Metric Explanations

- **MAPE (Mean Absolute Percentage Error)**: 
  - Definition: Average absolute percentage error = mean(|actual - pred| / |actual|)
  - Range: 0-100% (lower is better)
  - Advantage: Normalized error, comparable across price segments
  - Note: Unstable when actual ≈ 0

- **MAE (Mean Absolute Error)**:
  - Definition: Average absolute error (Singapore Dollars)
  - Purpose: Intuitive prediction deviation understanding
  - Example: MAE = 35k SGD → Average deviation 35k SGD

- **RMSE (Root Mean Squared Error)**:
  - Definition: Root mean squared error
  - Property: Penalizes large errors more
  - Purpose: Detect anomalous predictions

- **R² (Coefficient of Determination)**:
  - Definition: Proportion of variance explained by model
  - Range: -∞ ~ 1.0 (closer to 1 is better)
  - 0.8+ indicates good fit

---

## FAQ

**Q: Why use multiple models instead of just one?**

A: Different algorithms have different assumptions. XGBoost favors non-linearity, ElasticNet favors linearity. Ensemble comparison finds the optimal approach.

**Q: Why does SHAP explanation sometimes contradict intuition?**

A: SHAP provides local model explanation, reflecting the property's "deviation" in the model, not intrinsic property value driver.

**Q: How to deploy Approaches 2/3/4/5?**

A: See [ML_ARCHITECTURE_DESIGN.md](./ML_ARCHITECTURE_DESIGN.md) cross-approach comparison and selection recommendations.

---

## References
- [Feature Engineering Details](../02_feature_layer/README.md)
- [Data Layer Documentation](../01_data_layer/README.md)
- [Project Architecture](../00_project_docs/architecture_overview.md)
- SHAP Library: https://github.com/slundberg/shap
- XGBoost Hyperparameters: https://xgboost.readthedocs.io/en/latest/parameter.html

---

*Last Updated: 2026-04-04*
*Maintainer: ML Team*
