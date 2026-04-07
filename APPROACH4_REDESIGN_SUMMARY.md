# Approach 4 Redesign Summary

**Date**: April 4, 2026  
**Status**: ✅ Implementation Complete - Ready for Testing  
**Notebook**: `03_ml_layer/training/hybrid_tree_nn_price_prediction_20260404.ipynb`

---

## Problem with Approach 4 v1 (Failed)

**Test MAPE: 66.87%** (vs Approach 1 baseline: 12.09%)

### Root Causes:
1. **Inadequate tree features**: Only 2-D (prediction + residual)
2. **Severe overfitting**: Val loss diverged sharply from training loss
3. **Weak tree pathway**: 2-D → 16-D insufficient for capturing tree structure
4. **Poor validation**: Using test set for monitoring introduced leakage
5. **Simple fusion**: Just concatenation, no learned mechanism to weight components
6. **Weak regularization**: L2 (1e-5) and dropout (0.3) too mild

---

## Solution: Approach 4 v2 (Redesigned)

### ✅ Major Changes Implemented

#### 1. **Enhanced Tree Feature Extraction (Cell 7)**

**From**: XGBoost only, 2-D features  
**To**: Random Forest + ExtraTrees ensemble, 8-D rich features

```
8 features extracted:
1. RF prediction           5. Mean tree prediction
2. ET prediction          6. Model agreement/confidence
3. RF residual            7. Residual trend (normalized)
4. ET residual            8. Residual volatility (normalized)
```

**Benefits**:
- Captures tree structure diversity (2 models)
- Includes prediction uncertainty (agreement %)
- Normalized trends prevent scale issues
- More information, better learned representations

#### 2. **Deeper NN Pathways with Strong Regularization (Cell 9)**

**Continuous Pathway**:
- 17-D input → 128 → 64 → 32-D output
- Dropout: 0.4 → 0.4 → 0.3 (increased from 0.3 throughout)
- L2 regularization: 1e-4 (increased from 1e-5)
- BatchNorm after each layer

**Categorical Pathway**:
- Higher embedding dims: 4-12 vs 2-8 before
- Structure: Embeddings → 64 → 32-D
- Same strong regularization pattern

#### 3. **Learned Gating-Based Fusion (Cell 11)**

**From**: Simple concatenation  
**To**: Learned importance weights per pathway

```
Gate mechanism:
- Concatenates all 3 pathways (32-D each)
- Gate network: 96-D → 64-D hidden → softmax(3)
- Each pathway scaled by learned weight
- Fusion: 96-D → 48-D → 24-D → 1-D price
```

**Benefits**:
- Model learns which component is most important
- Flexible weighting (can change during training)
- Prevents weak components from hurting predictions

#### 4. **Proper Train/Val/Test Split (Cell 13)**

**From**: 80% train, 0% val, 20% test (used for monitoring)  
**To**: 71% train, 9% val, 10% test (proper holdout)

```
Original data (178.6K train + 82.1K test)
├── Training: 80% × 178.6K = 142.9K
├── Validation: 20% × 178.6K = 35.7K
└── Test: 82.1K (unchanged)
Total: 71% | 9% | 10% effective split
```

**Training improvements**:
- Batch size: 128 → 64 (better gradient estimates)
- Learning rate: 0.001 → 0.0005 (finer tuning)
- Epochs: 200 → 300 (early stopping allows longer training)
- Gradient clipping: clipnorm=1.0
- Early stopping patience: 15 → 20 with min_delta=500 SGD
- Optimizer: Adam with beta_1=0.9, beta_2=0.999

---

## Architecture Comparison

### v1 (Failed) to v2 (Redesigned)

| Component | v1 | v2 | Improvement |
|-----------|-----|-----|-------------|
| **Tree model** | XGBoost (1 model) | RF + ET (2 models) | Diversity |
| **Tree features** | 2-D (pred, resid) | 8-D rich | 4x information |
| **Tree pathway** | 2 → 16 | 8 → 64 → 32 | 8x wider |
| **Cont pathway depth** | 3 layers | 3 layers (same) | Same depth |
| **Cont dropout** | 0.3, 0.3, 0.3 | 0.4, 0.4, 0.3 | Stronger |
| **Cat pathway depth** | 1 layer | 2 layers | Deeper |
| **Fusion mechanism** | Concat | Gating | Learned weights |
| **L2 regularization** | 1e-5 | 1e-4 | 10x stronger |
| **Validation strategy** | Test set | True val split | Better monitoring |
| **Batch size** | 128 | 64 | Better gradients |
| **Learning rate** | 0.001 | 0.0005 | Finer tuning |

---

## Expected Improvements

### Performance Targets
- **Goal**: MAPE < 12.09% (match or beat Approach 1 baseline)
- **Optimistic**: MAPE 9-11% (3-6% improvement over baseline)
- **Conservative**: MAPE 10-13% (comparable to baseline)

### Metrics to Monitor
1. **Training curves**: Should show stable convergence, not divergence
2. **Validation loss**: Should track training loss reasonably well
3. **Test MAPE**: Primary metric (target: < 12.09%)
4. **Residual bias**: Mean residual should be near $0 (not +$400K)
5. **Prediction calibration**: % within ±5% should improve

---

## How to Use

### 1. **Run the Updated Notebook**

The changes are automatically applied to these cells:
- **Cell 7** (#VSC-1406e580): Tree feature extraction
- **Cell 9** (#VSC-f7ed8bc8): NN builder  
- **Cell 11** (#VSC-d97cf29a): Fusion model
- **Cell 13** (#VSC-39e73a0b): Training with val split

Execute all cells in order starting from Cell 3 (or restart kernel and run all).

### 2. **Interpret Results**

After training completes:
- Check training curves (should improve over time)
- Check validation loss trajectory (should not diverge)
- Review test MAPE in Cell 15 (Evaluation)
- Compare with Approach 1 in Cell 17 (Comparison)

### 3. **Next Steps Based on Results**

| Result | Action |
|--------|--------|
| MAPE < 11% | Excellent! Consider production deployment |
| MAPE 11-13% | Good progress. Try fine-tuning hyperparams. |
| MAPE 13-15% | Needs improvement. Adjust architecture. |
| MAPE > 15% | Return to v1 or try different approach. |

---

## Technical Details

### Random Forest Advantages Over XGBoost
- Better for ensemble with ExtraTrees (structural diversity)
- Faster inference (parallel predictions)
- More stable predictions across ranges
- Better feature importance estimates

### Why More Regularization?
- High dropout (0.4) prevents overfitting on small validation set
- Stronger L2 (1e-4) encourages simpler weights
- Both address the diverging validation loss issue

### Why Smaller Batch & Learning Rate?
- Batch 64 vs 128: More frequent gradient updates
- LR 0.0005 vs 0.001: Finer parameter tuning
- Together: Better convergence despite smaller batches

### Why Gating Mechanism?
- Simple concatenation treats all pathways equally
- Gating allows model to learn importance ratios
- Prevents weak pathways from diluting strong ones
- Interpretable: Can examine gate weights to understand component importance

---

## Files Modified

1. **Notebook**: `hybrid_tree_nn_price_prediction_20260404.ipynb`
   - Cell 7: Tree features (8-D from RF+ET)
   - Cell 9: NN pathways (deeper, stronger reg)
   - Cell 11: Fusion (gating mechanism)
   - Cell 13: Training (proper val split)

2. **Outputs**: Saved to `approach4_outputs/` (same as v1)
   - `hybrid_tree_nn_model_*.h5` (Keras model)
   - `hybrid_tree_encoder_*.joblib` (RF+ET models)
   - `hybrid_predictions_*.csv` (Predictions)
   - `approach_comparison_*.csv` (Metrics)

---

## Backward Compatibility

✅ **No changes to Approach 1**
- Approach 1 model files untouched
- Approach 1 notebook untouched
- Data layer unchanged
- Feature layer unchanged
- Outputs isolated in separate `approach4_outputs/` directory

**Both approaches can coexist and be evaluated side-by-side.**

---

## Summary

**Approach 4 v2 is a significant redesign addressing all root causes of v1 failure:**

1. ✅ 8-D tree features (vs 2-D) - 4x more information
2. ✅ Proper train/val/test split - fixes monitoring bias
3. ✅ Stronger regularization - controls overfitting
4. ✅ Gating fusion - learned component weighting
5. ✅ Better hyperparameters - improved convergence

**Expected outcome**: MAPE improvement of 1-3% over baseline, or match baseline if marginal.

**Next action**: Run the notebook and monitor test MAPE in Cell 15 ✓
