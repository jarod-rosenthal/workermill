# Merge Queue Gaps

Identified gaps in the parallel agent merge conflict handling pipeline. Each gap includes the root cause, affected code paths, and fix approach.

## Status

| # | Gap | Status | Fix Location |
|---|-----|--------|--------------|
| 1 | [No rebase-before-merge in worker merge queue](#gap-1-no-rebase-before-merge-in-worker-merge-queue) | DONE | `worker/epic/coordinator.ts`, `git-ops.ts` |
| 2 | [targetFiles accuracy is single point of failure](#gap-2-targetfiles-accuracy-is-single-point-of-failure) | DONE (lightweight) | `worker/epic/coordinator.ts` |
| 3 | [Failed merges silently drop story work](#gap-3-failed-merges-silently-drop-story-work) | DONE | `worker/epic/coordinator.ts` |
| 4 | [Merge queue is in-memory with no persistence](#gap-4-merge-queue-is-in-memory-with-no-persistence) | TODO | `worker/epic/coordinator.ts`, `checkpoint-manager.ts` |
| 5 | [AI merge agent not wired into merge queue](#gap-5-ai-merge-agent-not-wired-into-merge-queue) | DONE (via Gap 1) | `worker/epic/git-ops.ts` |

---

## Gap 1: No rebase-before-merge in worker merge queue

### Problem

`processMergeQueue()` at `coordinator.ts:2249` has a comment saying "Rebases onto main and runs targeted tests before merging" but the code never rebases. It runs targeted tests, then calls `gh pr merge --squash` directly.

### What happens

1. Story 0 and Story 1 both branch from `main@abc123`
2. Story 0 merges via merge queue — main is now at `abc456`
3. Story 1's branch is still based on `abc123`, behind main
4. `gh pr merge --squash` on Story 1 fails if there are conflicts with Story 0's merged changes
5. Fallback tries `--merge` instead of `--squash` — same conflict, same failure
6. PR marked `failed`, changes silently lost

### Why API-side doesn't have this problem

`mergeStoryPRsInOrder()` at `task-dispatch.ts:996` calls `scmProvider.updatePullRequestBranch()` before retrying. The worker-side merge queue has no equivalent step.

### Affected code

- `worker/epic/coordinator.ts` — `processMergeQueue()` (lines 2249-2353)

### Fix approach

Before attempting `gh pr merge`, update the PR branch to incorporate the latest base:

- **GitHub**: `gh api repos/{owner}/{repo}/pulls/{number}/update-branch -f expected_head_sha=...` or local rebase + force-push
- **Bitbucket**: Local rebase + force-push (no API equivalent)

If the branch update itself has conflicts (not just behind, but actual file conflicts), escalate to the AI merge agent (Gap 5).

---

## Gap 2: targetFiles accuracy is single point of failure

### Problem

Three separate conflict-prevention systems all rely on the planner accurately predicting which files each story will touch:

1. `enforceFileDependencies()` at `orchestrator-utils.ts:227` — adds synthetic sequential deps for shared files
2. `hasFileOverlap()` at `coordinator.ts:1340` — blocks parallel execution when running stories share target files
3. `hasMutexConflict()` at `coordinator.ts:1307` — blocks mutex group overlap

If an expert modifies files outside its declared `targetFiles` (shared types, config files, package.json, lock files, test utilities, barrel exports), the gating doesn't fire and two experts write to the same file concurrently.

### Evidence

Story completion metadata already includes `filesModified` (`coordinator.ts:2093`), but this is never compared against `targetFiles` and never fed back into the gating system.

### Affected code

- `worker/epic/coordinator.ts` — `hasFileOverlap()`, `registerRunningStory()`
- `worker/epic/executor.ts` — story completion reporting
- `api/src/services/orchestrator-utils.ts` — `enforceFileDependencies()`

### Fix approach

**Real-time gating update**: When an expert modifies a file not in its declared `targetFiles`, update the running story's file set in `runningStoryTargetFiles` so subsequent `hasFileOverlap()` checks catch the new overlap.

Implementation:
- Expert executor already posts completion with `filesModified` to the coordination feed
- Coordinator should also update `runningStoryTargetFiles` during execution (not just at completion) by having the executor periodically report touched files via coordination feed messages
- At minimum: on story completion, diff `filesModified` vs `targetFiles` and log a warning for undeclared files, so we can track how often this happens and tune the planner prompt

---

## Gap 3: Failed merges silently drop story work

### Problem

In `processMergeQueue()` at `coordinator.ts:2344-2348`, when both squash and merge-commit fail:

```typescript
storyPR.status = "failed";
```

Then in `checkMissionComplete()` at `coordinator.ts:2456`:

```typescript
} else if (mergedPRs.length > 0) {
  taskStatus = "deployed"; // PRs already merged via merge queue
```

If stories 0 and 1 merge but story 2 fails, the task reports `deployed` — story 2's changes are silently lost. No retry, no blocker escalation, no user notification beyond a dashboard log line.

### Impact

- Work is done and committed to a branch, but never lands on main
- Task shows "deployed" in the dashboard, creating false confidence
- The orphaned PR sits open with no follow-up
- Jira ticket transitions to "Done" despite incomplete work

### Affected code

- `worker/epic/coordinator.ts` — `processMergeQueue()` (failure path), `checkMissionComplete()` (status determination)

### Fix approach

1. When merge fails after all fallbacks, escalate via the existing blocker system (`blocker-manager.ts`) instead of silently marking failed
2. In `checkMissionComplete()`, check for failed PRs and set task status to `escalated` (not `deployed`) if any story's PR failed to merge
3. Include the failed story indices and conflict details in the Jira comment so the user knows exactly what needs manual attention

---

## Gap 4: Merge queue is in-memory with no persistence

### Problem

```typescript
// coordinator.ts:299
private mergeQueue: number[] = [];
private storyPRs: Map<number, StoryPRState> = new Map();
```

Both are instance variables. If the container is killed (Spot reclaim, OOM, timeout) while the merge queue has entries:
- Queue state is lost
- Stories that were approved but not yet merged become orphaned PRs
- PR review decisions are lost

### When this matters

Long-running tasks with 5+ stories completing over 30+ minutes. The window for container death (especially on Spot instances) is real. The existing checkpointing system (`worker/epic/checkpoint-manager.ts`) saves coordinator state to S3 but does not include `mergeQueue` or `storyPRs`.

### Affected code

- `worker/epic/coordinator.ts` — `mergeQueue`, `storyPRs` state
- `worker/epic/checkpoint-manager.ts` — checkpoint serialization

### Fix approach

1. Add `mergeQueue` and `storyPRs` to the checkpoint serialization in `checkpoint-manager.ts`
2. On coordinator resume from checkpoint, restore the merge queue and PR state
3. On resume, re-check PR status from the SCM provider (PRs may have been merged/closed externally while container was down)

---

## Gap 5: AI merge agent not wired into merge queue

### Problem

`resolveConflictsWithAgent()` at `git-ops.ts:1710` is a working implementation that spawns Claude to resolve conflict markers intelligently. It handles up to 10 files, has a 5-minute timeout, and uses the correct stdin-based prompt delivery pattern.

However, it is **only used in the consolidated PR path** (`createConsolidatedPR` Strategy 1.5). The per-story merge queue at `processMergeQueue()` cannot access it. When a squash merge fails, the queue tries a merge commit (same conflicts), then gives up.

### The irony

The hardest conflict resolution problem (consolidated PR with N stories) has the AI agent. The simpler problem (rebasing a single story branch onto main after previous stories merged) does not.

### Affected code

- `worker/epic/coordinator.ts` — `processMergeQueue()` (no conflict resolution)
- `worker/epic/git-ops.ts` — `resolveConflictsWithAgent()` (only used in consolidated path)

### Fix approach

When `gh pr merge --squash` fails in `processMergeQueue()`:

1. Checkout the story branch locally
2. Attempt `git rebase origin/main`
3. If rebase has conflicts, call `resolveConflictsWithAgent()` (already exists)
4. Force-push the rebased branch
5. Retry `gh pr merge --squash`
6. If AI agent also fails, escalate via blocker system (Gap 3 fix)

This reuses existing code — `resolveConflictsWithAgent()` just needs to be callable from the coordinator (currently it's a private method on `GitOps`). Either make it public or add a `rebaseAndResolve(branchName)` method to `GitOps` that wraps the rebase + agent call.
