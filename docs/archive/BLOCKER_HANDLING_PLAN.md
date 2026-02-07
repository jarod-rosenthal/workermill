# Fail-Fast Blocker Handling for Local WorkerMill

## Problem Statement

When a story fails in Epic mode (e.g., TypeScript error in OCS-28), the coordinator:
1. Posts a blocker to the coordination feed (informational only)
2. Resets the expert to "idle" after 2 seconds
3. **Continues claiming and executing other stories**
4. No notification is sent to the user
5. No mechanism exists to pause and wait for human guidance

This leads to wasted compute, cascading failures, and poor user experience.

## Solution Overview

Implement two complementary systems:

- **Option B: Human Escalation** - Pause on failure, notify user, wait for guidance (retry/skip/abort)
- **Option C: Auto-Retry** - Classify errors, attempt auto-fix for fixable errors before escalating

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

---

## Implementation Plan

### Phase 1: Error Classification System

**New File: `worker/epic/error-classifier.ts`**

Classify errors into categories to determine if auto-fix is viable:

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

---

### Phase 2: Blocker Manager

**New File: `worker/epic/blocker-manager.ts`**

Centralized blocker detection, escalation, and resolution handling.

**Key Responsibilities:**
1. Check coordination feed for unresolved blockers (`getBlockers()`)
2. Calculate dependent stories that should be blocked
3. Post escalation messages that trigger notifications
4. Wait for user response with timeout
5. Parse user commands (retry:N, skip:N, abort)

**Key Methods:**
```typescript
class BlockerManager {
  async checkForBlockers(): Promise<BlockerInfo | null>
  async escalateBlocker(blocker: BlockerInfo): Promise<void>
  getDependentStories(storyIndex: number, allStories: ReadyStory[]): number[]
  async waitForBlockerResponse(blocker: BlockerInfo, timeoutMs: number): Promise<BlockerResponse | null>
  parseBlockerCommand(content: string): BlockerResponse | null
}
```

---

### Phase 3: Coordinator Integration

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

---

### Phase 4: Executor Auto-Retry Logic

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

---

### Phase 5: Coordination Client Extensions

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

---

### Phase 6: API Notification Endpoint

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

---

### Phase 7: Frontend BlockerAlert

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

---

### Phase 8: Types and Interfaces

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

## Configuration

**Environment Variables:**
```bash
BLOCKER_MAX_AUTO_RETRIES=2              # Max auto-fix attempts per story
BLOCKER_CONTINUE_INDEPENDENT=false      # Continue independent stories on blocker
BLOCKER_AUTO_RETRY_ENABLED=true         # Enable auto-fix for fixable errors
BLOCKER_ESCALATION_TIMEOUT_MS=300000    # 5 min timeout before re-notify
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `worker/epic/error-classifier.ts` | Error pattern matching and classification |
| `worker/epic/blocker-manager.ts` | Blocker detection, escalation, resolution |
| `frontend/src/components/BlockerAlert.tsx` | User-facing blocker UI |

## Files to Modify

| File | Changes |
|------|---------|
| `worker/epic/coordinator.ts` | Add blocker check to loop, pause/resume logic |
| `worker/epic/executor.ts` | Add auto-retry logic, enhanced blocker posting |
| `worker/epic/coordination-client.ts` | Add getBlockers(), postEscalation(), resolveBlocker() |
| `worker/epic/types.ts` | Add error/blocker types |
| `api/src/services/notifications.ts` | Add notifyBlockerDetected() |
| `api/src/routes/coordination.ts` | Handle blocker_detected message type |
| `frontend/src/pages/Dashboard.tsx` | Integrate BlockerAlert component |

---

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

## Verification Plan

1. **Unit Tests:**
   - Error classifier correctly categorizes all error types
   - Blocker manager parses commands correctly
   - Dependent story calculation is accurate

2. **Integration Tests:**
   - Blocker posts trigger notifications
   - Commands from dashboard reach coordinator
   - Retry/skip/abort actions work correctly

3. **Manual E2E Testing:**
   - Trigger a TypeScript error → Verify auto-fix attempt
   - Trigger an auth error → Verify immediate escalation
   - Use dashboard to retry → Verify story re-executes
   - Use dashboard to skip → Verify Epic continues without story
   - Use dashboard to abort → Verify Epic terminates cleanly

---

## Implementation Order

1. **Phase 1**: Error classifier (foundation, no dependencies)
2. **Phase 8**: Types (needed by subsequent phases)
3. **Phase 5**: Coordination client extensions (API layer)
4. **Phase 6**: API notification endpoint
5. **Phase 2**: Blocker manager (depends on 1, 5, 8)
6. **Phase 4**: Executor auto-retry (depends on 1, 2)
7. **Phase 3**: Coordinator integration (depends on 2, 4)
8. **Phase 7**: Frontend BlockerAlert (can be parallel with 3-6)
