# Epic Mode Resilience System: Checkpoint/Recovery + Blocker Handling

## Implementation Status

**Status: ✅ IMPLEMENTATION COMPLETE** (2026-02-04)

All code changes have been implemented and deployed to local WorkerMill. The system is ready for verification testing.

### Completed Work

| Component | Status | Files |
|-----------|--------|-------|
| Resilience settings in Organization model | ✅ Complete | `Organization.ts`, `1706688000019-AddResilienceSettings.ts` |
| Error/blocker types | ✅ Complete | `worker/epic/types.ts` |
| Error classifier | ✅ Complete | `worker/epic/error-classifier.ts` (NEW) |
| Blocker manager | ✅ Complete | `worker/epic/blocker-manager.ts` (NEW) |
| Incremental push after commits | ✅ Complete | `executor.ts`, `git-ops.ts` |
| Story-level resume | ✅ Complete | `coordinator.ts`, `orchestrator.ts`, `control-center.ts` |
| Blocker check + dependency blocking | ✅ Complete | `coordinator.ts` |
| Auto-retry logic | ✅ Complete | `executor.ts` |
| Graceful shutdown (SIGTERM) | ✅ Complete | `index.ts`, `coordinator.ts` |
| Coordination client extensions | ✅ Complete | `coordination-client.ts` |
| API blocker-response endpoint | ✅ Complete | `coordination.ts` |
| Settings UI (Resilience section) | ✅ Complete | `Settings.tsx` |
| BlockerAlert component | ✅ Complete | `BlockerAlert.tsx` (NEW), `Dashboard.tsx` |
| Coordination feed message types | ✅ Complete | `coordination-store.ts`, `CoordinationFeed.tsx` |
| Mutex groups for parallel conflict prevention | ✅ Complete | `coordinator.ts`, `orchestrator-v2.ts`, `types.ts`, `coordination-client.ts` |

### What Remains: Verification Testing

The following tests should be run to verify the implementation:

- [ ] **Test 1: Incremental Push After Commit** - Verify commits are pushed after each agent commit
- [ ] **Test 2: Story-Level Resume** - Verify completed stories are skipped on restart
- [ ] **Test 3: Dependency Blocking** - Verify dependent stories are blocked when dependency fails
- [ ] **Test 4: Auto-Retry (3 attempts)** - Verify auto-fix attempts for fixable errors
- [ ] **Test 5: Human Escalation** - Verify BlockerAlert appears and actions work
- [ ] **Test 6: Graceful Shutdown** - Verify SIGTERM saves work properly
- [ ] **Test 7: Settings UI** - Verify settings persist and are used by worker
- [ ] **Test 8: Mutex Groups** - Verify stories targeting same directory run sequentially, not in parallel

### Local Deployment Verified

```
PostgreSQL:    running (localhost:5433)
API:           running (http://localhost:3001)
Frontend:      running (http://localhost:5173)

Resilience Settings (API verified):
  blockerMaxAutoRetries: 3
  blockerAutoRetryEnabled: true
  pushAfterCommit: true
  gracefulShutdownEnabled: true
```

---

## Overview

This plan unifies two complementary resilience systems for Epic mode:

| Failure Type | System | Handles |
|--------------|--------|---------|
| **Container Death** | Checkpoint/Recovery | OOM, Spot interruption, API restart, timeout |
| **Story Failure** | Blocker Handling | TypeScript errors, test failures, build errors |

Both systems must work together to provide a robust Epic execution that can survive crashes AND handle execution errors gracefully.

---

# Part 1: Checkpoint & Recovery System

## Problem Statement

When a WorkerMill Epic container dies mid-execution (API restart, Spot interruption, OOM, timeout), work is lost because:

1. **Commits only pushed at story END** - 30+ minutes of work at risk
2. **Resume logic exists but isn't integrated** - checkpoint library unused
3. **No skip logic for completed stories** - restarts redo everything
4. **No resume API** - can't manually trigger recovery

## Current State Analysis

### What IS Persisted (Safe)

| Layer | Storage | Survives Death? |
|-------|---------|-----------------|
| Story completions | PostgreSQL (WorkerContext) | ✅ Yes |
| Execution plan | PostgreSQL (WorkerTask.executionPlanV2) | ✅ Yes |
| Pushed branches | Git remote | ✅ Yes |
| S3 checkpoint | S3 bucket | ✅ Yes (but unused) |

### What is NOT Persisted (At Risk)

| Layer | Storage | Survives Death? |
|-------|---------|-----------------|
| Uncommitted files | Container filesystem | ❌ No |
| Local commits | Worktree .git/ | ❌ No |
| Claude context | Container memory | ❌ No |
| Phased checkpoints | Local until squash | ❌ No |

### The Danger Window

```
T+0   ─── Branch created locally
      ⚠️ DANGER WINDOW OPENS

T+1   ─── Agent starts executing
      ⚠️ Files being modified, not committed

T+30  ─── Agent completes, executor commits
      ⚠️ DANGER PEAK: All commits still local-only

T+31  ─── Push to remote
      ✅ DANGER WINDOW CLOSES

T+32  ─── Post completion to DB
      ✅ SAFE: Work recorded
```

## Proposed Solution: 4-Layer Recovery System

### Layer 1: Incremental Push Safety (Reduce Danger Window)

**Goal:** Push to remote more frequently, not just at story end.

**Changes:**
- `worker/epic/executor.ts`: Add periodic push during agent execution
- `worker/epic/git-ops.ts`: Add `pushIfCommitsExist()` helper
- Push after: branch creation, each agent commit, before completion

**Benefit:** Reduces danger window from 30 minutes to ~5 minutes max.

### Layer 2: Story-Level Resume (Skip Completed Stories)

**Goal:** On restart, skip stories that already completed.

**Changes:**
- `worker/epic/coordinator.ts`: On startup, query existing completions from DB
- `api/src/services/orchestrator.ts`: On retry, preserve executionPlanV2 (don't re-plan)
- `api/src/routes/control-center.ts`: Add resume endpoint

**Benefit:** Completed stories (pushed + completion posted) are never redone.

### Layer 3: Branch-Level Resume (Detect Partial Work)

**Goal:** If branch exists on remote but no completion posted, resume from it.

**Changes:**
- `worker/epic/coordinator.ts`: Check remote for story branches on startup
- `worker/epic/git-ops.ts`: `listRemoteStoryBranches()` helper
- If branch exists but no completion: clone branch, continue from last commit

**Benefit:** Partially completed stories resume from last push.

### Layer 4: Graceful Shutdown (Maximize Recovery Data)

**Goal:** When container is dying, save maximum state.

**Changes:**
- `worker/epic/index.ts`: Add SIGTERM handler
- Push any uncommitted work before exit
- Post "interrupted" status to coordination feed

**Benefit:** Even mid-story crashes preserve as much as possible.

## Checkpoint Implementation Plan

### Checkpoint Phase 1: Incremental Push Safety

**Files to modify:**
- `worker/epic/executor.ts`
- `worker/epic/git-ops.ts`

**Changes:**

1. Add `pushBranchIfCommitsExist()` to git-ops.ts:
```typescript
async pushBranchIfCommitsExist(worktreePath: string, branchName: string): Promise<boolean> {
  const hasCommits = await this.hasCommitsAheadOfMainInWorktree(worktreePath);
  if (hasCommits) {
    await this.pushBranchFromWorktree(worktreePath, branchName);
    return true;
  }
  return false;
}
```

2. In executor.ts `executeStory()`, add push after branch creation:
```typescript
// After createStoryBranch (line ~484):
await this.postLog(`Pushed initial branch to remote (checkpoint)`, expert, "system");
await this.gitOps.pushBranchFromWorktree(worktreePath, branchName);
```

3. Add periodic push during agent execution (every 5 minutes or after each tool use that modifies files)

### Checkpoint Phase 2: Story-Level Resume

**Files to modify:**
- `worker/epic/coordinator.ts`
- `api/src/services/orchestrator.ts`
- `api/src/routes/control-center.ts`

**Changes:**

1. In coordinator.ts, on startup check for existing completions:
```typescript
async initializeWithResume(): Promise<void> {
  // Query completions from coordination API
  const completions = await this.coordination.getCurrentRevisionCompletions();
  this.completedStoryIndices = new Set(
    completions.map(c => c.metadata?.storyIndex as number)
  );
  console.log(`[Epic] Found ${this.completedStoryIndices.size} already-completed stories`);
}
```

2. In orchestrator.ts, on retry preserve plan:
```typescript
// When retrying a failed task:
if (task.retryCount > 0 && task.executionPlanV2) {
  // Skip planning, use existing plan
  task.status = "queued";
  // Don't call runLocalPlanningAgent()
}
```

3. Add resume endpoint to control-center.ts:
```typescript
POST /api/control-center/tasks/:taskId/resume
// Sets status to "queued", preserves executionPlanV2, spawns new container
```

### Checkpoint Phase 3: Branch-Level Resume

**Files to modify:**
- `worker/epic/coordinator.ts`
- `worker/epic/git-ops.ts`

**Changes:**

1. Add `listRemoteStoryBranches()` to git-ops.ts:
```typescript
async listRemoteStoryBranches(jiraKey: string): Promise<string[]> {
  const output = await this.git("branch", "-r", "--list", `origin/story/${jiraKey}-*`);
  return output.split('\n').map(b => b.trim().replace('origin/', ''));
}
```

2. In coordinator startup, check for partial branches:
```typescript
async checkForPartialWork(): Promise<Map<number, string>> {
  const remoteBranches = await this.gitOps.listRemoteStoryBranches(this.config.jiraKey);
  const partialWork = new Map<number, string>();

  for (const branch of remoteBranches) {
    const storyIndex = extractStoryIndexFromBranch(branch);
    if (!this.completedStoryIndices.has(storyIndex)) {
      // Branch exists but not completed - this is partial work
      partialWork.set(storyIndex, branch);
    }
  }
  return partialWork;
}
```

3. When starting a story with partial work, clone from existing branch instead of creating new.

### Checkpoint Phase 4: Graceful Shutdown

**Files to modify:**
- `worker/epic/index.ts`
- `worker/epic/coordinator.ts`

**Changes:**

1. Add SIGTERM handler to index.ts:
```typescript
process.on('SIGTERM', async () => {
  console.log('[Epic] Received SIGTERM, initiating graceful shutdown');
  await coordinator.gracefulShutdown();
  process.exit(0);
});
```

2. Implement gracefulShutdown in coordinator.ts:
```typescript
async gracefulShutdown(): Promise<void> {
  this.missionActive = false;

  // For each running story, commit and push any uncommitted work
  for (const [storyIndex, worktreePath] of this.activeWorktrees) {
    try {
      await this.gitOps.commitUncommittedWork(worktreePath, "WIP: Interrupted");
      await this.gitOps.pushBranchFromWorktree(worktreePath, this.getStoryBranch(storyIndex));
    } catch (e) {
      console.log(`[Epic] Failed to save story ${storyIndex}: ${e}`);
    }
  }

  // Post interrupted status
  await this.postLog("Container shutting down - work saved to remote branches", "system");
}
```

## Existing Code to Reuse

| Function | Location | Purpose |
|----------|----------|---------|
| `getCurrentRevisionCompletions()` | coordination-client.ts:512 | Get completed stories |
| `pushBranchFromWorktree()` | git-ops.ts | Push branch |
| `hasCommitsAheadOfMainInWorktree()` | git-ops.ts | Check for commits |
| `getModifiedFilesInWorktree()` | git-ops.ts | Find uncommitted files |
| `commitChangesInWorktree()` | git-ops.ts | Commit files |

---

# Part 2: Blocker Handling System

## Problem Statement

When a story fails in Epic mode (e.g., TypeScript error in OCS-28), the coordinator:
1. Posts a blocker to the coordination feed (informational only)
2. Resets the expert to "idle" after 2 seconds
3. **Continues claiming and executing other stories**
4. No notification is sent to the user
5. No mechanism exists to pause and wait for human guidance

This leads to wasted compute, cascading failures, and poor user experience.

## Solution Overview

Implement two complementary subsystems:

- **Human Escalation** - Pause on failure, notify user, wait for guidance (retry/skip/abort)
- **Auto-Retry** - Classify errors, attempt auto-fix for fixable errors before escalating

```
Story Fails → Classify Error → Fixable?
                                  ├─ Yes → Auto-Fix (max 2 retries)
                                  │           └─ Still failing → Escalate
                                  └─ No → Escalate immediately

Escalate → Pause Coordinator → Notify (Email/Slack/SSE) → Wait for User
                                                              ├─ Retry → Re-execute story
                                                              ├─ Skip → Continue without story
                                                              └─ Abort → Stop Epic
```

## Blocker Phase 1: Error Classification System

**New File: `worker/epic/error-classifier.ts`**

| Category | Pattern Examples | Fixable? |
|----------|------------------|----------|
| `typescript` | `error TS\d+:`, `Cannot find module` | Yes |
| `lint` | `eslint.*error`, `prettier.*error` | Yes |
| `test` | `FAIL.*\.test\.`, `AssertionError` | Yes |
| `build` | `Build failed`, `Module not found` | Yes |
| `auth` | `401`, `403`, `Permission denied` | No |
| `network` | `ECONNREFUSED`, `ETIMEDOUT` | No |
| `resource` | `ENOMEM`, `ENOSPC`, `heap out of memory` | No |
| `unknown` | (default) | No |

**Key Functions:**
```typescript
function classifyError(errorOutput: string, command?: string, exitCode?: number): ClassifiedError
function isFixableCategory(category: ErrorCategory): boolean
function extractAffectedFiles(errorOutput: string, category: ErrorCategory): string[]
function generateFixPrompt(error: ClassifiedError, previousAttempts: string[]): string
```

## Blocker Phase 2: Blocker Manager

**New File: `worker/epic/blocker-manager.ts`**

Centralized blocker detection, escalation, and resolution handling.

**Key Responsibilities:**
1. Check coordination feed for unresolved blockers (`getBlockers()`)
2. Calculate dependent stories that should be blocked
3. Post escalation messages that trigger notifications
4. Wait for user response with timeout
5. Parse user commands (retry:N, skip:N, abort)

```typescript
class BlockerManager {
  async checkForBlockers(): Promise<BlockerInfo | null>
  async escalateBlocker(blocker: BlockerInfo): Promise<void>
  getDependentStories(storyIndex: number, allStories: ReadyStory[]): number[]
  async waitForBlockerResponse(blocker: BlockerInfo, timeoutMs: number): Promise<BlockerResponse | null>
  parseBlockerCommand(content: string): BlockerResponse | null
}
```

## Blocker Phase 3: Coordinator Integration

**Modify: `worker/epic/coordinator.ts`**

**New Properties:**
```typescript
private blockerManager: BlockerManager;
private blockerState: CoordinatorBlockerState;
private blockerConfig: BlockerConfig;
```

**Modified `coordinationLoop()` - Add blocker check at start:**
```typescript
private async coordinationLoop(): Promise<void> {
  await this.pollForCommands();

  // NEW: Check for blockers before processing more stories
  const shouldPause = await this.checkAndHandleBlockers();
  if (shouldPause) {
    return; // Skip this iteration, stay paused
  }

  this.coordination.startIteration();
  // ... rest of existing logic
}
```

**New Methods:**
- `checkAndHandleBlockers()` - Query for unresolved blockers, pause if found
- `pauseForBlocker(blocker)` - Enter wait state, poll for user response
- `resumeFromBlocker(response)` - Handle retry/skip/abort
- `markDependentsBlocked(storyIndex)` - Track blocked stories
- `unblockStories(storyIndex)` - Clear blocked state after resolution

## Blocker Phase 4: Executor Auto-Retry Logic

**Modify: `worker/epic/executor.ts`**

**New Properties:**
```typescript
private retryTracker: Map<string, number>; // storyId -> retry count
private maxAutoRetries: number = 2;
```

**Modified `executeStory()` catch block:**
```typescript
catch (error) {
  const classified = classifyError(errorMessage);

  if (classified.isFixable && this.getRetryCount(story.id) < this.maxAutoRetries) {
    // Attempt auto-fix
    const fixed = await this.attemptAutoFix(story, expert, classified, worktreePath);
    if (fixed) {
      // Retry execution
      return this.executeStory(story, expert, totalStories, userFeedback);
    }
  }

  // Not fixable or retries exhausted - escalate
  await this.postBlockerWithContext(story, expert, classified);
  storyResult.error = errorMessage;
}
```

**New Methods:**
- `attemptAutoFix(story, expert, error, worktreePath)` - Spawn AI with fix prompt
- `buildFixPrompt(story, error, previousAttempts)` - Context-rich prompt for fixing
- `postBlockerWithContext(story, expert, error)` - Enhanced blocker with classification

## Blocker Phase 5: Coordination Client Extensions

**Modify: `worker/epic/coordination-client.ts`**

**New Methods:**
```typescript
async getBlockers(): Promise<ContextMessage[]> {
  // Filter for messageType === "blocker" that are unresolved
}

async postEscalation(
  storyIndex: number,
  storyTitle: string,
  error: ClassifiedError,
  persona: string,
  dependentStories: number[]
): Promise<ContextMessage> {
  // Post "blocker_detected" message type (triggers notifications)
}

async resolveBlocker(blockerId: string, action: BlockerAction, guidance?: string): Promise<void> {
  // Post "blocker_resolved" message
}
```

## Blocker Phase 6: API Notification Endpoint

**Modify: `api/src/services/notifications.ts`**

**New Function:**
```typescript
export async function notifyBlockerDetected(
  task: WorkerTask,
  blocker: {
    storyIndex: number;
    storyTitle: string;
    errorCategory: string;
    errorMessage: string;
    affectedFiles: string[];
    dependentStories: number[];
  }
): Promise<void> {
  // 1. Send Slack notification (if webhook configured)
  // 2. Send email to org members (if enabled)
  // 3. SSE already handled by coordination feed
}
```

**Modify: `api/src/routes/coordination.ts`**

Handle `blocker_detected` message type specially:
```typescript
if (messageType === "blocker_detected") {
  // Trigger notifications
  await notifyBlockerDetected(task, metadata);
}
```

## Blocker Phase 7: Frontend BlockerAlert

**New Component: `frontend/src/components/BlockerAlert.tsx`**

Prominent alert banner shown when a blocker is detected:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️ BLOCKER: Story 1 Failed                                      │
├─────────────────────────────────────────────────────────────────┤
│ Error Type: TypeScript                                          │
│ Message: No inputs were found in tsconfig.json                  │
│ Files: api/tsconfig.json                                        │
│                                                                 │
│ Blocked Stories: S2, S3 (depend on S1)                          │
│                                                                 │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ Send guidance to worker (optional):                       │   │
│ │ [________________________________________________]       │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│ [🔄 Retry Story 1]  [⏭️ Skip Story 1]  [🛑 Abort Epic]          │
└─────────────────────────────────────────────────────────────────┘
```

**Integration Points:**
- Show in `Dashboard.tsx` task detail when blocker detected
- Show in `CoordinationFeed.tsx` with special styling
- Actions call existing Talk to Worker infrastructure

## Blocker Phase 8: Types and Interfaces

**Modify: `worker/epic/types.ts`**

```typescript
// Error classification
export type ErrorCategory = "typescript" | "lint" | "test" | "build" | "auth" | "network" | "resource" | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  isFixable: boolean;
  originalError: string;
  suggestedFix?: string;
  affectedFiles?: string[];
}

export interface BlockerInfo {
  storyIndex: number;
  storyTitle: string;
  error: ClassifiedError;
  persona: ExpertPersona;
  retryCount: number;
  maxRetries: number;
  dependentStories: number[];
  timestamp: string;
}

export type BlockerAction = "retry" | "skip" | "abort";

export interface BlockerResponse {
  action: BlockerAction;
  storyIndex?: number;
  guidance?: string;
}

// Add to ContextMessageType
export type ContextMessageType = ... | "blocker_detected" | "blocker_resolved";
```

---

# Part 3: Unified Implementation Plan

## Combined Priority Order

| Priority | Phase | System | Impact | Risk |
|----------|-------|--------|--------|------|
| 1 | **Checkpoint Phase 2** | Recovery | Highest - skip completed stories | Low |
| 2 | **Checkpoint Phase 1** | Recovery | High - reduce danger window | Low |
| 3 | **Blocker Phase 1-2** | Blocker | High - error classification + manager | Medium |
| 4 | **Checkpoint Phase 4** | Recovery | Medium - graceful shutdown | Low |
| 5 | **Blocker Phase 3-4** | Blocker | Medium - coordinator + executor | Medium |
| 6 | **Blocker Phase 5-7** | Blocker | Medium - API + frontend | Medium |
| 7 | **Checkpoint Phase 3** | Recovery | Lower - branch resume edge cases | High |

## All Files to Modify/Create

### New Files
| File | Purpose |
|------|---------|
| `worker/epic/error-classifier.ts` | Error pattern matching and classification |
| `worker/epic/blocker-manager.ts` | Blocker detection, escalation, resolution |
| `frontend/src/components/BlockerAlert.tsx` | User-facing blocker UI |

### Modified Files
| File | Changes |
|------|---------|
| `worker/epic/executor.ts` | Incremental pushes + auto-retry logic |
| `worker/epic/git-ops.ts` | Helper methods for push/branch detection |
| `worker/epic/coordinator.ts` | Resume detection + blocker check + graceful shutdown |
| `worker/epic/coordination-client.ts` | Blocker methods |
| `worker/epic/index.ts` | SIGTERM handler |
| `worker/epic/types.ts` | Error/blocker types |
| `api/src/services/orchestrator.ts` | Skip planning on retry |
| `api/src/services/notifications.ts` | notifyBlockerDetected() |
| `api/src/routes/control-center.ts` | Resume endpoint |
| `api/src/routes/coordination.ts` | Handle blocker_detected message type |
| `frontend/src/pages/Dashboard.tsx` | Integrate BlockerAlert |

## Configuration (Exposed in Settings UI)

All settings exposed in Settings > Resilience menu (not hardcoded):

| Setting | Default | Description |
|---------|---------|-------------|
| `blockerMaxAutoRetries` | 3 | Max auto-fix attempts before human escalation |
| `blockerAutoRetryEnabled` | true | Enable auto-fix for fixable errors |
| `pushAfterCommit` | true | Push to remote after each commit |
| `gracefulShutdownEnabled` | true | Save work on SIGTERM |

### Key Behaviors (User-Specified)

1. **Push after each commit** - Not time-based (5 min intervals), push immediately after each agent commit
2. **Hard stop on dependency failure** - If a dependency fails, do NOT launch dependent stories. They remain blocked.
3. **3 auto-retry attempts** - System tries to fix fixable errors 3 times before escalating
4. **Human escalation** - After 3 failed retries, escalate and WAIT for human assistance
5. **No new stories while blocked** - System must NOT launch new stories that depend on a blocked story

## Verification Plan

### Checkpoint/Recovery Tests
1. **Incremental Push**: Start task with long story → Kill container → Verify branch exists on remote
2. **Story Resume**: Complete 3/10 stories → Kill → Resume → Verify stories 1-3 skipped
3. **Graceful Shutdown**: Send SIGTERM → Verify uncommitted work pushed

### Blocker Handling Tests
1. **Error Classification**: Trigger TypeScript error → Verify auto-fix attempt
2. **Immediate Escalation**: Trigger auth error → Verify immediate escalation
3. **Dashboard Retry**: Use dashboard to retry → Verify story re-executes
4. **Dashboard Skip**: Use dashboard to skip → Verify Epic continues
5. **Dashboard Abort**: Use dashboard to abort → Verify Epic terminates

## User Interaction Flow

1. **Story fails** → Error classified → Auto-fix attempted (if fixable)
2. **Auto-fix fails or error not fixable** → Blocker posted with `blocker_detected` type
3. **Coordinator sees blocker** → Pauses, marks dependent stories blocked
4. **Notifications sent** → Email, Slack (if configured), SSE to dashboard
5. **Dashboard shows BlockerAlert** → User sees error details, affected stories
6. **User responds**:
   - **Retry**: `POST /api/coordination/commands { type: "resume", content: "retry:1" }`
   - **Skip**: `POST /api/coordination/commands { type: "resume", content: "skip:1" }`
   - **Abort**: `POST /api/coordination/commands { type: "resume", content: "abort" }`
   - **Guidance**: `POST /api/coordination/commands { type: "message", content: "Try..." }`
7. **Coordinator receives command** → Processes action, resumes or terminates

---

## Decisions Made

1. **Implement all phases** - Full resilience system
2. **Push after each commit** - Not time-based, immediate after each agent commit
3. **3 retry attempts** - Auto-fix 3 times before escalating to human
4. **Hard stop on blocked dependencies** - Do NOT launch dependent stories while parent is blocked
5. **All settings in UI** - No hardcoded values, expose in Settings > Resilience menu

## Implementation Tasks

| # | Task | Status |
|---|------|--------|
| 1 | Add resilience settings to Organization model (migration) | ✅ Complete |
| 2 | Create error-classifier.ts for error pattern matching | ✅ Complete |
| 3 | Create blocker-manager.ts for blocker handling | ✅ Complete |
| 4 | Add incremental push after commits in executor | ✅ Complete |
| 5 | Add story-level resume to coordinator | ✅ Complete |
| 6 | Add blocker check and dependency blocking to coordinator | ✅ Complete |
| 7 | Add auto-retry logic to executor | ✅ Complete |
| 8 | Add graceful shutdown with SIGTERM handler | ✅ Complete |
| 9 | Add blocker notification and coordination client extensions | ✅ Complete |
| 10 | Add resilience settings to Settings UI | ✅ Complete |
| 11 | Create BlockerAlert frontend component | ✅ Complete |
| 12 | Add error and blocker types to worker/epic/types.ts | ✅ Complete |

---

## Files Changed Summary

### New Files Created
| File | Purpose |
|------|---------|
| `api/src/db/migrations/1706688000019-AddResilienceSettings.ts` | Database migration for resilience columns |
| `worker/epic/error-classifier.ts` | Error pattern matching (typescript, lint, test, build, auth, network, resource) |
| `worker/epic/blocker-manager.ts` | Blocker detection, escalation, dependency tracking |
| `frontend/src/components/BlockerAlert.tsx` | UI component for blocker display and user actions |

### Modified Files
| File | Changes |
|------|---------|
| `api/src/models/Organization.ts` | Added 4 resilience setting columns |
| `api/src/db/connection.ts` | Registered new migration |
| `api/src/routes/settings.ts` | Exposed resilience settings in GET/PUT |
| `api/src/routes/control-center.ts` | Added POST `/tasks/:taskId/resume` endpoint |
| `api/src/routes/coordination.ts` | Added POST `/blocker-response` endpoint |
| `api/src/services/orchestrator.ts` | Skip planning on retry if executionPlanV2 exists |
| `worker/epic/types.ts` | Added ErrorClassification, BlockerInfo, ResilienceConfig types |
| `worker/epic/executor.ts` | Incremental push, auto-retry logic with error classification |
| `worker/epic/git-ops.ts` | Added `pushBranchIfCommitsExist()`, `commitUncommittedWork()` |
| `worker/epic/coordinator.ts` | Resume detection, blocker check, dependency blocking, graceful shutdown |
| `worker/epic/coordination-client.ts` | Extended `postBlocker()` with metadata parameter |
| `worker/epic/index.ts` | Added SIGTERM handler for graceful shutdown |
| `frontend/src/pages/Settings.tsx` | Added Epic Mode Resilience settings section |
| `frontend/src/pages/Dashboard.tsx` | Integrated BlockerAlert component |
| `frontend/src/store/coordination-store.ts` | Added blocker_detected, blocker_resolved message types |
| `frontend/src/components/CoordinationFeed.tsx` | Added blocker message type display config |
