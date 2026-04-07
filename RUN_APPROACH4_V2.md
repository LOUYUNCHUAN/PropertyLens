# Next Steps: Running Approach 4 v2

## 🎯 Quick Action Plan

### Step 1: Verify Changes
The following cells have been updated in the notebook:
- ✅ Cell 7 (Tree extraction): Random Forest + 8-D features  
- ✅ Cell 9 (NN builders): Deeper, stronger regularization
- ✅ Cell 11 (Fusion): Gating mechanism
- ✅ Cell 13 (Training): Train/val/test split

### Step 2: Run the Notebook
```bash
# Option A: Run in Jupyter
1. Open the notebook in Jupyter
2. Select Kernel → Restart
3. Click "Run All" (or run cells 3→18 sequentially)
4. Wait for training to complete (~10-15 minutes)

# Option B: Run individual cells (safer)
1. Restart notebook kernel
2. Run Cell 3 (Setup)
3. Run Cell 5 (Data loading)
4. Run Cell 7 (Tree features - NEW)
5. Run Cell 9 (NN builders - UPDATED)
6. Run Cell 11 (Fusion - UPDATED)
7. Run Cell 13 (Training - UPDATED)
8. Run Cells 15-23 (Evaluation)
```

### Step 3: Monitor Training
Watch for these indicators during Cell 13 execution:

**Good signs** ✓:
- Training loss decreases smoothly
- Validation loss tracks training loss (not diverging)
- No NaN or Inf values
- Early stopping triggered around 50-100 epochs
- Final val_loss improvement from initial val_loss

**Bad signs** ✗:
- Validation loss immediately diverges
- Training loss plateaus early
- Frequent NaN warnings
- Loss spikes or oscillations
- Early stopping at epoch 5-10

### Step 4: Check Results
After training completes (Cell 13):

1. **Review Cell 15 output** (Evaluation):
   - Primary metric: **Test MAPE**
   - Target: < 12.09% (match Approach 1 baseline)
   - Success: < 11% improvement

2. **Review Cell 17 output** (Comparison):
   - Compare MAPE, MAE, RMSE, R² with Approach 1
   - Check residual distribution plots
   - Check MAPE by price segment

3. **Review saved visualizations**:
   - `approach4_outputs/hybrid_model_training_performance_*.png`
   - `approach4_outputs/approach_comparison_*.png`

### Step 5: Interpret Results

| Test MAPE Result | Interpretation | Action |
|-----------------|-----------------|--------|
| < 10% | 🎉 Excellent improvement | Deploy to production |
| 10-11% | ✅ Good improvement | Consider ensemble with Approach 1 |
| 11-12% | ≈ Comparable to baseline | Needs hyperparameter tuning |
| 12-13% | ⚠️ Marginal improvement | Try Approach 4 v3 or alternative |
| > 13% | ✗ Worse than baseline | Debug or restart design |

### Step 6: Troubleshooting

If training fails or metrics are poor:

**Issue: Early stopping at epoch 1-5**
- Solution: Check that validation data shape is correct
- Run: `print(val_data[0].shape, y_val.shape)` in Cell 13

**Issue: NaN loss values**
- Solution: Gradient clipping might be too aggressive
- Try: Increasing clipnorm from 1.0 to 5.0

**Issue: Very high MAPE (>50%)**
- Solution: Check tree features are calculated correctly
- Verify: 8-D shape from `X_train_tree_np`

**Issue: Validation loss keeps increasing**
- Solution: Reduce learning rate or increase dropout
- Try: Changing LR from 0.0005 to 0.0002

---

## 📊 Performance Baselines for Comparison

### Approach 1 (Current Baseline)
- MAPE: **12.09%**
- MAE: **$72,344**
- RMSE: **$98,790**
- R²: **0.7377**

### Approach 4 v1 (Failed)
- MAPE: **66.87%** ← Why we redesigned
- MAE: **$427,573**
- RMSE: **$468,773**
- R²: **-4.9064** ← Worse than mean!

### Approach 4 v2 (Expected)
- MAPE: **~10-11%** ← Target is 1-3% improvement
- MAE: **~$65-75K** ← Similar or better
- RMSE: **~$90-100K** ← Similar or better
- R²: **~0.72-0.75** ← Stable or improved

---

## 📝 Detailed Debugging Guide

### Problem: Model Training is Very Slow
```python
# Check in Cell 13:
# If batch_size=64 seems slow, try:
batch_size=128  # temporary increase
# But keep validation split to catch overfitting
```

### Problem: MAPE is Still High After Training
```python
# In Cell 15, check:
print(f"Mean residual: ${residuals_hybrid.mean():.0f}")
print(f"Std residual: ${residuals_hybrid.std():.0f}")
print(f"Prediction range: ${y_pred_hybrid.min():.0f} to ${y_pred_hybrid.max():.0f}")
print(f"Actual range: ${y_test.min():.0f} to ${y_test.max():.0f}")

# Common issues:
# - Mean residual >> 0: Model systematically underestimates
# - Std > actual std: Predictions too spread out
# - Prediction range < actual range: Model not capturing full range
```

### Problem: Validation Loss Diverges from Training
```python
# Check in Cell 13 before training:
print(f"Train/val loss ratio should be < 1.5")
print(f"If > 2.0, increase dropout or L2 regularization")
print(f"Current settings:")
print(f"  - Dropout: 0.4, 0.4, 0.3")
print(f"  - L2: 1e-4")
# If diverging severely, try:
# - Dropout: 0.5, 0.5, 0.4
# - L2: 5e-4
```

---

## 🚀 Advanced Tuning (If Needed)

After first run, if results are suboptimal:

### To Reduce Overfitting:
1. Increase dropout: 0.4 → 0.5 in Cell 9
2. Increase L2: 1e-4 → 5e-4 in Cell 9 & 11
3. Reduce batch size: 64 → 32 in Cell 13
4. Increase early stopping patience: 20 → 30 in Cell 13 (wait longer for real improvement)

### To Improve Convergence:
1. Increase learning rate: 0.0005 → 0.001 in Cell 13
2. Reduce dropout: 0.4 → 0.3 in Cell 9
3. Reduce L2: 1e-4 → 5e-5 in Cell 9 & 11
4. Use larger batch: 64 → 128 in Cell 13

### To Improve Test Performance:
1. Ensemble Approach 1 + Approach 4 with learned weights
2. Use seed 42 or 2026 for reproducibility
3. Train longer: increase max_epochs to 500 in Cell 13

---

## 📋 Checklist

Before running:
- [ ] Notebook is open in Jupyter Lab/Notebook
- [ ] Python environment is activated (nus venv)
- [ ] GPU is available (optional but faster)

After running:
- [ ] Cell 13 completes without errors
- [ ] Cell 15 shows test metrics
- [ ] Cell 17 shows comparison with Approach 1
- [ ] Visualizations are saved to `approach4_outputs/`

Final verification:
- [ ] Test MAPE is printed in Cell 15
- [ ] Comparison table is printed in Cell 17
- [ ] All output files exist in `approach4_outputs/`
- [ ] Git has been committed with new results

---

## 📞 Support

If you encounter issues:

1. **Check the error message** in the notebook
2. **Review the cell code** against APPROACH4_CODE_CHANGES.md
3. **Check data shapes** with print statements
4. **Look for NaN/Inf** in intermediate outputs
5. **Try resetting kernel** and running from Cell 3

For detailed analysis:
- See: APPROACH4_REDESIGN_SUMMARY.md
- See: APPROACH4_CODE_CHANGES.md
- See: Memory files in `/memories/session/`

---

**Ready to run? Execute Cell 3 next →**
