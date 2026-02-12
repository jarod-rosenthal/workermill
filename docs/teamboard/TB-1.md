# TeamBoard — Project Setup & Dev Environment

> Built by WorkerMill | Ticket 1 of 5

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

## Prerequisites

None — this is the first ticket.

## What This Ticket Delivers

> **CRITICAL: Next.js 15, NOT 14.** Workers MUST install `next@^15.1.0`. Next.js 14.x has critical CVEs (`npm audit` will fail). If any tool or template suggests Next.js 14, override it to 15.

A fully scaffolded Next.js 15 monorepo with:
1. Project structure and all dependencies installed
2. Neon PostgreSQL database provisioned and connected
3. Prisma schema with all models and initial migration applied
4. Local dev environment running (`npm run dev`)
5. GitHub Actions CI pipeline (lint, typecheck, test)
6. GitHub Actions CD pipeline (deploy to Vercel)
7. Vercel project configured and first deploy live
8. Health check endpoint responding at production URL

**Source of Truth:**
- **Target repo**: `workermill-examples/teamboard` (GitHub)
- **Live URL**: https://teamboard.workermill.com
- **Deployment**: Vercel (app) + Neon PostgreSQL (database)
- **CI/CD**: GitHub Actions with `ubuntu-latest` runners (free for public repos)

---

## Phases

### Phase 0.1 — Repository Scaffolding

Create the `workermill-examples/teamboard` repository with this structure:

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
> - `vercel.json` — Vercel auto-detects Next.js, no config needed for TB-1 (vercel.json is a TB-5 concern)
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
> Do NOT add `output: 'standalone'`, `poweredByHeader`, `compress`, `optimizePackageImports`, or `images.formats`. Those are TB-5 (Production Deploy) items. TB-1 `next.config.js` is an empty config.

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
| Neon project | Created (`neondb` database) |
| Pooled connection (`DATABASE_URL`) | In GitHub secrets + Vercel env |
| Direct connection (`DIRECT_DATABASE_URL`) | In GitHub secrets + Vercel env |
| Neon API token (`NEON_API_TOKEN`) | In GitHub secrets |

**What workers need to do:** Apply the Prisma schema to the database (`npx prisma migrate deploy` or `npx prisma db push`).

> **Workers MUST use the EXACT Prisma schema below.** Do NOT add `@@map()`, `@@index()`, or any other annotations not shown. The schema is designed for Neon PostgreSQL and Prisma's default table naming is intentional.

**Prisma schema** — full data model:

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
| `DATABASE_URL` | Set |
| `DIRECT_DATABASE_URL` | Set |
| `NEON_API_TOKEN` | Set |
| `VERCEL_TOKEN` | Set |
| `VERCEL_ORG_ID` | Set |
| `VERCEL_PROJECT_ID` | Set |
| `NEXTAUTH_SECRET` | Set |
| `SEED_TOKEN` | Set |

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
| Vercel project (`teamboard`) | Created |
| GitHub repo linked | `workermill-examples/teamboard` |
| Framework | Next.js, Node 22 |
| Custom domain | `teamboard.workermill.com` (verified) |
| Env vars (5) | DATABASE_URL, DIRECT_DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, SEED_TOKEN |
| Auto-deploy on push | Enabled via Vercel GitHub App |

**What workers need to do:** Push the scaffolded Next.js app to trigger the first Vercel deploy, then verify the health check.

**Acceptance criteria:**
- `https://teamboard.workermill.com` loads
- `/api/health` returns `{ "status": "ok", "timestamp": "..." }`
- Vercel shows successful deployment in dashboard
- Auto-deploy triggers on merge to main

---

## Definition of Done

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

## Mandatory Rules

> These rules exist because real bugs were found during the v1 build. Every rule traces to a production incident or CI failure. Workers MUST follow these exactly.

### Rule 4: Prisma Requires Both DATABASE_URL and DIRECT_DATABASE_URL

**Neon PostgreSQL uses connection pooling.** The Prisma schema declares both `url` and `directUrl`. Any environment running Prisma commands (CI, deploy, local dev) MUST have BOTH environment variables set:

- `DATABASE_URL` — Pooled connection (for app runtime)
- `DIRECT_DATABASE_URL` — Direct connection (for migrations)

**Failure mode:** `prisma migrate deploy` crashes with `P1012 - Environment variable not found: DIRECT_DATABASE_URL` if missing.

### Rule 5: CI E2E Environment Requirements

The E2E job needs more than just the database URL. Required env vars:

| Variable | Why |
|----------|-----|
| `DATABASE_URL` | App connects to Neon |
| `DIRECT_DATABASE_URL` | Prisma migrations |
| `NEXTAUTH_SECRET` | JWT signing |
| `NEXTAUTH_URL` | Auth callback URL |
| `AUTH_TRUST_HOST=true` | **Auth.js v5 rejects localhost as untrusted.** Vercel sets this automatically, but CI doesn't. Without it, all auth endpoints return `UntrustedHost` errors. |

### Rule 8: CI Browser Install Must Match Playwright Config

**When adding Playwright projects, the CI browser install step MUST be updated to match.** If `playwright.config.ts` includes a WebKit project (`mobile-safari`), CI must install WebKit.

Preferred: Use `npx playwright install --with-deps` (no browser argument) to automatically install all browsers referenced by the config's projects.

---

## Worker Execution Rules

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

## Quality Gates

| Gate | Threshold | Tool |
|------|-----------|------|
| Lint | 0 errors, 0 warnings | ESLint with strict config |
| Types | 0 errors | `tsc --noEmit` |
| Unit tests | 100% pass, >60% coverage on API routes | Vitest |
| Security | 0 high/critical vulnerabilities | `npm audit` |
| Build | Successful production build | `next build` |

## Estimated Plan Size

5-7 stories — one per phase (scaffold, schema, CI/CD, deploy, verify).
