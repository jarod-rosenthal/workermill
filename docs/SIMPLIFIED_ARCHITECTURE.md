# Simplified WorkerMill Architecture

> **Status:** Proposal
> **Preserved Version:** `v1-full-coordination` tag

---

## Overview

Replace complex coordination with a simpler model:

```
BEFORE (Complex):
  Dispatch → Workers share branch → File locks → Context API →
  Dependency blocking → PR merge triggers next → Complex state machine

AFTER (Simple):
  Dispatch → Each worker gets own branch → All run in parallel →
  Orchestrator merges PRs in order → Done
```

---

## Architecture Diagram

```
                         Jira PRD Ticket
                              │
                              ▼
               ┌──────────────────────────┐
               │     Planning Agent       │  ← KEEP: Codebase context,
               │  (Decompose into stories)│     story sizing, targetFiles
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │      Approval UI         │  ← KEEP: Human review
               └────────────┬─────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │       Dispatcher         │
               │  - Create feature branch │
               │  - Create story branches │
               │  - Spawn ALL workers     │
               └────────────┬─────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │  Worker 1 │     │  Worker 2 │     │  Worker 3 │
    │           │     │           │     │           │
    │ Branch:   │     │ Branch:   │     │ Branch:   │
    │ story-0   │     │ story-1   │     │ story-2   │
    │           │     │           │     │           │
    │ Target:   │     │ Target:   │     │ Target:   │
    │ feature   │     │ feature   │     │ feature   │
    └─────┬─────┘     └─────┬─────┘     └─────┬─────┘
          │                 │                 │
          │    (completely independent)      │
          │      (no coordination)           │
          │                 │                 │
          ▼                 ▼                 ▼
       PR #1             PR #2            PR #3
    story-0→feature   story-1→feature  story-2→feature
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                            ▼
               ┌──────────────────────────┐
               │   Orchestrator Merger    │
               │  1. Wait for all PRs     │
               │  2. Merge PR #1          │
               │  3. Update story-1 from  │
               │     feature, merge PR #2 │
               │  4. Update story-2 from  │
               │     feature, merge PR #3 │
               │  5. Create final PR to   │
               │     main                 │
               └──────────────────────────┘
```

---

## State Machine (Simplified)

```
OLD: planning → pending_plan_approval → queued → dispatching →
     [blocked|queued] → running → [waiting_for_merge] →
     completed|failed|deployed|review_requested|cancelled

NEW: planning → pending_plan_approval → queued → running →
     completed|failed|cancelled

     Parent states:
     planning → pending_plan_approval → dispatching →
     waiting_for_children → merging → completed|failed
```

**Removed states:**
- `blocked` - Workers don't wait for each other
- `waiting_for_merge` - Orchestrator handles all merging

---

## Key Changes

### 1. Worker Branch Strategy

**Before:**
- All workers target same branch
- File locking prevents conflicts
- Sequential execution via dependencies

**After:**
- Each worker gets own branch: `feature/{ticket}/story-{index}`
- Workers run completely in parallel
- No file locking needed

```typescript
// OLD
childTask.jiraFields = {
  targetBranch: planJson.featureBranch, // Same for all
};

// NEW
childTask.jiraFields = {
  storyBranch: `${planJson.featureBranch}/story-${story.index}`,
  targetBranch: planJson.featureBranch, // PR target
};
```

### 2. Dispatch All Workers Immediately

**Before:**
- Story 0: queued (starts immediately)
- Story 1: blocked (waits for Story 0's PR merge)
- Story 2: blocked (waits for Story 1's PR merge)

**After:**
- Story 0: queued (starts immediately)
- Story 1: queued (starts immediately)
- Story 2: queued (starts immediately)

```typescript
// OLD
if (story.dependencies.length > 0) {
  childTask.status = "blocked";
} else {
  childTask.status = "queued";
}

// NEW
childTask.status = "queued"; // All start immediately
```

### 3. Orchestrator-Managed Merging

**Before:**
- Worker creates PR
- Human approves PR
- Human merges PR (or worker with `deploy` label)
- GitHub webhook triggers unblock
- Next worker starts

**After:**
- All workers create PRs in parallel
- All workers complete (no merging)
- Orchestrator waits for all PRs
- Orchestrator merges in dependency order
- Orchestrator creates final PR to main

```typescript
async function mergeStoriesInOrder(parentTask: WorkerTask): Promise<void> {
  const children = await getChildTasks(parentTask.id);
  const sortedChildren = topologicalSort(children);

  for (const child of sortedChildren) {
    // Update child branch from feature (get latest changes)
    await updateBranchFromBase(child.storyBranch, parentTask.featureBranch);

    // Resolve any merge conflicts
    if (await hasMergeConflicts(child.storyBranch)) {
      // Option 1: Auto-resolve with AI
      // Option 2: Mark as needs-human-review
      // Option 3: Fail and notify
    }

    // Merge the PR
    await mergePullRequest(child.githubPrUrl);
  }

  // Create final PR to main
  await createPullRequest({
    head: parentTask.featureBranch,
    base: "main",
    title: `[PRD] ${parentTask.summary}`,
  });
}
```

### 4. Conflict Resolution Strategy

**Option A: Fail-Fast (Conservative)**
```typescript
if (await hasMergeConflicts(child.storyBranch)) {
  parentTask.status = "merge_conflict";
  parentTask.errorMessage = `Story ${child.storyIndex} has merge conflicts`;
  // Human intervention required
}
```

**Option B: AI-Assisted Resolution (Experimental)**
```typescript
if (await hasMergeConflicts(child.storyBranch)) {
  // Spawn a "conflict resolver" worker
  await spawnConflictResolver(child, parentTask.featureBranch);
}
```

**Option C: Accept Both (Optimistic)**
```typescript
// Merge with strategy that accepts both changes
// Works if changes are in different parts of files
await mergePullRequest(child.githubPrUrl, { strategy: "ours" });
```

---

## What Gets Removed

### Files to Delete

| File/Code | Lines | Reason |
|-----------|-------|--------|
| `api/src/models/WorkerFileLock.ts` | ~50 | No file locking |
| `api/src/routes/coordination.ts` | ~200 | No context sharing |
| Blocked status handling in orchestrator | ~300 | No blocking |
| Unblock logic in orchestrator | ~200 | No unblocking |
| PR merge webhook handler | ~150 | Orchestrator merges |
| Context archival code | ~100 | No context sharing |
| **Total** | **~1000** | |

### Statuses to Remove

- `blocked`
- `waiting_for_merge` (if exists)

### API Endpoints to Remove

- `POST /api/coordination/manifest/declare`
- `GET /api/coordination/locks`
- `POST /api/coordination/context`
- `GET /api/coordination/context`

---

## What Stays the Same

| Component | Why Keep |
|-----------|----------|
| Planning Agent | Valuable for decomposition, targetFiles, sizing |
| Codebase Context | Prevents hallucinated file paths |
| Approval UI | Human oversight is important |
| ECS Task Spawning | True parallelism, fault isolation |
| Cost Tracking | Business value |
| Log Streaming | Visibility into worker progress |
| Quality Gates | Validation (non-blocking) |

---

## Implementation Plan

### Phase 1: Branch Strategy
1. Update worker entrypoint to use story-specific branches
2. Update orchestrator to create story branches at dispatch
3. Remove file locking code

### Phase 2: Parallel Dispatch
1. Remove `blocked` status logic
2. Dispatch all stories with `queued` status
3. Remove dependency-based blocking

### Phase 3: Orchestrator Merging
1. Add "all children complete" detection
2. Add PR merge function (GitHub API)
3. Add merge order logic (topological sort)
4. Add conflict detection
5. Add final PR creation

### Phase 4: Cleanup
1. Remove coordination API endpoints
2. Remove unused models
3. Remove unblock logic
4. Update tests/documentation

---

## Risk Analysis

| Risk | Mitigation |
|------|------------|
| Merge conflicts | Conflict detection + human notification |
| Lost dependency semantics | Stories still have declared deps, just for merge order |
| Parallel workers hitting same file | Well-decomposed stories shouldn't, conflicts caught at merge |
| Regression in single-story mode | No change to single-story flow |

---

## Metrics to Track

After simplification:

1. **Time to completion** - Should decrease (parallel execution)
2. **Merge conflict rate** - Monitor closely
3. **Success rate** - Should stay same or improve
4. **Code complexity** - Should decrease significantly
5. **Bug reports** - Should decrease (simpler system)

---

## Rollback Plan

If simplification causes issues:

```bash
git checkout v1-full-coordination
./deploy.sh --all
```

All coordination code is preserved in that tag.
