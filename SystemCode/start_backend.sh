#!/bin/bash
# Start the PropertyLens backend.
# OMP/BLAS thread caps prevent a macOS deadlock where torch's OpenMP threads
# conflict with uvicorn's thread pool during EfficientNet model loading.
cd "$(dirname "$0")"
exec env OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  .venv/bin/uvicorn backend.main:app --reload --port 8000
