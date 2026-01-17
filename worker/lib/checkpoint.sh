#!/bin/bash
# =============================================================================
# Worker State Checkpointing Library
# Functions for saving and loading worker task state to enable resumption
# after Spot interruptions, timeouts, or failures
# =============================================================================

set -e

# Checkpoint storage paths
CHECKPOINT_DIR="${CHECKPOINT_DIR:-/tmp}"
CHECKPOINT_FILE="${CHECKPOINT_DIR}/checkpoint.json"
CHECKPOINT_BUCKET="${CHECKPOINT_BUCKET:-}"
CHECKPOINT_ENABLED="${CHECKPOINT_ENABLED:-true}"
CHECKPOINT_INTERVAL="${CHECKPOINT_INTERVAL:-60}"

# Global state
CHECKPOINT_DIRTY=false
CHECKPOINT_COMMIT_COUNT=0

# =============================================================================
# checkpoint_init - Create initial checkpoint state file
# =============================================================================
checkpoint_init() {
    if [ "${CHECKPOINT_ENABLED}" != "true" ]; then
        return 0
    fi

    # Use JIRA_ISSUE_KEY for checkpoint keying - this stays constant across retries
    # TASK_ID changes on each retry, so checkpoints keyed by TASK_ID are useless for recovery
    local checkpoint_key="${JIRA_ISSUE_KEY:-${TASK_ID:-unknown}}"
    local task_id="${TASK_ID:-unknown}"
    local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    # Export checkpoint key for use in other functions
    export CHECKPOINT_KEY="${checkpoint_key}"

    # Initialize local checkpoint file
    cat > "${CHECKPOINT_FILE}" <<EOF
{
  "taskId": "${task_id}",
  "version": 1,
  "createdAt": "${now}",
  "updatedAt": "${now}",
  "stage": "initialized",
  "repoCloned": false,
  "branch": null,
  "commits": [],
  "filesAnalyzed": [],
  "filesModified": [],
  "testsRun": false,
  "testsPassed": null,
  "lastAction": "Task initialized",
  "pendingWork": null,
  "resumeCount": 0
}
EOF

    echo "[checkpoint] Initialized checkpoint at ${CHECKPOINT_FILE}"
    CHECKPOINT_DIRTY=false

    # Try to load existing checkpoint from S3 if this is a retry
    checkpoint_load || true
}

# =============================================================================
# checkpoint_update - Update stage/progress in checkpoint state
# Updates both local file and marks for S3 sync
# Usage: checkpoint_update "stage" "value"
# =============================================================================
checkpoint_update() {
    if [ "${CHECKPOINT_ENABLED}" != "true" ]; then
        return 0
    fi

    local field="$1"
    local value="$2"
    local now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    if [ ! -f "${CHECKPOINT_FILE}" ]; then
        echo "[checkpoint] ERROR: Checkpoint file not found at ${CHECKPOINT_FILE}"
        return 1
    fi

    # Use jq to safely update JSON
    if ! command -v jq >/dev/null 2>&1; then
        echo "[checkpoint] WARNING: jq not found, cannot update checkpoint"
        return 1
    fi

    case "${field}" in
        "stage")
            jq --arg stage "${value}" --arg now "${now}" \
                '.stage = $stage | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated stage: ${value}"
            ;;

        "branch")
            jq --arg branch "${value}" --arg now "${now}" \
                '.branch = $branch | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated branch: ${value}"
            ;;

        "repoCloned")
            jq --argjson cloned "$([ "${value}" = "true" ] && echo "true" || echo "false")" --arg now "${now}" \
                '.repoCloned = $cloned | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated repoCloned: ${value}"
            ;;

        "filesAnalyzed")
            jq --arg file "${value}" --arg now "${now}" \
                '.filesAnalyzed += [$file] | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Added analyzed file: ${value}"
            ;;

        "filesModified")
            jq --arg file "${value}" --arg now "${now}" \
                '.filesModified += [$file] | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Added modified file: ${value}"
            ;;

        "testsPassed")
            jq --argjson passed "$([ "${value}" = "true" ] && echo "true" || echo "false")" --arg now "${now}" \
                '.testsPassed = $passed | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated testsPassed: ${value}"
            ;;

        "testsRun")
            jq --argjson run "$([ "${value}" = "true" ] && echo "true" || echo "false")" --arg now "${now}" \
                '.testsRun = $run | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated testsRun: ${value}"
            ;;

        "lastAction")
            jq --arg action "${value}" --arg now "${now}" \
                '.lastAction = $action | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Updated lastAction: ${value}"
            ;;

        "pendingWork")
            if [ -z "${value}" ]; then
                jq --arg now "${now}" \
                    '.pendingWork = null | .updatedAt = $now' \
                    "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                    mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            else
                jq --arg work "${value}" --arg now "${now}" \
                    '.pendingWork = $work | .updatedAt = $now' \
                    "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                    mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            fi
            echo "[checkpoint] Updated pendingWork: ${value}"
            ;;

        "commit")
            # Add commit SHA to commits array
            jq --arg sha "${value}" --arg now "${now}" \
                '.commits += [$sha] | .updatedAt = $now' \
                "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"
            echo "[checkpoint] Added commit: ${value}"
            ((CHECKPOINT_COMMIT_COUNT++))
            ;;

        *)
            echo "[checkpoint] ERROR: Unknown field: ${field}"
            return 1
            ;;
    esac

    CHECKPOINT_DIRTY=true
    return 0
}

# =============================================================================
# checkpoint_load - Download existing checkpoint from S3 if exists
# Returns 0 if checkpoint was loaded (resuming), 1 if fresh start
# =============================================================================
checkpoint_load() {
    if [ "${CHECKPOINT_ENABLED}" != "true" ]; then
        return 1
    fi

    if [ -z "${CHECKPOINT_BUCKET}" ]; then
        echo "[checkpoint] WARNING: CHECKPOINT_BUCKET not set, skipping S3 load"
        return 1
    fi

    if ! command -v aws >/dev/null 2>&1; then
        echo "[checkpoint] WARNING: aws CLI not found, cannot load checkpoint from S3"
        return 1
    fi

    # Use CHECKPOINT_KEY (Jira issue key) for S3 path - constant across retries
    local checkpoint_key="${CHECKPOINT_KEY:-${JIRA_ISSUE_KEY:-${TASK_ID:-unknown}}}"
    local task_id="${TASK_ID:-unknown}"
    local s3_path="s3://${CHECKPOINT_BUCKET}/${checkpoint_key}/checkpoint.json"
    echo "[checkpoint] Looking for checkpoint at: ${s3_path}"

    # Check if checkpoint exists in S3
    if ! aws s3 ls "${s3_path}" >/dev/null 2>&1; then
        echo "[checkpoint] No existing checkpoint found in S3, starting fresh"
        return 1
    fi

    # Download checkpoint from S3
    echo "[checkpoint] Loading checkpoint from S3: ${s3_path}"
    if aws s3 cp "${s3_path}" "${CHECKPOINT_FILE}" 2>&1; then
        # Validate checkpoint structure
        if ! command -v jq >/dev/null 2>&1; then
            echo "[checkpoint] WARNING: jq not found, cannot validate checkpoint"
            return 0
        fi

        if jq empty "${CHECKPOINT_FILE}" 2>/dev/null; then
            # Validate checkpoint is valid JSON and increment resume count
            # Note: We no longer require exact task ID match since checkpoints are keyed by Jira issue key
            # and tasks get new IDs on retry. The checkpoint_key match is implicit via the S3 path.
            if true; then
                # Increment resume count
                jq --arg now "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
                    '.resumeCount += 1 | .updatedAt = $now' \
                    "${CHECKPOINT_FILE}" > "${CHECKPOINT_FILE}.tmp" && \
                    mv "${CHECKPOINT_FILE}.tmp" "${CHECKPOINT_FILE}"

                local stage=$(jq -r '.stage' "${CHECKPOINT_FILE}" 2>/dev/null || echo "unknown")
                local resume_count=$(jq -r '.resumeCount' "${CHECKPOINT_FILE}" 2>/dev/null || echo "0")
                echo "[checkpoint] Loaded checkpoint from retry #${resume_count}, last stage: ${stage}"
                CHECKPOINT_DIRTY=true
                return 0
            fi
        else
            echo "[checkpoint] WARNING: Checkpoint validation failed, starting fresh"
            return 1
        fi
    else
        echo "[checkpoint] ERROR: Failed to download checkpoint from S3"
        return 1
    fi
}

# =============================================================================
# checkpoint_save - Upload checkpoint state to S3
# Called periodically and on exit to persist state
# =============================================================================
checkpoint_save() {
    if [ "${CHECKPOINT_ENABLED}" != "true" ]; then
        return 0
    fi

    if [ -z "${CHECKPOINT_BUCKET}" ]; then
        echo "[checkpoint] WARNING: CHECKPOINT_BUCKET not set, skipping S3 save"
        return 1
    fi

    if [ ! -f "${CHECKPOINT_FILE}" ]; then
        echo "[checkpoint] WARNING: Checkpoint file not found at ${CHECKPOINT_FILE}"
        return 1
    fi

    if [ "${CHECKPOINT_DIRTY}" != "true" ]; then
        # Only save if state has changed
        return 0
    fi

    if ! command -v aws >/dev/null 2>&1; then
        echo "[checkpoint] WARNING: aws CLI not found, cannot save checkpoint to S3"
        return 1
    fi

    # Use CHECKPOINT_KEY (Jira issue key) for S3 path - constant across retries
    local checkpoint_key="${CHECKPOINT_KEY:-${JIRA_ISSUE_KEY:-${TASK_ID:-unknown}}}"
    local s3_path="s3://${CHECKPOINT_BUCKET}/${checkpoint_key}/checkpoint.json"

    # Upload checkpoint to S3
    if aws s3 cp "${CHECKPOINT_FILE}" "${s3_path}" --sse AES256 2>&1; then
        echo "[checkpoint] Saved checkpoint to S3: ${s3_path}"
        CHECKPOINT_DIRTY=false
        return 0
    else
        echo "[checkpoint] ERROR: Failed to save checkpoint to S3"
        return 1
    fi
}

# =============================================================================
# checkpoint_get - Read a field from the checkpoint
# Usage: checkpoint_get "field"
# Outputs the JSON value
# =============================================================================
checkpoint_get() {
    local field="$1"

    if [ ! -f "${CHECKPOINT_FILE}" ]; then
        return 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        return 1
    fi

    jq -r ".${field}" "${CHECKPOINT_FILE}" 2>/dev/null || echo ""
}

# =============================================================================
# checkpoint_status - Print human-readable checkpoint status
# =============================================================================
checkpoint_status() {
    if [ ! -f "${CHECKPOINT_FILE}" ]; then
        echo "[checkpoint] No checkpoint file found"
        return
    fi

    if ! command -v jq >/dev/null 2>&1; then
        echo "[checkpoint] Status: (jq not available)"
        return
    fi

    echo "[checkpoint] Current Status:"
    echo "  Stage: $(jq -r '.stage' "${CHECKPOINT_FILE}")"
    echo "  Branch: $(jq -r '.branch // "null"' "${CHECKPOINT_FILE}")"
    echo "  Repo Cloned: $(jq -r '.repoCloned' "${CHECKPOINT_FILE}")"
    echo "  Commits Made: $(jq -r '.commits | length' "${CHECKPOINT_FILE}")"
    echo "  Files Modified: $(jq -r '.filesModified | length' "${CHECKPOINT_FILE}")"
    echo "  Tests Run: $(jq -r '.testsRun' "${CHECKPOINT_FILE}")"
    echo "  Tests Passed: $(jq -r '.testsPassed' "${CHECKPOINT_FILE}")"
    echo "  Resume Count: $(jq -r '.resumeCount' "${CHECKPOINT_FILE}")"
    echo "  Last Action: $(jq -r '.lastAction' "${CHECKPOINT_FILE}")"
}

# =============================================================================
# Export functions for use in entrypoint.sh
# =============================================================================
export -f checkpoint_init
export -f checkpoint_update
export -f checkpoint_load
export -f checkpoint_save
export -f checkpoint_get
export -f checkpoint_status
