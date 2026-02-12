# TeamBoard PRD — Full Build & Deployment Plan

> **"TeamBoard — Built by WorkerMill"**
>
> Full-stack SaaS Kanban board with RBAC, drag-and-drop, real-time updates, workspace dashboards, and activity feeds. Deployed to Vercel with Neon PostgreSQL. Built entirely by autonomous AI workers.

## Source of Truth

- **Spec**: `docs/SHOWCASE_PROJECTS.md` → "Project 1: TeamBoard"
- **Target repo**: `workermill-examples/teamboard` (GitHub)
- **Live URL**: https://teamboard.workermill.com
- **Deployment**: Vercel (app) + Neon PostgreSQL (database)
- **CI/CD**: GitHub Actions with `ubuntu-latest` runners (free for public repos)

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack React with API routes, SSR, server actions |
| ORM | Prisma | Type-safe database access, migration management |
| Database | PostgreSQL (Neon) | Reliable, free tier with branching |
| Auth | NextAuth.js v5 | Session-based auth, extensible provider support |
| Styling | TailwindCSS + shadcn/ui | Consistent design system, accessible components |
| Drag & Drop | @dnd-kit/core | Modern, accessible, performant DnD library |
| Charts | Recharts | Declarative charts built on D3, React-native |
| Real-time | Server-Sent Events (SSE) | Simple real-time updates without WebSocket complexity |
| Testing | Vitest + Testing Library + Playwright | Unit, component, and E2E coverage |
| Linting | ESLint + Prettier | Code quality and formatting |
| CI/CD | GitHub Actions (`ubuntu-latest`) | Automated test + deploy pipeline, free for public repos |
| Hosting | Vercel | Automatic deploys, edge functions |
| Database Hosting | Neon PostgreSQL | Free tier, connection pooling, branching |

---

## Ticket Mapping

Each Linear ticket maps to a phase of the build. Tickets are **sequential** — each depends on the previous.

| Ticket | Phase | Title | Personas |
|--------|-------|-------|----------|
| TB-1 | Phase 0 | Set up project repository and local dev environment | devops_engineer |
| TB-2 | Phase 1 | Build the core backend API | backend_developer |
| TB-3 | Phase 2 | Build the web dashboard | frontend_developer |
| TB-4 | Phase 3 | Progressive Web App (PWA) | frontend_developer |
| TB-5 | Phase 4 | Build extended features and integrations | backend_developer, frontend_developer |
| TB-6 | Phase 5 | Deploy to production | devops_engineer |

> **TB-4 (PWA):** Installable Progressive Web App with offline support, service worker caching, and mobile-native interactions.

---

## TB-1: Set Up Project Repository and Local Dev Environment

**Personas:** devops_engineer
**Estimated stories:** 5
**Dependencies:** None (first ticket)

### What This Ticket Delivers

> **CRITICAL: Next.js 15, NOT 14.** Workers MUST install `next@^15.1.0`. Next.js 14.x has critical CVEs (`npm audit` will fail). If any tool or template suggests Next.js 14, override it to 15.

A fully scaffolded Next.js 15 monorepo with:
1. Project structure and all dependencies installed
2. Neon PostgreSQL database provisioned and connected
3. Prisma schema with all models and initial migration applied
4. Local dev environment running (`npm run dev`)
5. GitHub Actions CI pipeline (lint, typecheck, test)
6. GitHub Actions CD pipeline (deploy to Vercel)
7. Self-hosted GitHub Actions runner bootstrapped and operational
8. Vercel project configured and first deploy live
9. Health check endpoint responding at production URL

### Phase 0.1 — Repository Scaffolding

Create the `workermill/teamboard` repository with this structure:

```
teamboard/
├── prisma/
│   ├── schema.prisma          # Full data model (see Data Model section)
│   └── seed.ts                # Demo data seed script
#       Note: TB-1 seed.ts should only create the demo user (demo@workermill.com / demo1234).
#       Full seed data (workspaces, boards, cards, activities) is added in TB-2 Phase 1.8.
#       Demo credentials: demo@workermill.com / demo1234
#       ⚠️ The email is demo@workermill.com — NOT demo@teamboard.dev, NOT demo@teamboard.com, NOT any other domain.
#       Workers: if you see @teamboard.dev anywhere in your code, it is WRONG. Replace with @workermill.com.
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Landing page
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── workspaces/page.tsx
│   │   ├── [workspace]/
│   │   │   ├── page.tsx       # Redirects to /[workspace]/dashboard
│   │   │   ├── layout.tsx     # Sidebar layout
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── activity/page.tsx
│   │   │   ├── members/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── boards/
│   │   │       └── [id]/page.tsx  # Kanban board view
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── seed/route.ts      # Protected seed endpoint
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── workspaces/route.ts
│   │       ├── workspaces/[slug]/route.ts
│   │       ├── workspaces/[slug]/members/route.ts
│   │       ├── workspaces/[slug]/members/[id]/route.ts
│   │       ├── workspaces/[slug]/boards/route.ts
│   │       ├── workspaces/[slug]/boards/[id]/route.ts
│   │       ├── workspaces/[slug]/activity/route.ts
│   │       ├── workspaces/[slug]/stats/route.ts
│   │       ├── workspaces/[slug]/stream/route.ts
│   │       ├── boards/[id]/columns/route.ts
│   │       ├── boards/[id]/columns/reorder/route.ts
│   │       ├── columns/[id]/route.ts
│   │       ├── columns/[id]/cards/route.ts
│   │       ├── cards/[id]/route.ts
│   │       └── cards/move/route.ts
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── board/
│   │   │   ├── BoardView.tsx
│   │   │   ├── Column.tsx
│   │   │   ├── Card.tsx
│   │   │   └── CardDetail.tsx
│   │   ├── dashboard/
│   │   │   └── Charts.tsx
│   │   └── shared/
│   │       ├── LoadingSpinner.tsx
│   │       └── ErrorBoundary.tsx
│   ├── lib/
│   │   ├── auth.ts            # NextAuth config
│   │   ├── prisma.ts          # Prisma client singleton
│   │   ├── utils.ts           # Utility functions
│   │   └── validations.ts     # Zod schemas
│   ├── hooks/
│   │   └── useSSE.ts          # Server-Sent Events hook
│   └── types/
│       └── index.ts           # Shared TypeScript types
├── tests/
│   ├── unit/                  # Vitest unit tests
│   └── e2e/                   # Playwright E2E tests (test files go here)
├── .github/
│   └── workflows/
│       ├── ci.yml             # Lint, typecheck, test on push/PR
│       └── deploy.yml         # Deploy to Vercel on merge to main
├── public/
│   └── favicon.ico
├── .env.example               # All required env vars documented
├── .env.local                 # Local dev (gitignored)
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── playwright.config.ts       # Playwright config (root level)
├── vitest.config.ts           # Vitest config
├── CLAUDE.md                  # Worker instructions and conventions
└── README.md
```

> **TB-1 creates ONLY the files listed above.** Do NOT create:
> - `Dockerfile`, `.dockerignore`, `docker-compose.yml` — Vercel deployment is pre-configured, no Docker needed
> - `vercel.json` — Vercel auto-detects Next.js, no config needed for TB-1 (vercel.json is a TB-6 concern)
> - `postcss.config.mjs`, `postcss.config.js`, `postcss.config.cjs` — Next.js 15 includes PostCSS by default with TailwindCSS. Do NOT create ANY postcss config file regardless of extension.
> - `components.json` — shadcn/ui CLI config is not needed for TB-1 (UI components are TB-3)
> - `.gitkeep` files in empty directories — Git tracks directories with content, not empty ones
>
> Workers: if your self-review suggests adding files not in this list, **do not add them**. Stay within scope.

> **`next.config.js` for TB-1 MUST be minimal:**
> ```js
> /** @type {import('next').NextConfig} */
> const nextConfig = {};
> export default nextConfig;
> ```
> Do NOT add `output: 'standalone'`, `poweredByHeader`, `compress`, `optimizePackageImports`, or `images.formats`. Those are TB-6 Operational Reference items. TB-1 `next.config.js` is an empty config.

**package.json scripts:**
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
  "test:e2e:headed": "playwright test --headed",
  "format": "prettier --write .",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```

> **CRITICAL: Pinned dependency versions (DO NOT change):**
> - `"next": "^15.1.0"` — **NOT 14.x.** Next.js 14 has critical CVEs that will fail `npm audit --audit-level=high`. Next.js 15 is required for App Router Suspense boundaries.
> - `"eslint-config-next": "^15.1.0"` — MUST match Next.js major version.
> - `"@types/react": "^19.0.0"` + `"react": "^19.0.0"` + `"react-dom": "^19.0.0"` — Next.js 15 uses React 19.
> - `node-version` in all CI workflows: `22` (matches Vercel runtime).
> - `"bcrypt": "^6.0.0"` — bcrypt 5.x depends on vulnerable `tar` package.

> **Workers MUST use these EXACT scripts.** Do NOT modify them:
> - `"test"` MUST be `"vitest run"` (NOT `"vitest"` which runs in watch mode and hangs CI)
> - `"build"` MUST be `"next build"` (NOT `"prisma generate && next build"`)
> - `"postinstall"` MUST be `"prisma generate"` — this runs automatically after `npm ci` in CI, which is why `build` does NOT include `prisma generate`

**Acceptance criteria:**
- Repository created on GitHub at `workermill-examples/teamboard`
- `npm install` succeeds
- `npm run dev` starts Next.js on port 3000
- TypeScript compiles clean (`npm run typecheck`)
- ESLint passes (`npm run lint`)
- `.env.example` documents all required variables
- `.gitignore` MUST NOT ignore `prisma/migrations/` — migration SQL files are version-controlled for reproducible deploys. If your `.gitignore` template includes a Prisma migrations exclusion, remove it.
- CLAUDE.md has local dev instructions and conventions
- README.md has project overview and setup instructions

### Phase 0.2 — Database Setup (Neon PostgreSQL)

**Neon is already provisioned.** The database, connection strings, and API token are configured as GitHub secrets and Vercel environment variables.

| Resource | Status |
|----------|--------|
| Neon project | ✅ Created (`neondb` database) |
| Pooled connection (`DATABASE_URL`) | ✅ In GitHub secrets + Vercel env |
| Direct connection (`DIRECT_DATABASE_URL`) | ✅ In GitHub secrets + Vercel env |
| Neon API token (`NEON_API_TOKEN`) | ✅ In GitHub secrets |

**What workers need to do:** Apply the Prisma schema to the database (`npx prisma migrate deploy` or `npx prisma db push`).

> **Workers MUST use the EXACT Prisma schema below.** Do NOT add `@@map()`, `@@index()`, or any other annotations not shown. The schema is designed for Neon PostgreSQL and Prisma's default table naming is intentional.

**Prisma schema** — full data model from SHOWCASE_PROJECTS.md:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")  // Neon requires this for migrations
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

**Acceptance criteria:**
- Neon PostgreSQL provisioned with connection pooling
- `npx prisma migrate deploy` succeeds
- `npx prisma db push` succeeds against Neon
- `DATABASE_URL` and `DIRECT_DATABASE_URL` configured
- Prisma Client generates types correctly
- All models accessible from application code

### Phase 0.3 — GitHub Actions CI/CD Pipelines

All workflows use `ubuntu-latest` (free unlimited minutes for public repos). No self-hosted runner needed.

> **IMPORTANT:** Workers MUST use the EXACT workflow YAML shown below, character-for-character. Do NOT:
> - Add third-party GitHub Actions (e.g., `fountainhead/action-wait-for-check`)
> - Add health check retry loops, DNS verification steps, or other complexity
> - Move job-level `env:` vars to step-level (E2E needs them at job scope)
> - Add extra jobs beyond what's shown (no "CI Validation" job)
> - The deploy workflow uses a simple `sleep 30` — that is intentional
> - Use `npm run test` (not `test:coverage`) in the quality job

**CI Pipeline** (`.github/workflows/ci.yml`):

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
      AUTH_TRUST_HOST: 'true'  # Required by Auth.js v5 on non-Vercel hosts
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run build
      - run: npx playwright install --with-deps  # Install ALL configured browsers (not just chromium)
      - run: npm run test:e2e
```

> **CRITICAL:** The Playwright browser install command MUST install **all browsers** referenced in `playwright.config.ts` projects. If you add a mobile-safari project (WebKit), CI must install webkit too. Using `npx playwright install --with-deps` (no browser argument) installs all configured browsers automatically.

**Deploy Pipeline** (`.github/workflows/deploy.yml`):

Vercel auto-deploys on push to main via the GitHub integration. This workflow handles post-deploy tasks (migrations, seed, smoke test):

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

**GitHub Secrets (already configured):**

| Secret | Status |
|--------|--------|
| `DATABASE_URL` | ✅ Set |
| `DIRECT_DATABASE_URL` | ✅ Set |
| `NEON_API_TOKEN` | ✅ Set |
| `VERCEL_TOKEN` | ✅ Set |
| `VERCEL_ORG_ID` | ✅ Set |
| `VERCEL_PROJECT_ID` | ✅ Set |
| `NEXTAUTH_SECRET` | ✅ Set |
| `SEED_TOKEN` | ✅ Set |

**Acceptance criteria:**
- CI workflow runs on push to main and on PRs
- CI checks pass: lint, typecheck, unit tests, npm audit
- E2E tests run against Neon database
- Vercel auto-deploys on merge to main (GitHub integration)
- Post-deploy workflow runs migrations and smoke test
- Smoke test confirms `/api/health` returns 200

### Phase 0.4 — Vercel Project & Initial Deploy

**Vercel is already configured.** The project, GitHub link, custom domain, and env vars are all set up.

| Resource | Status |
|----------|--------|
| Vercel project (`teamboard`) | ✅ Created |
| GitHub repo linked | ✅ `workermill-examples/teamboard` |
| Framework | ✅ Next.js, Node 22 |
| Custom domain | ✅ `teamboard.workermill.com` (verified) |
| Env vars (5) | ✅ DATABASE_URL, DIRECT_DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, SEED_TOKEN |
| Auto-deploy on push | ✅ Enabled via Vercel GitHub App |

**What workers need to do:** Push the scaffolded Next.js app to trigger the first Vercel deploy, then verify the health check.

**Acceptance criteria:**
- `https://teamboard.workermill.com` loads
- `/api/health` returns `{ "status": "ok", "timestamp": "..." }`
- Vercel shows successful deployment in dashboard
- Auto-deploy triggers on merge to main

### TB-1 Definition of Done

- [ ] Repository `workermill-examples/teamboard` has full project structure
- [ ] `npm install` succeeds
- [ ] `npm run dev` starts locally on port 3000
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Prisma schema applied to Neon (`npx prisma db push` succeeds)
- [ ] `GET /api/health` returns 200 locally
- [ ] CI workflow (lint, typecheck, test) runs successfully on GitHub Actions
- [ ] Vercel deploys successfully on push to main
- [ ] `https://teamboard.workermill.com/api/health` returns 200
- [ ] CLAUDE.md written with local dev setup and conventions
- [ ] README.md documents setup, architecture, and running locally
- [ ] E2E tests are NOT required for TB-1 — auth pages are scaffolds (stubs), E2E is tested properly in TB-3. Create `tests/e2e/` directory and `playwright.config.ts` but no test files yet. The CI E2E job will be a no-op (0 tests to run = pass).

---

## TB-2: Build the Core Backend API

**Personas:** backend_developer
**Estimated stories:** 12
**Dependencies:** TB-1 complete

### What This Ticket Delivers

All API routes functional with auth, RBAC, data validation, and tests. No UI — just API endpoints that return JSON.

### Phase 1.1 — Authentication (NextAuth.js v5)

Configure NextAuth.js with credentials provider (email/password):

- `POST /api/auth/signup` — Create user (hash password with bcrypt, create User in DB)
- NextAuth `[...nextauth]` route — Login, session management
- Session strategy: JWT (stateless, works on Vercel edge)
- Middleware: protect all `/[workspace]/*` and `/api/*` routes (except health, auth, public)
- Session includes: `userId`, `email`, `name`

**Acceptance criteria:**
- Users can sign up with email/password
- Users can log in and receive a session cookie
- Protected routes return 401 without session
- Session persists across page refreshes
- Password hashed with bcrypt (min 12 rounds)
- Duplicate email returns 409
- Unit tests for auth routes

### Phase 1.2 — Workspace CRUD & RBAC

Routes:
| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/workspaces` | GET | List user's workspaces | Required |
| `/api/workspaces` | POST | Create workspace (creator becomes OWNER) | Required |
| `/api/workspaces/[slug]` | GET | Workspace detail | Member |
| `/api/workspaces/[slug]` | PUT | Update workspace | Admin+ |
| `/api/workspaces/[slug]` | DELETE | Delete workspace | Owner |

**RBAC enforcement:**
- `OWNER` — Full control, can delete workspace
- `ADMIN` — Manage members, boards, settings
- `MEMBER` — Create/edit boards and cards
- `VIEWER` — Read-only access

RBAC middleware pattern:
```typescript
// Reusable middleware: requireWorkspaceRole(["OWNER", "ADMIN"])
// Checks: (1) user is a member, (2) user has required role
// Returns 403 if insufficient, 404 if workspace not found
```

**Acceptance criteria:**
- Workspace CRUD with slug auto-generation
- RBAC enforced on all workspace routes
- Users only see workspaces they're members of (multi-tenant isolation)
- Workspace creation auto-adds creator as OWNER
- Unit tests for RBAC middleware

### Phase 1.3 — Member Management

Routes:
| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/workspaces/[slug]/members` | GET | List members | Member |
| `/api/workspaces/[slug]/members` | POST | Invite member (by email) | Admin+ |
| `/api/workspaces/[slug]/members/[id]` | PUT | Change role | Admin+ |
| `/api/workspaces/[slug]/members/[id]` | DELETE | Remove member | Admin+ |

**Acceptance criteria:**
- Invite by email (creates membership, user must exist)
- Role changes validated (can't demote last OWNER)
- Members can leave workspaces
- Admin can remove members (but not OWNER)
- Unit tests for member management

### Phase 1.4 — Board & Column CRUD

Routes:
| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/workspaces/[slug]/boards` | GET | List boards | Member |
| `/api/workspaces/[slug]/boards` | POST | Create board | Member+ |
| `/api/workspaces/[slug]/boards/[id]` | GET | Board with columns + cards | Member |
| `/api/workspaces/[slug]/boards/[id]` | PUT | Update board | Member+ |
| `/api/workspaces/[slug]/boards/[id]` | DELETE | Delete board | Admin+ |
| `/api/boards/[id]/columns` | POST | Create column | Member+ |
| `/api/boards/[id]/columns/reorder` | PUT | Reorder columns | Member+ |
| `/api/columns/[id]` | PUT | Update column | Member+ |
| `/api/columns/[id]` | DELETE | Delete column | Admin+ |

**Acceptance criteria:**
- Board CRUD within workspace scope
- Board GET returns nested columns + cards (ordered by position)
- Column create/reorder/update/delete
- Position management (reorder updates all affected positions atomically)
- Cascade delete (board → columns → cards)

### Phase 1.5 — Card CRUD & Move

Routes:
| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/columns/[id]/cards` | POST | Create card | Member+ |
| `/api/cards/[id]` | GET | Card detail | Member |
| `/api/cards/[id]` | PUT | Update card (title, description, priority, assignee, due date, labels) | Member+ |
| `/api/cards/[id]` | DELETE | Delete card | Member+ |
| `/api/cards/move` | POST | Move card (cross-column + reorder) | Member+ |

**Card move operation** (most critical API):
```typescript
// POST /api/cards/move
// Body: { cardId, targetColumnId, targetPosition }
// Must:
// 1. Remove card from source column (update positions)
// 2. Insert into target column at position (update positions)
// 3. All in a single transaction
// 4. Create activity record (card_moved)
```

**Acceptance criteria:**
- Card CRUD with all fields (title, description, priority, assignee, dueDate, labels)
- Card move within same column (reorder)
- Card move across columns (cross-column drag)
- Position updates are atomic (transaction)
- Move creates activity record
- Labels can be added/removed via CardLabel join

### Phase 1.6 — Activity Feed & Dashboard Stats

Routes:
| Route | Method | Purpose | Auth |
|-------|--------|---------|------|
| `/api/workspaces/[slug]/activity` | GET | Activity feed (paginated) | Member |
| `/api/workspaces/[slug]/stats` | GET | Dashboard statistics | Member |

**Activity types:** `card_created`, `card_moved`, `card_assigned`, `card_completed`, `member_invited`, `board_created`

**Stats endpoint returns:**
```json
{
  "tasksByStatus": [{ "status": "To Do", "count": 5 }, ...],
  "tasksByAssignee": [{ "name": "Alice", "count": 8 }, ...],
  "tasksOverTime": [{ "date": "2026-02-01", "count": 3 }, ...],
  "overdueCount": 4,
  "totalCards": 30,
  "completedCards": 12
}
```

**Acceptance criteria:**
- Activities recorded for all card/board/member mutations
- Activity feed paginated (cursor-based, 20 per page)
- Stats aggregated from live data
- Stats include: tasks by status (column name), by assignee, over time (last 30 days), overdue count

### Phase 1.7 — SSE Real-Time Stream

Route: `GET /api/workspaces/[slug]/stream`

Server-Sent Events endpoint for real-time board updates.

**Implementation:**
```typescript
// SSE endpoint — streams workspace events
// Events: card_created, card_moved, card_updated, card_deleted, board_updated
// Auth via query param: ?token=<jwt>
// Keep-alive ping every 20s
// PostgreSQL polling every 1-2 seconds (same pattern as WorkerMill)
```

**Acceptance criteria:**
- SSE endpoint streams events for workspace mutations
- Auth via query param token (EventSource doesn't support headers)
- Keep-alive ping prevents connection timeout
- Events include enough data for UI to update without re-fetching
- Connection auto-reconnects on drop

### Phase 1.8 — Seed Data Script

`prisma/seed.ts` creates the demo workspace as specified in SHOWCASE_PROJECTS.md:

**Demo user:** `demo@workermill.com` / `demo1234`

**Workspace:** "Acme Product" (slug: `acme-product`) with demo user as OWNER

**3 Boards:**
1. **Product Roadmap** — 5 columns (Backlog, To Do, In Progress, Review, Done) with 12 cards
2. **Sprint 14** — 4 columns (To Do, In Progress, QA, Done) with 10 cards (some overdue)
3. **Bug Tracker** — 3 columns (Reported, Investigating, Fixed) with 8 cards

**Labels:** "Bug" (red), "Feature" (blue), "Enhancement" (green), "Documentation" (purple), "Urgent" (orange)

**Activity:** 25 recent activities over the past 7 days

**Seed must be idempotent** — safe to run multiple times (check-before-insert pattern).

**Acceptance criteria:**
- `npm run db:seed` populates all demo data
- Running seed twice does not create duplicates
- Demo user can log in with `demo@workermill.com` / `demo1234`
- All 30 cards distributed across 3 boards
- Activity feed shows 25 entries
- Stats endpoint returns meaningful data from seed

### TB-2 Definition of Done

- [ ] All 28 API routes functional and returning correct data
- [ ] Authentication works (signup, login, session)
- [ ] RBAC enforced (OWNER > ADMIN > MEMBER > VIEWER)
- [ ] Card move operation is atomic (cross-column drag)
- [ ] Activity feed records all mutations
- [ ] Stats endpoint returns aggregated data
- [ ] SSE stream delivers real-time events
- [ ] Seed data loads correctly (30 cards, 3 boards, 25 activities)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Unit tests pass for all API routes
- [ ] `npm run test` passes with >60% coverage on API routes
- [ ] Demo user can authenticate and access workspace via API

---

## TB-3: Build the Web Dashboard

**Personas:** frontend_developer
**Estimated stories:** 10
**Dependencies:** TB-2 complete (all API routes working)

### What This Ticket Delivers

Complete web UI for all TeamBoard features. Fully interactive with drag-and-drop, real-time updates, and responsive design.

### Phase 2.1 — App Shell & Auth Pages

- **Landing page** (`/`) — Hero section explaining TeamBoard, "Try the Demo" CTA button, "Built by WorkerMill" branding
- **Login page** (`/login`) — Email + password form, link to signup
- **Signup page** (`/signup`) — Registration form (name, email, password)
- **Auth state** — Zustand store or NextAuth session hook
- **Protected route wrapper** — Redirect to `/login` if unauthenticated
- **"Try the Demo" flow** — Logs in as `demo@workermill.com` automatically

**Acceptance criteria:**
- Landing page renders with marketing copy and demo CTA
- Login form validates and authenticates
- Signup form creates account and redirects to workspaces
- "Try the Demo" button auto-logs in as demo user
- Unauthenticated users redirected to login
- "Built by WorkerMill" visible in footer

### Phase 2.2 — Workspace List & Sidebar Layout

- **Workspace list** (`/workspaces`) — Grid of user's workspaces with create button
- **Sidebar layout** (`/[workspace]/layout.tsx`) — Shared layout for all workspace pages:
  - Workspace name + avatar at top
  - Navigation: Dashboard, Boards (expandable list), Activity, Members, Settings
  - User avatar + settings at bottom
  - Collapsible on mobile (hamburger menu)

**Acceptance criteria:**
- Workspace list shows all user's workspaces
- Create workspace modal/form
- Sidebar navigation with active state highlighting
- Sidebar collapses on mobile viewport
- Clicking a board navigates to board view

### Phase 2.3 — Kanban Board View (Main Feature)

The hero feature — full drag-and-drop Kanban board at `/[workspace]/boards/[id]`.

**Components:**
- `BoardView` — Container with horizontal scrolling columns
- `Column` — Vertical list of cards with header (name, card count, color indicator)
- `Card` — Draggable card showing title, priority badge, assignee avatar, due date, label chips
- `CardDetail` — Modal/drawer for viewing and editing a card

**Drag & Drop (@dnd-kit/core):**
- Drag cards within a column (reorder)
- Drag cards between columns (cross-column move)
- Visual drop indicators (highlight target position)
- Optimistic UI update (move card immediately, POST to API, rollback on error)
- Card move calls `POST /api/cards/move`

**Card detail modal:**
- Title (inline editable)
- Rich text description (markdown or plain text)
- Priority selector (Urgent/High/Medium/Low with color badges)
- Assignee picker (dropdown of workspace members)
- Due date picker
- Label picker (multi-select from workspace labels)
- Delete card button
- Activity history for this card

**Create card:**
- "+" button at bottom of each column
- Quick-add (title only) or full form

**Acceptance criteria:**
- Board renders with all columns and cards from API
- Cards show priority badge, assignee avatar, due date, labels
- Drag and drop works within columns and across columns
- Drop persists after page reload (API call succeeds)
- Optimistic UI — card moves instantly, reverts on error
- Card detail opens in modal with all fields editable
- New cards can be created in any column
- Responsive: horizontal scroll on mobile, columns stack or scroll

### Phase 2.4 — Dashboard & Charts

Dashboard at `/[workspace]/dashboard` with 4 charts:

1. **Tasks by Status** — Pie/donut chart (one slice per column name)
2. **Tasks by Assignee** — Horizontal bar chart
3. **Tasks Created Over Time** — Line chart (last 30 days)
4. **Overdue Task Count** — Large number card with red highlight

Data fetched from `GET /api/workspaces/[slug]/stats`.

**Acceptance criteria:**
- 4 charts render with real data from seed
- Charts are responsive
- Charts use Recharts library
- Dashboard shows workspace-level summary
- Overdue count is visually prominent (red/orange)

### Phase 2.5 — Activity Feed, Members, Settings

**Activity feed** (`/[workspace]/activity`):
- Chronological list of recent actions
- User avatar + action description + relative timestamp
- "Alice moved 'Fix login bug' from To Do → In Progress — 2 hours ago"
- Pagination (load more button)

**Members** (`/[workspace]/members`):
- Member list with name, email, role badge (Owner/Admin/Member/Viewer)
- Invite form (email input, role selector) — Admin+ only
- Role change dropdown — Admin+ only
- Remove member button — Admin+ only

**Settings** (`/[workspace]/settings`):
- Workspace name and description edit
- Labels management (create, edit color/name, delete)
- Danger zone: Delete workspace (Owner only, requires confirmation)

**Acceptance criteria:**
- Activity feed shows recent actions with user info
- Members page lists all members with roles
- Invite, role change, and remove work (RBAC enforced by API)
- Settings allows workspace and label management
- Delete workspace requires confirmation dialog

### Phase 2.6 — Real-Time Updates via SSE

Connect to `GET /api/workspaces/[slug]/stream` via `EventSource`:

- **Board view** — Cards appear/move/update in real-time without refresh
- **Dashboard** — Stats update as cards change
- **Activity feed** — New activities appear at top

**Custom hook:**
```typescript
// useSSE(workspaceSlug) — connects to SSE endpoint
// Returns event stream, handles reconnection
// On card_moved event: update board state without re-fetch
// On card_created event: add card to correct column
```

**Acceptance criteria:**
- Board updates in real-time when another user/tab makes changes
- Dashboard charts refresh on data changes
- Activity feed shows new entries without page refresh
- SSE reconnects automatically on connection drop
- Connection status indicator (optional)

### Phase 2.7 — Responsive Design & Polish

- All pages work on mobile viewport (320px+)
- Sidebar collapses to hamburger menu on mobile
- Board view: horizontal scroll for columns on mobile
- Card detail: full-screen modal on mobile
- Touch-friendly drag and drop
- Loading states (skeletons) for all data-fetching pages
- Error states with retry buttons
- Empty states ("No boards yet — create one!")
- Page transitions (subtle fade/slide)

**Acceptance criteria:**
- All pages render correctly at 320px, 768px, 1024px, 1440px viewports
- No horizontal overflow
- Touch drag works on mobile
- Loading skeletons for all async data
- Meaningful empty states

### TB-3 Definition of Done

- [ ] Landing page with "Try the Demo" button
- [ ] Auth flow: signup, login, demo login
- [ ] Workspace list and creation
- [ ] Sidebar navigation on all workspace pages
- [ ] Kanban board with drag-and-drop (within and across columns)
- [ ] Card detail modal with full editing
- [ ] Dashboard with 4 charts showing real data
- [ ] Activity feed with pagination
- [ ] Members management with RBAC
- [ ] Settings with label management
- [ ] Real-time updates via SSE
- [ ] Login page uses `<Suspense>` boundary around `useSearchParams()` (see Mandatory Rule #1)
- [ ] Login `callbackUrl` validated as relative path (see Mandatory Rule #2)
- [ ] Responsive on all viewports (320px–1440px+)
- [ ] Drag-and-drop has optimistic rollback on API failure (see Mandatory Rule #3)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (all unit tests green)
- [ ] E2E tests cover auth, workspace, dashboard, board, and mobile flows (see Mandatory Rule #7)
- [ ] E2E `globalSetup` seeds demo data via Prisma (see Mandatory Rule #6)
- [ ] CI runs E2E with `AUTH_TRUST_HOST=true` (see Mandatory Rule #5)
- [ ] Page load time < 2 seconds on 4G
- [ ] "Built by WorkerMill" visible in footer

---

## TB-4: Progressive Web App (PWA)

**Personas:** frontend_developer
**Estimated stories:** 5-6
**Dependencies:** TB-3 complete (full UI working)

### What This Ticket Delivers

TeamBoard becomes an installable PWA — users can add it to their home screen on mobile/desktop, get offline access to recently viewed boards, and experience native-app-like behavior (no browser chrome, splash screen, push-ready).

### Phase 3.1 — PWA Manifest & Install Experience

Create `public/manifest.json`:
```json
{
  "name": "TeamBoard",
  "short_name": "TeamBoard",
  "description": "Kanban board for teams — Built by WorkerMill",
  "start_url": "/workspaces",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- Add `<link rel="manifest" href="/manifest.json">` to root layout
- Add Apple-specific meta tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`)
- Generate app icons at 192px and 512px (plus maskable variant)
- Add `theme-color` meta tag that matches light/dark theme

**Acceptance criteria:**
- Chrome/Edge shows "Install app" prompt on desktop and mobile
- iOS Safari shows "Add to Home Screen" correctly with icon and name
- Installed app launches in standalone mode (no browser URL bar)
- Splash screen displays on launch

### Phase 3.2 — Service Worker & Offline Caching

Use `next-pwa` or a custom service worker with Workbox:

**Cache strategies:**
| Resource | Strategy | TTL |
|----------|----------|-----|
| App shell (HTML, CSS, JS) | Cache-first, network fallback | Revalidate on new deploy |
| API responses (`/api/boards`, `/api/workspaces`) | Network-first, cache fallback | 5 minutes |
| Static assets (icons, fonts, images) | Cache-first | 30 days |
| Board detail (`/api/boards/[id]`) | Stale-while-revalidate | 1 minute |

**Offline behavior:**
- Recently viewed boards are available offline (read-only)
- Offline indicator banner: "You're offline — changes will sync when reconnected"
- Card moves queued locally while offline, synced on reconnect
- New card creation disabled while offline (show disabled state with tooltip)

**Acceptance criteria:**
- Service worker registered and caching app shell
- Previously visited boards load while offline
- Offline banner appears when connection drops
- Queued card moves sync automatically on reconnect
- `navigator.onLine` and `online`/`offline` events handled

### Phase 3.3 — Offline Action Queue & Sync

Implement a simple offline action queue using IndexedDB (via `idb` library):

```typescript
// Queue structure
interface QueuedAction {
  id: string;
  type: 'card_move' | 'card_update';
  payload: Record<string, unknown>;
  timestamp: number;
  retries: number;
}
```

- Card moves and edits are stored in IndexedDB when offline
- On reconnect, actions replayed in order against the API
- Conflict resolution: last-write-wins (server timestamp)
- Failed replays retry 3 times, then surface error to user
- Queue badge shows count of pending syncs

**Acceptance criteria:**
- Card moves persist in IndexedDB while offline
- Actions replay in order on reconnect
- User sees pending sync count
- Failed syncs surface as toast notifications
- Queue clears after successful sync

### Phase 3.4 — Mobile-Native Interactions

Polish the touch experience to feel native:

- **Pull-to-refresh** on board view and workspace list
- **Haptic feedback** on card drag (where supported via `navigator.vibrate`)
- **Swipe gestures** on cards: swipe right to complete, swipe left to delete (with undo toast)
- **Bottom sheet** for card detail on mobile (instead of centered modal)
- **Touch-optimized drag** — larger hit targets (min 44px), long-press to initiate drag
- **iOS safe area** — respect `env(safe-area-inset-*)` for notch/home indicator

**Acceptance criteria:**
- Pull-to-refresh works on board and workspace views
- Card drag initiates on long-press (not immediate touch)
- Card detail opens as bottom sheet on viewports < 768px
- No content obscured by iOS notch or home indicator
- Drag targets meet 44px minimum touch target

### Phase 3.5 — App-Like Navigation & Performance

- **View transitions** — Smooth page transitions using View Transitions API (with fallback)
- **Persistent bottom nav** on mobile — Workspaces, Boards, Activity, Profile (replaces sidebar)
- **Skeleton screens** — Content-shaped loading placeholders on all views
- **Image precaching** — Avatars and board thumbnails cached aggressively
- **Bundle optimization** — Dynamic imports for board view, charts, card detail

**Acceptance criteria:**
- Bottom navigation bar on mobile viewports (< 768px)
- Page transitions are smooth (no white flash)
- Skeleton screens show during data loading
- Lighthouse PWA audit passes (all checks green)
- Lighthouse Performance score >90 on mobile

### TB-4 Definition of Done

- [ ] `manifest.json` valid, app installable on Chrome, Edge, Safari
- [ ] Service worker caches app shell and API responses
- [ ] Recently viewed boards accessible offline (read-only)
- [ ] Offline indicator banner shown when disconnected
- [ ] Queued actions sync on reconnect
- [ ] Pull-to-refresh on board and workspace views
- [ ] Card detail as bottom sheet on mobile
- [ ] Bottom navigation bar on mobile viewports
- [ ] Lighthouse PWA audit: all checks pass
- [ ] Lighthouse Performance (mobile): >90
- [ ] Touch targets ≥ 44px
- [ ] iOS safe areas respected
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (all existing + new tests)
- [ ] E2E tests updated for PWA install prompt and offline banner

---

## TB-5: Build Extended Features and Integrations

**Personas:** backend_developer, frontend_developer
**Estimated stories:** 8
**Dependencies:** TB-3 complete (full UI working)

### What This Ticket Delivers

Polish features that make the demo compelling. These are the "wow factor" additions.

### Phase 4.1 — Card Enhancements

- **Card comments** — Add comments to cards (text, displayed in card detail)
- **Card checklists** — Subtasks within a card (checkbox list)
- **Card cover images** — Color or image header on card
- **Card due date warnings** — Visual indicator when due date is approaching or past
- **Keyboard shortcuts:**
  - `N` — New card
  - `E` — Edit card
  - `Delete` — Delete card (with confirmation)
  - `Esc` — Close modal
  - Arrow keys — Navigate between cards

### Phase 4.2 — Board Enhancements

- **Board filtering** — Filter cards by assignee, priority, label, due date
- **Board search** — Search cards by title/description
- **Column WIP limits** — Optional max cards per column (visual warning when exceeded)
- **Board templates** — "Kanban", "Scrum Sprint", "Bug Tracking" presets on board creation

### Phase 4.3 — Workspace Features

- **Workspace-level search** — Search across all boards and cards
- **Starred boards** — Pin favorite boards to top of sidebar
- **Recent activity notifications** — Badge on sidebar items with unread changes
- **Workspace avatar upload** — Upload custom avatar (store as base64 or use initials)

### Phase 4.4 — Performance & Accessibility

- **Accessibility audit** — axe-core scan, fix all violations
- **ARIA labels** on drag-and-drop elements
- **Focus management** — Keyboard-navigable board
- **Image optimization** — next/image for all images
- **Lazy loading** — Code split board view and charts
- **Performance audit** — Lighthouse score >90 on all pages

### TB-5 Definition of Done

- [ ] Card comments, checklists, and cover images working
- [ ] Board filtering and search
- [ ] Keyboard shortcuts functional
- [ ] Workspace search across boards
- [ ] Starred boards in sidebar
- [ ] axe-core: 0 accessibility violations on main pages
- [ ] Lighthouse Performance score >90
- [ ] All new features have unit tests
- [ ] Existing test mocks updated for any modified code (see Mandatory Rule #9)
- [ ] E2E tests updated/added for new UI features (see Mandatory Rule #7)
- [ ] CI browser install matches playwright.config.ts projects (see Mandatory Rule #8)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes (all unit AND existing tests green)
- [ ] CI fully green (quality + E2E) BEFORE merging (see Mandatory Rule #10)

---

## TB-6: Deploy to Production

**Personas:** devops_engineer
**Estimated stories:** 5
**Dependencies:** TB-3 complete minimum (TB-5 is nice-to-have)

### What This Ticket Delivers

Production deployment verified end-to-end. The live URL is functional, seeded with demo data, and passing all smoke tests. CI/CD pipeline is fully operational.

### Phase 5.1 — Production Environment Configuration

**All infrastructure is pre-configured.** Vercel project, Neon database, DNS, env vars, and GitHub secrets were set up during bootstrapping.

| Resource | Status |
|----------|--------|
| Vercel project (Next.js, Node 22) | ✅ Pre-configured |
| Custom domain (`teamboard.workermill.com`) | ✅ DNS CNAME + Vercel verified |
| Neon PostgreSQL | ✅ Provisioned |
| Vercel env vars (5) | ✅ Set |
| GitHub secrets (8) | ✅ Set |
| GitHub → Vercel auto-deploy | ✅ Enabled |
| SSL certificate | ✅ Automatic via Vercel |

**What workers verify:** Push to main triggers a Vercel deploy and the site loads at `https://teamboard.workermill.com`.

**Acceptance criteria:**
- Custom domain resolves to Vercel with HTTPS
- Build succeeds on Vercel
- Auto-deploy triggers on push to main

### Phase 5.2 — Database Migration & Seed

1. Run Prisma migrations against production Neon database
2. Run seed script to populate demo data
3. Verify data via API endpoints

```bash
# From CI/CD pipeline or manual:
DATABASE_URL=$PRODUCTION_DATABASE_URL npx prisma migrate deploy
DATABASE_URL=$PRODUCTION_DATABASE_URL npx tsx prisma/seed.ts
```

**Acceptance criteria:**
- All tables created in production database
- Seed data loaded (demo user, workspace, boards, cards, activities)
- `demo@workermill.com` / `demo1234` can authenticate
- API returns seeded data correctly

### Phase 5.3 — CI/CD Pipeline Verification

Verify the full CI/CD pipeline works end-to-end:

1. **CI gate works:** Push a branch → CI runs (lint, typecheck, test, e2e) on `ubuntu-latest` → All pass
2. **Deploy gate works:** Merge to main → Vercel auto-deploys → Post-deploy workflow runs migrations + smoke test
3. **Failure handling:** Intentionally break a test → CI blocks merge

**Pipeline flow:**
```
Push to branch
  → CI: lint → typecheck → unit tests → e2e tests
  → All pass → PR mergeable

Merge to main
  → Vercel auto-deploys via GitHub integration
  → Post-deploy workflow: prisma migrate → seed → smoke test
  → Deployment live at teamboard.workermill.com
```

**Acceptance criteria:**
- CI runs on every push and PR (`ubuntu-latest`)
- Vercel auto-deploys on merge to main
- Failed CI blocks PR merge (branch protection rule set)
- Smoke test (`/api/health`) passes post-deploy

### Phase 5.4 — Smoke Tests & Validation

Run the full smoke test suite against production:

```bash
# 1. Health check
curl -f https://teamboard.workermill.com/api/health

# 2. Auth works — login as demo user
# (Use browser or API test to verify session-based auth)

# 3. API returns data
# GET /api/workspaces → returns "Acme Product" workspace

# 4. Board has cards
# GET /api/workspaces/acme-product/boards → returns 3 boards
# GET /api/workspaces/acme-product/boards/<id> → returns columns with cards

# 5. Stats endpoint returns chart data
# GET /api/workspaces/acme-product/stats → returns aggregated stats

# 6. SSE stream connects
# GET /api/workspaces/acme-product/stream → returns text/event-stream
```

**Full acceptance criteria (user can do all of these):**
- [ ] See a landing page explaining what TeamBoard is, with "Try the Demo" button
- [ ] Click "Try the Demo" and be logged in as the demo user
- [ ] See the "Acme Product" workspace with 3 boards listed in the sidebar
- [ ] Open the "Product Roadmap" board and see 5 columns with cards
- [ ] Drag a card from "To Do" to "In Progress" and see it persist after page reload
- [ ] Click a card to see its detail (title, description, priority, assignee, due date, labels)
- [ ] Edit a card's title and description
- [ ] Create a new card in any column
- [ ] Navigate to the Dashboard and see 4 charts with real data from the seed
- [ ] Navigate to Activity and see recent actions
- [ ] Navigate to Members and see the member list with roles
- [ ] The entire experience is responsive (works on mobile viewport)
- [ ] Page load time < 2 seconds on 4G connection

### Phase 5.5 — E2E Tests Against Production (Optional)

Run Playwright tests against the live production URL:

```yaml
# In CI pipeline, after deploy:
- name: E2E against production
  run: |
    PLAYWRIGHT_BASE_URL=https://teamboard.workermill.com \
    npm run test:e2e
```

Test scenarios:
1. Landing page loads, "Try the Demo" button visible
2. Demo login works
3. Workspace list shows "Acme Product"
4. Board view renders columns and cards
5. Drag and drop moves a card
6. Card detail opens and is editable
7. Dashboard charts render
8. Activity feed shows entries

### TB-6 Definition of Done

- [ ] `https://teamboard.workermill.com` loads the landing page
- [ ] `/api/health` returns 200
- [ ] Demo user can log in via "Try the Demo"
- [ ] All 3 boards visible with correct card counts
- [ ] Drag and drop works and persists
- [ ] Dashboard charts render with real data
- [ ] Activity feed shows entries
- [ ] Responsive on mobile
- [ ] CI pipeline runs on push (lint, typecheck, test, e2e) on `ubuntu-latest`
- [ ] Vercel auto-deploys on merge to main
- [ ] Post-deploy workflow runs migrations + smoke test
- [ ] Smoke tests pass post-deploy
- [ ] Page load time < 2 seconds
- [ ] "Built by WorkerMill" visible in footer

---

## Quality Gates (All Tickets)

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors, 0 warnings | ESLint with strict config |
| Types | 0 errors | `tsc --noEmit` |
| Unit tests | 100% pass, >60% coverage on API routes | Vitest |
| E2E tests | 100% pass (including pre-existing tests) | Playwright |
| Security | 0 high/critical vulnerabilities | `npm audit` |
| Build | Successful production build | `next build` |
| Accessibility | 0 violations on main pages | axe-core in Playwright |
| Performance | Lighthouse >90 | Lighthouse CI |
| **CI gate** | **ALL GitHub Actions checks pass before merge** | `gh pr checks --watch` |

---

## Worker Execution Rules (MANDATORY — All Tickets)

These rules apply to every phase and every worker. Violations cause CI failures and require manual cleanup.

1. **Read CLAUDE.md first:** Before starting any work, read `CLAUDE.md` in the repo root for project conventions and patterns from previous phases.
2. **Run ALL quality checks before PR:** Before creating a pull request:
   - `npm run typecheck` — 0 errors
   - `npm run lint` — 0 errors
   - `npm run test` — all tests pass
   - `npm run test:e2e` — if this script exists, ALL E2E tests must pass (including pre-existing tests)
3. **Wait for CI before merge:** After creating a PR, run `gh pr checks <PR_NUMBER> --watch` and verify all checks pass. **NEVER merge with failing checks.**
4. **Update CLAUDE.md:** Before creating your PR, update CLAUDE.md if you established new patterns or conventions.
5. **Existing tests must keep passing:** When modifying existing components, run the full test suite to verify no regressions.
6. **Verify against actual DOM:** When writing tests, inspect the actual rendered output. Never assume routes or elements exist.

### Playwright E2E Testing Conventions

- Use `getByRole` with `{ name }` for interactive elements — NOT `getByText` (which returns the innermost text node, often a `<span>`)
- Use `{ exact: true }` for text queries to avoid substring matching
- Verify ARIA attributes are valid for the element's role (e.g., `aria-expanded` is NOT valid on `type="search"` inputs)
- Test against actual routes — check `src/app/` directory structure before writing navigation tests
- Use `div[role="img"]` not `[role="img"]` — SVG elements have implicit `role="img"`

### Estimated Plan Sizes

| Ticket | Recommended Stories | Notes |
|--------|-------------------|-------|
| TB-1 | 5-7 | One per phase (scaffold, schema, CI/CD, deploy, verify) |
| TB-2 | 8-10 | Group related routes (e.g., all workspace routes together) |
| TB-3 | 7-8 | One per UI section (auth, layout, board, dashboard, etc.) |
| TB-4 | 5-6 | PWA manifest, service worker, offline queue, mobile UX |
| TB-5 | 6-8 | Card features, board features, workspace features, accessibility |
| TB-6 | 4-6 | Deploy, migrate, smoke test, verify |

---

## Execution Order

```
TB-1 ─── TB-2 ─── TB-3 ──┬── TB-4 (PWA)
(repo &     (API)      (UI)  ├── TB-5 (polish)
 infra)                      └── TB-6 (deploy & validate)
```

- **TB-1 → TB-2 → TB-3** are strictly sequential
- **TB-4**, **TB-5**, and **TB-6** can run in parallel after TB-3
- **Minimum viable showcase**: TB-1 + TB-2 + TB-3 + TB-6
- **Full showcase**: All six tickets

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Neon free tier limits | Database throttled or unavailable | Monitor usage; Neon free tier is generous (0.5 GB, 190 compute hours) |
| Vercel build failures | Deploy blocked | Pin Node.js version, use `npm ci` for deterministic installs |
| GitHub Actions outage | CI/CD blocked | Rare; Vercel auto-deploy still works independently |
| @dnd-kit complexity | Drag-and-drop bugs | Use proven patterns from dnd-kit examples; focus on basic use case first |
| SSE connection limits | Real-time updates fail | Vercel edge supports SSE; keep-alive pings prevent timeout |
| Cross-task context loss | Workers deviate from patterns | CLAUDE.md updated every ticket with conventions |
| Seed data drift | Demo looks broken after changes | Idempotent seed script; re-seed after schema changes |
| Worker merges with failing CI | Broken production, manual cleanup | Deploy label MUST gate on CI passing (see Mandatory Rules) |
| E2E tests miss auth flows | Silent regressions on login/signup | E2E global setup seeds demo data; tests MUST cover auth |
| Missing Suspense boundaries | `next build` crashes, deploy blocked | All client hooks wrapped in Suspense (see Mandatory Rules) |
| **Merging with failing CI** | **E2E regressions in production** | **Worker Execution Rule #3: `gh pr checks --watch` before merge** |
| **Parallel story file conflicts** | **Merge conflicts between stories** | **Keep stories to 1-3 files; critic enforces 5-file cap** |
| **Invalid ARIA attributes** | **axe-core failures in E2E** | **Playwright conventions: verify ARIA validity before applying** |
| **Wrong Playwright selectors** | **Flaky/failing E2E tests** | **Use `getByRole` + `{ exact: true }`, not `getByText`** |
| **Too many stories in plan** | **Token waste, merge conflicts** | **Estimated plan sizes per ticket in PRD** |
| **shadcn/ui CLI generates files outside targetFiles** | **FILE SCOPE RESTRICTION blocks CLI output** | **Include `src/components/ui/` and `components.json` in targetFiles for UI scaffold stories** |
| **Dynamic route segments missing index page** | **404 on `/[workspace]` even though child routes work** | **Every `[param]/` dir needs `page.tsx` — add redirect to default child (see Mandatory Rule #11)** |

---

## Mandatory Rules (Lessons from v1 Build)

> **These rules exist because real bugs were found during the v1 build.** Every rule traces to a production incident or CI failure. Workers MUST follow these exactly.

### 1. Next.js 15 App Router Constraints

**Any page component using `useSearchParams()`, `usePathname()`, or other client-only hooks MUST be wrapped in a `<Suspense>` boundary.** Next.js 15 App Router performs static generation at build time, and these hooks cause `next build` to crash without Suspense.

```tsx
// WRONG — crashes next build
export default function LoginPage() {
  const searchParams = useSearchParams(); // Static generation fails here
  return <form>...</form>;
}

// RIGHT — works with static generation
function LoginForm() {
  const searchParams = useSearchParams();
  return <form>...</form>;
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
```

**This applies to:** `/login`, `/signup`, any page that reads URL parameters client-side.

### 2. Security: Validate All Redirect URLs

**Never pass user-controlled URLs directly to `router.push()` or `redirect()`.** This creates open redirect vulnerabilities.

```typescript
// WRONG — open redirect
const callbackUrl = searchParams.get('callbackUrl') || '/workspaces';
router.push(callbackUrl); // Attacker can set callbackUrl=https://evil.com

// RIGHT — validate relative path
const rawCallbackUrl = searchParams.get('callbackUrl') || '/workspaces';
const callbackUrl = rawCallbackUrl.startsWith('/') ? rawCallbackUrl : '/workspaces';
router.push(callbackUrl);
```

### 3. Optimistic UI Must Have Error Rollback

**All optimistic state updates (drag-and-drop, inline edits) MUST capture previous state and revert on API failure.** Fire-and-forget `fetch()` calls are forbidden.

```typescript
// WRONG — fire and forget, no rollback
setColumns(newColumns);
fetch('/api/cards/move', { method: 'POST', body: JSON.stringify(payload) });

// RIGHT — capture previous state, rollback on error
const prevColumns = columns;
setColumns(newColumns);
fetch('/api/cards/move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).catch(() => setColumns(prevColumns));
```

### 4. Prisma Requires Both DATABASE_URL and DIRECT_DATABASE_URL

**Neon PostgreSQL uses connection pooling.** The Prisma schema declares both `url` and `directUrl`. Any environment running Prisma commands (CI, deploy, local dev) MUST have BOTH environment variables set:

- `DATABASE_URL` — Pooled connection (for app runtime)
- `DIRECT_DATABASE_URL` — Direct connection (for migrations)

**Failure mode:** `prisma migrate deploy` crashes with `P1012 - Environment variable not found: DIRECT_DATABASE_URL` if missing.

### 5. CI E2E Environment Requirements

The E2E job needs more than just the database URL. Required env vars:

| Variable | Why |
|----------|-----|
| `DATABASE_URL` | App connects to Neon |
| `DIRECT_DATABASE_URL` | Prisma migrations |
| `NEXTAUTH_SECRET` | JWT signing |
| `NEXTAUTH_URL` | Auth callback URL |
| `AUTH_TRUST_HOST=true` | **Auth.js v5 rejects localhost as untrusted.** Vercel sets this automatically, but CI doesn't. Without it, all auth endpoints return `UntrustedHost` errors. |

### 6. E2E Tests Must Seed Their Own Data

**E2E tests MUST NOT depend on external seeding.** Use a Playwright `globalSetup` that creates the demo user, workspace, boards, and cards via Prisma before tests run. This makes E2E tests self-contained and reproducible.

The `playwright.config.ts` must include:
```typescript
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  // ...
});
```

The `global-setup.ts` creates the demo user with `prisma.user.upsert()` (always updating the password hash to ensure it matches test credentials).

### 7. E2E Tests Must Cover Core User Flows

**Minimum E2E test coverage (required for each ticket):**

| Flow | Test File | What to Assert |
|------|-----------|----------------|
| Auth | `auth.spec.ts` | Login, bad credentials, demo mode, signup page, redirect to login |
| Workspaces | `workspace.spec.ts` | List workspaces, navigate into workspace, role badges |
| Dashboard | `dashboard.spec.ts` | Stat cards render, chart data loads, sidebar nav |
| Board | `board.spec.ts` | Columns visible, cards visible, priority badges, drag handles |
| Mobile | `mobile.spec.ts` | Sidebar hidden, viewport sizing, form usability |

**Every ticket that adds UI features MUST add corresponding E2E tests.** The health check alone is not sufficient.

### 8. CI Browser Install Must Match Playwright Config

**When adding Playwright projects, the CI browser install step MUST be updated to match.** If `playwright.config.ts` includes a WebKit project (`mobile-safari`), CI must install WebKit.

Preferred: Use `npx playwright install --with-deps` (no browser argument) to automatically install all browsers referenced by the config's projects.

### 9. Workers Must Update Existing Test Mocks

**When modifying source code that is covered by mocked unit tests, workers MUST update the mocks.** Examples:
- Adding `TouchSensor` to `BoardView.tsx` → must add `TouchSensor` to the `@dnd-kit/core` mock in tests
- Changing the number of `useSensor` calls → must update `toHaveBeenCalledTimes()` assertions

**Rule:** After making code changes, run `npm run test` locally and fix any failures before committing.

### 10. Deploy Label Gates on CI

**The `deploy` label means "auto-merge and deploy" — but ONLY after CI passes.** The worker MUST:
1. Create the PR
2. Wait for CI to complete (poll check status)
3. Fix any CI failures (typecheck, lint, unit tests, E2E)
4. Only merge after ALL checks are green
5. Then deploy

**Never merge a PR with failing CI, even with the deploy label.**

### 11. Dynamic Route Segments Need Index Pages

**Every `[param]/` directory that users can navigate to MUST have a `page.tsx`.** Next.js App Router returns 404 for dynamic segments without a page component, even if child routes exist.

```tsx
// src/app/[workspace]/page.tsx — redirects to dashboard
import { redirect } from 'next/navigation';

export default function WorkspaceIndexPage({
  params,
}: {
  params: { workspace: string };
}) {
  redirect(`/${params.workspace}/dashboard`);
}
```

**This applies to:** `/[workspace]` (must redirect to `/[workspace]/dashboard`). Without this, clicking a workspace from the workspace list produces a 404.

---

## Operational Reference

> **This Operational Reference section is for TB-6 workers.** TB-1 workers should STOP reading at the "TB-1 Definition of Done" section above. The configurations below (vercel.json, performance targets, monitoring) are NOT part of TB-1 scope and should NOT be created during TB-1.

> This section covers production operations: environment setup, deployment, monitoring, troubleshooting, and recovery. Workers executing TB-6 should use this as their primary reference.

### Production Environment

| Component | Platform | Configuration |
|-----------|----------|---------------|
| **Application** | Vercel | Next.js 15, Node.js 22, IAD1 region |
| **Database** | Neon PostgreSQL | Pooled + direct connections, automatic backups |
| **DNS** | Custom domain | `teamboard.workermill.com` |
| **CI/CD** | GitHub Actions | `ubuntu-latest` runners |
| **SSL/TLS** | Vercel | Automatic certificate management |

**Live URLs:**
- **Production:** https://teamboard.workermill.com
- **Health Check:** https://teamboard.workermill.com/api/health

### Environment Variables

**Required for production (Vercel + GitHub Secrets):**

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon pooled connection string |
| `DIRECT_DATABASE_URL` | Neon direct connection (for migrations) |
| `NEXTAUTH_SECRET` | JWT session encryption key |
| `NEXTAUTH_URL` | Application URL (`https://teamboard.workermill.com`) |
| `AUTH_TRUST_HOST` | `true` — Auth.js v5 rejects localhost as untrusted without this |
| `SEED_TOKEN` | Protected seed endpoint token |

### CI/CD Pipeline Architecture

```
Push to Branch → Create PR
        │
        ▼
  CI Workflow (.github/workflows/ci.yml)
  ┌─────────────────────────────────────┐
  │  Quality Gate Job                    │
  │    ✓ npm ci → lint → typecheck      │
  │    ✓ test → npm audit               │
  │                                      │
  │  E2E Test Job (after quality)       │
  │    ✓ prisma migrate deploy          │
  │    ✓ npm run build                  │
  │    ✓ playwright install (all)       │
  │    ✓ seed E2E data → run tests      │
  │                                      │
  └──────────────┬──────────────────────┘
                 │ All checks pass
                 ▼
           Merge to main
                 │
        ┌────────┴────────┐
        ▼                 ▼
  Deploy Workflow    Vercel Auto-Deploy
  (deploy.yml)       (GitHub App)
  ┌──────────────┐
  │ 1. Migrate   │
  │ 2. Sleep 30s │
  │ 3. Seed data │
  │ 4. Smoke test│
  └──────────────┘
```

### Vercel Configuration

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
- `output: 'standalone'` — minimal Docker image
- `poweredByHeader: false` — remove X-Powered-By
- `compress: true` — Brotli compression
- `optimizePackageImports: ['lucide-react', '@radix-ui/*']` — reduce bundle size
- `images.formats: ['image/avif', 'image/webp']` — modern image formats

### Database Migrations

**Two-phase migration approach:**
1. **0001_init** — 9 core models (User, Workspace, Board, Column, Card, etc.)
2. **0002_extended_features** — Comment, ChecklistItem, StarredBoard, optional fields

**Commands:**
```bash
# Development
npx prisma db push              # Quick schema sync
npx prisma migrate dev --name X # Create migration file

# Production (automated by deploy.yml)
npx prisma migrate deploy

# Manual production (if needed)
export DATABASE_URL="<pooled-url>"
export DIRECT_DATABASE_URL="<direct-url>"
npx prisma migrate deploy
npx prisma migrate status       # Verify
```

**Rules:** Never edit existing migrations. Always test locally first. Use transactions for data migrations.

### Seeding Demo Data

**Endpoint:** `POST /api/seed` (requires `Authorization: Bearer $SEED_TOKEN`)

**Idempotent** — safe to run multiple times (checks for existing workspace slug).

**Creates:**
- Demo user: `demo@workermill.com` / `demo1234` (OWNER)
- Workspace: "Acme Product" (slug: `acme-product`) + 3 team members
- 3 boards: Product Roadmap (5 cols, 12 cards), Sprint 14 (4 cols, 10 cards), Bug Tracker (3 cols, 8 cards)
- 5 labels: Bug (red), Feature (blue), Enhancement (green), Documentation (purple), Urgent (orange)
- 25 activity entries (spanning 7 days)

### Smoke Tests

**Automated (in deploy.yml):**
1. `GET /api/health` → `{ "status": "ok" }`
2. `GET /` → 200
3. `GET /login` → 200
4. DNS resolution → Vercel IP
5. HTTPS certificate → valid

**Manual checklist (post-deploy):**
- [ ] Landing page loads, "Try the Demo" button visible
- [ ] Demo login → "Acme Product" workspace
- [ ] Dashboard shows 4 charts with data
- [ ] Product Roadmap board: 5 columns, cards draggable
- [ ] Card detail modal opens, edits save
- [ ] Activity feed, members page, settings page load
- [ ] Responsive at 320px mobile viewport
- [ ] No console errors
- [ ] Page load < 2 seconds on 4G

### Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Lighthouse Performance | >90 | 92 |
| First Contentful Paint | <1.5s | 1.2s |
| Time to Interactive | <2.5s | 2.1s |
| Total Bundle Size | <200KB | 178KB |
| API Response Time (p95) | <500ms | 320ms |

### Monitoring

**Vercel dashboard:** Deployment logs, function logs, analytics, Core Web Vitals.

**Neon console:** Connection pooling, query performance, storage usage, automatic daily backups.

### Rollback Procedures

**Application:** Vercel dashboard → Deployments → find last-good deployment → "Promote to Production". Or `vercel rollback` via CLI.

**Database:** Restore from Neon backup (console → Backups → select point → restore). Or create a reverse migration and deploy.

| Scenario | RTO | RPO |
|----------|-----|-----|
| Application rollback | 5 minutes | 0 (no data loss) |
| Database restore | 30 minutes | 24 hours (backup frequency) |
| Full rebuild | 2 hours | 24 hours |

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Build fails with TS errors | Code doesn't typecheck | `npm run typecheck` locally, fix errors |
| `prisma migrate deploy` fails | Missing `DIRECT_DATABASE_URL` or schema drift | Check env vars, run `npx prisma migrate status` |
| Seed endpoint 401 | Wrong `SEED_TOKEN` | Verify token matches in GitHub Secrets and Vercel |
| E2E tests timeout | Slow startup or DB issues | Check `/tmp/nextjs.log`, increase timeout to 30s |
| Auth "UntrustedHost" error | Missing `AUTH_TRUST_HOST=true` | Add to Vercel env vars and CI workflow |
| 404 on `/[workspace]` | Missing `page.tsx` for dynamic route | Add redirect page (see Mandatory Rule #11) |

### Security Measures

1. **HTTP headers** — CSP, XSS protection, frame deny, referrer policy (via `vercel.json`)
2. **Authentication** — NextAuth.js v5, JWT strategy, bcrypt 12 rounds
3. **Environment** — All secrets in Vercel env vars + GitHub Secrets, none in repo
4. **Database** — SSL/TLS required, connection pooling, Prisma prepared statements
5. **Dependencies** — `npm audit --audit-level=high` in CI

### Disaster Recovery

**Database corruption:** Neon console → Backups → restore → update `DATABASE_URL` → redeploy.

**Complete rebuild:**
1. Clone repo → provision new Neon database
2. `npx prisma migrate deploy` → `npm run db:seed`
3. Configure Vercel with new database → deploy
