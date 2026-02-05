# Feature: Epic Mode - Parallel Multi-Agent Execution

## Context

Enable multi-agent **parallel** collaboration triggered by the "epic" label on Jira tickets. The existing Epic Executor framework (`worker/epic/`) already has the parallel execution architecture - we need to fix API path issues and integrate it with the orchestration flow.

**Naming**: "Epic Mode" (NOT "war room")
**No new services**: Extend existing worker container

### What Already Exists (DO NOT RECREATE)

1. **Epic Executor** (`worker/epic/`):
   - `coordinator.ts` - Parallel coordination loop with story claiming
   - `executor.ts` - Story execution with Claude Agent SDK
   - `experts.ts` - 5 expert personas (frontend, backend, security, qa, devops)
   - `coordination-client.ts` - API client (has bugs)
   - Entry point: `worker/epic-entrypoint.sh`

2. **Coordination Infrastructure**:
   - `WorkerContext` model with `story_ready`, `story_claimed` message types
   - `POST /api/coordination/claim` - Atomic story claiming
   - SSE streaming at 500ms intervals

3. **V2 Pipeline** handles "epic" label but runs **sequentially**

### Key Gap

Current flow: `Epic label → Planner-Critic → runSequentialPipeline() → Sequential execution`

Target flow: `Epic label → [Optional Critic] → spawnEpicContainer() → Parallel execution via Epic Coordinator`

### Critic Label Behavior

The Planner-Critic validation phase is **optional** and only runs when the "critic" label is present:
- `epic` label only → Skip Planner-Critic, go directly to Epic execution
- `epic` + `critic` labels → Run Planner-Critic validation first, then Epic execution

---

## Requirements

### REQ-1: Fix coordination-client.ts API paths

The coordination client uses incorrect API paths that don't match the actual routes.

**File**: `worker/epic/coordination-client.ts`

**Changes**:
- Line ~47: Change `/api/coordination/contexts` to `/api/coordination/context/${this.parentTaskId}`
- Line ~63: Same fix in `getReadyStories()` method
- Line ~123: Same fix in `getUnansweredQuestions()` method
- Line ~158: Same fix in `getAllContexts()` method
- Line ~179: Change `/api/coordination/contexts` to `/api/coordination/context`

**Acceptance**:
- All API calls in coordination-client.ts use paths that match routes defined in `api/src/routes/coordination.ts`
- No references to `/api/coordination/contexts` remain (should be `/api/coordination/context/...`)

---

### REQ-2: Add executionMode field to WorkerTask model

Add a field to distinguish between execution types.

**File**: `api/src/models/WorkerTask.ts`

**Add column**:
```typescript
@Column({ type: 'varchar', length: 20, default: 'single' })
executionMode: 'single' | 'sequential' | 'parallel';
```

**Values**:
- `"single"` - Default single-task execution
- `"sequential"` - V2 pipeline (one persona at a time)
- `"parallel"` - Epic mode (all experts simultaneously)

**Acceptance**:
- WorkerTask entity has `executionMode` property with TypeORM @Column decorator
- Type is union of 'single' | 'sequential' | 'parallel'
- Default value is 'single'
- `npm run typecheck` passes in api/

---

### REQ-2b: Add criticEnabled field to WorkerTask model

Add a field to control whether Planner-Critic validation runs.

**File**: `api/src/models/WorkerTask.ts`

**Add column**:
```typescript
@Column({ name: "critic_enabled", type: "boolean", default: false })
criticEnabled: boolean;
```

**Acceptance**:
- WorkerTask entity has `criticEnabled` property with TypeORM @Column decorator
- Type is boolean
- Default value is false (critic disabled by default)
- `npm run typecheck` passes in api/

---

### REQ-3: Create database migration for executionMode and criticEnabled columns

Create migration to add the `execution_mode` and `critic_enabled` columns to the `worker_tasks` table.

**File**: Create `api/src/db/migrations/1705344000030-AddExecutionMode.ts`

**Migration content**:
- `up()`:
  - Add `execution_mode` column, type VARCHAR(20), default 'single', use `IF NOT EXISTS`
  - Add `critic_enabled` column, type BOOLEAN, default false, use `IF NOT EXISTS`
- `down()`: Drop both columns with `IF EXISTS`

**Acceptance**:
- Migration file exists at specified path
- Uses `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Column names are `execution_mode` and `critic_enabled` (snake_case for DB)

---

### REQ-4: Register migration in connection.ts

Register the new migration so it runs on API startup.

**File**: `api/src/db/connection.ts`

**Changes**:
- Add import for the new AddExecutionMode migration
- Add migration to the `migrations` array

**Acceptance**:
- Import statement exists for AddExecutionMode migration
- Migration class is included in migrations array
- `npm run typecheck` passes in api/

---

### REQ-5: Update webhooks.ts to set executionMode and criticEnabled for epic/critic labels

When a Jira ticket has the "epic" label, set `executionMode: "parallel"`. When it also has the "critic" label, enable the Planner-Critic phase.

**File**: `api/src/routes/webhooks.ts`

**Changes**:
- In the Jira webhook handler, after extracting labels
- Check if labels array includes "epic" (case-insensitive)
  - If yes, set `task.executionMode = 'parallel'`
  - Ensure `pipelineVersion` is also set to 'v2' for epic tasks
- Check if labels array includes "critic" (case-insensitive)
  - If yes, set `task.criticEnabled = true`

**Acceptance**:
- When Jira webhook fires with labels containing "epic", the created WorkerTask has `executionMode = 'parallel'`
- When Jira webhook fires with labels containing "critic", the created WorkerTask has `criticEnabled = true`
- Epic tasks also have `pipelineVersion = 'v2'`
- Non-epic tasks are unaffected (keep default 'single')
- Non-critic tasks are unaffected (keep default false)

---

### REQ-6: Add publishStoriesReady function to orchestrator-v2.ts

Create function to publish story_ready messages after planning completes.

**File**: `api/src/services/orchestrator-v2.ts`

**New function**: `async function publishStoriesReady(task: WorkerTask): Promise<void>`

**Implementation**:
- Parse the approved plan from task to extract individual stories/steps
- For each story, create a WorkerContext record with:
  - `messageType: 'story_ready'`
  - `parentTaskId: task.id`
  - `metadata: { storyIndex, persona, title, dependencies }`
- Initially only publish stories where `dependencies` is empty array
- Use the existing WorkerContext repository

**Acceptance**:
- Function `publishStoriesReady` exists and is exported
- Function creates WorkerContext records with messageType 'story_ready'
- Stories with dependencies are NOT published initially (only dependency-free stories)
- `npm run typecheck` passes in api/

---

### REQ-7: Add spawnEpicContainer function to orchestrator-v2.ts

Create function to spawn an Epic container for parallel execution.

**File**: `api/src/services/orchestrator-v2.ts`

**New function**: `async function spawnEpicContainer(task: WorkerTask): Promise<void>`

**Implementation**:
- Use existing ECS task spawning pattern (look for existing `runWorkerTask` or similar)
- Set environment variables:
  - `EPIC_MODE=true`
  - `PARENT_TASK_ID=<task.id>`
- Container should use `worker/epic-entrypoint.sh` as entry point
- Log that Epic container is being spawned

**Acceptance**:
- Function `spawnEpicContainer` exists and is exported
- Function spawns ECS task with EPIC_MODE and PARENT_TASK_ID environment variables
- Uses Epic-specific entry point
- `npm run typecheck` passes in api/

---

### REQ-8: Route parallel tasks to Epic container, respecting criticEnabled flag

Update the existing pipeline to route parallel tasks to Epic container. Skip Planner-Critic phase when `criticEnabled` is false.

**File**: `api/src/services/orchestrator-v2.ts`

**Changes**:

1. In the V2 pipeline flow (e.g., `processV2PipelinePlanning` or similar):
   - If `task.criticEnabled === false`, skip the Planner-Critic validation loop
   - If `task.criticEnabled === true`, run Planner-Critic as before

2. In `runSequentialPipeline()` or equivalent function:
   - At the start, add check:
```typescript
if (task.executionMode === 'parallel') {
  await publishStoriesReady(task);
  await spawnEpicContainer(task);
  return;
}
```
- Keep existing sequential logic intact for non-parallel tasks

**Acceptance**:
- When `task.criticEnabled === false`, Planner-Critic validation is skipped
- When `task.criticEnabled === true`, Planner-Critic validation runs as before
- When task has `executionMode === 'parallel'`, function calls publishStoriesReady then spawnEpicContainer and returns early
- Sequential execution logic is unchanged for other execution modes
- `npm run typecheck` passes in api/

---

### REQ-9: Add story_ready and story_claimed icons to CoordinationFeed

Add visual indicators for story message types in the dashboard.

**File**: `frontend/src/components/CoordinationFeed.tsx`

**Changes**:
- In the icon mapping/switch statement for message types, add:
  - `story_ready`: Use BookOpen or ListTodo icon (from lucide-react)
  - `story_claimed`: Use UserCheck or CheckCircle icon (from lucide-react)
- Icons should match the existing styling pattern

**Acceptance**:
- CoordinationFeed renders appropriate icons for story_ready messages
- CoordinationFeed renders appropriate icons for story_claimed messages
- Icons are imported from lucide-react
- `npx tsc -b` passes in frontend/

---

### REQ-10: Deploy and verify Epic mode end-to-end

Deploy all changes and verify the complete flow works.

**Steps**:
1. Run `cd api && npm run typecheck` - must pass
2. Run `cd frontend && npx tsc -b` - must pass
3. Run `./deploy.sh --api` - must succeed
4. Run `./deploy.sh --frontend` - must succeed
5. Create test Jira ticket with "epic" and "workermill" labels
6. Verify in dashboard:
   - Task shows `executionMode: parallel`
   - Story_ready messages appear in coordination feed
   - Epic container spawns (visible in ECS or logs)

**Acceptance**:
- Type checks pass for both api and frontend
- Deployments complete without errors
- Epic-labeled ticket triggers parallel execution mode

---

## Out of Scope

- Modifying the Epic Executor code itself (coordinator.ts, executor.ts, experts.ts) - these already work
- Adding new expert personas
- Changing the Planner-Critic logic
- WebSocket implementation (keep using SSE)
- Any changes to the sequential v2 pipeline for non-epic tasks

---

## Technical Notes

- **Backward compatibility**: Sequential v2 pipeline must remain unchanged for non-epic tasks
- **Database**: Use TypeORM patterns consistent with existing migrations
- **Icons**: Use lucide-react which is already installed in frontend
- **Logging**: Add appropriate console.log statements for debugging
- **Error handling**: Follow existing patterns in orchestrator-v2.ts

---

## Data Flow Diagram

```
Jira Webhook (epic label, optional critic label)
    │
    ▼
webhooks.ts: Create task with executionMode="parallel", pipelineVersion="v2"
             criticEnabled=true if "critic" label present
    │
    ▼
orchestrator.ts: processPlanningTask() → processV2PipelinePlanning()
    │
    ▼
    ┌─────────────────────────────────────┐
    │ IF criticEnabled === true:          │
    │   critic-agent.ts: Planner-Critic   │
    │   loop (Gemini 2.0 Flash validation)│
    │ ELSE:                               │
    │   Skip critic, proceed directly     │
    └─────────────────────────────────────┘
    │
    ▼
orchestrator-v2.ts: publishStoriesReady() posts story_ready messages
    │
    ▼
orchestrator-v2.ts: spawnEpicContainer() spawns worker with EPIC_MODE=true
    │
    ▼
epic-entrypoint.sh → EpicCoordinator
    │
    ├─► Poll for story_ready messages
    ├─► Claim stories atomically
    ├─► Execute stories in parallel with expert subagents
    ├─► Route questions between experts
    ├─► Post completions
    │
    ▼
Mission complete → Create consolidated PR
```
