#!/bin/sh
set -e

echo "[start] Waiting for database to be ready..."
# Wait for database to be ready with retries
MAX_RETRIES=30
RETRY=0
until ./node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        echo "[start] Database migration failed after $MAX_RETRIES attempts"
        exit 1
    fi
    echo "[start] Database not ready, waiting 2 seconds... (attempt $RETRY/$MAX_RETRIES)"
    sleep 2
done

echo "[start] Database migrations completed successfully"

echo "[start] Starting API + Worker combined..."

# Start the API server in background
node apps/api/dist/apps/api/src/index.js &
API_PID=$!
echo "[start] API started (PID: $API_PID)"

# Start the Worker in background
node apps/worker/dist/index.js &
WORKER_PID=$!
echo "[start] Worker started (PID: $WORKER_PID)"

# Wait for both
wait $API_PID $WORKER_PID