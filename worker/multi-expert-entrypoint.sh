***REMOVED***!/bin/bash
set -e

***REMOVED*** Multi-Expert Executor Entry Point
***REMOVED*** This script is called when MULTI_EXPERT_MODE=true

echo "[Multi-Expert] Starting Multi-Provider AI Collaboration"

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
    echo "[Multi-Expert] ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

***REMOVED*** Run the Multi-Expert coordinator
cd /app/multi-expert
exec node dist/index.js
