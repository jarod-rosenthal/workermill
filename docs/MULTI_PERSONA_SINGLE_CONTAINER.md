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

## CONTEXT.md Sidecar

### Purpose

A living document that serves as shared memory between personas without relying on LLM context continuation.

### Structure

```markdown
# Project Context

## High Level Goal
[From parent task description - what we're building overall]

## Current Phase
[Which subtask is currently executing]

## Architectural Decisions (The "Why")
- [Backend] Auth uses JWT in headers, not cookies, for mobile compatibility
- [Backend] User ID is UUID, not integer
- [Frontend] Using React Query for server state management

## Recent Accomplishments
- [Backend] Created /api/users and /api/stats endpoints
- [Backend] Added Zod schemas for request validation
- [Frontend] Built UserDashboard component with loading states

## Notes for Next Developer
- The /stats endpoint is slow; consider adding caching
- Use types from `src/shared/types.ts` for frontend components
- Auth middleware is in `src/middleware/auth.ts`

## Files Modified This Session
- src/api/users.ts (new)
- src/api/stats.ts (new)
- src/shared/types.ts (modified)
```

### Read/Write Protocol

**At subtask start** (injected into prompt):
```
Before starting work, read CONTEXT.md in the repository root to understand:
- The high-level goal of this multi-step task
- Architectural decisions made by previous personas
- Notes left specifically for you by the previous developer

Pay special attention to the "Notes for Next Developer" section.
```

**At subtask end** (injected into prompt):
```
Before finishing, you MUST update CONTEXT.md:

1. Update "Current Phase" to reflect completion of your subtask
2. Add any architectural decisions you made to "Architectural Decisions"
3. Replace "Recent Accomplishments" with YOUR accomplishments (keep it concise)
4. Update "Notes for Next Developer" with guidance for the next persona:
   - What patterns you established
   - Any gotchas or things to watch out for
   - Which files/types they should reference
5. Update "Files Modified This Session" with files you changed

Keep each section concise - summarize, don't append endlessly.
```

### Benefits

| Benefit | Description |
|---------|-------------|
| **Self-Pruning** | Agents rewrite/summarize, preventing unbounded growth |
| **Human Observable** | Inspect CONTEXT.md anytime to see AI's understanding |
| **Git Versioned** | Context evolution tracked in commit history |
| **No LLM Memory** | Clean separation - no context bleed between personas |
| **Structured Handoff** | Explicit sections for decisions, notes, and accomplishments |

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
build_subtask_prompt() {
    local persona="$1"
    local title="$2"
    local description="$3"

    cat > "${PROMPT_FILE}" << PROMPT_EOF
# Multi-Persona Pipeline Task

## Your Role
You are acting as a **${persona}**. This is subtask in a larger multi-step pipeline.

## IMPORTANT: Read CONTEXT.md First
Before starting work, read \`CONTEXT.md\` in the repository root to understand:
- The high-level goal of this multi-step task
- Architectural decisions made by previous personas
- Notes left specifically for you by the previous developer

Pay special attention to the "Notes for Next Developer" section.

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

## MANDATORY: Update CONTEXT.md Before Finishing

Before you finish, you MUST update \`CONTEXT.md\`:

1. Update "Current Phase" to reflect completion of your subtask
2. Add any architectural decisions you made to "Architectural Decisions" (prefix with [${persona}])
3. Replace "Recent Accomplishments" with YOUR accomplishments (keep concise)
4. Update "Notes for Next Developer" with guidance for the next persona
5. Update "Files Modified This Session" with files you changed

Keep each section concise - summarize, don't append endlessly.

## Output
When done, ensure all changes are saved. Do not output result markers - the entrypoint handles that.
PROMPT_EOF
}

create_initial_context_md() {
    local summary="$1"
    local description="$2"

    cat > "${REPO_PATH}/CONTEXT.md" << CONTEXT_EOF
# Project Context

## High Level Goal
${summary}

${description}

## Current Phase
Starting multi-persona pipeline execution

## Architectural Decisions (The "Why")
_No decisions yet - first subtask will establish patterns_

## Recent Accomplishments
_Pipeline just started_

## Notes for Next Developer
_First subtask - establish patterns and document decisions_

## Files Modified This Session
_None yet_
CONTEXT_EOF

    git add CONTEXT.md
    git commit -m "Initialize CONTEXT.md for multi-persona pipeline"
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
| Subtask failure cascades | Add subtask-level error handling, allow skip/retry |
| Git conflicts between subtasks | Sequential execution ensures no parallel conflicts |
| Long-running container timeout | Add per-subtask timeout, checkpoint progress |
