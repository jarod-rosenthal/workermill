# TP-2: Core API & Task Engine

> **TaskPulse Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/taskpulse`](https://github.com/workermill-examples/taskpulse)
> Architecture: [README.md](./README.md)

---

## What This Ticket Delivers

Complete backend API for TaskPulse — auth middleware, RBAC, full CRUD for projects/tasks/runs/members, run simulation engine, SSE streaming, comprehensive seed data, and unit tests.

## Scope Boundary

**TP-1 already created (do NOT recreate):** All config files, Prisma schema, auth setup (`src/lib/auth.ts`, `src/lib/prisma.ts`), page stubs, shared components (LoadingSpinner, ErrorBoundary, EmptyState), CI/CD workflows, health/seed routes, useSSE hook, types/index.ts, validations.ts.

**This ticket creates:** All API route handlers, RBAC middleware, run simulation engine, expanded seed data, unit tests.

**This ticket modifies:** `prisma/seed.ts` (expand from demo user to full demo data), `src/lib/validations.ts` (add route-specific schemas), `src/types/index.ts` (add API response types). **Group all modifications to a file in the same story as related new files.**

**TP-3 creates:** All UI components and page replacements. Do NOT create any component files.
**TP-4 creates:** Schedule and API key routes. Do NOT create schedule or API key routes.

## Prerequisites

TP-1 complete — all page stubs, auth, schema, CI/CD working.

---

## CRITICAL — Next.js 16 Async Params Pattern

Every route handler MUST use this pattern:

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  // ...
}
```

**For nested params (`/api/projects/[slug]/runs/[id]`):**
```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  // ...
}
```

---

## CRITICAL — Standard API Response Format

**All API routes MUST use this consistent format:**

**Success responses:**
```typescript
return NextResponse.json(data);                           // Single item
return NextResponse.json({ data: items, hasMore, cursor }); // Paginated list
```

**Error responses:**
```typescript
return NextResponse.json({ error: "Human-readable message" }, { status: 400 }); // Validation
return NextResponse.json({ error: "Authentication required" }, { status: 401 }); // No session
return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }); // Wrong role
return NextResponse.json({ error: "Project not found" }, { status: 404 });       // Not found
return NextResponse.json({ error: "Task name already exists" }, { status: 409 }); // Conflict
```

Workers MUST NOT invent custom error shapes. Every error response is `{ error: string }` with the appropriate HTTP status code.

---

## Work Groups

### Work Group 1: Auth Middleware & RBAC Helpers (4 files)

**Files:**
- `src/lib/middleware.ts` — RBAC middleware functions
- `src/app/api/auth/signup/route.ts` — MODIFY (add Zod validation using `emailSchema`/`passwordSchema` from validations.ts, and consistent error response format `{ error: string }`)
- `src/lib/validations.ts` — MODIFY (add route-specific Zod schemas)
- `src/types/index.ts` — MODIFY (add API response types for routes: project list item, run list item, task with run counts, member with user info, schedule with task name, dashboard stats shape)

**`src/lib/middleware.ts`:**
```typescript
// Import Prisma from generated client (Prisma 7):
// import { prisma } from "./prisma";
// (prisma.ts uses @/generated/prisma with @prisma/adapter-neon)
//
// getUserProjectMembership(projectSlug, userId) — Lookup user's role in a project
// hasPermission(userRole, requiredRole) — Numeric comparison: VIEWER=0 < MEMBER=1 < ADMIN=2 < OWNER=3
// requireProjectAccess(request, projectSlug, requiredRole?) — Returns { user, membership, project }
//   - Validates JWT session via auth()
//   - Returns 401 if not authenticated
//   - Returns 403 if insufficient role
//   - Returns 404 if project not found
```

**Additional Zod schemas in `src/lib/validations.ts`:**
- `createProjectSchema` — name (3-50 chars), description (optional)
- `updateProjectSchema` — name (optional), description (optional)
- `inviteMemberSchema` — email, role
- `registerTaskSchema` — name (machine name, lowercase+hyphens), displayName, description, retryLimit, retryDelay, timeout, concurrency, inputSchema, stepTemplates
- `triggerRunSchema` — taskId, input (optional JSON)
- `cursorPaginationSchema` — cursor (optional), limit (1-100, default 20)
- `runFilterSchema` — status (optional), taskId (optional), triggeredBy (optional), from/to dates

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 2: Project & Member Routes (4 files)

**Files:**
- `src/app/api/projects/route.ts` — GET list, POST create
- `src/app/api/projects/[slug]/route.ts` — GET detail, PUT update (ADMIN+), DELETE (OWNER)
- `src/app/api/projects/[slug]/members/route.ts` — GET list, POST invite (ADMIN+)
- `src/app/api/projects/[slug]/members/[id]/route.ts` — PUT role (ADMIN+), DELETE remove (ADMIN+ or self)

**GET /api/projects:**
- Returns user's projects with membership counts and run counts
- Ordered by most recent activity

**POST /api/projects:**
- Creates project, auto-generates slug from name (lowercase, hyphens, dedup)
- Creator becomes OWNER
- Returns created project

**GET /api/projects/[slug]:**
- Returns project with member count, task count, recent run count
- Requires project membership (any role)

**Member routes — business rules:**
- Cannot demote the last OWNER
- Members can self-remove (any role)
- Only OWNERs can manage other OWNERs
- Cannot invite existing members (409)

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 3: Task Definition, Run Routes & Simulator (7 files)

**Files:**
- `src/app/api/projects/[slug]/tasks/route.ts` — GET list, POST register (MEMBER+)
- `src/app/api/projects/[slug]/tasks/[id]/route.ts` — GET detail, PUT update (MEMBER+), DELETE (ADMIN+)
- `src/app/api/projects/[slug]/runs/route.ts` — GET list (filterable), POST trigger (MEMBER+)
- `src/app/api/projects/[slug]/runs/[id]/route.ts` — GET detail (include steps + recent logs)
- `src/app/api/projects/[slug]/runs/[id]/cancel/route.ts` — POST cancel (MEMBER+)
- `src/app/api/projects/[slug]/runs/[id]/retry/route.ts` — POST retry (MEMBER+)
- `src/lib/run-simulator.ts` — Run simulation logic

**GET /api/projects/[slug]/tasks:**
- Returns task definitions with run counts and last run status
- Ordered by displayName

**POST /api/projects/[slug]/tasks:**
- Register a new task definition
- Validates `stepTemplates` structure: `[{ name: string, avgDuration: number }]`
- Returns 409 if task name already exists in project

**GET /api/projects/[slug]/runs:**
- Cursor-based pagination (default 20 per page)
- Filter by: status, taskId, triggeredBy, date range (from/to)
- Returns runs with task displayName included
- Ordered by createdAt descending

**POST /api/projects/[slug]/runs (trigger):**
- Creates Run using `simulateRun()` from `run-simulator.ts`
- Takes `{ taskId, input? }` body
- Returns the completed Run with steps and logs
- Validates task exists and belongs to project
- Sets `triggeredBy: "manual"`

**GET /api/projects/[slug]/runs/[id]:**
- Returns full run detail including all RunSteps (ordered by position) and RunLogs (ordered by timestamp)
- Includes task definition info (displayName, retryLimit, timeout)

**POST cancel:** Sets status to CANCELLED (only if QUEUED or EXECUTING)
**POST retry:** Creates a new Run from the same task/input with `attempt: previousAttempt + 1`

**`src/lib/run-simulator.ts`:**

> **CRITICAL:** This file is imported by BOTH Next.js app code (`@/lib/run-simulator`) AND `prisma/seed.ts` (`../src/lib/run-simulator`). Therefore, all Prisma type imports in this file MUST use **relative imports** (e.g., `import type { TaskDefinition, Run, RunStep, RunLog } from "../generated/prisma"`) — NOT the `@/` alias. The `@/` alias only resolves inside Next.js; `tsx prisma/seed.ts` runs outside Next.js.

```typescript
export interface SimulatedRun {
  run: Run;
  steps: RunStep[];
  logs: RunLog[];
}

export function simulateRun(
  projectId: string,
  taskDef: TaskDefinition,
  input: unknown,
  triggeredBy: string
): SimulatedRun {
  // 1. Create Run with QUEUED → EXECUTING → COMPLETED/FAILED
  // 2. For each stepTemplate, create RunStep with:
  //    - Calculated startedAt (offset from run.startedAt)
  //    - Duration = avgDuration * (0.7 + Math.random() * 0.6) — ±30% variance
  //    - Status: COMPLETED (90%) or FAILED (10% — at random step)
  // 3. If any step fails:
  //    - Remaining steps stay QUEUED
  //    - Run.status = FAILED
  //    - Run.error = "Step '{name}' failed: {error message}"
  // 4. Generate RunLog entries per step:
  //    - INFO: "Starting {step name}..."
  //    - DEBUG: Step-specific progress messages (2-3 per step)
  //    - INFO: "Completed {step name} in {duration}ms" (or ERROR on failure)
  // 5. Total run duration = sum of step durations
  // 6. Return all records (caller persists to database using Prisma nested creates)
}
```

> **Implementation note:** `simulateRun()` returns data objects — the caller persists them using Prisma nested `create`:
> ```typescript
> const result = simulateRun(projectId, taskDef, input, "manual");
> const run = await prisma.run.create({
>   data: { ...result.run, steps: { create: result.steps }, logs: { create: result.logs } },
>   include: { steps: true, logs: true },
> });
> ```
> Prisma generates the `id` (CUID) and `createdAt` fields on insert. The `simulateRun()` return objects should omit these auto-generated fields (use `Omit<Run, 'id' | 'createdAt'>` etc., or plain objects matching the create input shape).

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 4: SSE Stream & Dashboard Stats (2 files)

**Files:**
- `src/app/api/projects/[slug]/runs/[id]/stream/route.ts` — SSE stream
- `src/app/api/projects/[slug]/stats/route.ts` — Dashboard aggregations

**`/api/projects/[slug]/runs/[id]/stream` — SSE:**
- Returns `text/event-stream` response
- Events: `{ type: "log", data: RunLog }` and `{ type: "status", data: { status, duration } }`
- Keep-alive ping every 15 seconds
- Closes when all logs have been emitted and run is in terminal state

**SSE replay logic (since runs are simulated synchronously — all data exists upfront):**
- On subscription, check if the run was created recently (within last 30 seconds):
  - **Recent run:** Emit logs progressively with delays matching their timestamp offsets from `run.startedAt`. This creates the illusion of real-time execution. Each log is delayed by `Math.max(0, (log.timestamp - run.startedAt) - (Date.now() - subscriptionStartTime))`. The `Math.max(0, ...)` clamp handles late subscribers where the calculated delay would be negative.
  - **Historical run:** Emit all logs immediately in timestamp order, then close.
- After all logs emitted, send a final `status` event with the terminal state and close the stream.

**`/api/projects/[slug]/stats` — dashboard aggregations:**
Returns JSON with:
- `runsByStatus` — Count per status (for pie/donut chart)
- `runsByTask` — Count per task (for bar chart)
- `runsOverTime` — Daily run count for last 30 days (for line chart)
- `avgDuration` — Average run duration in ms
- `successRate` — Percentage of COMPLETED runs
- `totalRuns` — Total run count
- `failedRuns` — Failed count (last 24 hours)

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 5: Seed Data Expansion (2 files)

> **Dependency:** This group imports `simulateRun()` from `run-simulator.ts` (Work Group 3). WG3 must be completed first.

**Files:**
- `prisma/seed.ts` — REPLACE (expand from demo user to full demo data)
- `src/app/api/seed/route.ts` — MODIFY (call expanded seed)

**Full seed data (see README.md for details):**
1. Demo user (`demo@workermill.com` / `demo1234`) — upsert
2. "Acme Backend Services" project (slug: `acme-backend`) — demo user as OWNER
3. 5 TaskDefinitions with stepTemplates
4. 50 Runs spread over 7 days (35 COMPLETED, 8 FAILED, 4 EXECUTING, 3 QUEUED)
5. RunSteps and RunLogs for each run (generated via `simulateRun()`)
6. 2 Schedules (nightly report + inventory sync)
7. 2 API Keys (production + staging)

**Implementation notes:**
- Import `PrismaClient` from `"../src/generated/prisma"` (relative path) — seed.ts runs via `tsx` outside Next.js, so the `@/` tsconfig alias does NOT resolve. App code uses `@/generated/prisma`; seed.ts uses the relative path.
- Instantiate with `@prisma/adapter-neon` adapter (same pattern as `src/lib/prisma.ts`)
- Use `simulateRun()` for the 43 terminal-state runs (35 COMPLETED + 8 FAILED)
- **EXECUTING/QUEUED runs need manual creation** — `simulateRun()` always produces terminal states. For the 4 EXECUTING runs: create the Run with status EXECUTING, some steps COMPLETED, current step EXECUTING (with `startedAt` set, no `completedAt`), remaining steps QUEUED. For the 3 QUEUED runs: create with status QUEUED, all steps QUEUED, no `startedAt`. Generate appropriate RunLog entries manually.
- Distribute runs across tasks: payment (15), email (12), report (10), inventory (8), image (5)
- Set `createdAt` timestamps spread over 7 days using `date-fns`
- All operations idempotent (upsert where possible, check-before-create otherwise)
- API keys: generate random keys, store bcrypt hash, display prefix only

**CRITICAL — `simulateRun()` import from seed.ts:**
`run-simulator.ts` lives in `src/lib/` and may use `@/generated/prisma` imports. Since `tsx` does NOT resolve the `@/` alias when running seed.ts, `run-simulator.ts` **MUST only use relative imports** for Prisma types (e.g., `import type { TaskDefinition } from "../generated/prisma"`). Then seed.ts imports it via `import { simulateRun } from "../src/lib/run-simulator"`. Alternatively, the seed script can inline its own simulation logic (~50 lines) to avoid the cross-boundary import issue.

**After completing, run:** `npm run typecheck && npm run db:seed` — must pass.

---

### Work Group 6: External Trigger Route (1 file)

**Files:**
- `src/app/api/trigger/route.ts` — POST with API key auth

**POST /api/trigger:**
- Authenticates via `Authorization: Bearer <api-key>` header
- **API key lookup (efficient, NOT O(n) bcrypt):**
  1. Extract the first 16 characters of the bearer token as the prefix
  2. Query: `WHERE keyPrefix = extractedPrefix` (narrows to 1 row)
  3. `bcrypt.compare(fullBearerToken, row.keyHash)` — single comparison
  4. If no match → 401
- Resolves the project from the matched API key's `projectId`
- Body: `{ task: "send-welcome-email", input?: { ... } }`
- Finds TaskDefinition by name in the project
- Calls `simulateRun()` and persists
- Returns the Run summary
- Updates API key's `lastUsedAt`

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 7: Unit Tests (2 files)

**Files:**
- `tests/unit/projects.test.ts` — Project and member route tests
- `tests/unit/runs.test.ts` — Run, task, and trigger route tests

**Test setup:**
- Mock Prisma client (all database methods)
- Mock NextAuth session
- Mock RBAC helpers

**Coverage targets:**
- Project CRUD: 10+ tests (create, list, update, delete, auth checks)
- Member management: 10+ tests (invite, role change, removal, last-owner protection)
- Task registration: 5+ tests (register, list, update, delete, duplicate name)
- Run lifecycle: 10+ tests (trigger, list with filters, detail, cancel, retry)
- External trigger: 5+ tests (valid key, invalid key, missing task, rate limit)

**After completing, run:** `npm run typecheck && npm run test` — all must pass.

---

## Definition of Done

- [ ] All 14 TP-2 files created and functional (13 API route files + run-simulator.ts)
- [ ] RBAC enforcement on every protected endpoint
- [ ] Run simulation produces realistic traces and logs
- [ ] SSE stream works for run log streaming
- [ ] Dashboard stats endpoint returns all aggregations
- [ ] External trigger endpoint with API key auth
- [ ] Full demo data seeded (5 tasks, 50 runs, 2 schedules, 2 API keys)
- [ ] 40+ unit tests passing
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors

## Estimated Plan Size

6-8 stories.
