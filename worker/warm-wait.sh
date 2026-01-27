#!/bin/bash
# Warm Container Wait Script
# Polls the API for task assignment, then sources environment variables and re-runs start.sh

set -e

echo "[Warm Pool] Container started in warm pool mode"
echo "[Warm Pool] ECS Task ID: ${ECS_TASK_ID}"
echo "[Warm Pool] API Base URL: ${API_BASE_URL}"

# Register as ready with the API
echo "[Warm Pool] Registering container as ready..."
REGISTER_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/api/warm-pool/ready" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${PLATFORM_API_KEY}" \
    -d "{\"ecsTaskId\": \"${ECS_TASK_ID}\", \"ecsTaskArn\": \"${ECS_TASK_ARN}\"}" || echo '{"error": "failed"}')

echo "[Warm Pool] Register response: ${REGISTER_RESPONSE}"

# Check if registration was successful
if echo "${REGISTER_RESPONSE}" | jq -e '.error' > /dev/null 2>&1; then
    echo "[Warm Pool] ERROR: Failed to register with API"
    exit 1
fi

CONTAINER_ID=$(echo "${REGISTER_RESPONSE}" | jq -r '.containerId // empty')
if [ -z "${CONTAINER_ID}" ]; then
    echo "[Warm Pool] ERROR: No container ID returned from registration"
    exit 1
fi

echo "[Warm Pool] Registered with container ID: ${CONTAINER_ID}"
echo "[Warm Pool] Waiting for task assignment..."

# Poll for assignment (30s long-poll with 35s timeout)
POLL_COUNT=0
MAX_POLLS=720  # 6 hours max wait time (720 * 30s = 6 hours)

while [ ${POLL_COUNT} -lt ${MAX_POLLS} ]; do
    POLL_COUNT=$((POLL_COUNT + 1))

    # Long-poll the API (30s server-side timeout, 35s client timeout)
    RESPONSE=$(curl -s --max-time 35 \
        "${API_BASE_URL}/api/warm-pool/poll/${ECS_TASK_ID}" \
        -H "x-api-key: ${PLATFORM_API_KEY}" \
        2>/dev/null || echo '{"status": "error", "message": "connection failed"}')

    STATUS=$(echo "${RESPONSE}" | jq -r '.status // "waiting"')

    case "${STATUS}" in
        "assigned")
            echo "[Warm Pool] Task assigned! Extracting environment variables..."

            # Extract environment variables and write to a file
            echo "${RESPONSE}" | jq -r '.environment // {} | to_entries[] | "export \(.key)=\"\(.value)\""' > /tmp/task_env.sh

            # Source the environment variables
            set -a
            source /tmp/task_env.sh
            set +a

            # Clean up the temp file
            rm -f /tmp/task_env.sh

            # Clear warm mode flag so start.sh doesn't loop back here
            unset WARM_POOL_MODE

            echo "[Warm Pool] Environment loaded. Starting task execution..."
            echo "[Warm Pool] Task ID: ${TASK_ID}"
            echo "[Warm Pool] Jira Issue: ${JIRA_ISSUE_KEY}"

            # Re-run start.sh which will now route to the appropriate executor
            exec /app/start.sh
            ;;

        "terminate")
            echo "[Warm Pool] Received terminate signal. Shutting down gracefully."
            exit 0
            ;;

        "waiting")
            # Still waiting, continue polling
            # Send heartbeat every poll (built into the poll endpoint)
            ;;

        "error")
            MESSAGE=$(echo "${RESPONSE}" | jq -r '.message // "unknown error"')
            echo "[Warm Pool] Poll error: ${MESSAGE}"
            # Continue polling unless it's a fatal error
            sleep 5
            ;;

        *)
            echo "[Warm Pool] Unexpected status: ${STATUS}"
            sleep 5
            ;;
    esac
done

echo "[Warm Pool] Max poll time exceeded (6 hours). Shutting down."
exit 0
