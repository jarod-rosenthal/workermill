#!/bin/bash
set -e

# WorkerMill AI Worker Entrypoint
# This script runs Claude Code CLI to execute AI agent tasks

# API base URL for posting logs
API_BASE="${API_BASE_URL:-https://workermill.com}"

# Format persona name for display (backend_developer -> Backend Developer)
format_persona() {
    echo "$1" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g'
}
PERSONA_DISPLAY=$(format_persona "${WORKER_PERSONA}")

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

post_log "system" "Starting WorkerMill AI Worker"
post_log "system" "Task ID: ${TASK_ID}"
post_log "system" "Jira Issue: ${JIRA_ISSUE_KEY}"
post_log "system" "Persona: ${WORKER_PERSONA}"
post_log "system" "Model: ${CLAUDE_MODEL}"
post_log "system" "Retry: ${RETRY_NUMBER:-0}"

# Validate required environment variables
required_vars="TASK_ID JIRA_ISSUE_KEY JIRA_SUMMARY GITHUB_REPO WORKER_PERSONA ANTHROPIC_API_KEY GITHUB_TOKEN"
for var in $required_vars; do
    if [ -z "${!var}" ]; then
        post_log "error" "ERROR: Missing required environment variable: $var" "error"
        echo "::result::error_missing_env"
        exit 1
    fi
done

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

post_log "system" "Cloning repository ${GITHUB_REPO}..."
cd /workspace

# Clone the repository
if ! git clone "${REPO_URL}" repo 2>&1; then
    post_log "error" "ERROR: Failed to clone repository" "error"
    echo "::result::error_clone_failed"
    exit 1
fi
post_log "system" "Repository cloned successfully"

cd repo

# Detect if this is a deployment run (second run after PR approval)
IS_DEPLOYMENT_RUN=false
if [[ "${TASK_NOTES}" == *"DEPLOYMENT_RUN"* ]] || [[ "${TASK_NOTES}" == *"PR_APPROVED"* ]]; then
    IS_DEPLOYMENT_RUN=true
    post_log "system" "DEPLOYMENT RUN detected - PR already approved, will deploy and merge"
fi

# Create branch for this task
BRANCH_NAME="ai/${JIRA_ISSUE_KEY}"
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
    # First run - create or checkout branch
    git checkout -b "${BRANCH_NAME}" 2>/dev/null || git checkout "${BRANCH_NAME}"
fi

# Construct the prompt for Claude Code
DIRECTIVE_PATH="/app/directives/${WORKER_PERSONA}/README.md"
COMMON_DIRECTIVES="/app/directives/common"
AGENTS_MD="/app/AGENTS.md"

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

## Instructions

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
- ::pr_url::<url> if PR was created
- ::pr_number::<number> if PR was created
- ::input_tokens::<count> for token tracking
- ::output_tokens::<count> for token tracking

Begin executing the task now.
EOF
    )
fi

post_log "system" "Starting Claude Code CLI..."
post_log "system" "Model: ${CLAUDE_MODEL:-sonnet}"

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
export TASK_ID ORG_ID API_BASE_URL ORG_API_KEY CLAUDE_MODEL

# Check if log-parser exists and set up the pipeline
if [ -f "${LOG_PARSER_SCRIPT}" ]; then
    post_log "system" "Live log streaming enabled via log-parser.cjs" "info"
    LOG_PARSER_CMD="node ${LOG_PARSER_SCRIPT}"
else
    post_log "warning" "log-parser.cjs not found at ${LOG_PARSER_SCRIPT}, logs will not stream to dashboard" "warning"
    LOG_PARSER_CMD="cat"  # Passthrough if parser not available
fi

# Run Claude with stream-json and pipe through log-parser for live log streaming
# Pipeline: claude (JSON output) -> tee (save raw output) -> log-parser (extract & post logs)
#
# CRITICAL: This pipeline is the ONLY way logs appear in the dashboard.
# - --output-format stream-json: Claude outputs structured JSON events
# - tee: Saves raw output for marker parsing after completion
# - log-parser.cjs: Extracts readable content and POSTs to /api/control-center/logs
claude \
    --print \
    --verbose \
    --dangerously-skip-permissions \
    --model "${CLAUDE_MODEL:-sonnet}" \
    --output-format stream-json \
    "${PROMPT}" \
    2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}" | ${LOG_PARSER_CMD} || EXIT_CODE=$?

# Show any stderr output for debugging
if [ -s "${STDERR_FILE}" ]; then
    echo "[Claude STDERR]:"
    cat "${STDERR_FILE}"
fi

echo ""
post_log "system" "Claude Code CLI completed with exit code: ${EXIT_CODE}"

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
PR_CREATED=false
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    PR_CREATED=true
elif grep -qE "github\.com/[^/]+/[^/]+/pull/[0-9]+" "${OUTPUT_FILE}"; then
    # Extract PR URL from natural language output
    DETECTED_PR_URL=$(grep -oE "https://github\.com/[^/]+/[^/]+/pull/[0-9]+" "${OUTPUT_FILE}" | head -1)
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

# Safety check: If there are uncommitted changes, commit them and create a PR
# This catches cases where Claude creates files but mistakenly outputs no_changes
if [ "${EXIT_CODE}" -eq 0 ]; then
    UNCOMMITTED_CHANGES=$(git status --porcelain 2>/dev/null | wc -l)
    if [ "${UNCOMMITTED_CHANGES}" -gt 0 ]; then
        post_log "system" "Detected ${UNCOMMITTED_CHANGES} uncommitted changes - auto-committing..."
        git add -A
        git commit -m "feat(${JIRA_ISSUE_KEY}): Auto-commit from worker

Changes detected after Claude completed but were not committed.
Ticket: ${JIRA_ISSUE_KEY}

Co-Authored-By: Claude <noreply@anthropic.com>" 2>&1 || true

        # Push and create PR if not already created
        if [ "${PR_CREATED}" = "false" ]; then
            post_log "system" "Pushing uncommitted changes and creating PR..."
            git push -u origin "${BRANCH_NAME}" 2>&1 || true

            # Create PR via gh CLI
            PR_OUTPUT=$(gh pr create \
                --title "${JIRA_ISSUE_KEY}: ${JIRA_SUMMARY}" \
                --body "## Summary
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
    if grep -q "::result::deployed" "${OUTPUT_FILE}"; then
        FINAL_RESULT="deployed"
    elif grep -q "::result::review_requested" "${OUTPUT_FILE}"; then
        FINAL_RESULT="review_requested"
    elif grep -q "::result::no_changes" "${OUTPUT_FILE}" && [ "${PR_CREATED}" = "true" ]; then
        # Claude said no_changes but we auto-created a PR for uncommitted files
        FINAL_RESULT="review_requested"
    elif grep -q "::result::no_changes" "${OUTPUT_FILE}"; then
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
        else
            FINAL_RESULT="completed"
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
fi

post_log "system" "Token usage: input=${INPUT_TOKENS}, output=${OUTPUT_TOKENS}, cache_creation=${CACHE_CREATION_TOKENS}, cache_read=${CACHE_READ_TOKENS}"

# Report back to API if we have credentials
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    post_log "system" "Reporting completion to API..."

    # Build JSON payload using jq to handle escaping properly
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
