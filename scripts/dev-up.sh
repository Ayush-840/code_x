#!/usr/bin/env bash
# Starts the full Vibe Coder stack:
#   1. Docker infra (Postgres :5433, Redis :6379, OpenSearch :9200)
#   2. Python services (analysis :8100, retrieval :8200, generation :8300, mock-interview :8400)
#   3. Node dev stack  (web :3000, api :4000, websocket :4001, worker)
set -euo pipefail
cd "$(dirname "$0")/.."

# 0. Stop any previous instance of this stack. Repeated dev-up/nohup runs
# otherwise orphan old tsx children that keep ports/queues/heartbeats alive —
# the root cause of EADDRINUSE crashes and "two workers, one paused" bugs.
REPO_ROOT="$(pwd)"
if pgrep -f "$REPO_ROOT" >/dev/null 2>&1; then
  echo "[dev-up] stopping previous stack processes..."
  # -9: tsx watch children ignore SIGTERM (verified), leaving zombies bound
  # to ports 4000/8100/... which is exactly what this cleanup exists to fix.
  pkill -9 -f "$REPO_ROOT" || true
  sleep 2
fi

# 1. Infra — optional: Docker may be off when Postgres/Redis run natively.
if docker info >/dev/null 2>&1; then
  docker compose -f docker/docker-compose.yml up -d
else
  echo "[dev-up] docker daemon not running — skipping infra (expect native postgres/redis)"
fi

# 2. Python venv (created on first run)
if [ ! -x .venv/bin/uvicorn ]; then
  echo "[dev-up] creating .venv and installing python deps..."
  python3 -m venv .venv
  .venv/bin/pip install -q fastapi 'uvicorn[standard]' pydantic rank-bm25 httpx
fi

# 3. Python services (detached, logs in /tmp/<name>.log)
python3 - <<'EOF'
import os, subprocess
SERVICES = [
    ("analysis",       "packages/analysis/src",       "analysis.main:app",       8100),
    ("retrieval",      "packages/retrieval/src",      "retrieval.main:app",      8200),
    ("generation",     "packages/generation/src",     "generation.main:app",     8300),
    ("mock-interview", "packages/mock-interview/src", "mock_interview.main:app", 8400),
]
UVICORN = os.path.abspath(".venv/bin/uvicorn")
for name, appdir, module, port in SERVICES:
    log = open(f"/tmp/{name}.log", "ab", 0)
    pid = os.fork()
    if pid == 0:
        os.setsid()
        subprocess.Popen(
            [UVICORN, module, "--app-dir", os.path.abspath(appdir),
             "--host", "0.0.0.0", "--port", str(port)],
            stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
        os._exit(0)
    os.waitpid(pid, 0)
    print(f"[dev-up] {name} -> :{port}")
EOF

# 4. Node dev stack (web + api + websocket + worker), detached. Daemonized
# (own session) rather than `nohup &` — a background child of this script
# dies with the terminal otherwise.
python3 scripts/daemonize.py /tmp/vibe-dev.log pnpm dev
echo "[dev-up] node stack -> :3000 web, :4000 api, :4001 ws (log: /tmp/vibe-dev.log)"

# 5. Health checks — probe /health on service ports; web (:3000) has no
# /health route, so the root page is the liveness signal there.
echo "[dev-up] waiting for services..."
sleep 8
for port in 3000 4000 4001 8100 8200 8300 8400; do
  path="/health"; [ "$port" = "3000" ] && path="/"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port$path" 2>/dev/null || echo 000)
  echo "  port $port -> HTTP $code"
done

# Guard against port drift: if something else grabbed :3000 before web booted,
# Next.js silently moves to 3001/3002 and the user stares at a dead localhost.
web_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:3000" 2>/dev/null || echo 000)
if [ "$web_code" != "200" ]; then
  echo "[dev-up] WARNING: web is NOT on :3000 (HTTP $web_code)." 
  echo "         Check the log for 'Port 3000 is in use' — an orphaned process" 
  echo "         likely squatted the port (lsof -nP -iTCP:3000)."
fi
echo "[dev-up] done. Open http://localhost:3000"
