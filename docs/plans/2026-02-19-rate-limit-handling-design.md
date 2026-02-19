# Rate Limit Handling Design

## Goal

When a user's Anthropic usage limit is reached mid-task, WorkerMill should stop retrying immediately, surface a clear blocker message on the dashboard, and let the user decide when to retry.

## Problem

Claude Max users hit weekly/session usage caps that lock them out for hours. The current coordinator detects rate limits but burns through 3 credential rotation attempts before hard-failing the story. This wastes time and gives the user a cryptic failure instead of a clear explanation. The blocker message is also buried — users have to expand the task card and drill into the error to see what happened.

## Detection

Already implemented in `worker/epic/agent-sdk.ts` (line ~398):

```typescript
if (/rate.limit|429|too many requests|over_quota|overloaded|capacity/i.test(text)) {
  isRateLimited = true;
}
```

The CLI outputs `rate_limit_error` on stderr. We cannot distinguish between throughput limits (resets in seconds) and usage caps (resets in hours) — both produce the same error type. The design treats all rate limits the same: stop and ask the user.

## Design

### 1. Coordinator: Immediate Blocker Escalation

**File:** `worker/epic/coordinator.ts` (~lines 1930-1961)

**Current behavior:** Detects `result.rateLimited`, rotates credentials up to 3 times, waits 5-30s between attempts, then hard-fails the story.

**New behavior:** When `result.rateLimited` is true, skip credential rotation entirely. Immediately escalate as a `blocker_detected` coordination feed event with:

- `errorCategory: "rate_limit"`
- `summary`: "Your Anthropic usage limit was reached. Check your plan at claude.ai/settings — if you have Extra Usage enabled with funds available, click Retry. Otherwise, wait for your limit to reset."
- `storyTitle`: current story title
- `autoRetryAttempts: 0`, `maxAutoRetries: 0` (retrying is pointless until the user acts)

Remove the credential rotation loop for rate limits. The `credentialRotator` stays for other use cases but rate limits bypass it.

### 2. Agent Spawner: Rate Limit Detection

**File:** `agent/src/spawner.ts` (~line 389)

**Current behavior:** Reads stdout for `::result::` marker only. No rate limit detection.

**New behavior:** Add the same regex check on stderr. When detected, emit `task:rate_limited` via `agentEvents` so the VS Code extension can notify the user. The worker still handles the actual blocker escalation — this is informational only.

### 3. Dashboard: Prominent Blocker Visibility

Three layers of visibility so the user can't miss it:

#### a. Top-level banner

**File:** `frontend/src/pages/Dashboard/MainDashboard.tsx`

When any active task has an unresolved blocker with `errorCategory === "rate_limit"`, render a persistent amber banner at the top of the dashboard (above the task list):

> "Anthropic usage limit reached — N task(s) paused. [Retry All]"

- Full-width amber banner with AlertTriangle icon
- "Retry All" button bulk-retries all rate-limited blockers
- Dismissible, but re-appears if new rate limit blockers fire

#### b. Task row badge

**File:** `frontend/src/pages/Dashboard/MainDashboard.tsx` (~line 2623)

Next to the existing status badge on each task row, show an amber "Usage Limit" badge when the task has an active `rate_limit` blocker. Visible without expanding the task card.

#### c. BlockerAlert styling

**File:** `frontend/src/components/BlockerAlert.tsx`

Add `rate_limit` to the error category map:

```typescript
rate_limit: { label: "Usage Limit", color: "text-amber-500" }
```

For `rate_limit` blockers, use amber styling (not red) since it's not an error — it's a pause. The summary text is immediately visible in the BlockerAlert header without expanding.

### 4. VS Code Extension: Notification

**File:** `packages/vscode-workermill/src/AgentClient.ts`

Listen for `task:rate_limited` SSE event. Show a VS Code warning notification:

> "WorkerMill: Anthropic usage limit reached. Task paused — retry from the dashboard when your limit resets."

Informational only, no action buttons.

### 5. API: New Feed Event Type

**File:** `api/src/routes/coordination.ts` (~line 43)

Add `"rate_limited"` to `VALID_MESSAGE_TYPES`. One-line change. The coordinator will use `blocker_detected` for the actual blocker (existing pattern), and can optionally post a `rate_limited` progress event for feed visibility.

## What This Does NOT Do

- No automatic retry/backoff — the user decides when to retry
- No credential rotation for rate limits — pointless for usage caps
- No detection of Extra Usage status — the user knows their own account
- No distinction between throughput limits and usage caps — same handling for both
- No new DB tables, models, or API endpoints
- No BYOK token tracking (future phase)

## Files Changed

| File | Change |
|------|--------|
| `worker/epic/coordinator.ts` | Replace rotation loop with immediate blocker escalation for rate limits |
| `agent/src/spawner.ts` | Add rate limit regex detection on stderr, emit `task:rate_limited` event |
| `agent/src/local-api.ts` | Broadcast `task:rate_limited` SSE event |
| `api/src/routes/coordination.ts` | Add `"rate_limited"` to VALID_MESSAGE_TYPES |
| `frontend/src/pages/Dashboard/MainDashboard.tsx` | Add top-level amber banner + task row badge for rate limit blockers |
| `frontend/src/components/BlockerAlert.tsx` | Add `rate_limit` error category with amber styling |
| `packages/vscode-workermill/src/AgentClient.ts` | Handle `task:rate_limited` SSE event, show VS Code notification |
