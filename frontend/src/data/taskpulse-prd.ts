// Sanitized PRD — the original specification that defined the TaskPulse showcase build
// Reconstructed from build log ticket specifications

export const taskPulsePrd = `# TaskPulse — Full Build Specification

## Purpose

This is a **showcase build** — a polished demo app designed to demonstrate what WorkerMill can build autonomously. A background task monitoring dashboard with scheduling, real-time log streaming, API key-based triggers, and run analytics. When a visitor clicks "Try the Demo", they should see a populated dashboard with realistic tasks, run history, and live metrics. Every page should have data. Empty states are failure.

## Source of Truth

- **Repo:** \`workermill-examples/taskpulse\` (GitHub)
- **Live URL:** https://taskpulse.workermill.com
- **Deployment:** Vercel (app) + Neon PostgreSQL (database)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.1 |
| Language | TypeScript | 5.7 |
| UI | React | 19 |
| ORM | Prisma | 7 (with Neon adapter) |
| Database | PostgreSQL (Neon) | Serverless with \`@prisma/adapter-neon\` |
| Auth | NextAuth.js v5 | 5.0.0-beta.30 (JWT strategy, bcrypt) |
| Styling | TailwindCSS v4 | CSS-first config (NO \`tailwind.config.js\`) |
| Charts | Recharts | 3 |
| Unit Tests | Vitest | 4 |
| E2E Tests | Playwright | Latest |
| Linting | ESLint 9 | Flat config |
| CI/CD | GitHub Actions | \`ubuntu-latest\` |
| Hosting | Vercel | Manual deploy via CLI |

## Global Constraints

- **Node.js:** >=24.0.0
- **Dark theme everywhere:** \`bg-gray-950\` background, \`bg-gray-900\` surfaces, \`border-gray-800\`, \`text-gray-100\` text
- **Prisma 7:** Import from \`@/generated/prisma\` (NOT \`@prisma/client\`), use \`PrismaNeon\` adapter, config in \`prisma.config.ts\`
- **TailwindCSS 4:** CSS-first — \`@import "tailwindcss"\` + \`@theme\` block, NO JS config file
- **NextAuth v5:** JWT strategy, \`auth()\` in server components for route protection (no middleware.ts)
- **Next.js 16 Route Params:** Dynamic route params are \`Promise<{ slug?: string }>\` — must await and guard
- **No \`@heroicons/react\`** — use inline SVGs only
- **Auto-deploy DISABLED** — deployments are manual via Vercel CLI

---

## Database Schema

### Enums (4)

- **RunStatus:** PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
- **StepStatus:** PENDING, RUNNING, COMPLETED, FAILED, SKIPPED
- **LogLevel:** DEBUG, INFO, WARN, ERROR
- **MemberRole:** OWNER, ADMIN, MEMBER, VIEWER

### Models (10+)

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| User | Core user model | email, name, passwordHash, avatarUrl |
| Account | NextAuth OAuth | provider, providerAccountId |
| Session | NextAuth sessions | sessionToken, expires |
| Project | Task grouping | name, slug, description |
| ProjectMember | Project membership | role (OWNER/ADMIN/MEMBER/VIEWER), userId, projectId |
| TaskDefinition | Task configuration | name, slug, description, stepTemplates (JSON), config (JSON) |
| Run | Task execution instance | status, startedAt, completedAt, duration, createdBy |
| RunStep | Individual step in a run | name, status, startedAt, completedAt, duration, output |
| RunLog | Log entries for a run | level (DEBUG/INFO/WARN/ERROR), message, timestamp |
| Schedule | Cron-based scheduling | cronExpression, timezone, isActive, nextRunAt |
| ApiKey | External trigger auth | name, keyPrefix, keyHash (bcrypt), lastUsedAt |

### Key Relationships

- User 1:N ProjectMember, Run (creator)
- Project 1:N ProjectMember, TaskDefinition, Schedule, ApiKey
- TaskDefinition 1:N Run
- Run 1:N RunStep, RunLog
- Cascade deletes on project removal

### RBAC Role Hierarchy

\`VIEWER < MEMBER < ADMIN < OWNER\`

- **VIEWER:** Read-only access to runs, tasks, dashboard
- **MEMBER:** Can trigger runs, view logs
- **ADMIN:** Can manage tasks, schedules, API keys, members
- **OWNER:** Full control, can delete project, transfer ownership

---

## Application Structure

### URL Map

| URL | Auth | Description |
|-----|------|-------------|
| \`/\` | No | Landing page |
| \`/login\` | No | Login form with "Try Demo" button |
| \`/signup\` | No | Registration form |
| \`/projects\` | Yes | Project list with create dialog |
| \`/projects/[slug]\` | Yes | Project layout (auth + sidebar) |
| \`/projects/[slug]/dashboard\` | Yes | Dashboard with analytics charts |
| \`/projects/[slug]/runs\` | Yes | Runs list with filters and pagination |
| \`/projects/[slug]/runs/[id]\` | Yes | Run detail with timeline and logs |
| \`/projects/[slug]/tasks\` | Yes | Task definitions list |
| \`/projects/[slug]/tasks/[id]\` | Yes | Task config editor |
| \`/projects/[slug]/schedules\` | Yes | Schedule management |
| \`/projects/[slug]/settings\` | Yes | Project settings, members, API keys |

### API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/health\` | No | Health check |
| POST | \`/api/seed\` | Token | Seed demo data |
| POST | \`/api/auth/signup\` | No | User registration |
| GET/POST | \`/api/auth/[...nextauth]\` | — | NextAuth handler |
| GET/POST | \`/api/projects\` | Yes | List / create projects |
| GET/PUT/DELETE | \`/api/projects/[slug]\` | Yes | Project CRUD |
| GET/POST | \`/api/projects/[slug]/members\` | Yes | Member management |
| PUT/DELETE | \`/api/projects/[slug]/members/[id]\` | Yes | Update role / remove |
| GET/POST | \`/api/projects/[slug]/tasks\` | Yes | List / create task definitions |
| GET/PUT/DELETE | \`/api/projects/[slug]/tasks/[id]\` | Yes | Task CRUD |
| GET/POST | \`/api/projects/[slug]/runs\` | Yes | List / trigger runs |
| GET | \`/api/projects/[slug]/runs/[id]\` | Yes | Run detail with steps and logs |
| PATCH | \`/api/projects/[slug]/runs/[id]\` | Yes | Cancel / retry run |
| GET | \`/api/projects/[slug]/runs/[id]/stream\` | Yes | SSE log stream |
| GET | \`/api/projects/[slug]/dashboard\` | Yes | Dashboard stats |
| GET/POST | \`/api/projects/[slug]/schedules\` | Yes | List / create schedules |
| PUT/DELETE | \`/api/projects/[slug]/schedules/[id]\` | Yes | Schedule CRUD |
| GET/POST | \`/api/projects/[slug]/api-keys\` | Yes | List / create API keys |
| DELETE | \`/api/projects/[slug]/api-keys/[id]\` | Yes | Revoke API key |
| POST | \`/api/trigger\` | API Key | External run trigger |

---

## Run Simulation Engine

### \`src/lib/run-simulator.ts\`

The run simulator generates realistic task execution data. It returns data objects — the caller persists via Prisma nested creates.

**Simulation logic:**
- 90% success rate, 10% failure rate
- Each run has N steps (from task definition's \`stepTemplates\`)
- Each step has realistic timing (variable duration with jitter)
- Failed runs fail at a random step with an error message
- Generates log entries at each step with appropriate log levels
- Cancelled runs stop partway through

**Output:**
- Run record with status, startedAt, completedAt, duration
- RunStep records with individual step timing and status
- RunLog records with timestamped log messages at DEBUG/INFO/WARN/ERROR levels

---

## SSE Live Log Streaming

### \`/api/projects/[slug]/runs/[id]/stream\`

Server-Sent Events endpoint for real-time log streaming:
- Replays recent logs for historical runs (batch replay)
- Streams live logs for in-progress runs
- Sends \`heartbeat\` events to keep connection alive
- Client uses \`useSSE\` custom hook for EventSource management

### \`src/hooks/useSSE.ts\`

Custom React hook for SSE connections:
- Auto-reconnect on disconnect
- Message buffering and parsing
- Cleanup on unmount

---

## Dashboard Analytics

### Stats Endpoint (\`/api/projects/[slug]/dashboard\`)

Returns 7 aggregation metrics:
- Total runs, success rate, average duration
- Runs by status distribution
- Runs per day (last 30 days)
- Task performance comparison
- Recent failures

### Charts (Recharts 3)

1. **Run Status Distribution** — Donut chart with status colors
2. **Runs Per Day** — Area chart (last 30 days)
3. **Task Performance** — Horizontal bar chart comparing tasks
4. **Success Rate** — Trend line or gauge

---

## Scheduling System

### Schedule CRUD

- Create schedules with cron expressions (validated via \`cron-parser\`)
- Human-readable display via \`cronstrue\`
- Timezone selector for schedule execution
- \`nextRunAt\` auto-calculated on create/update
- Preview: shows next 3 scheduled execution times

### Schedule UI

- CronDisplay component with human-readable format
- ScheduleForm dialog (Headless UI)
- Active/inactive toggle
- Timezone selector

---

## API Key System

### Key Generation

- Prefix: \`tp_live_\` + 32 hex characters
- Storage: bcrypt hash (full key never stored)
- \`keyPrefix\` field for lookup (first 8 chars)
- Full key returned once on creation — cannot be retrieved again

### External Trigger

\`POST /api/trigger\` with \`X-API-Key\` header:
1. Extract key prefix
2. Look up API key record by prefix
3. Verify full key against bcrypt hash
4. Trigger run for the associated task
5. Return run ID

---

## Keyboard Shortcuts

### \`src/hooks/useKeyboardShortcuts.ts\`

| Shortcut | Action |
|----------|--------|
| \`/\` or \`Ctrl+K\` | Open global search |
| \`N\` | New (context-dependent: new run, new task, etc.) |
| \`Esc\` | Close dialogs/search |
| \`?\` | Show keyboard shortcut help |

### Global Search

- Debounced API queries across tasks, runs, projects
- localStorage recent search history
- Keyboard navigation (arrow keys + Enter)
- Search results grouped by type

---

## UI Components

### Layout

- **Sidebar** (256px, dark): Project navigation, page links with icons
- **Header**: Breadcrumb trail, user menu dropdown
- **Project Layout**: Auth guard + project data loading wrapper

### Run Detail Page

- **RunTimeline**: Waterfall/trace view of steps with animated step reveal
- **RunLogs**: SSE-powered live log viewer with level filters (DEBUG/INFO/WARN/ERROR) and auto-scroll
- Status badges with color coding per status

### Task Configuration

- **TaskCard**: Task name, description, last run status, run count
- **TaskConfig**: Step template editor with JSON configuration

---

## Seed Data

### Demo User
- **Email:** demo@workermill.com
- **Password:** demo1234
- **Username:** demo

### Demo Project (1)
With all features populated:
- **5 task definitions** with step templates
- **50 runs** spread over last 7 days with mixed statuses
- **2 schedules** (one active, one inactive)
- **2 API keys** (one active, one revoked)

---

## Testing

### Unit Tests (Vitest — 101 tests)
- Auth middleware and RBAC
- Project and member CRUD
- Task definition validation
- Run simulation engine
- Schedule cron parsing
- API key generation and verification
- SSE stream handling
- Dashboard aggregation queries

### E2E Tests (Playwright — 66 tests)
- Authentication flows
- Run listing, filtering, detail view
- Dashboard chart rendering
- Task management
- Schedule CRUD
- Settings and member management
- Mobile responsive layout
- Keyboard shortcuts

---

## CI/CD

### GitHub Actions CI
- Triggered on push and PR to main
- Jobs: lint (ESLint 9 flat config), typecheck, unit tests (Vitest), build
- Node.js 24, Postgres service container

### Deploy Workflow
- Vercel CLI: \`vercel pull\` → \`vercel build --prod\` → \`vercel deploy --prebuilt --prod\`
- Post-deploy smoke tests

### Production Config (\`vercel.json\`)
- Security headers
- Function config
- Region: \`iad1\`
- \`next.config.ts\`: \`poweredByHeader: false\`, \`compress: true\`

---

## Post-Deploy Validation

1. Health endpoint returns 200
2. Demo login works
3. Runs page renders with data
4. Dashboard charts display
5. Tasks page shows definitions
6. Schedules page functional
7. Settings page loads
8. Keyboard shortcuts work
9. Responsive layout on mobile
10. Security headers present
`;
