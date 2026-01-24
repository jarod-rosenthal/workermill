#!/bin/bash
# WorkerMill Worker Start Script
# Routes to the appropriate entrypoint based on environment variables

# Check for Epic mode (multi-agent collaboration with Agent SDK)
if [ "${EPIC_MODE}" = "true" ]; then
    echo "[Worker] EPIC_MODE=true - Starting Epic executor..."
    exec /app/epic-entrypoint.sh
fi

# Default: Regular worker entrypoint
exec /app/entrypoint.sh
