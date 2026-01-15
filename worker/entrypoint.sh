***REMOVED***!/bin/bash
set -e

***REMOVED*** WorkerMill AI Worker Entrypoint
***REMOVED*** This script runs Claude Code CLI to execute AI agent tasks

***REMOVED*** API base URL for posting logs
API_BASE="${API_BASE_URL:-https://workermill.com}"

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

***REMOVED*** Function to post log to API for real-time streaming
post_log() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    ***REMOVED*** Also echo to stdout for CloudWatch
    echo "[worker] $message"

    ***REMOVED*** Post to API (fire and forget, don't block on failure)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
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

    ***REMOVED*** Post to API synchronously (wait for completion)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
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

echo "[worker] Verifying required tools..."
verify_tool "jq" || echo "[worker] CRITICAL: jq is required for JSON processing"
verify_tool "git"
verify_tool "gh"
verify_tool "aws"
verify_tool "node"
verify_tool "curl"
echo "[worker] PATH: $PATH"

***REMOVED*** =============================================================================
***REMOVED*** Initialize Checkpointing
***REMOVED*** =============================================================================
checkpoint_init

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
required_vars="TASK_ID JIRA_ISSUE_KEY JIRA_SUMMARY GITHUB_REPO WORKER_PERSONA ANTHROPIC_API_KEY GITHUB_TOKEN"
for var in $required_vars; do
    if [ -z "${!var}" ]; then
        post_log "error" "ERROR: Missing required environment variable: $var" "error"
        echo "::result::error_missing_env"
        exit 1
    fi
done

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

post_log "system" "Cloning repository ${GITHUB_REPO}..."
cd /workspace

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

***REMOVED*** Detect if this is a deployment run (second run after PR approval)
IS_DEPLOYMENT_RUN=false
if [[ "${TASK_NOTES}" == *"DEPLOYMENT_RUN"* ]] || [[ "${TASK_NOTES}" == *"PR_APPROVED"* ]]; then
    IS_DEPLOYMENT_RUN=true
    post_log "system" "DEPLOYMENT RUN detected - PR already approved, will deploy and merge"
fi

***REMOVED*** Create branch for this task
BRANCH_NAME="ai/${JIRA_ISSUE_KEY}"
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
    ***REMOVED*** First run - create or checkout branch
    git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
fi

***REMOVED*** Update checkpoint with branch information
checkpoint_update "branch" "${BRANCH_NAME}" || true
checkpoint_update "stage" "analyzing" || true
checkpoint_update "lastAction" "Branch created and ready for analysis" || true

***REMOVED*** Construct the prompt for Claude Code
DIRECTIVE_PATH="/app/directives/${WORKER_PERSONA}/README.md"
COMMON_DIRECTIVES="/app/directives/common"
AGENTS_MD="/app/AGENTS.md"

***REMOVED*** Build the task prompt based on run type
if [ "$IS_DEPLOYMENT_RUN" = true ]; then
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

***REMOVED******REMOVED*** Task Description
${JIRA_DESCRIPTION}

***REMOVED******REMOVED*** Task Notes
${TASK_NOTES}

***REMOVED******REMOVED*** Instructions

1. Read the persona-specific directive at: ${DIRECTIVE_PATH}
2. Read the common directives in: ${COMMON_DIRECTIVES}
3. Read the agent instructions in: ${AGENTS_MD}
4. Execute the task according to the directives
5. Make all necessary code changes
6. Commit your changes with a clear message referencing ${JIRA_ISSUE_KEY}
7. Create a pull request using: node /app/execution-compiled/git/create_pr.js

**IMPORTANT**: Check the AGENTS.md for deployment workflows:
- If DEPLOYMENT_ENABLED=true: Deploy changes, create PR, merge PR
- If DEPLOYMENT_ENABLED=false: Create PR only, stop at review_requested

***REMOVED******REMOVED*** Environment Variables Available
- TICKET_KEY=${JIRA_ISSUE_KEY}
- TICKET_SUMMARY=${JIRA_SUMMARY}
- GITHUB_TOKEN is configured
- DEPLOYMENT_ENABLED=${DEPLOYMENT_ENABLED:-false}

***REMOVED******REMOVED*** Output Markers
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

post_log "system" "Starting Claude Code CLI..."
post_log "system" "Model: ${CLAUDE_MODEL:-sonnet}"

***REMOVED*** Check if Ralph execution is enabled
USE_RALPH_EXECUTION="${USE_RALPH:-false}"
if [ "$USE_RALPH_EXECUTION" = "true" ]; then
    post_log "system" "Ralph execution mode enabled" "info"

    ***REMOVED*** Run Ralph execution workflow and exit (no fallback to direct execution)
    if [ -f "/app/ralph/execute.sh" ]; then
        chmod +x /app/ralph/execute.sh
        /app/ralph/execute.sh
        exit $?
    else
        post_log "error" "ERROR: Ralph execution script not found at /app/ralph/execute.sh" "error"
        echo "::result::failed"
        exit 1
    fi
else
    post_log "system" "Direct Claude Code execution mode" "info"
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
***REMOVED*** Ensures checkpoint is saved on EXIT, even on interruption or failure
***REMOVED*** =============================================================================
trap 'checkpoint_save 2>&1 || true; [ -n "${CHECKPOINT_PID}" ] && kill ${CHECKPOINT_PID} 2>/dev/null || true' EXIT

***REMOVED*** Run Claude with stream-json and pipe through log-parser for live log streaming
***REMOVED*** Pipeline: claude (JSON output) -> tee (save raw output) -> log-parser (extract & post logs)
***REMOVED***
***REMOVED*** CRITICAL: This pipeline is the ONLY way logs appear in the dashboard.
***REMOVED*** - --output-format stream-json: Claude outputs structured JSON events
***REMOVED*** - tee: Saves raw output for marker parsing after completion
***REMOVED*** - log-parser.cjs: Extracts readable content and POSTs to /api/control-center/logs
claude \
    --print \
    --verbose \
    --dangerously-skip-permissions \
    --model "${CLAUDE_MODEL:-sonnet}" \
    --output-format stream-json \
    "${PROMPT}" \
    2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?

***REMOVED*** Show any stderr output for debugging
if [ -s "${STDERR_FILE}" ]; then
    echo "[Claude STDERR]:"
    cat "${STDERR_FILE}"
fi

echo ""
post_log "system" "Claude Code CLI completed with exit code: ${EXIT_CODE}"

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
PR_CREATED=false
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    PR_CREATED=true
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

***REMOVED*** Safety check: If there are uncommitted changes, commit them and create a PR
***REMOVED*** This catches cases where Claude creates files but mistakenly outputs no_changes
if [ "${EXIT_CODE}" -eq 0 ]; then
    UNCOMMITTED_CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    if [ "${UNCOMMITTED_CHANGES}" -gt 0 ]; then
        post_log "system" "Detected ${UNCOMMITTED_CHANGES} uncommitted changes - auto-committing..."
        git add -A
        git commit -m "feat(${JIRA_ISSUE_KEY}): Auto-commit from worker

Changes detected after Claude completed but were not committed.
Ticket: ${JIRA_ISSUE_KEY}

Co-Authored-By: Claude <noreply@anthropic.com>" 2>&1 || true

        ***REMOVED*** Push and create PR if not already created
        if [ "${PR_CREATED}" = "false" ]; then
            post_log "system" "Pushing uncommitted changes and creating PR..."
            git push -u origin "${BRANCH_NAME}" 2>&1 || true

            ***REMOVED*** Create PR via gh CLI
            PR_OUTPUT=$(gh pr create \
                --title "${JIRA_ISSUE_KEY}: ${JIRA_SUMMARY}" \
                --body "***REMOVED******REMOVED*** Summary
Auto-generated PR for uncommitted changes.

Ticket: ${JIRA_ISSUE_KEY}

🤖 Generated with WorkerMill" \
                --head "${BRANCH_NAME}" \
                --base main 2>&1) || true

            if echo "${PR_OUTPUT}" | grep -q "github.com"; then
                PR_URL=$(echo "${PR_OUTPUT}" | grep -oE "https://github\.com/[^/]+/[^/]+/pull/[0-9]+" | head -1)
                PR_NUMBER=$(echo "${PR_URL}" | grep -oE "[0-9]+$")
                PR_CREATED=true
                post_log "system" "Auto-created PR: ${PR_URL}"
            fi
        fi
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
        elif [ "${DEPLOYMENT_ENABLED}" = "true" ] && [ "${PR_CREATED}" = "true" ]; then
            ***REMOVED*** Has deploy label, agent deployed and merged - deployed
            FINAL_RESULT="deployed"
        elif [ "${PR_CREATED}" = "true" ]; then
            ***REMOVED*** PR created, waiting for approval - review_requested
            FINAL_RESULT="review_requested"
        else
            FINAL_RESULT="completed"
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

    elif [ "${FINAL_RESULT}" = "no_changes" ] || [ "${FINAL_RESULT}" = "completed" ]; then
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
