"""
Train a normalised XGBoost model that predicts price_ratio instead of raw price.

price_ratio = resale_price / national_median_that_year

This makes the model learn relative flat value (consistent across eras)
rather than absolute price (which changed ~10x from 1990 to 2026).

Usage:
    python backend/train_normalised_model.py

Outputs:
    data/processed/xgb_normalised_model.joblib
    data/processed/normalised_model_meta.json
"""

from pathlib import Path
import json

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split


DATA_PATH = Path("data/processed/hdb_features.parquet")
FULL_MODEL_PATH = Path("data/processed/xgb_model.joblib")
NORM_MODEL_PATH = Path("data/processed/xgb_normalised_model.joblib")
FEATURE_COLS_PATH = Path("data/processed/feature_columns.json")
META_PATH = Path("data/processed/normalised_model_meta.json")


def train():
    print("Loading data...")
    df = pd.read_parquet(DATA_PATH)
    with open(FEATURE_COLS_PATH) as f:
        feature_cols = json.load(f)

    # Compute national median by year directly from training data
    national_median_by_year = (
        df.groupby("year")["resale_price"]
        .median()
        .round()
        .astype(int)
        .to_dict()
    )

    # Create normalised target
    df["national_median"] = df["year"].map(national_median_by_year)
    df = df[df["national_median"].notna()].copy()
    df["price_ratio"] = df["resale_price"] / df["national_median"]

    print(
        f"Dataset: {len(df):,} rows, years {df['year'].min()}–{df['year'].max()}"
    )
    print("Price ratio stats:")
    print(f"  Mean:   {df['price_ratio'].mean():.3f}")
    print(f"  Median: {df['price_ratio'].median():.3f}")
    print(f"  Std:    {df['price_ratio'].std():.3f}")
    print(f"  Min:    {df['price_ratio'].min():.3f}")
    print(f"  Max:    {df['price_ratio'].max():.3f}")

    X = df[feature_cols]
    y = df["price_ratio"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, shuffle=True
    )

    print(
        f"\nTraining on {len(X_train):,} rows, testing on {len(X_test):,} rows"
    )

    model = XGBRegressor(
        n_estimators=600,
        max_depth=7,
        learning_rate=0.04,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=3,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        n_jobs=-1,
        tree_method="hist",
        early_stopping_rounds=50,
    )

    model.fit(
        X_train,
        y_train,
        eval_set=[(X_test, y_test)],
        verbose=100,
    )

    # Evaluate on ratio
    y_pred_ratio = model.predict(X_test)
    ratio_rmse = float(np.sqrt(mean_squared_error(y_test, y_pred_ratio)))
    ratio_r2 = float(r2_score(y_test, y_pred_ratio))

    # Convert back to price for interpretable RMSE
    test_years = df.loc[X_test.index, "year"]
    test_medians = test_years.map(national_median_by_year)
    y_test_price = df.loc[X_test.index, "resale_price"]
    y_pred_price = y_pred_ratio * test_medians

    price_rmse = float(np.sqrt(mean_squared_error(y_test_price, y_pred_price)))
    price_r2 = float(r2_score(y_test_price, y_pred_price))

    print("\n=== Normalised Model Results ===")
    print(f"  Ratio R²:    {ratio_r2:.4f}")
    print(f"  Ratio RMSE:  {ratio_rmse:.4f}")
    print(f"  Price R²:    {price_r2:.4f}")
    print(f"  Price RMSE:  ${price_rmse:,.0f}")

    # Compare with original full model on the same test set
    full_model = joblib.load(FULL_MODEL_PATH)
    y_pred_full = full_model.predict(X_test)
    full_rmse = float(
        np.sqrt(mean_squared_error(y_test_price, y_pred_full))
    )
    full_r2 = float(r2_score(y_test_price, y_pred_full))

    print("\n=== Original Full Model (same test set) ===")
    print(f"  Price R²:    {full_r2:.4f}")
    print(f"  Price RMSE:  ${full_rmse:,.0f}")

    print("\n=== Improvement (normalised vs full) ===")
    print(f"  RMSE: {full_rmse - price_rmse:+,.0f} (positive = normalised better)")
    print(f"  R²:   {price_r2 - full_r2:+.4f}")

    # Evaluate specifically on post-2022 data (problem zone)
    post2022_mask = test_years >= 2022
    if post2022_mask.sum() > 0:
        y_test_recent = y_test_price[post2022_mask]
        y_pred_norm_recent = y_pred_price[post2022_mask]
        y_pred_full_recent = y_pred_full[post2022_mask.values]

        norm_rmse_recent = float(
            np.sqrt(mean_squared_error(y_test_recent, y_pred_norm_recent))
        )
        full_rmse_recent = float(
            np.sqrt(mean_squared_error(y_test_recent, y_pred_full_recent))
        )

        print(
            f"\n=== Post-2022 only ({post2022_mask.sum()} samples) ==="
        )
        print(f"  Normalised RMSE: ${norm_rmse_recent:,.0f}")
        print(f"  Full model RMSE: ${full_rmse_recent:,.0f}")
        print(f"  Improvement:     ${full_rmse_recent - norm_rmse_recent:+,.0f}")

    # Save model and meta
    joblib.dump(model, NORM_MODEL_PATH)
    meta = {
        "model_type": "normalised_xgboost",
        "target": "price_ratio",
        "description": (
            "Predicts price/national_median ratio. Multiply output by current "
            "national median to get price."
        ),
        "price_r2": round(price_r2, 4),
        "price_rmse": round(price_rmse),
        "ratio_r2": round(ratio_r2, 4),
        "national_median_by_year": {
            str(k): int(v) for k, v in national_median_by_year.items()
        },
        "training_rows": int(len(X_train)),
        "year_range": f"{int(df['year'].min())}–{int(df['year'].max())}",
    }
    with open(META_PATH, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nSaved model → {NORM_MODEL_PATH}")
    print(f"Saved meta  → {META_PATH}")
    return model


if __name__ == "__main__":
    train()

