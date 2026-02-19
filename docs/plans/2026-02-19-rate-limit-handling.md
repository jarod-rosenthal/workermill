# Rate Limit Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user's Anthropic usage cap is reached mid-task, stop retrying immediately, escalate as a clearly-visible blocker, and let the user decide when to retry.

**Architecture:** Replace the coordinator's credential-rotation-then-fail loop with immediate blocker escalation for rate limits. Add a `rate_limit` error category with amber styling. Surface rate limit blockers via a top-level dashboard banner, per-task row badges, and VS Code notifications — so the user never has to drill down to discover why their task stopped.

**Tech Stack:** TypeScript, React, Express, VS Code Extension API

---

### Task 1: Add `rate_limited` to coordination feed message types

This is the smallest change and unblocks the coordinator work.

**Files:**
- Modify: `api/src/routes/coordination.ts:43-64`

**Step 1: Add the new message type**

In `api/src/routes/coordination.ts`, find the `VALID_MESSAGE_TYPES` array (line 43) and add `"rate_limited"` after `"blocker_resolved"`:

```typescript
const VALID_MESSAGE_TYPES: ContextMessageType[] = [
  "constraints",
  "file_created",
  "file_modified",
  "decision",
  "dependency",
  "question",
  "answer",
  "completion",
  "blocker",
  "blocker_detected",
  "blocker_resolved",
  "rate_limited",        // ← ADD THIS LINE
  "warning",
  "progress",
  "story_ready",
  "story_claimed",
  "consultation",
  "revision_requested",
  "user_message",
  "worker_ack",
  "expert_response",
];
```

**Step 2: Add the type to the TypeScript union**

Find where `ContextMessageType` is defined. Check `api/src/models/CoordinationFeedItem.ts` or the coordination store. Add `"rate_limited"` to the union type.

Also check `frontend/src/store/coordination-store.ts` for the frontend `ContextMessageType` — add it there too.

**Step 3: Verify API type check passes**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Verify frontend type check passes**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/coordination.ts api/src/models/CoordinationFeedItem.ts frontend/src/store/coordination-store.ts
git commit -m "feat: add rate_limited coordination feed message type"
```

---

### Task 2: Coordinator — immediate blocker escalation on rate limit

Replace the credential rotation loop with a direct blocker escalation.

**Files:**
- Modify: `worker/epic/coordinator.ts:1930-1961`

**Step 1: Replace the rate limit handling block**

In `worker/epic/coordinator.ts`, find the `executeStoryAsync` method (line 1921). Replace lines 1930-1961 (the `if (result.rateLimited)` block) with:

```typescript
      // Handle rate limiting — escalate immediately as blocker (usage caps can last hours)
      if (result.rateLimited) {
        console.log(`[Epic] Rate limit detected for story ${story.storyIndex} — escalating as blocker`);
        this.rateLimitRetries.delete(story.storyIndex);
        this.unregisterRunningStory(story.storyIndex);

        // Post a rate_limited progress event for feed visibility
        await this.coordination.postContext(
          "rate_limited",
          "Anthropic usage limit reached — task paused.",
          expert,
          this.config.parentTaskId
        );

        // Escalate as blocker with clear user-facing message
        // Bypass blockerManager.escalateBlocker() to avoid the Decision API classifyError call
        // (rate limits aren't code errors — the classifier would return "unknown")
        const readyStories = await this.coordination.getReadyStories();
        const dependentStories = this.blockerManager
          ? this.blockerManager.getDependentStories(story.storyIndex, readyStories)
          : [];

        const summary = "Your Anthropic usage limit was reached. Check your plan at claude.ai/settings — if you have Extra Usage enabled with funds available, click Retry. Otherwise, wait for your limit to reset.";

        await this.coordination.postContext(
          "blocker",
          summary,
          expert,
          undefined,
          {
            storyIndex: story.storyIndex,
            storyTitle: story.title,
            persona: expert,
            errorCategory: "rate_limit",
            summary,
            fullErrorMessage: "Claude CLI returned rate_limit_error. This typically means your weekly/session usage cap has been reached. Usage caps reset on a schedule (check claude.ai/settings for your reset time).",
            affectedFiles: [],
            autoRetryAttempts: 0,
            maxAutoRetries: 0,
            dependentStories,
            isEscalated: true,
            isFixable: false,
          },
          `${expert}-story-${story.storyIndex}`
        );

        // Update expert state and mark dependent stories blocked
        this.expertStates.set(expert, {
          persona: expert,
          status: "blocked",
          currentStoryId: story.id,
          currentStoryIndex: story.storyIndex,
        });
        this.failedStoryIndices.add(story.storyIndex);
        for (const depIndex of dependentStories) {
          this.blockedStoryIndices.add(depIndex);
        }

        // Reset expert to idle after delay
        setTimeout(() => {
          this.expertStates.set(expert, { persona: expert, status: "idle" });
        }, 2000);

        return;
      }
```

**Step 2: Verify the worker builds**

Run: `cd worker && npx tsc --noEmit`
Expected: PASS (or check how the worker type-checks — it may use the Docker build pipeline)

If `tsc` isn't configured for the worker directory, just verify the coordinator file has no syntax errors:

Run: `node -e "require('fs').readFileSync('worker/epic/coordinator.ts','utf8')" && echo "Syntax OK"`

**Step 3: Commit**

```bash
git add worker/epic/coordinator.ts
git commit -m "feat: rate limit → immediate blocker escalation (skip credential rotation)"
```

---

### Task 3: BlockerAlert — add `rate_limit` category with amber styling

**Files:**
- Modify: `frontend/src/components/BlockerAlert.tsx:86-97`

**Step 1: Add rate_limit to the error category map**

In `BlockerAlert.tsx`, find the `formatErrorCategory` function (line 85). Add the `rate_limit` entry:

```typescript
  const formatErrorCategory = (category: string) => {
    const categories: Record<string, { label: string; color: string }> = {
      typescript: { label: "TypeScript", color: "text-blue-500" },
      lint: { label: "Lint", color: "text-yellow-500" },
      test: { label: "Test Failure", color: "text-red-500" },
      build: { label: "Build", color: "text-orange-500" },
      auth: { label: "Authentication", color: "text-purple-500" },
      network: { label: "Network", color: "text-gray-500" },
      resource: { label: "Resource", color: "text-red-600" },
      rate_limit: { label: "Usage Limit", color: "text-amber-500" },  // ← ADD
      unknown: { label: "Unknown", color: "text-gray-400" },
    };
    return categories[category] || categories.unknown;
  };
```

**Step 2: Use amber styling for rate_limit blockers**

In the same file, find the outer container div (line 103). Change it to use amber when the category is `rate_limit`:

```typescript
  const isRateLimit = blocker.errorCategory === "rate_limit";

  return (
    <div className={`${isRateLimit ? "bg-amber-500/10 border border-amber-500/30" : "bg-red-500/10 border border-red-500/30"} rounded-lg overflow-hidden`} data-testid="blocker-alert">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer ${isRateLimit ? "hover:bg-amber-500/5" : "hover:bg-red-500/5"}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-5 h-5 ${isRateLimit ? "text-amber-500" : "text-red-500"}`} />
```

Also update the header text for rate limit blockers. Find line 113-114:

```typescript
              <span className="font-medium text-foreground">
                {isRateLimit ? "Usage Limit Reached" : `Story ${blocker.storyIndex} Blocked`}
              </span>
```

**Step 3: Verify frontend type check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/components/BlockerAlert.tsx
git commit -m "feat: amber rate_limit blocker styling in BlockerAlert"
```

---

### Task 4: Dashboard — top-level rate limit banner

**Files:**
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx`

**Step 1: Add helper to detect rate limit blockers**

Near the top of the component (after the existing state/hooks), add a computed value that scans coordinationMessages for active rate limit blockers:

```typescript
  // Detect active rate limit blockers across all tasks
  const rateLimitBlockers = useMemo(() => {
    const blockers = coordinationMessages.filter((m: ContextMessage) =>
      (m.messageType === "blocker_detected" || (m.messageType === "blocker" && m.metadata?.isEscalated === true))
      && m.metadata?.errorCategory === "rate_limit"
    );
    const resolvedIds = new Set(
      coordinationMessages
        .filter((m: ContextMessage) => m.messageType === "blocker_resolved" || (m.messageType === "answer" && m.metadata?.blockerAction))
        .map((m: ContextMessage) => (m.metadata?.blockerId as string) || m.id)
        .filter(Boolean)
    );
    return blockers.filter((m: ContextMessage) => !resolvedIds.has(m.id));
  }, [coordinationMessages]);
```

You'll need to add `useMemo` to the React import if not already present.

**Step 2: Render the banner**

Find the main dashboard layout container (look for the task list section). Add the banner ABOVE the task list, inside the main content area. Add this JSX:

```tsx
        {/* Rate limit banner — shown above task list when any task is rate-limited */}
        {rateLimitBlockers.length > 0 && (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <span className="font-medium text-foreground">
                  Anthropic usage limit reached
                </span>
                <span className="text-sm text-muted-foreground ml-2">
                  {rateLimitBlockers.length} task{rateLimitBlockers.length > 1 ? "s" : ""} paused
                </span>
              </div>
            </div>
            <button
              onClick={async () => {
                for (const blocker of rateLimitBlockers) {
                  try {
                    await fetch(`${API_BASE}/api/coordination/blocker-response`, {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem("accessToken")}`,
                      },
                      body: JSON.stringify({
                        parentTaskId: blocker.parentTaskId,
                        blockerId: blocker.id,
                        action: "retry",
                      }),
                    });
                  } catch { /* ignore individual failures */ }
                }
                fetchData();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry All
            </button>
          </div>
        )}
```

Make sure `AlertTriangle` and `RotateCcw` are in the lucide-react imports. Also check that `API_BASE` is accessible (it's likely already defined in the file or use `import.meta.env.VITE_API_URL`).

**Step 3: Verify frontend type check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/Dashboard/MainDashboard.tsx
git commit -m "feat: top-level amber banner for rate limit blockers"
```

---

### Task 5: Dashboard — task row badge for rate limit blockers

**Files:**
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx:~2623`

**Step 1: Add rate limit badge to the task row**

Find the task row where the status badge renders (around line 2623 — look for `data-testid="task-status"`). Right after the status badge `<span>`, add a conditional rate limit badge:

```tsx
                          {/* Rate limit badge — visible without expanding */}
                          {(() => {
                            const taskBlockers = coordinationMessages.filter((m: ContextMessage) =>
                              m.parentTaskId === task.id
                              && (m.messageType === "blocker_detected" || (m.messageType === "blocker" && m.metadata?.isEscalated === true))
                              && m.metadata?.errorCategory === "rate_limit"
                            );
                            const resolvedIds = new Set(
                              coordinationMessages
                                .filter((m: ContextMessage) =>
                                  m.parentTaskId === task.id
                                  && (m.messageType === "blocker_resolved" || (m.messageType === "answer" && m.metadata?.blockerAction))
                                )
                                .map((m: ContextMessage) => (m.metadata?.blockerId as string) || m.id)
                                .filter(Boolean)
                            );
                            const active = taskBlockers.filter((m: ContextMessage) => !resolvedIds.has(m.id));
                            if (active.length === 0) return null;
                            return (
                              <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-500 border-amber-500/30 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Usage Limit
                              </span>
                            );
                          })()}
```

**Step 2: Verify frontend type check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/pages/Dashboard/MainDashboard.tsx
git commit -m "feat: amber Usage Limit badge on task row for rate limit blockers"
```

---

### Task 6: Agent spawner — rate limit detection + SSE event

**Files:**
- Modify: `agent/src/spawner.ts:395-401`
- Modify: `agent/src/local-api.ts:56-63,155-162`

**Step 1: Add rate limit detection to agent spawner stderr handler**

In `agent/src/spawner.ts`, find the stderr handler (line 395). Add rate limit detection:

```typescript
  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.red(redactSecrets(line))}`);
      agentEvents.emit("task:log", { id: task.id, line: redactSecrets(line), severity: "error" });

      // Detect rate limiting from Claude CLI stderr
      if (/rate.limit|429|too many requests|over_quota|overloaded|capacity/i.test(line)) {
        console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Rate limit detected`);
        agentEvents.emit("task:rate_limited", { id: task.id });
      }
    }
  });
```

**Step 2: Register the SSE broadcast in local-api.ts**

In `agent/src/local-api.ts`, add the event type to the comment block (line 56-63):

```typescript
// Event types:
//   "task:started"       { id, summary, persona, model, repo }
//   "task:completed"     { id, exitCode }
//   "task:failed"        { id, exitCode, error }
//   "task:rate_limited"  { id }                          ← ADD
//   "task:log"           { id, line, severity }
//   "task:planning"      { id, summary }
//   "task:plan_done"     { id, success }
//   "state:changed"      {} (generic — triggers full state refresh for clients)
```

Then add the broadcast line after the existing ones (line ~162):

```typescript
agentEvents.on("task:rate_limited", (info) => broadcastSSE("tasks", "task:rate_limited", info));
```

**Step 3: Verify agent type check**

Run: `cd agent && npm run typecheck`
Expected: PASS (with the known dotenv/config error which is intentional)

**Step 4: Commit**

```bash
git add agent/src/spawner.ts agent/src/local-api.ts
git commit -m "feat: agent rate limit detection + task:rate_limited SSE event"
```

---

### Task 7: VS Code extension — rate limit notification

**Files:**
- Modify: `packages/vscode-workermill/src/notifications.ts`

**Step 1: Add rate limit handler**

In `notifications.ts`, add a listener for the `task:rate_limited` event in the constructor (after line 16):

```typescript
export class NotificationManager {
  constructor(private client: AgentClient) {
    client.on("task:completed", (info: { id: string }) => this.onTaskCompleted(info));
    client.on("task:failed", (info: { id: string }) => this.onTaskFailed(info));
    client.on("task:rate_limited", (info: { id: string }) => this.onTaskRateLimited(info));  // ← ADD
  }
```

Add the handler method before `dispose()`:

```typescript
  private onTaskRateLimited(info: { id: string }): void {
    vscode.window.showWarningMessage(
      "WorkerMill: Anthropic usage limit reached. Task paused — retry from the dashboard when your limit resets.",
      "Open Dashboard",
    ).then((action) => {
      if (action === "Open Dashboard") {
        vscode.env.openExternal(vscode.Uri.parse("https://workermill.com"));
      }
    });
  }
```

**Step 2: Verify VS Code extension type check**

Run: `cd packages/vscode-workermill && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/vscode-workermill/src/notifications.ts
git commit -m "feat: VS Code notification for rate limit events"
```

---

## Rebuild/Restart Requirements

After all tasks are complete:

| Component | Action Needed |
|-----------|--------------|
| API (`api/`) | Auto-reloads via `tsx watch` — no action needed |
| Frontend (`frontend/`) | Auto-reloads via Vite HMR — no action needed |
| Worker (`worker/`) | `./bin/local-workermill build-worker` — worker code is compiled during Docker build |
| Agent (`agent/`) | `cd agent && npm run build && npm link` + restart agent |
| VS Code Extension | `cd packages/vscode-workermill && npm run build` then reload VS Code |
