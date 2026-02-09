# Fix: TB-2 Parallel Story Scope Explosion — Full Changelog

**Date:** 2026-02-09
**Context:** TB-2 (TeamBoard Phase 2) failed in production. The planner decomposed into 10 stories that ran in parallel, but each expert independently rewrote the entire backend (20-50 files each) instead of staying scoped. Only 2 of 10 stories merged. CI failed 3 times.

---

## Fix 1: Enforce targetFiles in executor prompt

**File:** `worker/epic/executor.ts` — `buildPrompt()` (~line 917)

**What changed:** After computing `constraintsText` from the coordination feed, a hard `FILE SCOPE RESTRICTION` block is injected into the expert's prompt when the story has `targetFiles` defined.

**Code added (after line 917):**
```typescript
let fileScopeConstraint = "";
if (story.targetFiles && story.targetFiles.length > 0) {
  fileScopeConstraint = [
    "",
    "⛔ FILE SCOPE RESTRICTION — You MUST ONLY create or modify these files:",
    ...story.targetFiles.map((f) => `  - ${f}`),
    "",
    "You may READ any file for context, but your commits MUST ONLY contain changes to the files listed above.",
    "If you need changes to other files, post a coordination message explaining why — do NOT modify them yourself.",
  ].join("\n");
}
```

**Template change (line ~1048):**
```
- ${constraintsText || "None specified"}
+ ${(constraintsText + fileScopeConstraint) || "None specified"}
```

**Impact:** Every expert now sees an explicit list of allowed files. This is the primary prevention mechanism.

**Rollback:** Remove the `fileScopeConstraint` variable and revert the template line to use `constraintsText` alone.

---

## Fix 2: Post-commit file scope validation in executor

**File:** `worker/epic/executor.ts` — `validateStoryCompletion()` (~line 427)

**What changed:** After checking that files were modified (section 1), a new section 1b checks whether modified files fall within the `targetFiles` scope. Out-of-scope files are logged as validation issues.

**Code added:**
```typescript
// 1b. Check that modified files are within targetFiles scope
if (story.targetFiles && story.targetFiles.length > 0 && changedFiles.length > 0) {
  const outOfScope = changedFiles.filter(
    (f) => !story.targetFiles!.some((t) => f === t || f.startsWith(t + "/")),
  );
  if (outOfScope.length > 0) {
    issues.push(
      `Files modified outside targetFiles scope: ${outOfScope.join(", ")}. ` +
        `Expected scope: ${story.targetFiles.join(", ")}`,
    );
  }
}
```

**Impact:** Detection/visibility layer. Out-of-scope modifications appear as warnings in the dashboard. NOT a hard block (to avoid losing the expert's work).

**Rollback:** Remove the `// 1b.` block.

---

## Fix 3: Critic hard-rejects plans with >3 files per story

### 3a: Critic prompt update

**File:** `api/src/services/critic-agent.ts` — `CRITIC_PROMPT` (~line 346)

**What changed:**
```
- 4. **Unrealistic Scope** - >3 files per step is a red flag
+ 4. **Unrealistic Scope** - Any step targeting >3 files MUST score below 85 (auto-rejection threshold).
+    Each step should modify at most 3 files. If a step needs more, split it into multiple steps first.
```

**Also added:**
```
6. **Overlapping File Scope** - If two or more steps share the same targetFiles, this causes parallel
   merge conflicts. Steps MUST NOT overlap on targetFiles. Deduct 10 points per shared file across steps.
```

### 3b: Planning agent hard cap at 5 files

**File:** `api/src/services/planning-agent.ts` — validation block (~line 1548)

**What changed:** The existing `>3 files` warning was replaced with a two-tier system:
- `>5 files`: **Hard cap** — truncates to first 5, logs error with dropped files
- `>3 files`: Warning about accuracy/merge risk (unchanged severity)

```typescript
// Before:
} else if (story.targetFiles.length > 3) {
  logger.warn("Story targets >3 files, may reduce Haiku accuracy", ...);
}

// After:
} else if (story.targetFiles.length > 5) {
  logger.error("Story targets >5 files — truncating to first 5 to prevent scope explosion", ...);
  story.targetFiles = story.targetFiles.slice(0, 5);
} else if (story.targetFiles.length > 3) {
  logger.warn("Story targets >3 files, may reduce accuracy and cause merge conflicts", ...);
}
```

**Impact:** Combined with the critic rejecting plans where steps have >3 files, the planner is forced to split stories. The hard cap at 5 is a safety net if the critic doesn't catch it.

**Rollback:** Revert to the single `>3` warning block.

---

## Fix 4: Catch-all mutexGroup for empty targetFiles

**File:** `api/src/services/orchestrator-v2.ts` — `publishStoriesReady()` (~line 584)

**What changed:** Added an `else if` branch after the existing mutex derivation logic. Stories with no `targetFiles` AND no explicit `mutexGroups` get assigned `["__unscoped__"]`.

```typescript
} else if (mutexGroups.length === 0) {
  mutexGroups = ["__unscoped__"];
  logger.warn("Story has no targetFiles — assigned __unscoped__ mutex group (sequential execution)", {
    taskId: task.id,
    storyIndex: step.index,
    title: step.title,
  });
}
```

**Impact:** All unscoped stories share the `__unscoped__` mutex group. The coordinator's `hasMutexConflict()` prevents them from running in parallel. Only properly scoped stories can run concurrently.

**Rollback:** Remove the `else if (mutexGroups.length === 0)` block.

---

## Fix 5: Wire up TaskRelationship in orchestrator

**File:** `api/src/services/orchestrator.ts` — `findQueuedTasks()` (~line 658)

**What changed:** Added an import for `TaskRelationship` and a dependency check after the maintenance org filter. Queued tasks that have a `depends_on` or `blocks` relationship with a non-terminal source task are filtered out.

**Import added:**
```typescript
import { TaskRelationship } from "../models/TaskRelationship.js";
```

**Query added (after nonMaintenanceTasks filter):**
```typescript
const blockingRelationships = await AppDataSource.getRepository(TaskRelationship)
  .createQueryBuilder("rel")
  .innerJoin("worker_tasks", "source", "source.id = rel.source_task_id")
  .where("rel.target_task_id IN (:...taskIds)", { taskIds })
  .andWhere("rel.relationship_type IN (:...types)", { types: ["depends_on", "blocks"] })
  .andWhere("source.status NOT IN (:...terminalStatuses)", {
    terminalStatuses: ["completed", "deployed", "failed", "cancelled"],
  })
  .select(["rel.target_task_id"])
  .getMany();

const blockedTaskIds = new Set(blockingRelationships.map((r) => r.targetTaskId));
const unblockedTasks = nonMaintenanceTasks.filter((t) => !blockedTaskIds.has(t.id));
```

**Downstream changes:** `nonMaintenanceTasks` → `unblockedTasks` in jiraIssueKeys mapping, eligibility filter, and the comment was updated.

**Impact:** Tasks with unresolved dependencies stay in the queue until their blockers reach a terminal state. This would have prevented TB-2 from starting while TB-1 was deploying.

**Rollback:** Remove the `TaskRelationship` import, the blocking query block, and revert `unblockedTasks` → `nonMaintenanceTasks` in the three downstream references.

---

## Fix 6: Typecheck gate before story push

**File:** `worker/epic/executor.ts` — `validateStoryCompletion()` (~line 447)

**What changed:** Added `execSync` import and a new section 1c that runs `npx tsc --noEmit` in the worktree if any `.ts`/`.tsx` files were modified and a `tsconfig.json` exists.

**Import added:**
```typescript
import { execSync } from "child_process";
```

**Code added (section 1c, after scope check, before acceptance criteria):**
```typescript
if (changedFiles.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
  // Check for tsconfig.json, run tsc --noEmit with 60s timeout
  // Failures are added to issues[] as validation warnings, not hard blocks
  // Truncated to 500 chars to avoid log bloat
}
```

**Impact:** Type errors are caught per-story before merge. Visible in the dashboard as validation issues. Not a hard block — the story still completes, but the error is surfaced.

**Rollback:** Remove the `execSync` import and the `// 1c.` block.

---

## Fix 7: Sequential fallback for high-overlap plans

### 7a: File-level overlap detection in orchestrator

**File:** `api/src/services/orchestrator-v2.ts` — `publishStoriesReady()` (~line 556)

**What changed:** Added a pre-computation pass before the story publication loop. Iterates all story pairs and checks for shared `targetFiles`. Shared files get `file:<path>` mutex groups added to both stories.

```typescript
const fileOverlapMutexByStep = new Map<number, string[]>();
for (let i = 0; i < plan.steps.length; i++) {
  // ... compare targetFiles across all pairs
  // shared files → fileMutexes = shared.map(f => `file:${f}`)
  // added to both steps
}
```

Then inside the loop, before publishing:
```typescript
const overlapMutexes = fileOverlapMutexByStep.get(step.index) || [];
if (overlapMutexes.length > 0) {
  mutexGroups = [...new Set([...mutexGroups, ...overlapMutexes])];
}
```

### 7b: Critic prompt update

**File:** `api/src/services/critic-agent.ts` — `CRITIC_PROMPT`

**Added check item 6:**
```
6. **Overlapping File Scope** - If two or more steps share the same targetFiles, this causes parallel
   merge conflicts. Steps MUST NOT overlap on targetFiles. Deduct 10 points per shared file across steps.
```

**Impact:** Stories that share targetFiles are forced sequential by the coordinator's existing `hasMutexConflict()`. The critic also penalizes plans with overlapping scopes, incentivizing the planner to split.

**Rollback:** Remove the `fileOverlapMutexByStep` pre-computation and the overlap merge block. Remove critic check item 6.

---

## Fix 8: Pre-flight env var validation

**File:** `api/src/services/local-epic-spawner.ts` — after `buildEnvArgs()` (~line 395)

**What changed:** After building the Docker `-e` args, a validation step parses them back into a map and checks that critical variables are non-empty: `TARGET_REPO`, `API_BASE_URL`, `ORG_API_KEY`, `SCM_TOKEN`.

```typescript
const envMap = new Map<string, string>();
// Parse -e KEY=VALUE pairs from envArgs
const requiredVars = ["TARGET_REPO", "API_BASE_URL", "ORG_API_KEY", "SCM_TOKEN"];
const missingVars = requiredVars.filter((v) => !envMap.get(v));
if (missingVars.length > 0) {
  throw new Error(`Pre-flight validation failed: missing required env vars: ${missingVars.join(", ")}`);
}
```

**Impact:** Missing configuration fails the task immediately with a clear error instead of spawning a container that runs for minutes then fails on git push.

**Rollback:** Remove the `envMap` / `requiredVars` / `missingVars` block.

---

## Fix 9: TaskRelationship from Jira/Linear links

### 9a: New service file

**File:** `api/src/services/task-relationship-sync.ts` (NEW)

**What it does:** After a `WorkerTask` is created from a webhook, this service fetches issue relationships from the source tracker and creates `TaskRelationship` records.

- **Jira:** `GET /rest/api/3/issue/{key}?fields=issuelinks` — parses `outwardIssue` (blocks) and `inwardIssue` (depends_on)
- **Linear:** GraphQL query `issue(id) { relations { nodes { type relatedIssue { identifier } } } }` — maps `blocks`/`blocked`/`related`/`duplicate`

Key function: `syncIssueRelationships(task, org, source, issueId)` — fire-and-forget, errors logged but don't propagate.

### 9b: Model update

**File:** `api/src/models/TaskRelationship.ts`

**What changed:** Added `"linear"` to the `RelationshipSource` type union.

### 9c: Webhook handler integration

**File:** `api/src/routes/webhooks.ts`

**What changed:** Added import for `syncIssueRelationships` and fire-and-forget calls after task creation in all 4 webhook handlers:
- Legacy Jira handler (~line 701)
- Legacy Linear handler (~line 1374)
- Multi-tenant Jira handler (~line 2832)
- Multi-tenant Linear handler (~line 3157)

**Impact:** Issue relationships from Jira/Linear are automatically mirrored into `TaskRelationship` records. Combined with Fix 5, the orchestrator respects these dependencies — a blocked task won't start until its blocker is terminal.

**Rollback:** Delete `task-relationship-sync.ts`. Remove the import and 4 `syncIssueRelationships` calls from `webhooks.ts`. Remove `"linear"` from `RelationshipSource`.

---

## Files Modified Summary

| File | Fixes | Type |
|------|-------|------|
| `worker/epic/executor.ts` | 1, 2, 6 | Worker (requires `build-worker`) |
| `api/src/services/critic-agent.ts` | 3a, 7b | API |
| `api/src/services/planning-agent.ts` | 3b | API |
| `api/src/services/orchestrator-v2.ts` | 4, 7a | API |
| `api/src/services/orchestrator.ts` | 5 | API |
| `api/src/services/local-epic-spawner.ts` | 8 | API |
| `api/src/services/task-relationship-sync.ts` | 9a | API (NEW) |
| `api/src/models/TaskRelationship.ts` | 9b | API (model) |
| `api/src/routes/webhooks.ts` | 9c | API |
| `api/src/routes/webhooks.ts` | comment fix | API |
| `CLAUDE.md` | comment fix | Docs |

## Deployment

```bash
# API changes (fixes 3, 4, 5, 7, 8, 9)
./deploy.sh --api

# Worker changes (fixes 1, 2, 6)
./deploy.sh --worker

# For local testing:
./bin/local-workermill build-worker   # rebuild worker image
# Then restart API (kill port 3001, start --skip-db)
```

## Verification Checklist

- [ ] `cd api && npm run typecheck` passes
- [ ] `cd worker/epic && npx tsc --noEmit` passes
- [ ] Create test task with multi-story plan — verify:
  - [ ] Stories with empty targetFiles get `__unscoped__` mutex group in logs
  - [ ] Expert prompt shows "FILE SCOPE RESTRICTION" section
  - [ ] Validation logs show out-of-scope file warnings if expert exceeds scope
  - [ ] Stories sharing targetFiles get `file:<path>` mutex groups
  - [ ] Typecheck runs after story commit (if TS project)
- [ ] Create Jira ticket with "blocks" link — verify `TaskRelationship` created
- [ ] Create blocked task — verify it stays queued until blocker completes
- [ ] Start container with missing env var — verify immediate failure with clear message
