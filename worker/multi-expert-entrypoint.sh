#!/bin/bash
set -e

# Multi-Expert Executor Entry Point
# This script is called when MULTI_EXPERT_MODE=true

echo "[Multi-Expert] Starting Multi-Provider AI Collaboration"

# Validate required environment variables
required_vars=("PARENT_TASK_ID" "API_BASE_URL" "ORG_API_KEY" "ANTHROPIC_API_KEY" "GITHUB_TOKEN")

missing_vars=()
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        missing_vars+=("$var")
    fi
done

# TARGET_REPO can come from either TARGET_REPO or GITHUB_REPO
if [ -z "${TARGET_REPO}" ]; then
    if [ -n "${GITHUB_REPO}" ]; then
        export TARGET_REPO="${GITHUB_REPO}"
    else
        missing_vars+=("TARGET_REPO or GITHUB_REPO")
    fi
fi

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "[Multi-Expert] ERROR: Missing required environment variables:"
    for var in "${missing_vars[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

echo "[Multi-Expert] All required environment variables set"

# =============================================================================
# Heartbeat Loop - sends heartbeats every 30 seconds to prevent timeout
# =============================================================================
HEARTBEAT_PID=""

send_heartbeat() {
    local payload
    payload=$(cat <<EOF
{
  "taskId": "${PARENT_TASK_ID}",
  "workerId": "${ECS_TASK_ID:-multi-expert-worker}",
  "status": "working",
  "persona": "multi_expert_coordinator"
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
    echo "[Multi-Expert] Started heartbeat loop (PID: ${HEARTBEAT_PID})"
}

stop_heartbeat_loop() {
    if [ -n "${HEARTBEAT_PID}" ]; then
        kill "${HEARTBEAT_PID}" 2>/dev/null || true
        echo "[Multi-Expert] Stopped heartbeat loop"
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

# Pass 2: detect and install tools based on repo contents
/app/install-tools.sh "${REPO_DIR:-}"

echo "[Multi-Expert] Starting Multi-Expert executor..."
echo ""

# Run the Multi-Expert coordinator
cd /app/multi-expert
node dist/index.js
EXIT_CODE=$?

# Cleanup
stop_heartbeat_loop
exit $EXIT_CODE
