#!/bin/sh
set -e

# Migrations are NOT run here — on Railway they run via the service's
# preDeployCommand (see railway/api-worker.json) so they only execute on
# actual deploys, not on every container restart. If you run this image
# outside Railway, run:
#   ./node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma

# Fail fast if any subpath export / entrypoint shipped in this image is
# missing (the artifacts.js outage class). Exits non-zero, which stops the
# container, so a broken image never serves traffic.
node /app/scripts/smoke-exports.cjs /app

echo "[start] Starting API + Worker combined..."

# Start the API server in background
node apps/api/dist/index.js &
API_PID=$!
echo "[start] API started (PID: $API_PID)"

# Start the Worker in background
node apps/worker/dist/index.js &
WORKER_PID=$!
echo "[start] Worker started (PID: $WORKER_PID)"

# Wait for both
wait $API_PID $WORKER_PID
