#!/bin/bash
#
# Standard SDK Entrypoint
#
# Runs the SDK-based standard executor for single-task execution.
# This provides Epic-level functionality (inline review/deploy/improve) for standard tasks.
#

set -e

echo "============================================================"
echo "STANDARD SDK EXECUTOR"
echo "============================================================"

# Validate required environment variables
if [ -z "$TASK_ID" ]; then
    echo "ERROR: TASK_ID is required"
    exit 1
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: ANTHROPIC_API_KEY is required"
    exit 1
fi

# Log startup info
echo "Task ID: ${TASK_ID}"
echo "Persona: ${WORKER_PERSONA:-backend_developer}"
echo "Model: ${WORKER_MODEL:-sonnet}"
echo "Target Repo: ${TARGET_REPO:-bitbucket.org/oncallshift/oncallshift-api}"

# Set defaults
export WORKER_PERSONA="${WORKER_PERSONA:-backend_developer}"
export WORKER_MODEL="${WORKER_MODEL:-sonnet}"

# Run the standard SDK executor
cd /app/standard
exec node dist/index.js
