# Multi-Persona Single Container Implementation Plan

## Overview

Execute multiple subtasks with different personas within a single ECS container, using fresh Claude Code context windows per subtask and a `CONTEXT.md` sidecar file for inter-persona communication.

## Goals

1. **Reduce startup overhead**: Single container start (~30-60s) instead of N containers
2. **Clean context per persona**: Each Claude invocation starts fresh with only its persona's directives
3. **Structured handoff**: CONTEXT.md provides architectural decisions and notes between personas
4. **Observable state**: Humans can inspect CONTEXT.md anytime to see AI's understanding
5. **Git-versioned context**: Context evolution tracked alongside code changes

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Single ECS Container                                                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ entrypoint.sh                                                        │   │
│  │                                                                      │   │
│  │  1. Clone repo                                                       │   │
│  │  2. Create initial CONTEXT.md from parent task                       │   │
│  │  3. Load AGENTS.md (once)                                            │   │
│  │  4. Load common directives (once)                                    │   │
│  │                                                                      │   │
│  │  for subtask in subtasks:                                            │   │
│  │    ┌──────────────────────────────────────────────────────────────┐  │   │
│  │    │ Subtask Execution                                            │  │   │
│  │    │                                                              │  │   │
│  │    │  a. Load persona directive: /app/directives/${persona}/      │  │   │
│  │    │  b. Build prompt with CONTEXT.md read/write instructions     │  │   │
│  │    │  c. Run: claude --print < prompt.txt                         │  │   │
│  │    │  d. Commit: git commit -m "[${persona}] ${subtask.title}"    │  │   │
│  │    │                                                              │  │   │
│  │    │  Context window: FRESH (no memory of previous subtasks)      │  │   │
│  │    │  Shared state: CONTEXT.md + git working directory            │  │   │
│  │    └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  │  5. Create PR with all commits                                       │   │
│  │  6. Report completion                                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Context Sidecar (Using Existing WorkerContext System)

### Existing Infrastructure

WorkerMill already has a `WorkerContext` system designed for sibling worker communication. We adapt it for sequential subtask handoff.

**Location:**
- Model: `api/src/models/WorkerContext.ts`
- API: `api/src/routes/coordination.ts`
- Endpoints: `POST/GET /api/coordination/context`

### Message Types (Already Defined)

| Type | Purpose | Multi-Persona Use |
|------|---------|-------------------|
| `constraints` | PRD-level constraints | Orchestrator posts BEFORE first subtask |
| `decision` | Architectural decisions | "Using JWT in headers for mobile compatibility" |
| `file_created` | New file announcements | "Created src/api/auth.ts" |
| `file_modified` | Modified file tracking | "Modified src/shared/types.ts" |
| `completion` | Subtask completion summary | "Auth API complete. Use types from src/shared/types.ts" |
| `progress` | Notes for next developer | "The /stats endpoint needs caching" |
| `blocker` | Issues needing resolution | (escalate to orchestrator) |

### Read/Write Protocol

**At subtask START** (fetch from API, inject into prompt):
```bash
# Fetch all context for this parent task
CONTEXT_JSON=$(curl -s "${API_BASE}/api/coordination/context/${PARENT_TASK_ID}" \
  -H "x-api-key: ${ORG_API_KEY}")

# Format for Claude
SIBLING_CONTEXT=$(echo "$CONTEXT_JSON" | jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"')
```

Prompt injection:
```
## Previous Developer Context

The following messages were left by previous personas in this pipeline:

${SIBLING_CONTEXT}

Pay special attention to:
- **decision** messages: Architectural choices you should align with
- **completion** messages: What's already done and how to use it
- **progress** messages: Notes specifically for you
```

**At subtask END** (Claude posts via bash functions):
```bash
# Functions available to Claude in the prompt
post_context() {
    local type="$1"
    local content="$2"
    curl -s -X POST "${API_BASE}/api/coordination/context" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"parentTaskId\": \"${PARENT_TASK_ID}\",
            \"taskId\": \"${TASK_ID}\",
            \"persona\": \"${CURRENT_PERSONA}\",
            \"messageType\": \"${type}\",
            \"content\": \"${content}\"
        }"
}

# Claude is instructed to call these before finishing:
post_context "decision" "Using bcrypt for password hashing, JWT for auth tokens"
post_context "file_created" "src/api/auth.ts - authentication endpoints"
post_context "completion" "Auth API complete. Import AuthService from src/services/auth"
post_context "progress" "Consider adding rate limiting to /api/auth/login"
```

### Benefits Over File-Based CONTEXT.md

| Benefit | WorkerContext | CONTEXT.md |
|---------|---------------|------------|
| **Real-time observable** | SSE streaming to dashboard | Must open file manually |
| **Typed messages** | Structured `messageType` enum | Free-form markdown |
| **Already implemented** | Just wire it up | New feature to build |
| **Survives failures** | Database persisted | Lost if commit fails |
| **Queryable** | Filter by type, time, persona | grep through file |
| **Dashboard integration** | Already streams to UI | Would need new UI |

### Dashboard Visibility

The existing dashboard already has SSE streaming for WorkerContext:
```
GET /api/coordination/context/:parentTaskId/stream
```

When a subtask posts context, it appears in real-time on the dashboard. Humans can watch the "conversation" between sequential personas as it happens.

## Implementation Phases

### Phase 1: Data Model Changes

**Files:** `api/src/models/WorkerTask.ts`, migration

Add fields to support multi-subtask execution:

```typescript
// WorkerTask additions
@Column({ name: "subtasks_json", type: "jsonb", nullable: true })
subtasksJson: SubtaskDefinition[] | null;

@Column({ name: "current_subtask_index", type: "int", default: 0 })
currentSubtaskIndex: number;

@Column({ name: "subtask_results", type: "jsonb", nullable: true })
subtaskResults: SubtaskResult[] | null;

// Types
interface SubtaskDefinition {
  index: number;
  title: string;
  description: string;
  persona: WorkerPersona;
  dependencies?: number[];  // Indices of subtasks this depends on
}

interface SubtaskResult {
  index: number;
  status: "pending" | "completed" | "failed";
  commitHash?: string;
  error?: string;
}
```

### Phase 2: Orchestrator Changes

**File:** `api/src/services/orchestrator.ts` or new `orchestrator-multi-persona.ts`

When spawning a task with subtasks:
1. Pass subtasks as JSON env var or fetch from API
2. Single ECS container spawn (not per-subtask)
3. Monitor for per-subtask completion markers
4. Track overall task completion when all subtasks done

```typescript
async function spawnMultiPersonaTask(task: WorkerTask): Promise<void> {
  // Single container with subtasks passed as env var
  const environment = [
    { name: "SUBTASKS_JSON", value: JSON.stringify(task.subtasksJson) },
    { name: "TASK_ID", value: task.id },
    // ... other env vars
  ];

  await runner.runWorkerTask(task, credentials, { environment });
}
```

### Phase 3: Entrypoint Changes

**File:** `worker/entrypoint.sh`

Add multi-subtask loop after repo clone:

```bash
# =============================================================================
# Multi-Subtask Execution (if SUBTASKS_JSON is provided)
# =============================================================================

if [ -n "${SUBTASKS_JSON}" ]; then
    post_log "system" "Multi-persona execution: $(echo "${SUBTASKS_JSON}" | jq length) subtasks"

    # Load shared content once
    AGENTS_MD_CONTENT=$(cat /app/AGENTS.md)
    COMMON_DIRECTIVE_CONTENT=$(load_common_directives)

    # Create initial CONTEXT.md
    create_initial_context_md "${JIRA_SUMMARY}" "${JIRA_DESCRIPTION}"

    # Process each subtask
    SUBTASK_COUNT=$(echo "${SUBTASKS_JSON}" | jq length)
    for i in $(seq 0 $((SUBTASK_COUNT - 1))); do
        SUBTASK=$(echo "${SUBTASKS_JSON}" | jq -r ".[$i]")
        SUBTASK_PERSONA=$(echo "${SUBTASK}" | jq -r '.persona')
        SUBTASK_TITLE=$(echo "${SUBTASK}" | jq -r '.title')
        SUBTASK_DESC=$(echo "${SUBTASK}" | jq -r '.description')

        post_log "system" "=== Subtask $((i + 1))/${SUBTASK_COUNT}: [${SUBTASK_PERSONA}] ${SUBTASK_TITLE} ==="

        # Load THIS subtask's persona directive
        DIRECTIVE_CONTENT=$(cat "/app/directives/${SUBTASK_PERSONA}/README.md")

        # Build prompt with CONTEXT.md instructions
        build_subtask_prompt "${SUBTASK_PERSONA}" "${SUBTASK_TITLE}" "${SUBTASK_DESC}"

        # Run Claude (fresh context window)
        claude --print --dangerously-skip-permissions \
            --model "${CLAUDE_MODEL:-haiku}" \
            < "${PROMPT_FILE}" 2>"${STDERR_FILE}" | tee "${OUTPUT_FILE}"

        # Commit this subtask's changes
        if git diff --quiet && git diff --cached --quiet; then
            post_log "system" "No changes from subtask ${i}"
        else
            git add -A
            git commit -m "[${SUBTASK_PERSONA}] ${SUBTASK_TITLE}"
            post_log "system" "Committed subtask ${i}: [${SUBTASK_PERSONA}] ${SUBTASK_TITLE}"
        fi

        # Report subtask completion to API
        report_subtask_completion "${TASK_ID}" "${i}" "completed"
    done

    # All subtasks done - create PR
    create_pr_for_multitask

    echo "::result::deployed"
    exit 0
fi

# ... existing single-task logic continues below ...
```

### Phase 4: Prompt Template Updates

**New function in entrypoint.sh:**

```bash
# Fetch context from previous subtasks via WorkerContext API
fetch_sibling_context() {
    if [ -z "${PARENT_TASK_ID}" ]; then
        echo ""
        return
    fi

    local response
    response=$(curl -s "${API_BASE_URL}/api/coordination/context/${PARENT_TASK_ID}" \
        -H "x-api-key: ${ORG_API_KEY}")

    # Format context for prompt injection
    echo "$response" | jq -r '.contexts[] | "[\(.persona)] \(.messageType): \(.content)"' 2>/dev/null || echo ""
}

# Post context message for next subtask
post_subtask_context() {
    local type="$1"
    local content="$2"

    curl -s -X POST "${API_BASE_URL}/api/coordination/context" \
        -H "x-api-key: ${ORG_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{
            \"parentTaskId\": \"${PARENT_TASK_ID}\",
            \"taskId\": \"${TASK_ID}\",
            \"persona\": \"${CURRENT_PERSONA}\",
            \"messageType\": \"${type}\",
            \"content\": \"${content}\"
        }" >/dev/null 2>&1
}

build_subtask_prompt() {
    local persona="$1"
    local title="$2"
    local description="$3"
    local sibling_context="$4"

    cat > "${PROMPT_FILE}" << PROMPT_EOF
# Multi-Persona Pipeline Task

## Your Role
You are acting as a **${persona}**. This is a subtask in a larger multi-step pipeline.

## Previous Developer Context

The following messages were left by previous personas in this pipeline:

${sibling_context:-"_You are the first subtask - no previous context yet._"}

Pay special attention to:
- **decision** messages: Architectural choices you should align with
- **completion** messages: What's already done and how to use it
- **progress** messages: Notes specifically for you

## Your Subtask
**Title:** ${title}

**Description:**
${description}

## Your Directives
${DIRECTIVE_CONTENT}

## Common Guidelines
${COMMON_DIRECTIVE_CONTENT}

## Agent Workflow
${AGENTS_MD_CONTENT}

## MANDATORY: Post Context Before Finishing

Before you finish, you MUST communicate your work to the next persona using post_context:

\`\`\`bash
# Post architectural decisions you made
post_context "decision" "Using bcrypt for passwords, JWT for auth tokens"

# Post files you created (important for next persona)
post_context "file_created" "src/api/auth.ts - authentication endpoints"

# Post completion summary with usage instructions
post_context "completion" "Auth API complete. Import AuthService from src/services/auth"

# Post notes/warnings for next developer
post_context "progress" "Consider adding rate limiting to /api/auth/login"
\`\`\`

These messages will be visible to the next persona AND on the dashboard in real-time.

## Output
When done, ensure all changes are saved. Do not output result markers - the entrypoint handles that.
PROMPT_EOF
}

# Post initial constraints before first subtask (called by orchestrator)
post_initial_constraints() {
    local summary="$1"
    local description="$2"

    post_subtask_context "constraints" "High Level Goal: ${summary}. ${description}"
}
```

### Phase 5: API Endpoint for Subtask Status

**File:** `api/src/routes/tasks.ts`

```typescript
// Report subtask completion from worker
router.post("/:taskId/subtask/:index/complete", async (req, res) => {
  const { taskId, index } = req.params;
  const { status, commitHash, error } = req.body;

  const task = await taskRepo.findOne({ where: { id: taskId } });
  if (!task) return res.status(404).json({ error: "Task not found" });

  // Update subtask result
  const results = task.subtaskResults || [];
  results[parseInt(index)] = { index: parseInt(index), status, commitHash, error };
  task.subtaskResults = results;
  task.currentSubtaskIndex = parseInt(index) + 1;

  await taskRepo.save(task);

  // Log event for dashboard
  await logTaskEvent(taskId, "subtask_complete",
    `Subtask ${index} completed: ${task.subtasksJson?.[parseInt(index)]?.title}`);

  res.json({ success: true });
});
```

### Phase 6: Dashboard Updates (Optional)

**File:** `frontend/src/pages/Dashboard.tsx`

Show subtask progress:
- List of subtasks with status indicators
- Current subtask highlighted
- Expandable to show commit hash per subtask
- Link to view CONTEXT.md in repo

---

## Migration Path

### Step 1: Feature Flag
Add `useMultiPersonaContainer` to Organization settings (default: false)

### Step 2: V2 Pipeline Integration
The existing V2 pipeline (`orchestrator-v2.ts`) already has:
- `PlannedStepV2` with `persona` field
- Sequential step tracking

Modify to use single-container execution when flag enabled.

### Step 3: Gradual Rollout
1. Test with single org on dev environment
2. Monitor CONTEXT.md quality and handoff effectiveness
3. Enable for production orgs as validated

---

## What Stays the Same

| Component | Change? | Notes |
|-----------|---------|-------|
| Directive files | No | Same files, just loaded dynamically per subtask |
| AGENTS.md | No | Loaded once, used for all subtasks |
| Common directives | No | Loaded once, used for all subtasks |
| Prompt structure | Minimal | Add CONTEXT.md read/write instructions |
| Claude invocation | No | Same `claude --print` call |
| Git commit flow | No | Same commit mechanism |
| PR creation | No | Same `create_pr.js` script |
| Result markers | Modified | Report per-subtask, final marker at end |

---

## What Changes

| Component | Current | New |
|-----------|---------|-----|
| Container spawning | 1 container per task | 1 container for N subtasks |
| Persona loading | Once at start | Per subtask in loop |
| Context sharing | None | CONTEXT.md sidecar |
| Orchestrator | Spawns per step | Passes subtasks as JSON |
| Task model | Single persona | Array of subtask definitions |

---

## Success Metrics

1. **Startup time reduction**: N subtasks should take ~(30s + N*execution_time) vs ~(N*30s + N*execution_time)
2. **Context quality**: CONTEXT.md should be readable and useful at any point
3. **Handoff effectiveness**: Subtask N should successfully build on subtask N-1's work
4. **No context bleed**: Each persona should only exhibit its own directive behaviors

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| CONTEXT.md grows too large | Enforce "replace, don't append" in prompt instructions |
| Claude ignores CONTEXT.md | Add explicit "MANDATORY" markers, verify in output |
| Subtask failure cascades | Transactional subtask model with retry/rollback (see below) |
| Git conflicts between subtasks | Sequential execution ensures no parallel conflicts |
| Long-running container timeout | Add per-subtask timeout, checkpoint progress |

---

## Failure Handling: Transactional Subtask Model

Each subtask is treated like a database transaction: **either it completes successfully and commits, or it rolls back completely as if it never happened.**

### Reset-Retry-Abort Logic

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ For each subtask:                                                           │
│                                                                             │
│  STEP A: Snapshot                                                           │
│    START_COMMIT=$(git rev-parse HEAD)                                       │
│    CONTEXT_COUNT_BEFORE=$(count context entries for this persona)           │
│                                                                             │
│  STEP B: Execute                                                            │
│    Run: claude --print < prompt.txt                                         │
│                                                                             │
│  STEP C: Validate                                                           │
│    ✓ Did Claude exit with code 0?                                           │
│    ✓ Did post_context get called? (context count increased)                 │
│                                                                             │
│  STEP D: Decision                                                           │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │ IF SUCCESS:                                                         │  │
│    │   git add . && git commit -m "[persona] subtask title"              │  │
│    │   Proceed to next subtask                                           │  │
│    ├─────────────────────────────────────────────────────────────────────┤  │
│    │ IF FAILURE:                                                         │  │
│    │   git reset --hard $START_COMMIT  ← ROLLBACK                        │  │
│    │   git clean -fd                   ← Remove untracked files          │  │
│    │   Remove persona's context entries                                  │  │
│    │                                                                     │  │
│    │   IF retries remaining: Go back to STEP B                           │  │
│    │   ELSE: Abort pipeline, post blocker, exit 1                        │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation in entrypoint.sh

```bash
MAX_RETRIES=2

execute_subtask_with_retry() {
    local index="$1"
    local persona="$2"
    local title="$3"

    # STEP A: Snapshot current state
    START_COMMIT=$(git rev-parse HEAD)
    CONTEXT_COUNT_BEFORE=$(get_persona_context_count "$persona")

    attempt=1
    success=false

    while [ $attempt -le $MAX_RETRIES ]; do
        post_log "system" "Attempt $attempt for [$persona] $title"

        # STEP B: Execute Claude
        build_and_run_subtask "$persona" "$title"
        claude_exit_code=$?

        # STEP C: Validate
        CONTEXT_COUNT_AFTER=$(get_persona_context_count "$persona")

        if [ $claude_exit_code -eq 0 ] && [ $CONTEXT_COUNT_AFTER -gt $CONTEXT_COUNT_BEFORE ]; then
            # SUCCESS - Commit and continue
            git add -A
            git commit -m "[$persona] $title"
            success=true
            break
        fi

        # STEP D: FAILURE - Rollback
        post_log "system" "Subtask failed. Rolling back to ${START_COMMIT:0:7}..."
        git reset --hard $START_COMMIT
        git clean -fd
        rollback_context_for_persona "$persona"

        ((attempt++))
    done

    if [ "$success" != "true" ]; then
        post_context "blocker" "Subtask '$title' failed after $MAX_RETRIES attempts"
        return 1
    fi

    return 0
}

# Helper: Count context entries for a persona
get_persona_context_count() {
    local persona="$1"
    curl -s "${API_BASE}/api/coordination/context/${PARENT_TASK_ID}" \
        -H "x-api-key: ${ORG_API_KEY}" | \
        jq "[.contexts[] | select(.persona == \"$persona\")] | length"
}

# Helper: Remove a persona's context entries (for retry)
rollback_context_for_persona() {
    local persona="$1"
    # Call API to delete this persona's entries, or track locally
    curl -s -X DELETE "${API_BASE}/api/coordination/context/${PARENT_TASK_ID}/persona/${persona}" \
        -H "x-api-key: ${ORG_API_KEY}"
}
```

### Why This Works

| Benefit | Explanation |
|---------|-------------|
| **Guaranteed Clean State** | If persona writes broken files then crashes, `git reset` wipes them instantly |
| **Stochastic Defense** | LLMs are random. Simple "wipe and retry" fixes 30-50% of AI errors without prompt changes |
| **Human Debugging** | If pipeline aborts after Backend step, git history is clean - human can pick up exactly where AI left off |
| **Context Consistency** | Rolling back context entries ensures next attempt sees the same state as first attempt |

### Validation Criteria

A subtask is considered **successful** if:
1. Claude exits with code 0
2. At least one `post_context` call was made (context count increased)

A subtask is considered **failed** if:
1. Claude exits with non-zero code, OR
2. No `post_context` calls were made (persona didn't communicate work)

### Pipeline Abort Behavior

When a subtask fails after all retries:
1. Pipeline execution stops immediately
2. A `blocker` context message is posted explaining the failure
3. Successful subtask commits are preserved in git history
4. Container exits with code 1
5. Orchestrator marks task as `failed`
6. Human can review logs, fix issues, and re-trigger

---

## Local Testing

A test harness is available at `test-multi-persona/` to validate the core concepts locally without deployment:

```bash
cd test-multi-persona

# Dry run (shows prompts, no API calls)
./run-test.sh --dry-run

# Full run with Haiku
./run-test.sh
```

The test harness includes:
- File-based mock of WorkerContext API
- Transactional retry/rollback logic
- Persona directive loading from `worker/directives/`
- Git commits per subtask

See `test-multi-persona/README.md` for details
