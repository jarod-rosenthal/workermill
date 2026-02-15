# Skip Per-Story Review When Dependencies Have Merge Conflicts

## Context

Per-story reviews run on individual worktrees that may be missing code from sibling branches due to merge conflicts. This causes false rejections — the reviewer grades an incomplete codebase, finds "errors" from missing code, and burns revision cycles fixing non-existent problems. The consolidated review at the end runs on the fully merged feature branch and catches everything anyway.

**Observed in TB-9:** Story 7 (verification/quality gates) got score 3/10 and burned a revision cycle because 4 of 7 dependency branches couldn't merge in. The typecheck/test failures were from missing sibling code, not real bugs.

## Changes

### 1. Add `depConflicts` field to `StoryResult` (`worker/epic/types.ts:136`)

Add an optional field to pass conflict info from executor back to coordinator:

```typescript
/** Dependency branches that had merge conflicts (missing from worktree) */
depConflicts?: string[];
```

### 2. Populate `depConflicts` in executor (`worker/epic/executor.ts:~644`)

After the dependency merge in `executeStory()`, store `mergeResult.conflicted` on `storyResult`:

```typescript
if (mergeResult.conflicted.length > 0) {
  storyResult.depConflicts = mergeResult.conflicted;
  // ... existing logging ...
}
```

### 3. Track conflicts in coordinator (`worker/epic/coordinator.ts:~273`)

Add a new map to the coordinator class:

```typescript
private storyDepConflicts: Map<number, string[]> = new Map();
```

### 4. Store conflicts on story completion (`worker/epic/coordinator.ts:~1910`)

In `executeStoryAsync()`, after `result.success` check, store the conflicts:

```typescript
if (result.depConflicts?.length) {
  this.storyDepConflicts.set(story.storyIndex, result.depConflicts);
}
```

### 5. Skip review in `checkCompletions()` (`worker/epic/coordinator.ts:~2182`)

After the existing `if (this.reviewedStoryIndices.has(storyIndex)) continue;` check, add:

```typescript
// Skip per-story review if dependencies had merge conflicts — the worktree
// is missing sibling code, so typecheck/test failures are expected false positives.
// The consolidated review on the fully merged feature branch catches real issues.
const conflicts = this.storyDepConflicts.get(storyIndex);
if (conflicts && conflicts.length > 0) {
  console.log(`[Epic] Skipping per-story review for story ${storyIndex} — ${conflicts.length} dependency merge conflict(s), deferring to consolidated review`);
  this.postDashboardLog(`Story ${storyIndex} review skipped (dependency merge conflicts — consolidated review will catch issues)`);
  this.reviewedStoryIndices.add(storyIndex);
  continue;
}
```

## Files Modified

1. `worker/epic/types.ts` — Add `depConflicts` to `StoryResult`
2. `worker/epic/executor.ts` — Populate `depConflicts` from `mergeResult.conflicted`
3. `worker/epic/coordinator.ts` — Track conflicts map + skip review logic

## Verification

1. `cd worker/epic && npx tsc --noEmit` — typecheck the worker epic module
2. Review the log output in a future run — stories with dep conflicts should show "Skipping per-story review" instead of burning revision cycles
3. Consolidated review still runs on the fully merged feature branch (no changes to that path)
