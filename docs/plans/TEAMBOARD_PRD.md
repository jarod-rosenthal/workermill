# TeamBoard — Full Build Specification

## Purpose

Polished demo app showcasing WorkerMill at `teamboard.workermill.com`. Full-stack SaaS Kanban board with RBAC, drag-and-drop, real-time updates, workspace dashboards, activity feeds, and PWA support. When a visitor clicks "Try the Demo", they should see a populated workspace with realistic boards, cards, and activity. Every page should have data. Empty states are failure.

**This app must look like it was designed by expert UI designers and built by a professional engineering team.** The bar is Linear, Notion, and Vercel's dashboard — not a weekend hackathon project.

## Source of Truth

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
| Auth | NextAuth.js v5 | `5.0.0-beta.25` exact, JWT strategy, bcrypt |
| Styling | TailwindCSS + shadcn/ui | Tailwind v4 (CSS-based config) |
| Drag & Drop | @dnd-kit/core | Latest |
| Charts | Recharts | Latest |
| Real-time | Server-Sent Events (SSE) | PostgreSQL polling |
| PWA | next-pwa or custom Workbox | Latest |
| Testing | Vitest + Testing Library + Playwright | Latest |
| CI/CD | GitHub Actions (`ubuntu-latest`) | Free for public repos |
| Hosting | Vercel | Automatic deploys |
| Database Hosting | Neon PostgreSQL | Free tier, connection pooling |

---

## CRITICAL: LLM Knowledge Gaps

Your training data may not include these — they are ALL correct and valid. Do NOT "fix" them.

### Next.js 15 Route Params (WILL BREAK BUILD IF WRONG)

Next.js 15 changed route handler signatures. `params` is now a `Promise` and MUST be awaited:

```typescript
// WRONG (Next.js 14 — WILL NOT BUILD):
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const board = await prisma.board.findUnique({ where: { id: params.id } });
}

// CORRECT (Next.js 15 — params is a Promise):
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const board = await prisma.board.findUnique({ where: { id } });
}
```

This applies to EVERY `route.ts` under `app/api/` with dynamic segments (`[id]`, `[slug]`, `[boardId]`, `[...nextauth]`), and to `page.tsx`/`layout.tsx` with dynamic params. Build fails with: `Type '{ params: { id: string; }; }' is not a valid type`.

### Tailwind v4 Configuration (NO JavaScript config)

Tailwind v4 does NOT use `tailwind.config.ts` or `tailwind.config.js`. Configuration is CSS-based with `@theme` directives. **Do NOT create a `tailwind.config.ts` file — delete it if it exists.**

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  --color-primary: #6366f1;
  --color-primary-foreground: #ffffff;
  --color-secondary: #f1f5f9;
  --color-accent: #8b5cf6;
  --color-destructive: #ef4444;
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-muted: #64748b;
  --color-background: #ffffff;
  --color-foreground: #0f172a;
  --color-card: #ffffff;
  --color-border: #e2e8f0;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
}
```

### Pinned Dependencies (DO NOT change)

- `"next": "^15.1.0"` — NOT 14.x (14 has critical CVEs)
- `"next-auth": "5.0.0-beta.25"` — exact beta version, NOT `"^5.0.0"` (doesn't exist on npm)
- `"eslint-config-next": "^15.1.0"` — must match Next.js major
- `"bcrypt": "^6.0.0"` — NOT v5.x (v5 has vulnerable `tar` dependency, fails `npm audit`)
- `"react": "^19.0.0"`, `"react-dom": "^19.0.0"`, `"@types/react": "^19.0.0"` — React 19
- `"@testing-library/react": "^16.0.0"` — React 19 compatible
- `node-version` in all CI workflows: `22` (matches Vercel runtime)

### React 19 Peer Dependency Resolution

If `npm ci` fails due to peer deps, add `.npmrc` with `legacy-peer-deps=true`. Do NOT use `--force`.

---

## Design Standards

Every page, component, and interaction must reflect the quality of a product designed by senior UI designers.

### Visual Identity
- **References:** Linear (clean density), Notion (warm neutrals + subtle depth), Vercel dashboard (typography + spacing)
- **Palette:** Primary, secondary, accent, semantic colors. Do NOT rely on shadcn/ui defaults. Use subtle gradients and tinted backgrounds.
- **Typography:** Inter or Geist. Clear type scale with medium (500) and semibold (600) for hierarchy.
- **Spacing:** 4px/8px grid. Generous whitespace. Cards and panels need breathing room.
- **Shadows:** Layered shadow system for cards, modals, dropdowns. Subtle elevation hierarchy.

### Interactions
- All state transitions animated (150-300ms, ease-out). Use `framer-motion` or CSS transitions.
- Every clickable element has visible hover state. Skeleton loading screens (shimmer). Friendly error states with retry.
- Card drag shadows, toast slide-in/out, checkbox animations, button press feedback.

### Responsive: 320px, 768px, 1024px, 1440px+
- Sidebar collapses to hamburger on mobile. Board view: horizontal scroll for columns. Card detail: full-screen sheet on mobile.
- Touch targets >= 44px. No horizontal overflow.

### Design Anti-Patterns
- Do NOT ship default shadcn/ui without customization. Do NOT use raw Tailwind gray as only color.
- Do NOT skip loading/empty/error states. Do NOT use instant state changes without animation.
- Do NOT use placeholder "Lorem ipsum" — write realistic product copy.

---

## Code Style Rules

- TypeScript strict mode, no `any` types
- All `useSearchParams()` / `usePathname()` MUST be wrapped in `<Suspense>` (Next.js 15 build crashes without it)
- Never pass user-controlled URLs to `router.push()` — validate as relative path first
- All optimistic UI updates MUST capture previous state and revert on API failure
- Prisma requires BOTH `DATABASE_URL` (pooled) and `DIRECT_DATABASE_URL` (direct for migrations)
- Every `[param]/` directory users can navigate to MUST have a `page.tsx`
- Do NOT create `postcss.config.*` — Next.js 15 includes PostCSS by default

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
  comments      Comment[]
  starredBoards StarredBoard[]
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

enum MemberRole { OWNER ADMIN MEMBER VIEWER }

model Board {
  id          String    @id @default(cuid())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workspaceId String
  name        String
  description String?
  position    Int       @default(0)
  createdAt   DateTime  @default(now())
  columns     Column[]
  starredBy   StarredBoard[]
}

model StarredBoard {
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId  String
  board   Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  boardId String
  @@id([userId, boardId])
}

model Column {
  id       String @id @default(cuid())
  board    Board  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  boardId  String
  name     String
  position Int    @default(0)
  color    String @default("#6B7280")
  wipLimit Int?
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
  coverColor  String?
  assignee    User?     @relation("assignee", fields: [assigneeId], references: [id])
  assigneeId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  labels      CardLabel[]
  comments    Comment[]
  checklists  ChecklistItem[]
}

enum Priority { URGENT HIGH MEDIUM LOW }

model Comment {
  id        String   @id @default(cuid())
  card      Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)
  cardId    String
  user      User     @relation(fields: [userId], references: [id])
  userId    String
  content   String   @db.Text
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ChecklistItem {
  id        String   @id @default(cuid())
  card      Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)
  cardId    String
  title     String
  completed Boolean  @default(false)
  position  Int      @default(0)
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
  type        String
  entityType  String
  entityId    String
  data        Json
  createdAt   DateTime  @default(now())
}
```

**Use this EXACT schema.** Do NOT add `@@map()`, `@@index()`, or annotations not shown.

---

## API Endpoints

### Auth
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/signup` | None | `{email, password, name}` → creates user, returns session |
| GET/POST | `/api/auth/[...nextauth]` | None | NextAuth.js handler. JWT strategy, bcrypt 12+ rounds |

### Health & Seed
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/health` | None | `{ "status": "ok", "timestamp": "..." }` |
| POST | `/api/seed` | Bearer `$SEED_TOKEN` | 200 success, 409 already seeded. Idempotent |

### Workspaces
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces` | Required | List user's workspaces |
| POST | `/api/workspaces` | Required | Create workspace (creator = OWNER) |
| GET/PUT | `/api/workspaces/[slug]` | Member/Admin+ | Detail / update |
| DELETE | `/api/workspaces/[slug]` | Owner | Delete workspace |

### Members
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces/[slug]/members` | Member | List members |
| POST | `/api/workspaces/[slug]/members` | Admin+ | Invite by email |
| PUT/DELETE | `/api/workspaces/[slug]/members/[id]` | Admin+ | Change role / remove |

### Boards & Columns
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET/POST | `/api/workspaces/[slug]/boards` | Member/Member+ | List / create |
| GET/PUT/DELETE | `/api/workspaces/[slug]/boards/[id]` | Member/Member+/Admin+ | Detail / update / delete |
| POST | `/api/boards/[id]/columns` | Member+ | Create column |
| PUT | `/api/boards/[id]/columns/reorder` | Member+ | Reorder columns |
| PUT/DELETE | `/api/columns/[id]` | Member+/Admin+ | Update / delete column |
| POST/DELETE | `/api/boards/[id]/star` | Member | Star / unstar |

### Cards
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/columns/[id]/cards` | Member+ | Create card |
| GET/PUT/DELETE | `/api/cards/[id]` | Member/Member+/Member+ | Detail / update / delete |
| POST | `/api/cards/move` | Member+ | `{ cardId, targetColumnId, targetPosition }` — single transaction |
| POST/DELETE | `/api/cards/[id]/comments` | Member+/Author+ | Add / delete comment |
| POST/PUT/DELETE | `/api/cards/[id]/checklist` | Member+ | Checklist CRUD |

### Activity, Stats, Search, SSE
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/workspaces/[slug]/activity` | Member | Cursor-based, 20/page |
| GET | `/api/workspaces/[slug]/stats` | Member | `tasksByStatus`, `tasksByAssignee`, `tasksOverTime`, `overdueCount`, `totalCards`, `completedCards` |
| GET | `/api/workspaces/[slug]/search` | Member | Search cards by title/description across boards |
| GET | `/api/workspaces/[slug]/stream` | Member (query param JWT) | SSE events: `card_created/moved/updated/deleted`, `board_updated`. Keep-alive 20s, polling 1-2s |

### RBAC: OWNER (full control) > ADMIN (manage members/boards) > MEMBER (create/edit) > VIEWER (read-only)

---

## Frontend Routes

| Path | Page | Auth |
|------|------|------|
| `/` | Landing page (public marketing) | None |
| `/login`, `/signup` | Auth forms | None |
| `/workspaces` | Workspace list | Required |
| `/[workspace]/dashboard` | Dashboard with 4 charts + stats | Member |
| `/[workspace]/boards/[id]` | Kanban board view | Member |
| `/[workspace]/activity` | Activity feed | Member |
| `/[workspace]/members` | Member management | Member |
| `/[workspace]/settings` | Workspace settings | Admin+ |

**Layout:** Landing + auth pages render WITHOUT sidebar (full-width). All authenticated routes render WITH sidebar.

### Landing Page (`/`)
Hero with gradient, "Try the Demo" CTA, feature cards, "How It Works", "Built by WorkerMill" section with badge. Professional SaaS aesthetic. "Sign In" in top nav.

### Kanban Board
- `BoardView` → horizontal scrolling columns. `Column` → card list with header, count, color, WIP warning. `Card` → draggable with title, priority badge, assignee avatar, due date, labels, cover color, checklist progress.
- `CardDetail` modal (desktop) / full-screen sheet (mobile): inline-editable title, rich description, priority/assignee/due date/label/cover pickers, comments, checklist with progress bar, delete button.
- **Drag & Drop (@dnd-kit):** Within and between columns. Visual drop indicators. Optimistic UI with rollback. Long-press for touch.
- Filter bar: assignee, priority, label, due date. Search within board. WIP limits with amber/red warnings.
- Keyboard: N=new, E=edit, Del=delete, Esc=close, arrows=navigate.

### Dashboard: 4 charts (tasks by status pie, tasks by assignee bar, tasks over time line, overdue count card). Animated counters.

### Activity Feed: Chronological list with avatars + relative timestamps. Pagination. Real-time via SSE.

### Members: List with role badges. Invite form (Admin+). Role change dropdown. Remove button.

### Settings: Workspace name/description edit. Labels CRUD. Danger zone: delete workspace (Owner, confirm dialog).

### Sidebar: Workspace name, nav (Dashboard, Boards with expandable list + star toggle, Activity, Members, Settings), starred boards pinned, active indicator bar, collapsible on mobile, user avatar at bottom.

---

## PWA

- `public/manifest.json` with icons (192px, 512px, maskable). Apple meta tags. `theme-color`.
- Service worker: cache-first for static assets, network-first for API, stale-while-revalidate for board detail.
- Offline: recently viewed boards read-only, offline banner, card moves queued in IndexedDB, synced on reconnect.
- Mobile: pull-to-refresh, haptic on drag, swipe gestures, bottom sheet for card detail, bottom nav bar (<768px), iOS safe areas.
- Lighthouse PWA audit: all checks pass. Performance >90 mobile.

---

## Seed Data

`POST /api/seed` — run on every deploy, idempotent (upsert).

- **Demo user:** `demo@workermill.com` / `demo1234` (OWNER)
- **Workspace:** "Acme Product" (slug: `acme-product`) + 3 team members
- **3 Boards:** Product Roadmap (5 cols, 12 cards), Sprint 14 (4 cols, 10 cards, some overdue), Bug Tracker (3 cols, 8 cards)
- **5 Labels:** Bug (red), Feature (blue), Enhancement (green), Documentation (purple), Urgent (orange)
- **25 Activities:** Spread over 7 days, varied types and timestamps
- Cards have realistic titles, varied priorities/assignees/due dates/labels. Some with comments (2-3), checklists (3-5 items), cover colors, overdue dates.

---

## Configuration

### package.json scripts
```json
{
  "dev": "next dev", "build": "next build", "start": "next start",
  "lint": "next lint", "typecheck": "tsc --noEmit",
  "test": "vitest run", "test:e2e": "playwright test",
  "format": "prettier --write .",
  "db:push": "prisma db push", "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts", "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```
- `"test"` MUST be `"vitest run"` (NOT `"vitest"` — hangs CI). `"postinstall"` MUST be `"prisma generate"`.

### Local Development
```bash
cp .env.example .env.local
docker compose up -d --wait    # PostgreSQL 16-alpine on port 5432
npm install && npx prisma db push && npm run db:seed && npm run dev
```

### .env.example
```bash
DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"
DIRECT_DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"
NEXTAUTH_SECRET="local-dev-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST="true"
SEED_TOKEN="local-dev-seed-token"
```

### .npmrc (repo root — MUST create during scaffolding)
```
legacy-peer-deps=true
```
React 19 peer dependency conflicts with `@testing-library/react` and other packages will cause `npm ci` and `npm install` to fail without this. Create this file in the scaffolding story BEFORE any `npm install`.

### Quality Gates (pre-commit)
```
npm run lint && npm run typecheck && npm run build && npm run test && npm audit --audit-level=high
```
E2E tests run post-push in CI. Workers should also run locally: `npx playwright install --with-deps chromium && npm run test:e2e`.

### CLAUDE.md (repo root)

Create this file to guide AI workers:
```markdown
# TeamBoard
Next.js 15, Prisma, PostgreSQL, NextAuth.js v5.

## Commands
| Task | Command |
|------|---------|
| Install | `npm install` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Unit tests | `npm run test` |
| E2E tests | `npx playwright install --with-deps chromium && npm run test:e2e` |
| Validate | `npm run lint && npm run typecheck && npm run build && npm run test && npm audit --audit-level=high` |

## CRITICAL Constraints
- Next.js 15 route params are Promises: `{ params: Promise<{ id: string }> }` then `await params`
- Tailwind v4: NO `tailwind.config.ts` — use CSS `@theme` in globals.css
- `bcrypt ^6.0.0` (NOT 5.x), `next-auth` exact `5.0.0-beta.25`
- All `useSearchParams()` wrapped in `<Suspense>`
- Do NOT create `postcss.config.*`
- `npm run build` MUST succeed before pushing
```

### CI Pipeline
Quality job: checkout → setup-node 22 → `npm ci` → lint → typecheck → build → test → `npm audit --audit-level=high`.
E2E job (needs quality): `npm ci` → `prisma migrate deploy` → build → `npx playwright install --with-deps` → test:e2e.

### Vercel Config
- `output: 'standalone'`, `poweredByHeader: false`, `compress: true`
- `vercel.json`: `maxDuration: 10` for API routes, security headers (nosniff, DENY, XSS protection)
- Prisma binary targets: include `"rhel-openssl-3.0.x"` for Vercel serverless
- `NEXTAUTH_URL` and `AUTH_TRUST_HOST` must be set at build time

### GitHub Secrets (pre-configured)
DATABASE_URL, DIRECT_DATABASE_URL, NEON_API_TOKEN, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, NEXTAUTH_SECRET, SEED_TOKEN — all set.

### Neon PostgreSQL + Vercel Project — pre-configured and linked.

---

## E2E Tests

Playwright tests against dev server + real PostgreSQL. `global-setup.ts` seeds demo data via Prisma.

**Test files:** auth, workspace, dashboard, board, card-detail, activity, members, mobile, pwa.

**Projects:** Desktop Chrome, Pixel 5, iPhone 13. `webServer`: `npm run build && npm run start` on port 3000.

**Conventions:** Use `getByRole` with `{ name }`, `{ exact: true }`. NEVER use Tailwind classes as selectors. Use `data-testid` for complex components.

---

## Anti-Patterns (Do NOT)

- Do NOT use synchronous `params` in route handlers — Next.js 15 requires `params: Promise<{...}>` and `await params` (build WILL fail)
- Do NOT create `tailwind.config.ts` — Tailwind v4 uses CSS `@theme` only (delete if exists)
- Do NOT use `bcrypt` v5.x — use `^6.0.0` (v5 fails `npm audit`)
- Do NOT use `next-auth` `^5.0.0` — use exact `5.0.0-beta.25`
- Do NOT use Next.js 14 — use 15
- Do NOT use `useSearchParams()` without `<Suspense>` boundary
- Do NOT create `postcss.config.*` — Next.js 15 includes PostCSS
- Do NOT create dynamic route directories without `page.tsx`
- Do NOT use `"vitest"` as test script — hangs CI
- Do NOT add `@@map()`, `@@index()` to Prisma schema
- Do NOT ship default shadcn/ui without customization
- Do NOT skip loading/empty/error states
- Do NOT use instant state changes without animation
- Do NOT claim completion without running `npm run typecheck && npm run build`
