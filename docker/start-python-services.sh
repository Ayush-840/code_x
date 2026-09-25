#!/bin/bash
set -e

echo "[python-all] Starting all Python services..."

# Analysis service on 8100
uvicorn analysis.main:app --host 0.0.0.0 --app-dir /app/packages/analysis/src --port 8100 &
echo "[python-all] analysis -> :8100"

# Retrieval service on 8200
uvicorn retrieval.main:app --host 0.0.0.0 --app-dir /app/packages/retrieval/src --port 8200 &
echo "[python-all] retrieval -> :8200"

# Generation service on 8300
uvicorn generation.main:app --host 0.0.0.0 --app-dir /app/packages/generation/src --port 8300 &
echo "[python-all] generation -> :8300"

# Mock Interview service on 8400
uvicorn mock_interview.main:app --host 0.0.0.0 --app-dir /app/packages/mock-interview/src --port 8400 &
echo "[python-all] mock-interview -> :8400"

# CodeGraph service on 8500 (repo-keyed graph store + LLM explain/chat)
uvicorn codegraph_api.main:app --host 0.0.0.0 --app-dir /app/packages/codegraph-api/src --port 8500 &
echo "[python-all] codegraph -> :8500"

echo "[python-all] All 5 services started. Waiting..."
wait
