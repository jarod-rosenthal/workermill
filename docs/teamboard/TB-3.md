# TeamBoard — Web Dashboard

> Built by WorkerMill | Ticket 3 of 5

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

TB-2 is complete — all API routes are working, seed data is available:
- Authentication works (signup, login, session via NextAuth.js v5)
- RBAC enforced (OWNER > ADMIN > MEMBER > VIEWER)
- All 28 API routes functional and returning correct JSON
- Seed data loaded (demo user `demo@workermill.com` / `demo1234`, 3 boards, 30 cards, 25 activities)
- SSE stream endpoint active at `/api/workspaces/[slug]/stream`
- Stats endpoint returns aggregated dashboard data

## What This Ticket Delivers

Complete web UI for all TeamBoard features. Fully interactive with drag-and-drop, real-time updates, and responsive design.

---

## API Routes Available (from TB-2)

These endpoints are already implemented and available for the frontend to consume:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth.js authentication |
| `/api/auth/signup` | POST | User registration |
| `/api/workspaces` | GET, POST | List/create workspaces |
| `/api/workspaces/[slug]` | GET, PUT, DELETE | Workspace CRUD |
| `/api/workspaces/[slug]/members` | GET, POST | List/invite members |
| `/api/workspaces/[slug]/members/[id]` | PUT, DELETE | Manage members |
| `/api/workspaces/[slug]/boards` | GET, POST | List/create boards |
| `/api/workspaces/[slug]/boards/[id]` | GET, PUT, DELETE | Board CRUD (GET returns nested columns + cards) |
| `/api/workspaces/[slug]/activity` | GET | Activity feed (paginated, cursor-based) |
| `/api/workspaces/[slug]/stats` | GET | Dashboard statistics |
| `/api/workspaces/[slug]/stream` | GET | SSE real-time events |
| `/api/boards/[id]/columns` | POST | Create column |
| `/api/boards/[id]/columns/reorder` | PUT | Reorder columns |
| `/api/columns/[id]` | PUT, DELETE | Column CRUD |
| `/api/columns/[id]/cards` | POST | Create card |
| `/api/cards/[id]` | GET, PUT, DELETE | Card CRUD |
| `/api/cards/move` | POST | Move card (cross-column + reorder) |

---

## Phases

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
- "Alice moved 'Fix login bug' from To Do -> In Progress — 2 hours ago"
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

---

## Definition of Done

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
- [ ] Responsive on all viewports (320px-1440px+)
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

## Mandatory Rules

> These rules exist because real bugs were found during the v1 build. Every rule traces to a production incident or CI failure. Workers MUST follow these exactly.

### Rule 1: Next.js 15 App Router Constraints

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

### Rule 2: Security: Validate All Redirect URLs

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

### Rule 3: Optimistic UI Must Have Error Rollback

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

### Rule 7: E2E Tests Must Cover Core User Flows

**Minimum E2E test coverage (required for each ticket):**

| Flow | Test File | What to Assert |
|------|-----------|----------------|
| Auth | `auth.spec.ts` | Login, bad credentials, demo mode, signup page, redirect to login |
| Workspaces | `workspace.spec.ts` | List workspaces, navigate into workspace, role badges |
| Dashboard | `dashboard.spec.ts` | Stat cards render, chart data loads, sidebar nav |
| Board | `board.spec.ts` | Columns visible, cards visible, priority badges, drag handles |
| Mobile | `mobile.spec.ts` | Sidebar hidden, viewport sizing, form usability |

**Every ticket that adds UI features MUST add corresponding E2E tests.** The health check alone is not sufficient.

### Rule 11: Dynamic Route Segments Need Index Pages

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

## Playwright E2E Testing Conventions

- Use `getByRole` with `{ name }` for interactive elements — NOT `getByText` (which returns the innermost text node, often a `<span>`)
- Use `{ exact: true }` for text queries to avoid substring matching
- Verify ARIA attributes are valid for the element's role (e.g., `aria-expanded` is NOT valid on `type="search"` inputs)
- Test against actual routes — check `src/app/` directory structure before writing navigation tests
- Use `div[role="img"]` not `[role="img"]` — SVG elements have implicit `role="img"`

---

## Worker Execution Rules

1. **Read CLAUDE.md first:** Before starting any work, read `CLAUDE.md` in the repo root for project conventions and patterns from previous phases.
2. **Run ALL quality checks before PR:** Before creating a pull request:
   - `npm run typecheck` — 0 errors
   - `npm run lint` — 0 errors
   - `npm run test` — all tests pass
   - `npm run test:e2e` — ALL E2E tests must pass (including pre-existing tests)
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
| E2E tests | 100% pass (including pre-existing tests) | Playwright |
| Security | 0 high/critical vulnerabilities | `npm audit` |
| Build | Successful production build | `next build` |
| Accessibility | 0 violations on main pages | axe-core in Playwright |
| Performance | Lighthouse >90 | Lighthouse CI |

## Estimated Plan Size

7-8 stories — one per UI section (auth, layout, board, dashboard, etc.).
