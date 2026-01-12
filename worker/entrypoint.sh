#!/bin/bash
set -e

# WorkerMill AI Worker Entrypoint
# This script runs Claude Code CLI to execute AI agent tasks

# API base URL for posting logs
API_BASE="${API_BASE_URL:-https://workermill.com}"

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

# Token tracking uses log-parser.cjs (same as oncallshift)
# No proxy needed - log-parser reads Claude's stream-json output directly
post_log "system" "Token tracking via log-parser.cjs"

# Function to stream output file to API in background (for live log viewing in dashboard)
stream_logs_to_api() {
    local output_file="$1"
    local last_line=0

    while [ -f "$output_file" ] || [ "$STREAMING_ACTIVE" = "true" ]; do
        if [ -f "$output_file" ]; then
            local current_lines=$(wc -l < "$output_file" 2>/dev/null || echo "0")
            if [ "$current_lines" -gt "$last_line" ]; then
                # Get new lines and post them (limit to 50 lines per batch)
                local new_content=$(tail -n +$((last_line + 1)) "$output_file" | head -n 50)
                if [ -n "$new_content" ]; then
                    post_log "claude_output" "$new_content" "info"
                fi
                last_line=$current_lines
            fi
        fi
        sleep 0.5
    done
}

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

# Run Claude Code in agentic mode (SAME AS ONCALLSHIFT)
echo ""
echo "[Claude] Starting Claude Agent..."
echo "================================"
post_log "system" "Starting Claude Agent (model: ${CLAUDE_MODEL:-sonnet}, max turns: ${MAX_TURNS:-50})" "info"

# Set up Claude Code with appropriate permissions
export CLAUDE_CODE_ACCEPT_EDITS=true
export CLAUDE_CODE_MAX_TURNS="${MAX_TURNS:-50}"

# Use sonnet (reliable model) until system is stable, can override with CLAUDE_MODEL env var
CLAUDE_MODEL="${CLAUDE_MODEL:-sonnet}"
echo "[Claude] Using model: ${CLAUDE_MODEL}"

# Test Claude CLI is working before running the full task
echo "[Claude] Testing CLI connectivity..."
if ! claude --version > /dev/null 2>&1; then
    echo "[ERROR] Claude CLI not working"
    post_log "error" "Claude CLI not working" "error"
    exit 1
fi

# Warn if API key missing (usage reporting depends on it)
if [ -z "${ANTHROPIC_API_KEY}" ]; then
    echo "[WARN] ANTHROPIC_API_KEY not set; token usage reporting may fail"
fi

# Run Claude Code with stream-json output for accurate token tracking
CLAUDE_OUTPUT_FILE="/tmp/claude-output.jsonl"
OUTPUT_FILE="${CLAUDE_OUTPUT_FILE}"  # Alias for marker parsing later

echo "[DEBUG] Prompt: ${PROMPT}"
echo "[DEBUG] ANTHROPIC_API_KEY set: $(test -n "${ANTHROPIC_API_KEY}" && echo "yes (${#ANTHROPIC_API_KEY} chars)" || echo "no")"
echo "[DEBUG] Working directory: $(pwd)"

# Run Claude and capture stderr separately to see errors
CLAUDE_STDERR_FILE="/tmp/claude-stderr.log"

# Start background log streaming to API (for live dashboard viewing)
touch "${CLAUDE_OUTPUT_FILE}"
export STREAMING_ACTIVE="true"
stream_logs_to_api "${CLAUDE_OUTPUT_FILE}" &
STREAM_PID=$!

# Run Claude with stream-json and pipe through log-parser.cjs (SAME AS ONCALLSHIFT)
# Pipeline: claude -> tee (save raw output) -> log-parser (extracts tokens, sends to API)
# log-parser.cjs will:
# 1. Pass through all output to stdout
# 2. Extract token usage using Math.max() accumulation
# 3. Send usage to /api/tasks/:id/usage endpoint at end
claude \
    --print \
    --verbose \
    --dangerously-skip-permissions \
    --max-turns "${MAX_TURNS:-50}" \
    --model "${CLAUDE_MODEL}" \
    --output-format stream-json \
    "${PROMPT}" \
    2>"${CLAUDE_STDERR_FILE}" | tee "${CLAUDE_OUTPUT_FILE}" | node /app/scripts/log-parser.cjs

CLAUDE_EXIT_CODE=${PIPESTATUS[0]}
EXIT_CODE=${CLAUDE_EXIT_CODE}

# Stop background log streaming
export STREAMING_ACTIVE="false"
sleep 1
kill $STREAM_PID 2>/dev/null || true

# Show any stderr output
if [ -s "${CLAUDE_STDERR_FILE}" ]; then
    echo "[Claude STDERR]:"
    cat "${CLAUDE_STDERR_FILE}"
fi

echo "================================"
echo "[Claude] Agent finished with exit code: ${CLAUDE_EXIT_CODE}"
if [ "${CLAUDE_EXIT_CODE}" -eq 0 ]; then
    post_log "system" "Claude Agent completed successfully" "info"
else
    post_log "error" "Claude Agent exited with code ${CLAUDE_EXIT_CODE}" "error"
fi

# Parse output for markers
# Note: Output may contain JSON stream data after the marker value, so we extract only the clean value
if grep -q "::pr_url::" "${OUTPUT_FILE}"; then
    # Extract URL - stops at first quote, whitespace, or end of line
    PR_URL=$(grep "::pr_url::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_url:://' | sed 's/["'"'"'\\ ].*//' | tr -d '\r\n')
    echo "::pr_url::${PR_URL}"
fi

if grep -q "::pr_number::" "${OUTPUT_FILE}"; then
    # Extract only digits for PR number
    PR_NUMBER=$(grep "::pr_number::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::pr_number:://' | grep -o '^[0-9]*')
    echo "::pr_number::${PR_NUMBER}"
fi

if grep -q "::branch::" "${OUTPUT_FILE}"; then
    # Extract branch name - stops at first quote, whitespace, or invalid char
    BRANCH=$(grep "::branch::" "${OUTPUT_FILE}" | head -1 | sed 's/.*::branch:://' | sed 's/["'"'"'\\ ].*//' | tr -d '\r\n')
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

if [ "${EXIT_CODE}" -eq 0 ]; then
    if grep -q "::result::deployed" "${OUTPUT_FILE}"; then
        FINAL_RESULT="deployed"
    elif grep -q "::result::review_requested" "${OUTPUT_FILE}"; then
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

# Post completion log
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
        export COMMENT="[AI Worker] Task deployed successfully by ${WORKER_PERSONA}. Model: ${CLAUDE_MODEL:-sonnet}"
        if [ -n "${PR_URL}" ]; then
            export COMMENT="${COMMENT}. PR: ${PR_URL}"
        fi
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Done"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "review_requested" ]; then
        export COMMENT="[AI Worker] PR created by ${WORKER_PERSONA}, awaiting review. PR: ${PR_URL}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Review Requested"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "no_changes" ] || [ "${FINAL_RESULT}" = "completed" ]; then
        export COMMENT="[AI Worker] No changes required. Model: ${CLAUDE_MODEL:-sonnet}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
        export TRANSITION_NAME="Done"
        node /app/execution-compiled/ticket/transition_issue.js 2>&1 || true

    elif [ "${FINAL_RESULT}" = "failed" ]; then
        export COMMENT="[AI Worker] Task failed. Model: ${CLAUDE_MODEL:-sonnet}. Exit code: ${EXIT_CODE}"
        node /app/execution-compiled/ticket/add_comment.js 2>&1 || true
    fi
fi

# Token usage is already sent by log-parser.cjs to /api/tasks/:id/usage
# We just need to report task completion with result and PR info

# Report back to API if we have credentials
if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
    COMPLETION_URL="${API_BASE_URL}/api/tasks/${TASK_ID}/worker-complete"
    post_log "system" "Reporting completion to API: ${COMPLETION_URL}"

    # Build JSON payload (handle empty values for prUrl, prNumber, branch)
    # Note: Token data NOT included - already sent by log-parser.cjs to /usage endpoint
    PR_URL_JSON="null"
    PR_NUMBER_JSON="null"
    BRANCH_JSON="null"
    [ -n "${PR_URL:-}" ] && PR_URL_JSON="\"${PR_URL}\""
    [ -n "${PR_NUMBER:-}" ] && PR_NUMBER_JSON="${PR_NUMBER}"
    [ -n "${BRANCH_NAME:-}" ] && BRANCH_JSON="\"${BRANCH_NAME}\""

    JSON_PAYLOAD=$(cat <<JSONEOF
{
  "exitCode": ${EXIT_CODE},
  "result": "${FINAL_RESULT}",
  "prUrl": ${PR_URL_JSON},
  "prNumber": ${PR_NUMBER_JSON},
  "branch": ${BRANCH_JSON}
}
JSONEOF
)

    # Use --fail to return non-zero on HTTP errors (4xx, 5xx)
    # Capture response to log both success and failure
    HTTP_RESPONSE=$(curl -sf -X POST "${COMPLETION_URL}" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "${JSON_PAYLOAD}" 2>&1) && {
        post_log "system" "API completion reported successfully: ${HTTP_RESPONSE}"
    } || {
        post_log "error" "Failed to report completion to API. URL: ${COMPLETION_URL}, Response: ${HTTP_RESPONSE}" "error"
    }
else
    post_log "warning" "Missing API_BASE_URL or ORG_API_KEY, cannot report completion" "warning"
fi

post_log "system" "Done."
exit ${EXIT_CODE}
