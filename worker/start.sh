#!/bin/bash
# WorkerMill Worker Start Script
# Routes to the appropriate entrypoint based on environment variables

# Check for Warm Pool mode FIRST (before any other checks)
# Warm containers wait for task assignment, then re-run start.sh with task env vars
if [ "${WARM_POOL_MODE}" = "true" ]; then
    echo "[Worker] WARM_POOL_MODE=true - Starting warm container wait loop..."
    exec /app/warm-wait.sh
fi

# Pass 1: detect tools needed from env vars (before repo clone)
/app/install-tools.sh

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

# Check for Standard SDK mode (single-task execution with Agent SDK)
# This provides Epic-level functionality (inline review/deploy/improve) for standard tasks
if [ "${STANDARD_SDK_MODE}" = "true" ]; then
    echo "[Worker] STANDARD_SDK_MODE=true - Starting Standard SDK executor..."
    exec /app/standard-entrypoint.sh
fi

# Default: Regular worker entrypoint (legacy bash-based execution)
exec /app/entrypoint.sh
