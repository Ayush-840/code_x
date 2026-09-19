#!/bin/sh
set -e

echo "[start] Running migrations..."
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma

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