# TaskPulse — Architecture & Specification

> A real-time background task monitoring dashboard, built entirely by autonomous AI workers.
> Inspired by [trigger.dev](https://trigger.dev). Built by [WorkerMill](https://workermill.com).

**Live demo:** [taskpulse.workermill.com](https://taskpulse.workermill.com)
**Repository:** [workermill-examples/taskpulse](https://github.com/workermill-examples/taskpulse)

---

## Product Concept

TaskPulse is a developer-facing dashboard for orchestrating and monitoring background tasks. Define task types with retry policies, trigger them via API or cron schedule, and watch execution in real-time with step-level traces, structured logs, and analytics.

**Think of it as:** A lightweight, self-hosted alternative to Trigger.dev — focused on the observability and monitoring experience rather than managed infrastructure.

### What It Does

1. **Task Registry** — Define task types with retry policies, timeouts, concurrency limits, and step templates
2. **Run Monitoring** — Real-time execution traces showing each step with timing, status, and output
3. **Log Streaming** — Structured logs with level filtering (DEBUG/INFO/WARN/ERROR), streamed via SSE
4. **Scheduling** — Cron-based task triggers with timezone support and enable/disable
5. **API Triggers** — External trigger endpoint authenticated with project-scoped API keys
6. **Dashboard Analytics** — Success rates, execution timing distributions, runs over time, task breakdown
7. **Project Management** — Multi-project with RBAC (Owner/Admin/Member/Viewer)

### What Makes It Distinct from trigger.dev

- **Monitoring-first** — The dashboard IS the product, not a side feature bolted onto an SDK
- **Self-contained** — Single Next.js app with no external worker infrastructure
- **Simulated execution** — Runs execute with realistic timing and step progression for demo purposes (no actual containers)
- **Dark theme** — Developer-tool aesthetic with monospace log viewer and trace timelines
- **Showcase-scoped** — Focused enough to demonstrate WorkerMill's capabilities without being an impossible project

### Demo Flow

1. Landing page → "Try the Demo" → auto-login as demo user
2. See "Acme Backend Services" project with 5 task definitions and 50 historical runs
3. Browse Runs page — filter by status, task, date range
4. Click a run → see trace timeline with step-by-step execution and streaming logs
5. Click "Trigger Run" on a task → new run appears with steps animating through execution
6. Browse Dashboard — charts showing success rate, execution timing, runs over time
7. Manage Schedules, API Keys, Project Members via Settings

---

## Tech Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|-----------|
| Framework | Next.js 16 (App Router) | `^16.1.0` | Full-stack React, Turbopack, SSR — latest stable |
| Language | TypeScript | `^5.9.0` | Type safety, Prisma types, shared interfaces |
| ORM | Prisma 7 | `^7.2.0` | Type-safe DB, driver adapters, ESM-native |
| DB Adapter | @prisma/adapter-neon | `^7.2.0` | Neon serverless driver for Prisma 7 |
| Neon Driver | @neondatabase/serverless | `^1.0.0` | Required peer dep of @prisma/adapter-neon |
| Database | PostgreSQL (Neon) | — | Free tier, connection pooling, reliable |
| Auth | NextAuth.js v5 | `5.0.0-beta.25` | Session-based auth — same pin as TeamBoard |
| Styling | TailwindCSS v4 | `^4.1.0` | CSS-first config, dark theme with utility classes |
| PostCSS | @tailwindcss/postcss | `^4.1.0` | Tailwind v4 PostCSS plugin (replaces `tailwindcss` plugin) |
| UI Components | @headlessui/react | `^2.2.0` | Accessible dialogs, dropdowns, transitions |
| Charts | Recharts | `^3.7.0` | Declarative charts for dashboard |
| Real-time | Server-Sent Events (SSE) | — | Log streaming, run status updates |
| Date Formatting | date-fns | `^4.1.0` | Lightweight date utilities |
| Cron Parsing | cron-parser | `^4.9.0` | Parse cron expressions, compute next runs |
| Cron Description | cronstrue | `^3.9.0` | Human-readable cron descriptions |
| Class Merging | tailwind-merge | `^3.4.0` | Resolve conflicting Tailwind classes in cn() |
| Validation | Zod | `^3.23.0` | Request validation schemas |
| Password Hashing | bcrypt | `^6.0.0` | Signup password hashing |
| ESLint Compat | @eslint/eslintrc | `^3.3.0` | FlatCompat for eslint-config-next in flat config |
| Testing | Vitest + Playwright | `^4.0.0` / `^1.58.0` | Unit + E2E coverage |
| CI/CD | GitHub Actions | — | Lint, typecheck, test, deploy |
| Hosting | Vercel | — | Automatic deploys, Turbopack builds |
| Database Hosting | Neon PostgreSQL | — | Free tier, connection pooling |

### Design System — Dark Theme

The entire app uses a dark color scheme (no light mode toggle). This is a developer tool — dark is the default.

| Element | Tailwind Class | Hex |
|---------|---------------|-----|
| Background | `bg-gray-950` | #030712 |
| Surface/Card | `bg-gray-900` | #111827 |
| Surface Hover | `bg-gray-800` | #1f2937 |
| Border | `border-gray-800` | #1f2937 |
| Text Primary | `text-gray-100` | #f3f4f6 |
| Text Secondary | `text-gray-400` | #9ca3af |
| Accent/Brand | `violet-500` | #8b5cf6 |
| Success | `emerald-500` | #10b981 |
| Error | `red-500` | #ef4444 |
| Warning | `amber-500` | #f59e0b |
| Info/Active | `blue-500` | #3b82f6 |

**Run Status Colors:**

| Status | Color | Extra |
|--------|-------|-------|
| QUEUED | `text-gray-400 bg-gray-400/10` | — |
| EXECUTING | `text-blue-400 bg-blue-400/10` | Animated pulse dot |
| COMPLETED | `text-emerald-400 bg-emerald-400/10` | Checkmark icon |
| FAILED | `text-red-400 bg-red-400/10` | X icon |
| CANCELLED | `text-gray-500 bg-gray-500/10` | Slash icon |
| TIMED_OUT | `text-amber-400 bg-amber-400/10` | Clock icon |

---

## Data Model

Full Prisma schema — 10 models, 4 enums.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  passwordHash  String
  avatarUrl     String?
  createdAt     DateTime  @default(now())
  memberships   ProjectMember[]
}

model Project {
  id          String    @id @default(cuid())
  name        String
  slug        String    @unique
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  members     ProjectMember[]
  tasks       TaskDefinition[]
  runs        Run[]
  schedules   Schedule[]
  apiKeys     ApiKey[]
}

model ProjectMember {
  id        String      @id @default(cuid())
  project   Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId String
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  role      MemberRole  @default(MEMBER)
  joinedAt  DateTime    @default(now())

  @@unique([projectId, userId])
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

model TaskDefinition {
  id            String    @id @default(cuid())
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId     String
  name          String    // machine name: "send-welcome-email"
  displayName   String    // human name: "Send Welcome Email"
  description   String?
  version       String    @default("1.0.0")
  retryLimit    Int       @default(3)
  retryDelay    Int       @default(1000)    // ms between retries
  timeout       Int       @default(300000)  // 5 min default
  concurrency   Int       @default(10)
  inputSchema   Json?     // JSON Schema for input validation
  stepTemplates Json?     // [{ name: "Validate", avgDuration: 500 }, ...]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  runs          Run[]
  schedules     Schedule[]

  @@unique([projectId, name])
}

enum RunStatus {
  QUEUED
  EXECUTING
  COMPLETED
  FAILED
  CANCELLED
  TIMED_OUT
}

model Run {
  id            String      @id @default(cuid())
  project       Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId     String
  task          TaskDefinition @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId        String
  status        RunStatus   @default(QUEUED)
  input         Json?
  output        Json?
  error         String?     @db.Text
  attempt       Int         @default(1)
  maxAttempts   Int         @default(3)
  triggeredBy   String      @default("api")  // "api", "schedule", "manual"
  startedAt     DateTime?
  completedAt   DateTime?
  duration      Int?        // ms
  createdAt     DateTime    @default(now())
  steps         RunStep[]
  logs          RunLog[]
}

model RunStep {
  id          String      @id @default(cuid())
  run         Run         @relation(fields: [runId], references: [id], onDelete: Cascade)
  runId       String
  name        String
  status      RunStatus   @default(QUEUED)
  position    Int         @default(0)
  startedAt   DateTime?
  completedAt DateTime?
  duration    Int?        // ms
  output      Json?
  error       String?
  createdAt   DateTime    @default(now())
}

enum LogLevel {
  DEBUG
  INFO
  WARN
  ERROR
}

model RunLog {
  id        String    @id @default(cuid())
  run       Run       @relation(fields: [runId], references: [id], onDelete: Cascade)
  runId     String
  level     LogLevel  @default(INFO)
  message   String    @db.Text
  metadata  Json?
  timestamp DateTime  @default(now())
}

model Schedule {
  id              String          @id @default(cuid())
  project         Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId       String
  task            TaskDefinition  @relation(fields: [taskId], references: [id], onDelete: Cascade)
  taskId          String
  cronExpression  String
  description     String?
  enabled         Boolean         @default(true)
  timezone        String          @default("UTC")
  lastRunAt       DateTime?
  nextRunAt       DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}

model ApiKey {
  id          String    @id @default(cuid())
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  projectId   String
  name        String
  keyHash     String    // bcrypt hash of the full key
  keyPrefix   String    // first 16 chars for display: "tp_live_a1b2c3d4"
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
}
```

> **Prisma 7 notes:**
> - `provider = "prisma-client"` (NOT `"prisma-client-js"` — that's Prisma 6)
> - `output = "../src/generated/prisma"` outputs the generated client under `src/` for clean `@/generated/prisma` imports
> - Datasource block has NO `url` or `directUrl` — connection strings are configured in `prisma.config.ts`
> - Runtime connection uses `@prisma/adapter-neon` (Neon serverless driver)
> - `prisma.config.ts` provides the direct URL for CLI operations (migrations, push, studio)

---

## File Tree

```
taskpulse/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── prisma.config.ts                               # Prisma 7 config (datasource URL)
├── src/
│   ├── app/
│   │   ├── layout.tsx                              # Root layout (dark theme, providers)
│   │   ├── page.tsx                                # Landing page
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── projects/page.tsx                       # Project list
│   │   ├── [project]/
│   │   │   ├── layout.tsx                          # Sidebar + header layout
│   │   │   ├── page.tsx                            # → redirect to /runs
│   │   │   ├── runs/
│   │   │   │   ├── page.tsx                        # Runs list (main screen)
│   │   │   │   └── [id]/page.tsx                   # Run detail (trace + logs)
│   │   │   ├── tasks/
│   │   │   │   ├── page.tsx                        # Task definitions list
│   │   │   │   └── [id]/page.tsx                   # Task detail + recent runs
│   │   │   ├── schedules/page.tsx                  # Schedule management
│   │   │   ├── dashboard/page.tsx                  # Analytics + charts
│   │   │   └── settings/page.tsx                   # Members, API keys, project config
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── seed/route.ts
│   │       ├── auth/
│   │       │   ├── [...nextauth]/route.ts
│   │       │   └── signup/route.ts
│   │       ├── projects/
│   │       │   ├── route.ts                        # GET list, POST create
│   │       │   └── [slug]/
│   │       │       ├── route.ts                    # GET, PUT, DELETE
│   │       │       ├── members/
│   │       │       │   ├── route.ts                # GET list, POST invite
│   │       │       │   └── [id]/route.ts           # PUT role, DELETE remove
│   │       │       ├── tasks/
│   │       │       │   ├── route.ts                # GET list, POST register
│   │       │       │   └── [id]/route.ts           # GET, PUT, DELETE
│   │       │       ├── runs/
│   │       │       │   ├── route.ts                # GET list, POST trigger
│   │       │       │   └── [id]/
│   │       │       │       ├── route.ts            # GET detail
│   │       │       │       ├── cancel/route.ts     # POST
│   │       │       │       ├── retry/route.ts      # POST
│   │       │       │       └── stream/route.ts     # GET SSE
│   │       │       ├── schedules/
│   │       │       │   ├── route.ts                # GET list, POST create
│   │       │       │   └── [id]/route.ts           # GET, PUT, DELETE
│   │       │       ├── api-keys/
│   │       │       │   ├── route.ts                # GET list, POST create
│   │       │       │   └── [id]/route.ts           # DELETE revoke
│   │       │       └── stats/route.ts              # GET dashboard aggregations
│   │       └── trigger/route.ts                    # POST — external trigger (API key auth)
│   │   ├── globals.css                               # Tailwind v4 CSS-first config
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── runs/
│   │   │   ├── RunsTable.tsx                       # Filterable runs list with pagination
│   │   │   ├── RunTimeline.tsx                     # Trace/waterfall view of steps
│   │   │   ├── RunLogs.tsx                         # Log viewer with level filtering
│   │   │   ├── RunStatusBadge.tsx                  # Status badge (color + icon)
│   │   │   └── TriggerRunDialog.tsx                # Manual trigger modal
│   │   ├── tasks/
│   │   │   ├── TaskCard.tsx                        # Task definition card
│   │   │   └── TaskConfig.tsx                      # Task config display
│   │   ├── schedules/
│   │   │   ├── ScheduleForm.tsx                    # Create/edit schedule
│   │   │   └── CronDisplay.tsx                     # Human-readable cron display
│   │   ├── dashboard/
│   │   │   └── Charts.tsx                          # 4 Recharts visualizations
│   │   └── shared/
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── EmptyState.tsx
│   │       ├── SessionProvider.tsx                  # NextAuth client wrapper
│   │       ├── GlobalSearch.tsx                     # Ctrl/Cmd+K search overlay
│   │       └── KeyboardShortcutsHelp.tsx            # Keyboard shortcuts modal
│   ├── lib/
│   │   ├── auth.ts                                 # NextAuth config
│   │   ├── prisma.ts                               # Prisma client singleton
│   │   ├── middleware.ts                            # RBAC middleware functions
│   │   ├── utils.ts                                # Utility functions (cn, formatDuration, etc.)
│   │   ├── validations.ts                          # Zod schemas
│   │   └── run-simulator.ts                        # Simulated run execution logic
│   ├── hooks/
│   │   ├── useSSE.ts                               # SSE subscription hook
│   │   └── useKeyboardShortcuts.ts                 # Global keyboard shortcuts
│   └── types/
│       ├── index.ts                                # Shared TypeScript types
│       └── next-auth.d.ts                          # NextAuth session type augmentation
├── tests/
│   ├── unit/
│   │   ├── health.test.ts
│   │   ├── projects.test.ts                        # Project & member route tests
│   │   ├── runs.test.ts                            # Run, task & trigger route tests
│   │   ├── schedules.test.ts                       # Schedule route tests
│   │   ├── api-keys.test.ts                        # API key route tests
│   │   └── hooks.test.ts                           # useKeyboardShortcuts tests
│   └── e2e/
│       ├── global-setup.ts                         # Database seeding and env config
│       ├── auth.spec.ts                            # Login, signup, demo login
│       ├── runs.spec.ts                            # Runs list, filtering, run detail
│       ├── dashboard.spec.ts                       # Charts render, stats display
│       └── mobile.spec.ts                          # Responsive layout, sidebar collapse
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── public/
│   └── favicon.svg                                 # SVG favicon (no binary files)
├── .env.example
├── .gitignore
├── eslint.config.mjs                              # ESLint flat config (Next.js 16)
├── postcss.config.mjs                             # Tailwind v4 PostCSS plugin
├── .prettierrc
├── next.config.js
├── tsconfig.json
├── package.json
├── playwright.config.ts
├── vitest.config.ts
├── CLAUDE.md
└── README.md
```

**Total:** ~80 files (14 pages, 21 API route files, 18 components, 6 lib, 2 hooks, 1 types, 11 tests, 14 config/meta)

---

## API Route Inventory

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/health` | GET | Public | Health check |
| `/api/seed` | POST | Token | Seed demo data |
| `/api/auth/[...nextauth]` | GET/POST | NextAuth | Auth endpoints |
| `/api/auth/signup` | POST | Public | User registration |
| `/api/projects` | GET | JWT | List user's projects |
| `/api/projects` | POST | JWT | Create project (creator = OWNER) |
| `/api/projects/[slug]` | GET | JWT | Project detail with counts |
| `/api/projects/[slug]` | PUT | ADMIN+ | Update name/description |
| `/api/projects/[slug]` | DELETE | OWNER | Delete project |
| `/api/projects/[slug]/members` | GET | JWT | List members |
| `/api/projects/[slug]/members` | POST | ADMIN+ | Invite by email |
| `/api/projects/[slug]/members/[id]` | PUT | ADMIN+ | Update role |
| `/api/projects/[slug]/members/[id]` | DELETE | ADMIN+ | Remove (self-remove OK) |
| `/api/projects/[slug]/tasks` | GET | JWT | List task definitions |
| `/api/projects/[slug]/tasks` | POST | MEMBER+ | Register task |
| `/api/projects/[slug]/tasks/[id]` | GET | JWT | Task detail + recent runs |
| `/api/projects/[slug]/tasks/[id]` | PUT | MEMBER+ | Update config |
| `/api/projects/[slug]/tasks/[id]` | DELETE | ADMIN+ | Delete task |
| `/api/projects/[slug]/runs` | GET | JWT | List runs (filterable) |
| `/api/projects/[slug]/runs` | POST | MEMBER+ | Trigger manual run |
| `/api/projects/[slug]/runs/[id]` | GET | JWT | Run detail + steps + logs |
| `/api/projects/[slug]/runs/[id]/cancel` | POST | MEMBER+ | Cancel running/queued run |
| `/api/projects/[slug]/runs/[id]/retry` | POST | MEMBER+ | Retry failed run |
| `/api/projects/[slug]/runs/[id]/stream` | GET | JWT | SSE log/status stream |
| `/api/projects/[slug]/schedules` | GET | JWT | List schedules |
| `/api/projects/[slug]/schedules` | POST | MEMBER+ | Create schedule |
| `/api/projects/[slug]/schedules/[id]` | GET | JWT | Schedule detail |
| `/api/projects/[slug]/schedules/[id]` | PUT | MEMBER+ | Update schedule |
| `/api/projects/[slug]/schedules/[id]` | DELETE | ADMIN+ | Delete schedule |
| `/api/projects/[slug]/api-keys` | GET | ADMIN+ | List keys (prefix only) |
| `/api/projects/[slug]/api-keys` | POST | ADMIN+ | Create key (return full key once) |
| `/api/projects/[slug]/api-keys/[id]` | DELETE | ADMIN+ | Revoke key |
| `/api/projects/[slug]/stats` | GET | JWT | Dashboard aggregations |
| `/api/trigger` | POST | API Key | External trigger endpoint |

**Total: 34 operations across 21 route files.**

**Standard API Error Response:** All error responses use this format:
```typescript
NextResponse.json({ error: "Human-readable message" }, { status: 4xx })
```
Success responses use `NextResponse.json(data)` or `NextResponse.json({ data })` for consistency.

**Project Slug Generation:** Auto-generate from project name: lowercase → replace non-alphanumeric with hyphens → collapse multiple hyphens → trim leading/trailing hyphens. On collision, append `-2`, `-3`, etc.

---

## Run Simulation

Since TaskPulse is a showcase (not a production task runner), runs are **simulated** rather than actually executing code. When a run is triggered:

1. **POST /runs** creates the Run record with status `QUEUED`
2. Server reads the TaskDefinition's `stepTemplates` to create RunStep records
3. Each step gets a calculated `startedAt`, `completedAt`, and `duration` based on the template's `avgDuration` (with ±30% random variance)
4. RunLog entries are generated for each step (start message, progress, completion/error)
5. 10% of runs randomly fail at a random step (for realistic data)
6. The entire simulation runs synchronously in the trigger API handler (~100ms total)
7. The Run is returned with status `COMPLETED` (or `FAILED`)

**For the UI animation:** The Run detail page renders the trace timeline based on step timestamps. Steps are revealed progressively using CSS transitions keyed to the time offset from `Run.startedAt`, creating the illusion of real-time execution even though all data was calculated upfront.

**SSE stream behavior:** Since runs are simulated synchronously (all data created upfront), the SSE stream endpoint progressively emits logs based on their timestamps rather than dumping everything at once. It compares each log's `timestamp` to the run's `startedAt` and the subscription start time, emitting logs with appropriate delays to replay the execution timeline. For already-completed historical runs, all logs are emitted immediately. For freshly triggered runs (where `startedAt` is within the last 30 seconds), logs are emitted with delays matching their timestamp offsets.

**`src/lib/run-simulator.ts`** contains the simulation logic:
- `simulateRun(projectId, taskDef, input, triggeredBy)` → creates Run + RunSteps + RunLogs with calculated timestamps. Always produces a terminal state (COMPLETED or FAILED). Uses **relative imports** for Prisma types (not `@/`) because it's shared between Next.js app code and `prisma/seed.ts`.
- `generateStepLogs(step)` → creates realistic log entries per step
- Random failure injection with realistic error messages

---

## Demo Seed Data

### Demo User
- **Email:** `demo@workermill.com`
- **Password:** `demo1234`
- **Name:** Demo User

### Demo Project
- **Name:** Acme Backend Services
- **Slug:** `acme-backend`
- **Demo user role:** OWNER

### 5 Task Definitions

| Name | Display Name | Steps | Avg Duration | Retry | Timeout |
|------|-------------|-------|-------------|-------|---------|
| `send-welcome-email` | Send Welcome Email | Validate recipient → Render template → Send via SMTP | ~2s | 3 | 30s |
| `process-payment` | Process Payment | Validate payment → Charge card → Update order → Send receipt | ~3s | 2 | 60s |
| `generate-report` | Generate Daily Report | Query database → Aggregate metrics → Format data → Generate PDF → Upload to S3 | ~5s | 1 | 300s |
| `sync-inventory` | Sync Inventory | Fetch external API → Diff changes → Update database | ~2s | 3 | 120s |
| `resize-image` | Resize Image | Download original → Resize variants → Upload to CDN | ~1.5s | 2 | 60s |

### 50 Runs (spread over 7 days)

| Status | Count | Percentage |
|--------|-------|------------|
| COMPLETED | 35 | 70% |
| FAILED | 8 | 16% |
| EXECUTING | 4 | 8% |
| QUEUED | 3 | 6% |

Each run has appropriate RunSteps and RunLogs matching the task's step templates.

**EXECUTING and QUEUED runs** are NOT created by `simulateRun()` (which only produces COMPLETED/FAILED). Instead, seed these manually:
- **QUEUED (3):** Create Run with status QUEUED, all RunSteps status QUEUED, no RunLogs. Set `startedAt: null`.
- **EXECUTING (4):** Create Run with status EXECUTING and `startedAt` set. Mark first N steps as COMPLETED with logs, one step as EXECUTING, remaining steps as QUEUED.

### 2 Schedules

| Description | Cron | Task | Enabled |
|-------------|------|------|---------|
| Nightly Report Generation | `0 2 * * *` | generate-report | Yes |
| Inventory Sync | `*/30 * * * *` | sync-inventory | Yes |

### 2 API Keys

| Name | Prefix | Last Used |
|------|--------|-----------|
| Production Backend | `tp_live_a1b2c3d4` | 2 hours ago |
| Staging CI/CD | `tp_test_e5f6g7h8` | 1 day ago |

---

## Epic Breakdown

| Epic | Title | Scope | Estimated Stories |
|------|-------|-------|-------------------|
| [TP-1](./TP-1-project-setup.md) | Project Setup & Dev Environment | Scaffold, schema, auth, CI/CD, deploy | 5-7 |
| [TP-2](./TP-2-core-api.md) | Core API & Task Engine | RBAC, project/task/run CRUD, simulation, SSE | 6-8 |
| [TP-3](./TP-3-dashboard-ui.md) | Dashboard UI | Runs list, trace timeline, log viewer, charts, E2E | 7-9 |
| [TP-4](./TP-4-advanced-features.md) | Scheduling, API Keys & Polish | Schedules, API keys, trigger endpoint, tests | 5-7 |
| [TP-5](./TP-5-production-deploy.md) | Production Deploy & Validation | vercel.json, security headers, verification | 3-4 |

**Sequential dependencies:** TP-1 → TP-2 → TP-3 → TP-4 → TP-5

---

## Infrastructure Prerequisites

These must be provisioned BEFORE workers start. Same pattern as TeamBoard.

| Resource | Status | Notes |
|----------|--------|-------|
| GitHub repo `workermill-examples/taskpulse` | Create before TP-1 | Public repo |
| Neon PostgreSQL | Provision | Free tier, `neondb` database |
| Vercel project | Create | Next.js, Node 22, link to GitHub repo |
| Custom domain `taskpulse.workermill.com` | Configure | DNS → Vercel |
| GitHub secret `DATABASE_URL` | Set | Neon pooled connection |
| GitHub secret `DIRECT_DATABASE_URL` | Set | Neon direct connection |
| GitHub secret `NEXTAUTH_SECRET` | Set | Random 32-char string |
| GitHub secret `SEED_TOKEN` | Set | Token for seed endpoint |
| Vercel env vars | Set | Same 4 + `NEXTAUTH_URL=https://taskpulse.workermill.com` + `AUTH_TRUST_HOST=true` |
| SSL certificate | Automatic | Via Vercel |
| Auto-deploy on push to main | Enable | Via Vercel GitHub App |

---

## Learnings Applied from TeamBoard

These are hard-won lessons from TB-7 through TB-10 that must be baked into every epic spec:

### Worker Capabilities & Limitations

| Can Do | Cannot Do |
|--------|-----------|
| Write TypeScript/React code | Create binary files (PNG, ICO) |
| Run CLI commands (typecheck, lint, test) | Run interactive tools (Lighthouse, network disconnect) |
| Create/modify files in worktrees | Access external services at runtime |
| Follow explicit instructions precisely | Design UI without detailed specs |
| Fix TypeScript/ESLint errors when told | Infer missing dependency requirements |

### Spec Patterns That Work

1. **Single-file ownership** — Each work group owns specific files. No two groups modify the same file.
2. **Per-group typecheck gates** — Every work group ends with `npm run typecheck` — must pass with 0 errors.
3. **Exact dependency versions** — Pin major versions in the spec. Workers install what you tell them to.
4. **Explicit scope boundaries** — "This epic creates X. Do NOT create Y." at the top of every spec.
5. **Pre-provisioned infrastructure** — Workers don't provision databases or hosting. That's done before they start.
6. **SVG-only icons** — Use SVG or programmatic icon generation. Workers cannot create PNG/ICO files.
7. **No verification-only stories** — Every work group must produce code changes. Verification is a step within each group, not a standalone story.
8. **CRITICAL patterns documented inline** — Next.js 16 async params, NextAuth v5 imports, Prisma 7 client singleton with adapter — copy the exact patterns into each epic spec where they apply.

### Spec Anti-Patterns to Avoid

1. **Shared files across groups** — Causes merge conflicts. If two groups need the same file, put them in the same group.
2. **Implicit dependencies** — If Group 3 imports a component from Group 1, say so explicitly and ensure Group 1 runs first.
3. **Undeclared dependencies** — If a component uses `@heroicons/react`, list it in the dependencies section. Workers won't add unlisted packages.
4. **Verification stories** — "Story 7: Verify everything works" always fails. Verification is part of each story.
5. **Oversized work groups** — Keep each group to 5-8 files max (constrained by planner's `maxTargetFiles`).

---

## Worker Execution Rules

Include in the CLAUDE.md that workers read:

1. **Read CLAUDE.md first** before starting any work
2. **Run ALL quality checks before PR:** `npm run typecheck` (0 errors), `npm run lint` (0 errors), `npm run test` (all pass)
3. **Wait for CI before merge:** `gh pr checks <PR> --watch` — NEVER merge with failing checks
4. **Update CLAUDE.md** if you establish new patterns or conventions
5. **Existing tests must keep passing** — run full test suite after modifications
6. **Dark theme everywhere** — all new UI uses `bg-gray-950`/`bg-gray-900` base colors, `text-gray-100`/`text-gray-400` text
7. **Next.js 16 async params** — all route handlers and pages must use `Promise<{ param }>` and `await params`
