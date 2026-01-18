# Multi-Persona Ralph Orchestration Implementation Plan

## Overview

Enable Ralph to orchestrate multiple specialized personas when building a prototype, allowing different experts (backend_developer, frontend_developer, qa_engineer, etc.) to work on different stories in parallel.

## Architecture

```
Jira Ticket: "Build user auth with API and UI"
           ↓
    Ralph Planning Phase
    (breaks into stories)
           ↓
┌──────────┴──────────┐
↓                     ↓                     ↓
Story 1               Story 2               Story 3
backend_developer     frontend_developer    qa_engineer
Claude Opus           Claude Haiku          Ollama Qwen
(Child Task 1)        (Child Task 2)        (Child Task 3)
           ↓
    All PRs merged → Parent task complete
```

## Implementation Phases

### Phase 1: Database Schema (Migration)

**File:** `api/src/db/migrations/1705344000004-AddStoryLevelPersonas.ts`

Add fields to track parent-child task relationships:

```typescript
// WorkerTask additions:
parentTaskId: UUID | null       // Links child to parent task
storyIndex: number | null       // Which story (0-indexed)
storyTitle: string | null       // "Implement auth service"
childTaskIds: string[] | null   // Parent tracks children
```

---

### Phase 2: WorkerTask Model Update

**File:** `api/src/models/WorkerTask.ts`

Add columns for parent-child tracking and story metadata.

---

### Phase 3: Jira-to-PRD Persona Parsing

**File:** `worker/execution/ralph/jira-to-prd.ts`

Extend to parse `@persona:` annotations from Jira acceptance criteria:

**Input format in Jira:**
```gherkin
Scenario: Create auth API endpoints
@persona: backend_developer
GIVEN no auth system exists
WHEN user submits credentials
THEN return JWT token

Scenario: Build login form component
@persona: frontend_developer
GIVEN API endpoint exists
WHEN user visits /login
THEN form displays with validation
```

**Changes:**
1. Add `assignedPersona?: string` to `GherkinScenario` interface
2. Parse `@persona:` lines in Gherkin parser (line ~83)
3. Output persona assignments to `.ralph/persona-assignments.json`

---

### Phase 4: Ralph Execute Script Enhancement

**File:** `worker/ralph/execute.sh`

After Ralph planning completes, output story breakdown with personas:

1. Read `.ralph/progress.json` after planning phase
2. Merge with `.ralph/persona-assignments.json`
3. Output consolidated `::ralph_stories::` marker with JSON payload
4. Orchestrator parses this to create child tasks

**New output marker:**
```bash
::ralph_stories::{"stories":[{"index":0,"title":"Create auth API","persona":"backend_developer"},{"index":1,"title":"Build login form","persona":"frontend_developer"}]}
```

---

### Phase 5: Child Task Creation Service

**File:** `api/src/services/story-task-converter.ts` (new)

```typescript
interface RalphStory {
  index: number;
  title: string;
  description: string;
  persona: string;
  dependencies?: number[]; // Story indices this depends on
}

async function createChildTasksFromStories(
  parentTask: WorkerTask,
  stories: RalphStory[],
  org: Organization
): Promise<WorkerTask[]> {
  // For each story:
  // 1. Determine provider from org.providerRouting[persona]
  // 2. Create WorkerTask with parentTaskId linked
  // 3. Set status = "queued" (or "blocked" if has dependencies)
  // 4. Return child tasks
}
```

---

### Phase 6: Orchestrator Integration

**File:** `api/src/services/orchestrator.ts`

**6a. Detect Ralph story breakdown completion:**
```typescript
// In monitorExecutingTasks(), after parsing logs:
if (detectedMarker === "ralph_stories") {
  const stories = JSON.parse(markerPayload);
  await handleRalphStoryBreakdown(task, stories);
}
```

**6b. Create child tasks:**
```typescript
async function handleRalphStoryBreakdown(
  parentTask: WorkerTask,
  stories: RalphStory[]
) {
  const childTasks = await createChildTasksFromStories(
    parentTask, stories, parentTask.organization
  );

  parentTask.childTaskIds = childTasks.map(t => t.id);
  parentTask.status = "dispatching";
  await taskRepo.save(parentTask);
}
```

**6c. Monitor parent completion:**
```typescript
async function checkParentCompletion(parentTask: WorkerTask) {
  if (!parentTask.childTaskIds) return;

  const children = await taskRepo.find({
    where: { id: In(parentTask.childTaskIds) }
  });

  const allComplete = children.every(t => t.isTerminal());
  if (allComplete) {
    parentTask.status = children.some(t => t.status === "failed")
      ? "failed" : "deployed";
    await taskRepo.save(parentTask);
  }
}
```

---

### Phase 7: Organization Feature Flag

**File:** `api/src/models/Organization.ts`

```typescript
@Column({ name: "use_multi_persona_ralph", type: "boolean", default: false })
useMultiPersonaRalph: boolean;
```

Only enable child task creation when both:
- `useRalphExecution = true`
- `useMultiPersonaRalph = true`

---

### Phase 8: Dashboard Updates (Optional)

**File:** `frontend/src/pages/Dashboard.tsx`

Display parent-child task hierarchy:
- Parent task shows "Dispatching 3 stories..."
- Child tasks show persona badges and individual progress
- Timeline view of parallel execution

---

## Files to Modify

| File | Changes |
|------|---------|
| `api/src/db/migrations/1705344000004-AddStoryLevelPersonas.ts` | New migration |
| `api/src/models/WorkerTask.ts` | Add parent-child columns |
| `api/src/models/Organization.ts` | Add feature flag |
| `api/src/services/story-task-converter.ts` | New service |
| `api/src/services/orchestrator.ts` | Handle story breakdown, child creation, completion |
| `worker/execution/ralph/jira-to-prd.ts` | Parse @persona annotations |
| `worker/ralph/execute.sh` | Output ::ralph_stories:: marker |
| `worker/ralph/parse-progress.sh` | Include persona in progress tracking |

---

## Concurrency Model

Existing persona concurrency controls work automatically:

- **Same persona stories:** Execute sequentially (slot occupied)
- **Different persona stories:** Execute in parallel (different slots)
- **Org limit:** Respects `maxConcurrentWorkers` (default 3)

Example with 3 stories:
```
backend_developer  → Slot free → SPAWN
frontend_developer → Slot free → SPAWN (parallel)
qa_engineer        → Slot free → SPAWN (parallel)
```

---

## Provider Routing

Uses existing `providerRouting` from Organization:

```json
{
  "backend_developer": { "provider": "anthropic", "model": "claude-opus-4" },
  "frontend_developer": { "provider": "anthropic", "model": "claude-haiku-4-5" },
  "qa_engineer": { "provider": "ollama", "model": "qwen2.5-coder:32b" }
}
```

Each child task automatically gets the configured provider for its persona.

---

## Backward Compatibility

- Feature flag `useMultiPersonaRalph` defaults to `false`
- Without flag, Ralph executes all stories with single persona (current behavior)
- Database columns are nullable with safe defaults
- Can disable at any time by setting flag to `false`

---

## Verification Plan

1. **Unit test:** `story-task-converter.ts` creates correct child tasks
2. **Integration test:** Create Jira ticket with @persona annotations
3. **E2E test:**
   - Enable `useRalphExecution` and `useMultiPersonaRalph` for test org
   - Create ticket with 2+ stories requiring different personas
   - Verify child tasks spawn with correct personas
   - Verify parallel execution (different personas run simultaneously)
   - Verify parent completes when all children complete
4. **Dashboard verification:** Check task hierarchy displays correctly

---

## Implementation Order

1. Database migration (schema foundation)
2. WorkerTask model (columns)
3. Organization model (feature flag)
4. Jira-to-PRD parser (@persona parsing)
5. Ralph execute.sh (output marker)
6. Story task converter service (child creation)
7. Orchestrator integration (detection + monitoring)
8. Settings API (expose feature flag)
9. Dashboard updates (optional, can defer)

---

## Rollout Strategy

1. **Dev testing:** Enable flag for test org, verify with oncallshift repo
2. **Gradual rollout:** Enable per-org as requested
3. **Default enable:** After stability proven, consider defaulting to true
