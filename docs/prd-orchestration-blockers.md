# PRD Orchestration — Blocking Issues & Fix Plan

**Status:** ✅ RESOLVED — All critical blockers fixed (January 18, 2026)
**Created:** January 2026
**Purpose:** Handoff document for agent collaboration on fixes

---

## Executive Summary

The PRD (Product Requirements Document) orchestration feature is designed to:
1. Accept a large PRD/Epic ticket
2. Run a planning agent to break it into stories
3. Present plan for human approval
4. Execute stories in dependency order
5. Merge results back to parent branch

**Current State:** All 3 critical blockers have been resolved. The feature is ready for testing.

---

## Architecture Overview

### Intended Flow
```
Jira PRD Ticket (Epic/Story with multiple subtasks)
    ↓
[1] Task created with workflowMode = 'prd'
    ↓
[2] Planning agent analyzes ticket, generates plan (stories + dependencies)
    ↓
[3] Plan saved to task.planJson, status → 'pending_plan_approval'
    ↓
[4] Human reviews plan in dashboard, approves/requests changes
    ↓
[5] Child tasks created for each story, respecting dependencies
    ↓
[6] Workers execute stories, blocked stories wait for dependencies
    ↓
[7] On completion, checkAndUnblockDependentTasks() releases blocked stories
    ↓
[8] All stories complete → parent PRD marked complete
```

### Key Files

| File | Purpose |
|------|---------|
| `api/src/services/orchestrator.ts` | Core orchestration logic |
| `api/src/routes/tasks.ts` | Task API endpoints including worker-complete callback |
| `api/src/models/WorkerTask.ts` | Task model with PRD fields (planJson, planStatus, parentTaskId, storyIndex) |
| `api/src/models/WorkerCommand.ts` | Mid-execution commands to workers |
| `docs/native-prd-orchestration.md` | Feature specification |
| `docs/dynamic-prd-planning.md` | Planning agent specification |
| `docs/prd-orchestration-ui.md` | Dashboard UI specification |

---

## Critical Blocking Issues

### BLOCKER 1: `claimPlanningTask()` Function Does Not Exist

**Severity:** ✅ FIXED
**Location:** `api/src/services/orchestrator.ts:475`

**Problem:**
```typescript
// Line 496-505
async function processPlanningTask(task: WorkerTask) {
  if (!await claimPlanningTask(task.id)) {  // ← FUNCTION DOES NOT EXIST
    return;
  }
  // ...
}
```

The function `claimPlanningTask()` is called but never defined anywhere in the codebase. This will throw a `ReferenceError` at runtime.

**Fix Options:**

Option A: Create dedicated `claimPlanningTask()` function:
```typescript
async function claimPlanningTask(taskId: string): Promise<boolean> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const result = await taskRepo.update(
    { id: taskId, status: 'planning', planStatus: IsNull() },
    { planStatus: 'generating' }
  );
  return result.affected === 1;
}
```

Option B: Reuse existing `claimTask()` with planning-specific status:
```typescript
// In processPlanningTask():
if (!await claimTask(task.id, 'planning')) {
  return;
}
```

**Recommended:** Option A — planning tasks have different state machine than execution tasks.

---

### BLOCKER 2: Planning Results Never Saved

**Severity:** ✅ FIXED
**Location:** `api/src/services/planning-agent.ts:555-561`

**Problem:**
```typescript
async function processPlanningTask(task: WorkerTask) {
  if (!await claimPlanningTask(task.id)) {
    return;
  }

  try {
    // Line 516: Planning runs successfully
    const plan = await runPlanningAgent(task);

    // Line 519-528: Event is logged
    await logTaskEvent(task.id, 'planning_complete', {
      storyCount: plan.stories?.length || 0,
    });

    // ❌ MISSING: Save the plan!
    // ❌ MISSING: Update task status!
    // ❌ MISSING: Notify dashboard!

    // Function ends here - plan is lost forever

  } catch (error) {
    // Error handling exists but success path does nothing
  }
}
```

**Required Fix:**
```typescript
async function processPlanningTask(task: WorkerTask) {
  if (!await claimPlanningTask(task.id)) {
    return;
  }

  const taskRepo = AppDataSource.getRepository(WorkerTask);

  try {
    const plan = await runPlanningAgent(task);

    await logTaskEvent(task.id, 'planning_complete', {
      storyCount: plan.stories?.length || 0,
    });

    // ✅ ADD: Save the plan and update status
    task.planJson = plan;
    task.planStatus = 'pending_approval';
    await taskRepo.save(task);

    // ✅ ADD: Optional - create Jira comment with plan summary
    if (task.jiraIssueKey) {
      await postPlanSummaryToJira(task);
    }

    logger.info(`Planning complete for task ${task.id}, awaiting approval`);

  } catch (error) {
    task.planStatus = 'failed';
    task.planError = error instanceof Error ? error.message : 'Unknown error';
    await taskRepo.save(task);
    throw error;
  }
}
```

---

### BLOCKER 3: Dependency Unblocking Race Condition

**Severity:** ✅ FIXED (January 18, 2026)
**Location:** `api/src/services/orchestrator.ts:1549-1561` (`monitorExecutingTasks()`)

**Problem:**
Two paths can complete a task:

**Path A: Worker callback (WORKS):**
```
Worker completes → POST /api/tasks/:id/worker-complete → checkAndUnblockDependentTasks() ✅
```

**Path B: Orchestrator monitoring (BROKEN):**
```
Worker completes → ECS task stops → monitorExecutingTasks() detects → Updates task status → ❌ NEVER calls checkAndUnblockDependentTasks()
```

If the worker's callback fails (network error, API timeout, worker crash before callback), Path B kicks in but doesn't unblock dependencies.

**Current Code (Line ~1547):**
```typescript
// In monitorExecutingTasks(), after detecting ECS task completion:
task.status = 'completed';
task.completedAt = new Date();
await taskRepo.save(task);
// ❌ MISSING: checkAndUnblockDependentTasks(task.id)
```

**Required Fix:**
```typescript
// In monitorExecutingTasks(), after detecting ECS task completion:
task.status = 'completed';
task.completedAt = new Date();
await taskRepo.save(task);

// ✅ ADD: Ensure dependencies are unblocked even if worker callback failed
if (task.parentTaskId) {
  await checkAndUnblockDependentTasks(task.id);
}
```

**Note:** The function `checkAndUnblockDependentTasks()` already exists and is called from `api/src/routes/tasks.ts:1256`. It just needs to also be called from the orchestrator's monitoring path.

---

## High Priority Issues (Non-Blocking)

### ISSUE 4: Plan Approval Endpoints Missing

**Severity:** ✅ IMPLEMENTED
**Location:** `api/src/routes/tasks.ts:604` - `POST /:id/plan/approve`

**Required Endpoints:**

```typescript
// Approve a pending plan and start execution
POST /api/tasks/:taskId/plan/approve
Body: { createChildTasks: boolean }  // optional, default true
Response: { approved: true, childTaskIds: string[] }

// Request changes to a plan
POST /api/tasks/:taskId/plan/request-changes
Body: { feedback: string }
Response: { status: 'pending_revision' }

// Get current plan for review
GET /api/tasks/:taskId/plan
Response: { plan: PlanJson, status: 'pending_approval' | 'approved' | 'pending_revision' }
```

**Implementation Notes:**
- On approval, create child WorkerTask records for each story
- Set `parentTaskId` on children pointing to PRD task
- Set `storyIndex` (1-based) for ordering
- Set `dependencies` array with indices of blocking stories
- Set initial status to 'blocked' if dependencies exist, else 'queued'

---

### ISSUE 5: Child Task Creation Logic Missing

**Severity:** 🟠 HIGH — Feature incomplete
**Location:** Should be triggered after plan approval

**Required Function:**
```typescript
async function createChildTasksFromPlan(parentTask: WorkerTask): Promise<WorkerTask[]> {
  const plan = parentTask.planJson;
  if (!plan?.stories?.length) {
    throw new Error('No stories in plan');
  }

  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const children: WorkerTask[] = [];

  for (let i = 0; i < plan.stories.length; i++) {
    const story = plan.stories[i];
    const storyIndex = i + 1;  // 1-based

    const child = taskRepo.create({
      organizationId: parentTask.organizationId,
      parentTaskId: parentTask.id,
      storyIndex,
      status: story.dependencies?.length ? 'blocked' : 'queued',
      dependencies: story.dependencies || [],
      title: story.title,
      description: story.description,
      persona: story.persona || parentTask.persona,
      jiraIssueKey: parentTask.jiraIssueKey,  // Same parent ticket
      workflowMode: 'story',
      // Inherit other fields from parent...
    });

    children.push(await taskRepo.save(child));
  }

  // Update parent status
  parentTask.planStatus = 'executing';
  await taskRepo.save(parentTask);

  return children;
}
```

---

### ISSUE 6: Feature Branch Strategy Not Implemented

**Severity:** 🟠 HIGH — Merge conflicts likely without this
**Location:** References in `orchestrator.ts:752, 841` but not implemented

**Current State:**
- Code references `planJson.featureBranch` but it's never created
- Each story would create its own branch without coordination
- No merge strategy defined

**Required Implementation:**
```typescript
// On plan approval, create parent feature branch
async function createFeatureBranch(task: WorkerTask): Promise<string> {
  const branchName = `ai/${task.jiraIssueKey}`;
  // Use GitHub API to create branch from main
  await githubClient.createBranch(task.repoFullName, branchName, 'main');
  return branchName;
}

// Child stories branch from parent feature branch
// ai/OCS-123 (parent)
//   └── ai/OCS-123-story-1 (child)
//   └── ai/OCS-123-story-2 (child)

// On story completion, merge to parent branch
// On all stories complete, create PR from parent branch to main
```

---

## Testing Checklist

After fixes are applied, verify:

### Blocker 1 (claimPlanningTask)
- [ ] Planning task processing doesn't throw ReferenceError
- [ ] Multiple orchestrator instances don't double-process same planning task
- [ ] Failed claim returns gracefully

### Blocker 2 (Plan Storage)
- [ ] After planning completes, `task.planJson` contains the plan
- [ ] `task.planStatus` is set to `'pending_approval'`
- [ ] Plan appears in dashboard for review
- [ ] Jira comment posted with plan summary (if configured)

### Blocker 3 (Dependency Unblocking)
- [ ] When worker callback succeeds, blocked stories are unblocked
- [ ] When worker callback fails but ECS task completes, blocked stories are still unblocked
- [ ] Stories with multiple dependencies only unblock when ALL dependencies complete

### Integration Test
- [ ] Create PRD ticket with `workermill` label
- [ ] Planning agent generates multi-story plan
- [ ] Plan appears for approval in dashboard
- [ ] Approve plan → child tasks created
- [ ] First story (no dependencies) starts executing
- [ ] Story completes → dependent stories unblock
- [ ] All stories complete → parent PRD marked complete

---

## File Change Summary

| File | Changes Required |
|------|------------------|
| `api/src/services/orchestrator.ts` | Add `claimPlanningTask()`, save plan results, add unblocking call |
| `api/src/routes/tasks.ts` | Add plan approval endpoints |
| `api/src/routes/index.ts` | Register new routes if separate file created |
| `frontend/src/pages/Orchestration/` | Connect to approval endpoints |

---

## Agent Handoff Notes

### Context for Next Agent

1. **Read first:** `docs/native-prd-orchestration.md` for full feature spec
2. **Primary file:** `api/src/services/orchestrator.ts` — most changes go here
3. **Reference implementation:** `checkAndUnblockDependentTasks()` in `api/src/routes/tasks.ts:1256` shows the dependency unblocking pattern
4. **Model:** `WorkerTask` already has all required fields (`planJson`, `planStatus`, `parentTaskId`, `storyIndex`, `dependencies`)

### What's Already Working
- `WorkerTask` model has all PRD fields
- `checkAndUnblockDependentTasks()` function exists and works
- Worker entrypoint handles `parentTaskId` for child stories
- Frontend orchestration components exist (need endpoint connections)

### What's Not Working
- Planning task processing crashes (missing function)
- Plans are generated but discarded
- Dependency unblocking has a race condition gap
- No way to approve plans from dashboard

### Suggested Approach
1. Fix Blocker 1 first (fastest, unblocks testing)
2. Fix Blocker 2 second (enables plan visibility)
3. Fix Blocker 3 third (ensures reliability)
4. Add approval endpoints (completes the flow)
5. Test end-to-end with real Jira ticket

---

## Related Documentation

- `docs/native-prd-orchestration.md` — Full feature specification
- `docs/dynamic-prd-planning.md` — Planning agent behavior
- `docs/prd-orchestration-ui.md` — Dashboard UI requirements
- `CLAUDE.md` — General codebase guidelines (DO NOT CHANGE patterns without approval)
