***REMOVED***!/bin/bash
set -e

***REMOVED*** Epic Executor Entry Point
***REMOVED*** This script is called when EPIC_MODE=true
***REMOVED*** It runs the multi-agent collaboration using Agent SDK (Claude CLI subprocess)

echo "============================================================"
echo "EPIC EXECUTOR - Multi-Agent Collaboration with Agent SDK"
echo "============================================================"
echo ""
echo "Parent Task ID: ${PARENT_TASK_ID:-not set}"
echo "Target Repo: ${TARGET_REPO:-${GITHUB_REPO:-not set}}"
echo "API Base URL: ${API_BASE_URL:-not set}"
echo ""

***REMOVED*** Validate required environment variables
required_vars=("PARENT_TASK_ID" "API_BASE_URL" "ORG_API_KEY" "ANTHROPIC_API_KEY" "GITHUB_TOKEN")

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

***REMOVED*** TARGET_REPO can come from either TARGET_REPO or GITHUB_REPO
if [ -z "${TARGET_REPO}" ]; then
    if [ -n "${GITHUB_REPO}" ]; then
        export TARGET_REPO="${GITHUB_REPO}"
    else
        missing_vars+=("TARGET_REPO or GITHUB_REPO")
    fi
fi

if [ ${***REMOVED***missing_vars[@]} -ne 0 ]; then
    echo "[Epic] ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

echo "[Epic] All required environment variables set"
echo "[Epic] Starting Epic executor..."
echo ""

***REMOVED*** Run the compiled Epic executor
cd /app/epic
exec node dist/index.js
