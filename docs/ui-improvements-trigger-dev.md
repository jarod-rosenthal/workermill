# UI Improvements — Inspired by Trigger.dev

> Reference repo: [github.com/triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev)
> Testing environment: Local WorkerMill only — DO NOT deploy to prod
> Visual references: `docs/reference-screenshots/trigger-dev/`

## Overview

Trigger.dev is an open-source task orchestration platform with a polished developer dashboard. Their UI patterns for visualizing task execution, real-time logs, and status management are directly applicable to WorkerMill. This document captures specific patterns worth adopting, prioritized by impact.

---

## Architecture Constraints — DO NOT CHANGE

The live streaming terminal and communication channel are the foundation of WorkerMill. **All improvements in this document are render-layer only.** The data pipeline stays untouched.

### What Stays Exactly As-Is

| Component | Location | Why It's Sacred |
|-----------|----------|-----------------|
| **Log SSE endpoint** | `api/src/routes/control-center/logs.ts:251-443` | `GET /api/control-center/logs/:taskId/stream` — PostgreSQL polling every 1s, cursor-based resume, 100 logs per poll |
| **Coordination SSE endpoint** | `api/src/routes/coordination.ts:72-160` | `GET /api/coordination/context/:parentTaskId/stream` — PostgreSQL polling every 5s for context messages |
| **SSE connection setup** | `frontend/src/pages/Dashboard/MainDashboard.tsx:871-1048` | EventSource creation, cursor tracking, dedup, polling fallback on SSE failure |
| **Log ingestion** | `api/src/routes/control-center/logs.ts:451-536` | `POST /api/control-center/logs` — worker → PostgreSQL → SSE → frontend |
| **Blocker response** | `api/src/routes/coordination.ts:367-445` | `POST /api/coordination/blocker-response` — retry/skip/abort actions |
| **Coordination store** | `frontend/src/store/coordination-store.ts` | Zustand store for context messages (max 200, localStorage persistence) |

### Two Independent SSE Streams

The dashboard maintains **two separate SSE connections** per active task:

1. **Log stream** → `streamingLogs` state (last 1,000 lines per task, bounded buffer)
2. **Coordination stream** → Zustand coordination store (context messages, blockers, questions)

Both must remain functional and independently connected after all UI changes.

### Where Things Actually Live Today

The plan originally referenced `frontend/src/pages/TaskDetail.tsx` — **this page does not exist**. The actual architecture:

| Feature | Actual Location | Structure |
|---------|----------------|-----------|
| Task list + expandable detail | `MainDashboard.tsx` (2,700+ lines) | Expandable task cards, each with inline log viewer + error panel + comms panel |
| Log rendering | `TerminalLogViewer.tsx` (196 lines) | Reusable component for historical logs; live streaming rendered inline in MainDashboard |
| Blocker alerts | `BlockerAlert.tsx` (306 lines) | Standalone component rendered inside expanded task card |
| Coordination feed | `CoordinationFeed.tsx` (1,159 lines) | Standalone component with its own SSE connection, threaded/flat views |
| Error parsing | `MainDashboard.tsx:269-356` | Parses streaming logs for error keywords, auto-expands error panel |

### Log Buffer Architecture

```
Worker → POST /api/control-center/logs → PostgreSQL
                                              ↓
                              SSE poll every 1s (100 logs/batch)
                                              ↓
                              EventSource in MainDashboard.tsx
                                              ↓
                              streamingLogs[taskId] (last 1,000 lines)
                                              ↓
                              Render layer (THIS IS WHAT WE CHANGE)
```

The `streamingLogs` buffer is bounded at 1,000 entries. Virtual scrolling (#2) wraps this buffer. Scrolling past the buffer top requires a REST fetch for older logs — this is the **only new API behavior** needed (a `before` cursor param on the existing `GET /api/control-center/logs/:taskId` endpoint).

---

## 1. Epic Execution Timeline Visualization

**Priority: P0 — Highest Impact**
**Effort: Medium**
**Reference:** `apps/webapp/app/components/run/RunTimeline.tsx`, `apps/webapp/app/components/primitives/Timeline.tsx`

### What Trigger.dev Does

Horizontal timeline showing task execution phases as spans with precise timestamps and duration calculations. Uses React Context (`TimelineContext`, `MousePositionContext`) for interactive cursor tracking. Math-based positioning via `inverseLerp()`/`lerp()` for pixel-perfect span placement.

Status timeline events flow: `Triggered → Waiting to dequeue → Dequeued → Waiting to execute → Started → Executing → Finished`

> **See:** `reference-screenshots/trigger-dev/01-run-timeline-definitions.png` (state progression), `07-run-inspector.jpg` (live timer), `11-otel-traces.png` (horizontal duration bars + hierarchical tree)

### What WorkerMill Should Build

An epic execution timeline showing the full lifecycle of a task:

```
Planning ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
Expert 1 (backend_developer)  ░░░░████████████░░░░░░░░░░░░░░░░░░░░░░
Expert 2 (qa_engineer)        ░░░░░░░░████████████░░░░░░░░░░░░░░░░░░
Expert 3 (tech_lead review)   ░░░░░░░░░░░░░░░░░░░░████░░░░░░░░░░░░░
Revision (story 4)            ░░░░░░░░░░░░░░░░░░░░░░░░░░████░░░░░░░
Quality Check                 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░
Consolidation + PR            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░██
```

This is the "htop for AI workers" promise delivered visually. Our parallel expert model is more visually interesting than Trigger.dev's sequential runs — we have genuine parallelism to show.

### Key Implementation Details

- Each story becomes a `Span` component with start/end times
- Planning, review, quality check, and consolidation are distinct phases
- Parallel experts shown as stacked horizontal bars
- Revision cycles visually distinct (different color or dashed pattern)
- Live timer (`LiveTimer.tsx` pattern) for in-progress spans
- Mouse hover shows exact timestamp and duration
- Click a span to jump to that story's logs

### Data Source

The coordination feed (`GET /api/coordination/feed/:taskId`) and worker task logs already contain timestamps for story start/complete events. The timeline component parses these from the **existing coordination Zustand store** — no new API calls needed.

Relevant coordination message types: `story_claimed` (start), `completion` (end), `revision_requested` (revision start), `blocker` / `blocker_resolved` (blocker spans).

### Files to Create/Modify

```
frontend/src/components/timeline/EpicTimeline.tsx       # Main timeline component
frontend/src/components/timeline/TimelineSpan.tsx        # Individual span (story/phase)
frontend/src/components/timeline/TimelineContext.tsx      # React context for mouse tracking
frontend/src/components/timeline/timeline-utils.ts       # lerp/inverseLerp math utilities
frontend/src/components/timeline/LiveTimer.tsx            # Real-time elapsed timer
frontend/src/pages/Dashboard/MainDashboard.tsx            # MODIFY — add timeline inside expanded task card
```

---

## 2. Virtual Scrolling for Log Viewer

**Priority: P1 — Performance Fix**
**Effort: Small**
**Reference:** `apps/webapp/app/components/logs/LogsTable.tsx`, `@tanstack/react-virtual`

### What Trigger.dev Does

Uses `@tanstack/react-virtual` for log tables with 1000+ entries. IntersectionObserver triggers "load more" at 0.1 threshold. Deferred loading spinner (200ms delay to prevent flicker).

> **See:** `reference-screenshots/trigger-dev/09-v3-logs-page.png` (full logs page with filter bar, live toggle, and virtualized table)

### What WorkerMill Should Build

Replace the current log rendering (every SSE event appends a div to the DOM) with virtualized rendering. On long-running epics (11+ stories, 30k+ log lines), the current approach causes visible performance degradation — scrolling becomes janky and the browser tab uses excessive memory.

### How It Integrates With Existing Streaming

The SSE connection and `streamingLogs` buffer stay untouched. Virtual scrolling wraps the buffer:

```
streamingLogs[taskId] (bounded array, max 1,000 entries)
        ↓
@tanstack/react-virtual virtualizer
        ↓
Only renders visible rows + overscan buffer (typically ~50 DOM nodes)
```

**Follow mode (auto-scroll to bottom):** Default on. When new logs arrive via SSE, virtualizer scrolls to end. User scrolling up pauses follow mode. A "Resume follow" button appears at the bottom.

**Historical log loading:** When user scrolls to the top of the 1,000-line buffer, trigger a REST fetch using the existing `GET /api/control-center/logs/:taskId` endpoint with a `before` cursor param. Prepend older logs to the buffer. This is the only new behavior — a cursor param on an existing endpoint.

### Key Implementation Details

- Install `@tanstack/react-virtual`
- Virtualize the log container — only render visible rows + small overscan buffer
- Keep auto-scroll-to-bottom behavior (follow mode) as default
- Preserve the existing SSE streaming — just virtualize the render layer
- Add "load older" trigger when scrolling past buffer top
- Each row gets the log color coding from #3 (applied at render time)

### Files to Create/Modify

```
frontend/src/components/logs/VirtualLogViewer.tsx         # New virtualized log component
frontend/src/pages/Dashboard/MainDashboard.tsx            # MODIFY — replace inline log rendering with VirtualLogViewer
api/src/routes/control-center/logs.ts                     # MODIFY — add `before` cursor param to GET endpoint (minor)
```

---

## 3. Log Level Color Coding

**Priority: P1 — Quick Win**
**Effort: Tiny**
**Reference:** `apps/webapp/app/components/logs/LogsTable.tsx`

### What Trigger.dev Does

Uses **inset box-shadow** (not border) for level indicators — performs better during scroll because box-shadow doesn't affect layout.

> **See:** `reference-screenshots/trigger-dev/09-v3-logs-page.png` (log table rows with colored indicators)

```css
box-shadow: inset 2px 0 0 0 rgb(239, 68, 68); /* ERROR = red */
box-shadow: inset 2px 0 0 0 rgb(234, 179, 8);  /* WARN = amber */
box-shadow: inset 2px 0 0 0 rgb(59, 130, 246);  /* INFO = blue */
box-shadow: inset 2px 0 0 0 rgb(148, 163, 184); /* DEBUG = neutral */
```

### What WorkerMill Should Build

Our logs are currently unstyled monospace text. Add a 2px colored left edge per log line based on content. This is **pure render-time pattern matching** on the `message` string — no changes to the SSE stream or log storage.

| Pattern | Color | Meaning |
|---------|-------|---------|
| `[ERROR]`, `Error:`, stack traces | Red (`#EF4444`) | Errors |
| `[WARN]`, `Warning:` | Amber (`#EAB308`) | Warnings |
| `[Epic]`, `[Executor]`, `[GitOps]` | Blue (`#3B82F6`) | System events |
| `[quality-runner]`, `QUALITY` | Purple (`#8B5CF6`) | Quality checks |
| `REVIEW_DECISION`, `[tech_lead]` | Indigo (`#6366F1`) | Review events |
| `[BLOCKER]`, `escalat` | Red (`#EF4444`) | Blockers |
| Persona prefix `[emoji persona]` | Teal (`#14B8A6`) | Expert activity |
| Default | Slate (`#94A3B8`) | General |

### How It Integrates

The color function receives a `StreamingLog` object (already has `message`, `severity`, `logType` fields). Pattern matching uses these existing fields — no new data needed. Applied per-row inside the VirtualLogViewer (#2) or the existing inline renderer.

### Files to Create/Modify

```
frontend/src/components/logs/log-colors.ts               # NEW — color classification function
frontend/src/components/logs/VirtualLogViewer.tsx         # Apply colors per row (if #2 is done first)
frontend/src/pages/Dashboard/MainDashboard.tsx            # MODIFY — apply colors to existing inline log rendering (fallback if #2 not yet done)
frontend/src/components/TerminalLogViewer.tsx             # MODIFY — apply colors to historical log viewer too
```

---

## 4. Animated In-Progress Tile Pattern

**Priority: P2 — Polish**
**Effort: Tiny**
**Reference:** `apps/webapp/tailwind.config.js` — `animate-tile-scroll` keyframes

### What Trigger.dev Does

In-progress task rows have a subtle **diagonal stripe animation** — a repeating tile pattern that scrolls diagonally using CSS `background-image` with `repeating-linear-gradient`. Pure CSS, no JavaScript re-renders.

```css
@keyframes tile-scroll {
  0% { background-position: 0 0; }
  100% { background-position: 8px 8px; }
}
```

### What WorkerMill Should Build

Apply this animated stripe pattern to:
- Task cards in `running` status on the dashboard
- The active story row in the timeline (if #1 is built)
- The log viewer header while streaming is active

Replace the current static "Running" badge with a visually alive indicator.

### How It Integrates

Pure CSS addition. No JavaScript changes to streaming or state. The animation class is conditionally applied based on the existing `task.status === 'running'` check that's already in the dashboard.

### Files to Modify

```
frontend/tailwind.config.ts                           # Add tile-scroll animation keyframes
frontend/src/pages/Dashboard/MainDashboard.tsx        # MODIFY — add animation class to running task cards
frontend/src/components/timeline/TimelineSpan.tsx      # Apply to in-progress spans (if #1 is built)
```

---

## 5. Granular Status States

**Priority: P1 — Better Lifecycle Visibility**
**Effort: Medium**
**Reference:** `apps/webapp/app/components/runs/v3/TaskRunStatus.tsx` — 16 distinct states

> **See:** `reference-screenshots/trigger-dev/12-retrying.png` (retry state), `14-priority-runs.png` (queue visibility)

### Current WorkerMill Statuses vs. Proposed

| Current | Gap | Proposed Addition |
|---------|-----|-------------------|
| `queued` | No visibility into planning vs. waiting | `planning`, `queued` |
| `running` | No distinction between phases | `executing`, `reviewing`, `revising` |
| — | No "done but imperfect" state | `completed_with_warnings` |
| `completed` | Only binary pass/fail | `completed` (quality >= 85) |
| `escalated` | Good, keep it | `escalated` |
| `cancelled` | Good, keep it | `cancelled` |
| `failed` | No retry visibility | `failed`, `retrying` |

### Key New Statuses

- **`planning`** — planner-critic loop is running (distinct from `queued`)
- **`reviewing`** — tech lead is reviewing stories (distinct from `executing`)
- **`revising`** — revision cycle in progress (currently invisible)
- **`completed_with_warnings`** — PR created but quality score < 85 (e.g., TB-8 run 1 scored 71)
- **`retrying`** — blocker auto-retry in progress

### How It Integrates

Status is already a field on `WorkerTask` model and flows through the existing dashboard SSE stream (`GET /api/control-center/stream` polls every 5s). The worker and orchestrator already set status — we add new enum values and update the points where status transitions happen.

**Frontend impact:** The dashboard already renders status badges per task card. We replace the current status rendering with a centralized component that maps status → color + icon.

**Backend impact:** Add new enum values to the `WorkerTask` model. Workers set these via existing `POST /api/tasks/:id/status` calls. DB migration adds new allowed values (backward-compatible — existing tasks keep their current status).

### Status Color Mapping

```typescript
const STATUS_COLORS: Record<TaskStatus, string> = {
  queued:                   '#94A3B8', // slate
  planning:                 '#A78BFA', // violet
  executing:                '#3B82F6', // blue
  reviewing:                '#6366F1', // indigo
  revising:                 '#F59E0B', // amber
  retrying:                 '#F97316', // orange
  completed:                '#22C55E', // green
  completed_with_warnings:  '#EAB308', // yellow
  escalated:                '#EF4444', // red
  cancelled:                '#6B7280', // gray
  failed:                   '#DC2626', // red-600
}
```

### Status Icons (Heroicons)

```typescript
const STATUS_ICONS: Record<TaskStatus, HeroIcon> = {
  queued:                   ClockIcon,
  planning:                 LightBulbIcon,
  executing:                PlayIcon,
  reviewing:                EyeIcon,
  revising:                 ArrowPathIcon,
  retrying:                 ArrowPathIcon,
  completed:                CheckCircleIcon,
  completed_with_warnings:  ExclamationTriangleIcon,
  escalated:                ExclamationCircleIcon,
  cancelled:                XCircleIcon,
  failed:                   XCircleIcon,
}
```

### Files to Create/Modify

```
frontend/src/components/status/TaskStatus.tsx         # NEW — centralized status component
frontend/src/components/status/TaskStatusIcon.tsx      # NEW — icon-only variant
frontend/src/components/status/TaskStatusCombo.tsx     # NEW — icon + label combo
frontend/src/components/status/status-colors.ts        # NEW — color/icon mapping
api/src/models/WorkerTask.ts                           # MODIFY — add new status enum values
api/src/db/migrations/                                 # NEW — migration to add enum values
frontend/src/pages/Dashboard/MainDashboard.tsx         # MODIFY — use new status component in task cards
```

### Migration Consideration

New statuses must be backward-compatible. Existing tasks stay in their current status. The API must accept old status values during transition. Use `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for PostgreSQL enum extension.

---

## 6. Three-Pane Resizable Task Detail Layout

**Priority: P2 — Power User Feature**
**Effort: Large (was Medium — upgraded after architecture review)**
**Reference:** `apps/webapp/app/components/primitives/Resizable.tsx`, `react-resizable-panels`

### What Trigger.dev Does

Task detail view is a 3-pane layout with user-resizable panels. Panel sizes persist to localStorage via a snapshot service. Uses `react-resizable-panels` library.

> **See:** `reference-screenshots/trigger-dev/06-run-inspector-overview.jpg` (multi-panel inspector), `09-v3-logs-page.png` (logs + detail side panel), `11-otel-traces.png` (tree + timeline + inspector three-pane)

```
┌──────────┬─────────────────┬──────────┐
│ TreeView │   Timeline      │ Inspector│
│ (spans)  │   (execution)   │ (detail) │
│          │                 │          │
└──────────┴─────────────────┴──────────┘
```

### What WorkerMill Should Build

Replace the current single-column expanded task card with a three-pane layout. **Blockers and the Talk button stay full-width above the panes** — they must never be hidden inside a panel.

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ BLOCKER: Story 3 — TypeScript error  [Retry] [Skip]  │  ← Full-width, always visible
├──────────┬──────────────────────────────┬───────────────┤
│ Stories  │  Log Stream (virtualized)    │ Detail        │
│ ──────── │  [🔧 backend_dev 🤖]        │ ──────────    │
│ ● Story 0│  Tool: Edit → auth.ts       │ Files Changed │
│   Story 1│  Fixed the middleware...     │  src/lib/     │
│   Story 2│  Tool: Bash → npm test      │    auth.ts    │
│ ● Story 3│  Tests passing (12/12)      │  src/routes/  │
│ ──────── │  [quality-runner] Score: 92  │    api.ts     │
│ Comms    │                              │ ──────────    │
│ (tab)    │                              │ Errors        │
│          │                              │  2 TypeScript │
├──────────┴──────────────────────────────┴───────────────┤
│ [💬 Talk to Worker]                    [⏸ Pause Follow] │  ← Footer bar, always visible
└─────────────────────────────────────────────────────────┘
```

### Critical Layout Rules

1. **Blocker alerts render ABOVE all panes** as a full-width bar. A blocker must never be hidden behind a collapsed pane or buried in a tab. `BlockerAlert.tsx` stays as a standalone component.
2. **Talk button and Follow toggle render BELOW all panes** in a fixed footer bar. Always accessible.
3. **Both SSE connections stay active** — log stream feeds center pane, coordination stream feeds left pane (Comms tab) and blocker bar.
4. **Mobile (< 768px):** Collapse to single column with tabs (Stories | Logs | Detail) instead of three panes. Blocker alert and Talk button stay fixed.

### How It Integrates With Existing Streaming

**Center pane (Log Stream):**
- Receives data from existing `streamingLogs[taskId]` buffer (no change)
- Renders via VirtualLogViewer (#2) with log colors (#3)
- SSE connection stays in MainDashboard.tsx (or extracted hook)

**Left pane — Story Tree + Comms (tabs):**
- **Stories tab:** Reads from coordination store — filters `story_claimed`, `completion`, `revision_requested` messages to build story status tree. No new data fetching.
- **Comms tab:** Embeds existing `CoordinationFeed.tsx` component (unchanged). Its SSE connection stays in its Zustand store.

**Right pane — Detail:**
- **Files Changed:** Reads from coordination store — filters `file_created`, `file_modified` messages. No new data fetching.
- **Errors:** Reads from existing error parsing in MainDashboard.tsx (already parses streaming logs for error keywords).

**Above panes — Blocker Alert:**
- Existing `BlockerAlert.tsx` component, same props, same positioning logic from MainDashboard.tsx.

### Architectural Decision: Extract from MainDashboard.tsx

MainDashboard.tsx is 2,700+ lines because it contains everything inline. The three-pane layout requires extracting the expanded task detail into its own component:

```
MainDashboard.tsx (task list, SSE connections, state management)
    └── TaskDetailView.tsx (NEW — expanded task detail with 3 panes)
            ├── BlockerAlert.tsx (existing, full-width above panes)
            ├── ResizablePanels.tsx (NEW — wrapper)
            │   ├── StoryTree.tsx (NEW — left pane)
            │   ├── VirtualLogViewer.tsx (center pane, from #2)
            │   └── DetailPane.tsx (NEW — right pane)
            ├── CoordinationFeed.tsx (existing, embedded in left pane tab)
            └── TaskDetailFooter.tsx (NEW — Talk button + Follow toggle)
```

MainDashboard.tsx keeps: SSE connection management, `streamingLogs` state, error parsing, task list rendering.
TaskDetailView.tsx gets: the expanded card layout, pane arrangement, story filtering.

### Key Implementation Details

- Install `react-resizable-panels`
- Save panel sizes to localStorage (key per user/layout)
- Collapse panes on mobile (< 768px) — single column with tabs instead
- Double-click divider to reset to default sizes
- Story selection in left pane filters logs in center pane (client-side filter on `streamingLogs`)

### Files to Create/Modify

```
frontend/src/components/layout/ResizablePanels.tsx     # NEW — wrapper with localStorage persistence
frontend/src/components/tasks/TaskDetailView.tsx        # NEW — extracted task detail (hosts 3 panes)
frontend/src/components/tasks/StoryTree.tsx             # NEW — left pane story navigation
frontend/src/components/tasks/DetailPane.tsx            # NEW — right pane (files + errors)
frontend/src/components/tasks/TaskDetailFooter.tsx      # NEW — Talk button + Follow toggle footer
frontend/src/pages/Dashboard/MainDashboard.tsx          # MODIFY — extract expanded card into TaskDetailView
```

---

## 7. Feature-Colored Navigation Icons

**Priority: P3 — Polish**
**Effort: Tiny**
**Reference:** `apps/webapp/tailwind.config.js` — feature color tokens

### What Trigger.dev Does

Each sidebar section has a distinct icon color:
- Tasks → `blue-500`
- Runs → `indigo-500`
- Batches → `pink-500`
- Schedules → `yellow-500`
- Deployments → `green-500`

### What WorkerMill Should Build

Apply semantic colors to our sidebar icons:

| Section | Color | Hex |
|---------|-------|-----|
| Dashboard | Blue | `#3B82F6` |
| Tasks | Indigo | `#6366F1` |
| Analytics | Green | `#22C55E` |
| Settings | Slate | `#64748B` |
| Docs | Purple | `#8B5CF6` |
| Personas | Amber | `#F59E0B` |

### Files to Modify

```
frontend/src/components/Sidebar.tsx    # MODIFY — add color to nav icons
```

---

## Implementation Order

| Phase | Items | Scope | Risk to Streaming |
|-------|-------|-------|-------------------|
| **Phase 1** | Log level colors (#3), Animated tiles (#4), Nav colors (#7) | Quick wins — pure CSS/component changes | **None** — no streaming code touched |
| **Phase 2** | Virtual scrolling (#2), Granular statuses (#5) | Core infrastructure improvements | **Low** — #2 wraps existing buffer, #5 adds enum values |
| **Phase 3** | Epic timeline (#1), 3-pane layout (#6) | Major new features | **Medium** — #6 restructures MainDashboard.tsx (extraction, not rewrite) |

### Phase 1 Validation Checklist

Before moving to Phase 2, verify:
- [ ] Log colors render correctly for all message types (errors red, system blue, etc.)
- [ ] Animated tile plays on running task cards, stops on completion
- [ ] Sidebar icons have correct colors
- [ ] SSE log streaming still works (start a task, verify live logs appear)
- [ ] Blocker alerts still render and retry/skip/abort still work
- [ ] CoordinationFeed still shows messages in real-time

### Phase 2 Validation Checklist

Before moving to Phase 3, verify:
- [ ] Virtual log viewer renders 1,000+ lines without DOM bloat (check Elements panel)
- [ ] Follow mode auto-scrolls on new logs, pauses when user scrolls up
- [ ] "Load older" works when scrolling past buffer top
- [ ] New status values (planning, reviewing, etc.) display with correct colors/icons
- [ ] Status transitions visible in real-time as tasks progress
- [ ] Both SSE streams still functioning

### Phase 3 Validation Checklist

After completion, verify:
- [ ] Three-pane layout renders with resizable dividers
- [ ] Blocker alert appears ABOVE panes (full width), not inside a pane
- [ ] Talk button accessible in footer bar
- [ ] Story tree shows correct story statuses from coordination feed
- [ ] Clicking a story filters log viewer to that story's logs
- [ ] Timeline shows parallel expert execution with correct durations
- [ ] Panel sizes persist across page reloads (localStorage)
- [ ] Mobile layout collapses to tabs
- [ ] All SSE connections survive panel resize/collapse
- [ ] Error panel in right pane updates in real-time

## Testing

All changes tested via Local WorkerMill (`./bin/local-workermill start`). Run a task and verify:
- Log stream connects and renders in real-time (SSE, not polling fallback)
- Blocker alert appears when a story escalates, retry/skip/abort buttons work
- CoordinationFeed shows context messages with correct threading
- Timeline renders correctly for parallel expert execution
- Log viewer handles 10k+ lines without degradation
- Status transitions are visible in real-time
- Resizable panels persist across page reloads

## Visual References

Screenshots from Trigger.dev's public changelog and documentation, stored in `docs/reference-screenshots/trigger-dev/`.

### Key References (mapped to our improvements)

| Screenshot | What It Shows | Maps To |
|------------|---------------|---------|
| `01-run-timeline-definitions.png` | 6 timeline states (Triggered → Completed) shown as vertical progress indicators with colored dots and duration labels between each state | **#1 Epic Timeline** — Our timeline will be horizontal (parallel stories) but the state progression and duration display patterns apply directly |
| `02-attempt-span-timeline.png` | Attempt-level timeline states with finer granularity | **#1 Epic Timeline** — Shows how sub-tasks (attempts) nest within runs, similar to our stories within epics |
| `03-span-timeline.png` | Individual span timeline states | **#1 Epic Timeline** — Smallest unit of work visualization |
| `06-run-inspector-overview.jpg` | Side-by-side inspector panels — Overview/Detail/Context tabs, status badge, timeline bar at top, Payload JSON, Output JSON | **#6 Three-Pane Layout** — Their inspector panel pattern maps to our right pane (Detail). The tab pattern (Overview/Detail/Context) could work for our story detail view |
| `07-run-inspector.jpg` | Live timer animation showing "Triggered → Started → 37.6s" with animated spinner on active step | **#1 Epic Timeline** — The `LiveTimer.tsx` component pattern. Shows elapsed time updating in real-time for the active span |
| `09-v3-logs-page.png` | **MOST VALUABLE** — Full logs page: sidebar nav with section counts, search/filter bar (Errors only toggle, Task/Environment/Version/Time dropdowns, Live toggle), log table with Timestamp/Task ID/Summary columns, right-side detail panel | **#2 Virtual Scrolling, #3 Log Colors, #6 Three-Pane Layout** — This is their complete logs UX. The filter bar, live toggle, and detail panel on the right are all patterns we should adopt |
| `11-otel-traces.png` | **MOST VALUABLE** — Trace view: left-side hierarchical tree (ROOT → Attempt → prisma operations), horizontal duration bars per span with time axis (0ms → 1.1s), right-side inspector with Properties JSON | **#1 Epic Timeline, #6 Three-Pane Layout** — This is closest to what our epic timeline + story tree should look like. The hierarchical tree on the left = our Story Tree. The duration bars = our timeline spans |
| `12-retrying.png` | Retry UI showing "By default we retry 3 times" with retry configuration | **#5 Granular Statuses** — Their `retrying` state visualization |
| `14-priority-runs.png` | Priority run queue UI showing task prioritization | **#5 Granular Statuses** — Queue visibility pattern |
| `15-limits-page.png` | Concurrency limits dashboard | General reference — capacity management UI pattern |
| `16-v3-deployments.png` | Deployments page with version history | General reference — deployment history UI pattern |

### Additional References

| Screenshot | Notes |
|------------|-------|
| `08-v3-dashboard.png` | Just the v3 logo graphic — not useful as UI reference |
| `10-observability-hero.png` | Observability product hero banner |
| `13-run-replay.png` | Run replay interface — interesting but not in our current scope |

### Video References (local only, not in git — 54MB total)

Stored at `~/.workermill/reference-videos/` (too large for git):

| Video | What It Shows |
|-------|---------------|
| `video-run-timeline.mp4` | Animated timeline demo — shows how spans render and update in real-time |
| `video-run-inspector.mp4` | Inspector interaction — tab switching, payload viewing, live timer |
| `video-dashboard-improvements.mp4` | Dashboard improvements overview — filters, search, layout |

---

## Dependencies to Add

```bash
cd frontend
npm install @tanstack/react-virtual react-resizable-panels
```

No other new dependencies required — we already use Tailwind, Heroicons, and Recharts.
