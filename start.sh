#!/usr/bin/env bash
# Quick start: installs deps, downloads models, and runs backend + frontend

set -e
cd "$(dirname "$0")"

echo "==> Setting up Python backend..."
cd backend
python -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q -r requirements.txt

echo "==> Downloading translation models (first run only)..."
python setup_models.py

echo "==> Starting backend on http://localhost:8000 ..."
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

echo "==> Backend running (PID $BACKEND_PID)"
echo ""
echo "======================================="
echo "  Open your browser:"
echo "  http://localhost:8000"
echo "======================================="
echo ""
echo "Press Ctrl+C to stop."

wait $BACKEND_PID
