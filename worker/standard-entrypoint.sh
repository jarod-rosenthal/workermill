***REMOVED***!/bin/bash
***REMOVED***
***REMOVED*** Standard SDK Entrypoint
***REMOVED***
***REMOVED*** Runs the SDK-based standard executor for single-task execution.
***REMOVED*** This provides Epic-level functionality (inline review/deploy/improve) for standard tasks.
***REMOVED***

set -e

echo "============================================================"
echo "STANDARD SDK EXECUTOR"
echo "============================================================"

***REMOVED*** Validate required environment variables
if [ -z "$TASK_ID" ]; then
    echo "ERROR: TASK_ID is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is required"
    exit 1
fi

***REMOVED*** Log startup info
echo "Task ID: ${TASK_ID}"
echo "Persona: ${WORKER_PERSONA:-backend_developer}"
echo "Model: ${WORKER_MODEL:-sonnet}"
echo "Target Repo: ${TARGET_REPO:-bitbucket.org/oncallshift/oncallshift-api}"

***REMOVED*** Set defaults
export WORKER_PERSONA="${WORKER_PERSONA:-backend_developer}"
export WORKER_MODEL="${WORKER_MODEL:-sonnet}"

***REMOVED*** Pass 2: detect and install tools based on repo contents
/app/install-tools.sh "${REPO_DIR:-}"

***REMOVED*** Run the standard SDK executor
cd /app/standard
exec node dist/index.js
