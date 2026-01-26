***REMOVED***!/bin/bash
set -e

***REMOVED*** WorkerMill Virtual Manager Entrypoint
***REMOVED*** Handles: PR review, log analysis for environment issues
***REMOVED***
***REMOVED*** Routing:
***REMOVED*** - Anthropic provider: Uses Agent SDK (Node.js) for native Claude Code integration
***REMOVED*** - Other providers: Uses shell-based approach with AI SDK executor

echo "[Manager] Starting Virtual Manager..."
echo "Task ID: ${TASK_ID}"
echo "Action: ${MANAGER_ACTION}"
echo "Repository: ${GITHUB_REPO}"
echo "Provider: ${MANAGER_PROVIDER:-anthropic}"

***REMOVED*** Route to Agent SDK for Anthropic (default)
if [ "${MANAGER_PROVIDER}" = "anthropic" ] || [ -z "${MANAGER_PROVIDER}" ]; then
    echo "[Manager] Using Agent SDK mode (Node.js)"

    ***REMOVED*** Run the Agent SDK-based manager
    exec node /app/manager/dist/index.js
fi

***REMOVED*** Fall through to shell-based approach for non-Anthropic providers
echo "[Manager] Using shell-based mode for ${MANAGER_PROVIDER}"

***REMOVED*** API base URL for posting logs
API_BASE="${API_BASE_URL:-https://workermill.com}"

***REMOVED*** Send log to Control Center API
post_log() {
    local log_type="${1:-manager}"
    local message="$2"
    local severity="${3:-info}"

    ***REMOVED*** Also echo to stdout for CloudWatch
    echo "[manager] $message"

    ***REMOVED*** Post to API (fire and forget)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 &
}

***REMOVED*** Cleanup function
cleanup() {
    rm -f ~/.git-credentials 2>/dev/null || true
}
trap cleanup EXIT

post_log "system" "Starting Virtual Manager"
post_log "system" "Task ID: ${TASK_ID}"
post_log "system" "Action: ${MANAGER_ACTION}"

***REMOVED*** Validate required environment variables
required_vars="TASK_ID MANAGER_ACTION ANTHROPIC_API_KEY GITHUB_TOKEN"
for var in $required_vars; do
    if [ -z "${!var}" ]; then
        post_log "error" "ERROR: Missing required environment variable: $var" "error"
        exit 1
    fi
done

***REMOVED*** Configure git
post_log "system" "Configuring git..."
git config --global credential.helper store
echo "https://x-access-token:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
git config --global user.name "Virtual Manager"
git config --global user.email "ai-manager@workermill.com"

***REMOVED*** Configure gh CLI
export GH_TOKEN="${GITHUB_TOKEN}"
echo "${GITHUB_TOKEN}" | gh auth login --with-token 2>/dev/null || true

***REMOVED*** Build instructions based on action
INSTRUCTIONS_FILE="/tmp/manager-instructions.md"
MANAGER_DIRECTIVE="/app/directives/manager/README.md"

***REMOVED*** Copy base Manager directive
if [ -f "${MANAGER_DIRECTIVE}" ]; then
    cp "${MANAGER_DIRECTIVE}" "${INSTRUCTIONS_FILE}"
    echo "" >> "${INSTRUCTIONS_FILE}"
    echo "---" >> "${INSTRUCTIONS_FILE}"
    echo "" >> "${INSTRUCTIONS_FILE}"
else
    post_log "warning" "Manager directive not found at ${MANAGER_DIRECTIVE}" "warning"
    touch "${INSTRUCTIONS_FILE}"
fi

***REMOVED*** Add action-specific context
case "${MANAGER_ACTION}" in
    "review_pr")
        post_log "manager" "Action: PR Code Review"

        ***REMOVED*** Clone repository for PR review
        REPO_DIR="/workspace/repo"
        post_log "system" "Cloning ${GITHUB_REPO} for PR review..."
        if ! git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git" "${REPO_DIR}" 2>&1; then
            post_log "error" "Failed to clone repository ${GITHUB_REPO}" "error"
            exit 1
        fi
        cd "${REPO_DIR}"
        post_log "system" "Clone successful"

        cat >> "${INSTRUCTIONS_FILE}" << EOF
***REMOVED*** Current Task: PR Code Review

***REMOVED******REMOVED*** Task Details
- **Task ID**: ${TASK_ID}
- **Jira Issue**: ${JIRA_ISSUE_KEY}
- **PR URL**: ${PR_URL}
- **PR Number**: ${PR_NUMBER}

***REMOVED******REMOVED*** Your Job

1. Fetch the PR diff using:
   \`\`\`bash
   gh pr diff ${PR_NUMBER}
   \`\`\`

2. Review the code against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?

3. Make a decision:
   - **APPROVE**: Code is ready to merge
   - **REVISION_NEEDED**: Has fixable issues, provide specific feedback
   - **REJECT**: Fundamental problems, cannot be fixed with revisions

4. **Submit your review to GitHub (REQUIRED)**:

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${PR_NUMBER} --approve --body "Your approval message here"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${PR_NUMBER} --request-changes --body "Your detailed feedback here"
   \`\`\`

5. Output your decision (IMPORTANT: use EXACTLY one of the three values):
   \`\`\`
   ::review_decision::approved
   \`\`\`
   OR
   \`\`\`
   ::review_decision::revision_needed
   \`\`\`
   OR
   \`\`\`
   ::review_decision::rejected
   \`\`\`

   Then add these additional fields:
   \`\`\`
   ::code_quality_score::8
   ::feedback::Your detailed feedback here (single line, no newlines)
   \`\`\`

***REMOVED******REMOVED*** Jira Task Summary
${JIRA_SUMMARY:-No summary provided}

***REMOVED******REMOVED*** Jira Task Description
${JIRA_DESCRIPTION:-No description provided}

***REMOVED******REMOVED*** Previous Review Feedback (if any)
${REVIEW_FEEDBACK:-None - this is the first review}

EOF
        ;;

    "analyze_logs")
        post_log "manager" "Action: Log Analysis (Manager Mode)"

        ***REMOVED*** No repository clone needed - only analyzes logs via API
        cd /tmp

        ***REMOVED*** Fetch worker logs from API
        post_log "system" "Fetching worker logs from API..."
        LOGS_FILE="/tmp/worker-logs.json"

        if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
            curl -sf "${API_BASE_URL}/api/control-center/logs/${TASK_ID}/all" \
                -H "x-api-key: ${ORG_API_KEY}" \
                > "${LOGS_FILE}" 2>/dev/null || echo "[]" > "${LOGS_FILE}"

            LOG_COUNT=$(jq 'length' "${LOGS_FILE}" 2>/dev/null || echo "0")
            post_log "system" "Fetched ${LOG_COUNT} log entries"
        else
            echo "[]" > "${LOGS_FILE}"
            post_log "warning" "No API credentials, skipping log fetch" "warning"
        fi

        cat >> "${INSTRUCTIONS_FILE}" << EOF
***REMOVED*** Current Task: Log Analysis (Manager Mode)

***REMOVED******REMOVED*** Task Details
- **Task ID**: ${TASK_ID}
- **Jira Issue**: ${JIRA_ISSUE_KEY}

***REMOVED******REMOVED*** Your Job

This is "training wheels" mode - analyze worker execution for environment issues.

1. Read the worker logs from: /tmp/worker-logs.json
2. Analyze for environment issues:
   - \`command not found\` - Missing tools
   - \`permission denied\` - Permission issues
   - \`No such file or directory\` - Missing files/scripts
   - Retry sequences (same tool, multiple attempts)
   - Container or deployment errors
   - AWS/infrastructure permission errors

3. For each issue found:
   - Document what went wrong
   - Suggest specific fixes for the environment

4. Post your findings as a Jira comment using curl:
   \`\`\`bash
   ***REMOVED*** Get JIRA credentials from API
   JIRA_CONFIG=\$(curl -sf -H "x-api-key: \${ORG_API_KEY}" "\${API_BASE_URL}/api/control-center/jira-config")
   JIRA_URL=\$(echo "\$JIRA_CONFIG" | jq -r '.url')
   JIRA_EMAIL=\$(echo "\$JIRA_CONFIG" | jq -r '.email')
   JIRA_API_TOKEN=\$(echo "\$JIRA_CONFIG" | jq -r '.apiToken')

   ***REMOVED*** Post comment
   curl -X POST \\
     -H "Content-Type: application/json" \\
     -u "\${JIRA_EMAIL}:\${JIRA_API_TOKEN}" \\
     "\${JIRA_URL}/rest/api/3/issue/${JIRA_ISSUE_KEY}/comment" \\
     -d '{
       "body": {
         "type": "doc",
         "version": 1,
         "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Your analysis here"}]}]
       }
     }'
   \`\`\`

5. Output your analysis:
   \`\`\`
   ::issues_found::N
   ::environment_suggestions::N
   ::analysis::Summary of your findings
   \`\`\`

***REMOVED******REMOVED*** Worker Logs
Read from: /tmp/worker-logs.json (JSON array of log entries)

Each log entry has: type, message, severity, created_at, command, exit_code, stdout, stderr

EOF
        ;;

    *)
        post_log "error" "Unknown MANAGER_ACTION: ${MANAGER_ACTION}" "error"
        exit 1
        ;;
esac

***REMOVED*** Add common environment info
cat >> "${INSTRUCTIONS_FILE}" << EOF

***REMOVED******REMOVED*** Environment
- API_BASE_URL: ${API_BASE_URL}
- Repository: ${GITHUB_REPO}
- Working directory: $(pwd)

***REMOVED******REMOVED*** API Authentication
Use the ORG_API_KEY environment variable with x-api-key header:
\`\`\`bash
curl -H "x-api-key: \${ORG_API_KEY}" ...
\`\`\`

EOF

post_log "system" "Manager instructions created"

***REMOVED*** Select Claude model based on action
if [ -n "${CLAUDE_MODEL}" ]; then
    ***REMOVED*** Use configured model
    if [[ "${CLAUDE_MODEL}" == *"opus"* ]]; then
        CLAUDE_MODEL="opus"
    elif [[ "${CLAUDE_MODEL}" == *"haiku"* ]]; then
        CLAUDE_MODEL="haiku"
    else
        CLAUDE_MODEL="sonnet"
    fi
else
    ***REMOVED*** Default model per action
    case "${MANAGER_ACTION}" in
        "review_pr")
            CLAUDE_MODEL="opus"  ***REMOVED*** Best reasoning for code review
            ;;
        "analyze_logs")
            CLAUDE_MODEL="haiku"  ***REMOVED*** Fast for pattern extraction
            ;;
    esac
fi

***REMOVED*** Set max turns based on action
case "${MANAGER_ACTION}" in
    "review_pr")
        MAX_TURNS=30
        ;;
    "analyze_logs")
        MAX_TURNS=20
        ;;
esac

post_log "system" "Starting Claude Agent (model: ${CLAUDE_MODEL}, max turns: ${MAX_TURNS})"

***REMOVED*** Set up Claude Code
export CLAUDE_CODE_ACCEPT_EDITS=true
export CLAUDE_CODE_MAX_TURNS="${MAX_TURNS}"

***REMOVED*** Run AI Agent (Claude CLI or AI SDK based on provider)
CLAUDE_OUTPUT_FILE="/tmp/claude-output.jsonl"

***REMOVED*** Route based on provider setting
if [ "${MANAGER_PROVIDER}" = "anthropic" ] || [ -z "${MANAGER_PROVIDER}" ]; then
    ***REMOVED*** Agent SDK (Claude Code CLI) - proven working for Anthropic
    post_log "system" "Using Agent SDK (Claude Code CLI) for Anthropic"
    PROMPT="Read the file ${INSTRUCTIONS_FILE} and follow the instructions exactly. Start by reading the file now."

    claude \
        --print \
        --verbose \
        --dangerously-skip-permissions \
        --max-turns "${MAX_TURNS}" \
        --model "${CLAUDE_MODEL}" \
        --output-format stream-json \
        "${PROMPT}" \
        2>/tmp/claude-stderr.log | tee "${CLAUDE_OUTPUT_FILE}" | while IFS= read -r line; do
        if echo "$line" | jq -e '.type == "assistant" and .message.content' > /dev/null 2>&1; then
            text_content=$(echo "$line" | jq -r '.message.content[]? | select(.type == "text") | .text // empty' 2>/dev/null)
            if [ -n "$text_content" ]; then
                echo "$text_content"
                truncated=$(echo "$text_content" | head -c 500 | tr '\n' ' ' | sed 's/"/\\"/g')
                post_log "manager_output" "$truncated" "info"
            fi
        fi
    done
else
    ***REMOVED*** AI SDK (Vercel) for non-Anthropic providers (OpenAI, Google, Ollama)
    post_log "system" "Using AI SDK for ${MANAGER_PROVIDER} (model: ${MANAGER_MODEL})"

    ***REMOVED*** Set working directory for AI SDK executor
    export AGENT_WORKING_DIR="${REPO_DIR:-/workspace/repo}"
    export AGENT_MAX_STEPS="${MAX_TURNS}"

    ***REMOVED*** Run AI SDK executor with manager persona
    node /app/agents/ai-sdk-executor.js \
        --provider "${MANAGER_PROVIDER}" \
        --model "${MANAGER_MODEL}" \
        --persona manager \
        --prompt-file "${INSTRUCTIONS_FILE}" \
        2>/tmp/claude-stderr.log | tee "${CLAUDE_OUTPUT_FILE}" | while IFS= read -r line; do
        ***REMOVED*** Log all output from AI SDK executor
        if [ -n "$line" ]; then
            echo "$line"
            truncated=$(echo "$line" | head -c 500 | tr '\n' ' ' | sed 's/"/\\"/g')
            post_log "manager_output" "$truncated" "info"
        fi
    done
fi

CLAUDE_EXIT_CODE=${PIPESTATUS[0]}

***REMOVED*** Show stderr
if [ -s "/tmp/claude-stderr.log" ]; then
    echo "[Claude STDERR]:"
    cat /tmp/claude-stderr.log
fi

echo "================================"
echo "[Claude] Agent finished with exit code: ${CLAUDE_EXIT_CODE}"

***REMOVED*** Parse output markers
if [ "${CLAUDE_EXIT_CODE}" -eq 0 ]; then
    post_log "system" "Manager completed successfully"

    ***REMOVED*** Use tail -1 to get the LAST match (actual output), not first (template text)
    DECISION=$(grep -oP '::review_decision::\K(approved|revision_needed|rejected)' "${CLAUDE_OUTPUT_FILE}" 2>/dev/null | tail -1 || echo "")
    CODE_QUALITY=$(grep -oP '::code_quality_score::\K[0-9]+' "${CLAUDE_OUTPUT_FILE}" 2>/dev/null | tail -1 || echo "")
    FEEDBACK=$(grep -oP '::feedback::\K[^\n]+' "${CLAUDE_OUTPUT_FILE}" 2>/dev/null | tail -1 || echo "")

    ***REMOVED*** Default to approved if no decision marker found (manager didn't find issues)
    if [ -z "${DECISION}" ]; then
        DECISION="approved"
        post_log "system" "No explicit decision marker found, defaulting to approved"
    fi

    echo "[Manager] Parsed: decision=${DECISION}, codeQuality=${CODE_QUALITY}"
    echo "[Manager] Feedback: ${FEEDBACK:0:100}..."

    ***REMOVED*** Post result markers to database for orchestrator backup detection
    ***REMOVED*** These markers allow monitorManagerTasks() to detect completion if API call fails
    post_log "system" "::manager_decision::${DECISION}" "info"
    if [ -n "${CODE_QUALITY}" ]; then
        post_log "system" "::manager_score::${CODE_QUALITY}" "info"
    fi
    if [ -n "${FEEDBACK}" ]; then
        ***REMOVED*** Truncate feedback to 500 chars for log marker
        post_log "system" "::manager_feedback::${FEEDBACK:0:500}" "info"
    fi

    ***REMOVED*** Report completion to API
    if [ -n "${API_BASE_URL}" ] && [ -n "${ORG_API_KEY}" ]; then
        post_log "system" "Reporting manager completion to API..."

        ***REMOVED*** Build JSON payload using jq to handle escaping properly
        JSON_PAYLOAD=$(jq -n \
            --arg decision "${DECISION:-unknown}" \
            --arg feedback "$(echo "${FEEDBACK:-No feedback provided}" | tr -d '\r' | head -c 2000)" \
            --argjson codeQualityScore "${CODE_QUALITY:-0}" \
            --arg managerModel "${CLAUDE_MODEL}" \
            '{
                decision: $decision,
                feedback: $feedback,
                codeQualityScore: $codeQualityScore,
                managerModel: $managerModel
            }'
        )

        ***REMOVED*** Retry completion reporting up to 3 times with exponential backoff
        COMPLETION_REPORTED=false
        MAX_RETRIES=3
        RETRY_DELAY=2

        for ATTEMPT in $(seq 1 $MAX_RETRIES); do
            HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/api-response.txt \
                --connect-timeout 10 \
                --max-time 30 \
                -X POST "${API_BASE_URL}/api/tasks/${TASK_ID}/manager-complete" \
                -H "x-api-key: ${ORG_API_KEY}" \
                -H "Content-Type: application/json" \
                -d "${JSON_PAYLOAD}" 2>&1)
            RESPONSE=$(cat /tmp/api-response.txt 2>/dev/null || echo "")

            if [ "$HTTP_CODE" = "200" ]; then
                post_log "system" "Manager completion reported successfully: ${RESPONSE}"
                COMPLETION_REPORTED=true
                break
            else
                post_log "error" "Attempt ${ATTEMPT}/${MAX_RETRIES}: Failed to report manager completion (HTTP ${HTTP_CODE}): ${RESPONSE}" "error"
                if [ "$ATTEMPT" -lt "$MAX_RETRIES" ]; then
                    sleep $RETRY_DELAY
                    RETRY_DELAY=$((RETRY_DELAY * 2))
                fi
            fi
        done

        if [ "$COMPLETION_REPORTED" = "false" ]; then
            post_log "error" "All ${MAX_RETRIES} attempts to report manager completion failed. Orchestrator will detect via log markers." "error"
        fi
    fi
else
    post_log "error" "Manager exited with code ${CLAUDE_EXIT_CODE}" "error"
    post_log "system" "::manager_decision::failed" "info"
fi

exit ${CLAUDE_EXIT_CODE}
