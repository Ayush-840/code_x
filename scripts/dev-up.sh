#!/usr/bin/env bash
# Starts the full Vibe Coder stack:
#   1. Docker infra (Postgres :5433, Redis :6379, OpenSearch :9200)
#   2. Python services (analysis :8100, retrieval :8200, generation :8300, mock-interview :8400)
#   3. Node dev stack  (web :3000, api :4000, websocket :4001, worker)
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Infra
docker compose -f docker/docker-compose.yml up -d

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

# 4. Node dev stack (web + api + websocket + worker), detached
nohup pnpm dev > /tmp/vibe-dev.log 2>&1 &
echo "[dev-up] node stack -> :3000 web, :4000 api, :4001 ws (log: /tmp/vibe-dev.log)"

# 5. Health checks
echo "[dev-up] waiting for services..."
sleep 8
for port in 3000 4000 4001 8100 8200 8300 8400; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$port" 2>/dev/null || echo 000)
  echo "  port $port -> HTTP $code"
done
echo "[dev-up] done. Open http://localhost:3000"
