---
applyTo: "04_xai_layer/**/*.ipynb"
---

# XAI Layer Instructions

**Scope:** `04_xai_layer/` post-hoc explainability training and per-listing inference  
**Key Notebooks (run in order):**  
- [`04_hybrid_xai_train.ipynb`](../../04_xai_layer/04_hybrid_xai_train.ipynb) — Train SHAP, LIME, surrogates, Apriori rules
- [`05_hybrid_xai_explain.ipynb`](../../04_xai_layer/05_hybrid_xai_explain.ipynb) — Per-listing attributions and explanations

**Support Module:** [`feature_labels.py`](../../04_xai_layer/feature_labels.py) — Human-readable feature names for explanations

**Reference:** Artefacts saved under `04_xai_layer/artifacts/` after training

---

## 1. Role & Approaches

**Purpose:** Provide **human-interpretable explanations** for hybrid model predictions via multiple XAI methods:

| Method | Output | Use Case |
|--------|--------|----------|
| **SHAP** | Per-feature contribution (SGD) to predicted price | "Which features move price most?" |
| **LIME** | Local surrogate rules for individual listings | "Why is this listing predicted at $500k?" |
| **Surrogate Models** | Interpretable decision tree mimicking hybrid | "What's the global decision boundary?" |
| **Apriori Rules** | Association rules (e.g., "4-room + MRT < 1km = high price") | "What patterns drive price clusters?" |
| **CBR (Case-Based Reasoning)** | Comparable listings (similar features, nearby transactions) | "What are similar properties trading at?" |

---

## 2. Training Workflow

### Step 1: Train XAI Artefacts (`04_hybrid_xai_train.ipynb`)

**Inputs:**
- Hybrid bundle from `03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib`
- Feature tables from `hf_data/02_feature_layer/training/outputs/hdb_feature_*.csv`
- Sample training data (e.g., 10k rows for computational efficiency)

**Outputs:**
- `artifacts/shap_explainer.pkl` — SHAP TreeExplainer or KernelExplainer
- `artifacts/lime_explainer.pkl` — LIME TabularExplainer
- `artifacts/surrogate_tree.pkl` — Decision tree (max_depth=5, fidelity ~95%)
- `artifacts/apriori_rules.pkl` — Frequent itemsets + association rules
- `artifacts/feature_scalers.pkl` — StandardScaler for feature normalization

**Key Steps:**

#### SHAP Training
```python
import shap
from yc_hybrid_inference import load_bundle, build_yc_hybrid_vector

bundle = load_bundle('03_ml_layer_hybrid/artifacts/hybrid_cluster_bundle.joblib')

# SHAP requires a model and baseline data
# Use 1000 background samples for efficiency
background_data = df_train[feature_cols].sample(n=1000, random_state=42)

# Create a prediction wrapper
def model_predict(X):
    """Wrapper for hybrid model that SHAP can call"""
    predictions = []
    for idx in range(len(X)):
        cluster_id = bundle['kmeans_model'].predict(X[idx:idx+1])[0]
        pred = bundle['cluster_models'][cluster_id].predict(X[idx:idx+1])[0]
        predictions.append(pred)
    return np.array(predictions)

# Train SHAP explainer
explainer = shap.KernelExplainer(model_predict, background_data)
print("✓ SHAP explainer trained")

# Save
import pickle
with open('artifacts/shap_explainer.pkl', 'wb') as f:
    pickle.dump(explainer, f)
```

#### LIME Training
```python
from lime.tabular import LimeTabularExplainer
import pickle

# LIME for tabular data
lime_explainer = LimeTabularExplainer(
    training_data=df_train[feature_cols].values,
    feature_names=feature_cols,
    class_names=['price'],
    mode='regression'
)
print("✓ LIME explainer trained")

with open('artifacts/lime_explainer.pkl', 'wb') as f:
    pickle.dump(lime_explainer, f)
```

#### Surrogate Tree Training
```python
from sklearn.tree import DecisionTreeRegressor

# Train shallow tree to approximate hybrid model
surrogate = DecisionTreeRegressor(max_depth=5, random_state=42)
y_pred_train = np.array([model_predict(df_train[feature_cols].iloc[i:i+1]) for i in range(len(df_train))])
surrogate.fit(df_train[feature_cols], y_pred_train)

# Check fidelity
y_pred_surrogate = surrogate.predict(df_test[feature_cols])
fidelity = 1 - np.mean(np.abs(y_pred_test - y_pred_surrogate) / y_pred_test)
print(f"Surrogate fidelity: {fidelity:.2%}")
assert fidelity > 0.90, "Surrogate has low fidelity; increase max_depth"

with open('artifacts/surrogate_tree.pkl', 'wb') as f:
    pickle.dump(surrogate, f)
```

#### Apriori Rules Training
```python
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder

# Discretize features for market basket analysis
# Example: Create itemsets like "town=AMK", "flat_type=4ROOM", "dist_mrt_low", "price_high"
itemsets = []
for idx, row in df_train.iterrows():
    items = []
    items.append(f"town={row['town']}")
    items.append(f"flat_type={row['flat_type']}")
    items.append(f"mrt_dist={'close' if row['dist_nearest_mrt_km'] < 1 else 'far'}")
    items.append(f"price={'high' if row['resale_price'] > df_train['resale_price'].median() else 'low'}")
    itemsets.append(items)

# Find frequent itemsets
te = TransactionEncoder()
te_ary = te.fit(itemsets).transform(itemsets)
df_itemsets = pd.DataFrame(te_ary, columns=te.columns_)
frequent_itemsets = apriori(df_itemsets, min_support=0.01, use_colnames=True)
rules = association_rules(frequent_itemsets, metric="confidence", min_threshold=0.5)

print(f"Found {len(rules)} association rules")
print(rules.sort_values('lift', ascending=False).head(10))

with open('artifacts/apriori_rules.pkl', 'wb') as f:
    pickle.dump({'itemsets': frequent_itemsets, 'rules': rules}, f)
```

**Validation:**
- [ ] SHAP explainer trains and can generate values for sample listings
- [ ] LIME explainer trains successfully
- [ ] Surrogate tree fidelity ≥ 90% on test set
- [ ] Apriori rules extracted; top rules make business sense
- [ ] All pickle files saved to `artifacts/`

---

### Step 2: Per-Listing Explanations (`05_hybrid_xai_explain.ipynb`)

**Inputs:**
- XAI artefacts from Step 1 (`shap_explainer.pkl`, `lime_explainer.pkl`, etc.)
- Hybrid bundle from `03_ml_layer_hybrid/artifacts/`
- Feature tables
- Sample listings to explain (or bulk evaluation set)

**Outputs:**
- SHAP values (per-feature contributions) for sample listings
- LIME explanations (local rules) for sample listings
- Surrogate tree feature importances (global)
- Apriori rule matches for sample listings
- CBR results (comparable listings)
- Visualization plots (SHAP waterfall, LIME explanation, etc.)

**Key Steps:**

#### Generate SHAP Explanations
```python
import pickle
import shap

# Load explainer
with open('artifacts/shap_explainer.pkl', 'rb') as f:
    shap_explainer = pickle.load(f)

# Pick sample listings
sample_indices = [100, 500, 1000]

for idx in sample_indices:
    sample = df_test[feature_cols].iloc[idx:idx+1].values
    shap_values = shap_explainer.shap_values(sample)
    
    # Log SHAP explanation
    print(f"\n=== Listing {idx} (Predicted: ${predictions[idx]:,.0f}) ===")
    
    # Top contributing features
    top_features = sorted(
        zip(feature_cols, shap_values[0]),
        key=lambda x: abs(x[1]),
        reverse=True
    )[:5]
    
    for feature, contribution in top_features:
        direction = "↑" if contribution > 0 else "↓"
        print(f"  {direction} {feature}: +${contribution:,.0f}")
```

#### Generate LIME Explanations
```python
from lime.tabular import LimeTabularExplainer
import pickle

with open('artifacts/lime_explainer.pkl', 'rb') as f:
    lime_explainer = pickle.load(f)

for idx in sample_indices:
    sample = df_test[feature_cols].iloc[idx:idx+1].values[0]
    
    # LIME explanation (local surrogate)
    exp = lime_explainer.explain_instance(
        sample,
        predict_fn=model_predict,
        num_features=5
    )
    
    print(f"\n=== LIME Explanation for Listing {idx} ===")
    print(f"Intercept (base price): ${exp.intercept[1]:,.0f}")
    for feature, weight in exp.as_list():
        print(f"  {feature}: {weight:+.0f}")
```

#### Surrogate Interpretations
```python
import pickle
from sklearn.tree import export_text

with open('artifacts/surrogate_tree.pkl', 'rb') as f:
    surrogate = pickle.load(f)

# Print decision path for a sample listing
sample = df_test[feature_cols].iloc[0:1]
prediction = surrogate.predict(sample)[0]

print(f"\n=== Surrogate Tree Decision Path ===")
print(f"Predicted Price: ${prediction:,.0f}")
print(export_text(surrogate, feature_names=feature_cols))

# Feature importances
importances = sorted(
    zip(feature_cols, surrogate.feature_importances_),
    key=lambda x: x[1],
    reverse=True
)
print("\nTop 10 Global Features (Surrogate Tree):")
for feature, importance in importances[:10]:
    print(f"  {feature}: {importance:.4f}")
```

#### CBR (Comparable Listings)
```python
from sklearn.metrics.pairwise import euclidean_distances
from sklearn.preprocessing import StandardScaler

# Normalize features for distance calculation
scaler = StandardScaler()
train_scaled = scaler.fit_transform(df_train[feature_cols])
test_scaled = scaler.transform(df_test[feature_cols])

for idx in sample_indices:
    # Find 5 nearest neighbours
    distances = euclidean_distances(test_scaled[idx:idx+1], train_scaled)[0]
    nearest_indices = np.argsort(distances)[:5]
    
    print(f"\n=== Comparable Listings for {idx} ===")
    print(f"Query Predicted Price: ${predictions[idx]:,.0f}")
    
    for rank, train_idx in enumerate(nearest_indices, 1):
        comparable = df_train.iloc[train_idx]
        price = comparable['resale_price']
        distance = distances[train_idx]
        print(f"  {rank}. ${price:,.0f} (similarity: {1/(1+distance):.2f})")
```

**Validation:**
- [ ] SHAP values sum approximately to prediction (waterfall effect)
- [ ] LIME rule list is interpretable (e.g., "4-room in Bedok" matches sample)
- [ ] Surrogate tree provides consistent predictions
- [ ] Comparable listings are truly similar (check feature values)

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

### Feature Mapping (Human-Readable Labels)
```python
# Use feature_labels.py to convert column names to readable strings
from feature_labels import get_feature_label

readable_features = {col: get_feature_label(col) for col in feature_cols}
# Example: {'dist_nearest_mrt_km': 'Distance to Nearest MRT (km)', ...}

# In explanations, display using readable names
for feature, contribution in top_features:
    readable_name = readable_features.get(feature, feature)
    print(f"  {readable_name}: +${contribution:,.0f}")
```

### Pickling & Loading
```python
import pickle

# Save
with open(f'{ARTIFACTS}/shap_explainer_{date_suffix}.pkl', 'wb') as f:
    pickle.dump(explainer, f)

# Load
with open(f'{ARTIFACTS}/shap_explainer_20260403.pkl', 'rb') as f:
    explainer = pickle.load(f)
```

### Explanation Output Format
```python
def format_explanation(price_actual, price_predicted, shap_values, feature_cols, feature_labels):
    """Format XAI output for user display"""
    explanation = {
        'address': '123 AMK AVE 4, Block 123',
        'predicted_price': f"${price_predicted:,.0f}",
        'price_range': f"${price_predicted*0.95:,.0f} - ${price_predicted*1.05:,.0f}",  # ±5%
        'confidence': '95%',
        'top_drivers': [
            {
                'feature': feature_labels.get(col, col),
                'impact': f"+${value:,.0f}" if value > 0 else f"-${abs(value):,.0f}",
                'direction': '↑' if value > 0 else '↓'
            }
            for col, value in sorted(zip(feature_cols, shap_values), 
                                     key=lambda x: abs(x[1]), reverse=True)[:5]
        ],
        'comparables': [
            {'price': f"${cmp_price:,.0f}", 'similarity': f"{sim:.0%}"}
            for cmp_price, sim in comparables
        ]
    }
    return explanation
```

---

## 4. Quality Standards

### SHAP Validation
```python
# SHAP values should sum approximately to prediction (with base value)
base_value = shap_explainer.expected_value
shap_sum = base_value + shap_values[0].sum()
pred = predictions[idx]

assert abs(shap_sum - pred) / pred < 0.01, "SHAP values don't explain prediction!"
print(f"✓ SHAP waterfall validated: base={base_value:.0f} + sum={shap_values[0].sum():.0f} = {shap_sum:.0f} (pred={pred:.0f})")
```

### LIME Stability
```python
# Run LIME multiple times; should be relatively stable
lime_runs = []
for _ in range(3):
    exp = lime_explainer.explain_instance(sample, predict_fn=model_predict, num_features=5)
    lime_runs.append([f for f, w in exp.as_list()])

# Check consistency (features should appear in all runs)
top_features = lime_runs[0]
consistency = sum(1 for feature in top_features if all(feature in run for run in lime_runs)) / len(top_features)
print(f"LIME stability: {consistency:.0%}")
```

### Surrogate Fidelity
```python
# Compare surrogate to hybrid model on test set
y_pred_hybrid = np.array([model_predict(df_test[feature_cols].iloc[i:i+1]) for i in range(len(df_test))])
y_pred_surrogate = surrogate.predict(df_test[feature_cols])
fidelity = 1 - mean_absolute_percentage_error(y_pred_hybrid, y_pred_surrogate)
print(f"Surrogate Tree Fidelity: {fidelity:.2%}")
assert fidelity > 0.90, f"Fidelity too low ({fidelity:.2%}); increase max_depth"
```

### Apriori Rule Sensibility
```python
# Check that discovered rules make intuitive sense
print("Top 10 Association Rules (by Lift):")
top_rules = rules.sort_values('lift', ascending=False).head(10)
for idx, rule in top_rules.iterrows():
    antecedent = ', '.join(rule['antecedents'])
    consequent = ', '.join(rule['consequents'])
    lift = rule['lift']
    print(f"  {antecedent} → {consequent} (lift: {lift:.2f}x)")
```

---

## 5. Visualization Examples

### SHAP Waterfall Plot
```python
import shap

shap.plots.waterfall(shap_explainer(sample)[0])
plt.title(f"SHAP Explanation: ${predictions[idx]:,.0f}")
plt.savefig(f'artifacts/shap_waterfall_{idx}.png', dpi=150, bbox_inches='tight')
plt.show()
```

### LIME Explanation UI
```python
# LIME generates HTML explanation (use in Jupyter)
exp.show_in_notebook()
```

### Feature Importance Bar Plot
```python
importances = pd.DataFrame({
    'feature': feature_cols,
    'importance': surrogate.feature_importances_
}).sort_values('importance', ascending=False).head(10)

plt.figure(figsize=(10, 6))
plt.barh(importances['feature'], importances['importance'])
plt.xlabel('Importance (Surrogate Tree)')
plt.title('Top 10 Features for HDB Price Prediction')
plt.tight_layout()
plt.savefig('artifacts/feature_importance.png', dpi=150, bbox_inches='tight')
plt.show()
```

---

## 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| SHAP explainer OOM on large dataset | Use `shap.sample()` or reduce background data to 1k rows |
| LIME rules don't match intuition | Increase `num_features`; check that local neighbourhood is representative |
| Surrogate fidelity < 90% | Increase `max_depth` (trade-off: interpretability vs accuracy) |
| Apriori rules too many | Increase `min_support` threshold; focus on high-lift rules |
| CBR comparables are dissimilar | Add feature weighting; use domain knowledge to exclude irrelevant features |
| Pickle load error | Check file is not corrupted; verify Python version match |

---

## 7. See Also

- [XAI Layer README](../../04_xai_layer/) — Architecture details
- [Feature Labels](../../04_xai_layer/feature_labels.py) — Human-readable explanations
- [ML Layer](../../03_ml_layer_hybrid/) — Model to explain
- [SHAP Documentation](https://shap.readthedocs.io/) — Official SHAP guide
- [LIME Documentation](https://github.com/marcotcr/lime) — Official LIME guide
- [Workspace Instructions](../../.github/copilot-instructions.md) — General conventions
