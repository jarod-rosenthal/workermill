# TeamBoard — Full Build Specification

## Purpose

This is a polished demo app designed to showcase WorkerMill's capabilities, `teamboard.workermill.com`. A full-stack SaaS Kanban board with RBAC, drag-and-drop, real-time updates, workspace dashboards, and activity feeds. When a visitor clicks "Try the Demo", they should see a populated workspace with realistic boards, cards, and activity. Every page should have data. Empty states are failure.

## Source of Truth

- **Spec:** `docs/SHOWCASE_PROJECTS.md` → "Project 1: TeamBoard"
- **Repo:** `workermill-examples/teamboard` (GitHub, PAT configured as `GH_TOKEN` secret)
- **Live URL:** https://teamboard.workermill.com
- **Deployment:** Vercel (app) + Neon PostgreSQL (database)
- **CI/CD:** GitHub Actions with `ubuntu-latest` runners (free for public repos)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 15 |
| ORM | Prisma | Latest |
| Database | PostgreSQL (Neon) | Free tier with connection pooling |
| Auth | NextAuth.js v5 | JWT strategy, bcrypt |
| Styling | TailwindCSS + shadcn/ui | Tailwind v4 |
| Drag & Drop | @dnd-kit/core | Latest |
| Charts | Recharts | Latest |
| Real-time | Server-Sent Events (SSE) | PostgreSQL polling |
| Testing | Vitest + Testing Library + Playwright | Latest |
| Linting | ESLint + Prettier | Latest |
| CI/CD | GitHub Actions (`ubuntu-latest`) | Free for public repos |
| Hosting | Vercel | Automatic deploys |
| Database Hosting | Neon PostgreSQL | Free tier, connection pooling |

## Global Constraints

### LLM Knowledge Gaps — DO NOT "FIX" These

Your training data may not include these — they are ALL correct and valid:

- **Next.js 15** is required. Do NOT use Next.js 14 — it has critical CVEs (`npm audit` will fail).
- **React 19** — Next.js 15 uses React 19. `"@types/react": "^19.0.0"`, `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`.
- **bcrypt 6.x** — bcrypt 5.x depends on vulnerable `tar` package.

### Pinned Dependencies (DO NOT change)

- `"next": "^15.1.0"` — NOT 14.x
- `"eslint-config-next": "^15.1.0"` — must match Next.js major
- `node-version` in all CI workflows: `22` (matches Vercel runtime)
- `"bcrypt": "^6.0.0"`

### Pre-Commit Quality Gates

```
npm run lint
npm run typecheck
npm run test
npm audit --audit-level=high
```

### Code Style Rules

- TypeScript strict mode, no `any` types
- All pages using `useSearchParams()` or `usePathname()` MUST be wrapped in `<Suspense>` boundary (Next.js 15 App Router static generation crashes without it)
- Never pass user-controlled URLs directly to `router.push()` — validate as relative path first
- All optimistic UI updates MUST capture previous state and revert on API failure
- Prisma requires BOTH `DATABASE_URL` (pooled) and `DIRECT_DATABASE_URL` (direct for migrations)

### adapter-static Constraints

SvelteKit is NOT used — this is Next.js. But note: dynamic routes (`[id]`, `[param]`) in App Router require `page.tsx` files. Missing page components return 404 even if child routes exist.

---

## Data Model

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String
  passwordHash  String
  avatarUrl     String?
  createdAt     DateTime  @default(now())
  memberships   WorkspaceMember[]
  assignedCards Card[]    @relation("assignee")
  activities    Activity[]
}

model Workspace {
  id          String    @id @default(cuid())
  name        String
  slug        String    @unique
  description String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  members     WorkspaceMember[]
  boards      Board[]
  activities  Activity[]
  labels      Label[]
}

model WorkspaceMember {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId      String
  role        MemberRole @default(MEMBER)
  joinedAt    DateTime  @default(now())

  @@unique([workspaceId, userId])
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
  VIEWER
}

model Board {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  name        String
  description String?
  position    Int       @default(0)
  createdAt   DateTime  @default(now())
  columns     Column[]
}

model Column {
  id       String @id @default(cuid())
  board    Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  boardId  String
  name     String
  position Int    @default(0)
  color    String @default("#6B7280")
  cards    Card[]
}

model Card {
  id          String    @id @default(cuid())
  column      Column    @relation(fields: [columnId], references: [id], onDelete: Cascade)
  columnId    String
  title       String
  description String?   @db.Text
  priority    Priority  @default(MEDIUM)
  position    Int       @default(0)
  dueDate     DateTime?
  assignee    User?     @relation("assignee", fields: [assigneeId], references: [id])
  assigneeId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  labels      CardLabel[]
}

enum Priority {
  URGENT
  HIGH
  MEDIUM
  LOW
}

model Label {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  name        String
  color       String
  cards       CardLabel[]
}

model CardLabel {
  card    Card  @relation(fields: [cardId], references: [id], onDelete: Cascade)
  cardId  String
  label   Label @relation(fields: [labelId], references: [id], onDelete: Cascade)
  labelId String

  @@id([cardId, labelId])
}

model Activity {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  user        User      @relation(fields: [userId], references: [id])
  userId      String
  type        String    // card_created, card_moved, card_assigned, card_completed, member_invited
  entityType  String    // card, board, member
  entityId    String
  data        Json      // { from: "To Do", to: "In Progress", cardTitle: "..." }
  createdAt   DateTime  @default(now())
}
```

**Workers MUST use this EXACT schema.** Do NOT add `@@map()`, `@@index()`, or annotations not shown.

---

## API Endpoints

### Health

```
GET /api/health → { "status": "ok", "timestamp": "..." }
```

### Auth

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/signup` | None | `{email, password, name}` → creates user, returns session |
| GET/POST | `/api/auth/[...nextauth]` | None | NextAuth.js handler (login, session) |

- Session strategy: JWT (stateless, works on Vercel edge)
- Password hashed with bcrypt (min 12 rounds)
- Duplicate email returns 409
- Session includes: `userId`, `email`, `name`
- Middleware protects all `/[workspace]/*` and `/api/*` routes (except health, auth, public)

### Workspaces

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces` | Required | List user's workspaces |
| POST | `/api/workspaces` | Required | Create workspace (creator becomes OWNER) |
| GET | `/api/workspaces/[slug]` | Member | Workspace detail |
| PUT | `/api/workspaces/[slug]` | Admin+ | Update workspace |
| DELETE | `/api/workspaces/[slug]` | Owner | Delete workspace |

### Members

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces/[slug]/members` | Member | List members |
| POST | `/api/workspaces/[slug]/members` | Admin+ | Invite member (by email) |
| PUT | `/api/workspaces/[slug]/members/[id]` | Admin+ | Change role |
| DELETE | `/api/workspaces/[slug]/members/[id]` | Admin+ | Remove member |

### Boards & Columns

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces/[slug]/boards` | Member | List boards |
| POST | `/api/workspaces/[slug]/boards` | Member+ | Create board |
| GET | `/api/workspaces/[slug]/boards/[id]` | Member | Board with nested columns + cards |
| PUT | `/api/workspaces/[slug]/boards/[id]` | Member+ | Update board |
| DELETE | `/api/workspaces/[slug]/boards/[id]` | Admin+ | Delete board |
| POST | `/api/boards/[id]/columns` | Member+ | Create column |
| PUT | `/api/boards/[id]/columns/reorder` | Member+ | Reorder columns |
| PUT | `/api/columns/[id]` | Member+ | Update column |
| DELETE | `/api/columns/[id]` | Admin+ | Delete column |

### Cards

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/columns/[id]/cards` | Member+ | Create card |
| GET | `/api/cards/[id]` | Member | Card detail |
| PUT | `/api/cards/[id]` | Member+ | Update card (title, description, priority, assignee, due date, labels) |
| DELETE | `/api/cards/[id]` | Member+ | Delete card |
| POST | `/api/cards/move` | Member+ | Move card (cross-column + reorder) |

**Card move** is the most critical API:
```typescript
// POST /api/cards/move
// Body: { cardId, targetColumnId, targetPosition }
// 1. Remove card from source column (update positions)
// 2. Insert into target column at position (update positions)
// 3. All in a single transaction
// 4. Create activity record (card_moved)
```

### Activity & Stats

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces/[slug]/activity` | Member | Activity feed (cursor-based, 20 per page) |
| GET | `/api/workspaces/[slug]/stats` | Member | Dashboard statistics |

**Stats response:**
```json
{
  "tasksByStatus": [{ "status": "To Do", "count": 5 }],
  "tasksByAssignee": [{ "name": "Alice", "count": 8 }],
  "tasksOverTime": [{ "date": "2026-02-01", "count": 3 }],
  "overdueCount": 4,
  "totalCards": 30,
  "completedCards": 12
}
```

### SSE Real-Time Stream

```
GET /api/workspaces/[slug]/stream
```

- Events: `card_created`, `card_moved`, `card_updated`, `card_deleted`, `board_updated`
- Auth via query param: `?token=<jwt>` (EventSource doesn't support headers)
- Keep-alive ping every 20s
- PostgreSQL polling every 1-2 seconds

### Seed Endpoint

```
POST /api/seed — Protected by Authorization: Bearer $SEED_TOKEN
```

Returns 200 on success, 409 if already seeded. Idempotent.

### RBAC Enforcement

- `OWNER` — Full control, can delete workspace
- `ADMIN` — Manage members, boards, settings
- `MEMBER` — Create/edit boards and cards
- `VIEWER` — Read-only access

---

## Frontend

### Routes

| Path | Page | Auth | API Calls |
|------|------|------|-----------|
| `/` | Landing page (public) | None | None — static marketing page |
| `/login` | Login form | None | NextAuth signIn |
| `/signup` | Registration form | None | POST `/api/auth/signup` |
| `/workspaces` | Workspace list | Required | GET `/api/workspaces` |
| `/[workspace]/dashboard` | Dashboard with charts | Member | GET stats |
| `/[workspace]/boards/[id]` | Kanban board view | Member | GET board, POST cards/move |
| `/[workspace]/activity` | Activity feed | Member | GET activity |
| `/[workspace]/members` | Member management | Member | GET/POST/PUT/DELETE members |
| `/[workspace]/settings` | Workspace settings | Admin+ | PUT workspace, CRUD labels |

### Landing Page (`/`)

Public page — visible without auth. Must look like a real product marketing page.

**Required sections:**
- **Hero** — "TeamBoard" name, tagline, "Try the Demo" CTA button
- **Features** — 3-4 feature cards (Kanban boards, RBAC, real-time, dashboards)
- **Built by WorkerMill** — prominent section explaining this was built by AI workers using [WorkerMill](https://workermill.com)
- **Footer** — copyright, "Built with WorkerMill" link

**Layout behavior:**
- Landing page (`/`) and login/signup render WITHOUT sidebar — full-width pages
- All authenticated routes render WITH sidebar
- Layout component checks current route to decide

### Auth Flow

- NextAuth.js v5 with JWT strategy
- Protected routes redirect to `/login` if unauthenticated
- Successful login redirects to `/workspaces` (NOT `/`)
- "Try the Demo" button auto-logs in as `demo@workermill.com`

### Kanban Board (Main Feature)

**Components:**
- `BoardView` — Container with horizontal scrolling columns
- `Column` — Vertical list of cards with header (name, card count, color)
- `Card` — Draggable card showing title, priority badge, assignee avatar, due date, label chips
- `CardDetail` — Modal for viewing and editing a card

**Drag & Drop (@dnd-kit/core):**
- Drag within column (reorder) and between columns (cross-column move)
- Visual drop indicators
- Optimistic UI (move immediately, POST to API, rollback on error)

**Card detail modal:**
- Title (inline editable), rich text description
- Priority selector (Urgent/High/Medium/Low with color badges)
- Assignee picker, due date picker, label picker
- Delete card, activity history

### Dashboard

4 charts at `/[workspace]/dashboard`:
1. **Tasks by Status** — Pie/donut chart (one slice per column name)
2. **Tasks by Assignee** — Horizontal bar chart
3. **Tasks Created Over Time** — Line chart (last 30 days)
4. **Overdue Task Count** — Large number card with red highlight

### Key Components

- `Sidebar` — Workspace name, nav links (Dashboard, Boards, Activity, Members, Settings), collapsible on mobile
- `FlagToggle`-style `CardPriorityBadge` — color-coded priority
- `useSSE(workspaceSlug)` — custom hook for real-time updates, auto-reconnect

---

## Seed Data (CRITICAL — Makes or Breaks the Demo)

**Run on every deploy** via `POST /api/seed`. Idempotent (check-before-insert).

### Demo User
- `demo@workermill.com` / `demo1234` (role: OWNER)

### Workspace
- "Acme Product" (slug: `acme-product`)

### 3 Boards
1. **Product Roadmap** — 5 columns (Backlog, To Do, In Progress, Review, Done) with 12 cards
2. **Sprint 14** — 4 columns (To Do, In Progress, QA, Done) with 10 cards (some overdue)
3. **Bug Tracker** — 3 columns (Reported, Investigating, Fixed) with 8 cards

### 5 Labels
- "Bug" (red), "Feature" (blue), "Enhancement" (green), "Documentation" (purple), "Urgent" (orange)

### 25 Activity Entries
Spread over 7 days. Include card_created, card_moved, card_assigned, board_created, member_invited. Timestamps spread across business hours — NOT all at the same time.

Cards should use realistic product titles (not "test card 1"). Vary priorities, assignees, due dates, and labels across cards.

---

## Configuration Files

### Project Structure

```
teamboard/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing page
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── workspaces/page.tsx
│   │   ├── [workspace]/
│   │   │   ├── page.tsx          # Redirects to dashboard
│   │   │   ├── layout.tsx        # Sidebar layout
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── activity/page.tsx
│   │   │   ├── members/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── boards/[id]/page.tsx
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── seed/route.ts
│   │       ├── auth/[...nextauth]/route.ts
│   │       └── ... (all API routes)
│   ├── components/
│   │   ├── ui/               # shadcn/ui
│   │   ├── layout/           # Sidebar, Header
│   │   ├── board/            # BoardView, Column, Card, CardDetail
│   │   ├── dashboard/        # Charts
│   │   └── shared/           # LoadingSpinner, ErrorBoundary
│   ├── lib/
│   │   ├── auth.ts           # NextAuth config
│   │   ├── prisma.ts         # Prisma client singleton
│   │   ├── utils.ts
│   │   └── validations.ts    # Zod schemas
│   ├── hooks/
│   │   └── useSSE.ts
│   └── types/
│       └── index.ts
├── tests/
│   ├── unit/
│   └── e2e/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── playwright.config.ts
├── vitest.config.ts
├── CLAUDE.md
└── README.md
```

### package.json scripts

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "format": "prettier --write .",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```

- `"test"` MUST be `"vitest run"` (NOT `"vitest"` which hangs CI in watch mode)
- `"build"` MUST be `"next build"` (NOT `"prisma generate && next build"`)
- `"postinstall"` MUST be `"prisma generate"` — runs automatically after `npm ci`

### CI Pipeline (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    name: Lint, Type Check & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test
      - run: npm audit --audit-level=high

  e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    needs: quality
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
      NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}
      NEXTAUTH_URL: http://localhost:3000
      AUTH_TRUST_HOST: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run build
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```

### Deploy Pipeline (`.github/workflows/deploy.yml`)

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  post-deploy:
    name: Post-Deploy Tasks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Run database migrations
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_DATABASE_URL: ${{ secrets.DIRECT_DATABASE_URL }}
        run: npx prisma migrate deploy

      - name: Wait for Vercel deploy
        run: sleep 30

      - name: Seed demo data
        run: |
          response=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            https://teamboard.workermill.com/api/seed \
            -H "Authorization: Bearer ${{ secrets.SEED_TOKEN }}")
          if [ "$response" = "200" ] || [ "$response" = "409" ]; then
            echo "Seed successful (HTTP $response)"
          else
            echo "Seed failed with HTTP $response"
            exit 1
          fi

      - name: Smoke test
        run: |
          curl -f https://teamboard.workermill.com/api/health || exit 1
          echo "Health check passed"
```

### GitHub Secrets (pre-configured)

| Secret | Status |
|--------|--------|
| `DATABASE_URL` | Set |
| `DIRECT_DATABASE_URL` | Set |
| `NEON_API_TOKEN` | Set |
| `VERCEL_TOKEN` | Set |
| `VERCEL_ORG_ID` | Set |
| `VERCEL_PROJECT_ID` | Set |
| `NEXTAUTH_SECRET` | Set |
| `SEED_TOKEN` | Set |

### Vercel (pre-configured)

| Resource | Status |
|----------|--------|
| Vercel project (`teamboard`) | Created |
| GitHub repo linked | `workermill-examples/teamboard` |
| Framework | Next.js, Node 22 |
| Custom domain | `teamboard.workermill.com` (verified) |
| Env vars | DATABASE_URL, DIRECT_DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, SEED_TOKEN |
| Auto-deploy on push | Enabled via Vercel GitHub App |

### Neon PostgreSQL (pre-configured)

| Resource | Status |
|----------|--------|
| Neon project | Created (`neondb` database) |
| Pooled connection (`DATABASE_URL`) | In GitHub secrets + Vercel env |
| Direct connection (`DIRECT_DATABASE_URL`) | In GitHub secrets + Vercel env |
| Neon API token (`NEON_API_TOKEN`) | In GitHub secrets |

### Vercel Production Config

**`vercel.json`:**
```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "functions": {
    "src/app/api/**/*.ts": { "maxDuration": 10 }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-XSS-Protection", "value": "1; mode=block" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

**`next.config.js` production optimizations:**
- `output: 'standalone'`
- `poweredByHeader: false`
- `compress: true`
- `optimizePackageImports: ['lucide-react', '@radix-ui/*']`
- `images.formats: ['image/avif', 'image/webp']`

### E2E Test Conventions

- Use `globalSetup` that seeds demo data via Prisma before tests run
- Use `getByRole` with `{ name }` for interactive elements — NOT `getByText`
- Use `{ exact: true }` for text queries
- NEVER use Tailwind classes as selectors
- Run `npx prettier --write .` after editing test files
- CI browser install: `npx playwright install --with-deps` (installs all configured browsers)

---

## Acceptance Criteria

### Local
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts on port 3000
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run test:e2e` passes
- [ ] `npm audit --audit-level=high` passes
- [ ] `GET /api/health` returns `{ "status": "ok" }`
- [ ] Login with `demo@workermill.com` / `demo1234` works
- [ ] All 3 boards visible with correct card counts (12, 10, 8)
- [ ] Drag and drop works within and across columns, persists after reload
- [ ] Dashboard shows 4 charts with non-zero data
- [ ] Activity feed shows 25 seeded entries
- [ ] SSE stream connects and delivers real-time events
- [ ] Responsive at 320px, 768px, 1024px, 1440px — no horizontal overflow

### Production
- [ ] `https://teamboard.workermill.com` loads landing page
- [ ] `/api/health` returns 200
- [ ] "Try the Demo" logs in as demo user
- [ ] All 3 boards visible with cards
- [ ] Drag and drop works and persists
- [ ] Dashboard charts render with real data
- [ ] Activity feed shows entries
- [ ] Responsive on mobile
- [ ] CI pipeline runs on push (lint, typecheck, test, e2e) on `ubuntu-latest`
- [ ] Vercel auto-deploys on merge to main
- [ ] Post-deploy smoke test passes
- [ ] Page load time < 2 seconds
- [ ] "Built by WorkerMill" visible in footer

## Anti-Patterns (Do NOT)

- Do NOT use Next.js 14 — use 15
- Do NOT use `useSearchParams()` without `<Suspense>` boundary — build crashes
- Do NOT pass user-controlled URLs to `router.push()` without validation
- Do NOT fire-and-forget optimistic updates — always capture previous state for rollback
- Do NOT forget `DIRECT_DATABASE_URL` in any env running Prisma
- Do NOT forget `AUTH_TRUST_HOST=true` in CI — Auth.js v5 rejects localhost
- Do NOT create dynamic route directories without `page.tsx` — returns 404
- Do NOT use `"vitest"` as test script — hangs CI in watch mode
- Do NOT edit existing Prisma migrations — create new ones
- Do NOT skip CI before merge — even with deploy label
- Do NOT add `@@map()`, `@@index()`, or extra annotations to the Prisma schema
- Do NOT create Dockerfile, docker-compose, or vercel.json during initial setup — Vercel auto-detects Next.js
- Do NOT create `postcss.config.*` — Next.js 15 includes PostCSS by default
