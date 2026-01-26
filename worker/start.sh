***REMOVED***!/bin/bash
***REMOVED*** WorkerMill Worker Start Script
***REMOVED*** Routes to the appropriate entrypoint based on environment variables

***REMOVED*** Check for Epic mode (multi-agent collaboration with Claude CLI)
if [ "${EPIC_MODE}" = "true" ]; then
    echo "[Worker] EPIC_MODE=true - Starting Epic executor..."
    exec /app/epic-entrypoint.sh
fi

***REMOVED*** Check for Multi-Expert mode (multi-agent collaboration with AI SDK)
if [ "${MULTI_EXPERT_MODE}" = "true" ]; then
    echo "[Worker] MULTI_EXPERT_MODE=true - Starting Multi-Expert executor..."
    exec /app/multi-expert-entrypoint.sh
fi

***REMOVED*** Check for Standard SDK mode (single-task execution with Agent SDK)
***REMOVED*** This provides Epic-level functionality (inline review/deploy/improve) for standard tasks
if [ "${STANDARD_SDK_MODE}" = "true" ]; then
    echo "[Worker] STANDARD_SDK_MODE=true - Starting Standard SDK executor..."
    exec /app/standard-entrypoint.sh
fi

***REMOVED*** Default: Regular worker entrypoint (legacy bash-based execution)
exec /app/entrypoint.sh
