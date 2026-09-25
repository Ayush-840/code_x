#!/bin/bash
set -e

echo "[python-all] Boot preflight: compiling all service packages..."
# Import preflight: compile every service package before starting uvicorn. A
# syntax error or missing __init__.py fails the container here, instead of a
# service silently dying after boot while the other four keep serving.
python3 -m compileall -q \
    /app/packages/analysis/src/analysis \
    /app/packages/retrieval/src/retrieval \
    /app/packages/generation/src/generation \
    /app/packages/mock-interview/src/mock_interview \
    /app/packages/codegraph-api/src/codegraph_api \
    /app/packages/codegraph-parser/src/codegraph_parser \
    /app/packages/shared_python/src
echo "[python-all] Preflight OK."

declare -A PIDS=()

echo "[python-all] Starting all Python services..."

# Analysis service on 8100
uvicorn analysis.main:app --host 0.0.0.0 --app-dir /app/packages/analysis/src --port 8100 &
PIDS[analysis]=$!
echo "[python-all] analysis -> :8100 (pid ${PIDS[analysis]})"

# Retrieval service on 8200
uvicorn retrieval.main:app --host 0.0.0.0 --app-dir /app/packages/retrieval/src --port 8200 &
PIDS[retrieval]=$!
echo "[python-all] retrieval -> :8200 (pid ${PIDS[retrieval]})"

# Generation service on 8300
uvicorn generation.main:app --host 0.0.0.0 --app-dir /app/packages/generation/src --port 8300 &
PIDS[generation]=$!
echo "[python-all] generation -> :8300 (pid ${PIDS[generation]})"

# Mock Interview service on 8400
uvicorn mock_interview.main:app --host 0.0.0.0 --app-dir /app/packages/mock-interview/src --port 8400 &
PIDS[mock_interview]=$!
echo "[python-all] mock-interview -> :8400 (pid ${PIDS[mock_interview]})"

# CodeGraph service on 8500 (repo-keyed graph store + LLM explain/chat)
uvicorn codegraph_api.main:app --host 0.0.0.0 --app-dir /app/packages/codegraph-api/src --port 8500 &
PIDS[codegraph]=$!
echo "[python-all] codegraph -> :8500 (pid ${PIDS[codegraph]})"

echo "[python-all] All 5 services started."

# Supervision: if ANY service exits, exit the container so Railway restarts it
# and the failure is visible — instead of one service silently disappearing
# while `wait` keeps the container alive on the remaining ports.
TERM_PID=""
forward_term() {
  TERM_PID="sent"
  kill -TERM "${PIDS[@]}" 2>/dev/null
  exit 0
}
trap forward_term TERM INT

set +e
# bash >= 5.1 (Debian trixie ships 5.2): -p records which job exited.
wait -n -p FAILED_PID
EXIT_CODE=$?
set -e

# Distinguish graceful shutdown (trap fired) from an actual crash.
if [ "$TERM_PID" = "sent" ]; then
  exit 0
fi

SERVICE_NAME="unknown"
for name in "${!PIDS[@]}"; do
  if [ "${PIDS[$name]}" = "$FAILED_PID" ]; then
    SERVICE_NAME="$name"
    break
  fi
done
echo "[python-all] FATAL: service '$SERVICE_NAME' exited with code $EXIT_CODE — stopping container so it restarts clean." >&2
kill -TERM "${PIDS[@]}" 2>/dev/null
exit "$EXIT_CODE"
