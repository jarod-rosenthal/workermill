#!/bin/bash
# WorkerMill Worker Start Script
# Routes to the appropriate entrypoint based on environment variables

# Check for Epic mode (multi-agent collaboration with Claude CLI)
if [ "${EPIC_MODE}" = "true" ]; then
    echo "[Worker] EPIC_MODE=true - Starting Epic executor..."
    exec /app/epic-entrypoint.sh
fi

# Check for Multi-Expert mode (multi-agent collaboration with AI SDK)
if [ "${MULTI_EXPERT_MODE}" = "true" ]; then
    echo "[Worker] MULTI_EXPERT_MODE=true - Starting Multi-Expert executor..."
    exec /app/multi-expert-entrypoint.sh
fi

# Default: Regular worker entrypoint
exec /app/entrypoint.sh
