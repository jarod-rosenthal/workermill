# Phase 3: Orchestrator-Managed PR Merging

**Date:** 2025-01-18
**Status:** Implementation Complete (not deployed)

## Overview

Phase 3 implements orchestrator-managed PR merging for PRD workflows. When all child tasks (stories) complete, the orchestrator automatically merges all story PRs into the feature branch **before** creating the final PR to main.

This separates concerns:
- **Workers**: Create PRs to feature branch (`story-1 -> feature/xyz`)
- **Orchestrator Phase 3**: Merge PRs in dependency order into feature branch
- **Orchestrator Phase 4**: Create final PR from feature branch to main (`feature/xyz -> main`)

## Architecture

### Flow Diagram

```
All children terminal
        │
        ▼
┌───────────────────────────────────┐
│ PHASE 3: Orchestrator PR Merging  │
│                                   │
│ 1. Get all child tasks with PRs   │
│ 2. Sort by storyIndex (order)     │
│ 3. Merge each in sequence         │
│    (squash to feature branch)     │
│ 4. Handle conflicts gracefully    │
│                                   │
│ Result: All PRs merged into       │
│ feature branch                    │
└───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│ PHASE 4: Create Final PR          │
│                                   │
│ Create PR: feature branch -> main │
│                                   │
│ Result: Single consolidated PR    │
│ ready for review/merge            │
└───────────────────────────────────┘
```

## Implementation Details

### Function: `mergeStoryPRsInOrder()`

**Location:** `/mnt/c/Users/jarod/github/workermill/api/src/services/orchestrator.ts:1166-1283`

```typescript
async function mergeStoryPRsInOrder(parentTask: WorkerTask): Promise<void>
```

**Behavior:**

1. **Collect child PRs**: Gets all child tasks belonging to parent task
2. **Sort by dependency order**: Uses `jiraFields.storyIndex` to order PRs
3. **Merge sequentially**:
   - Calls `mergePullRequest()` with squash merge method
   - Uses child task's Jira key as commit title
   - Logs each merge to parent task events
4. **Handle failures gracefully**:
   - If a single PR fails to merge (conflict), logs warning and continues
   - All PRs are attempted - doesn't fail on first error
   - Catches and logs exceptions to prevent workflow interruption
5. **Add delays**: 2-second delay between merges to allow GitHub to process

**Logging:**
- `🔄 Phase 3: Merging X story PRs in dependency order...` (start)
- `Merging Story {index}: PR #{number}` (per PR)
- `✅ Merged PR #{number} (Story {index})` (success)
- `⚠️ PR #{number} may have merge conflicts...` (partial failure)
- `❌ Failed to merge PR #{number}:` error (exception)
- `✅ Phase 3 complete: All story PRs merged into feature branch` (finish)

### Integration Point

**Location:** `orchestrator.ts:1349-1375`

Called from `checkParentTaskCompletion()` when:
1. All child tasks reach terminal status (completed/deployed/review_requested/failed/cancelled)
2. Parent task is in `dispatching` status
3. This is a PRD workflow (`isPrdWorkflow = true`)
4. At least one story completed successfully (`completed > 0`)

```typescript
// PHASE 3: Merge all story PRs in dependency order into feature branch
// This runs BEFORE creating the final PR to main, ensuring all PRs are consolidated
if (isPrdWorkflow && completed > 0) {
  try {
    await mergeStoryPRsInOrder(parentTask);
  } catch (error) {
    logger.error("Error in Phase 3 PR merging", { ... });
    await logTaskEvent(..., "Phase 3 PR merging encountered errors - continuing...");
  }
}
```

**Key Decision:** Phase 3 runs **BEFORE** the final PR is created, not after. This ensures:
- All merged commits are included in the final PR
- No gaps between individual story PRs and consolidation
- Clean git history with squashed commits

## Merge Strategy

### Merge Method: Squash

Each story PR is merged using squash merge:

```typescript
const merged = await mergePullRequest(repo, prNumber, {
  mergeMethod: "squash",
  commitTitle: `${child.jiraIssueKey}: ${child.summary}`,
})
```

**Why squash?**
- Reduces clutter - one commit per story
- Preserves Jira key in commit message for traceability
- Clean feature branch history (linear, no merge commits)

### Commit Title Format

```
{JIRA_KEY}: {Story Summary}
```

Example:
```
OCS-15: Add Slack integration webhook handler
OCS-16: Implement webhook retry logic
OCS-17: Add webhook signature verification
```

## Dependency Ordering

Stories are merged in order by `storyIndex`:

```typescript
const sortedChildren = children
  .filter((c) => c.githubPrNumber && c.githubRepo)
  .sort((a, b) => {
    const aIndex = (a.jiraFields as any)?.storyIndex || 0;
    const bIndex = (b.jiraFields as any)?.storyIndex || 0;
    return aIndex - bIndex;
  });
```

**Important:** `storyIndex` is set during planning and preserved in task's `jiraFields`. If a story has no index, it defaults to 0 (higher priority).

**Dependency Guarantee:** If Story B depends on Story A, Story A has a lower index and merges first. This ensures:
1. Story A changes are in the feature branch before Story B PR merges
2. If Story B has conflicts due to Story A's changes, they're resolved during Story B's PR review
3. Clean dependency chain is preserved in git history

## Error Handling

### Partial Failures

If a merge fails (usually due to conflicts), Phase 3:

1. Logs the failure with details
2. Continues with the next PR (doesn't stop)
3. Notifies user in parent task logs

```typescript
} else {
  await logTaskEvent(
    parentTask.id,
    "info",
    `⚠️ PR #${child.githubPrNumber} may have merge conflicts - continuing with other PRs`,
    { severity: "warning" }
  );
  // Continue with other PRs - don't fail entire workflow
}
```

**User action required:** If a PR has conflicts, user must manually merge it on GitHub. The final PR creation will still succeed if other PRs merged.

### Exceptions

If an unexpected error occurs (e.g., network issue):

1. Exception is caught per PR
2. Logged with error details
3. Workflow continues to next PR
4. Parent task still completes (failure recorded in logs)

```typescript
} catch (error) {
  logger.error("Failed to merge child PR", {
    parentTaskId, childTaskId, prNumber, error
  });
  await logTaskEvent(parentTask.id, "error",
    `❌ Failed to merge PR #${prNumber}: ${error message}`);
  // Continue with other PRs
}
```

## Delays & Rate Limiting

Between each PR merge, Phase 3 waits 2 seconds:

```typescript
// Small delay between merges to let GitHub process
await new Promise((resolve) => setTimeout(resolve, 2000));
```

This prevents:
- Rate limiting from GitHub API
- Race conditions on fast network
- Overloading GitHub webhook delivery

For typical multi-story PRD (3-5 stories), total Phase 3 time: 10-15 seconds.

## Logging & Observability

### Task Events

All Phase 3 activities are logged as task events (visible in dashboard):

```
🔄 Phase 3: Merging 4 story PRs in dependency order...
Merging Story 1: PR #456
✅ Merged PR #456 (Story 1)
Merging Story 2: PR #457
✅ Merged PR #457 (Story 2)
...
✅ Phase 3 complete: All story PRs merged into feature branch
```

### Logger Output

Structured logs at `INFO` and `ERROR` levels:

```json
{
  "level": "info",
  "message": "Merged child story PR",
  "parentTaskId": "...",
  "childTaskId": "...",
  "prNumber": 456,
  "storyIndex": 1
}
```

## Files Modified

### `/mnt/c/Users/jarod/github/workermill/api/src/services/orchestrator.ts`

**Added:**
- `mergeStoryPRsInOrder()` function (lines 1166-1283)
  - 117 lines of implementation
  - Comprehensive error handling
  - Dependency ordering
  - Task event logging

**Modified:**
- `checkParentTaskCompletion()` function (lines 1349-1375)
  - Added Phase 3 integration before final PR creation
  - Wrapped in try-catch to prevent workflow interruption
  - Conditional on PRD workflow and completed stories

**No breaking changes:**
- All existing logic preserved
- Phase 3 only runs for PRD workflows
- Errors are non-fatal (workflow continues)

## Testing Scenarios

### Scenario 1: All Stories Merge Successfully
```
Parent: OCS-100 (epic with 3 stories)
Stories: OCS-101, OCS-102, OCS-103 (all completed)
Expected:
  - Phase 3 merges all 3 PRs in order (1→2→3)
  - Phase 4 creates final PR: feature/xyz -> main
  - Dashboard shows: ✅ Phase 3 complete
```

### Scenario 2: One Story Has Merge Conflicts
```
Parent: OCS-100
Stories: OCS-101 (completed), OCS-102 (completed), OCS-103 (completed)
Story 102 PR has conflicts
Expected:
  - Phase 3 merges PR 101 ✅
  - Phase 3 attempts PR 102, conflict detected ⚠️
  - Phase 3 continues, merges PR 103 ✅
  - Dashboard shows: ⚠️ PR #102 may have merge conflicts
  - Final PR created with PRs 101 + 103 (not 102)
```

### Scenario 3: One Story Failed (Not Created)
```
Parent: OCS-100
Stories: OCS-101 (completed), OCS-102 (failed), OCS-103 (completed)
Expected:
  - Phase 3 attempts merge of PR 101 ✅
  - Phase 3 skips PR 102 (has no githubPrNumber because failed)
  - Phase 3 merges PR 103 ✅
  - Phase 4: Final PR **not created** (because failed > 0)
```

### Scenario 4: Single Story PRD (Not Multi-Story)
```
Parent: OCS-100 (single-story plan, not dispatching)
Expected:
  - Phase 3 is **skipped** (only runs for multi-story PRD)
  - Parent transitions directly to completed
  - Final PR created from child's PR (no orchestration)
```

## Backwards Compatibility

Phase 3 is fully backwards compatible:

1. **Existing PRD workflows unaffected**: Only runs when all children complete
2. **Single-story PRD unchanged**: Single story has no PR merging needed
3. **Non-PRD workflows unaffected**: Regular tasks skip Phase 3 entirely
4. **Errors are non-fatal**: Workflow continues even if Phase 3 fails
5. **No database schema changes**: Uses existing fields (storyIndex, githubPrNumber)

## Future Enhancements

### Potential Improvements

1. **Conflict resolution strategy**:
   - Option to auto-rebase conflicting PRs
   - Option to create separate "conflict resolution" PR

2. **Merge status webhook**:
   - Notify workers after their PR is merged
   - Allow workers to take action on feedback

3. **Parallel merging**:
   - Merge non-dependent PRs in parallel (if topology analysis available)
   - Currently sequential for simplicity

4. **Merge verification**:
   - Check that feature branch contains all expected commits after merge
   - Verify no commits were lost

5. **Rollback capability**:
   - Store list of merged PRs
   - Option to revert merges if final PR creation fails

## Status

**Implementation:** ✅ Complete
- Function implemented: `mergeStoryPRsInOrder()`
- Integration point added: `checkParentTaskCompletion()`
- Typecheck passing: ✅ No TypeScript errors
- Not yet deployed to production

**Next Steps:**
1. Deploy to staging environment
2. Test with sample PRD workflow
3. Verify GitHub merge operations work correctly
4. Monitor error logs for edge cases
5. Deploy to production after validation

## References

- **Phase 1**: Single-story PRD execution (workers create PR to feature branch)
- **Phase 2**: Multi-story dispatch and dependency management (orchestrator coordinates workers)
- **Phase 3**: PR merging (orchestrator merges story PRs in order) ← **YOU ARE HERE**
- **Phase 4**: Final PR creation (orchestrator creates consolidated PR to main)
- **Phase 5**: Deployment and verification (orchestrator deploys and verifies)
