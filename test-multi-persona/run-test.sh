***REMOVED***!/bin/bash
***REMOVED*** run-test.sh - Multi-Persona Single Container Test Harness
***REMOVED***
***REMOVED*** This script proves out the core concept:
***REMOVED*** 1. Sequential subtask execution with different personas
***REMOVED*** 2. Fresh Claude Code context per subtask
***REMOVED*** 3. Context handoff via file-based mock of WorkerContext API
***REMOVED*** 4. Git commits per subtask
***REMOVED*** 5. Transactional subtasks with retry/rollback on failure
***REMOVED***
***REMOVED*** Usage: ./run-test.sh [--dry-run]

set -e

***REMOVED*** Configuration
export TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKERMILL_DIR="$(dirname "$TEST_DIR")"
TEST_REPO="${TEST_DIR}/test-repo"
SUBTASKS_FILE="${TEST_DIR}/subtasks.json"
DIRECTIVES_DIR="${WORKERMILL_DIR}/worker/directives"
AGENTS_MD="${WORKERMILL_DIR}/worker/AGENTS.md"

***REMOVED*** Retry configuration
MAX_RETRIES=2

***REMOVED*** Check for dry-run mode (shows prompts without running Claude)
DRY_RUN=false
if [ "$1" == "--dry-run" ]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE - Will show prompts but not execute Claude ==="
fi

***REMOVED*** Source helper functions
source "${TEST_DIR}/helpers.sh"

***REMOVED*** Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' ***REMOVED*** No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_retry() { echo -e "${MAGENTA}[RETRY]${NC} $1"; }

***REMOVED*** Verify prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v claude &> /dev/null; then
        log_error "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Install with: apt install jq (or brew install jq)"
        exit 1
    fi

    if [ ! -f "$SUBTASKS_FILE" ]; then
        log_error "Subtasks file not found: $SUBTASKS_FILE"
        exit 1
    fi

    if [ ! -d "$DIRECTIVES_DIR" ]; then
        log_error "Directives directory not found: $DIRECTIVES_DIR"
        exit 1
    fi

    log_success "Prerequisites OK"
}

***REMOVED*** Initialize test repository
init_test_repo() {
    log_info "Initializing test repository..."

    ***REMOVED*** Clean up any existing test repo
    rm -rf "$TEST_REPO"
    mkdir -p "$TEST_REPO"

    cd "$TEST_REPO"
    git init
    git config user.email "test@workermill.local"
    git config user.name "WorkerMill Test"

    ***REMOVED*** Create initial structure
    mkdir -p src
    cat > package.json << 'EOF'
{
  "name": "multi-persona-test",
  "version": "1.0.0",
  "description": "Test project for multi-persona execution",
  "scripts": {
    "start": "node src/index.js",
    "test": "echo \"Tests would run here\""
  }
}
EOF

    cat > README.md << 'EOF'
***REMOVED*** Multi-Persona Test Project

This project is being built by multiple AI personas working sequentially.

***REMOVED******REMOVED*** Personas involved:
- Backend Developer: API implementation
- Frontend Developer: UI components
- QA Engineer: Testing and validation
EOF

    git add -A
    git commit -m "Initial project setup"

    log_success "Test repository initialized at $TEST_REPO"
    cd "$TEST_DIR"
}

***REMOVED*** Reset context store for fresh test
reset_context() {
    log_info "Resetting context store..."
    rm -f "${TEST_DIR}/context-store.json"
    init_context_store
    log_success "Context store reset"
}

***REMOVED*** Get current context count for a persona
get_persona_context_count() {
    local persona="$1"
    jq "[.contexts[] | select(.persona == \"$persona\")] | length" "$CONTEXT_FILE" 2>/dev/null || echo "0"
}

***REMOVED*** Build prompt for a subtask
build_prompt() {
    local persona="$1"
    local title="$2"
    local description="$3"
    local sibling_context="$4"

    local directive_file="${DIRECTIVES_DIR}/${persona}/README.md"
    local directive_content=""

    if [ -f "$directive_file" ]; then
        directive_content=$(cat "$directive_file")
    else
        directive_content="You are a ${persona}. Follow best practices for your role."
        log_warn "Directive file not found for ${persona}, using default"
    fi

    ***REMOVED*** Build the prompt
    cat << PROMPT_EOF
***REMOVED*** Multi-Persona Pipeline Task

***REMOVED******REMOVED*** Your Role
You are acting as a **${persona}**. This is a subtask in a larger multi-step pipeline.

***REMOVED******REMOVED*** Previous Developer Context

The following messages were left by previous personas in this pipeline:

${sibling_context}

Pay special attention to:
- **decision** messages: Architectural choices you should align with
- **file_created** messages: Files that already exist for you to use
- **completion** messages: What's already done and how to use it
- **progress** messages: Notes specifically for you

***REMOVED******REMOVED*** Your Subtask
**Title:** ${title}

**Description:**
${description}

***REMOVED******REMOVED*** Your Directives
${directive_content}

***REMOVED******REMOVED*** Working Directory
You are working in a git repository. Make your changes directly to the files.

***REMOVED******REMOVED*** MANDATORY: Output Context Markers

After completing your work, you MUST output these markers so the next persona knows what you did.
These are plain text markers that get parsed by the orchestrator - just print them as output.

**Required format:**
\`\`\`
::context::decision::Brief description of architectural decisions you made
::context::file_created::path/to/file.js - what the file does
::context::completion::Summary of what you built and how to use it
::context::progress::Any notes or suggestions for next developer
\`\`\`

**Example output at end of your response:**
\`\`\`
::context::decision::Using Express.js with REST conventions
::context::file_created::src/api.js - greeting API endpoint
::context::completion::Created GET /api/greet/:name endpoint. Start with npm start.
::context::progress::Consider adding rate limiting
\`\`\`

**CRITICAL:** You MUST output at least one \`::context::completion::\` marker or the pipeline will FAIL and RETRY.

***REMOVED******REMOVED*** Output
Make your code changes, then output the context markers. Keep responses concise.
PROMPT_EOF
}

***REMOVED*** Parse context markers from output and post them
***REMOVED*** Returns 0 if at least one ::context::completion:: marker was found
parse_and_post_context_markers() {
    local output_file="$1"
    local persona="$2"
    local found_completion=false
    local marker_count=0

    log_info "Parsing context markers from output..."

    ***REMOVED*** Extract all ::context:: markers from the output
    while IFS= read -r line; do
        ***REMOVED*** Match ::context::<type>::<content>
        if [[ "$line" =~ ::context::([a-z_]+)::(.+) ]]; then
            local msg_type="${BASH_REMATCH[1]}"
            local content="${BASH_REMATCH[2]}"

            ***REMOVED*** Clean up content (remove trailing whitespace, quotes, backticks)
            content=$(echo "$content" | sed 's/[`"]*$//' | sed 's/^[`"]*//' | xargs)

            if [ -n "$content" ]; then
                log_info "  Found marker: [$msg_type] $content"
                post_context "$msg_type" "$content"
                ((marker_count++))

                if [ "$msg_type" == "completion" ]; then
                    found_completion=true
                fi
            fi
        fi
    done < "$output_file"

    log_info "Parsed $marker_count context markers (completion found: $found_completion)"

    if [ "$found_completion" == "true" ]; then
        return 0
    else
        return 1
    fi
}

***REMOVED*** Rollback git state to a specific commit
rollback_to_commit() {
    local commit="$1"
    local persona="$2"

    log_retry "Rolling back ${persona}'s changes to ${commit:0:7}..."

    cd "$TEST_REPO"
    git reset --hard "$commit"
    git clean -fd  ***REMOVED*** Remove untracked files
    cd "$TEST_DIR"

    log_retry "Rollback complete - repo restored to clean state"
}

***REMOVED*** Remove context entries for a persona (for retry)
rollback_context_for_persona() {
    local persona="$1"

    log_retry "Removing ${persona}'s context entries for retry..."

    ***REMOVED*** Filter out entries from this persona
    local updated=$(jq "del(.contexts[] | select(.persona == \"$persona\"))" "$CONTEXT_FILE")
    echo "$updated" > "$CONTEXT_FILE"
}

***REMOVED*** Execute a single subtask with retry/rollback logic
execute_subtask_with_retry() {
    local index="$1"
    local title="$2"
    local description="$3"
    local persona="$4"

    export CURRENT_PERSONA="$persona"
    export CURRENT_SUBTASK_INDEX="$index"

    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "SUBTASK $((index + 1)): [$persona] $title"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    ***REMOVED*** ==========================================
    ***REMOVED*** STEP A: Snapshot current state (Safety Net)
    ***REMOVED*** ==========================================
    cd "$TEST_REPO"
    local START_COMMIT=$(git rev-parse HEAD)
    cd "$TEST_DIR"

    log_info "Snapshot: ${START_COMMIT:0:7} (will rollback here on failure)"

    ***REMOVED*** Retry loop
    local attempt=1
    local success=false

    while [ $attempt -le $MAX_RETRIES ]; do
        if [ $attempt -gt 1 ]; then
            log_retry "━━━ Attempt $attempt of $MAX_RETRIES for [$persona] ━━━"
        fi

        ***REMOVED*** Fetch context from previous subtasks
        local sibling_context=$(fetch_context)
        log_info "Fetched context from previous personas"

        ***REMOVED*** Build the prompt
        local prompt=$(build_prompt "$persona" "$title" "$description" "$sibling_context")

        ***REMOVED*** Save prompt for inspection
        local prompt_file="${TEST_DIR}/prompt-${index}-${persona}.txt"
        echo "$prompt" > "$prompt_file"
        log_info "Prompt saved to: $prompt_file"

        ***REMOVED*** ==========================================
        ***REMOVED*** DRY RUN MODE
        ***REMOVED*** ==========================================
        if [ "$DRY_RUN" == "true" ]; then
            log_warn "DRY RUN: Skipping Claude execution"
            echo ""
            echo "=== PROMPT PREVIEW (first 50 lines) ==="
            head -50 "$prompt_file"
            echo "..."
            echo "=== END PREVIEW ==="
            echo ""

            ***REMOVED*** Simulate output with context markers for dry-run
            local dry_run_output="${TEST_DIR}/output-${index}-${persona}-dryrun.txt"
            cat > "$dry_run_output" << EOF
[DRY RUN] Simulated work for $persona

::context::decision::[DRY RUN] Simulated decision
::context::completion::[DRY RUN] Simulated completion for $persona
EOF
            ***REMOVED*** Parse the simulated markers
            parse_and_post_context_markers "$dry_run_output" "$persona"
            cp "$dry_run_output" "${TEST_DIR}/output-${index}-${persona}.txt"
            success=true
            break
        fi

        ***REMOVED*** ==========================================
        ***REMOVED*** STEP B: Execute Claude
        ***REMOVED*** ==========================================
        cd "$TEST_REPO"

        log_info "Running Claude as $persona (attempt $attempt)..."

        local output_file="${TEST_DIR}/output-${index}-${persona}-attempt${attempt}.txt"
        local claude_exit_code=0

        ***REMOVED*** Run claude --print with the prompt piped via stdin
        ***REMOVED*** Use tee to stream output in real-time while also saving to file
        echo ""
        echo "┌─── Claude Output (streaming) ───────────────────────────────────┐"
        if claude --print --dangerously-skip-permissions --model "claude-haiku-4-5-20251001" < "$prompt_file" 2>&1 | tee "$output_file"; then
            claude_exit_code=${PIPESTATUS[0]}
        else
            claude_exit_code=${PIPESTATUS[0]}
        fi
        echo "└─────────────────────────────────────────────────────────────────┘"
        echo ""

        cd "$TEST_DIR"

        ***REMOVED*** ==========================================
        ***REMOVED*** STEP C: Parse Output Markers & Validate
        ***REMOVED*** ==========================================
        ***REMOVED*** Parse ::context:: markers from output and post them to context store
        ***REMOVED*** This matches production behavior where shell parses markers, not Claude calling bash
        local markers_valid=false

        if [ $claude_exit_code -eq 0 ]; then
            if parse_and_post_context_markers "$output_file" "$persona"; then
                markers_valid=true
            fi
        fi

        log_info "Validation: exit_code=$claude_exit_code | markers_valid=$markers_valid"

        ***REMOVED*** ==========================================
        ***REMOVED*** STEP D: Decision - Success or Rollback
        ***REMOVED*** ==========================================
        if [ $claude_exit_code -eq 0 ] && [ "$markers_valid" == "true" ]; then
            ***REMOVED*** SUCCESS!
            log_success "Claude execution completed and context markers found"
            log_info "Output saved to: $output_file"

            ***REMOVED*** Commit any changes
            cd "$TEST_REPO"
            if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
                git add -A
                git commit -m "[$persona] $title" || true
                log_success "Committed changes for subtask $((index + 1))"
            else
                log_warn "No file changes to commit"
            fi
            cd "$TEST_DIR"

            ***REMOVED*** Copy final output to standard location
            cp "$output_file" "${TEST_DIR}/output-${index}-${persona}.txt"

            success=true
            break
        else
            ***REMOVED*** FAILURE - Rollback and possibly retry
            log_error "Subtask validation failed!"

            if [ $claude_exit_code -ne 0 ]; then
                log_error "  - Claude exited with code: $claude_exit_code"
            fi
            if [ "$markers_valid" != "true" ]; then
                log_error "  - No ::context::completion:: marker found in output"
            fi

            ***REMOVED*** ROLLBACK
            rollback_to_commit "$START_COMMIT" "$persona"
            rollback_context_for_persona "$persona"

            ((attempt++))

            if [ $attempt -le $MAX_RETRIES ]; then
                log_retry "Will retry subtask..."
                sleep 2  ***REMOVED*** Brief pause before retry
            fi
        fi
    done

    ***REMOVED*** ==========================================
    ***REMOVED*** Final Result
    ***REMOVED*** ==========================================
    if [ "$success" == "true" ]; then
        log_success "Subtask $((index + 1)) [$persona] complete"
        echo ""
        return 0
    else
        log_error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        log_error "CRITICAL: Subtask [$persona] failed after $MAX_RETRIES attempts"
        log_error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        ***REMOVED*** Post blocker to context for debugging
        post_context "blocker" "Subtask '$title' failed after $MAX_RETRIES attempts. Pipeline aborted."

        return 1
    fi
}

***REMOVED*** Main execution
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║     Multi-Persona Single Container Test Harness               ║"
    echo "║     with Transactional Retry/Rollback                         ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Configuration: MAX_RETRIES=$MAX_RETRIES"
    echo ""

    check_prerequisites
    init_test_repo
    reset_context

    ***REMOVED*** Parse subtasks
    local subtask_count=$(jq '.subtasks | length' "$SUBTASKS_FILE")
    local task_title=$(jq -r '.title' "$SUBTASKS_FILE")

    log_info "Task: $task_title"
    log_info "Subtasks to execute: $subtask_count"
    echo ""

    ***REMOVED*** Post initial constraints (like orchestrator would)
    post_context "constraints" "Building: $task_title. Use JavaScript/Node.js. Keep it simple and functional."

    ***REMOVED*** Track overall success
    local pipeline_success=true
    local failed_subtask=""

    ***REMOVED*** Execute each subtask with retry/rollback
    for i in $(seq 0 $((subtask_count - 1))); do
        local title=$(jq -r ".subtasks[$i].title" "$SUBTASKS_FILE")
        local description=$(jq -r ".subtasks[$i].description" "$SUBTASKS_FILE")
        local persona=$(jq -r ".subtasks[$i].persona" "$SUBTASKS_FILE")

        if ! execute_subtask_with_retry "$i" "$title" "$description" "$persona"; then
            pipeline_success=false
            failed_subtask="[$persona] $title"
            break  ***REMOVED*** Abort pipeline on failure
        fi

        ***REMOVED*** Small delay between subtasks for readability
        sleep 1
    done

    ***REMOVED*** Final summary
    echo ""
    if [ "$pipeline_success" == "true" ]; then
        echo "╔═══════════════════════════════════════════════════════════════╗"
        echo "║                    PIPELINE COMPLETE                          ║"
        echo "╚═══════════════════════════════════════════════════════════════╝"
    else
        echo "╔═══════════════════════════════════════════════════════════════╗"
        echo "║                    PIPELINE FAILED                            ║"
        echo "╚═══════════════════════════════════════════════════════════════╝"
        echo ""
        log_error "Failed at: $failed_subtask"
        log_info "Successful subtasks are preserved in git history"
    fi
    echo ""

    log_info "Final context store:"
    show_context

    log_info "Git log:"
    cd "$TEST_REPO"
    git log --oneline
    cd "$TEST_DIR"

    log_info "Files created:"
    find "$TEST_REPO" -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | grep -v node_modules || echo "No JS/TS files"

    echo ""
    if [ "$pipeline_success" == "true" ]; then
        log_success "Test harness complete! Review:"
    else
        log_warn "Test harness finished with failures. Review:"
    fi
    log_info "  - Context store: ${TEST_DIR}/context-store.json"
    log_info "  - Test repo: ${TEST_REPO}"
    log_info "  - Prompts: ${TEST_DIR}/prompt-*.txt"
    log_info "  - Outputs: ${TEST_DIR}/output-*.txt"

    ***REMOVED*** Exit with appropriate code
    if [ "$pipeline_success" == "true" ]; then
        exit 0
    else
        exit 1
    fi
}

***REMOVED*** Run main
main "$@"
