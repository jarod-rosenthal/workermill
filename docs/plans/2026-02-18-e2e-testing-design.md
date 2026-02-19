# E2E Testing Redesign — Production-Ready Coverage

**Date:** 2026-02-18
**Status:** Design

## Problem

WorkerMill's E2E tests are insufficient for production launch. The existing 18 test files are mostly smoke tests ("page loads"), not functional tests. The ~6 test routes in `api/src/routes/test.ts` simulate worker behavior (claim, complete, fail, escalate) because local WorkerMill has no worker during E2E runs. This creates two problems:

1. Tests that use test-only routes can't run against production (disabled via `NODE_ENV` check)
2. Tests don't exercise the real product surface — they bypass the orchestrator, workers, and SSE pipeline

## Root Cause

**Local WorkerMill has no lightweight worker for testing.** In production, the orchestrator claims tasks and workers execute them. In E2E tests, nothing executes tasks — so backdoor routes were created to simulate state transitions. This means E2E tests exercise a different code path than real users see.

## Solution

Three changes that eliminate the divergence:

### 1. Mock Worker Mode (`--mock-workers`)

Add a mock worker to the local-epic-spawner that executes tasks through the **real API surface** on a fast timeline, without calling Claude CLI.

**Behavior:**
- Orchestrator claims the task (real, no change)
- Mock worker posts synthetic log lines via `POST /api/tasks/:id/logs` (real endpoint)
- Mock worker transitions through states using the same output markers real workers use (`::result::`, `::pr_url::`, `::cost::`)
- Configurable outcomes per task via a `E2E-` prefix convention:
  - `E2E-SUCCESS-*` → completes with `::result::review_requested`
  - `E2E-FAIL-*` → fails after posting error logs
  - `E2E-BLOCKER-*` → escalates with a blocker after retry exhaustion
  - `E2E-SLOW-*` → runs for 30s (tests SSE streaming, cancel, pause)
  - Default (`E2E-*`) → completes successfully in ~5 seconds

**Implementation location:** `api/src/services/mock-worker.ts` (new file), called from `local-epic-spawner.ts` when `MOCK_WORKERS=true`.

**Timeline per mock task:**
```
t+0s:  Status → executing, post log: "Starting mock execution..."
t+1s:  Post log: "Analyzing task requirements..."
t+2s:  Post log: "Implementing changes..."
t+3s:  Post log: "Running tests..."
t+4s:  Post output markers (::result::, ::pr_url:: if success)
t+5s:  Status → completed/failed/escalated (based on prefix)
```

The mock worker uses the **exact same API endpoints** real workers use:
- `POST /api/tasks/:taskId/logs` (log posting)
- `POST /api/coordination/` (context messages for epic mode)
- Output marker parsing happens in the same code path

### 2. Real Cognito Auth Locally

Remove `--local-auth` as the default. Local WorkerMill authenticates through real Cognito, matching production exactly.

**Changes:**
- `./bin/local-workermill start` defaults to `EXECUTION_MODE=development` (real Cognito)
- `--local-auth` remains available as an opt-in for quick local dev (not for testing)
- E2E test user: `admin@localhost` with `E2E_TEST_USER_PASSWORD` from env/secrets
- `auth.setup.ts` already handles Cognito login — no changes needed there

### 3. Delete Test-Only Routes

Remove `api/src/routes/test.ts` entirely. Every operation it provided either:
- Already exists as a real endpoint (`DELETE /api/tasks/:id`)
- Is replaced by the mock worker (claim, complete, fail, escalate)
- Needs a real admin endpoint (bulk cleanup)

**New real endpoint:** `DELETE /api/control-center/tasks/cleanup` — admin-gated (`requireAdmin`), deletes tasks matching `E2E-*` prefix older than a configurable age. This is a legitimate admin feature for cleaning up test/demo data.

## Unified E2E Test Suite

One set of tests. Point at any URL via `BASE_URL` env var.

### Test Infrastructure

**Playwright config changes:**
- `globalSetup`: Verify API health (`GET /health`), check auth works
- `globalTeardown`: Cleanup `E2E-*` tasks via `DELETE /api/control-center/tasks/cleanup`
- Single project (no `local-only` vs `prod-safe` split)
- 2 parallel workers (most tests are independent)
- `BASE_URL` defaults to `http://localhost:5173`, overridable for production

**API client rewrite** (`e2e/helpers/api-client.ts`):
- Authenticated requests using the test user's JWT (from Playwright storage state)
- No test-route dependencies
- Data creation via real endpoints (webhooks, CRUD APIs)
- Cleanup via real delete endpoints

**Data conventions:**
- All test-created entities use `E2E-{SUITE}-{TIMESTAMP}` naming
- Tasks: `E2E-TEST-{timestamp}` Jira keys (won't match any real project config)
- Boards: `E2E Test Board {timestamp}`
- Personas: `E2E Test Persona {timestamp}`
- Cleanup in `afterAll` per suite + global teardown as safety net

### CI Workflow

```yaml
name: E2E Tests
on:
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options: [local, production]
        default: local

jobs:
  e2e:
    runs-on: [self-hosted, linux]
    steps:
      # Local: start full stack
      - if: inputs.target == 'local'
        run: |
          ./bin/local-workermill start --skip-db --mock-workers
          # Wait for API + frontend healthy

      # Set BASE_URL based on target
      - env:
          BASE_URL: ${{ inputs.target == 'production' && 'https://workermill.com' || 'http://localhost:5173' }}

      # Run tests (same suite regardless of target)
      - run: cd frontend && npx playwright test

      # Upload artifacts
      - uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/

      # Local: tear down
      - if: inputs.target == 'local'
        run: ./bin/local-workermill stop
```

### Test Coverage

#### Tier 1 — Revenue & Access

**`auth-login.spec.ts`** — Login flow
- Cognito login with valid credentials → redirects to dashboard
- Session persists across page reload (token in localStorage)
- Logout clears session, redirects to login
- Invalid credentials show error message

**`auth-signup.spec.ts`** — Signup + onboarding (NEW)
- Email + password signup → verification redirect
- Invite-based signup (email pre-filled, org name hidden)
- Onboarding: create org → dashboard
- Onboarding: join via invite token → dashboard
- Terms of service checkbox required

**`auth-routes.spec.ts`** — Route protection
- Unauthenticated user → redirected to `/login`
- Public pages accessible without auth (`/docs`, `/`)
- Authenticated user can access `/dashboard`, `/settings`, `/boards`

**`billing.spec.ts`** — Subscription & payments (NEW)
- View current plan on billing page
- Upgrade button opens Stripe checkout (test mode, `4242 4242 4242 4242`)
- Billing portal redirect works
- Plan badge displays correctly in settings
- Deposit page: amount selection, Stripe Elements loads, skip works

**`settings-mutations.spec.ts`** — Settings CRUD (UPGRADED)
- Change organization name → persists after reload
- Change default worker model → persists
- Save GitHub integration token → validation feedback
- Save Jira/Bitbucket credentials → validation feedback
- Toggle org settings (critic, tech lead review)

#### Tier 2 — Core Product

**`webhook-task.spec.ts`** — Webhook → task creation (UPGRADED)
- Jira webhook creates task visible in dashboard
- GitHub Issues webhook creates task
- Label parsing (haiku/sonnet/opus) sets correct model
- Task appears with `queued` status initially
- Task detail page shows summary, description, status

**`task-lifecycle.spec.ts`** — Full task lifecycle via mock worker (REWRITTEN)
- Create task via webhook → appears queued in dashboard
- Mock worker claims and executes → status updates to `executing` in real-time
- Logs stream via SSE during execution → visible in log viewer
- Task completes → status shows `completed`, PR URL displayed
- Task fails (use `E2E-FAIL-*` key) → status shows `failed`, error displayed
- Task escalates (use `E2E-BLOCKER-*` key) → blocker alert appears

**`task-admin.spec.ts`** — Admin task controls (NEW)
- Cancel running task → status changes, execution stops
- Retry failed task → re-queued, new execution starts
- Approve task in `review_requested` → re-queued for deployment
- Delete completed task → removed from list
- Bulk cleanup of E2E test tasks

**`log-streaming.spec.ts`** — SSE streaming (UPGRADED)
- Logs appear in real-time without page refresh (mock worker posts progressively)
- Log ordering preserved (timestamps correct)
- Navigate away and back → stream resumes from cursor
- Multiple log entries batch correctly

**`boards-crud.spec.ts`** — Board management (REWRITTEN)
- Create board with name → appears in board list
- Create board from template → columns pre-populated
- Add card to board → card visible in column
- Edit card title/description → changes persist
- Move card between columns (drag or menu)
- Delete card → removed
- Delete board → removed from list
- Run card as AI task → task created, status updates on card

**`personas-crud.spec.ts`** — Persona management (REWRITTEN)
- View persona list with search/filter
- Create custom persona → appears in list
- Edit persona details → changes persist
- Persona appears in task creation picker
- Delete persona → removed from list

**`dashboard-filters.spec.ts`** — Dashboard interactions (NEW)
- Filter tasks by status (queued, executing, completed, failed)
- Search tasks by name/key
- Task list pagination works
- Sort by date/status
- Click task row → navigates to detail page

**`blocker-handling.spec.ts`** — Blocker response flow (REWRITTEN)
- Task escalates (mock worker `E2E-BLOCKER-*`) → blocker alert visible
- Click "Retry" → task re-queued, mock worker re-executes
- Click "Skip" → story skipped, execution continues
- Click "Abort" → task cancelled

#### Tier 3 — Trust & Safety

**`rbac.spec.ts`** — Role-based access (NEW)
- Admin user sees billing/settings admin controls
- Admin-only buttons (upgrade plan, manage team) visible
- API key management: generate, copy, revoke
- Revoked API key returns 401 on subsequent use

**`profile.spec.ts`** — Profile management (UPGRADED)
- View profile displays correct user info
- Change display name → persists after reload
- Change password form validates correctly

**`sse-resilience.spec.ts`** — Stream reliability (NEW)
- SSE stream connects on page load
- Navigate to different page, return → stream reconnects
- Dashboard stats update in real-time (task count changes when mock worker completes)

**`error-states.spec.ts`** — Error handling (UPGRADED)
- 404 page for invalid routes
- Task detail for non-existent ID → appropriate error
- Network error handling (API unavailable) → error state shown

#### Tier 4 — Polish

**`docs.spec.ts`** — Public documentation (NEW)
- Docs overview page loads without auth
- Navigation between doc pages works
- Code examples render correctly

**`analytics.spec.ts`** — Analytics (UPGRADED)
- Analytics page loads with data sections
- Date range filter changes displayed data
- Cost breakdown visible

## File Structure

```
frontend/e2e/
├── global-setup.ts              # Health check, verify API + auth
├── global-teardown.ts           # Bulk cleanup E2E-* data
├── fixtures/
│   └── auth.fixture.ts          # Authenticated page fixture
├── helpers/
│   ├── api-client.ts            # Rewritten: real endpoints only, JWT auth
│   └── test-data.ts             # Naming conventions, factories
├── tests/
│   ├── auth.setup.ts            # Cognito login, save session (unchanged)
│   ├── auth-login.spec.ts       # Login/logout/session
│   ├── auth-signup.spec.ts      # NEW: signup + onboarding
│   ├── auth-routes.spec.ts      # Route protection
│   ├── billing.spec.ts          # NEW: Stripe test mode
│   ├── settings-mutations.spec.ts  # UPGRADED: real mutations
│   ├── webhook-task.spec.ts     # UPGRADED: GitHub + Jira
│   ├── task-lifecycle.spec.ts   # REWRITTEN: mock worker driven
│   ├── task-admin.spec.ts       # NEW: cancel, retry, approve, delete
│   ├── log-streaming.spec.ts    # UPGRADED: mock worker logs
│   ├── boards-crud.spec.ts      # REWRITTEN: full CRUD
│   ├── personas-crud.spec.ts    # REWRITTEN: full CRUD
│   ├── dashboard-filters.spec.ts  # NEW: search, filter, sort
│   ├── blocker-handling.spec.ts # REWRITTEN: real escalation flow
│   ├── rbac.spec.ts             # NEW: role-based UI gating
│   ├── profile.spec.ts          # UPGRADED: real mutations
│   ├── sse-resilience.spec.ts   # NEW: reconnection, cursor
│   ├── error-states.spec.ts     # UPGRADED: more states
│   ├── docs.spec.ts             # NEW: public docs
│   └── analytics.spec.ts        # UPGRADED: filters
```

**Deleted files:**
- `api/src/routes/test.ts` — replaced by mock worker + real endpoints
- `frontend/e2e/tests/auth.spec.ts` → split into `auth-login.spec.ts` + `auth-routes.spec.ts`
- `frontend/e2e/tests/auth.unauth.spec.ts` → merged into `auth-routes.spec.ts`
- `frontend/e2e/tests/navigation.spec.ts` → absorbed into relevant domain specs
- `frontend/e2e/tests/navigation.unauth.spec.ts` → merged into `auth-routes.spec.ts`
- `frontend/e2e/tests/orchestration.spec.ts` → replaced by `task-lifecycle.spec.ts`
- `frontend/e2e/tests/settings.spec.ts` → replaced by `settings-mutations.spec.ts`
- `frontend/e2e/tests/persona-studio.spec.ts` → replaced by `personas-crud.spec.ts`
- `frontend/e2e/tests/boards.spec.ts` → replaced by `boards-crud.spec.ts`
- `frontend/e2e/tests/webhook-github.spec.ts` → merged into `webhook-task.spec.ts`

## API Changes

### New: Mock Worker (`api/src/services/mock-worker.ts`)

Called by `local-epic-spawner.ts` when `MOCK_WORKERS=true` env var is set.

```typescript
interface MockWorkerConfig {
  taskId: string;
  apiBaseUrl: string;
  apiKey: string;
  scenario: 'success' | 'failure' | 'blocker' | 'slow';
}
```

Determines scenario from Jira key prefix:
- `E2E-FAIL-*` → failure
- `E2E-BLOCKER-*` → blocker/escalation
- `E2E-SLOW-*` → slow execution (30s)
- Everything else → success (5s)

Posts logs and state transitions through real API endpoints, same as production workers.

### New: Admin Cleanup Endpoint

`DELETE /api/control-center/tasks/cleanup` — `requireAdmin` middleware.

Query params:
- `prefix` (default: `E2E-`) — Jira key prefix to match
- `maxAge` (default: `24`) — hours, only delete tasks older than this

Cascades: deletes logs, context, commands, feedback for matched tasks.

### Removed: Test Routes

Delete `api/src/routes/test.ts` and its mount in `api/src/app.ts`.

## Local WorkerMill Changes

### `./bin/local-workermill start` defaults

| Flag | Current Default | New Default |
|------|----------------|-------------|
| Auth mode | `--local-auth` (bypass Cognito) | Real Cognito (no flag) |
| Workers | Real Claude CLI | Real Claude CLI (no change) |

### New flag: `--mock-workers`

Sets `MOCK_WORKERS=true` env var. The local-epic-spawner checks this and spawns mock workers instead of Claude CLI processes.

```bash
# E2E testing (real Cognito, mock workers, fast)
./bin/local-workermill start --mock-workers

# Development (real Cognito, real workers)
./bin/local-workermill start

# Quick local dev (skip Cognito, real workers)
./bin/local-workermill start --local-auth
```

## Running E2E Tests

### Locally

```bash
# Terminal 1: Start local WorkerMill with mock workers
./bin/local-workermill start --mock-workers

# Terminal 2: Run E2E tests
cd frontend
E2E_TEST_USER_PASSWORD=<password> npx playwright test
```

### Against Production

```bash
cd frontend
BASE_URL=https://workermill.com \
  E2E_TEST_USER_EMAIL=admin@localhost \
  E2E_TEST_USER_PASSWORD=<password> \
  npx playwright test
```

Same tests, same auth, same endpoints. Against production, mock workers aren't involved — tests observe real tasks and create test data via real webhooks. Task lifecycle tests that depend on mock worker timing use adaptive waits (poll for expected state rather than fixed timeouts).

### CI

GitHub Actions workflow_dispatch with `target` input (local/production). Local starts the full stack with `--mock-workers`. Both use real Cognito credentials from GitHub Secrets.
