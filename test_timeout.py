#!/usr/bin/env python3
"""
Quick test of model loading with timeout
"""
import sys
from pathlib import Path

# Add paths
HERE = Path.cwd()
REPO_ROOT = HERE if (HERE / 'hf_data').exists() else HERE.parent
LAYER_ROOT = REPO_ROOT / '05_photo_layer'

if str(LAYER_ROOT) not in sys.path:
    sys.path.insert(0, str(LAYER_ROOT))

from yc_photo_condition import load_condition_model

print("Testing model loading with 5-second timeout...")
try:
    model = load_condition_model(timeout_seconds=5)
    print("SUCCESS: Model loaded!")
except TimeoutError as e:
    print(f"TIMEOUT: {e}")
except Exception as e:
    print(f"ERROR: {e}")