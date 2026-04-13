# XAI Layer Instructions

**Scope:** `04_xai_layer/` post-hoc explainability training and per-listing inference  
**Key Notebooks (run in order):**
- `04_hybrid_xai_train.ipynb` — Train SHAP, LIME, surrogates, Apriori rules
- `05_hybrid_xai_explain.ipynb` — Per-listing attributions and explanations

**Support Module:** `feature_labels.py` — Human-readable feature names  
**Reference:** Artefacts under `artifacts/` | [Root Instructions](../CLAUDE.md)

---

## 1. Role & XAI Approaches

**Purpose:** Provide human-interpretable explanations for hybrid model predictions.

| Method | Output | Use Case |
|--------|--------|----------|
| **SHAP** | Per-feature SGD contribution | "Which features move price most?" |
| **LIME** | Local surrogate rules for individual listings | "Why is this listing predicted at $500k?" |
| **Surrogate Models** | Interpretable decision tree mimicking hybrid | "What's the global decision boundary?" |
| **Apriori Rules** | Association rules (e.g., "4-room + MRT < 1km = high price") | "What patterns drive price clusters?" |
| **CBR** | Comparable listings (similar features, nearby transactions) | "What are similar properties trading at?" |

---

## 2. Training Workflow

### Step 1: Train XAI Artefacts (`04_hybrid_xai_train.ipynb`)

**Inputs:** Hybrid bundle from `03_ml_layer_hybrid/artifacts/`, feature tables  
**Outputs:** `artifacts/shap_explainer.pkl`, `artifacts/lime_explainer.pkl`, `artifacts/surrogate_tree.pkl`, `artifacts/apriori_rules.pkl`

#### SHAP
```python
import shap
from yc_hybrid_inference import load_bundle

bundle = load_bundle('03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib')
background_data = df_train[feature_cols].sample(n=1000, random_state=42)

def model_predict(X):
    predictions = []
    for i in range(len(X)):
        cluster_id = bundle['kmeans_model'].predict(X[i:i+1])[0]
        predictions.append(bundle['cluster_models'][cluster_id].predict(X[i:i+1])[0])
    return np.array(predictions)

explainer = shap.KernelExplainer(model_predict, background_data)

import pickle
with open('artifacts/shap_explainer.pkl', 'wb') as f:
    pickle.dump(explainer, f)
```

#### LIME
```python
from lime.tabular import LimeTabularExplainer
lime_explainer = LimeTabularExplainer(
    training_data=df_train[feature_cols].values,
    feature_names=feature_cols,
    mode='regression'
)
with open('artifacts/lime_explainer.pkl', 'wb') as f:
    pickle.dump(lime_explainer, f)
```

#### Surrogate Tree
```python
from sklearn.tree import DecisionTreeRegressor
surrogate = DecisionTreeRegressor(max_depth=5, random_state=42)
y_pred_train = model_predict(df_train[feature_cols].values)
surrogate.fit(df_train[feature_cols], y_pred_train)

fidelity = 1 - np.mean(np.abs(y_pred_test - surrogate.predict(df_test[feature_cols])) / y_pred_test)
assert fidelity > 0.90, f"Surrogate fidelity too low: {fidelity:.2%}"
```

#### Apriori Rules
```python
from mlxtend.frequent_patterns import apriori, association_rules
# Discretize features into itemsets (town, flat_type, mrt proximity, price band)
# Then: frequent_itemsets = apriori(df_itemsets, min_support=0.01, use_colnames=True)
# rules = association_rules(frequent_itemsets, metric="confidence", min_threshold=0.5)
```

**Validation:**
- [ ] SHAP explainer generates values for sample listings
- [ ] Surrogate tree fidelity ≥ 90% on test set
- [ ] Apriori top rules make business sense
- [ ] All pickle files saved to `artifacts/`

---

### Step 2: Per-Listing Explanations (`05_hybrid_xai_explain.ipynb`)

#### SHAP
```python
import pickle, shap
with open('artifacts/shap_explainer.pkl', 'rb') as f:
    shap_explainer = pickle.load(f)

sample = df_test[feature_cols].iloc[0:1].values
shap_values = shap_explainer.shap_values(sample)

# Validate: base + sum ≈ prediction
base_value = shap_explainer.expected_value
shap_sum = base_value + shap_values[0].sum()
assert abs(shap_sum - predictions[0]) / predictions[0] < 0.01, "SHAP values don't explain prediction!"
```

#### CBR (Comparable Listings)
```python
from sklearn.metrics.pairwise import euclidean_distances
from sklearn.preprocessing import StandardScaler

scaler = StandardScaler()
train_scaled = scaler.fit_transform(df_train[feature_cols])
test_scaled = scaler.transform(df_test[feature_cols])

distances = euclidean_distances(test_scaled[0:1], train_scaled)[0]
nearest_5 = np.argsort(distances)[:5]
```

**Validation:**
- [ ] SHAP values sum approximately to prediction
- [ ] LIME rule list is interpretable
- [ ] CBR comparables are genuinely similar (spot-check feature values)

---

## 3. Standard Patterns

### Path Resolution
```python
from pathlib import Path
cwd = Path.cwd()
REPO_ROOT = cwd if (cwd / 'hf_data').exists() else cwd.parent
ARTIFACTS = REPO_ROOT / '04_xai_layer/artifacts'
ARTIFACTS.mkdir(exist_ok=True)
```

### Feature Labels (Human-Readable)
```python
from feature_labels import get_feature_label
for feature, contribution in top_features:
    print(f"  {get_feature_label(feature)}: +${contribution:,.0f}")
```

### Explanation Output Format
```python
explanation = {
    'predicted_price': f"${price_predicted:,.0f}",
    'price_range': f"${price_predicted*0.95:,.0f} - ${price_predicted*1.05:,.0f}",
    'top_drivers': [
        {'feature': get_feature_label(col), 'impact': f"+${v:,.0f}" if v > 0 else f"-${abs(v):,.0f}"}
        for col, v in sorted(zip(feature_cols, shap_values), key=lambda x: abs(x[1]), reverse=True)[:5]
    ]
}
```

---

## 4. Quality Standards

### LIME Stability Check
```python
lime_runs = [
    [f for f, w in lime_explainer.explain_instance(sample, model_predict, num_features=5).as_list()]
    for _ in range(3)
]
top_features = lime_runs[0]
consistency = sum(1 for f in top_features if all(f in run for run in lime_runs)) / len(top_features)
print(f"LIME stability: {consistency:.0%}")
```

### Surrogate Fidelity
```python
from sklearn.metrics import mean_absolute_percentage_error
fidelity = 1 - mean_absolute_percentage_error(y_pred_hybrid, surrogate.predict(df_test[feature_cols]))
assert fidelity > 0.90, f"Fidelity too low ({fidelity:.2%})"
```

---

## 5. Troubleshooting

| Issue | Solution |
|-------|----------|
| SHAP OOM on large dataset | Use `shap.sample()` or limit background data to 1k rows |
| LIME rules don't match intuition | Increase `num_features`; verify local neighbourhood is representative |
| Surrogate fidelity < 90% | Increase `max_depth` (trade-off: interpretability vs accuracy) |
| Apriori too many rules | Increase `min_support`; focus on high-lift rules |
| CBR comparables dissimilar | Add feature weighting using domain knowledge |
| Pickle load error | Verify Python version matches; check file integrity |
