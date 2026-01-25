***REMOVED***!/bin/bash
set -e

***REMOVED*** WorkerMill AI Worker Entrypoint
***REMOVED*** This script runs Claude Code CLI to execute AI agent tasks

***REMOVED*** API base URL for posting logs (exported for subshells)
export API_BASE="${API_BASE_URL:-https://workermill.com}"


***REMOVED*** Parent task ID for multi-story orchestration (set by orchestrator for child tasks)
export PARENT_TASK_ID="${PARENT_TASK_ID:-}"
***REMOVED*** PRD child task flag: when true, merge to feature branch without deploying
export PRD_CHILD_TASK="${PRD_CHILD_TASK:-false}"
***REMOVED*** =============================================================================
***REMOVED*** Load Checkpoint Library
***REMOVED*** =============================================================================
CHECKPOINT_LIB="/app/lib/checkpoint.sh"
if [ -f "${CHECKPOINT_LIB}" ]; then
    source "${CHECKPOINT_LIB}"
else
    echo "[warning] Checkpoint library not found at ${CHECKPOINT_LIB}"
fi

***REMOVED*** Format persona name for display (backend_developer -> Backend Developer)
format_persona() {
    echo "$1" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g'
}
PERSONA_DISPLAY=$(format_persona "${WORKER_PERSONA}")

***REMOVED*** =============================================================================
***REMOVED*** Worker Coordination Functions
***REMOVED*** =============================================================================
***REMOVED*** These functions enable multi-worker coordination via the WorkerMill API.
***REMOVED*** Workers check in when starting, send heartbeats periodically, and check out
***REMOVED*** when finishing. This allows detection of concurrent workers on the same repo.

***REMOVED*** PID for the heartbeat background process
HEARTBEAT_PID=""

***REMOVED*** Generate a unique worker ID from ECS task ID or fallback to hostname+pid
WORKER_ID="${ECS_TASK_ID:-${HOSTNAME:-worker}-$$}"

***REMOVED*** Check in with the coordination service
***REMOVED*** Called once after cloning the repo to announce worker presence
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

        ***REMOVED*** Check for conflicts (other workers on same repo)
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

***REMOVED*** Send a heartbeat to indicate the worker is still alive
***REMOVED*** Updates the current status and optionally the file being worked on
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

***REMOVED*** Background heartbeat loop - sends heartbeats every 30 seconds
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

***REMOVED*** Stop the heartbeat background process
stop_heartbeat_loop() {
    if [ -n "${HEARTBEAT_PID}" ]; then
        kill "${HEARTBEAT_PID}" 2>/dev/null || true
        echo "[coordination] Stopped heartbeat loop"
        HEARTBEAT_PID=""
    fi
}

***REMOVED*** =============================================================================
***REMOVED*** Background Context Polling for Real-Time Sibling Updates
***REMOVED*** =============================================================================
***REMOVED*** Polls for context messages from sibling workers in multi-story PRD workflows.
***REMOVED*** Writes new context to /tmp/sibling_context.log for Claude to read.

CONTEXT_POLL_PID=""

start_context_polling() {
    if [ -z "${PARENT_TASK_ID}" ]; then
        echo "[context] Skipping context polling - not a multi-story task"
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[context] Skipping context polling - missing credentials"
        return 0
    fi

    echo "[context] Starting sibling context polling..."

    (
        local last_check=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        while true; do
            sleep 15  ***REMOVED*** Poll every 15 seconds

            local response
            response=$(curl -s --connect-timeout 5 --max-time 10 \
                -X GET "${API_BASE_URL}/api/coordination/context/${PARENT_TASK_ID}?since=${last_check}" \
                -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

            local count
            count=$(echo "$response" | jq -r '.count // 0' 2>/dev/null || echo "0")

            if [ "$count" -gt 0 ]; then
                echo "[context] Received ${count} new sibling updates"
                ***REMOVED*** Write to temp file for Claude to potentially read
                echo "$response" | jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"' >> /tmp/sibling_context.log 2>/dev/null

                ***REMOVED*** Special handling for questions - write to dedicated file
                ***REMOVED*** This allows Claude to easily check for pending questions
                local questions
                questions=$(echo "$response" | jq -r ".contexts[] | select(.messageType == \"question\") | select(.taskId != \"${TASK_ID}\") | \"[\(.persona)] Q: \(.content) (id: \(.id))\"" 2>/dev/null)
                if [ -n "$questions" ]; then
                    echo "[qa] New question(s) from siblings detected!"
                    echo "--- New questions at $(date -u +%Y-%m-%dT%H:%M:%SZ) ---" >> /tmp/sibling_questions.log
                    echo "$questions" >> /tmp/sibling_questions.log
                fi
            fi

            last_check=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        done
    ) &
    CONTEXT_POLL_PID=$!
    echo "[context] Started context polling (PID: ${CONTEXT_POLL_PID})"
}

stop_context_polling() {
    if [ -n "${CONTEXT_POLL_PID}" ]; then
        kill "${CONTEXT_POLL_PID}" 2>/dev/null || true
        echo "[context] Stopped context polling"
        CONTEXT_POLL_PID=""
    fi
}

***REMOVED*** Check out from the coordination service
***REMOVED*** Called when the worker is finishing (in cleanup handler)
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

***REMOVED*** Get list of active workers on the same repository
***REMOVED*** Useful for Claude to check before editing conflicting files
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

***REMOVED*** =============================================================================
***REMOVED*** Git Manifest Functions
***REMOVED*** =============================================================================
***REMOVED*** The manifest system allows workers to declare intent to modify files BEFORE
***REMOVED*** they start editing. This prevents merge conflicts when multiple workers
***REMOVED*** operate on the same repository.

***REMOVED*** Declare a manifest of files this worker intends to modify
***REMOVED*** Called after analyzing/planning phase but before making actual edits
***REMOVED*** Arguments:
***REMOVED***   $1 - JSON array of file paths to modify (e.g., '["src/api/index.ts", "package.json"]')
***REMOVED*** Returns:
***REMOVED***   0 if successful (no conflicts, locks acquired)
***REMOVED***   1 if conflicts exist (check response for details)
***REMOVED***   2 if API call failed
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
        ***REMOVED*** Conflicts detected
        echo "[manifest] WARNING: Conflicts detected with other workers"
        local conflicts
        conflicts=$(echo "$body" | jq -c '.conflicts' 2>/dev/null || echo "[]")
        echo "[manifest] Conflicting files: ${conflicts}"

        ***REMOVED*** Output conflict details for Claude to process
        echo "$body" | jq -r '.conflicts[] | "  - \(.filePath) locked by task \(.heldBy.taskId) until \(.heldBy.expiresAt)"' 2>/dev/null || true
        return 1
    else
        echo "[manifest] Failed to declare manifest (HTTP ${http_code}): ${body}"
        return 2
    fi
}

***REMOVED*** Get existing manifests for the repository
***REMOVED*** Use this to check what files other workers are modifying before planning
***REMOVED*** Arguments:
***REMOVED***   $1 - (optional) branch to filter by
***REMOVED*** Returns:
***REMOVED***   JSON array of manifests
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

***REMOVED*** Clear this worker's manifest (releases all file locks)
***REMOVED*** Called automatically on exit, but can be called early if worker
***REMOVED*** decides not to modify certain files
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

***REMOVED*** =============================================================================
***REMOVED*** Simplified Manifest Declaration for Claude's Use
***REMOVED*** =============================================================================
***REMOVED*** These are simplified wrappers that Claude can call directly in its prompt.
***REMOVED*** They provide cleaner output and easier usage compared to the full coordination functions.

***REMOVED*** Declare files this worker intends to modify
***REMOVED*** Called after Claude's planning phase to lock files
***REMOVED*** Arguments:
***REMOVED***   $1 - JSON array of file paths (e.g., '["src/api/index.ts", "package.json"]')
***REMOVED*** Returns:
***REMOVED***   0 if successful (locks acquired)
***REMOVED***   1 if conflicts exist (another worker has locked these files)
declare_work_manifest() {
    local files_json="$1"

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[manifest] Skipping - missing credentials"
        return 0
    fi

    if [ -z "${files_json}" ] || [ "${files_json}" = "[]" ]; then
        echo "[manifest] No files to declare"
        return 0
    fi

    echo "[manifest] Declaring intent to modify: ${files_json}"

    local response
    local http_code

    response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 30 \
        -X POST "${API_BASE_URL}/api/coordination/manifest/declare" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"taskId\": \"${TASK_ID}\",
            \"repo\": \"${GITHUB_REPO}\",
            \"branch\": \"${BRANCH_NAME}\",
            \"filesToModify\": ${files_json}
        }" 2>/dev/null)

    http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        local locks=$(echo "$body" | jq -r '.locksAcquired | length // 0' 2>/dev/null)
        echo "[manifest] Successfully acquired ${locks} file locks"
        return 0
    elif [ "$http_code" = "409" ]; then
        echo "[manifest] CONFLICT: Another worker is modifying these files"
        echo "$body" | jq -r '.conflicts[] | "  - \(.filePath) locked by \(.heldBy.taskId)"' 2>/dev/null
        return 1
    else
        echo "[manifest] Warning: Could not declare manifest (HTTP ${http_code})"
        return 0  ***REMOVED*** Non-fatal, continue anyway
    fi
}

***REMOVED*** Wait for a file lock to be released by another worker
***REMOVED*** Use this when you encounter a CONFLICT and want to wait for the file to become available
***REMOVED*** Arguments:
***REMOVED***   $1 - File path to wait for
***REMOVED*** Returns:
***REMOVED***   0 if file became available
***REMOVED***   1 if timeout (5 minutes)
wait_for_file_lock() {
    local file_path="$1"
    local max_wait=300  ***REMOVED*** 5 minutes
    local waited=0

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[manifest] Cannot wait for lock - missing credentials"
        return 0
    fi

    echo "[manifest] Waiting for file lock on: ${file_path}"

    while [ $waited -lt $max_wait ]; do
        local locks=$(curl -s "${API_BASE_URL}/api/coordination/locks?repo=${GITHUB_REPO}" \
            -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

        local is_locked=$(echo "$locks" | jq -r ".locks[] | select(.filePath == \"${file_path}\") | .taskId" 2>/dev/null)

        if [ -z "$is_locked" ]; then
            echo "[manifest] File ${file_path} is now available"
            return 0
        fi

        echo "[manifest] Waiting for ${file_path} (held by ${is_locked})..."
        sleep 10
        waited=$((waited + 10))
    done

    echo "[manifest] Timeout waiting for ${file_path}"
    return 1
}

***REMOVED*** =============================================================================
***REMOVED*** Worker Context Posting (Multi-Worker Coordination)
***REMOVED*** =============================================================================
***REMOVED*** Posts context messages to API for sibling workers to see.
***REMOVED*** Only active when PARENT_TASK_ID is set (multi-story orchestration).

***REMOVED*** =============================================================================
***REMOVED*** Inter-Worker Q&A Functions
***REMOVED*** =============================================================================
***REMOVED*** These functions enable structured question/answer flow between sibling workers
***REMOVED*** in multi-story PRD workflows. One worker can ask a question and wait for
***REMOVED*** another worker to answer it.

***REMOVED*** Ask a question to sibling workers
***REMOVED*** Usage: question_id=$(ask_siblings "What API endpoint should I use for auth?")
***REMOVED*** Returns: Question ID that can be used to check for answers
ask_siblings() {
    local question="$1"
    local timeout="${2:-300}"  ***REMOVED*** Default 5 min timeout

    if [ -z "${PARENT_TASK_ID}" ]; then
        echo "[qa] Not in multi-story workflow, cannot ask siblings" >&2
        return 1
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[qa] Missing API credentials" >&2
        return 1
    fi

    echo "[qa] Asking siblings: ${question}" >&2

    ***REMOVED*** Escape quotes in the question for JSON
    local escaped_question
    escaped_question=$(echo "$question" | sed 's/"/\\"/g' | tr -d '\n\r')

    local response
    response=$(curl -s --connect-timeout 10 --max-time 30 \
        -X POST "${API_BASE_URL}/api/coordination/context" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"parentTaskId\": \"${PARENT_TASK_ID}\",
            \"taskId\": \"${TASK_ID}\",
            \"persona\": \"${WORKER_PERSONA}\",
            \"messageType\": \"question\",
            \"content\": \"${escaped_question}\",
            \"metadata\": {\"timeout\": ${timeout}, \"answered\": false}
        }" 2>/dev/null)

    local question_id
    question_id=$(echo "$response" | jq -r '.context.id // empty' 2>/dev/null)

    if [ -n "$question_id" ] && [ "$question_id" != "null" ]; then
        echo "[qa] Question posted with ID: ${question_id}" >&2
        echo "$question_id"
        return 0
    else
        echo "[qa] Failed to post question: ${response}" >&2
        return 1
    fi
}

***REMOVED*** Wait for an answer to a question
***REMOVED*** Usage: answer=$(wait_for_answer "$question_id" 120)
***REMOVED*** Returns: The answer content, or empty on timeout
wait_for_answer() {
    local question_id="$1"
    local timeout="${2:-300}"
    local waited=0
    local poll_interval=10

    if [ -z "${PARENT_TASK_ID}" ]; then
        echo "[qa] Not in multi-story workflow" >&2
        return 1
    fi

    echo "[qa] Waiting for answer to question ${question_id}..." >&2

    while [ $waited -lt $timeout ]; do
        local response
        response=$(curl -s --connect-timeout 5 --max-time 10 \
            -X GET "${API_BASE_URL}/api/coordination/context/${PARENT_TASK_ID}?messageType=answer" \
            -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

        ***REMOVED*** Look for an answer that references our question
        local answer
        answer=$(echo "$response" | jq -r ".contexts[] | select(.metadata.questionId == \"${question_id}\") | .content" 2>/dev/null | head -1)

        if [ -n "$answer" ] && [ "$answer" != "null" ]; then
            echo "[qa] Received answer!" >&2
            echo "$answer"
            return 0
        fi

        sleep $poll_interval
        waited=$((waited + poll_interval))
        echo "[qa] Still waiting... (${waited}s/${timeout}s)" >&2
    done

    echo "[qa] Timeout waiting for answer" >&2
    return 1
}

***REMOVED*** Answer a sibling's question
***REMOVED*** Usage: answer_sibling "$question_id" "Use POST /api/auth/login"
answer_sibling() {
    local question_id="$1"
    local answer="$2"

    if [ -z "${PARENT_TASK_ID}" ]; then
        echo "[qa] Not in multi-story workflow" >&2
        return 1
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo "[qa] Missing API credentials" >&2
        return 1
    fi

    ***REMOVED*** Escape quotes in the answer for JSON
    local escaped_answer
    escaped_answer=$(echo "$answer" | sed 's/"/\\"/g' | tr -d '\n\r')

    echo "[qa] Answering question ${question_id}: ${answer:0:50}..." >&2

    curl -s --connect-timeout 10 --max-time 30 \
        -X POST "${API_BASE_URL}/api/coordination/context" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"parentTaskId\": \"${PARENT_TASK_ID}\",
            \"taskId\": \"${TASK_ID}\",
            \"persona\": \"${WORKER_PERSONA}\",
            \"messageType\": \"answer\",
            \"content\": \"${escaped_answer}\",
            \"metadata\": {\"questionId\": \"${question_id}\"}
        }" >/dev/null 2>&1

    echo "[qa] Answer posted" >&2
    return 0
}

***REMOVED*** Check for pending questions from siblings that this worker might answer
***REMOVED*** Usage: check_sibling_questions
***REMOVED*** Returns: List of unanswered questions from siblings
check_sibling_questions() {
    if [ -z "${PARENT_TASK_ID}" ]; then
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        return 0
    fi

    local response
    response=$(curl -s --connect-timeout 5 --max-time 10 \
        -X GET "${API_BASE_URL}/api/coordination/context/${PARENT_TASK_ID}?messageType=question" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    ***REMOVED*** Filter to questions NOT from this worker
    local questions
    questions=$(echo "$response" | jq -r ".contexts[] | select(.taskId != \"${TASK_ID}\") | \"[\(.persona)] Q: \(.content) (id: \(.id))\"" 2>/dev/null)

    if [ -n "$questions" ]; then
        echo "[qa] Pending questions from siblings:"
        echo "$questions"
    fi
}

***REMOVED*** Export Q&A functions for use in subshells
export -f ask_siblings
export -f wait_for_answer
export -f answer_sibling
export -f check_sibling_questions

***REMOVED*** Escape a string for safe inclusion in JSON
***REMOVED*** Handles: backslashes, quotes, newlines, tabs, carriage returns
json_escape() {
    local input="$1"
    ***REMOVED*** Use jq if available (most reliable), otherwise use sed
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$input" | jq -Rs '.' | sed 's/^"//;s/"$//'
    else
        printf '%s' "$input" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\r/\\r/g' | tr '\n' ' '
    fi
}

***REMOVED*** Post a context message for sibling workers
***REMOVED*** Arguments:
***REMOVED***   $1 - messageType: file_created|file_modified|decision|dependency|question|answer|completion|blocker|warning|progress
***REMOVED***   $2 - content: The message content
***REMOVED***   $3 - metadata (optional): JSON object with additional data
post_context() {
    local msg_type="$1"
    local content="$2"
    local metadata="${3:-null}"

    ***REMOVED*** Skip if not a multi-story task (no parent)
    if [ -z "${PARENT_TASK_ID}" ]; then
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        echo "[context] Skipping - missing API credentials"
        return 0
    fi

    ***REMOVED*** Escape content for JSON
    local escaped_content
    escaped_content=$(json_escape "$content")

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
            \"content\": \"${escaped_content}\",
            \"metadata\": ${metadata}
        }" >/dev/null 2>&1 &
}

***REMOVED*** Fetch context from sibling workers
***REMOVED*** Called on startup to get existing sibling context for prompt injection
fetch_sibling_context() {
    if [ -z "${PARENT_TASK_ID}" ]; then
        echo ""
        return 0
    fi

    if [ -z "${API_BASE_URL}" ] || [ -z "${ORG_API_KEY}" ]; then
        echo ""
        return 0
    fi

    echo "[context] Fetching sibling context for parent task ${PARENT_TASK_ID}..." >&2

    local response
    response=$(curl -s --connect-timeout 10 --max-time 30 \
        -X GET "${API_BASE_URL}/api/coordination/context/${PARENT_TASK_ID}" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    local count
    count=$(echo "$response" | jq -r '.count // 0' 2>/dev/null || echo "0")

    if [ "$count" -gt 0 ]; then
        echo "[context] Found ${count} context messages from siblings" >&2
        ***REMOVED*** Format context for prompt injection
        echo "$response" | jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"' 2>/dev/null
    else
        echo "[context] No sibling context available yet" >&2
        echo ""
    fi
}

***REMOVED*** =============================================================================
***REMOVED*** Worker Command Polling (Supervised Mode)
***REMOVED*** =============================================================================
***REMOVED*** Polls for commands from the dashboard in supervised mode.
***REMOVED*** Commands allow operators to pause, resume, or send messages to workers.

COMMAND_POLL_PID=""

***REMOVED*** Start background command polling loop
***REMOVED*** Only active when in supervised mode
start_command_polling() {
    ***REMOVED*** Check if supervised mode is enabled
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
            sleep 30  ***REMOVED*** Poll every 30 seconds

            ***REMOVED*** Fetch pending commands
            local response
            response=$(curl -s --connect-timeout 5 --max-time 10 \
                -X GET "${API_BASE_URL}/api/coordination/commands/${TASK_ID}/pending" \
                -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

            ***REMOVED*** Parse commands
            local cmd_count
            cmd_count=$(echo "$response" | jq -r '.commands | length' 2>/dev/null || echo "0")

            if [ "$cmd_count" -gt 0 ]; then
                echo "[commands] Received ${cmd_count} command(s)"

                ***REMOVED*** Process each command
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
                            ***REMOVED*** Questions would need Claude to respond - handled in agent loop
                            ;;
                    esac

                    ***REMOVED*** Acknowledge command
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

***REMOVED*** Stop command polling
stop_command_polling() {
    if [ -n "${COMMAND_POLL_PID}" ]; then
        kill "${COMMAND_POLL_PID}" 2>/dev/null || true
        echo "[commands] Stopped command polling"
        COMMAND_POLL_PID=""
    fi
}

***REMOVED*** Function to post log to API for real-time streaming
post_log() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    ***REMOVED*** Also echo to stdout for CloudWatch
    echo "[worker] $message"

    ***REMOVED*** Skip API call if credentials not available
    if [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        return 0
    fi

    ***REMOVED*** Post to API (fire and forget, don't block on failure)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 &
}

***REMOVED*** Synchronous version of post_log for critical messages that must be captured
***REMOVED*** before the script exits
post_log_sync() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    ***REMOVED*** Also echo to stdout for CloudWatch
    echo "[worker] $message"

    ***REMOVED*** Skip API call if credentials not available
    if [ -z "${ORG_API_KEY}" ] || [ -z "${TASK_ID}" ]; then
        return 0
    fi

    ***REMOVED*** Post to API synchronously (wait for completion)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 || true
}

***REMOVED*** Verify required tools are available
***REMOVED*** This helps diagnose issues where Kaniko might corrupt the filesystem
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

***REMOVED*** =============================================================================
***REMOVED*** SIGTERM Trap Handler for Spot Interruptions
***REMOVED*** =============================================================================
***REMOVED*** ECS Spot instances receive SIGTERM 2 minutes before termination.
***REMOVED*** This handler saves checkpoint state to enable resumption on retry.
handle_spot_interruption() {
    echo "[worker] SIGTERM received - Spot interruption detected"
    post_log_sync "system" "Spot interruption detected - saving checkpoint state" "warning"

    ***REMOVED*** Update checkpoint to mark interruption
    if [ "${CHECKPOINT_ENABLED:-true}" = "true" ]; then
        checkpoint_update "stage" "interrupted" 2>/dev/null || true
        checkpoint_update "lastAction" "Interrupted by Spot capacity reclaim" 2>/dev/null || true
        checkpoint_save 2>/dev/null || true
        echo "[worker] Checkpoint saved for resumption"
    fi

    ***REMOVED*** Stop heartbeat and check out from coordination
    stop_heartbeat_loop 2>/dev/null || true
    coordination_checkout 2>/dev/null || true

    post_log_sync "system" "Graceful shutdown complete - task will be retried" "warning"

    ***REMOVED*** Exit cleanly (exit 0) so ECS knows we handled SIGTERM gracefully
    ***REMOVED*** The orchestrator will detect Spot interruption via exit code 137 (SIGKILL after SIGTERM timeout)
    ***REMOVED*** or via the checkpoint stage="interrupted"
    exit 0
}

***REMOVED*** Register SIGTERM handler early (before any long-running operations)
trap handle_spot_interruption SIGTERM

echo "[worker] Verifying required tools..."
verify_tool "jq" || echo "[worker] CRITICAL: jq is required for JSON processing"
verify_tool "git"
verify_tool "gh"
verify_tool "aws"
verify_tool "node"
verify_tool "curl"
echo "[worker] PATH: $PATH"

***REMOVED*** =============================================================================
***REMOVED*** Initialize Checkpointing and Resume Detection
***REMOVED*** =============================================================================
checkpoint_init

***REMOVED*** Check if we're resuming from a previous run
RESUMING=false
RESUME_STAGE=""
RESUME_CONTEXT=""
RESUME_BRANCH=""
RESUME_COUNT=0

if [ "${CHECKPOINT_ENABLED:-true}" = "true" ] && [ -f "${CHECKPOINT_FILE:-/tmp/checkpoint.json}" ]; then
    RESUME_STAGE=$(checkpoint_get "stage" 2>/dev/null || echo "")
    RESUME_COUNT=$(checkpoint_get "resumeCount" 2>/dev/null || echo "0")

    ***REMOVED*** If resume count > 0, this is a resumed task
    if [ "${RESUME_COUNT}" != "0" ] && [ "${RESUME_COUNT}" != "null" ] && [ -n "${RESUME_COUNT}" ]; then
        RESUMING=true
        RESUME_BRANCH=$(checkpoint_get "branch" 2>/dev/null || echo "")

        ***REMOVED*** Build resume context from checkpoint
        RESUME_FILES_MODIFIED=$(checkpoint_get "filesModified" 2>/dev/null || echo "[]")
        RESUME_COMMITS=$(checkpoint_get "commits" 2>/dev/null || echo "[]")
        RESUME_LAST_ACTION=$(checkpoint_get "lastAction" 2>/dev/null || echo "")
        RESUME_TESTS_RUN=$(checkpoint_get "testsRun" 2>/dev/null || echo "false")
        RESUME_TESTS_PASSED=$(checkpoint_get "testsPassed" 2>/dev/null || echo "null")

        ***REMOVED*** Load failure context if previous run failed (not just interrupted)
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

***REMOVED*** Start background checkpoint sync (every 60 seconds)
***REMOVED*** This runs in the background and saves state periodically
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

***REMOVED*** Validate required environment variables
required_vars="TASK_ID JIRA_ISSUE_KEY JIRA_SUMMARY GITHUB_REPO WORKER_PERSONA GITHUB_TOKEN"
for var in $required_vars; do
    if [ -z "${!var}" ]; then
        post_log "error" "ERROR: Missing required environment variable: $var" "error"
        echo "::result::error_missing_env"
        exit 1
    fi
done

***REMOVED*** Validate provider-specific credentials
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
        ***REMOVED*** Universal agent uses GEMINI_API_KEY
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
    ai-sdk)
        ***REMOVED*** AI SDK multi-expert mode: validate credentials for the underlying provider
        ***REMOVED*** AI_SDK_UNDERLYING_PROVIDER specifies which provider the AI SDK should use
        post_log "system" "AI SDK mode: underlying provider is ${AI_SDK_UNDERLYING_PROVIDER:-anthropic}"
        case "${AI_SDK_UNDERLYING_PROVIDER:-anthropic}" in
            anthropic)
                if [ -z "${ANTHROPIC_API_KEY}" ]; then
                    post_log "error" "ERROR: ANTHROPIC_API_KEY required for AI SDK with anthropic" "error"
                    echo "::result::error_missing_env"
                    exit 1
                fi
                ;;
            openai)
                if [ -z "${OPENAI_API_KEY}" ]; then
                    post_log "error" "ERROR: OPENAI_API_KEY required for AI SDK with openai" "error"
                    echo "::result::error_missing_env"
                    exit 1
                fi
                ;;
            google|gemini)
                if [ -z "${GOOGLE_API_KEY}" ]; then
                    post_log "error" "ERROR: GOOGLE_API_KEY required for AI SDK with google/gemini" "error"
                    echo "::result::error_missing_env"
                    exit 1
                fi
                ;;
            ollama)
                if [ -z "${OLLAMA_HOST}" ]; then
                    post_log "warning" "WARNING: OLLAMA_HOST not set for AI SDK, using default: http://localhost:11434" "warning"
                fi
                ;;
            *)
                post_log "warning" "WARNING: Unknown underlying provider ${AI_SDK_UNDERLYING_PROVIDER}, proceeding anyway" "warning"
                ;;
        esac
        ;;
    *)
        post_log "error" "ERROR: Unknown provider: ${WORKER_PROVIDER}" "error"
        echo "::result::error_unknown_provider"
        exit 1
        ;;
esac

***REMOVED*** Configure git
post_log "system" "Configuring git..."
git config --global user.email "ai-worker@workermill.com"
git config --global user.name "WorkerMill AI"
git config --global credential.helper store

***REMOVED*** Configure GitHub CLI authentication
post_log "system" "Configuring GitHub authentication..."
echo "${GITHUB_TOKEN}" | gh auth login --with-token 2>/dev/null || true

***REMOVED*** Set up git credentials for HTTPS
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials

***REMOVED*** Extract repo info (format: owner/repo)
REPO_OWNER=$(echo "${GITHUB_REPO}" | cut -d'/' -f1)
REPO_NAME=$(echo "${GITHUB_REPO}" | cut -d'/' -f2)
REPO_URL="https://github.com/${GITHUB_REPO}.git"

***REMOVED*** Detect if this is a deployment run (second run after PR approval)
IS_DEPLOYMENT_RUN=false
if [[ "${TASK_NOTES}" == *"DEPLOYMENT_RUN"* ]] || [[ "${TASK_NOTES}" == *"PR_APPROVED"* ]]; then
    IS_DEPLOYMENT_RUN=true
    post_log "system" "DEPLOYMENT RUN detected - PR already approved, will deploy and merge"
fi

***REMOVED*** Create branch for this task (used in cloning and resume logic)
BRANCH_NAME="ai/${JIRA_ISSUE_KEY}"

***REMOVED*** Feature branch workflow: If TARGET_BRANCH is set (multi-story PRD), use it as the base
***REMOVED*** Workers branch from TARGET_BRANCH and create PRs back to TARGET_BRANCH
***REMOVED*** Final PR from TARGET_BRANCH to main is created by the orchestrator
BASE_BRANCH="${TARGET_BRANCH:-main}"
if [ -n "${TARGET_BRANCH}" ]; then
    post_log "system" "Feature branch workflow: will branch from and PR to ${TARGET_BRANCH}"
fi

***REMOVED*** =============================================================================
***REMOVED*** Sibling Change Synchronization (Multi-Story PRD Workflow)
***REMOVED*** =============================================================================
***REMOVED*** When multiple workers collaborate on related stories, they need to stay in sync.
***REMOVED*** These functions pull changes that sibling workers have pushed to the feature branch.

***REMOVED*** Pull latest changes from feature branch (includes sibling work)
pull_sibling_changes() {
    if [ -z "${TARGET_BRANCH}" ]; then
        return 0
    fi

    echo "[git] Checking for sibling changes on ${TARGET_BRANCH}..."

    ***REMOVED*** Fetch latest from remote
    git fetch origin "${TARGET_BRANCH}" 2>/dev/null || true

    ***REMOVED*** Check if feature branch has new commits
    local local_head=$(git rev-parse HEAD 2>/dev/null)
    local remote_head=$(git rev-parse "origin/${TARGET_BRANCH}" 2>/dev/null || echo "")

    if [ -n "${remote_head}" ] && [ "${local_head}" != "${remote_head}" ]; then
        echo "[git] Feature branch has new commits from siblings"

        ***REMOVED*** Try to merge sibling changes
        if git merge "origin/${TARGET_BRANCH}" --no-edit 2>/dev/null; then
            echo "[git] Successfully merged sibling changes"
            post_log "system" "Merged sibling changes from ${TARGET_BRANCH}"
        else
            echo "[git] Merge conflict with sibling changes - attempting rebase"
            git merge --abort 2>/dev/null || true

            if git rebase "origin/${TARGET_BRANCH}" 2>/dev/null; then
                echo "[git] Successfully rebased on sibling changes"
                post_log "system" "Rebased on sibling changes from ${TARGET_BRANCH}"
            else
                echo "[git] Rebase failed - will work on divergent branch"
                git rebase --abort 2>/dev/null || true
                post_log "warning" "Could not merge sibling changes - may have conflicts" "warning"
            fi
        fi
    else
        echo "[git] No new sibling changes to pull"
    fi
}

***REMOVED*** Sync with sibling changes (call during long tasks)
sync_with_siblings() {
    if [ -z "${TARGET_BRANCH}" ]; then
        return 0
    fi

    ***REMOVED*** Only sync if we have uncommitted changes saved
    local has_changes=$(git status --porcelain 2>/dev/null | wc -l)

    if [ "$has_changes" -gt 0 ]; then
        echo "[git] Stashing local changes before sync..."
        git stash push -m "auto-stash for sibling sync" 2>/dev/null || true
    fi

    pull_sibling_changes

    if [ "$has_changes" -gt 0 ]; then
        echo "[git] Restoring local changes..."
        git stash pop 2>/dev/null || true
    fi
}

***REMOVED*** Export functions for use in subshells
export -f pull_sibling_changes
export -f sync_with_siblings

***REMOVED*** =============================================================================
***REMOVED*** Repository Cloning / Resume Logic
***REMOVED*** =============================================================================
***REMOVED*** On resume: If we're past the cloning stage, skip clone and checkout existing branch
***REMOVED*** Stages in order: initialized -> cloning -> analyzing -> implementing -> testing -> committing -> pr_creating
SKIP_CLONE=false

if [ "$RESUMING" = true ]; then
    ***REMOVED*** Check if we've already cloned (stages after "initialized" mean we've cloned)
    case "${RESUME_STAGE}" in
        "analyzing"|"implementing"|"testing"|"committing"|"pr_creating")
            SKIP_CLONE=true
            ***REMOVED*** Use branch from checkpoint if available, otherwise use default
            if [ -n "${RESUME_BRANCH}" ] && [ "${RESUME_BRANCH}" != "null" ]; then
                BRANCH_NAME="${RESUME_BRANCH}"
            fi
            post_log "system" "RESUME: Skipping clone, will checkout existing branch ${BRANCH_NAME}"
            ;;
        "cloning"|"initialized"|*)
            ***REMOVED*** Need to clone fresh
            post_log "system" "RESUME: Stage is '${RESUME_STAGE}', will clone repository fresh"
            ;;
    esac
fi

cd /workspace

if [ "$SKIP_CLONE" = true ]; then
    ***REMOVED*** Resume: Clone fresh but checkout existing branch
    post_log "system" "Cloning repository ${GITHUB_REPO} for resume..."
    if ! git clone "${REPO_URL}" repo 2>&1; then
        post_log "error" "ERROR: Failed to clone repository" "error"
        echo "::result::error_clone_failed"
        exit 1
    fi
    cd repo
    git fetch origin

    ***REMOVED*** Checkout the branch from previous run
    if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
        git checkout "${BRANCH_NAME}"
        git pull origin "${BRANCH_NAME}" 2>/dev/null || true
        post_log "system" "RESUME: Checked out existing branch ${BRANCH_NAME}"
    else
        ***REMOVED*** Branch doesn't exist remotely yet - create it
        post_log "system" "RESUME: Branch ${BRANCH_NAME} not found on remote, creating new"
        git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
    fi
    checkpoint_update "lastAction" "Resumed from checkpoint - repository ready" || true
else
    ***REMOVED*** Normal flow: Clone and create branch
    post_log "system" "Cloning repository ${GITHUB_REPO}..."

    ***REMOVED*** Clone the repository
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
        ***REMOVED*** For deployment runs, the branch should already exist with approved changes
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
        ***REMOVED*** First run - create or checkout branch (handles branch already exists)
        git fetch origin 2>/dev/null || true
        if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH_NAME}"; then
            ***REMOVED*** Branch exists remotely - checkout and pull
            git checkout "${BRANCH_NAME}"
            git pull origin "${BRANCH_NAME}" 2>/dev/null || true
            post_log "system" "Checked out existing branch ${BRANCH_NAME}"
        else
            ***REMOVED*** Branch doesn't exist - create new from BASE_BRANCH
            ***REMOVED*** Phase 1 simplification: If STORY_BRANCH is set, use it (each worker gets its own branch)
            if [ -n "${STORY_BRANCH}" ]; then
                ***REMOVED*** Story-specific branch workflow: worker works on STORY_BRANCH, PRs to TARGET_BRANCH
                if [ -n "${TARGET_BRANCH}" ]; then
                    ***REMOVED*** Ensure the target branch exists locally
                    if git show-ref --verify --quiet "refs/remotes/origin/${TARGET_BRANCH}"; then
                        git checkout "origin/${TARGET_BRANCH}" 2>/dev/null || git checkout "${TARGET_BRANCH}"
                        git checkout -b "${STORY_BRANCH}"
                        BRANCH_NAME="${STORY_BRANCH}"
                        post_log "system" "Created story-specific branch ${STORY_BRANCH} from ${TARGET_BRANCH}"
                    else
                        post_log "warning" "Target branch ${TARGET_BRANCH} not found, falling back to default branch" "warning"
                        git checkout -b "${STORY_BRANCH}" 2>/dev/null || git checkout "${STORY_BRANCH}"
                        BRANCH_NAME="${STORY_BRANCH}"
                    fi
                else
                    git checkout -b "${STORY_BRANCH}" 2>/dev/null || git checkout "${STORY_BRANCH}"
                    BRANCH_NAME="${STORY_BRANCH}"
                    post_log "system" "Created story-specific branch ${STORY_BRANCH}"
                fi
            ***REMOVED*** For feature branch workflow, branch from TARGET_BRANCH instead of main
            elif [ -n "${TARGET_BRANCH}" ]; then
                ***REMOVED*** Ensure the target branch exists locally
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

***REMOVED*** Update checkpoint with branch information
checkpoint_update "branch" "${BRANCH_NAME}" || true
checkpoint_update "stage" "analyzing" || true
checkpoint_update "lastAction" "Branch created and ready for analysis" || true

***REMOVED*** Pull sibling changes if this is a multi-story workflow
***REMOVED*** This ensures we have the latest work from sibling workers before starting
if [ -n "${TARGET_BRANCH}" ]; then
    pull_sibling_changes
fi

***REMOVED*** =============================================================================
***REMOVED*** Worker Coordination: Check-in and Heartbeat
***REMOVED*** =============================================================================
***REMOVED*** Now that we've cloned and set up the branch, announce our presence to the
***REMOVED*** coordination service and start the heartbeat loop.
coordination_checkin "analyzing"
start_heartbeat_loop
start_command_polling
start_context_polling

***REMOVED*** Announce to siblings that we're starting work
if [ -n "${PARENT_TASK_ID}" ]; then
    post_context "progress" "Starting work on ${JIRA_ISSUE_KEY}: ${TICKET_SUMMARY:-'(no summary)'}" \
        "{\"persona\": \"${WORKER_PERSONA}\", \"branch\": \"${BRANCH_NAME}\", \"stage\": \"analyzing\"}"
fi

***REMOVED*** =============================================================================
***REMOVED*** Multi-Persona Single Container Execution Mode
***REMOVED*** =============================================================================
***REMOVED*** When MULTI_PERSONA_MODE=true and SUBTASKS_JSON is set, this container executes
***REMOVED*** multiple subtasks with different personas sequentially, reducing startup overhead
***REMOVED*** from N containers (~30s each) to 1 container (~30s total).
***REMOVED***
***REMOVED*** Key features:
***REMOVED*** - Sequential subtask execution within single container
***REMOVED*** - Persona hot-swap per subtask (loads appropriate directives)
***REMOVED*** - Context handoff via WorkerContext API for sibling awareness
***REMOVED*** - Per-subtask commits with retry/rollback support
***REMOVED*** - Consolidated PR after all subtasks complete

***REMOVED*** Set up log parser for streaming Claude output to dashboard
***REMOVED*** This must be defined before multi-persona mode which uses it
LOG_PARSER_SCRIPT="/app/scripts/log-parser.cjs"
if [ -f "${LOG_PARSER_SCRIPT}" ]; then
    LOG_PARSER_CMD="node ${LOG_PARSER_SCRIPT}"
else
    post_log "warning" "log-parser.cjs not found, logs will not stream to dashboard" "warning"
    LOG_PARSER_CMD="cat"
fi

if [ "${MULTI_PERSONA_MODE}" = "true" ] && [ -n "${SUBTASKS_JSON}" ]; then
    post_log "system" "=== MULTI-PERSONA MODE ACTIVATED ===" "info"

    ***REMOVED*** Set PARENT_TASK_ID for coordination API - in multi-persona mode, the main task is the parent
    export PARENT_TASK_ID="${TASK_ID}"

    ***REMOVED*** Export env vars for log-parser to use additive token aggregation
    ***REMOVED*** MULTI_PERSONA_MODE tells log-parser to use mode=add for partial updates
    ***REMOVED*** SKIP_FINAL_USAGE tells log-parser to skip /usage call (we handle final reporting)
    export MULTI_PERSONA_MODE="true"
    export SKIP_FINAL_USAGE="true"

    ***REMOVED*** Parse subtasks JSON
    SUBTASK_COUNT=$(echo "${SUBTASKS_JSON}" | jq 'length' 2>/dev/null || echo "0")

    ***REMOVED*** Announce multi-persona pipeline start to Communication Feed
    post_context "progress" "Multi-persona pipeline starting with ${SUBTASK_COUNT} subtasks" \
        "{\"mode\": \"multi-persona\", \"ticket\": \"${JIRA_ISSUE_KEY}\", \"subtaskCount\": ${SUBTASK_COUNT}}"

    if [ "${SUBTASK_COUNT}" = "0" ] || [ "${SUBTASK_COUNT}" = "null" ]; then
        post_log "error" "SUBTASKS_JSON is empty or invalid" "error"
        echo "::result::failed"
        exit 1
    fi

    post_log "system" "Multi-Persona Mode: ${SUBTASK_COUNT} subtasks to execute"

    ***REMOVED*** Track overall success
    MULTI_PERSONA_SUCCESS=true
    MULTI_PERSONA_COMMITS=""

    ***REMOVED*** Track accumulated tokens across all subtasks for accurate cost reporting
    TOTAL_INPUT_TOKENS=0
    TOTAL_OUTPUT_TOKENS=0
    TOTAL_CACHE_CREATION_TOKENS=0
    TOTAL_CACHE_READ_TOKENS=0

    ***REMOVED*** Execute each subtask sequentially
    for i in $(seq 0 $((SUBTASK_COUNT - 1))); do
        SUBTASK=$(echo "${SUBTASKS_JSON}" | jq -r ".[$i]")
        SUBTASK_INDEX=$(echo "${SUBTASK}" | jq -r '.index // '"$i"'')
        SUBTASK_TITLE=$(echo "${SUBTASK}" | jq -r '.title // "Untitled"')
        SUBTASK_DESCRIPTION=$(echo "${SUBTASK}" | jq -r '.description // ""')
        SUBTASK_PERSONA=$(echo "${SUBTASK}" | jq -r '.persona // "backend_developer"')
        SUBTASK_TARGET_FILES=$(echo "${SUBTASK}" | jq -r '.targetFiles // []')
        SUBTASK_REFERENCE_FILES=$(echo "${SUBTASK}" | jq -r '.referenceFiles // []')

        post_log "system" "========================================" "info"
        post_log "system" "SUBTASK $((i + 1))/${SUBTASK_COUNT}: ${SUBTASK_TITLE}" "info"
        post_log "system" "Persona: ${SUBTASK_PERSONA}" "info"
        post_log "system" "========================================" "info"

        ***REMOVED*** Post to Communication Feed
        post_context "progress" "Starting subtask $((i + 1))/${SUBTASK_COUNT}: ${SUBTASK_TITLE}" \
            "{\"subtaskIndex\": ${SUBTASK_INDEX}, \"totalSubtasks\": ${SUBTASK_COUNT}}"

        ***REMOVED*** Update task with current subtask index
        if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
            curl -s -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/subtask/${SUBTASK_INDEX}/complete" \
                -H "x-api-key: ${ORG_API_KEY}" \
                -H "Content-Type: application/json" \
                -d "{\"status\": \"in_progress\", \"persona\": \"${SUBTASK_PERSONA}\"}" \
                >/dev/null 2>&1 || true
        fi

        ***REMOVED*** Update WORKER_PERSONA for this subtask
        export WORKER_PERSONA="${SUBTASK_PERSONA}"

        ***REMOVED*** Load persona-specific directives
        SUBTASK_DIRECTIVE_PATH="/app/directives/${SUBTASK_PERSONA}/README.md"
        SUBTASK_DIRECTIVE_CONTENT=""
        if [ -f "${SUBTASK_DIRECTIVE_PATH}" ]; then
            SUBTASK_DIRECTIVE_CONTENT=$(cat "${SUBTASK_DIRECTIVE_PATH}" 2>/dev/null)
            post_log "system" "Loaded ${SUBTASK_PERSONA} directive (${***REMOVED***SUBTASK_DIRECTIVE_CONTENT} chars)"
        else
            post_log "warning" "Directive not found for ${SUBTASK_PERSONA}, using default" "warning"
        fi

        ***REMOVED*** Load common directives
        SUBTASK_COMMON_CONTENT=""
        if [ -d "/app/directives/common" ]; then
            for f in /app/directives/common/*.md; do
                if [ -f "$f" ]; then
                    SUBTASK_COMMON_CONTENT="${SUBTASK_COMMON_CONTENT}$(cat "$f")

"
                fi
            done
        fi

        ***REMOVED*** Fetch sibling context for this subtask
        SUBTASK_SIBLING_CONTEXT=""
        if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
            SUBTASK_SIBLING_CONTEXT=$(curl -s --connect-timeout 5 --max-time 10 \
                -X GET "${API_BASE_URL}/api/coordination/context/${TASK_ID}" \
                -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null | \
                jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"' 2>/dev/null || echo "")
        fi

        ***REMOVED*** Build subtask prompt
        SUBTASK_PROMPT="You are an AI Worker executing subtask $((i + 1)) of ${SUBTASK_COUNT} in a multi-persona pipeline.

***REMOVED******REMOVED*** Subtask Information
- **Title**: ${SUBTASK_TITLE}
- **Persona**: ${SUBTASK_PERSONA}
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Branch**: ${BRANCH_NAME}

***REMOVED******REMOVED*** Description
${SUBTASK_DESCRIPTION}

***REMOVED******REMOVED*** Your Role (${SUBTASK_PERSONA})
${SUBTASK_DIRECTIVE_CONTENT}

***REMOVED******REMOVED*** Common Guidelines
${SUBTASK_COMMON_CONTENT}

***REMOVED******REMOVED*** Target Files
${SUBTASK_TARGET_FILES}

***REMOVED******REMOVED*** Reference Files (read-only context)
${SUBTASK_REFERENCE_FILES}

***REMOVED******REMOVED*** Sibling Context (work done by previous subtasks)
${SUBTASK_SIBLING_CONTEXT}

***REMOVED******REMOVED*** Instructions
1. Read and understand the codebase context
2. Implement the changes described above
3. Create atomic, well-tested changes
4. Commit your changes with a descriptive message prefixed with [${JIRA_ISSUE_KEY}]
5. **Output context markers** to communicate with the team (REQUIRED)

***REMOVED******REMOVED*** MANDATORY: Output Context Markers

After completing your work, you MUST output context markers so the next persona knows what you did.
These are plain text markers that get parsed by the orchestrator - just print them as output.

**Required format:**
\`\`\`
::context::decision::Brief description of architectural decisions you made
::context::file_created::path/to/file.js - what the file does
::context::file_modified::path/to/file.js - what changes you made
::context::completion::Summary of what you built and how to use it
::context::progress::Any notes or suggestions for next developer
\`\`\`

**Example output at end of your response:**
\`\`\`
::context::decision::Using Express.js REST conventions with async handlers
::context::file_created::src/api/health.ts - health check endpoint
::context::file_modified::src/routes/index.ts - added health route
::context::completion::Created GET /api/health endpoint returning JSON status
::context::progress::Consider adding database connection check
\`\`\`

**CRITICAL:** You MUST output at least one \`::context::completion::\` marker or the pipeline will FAIL and RETRY.

***REMOVED******REMOVED*** Output
Make your code changes, commit them, then output the context markers. Keep responses concise.

When complete, your commit message should be:
[${JIRA_ISSUE_KEY}] Subtask $((i + 1)): ${SUBTASK_TITLE}

Do NOT create a PR - this will be done after all subtasks complete.
"

        ***REMOVED*** Save prompt to file
        SUBTASK_PROMPT_FILE="/tmp/subtask_${i}_prompt.txt"
        echo "${SUBTASK_PROMPT}" > "${SUBTASK_PROMPT_FILE}"

        ***REMOVED*** Record pre-execution git state for rollback
        SUBTASK_PRE_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")

        ***REMOVED*** Execute subtask with Claude Code
        ***REMOVED*** IMPORTANT: Use the same log streaming pipeline as the standard flow
        ***REMOVED*** so that agent thinking/tool use appears in the dashboard
        post_log "system" "Executing subtask with Claude Code..." "info"

        set +e  ***REMOVED*** Don't exit on error
        SUBTASK_OUTPUT_FILE="/tmp/subtask_${i}_output.txt"
        SUBTASK_STDERR_FILE="/tmp/subtask_${i}_stderr.txt"

        if [ "${WORKER_PROVIDER}" = "anthropic" ]; then
            ***REMOVED*** Use Claude Code CLI with log streaming pipeline
            ***REMOVED*** Pipeline: claude (JSON output) -> tee (save raw output) -> log-parser (extract & post logs)
            ***REMOVED*** This is identical to the standard flow to ensure logs appear in dashboard
            claude \
                --print \
                --verbose \
                --dangerously-skip-permissions \
                --model "${CLAUDE_MODEL:-haiku}" \
                --output-format stream-json \
                < "${SUBTASK_PROMPT_FILE}" \
                2>"${SUBTASK_STDERR_FILE}" | tee "${SUBTASK_OUTPUT_FILE}" | ${LOG_PARSER_CMD}
            SUBTASK_EXIT_CODE=$?

            ***REMOVED*** Show stderr if any
            if [ -s "${SUBTASK_STDERR_FILE}" ]; then
                echo "[Subtask $((i + 1)) STDERR]:"
                cat "${SUBTASK_STDERR_FILE}"
            fi
        else
            ***REMOVED*** Use LangGraph for other providers
            post_log "warning" "Non-anthropic provider not yet supported in multi-persona mode" "warning"
            SUBTASK_EXIT_CODE=1
        fi
        set -e

        ***REMOVED*** Capture output
        SUBTASK_OUTPUT=$(cat "${SUBTASK_OUTPUT_FILE}" 2>/dev/null || echo "")

        ***REMOVED*** Parse context markers from output
        if echo "${SUBTASK_OUTPUT}" | grep -q "::context::"; then
            while IFS= read -r line; do
                if echo "$line" | grep -q "::context::"; then
                    CONTEXT_TYPE=$(echo "$line" | sed 's/.*::context::\([^:]*\)::.*/\1/')
                    CONTEXT_CONTENT=$(echo "$line" | sed 's/.*::context::[^:]*:://')

                    ***REMOVED*** Escape content for JSON (handles quotes, newlines, special chars)
                    ESCAPED_CONTENT=$(json_escape "$CONTEXT_CONTENT")

                    ***REMOVED*** Post to WorkerContext API
                    if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
                        curl -s -X POST "${API_BASE_URL}/api/coordination/context" \
                            -H "x-api-key: ${ORG_API_KEY}" \
                            -H "Content-Type: application/json" \
                            -d "{
                                \"parentTaskId\": \"${TASK_ID}\",
                                \"taskId\": \"${TASK_ID}\",
                                \"persona\": \"${SUBTASK_PERSONA}\",
                                \"messageType\": \"${CONTEXT_TYPE}\",
                                \"content\": \"${ESCAPED_CONTENT}\",
                                \"metadata\": {\"subtaskIndex\": ${i}}
                            }" >/dev/null 2>&1 || true
                    fi
                fi
            done <<< "${SUBTASK_OUTPUT}"
        fi

        ***REMOVED*** Extract and accumulate tokens from this subtask's output
        ***REMOVED*** Log-parser outputs markers like ::input_tokens::1234 that we can parse
        SUBTASK_INPUT=$(grep -o '::input_tokens::[0-9]*' "${SUBTASK_OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::input_tokens:://' || echo "0")
        SUBTASK_OUTPUT_TOKENS=$(grep -o '::output_tokens::[0-9]*' "${SUBTASK_OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::output_tokens:://' || echo "0")
        SUBTASK_CACHE_CREATION=$(grep -o '::cache_creation_tokens::[0-9]*' "${SUBTASK_OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::cache_creation_tokens:://' || echo "0")
        SUBTASK_CACHE_READ=$(grep -o '::cache_read_tokens::[0-9]*' "${SUBTASK_OUTPUT_FILE}" 2>/dev/null | tail -1 | sed 's/::cache_read_tokens:://' || echo "0")

        ***REMOVED*** Ensure values are numeric
        [ -z "${SUBTASK_INPUT}" ] && SUBTASK_INPUT=0
        [ -z "${SUBTASK_OUTPUT_TOKENS}" ] && SUBTASK_OUTPUT_TOKENS=0
        [ -z "${SUBTASK_CACHE_CREATION}" ] && SUBTASK_CACHE_CREATION=0
        [ -z "${SUBTASK_CACHE_READ}" ] && SUBTASK_CACHE_READ=0

        ***REMOVED*** Accumulate across subtasks
        TOTAL_INPUT_TOKENS=$((TOTAL_INPUT_TOKENS + SUBTASK_INPUT))
        TOTAL_OUTPUT_TOKENS=$((TOTAL_OUTPUT_TOKENS + SUBTASK_OUTPUT_TOKENS))
        TOTAL_CACHE_CREATION_TOKENS=$((TOTAL_CACHE_CREATION_TOKENS + SUBTASK_CACHE_CREATION))
        TOTAL_CACHE_READ_TOKENS=$((TOTAL_CACHE_READ_TOKENS + SUBTASK_CACHE_READ))

        post_log "system" "Subtask $((i + 1)) tokens: input=${SUBTASK_INPUT}, output=${SUBTASK_OUTPUT_TOKENS}, cache_create=${SUBTASK_CACHE_CREATION}, cache_read=${SUBTASK_CACHE_READ}" "info"
        post_log "system" "Running total: input=${TOTAL_INPUT_TOKENS}, output=${TOTAL_OUTPUT_TOKENS}" "info"

        if [ $SUBTASK_EXIT_CODE -ne 0 ]; then
            post_log "error" "Subtask $((i + 1)) failed with exit code ${SUBTASK_EXIT_CODE}" "error"

            ***REMOVED*** Rollback to pre-subtask state
            if [ -n "${SUBTASK_PRE_COMMIT}" ]; then
                post_log "warning" "Rolling back to pre-subtask state: ${SUBTASK_PRE_COMMIT}" "warning"
                git reset --hard "${SUBTASK_PRE_COMMIT}" 2>/dev/null || true
                git clean -fd 2>/dev/null || true
            fi

            ***REMOVED*** Rollback context for this persona
            if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
                curl -s -X DELETE "${API_BASE_URL}/api/coordination/context/${TASK_ID}/persona/${SUBTASK_PERSONA}" \
                    -H "x-api-key: ${ORG_API_KEY}" \
                    >/dev/null 2>&1 || true
            fi

            ***REMOVED*** Report subtask failure
            curl -s -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/subtask/${SUBTASK_INDEX}/complete" \
                -H "x-api-key: ${ORG_API_KEY}" \
                -H "Content-Type: application/json" \
                -d "{\"status\": \"failed\", \"error\": \"Exit code ${SUBTASK_EXIT_CODE}\", \"persona\": \"${SUBTASK_PERSONA}\"}" \
                >/dev/null 2>&1 || true

            MULTI_PERSONA_SUCCESS=false

            ***REMOVED*** Post failure to Communication Feed
            post_context "blocker" "Subtask $((i + 1))/${SUBTASK_COUNT} failed: ${SUBTASK_TITLE}" \
                "{\"subtaskIndex\": ${SUBTASK_INDEX}, \"exitCode\": ${SUBTASK_EXIT_CODE}}"
            break
        fi

        ***REMOVED*** Check if subtask made any commits
        SUBTASK_POST_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
        if [ "${SUBTASK_POST_COMMIT}" != "${SUBTASK_PRE_COMMIT}" ]; then
            post_log "system" "Subtask $((i + 1)) committed: ${SUBTASK_POST_COMMIT:0:7}" "info"
            MULTI_PERSONA_COMMITS="${MULTI_PERSONA_COMMITS} ${SUBTASK_POST_COMMIT:0:7}"

            ***REMOVED*** Push the commit
            git push origin "${BRANCH_NAME}" 2>&1 || {
                post_log "warning" "Failed to push subtask commit, will push at end" "warning"
            }
        else
            post_log "system" "Subtask $((i + 1)) made no changes" "info"
        fi

        ***REMOVED*** Report subtask completion
        curl -s -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/subtask/${SUBTASK_INDEX}/complete" \
            -H "x-api-key: ${ORG_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "{\"status\": \"completed\", \"commitHash\": \"${SUBTASK_POST_COMMIT:0:40}\", \"persona\": \"${SUBTASK_PERSONA}\"}" \
            >/dev/null 2>&1 || true

        post_log "system" "Subtask $((i + 1)) completed successfully" "info"

        ***REMOVED*** Post completion to Communication Feed
        post_context "completion" "Completed subtask $((i + 1))/${SUBTASK_COUNT}: ${SUBTASK_TITLE}" \
            "{\"subtaskIndex\": ${SUBTASK_INDEX}, \"commitHash\": \"${SUBTASK_POST_COMMIT:0:7}\"}"
    done

    ***REMOVED*** Handle multi-persona completion
    if [ "${MULTI_PERSONA_SUCCESS}" = "true" ]; then
        post_log "system" "All ${SUBTASK_COUNT} subtasks completed successfully" "info"
        post_log "system" "Commits: ${MULTI_PERSONA_COMMITS}" "info"

        ***REMOVED*** Push all changes
        git push origin "${BRANCH_NAME}" 2>&1 || {
            post_log "error" "Failed to push final changes" "error"
            echo "::result::failed"
            exit 1
        }

        ***REMOVED*** Create consolidated PR
        post_log "system" "Creating consolidated PR..." "info"

        PR_TITLE="[${JIRA_ISSUE_KEY}] ${JIRA_SUMMARY}"
        PR_BODY="***REMOVED******REMOVED*** Multi-Persona Pipeline Execution

**Ticket**: ${JIRA_ISSUE_KEY}
**Summary**: ${JIRA_SUMMARY}

***REMOVED******REMOVED******REMOVED*** Subtasks Executed

$(echo "${SUBTASKS_JSON}" | jq -r '.[] | "- **\(.persona)**: \(.title)"')

***REMOVED******REMOVED******REMOVED*** Commits
${MULTI_PERSONA_COMMITS}

---
_Generated by WorkerMill Multi-Persona Pipeline_
"

        PR_RESULT=$(gh pr create \
            --title "${PR_TITLE}" \
            --body "${PR_BODY}" \
            --base "${BASE_BRANCH}" \
            --head "${BRANCH_NAME}" \
            2>&1) || {
            ***REMOVED*** Check if PR already exists
            if echo "${PR_RESULT}" | grep -qi "already exists"; then
                post_log "system" "PR already exists"
                PR_URL=$(gh pr view "${BRANCH_NAME}" --json url -q '.url' 2>/dev/null || echo "")
            else
                post_log "error" "Failed to create PR: ${PR_RESULT}" "error"
            fi
        }

        PR_URL=$(echo "${PR_RESULT}" | grep -oE 'https://github.com/[^[:space:]]+' | head -1)

        if [ -n "${PR_URL}" ]; then
            post_log "system" "PR created: ${PR_URL}" "info"
            echo "::pr_url::${PR_URL}"
            ***REMOVED*** Extract PR number from URL
            PR_NUMBER=$(echo "${PR_URL}" | grep -oE '/pull/[0-9]+' | grep -oE '[0-9]+' || echo "")
            if [ -n "${PR_NUMBER}" ]; then
                echo "::pr_number::${PR_NUMBER}"
            fi

            ***REMOVED*** Post to Communication Feed
            post_context "completion" "All ${SUBTASK_COUNT} subtasks completed! PR created: ${PR_URL}" \
                "{\"prUrl\": \"${PR_URL}\", \"prNumber\": ${PR_NUMBER:-null}, \"totalSubtasks\": ${SUBTASK_COUNT}}"
        fi

        echo "::result::review_requested"
        FINAL_RESULT="review_requested"
        EXIT_CODE=0

        ***REMOVED*** Report completion to API before exiting (same as standard flow)
        ***REMOVED*** NOTE: Tokens are NOT included here because:
        ***REMOVED*** - Real-time partial updates (mode=add) already tracked tokens during each subtask
        ***REMOVED*** - Partial updates also calculated and saved cost in real-time
        ***REMOVED*** - Including tokens here would double-count them
        post_log "system" "Reporting multi-persona completion to API..."
        post_log "system" "Final token totals (tracked via partials): input=${TOTAL_INPUT_TOKENS}, output=${TOTAL_OUTPUT_TOKENS}, cache_create=${TOTAL_CACHE_CREATION_TOKENS}, cache_read=${TOTAL_CACHE_READ_TOKENS}"
        if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
            JSON_PAYLOAD=$(jq -n \
                --argjson exitCode "${EXIT_CODE}" \
                --arg result "${FINAL_RESULT}" \
                --arg prUrl "$(echo "${PR_URL:-}" | tr -d '\r\n')" \
                --arg prNumber "$(echo "${PR_NUMBER:-}" | tr -d '\r\n')" \
                --arg branch "$(echo "${BRANCH_NAME:-}" | tr -d '\r\n')" \
                '{
                    exitCode: $exitCode,
                    result: $result,
                    prUrl: $prUrl,
                    prNumber: (if $prNumber == "" then null else ($prNumber | tonumber) end),
                    branch: $branch
                }'
            )

            HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/completion-response.txt \
                --connect-timeout 10 \
                --max-time 30 \
                -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/worker-complete" \
                -H "x-api-key: ${ORG_API_KEY}" \
                -H "Content-Type: application/json" \
                -d "${JSON_PAYLOAD}" 2>&1)

            if [ "$HTTP_CODE" = "200" ]; then
                post_log_sync "system" "Multi-persona completion reported successfully"
            else
                post_log_sync "error" "Failed to report completion (HTTP ${HTTP_CODE})" "error"
            fi
        fi

        post_log_sync "system" "Multi-persona pipeline done."
        exit 0
    else
        post_log "error" "Multi-persona pipeline failed" "error"
        echo "::result::failed"
        FINAL_RESULT="failed"
        EXIT_CODE=1

        ***REMOVED*** Report failure to API
        ***REMOVED*** Tokens already tracked via real-time partial updates - don't re-send to avoid double-counting
        post_log "system" "Token totals at failure (tracked via partials): input=${TOTAL_INPUT_TOKENS:-0}, output=${TOTAL_OUTPUT_TOKENS:-0}"
        if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
            JSON_PAYLOAD=$(jq -n \
                --argjson exitCode "${EXIT_CODE}" \
                --arg result "${FINAL_RESULT}" \
                '{
                    exitCode: $exitCode,
                    result: $result
                }'
            )

            curl -s --connect-timeout 10 --max-time 30 \
                -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/worker-complete" \
                -H "x-api-key: ${ORG_API_KEY}" \
                -H "Content-Type: application/json" \
                -d "${JSON_PAYLOAD}" >/dev/null 2>&1 || true
        fi

        post_log_sync "system" "Multi-persona pipeline failed."
        exit 1
    fi
fi

***REMOVED*** =============================================================================
***REMOVED*** Directive Loading: API Fetch with File Fallback
***REMOVED*** =============================================================================
***REMOVED*** Attempts to fetch persona directives from WorkerMill API (database-backed)
***REMOVED*** Falls back to bundled file-based directives if API fetch fails.
***REMOVED*** This enables runtime directive editing via Persona Studio UI.

DIRECTIVE_PATH="/app/directives/${WORKER_PERSONA}/README.md"
COMMON_DIRECTIVES="/app/directives/common"
AGENTS_MD="/app/AGENTS.md"
DIRECTIVE_FETCH_SUCCESS=false

***REMOVED*** Try fetching directives from API if credentials are available
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    post_log "system" "Attempting to fetch directives from API..."

    BUNDLE_RESPONSE=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 30 \
        -X GET "${API_BASE_URL}/api/personas/worker/${WORKER_PERSONA}/bundle" \
        -H "x-api-key: ${ORG_API_KEY}" 2>/dev/null)

    BUNDLE_HTTP_CODE=$(echo "$BUNDLE_RESPONSE" | tail -n1)
    BUNDLE_BODY=$(echo "$BUNDLE_RESPONSE" | sed '$d')

    if [ "$BUNDLE_HTTP_CODE" = "200" ]; then
        ***REMOVED*** Validate response has expected structure
        HAS_PERSONA=$(echo "$BUNDLE_BODY" | jq -e '.persona' > /dev/null 2>&1 && echo "true" || echo "false")

        if [ "$HAS_PERSONA" = "true" ]; then
            post_log "system" "Successfully fetched directives from API"

            ***REMOVED*** Create temp directory for API-fetched directives
            mkdir -p /tmp/directives/common

            ***REMOVED*** Extract and write README directive
            README_CONTENT=$(echo "$BUNDLE_BODY" | jq -r '.directives.readme // empty')
            if [ -n "$README_CONTENT" ] && [ "$README_CONTENT" != "null" ]; then
                echo "$README_CONTENT" > /tmp/directives/readme.md
                DIRECTIVE_PATH="/tmp/directives/readme.md"
                post_log "system" "Loaded README directive from API"
            fi

            ***REMOVED*** Extract and write common directives
            COMMON_COUNT=$(echo "$BUNDLE_BODY" | jq '.directives.common | length' 2>/dev/null || echo "0")
            if [ "$COMMON_COUNT" -gt 0 ]; then
                ***REMOVED*** Write each common directive to a file
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

            ***REMOVED*** Extract persona metadata for logging
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

***REMOVED*** Verify fallback paths exist
if [ "$DIRECTIVE_FETCH_SUCCESS" = "false" ]; then
    if [ ! -f "$DIRECTIVE_PATH" ]; then
        post_log "warning" "Directive file not found: ${DIRECTIVE_PATH}" "warning"
    fi
    if [ ! -d "$COMMON_DIRECTIVES" ]; then
        post_log "warning" "Common directives directory not found: ${COMMON_DIRECTIVES}" "warning"
    fi
fi

***REMOVED*** =============================================================================
***REMOVED*** Read directive content for inline inclusion in prompt
***REMOVED*** This is especially important for non-Claude providers (Ollama, OpenAI, etc.)
***REMOVED*** that can't read files the same way Claude Code can
***REMOVED*** =============================================================================
DIRECTIVE_CONTENT=""
if [ -f "$DIRECTIVE_PATH" ]; then
    DIRECTIVE_CONTENT=$(cat "$DIRECTIVE_PATH" 2>/dev/null)
    post_log "system" "Loaded persona directive (${***REMOVED***DIRECTIVE_CONTENT} chars)"
fi

COMMON_DIRECTIVE_CONTENT=""
if [ -d "$COMMON_DIRECTIVES" ]; then
    ***REMOVED*** Concatenate all common directive files
    for f in "${COMMON_DIRECTIVES}"/*.md; do
        if [ -f "$f" ]; then
            FILENAME=$(basename "$f")
            CONTENT=$(cat "$f" 2>/dev/null)
            COMMON_DIRECTIVE_CONTENT="${COMMON_DIRECTIVE_CONTENT}

***REMOVED******REMOVED******REMOVED*** ${FILENAME}
${CONTENT}
"
        fi
    done
    post_log "system" "Loaded common directives (${***REMOVED***COMMON_DIRECTIVE_CONTENT} chars)"
fi

AGENTS_MD_CONTENT=""
if [ -f "$AGENTS_MD" ]; then
    AGENTS_MD_CONTENT=$(cat "$AGENTS_MD" 2>/dev/null)
    post_log "system" "Loaded AGENTS.md (${***REMOVED***AGENTS_MD_CONTENT} chars)"
fi

***REMOVED*** =============================================================================
***REMOVED*** Fetch Sibling Context for Multi-Story PRD Workflows
***REMOVED*** =============================================================================
***REMOVED*** If this worker is part of a multi-story PRD (has PARENT_TASK_ID), fetch
***REMOVED*** context from sibling workers to inject into the prompt.
SIBLING_CONTEXT=""
if [ -n "${PARENT_TASK_ID}" ]; then
    SIBLING_CONTEXT=$(fetch_sibling_context)
    if [ -n "${SIBLING_CONTEXT}" ]; then
        post_log "system" "Loaded sibling context from parent ${PARENT_TASK_ID}"
    fi
fi

***REMOVED*** =============================================================================
***REMOVED*** V2 Pipeline Step Processing
***REMOVED*** =============================================================================
***REMOVED*** If this is a V2 pipeline task, run the step processor to build the prompt
***REMOVED*** V2 pipelines use sequential execution with context sidecar and git rewind support

IS_V2_PIPELINE=false
if [ "${PIPELINE_VERSION}" = "v2" ] && [ -n "${V2_STEP_INPUT}" ]; then
    IS_V2_PIPELINE=true
    post_log "system" "V2 Pipeline detected - running step processor"

    ***REMOVED*** Run the V2 step processor
    ***REMOVED*** It parses V2_STEP_INPUT, runs git setup (with git clean for rewinds),
    ***REMOVED*** resolves reference file patterns, and builds the step-specific prompt
    V2_PROCESSOR="/app/execution-compiled/v2/process-step.js"
    if [ -f "${V2_PROCESSOR}" ]; then
        ***REMOVED*** Export V2_STEP_INPUT for the processor
        export V2_STEP_INPUT

        ***REMOVED*** Run processor and capture its output
        V2_OUTPUT=$(node "${V2_PROCESSOR}" 2>&1) || {
            V2_EXIT=$?
            post_log "error" "V2 step processor failed with exit ${V2_EXIT}" "error"
            post_log "error" "Output: ${V2_OUTPUT}" "error"
            echo "::step_result::STEP_FAILED"
            echo "::step_error::V2 step processor failed"
            exit 1
        }

        ***REMOVED*** Parse processor output for metadata
        if echo "${V2_OUTPUT}" | grep -q "V2_PROMPT_FILE="; then
            V2_PROMPT_FILE=$(echo "${V2_OUTPUT}" | grep "V2_PROMPT_FILE=" | cut -d= -f2)
            V2_STEP_INDEX=$(echo "${V2_OUTPUT}" | grep "V2_STEP_INDEX=" | cut -d= -f2)
            V2_STEP_TITLE=$(echo "${V2_OUTPUT}" | grep "V2_STEP_TITLE=" | cut -d= -f2)
            V2_STEP_PERSONA=$(echo "${V2_OUTPUT}" | grep "V2_STEP_PERSONA=" | cut -d= -f2)
            V2_TOTAL_STEPS=$(echo "${V2_OUTPUT}" | grep "V2_TOTAL_STEPS=" | cut -d= -f2)

            post_log "system" "V2 Step ${V2_STEP_INDEX}/${V2_TOTAL_STEPS}: ${V2_STEP_TITLE}" "info"
            post_log "system" "Persona: ${V2_STEP_PERSONA}"

            ***REMOVED*** Load the V2 prompt
            PROMPT=$(cat "${V2_PROMPT_FILE}")
            post_log "system" "V2 prompt loaded (${***REMOVED***PROMPT} chars)"
        else
            post_log "error" "V2 processor did not output prompt file path" "error"
            echo "::step_result::STEP_FAILED"
            echo "::step_error::V2 processor did not generate prompt"
            exit 1
        fi
    else
        post_log "error" "V2 step processor not found at ${V2_PROCESSOR}" "error"
        echo "::step_result::STEP_FAILED"
        echo "::step_error::V2 step processor not installed"
        exit 1
    fi
fi

***REMOVED*** Build the task prompt based on run type (skip if V2 already built prompt)
if [ "${IS_V2_PIPELINE}" = "true" ]; then
    post_log "system" "Using V2 pipeline prompt"
elif [ "$IS_DEPLOYMENT_RUN" = true ]; then
    PROMPT=$(cat <<EOF
You are an AI Worker executing a DEPLOYMENT RUN from WorkerMill.

***REMOVED******REMOVED*** Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}
- **Run Type**: DEPLOYMENT (PR already approved)

***REMOVED******REMOVED*** Task Notes
${TASK_NOTES}

***REMOVED******REMOVED*** Instructions

This is a deployment run. The PR has already been approved. Your job is to:

1. Verify the PR exists and is approved
2. Deploy the approved changes (follow deployment procedures in directives)
3. Verify deployment succeeded
4. Merge the PR
5. Add completion comment to ticket

Read the agent instructions in: ${AGENTS_MD} for the complete workflow.

***REMOVED******REMOVED*** Environment Variables Available
- TICKET_KEY=${JIRA_ISSUE_KEY}
- TICKET_SUMMARY=${JIRA_SUMMARY}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${DEPLOYMENT_ENABLED:-false}

***REMOVED******REMOVED*** Output Markers
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

***REMOVED******REMOVED*** Task Information
- **Ticket**: ${JIRA_ISSUE_KEY}
- **Summary**: ${JIRA_SUMMARY}
- **Persona**: ${WORKER_PERSONA}
- **Deploy Label**: ${DEPLOYMENT_ENABLED:-false}
- **Review Label**: ${REVIEW_ENABLED:-false}
- **PRD Child Task**: ${PRD_CHILD_TASK:-false}
$(if [ "${PRD_CHILD_TASK}" = "true" ]; then cat <<'PRDBLOCK'

***REMOVED******REMOVED*** ⚠️ PRD CHILD TASK - SPECIAL WORKFLOW ⚠️

**YOU ARE A PRD CHILD TASK. YOUR WORKFLOW IS DIFFERENT:**

| Step | What to Do | What NOT to Do |
|------|------------|----------------|
| 1 | Make code changes | - |
| 2 | Run tests | - |
| 3 | Create PR to TARGET_BRANCH (feature branch) | Do NOT PR to main |
| 4 | Merge PR to feature branch | - |
| 5 | Output \`::result::deployed\` | - |
| ❌ | - | **DO NOT DEPLOY** |

**Why?** You're one of many stories. Deployment happens ONCE after ALL stories complete.

**Your final output MUST be:**
- \`::result::deployed\` (even though you didn't deploy - this unblocks dependent stories)
- \`::pr_url::<url>\`

**SKIP all deployment sections in directives.** When you see instructions about:
- \`aws ecs update-service\` → SKIP
- \`/kaniko/executor\` → SKIP
- \`aws s3 sync\` → SKIP
- \`aws cloudfront create-invalidation\` → SKIP

Just merge your PR and output \`::result::deployed\`.

PRDBLOCK
fi)

***REMOVED******REMOVED*** Task Description
${JIRA_DESCRIPTION}

***REMOVED******REMOVED*** Task Notes
${TASK_NOTES}

***REMOVED******REMOVED*** File Targeting (Cost-First Optimization)

The planning agent has identified specific files to focus on. Use this guidance:

**Target Files (files to modify - max 3 for Haiku):**
$(if [ -n "${TARGET_FILES}" ] && [ "${TARGET_FILES}" != "[]" ]; then echo "${TARGET_FILES}" | jq -r '.[]' 2>/dev/null | sed 's/^/- /'; else echo "- Not specified (you choose based on task)"; fi)

**Reference Files (files to read for context/patterns):**
$(if [ -n "${REFERENCE_FILES}" ] && [ "${REFERENCE_FILES}" != "[]" ]; then echo "${REFERENCE_FILES}" | jq -r '.[]' 2>/dev/null | sed 's/^/- /'; else echo "- None specified"; fi)

Use these target files to scope your work efficiently. If target files are empty, analyze the task and choose the most important files to modify.

***REMOVED******REMOVED*** Your Role & Directives

You are acting as a **${WORKER_PERSONA}**. Follow these directives:

${DIRECTIVE_CONTENT}

***REMOVED******REMOVED*** Common Guidelines

${COMMON_DIRECTIVE_CONTENT}

***REMOVED******REMOVED*** Agent Workflow

${AGENTS_MD_CONTENT}

***REMOVED******REMOVED*** ⚠️ PRD CONSTRAINTS (MANDATORY) ⚠️

$(if echo "${SIBLING_CONTEXT}" | grep -q '\[orchestrator\] constraints:'; then
  echo "**The following constraints were set by the orchestrator and MUST be followed:**"
  echo ""
  echo "${SIBLING_CONTEXT}" | grep '\[orchestrator\] constraints:' | sed 's/\[orchestrator\] constraints: //'
  echo ""
  echo "**VIOLATION OF THESE CONSTRAINTS WILL CAUSE YOUR WORK TO BE REJECTED.**"
else
  echo "No explicit constraints set. Follow standard best practices for this codebase."
fi)

***REMOVED******REMOVED*** Sibling Worker Context

You are part of a multi-story PRD workflow with PARALLEL workers. This means:
- Other workers are ACTIVELY working on related stories RIGHT NOW
- You share the same repository and may edit overlapping files
- Your changes will be merged together into the feature branch

**Current Sibling Activity:**
$(echo "${SIBLING_CONTEXT:-"No sibling context available - you are the first worker or this is a single-story task."}" | grep -v '\[orchestrator\] constraints:')

**How to interpret sibling messages:**
- \`[orchestrator] constraints:\` = **MANDATORY** project constraints - you MUST follow these
- \`[persona] progress:\` = Sibling started working, note their ticket/scope
- \`[persona] decision:\` = Sibling made an architectural choice - ALIGN with it if relevant
- \`[persona] file_modified:\` = Sibling is editing that file - AVOID editing the same file
- \`[persona] blocker:\` = Sibling is stuck - can you help or work around it?
- \`[persona] completion:\` = Sibling finished - their code is in the feature branch

**CRITICAL: Before editing ANY file, check if a sibling mentioned it. If so:**
1. Pull their changes first: \`git pull origin \${TARGET_BRANCH}\`
2. Or choose a different approach that doesn't conflict

**IMPORTANT - Active Communication Required:**
You MUST actively communicate with siblings using post_context(). Call it at these key points:

1. **After analyzing** - Share what files you plan to modify:
   \`\`\`bash
   post_context "decision" "Planning to modify: src/components/Gallery.tsx, src/api/upload.ts"
   \`\`\`

2. **Before modifying shared files** - Announce your intent:
   \`\`\`bash
   post_context "file_modified" "Editing src/types/index.ts - adding GalleryImage interface"
   \`\`\`

3. **After key decisions** - Share architectural choices:
   \`\`\`bash
   post_context "decision" "Using React Query for data fetching, storing images in S3"
   \`\`\`

4. **If blocked** - Ask for help:
   \`\`\`bash
   post_context "blocker" "Need API endpoint for image metadata - waiting on backend"
   \`\`\`

**Coordination Guidelines:**
- Check /tmp/sibling_context.log periodically for new updates from siblings
- If you see a sibling modified a file you need, run \`git pull origin \${TARGET_BRANCH}\` first
- Coordinate on shared resources (databases, config files, types, etc.)
- Post context BEFORE making changes, not just after

***REMOVED******REMOVED*** Inter-Worker Q&A

You can ask questions to sibling workers and answer theirs. Use this when you need
information from a sibling before proceeding, rather than guessing.

**Ask a question (and wait for answer):**
\`\`\`bash
***REMOVED*** Ask a question - returns the question ID
question_id=\$(ask_siblings "What database schema are you using for users?")

***REMOVED*** Wait for an answer (default 5 min timeout, or specify seconds)
answer=\$(wait_for_answer "\$question_id" 120)  ***REMOVED*** Wait up to 2 min
if [ -n "\$answer" ]; then
    echo "Got answer: \$answer"
fi
\`\`\`

**Check for sibling questions you can answer:**
\`\`\`bash
***REMOVED*** Lists unanswered questions from other workers
check_sibling_questions
***REMOVED*** Output: [backend_developer] Q: What API endpoint for auth? (id: abc-123)
\`\`\`

**Answer a sibling's question:**
\`\`\`bash
***REMOVED*** Provide an answer to a specific question ID
answer_sibling "abc-123" "Use POST /api/auth/login with email/password body"
\`\`\`

**Best practices:**
- Ask questions early in your workflow if you need info from siblings
- Check /tmp/sibling_questions.log for newly arrived questions during execution
- Answer sibling questions when you have relevant expertise
- Don't block indefinitely - use reasonable timeouts

***REMOVED******REMOVED*** File Coordination (Multi-Worker)

When working on multi-worker PRD tasks, you MUST coordinate file access to prevent conflicts.

**Before editing files, declare your intent:**
\`\`\`bash
***REMOVED*** Example: Declare files you plan to modify
declare_work_manifest '["src/components/Gallery.tsx", "src/styles/gallery.css"]'
\`\`\`

**If you get a CONFLICT response:**
1. Check which worker holds the lock (shown in output)
2. Either wait for it to be released: \`wait_for_file_lock "src/components/Gallery.tsx"\`
3. Or choose different files that aren't locked

**Best practices:**
- Declare your manifest early, after planning but before making edits
- Only declare files you actually plan to modify
- If a conflict blocks critical files, escalate with ::result::escalated

***REMOVED******REMOVED*** Instructions

**FOCUS: Your task is defined ONLY by the "Task Description" section above. Ignore any model names,
environment variables, or infrastructure details - those are internal orchestration settings, not your task.**

1. Analyze the task based on your persona directives above
2. Make all necessary code changes to complete the task
3. Follow the coding standards and practices in the directives
4. When done, your changes will be committed and a PR will be created
5. Avoid unnecessary iterations - run tests once after changes, don't repeat if they pass

**IMPORTANT Workflow**:
- If PRD_CHILD_TASK=true: Create PR to feature branch, merge PR, do NOT deploy, output ::result::deployed
- If DEPLOYMENT_ENABLED=true (and PRD_CHILD_TASK=false): Deploy changes, create PR, merge PR
- If DEPLOYMENT_ENABLED=false: Create PR only, stop at review_requested

**PRD Child Task Note**: When PRD_CHILD_TASK=true, you are part of a multi-story PRD workflow.
Your changes merge to the feature branch (TARGET_BRANCH), not directly to production.
The final deployment happens after ALL stories complete. Output ::result::deployed to unblock dependent stories.

***REMOVED******REMOVED*** Environment Variables Available
- TICKET_KEY=${JIRA_ISSUE_KEY}
- TICKET_SUMMARY=${JIRA_SUMMARY}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${DEPLOYMENT_ENABLED:-false}
- PRD_CHILD_TASK=${PRD_CHILD_TASK:-false}
- TARGET_BRANCH=${TARGET_BRANCH:-} (feature branch for PRD workflows)

***REMOVED******REMOVED*** Output Markers
When complete, output these markers (the orchestrator parses them):
- ::result::deployed (if you deployed AND merged the PR, OR if PRD_CHILD_TASK=true and you merged to feature branch)
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

***REMOVED*** =============================================================================
***REMOVED*** Inject Resume Context into Prompt
***REMOVED*** =============================================================================
***REMOVED*** If this is a resumed task, prepend context about previous progress
if [ "$RESUMING" = true ]; then
    post_log "system" "Building resume context for Claude..."

    ***REMOVED*** Determine if previous run failed or was just interrupted
    PREVIOUS_FAILED=false
    if [ "${RESUME_STAGE}" = "failed" ] && [ "${RESUME_EXIT_CODE}" != "0" ]; then
        PREVIOUS_FAILED=true
        post_log "system" "Previous run FAILED - adding 'try different approach' guidance"
    fi

    ***REMOVED*** Build human-readable resume context
    if [ "${PREVIOUS_FAILED}" = true ]; then
        ***REMOVED*** FAILURE case: Previous run failed, need to try a different approach
        RESUME_PREFIX=$(cat <<RESUMEEOF
***REMOVED******REMOVED*** ⚠️ CRITICAL: RETRYING AFTER FAILURE

**This is attempt ***REMOVED***${RESUME_COUNT}. The previous attempt FAILED with exit code ${RESUME_EXIT_CODE}.**

***REMOVED******REMOVED******REMOVED*** What Went Wrong
${RESUME_FAILURE_REASON}

***REMOVED******REMOVED******REMOVED*** Last Output Before Failure
\`\`\`
${RESUME_LAST_OUTPUT}
\`\`\`

***REMOVED******REMOVED******REMOVED*** Previous Progress (Before Failure)
- **Branch**: ${RESUME_BRANCH}
- **Last action**: ${RESUME_LAST_ACTION}
- **Tests run**: ${RESUME_TESTS_RUN}
- **Tests passed**: ${RESUME_TESTS_PASSED}

***REMOVED******REMOVED******REMOVED*** Files Modified Before Failure
${RESUME_FILES_MODIFIED}

***REMOVED******REMOVED******REMOVED*** IMPORTANT: TRY A DIFFERENT APPROACH

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
        ***REMOVED*** INTERRUPTION case: Previous run was interrupted (Spot), just resume
        RESUME_PREFIX=$(cat <<RESUMEEOF
***REMOVED******REMOVED*** IMPORTANT: RESUMED TASK

**This is a RESUMED task (attempt ***REMOVED***${RESUME_COUNT}). The previous run was interrupted (not failed).**

***REMOVED******REMOVED******REMOVED*** Previous Progress
- **Stage reached**: ${RESUME_STAGE}
- **Branch**: ${RESUME_BRANCH}
- **Last action**: ${RESUME_LAST_ACTION}
- **Tests run**: ${RESUME_TESTS_RUN}
- **Tests passed**: ${RESUME_TESTS_PASSED}

***REMOVED******REMOVED******REMOVED*** Files Modified (in previous run)
${RESUME_FILES_MODIFIED}

***REMOVED******REMOVED******REMOVED*** Commits Made (in previous run)
${RESUME_COMMITS}

***REMOVED******REMOVED******REMOVED*** Resume Instructions
1. **DO NOT redo completed work** - Check what exists before making changes
2. **Check git status** - See what uncommitted changes exist from the previous run
3. **Check git log** - See what commits were already made
4. **Continue from where you left off** - If implementing, continue implementation. If testing, run tests. If committing, commit remaining changes.
5. **If PR already exists** - Check for existing PR on this branch before creating a new one

---

RESUMEEOF
        )
    fi

    ***REMOVED*** Prepend resume context to the prompt
    PROMPT="${RESUME_PREFIX}

${PROMPT}"

    post_log "system" "Resume context injected into prompt"
fi

post_log "system" "Starting AI Agent..."
post_log "system" "Provider: ${WORKER_PROVIDER:-anthropic}"
post_log "system" "Model: ${CLAUDE_MODEL:-sonnet}"
if [ "$RESUMING" = true ]; then
    post_log "system" "This is a RESUMED task (attempt ***REMOVED***${RESUME_COUNT})"
fi


***REMOVED*** =============================================================================
***REMOVED*** CRITICAL: Live Log Streaming Implementation
***REMOVED*** =============================================================================
***REMOVED*** DO NOT MODIFY THIS SECTION WITHOUT EXPLICIT USER APPROVAL!
***REMOVED***
***REMOVED*** This log streaming system took a week to get working. It follows the exact
***REMOVED*** pattern from the oncallshift reference implementation. Key components:
***REMOVED***
***REMOVED*** 1. Claude CLI outputs structured JSON via --output-format stream-json
***REMOVED*** 2. Output is piped through log-parser.cjs which:
***REMOVED***    - Extracts readable content from JSON events
***REMOVED***    - Posts logs to /api/control-center/logs for live dashboard viewing
***REMOVED***    - Tracks token usage for cost calculation
***REMOVED*** 3. Dashboard connects via SSE to stream logs in real-time
***REMOVED***
***REMOVED*** Pattern: claude --output-format stream-json | tee output.jsonl | log-parser.cjs
***REMOVED***
***REMOVED*** If logs stop appearing in dashboard, check:
***REMOVED*** - log-parser.cjs is being invoked (not just "cat")
***REMOVED*** - ORG_API_KEY is set for authentication
***REMOVED*** - API endpoint /api/control-center/logs is accessible
***REMOVED***
***REMOVED*** Reference: oncallshift backend/scripts/ai-worker-entrypoint.sh lines 604-630
***REMOVED*** =============================================================================

***REMOVED*** Set environment variables for execution scripts
export TICKET_KEY="${JIRA_ISSUE_KEY}"
export TICKET_SUMMARY="${JIRA_SUMMARY}"
export REPO_PATH="/workspace/repo"
***REMOVED*** JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN are passed from the orchestrator

***REMOVED*** Transition Jira ticket to "In Progress"
if [ -n "${JIRA_BASE_URL}" ] && [ -n "${JIRA_EMAIL}" ] && [ -n "${JIRA_API_TOKEN}" ]; then
    post_log "system" "Transitioning Jira ticket to In Progress..."
    export TRANSITION_NAME="In Progress"
    node /app/execution-compiled/ticket/transition_issue.js 2>&1 || post_log "warning" "Warning: Could not transition ticket (may already be in progress)" "warning"
fi

***REMOVED*** Run Claude Code CLI with stream-json output for accurate token tracking
***REMOVED*** and live log streaming via log-parser.cjs
OUTPUT_FILE="/tmp/claude_output.jsonl"
STDERR_FILE="/tmp/claude_stderr.log"
EXIT_CODE=0

***REMOVED*** Post initial log
post_log "system" "Worker started for ${JIRA_ISSUE_KEY} with persona ${WORKER_PERSONA}" "info"
post_log "system" "Using model: ${CLAUDE_MODEL:-sonnet}" "info"

***REMOVED*** Log parser script path (inside Docker container)
LOG_PARSER_SCRIPT="/app/scripts/log-parser.cjs"

***REMOVED*** Export env vars for log-parser.cjs (required for API posting and cost tracking)
***REMOVED*** Also export Jira credentials so Claude's Bash tool can download attachments
export TASK_ID ORG_ID API_BASE_URL ORG_API_KEY CLAUDE_MODEL JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN

***REMOVED*** Check if log-parser exists and set up the pipeline
if [ -f "${LOG_PARSER_SCRIPT}" ]; then
    post_log "system" "Live log streaming enabled via log-parser.cjs" "info"
    LOG_PARSER_CMD="node ${LOG_PARSER_SCRIPT}"
else
    post_log "warning" "log-parser.cjs not found at ${LOG_PARSER_SCRIPT}, logs will not stream to dashboard" "warning"
    LOG_PARSER_CMD="cat"  ***REMOVED*** Passthrough if parser not available
fi

***REMOVED*** =============================================================================
***REMOVED*** Trap Handler for Graceful Shutdown
***REMOVED*** Ensures checkpoint is saved and coordination cleanup on EXIT
***REMOVED*** =============================================================================
cleanup_on_exit() {
    ***REMOVED*** Save checkpoint state
    checkpoint_save 2>&1 || true

    ***REMOVED*** Stop checkpoint background sync
    [ -n "${CHECKPOINT_PID}" ] && kill ${CHECKPOINT_PID} 2>/dev/null || true

    ***REMOVED*** Clear manifest (releases file locks)

    ***REMOVED*** Stop command polling
    stop_command_polling

    ***REMOVED*** Stop context polling for sibling updates
    stop_context_polling

    coordination_clear_manifest

    ***REMOVED*** Stop heartbeat loop and check out from coordination service
    stop_heartbeat_loop
    coordination_checkout
}
trap cleanup_on_exit EXIT

***REMOVED*** =============================================================================
***REMOVED*** Provider-Specific AI Agent Execution
***REMOVED*** =============================================================================
***REMOVED*** Dispatch to the appropriate AI provider based on WORKER_PROVIDER environment variable
***REMOVED*** Each provider outputs the same standard markers (::result::, ::pr_url::, ::input_tokens::, etc.)

case "$WORKER_PROVIDER" in
    anthropic)
        ***REMOVED*** Anthropic Claude Code CLI
        ***REMOVED*** Pipeline: claude (JSON output) -> tee (save raw output) -> log-parser (extract & post logs)
        ***REMOVED***
        ***REMOVED*** CRITICAL: This pipeline is the ONLY way logs appear in the dashboard.
        ***REMOVED*** - --output-format stream-json: Claude outputs structured JSON events
        ***REMOVED*** - tee: Saves raw output for marker parsing after completion
        ***REMOVED*** - log-parser.cjs: Extracts readable content and POSTs to /api/control-center/logs
        post_log "system" "Invoking Anthropic Claude Code CLI..."

        ***REMOVED*** Write prompt to file to avoid "Argument list too long" error
        ***REMOVED*** Large prompts (directives + AGENTS.md) can exceed shell ARG_MAX limits
        PROMPT_FILE="/tmp/agent_prompt.txt"
        printf '%s' "${PROMPT}" > "${PROMPT_FILE}"

        claude \
            --print \
            --verbose \
            --dangerously-skip-permissions \
            --model "${CLAUDE_MODEL:-sonnet}" \
            --output-format stream-json \
            < "${PROMPT_FILE}" \
            2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?
        ;;

    ollama|openai|gemini|google|groq|mistral|xai|grok|azure)
        ***REMOVED*** =============================================================================
        ***REMOVED*** Unified LangGraph ReAct Executor
        ***REMOVED*** =============================================================================
        ***REMOVED*** All non-Anthropic providers use the unified langgraph-executor.py
        ***REMOVED*** This provides consistent behavior across providers with:
        ***REMOVED*** - Structured Thought -> Action -> Observation loop
        ***REMOVED*** - State management for test result caching
        ***REMOVED*** - Edit failure recovery and guidance
        ***REMOVED*** - Bash command loop detection
        ***REMOVED***
        ***REMOVED*** Supported providers:
        ***REMOVED***   ollama   - Local models via Ollama (llama3.1, qwen2.5-coder, etc.)
        ***REMOVED***   openai   - OpenAI API (gpt-4o, gpt-4-turbo, etc.)
        ***REMOVED***   gemini   - Google Gemini (gemini-1.5-pro, etc.)
        ***REMOVED***   google   - Alias for gemini
        ***REMOVED***   groq     - Groq fast inference (llama-3.1-70b-versatile, etc.)
        ***REMOVED***   mistral  - Mistral AI (mistral-large-latest, etc.)
        ***REMOVED***   xai/grok - Elon Musk's Grok (grok-2, grok-2-mini, etc.)
        ***REMOVED***   azure    - Azure OpenAI (deployments)
        ***REMOVED***
        post_log "system" "Invoking LangGraph ReAct executor..."
        post_log "system" "Provider: ${WORKER_PROVIDER}"
        post_log "system" "Model: ${WORKER_MODEL:-auto}"

        ***REMOVED*** Write prompt to a temp file to avoid shell escaping issues
        PROMPT_FILE="/tmp/agent_prompt.txt"
        echo "${PROMPT}" > "${PROMPT_FILE}"

        ***REMOVED*** -u flag disables Python stdout buffering for real-time log streaming
        python3 -u /app/agents/langgraph-executor.py \
            --provider "${WORKER_PROVIDER}" \
            --model "${WORKER_MODEL:-}" \
            --prompt-file "${PROMPT_FILE}" \
            2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?
        ;;

    ai-sdk)
        ***REMOVED*** =============================================================================
        ***REMOVED*** Vercel AI SDK Executor (Multi-Expert Mode)
        ***REMOVED*** =============================================================================
        ***REMOVED*** AI SDK provides a unified interface for multiple AI providers, enabling
        ***REMOVED*** per-persona provider routing configured in org settings.
        ***REMOVED***
        ***REMOVED*** Environment variables:
        ***REMOVED***   AI_SDK_UNDERLYING_PROVIDER - The actual AI provider to use (anthropic, openai, google, ollama)
        ***REMOVED***   WORKER_MODEL - Model name (provider-specific)
        ***REMOVED***   WORKER_PERSONA - Agent persona for directive loading
        ***REMOVED***
        ***REMOVED*** The executor resolves provider routing from org settings and dispatches
        ***REMOVED*** to the appropriate AI provider using the Vercel AI SDK generateText API.
        ***REMOVED***
        post_log "system" "Invoking Vercel AI SDK executor (multi-expert mode)..."
        post_log "system" "Underlying Provider: ${AI_SDK_UNDERLYING_PROVIDER:-anthropic}"
        post_log "system" "Model: ${WORKER_MODEL:-auto}"
        post_log "system" "Persona: ${WORKER_PERSONA}"

        ***REMOVED*** Write prompt to a temp file to avoid shell escaping issues
        PROMPT_FILE="/tmp/agent_prompt.txt"
        echo "${PROMPT}" > "${PROMPT_FILE}"

        ***REMOVED*** Set working directory for the agent (use REPO_PATH where repo is cloned)
        export AGENT_WORKING_DIR="${REPO_PATH:-/workspace/repo}"
        export DIRECTIVES_DIR="/app/directives"

        ***REMOVED*** Run the AI SDK executor
        node /app/agents/ai-sdk-executor.js \
            --provider "${AI_SDK_UNDERLYING_PROVIDER:-anthropic}" \
            --model "${WORKER_MODEL:-}" \
            --persona "${WORKER_PERSONA}" \
            --prompt-file "${PROMPT_FILE}" \
            2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?
        ;;

    *)
        post_log "error" "ERROR: Unknown provider: ${WORKER_PROVIDER}" "error"
        post_log "error" "Supported providers: anthropic, ollama, openai, gemini, groq, mistral, azure, ai-sdk" "error"
        echo "::result::error_unknown_provider"
        EXIT_CODE=1
        ;;
esac

***REMOVED*** Show any stderr output for debugging
if [ -s "${STDERR_FILE}" ]; then
    echo "[Agent STDERR]:"
    cat "${STDERR_FILE}"
fi

echo ""
post_log "system" "AI agent completed with exit code: ${EXIT_CODE}"

***REMOVED*** Save failure context to checkpoint for smarter retries
***REMOVED*** This allows the next attempt to understand WHY it failed and try a different approach
if [ "${EXIT_CODE}" -ne 0 ] && [ "${CHECKPOINT_ENABLED:-true}" = "true" ]; then
    ***REMOVED*** Extract last 20 lines of output as failure context
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

***REMOVED*** Parse output for markers
***REMOVED*** Note: Markers may appear in JSON strings with \n literals, so extract only the value
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    ***REMOVED*** Extract URL and stop at whitespace, literal \n, or end of line
    PR_URL=$(grep "::pr_url::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::pr_url::${PR_URL}"
fi

if grep -q "::pr_number::" "${OUTPUT_FILE}"; then
    ***REMOVED*** Extract number and stop at whitespace, literal \n, or end of line
    PR_NUMBER=$(grep "::pr_number::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_number:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::pr_number::${PR_NUMBER}"
fi

if grep -q "::branch::" "${OUTPUT_FILE}"; then
    ***REMOVED*** Extract branch and stop at whitespace, literal \n, or end of line
    BRANCH=$(grep "::branch::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::branch:://' | sed 's/\\n.*//' | tr -d '\r\n' | cut -d'"' -f1)
    echo "::branch::${BRANCH}"
fi

***REMOVED*** Output token counts if available
if grep -q "::input_tokens::" "${OUTPUT_FILE}"; then
    echo "$(grep '::input_tokens::' "${OUTPUT_FILE}" | head -1)"
fi

if grep -q "::output_tokens::" "${OUTPUT_FILE}"; then
    echo "$(grep '::output_tokens::' "${OUTPUT_FILE}" | head -1)"
fi

***REMOVED*** Determine final result based on agent output
FINAL_RESULT=""

***REMOVED*** Check if PR was created - either via marker or natural language output
***REMOVED*** IMPORTANT: Only trust PR URLs that match the actual target repo
PR_CREATED=false
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    ***REMOVED*** Extract the URL from the marker and validate it's for the correct repo
    DETECTED_PR_URL=$(grep '::pr_url::' "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://')

    ***REMOVED*** Check for obvious placeholder URLs that models hallucinate
    IS_PLACEHOLDER=false
    if echo "${DETECTED_PR_URL}" | grep -qiE "(owner/repo|your-|example|placeholder|test-repo|my-repo)"; then
        IS_PLACEHOLDER=true
        post_log "system" "[error] Agent hallucinated a PLACEHOLDER PR URL: ${DETECTED_PR_URL}"
        post_log "system" "[error] This is a common model failure - the PR was never actually created"
    elif echo "${DETECTED_PR_URL}" | grep -qE "/pull/123$"; then
        ***REMOVED*** /pull/123 is a common example number used in documentation
        IS_PLACEHOLDER=true
        post_log "system" "[error] Agent output suspicious PR URL ending in /pull/123: ${DETECTED_PR_URL}"
        post_log "system" "[error] PR ***REMOVED***123 is a common documentation example - likely hallucinated"
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
    ***REMOVED*** Extract PR URL from natural language output - ONLY match the actual target repo
    ***REMOVED*** This prevents matching example URLs like "github.com/owner/repo/pull/123" from documentation
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

***REMOVED*** =============================================================================
***REMOVED*** WORKFLOW VALIDATION: Ensure all steps completed regardless of agent behavior
***REMOVED*** This catches cases where agent exits early or claims completion prematurely
***REMOVED*** =============================================================================
if [ "${EXIT_CODE}" -eq 0 ]; then
    post_log "system" "[validation] Verifying workflow completion..."

    ***REMOVED*** Step 1: Check for uncommitted changes and commit them
    UNCOMMITTED_CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    if [ "${UNCOMMITTED_CHANGES}" -gt 0 ]; then
        post_log "system" "[validation] Found ${UNCOMMITTED_CHANGES} uncommitted changes - committing..."
        git add -A
        git commit -m "feat(${JIRA_ISSUE_KEY}): Auto-commit from validation

Changes detected after agent completed but were not committed.
Ticket: ${JIRA_ISSUE_KEY}

Co-Authored-By: Claude <noreply@anthropic.com>" 2>&1 || true
    fi

    ***REMOVED*** Step 2: Check if branch has commits beyond main (i.e., work was done)
    ***REMOVED*** Check commits ahead of BASE_BRANCH (TARGET_BRANCH for feature branch workflow, or main)
    COMMITS_AHEAD=$(git rev-list --count "origin/${BASE_BRANCH}..HEAD" 2>/dev/null || echo "0")
    if [ "${COMMITS_AHEAD}" -gt 0 ]; then
        post_log "system" "[validation] Branch has ${COMMITS_AHEAD} commit(s) ahead of main"

        ***REMOVED*** Step 3: Check if branch is pushed to remote
        REMOTE_REF=$(git ls-remote --heads origin "${BRANCH_NAME}" 2>/dev/null | wc -l)
        if [ "${REMOTE_REF}" -eq 0 ]; then
            post_log "system" "[validation] Branch not pushed to remote - pushing now..."
            git push -u origin "${BRANCH_NAME}" 2>&1 || true
        else
            post_log "system" "[validation] Branch already pushed to remote"
        fi

        ***REMOVED*** Step 4: Check if PR exists for this branch (if not already detected)
        if [ "${PR_CREATED}" = "false" ]; then
            EXISTING_PR=$(gh pr list --head "${BRANCH_NAME}" --json number,url -q '.[0]' 2>/dev/null || echo "")
            if [ -n "${EXISTING_PR}" ] && [ "${EXISTING_PR}" != "null" ]; then
                ***REMOVED*** PR already exists
                PR_NUMBER=$(echo "${EXISTING_PR}" | jq -r '.number' 2>/dev/null || echo "")
                PR_URL=$(echo "${EXISTING_PR}" | jq -r '.url' 2>/dev/null || echo "")
                if [ -n "${PR_NUMBER}" ] && [ "${PR_NUMBER}" != "null" ]; then
                    PR_CREATED=true
                    post_log "system" "[validation] Found existing PR ***REMOVED***${PR_NUMBER}: ${PR_URL}"
                fi
            fi
        fi

        ***REMOVED*** Step 5: Create PR if none exists
        if [ "${PR_CREATED}" = "false" ]; then
            post_log "system" "[validation] No PR found - creating PR to ${BASE_BRANCH}..."
            PR_OUTPUT=$(gh pr create \
                --title "${JIRA_ISSUE_KEY}: ${JIRA_SUMMARY}" \
                --body "***REMOVED******REMOVED*** Summary
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
                post_log "system" "[validation] Created PR ***REMOVED***${PR_NUMBER}: ${PR_URL}"
            elif echo "${PR_OUTPUT}" | grep -q "already exists"; then
                post_log "system" "[validation] PR already exists (race condition handled)"
                ***REMOVED*** Try to get the PR info again
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

    ***REMOVED*** Post context about workflow completion for siblings
    if [ "${PR_CREATED}" = "true" ] && [ -n "${PARENT_TASK_ID}" ]; then
        post_context "completion" "PR created: ${PR_URL}" "{\"prUrl\": \"${PR_URL}\", \"prNumber\": ${PR_NUMBER:-null}}"
    fi
fi

if [ "${EXIT_CODE}" -eq 0 ]; then
    ***REMOVED*** IMPORTANT: Only check the LAST 100 lines for result markers
    ***REMOVED*** The full output includes AGENTS.md which has example markers like ::result::deployed
    ***REMOVED*** We need to find the ACTUAL result the worker output, not documentation examples
    LAST_OUTPUT=$(tail -100 "${OUTPUT_FILE}")

    if echo "${LAST_OUTPUT}" | grep -q "::result::deployed"; then
        FINAL_RESULT="deployed"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::review_requested"; then
        FINAL_RESULT="review_requested"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::escalated"; then
        ***REMOVED*** Agent needs clarification - unclear requirements or blocked
        FINAL_RESULT="escalated"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::no_changes" && [ "${PR_CREATED}" = "true" ]; then
        ***REMOVED*** Claude said no_changes but we auto-created a PR for uncommitted files
        FINAL_RESULT="review_requested"
    elif echo "${LAST_OUTPUT}" | grep -q "::result::no_changes"; then
        FINAL_RESULT="no_changes"
    else
        ***REMOVED*** Fallback based on context
        if [ "$IS_DEPLOYMENT_RUN" = true ]; then
            ***REMOVED*** Second run after approval - deployed
            FINAL_RESULT="deployed"
        elif [ "${PRD_CHILD_TASK}" = "true" ] && [ "${PR_CREATED}" = "true" ]; then
            ***REMOVED*** PRD child task merged to feature branch - counts as deployed for orchestrator
            FINAL_RESULT="deployed"
        elif [ "${DEPLOYMENT_ENABLED}" = "true" ] && [ "${PR_CREATED}" = "true" ]; then
            ***REMOVED*** Has deploy label, agent deployed and merged - deployed
            FINAL_RESULT="deployed"
        elif [ "${PR_CREATED}" = "true" ]; then
            ***REMOVED*** PR created, waiting for approval - review_requested
            FINAL_RESULT="review_requested"
        elif [ "${COMMITS_AHEAD:-0}" = "0" ]; then
            ***REMOVED*** No result marker, no PR, no commits - agent failed to make any changes
            ***REMOVED*** This catches: Ollama down, tool call parsing failures, silent agent failures
            post_log "system" "[validation] Agent exited without making changes - marking as failed"
            FINAL_RESULT="failed"
        else
            ***REMOVED*** Has commits but no PR and no result marker - something went wrong
            post_log "system" "[validation] Agent made commits but no PR/result - marking as failed"
            FINAL_RESULT="failed"
        fi
    fi
else
    FINAL_RESULT="failed"
fi
echo "::result::${FINAL_RESULT}"

***REMOVED*** Post result markers to database for orchestrator backup detection
***REMOVED*** These markers allow monitorExecutingTasks() to detect completion if worker-complete fails
post_log "system" "::result::${FINAL_RESULT}" "info"
if [ -n "${PR_URL}" ]; then
    post_log "system" "::pr_url::${PR_URL}" "info"
fi
if [ -n "${PR_NUMBER}" ]; then
    post_log "system" "::pr_number::${PR_NUMBER}" "info"
fi

***REMOVED*** Post human-readable completion log
if [ "${FINAL_RESULT}" = "failed" ]; then
    post_log "status_change" "Task failed with exit code ${EXIT_CODE}" "error"
else
    post_log "status_change" "Task completed with result: ${FINAL_RESULT}" "info"
fi

***REMOVED*** Update Jira ticket on completion
if [ -n "${JIRA_BASE_URL}" ] && [ -n "${JIRA_EMAIL}" ] && [ -n "${JIRA_API_TOKEN}" ]; then
    post_log "system" "Updating Jira ticket..."

    ***REMOVED*** Handle based on result
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
        ***REMOVED*** Escalated: Add comment but do NOT transition Jira - ticket stays "In Progress"
        ***REMOVED*** The WorkerMill task will show "Escalated" status, but Jira stays in progress for visibility
        export COMMENT="[${PERSONA_DISPLAY}] Task escalated - needs clarification. Model: ${CLAUDE_MODEL:-sonnet}. Please review the ticket and provide additional context."
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        ***REMOVED*** No transition - ticket remains in "In Progress" in Jira

    elif [ "${FINAL_RESULT}" = "no_changes" ]; then
        ***REMOVED*** Agent explicitly said no changes needed (legitimate scenario)
        export COMMENT="[${PERSONA_DISPLAY}] No changes required. Model: ${CLAUDE_MODEL:-sonnet}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Done"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "failed" ]; then
        export COMMENT="[${PERSONA_DISPLAY}] Task failed. Model: ${CLAUDE_MODEL:-sonnet}. Exit code: ${EXIT_CODE}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
    fi
fi

***REMOVED*** Extract token counts from JSON output
***REMOVED*** The stream-json output contains usage data in the final message event
***REMOVED*** log-parser.cjs also reports tokens to the API, but we extract here for Jira comments
INPUT_TOKENS="0"
OUTPUT_TOKENS="0"
CACHE_CREATION_TOKENS="0"
CACHE_READ_TOKENS="0"

if [ -f "${OUTPUT_FILE}" ] && [ -s "${OUTPUT_FILE}" ]; then
    ***REMOVED*** Get the last line which typically contains the final usage stats
    LAST_LINE=$(tail -1 "${OUTPUT_FILE}" 2>/dev/null)

    ***REMOVED*** Parse usage from JSON (handles both .usage and .message.usage paths)
    INPUT_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.input_tokens // .message.usage.input_tokens // 0' 2>/dev/null || echo "0")
    OUTPUT_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.output_tokens // .message.usage.output_tokens // 0' 2>/dev/null || echo "0")
    CACHE_CREATION_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.cache_creation_input_tokens // .message.usage.cache_creation_input_tokens // 0' 2>/dev/null || echo "0")
    CACHE_READ_TOKENS=$(echo "${LAST_LINE}" | jq -r '.usage.cache_read_input_tokens // .message.usage.cache_read_input_tokens // 0' 2>/dev/null || echo "0")

    ***REMOVED*** Handle null values from jq
    [ "${INPUT_TOKENS}" = "null" ] && INPUT_TOKENS=0
    [ "${OUTPUT_TOKENS}" = "null" ] && OUTPUT_TOKENS=0
    [ "${CACHE_CREATION_TOKENS}" = "null" ] && CACHE_CREATION_TOKENS=0
    [ "${CACHE_READ_TOKENS}" = "null" ] && CACHE_READ_TOKENS=0

    if [ "${INPUT_TOKENS}" != "0" ]; then
        echo "[Tokens] Parsed from JSON: input=${INPUT_TOKENS}, output=${OUTPUT_TOKENS}, cache_creation=${CACHE_CREATION_TOKENS}, cache_read=${CACHE_READ_TOKENS}"
    fi

    ***REMOVED*** Fallback: Parse from text markers (::input_tokens::12345) if JSON parsing returned 0
    ***REMOVED*** This handles universal-agent.js output format
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

***REMOVED*** Report back to API if we have credentials
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    post_log "system" "Reporting completion to API..."

    ***REMOVED*** Build JSON payload using jq to handle escaping properly
    ***REMOVED*** Fallback to manual JSON construction if jq is not available
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
        ***REMOVED*** Fallback: Manual JSON construction (less safe for special characters but functional)
        echo "[worker] WARNING: jq not found, using fallback JSON construction"
        verify_tool "jq" || true  ***REMOVED*** Log diagnostic info
        ***REMOVED*** Clean up values to prevent JSON injection
        CLEAN_PR_URL=$(echo "${PR_URL:-}" | tr -d '\r\n"' | sed 's/\\/\\\\/g')
        CLEAN_BRANCH=$(echo "${BRANCH_NAME:-}" | tr -d '\r\n"' | sed 's/\\/\\\\/g')
        CLEAN_PR_NUMBER="${PR_NUMBER:-}"
        ***REMOVED*** Build JSON manually
        if [ -n "${CLEAN_PR_NUMBER}" ] && [ "${CLEAN_PR_NUMBER}" != "null" ]; then
            PR_NUMBER_JSON="${CLEAN_PR_NUMBER}"
        else
            PR_NUMBER_JSON="null"
        fi
        JSON_PAYLOAD="{\"exitCode\":${EXIT_CODE:-0},\"result\":\"${FINAL_RESULT:-completed}\",\"prUrl\":\"${CLEAN_PR_URL}\",\"prNumber\":${PR_NUMBER_JSON},\"branch\":\"${CLEAN_BRANCH}\",\"inputTokens\":${INPUT_TOKENS:-0},\"outputTokens\":${OUTPUT_TOKENS:-0},\"cacheCreationTokens\":${CACHE_CREATION_TOKENS:-0},\"cacheReadTokens\":${CACHE_READ_TOKENS:-0}}"
    fi

    ***REMOVED*** Retry completion reporting up to 3 times with exponential backoff
    ***REMOVED*** This is critical - if we can't report completion, the task will be stuck
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
        ***REMOVED*** Exit with error so ECS records task as failed, triggering faster recovery
        post_log_sync "system" "Done (completion reporting failed)."
        exit 1
    fi
fi

post_log_sync "system" "Done."
exit ${EXIT_CODE}
