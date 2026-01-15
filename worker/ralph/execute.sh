#!/bin/bash
# Ralph Execution Helper Script
# Orchestrates the Ralph PRD-to-code workflow
# Called from entrypoint.sh when USE_RALPH=true

set -e

# =============================================================================
# Log Streaming Functions
# =============================================================================

# Post log helper (passed from parent script)
post_log() {
    local log_type="${1:-system}"
    local message="$2"
    local severity="${3:-info}"

    echo "[worker] $message"

    # Post to API (fire and forget, don't block on failure)
    curl -s -X POST "${API_BASE}/api/control-center/logs" \
        -H "Content-Type: application/json" \
        -d "{\"taskId\": \"${TASK_ID}\", \"type\": \"${log_type}\", \"message\": \"${message}\", \"severity\": \"${severity}\"}" \
        >/dev/null 2>&1 &
}

# Post Ralph-specific log with [ralph] prefix
post_ralph_log() {
    local message="$1"
    local severity="${2:-info}"
    post_log "system" "[ralph] $message" "$severity"
}

# =============================================================================
# Progress Tracking
# =============================================================================

# Last known progress state (to avoid duplicate logging)
LAST_PROGRESS_MARKER=""
LAST_COMPLETED_COUNT=0

# Parse and report progress from .ralph/progress.json
check_progress() {
    local progress_file="/workspace/repo/.ralph/progress.json"

    if [ ! -f "$progress_file" ]; then
        return 0
    fi

    # Run progress parser if available
    if [ -f "/app/ralph/parse-progress.sh" ]; then
        PROGRESS_OUTPUT=$(/app/ralph/parse-progress.sh "$progress_file" 2>/dev/null || true)

        if [ -n "$PROGRESS_OUTPUT" ]; then
            # Extract progress marker
            PROGRESS_MARKER=$(echo "$PROGRESS_OUTPUT" | grep "::ralph_progress::" | head -1 || true)

            # Only log if progress changed
            if [ -n "$PROGRESS_MARKER" ] && [ "$PROGRESS_MARKER" != "$LAST_PROGRESS_MARKER" ]; then
                # Parse the marker: ::ralph_progress::<current>/<total>::<description>
                PROGRESS_PART=$(echo "$PROGRESS_MARKER" | sed 's/::ralph_progress:://' | cut -d':' -f1)
                DESCRIPTION=$(echo "$PROGRESS_MARKER" | sed 's/::ralph_progress::[^:]*:://')

                CURRENT=$(echo "$PROGRESS_PART" | cut -d'/' -f1)
                TOTAL=$(echo "$PROGRESS_PART" | cut -d'/' -f2)

                post_ralph_log "Story ${CURRENT}/${TOTAL}: ${DESCRIPTION}"
                echo "$PROGRESS_MARKER"

                LAST_PROGRESS_MARKER="$PROGRESS_MARKER"
            fi

            # Check for completed stories count
            COMPLETED_LINE=$(echo "$PROGRESS_OUTPUT" | grep "::ralph_stories_completed::" | head -1 || true)
            if [ -n "$COMPLETED_LINE" ]; then
                COMPLETED_COUNT=$(echo "$COMPLETED_LINE" | sed 's/::ralph_stories_completed:://')
                if [ "$COMPLETED_COUNT" != "$LAST_COMPLETED_COUNT" ] && [ "$COMPLETED_COUNT" -gt "$LAST_COMPLETED_COUNT" ]; then
                    post_ralph_log "Completed ${COMPLETED_COUNT} stories"
                    LAST_COMPLETED_COUNT="$COMPLETED_COUNT"
                fi
            fi
        fi
    fi
}

# =============================================================================
# Activity Log Streaming
# =============================================================================

# Start streaming Ralph activity log with robust file handling
# Handles: file not existing initially, truncation, rotation
start_activity_log_streaming() {
    local log_file="/workspace/repo/.ralph/activity.log"

    (
        # Wait for log file to be created (with timeout)
        WAIT_COUNT=0
        while [ ! -f "$log_file" ] && [ $WAIT_COUNT -lt 30 ]; do
            sleep 1
            WAIT_COUNT=$((WAIT_COUNT + 1))
        done

        if [ ! -f "$log_file" ]; then
            echo "[ralph-stream] Activity log not created within 30s timeout" >&2
            return 0
        fi

        # Use tail -F (capital F) to follow file even through truncation/rotation
        # --retry keeps trying if file becomes inaccessible temporarily
        tail -F --retry "$log_file" 2>/dev/null | while IFS= read -r line; do
            # Skip empty lines
            [ -z "$line" ] && continue

            # Prefix all Ralph activity logs
            post_ralph_log "$line"
        done
    ) &

    ACTIVITY_TAIL_PID=$!
    echo "$ACTIVITY_TAIL_PID"
}

# Start progress monitoring loop
start_progress_monitoring() {
    (
        while true; do
            sleep 5
            check_progress 2>/dev/null || true
        done
    ) &

    PROGRESS_MONITOR_PID=$!
    echo "$PROGRESS_MONITOR_PID"
}

# =============================================================================
# Claude Code Log Streaming (from Ralph subprocess)
# =============================================================================

# Stream Claude Code output from Ralph's subprocess
# Ralph invokes Claude Code which writes to its own log/output
# We capture this via Ralph's activity log which includes Claude output
stream_ralph_output() {
    local output_file="$1"

    if [ -f "$output_file" ]; then
        # Stream output through to console (and thus to entrypoint's log parser)
        tail -f "$output_file" 2>/dev/null &
        echo $!
    fi
}

# =============================================================================
# Cleanup Handler
# =============================================================================

PIDS_TO_CLEANUP=""

cleanup_processes() {
    for pid in $PIDS_TO_CLEANUP; do
        kill "$pid" 2>/dev/null || true
    done
}

trap cleanup_processes EXIT

# =============================================================================
# Main Execution
# =============================================================================

# Ensure .ralph directory exists
mkdir -p /workspace/repo/.ralph

# Step 1: Convert Jira ticket to PRD format
post_log "system" "Step 1: Converting Jira ticket to PRD format..." "info"

# Build Jira ticket JSON for the converter
JIRA_TICKET_JSON=$(jq -n \
    --arg key "${JIRA_ISSUE_KEY}" \
    --arg summary "${JIRA_SUMMARY}" \
    --arg description "${JIRA_DESCRIPTION:-}" \
    --arg acceptanceCriteria "${TASK_NOTES:-}" \
    --arg technicalNotes "${TASK_NOTES:-}" \
    '{key: $key, summary: $summary, description: $description, acceptanceCriteria: $acceptanceCriteria, technicalNotes: $technicalNotes}')

export JIRA_TICKET_JSON

# Compile and run the Jira-to-PRD converter
if [ -f "/app/execution-compiled/ralph/jira-to-prd.js" ]; then
    node /app/execution-compiled/ralph/jira-to-prd.js 2>&1 || {
        post_log "error" "ERROR: Jira-to-PRD conversion failed" "error"
        echo "::result::failed"
        exit 1
    }
else
    post_log "warning" "jira-to-prd.js not compiled, skipping PRD generation (execution-compiled/ralph/ directory)" "warning"
fi

# Step 2: Create Ralph configuration
post_log "system" "Step 2: Setting up Ralph configuration..." "info"

# Copy and customize Ralph config
if [ -f "/app/ralph/config.template.json" ]; then
    # Substitute environment variables in config template
    CONFIG_CONTENT=$(cat /app/ralph/config.template.json)
    CONFIG_CONTENT="${CONFIG_CONTENT//\${CLAUDE_MODEL}/${CLAUDE_MODEL}}"
    CONFIG_CONTENT="${CONFIG_CONTENT//\${RALPH_MAX_STORIES}/${RALPH_MAX_STORIES:-10}}"
    CONFIG_CONTENT="${CONFIG_CONTENT//\${RALPH_RETRIES}/${RALPH_RETRIES:-3}}"

    echo "$CONFIG_CONTENT" > /workspace/repo/.ralph/config.json
    post_ralph_log "Config written to .ralph/config.json"
else
    post_log "warning" "Ralph config template not found at /app/ralph/config.template.json" "warning"
fi

# Step 3: Run Ralph planning
post_log "system" "Step 3: Running Ralph planning phase..." "info"
cd /workspace/repo

if command -v ralph >/dev/null 2>&1; then
    post_ralph_log "Starting planning phase..."

    ralph plan --config .ralph/config.json 2>&1 | while IFS= read -r line; do
        # Stream planning output with [ralph] prefix
        [ -n "$line" ] && post_ralph_log "$line"
    done || {
        RALPH_PLAN_EXIT=$?
        post_log "error" "ERROR: Ralph planning failed (exit code: $RALPH_PLAN_EXIT)" "error"
        echo "::result::failed"
        exit 1
    }

    # Check planning results
    if [ -f ".ralph/progress.json" ]; then
        STORY_COUNT=$(jq -r '.totalStories // (.stories | length) // 0' .ralph/progress.json 2>/dev/null || echo "0")
        post_ralph_log "Planning complete. ${STORY_COUNT} stories ready for execution."
        echo "::ralph_plan_complete::${STORY_COUNT}"
    fi
else
    post_log "error" "ERROR: Ralph CLI not found in PATH" "error"
    echo "::result::failed"
    exit 1
fi

# Step 4: Run Ralph execution loop
post_log "system" "Step 4: Starting Ralph execution loop..." "info"
post_ralph_log "Starting execution loop..."

# Start background activity log streaming (with rotation handling)
ACTIVITY_PID=$(start_activity_log_streaming)
if [ -n "$ACTIVITY_PID" ]; then
    PIDS_TO_CLEANUP="$PIDS_TO_CLEANUP $ACTIVITY_PID"
    post_ralph_log "Activity log streaming started (PID: $ACTIVITY_PID)"
fi

# Start progress monitoring loop
PROGRESS_PID=$(start_progress_monitoring)
if [ -n "$PROGRESS_PID" ]; then
    PIDS_TO_CLEANUP="$PIDS_TO_CLEANUP $PROGRESS_PID"
    post_ralph_log "Progress monitoring started (PID: $PROGRESS_PID)"
fi

# Run Ralph loop - stream output directly
# Ralph's loop command invokes Claude Code for each story
# The activity.log captures Ralph-level events, while Claude's output
# goes through Ralph's configured agent command
RALPH_LOOP_EXIT=0
ralph loop --config .ralph/config.json 2>&1 | while IFS= read -r line; do
    # Skip empty lines
    [ -z "$line" ] && continue

    # Detect story transitions from Ralph output
    if echo "$line" | grep -qi "starting story\|beginning story"; then
        post_ralph_log "$line"
    elif echo "$line" | grep -qi "completed story\|finished story"; then
        post_ralph_log "$line"
        # Check progress after story completion
        check_progress
    elif echo "$line" | grep -qi "error\|failed\|exception"; then
        post_ralph_log "$line" "warning"
    else
        # Regular output - could be Claude Code output
        # Pass through without [ralph] prefix if it looks like Claude output
        if echo "$line" | grep -qE "^\[claude\]|^Claude|assistant>|tool>"; then
            post_log "system" "$line" "info"
        else
            post_ralph_log "$line"
        fi
    fi
done || RALPH_LOOP_EXIT=$?

# Check Ralph loop exit status
if [ $RALPH_LOOP_EXIT -ne 0 ]; then
    post_log "error" "ERROR: Ralph execution loop failed (exit code: $RALPH_LOOP_EXIT)" "error"
    echo "::result::failed"
    exit 1
fi

post_ralph_log "Execution loop completed"

# Final progress check
check_progress

# Parse final results from progress.json
FINAL_RESULT="deployed"
if [ -f "/workspace/repo/.ralph/progress.json" ]; then
    # Get final status
    RALPH_STATUS=$(jq -r '.status // "unknown"' /workspace/repo/.ralph/progress.json 2>/dev/null || echo "unknown")
    COMPLETED=$(jq -r '.completedStories // 0' /workspace/repo/.ralph/progress.json 2>/dev/null || echo "0")
    TOTAL=$(jq -r '.totalStories // (.stories | length) // 0' /workspace/repo/.ralph/progress.json 2>/dev/null || echo "0")

    post_ralph_log "Final status: ${RALPH_STATUS}, Stories: ${COMPLETED}/${TOTAL}"

    # Map Ralph status to WorkerMill result
    case "$RALPH_STATUS" in
        completed|success)
            FINAL_RESULT="deployed"
            ;;
        partial|incomplete)
            FINAL_RESULT="escalated"
            post_ralph_log "Partial completion - some stories may have failed" "warning"
            ;;
        failed|error)
            FINAL_RESULT="failed"
            ;;
        *)
            # Check if we completed all stories
            if [ "$COMPLETED" = "$TOTAL" ] && [ "$TOTAL" != "0" ]; then
                FINAL_RESULT="deployed"
            elif [ "$COMPLETED" != "0" ]; then
                FINAL_RESULT="escalated"
            fi
            ;;
    esac

    # Extract PR URL if created by Ralph
    PR_URL=$(jq -r '.prUrl // empty' /workspace/repo/.ralph/progress.json 2>/dev/null || true)
    PR_NUMBER=$(jq -r '.prNumber // empty' /workspace/repo/.ralph/progress.json 2>/dev/null || true)

    if [ -n "$PR_URL" ]; then
        echo "::pr_url::${PR_URL}"
        post_ralph_log "PR created: ${PR_URL}"
    fi
    if [ -n "$PR_NUMBER" ]; then
        echo "::pr_number::${PR_NUMBER}"
    fi
fi

# Check activity log for errors (fallback detection)
if [ -f "/workspace/repo/.ralph/activity.log" ]; then
    ERROR_COUNT=$(grep -ci "error\|failed\|exception" /workspace/repo/.ralph/activity.log 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" -gt 0 ] && [ "$FINAL_RESULT" = "deployed" ]; then
        FINAL_RESULT="escalated"
        post_ralph_log "Detected ${ERROR_COUNT} error(s) in activity log - marked as escalated" "warning"
    fi
fi

echo "::result::${FINAL_RESULT}"
post_log "status_change" "Ralph execution completed with result: ${FINAL_RESULT}" "info"

exit 0
