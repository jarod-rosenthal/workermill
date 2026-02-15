# TP-3: Dashboard UI

> **TaskPulse Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/taskpulse`](https://github.com/workermill-examples/taskpulse)
> Architecture: [README.md](./README.md)

---

## What This Ticket Delivers

Complete web UI for TaskPulse — project navigation, runs list with filtering, run detail with trace timeline and log viewer, task management, dashboard charts, settings page, and E2E tests. This epic brings the TP-2 backend API to life with a polished dark-theme frontend.

## Scope Boundary

**TP-1/TP-2 already created (do NOT recreate):** All API routes, Prisma schema, auth setup, run simulator, seed data, shared components (LoadingSpinner, ErrorBoundary, EmptyState), useSSE hook, types, validations.

**This ticket replaces:** All page stubs from TP-1. The stub files are MODIFICATIONS (replace content).

**This ticket creates:** All new component files in `src/components/layout/`, `src/components/runs/`, `src/components/tasks/`, `src/components/dashboard/`, E2E test files.

**TP-4 creates:** Schedule components, API key management UI, CronDisplay, ScheduleForm. Do NOT create schedule or API key UI.
**TP-5 creates:** vercel.json, production config. Do NOT create vercel.json.

## Prerequisites

TP-2 complete — all API routes working, seed data loaded, run simulation functional.

---

## CRITICAL — Next.js 16 Async Params Pattern

```typescript
export default async function Page({
  params,
}: {
  params: Promise<{ project: string }>;
}) {
  const { project } = await params;
  // ...
}
```

Also: `useSearchParams()` must be wrapped in `<Suspense>`.

---

## CRITICAL — Dark Theme Convention

Every component uses dark colors. Reference the design system in README.md:
- Background: `bg-gray-950`
- Surface/Card: `bg-gray-900 border border-gray-800 rounded-lg`
- Table rows hover: `hover:bg-gray-800/50`
- Text: `text-gray-100` (primary), `text-gray-400` (secondary)
- Accent/links: `text-violet-400 hover:text-violet-300`
- Inputs: `bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500`

---

## Work Groups

### Work Group 1: Layout Components + Projects Page (5 files)

**Files:**
- `src/components/layout/Sidebar.tsx` — NEW
- `src/components/layout/Header.tsx` — NEW
- `src/app/[project]/layout.tsx` — MODIFY (replace stub)
- `src/app/projects/page.tsx` — MODIFY (replace stub)
- `src/app/[project]/page.tsx` — MODIFY (replace stub — redirect to runs)

**Sidebar (`src/components/layout/Sidebar.tsx`):**
- Dark sidebar: `bg-gray-900 border-r border-gray-800`, 256px width
- Logo/brand: "TaskPulse" with violet accent, links to `/projects`
- Navigation links with icons (use inline SVGs or Unicode symbols, NOT @heroicons/react):
  - Runs (`/[project]/runs`) — play icon
  - Tasks (`/[project]/tasks`) — list icon
  - Schedules (`/[project]/schedules`) — clock icon
  - Dashboard (`/[project]/dashboard`) — chart icon
  - Settings (`/[project]/settings`) — gear icon
- Active link: `bg-gray-800 text-violet-400`
- Inactive link: `text-gray-400 hover:text-gray-200 hover:bg-gray-800/50`
- Collapsible on mobile with hamburger menu
- Project name display at top

> **IMPORTANT:** Do NOT use `@heroicons/react`. Use inline SVG elements or Unicode characters for icons. This avoids an unlisted dependency issue that caused TB-10 to fail.

**Header (`src/components/layout/Header.tsx`):**
- `bg-gray-900 border-b border-gray-800`, full width
- Breadcrumb showing: Project name > Current page
- User menu (dropdown): user name, email, sign out
- Mobile: hamburger menu toggle for sidebar

**Projects page (`src/app/projects/page.tsx`):**
- Server component with auth check (redirect to login if unauthenticated)
- Grid layout of project cards (`bg-gray-900 border border-gray-800 rounded-lg`)
- Each card: project name, description, member count, total runs, last activity
- "Create Project" button → inline form or modal
- Empty state when no projects

**Project layout (`src/app/[project]/layout.tsx`):**
- Server component: auth check + project data fetch
- Client component wrapper for sidebar state
- `notFound()` for invalid project slugs
- Passes project data to sidebar

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 2: RunsTable + RunStatusBadge + TriggerRunDialog (4 files)

**Files:**
- `src/components/runs/RunsTable.tsx` — NEW
- `src/components/runs/RunStatusBadge.tsx` — NEW
- `src/components/runs/TriggerRunDialog.tsx` — NEW
- `src/app/[project]/runs/page.tsx` — MODIFY (replace stub)

**RunStatusBadge (`src/components/runs/RunStatusBadge.tsx`):**
Client component (`"use client"` — used inside client component parents like RunsTable).
- Small pill badge with icon + text
- Colors per status (see README.md design system):
  - QUEUED: `text-gray-400 bg-gray-400/10` — clock icon
  - EXECUTING: `text-blue-400 bg-blue-400/10` — animated pulse dot
  - COMPLETED: `text-emerald-400 bg-emerald-400/10` — check icon
  - FAILED: `text-red-400 bg-red-400/10` — X icon
  - CANCELLED: `text-gray-500 bg-gray-500/10` — slash icon
  - TIMED_OUT: `text-amber-400 bg-amber-400/10` — clock-alert icon
- Sizes: sm, md

**RunsTable (`src/components/runs/RunsTable.tsx`):**
- Client component
- Dark table: `bg-gray-900 border border-gray-800 rounded-lg`
- Columns: Status (badge), Task Name, Triggered By, Started, Duration, Run ID (monospace, truncated)
- Row click → navigate to run detail page
- Row hover: `hover:bg-gray-800/50`
- **Filters bar** above table:
  - Status dropdown (multi-select): QUEUED, EXECUTING, COMPLETED, FAILED, CANCELLED, TIMED_OUT
  - Task dropdown: list of task definitions
  - Date range picker: From / To
  - "Clear filters" button
- Cursor-based pagination: "Load more" button at bottom
- Loading state: skeleton rows
- Empty state: EmptyState component

**TriggerRunDialog (`src/components/runs/TriggerRunDialog.tsx`):**
Client component (`"use client"` — uses Headless UI Dialog and form state).
- Headless UI Dialog with dark overlay
- Task selector dropdown
- JSON input editor (textarea with monospace font)
- "Trigger" button → POST to runs endpoint
- On success: navigate to the new run's detail page
- Loading state during submission

**Runs page (`src/app/[project]/runs/page.tsx`):**
- Server component: fetch initial runs with default pagination
- Pass data to RunsTable client component
- Page header: "Runs" title + "Trigger Run" button (opens TriggerRunDialog)

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 3: Run Detail — Timeline + Logs (3 files)

> **Dependency:** This group imports `RunStatusBadge` from Work Group 2. WG2 must be completed first.

**Files:**
- `src/components/runs/RunTimeline.tsx` — NEW
- `src/components/runs/RunLogs.tsx` — NEW (`"use client"` — uses useSSE hook, interactive filtering, auto-scroll)
- `src/app/[project]/runs/[id]/page.tsx` — MODIFY (replace stub)

**RunTimeline (`src/components/runs/RunTimeline.tsx`):**
This is the **hero component** — the trace/waterfall view of run execution.
- Vertical timeline with steps listed top-to-bottom
- Each step shows:
  - Step name (left)
  - Status badge (RunStatusBadge)
  - Duration bar (proportional width, colored by status)
  - Start time offset from run start (e.g., "+1.2s")
  - Duration text (e.g., "842ms")
- Horizontal bars represent step duration, scaled to the total run duration
- Color: emerald for completed, red for failed, blue for executing, gray for queued
- Animated: steps reveal progressively based on their `startedAt` timestamps relative to now
  - CSS transitions with `transition-delay` based on step offset
  - Creates illusion of real-time execution for freshly triggered runs
- Error step: shows error message in red below the step bar
- Responsive: full width on mobile, max-width on desktop

**RunLogs (`src/components/runs/RunLogs.tsx`):**
- Monospace log viewer (font-mono)
- Dark background: `bg-gray-950 rounded-lg border border-gray-800`
- Each log line: `[timestamp] [LEVEL] message`
- Level colors: DEBUG=gray-500, INFO=gray-300, WARN=amber-400, ERROR=red-400
- Level filter buttons at top: ALL, DEBUG, INFO, WARN, ERROR
- Auto-scroll to bottom for new logs
- Max height with overflow scroll
- SSE integration: subscribes to `/stream` endpoint for live log updates
- Metadata expandable (click to toggle JSON view)

**Run detail page (`src/app/[project]/runs/[id]/page.tsx`):**
- Server component: fetch run with steps and logs
- Two-panel layout:
  - Top: Run header (status badge, task name, triggered by, timestamps, duration, attempt count)
  - Middle: RunTimeline (trace view)
  - Bottom: RunLogs (log viewer)
- Action buttons: "Retry" (if FAILED), "Cancel" (if QUEUED/EXECUTING)
- Breadcrumb: Runs > Run {id}

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 4: Tasks Pages (4 files)

> **Dependency:** This group imports `RunsTable` and `RunStatusBadge` from Work Group 2. WG2 must be completed first.

**Files:**
- `src/components/tasks/TaskCard.tsx` — NEW
- `src/components/tasks/TaskConfig.tsx` — NEW
- `src/app/[project]/tasks/page.tsx` — MODIFY (replace stub)
- `src/app/[project]/tasks/[id]/page.tsx` — MODIFY (replace stub)

**TaskCard (`src/components/tasks/TaskCard.tsx`):**
- Dark card: `bg-gray-900 border border-gray-800 rounded-lg p-4`
- Task display name (large)
- Machine name (monospace, gray-500)
- Description (truncated to 2 lines)
- Stats: total runs, success rate, avg duration, last run time
- Click → navigate to task detail
- Step count badge

**TaskConfig (`src/components/tasks/TaskConfig.tsx`):**
- Configuration display for a task definition
- Grid/table of settings: retryLimit, retryDelay, timeout, concurrency, version
- Step templates list: name + avg duration for each step
- Input schema display (formatted JSON if present)
- All values in monospace font
- Read-only display (editing is a stretch goal)

**Tasks list page:**
- Server component: fetch task definitions with run counts
- Grid of TaskCards (2 columns on desktop, 1 on mobile)
- Page header: "Tasks" title + total count

**Task detail page:**
- Server component: fetch task definition + recent runs
- Top: Task header (displayName, name, version, description)
- Middle: TaskConfig
- Bottom: Recent runs table (last 10 runs for this task, reuse RunsTable with taskId filter)
- "Trigger Run" button specific to this task

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 5: Dashboard + Charts (2 files)

**Files:**
- `src/components/dashboard/Charts.tsx` — NEW
- `src/app/[project]/dashboard/page.tsx` — MODIFY (replace stub)

**Charts (`src/components/dashboard/Charts.tsx`):**
Client component (`"use client"` — Recharts requires browser APIs like `ResizeObserver`).
4 Recharts visualizations in dark theme:

1. **Runs by Status** — Donut/pie chart
   - COMPLETED=emerald, FAILED=red, QUEUED=gray, EXECUTING=blue, CANCELLED=gray-500, TIMED_OUT=amber
   - Center: total count
   - Legend below chart

2. **Runs by Task** — Horizontal bar chart
   - Task displayNames on Y axis, run counts on X
   - Bars colored violet
   - Sorted by count descending

3. **Runs Over Time** — Area/line chart
   - Last 30 days on X axis
   - Run count on Y axis
   - Violet fill with line
   - Tooltip showing date + count

4. **Success Rate** — Large number display
   - Big percentage number (emerald if > 90%, amber if > 70%, red otherwise)
   - Subtitle: "Last 30 days"
   - Below: total runs, failed runs

**Recharts 3 dark theme overrides:**
- `<ResponsiveContainer>` for sizing
- Axis ticks: `fill="#9ca3af"` (gray-400)
- Grid lines: `stroke="#1f2937"` (gray-800)
- Tooltip: `bg-gray-800 border-gray-700 text-gray-100`
- **Recharts 3 note:** `accessibilityLayer` is now `true` by default. `CategoricalChartState` type was removed — use Recharts 3 API.

**Dashboard page:**
- Server component: fetch stats from `/api/projects/[slug]/stats`
- Summary stat cards at top (grid of 4):
  - Total Runs (number)
  - Success Rate (percentage)
  - Avg Duration (formatted)
  - Failed (last 24h) (number, red if > 0)
- Charts in 2x2 grid below stats
- Card containers: `bg-gray-900 border border-gray-800 rounded-lg p-6`

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 6: Settings Page (1 file)

**Files:**
- `src/app/[project]/settings/page.tsx` — MODIFY (replace stub)

**Settings page — 3 sections:**

**1. Project Settings (top)**
- Project name + description editing (inline forms)
- Slug display (read-only)
- "Delete Project" button (OWNER only, confirmation dialog)
- RBAC: only ADMIN+ can edit settings

**2. Members Section (middle)**
- Member list: name, email, role badge, joined date
- Invite button: email + role dropdown (ADMIN+ only)
- Role change dropdown per member (ADMIN+ only)
- Remove button per member (with last-owner protection)
- Self-remove option

**3. API Keys Section (bottom — placeholder)**
- Heading: "API Keys"
- Text: "API key management coming in the next update."
- This section is implemented in TP-4

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 7: E2E Tests (5 files)

**Files:**
- `tests/e2e/global-setup.ts` — Database seeding and env config
- `tests/e2e/auth.spec.ts` — Login, signup, demo login, session
- `tests/e2e/runs.spec.ts` — Runs list, filtering, run detail, trigger
- `tests/e2e/dashboard.spec.ts` — Charts render, stats display
- `tests/e2e/mobile.spec.ts` — Responsive layout, sidebar collapse

**Test coverage targets:**
- auth.spec.ts: 10+ tests (login, signup, demo credentials, redirect, session)
- runs.spec.ts: 15+ tests (list page, status filter, task filter, run detail, timeline, logs, trigger)
- dashboard.spec.ts: 8+ tests (stat cards, charts render, data matches)
- mobile.spec.ts: 8+ tests (sidebar collapse, responsive layout, touch targets)

**Global setup:**
- Seed demo data before tests
- Configure base URL for test server

**Update `playwright.config.ts`** if needed for the test suite.

**After completing, run:** `npm run typecheck && npm run test:e2e` — all must pass.

---

## Learnings Applied from TeamBoard

1. **Single-file ownership** — No two work groups modify the same file
2. **No @heroicons/react** — Use inline SVGs instead (TB-10 failed because of missing @heroicons/react dependency)
3. **Server/client component separation** — Server handles auth + data, client handles interactivity
4. **Suspense for useSearchParams** — Required by Next.js 16
5. **Per-group typecheck gates** — Every group ends with `npm run typecheck`
6. **Prisma 7 imports** — All files import from `@/generated/prisma`, NOT `@prisma/client`

---

## Definition of Done

- [ ] All page stubs replaced with functional UI
- [ ] Sidebar + header navigation working
- [ ] Runs list with filtering and pagination
- [ ] Run detail with trace timeline and log viewer
- [ ] Task list and task detail pages
- [ ] Dashboard with 4 charts rendering real data
- [ ] Settings page with member management
- [ ] 40+ E2E tests passing
- [ ] Dark theme consistent throughout
- [ ] Responsive design (mobile through desktop)
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors

## Estimated Plan Size

7-9 stories.
