#!/bin/bash
set -e

# WorkerMill AI Worker Entrypoint
# This script runs Claude Code CLI to execute AI agent tasks

# API base URL for posting logs (exported for subshells)
export API_BASE="${API_BASE_URL:-https://workermill.com}"


# Parent task ID for multi-story orchestration (set by orchestrator for child tasks)
export PARENT_TASK_ID="${PARENT_TASK_ID:-}"
# =============================================================================
# Load Checkpoint Library
# =============================================================================
CHECKPOINT_LIB="/app/lib/checkpoint.sh"
if [ -f "${CHECKPOINT_LIB}" ]; then
    source "${CHECKPOINT_LIB}"
else
    echo "[warning] Checkpoint library not found at ${CHECKPOINT_LIB}"
fi

# Format persona name for display (backend_developer -> Backend Developer)
format_persona() {
    echo "$1" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g'
}
PERSONA_DISPLAY=$(format_persona "${WORKER_PERSONA}")

# =============================================================================
# Worker Coordination Functions
# =============================================================================
# These functions enable multi-worker coordination via the WorkerMill API.
# Workers check in when starting, send heartbeats periodically, and check out
# when finishing. This allows detection of concurrent workers on the same repo.

# PID for the heartbeat background process
HEARTBEAT_PID=""

# Generate a unique worker ID from ECS task ID or fallback to hostname+pid
WORKER_ID="${ECS_TASK_ID:-${HOSTNAME:-worker}-$$}"

# Check in with the coordination service
# Called once after cloning the repo to announce worker presence
coordination_checkin() {
    local status="${1:-starting}"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[coordination] Skipping check-in - missing API credentials or TASK_ID"
        return 0
    fi

    echo "[coordination] Checking in: task=${TASK_ID}, worker=${WORKER_ID}, repo=${GITHUB_REPO}, branch=${BRANCH_NAME:-unknown}"

    local response
    response=$(curl -s -w "\n%{http_code}" --connect-timeout 5 --max-time 10 \
        -X POST "${API_BASE_URL}/api/coordination/check-in" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"taskId\": \"${TASK_ID}\",
            \"workerId\": \"${WORKER_ID}\",
            \"repo\": \"${GITHUB_REPO}\",
            \"branch\": \"${BRANCH_NAME:-ai/${JIRA_ISSUE_KEY}}\",
            \"status\": \"${status}\",
            \"metadata\": {
                \"persona\": \"${WORKER_PERSONA}\",
                \"model\": \"${CLAUDE_MODEL}\",
                \"jiraKey\": \"${JIRA_ISSUE_KEY}\"
            }
        }" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        echo "[coordination] Check-in successful"

        # Check for conflicts (other workers on same repo)
        local conflict_count
        conflict_count=$(echo "$body" | jq -r '.conflicts | length // 0' 2>/dev/null || echo "0")
        if [ "$conflict_count" -gt 0 ]; then
            echo "[coordination] WARNING: ${conflict_count} other worker(s) active on this repo"
            echo "[coordination] Conflicts: $(echo "$body" | jq -c '.conflicts' 2>/dev/null)"
        fi
        return 0
    else
        echo "[coordination] Check-in failed (HTTP ${http_code}): ${body}"
        return 1
    fi
}

# Send a heartbeat to indicate the worker is still alive
# Updates the current status and optionally the file being worked on
send_heartbeat() {
    local status="${1:-working}"
    local current_file="${2:-}"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        return 0
    fi

    local payload="{\"taskId\": \"${TASK_ID}\", \"status\": \"${status}\""
    if [ -n "$current_file" ]; then
        payload="${payload}, \"currentFile\": \"${current_file}\""
    fi
    payload="${payload}}"

    curl -s --connect-timeout 5 --max-time 10 \
        -X POST "${API_BASE_URL}/api/coordination/heartbeat" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null 2>&1 || true
}

# Background heartbeat loop - sends heartbeats every 30 seconds
start_heartbeat_loop() {
    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[coordination] Skipping heartbeat loop - missing credentials"
        return 0
    fi

    (
        while true; do
            sleep 30
            send_heartbeat "working"
        done
    ) &
    HEARTBEAT_PID=$!
    echo "[coordination] Started heartbeat loop (PID: ${HEARTBEAT_PID})"
}

# Stop the heartbeat background process
stop_heartbeat_loop() {
    if [ -n "${HEARTBEAT_PID}" ]; then
        kill "${HEARTBEAT_PID}" 2>/dev/null || true
        echo "[coordination] Stopped heartbeat loop"
        HEARTBEAT_PID=""
    fi
}

# Check out from the coordination service
# Called when the worker is finishing (in cleanup handler)
coordination_checkout() {
    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        return 0
    fi

    echo "[coordination] Checking out: task=${TASK_ID}"

    curl -s --connect-timeout 5 --max-time 10 \
        -X DELETE "${API_BASE_URL}/api/coordination/check-out" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"taskId\": \"${TASK_ID}\"}" >/dev/null 2>&1 || true

    echo "[coordination] Check-out complete"
}

# Get list of active workers on the same repository
# Useful for Claude to check before editing conflicting files
coordination_get_active_workers() {
    local repo="${1:-${GITHUB_REPO}}"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[]"
        return 0
    fi

    local response
    response=$(curl -s --connect-timeout 5 --max-time 10 \
        -X GET "${API_BASE_URL}/api/coordination/active-workers?repo=${repo}" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    echo "$response" | jq -c '.workers // []' 2>/dev/null || echo "[]"
}

# =============================================================================
# Git Manifest Functions
# =============================================================================
# The manifest system allows workers to declare intent to modify files BEFORE
# they start editing. This prevents merge conflicts when multiple workers
# operate on the same repository.

# Declare a manifest of files this worker intends to modify
# Called after analyzing/planning phase but before making actual edits
# Arguments:
#   $1 - JSON array of file paths to modify (e.g., '["src/api/index.ts", "package.json"]')
# Returns:
#   0 if successful (no conflicts, locks acquired)
#   1 if conflicts exist (check response for details)
#   2 if API call failed
coordination_declare_manifest() {
    local files_json="$1"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[manifest] Skipping manifest declaration - missing API credentials or TASK_ID"
        return 0
    fi

    if [ -z "${files_json}" ] || [ "${files_json}" = "[]" ]; then
        echo "[manifest] No files to declare in manifest"
        return 0
    fi

    echo "[manifest] Declaring intent to modify files: ${files_json}"

    local response
    response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 30 \
        -X POST "${API_BASE_URL}/api/coordination/manifest/declare" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"taskId\": \"${TASK_ID}\",
            \"repo\": \"${GITHUB_REPO}\",
            \"branch\": \"${BRANCH_NAME:-ai/${JIRA_ISSUE_KEY}}\",
            \"filesToModify\": ${files_json}
        }" 2>/dev/null)

    local http_code
    http_code=$(echo "$response" | tail -n1)
    local body
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        local locks_acquired
        locks_acquired=$(echo "$body" | jq -r '.locksAcquired | length // 0' 2>/dev/null || echo "0")
        echo "[manifest] Successfully declared manifest - ${locks_acquired} file locks acquired"
        return 0
    elif [ "$http_code" = "409" ]; then
        # Conflicts detected
        echo "[manifest] WARNING: Conflicts detected with other workers"
        local conflicts
        conflicts=$(echo "$body" | jq -c '.conflicts' 2>/dev/null || echo "[]")
        echo "[manifest] Conflicting files: ${conflicts}"

        # Output conflict details for Claude to process
        echo "$body" | jq -r '.conflicts[] | "  - \(.filePath) locked by task \(.heldBy.taskId) until \(.heldBy.expiresAt)"' 2>/dev/null || true
        return 1
    else
        echo "[manifest] Failed to declare manifest (HTTP ${http_code}): ${body}"
        return 2
    fi
}

# Get existing manifests for the repository
# Use this to check what files other workers are modifying before planning
# Arguments:
#   $1 - (optional) branch to filter by
# Returns:
#   JSON array of manifests
coordination_get_manifests() {
    local branch="${1:-}"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[]"
        return 0
    fi

    local url="${API_BASE_URL}/api/coordination/manifest?repo=${GITHUB_REPO}"
    if [ -n "${branch}" ]; then
        url="${url}&branch=${branch}"
    fi

    local response
    response=$(curl -s --connect-timeout 5 --max-time 10 \
        -X GET "${url}" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    echo "$response" | jq -c '.manifests // []' 2>/dev/null || echo "[]"
}

# Clear this worker's manifest (releases all file locks)
# Called automatically on exit, but can be called early if worker
# decides not to modify certain files
coordination_clear_manifest() {
    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        return 0
    fi

    echo "[manifest] Clearing manifest for task ${TASK_ID}"

    curl -s --connect-timeout 5 --max-time 10 \
        -X DELETE "${API_BASE_URL}/api/coordination/manifest/${TASK_ID}" \
        -H "x-api-key: ${ORG_API_KEY}" >/dev/null 2>&1 || true

    echo "[manifest] Manifest cleared"
}

# =============================================================================
# Worker Context Posting (Multi-Worker Coordination)
# =============================================================================
# Posts context messages to API for sibling workers to see.
# Only active when PARENT_TASK_ID is set (multi-story orchestration).

# Post a context message for sibling workers
# Arguments:
#   $1 - messageType: file_created|file_modified|decision|dependency|question|answer|completion|blocker|warning|progress
#   $2 - content: The message content
#   $3 - metadata (optional): JSON object with additional data
post_context() {
    local msg_type="$1"
    local content="$2"
    local metadata="${3:-null}"

    # Skip if not a multi-story task (no parent)
    if [ -z "${PARENT_TASK_ID}" ]; then
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[context] Skipping - missing API credentials"
        return 0
    fi

    echo "[context] Posting ${msg_type}: ${content:0:80}..."

    curl -s --connect-timeout 5 --max-time 10 \
        -X POST "${API_BASE_URL}/api/coordination/context" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"parentTaskId\": \"${PARENT_TASK_ID}\",
            \"taskId\": \"${TASK_ID}\",
            \"persona\": \"${WORKER_PERSONA}\",
            \"messageType\": \"${msg_type}\",
            \"content\": \"${content}\",
            \"metadata\": ${metadata}
        }" >/dev/null 2>&1 &
}

# =============================================================================
# Worker Command Polling (Supervised Mode)
# =============================================================================
# Polls for commands from the dashboard in supervised mode.
# Commands allow operators to pause, resume, or send messages to workers.

COMMAND_POLL_PID=""

# Start background command polling loop
# Only active when in supervised mode
start_command_polling() {
    # Check if supervised mode is enabled
    if [ "${EXECUTION_MODE}" != "supervised" ]; then
        echo "[commands] Skipping command polling - autonomous mode"
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[commands] Skipping command polling - missing credentials"
        return 0
    fi

    echo "[commands] Starting command polling loop..."

    (
        while true; do
            sleep 30  # Poll every 30 seconds

            # Fetch pending commands
            local response
            response=$(curl -s --connect-timeout 5 --max-time 10 \
                -X GET "${API_BASE_URL}/api/coordination/commands/${TASK_ID}/pending" \
                -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

            # Parse commands
            local cmd_count
            cmd_count=$(echo "$response" | jq -r '.commands | length' 2>/dev/null || echo "0")

            if [ "$cmd_count" -gt 0 ]; then
                echo "[commands] Received ${cmd_count} command(s)"

                # Process each command
                echo "$response" | jq -c '.commands[]' 2>/dev/null | while read -r cmd; do
                    local cmd_id=$(echo "$cmd" | jq -r '.id')
                    local cmd_type=$(echo "$cmd" | jq -r '.type')
                    local cmd_content=$(echo "$cmd" | jq -r '.content')

                    echo "[commands] Processing ${cmd_type}: ${cmd_content:0:50}"

                    case "$cmd_type" in
                        pause)
                            echo "[commands] PAUSE received - worker will pause at next checkpoint"
                            touch /tmp/worker_paused
                            ;;
                        resume)
                            echo "[commands] RESUME received - resuming execution"
                            rm -f /tmp/worker_paused
                            ;;
                        message)
                            echo "[commands] MESSAGE from dashboard: ${cmd_content}"
                            ;;
                        question)
                            echo "[commands] QUESTION from dashboard: ${cmd_content}"
                            # Questions would need Claude to respond - handled in agent loop
                            ;;
                    esac

                    # Acknowledge command
                    curl -s --connect-timeout 5 --max-time 10 \
                        -X POST "${API_BASE_URL}/api/coordination/commands/${cmd_id}/acknowledge" \
                        -H "x-api-key: ${ORG_API_KEY}" \
                        -H "Content-Type: application/json" \
                        -d '{}' >/dev/null 2>&1 || true
                done
            fi
        done
    ) &
    COMMAND_POLL_PID=$!
    echo "[commands] Started command polling (PID: ${COMMAND_POLL_PID})"
}

# Stop command polling
stop_command_polling() {
    if [ -n "${COMMAND_POLL_PID}" ]; then
        kill "${COMMAND_POLL_PID}" 2>/dev/null || true
        echo "[commands] Stopped command polling"
        COMMAND_POLL_PID=""
    fi
}

# Function to post log to API for real-time streaming
post_log() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    # Also echo to stdout for CloudWatch
    echo "[worker] $message"

    # Post to API (fire and forget, don't block on failure)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 &
}

# Synchronous version of post_log for critical messages that must be captured
# before the script exits
post_log_sync() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    # Also echo to stdout for CloudWatch
    echo "[worker] $message"

    # Post to API synchronously (wait for completion)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 || true
}

# Verify required tools are available
# This helps diagnose issues where Kaniko might corrupt the filesystem
verify_tool() {
    local tool="$1"
    if command -v "$tool" >/dev/null 2>&1; then
        echo "[worker] Tool available: $tool at $(command -v "$tool")"
        return 0
    else
        echo "[worker] WARNING: Tool not found: $tool"
        return 1
    fi
}

# =============================================================================
# SIGTERM Trap Handler for Spot Interruptions
# =============================================================================
# ECS Spot instances receive SIGTERM 2 minutes before termination.
# This handler saves checkpoint state to enable resumption on retry.
handle_spot_interruption() {
    echo "[worker] SIGTERM received - Spot interruption detected"
    post_log_sync "system" "Spot interruption detected - saving checkpoint state" "warning"

    # Update checkpoint to mark interruption
    if [ "${CHECKPOINT_ENABLED:-true}" = "true" ]; then
        checkpoint_update "stage" "interrupted" 2>/dev/null || true
        checkpoint_update "lastAction" "Interrupted by Spot capacity reclaim" 2>/dev/null || true
        checkpoint_save 2>/dev/null || true
        echo "[worker] Checkpoint saved for resumption"
    fi

    # Stop heartbeat and check out from coordination
    stop_heartbeat_loop 2>/dev/null || true
    coordination_checkout 2>/dev/null || true

    post_log_sync "system" "Graceful shutdown complete - task will be retried" "warning"

    # Exit cleanly (exit 0) so ECS knows we handled SIGTERM gracefully
    # The orchestrator will detect Spot interruption via exit code 137 (SIGKILL after SIGTERM timeout)
    # or via the checkpoint stage="interrupted"
    exit 0
}

# Register SIGTERM handler early (before any long-running operations)
trap handle_spot_interruption SIGTERM

echo "[worker] Verifying required tools..."
verify_tool "jq" || echo "[worker] CRITICAL: jq is required for JSON processing"
verify_tool "git"
verify_tool "gh"
verify_tool "aws"
verify_tool "node"
verify_tool "curl"
echo "[worker] PATH: $PATH"

# =============================================================================
# Initialize Checkpointing and Resume Detection
# =============================================================================
checkpoint_init

# Check if we're resuming from a previous run
RESUMING=false
RESUME_STAGE=""
RESUME_CONTEXT=""
RESUME_BRANCH=""
RESUME_COUNT=0

if [ "${CHECKPOINT_ENABLED:-true}" = "true" ] && [ -f "${CHECKPOINT_FILE:-/tmp/checkpoint.json}" ]; then
    RESUME_STAGE=$(checkpoint_get "stage" 2>/dev/null || echo "")
    RESUME_COUNT=$(checkpoint_get "resumeCount" 2>/dev/null || echo "0")

    # If resume count > 0, this is a resumed task
    if [ "${RESUME_COUNT}" != "0" ] && [ "${RESUME_COUNT}" != "null" ] && [ -n "${RESUME_COUNT}" ]; then
        RESUMING=true
        RESUME_BRANCH=$(checkpoint_get "branch" 2>/dev/null || echo "")

        # Build resume context from checkpoint
        RESUME_FILES_MODIFIED=$(checkpoint_get "filesModified" 2>/dev/null || echo "[]")
        RESUME_COMMITS=$(checkpoint_get "commits" 2>/dev/null || echo "[]")
        RESUME_LAST_ACTION=$(checkpoint_get "lastAction" 2>/dev/null || echo "")
        RESUME_TESTS_RUN=$(checkpoint_get "testsRun" 2>/dev/null || echo "false")
        RESUME_TESTS_PASSED=$(checkpoint_get "testsPassed" 2>/dev/null || echo "null")

        # Load failure context if previous run failed (not just interrupted)
        RESUME_EXIT_CODE=$(checkpoint_get "exitCode" 2>/dev/null || echo "0")
        RESUME_FAILURE_REASON=$(checkpoint_get "failureReason" 2>/dev/null || echo "")
        RESUME_LAST_OUTPUT=$(checkpoint_get "lastOutput" 2>/dev/null || echo "")
        RESUME_LAST_ERROR=$(checkpoint_get "lastError" 2>/dev/null || echo "")

        echo "[worker] RESUMING from previous run (resume count: ${RESUME_COUNT})"
        echo "[worker] Previous stage: ${RESUME_STAGE}"
        echo "[worker] Previous branch: ${RESUME_BRANCH}"
        if [ "${RESUME_STAGE}" = "failed" ]; then
            echo "[worker] Previous run FAILED with exit code ${RESUME_EXIT_CODE}"
        fi
        checkpoint_status
    fi
fi

# Start background checkpoint sync (every 60 seconds)
# This runs in the background and saves state periodically
if [ "${CHECKPOINT_ENABLED:-true}" = "true" ]; then
    (
        while true; do
            sleep "${CHECKPOINT_INTERVAL:-60}"
            checkpoint_save 2>&1 || true
        done
    ) &
    CHECKPOINT_PID=$!
    echo "[worker] Started checkpoint background sync (PID: ${CHECKPOINT_PID})"
fi

post_log "system" "Starting WorkerMill AI Worker"
post_log "system" "Task ID: ${TASK_ID}"
post_log "system" "Jira Issue: ${JIRA_ISSUE_KEY}"
post_log "system" "Persona: ${WORKER_PERSONA}"
post_log "system" "Model: ${CLAUDE_MODEL}"
post_log "system" "Retry: ${RETRY_NUMBER:-0}"

# Validate required environment variables
required_vars="TASK_ID JIRA_ISSUE_KEY JIRA_SUMMARY GITHUB_REPO WORKER_PERSONA GITHUB_TOKEN"
for var in $required_vars; do
    if [ -z "${!var}" ]; then
        post_log "error" "ERROR: Missing required environment variable: $var" "error"
        echo "::result::error_missing_env"
        exit 1
    fi
done

# Validate provider-specific credentials
WORKER_PROVIDER="${WORKER_PROVIDER:-anthropic}"
case "$WORKER_PROVIDER" in
    anthropic)
        if [ -z "${ANTHROPIC_API_KEY}" ]; then
            post_log "error" "ERROR: ANTHROPIC_API_KEY required for anthropic provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    openai)
        if [ -z "${OPENAI_API_KEY}" ]; then
            post_log "error" "ERROR: OPENAI_API_KEY required for openai provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    google)
        if [ -z "${GOOGLE_API_KEY}" ]; then
            post_log "error" "ERROR: GOOGLE_API_KEY required for google provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    ollama)
        if [ -z "${OLLAMA_HOST}" ]; then
            post_log "warning" "WARNING: OLLAMA_HOST not set, using default: http://host.docker.internal:11434" "warning"
        fi
        ;;
    azure)
        if [ -z "${AZURE_API_KEY}" ]; then
            post_log "error" "ERROR: AZURE_API_KEY required for azure provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        if [ -z "${AZURE_API_BASE}" ]; then
            post_log "error" "ERROR: AZURE_API_BASE required for azure provider (e.g., https://your-resource.openai.azure.com)" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    gemini)
        if [ -z "${GEMINI_API_KEY}" ] && [ -z "${GOOGLE_API_KEY}" ]; then
            post_log "error" "ERROR: GEMINI_API_KEY or GOOGLE_API_KEY required for gemini provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        # Universal agent uses GEMINI_API_KEY
        export GEMINI_API_KEY="${GEMINI_API_KEY:-${GOOGLE_API_KEY}}"
        ;;
    groq)
        if [ -z "${GROQ_API_KEY}" ]; then
            post_log "error" "ERROR: GROQ_API_KEY required for groq provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    mistral)
        if [ -z "${MISTRAL_API_KEY}" ]; then
            post_log "error" "ERROR: MISTRAL_API_KEY required for mistral provider" "error"
            echo "::result::error_missing_env"
            exit 1
        fi
        ;;
    *)
        post_log "error" "ERROR: Unknown provider: ${WORKER_PROVIDER}" "error"
        echo "::result::error_unknown_provider"
        exit 1
        ;;
esac

# Configure git
post_log "system" "Configuring git..."
git config --global user.email "ai-worker@workermill.com"
git config --global user.name "WorkerMill AI"
git config --global credential.helper store

# Configure GitHub CLI authentication
post_log "system" "Configuring GitHub authentication..."
echo "${GITHUB_TOKEN}" | gh auth login --with-token 2>/dev/null || true

# Set up git credentials for HTTPS
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials

# Extract repo info (format: owner/repo)
REPO_OWNER=$(echo "${GITHUB_REPO}" | cut -d'/' -f1)
REPO_NAME=$(echo "${GITHUB_REPO}" | cut -d'/' -f2)
REPO_URL="https://github.com/${GITHUB_REPO}.git"

# Detect if this is a deployment run (second run after PR approval)
IS_DEPLOYMENT_RUN=false
if [[ "${TASK_NOTES}" == *"DEPLOYMENT_RUN"* ]] || [[ "${TASK_NOTES}" == *"PR_APPROVED"* ]]; then
    IS_DEPLOYMENT_RUN=true
    post_log "system" "DEPLOYMENT RUN detected - PR already approved, will deploy and merge"
fi

# Create branch for this task (used in cloning and resume logic)
BRANCH_NAME="ai/${JIRA_ISSUE_KEY}"

# Feature branch workflow: If TARGET_BRANCH is set (multi-story PRD), use it as the base
# Workers branch from TARGET_BRANCH and create PRs back to TARGET_BRANCH
# Final PR from TARGET_BRANCH to main is created by the orchestrator
BASE_BRANCH="${TARGET_BRANCH:-main}"
if [ -n "${TARGET_BRANCH}" ]; then
    post_log "system" "Feature branch workflow: will branch from and PR to ${TARGET_BRANCH}"
fi

# =============================================================================
# Repository Cloning / Resume Logic
# =============================================================================
# On resume: If we're past the cloning stage, skip clone and checkout existing branch
# Stages in order: initialized -> cloning -> analyzing -> implementing -> testing -> committing -> pr_creating
SKIP_CLONE=false

if [ "$RESUMING" = true ]; then
    # Check if we've already cloned (stages after "initialized" mean we've cloned)
    case "${RESUME_STAGE}" in
        "analyzing"|"implementing"|"testing"|"committing"|"pr_creating")
            SKIP_CLONE=true
            # Use branch from checkpoint if available, otherwise use default
            if [ -n "${RESUME_BRANCH}" ] && [ "${RESUME_BRANCH}" != "null" ]; then
                BRANCH_NAME="${RESUME_BRANCH}"
            fi
            post_log "system" "RESUME: Skipping clone, will checkout existing branch ${BRANCH_NAME}"
            ;;
        "cloning"|"initialized"|*)
            # Need to clone fresh
            post_log "system" "RESUME: Stage is '${RESUME_STAGE}', will clone repository fresh"
            ;;
    esac
fi

cd /workspace

if [ "$SKIP_CLONE" = true ]; then
    # Resume: Clone fresh but checkout existing branch
    post_log "system" "Cloning repository ${GITHUB_REPO} for resume..."
    if ! git clone "${REPO_URL}" repo 2>&1; then
        post_log "error" "ERROR: Failed to clone repository" "error"
        echo "::result::error_clone_failed"
        exit 1
    fi
    cd repo
    git fetch origin

    # Checkout the branch from previous run
    if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
        git checkout "${BRANCH_NAME}"
        git pull origin "${BRANCH_NAME}" 2>/dev/null || true
        post_log "system" "RESUME: Checked out existing branch ${BRANCH_NAME}"
    else
        # Branch doesn't exist remotely yet - create it
        post_log "system" "RESUME: Branch ${BRANCH_NAME} not found on remote, creating new"
        git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
    fi
    checkpoint_update "lastAction" "Resumed from checkpoint - repository ready" || true
else
    # Normal flow: Clone and create branch
    post_log "system" "Cloning repository ${GITHUB_REPO}..."

    # Clone the repository
    if ! git clone "${REPO_URL}" repo 2>&1; then
        post_log "error" "ERROR: Failed to clone repository" "error"
        echo "::result::error_clone_failed"
        exit 1
    fi
    post_log "system" "Repository cloned successfully"
    checkpoint_update "stage" "cloning" || true
    checkpoint_update "repoCloned" "true" || true
    checkpoint_update "lastAction" "Repository cloned and ready for analysis" || true

    cd repo

    post_log "system" "Creating branch: ${BRANCH_NAME}"

    if [ "$IS_DEPLOYMENT_RUN" = true ]; then
        # For deployment runs, the branch should already exist with approved changes
        git fetch origin
        if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
            git checkout "${BRANCH_NAME}"
            git pull origin "${BRANCH_NAME}"
            post_log "system" "Checked out existing branch with approved changes"
        else
            post_log "error" "ERROR: Expected branch ${BRANCH_NAME} not found for deployment run" "error"
            echo "::result::error_branch_not_found"
            exit 1
        fi
    else
        # First run - create or checkout branch (handles branch already exists)
        git fetch origin 2>/dev/null || true
        if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
            # Branch exists remotely - checkout and pull
            git checkout "${BRANCH_NAME}"
            git pull origin "${BRANCH_NAME}" 2>/dev/null || true
            post_log "system" "Checked out existing branch ${BRANCH_NAME}"
        else
            # Branch doesn't exist - create new from BASE_BRANCH
            # For feature branch workflow, branch from TARGET_BRANCH instead of main
            if [ -n "${TARGET_BRANCH}" ]; then
                # Ensure the target branch exists locally
                if git show-ref --verify --quiet "refs/remotes/origin/${TARGET_BRANCH}"; then
                    git checkout "origin/${TARGET_BRANCH}" 2>/dev/null || git checkout "${TARGET_BRANCH}"
                    git checkout -b "${BRANCH_NAME}"
                    post_log "system" "Created branch ${BRANCH_NAME} from ${TARGET_BRANCH}"
                else
                    post_log "warning" "Target branch ${TARGET_BRANCH} not found, falling back to default branch" "warning"
                    git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
                fi
            else
                git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
            fi
        fi
    fi
fi

# Update checkpoint with branch information
checkpoint_update "branch" "${BRANCH_NAME}" || true
checkpoint_update "stage" "analyzing" || true
checkpoint_update "lastAction" "Branch created and ready for analysis" || true

# =============================================================================
# Worker Coordination: Check-in and Heartbeat
# =============================================================================
# Now that we've cloned and set up the branch, announce our presence to the
# coordination service and start the heartbeat loop.
coordination_checkin "analyzing"
start_heartbeat_loop
start_command_polling

# =============================================================================
# Directive Loading: API Fetch with File Fallback
# =============================================================================
# Attempts to fetch persona directives from WorkerMill API (database-backed)
# Falls back to bundled file-based directives if API fetch fails.
# This enables runtime directive editing via Persona Studio UI.

DIRECTIVE_PATH="/app/directives/${WORKER_PERSONA}/README.md"
COMMON_DIRECTIVES="/app/directives/common"
AGENTS_MD="/app/AGENTS.md"
DIRECTIVE_FETCH_SUCCESS=false

# Try fetching directives from API if credentials are available
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    post_log "system" "Attempting to fetch directives from API..."

    BUNDLE_RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 30 \
        -X GET "${API_BASE_URL}/api/personas/worker/${WORKER_PERSONA}/bundle" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    BUNDLE_HTTP_CODE=$(echo "$BUNDLE_RESPONSE" | tail -n1)
    BUNDLE_BODY=$(echo "$BUNDLE_RESPONSE" | sed '$d')

    if [ "$BUNDLE_HTTP_CODE" = "200" ]; then
        # Validate response has expected structure
        HAS_PERSONA=$(echo "$BUNDLE_BODY" | jq -e '.persona' > /dev/null 2>&1 && echo "true" || echo "false")

        if [ "$HAS_PERSONA" = "true" ]; then
            post_log "system" "Successfully fetched directives from API"

            # Create temp directory for API-fetched directives
            mkdir -p /tmp/directives/common

            # Extract and write README directive
            README_CONTENT=$(echo "$BUNDLE_BODY" | jq -r '.directives.readme // empty')
            if [ -n "$README_CONTENT" ] && [ "$README_CONTENT" != "null" ]; then
                echo "$README_CONTENT" > /tmp/directives/readme.md
                DIRECTIVE_PATH="/tmp/directives/readme.md"
                post_log "system" "Loaded README directive from API"
            fi

            # Extract and write common directives
            COMMON_COUNT=$(echo "$BUNDLE_BODY" | jq '.directives.common | length' 2>/dev/null || echo "0")
            if [ "$COMMON_COUNT" -gt 0 ]; then
                # Write each common directive to a file
                echo "$BUNDLE_BODY" | jq -c '.directives.common[]' 2>/dev/null | while read -r directive; do
                    FILENAME=$(echo "$directive" | jq -r '.filename // empty')
                    CONTENT=$(echo "$directive" | jq -r '.content // empty')
                    if [ -n "$FILENAME" ] && [ -n "$CONTENT" ]; then
                        echo "$CONTENT" > "/tmp/directives/common/${FILENAME}"
                    fi
                done
                COMMON_DIRECTIVES="/tmp/directives/common"
                post_log "system" "Loaded ${COMMON_COUNT} common directives from API"
            fi

            # Extract persona metadata for logging
            PERSONA_NAME=$(echo "$BUNDLE_BODY" | jq -r '.persona.name // empty')
            PERSONA_EMOJI=$(echo "$BUNDLE_BODY" | jq -r '.persona.emoji // empty')
            if [ -n "$PERSONA_NAME" ]; then
                post_log "system" "Using persona: ${PERSONA_EMOJI} ${PERSONA_NAME}"
            fi

            DIRECTIVE_FETCH_SUCCESS=true
        else
            post_log "warning" "API response missing persona data, falling back to files" "warning"
        fi
    else
        post_log "warning" "Failed to fetch directives from API (HTTP ${BUNDLE_HTTP_CODE}), using bundled files" "warning"
    fi
else
    post_log "system" "API credentials not configured, using bundled directive files"
fi

# Verify fallback paths exist
if [ "$DIRECTIVE_FETCH_SUCCESS" = "false" ]; then
    if [ ! -f "$DIRECTIVE_PATH" ]; then
        post_log "warning" "Directive file not found: ${DIRECTIVE_PATH}" "warning"
    fi
    if [ ! -d "$COMMON_DIRECTIVES" ]; then
        post_log "warning" "Common directives directory not found: ${COMMON_DIRECTIVES}" "warning"
    fi
fi

# =============================================================================
# Read directive content for inline inclusion in prompt
# This is especially important for non-Claude providers (Ollama, OpenAI, etc.)
# that can't read files the same way Claude Code can
# =============================================================================
DIRECTIVE_CONTENT=""
if [ -f "$DIRECTIVE_PATH" ]; then
    DIRECTIVE_CONTENT=$(cat "$DIRECTIVE_PATH" 2>/dev/null)
    post_log "system" "Loaded persona directive (${#DIRECTIVE_CONTENT} chars)"
fi

COMMON_DIRECTIVE_CONTENT=""
if [ -d "$COMMON_DIRECTIVES" ]; then
    # Concatenate all common directive files
    for f in "${COMMON_DIRECTIVES}"/*.md; do
        if [ -f "$f" ]; then
            FILENAME=$(basename "$f")
            CONTENT=$(cat "$f" 2>/dev/null)
            COMMON_DIRECTIVE_CONTENT="${COMMON_DIRECTIVE_CONTENT}

### ${FILENAME}
${CONTENT}
"
        fi
    done
    post_log "system" "Loaded common directives (${#COMMON_DIRECTIVE_CONTENT} chars)"
fi

AGENTS_MD_CONTENT=""
if [ -f "$AGENTS_MD" ]; then
    AGENTS_MD_CONTENT=$(cat "$AGENTS_MD" 2>/dev/null)
    post_log "system" "Loaded AGENTS.md (${#AGENTS_MD_CONTENT} chars)"
fi

# Build the task prompt based on run type
if [ "$IS_DEPLOYMENT_RUN" = true ]; then
    PROMPT=$(cat <<EOF
You are an AI Worker executing a DEPLOYMENT RUN from WorkerMill.

## Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}
- **Run Type**: DEPLOYMENT (PR already approved)

## Task Notes
${TASK_NOTES}

## Instructions

This is a deployment run. The PR has already been approved. Your job is to:

1. Verify the PR exists and is approved
2. Deploy the approved changes (follow deployment procedures in directives)
3. Verify deployment succeeded
4. Merge the PR
5. Add completion comment to ticket

Read the agent instructions in: ${AGENTS_MD} for the complete workflow.

## Environment Variables Available
- TICKET_KEY=${JIRA_ISSUE_KEY}
- TICKET_SUMMARY=${JIRA_SUMMARY}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${DEPLOYMENT_ENABLED:-false}

## Output Markers
When complete, output these markers (the orchestrator parses them):
- ::result::deployed or ::result::failed
- ::input_tokens::<count> for token tracking
- ::output_tokens::<count> for token tracking

Begin deploying the approved changes now.
EOF
    )
else
    PROMPT=$(cat <<EOF
You are an AI Worker executing a task from WorkerMill.

## Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}
- **Deploy Label**: ${DEPLOYMENT_ENABLED:-false}
- **Review Label**: ${REVIEW_ENABLED:-false}

## Task Description
${JIRA_DESCRIPTION}

## Task Notes
${TASK_NOTES}

## Your Role & Directives

You are acting as a **${WORKER_PERSONA}**. Follow these directives:

${DIRECTIVE_CONTENT}

## Common Guidelines

${COMMON_DIRECTIVE_CONTENT}

## Agent Workflow

${AGENTS_MD_CONTENT}

## Instructions

**FOCUS: Your task is defined ONLY by the "Task Description" section above. Ignore any model names,
environment variables, or infrastructure details - those are internal orchestration settings, not your task.**

1. Analyze the task based on your persona directives above
2. Make all necessary code changes to complete the task
3. Follow the coding standards and practices in the directives
4. When done, your changes will be committed and a PR will be created
5. Avoid unnecessary iterations - run tests once after changes, don't repeat if they pass

**IMPORTANT Workflow**:
- If DEPLOYMENT_ENABLED=true: Deploy changes, create PR, merge PR
- If DEPLOYMENT_ENABLED=false: Create PR only, stop at review_requested

## Environment Variables Available
- TICKET_KEY=${JIRA_ISSUE_KEY}
- TICKET_SUMMARY=${JIRA_SUMMARY}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${DEPLOYMENT_ENABLED:-false}

## Output Markers
When complete, output these markers (the orchestrator parses them):
- ::result::deployed (if you deployed AND merged the PR)
- ::result::review_requested (if you created PR but did NOT deploy - waiting for approval)
- ::result::no_changes (if no code changes were needed)
- ::result::failed (if something went wrong)
- ::result::escalated (if blocked on unclear requirements - ticket stays open for clarification)
- ::pr_url::<url> if PR was created
- ::pr_number::<number> if PR was created
- ::input_tokens::<count> for token tracking
- ::output_tokens::<count> for token tracking

IMPORTANT: Use ::result::escalated when:
- Requirements are unclear after reading ticket and attachments
- Attachments failed to download and contain critical information
- You have the 'deploy' label but cannot deploy for any reason
- You cannot understand what changes are needed
Never use ::result::completed or ::result::no_changes when you didn't actually complete the work.

Begin executing the task now.
EOF
    )
fi

# =============================================================================
# Inject Resume Context into Prompt
# =============================================================================
# If this is a resumed task, prepend context about previous progress
if [ "$RESUMING" = true ]; then
    post_log "system" "Building resume context for Claude..."

    # Determine if previous run failed or was just interrupted
    PREVIOUS_FAILED=false
    if [ "${RESUME_STAGE}" = "failed" ] && [ "${RESUME_EXIT_CODE}" != "0" ]; then
        PREVIOUS_FAILED=true
        post_log "system" "Previous run FAILED - adding 'try different approach' guidance"
    fi

    # Build human-readable resume context
    if [ "${PREVIOUS_FAILED}" = true ]; then
        # FAILURE case: Previous run failed, need to try a different approach
        RESUME_PREFIX=$(cat <<RESUMEEOF
## ⚠️ CRITICAL: RETRYING AFTER FAILURE

**This is attempt #${RESUME_COUNT}. The previous attempt FAILED with exit code ${RESUME_EXIT_CODE}.**

### What Went Wrong
${RESUME_FAILURE_REASON}

### Last Output Before Failure
\`\`\`
${RESUME_LAST_OUTPUT}
\`\`\`

### Previous Progress (Before Failure)
- **Branch**: ${RESUME_BRANCH}
- **Last action**: ${RESUME_LAST_ACTION}
- **Tests run**: ${RESUME_TESTS_RUN}
- **Tests passed**: ${RESUME_TESTS_PASSED}

### Files Modified Before Failure
${RESUME_FILES_MODIFIED}

### IMPORTANT: TRY A DIFFERENT APPROACH

The previous approach failed. You MUST:

1. **Analyze the failure** - Understand WHY the previous attempt failed
2. **DO NOT repeat the same approach** - If the same command or method failed, try something different
3. **Check the current state** - Run git status to see what exists now
4. **Consider alternatives**:
   - If a test was failing, investigate the root cause before fixing
   - If a command errored, check prerequisites and dependencies
   - If stuck on a problem, try breaking it into smaller steps
   - If an approach seems blocked, escalate with ::result::escalated
5. **Learn from the error** - The failure context above tells you what NOT to do

If you believe this task cannot be completed, output ::result::escalated with a clear explanation.

---

RESUMEEOF
        )
    else
        # INTERRUPTION case: Previous run was interrupted (Spot), just resume
        RESUME_PREFIX=$(cat <<RESUMEEOF
## IMPORTANT: RESUMED TASK

**This is a RESUMED task (attempt #${RESUME_COUNT}). The previous run was interrupted (not failed).**

### Previous Progress
- **Stage reached**: ${RESUME_STAGE}
- **Branch**: ${RESUME_BRANCH}
- **Last action**: ${RESUME_LAST_ACTION}
- **Tests run**: ${RESUME_TESTS_RUN}
- **Tests passed**: ${RESUME_TESTS_PASSED}

### Files Modified (in previous run)
${RESUME_FILES_MODIFIED}

### Commits Made (in previous run)
${RESUME_COMMITS}

### Resume Instructions
1. **DO NOT redo completed work** - Check what exists before making changes
2. **Check git status** - See what uncommitted changes exist from the previous run
3. **Check git log** - See what commits were already made
4. **Continue from where you left off** - If implementing, continue implementation. If testing, run tests. If committing, commit remaining changes.
5. **If PR already exists** - Check for existing PR on this branch before creating a new one

---

RESUMEEOF
        )
    fi

    # Prepend resume context to the prompt
    PROMPT="${RESUME_PREFIX}

${PROMPT}"

    post_log "system" "Resume context injected into prompt"
fi

post_log "system" "Starting AI Agent..."
post_log "system" "Provider: ${WORKER_PROVIDER:-anthropic}"
post_log "system" "Model: ${CLAUDE_MODEL:-sonnet}"
if [ "$RESUMING" = true ]; then
    post_log "system" "This is a RESUMED task (attempt #${RESUME_COUNT})"
fi


# =============================================================================
# CRITICAL: Live Log Streaming Implementation
# =============================================================================
# DO NOT MODIFY THIS SECTION WITHOUT EXPLICIT USER APPROVAL!
#
# This log streaming system took a week to get working. It follows the exact
# pattern from the oncallshift reference implementation. Key components:
#
# 1. Claude CLI outputs structured JSON via --output-format stream-json
# 2. Output is piped through log-parser.cjs which:
#    - Extracts readable content from JSON events
#    - Posts logs to /api/control-center/logs for live dashboard viewing
#    - Tracks token usage for cost calculation
# 3. Dashboard connects via SSE to stream logs in real-time
#
# Pattern: claude --output-format stream-json | tee output.jsonl | log-parser.cjs
#
# If logs stop appearing in dashboard, check:
# - log-parser.cjs is being invoked (not just "cat")
# - ORG_API_KEY is set for authentication
# - API endpoint /api/control-center/logs is accessible
#
# Reference: oncallshift backend/scripts/ai-worker-entrypoint.sh lines 604-630
# =============================================================================

# Set environment variables for execution scripts
export TICKET_KEY="${JIRA_ISSUE_KEY}"
export TICKET_SUMMARY="${JIRA_SUMMARY}"
export REPO_PATH="/workspace/repo"
# JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN are passed from the orchestrator

# Transition Jira ticket to "In Progress"
if [ -n "${JIRA_BASE_URL}" ] && [ -n "${JIRA_EMAIL}" ] && [ -n "${JIRA_API_TOKEN}" ]; then
    post_log "system" "Transitioning Jira ticket to In Progress..."
    export TRANSITION_NAME="In Progress"
    node /app/execution-compiled/ticket/transition_issue.js 2>&1 || post_log "warning" "Warning: Could not transition ticket (may already be in progress)" "warning"
fi

# Run Claude Code CLI with stream-json output for accurate token tracking
# and live log streaming via log-parser.cjs
OUTPUT_FILE="/tmp/claude_output.jsonl"
STDERR_FILE="/tmp/claude_stderr.log"
EXIT_CODE=0

# Post initial log
post_log "system" "Worker started for ${JIRA_ISSUE_KEY} with persona ${WORKER_PERSONA}" "info"
post_log "system" "Using model: ${CLAUDE_MODEL:-sonnet}" "info"

# Log parser script path (inside Docker container)
LOG_PARSER_SCRIPT="/app/scripts/log-parser.cjs"

# Export env vars for log-parser.cjs (required for API posting and cost tracking)
# Also export Jira credentials so Claude's Bash tool can download attachments
export TASK_ID ORG_ID API_BASE_URL ORG_API_KEY CLAUDE_MODEL JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN

# Check if log-parser exists and set up the pipeline
if [ -f "${LOG_PARSER_SCRIPT}" ]; then
    post_log "system" "Live log streaming enabled via log-parser.cjs" "info"
    LOG_PARSER_CMD="node ${LOG_PARSER_SCRIPT}"
else
    post_log "warning" "log-parser.cjs not found at ${LOG_PARSER_SCRIPT}, logs will not stream to dashboard" "warning"
    LOG_PARSER_CMD="cat"  # Passthrough if parser not available
fi

# =============================================================================
# Trap Handler for Graceful Shutdown
# Ensures checkpoint is saved and coordination cleanup on EXIT
# =============================================================================
cleanup_on_exit() {
    # Save checkpoint state
    checkpoint_save 2>&1 || true

    # Stop checkpoint background sync
    [ -n "${CHECKPOINT_PID}" ] && kill ${CHECKPOINT_PID} 2>/dev/null || true

    # Clear manifest (releases file locks)

    # Stop command polling
    stop_command_polling
    coordination_clear_manifest

    # Stop heartbeat loop and check out from coordination service
    stop_heartbeat_loop
    coordination_checkout
}
trap cleanup_on_exit EXIT

# =============================================================================
# Provider-Specific AI Agent Execution
# =============================================================================
# Dispatch to the appropriate AI provider based on WORKER_PROVIDER environment variable
# Each provider outputs the same standard markers (::result::, ::pr_url::, ::input_tokens::, etc.)

case "$WORKER_PROVIDER" in
    anthropic)
        # Anthropic Claude Code CLI
        # Pipeline: claude (JSON output) -> tee (save raw output) -> log-parser (extract & post logs)
        #
        # CRITICAL: This pipeline is the ONLY way logs appear in the dashboard.
        # - --output-format stream-json: Claude outputs structured JSON events
        # - tee: Saves raw output for marker parsing after completion
        # - log-parser.cjs: Extracts readable content and POSTs to /api/control-center/logs
        post_log "system" "Invoking Anthropic Claude Code CLI..."
        claude \
            --print \
            --verbose \
            --dangerously-skip-permissions \
            --model "${CLAUDE_MODEL:-sonnet}" \
            --output-format stream-json \
            "${PROMPT}" \
            2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?
        ;;

    ollama|openai|gemini|google|groq|mistral|xai|grok|azure)
        # =============================================================================
        # Unified LangGraph ReAct Executor
        # =============================================================================
        # All non-Anthropic providers use the unified langgraph-executor.py
        # This provides consistent behavior across providers with:
        # - Structured Thought -> Action -> Observation loop
        # - State management for test result caching
        # - Edit failure recovery and guidance
        # - Bash command loop detection
        #
        # Supported providers:
        #   ollama   - Local models via Ollama (llama3.1, qwen2.5-coder, etc.)
        #   openai   - OpenAI API (gpt-4o, gpt-4-turbo, etc.)
        #   gemini   - Google Gemini (gemini-1.5-pro, etc.)
        #   google   - Alias for gemini
        #   groq     - Groq fast inference (llama-3.1-70b-versatile, etc.)
        #   mistral  - Mistral AI (mistral-large-latest, etc.)
        #   xai/grok - Elon Musk's Grok (grok-2, grok-2-mini, etc.)
        #   azure    - Azure OpenAI (deployments)
        #
        post_log "system" "Invoking LangGraph ReAct executor..."
        post_log "system" "Provider: ${WORKER_PROVIDER}"
        post_log "system" "Model: ${WORKER_MODEL:-auto}"

        # Write prompt to a temp file to avoid shell escaping issues
        PROMPT_FILE="/tmp/agent_prompt.txt"
        echo "${PROMPT}" > "${PROMPT_FILE}"

        # -u flag disables Python stdout buffering for real-time log streaming
        python3 -u /app/agents/langgraph-executor.py \
            --provider "${WORKER_PROVIDER}" \
            --model "${WORKER_MODEL:-}" \
            --prompt-file "${PROMPT_FILE}" \
            2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?
        ;;

    *)
        post_log "error" "ERROR: Unknown provider: ${WORKER_PROVIDER}" "error"
        post_log "error" "Supported providers: anthropic, ollama, openai, gemini, groq, mistral, azure" "error"
        echo "::result::error_unknown_provider"
        EXIT_CODE=1
        ;;
esac

# Show any stderr output for debugging
if [ -s "${STDERR_FILE}" ]; then
    echo "[Agent STDERR]:"
    cat "${STDERR_FILE}"
fi

echo ""
post_log "system" "AI agent completed with exit code: ${EXIT_CODE}"

# Save failure context to checkpoint for smarter retries
# This allows the next attempt to understand WHY it failed and try a different approach
if [ "${EXIT_CODE}" -ne 0 ] && [ "${CHECKPOINT_ENABLED:-true}" = "true" ]; then
    # Extract last 20 lines of output as failure context
    FAILURE_CONTEXT=$(tail -20 "${OUTPUT_FILE}" 2>/dev/null | head -c 1000 || echo "No output captured")
    STDERR_CONTEXT=$(tail -10 "${STDERR_FILE}" 2>/dev/null | head -c 500 || echo "")

    checkpoint_update "stage" "failed" 2>/dev/null || true
    checkpoint_update "exitCode" "${EXIT_CODE}" 2>/dev/null || true
    checkpoint_update "failureReason" "Agent exited with code ${EXIT_CODE}" 2>/dev/null || true
    checkpoint_update "lastOutput" "${FAILURE_CONTEXT}" 2>/dev/null || true
    if [ -n "${STDERR_CONTEXT}" ]; then
        checkpoint_update "lastError" "${STDERR_CONTEXT}" 2>/dev/null || true
    fi
    checkpoint_save 2>/dev/null || true
    post_log "system" "Failure context saved to checkpoint for retry"
fi

# Parse output for markers
# Note: Markers may appear in JSON strings with \n literals, so extract only the value
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    # Extract URL and stop at whitespace, literal \n, or end of line
    PR_URL=$(grep "::pr_url::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::pr_url::${PR_URL}"
fi

if grep -q "::pr_number::" "${OUTPUT_FILE}"; then
    # Extract number and stop at whitespace, literal \n, or end of line
    PR_NUMBER=$(grep "::pr_number::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_number:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::pr_number::${PR_NUMBER}"
fi

if grep -q "::branch::" "${OUTPUT_FILE}"; then
    # Extract branch and stop at whitespace, literal \n, or end of line
    BRANCH=$(grep "::branch::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::branch:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::branch::${BRANCH}"
fi

# Output token counts if available
if grep -q "::input_tokens::" "${OUTPUT_FILE}"; then
    echo "$(grep '::input_tokens::' "${OUTPUT_FILE}" | head -1)"
fi

if grep -q "::output_tokens::" "${OUTPUT_FILE}"; then
    echo "$(grep '::output_tokens::' "${OUTPUT_FILE}" | head -1)"
fi

# Determine final result based on agent output
FINAL_RESULT=""

# Check if PR was created - either via marker or natural language output
# IMPORTANT: Only trust PR URLs that match the actual target repo
PR_CREATED=false
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    # Extract the URL from the marker and validate it's for the correct repo
    DETECTED_PR_URL=$(grep '::pr_url::' "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://')

    # Check for obvious placeholder URLs that models hallucinate
    IS_PLACEHOLDER=false
    if echo "${DETECTED_PR_URL}" | grep -qiE "(owner/repo|your-|example|placeholder|test-repo|my-repo)"; then
        IS_PLACEHOLDER=true
        post_log "system" "[error] Agent hallucinated a PLACEHOLDER PR URL: ${DETECTED_PR_URL}"
        post_log "system" "[error] This is a common model failure - the PR was never actually created"
    elif echo "${DETECTED_PR_URL}" | grep -qE "/pull/123$"; then
        # /pull/123 is a common example number used in documentation
        IS_PLACEHOLDER=true
        post_log "system" "[error] Agent output suspicious PR URL ending in /pull/123: ${DETECTED_PR_URL}"
        post_log "system" "[error] PR #123 is a common documentation example - likely hallucinated"
    fi

    if [ "${IS_PLACEHOLDER}" = "false" ] && echo "${DETECTED_PR_URL}" | grep -qE "github\.com/${GITHUB_REPO}/pull/[0-9]+"; then
        PR_CREATED=true
        PR_URL="${DETECTED_PR_URL}"
        PR_NUMBER=$(echo "${DETECTED_PR_URL}" | grep -oE "[0-9]+$")
        post_log "system" "Validated PR URL from marker: ${PR_URL}"
    elif [ "${IS_PLACEHOLDER}" = "false" ]; then
        post_log "system" "[warning] Agent output invalid PR URL (wrong repo): ${DETECTED_PR_URL}"
        post_log "system" "[warning] Expected repo: ${GITHUB_REPO}"
    fi
elif grep -qE "github\.com/${GITHUB_REPO}/pull/[0-9]+" "${OUTPUT_FILE}"; then
    # Extract PR URL from natural language output - ONLY match the actual target repo
    # This prevents matching example URLs like "github.com/owner/repo/pull/123" from documentation
    DETECTED_PR_URL=$(grep -oE "https://github\.com/${GITHUB_REPO}/pull/[0-9]+" "${OUTPUT_FILE}" | head -1)
    if [ -n "${DETECTED_PR_URL}" ]; then
        PR_CREATED=true
        PR_URL="${DETECTED_PR_URL}"
        DETECTED_PR_NUMBER=$(echo "${DETECTED_PR_URL}" | grep -oE "[0-9]+$")
        if [ -n "${DETECTED_PR_NUMBER}" ]; then
            PR_NUMBER="${DETECTED_PR_NUMBER}"
        fi
        post_log "system" "Detected PR from output: ${PR_URL}"
    fi
fi

# =============================================================================
# WORKFLOW VALIDATION: Ensure all steps completed regardless of agent behavior
# This catches cases where agent exits early or claims completion prematurely
# =============================================================================
if [ "${EXIT_CODE}" -eq 0 ]; then
    post_log "system" "[validation] Verifying workflow completion..."

    # Step 1: Check for uncommitted changes and commit them
    UNCOMMITTED_CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    if [ "${UNCOMMITTED_CHANGES}" -gt 0 ]; then
        post_log "system" "[validation] Found ${UNCOMMITTED_CHANGES} uncommitted changes - committing..."
        git add -A
        git commit -m "feat(${JIRA_ISSUE_KEY}): Auto-commit from validation

Changes detected after agent completed but were not committed.
Ticket: ${JIRA_ISSUE_KEY}

Co-Authored-By: Claude <noreply@anthropic.com>" 2>&1 || true
    fi

    # Step 2: Check if branch has commits beyond main (i.e., work was done)
    # Check commits ahead of BASE_BRANCH (TARGET_BRANCH for feature branch workflow, or main)
    COMMITS_AHEAD=$(git rev-list --count "origin/${BASE_BRANCH}..HEAD" 2>/dev/null || echo "0")
    if [ "${COMMITS_AHEAD}" -gt 0 ]; then
        post_log "system" "[validation] Branch has ${COMMITS_AHEAD} commit(s) ahead of main"

        # Step 3: Check if branch is pushed to remote
        REMOTE_REF=$(git ls-remote --heads origin "${BRANCH_NAME}" 2>/dev/null | wc -l)
        if [ "${REMOTE_REF}" -eq 0 ]; then
            post_log "system" "[validation] Branch not pushed to remote - pushing now..."
            git push -u origin "${BRANCH_NAME}" 2>&1 || true
        else
            post_log "system" "[validation] Branch already pushed to remote"
        fi

        # Step 4: Check if PR exists for this branch (if not already detected)
        if [ "${PR_CREATED}" = "false" ]; then
            EXISTING_PR=$(gh pr list --head "${BRANCH_NAME}" --json number,url -q '.[0]' 2>/dev/null || echo "")
            if [ -n "${EXISTING_PR}" ] && [ "${EXISTING_PR}" != "null" ]; then
                # PR already exists
                PR_NUMBER=$(echo "${EXISTING_PR}" | jq -r '.number' 2>/dev/null || echo "")
                PR_URL=$(echo "${EXISTING_PR}" | jq -r '.url' 2>/dev/null || echo "")
                if [ -n "${PR_NUMBER}" ] && [ "${PR_NUMBER}" != "null" ]; then
                    PR_CREATED=true
                    post_log "system" "[validation] Found existing PR #${PR_NUMBER}: ${PR_URL}"
                fi
            fi
        fi

        # Step 5: Create PR if none exists
        if [ "${PR_CREATED}" = "false" ]; then
            post_log "system" "[validation] No PR found - creating PR to ${BASE_BRANCH}..."
            PR_OUTPUT=$(gh pr create \
                --title "${JIRA_ISSUE_KEY}: ${JIRA_SUMMARY}" \
                --body "## Summary
Auto-generated PR by WorkerMill validation.

Ticket: ${JIRA_ISSUE_KEY}
Target: ${BASE_BRANCH}

🤖 Generated with WorkerMill" \
                --head "${BRANCH_NAME}" \
                --base "${BASE_BRANCH}" 2>&1) || true

            if echo "${PR_OUTPUT}" | grep -q "github.com"; then
                PR_URL=$(echo "${PR_OUTPUT}" | grep -oE "https://github\.com/[^/]+/[^/]+/pull/[0-9]+" | head -1)
                PR_NUMBER=$(echo "${PR_URL}" | grep -oE "[0-9]+$")
                PR_CREATED=true
                post_log "system" "[validation] Created PR #${PR_NUMBER}: ${PR_URL}"
            elif echo "${PR_OUTPUT}" | grep -q "already exists"; then
                post_log "system" "[validation] PR already exists (race condition handled)"
                # Try to get the PR info again
                EXISTING_PR=$(gh pr list --head "${BRANCH_NAME}" --json number,url -q '.[0]' 2>/dev/null || echo "")
                if [ -n "${EXISTING_PR}" ]; then
                    PR_NUMBER=$(echo "${EXISTING_PR}" | jq -r '.number' 2>/dev/null || echo "")
                    PR_URL=$(echo "${EXISTING_PR}" | jq -r '.url' 2>/dev/null || echo "")
                    PR_CREATED=true
                fi
            fi
        fi
    else
        post_log "system" "[validation] No commits ahead of main - no changes to push"
    fi

    post_log "system" "[validation] Workflow validation complete. PR_CREATED=${PR_CREATED}"

    # Post context about workflow completion for siblings
    if [ "${PR_CREATED}" = "true" ] && [ -n "${PARENT_TASK_ID}" ]; then
        post_context "completion" "PR created: ${PR_URL}" "{\"prUrl\": \"${PR_URL}\", \"prNumber\": ${PR_NUMBER:-null}}"
    fi
fi

if [ "${EXIT_CODE}" -eq 0 ]; then
    # IMPORTANT: Only check the LAST 100 lines for result markers
    # The full output includes AGENTS.md which has example markers like ::result::deployed
    # We need to find the ACTUAL result the worker output, not documentation examples
    LAST_OUTPUT=$(tail -100 "${OUTPUT_FILE}")

    if echo "${LAST_OUTPUT}" | grep -q "::result::deployed"; then
        FINAL_RESULT="deployed"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::review_requested"; then
        FINAL_RESULT="review_requested"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::escalated"; then
        # Agent needs clarification - unclear requirements or blocked
        FINAL_RESULT="escalated"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::no_changes" && [ "${PR_CREATED}" = "true" ]; then
        # Claude said no_changes but we auto-created a PR for uncommitted files
        FINAL_RESULT="review_requested"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::no_changes"; then
        FINAL_RESULT="no_changes"
    else
        # Fallback based on context
        if [ "$IS_DEPLOYMENT_RUN" = true ]; then
            # Second run after approval - deployed
            FINAL_RESULT="deployed"
        elif [ "${DEPLOYMENT_ENABLED}" = "true" ] && [ "${PR_CREATED}" = "true" ]; then
            # Has deploy label, agent deployed and merged - deployed
            FINAL_RESULT="deployed"
        elif [ "${PR_CREATED}" = "true" ]; then
            # PR created, waiting for approval - review_requested
            FINAL_RESULT="review_requested"
        elif [ "${COMMITS_AHEAD:-0}" = "0" ]; then
            # No result marker, no PR, no commits - agent failed to make any changes
            # This catches: Ollama down, tool call parsing failures, silent agent failures
            post_log "system" "[validation] Agent exited without making changes - marking as failed"
            FINAL_RESULT="failed"
        else
            # Has commits but no PR and no result marker - something went wrong
            post_log "system" "[validation] Agent made commits but no PR/result - marking as failed"
            FINAL_RESULT="failed"
        fi
    fi
else
    FINAL_RESULT="failed"
fi
echo "::result::${FINAL_RESULT}"

# Post result markers to database for orchestrator backup detection
# These markers allow monitorExecutingTasks() to detect completion if worker-complete fails
post_log "system" "::result::${FINAL_RESULT}" "info"
if [ -n "${PR_URL}" ]; then
    post_log "system" "::pr_url::${PR_URL}" "info"
fi
if [ -n "${PR_NUMBER}" ]; then
    post_log "system" "::pr_number::${PR_NUMBER}" "info"
fi

# Post human-readable completion log
if [ "${FINAL_RESULT}" = "failed" ]; then
    post_log "status_change" "Task failed with exit code ${EXIT_CODE}" "error"
else
    post_log "status_change" "Task completed with result: ${FINAL_RESULT}" "info"
fi

# Update Jira ticket on completion
if [ -n "${JIRA_BASE_URL}" ] && [ -n "${JIRA_EMAIL}" ] && [ -n "${JIRA_API_TOKEN}" ]; then
    post_log "system" "Updating Jira ticket..."

    # Handle based on result
    if [ "${FINAL_RESULT}" = "deployed" ]; then
        export COMMENT="[${PERSONA_DISPLAY}] Task deployed successfully. Model: ${CLAUDE_MODEL:-sonnet}"
        if [ -n "${PR_URL}" ]; then
            export COMMENT="${COMMENT}. PR: ${PR_URL}"
        fi
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Done"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "review_requested" ]; then
        export COMMENT="[${PERSONA_DISPLAY}] PR created, awaiting review. PR: ${PR_URL}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Review Requested"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "escalated" ]; then
        # Escalated: Add comment but do NOT transition Jira - ticket stays "In Progress"
        # The WorkerMill task will show "Escalated" status, but Jira stays in progress for visibility
        export COMMENT="[${PERSONA_DISPLAY}] Task escalated - needs clarification. Model: ${CLAUDE_MODEL:-sonnet}. Please review the ticket and provide additional context."
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        # No transition - ticket remains in "In Progress" in Jira

    elif [ "${FINAL_RESULT}" = "no_changes" ]; then
        # Agent explicitly said no changes needed (legitimate scenario)
        export COMMENT="[${PERSONA_DISPLAY}] No changes required. Model: ${CLAUDE_MODEL:-sonnet}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Done"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "failed" ]; then
        export COMMENT="[${PERSONA_DISPLAY}] Task failed. Model: ${CLAUDE_MODEL:-sonnet}. Exit code: ${EXIT_CODE}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
    fi
fi

# Extract token counts from JSON output
# The stream-json output contains usage data in the final message event
# log-parser.cjs also reports tokens to the API, but we extract here for Jira comments
INPUT_TOKENS="0"
OUTPUT_TOKENS="0"
CACHE_CREATION_TOKENS="0"
CACHE_READ_TOKENS="0"

if [ -f "${OUTPUT_FILE}" ] && [ -s "${OUTPUT_FILE}" ]; then
    # Get the last line which typically contains the final usage stats
    LAST_LINE=$(tail -1 "${OUTPUT_FILE}" 2>/dev/null)

    # Parse usage from JSON (handles both .usage and .message.usage paths)
    INPUT_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.input_tokens // .message.usage.input_tokens // 0' 2>/dev/null || echo "0")
    OUTPUT_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.output_tokens // .message.usage.output_tokens // 0' 2>/dev/null || echo "0")
    CACHE_CREATION_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.cache_creation_input_tokens // .message.usage.cache_creation_input_tokens // 0' 2>/dev/null || echo "0")
    CACHE_READ_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.cache_read_input_tokens // .message.usage.cache_read_input_tokens // 0' 2>/dev/null || echo "0")

    # Handle null values from jq
    [ "${INPUT_TOKENS}" = "null" ] && INPUT_TOKENS=0
    [ "${OUTPUT_TOKENS}" = "null" ] && OUTPUT_TOKENS=0
    [ "${CACHE_CREATION_TOKENS}" = "null" ] && CACHE_CREATION_TOKENS=0
    [ "${CACHE_READ_TOKENS}" = "null" ] && CACHE_READ_TOKENS=0

    if [ "${INPUT_TOKENS}" != "0" ]; then
        echo "[Tokens] Parsed from JSON: input=${INPUT_TOKENS}, output=${OUTPUT_TOKENS}, cache_creation=${CACHE_CREATION_TOKENS}, cache_read=${CACHE_READ_TOKENS}"
    fi

    # Fallback: Parse from text markers (::input_tokens::12345) if JSON parsing returned 0
    # This handles universal-agent.js output format
    if [ "${INPUT_TOKENS}" = "0" ]; then
        MARKER_INPUT=$(grep -o '::input_tokens::[0-9]*' "${OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::input_tokens:://')
        if [ -n "${MARKER_INPUT}" ] && [ "${MARKER_INPUT}" != "0" ]; then
            INPUT_TOKENS="${MARKER_INPUT}"
            echo "[Tokens] Parsed from markers: input=${INPUT_TOKENS}"
        fi
    fi
    if [ "${OUTPUT_TOKENS}" = "0" ]; then
        MARKER_OUTPUT=$(grep -o '::output_tokens::[0-9]*' "${OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::output_tokens:://')
        if [ -n "${MARKER_OUTPUT}" ] && [ "${MARKER_OUTPUT}" != "0" ]; then
            OUTPUT_TOKENS="${MARKER_OUTPUT}"
            echo "[Tokens] Parsed from markers: output=${OUTPUT_TOKENS}"
        fi
    fi
fi

post_log "system" "Token usage: input=${INPUT_TOKENS}, output=${OUTPUT_TOKENS}, cache_creation=${CACHE_CREATION_TOKENS}, cache_read=${CACHE_READ_TOKENS}"

# Report back to API if we have credentials
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    post_log "system" "Reporting completion to API..."

    # Build JSON payload using jq to handle escaping properly
    # Fallback to manual JSON construction if jq is not available
    if command -v jq >/dev/null 2>&1; then
        JSON_PAYLOAD=$(jq -n \
            --argjson exitCode "${EXIT_CODE:-0}" \
            --arg result "${FINAL_RESULT:-completed}" \
            --arg prUrl "$(echo "${PR_URL:-}" | tr -d '\r\n')" \
            --arg prNumber "$(echo "${PR_NUMBER:-}" | tr -d '\r\n')" \
            --arg branch "$(echo "${BRANCH_NAME:-}" | tr -d '\r\n')" \
            --argjson inputTokens "${INPUT_TOKENS:-0}" \
            --argjson outputTokens "${OUTPUT_TOKENS:-0}" \
            --argjson cacheCreationTokens "${CACHE_CREATION_TOKENS:-0}" \
            --argjson cacheReadTokens "${CACHE_READ_TOKENS:-0}" \
            '{
                exitCode: $exitCode,
                result: $result,
                prUrl: $prUrl,
                prNumber: (if $prNumber == "" then null else ($prNumber | tonumber) end),
                branch: $branch,
                inputTokens: $inputTokens,
                outputTokens: $outputTokens,
                cacheCreationTokens: $cacheCreationTokens,
                cacheReadTokens: $cacheReadTokens
            }'
        )
    else
        # Fallback: Manual JSON construction (less safe for special characters but functional)
        echo "[worker] WARNING: jq not found, using fallback JSON construction"
        verify_tool "jq" || true  # Log diagnostic info
        # Clean up values to prevent JSON injection
        CLEAN_PR_URL=$(echo "${PR_URL:-}" | tr -d '\r\n"' | sed 's/\\/\\\\/g')
        CLEAN_BRANCH=$(echo "${BRANCH_NAME:-}" | tr -d '\r\n"' | sed 's/\\/\\\\/g')
        CLEAN_PR_NUMBER="${PR_NUMBER:-}"
        # Build JSON manually
        if [ -n "${CLEAN_PR_NUMBER}" ] && [ "${CLEAN_PR_NUMBER}" != "null" ]; then
            PR_NUMBER_JSON="${CLEAN_PR_NUMBER}"
        else
            PR_NUMBER_JSON="null"
        fi
        JSON_PAYLOAD="{\"exitCode\":${EXIT_CODE:-0},\"result\":\"${FINAL_RESULT:-completed}\",\"prUrl\":\"${CLEAN_PR_URL}\",\"prNumber\":${PR_NUMBER_JSON},\"branch\":\"${CLEAN_BRANCH}\",\"inputTokens\":${INPUT_TOKENS:-0},\"outputTokens\":${OUTPUT_TOKENS:-0},\"cacheCreationTokens\":${CACHE_CREATION_TOKENS:-0},\"cacheReadTokens\":${CACHE_READ_TOKENS:-0}}"
    fi

    # Retry completion reporting up to 3 times with exponential backoff
    # This is critical - if we can't report completion, the task will be stuck
    COMPLETION_REPORTED=false
    MAX_RETRIES=3
    RETRY_DELAY=2

    for ATTEMPT in $(seq 1 $MAX_RETRIES); do
        HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/completion-response.txt \
            --connect-timeout 10 \
            --max-time 30 \
            -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/worker-complete" \
            -H "x-api-key: ${ORG_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "${JSON_PAYLOAD}" 2>&1)
        RESPONSE=$(cat /tmp/completion-response.txt 2>/dev/null || echo "")

        if [ "$HTTP_CODE" = "200" ]; then
            post_log_sync "system" "Completion reported successfully (attempt ${ATTEMPT}): ${RESPONSE}"
            COMPLETION_REPORTED=true
            break
        else
            post_log_sync "error" "Attempt ${ATTEMPT}/${MAX_RETRIES} failed (HTTP ${HTTP_CODE}): ${RESPONSE}" "error"
            if [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; then
                post_log_sync "system" "Retrying in ${RETRY_DELAY} seconds..."
                sleep $RETRY_DELAY
                RETRY_DELAY=$((RETRY_DELAY * 2))
            fi
        fi
    done

    if [ "$COMPLETION_REPORTED" = "false" ]; then
        post_log_sync "error" "CRITICAL: Failed to report completion after ${MAX_RETRIES} attempts. Task will be recovered by orchestrator." "error"
        # Exit with error so ECS records task as failed, triggering faster recovery
        post_log_sync "system" "Done (completion reporting failed)."
        exit 1
    fi
fi

post_log_sync "system" "Done."
exit ${EXIT_CODE}
