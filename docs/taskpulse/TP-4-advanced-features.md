# TP-4: Scheduling, API Keys & Polish

> **TaskPulse Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/taskpulse`](https://github.com/workermill-examples/taskpulse)
> Architecture: [README.md](./README.md)

---

## What This Ticket Delivers

Schedule management UI, API key management UI, global search, keyboard shortcuts, responsive polish, and comprehensive unit tests. This epic adds the power-user features that make TaskPulse feel like a production developer tool.

## Scope Boundary

**TP-1/TP-2/TP-3 already created (do NOT recreate):** All page files, all component files (Sidebar, Header, RunsTable, RunTimeline, RunLogs, RunStatusBadge, TriggerRunDialog, TaskCard, TaskConfig, Charts, LoadingSpinner, ErrorBoundary, EmptyState), all API routes except schedules and API keys, E2E tests, useSSE hook.

**This ticket creates:** Schedule components, API key components, schedule API routes, API key API routes, keyboard shortcuts hook, global search component, unit tests.

**This ticket modifies:** `src/app/[project]/settings/page.tsx` (add API key management section), `src/app/[project]/schedules/page.tsx` (replace stub with full schedule UI), `src/app/[project]/layout.tsx` (add GlobalSearch, KeyboardShortcutsHelp, and keyboard shortcuts integration). **Group all modifications to the same file in the same story as related new files.**

**TP-5 creates:** vercel.json, production config. Do NOT create vercel.json.

## Prerequisites

TP-3 complete — all UI pages functional, dashboard charts rendering, E2E tests passing.

---

## CRITICAL — Patterns

**Next.js 16 async params:** All route handlers use `Promise<{ param }>` and `await params`.

**Dark theme:** All new components use `bg-gray-900`/`bg-gray-950` backgrounds, `text-gray-100`/`text-gray-400` text.

**Icons:** Use inline SVG elements or Unicode characters. Do NOT use `@heroicons/react`.

---

## Work Groups

### Work Group 1: Schedule API Routes (2 files)

**Files:**
- `src/app/api/projects/[slug]/schedules/route.ts` — GET list, POST create (MEMBER+)
- `src/app/api/projects/[slug]/schedules/[id]/route.ts` — GET detail, PUT update (MEMBER+), DELETE (ADMIN+)

**GET /api/projects/[slug]/schedules:**
- Returns schedules with task displayName included
- Includes `lastRunAt` and `nextRunAt`
- Ordered by createdAt descending

**POST /api/projects/[slug]/schedules:**
- Body: `{ taskId, cronExpression, description?, timezone?, enabled? }`
- Validates cron expression using `cron-parser`
- Calculates and sets `nextRunAt` from cron expression
- Returns created schedule

**PUT /api/projects/[slug]/schedules/[id]:**
- Update any field: cronExpression, description, timezone, enabled
- Recalculate `nextRunAt` when cron or timezone changes
- When disabled: set `nextRunAt` to null

**DELETE /api/projects/[slug]/schedules/[id]:**
- ADMIN+ required
- Hard delete

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 2: API Key Routes (2 files)

**Files:**
- `src/app/api/projects/[slug]/api-keys/route.ts` — GET list, POST create (ADMIN+)
- `src/app/api/projects/[slug]/api-keys/[id]/route.ts` — DELETE revoke (ADMIN+)

**GET /api/projects/[slug]/api-keys:**
- Returns API keys with `keyPrefix` (NOT the full key), name, lastUsedAt, expiresAt, createdAt
- ADMIN+ required

**POST /api/projects/[slug]/api-keys:**
- Body: `{ name, expiresAt? }`
- Generates a random API key: `tp_live_` + 32 random hex chars
- Stores bcrypt hash of the full key
- Stores first 16 chars as `keyPrefix` for display
- **Returns the full key ONCE in the response** — it cannot be retrieved again
- ADMIN+ required

**DELETE /api/projects/[slug]/api-keys/[id]:**
- Hard delete (revoke)
- ADMIN+ required

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 3: Schedule UI (3 files)

**Files:**
- `src/components/schedules/ScheduleForm.tsx` — NEW
- `src/components/schedules/CronDisplay.tsx` — NEW
- `src/app/[project]/schedules/page.tsx` — MODIFY (replace stub)

**ScheduleForm and CronDisplay are both client components — add `"use client"` to each.**

**CronDisplay (`src/components/schedules/CronDisplay.tsx`):**
- Takes a cron expression string
- Renders human-readable description (e.g., "Every day at 2:00 AM UTC") using `cronstrue` (`import cronstrue from "cronstrue"` → `cronstrue.toString(cronExpression)`)
- Uses `cron-parser` to compute next 3 upcoming execution times (parse + iterator)
- Shows the raw cron expression in monospace below the description
- Color: `text-gray-300` for description, `text-gray-500 font-mono` for raw cron

**ScheduleForm (`src/components/schedules/ScheduleForm.tsx`):**
- Headless UI Dialog for create/edit
- Fields:
  - Task selector (dropdown of task definitions)
  - Cron expression input (monospace, with live preview via CronDisplay)
  - Description (optional textarea)
  - Timezone selector (common timezones: UTC, US/Eastern, US/Pacific, Europe/London, Asia/Tokyo)
  - Enabled toggle
- Validation: cron expression must be valid (parse with cron-parser)
- Submit → POST or PUT to schedules endpoint

**Schedules page:**
- Server component: fetch schedules for project
- Table/card list of schedules:
  - Description / cron expression
  - Task name
  - Enabled/disabled toggle
  - Last run time
  - Next run time
  - CronDisplay for each
- "Create Schedule" button → ScheduleForm
- Edit button per schedule → ScheduleForm (edit mode)
- Delete button per schedule (ADMIN+ only, confirmation)
- Empty state

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 4: API Key UI + Settings Update (1 file)

**Files:**
- `src/app/[project]/settings/page.tsx` — MODIFY (add API key section)

**API Key section in Settings (replaces placeholder):**
- API key list: name, keyPrefix (monospace, partially masked: `tp_live_a1b2...`), lastUsedAt, createdAt
- "Create API Key" button → dialog:
  - Name input
  - Expiration date (optional)
  - On submit: shows the full key ONCE in a copyable field with "Copy" button
  - Warning: "This key won't be shown again. Copy it now."
- Delete/Revoke button per key (confirmation dialog)
- ADMIN+ required for all operations
- Non-admin users see: "Contact a project admin to manage API keys."

**Usage example box:**
Below the API key list, show a dark code block with:
```
curl -X POST https://taskpulse.workermill.com/api/trigger \
  -H "Authorization: Bearer tp_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"task": "send-welcome-email", "input": {"email": "user@example.com"}}'
```

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 5: Keyboard Shortcuts + Global Search (4 files)

**Files:**
- `src/hooks/useKeyboardShortcuts.ts` — NEW
- `src/components/shared/GlobalSearch.tsx` — NEW (`"use client"` — keyboard events, Headless UI Dialog, localStorage, debounced search)
- `src/components/shared/KeyboardShortcutsHelp.tsx` — NEW (`"use client"` — modal with keyboard event listener)
- `src/app/[project]/layout.tsx` — MODIFY (add GlobalSearch, KeyboardShortcutsHelp, and useKeyboardShortcuts integration)

> **Integration:** The project layout must render `<GlobalSearch />` and `<KeyboardShortcutsHelp />` alongside the existing Sidebar/Header. Since these components use hooks and browser APIs, wrap them in a client component boundary within the layout. The `useKeyboardShortcuts` hook should be called from this same client wrapper to register global shortcuts.

**useKeyboardShortcuts hook:**
- Global keyboard event handler
- Shortcuts:
  - **/** or **Ctrl/Cmd+K** — Focus global search
  - **N** — Open trigger run dialog
  - **Esc** — Close modal/dialog/search
  - **?** — Show keyboard shortcuts help
- Smart input detection: disabled when typing in inputs/textareas (except Esc)
- Registers/unregisters on mount/unmount

**GlobalSearch (`src/components/shared/GlobalSearch.tsx`):**
- Search overlay (Headless UI Dialog) triggered by Ctrl/Cmd+K or /
- Dark overlay: `bg-gray-950/80 backdrop-blur-sm`
- Search input: monospace, large text, dark background
- Debounced search (300ms) → queries existing API endpoints: `GET /api/projects/[slug]/runs` (with status/task filters) and `GET /api/projects/[slug]/tasks` (filtered by displayName). No dedicated search endpoint needed.
- Results grouped: "Runs" section and "Tasks" section
- Each result: name/title, status badge (for runs), task name (for runs)
- Keyboard navigation: arrow keys to navigate, Enter to select
- Recent searches stored in localStorage

**KeyboardShortcutsHelp:**
- Simple modal showing all available shortcuts in a table
- Triggered by pressing `?`
- Dark themed consistent with the rest

**After completing, run:** `npm run typecheck` — must pass with 0 errors.

---

### Work Group 6: Unit Tests (3 files)

**Files:**
- `tests/unit/schedules.test.ts` — Schedule route tests
- `tests/unit/api-keys.test.ts` — API key route tests
- `tests/unit/hooks.test.ts` — useKeyboardShortcuts tests

**Test coverage:**
- Schedule CRUD: 10+ tests (create, list, update, delete, cron validation, enable/disable, nextRunAt calculation)
- API key management: 8+ tests (create, list prefix only, delete/revoke, auth check, full key returned once)
- Keyboard shortcuts: 10+ tests (shortcut firing, input detection, modifier keys, cleanup)

**After completing, run:** `npm run typecheck && npm run test` — all must pass.

---

## Definition of Done

- [ ] Schedule CRUD (API + UI) fully functional
- [ ] API key management (API + UI) fully functional
- [ ] Cron expression display with human-readable descriptions
- [ ] Global search working with Ctrl/Cmd+K
- [ ] Keyboard shortcuts registered and functional
- [ ] Usage example in API key settings
- [ ] 30+ new unit tests passing
- [ ] All existing tests still passing
- [ ] `npm run typecheck` — 0 errors
- [ ] `npm run lint` — 0 errors

## Estimated Plan Size

5-7 stories.
