# Code Changes Summary - Approach 4 Redesign

## Cell 7: Tree Feature Extraction

### BEFORE (v1 - Failed):
```python
xgb_encoder = XGBRegressor(n_estimators=200, max_depth=8, ...)
xgb_encoder.fit(X_train_full, y_train, ...)

# 2-D features only
def get_tree_features(...):
    train_pred = model.predict(X_train)
    test_pred = model.predict(X_test)
    train_resid = y_train - train_pred
    test_resid = y_test - test_pred
    X_train_tree = np.column_stack([train_pred, train_resid])
    # Shape: (N, 2)
```

### AFTER (v2 - Redesigned):
```python
# Random Forest ensemble (2 models)
tree_encoder = RandomForestRegressor(n_estimators=100, max_depth=10, ...)
tree_encoder.fit(X_train_full, y_train)

extra_encoder = ExtraTreesRegressor(n_estimators=100, max_depth=10, ...)
extra_encoder.fit(X_train_full, y_train)

# 8-D rich features
def get_enhanced_tree_features(rf_model, et_model, X_train, y_train, X_test, y_test):
    # Extract: pred, resid, pred_mean, agreement, trend, volatility
    X_train_tree = np.column_stack([
        rf_train_pred,      # Feature 1
        et_train_pred,      # Feature 2
        rf_train_resid,     # Feature 3
        et_train_resid,     # Feature 4
        mean_train_pred,    # Feature 5
        agreement_train,    # Feature 6
        trend_train,        # Feature 7
        volatility_train    # Feature 8
    ])
    # Shape: (N, 8)
```

**Changes**: 1 model → 2 models, 2-D → 8-D features

---

## Cell 9: NN Builders

### BEFORE (v1):
```python
# Continuous pathway: basic
x_cont = layers.Dense(128, activation='relu', kernel_regularizer=l2(1e-5))(nn_input_continuous)
x_cont = layers.BatchNormalization()(x_cont)
x_cont = layers.Dropout(0.3)(x_cont)
x_cont = layers.Dense(64, activation='relu', kernel_regularizer=l2(1e-5))(x_cont)
x_cont = layers.BatchNormalization()(x_cont)
x_cont = layers.Dropout(0.3)(x_cont)  # ← Same dropout
x_cont = layers.Dense(32, activation='relu', kernel_regularizer=l2(1e-5))(x_cont)

# Categorical pathway: simple
n_unique = int(X_train_categorical[:, i].max()) + 1
embedding_dim = min(8, max(2, n_unique // 2))  # Small embeddings
cat_embedding = layers.Embedding(input_dim=n_unique, output_dim=embedding_dim, ...)(...)
# Only 1 dense layer after embedding
```

### AFTER (v2):
```python
# Continuous pathway: stronger
x_cont = layers.Dense(128, activation='relu', 
                     kernel_regularizer=l2(1e-4),  # ← 10x stronger
                     bias_regularizer=l2(1e-4))(nn_input_continuous)
x_cont = layers.BatchNormalization()(x_cont)
x_cont = layers.Dropout(0.4)(x_cont)  # ← Increased dropout
x_cont = layers.Dense(64, activation='relu', kernel_regularizer=l2(1e-4), ...)(x_cont)
x_cont = layers.BatchNormalization()(x_cont)
x_cont = layers.Dropout(0.4)(x_cont)  # ← Increased dropout
x_cont = layers.Dense(32, activation='relu', kernel_regularizer=l2(1e-4))(x_cont)
x_cont = layers.BatchNormalization()(x_cont)
x_cont = layers.Dropout(0.3)(x_cont)

# Categorical pathway: deeper & stronger
embedding_dim = min(12, max(4, n_unique // 4))  # ← Larger embeddings
cat_embedding = layers.Embedding(input_dim=n_unique, output_dim=embedding_dim,
                                 embeddings_regularizer=l2(1e-4), ...)(...)
cat_embedding = layers.Flatten()(cat_embedding)
# Now add ADDITIONAL processing layer
x_cat = layers.Dense(64, activation='relu', kernel_regularizer=l2(1e-4))(x_cat)
x_cat = layers.BatchNormalization()(x_cat)
x_cat = layers.Dropout(0.4)(x_cat)
x_cat = layers.Dense(32, activation='relu', kernel_regularizer=l2(1e-4))(x_cat)
x_cat = layers.BatchNormalization()(x_cat)
x_cat = layers.Dropout(0.3)(x_cat)
```

**Changes**: L2 reg 1e-5→1e-4, dropout 0.3→0.4, cat pathway 1 layer→2 layers

---

## Cell 11: Fusion Architecture

### BEFORE (v1):
```python
# Tree pathway: weak
tree_input = keras.Input(shape=(2,), name='tree_input')  # 2-D input
tree_projected = layers.Dense(16, activation='relu', kernel_regularizer=l2(1e-5))(tree_input)
tree_projected = layers.BatchNormalization()(tree_projected)
# Only 16-D output from tree!

# Fusion: Simple concatenation
components_to_concat = [tree_projected, nn_continuous_output, nn_categorical_output]
fusion_input = layers.Concatenate()(components_to_concat)  # Just concat, no weighting

# Refinement: basic
x_fusion = layers.Dense(64, activation='relu', kernel_regularizer=l2(1e-5))(fusion_input)
x_fusion = layers.BatchNormalization()(x_fusion)
x_fusion = layers.Dropout(0.2)(x_fusion)  # Light dropout
x_fusion = layers.Dense(32, activation='relu', kernel_regularizer=l2(1e-5))(x_fusion)
x_fusion = layers.BatchNormalization()(x_fusion)
x_fusion = layers.Dropout(0.1)(x_fusion)
```

### AFTER (v2):
```python
# Tree pathway: upgraded
tree_input = keras.Input(shape=(8,), name='tree_input')  # 8-D input
tree_encoded = layers.Dense(64, activation='relu', kernel_regularizer=l2(1e-4))(tree_input)
tree_encoded = layers.BatchNormalization()(tree_encoded)
tree_encoded = layers.Dropout(0.3)(tree_encoded)
tree_encoded = layers.Dense(32, activation='relu', kernel_regularizer=l2(1e-4))(tree_encoded)
tree_encoded = layers.BatchNormalization()(tree_encoded)
tree_output = layers.Dropout(0.2)(tree_encoded)  # 32-D output from tree

# Fusion: Learned gating mechanism
all_components = layers.Concatenate()(components_to_combine)
gate_input = all_components
gate = layers.Dense(3 * 8, activation='relu', kernel_regularizer=l2(1e-4))(gate_input)
gate = layers.BatchNormalization()(gate)
gate = layers.Dropout(0.2)(gate)
gate_weights = layers.Dense(3, activation='softmax', name='pathway_gates')(gate)  # Learns weights!

# Apply gating: scale each component
gate_tree = layers.Lambda(lambda x: x[:, 0:1])(gate_weights)
scaled_tree = layers.Multiply()([tree_output, gate_tree])  # Component × weight
# ... same for continuous and categorical ...

gated_combined = layers.Concatenate()([scaled_tree, scaled_cont, scaled_cat])

# Refinement: stronger
x_fusion = layers.Dense(96, activation='relu', kernel_regularizer=l2(1e-4))(gated_combined)
x_fusion = layers.BatchNormalization()(x_fusion)
x_fusion = layers.Dropout(0.3)(x_fusion)  # ← Stronger dropout
x_fusion = layers.Dense(48, activation='relu', kernel_regularizer=l2(1e-4))(x_fusion)
x_fusion = layers.BatchNormalization()(x_fusion)
x_fusion = layers.Dropout(0.2)(x_fusion)
x_fusion = layers.Dense(24, activation='relu', kernel_regularizer=l2(1e-4))(x_fusion)
x_fusion = layers.Dropout(0.1)(x_fusion)
```

**Changes**: 2D→8D tree input, concat→gating fusion, 16D→64D→32D tree pathway, stronger refinement

---

## Cell 13: Training

### BEFORE (v1):
```python
# No validation split - validation used test set!
train_data = [X_train_tree_np, X_train_continuous_scaled_np, X_train_categorical_np]
test_data = [X_test_tree_np, X_test_continuous_scaled_np, X_test_categorical_np]

early_stopping = callbacks.EarlyStopping(
    monitor='val_loss',
    patience=15,  # ← Short patience
    verbose=1,
    restore_best_weights=True,
    min_delta=100
)

history = model.fit(
    train_data,
    y_train,
    batch_size=128,  # ← Large batch
    epochs=200,      # ← Short max
    validation_data=(test_data, y_test),  # ← USING TEST SET FOR VALIDATION!
    callbacks=[early_stopping, reduce_lr, checkpoint],
    verbose=1
)
```

### AFTER (v2):
```python
# Proper train/val/test split
from sklearn.model_selection import train_test_split
indices = np.arange(len(X_train_tree_np))
train_idx, val_idx = train_test_split(indices, test_size=0.2, random_state=SEED)

X_train_tree_final = X_train_tree_np[train_idx]
X_val_tree = X_train_tree_np[val_idx]
y_train_final = y_train[train_idx]
y_val = y_train[val_idx]

train_data = [X_train_tree_final, X_train_continuous_final, X_train_categorical_final]
val_data = [X_val_tree, X_val_continuous, X_val_categorical]
test_data = [X_test_tree_np, X_test_continuous_scaled_np, X_test_categorical_np]

early_stopping = callbacks.EarlyStopping(
    monitor='val_loss',
    patience=20,      # ← Longer patience
    verbose=1,
    restore_best_weights=True,
    min_delta=500     # ← Higher min delta (SGD)
)

reduce_lr = callbacks.ReduceLROnPlateau(
    monitor='val_loss',
    factor=0.5,
    patience=8,       # ← Better configured
    verbose=1,
    min_lr=0.00001,
    cooldown=2        # ← Added cooldown
)

history = model.fit(
    train_data,
    y_train_final,
    batch_size=64,    # ← Smaller batch → better gradients
    epochs=300,       # ← Longer max (early stop will limit)
    validation_data=(val_data, y_val),  # ← TRUE VALIDATION SET
    callbacks=[early_stopping, reduce_lr, checkpoint],
    verbose=1
)
```

**Changes**: Added train/val split, batch 128→64, epochs 200→300, patience 15→20, min_delta 100→500

---

## Optimizer Changes

### BEFORE:
```python
model.compile(
    optimizer=Adam(learning_rate=0.001),  # ← Fixed, higher rate
    loss='mae',
    metrics=['mae', 'mse']
)
```

### AFTER:
```python
model.compile(
    optimizer=Adam(learning_rate=0.0005,  # ← Lower rate for finer tuning
                   beta_1=0.9,
                   beta_2=0.999,
                   clipnorm=1.0),          # ← Gradient clipping
    loss='mae',
    metrics=['mae', 'mse']
)
```

**Changes**: LR 0.001→0.0005, added explicit betas, added gradient clipping

---

## Summary of Changes

| Aspect | v1 | v2 | Reason |
|--------|-----|-----|--------|
| Tree model | 1 XGBoost | 2 (RF + ET) | Diversity |
| Tree features | 2-D | 8-D | More info |
| Tree pathway depth | Weak | Strong (8→32) | Better encoding |
| L2 regularization | 1e-5 | 1e-4 | Prevent overfitting |
| Max dropout | 0.3 | 0.4 | Stronger regularization |
| Fusion | Concat | Gating | Learned weighting |
| Validation | Test set | True val split | Fix leakage |
| Batch size | 128 | 64 | Better gradients |
| Learning rate | 0.001 | 0.0005 | Finer tuning |
| Gradient clipping | None | 1.0 | Stable training |

All changes address specific failure modes from v1 while maintaining simplicity and interpretability.
