#!/bin/bash
set -e

# Epic Executor Entry Point
# This script is called when EPIC_MODE=true
# It runs the multi-agent collaboration using Agent SDK (Claude CLI subprocess)

echo "============================================================"
echo "EPIC EXECUTOR - Multi-Agent Collaboration with Agent SDK"
echo "============================================================"
echo ""
echo "Parent Task ID: ${PARENT_TASK_ID:-not set}"
echo "Target Repo: ${TARGET_REPO:-${GITHUB_REPO:-not set}}"
echo "API Base URL: ${API_BASE_URL:-not set}"
echo ""

# Validate required environment variables
# Note: For non-GitHub SCM providers (BitBucket, GitLab), SCM_TOKEN is used instead of GITHUB_TOKEN
required_vars=("PARENT_TASK_ID" "API_BASE_URL" "ORG_API_KEY" "ANTHROPIC_API_KEY")

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

# SCM token check: GITHUB_TOKEN or SCM_TOKEN must be set
if [ -z "${GITHUB_TOKEN}" ] && [ -z "${SCM_TOKEN}" ]; then
    missing_vars+=("GITHUB_TOKEN or SCM_TOKEN")
fi

# For backwards compatibility, set GITHUB_TOKEN from SCM_TOKEN if not set
if [ -z "${GITHUB_TOKEN}" ] && [ -n "${SCM_TOKEN}" ]; then
    export GITHUB_TOKEN="${SCM_TOKEN}"
fi

# TARGET_REPO can come from either TARGET_REPO or GITHUB_REPO
if [ -z "${TARGET_REPO}" ]; then
    if [ -n "${GITHUB_REPO}" ]; then
        export TARGET_REPO="${GITHUB_REPO}"
    else
        missing_vars+=("TARGET_REPO or GITHUB_REPO")
    fi
fi

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "[Epic] ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

echo "[Epic] All required environment variables set"

# =============================================================================
# Heartbeat Loop - sends heartbeats every 30 seconds to prevent timeout
# =============================================================================
HEARTBEAT_PID=""

send_heartbeat() {
    local payload
    payload=$(cat <<EOF
{
  "taskId": "${PARENT_TASK_ID}",
  "workerId": "${ECS_TASK_ID:-epic-worker}",
  "status": "working",
  "persona": "epic_coordinator"
}
EOF
)
    curl -s --connect-timeout 5 --max-time 10 \
        -X POST "${API_BASE_URL}/api/coordination/heartbeat" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null 2>&1 || true
}

start_heartbeat_loop() {
    (
        while true; do
            sleep 30
            send_heartbeat
        done
    ) &
    HEARTBEAT_PID=$!
    echo "[Epic] Started heartbeat loop (PID: ${HEARTBEAT_PID})"
}

stop_heartbeat_loop() {
    if [ -n "${HEARTBEAT_PID}" ]; then
        kill "${HEARTBEAT_PID}" 2>/dev/null || true
        echo "[Epic] Stopped heartbeat loop"
        HEARTBEAT_PID=""
    fi
}

# Cleanup on exit
cleanup() {
    stop_heartbeat_loop
}
trap cleanup EXIT

# Start heartbeat loop
start_heartbeat_loop

echo "[Epic] Starting Epic executor..."
echo ""

# Run the compiled Epic executor
cd /app/epic
node dist/index.js
EXIT_CODE=$?

# Cleanup
stop_heartbeat_loop
exit $EXIT_CODE
