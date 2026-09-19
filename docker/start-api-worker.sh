#!/bin/sh
set -e

echo "[start] Fixing prisma engine permissions..."
chmod -R u+w /app/node_modules/.pnpm/@prisma+engines@* 2>/dev/null || true

echo "[start] Running migrations..."
./packages/database/node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma

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