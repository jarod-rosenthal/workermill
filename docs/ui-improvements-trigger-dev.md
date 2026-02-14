# UI Improvements — Inspired by Trigger.dev

> Reference repo: [github.com/triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev)
> Testing environment: Local WorkerMill only — DO NOT deploy to prod
> Visual references: `docs/reference-screenshots/trigger-dev/`

## Overview

Trigger.dev is an open-source task orchestration platform with a polished developer dashboard. Their UI patterns for visualizing task execution, real-time logs, and status management are directly applicable to WorkerMill. This document captures specific patterns worth adopting, prioritized by impact.

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

The coordination feed (`GET /api/coordination/feed/:taskId`) and worker task logs already contain timestamps for story start/complete events. The timeline component would parse these to build the visualization.

### Files to Create/Modify

```
frontend/src/components/timeline/EpicTimeline.tsx       # Main timeline component
frontend/src/components/timeline/TimelineSpan.tsx        # Individual span (story/phase)
frontend/src/components/timeline/TimelineContext.tsx      # React context for mouse tracking
frontend/src/components/timeline/timeline-utils.ts       # lerp/inverseLerp math utilities
frontend/src/components/timeline/LiveTimer.tsx            # Real-time elapsed timer
frontend/src/pages/TaskDetail.tsx                         # MODIFY — add timeline above log stream
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

Replace the current log viewer's growing DOM (every SSE event appends a div) with virtualized rendering. On long-running epics (11+ stories, 30k+ log lines), the current approach causes visible performance degradation — scrolling becomes janky and the browser tab uses excessive memory.

### Key Implementation Details

- Install `@tanstack/react-virtual`
- Virtualize the log container — only render visible rows + small overscan buffer
- Keep auto-scroll-to-bottom behavior (follow mode)
- Preserve the existing SSE streaming — just virtualize the render layer
- Add infinite scroll for loading older logs when scrolling up

### Files to Create/Modify

```
frontend/src/components/logs/VirtualLogViewer.tsx    # New virtualized log component
frontend/src/pages/TaskDetail.tsx                     # MODIFY — replace current log div
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

Our logs are currently unstyled monospace text. Add a 2px colored left edge per log line based on content:

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

### Files to Modify

```
frontend/src/components/logs/LogLine.tsx    # MODIFY or CREATE — add color coding
frontend/src/pages/TaskDetail.tsx           # MODIFY — use updated log line component
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
- The active story row in the timeline
- The log viewer header while streaming is active

Replace the current static "Running" badge with a visually alive indicator.

### Files to Modify

```
frontend/tailwind.config.ts                           # Add tile-scroll animation keyframes
frontend/src/components/tasks/TaskCard.tsx             # MODIFY — add animation to running cards
frontend/src/components/timeline/TimelineSpan.tsx      # Apply to in-progress spans (new component)
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
frontend/src/components/tasks/TaskCard.tsx              # MODIFY — use new status component
frontend/src/pages/Dashboard.tsx                        # MODIFY — update status filter options
```

### Migration Consideration

New statuses must be backward-compatible. Existing tasks stay in their current status. The API must accept old status values during transition.

---

## 6. Three-Pane Resizable Task Detail Layout

**Priority: P2 — Power User Feature**
**Effort: Medium**
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

Replace the current single-column task detail with a 3-pane layout:

```
┌──────────┬─────────────────────────────┬────────────┐
│ Stories  │   Logs (streaming)          │ Files      │
│          │                             │ Changed    │
│ ● Story 0│ [🔧 backend_dev 🤖]        │            │
│   Story 1│ Tool: Edit → auth.ts        │ src/       │
│   Story 2│ Fixed the middleware...      │  lib/      │
│ ● Story 3│ Tool: Bash → npm run test   │   auth.ts  │
│   Story 4│ Tests passing (12/12)        │  routes/   │
│          │ [quality-runner] Score: 92   │   api.ts   │
│          │                             │            │
└──────────┴─────────────────────────────┴────────────┘
```

**Left pane — Story Tree:**
- Collapsible tree of stories with status icons
- Click to filter logs to that story
- Shows expert persona per story
- Highlights currently active story

**Center pane — Log Stream:**
- Existing SSE log viewer (with new virtual scrolling + color coding)
- Filtered by selected story (or show all)
- Timeline visualization at the top

**Right pane — File Inspector:**
- Tree of files changed by the selected story
- Click to view diff (if available via coordination feed)
- Shows total files changed count
- Collapsible file tree

### Key Implementation Details

- Install `react-resizable-panels`
- Save panel sizes to localStorage (key per user/layout)
- Collapse panes on mobile (< 768px) — single column with tabs instead
- Double-click divider to reset to default sizes

### Files to Create/Modify

```
frontend/src/components/layout/ResizablePanels.tsx     # NEW — wrapper with localStorage persistence
frontend/src/components/tasks/StoryTree.tsx             # NEW — left pane story navigation
frontend/src/components/tasks/FileInspector.tsx         # NEW — right pane file tree
frontend/src/pages/TaskDetail.tsx                       # MODIFY — replace with 3-pane layout
```

---

## 7. Feature-Colored Navigation Icons

**Priority: P3 — Polish**
**Effort: Tiny**
**Reference:** `apps/webapp/tailwind.config.js` — feature color tokens

### What Trigger.dev Does

Each sidebar section has a distinct icon color:
- 🔵 Tasks → `blue-500`
- 🟣 Runs → `indigo-500`
- 🩷 Batches → `pink-500`
- 🟡 Schedules → `yellow-500`
- 🟢 Deployments → `green-500`

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

| Phase | Items | Estimated Scope |
|-------|-------|-----------------|
| **Phase 1** | Log level colors (#3), Animated tiles (#4), Nav colors (#7) | Quick wins — pure CSS/component changes |
| **Phase 2** | Virtual scrolling (#2), Granular statuses (#5) | Core infrastructure improvements |
| **Phase 3** | Epic timeline (#1), 3-pane layout (#6) | Major new features |

## Testing

All changes tested via Local WorkerMill (`./bin/local-workermill start`). Run a task and verify:
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
| `06-run-inspector-overview.jpg` | Side-by-side inspector panels — Overview/Detail/Context tabs, status badge, timeline bar at top, Payload JSON, Output JSON | **#6 Three-Pane Layout** — Their inspector panel pattern maps to our right pane (File Inspector). The tab pattern (Overview/Detail/Context) could work for our story detail view |
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
