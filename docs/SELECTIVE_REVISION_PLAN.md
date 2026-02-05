# Selective Story Revision for Epic Mode

## Problem Statement

When the Tech Lead requests revision, the coordinator currently queues ALL stories for re-execution (`coordinator.ts:2302-2303`):

```typescript
const stories = await this.coordination.getReadyStories();
this.revisionStoriesQueued = stories;
```

This is wasteful. If Tech Lead says "missing CI workflow and Husky hooks", only Stories 2 and 3 need revision - not all 16.

## Solution Overview

Implement selective story revision where:
1. Tech Lead outputs structured `AFFECTED_STORIES: [2, 3]` marker
2. Coordinator parses this and computes transitive closure (affected + downstream dependents)
3. Only affected stories are re-executed, respecting dependency order

---

## Architecture Context

### Revision Tracking (Already Implemented)

The coordinator tracks revisions via:
- `revisionCount: number` - incremented each time Tech Lead requests revision (max: `MAX_REVIEW_REVISIONS`, default 3)
- `lastReviewFeedback: string` - feedback injected into story prompts during revision
- `revisionStoriesQueued: ReadyStory[]` - stories to re-execute

Each completion posts `revisionNumber` metadata:
```typescript
// executor.ts line 792
await this.coordination.postStoryComplete(storyIndex, { revisionNumber });
```

Completions are filtered by revision:
```typescript
// coordination-client.ts lines 533-547
const completionRevision = (c.metadata?.revisionNumber as number) || 0;
return completionRevision >= currentRevision;
```

### Story Dependencies (Already Tracked)

Dependencies originate from the **planning agent** and are stored in `worker_contexts.metadata`:
```typescript
interface ReadyStory {
  storyIndex: number;
  dependencies: number[];  // Story indices this depends on
  // ...
}
```

The coordinator enforces dependencies in `processReadyStories()` (lines 1040-1050):
- Stories with unmet dependencies are skipped
- Only stories with all dependencies completed are assigned to experts

### Git Branches During Revision (Reused, Not Deleted)

**Critical insight:** Story branches are **REUSED** across revisions:
1. First run: Branch created `{user}-{story-index}-{story-title}`
2. Revision: Same branch, new commits added on top
3. Fresh worktree created each time (for isolation)
4. Branch already exists → worktree attached to existing branch

This means revision changes accumulate on the same branch, and the PR updates when the feature branch is force-pushed with merged story branches.

---

## PR Workflow During Revisions

Understanding how PRs work during the revision cycle is critical to this design.

### Normal Flow (First Completion)

1. Stories execute in parallel, each creating branch `story-{jiraKey}-{storyIndex}`
2. Each story pushes its branch on completion
3. `createConsolidatedPR()` runs:
   - Fetches all remote refs (`git fetch --all`)
   - Creates feature branch `feature/{jiraKey}-epic` from main
   - Merges all story branches into feature branch
   - Force pushes feature branch
   - Creates PR (or returns existing PR URL if one exists)

### Revision Flow

1. Tech Lead requests revision
2. Affected stories re-execute on their existing branches
3. Stories push updates to their branches
4. `createConsolidatedPR()` runs again:
   - Recreates feature branch from main (fresh start)
   - Re-merges ALL story branches (including updated ones)
   - **Force pushes** feature branch
   - PR already exists → returns existing URL

**Key insight:** The PR automatically updates because:
- The feature branch is force-pushed with new content
- GitHub/Bitbucket PRs track the branch, not specific commits
- When the branch updates, the PR diff updates automatically

### Why Branches Can Go Missing

OCS-28 had missing branches in the PR. The exploration reveals the **root cause**:

#### The Story Complete vs Branch Pushed Gap

A story can be marked **complete** in the coordination feed but have **no branch pushed**:

```typescript
// executor.ts lines 724-760
const hasCommits = await this.gitOps.hasCommitsAheadOfMainInWorktree(worktreePath);

if (hasCommits) {
  await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);  // ✅ Branch pushed
} else {
  await this.postLog(`No changes to push (branch is up-to-date with main)`);  // ❌ No branch!
}

// Story is STILL marked complete (lines 785-799) regardless of branch push
```

| Condition | Branch Pushed? | In PR? |
|-----------|----------------|--------|
| Story has commits + file changes | ✅ Yes | ✅ Yes |
| Story has commits, no file changes | ✅ Yes | ✅ Yes |
| Story has NO commits (up-to-date) | ❌ No | ❌ **Missing** |

#### Branch Naming Pattern

`getStoryBranches()` searches for: `origin/story/{jiraKey.toLowerCase()}-s{N}-*`

Example for OCS-28:
- `story/ocs-28-s0-setup-project` ✅
- `story/ocs-28-s1-backend-api` ✅
- `story/ocs-28-s2-frontend-ui` ❌ (if Story 2 had no commits)

#### Other Causes

1. **Fetch timing** - `git fetch --all` may not capture branches pushed milliseconds before
2. **Branch naming mismatch** - jiraKey case sensitivity (`OCS-28` vs `ocs-28`)
3. **Push failure** - Network/auth issues during push (logged but story still marked complete)

---

## Implementation Plan

### Phase 1: Extend InlineReviewResult Interface

**File:** `worker/epic/inline-reviewer.ts` (lines 22-28)

Add fields for affected stories:
```typescript
export interface InlineReviewResult {
  success: boolean;
  decision: ReviewDecision;
  feedback: string;
  codeQualityScore: number;
  error?: string;
  // NEW
  affectedStories?: number[];
  affectedReasons?: Record<number, string>;
}
```

### Phase 2: Update Tech Lead System Prompt

**File:** `worker/epic/inline-reviewer.ts` (line 33+, `TECH_LEAD_SYSTEM_PROMPT`)

Add to output format section:
```
For REVISION_NEEDED decisions, specify which stories need changes:

AFFECTED_STORIES: [2, 3]
AFFECTED_REASONS: {"2": "Missing CI workflow", "3": "Husky hooks not implemented"}

Only include stories with ACTUAL issues. The system handles downstream dependencies.
```

### Phase 3: Add Story Summary to Review Prompt

**File:** `worker/epic/inline-reviewer.ts` - `buildReviewPrompt()` method

Pass `storyCompletions` to reviewer and add to prompt:
```markdown
## Story Summary
| Story | Title | Files Modified |
|-------|-------|----------------|
| 0 | Initialize monorepo | package.json, tsconfig.json |
| 1 | Configure ESLint | eslint.config.mjs |
...
```

### Phase 4: Parse Affected Stories from Output

**File:** `worker/epic/inline-reviewer.ts`

Add new method:
```typescript
private parseAffectedStories(): { stories: number[]; reasons: Record<number, string> } | null {
  const match = this.allOutput.match(/AFFECTED_STORIES:\s*\[([^\]]+)\]/i);
  if (!match) return null;

  const stories = match[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  // Parse AFFECTED_REASONS if present
  return stories.length > 0 ? { stories, reasons } : null;
}
```

Update `getDecision()` to call this and include in result.

### Phase 5: API Endpoint for Selective Claim Archiving

**File:** `api/src/routes/coordination.ts`

Add `POST /api/coordination/archive-claims`:
```typescript
router.post("/archive-claims", authenticateRequest, [
  body("parentTaskId").isUUID(),
  body("storyIndices").isArray(),
], asyncHandler(async (req, res) => {
  // Archive story_claimed and completion messages for specified indices
  // Uses: metadata->>'storyIndex' IN (...)
}));
```

### Phase 6: Coordination Client Method

**File:** `worker/epic/coordination-client.ts`

Add method:
```typescript
async archiveStoryClaims(storyIndices: number[]): Promise<void> {
  await this.api.post("/api/coordination/archive-claims", {
    parentTaskId: this.parentTaskId,
    storyIndices,
  });
  this.coalescer.invalidateAll();
}
```

### Phase 7: Compute Affected Story Closure

**File:** `worker/epic/coordinator.ts`

Add helper method:
```typescript
private computeAffectedStoryClosure(
  directlyAffected: number[],
  allStories: ReadyStory[]
): Set<number> {
  const toRevise = new Set(directlyAffected);

  // Build reverse dependency map
  const dependents = new Map<number, number[]>();
  for (const story of allStories) {
    for (const dep of story.dependencies) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(story.storyIndex);
    }
  }

  // BFS for downstream stories
  const queue = [...directlyAffected];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const downstream of dependents.get(current) || []) {
      if (!toRevise.has(downstream)) {
        toRevise.add(downstream);
        queue.push(downstream);
      }
    }
  }
  return toRevise;
}
```

### Phase 8: Update triggerRevision()

**File:** `worker/epic/coordinator.ts` (lines 2283-2306)

Change signature and logic:
```typescript
private async triggerRevision(
  feedback: string,
  affectedStories?: number[],
  affectedReasons?: Record<number, string>
): Promise<void> {
  const allStories = await this.coordination.getReadyStories();

  let storiesToRevise: Set<number>;
  if (affectedStories?.length > 0) {
    storiesToRevise = this.computeAffectedStoryClosure(affectedStories, allStories);
    console.log(`[Epic] Selective revision: ${affectedStories.length} directly affected, ${storiesToRevise.size} total`);
  } else {
    storiesToRevise = new Set(allStories.map(s => s.storyIndex));
  }

  // Archive old claims for affected stories
  await this.coordination.archiveStoryClaims(Array.from(storiesToRevise));

  // Clear completion state for affected stories only
  for (const idx of storiesToRevise) {
    this.completedStoryIndices.delete(idx);
  }

  // Queue only affected stories, sorted by index
  this.revisionStoriesQueued = allStories
    .filter(s => storiesToRevise.has(s.storyIndex))
    .sort((a, b) => a.storyIndex - b.storyIndex);
}
```

### Phase 9: Update Review Result Handling

**File:** `worker/epic/coordinator.ts` (around line 1808)

Pass affected stories to triggerRevision:
```typescript
case "revision_needed":
  await this.triggerRevision(
    reviewResult.feedback,
    reviewResult.affectedStories,
    reviewResult.affectedReasons
  );
```

---

## Files to Modify

### Phase 0: Bug Fixes

| File | Line | Fix |
|------|------|-----|
| `worker/epic/coordinator.ts` | 2287 | Add `this.completedStoryIndices.clear()` in triggerRevision |
| `worker/epic/git-ops.ts` | 648 | Add `git fetch origin branchName` before worktree creation |
| `worker/epic/executor.ts` | 636 | Add `revisionNumber` to phased completion metadata |
| `worker/epic/executor.ts` | 756 | Fail story if no commits (throw error) |
| `worker/epic/coordination-client.ts` | 545 | Change `>=` to `===` in revision filter |

### Phase 1-9: Selective Revision Feature

| File | Changes |
|------|---------|
| `worker/epic/inline-reviewer.ts` | Extend interface, update prompt, add AFFECTED_STORIES parsing |
| `worker/epic/coordinator.ts` | Update `triggerRevision()` signature, add `computeAffectedStoryClosure()` |
| `worker/epic/coordination-client.ts` | Add `archiveStoryClaims()` method |
| `api/src/routes/coordination.ts` | Add `/archive-claims` endpoint |

## Execution Order

1. Phase 1 (types) - independent
2. Phase 5 (API endpoint) - independent
3. Phase 6 (coordination client) - after Phase 5
4. Phases 2-4 (inline reviewer) - after Phase 1
5. Phases 7-9 (coordinator) - after all above

## Verification

1. **Unit test** `computeAffectedStoryClosure()` with dependency graphs
2. **Integration test**: Complete Epic, trigger revision with AFFECTED_STORIES, verify only specified stories re-run
3. **E2E test**: Full workflow where Tech Lead finds specific issues, verify selective revision

## Example Scenario

```
Stories: 0 → 1 → 2 → 3 → 4  (linear chain)
Tech Lead: "Story 2 missing Husky hooks"
AFFECTED_STORIES: [2]

Computed closure: {2, 3, 4} (2 + downstream dependents)
Result: Only stories 2, 3, 4 re-execute (not 0, 1)
```

---

## Related Issues to Address

### Issue 1: Story Complete Without Branch (Critical)

**Problem:** A story can be marked complete but have no branch pushed if it had zero commits. This causes the story to be missing from the consolidated PR.

**Impact:** PR doesn't contain all work. User thinks all stories are done but PR is incomplete.

**Fix Options:**

A. **Fail the story if no commits** - If a story produces zero changes, it's likely a bug or incomplete implementation.
```typescript
// executor.ts - After execution completes
if (!hasCommits) {
  throw new Error(`Story ${storyIndex} completed but produced no commits`);
}
```

B. **Record "no-change" stories explicitly** - Track stories that intentionally had no changes (validation/analysis only).
```typescript
// Store in coordination feed
await this.coordination.postMessage("story_no_changes", {
  storyIndex,
  reason: "Analysis-only story, no code changes required"
});
```

C. **Include no-change stories in PR description** - During consolidation, note which stories had no changes.

**Recommendation:** Option A for now - stories without commits should fail. A story that produces no changes is suspicious.

### Issue 2: Push Failure Not Fatal

**Problem:** If branch push fails (network/auth), the story is still marked complete.

**Location:** `executor.ts:756-760`

**Fix:** Make push failure fatal, or retry with backoff.

### Issue 4: Missing Fetch Before Worktree Creation (CRITICAL)

**Problem:** When creating a worktree for revision, the code only fetches `origin/main` (line 595), NOT story branches. The worktree creation checks if branch exists but doesn't sync it from remote:

```typescript
// git-ops.ts line 595 - ONLY fetches main!
await this.git.fetch(["origin", this.mainBranch]);

// ... later at line 650, checks if branch exists
const branchExists = branches.all.includes(branchName) ||
                     branches.all.includes(`remotes/origin/${branchName}`);

// line 657 - creates worktree but with STALE local branch
execSync(`git worktree add "${worktreePath}" "${branchName}"`, ...);
```

**Result:**
- If branch exists locally but is stale → Worktree has OLD commits, missing agent's previous work
- If branch only on remote and not fetched → Creates NEW branch from main, ALL previous work LOST
- Agent's `git diff` shows incomplete changes
- Agent redoes work they already did

**Fix:** Fetch the specific branch before creating worktree:
```typescript
if (branchExists) {
  // CRITICAL: Sync remote branch before creating worktree
  if (branches.all.includes(`remotes/origin/${branchName}`)) {
    try {
      console.log(`[GitOps] Fetching latest from origin/${branchName}...`);
      await this.git.fetch(["origin", branchName]);
    } catch (e) {
      console.log(`[GitOps] Could not fetch origin/${branchName}:`, e);
    }
  }

  console.log(`[GitOps] Branch ${branchName} exists, creating worktree from it...`);
  execSync(`git worktree add "${worktreePath}" "${branchName}"`, ...);
}
```

**Location:** `git-ops.ts:648-667`

### Issue 3: Context Limit Bug (Fixed)

**Problem:** API returned oldest 100 contexts by default, causing recent story completions to be truncated.

**Fix:** Changed default limit from 100 to 1000 in `api/src/routes/coordination.ts:754`.

**Status:** ✅ Fixed (staged, not committed)

---

## Implementation Priority

### Phase 0: Critical Bug Fixes (Must Do First)

| Priority | Issue | Fix | File |
|----------|-------|-----|------|
| 0a | completedStoryIndices not cleared | Add `this.completedStoryIndices.clear()` in triggerRevision | coordinator.ts:2287 |
| 0b | Missing fetch before worktree | Add `git fetch origin branchName` before worktree | git-ops.ts:648 |
| 0c | Phased execution missing revisionNumber | Add `revisionNumber` to completion metadata | executor.ts:636 |
| 0d | Filter uses >= instead of === | Change to `completionRevision === currentRevision` | coordination-client.ts:545 |
| 0e | Story complete without branch | Fail story if no commits pushed | executor.ts:756 |

~~Issue #6 (Feedback never reaches agent)~~ - Verified as false positive, config is shared by reference.

### Phase 1-9: Selective Revision Feature (After Bugs Fixed)

1. **Phases 1-4:** Inline reviewer changes (prompt + parsing)
2. **Phase 5-6:** API endpoint + coordination client
3. **Phases 7-9:** Coordinator selective revision logic

---

## What's Already Implemented vs New

| Feature | Status | Location |
|---------|--------|----------|
| Revision counter | ✅ Exists | `coordinator.ts:54` |
| Feedback injection | ✅ Exists | `coordinator.ts:1790`, `executor.ts:959-979` |
| Completion revision tracking | ✅ Exists | `coordination-client.ts:533-547` |
| Story dependencies | ✅ Exists | `types.ts:60`, planning agent output |
| Dependency enforcement | ✅ Exists | `coordinator.ts:1040-1050` |
| Branch reuse on revision | ✅ Exists | `git-ops.ts:650-660` |
| **Selective story filtering** | ❌ NEW | This plan |
| **Tech Lead AFFECTED_STORIES output** | ❌ NEW | This plan |
| **Transitive closure computation** | ❌ NEW | This plan |

### Note: No Separate "Critic Agent"

There is **no critic agent** in Epic mode. The Tech Lead reviewer (`InlineReviewer`) runs inline in the same container after all stories complete. It's not a separate worker.

The `critic` label enables **Planner-Critic validation** during planning phase, which is separate from the Tech Lead review cycle.

---

## Revision Flow Verification

### Expected Flow
1. Tech Lead says REVISION_NEEDED
2. Coordinator queues stories with feedback
3. Story assigned to executor
4. **Executor pulls existing branch with previous commits**
5. Agent sees previous work, applies targeted fixes
6. Agent commits and pushes to same branch
7. PR auto-updates (same branch, new commits)

### Current Status

| Step | Status | Issue | Location |
|------|--------|-------|----------|
| 1. Tech Lead triggers revision | ✅ Works | - | `coordinator.ts:1788-1809` |
| 2. Feedback stored | ✅ Works | Config shared by reference, executor sees it | - |
| 3. Stories re-queued | ❌ **BROKEN** | `completedStoryIndices` not cleared | Issue #2 below |
| 4. Completion filtering | ❌ **BROKEN** | Filter uses `>=` instead of `===` | Issue #3 below |
| 5. Worktree from existing branch | ❌ **BROKEN** | Missing fetch, stale commits | Issue #5 below |
| 6. Agent sees feedback | ✅ Works | `config.reviewFeedback` used in prompt (line 960) | - |
| 7. Agent commits and pushes | ✅ Works | - | `pushBranchFromWorktree()` |
| 8. PR auto-updates | ⚠️ **PARTIAL** | May mix revision 0 and 1 branches | Issue #7 below |

### Critical Issues Found (7 Total)

#### Issue #1: Phased Execution Missing revisionNumber
**Location:** `executor.ts:636-647`

Phased execution completions don't include `revisionNumber` metadata:
```typescript
await this.coordination.postCompletion(story.storyIndex, ..., {
  filesModified,
  phasedExecution: true,
  // ❌ MISSING: revisionNumber
});
```
**Impact:** Revision 1 includes revision 0 completions, causing stories to appear "done" when they need re-execution.

#### Issue #2: completedStoryIndices Never Cleared (CRITICAL)
**Location:** `coordinator.ts:2283-2306`

```typescript
private async triggerRevision(feedback: string): Promise<void> {
  this.config.reviewFeedback = feedback;
  // ❌ MISSING: this.completedStoryIndices.clear();
  const stories = await this.coordination.getReadyStories();
  this.revisionStoriesQueued = stories;
}
```
**Impact:** Stories completed in revision 0 stay marked "done". In revision 1, `processRevisionStories()` thinks they're already complete and skips them.

#### Issue #3: getCurrentRevisionCompletions() Filter Wrong
**Location:** `coordination-client.ts:545`

```typescript
return completionRevision >= currentRevision;  // ❌ Should be ===
```
**Impact:** In revision 1, stories without `revisionNumber` (default 0) get excluded even if they need tracking.

#### Issue #4: All-or-Nothing Re-execution
**Location:** `coordinator.ts:2302`

All stories are re-queued, not just ones that need revision. (This is what selective revision fixes.)

#### Issue #5: Missing Fetch Before Worktree (Already Documented)
**Location:** `git-ops.ts:648-667`

Worktree created from stale local branch, agent loses previous work.

#### ~~Issue #6: Feedback Never Reaches Agent~~ (FALSE POSITIVE - VERIFIED OK)
**Status:** ✅ **Actually works correctly**

The `config` object is shared by reference between coordinator and executor:
- Coordinator sets `this.config.reviewFeedback = feedback;` (line 2287)
- Executor uses `this.config.reviewFeedback` in prompt (line 960-978)
- Same object reference, so feedback IS visible to agent

#### Issue #7: Mixed-Revision PR
**Location:** `git-ops.ts:1309`

After revision, `createConsolidatedPR()` merges story branches that may be a mix of revision 0 and revision 1 content if selective revision is used.

---

## Decisions (From User)

1. **Stories with no changes = BUG** - If an agent is assigned, it must produce code. No-code stories shouldn't exist.
2. **Validation flag = YES** - Add `"type": "validation"` for explicitly validation-only stories
3. **UI for no-changes = YES** - Show "no changes, task complete" clearly
4. **Branch reuse = YES** - Agents must continue from their existing branch, NOT start from main
