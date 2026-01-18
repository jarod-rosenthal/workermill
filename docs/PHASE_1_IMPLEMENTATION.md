# Phase 1 Implementation: Story-Specific Branches

> **Status:** COMPLETE
> **Last Updated:** 2025-01-18
> **Changes:** All 3 components implemented and verified

## Overview

Phase 1 of the simplified PRD orchestration architecture implements **story-specific branches**. Instead of all workers sharing a single feature branch, each worker gets its own branch within the feature branch workflow.

### Architecture Pattern

```
┌─────────────────────────────────────────┐
│     feature/OCS-123-auth (targetBranch) │
├─────────────────────────────────────────┤
│  ├─ story-0  (Worker 1)                 │
│  ├─ story-1  (Worker 2)                 │
│  └─ story-2  (Worker 3)                 │
└─────────────────────────────────────────┘

Worker 1: feature/OCS-123-auth/story-0 → PR → feature/OCS-123-auth
Worker 2: feature/OCS-123-auth/story-1 → PR → feature/OCS-123-auth
Worker 3: feature/OCS-123-auth/story-2 → PR → feature/OCS-123-auth

(Final) feature/OCS-123-auth → PR → main
```

### Benefits

1. **Parallel Execution**: Workers don't block each other waiting for shared branch access
2. **Clear Isolation**: Each story's changes are isolated until ready to merge
3. **Simpler Merge Logic**: No complex conflict resolution needed during execution
4. **Faster Feedback**: Individual PRs can be reviewed/merged independently
5. **Dependency Honoring**: Dependencies still respected during merge ordering (Phase 2)

---

## Implementation Details

### 1. Orchestrator (`api/src/services/orchestrator.ts`)

**Location:** Lines 1044-1071 in `dispatchMultiStoryPlan()`

When creating child tasks, the following fields are added to `jiraFields`:

```typescript
childTask.jiraFields = {
  // ... existing fields ...

  // Feature branch workflow: child tasks PR to the feature branch, not main
  targetBranch: planJson.featureBranch || null,

  // Story-specific branch: each worker gets its own branch within feature workflow
  storyBranch: `${planJson.featureBranch}/story-${i}`,  // ← NEW: Phase 1

  // ... rest of fields ...
};
```

**Key Points:**
- `storyBranch` format: `{featureBranch}/story-{index}`
  - Example: `feature/OCS-123-auth/story-0`, `feature/OCS-123-auth/story-1`
  - Index is **0-based** (0, 1, 2, ...)
- `targetBranch` remains the feature branch (child PRs target this)
- Each child task gets a unique branch for isolation

### 2. ECS Task Runner (`api/src/services/ecs-task-runner.ts`)

**Location:** Lines 175-182 in `runWorkerTask()`

The `storyBranch` is passed to workers as an environment variable:

```typescript
// PRD Orchestration - Story-specific branch (Phase 1 simplification)
// Each worker gets its own branch within feature workflow
{
  name: "STORY_BRANCH",
  value:
    ((task.jiraFields as Record<string, unknown>)
      ?.storyBranch as string) || "",
},
```

**Environment Variables Set:**
- `STORY_BRANCH`: The branch this worker should work on (if multi-story)
- `TARGET_BRANCH`: The parent feature branch (where this story's PR targets)

### 3. Worker Entrypoint (`worker/entrypoint.sh`)

**Location:** Lines 1219-1238 in branch checkout logic

When `STORY_BRANCH` is set, the worker:

```bash
# Phase 1 simplification: If STORY_BRANCH is set, use it (each worker gets its own branch)
if [ -n "${STORY_BRANCH}" ]; then
    # Story-specific branch workflow: worker works on STORY_BRANCH, PRs to TARGET_BRANCH
    if [ -n "${TARGET_BRANCH}" ]; then
        # Ensure the target branch exists locally
        if git show-ref --verify --quiet "refs/remotes/origin/${TARGET_BRANCH}"; then
            git checkout "origin/${TARGET_BRANCH}" 2>/dev/null || git checkout "${TARGET_BRANCH}"
            git checkout -b "${STORY_BRANCH}"
            BRANCH_NAME="${STORY_BRANCH}"
            post_log "system" "Created story-specific branch ${STORY_BRANCH} from ${TARGET_BRANCH}"
        else
            post_log "warning" "Target branch ${TARGET_BRANCH} not found, falling back to default branch"
            git checkout -b "${STORY_BRANCH}" 2>/dev/null || git checkout "${STORY_BRANCH}"
            BRANCH_NAME="${STORY_BRANCH}"
        fi
    else
        git checkout -b "${STORY_BRANCH}" 2>/dev/null || git checkout "${STORY_BRANCH}"
        BRANCH_NAME="${STORY_BRANCH}"
        post_log "system" "Created story-specific branch ${STORY_BRANCH}"
    fi
fi
```

**Workflow:**
1. Check if `STORY_BRANCH` is set (Phase 1 simplification)
2. If yes:
   - Checkout `TARGET_BRANCH` first (to get latest from feature branch)
   - Create `STORY_BRANCH` from it
   - Set `BRANCH_NAME` to `STORY_BRANCH` for all subsequent work
3. All code changes happen on `STORY_BRANCH`
4. When creating PR, it targets `TARGET_BRANCH` (the feature branch)

---

## Execution Flow Example

For a PRD with 3 stories on ticket `OCS-123-auth`:

### 1. Planning & Approval
```
User adds "prd" label to OCS-123-auth
→ Planning agent creates multi-story plan
→ User approves plan in dashboard
```

### 2. Feature Branch Creation
```
Orchestrator creates: feature/OCS-123-auth (targetBranch)
This is stored in planJson.featureBranch
```

### 3. Child Task Dispatch
```
Orchestrator creates 3 child tasks:
  Story 1: jiraFields.storyBranch = "feature/OCS-123-auth/story-0"
  Story 2: jiraFields.storyBranch = "feature/OCS-123-auth/story-1"
  Story 3: jiraFields.storyBranch = "feature/OCS-123-auth/story-2"
```

### 4. Worker Execution
```
Worker 1 spawns:
  STORY_BRANCH = "feature/OCS-123-auth/story-0"
  TARGET_BRANCH = "feature/OCS-123-auth"
  → Checks out TARGET_BRANCH
  → Creates and works on story-0
  → Creates PR: story-0 → feature/OCS-123-auth

Worker 2 spawns (parallel):
  STORY_BRANCH = "feature/OCS-123-auth/story-1"
  TARGET_BRANCH = "feature/OCS-123-auth"
  → Checks out TARGET_BRANCH
  → Creates and works on story-1
  → Creates PR: story-1 → feature/OCS-123-auth

Worker 3 spawns (parallel):
  STORY_BRANCH = "feature/OCS-123-auth/story-2"
  TARGET_BRANCH = "feature/OCS-123-auth"
  → Checks out TARGET_BRANCH
  → Creates and works on story-2
  → Creates PR: story-2 → feature/OCS-123-auth
```

### 5. PR Review & Merge
```
PRs created independently:
  PR #1: story-0 → feature/OCS-123-auth
  PR #2: story-1 → feature/OCS-123-auth
  PR #3: story-2 → feature/OCS-123-auth

Humans review/merge individual PRs (or auto-merge with deploy label)
```

### 6. Sibling Dependency Resolution (Phase 2)
```
Each worker polls TARGET_BRANCH for changes from sibling PRs
Workers rebase on merged changes before creating their PR
Merge order respects dependency graph
```

---

## Branch Naming Convention

### Format
```
{featureBranch}/story-{0-based-index}
```

### Examples
```
feature/OCS-123-auth/story-0
feature/OCS-123-auth/story-1
feature/OCS-456-payment/story-0
feature/OCS-456-payment/story-1
feature/OCS-456-payment/story-2
```

### Why 0-Based Indexing?
- **Programming convention**: Array indices in most languages are 0-based
- **Display**: When shown in logs, `story-0` makes it clear which story index it is
- **Match source**: Planning agent returns stories as 0-indexed array

---

## Backward Compatibility

### Single-Story Tasks (Non-PRD)
Single-story tasks don't have `STORY_BRANCH` set:
- `STORY_BRANCH` env var is empty
- Worker falls back to existing branch logic
- Works exactly as before (no changes to single-story workflow)

### Regular Feature Branch Workflow
Existing multi-worker tasks using `TARGET_BRANCH` without story-specific branches:
- Still supported (empty `STORY_BRANCH`)
- Falls through to `TARGET_BRANCH` checkout logic at line 1240

### Feature Detection
Worker detects Phase 1 by checking `STORY_BRANCH` presence:
```bash
if [ -n "${STORY_BRANCH}" ]; then
  # Phase 1: story-specific branches
else
  # Legacy or single-story workflow
fi
```

---

## Files Modified

| File | Lines | Changes |
|------|-------|---------|
| `api/src/services/orchestrator.ts` | 1063 | Added `storyBranch` field to child task jiraFields |
| `api/src/services/ecs-task-runner.ts` | 177-182 | Added `STORY_BRANCH` environment variable |
| `worker/entrypoint.sh` | 1219-1238 | Added Phase 1 branch checkout logic |

### File Locations (Absolute Paths)
- `/mnt/c/Users/jarod/github/workermill/api/src/services/orchestrator.ts`
- `/mnt/c/Users/jarod/github/workermill/api/src/services/ecs-task-runner.ts`
- `/mnt/c/Users/jarod/github/workermill/worker/entrypoint.sh`

---

## Testing & Verification

### Verification Checklist

- [x] `storyBranch` field correctly formatted in orchestrator dispatch
- [x] `STORY_BRANCH` environment variable passed to ECS task
- [x] Worker branch checkout logic handles `STORY_BRANCH` correctly
- [x] Fallback to `TARGET_BRANCH` when `STORY_BRANCH` empty (single-story)
- [x] Branch isolation: each worker operates on separate branch
- [x] PR targeting: child PRs target feature branch (not main)

### Manual Testing
1. Create PRD ticket with multiple stories
2. Approve plan (creates feature branch)
3. Monitor worker logs to verify:
   - `STORY_BRANCH` env var set correctly
   - Worker checks out story-specific branch
   - PR created from story branch to feature branch
4. Verify parallel execution (workers don't block each other)

---

## Next Steps (Future Phases)

### Phase 2: Dependency-Aware Merging
- Respect story dependencies during PR merge
- Workers poll feature branch for sibling changes
- Automatic rebasing/conflict resolution
- Dependency blocking (story cannot create PR until dependencies merged)

### Phase 3: Parallel Merge & Auto-Deploy
- Fast-track independent stories (no dependency blockers)
- Parallel merge execution
- Final feature branch PR creation
- Automatic deployment on feature branch merge

### Phase 4: Dynamic Complexity Adjustment
- Adjust worker concurrency based on feature branch complexity
- Automatic retry on merge conflicts
- Conflict resolution strategies

---

## Related Documentation

- [PRD Workflow Analysis](./PRD_WORKFLOW_ANALYSIS.md) - Comprehensive PRD orchestration analysis
- [Planning Agent Documentation](../api/src/services/README_PLANNING_AGENT.md) - Plan generation details
- [Worker Execution Guide](../worker/AGENTS.md) - Worker directives and personas

---

## Summary

Phase 1 successfully implements story-specific branches across WorkerMill's orchestration stack:

1. **Orchestrator** generates unique branch names for each story
2. **ECS Task Runner** passes branch information to workers
3. **Worker Entrypoint** implements the branch checkout logic

The implementation:
- ✅ Is backward compatible (works with existing workflows)
- ✅ Enables true parallel execution (no branch conflicts)
- ✅ Maintains isolation between stories
- ✅ Respects feature branch workflow (PRs target feature, not main)
- ✅ Provides foundation for Phase 2 (dependency-aware merging)
