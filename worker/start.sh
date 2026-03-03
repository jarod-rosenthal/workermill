***REMOVED***!/bin/bash
***REMOVED*** WorkerMill Worker Start Script
***REMOVED*** Routes to the appropriate entrypoint based on environment variables

***REMOVED*** Fix Docker socket permissions if mounted.
***REMOVED*** The socket may be owned by a host-specific GID (e.g. 989, 999, 998) that
***REMOVED*** doesn't match any group inside the container. sudo chmod makes it accessible
***REMOVED*** to the worker user regardless of the host's docker GID.
if [ -S /var/run/docker.sock ]; then
    sudo chmod 666 /var/run/docker.sock 2>/dev/null && \
        echo "[Worker] Docker socket permissions fixed" || \
        echo "[Worker] Warning: Could not fix Docker socket permissions"
fi

***REMOVED*** Check for Warm Pool mode FIRST (before any other checks)
***REMOVED*** Warm containers wait for task assignment, then re-run start.sh with task env vars
if [ "${WARM_POOL_MODE}" = "true" ]; then
    echo "[Worker] WARM_POOL_MODE=true - Starting warm container wait loop..."
    exec /app/warm-wait.sh
fi

***REMOVED*** Pass 1: detect tools needed from env vars (before repo clone)
/app/install-tools.sh

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
