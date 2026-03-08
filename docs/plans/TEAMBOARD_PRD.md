# TeamBoard — Build Specification

## Purpose

Polished demo app showcasing WorkerMill at `teamboard.workermill.com`. Full-stack SaaS Kanban board with RBAC, drag-and-drop, real-time updates, workspace dashboards, activity feeds, and PWA support. When a visitor clicks "Try the Demo", they should see a populated workspace with realistic boards, cards, and activity. Every page should have data. Empty states are failure.

**This app must look like it was designed by expert UI designers and built by a professional engineering team.** The bar is Linear, Notion, and Vercel's dashboard — not a weekend hackathon project.

## Source of Truth

- **Repo:** `workermill-examples/teamboard` (GitHub, PAT configured as `GH_TOKEN` secret)
- **Live URL:** https://teamboard.workermill.com
- **Deployment:** Vercel (app) + Neon PostgreSQL (database)
- **CI/CD:** GitHub Actions with `ubuntu-latest` runners (free for public repos)

---

## 1. Tech Stack & Dependencies

| Layer | Package | Version | Notes |
|-------|---------|---------|-------|
| Framework | `next` | `^15.1.0` | App Router. NOT 14.x. |
| ORM | `prisma` + `@prisma/client` | `^6.1.0` | NOT v7 (breaking datasource changes). |
| Database | PostgreSQL (Neon) | Free tier | Connection pooling enabled. |
| Auth | `next-auth` | `5.0.0-beta.25` exact | NOT `^5.0.0` (doesn't exist on npm). JWT strategy. |
| Auth adapter | `@auth/prisma-adapter` | `^2.11.1` | NOT `^3.x` (3.7.0 doesn't exist on npm). |
| Password hashing | `bcrypt` | `^6.0.0` | NOT v5.x (fails `npm audit`). |
| Styling | `tailwindcss` | `^4.0.0` | CSS-based config only. See Tailwind section. |
| Styling PostCSS | `@tailwindcss/postcss` | latest (devDep) | Required for Tailwind v4 compilation. |
| UI components | shadcn/ui | latest | Must be customized beyond defaults. |
| Drag & Drop | `@dnd-kit/core` | latest | |
| Charts | `recharts` | latest | |
| Animation | `framer-motion` | latest | |
| React | `react` + `react-dom` | `^19.0.0` | |
| React types | `@types/react` + `@types/react-dom` | `^19.0.0` | |
| Testing | `vitest` | latest (devDep) | |
| Testing React | `@testing-library/react` | `^16.0.0` (devDep) | React 19 compatible. |
| E2E | `@playwright/test` | latest (devDep) | |
| ESLint | `eslint-config-next` | `^15.1.0` | Must match Next.js major. |
| Node.js | | `22` | In all CI workflows. Matches Vercel runtime. |

### `.npmrc` (create in repo root during scaffolding, BEFORE `npm install`)
```
legacy-peer-deps=true
```
React 19 peer dependency conflicts cause `npm ci` and `npm install` to fail without this.

---

## 2. Tailwind v4 Setup

Tailwind v4 does NOT use `tailwind.config.ts` or `tailwind.config.js`. Delete these files if they exist.

**Three files are required:**

**`postcss.config.mjs`** — without this file, zero CSS renders:
```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

**`app/globals.css`** — CSS-based theme configuration:
```css
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

**`app/layout.tsx`** must import `./globals.css`.

---

## 3. Authentication (NextAuth v5)

Auth is split into TWO files because `middleware.ts` runs in Edge runtime, which cannot execute Node.js native modules (bcrypt, prisma).

### `lib/auth.config.ts` — Edge-safe config
No prisma, no bcrypt, no PrismaAdapter. Middleware imports from this file.
```typescript
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      // authorize is NOT here — it needs prisma+bcrypt (Node.js only)
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) { token.id = user.id; }
      return token;
    },
    session({ session, token }) {
      if (token?.id) { session.user.id = token.id as string; }
      return session;
    },
  },
  pages: { signIn: "/login" },
};
```

### `lib/auth.ts` — Full config (server-side only)
Extends the Edge-safe config with PrismaAdapter and the authorize function.
```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password  // Field name is "password", NOT "passwordHash"
        );
        return valid ? { id: user.id, email: user.email, name: user.name } : null;
      },
    }),
  ],
});
```

### `middleware.ts` — Edge-safe auth redirects
```typescript
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|browserconfig.xml|og-image.png|icons).*)'],
};
```

### `app/api/auth/[...nextauth]/route.ts`
```typescript
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

### Protected API routes
```typescript
import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // ...
}
```

---

## 4. Next.js 15 Route Params

Every `route.ts`, `page.tsx`, and `layout.tsx` with dynamic segments MUST use Promise-based params:

```typescript
// CORRECT:
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}

// WRONG (will not build):
export async function GET(req: Request, { params }: { params: { id: string } }) {
```

---

## 5. Data Model

Use this EXACT schema. Every file that references these fields MUST use the exact names shown here.

**Field name reference:**
- User password field: `password` (NOT `passwordHash`)
- User avatar field: `avatar` (NOT `avatarUrl`)
- ChecklistItem text field: `text` (NOT `title`)
- Label color field: `color` as `String` (hex like `#EF4444`, NOT an enum)

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
  password      String
  avatar        String?
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
  text      String
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

Prisma's `JsonValue` type requires `any` for JSON metadata fields. Use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on those specific lines.

---

## 6. API Endpoints

All route handlers with dynamic segments use `params: Promise<{...}>` and `await params`.

RBAC hierarchy: OWNER > ADMIN > MEMBER > VIEWER. ADMINs cannot invite as OWNER (enforce hierarchy check in POST /members).

### Auth
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/signup` | None | `{email, password, name}` → creates user with bcrypt 12+ rounds, returns session |
| GET/POST | `/api/auth/[...nextauth]` | None | NextAuth.js handler |

### Health & Seed
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/health` | None | `{ "status": "ok", "timestamp": "..." }` |
| POST | `/api/seed` | Bearer `$SEED_TOKEN` | 200 success, 409 already seeded. Idempotent. |

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
| POST | `/api/workspaces/[slug]/members` | Admin+ | Invite by email. Enforce role hierarchy. |
| PUT/DELETE | `/api/workspaces/[slug]/members/[id]` | Admin+ | Change role / remove |

### Boards & Columns
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET/POST | `/api/workspaces/[slug]/boards` | Member/Member+ | List / create |
| GET/PUT/DELETE | `/api/workspaces/[slug]/boards/[id]` | Member/Admin+/Admin+ | Detail / update / delete |
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
| GET | `/api/workspaces/[slug]/activity` | Member | Cursor-based, 20/page. Use timestamp-based tracking (createdAt > lastTimestamp), NOT CUID comparison. |
| GET | `/api/workspaces/[slug]/stats` | Member | `tasksByStatus`, `tasksByAssignee`, `tasksOverTime`, `overdueCount`, `totalCards`, `completedCards` |
| GET | `/api/workspaces/[slug]/search` | Member | Search cards by title/description across boards |
| GET | `/api/workspaces/[slug]/stream` | Member (query param JWT) | SSE events: `card_created/moved/updated/deleted`, `board_updated`. Keep-alive 20s, polling 1-2s. Add AbortSignal listener for interval cleanup. |

---

## 7. Frontend

### Routes

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

Landing + auth pages render WITHOUT sidebar (full-width). All authenticated routes render WITH sidebar.

### Code Requirements
- TypeScript strict mode, no `any` types (except Prisma `JsonValue` — see above)
- All `useSearchParams()` / `usePathname()` wrapped in `<Suspense>` (build crashes without it)
- All optimistic UI updates capture previous state and revert on API failure
- Every `[param]/` directory users can navigate to has a `page.tsx`
- Customize shadcn/ui components beyond defaults — match Linear/Notion aesthetic
- Every page has skeleton loading, error states with retry, and animations (150-300ms, ease-out)

### Landing Page (`/`)
Hero with gradient, "Try the Demo" CTA, feature cards, "How It Works", "Built by WorkerMill" section with badge. Professional SaaS aesthetic. "Sign In" in top nav.

### Kanban Board
- `BoardView` → horizontal scrolling columns. `Column` → card list with header, count, color, WIP warning. `Card` → draggable with title, priority badge, assignee avatar, due date, labels, cover color, checklist progress.
- `CardDetail` modal (desktop) / full-screen sheet (mobile): inline-editable title, rich description, priority/assignee/due date/label/cover pickers, comments, checklist with progress bar, delete button.
- **Drag & Drop (@dnd-kit):** Within and between columns. Visual drop indicators. Optimistic UI with rollback. Long-press for touch.
- Filter bar: assignee, priority, label, due date. Search within board. WIP limits with amber/red warnings.
- Keyboard: N=new, E=edit, Del=delete, Esc=close, arrows=navigate.

### Dashboard
4 charts (tasks by status pie, tasks by assignee bar, tasks over time line, overdue count card). Animated counters.

### Activity Feed
Chronological list with avatars + relative timestamps. Cursor-based pagination. Real-time via SSE.

### Members
List with role badges. Invite form (Admin+). Role change dropdown. Remove button.

### Settings
Workspace name/description edit. Labels CRUD with color picker (hex values). Danger zone: delete workspace (Owner, confirmation dialog).

### Sidebar
Workspace name, nav links (Dashboard, Boards with expandable list + star toggle, Activity, Members, Settings), starred boards pinned, active indicator bar, collapsible on mobile, user avatar at bottom.

**The sidebar renders desktop and mobile variants.** Every `data-testid` inside the sidebar MUST be unique across both variants. Use `-desktop` / `-mobile` suffixes (e.g., `data-testid="user-menu-desktop"`, `data-testid="user-menu-mobile"`). The E2E auth fixture targets `[data-testid="user-menu-desktop"]` to verify login. Duplicate testids cause Playwright strict mode violations and 100% E2E failure.

### Responsive Design
320px, 768px, 1024px, 1440px+. Sidebar collapses to hamburger on mobile. Board horizontal scroll. Card detail full-screen sheet on mobile. Touch targets >= 44px.

---

## 8. PWA

- `public/manifest.json` with icons (192px, 512px, maskable). Apple meta tags. `theme-color`.
- Service worker: cache-first for static assets, network-first for API, stale-while-revalidate for board detail.
- Offline: recently viewed boards read-only, offline banner, card moves queued in IndexedDB, synced on reconnect.
- Mobile: pull-to-refresh, haptic on drag, swipe gestures, bottom sheet for card detail, bottom nav bar (<768px), iOS safe areas.
- Lighthouse PWA audit: all checks pass. Performance >90 mobile.

---

## 9. Seed Data

`POST /api/seed` — run on every deploy, idempotent (upsert with `findFirst` + conditional `create`).

| Item | Spec |
|------|------|
| **Demo user** | `demo@workermill.com` / `demo1234` (OWNER). Same credentials in `prisma/seed.ts`, `e2e/global-setup.ts`, `e2e/fixtures/auth.fixture.ts`, all E2E specs, and `README.md`. |
| **Workspace** | "Acme Product" (slug: `acme-product`) + 3 team members |
| **Boards** | 3 total: Product Roadmap (5 cols, 12 cards), Sprint 14 (4 cols, 10 cards), Bug Tracker (3 cols, 8 cards) |
| **Cards** | 30 total. Varied priority (LOW/MEDIUM/HIGH/URGENT), varied assignee (some null, some demoUser), varied dueDate (some overdue, some future, some null). Realistic titles. |
| **Labels** | 5: Bug (`#EF4444`), Feature (`#3B82F6`), Enhancement (`#22C55E`), Documentation (`#8B5CF6`), Urgent (`#F97316`). Hex color values. |
| **Activities** | 25, spread over 7 days, varied types and timestamps |
| **Extras** | Comments (2-3) and checklists (3-5 items) on select cards. Some cards with cover colors. |
| **Verification** | `scripts/verify-seed.sh` uses `EXPECTED_CARDS=30`. Must match what `prisma/seed.ts` creates. |

---

## 10. Configuration

### `next.config.ts`
```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
};
```
Because `output: 'standalone'` is set, `next start` does NOT work. Start the app with `node .next/standalone/server.js` everywhere (local dev after build, Playwright webServer, CI).

### `package.json` scripts
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "node .next/standalone/server.js",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:e2e": "playwright test",
  "format": "prettier --write .",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate deploy",
  "db:seed": "tsx prisma/seed.ts",
  "db:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```
`"test"` MUST be `"vitest run"` (NOT `"vitest"` — hangs in CI).

### `.env.example`
```bash
DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"
DIRECT_DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"
NEXTAUTH_SECRET="local-dev-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST="true"
SEED_TOKEN="local-dev-seed-token"
```

### Local Development
```bash
cp .env.example .env.local
docker compose up -d --wait    # PostgreSQL 16-alpine on port 5432
npm install && npx prisma db push && npm run db:seed && npm run dev
```

### Scaffolding Checklist (create these BEFORE any other code)
1. `app/layout.tsx` — minimal root layout importing `./globals.css`. Build fails without it.
2. `app/page.tsx` — minimal placeholder. Build fails without it.
3. `postcss.config.mjs` — with `@tailwindcss/postcss`. No styles render without it.
4. `app/globals.css` — with `@import "tailwindcss"` and `@theme` block.
5. `.npmrc` — with `legacy-peer-deps=true`. Install fails without it.

### Quality Gates (pre-commit)
```
npm run lint && npm run typecheck && npm run build && npm run test && npm audit --audit-level=high
```

### Vercel Config
- `vercel.json`: `maxDuration: 10` for API routes, security headers (nosniff, DENY, XSS protection)
- Prisma binary targets: include `"rhel-openssl-3.0.x"` for Vercel serverless
- `NEXTAUTH_URL` and `AUTH_TRUST_HOST` must be set at build time

### GitHub Secrets (pre-configured)
DATABASE_URL, DIRECT_DATABASE_URL, NEON_API_TOKEN, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, NEXTAUTH_SECRET, SEED_TOKEN — all set.

### CI Pipeline
Quality job: checkout → setup-node 22 → `npm ci` → lint → typecheck → build → test → `npm audit --audit-level=high`.
E2E job (needs quality): `npm ci` → `prisma migrate deploy` → build → `npx playwright install --with-deps` → test:e2e.

---

## 11. E2E Tests

Playwright tests against built app + real PostgreSQL. `global-setup.ts` seeds demo data via Prisma.

**Test files:** auth, workspace, dashboard, board, card-detail, activity, members, mobile, pwa.

### Playwright config
- **Projects:** Desktop Chrome (always), Pixel 5 and iPhone 13 (local only, excluded in CI via `...(!process.env.CI ? [mobile projects] : [])`).
- **webServer command:** `npm run build && node .next/standalone/server.js` on port 3000. NOT `npm run start`.
- **Retries:** 2. **Workers:** 1 in CI.

### Test conventions
- Use `getByRole` with `{ name }`, `{ exact: true }`. Use `data-testid` for complex components.
- Never use Tailwind classes as selectors.
- Never call `test.use(devices[...])` inside `describe` blocks — Playwright errors with `Cannot use({ defaultBrowserType }) in a describe group`. Configure browser settings in `playwright.config.ts` projects only.
- The auth fixture (`e2e/fixtures/auth.fixture.ts`) logs in via `/login` form and verifies by checking `[data-testid="user-menu-desktop"]`. This testid MUST exist and resolve to exactly ONE element at 1280x720.

---

## 12. `CLAUDE.md` (repo root)

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
| Start (after build) | `node .next/standalone/server.js` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Unit tests | `npm run test` |
| E2E tests | `npx playwright install --with-deps chromium && npm run test:e2e` |
| Validate | `npm run lint && npm run typecheck && npm run build && npm run test && npm audit --audit-level=high` |

## CRITICAL — Read Before Writing Any Code
- Next.js 15 route params are Promises: `{ params: Promise<{ id: string }> }` then `await params`
- Tailwind v4: NO `tailwind.config.ts`. MUST have `postcss.config.mjs` with `@tailwindcss/postcss`.
- Schema field names: `password` (NOT passwordHash), `avatar` (NOT avatarUrl), ChecklistItem `text` (NOT title), Label `color` is String (NOT enum)
- Auth: `lib/auth.config.ts` (Edge-safe) and `lib/auth.ts` (full). Middleware imports from auth.config.ts ONLY.
- Dependencies: `next-auth` exact `5.0.0-beta.25`, `@auth/prisma-adapter ^2.11.1`, `bcrypt ^6.0.0`, `prisma ^6.1.0`
- `output: 'standalone'` means use `node .next/standalone/server.js` NOT `next start`
- All `useSearchParams()` wrapped in `<Suspense>`
- All `data-testid` attributes must be unique at the tested viewport (no duplicates between desktop/mobile sidebar)
- `npm run build` MUST succeed before pushing
```

---

## 13. Design Standards

Every page, component, and interaction must reflect Linear/Notion/Vercel quality.

- **Palette:** Primary, secondary, accent, semantic colors. Subtle gradients and tinted backgrounds.
- **Typography:** Inter or Geist. Clear type scale with medium (500) and semibold (600) for hierarchy.
- **Spacing:** 4px/8px grid. Generous whitespace.
- **Shadows:** Layered shadow system for cards, modals, dropdowns.
- **Animations:** All state transitions animated (150-300ms, ease-out). Skeleton loading screens with shimmer. Card drag shadows, toast slide-in/out, checkbox animations, button press feedback.
- **Every page:** skeleton loading state, error state with retry button, empty state with action prompt.
- **Responsive:** Touch targets >= 44px. No horizontal overflow.
