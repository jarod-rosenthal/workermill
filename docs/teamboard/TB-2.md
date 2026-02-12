# TeamBoard — Core Backend API

> Built by WorkerMill | Ticket 2 of 5

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

TB-1 is complete — the repository exists at `workermill-examples/teamboard` with:
- Full project structure scaffolded (Next.js 15, TypeScript, TailwindCSS)
- Prisma schema applied to Neon PostgreSQL (all models created)
- CI/CD pipelines configured (GitHub Actions)
- Vercel project deployed and health check responding
- Demo user `demo@workermill.com` / `demo1234` created by TB-1 seed

## What This Ticket Delivers

All API routes functional with auth, RBAC, data validation, and tests. No UI — just API endpoints that return JSON.

---

## Prisma Schema Reference

Workers need the schema for API route implementation. This is the schema created by TB-1:

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

---

## Phases

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
- Cascade delete (board -> columns -> cards)

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
  "tasksByStatus": [{ "status": "To Do", "count": 5 }],
  "tasksByAssignee": [{ "name": "Alice", "count": 8 }],
  "tasksOverTime": [{ "date": "2026-02-01", "count": 3 }],
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

`prisma/seed.ts` creates the demo workspace as specified:

**Demo user:** `demo@workermill.com` / `demo1234`

> **The email is `demo@workermill.com` — NOT `demo@teamboard.dev`, NOT `demo@teamboard.com`, NOT any other domain.** Workers: if you see `@teamboard.dev` anywhere in your code, it is WRONG. Replace with `@workermill.com`.

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

---

## Definition of Done

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

## Mandatory Rules

> These rules exist because real bugs were found during the v1 build. Every rule traces to a production incident or CI failure. Workers MUST follow these exactly.

### Rule 4: Prisma Requires Both DATABASE_URL and DIRECT_DATABASE_URL

**Neon PostgreSQL uses connection pooling.** The Prisma schema declares both `url` and `directUrl`. Any environment running Prisma commands (CI, deploy, local dev) MUST have BOTH environment variables set:

- `DATABASE_URL` — Pooled connection (for app runtime)
- `DIRECT_DATABASE_URL` — Direct connection (for migrations)

**Failure mode:** `prisma migrate deploy` crashes with `P1012 - Environment variable not found: DIRECT_DATABASE_URL` if missing.

### Rule 6: E2E Tests Must Seed Their Own Data

**E2E tests MUST NOT depend on external seeding.** Use a Playwright `globalSetup` that creates the demo user, workspace, boards, and cards via Prisma before tests run. This makes E2E tests self-contained and reproducible.

The `playwright.config.ts` must include:
```typescript
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  // ...
});
```

The `global-setup.ts` creates the demo user with `prisma.user.upsert()` (always updating the password hash to ensure it matches test credentials).

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

8-10 stories — group related routes (e.g., all workspace routes together).
