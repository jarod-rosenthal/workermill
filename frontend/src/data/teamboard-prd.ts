// Sanitized PRD — the original specification that defined the TeamBoard showcase build
// Generated from docs/plans/TEAMBOARD_PRD.md

export const teamBoardPrd = `
# TeamBoard — Full Build Specification

## Purpose

This is a polished demo app designed to showcase WorkerMill's capabilities, \`teamboard.workermill.com\`. A full-stack SaaS Kanban board with RBAC, drag-and-drop, real-time updates, workspace dashboards, activity feeds, and PWA support. When a visitor clicks "Try the Demo", they should see a populated workspace with realistic boards, cards, and activity. Every page should have data. Empty states are failure.

**This app must look like it was designed by expert UI designers and built by a professional engineering team.** It is the first thing prospects see when evaluating WorkerMill. A generic-looking app with default shadcn/ui styling and no visual personality will actively harm credibility. The bar is Linear, Notion, and Vercel's dashboard — not a weekend hackathon project.

## Source of Truth

- **Spec:** \`docs/SHOWCASE_PROJECTS.md\` → "Project 1: TeamBoard"
- **Repo:** \`workermill-examples/teamboard\` (GitHub, PAT configured as \`GH_TOKEN\` secret)
- **Live URL:** https://teamboard.workermill.com
- **Deployment:** Vercel (app) + Neon PostgreSQL (database)
- **CI/CD:** GitHub Actions with \`ubuntu-latest\` runners (free for public repos)

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
| PWA | next-pwa or custom Workbox | Latest |
| Testing | Vitest + Testing Library + Playwright | Latest |
| Linting | ESLint + Prettier | Latest |
| CI/CD | GitHub Actions (\`ubuntu-latest\`) | Free for public repos |
| Hosting | Vercel | Automatic deploys |
| Database Hosting | Neon PostgreSQL | Free tier, connection pooling |

## Design Standards

**This is non-negotiable.** Every page, component, and interaction must reflect the quality of a product designed by senior UI designers. Workers must treat visual polish as a first-class requirement, not an afterthought.

### Visual Identity

- **Design references:** Linear (clean density), Notion (warm neutrals + subtle depth), Vercel dashboard (typography + spacing). Study these before writing any UI code.
- **Color palette:** Define a cohesive palette with primary, secondary, accent, and semantic colors (success/warning/error/info). Do NOT rely on shadcn/ui defaults — customize the theme. Use subtle gradients and tinted backgrounds, not flat gray-on-white.
- **Typography:** Use a modern sans-serif (Inter or Geist). Establish a clear type scale with distinct heading, body, caption, and label sizes. Pay attention to font weights — use medium (500) and semibold (600) for hierarchy, not just bold.
- **Spacing:** Consistent spacing system (4px/8px grid). Generous whitespace — never cram elements together. Cards, panels, and sections need breathing room.
- **Border radius:** Consistent radius tokens (sm/md/lg). Rounded, modern feel — not sharp corners.
- **Shadows & depth:** Layered shadow system for cards, modals, dropdowns. Subtle, not heavy. Use elevation to create visual hierarchy.

### Interaction Design

- **Animations:** All state transitions must be animated — page transitions, modal open/close, card drag, toast notifications, hover states. Use \`framer-motion\` or CSS transitions. 150-300ms duration, ease-out curves. No janky jumps.
- **Hover states:** Every clickable element must have a visible hover state (color shift, subtle scale, background highlight). Interactive elements must feel alive.
- **Loading states:** Skeleton screens that match the actual layout shape, not generic spinners. Skeletons should shimmer.
- **Empty states:** Custom illustrations or icons with helpful copy — "No boards yet — create your first one!" with a prominent CTA button. Never show a blank page.
- **Error states:** Friendly error messages with retry buttons. Not raw error text.
- **Micro-interactions:** Checkbox animations, button press feedback, card drag shadows, toast slide-in/out, counter animations on dashboard stats.

### Page-Level Polish

- **Landing page:** Hero with gradient background, animated feature showcase, smooth scroll between sections, professional marketing copy. Must rival a real SaaS landing page.
- **Dashboard:** Stats cards with subtle gradients or colored accents. Charts with custom color schemes matching the palette. Animated number counters on load.
- **Board view:** Cards with subtle shadows that intensify on hover/drag. Column headers with color accents. Smooth drag animations with ghost preview. Drop zones that highlight on hover.
- **Card detail:** Well-structured modal with clear sections. Priority badges with color coding. Avatar circles for assignees. Clean label chips.
- **Sidebar:** Smooth collapse animation. Active state with colored indicator bar. Hover feedback on all nav items. Board list with subtle icons.

### Responsive Design

- All pages work at 320px, 768px, 1024px, 1440px+
- Sidebar collapses to hamburger menu on mobile
- Board view: horizontal scroll for columns on mobile
- Card detail: full-screen sheet on mobile (not centered modal)
- Touch-friendly: all tap targets ≥ 44px
- No horizontal overflow anywhere

### Design Anti-Patterns (Do NOT)

- Do NOT ship default shadcn/ui styling without customization — it looks generic
- Do NOT use raw Tailwind gray palette as the only color — add warmth and brand color
- Do NOT skip loading/empty/error states — they destroy the polished feel
- Do NOT use instant state changes without animation — feels cheap
- Do NOT use tiny click targets on mobile — 44px minimum
- Do NOT use placeholder text like "Lorem ipsum" — write realistic product copy everywhere

---

## Global Constraints

### LLM Knowledge Gaps — DO NOT "FIX" These

Your training data may not include these — they are ALL correct and valid:

- **Next.js 15** is required. Do NOT use Next.js 14 — it has critical CVEs (\`npm audit\` will fail).
- **React 19** — Next.js 15 uses React 19. \`"@types/react": "^19.0.0"\`, \`"react": "^19.0.0"\`, \`"react-dom": "^19.0.0"\`.
- **bcrypt 6.x** — bcrypt 5.x depends on vulnerable \`tar\` package.

### Pinned Dependencies (DO NOT change)

- \`"next": "^15.1.0"\` — NOT 14.x
- \`"eslint-config-next": "^15.1.0"\` — must match Next.js major
- \`node-version\` in all CI workflows: \`22\` (matches Vercel runtime)
- \`"bcrypt": "^6.0.0"\`

### Pre-Commit Quality Gates

\`\`\`
npm run lint
npm run typecheck
npm run test
npm audit --audit-level=high
\`\`\`

### Code Style Rules

- TypeScript strict mode, no \`any\` types
- All pages using \`useSearchParams()\` or \`usePathname()\` MUST be wrapped in \`<Suspense>\` boundary (Next.js 15 App Router static generation crashes without it)
- Never pass user-controlled URLs directly to \`router.push()\` — validate as relative path first
- All optimistic UI updates MUST capture previous state and revert on API failure
- Prisma requires BOTH \`DATABASE_URL\` (pooled) and \`DIRECT_DATABASE_URL\` (direct for migrations)
- Every \`[param]/\` directory users can navigate to MUST have a \`page.tsx\` — Next.js App Router returns 404 for dynamic segments without one

---

## Data Model

\`\`\`prisma
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

enum Priority {
  URGENT
  HIGH
  MEDIUM
  LOW
}

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
  type        String    // card_created, card_moved, card_assigned, card_completed, member_invited
  entityType  String    // card, board, member
  entityId    String
  data        Json      // { from: "To Do", to: "In Progress", cardTitle: "..." }
  createdAt   DateTime  @default(now())
}
\`\`\`

**Workers MUST use this EXACT schema.** Do NOT add \`@@map()\`, \`@@index()\`, or annotations not shown.

---

## API Endpoints

### Health

\`\`\`
GET /api/health → { "status": "ok", "timestamp": "..." }
\`\`\`

### Auth

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | \`/api/auth/signup\` | None | \`{email, password, name}\` → creates user, returns session |
| GET/POST | \`/api/auth/[...nextauth]\` | None | NextAuth.js handler (login, session) |

- Session strategy: JWT (stateless, works on Vercel edge)
- Password hashed with bcrypt (min 12 rounds)
- Duplicate email returns 409
- Session includes: \`userId\`, \`email\`, \`name\`
- Middleware protects all \`/[workspace]/*\` and \`/api/*\` routes (except health, auth, public)

### Workspaces

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | \`/api/workspaces\` | Required | List user's workspaces |
| POST | \`/api/workspaces\` | Required | Create workspace (creator becomes OWNER) |
| GET | \`/api/workspaces/[slug]\` | Member | Workspace detail |
| PUT | \`/api/workspaces/[slug]\` | Admin+ | Update workspace |
| DELETE | \`/api/workspaces/[slug]\` | Owner | Delete workspace |

### Members

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | \`/api/workspaces/[slug]/members\` | Member | List members |
| POST | \`/api/workspaces/[slug]/members\` | Admin+ | Invite member (by email) |
| PUT | \`/api/workspaces/[slug]/members/[id]\` | Admin+ | Change role |
| DELETE | \`/api/workspaces/[slug]/members/[id]\` | Admin+ | Remove member |

### Boards & Columns

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | \`/api/workspaces/[slug]/boards\` | Member | List boards |
| POST | \`/api/workspaces/[slug]/boards\` | Member+ | Create board |
| GET | \`/api/workspaces/[slug]/boards/[id]\` | Member | Board with nested columns + cards |
| PUT | \`/api/workspaces/[slug]/boards/[id]\` | Member+ | Update board |
| DELETE | \`/api/workspaces/[slug]/boards/[id]\` | Admin+ | Delete board |
| POST | \`/api/boards/[id]/columns\` | Member+ | Create column |
| PUT | \`/api/boards/[id]/columns/reorder\` | Member+ | Reorder columns |
| PUT | \`/api/columns/[id]\` | Member+ | Update column |
| DELETE | \`/api/columns/[id]\` | Admin+ | Delete column |

### Cards

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | \`/api/columns/[id]/cards\` | Member+ | Create card |
| GET | \`/api/cards/[id]\` | Member | Card detail with comments + checklist |
| PUT | \`/api/cards/[id]\` | Member+ | Update card (title, description, priority, assignee, due date, labels, coverColor) |
| DELETE | \`/api/cards/[id]\` | Member+ | Delete card |
| POST | \`/api/cards/move\` | Member+ | Move card (cross-column + reorder) |
| POST | \`/api/cards/[id]/comments\` | Member+ | Add comment |
| DELETE | \`/api/cards/[id]/comments/[commentId]\` | Author/Admin+ | Delete comment |
| POST | \`/api/cards/[id]/checklist\` | Member+ | Add checklist item |
| PUT | \`/api/cards/[id]/checklist/[itemId]\` | Member+ | Toggle/update checklist item |
| DELETE | \`/api/cards/[id]/checklist/[itemId]\` | Member+ | Delete checklist item |

**Card move** is the most critical API:
\`\`\`typescript
// POST /api/cards/move
// Body: { cardId, targetColumnId, targetPosition }
// 1. Remove card from source column (update positions)
// 2. Insert into target column at position (update positions)
// 3. All in a single transaction
// 4. Create activity record (card_moved)
\`\`\`

### Activity & Stats

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | \`/api/workspaces/[slug]/activity\` | Member | Activity feed (cursor-based, 20 per page) |
| GET | \`/api/workspaces/[slug]/stats\` | Member | Dashboard statistics |
| GET | \`/api/workspaces/[slug]/search\` | Member | Search cards by title/description across all boards |

**Stats response:**
\`\`\`json
{
  "tasksByStatus": [{ "status": "To Do", "count": 5 }],
  "tasksByAssignee": [{ "name": "Alice", "count": 8 }],
  "tasksOverTime": [{ "date": "2026-02-01", "count": 3 }],
  "overdueCount": 4,
  "totalCards": 30,
  "completedCards": 12
}
\`\`\`

### Starred Boards

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | \`/api/boards/[id]/star\` | Member | Star a board |
| DELETE | \`/api/boards/[id]/star\` | Member | Unstar a board |

### SSE Real-Time Stream

\`\`\`
GET /api/workspaces/[slug]/stream
\`\`\`

- Events: \`card_created\`, \`card_moved\`, \`card_updated\`, \`card_deleted\`, \`board_updated\`
- Auth via query param: \`?token=<jwt>\` (EventSource doesn't support headers)
- Keep-alive ping every 20s
- PostgreSQL polling every 1-2 seconds

### Seed Endpoint

\`\`\`
POST /api/seed — Protected by Authorization: Bearer \$SEED_TOKEN
\`\`\`

Returns 200 on success, 409 if already seeded. Idempotent.

### RBAC Enforcement

- \`OWNER\` — Full control, can delete workspace
- \`ADMIN\` — Manage members, boards, settings
- \`MEMBER\` — Create/edit boards and cards
- \`VIEWER\` — Read-only access

---

## Frontend

### Routes

| Path | Page | Auth | API Calls |
|------|------|------|-----------|
| \`/\` | Landing page (public) | None | None — static marketing page |
| \`/login\` | Login form | None | NextAuth signIn |
| \`/signup\` | Registration form | None | POST \`/api/auth/signup\` |
| \`/workspaces\` | Workspace list | Required | GET \`/api/workspaces\` |
| \`/[workspace]/dashboard\` | Dashboard with charts | Member | GET stats |
| \`/[workspace]/boards/[id]\` | Kanban board view | Member | GET board, POST cards/move |
| \`/[workspace]/activity\` | Activity feed | Member | GET activity |
| \`/[workspace]/members\` | Member management | Member | GET/POST/PUT/DELETE members |
| \`/[workspace]/settings\` | Workspace settings | Admin+ | PUT workspace, CRUD labels |

### Landing Page (\`/\`)

Public page — visible without auth. This is the first thing a visitor sees. It must look like a real product marketing page, not a placeholder.

**Required sections:**
- **Hero** — Gradient background, "TeamBoard" name, compelling tagline, animated feature preview or illustration, "Try the Demo" CTA button with hover animation
- **Features** — 3-4 feature cards with icons (Kanban boards, RBAC, real-time collaboration, analytics dashboard)
- **How It Works** — Brief visual explanation with icons or step illustrations
- **Built by WorkerMill** — prominent section explaining this was built entirely by AI workers using [WorkerMill](https://workermill.com). Include a "Built with WorkerMill" badge. This is a showcase — visitors need to know the app was autonomously constructed by AI agents.
- **Footer** — copyright, "Built with WorkerMill" link, relevant links

**Design requirements:**
- Professional, modern SaaS aesthetic — gradient hero, clean typography, generous whitespace
- Fully responsive (mobile + desktop)
- Smooth scroll animations between sections
- Do NOT use "Lorem ipsum" — write realistic product copy
- "Sign In" link in top nav → \`/login\`

**Layout behavior:**
- Landing page (\`/\`) and login/signup render WITHOUT sidebar — full-width pages
- All authenticated routes render WITH sidebar
- Layout component checks current route to decide

### Auth Flow

- NextAuth.js v5 with JWT strategy
- Protected routes redirect to \`/login\` if unauthenticated
- Successful login redirects to \`/workspaces\` (NOT \`/\`)
- "Try the Demo" button auto-logs in as \`demo@workermill.com\`

### Kanban Board (Main Feature)

**Components:**
- \`BoardView\` — Container with horizontal scrolling columns
- \`Column\` — Vertical list of cards with header (name, card count, color indicator, WIP limit warning)
- \`Card\` — Draggable card showing title, priority badge, assignee avatar, due date, label chips, cover color strip, checklist progress bar
- \`CardDetail\` — Modal (desktop) or full-screen sheet (mobile) for viewing and editing a card

**Drag & Drop (@dnd-kit/core):**
- Drag within column (reorder) and between columns (cross-column move)
- Visual drop indicators (highlight target position)
- Optimistic UI (move immediately, POST to API, rollback on error)
- Touch: long-press to initiate drag (not immediate touch), larger hit targets (min 44px)

**Card detail modal:**
- Title (inline editable), rich text description
- Priority selector (Urgent/High/Medium/Low with color badges)
- Assignee picker, due date picker, label picker
- Cover color picker
- Comments section (add/delete)
- Checklist with progress bar (add/toggle/delete items)
- Delete card button
- Activity history for this card

**Board filtering & search:**
- Filter bar: by assignee, priority, label, due date
- Search cards by title/description within board
- Column WIP limits: visual warning (amber/red) when card count exceeds limit

**Keyboard shortcuts:**
- \`N\` — New card
- \`E\` — Edit card
- \`Delete\` — Delete card (with confirmation)
- \`Esc\` — Close modal
- Arrow keys — Navigate between cards

### Dashboard

4 charts + stats at \`/[workspace]/dashboard\`:
1. **Tasks by Status** — Pie/donut chart (one slice per column name)
2. **Tasks by Assignee** — Horizontal bar chart
3. **Tasks Created Over Time** — Line chart (last 30 days)
4. **Overdue Task Count** — Large number card with red highlight

Stats cards should have animated number counters on load.

### Activity Feed

\`/[workspace]/activity\`:
- Chronological list with user avatar + action description + relative timestamp
- "Alice moved 'Fix login bug' from To Do → In Progress — 2 hours ago"
- Pagination (load more button)
- New activities appear in real-time via SSE (no refresh needed)

### Members Page

\`/[workspace]/members\`:
- Member list with name, email, role badge (Owner/Admin/Member/Viewer)
- Invite form (email input, role selector) — Admin+ only
- Role change dropdown — Admin+ only
- Remove member button — Admin+ only

### Settings Page

\`/[workspace]/settings\`:
- Workspace name and description edit
- Labels management (create, edit color/name, delete)
- Danger zone: Delete workspace (Owner only, requires confirmation dialog)

### Sidebar

- Workspace name + avatar at top
- Navigation: Dashboard, Boards (expandable list with star toggle), Activity, Members, Settings
- Starred boards pinned to top of board list
- Active state with colored indicator bar
- Collapsible on mobile (hamburger menu)
- Smooth collapse/expand animation
- User avatar + settings at bottom
- Unread activity badge on Activity nav item

### Workspace-Level Search

Search across all boards and cards within the workspace. Available in sidebar or header.

---

## Progressive Web App (PWA)

### Manifest & Install

Create \`public/manifest.json\`:
\`\`\`json
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
\`\`\`

- \`<link rel="manifest" href="/manifest.json">\` in root layout
- Apple-specific meta tags (\`apple-mobile-web-app-capable\`, \`apple-mobile-web-app-status-bar-style\`, \`apple-touch-icon\`)
- Generate app icons at 192px and 512px (plus maskable variant)
- \`theme-color\` meta tag matching light/dark theme

### Service Worker & Offline Caching

Use \`next-pwa\` or custom Workbox service worker:

| Resource | Strategy | TTL |
|----------|----------|-----|
| App shell (HTML, CSS, JS) | Cache-first, network fallback | Revalidate on new deploy |
| API responses (\`/api/boards\`, \`/api/workspaces\`) | Network-first, cache fallback | 5 minutes |
| Static assets (icons, fonts, images) | Cache-first | 30 days |
| Board detail (\`/api/boards/[id]\`) | Stale-while-revalidate | 1 minute |

**Offline behavior:**
- Recently viewed boards available offline (read-only)
- Offline indicator banner: "You're offline — changes will sync when reconnected"
- Card moves queued locally while offline, synced on reconnect
- New card creation disabled while offline (show disabled state with tooltip)

### Offline Action Queue

Simple offline action queue using IndexedDB (via \`idb\` library):

\`\`\`typescript
interface QueuedAction {
  id: string;
  type: 'card_move' | 'card_update';
  payload: Record<string, unknown>;
  timestamp: number;
  retries: number;
}
\`\`\`

- Card moves and edits stored in IndexedDB when offline
- On reconnect, actions replayed in order against API
- Conflict resolution: last-write-wins (server timestamp)
- Failed replays retry 3 times, then surface error to user
- Queue badge shows count of pending syncs

### Mobile-Native Interactions

- **Pull-to-refresh** on board view and workspace list
- **Haptic feedback** on card drag (where supported via \`navigator.vibrate\`)
- **Swipe gestures** on cards: swipe right to complete, swipe left to delete (with undo toast)
- **Bottom sheet** for card detail on mobile (instead of centered modal)
- **Bottom navigation bar** on mobile viewports (< 768px): Workspaces, Boards, Activity, Profile
- **Long-press to drag** — not immediate touch
- **iOS safe area** — respect \`env(safe-area-inset-*)\` for notch/home indicator

### Performance

- View Transitions API for smooth page transitions (with fallback)
- Skeleton screens on all data-loading pages
- Dynamic imports for board view, charts, card detail
- Lighthouse PWA audit: all checks pass
- Lighthouse Performance score >90 on mobile

---

## Seed Data (CRITICAL — Makes or Breaks the Demo)

**Run on every deploy** via \`POST /api/seed\`. Idempotent (upsert, not insert-if-missing).

### Demo User
- \`demo@workermill.com\` / \`demo1234\` (role: OWNER)

### Workspace
- "Acme Product" (slug: \`acme-product\`) with demo user as OWNER + 3 additional team members

### 3 Boards
1. **Product Roadmap** — 5 columns (Backlog, To Do, In Progress, Review, Done) with 12 cards
2. **Sprint 14** — 4 columns (To Do, In Progress, QA, Done) with 10 cards (some overdue)
3. **Bug Tracker** — 3 columns (Reported, Investigating, Fixed) with 8 cards

### 5 Labels
- "Bug" (red), "Feature" (blue), "Enhancement" (green), "Documentation" (purple), "Urgent" (orange)

### 25 Activity Entries
Spread over 7 days. Include card_created, card_moved, card_assigned, board_created, member_invited. Timestamps spread across business hours — NOT all at the same time.

### Card Details
Cards should use realistic product titles (not "test card 1"). Vary priorities, assignees, due dates, and labels across cards. Some cards should have:
- Comments (2-3 per card on some cards)
- Checklists (3-5 items, some completed)
- Cover colors
- Overdue due dates (for the dashboard overdue count)

---

## Configuration Files

### Project Structure

\`\`\`
teamboard/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── public/
│   ├── manifest.json
│   ├── sw.js
│   └── icons/
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
│   │   ├── ui/               # shadcn/ui (customized theme)
│   │   ├── layout/           # Sidebar, Header, BottomNav
│   │   ├── board/            # BoardView, Column, Card, CardDetail
│   │   ├── dashboard/        # Charts, StatCards
│   │   └── shared/           # LoadingSpinner, ErrorBoundary, EmptyState
│   ├── lib/
│   │   ├── auth.ts           # NextAuth config
│   │   ├── prisma.ts         # Prisma client singleton
│   │   ├── utils.ts
│   │   ├── validations.ts    # Zod schemas
│   │   └── offline-queue.ts  # IndexedDB action queue
│   ├── hooks/
│   │   ├── useSSE.ts
│   │   └── useOffline.ts
│   └── types/
│       └── index.ts
├── tests/
│   ├── unit/
│   └── e2e/
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── docker-compose.yml
├── playwright.config.ts
├── vitest.config.ts
├── .env.example
├── CLAUDE.md
└── README.md
\`\`\`

### package.json scripts

\`\`\`json
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
\`\`\`

- \`"test"\` MUST be \`"vitest run"\` (NOT \`"vitest"\` which hangs CI in watch mode)
- \`"build"\` MUST be \`"next build"\` (NOT \`"prisma generate && next build"\`)
- \`"postinstall"\` MUST be \`"prisma generate"\` — runs automatically after \`npm ci\`

### Local Development (docker-compose)

This is the **primary development and testing environment**. It runs a local PostgreSQL so workers can develop without cloud dependencies. Neon is only for production.

**\`docker-compose.yml\`:**
\`\`\`yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: teamboard
      POSTGRES_USER: teamboard
      POSTGRES_PASSWORD: teamboard
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U teamboard"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
\`\`\`

**Usage:**
\`\`\`bash
# Start local database
docker compose up -d --wait

# Run app against local database
npm run dev

# Run tests against local database
npm run test
npm run test:e2e

# Stop
docker compose down
\`\`\`

### Environment Variables

**\`.env.example\`** (copy to \`.env.local\` for local dev):
\`\`\`bash
# Database — local PostgreSQL via docker-compose
DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"
DIRECT_DATABASE_URL="postgresql://teamboard:teamboard@localhost:5432/teamboard"

# Auth
NEXTAUTH_SECRET="local-dev-secret-change-in-production"
NEXTAUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST="true"

# Seed endpoint protection
SEED_TOKEN="local-dev-seed-token"
\`\`\`

**Workers:** Copy \`.env.example\` to \`.env.local\`, run \`docker compose up -d --wait\`, then \`npx prisma db push && npm run db:seed && npm run dev\`.

### CI Pipeline (\`.github/workflows/ci.yml\`)

\`\`\`yaml
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
      DATABASE_URL: \${{ secrets.DATABASE_URL }}
      DIRECT_DATABASE_URL: \${{ secrets.DIRECT_DATABASE_URL }}
      NEXTAUTH_SECRET: \${{ secrets.NEXTAUTH_SECRET }}
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
\`\`\`

### Deploy Pipeline (\`.github/workflows/deploy.yml\`)

\`\`\`yaml
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
          DATABASE_URL: \${{ secrets.DATABASE_URL }}
          DIRECT_DATABASE_URL: \${{ secrets.DIRECT_DATABASE_URL }}
        run: npx prisma migrate deploy

      - name: Wait for Vercel deploy
        run: sleep 30

      - name: Seed demo data
        run: |
          response=\$(curl -s -o /dev/null -w "%{http_code}" -X POST \
            https://teamboard.workermill.com/api/seed \
            -H "Authorization: Bearer \${{ secrets.SEED_TOKEN }}")
          if [ "\$response" = "200" ] || [ "\$response" = "409" ]; then
            echo "Seed successful (HTTP \$response)"
          else
            echo "Seed failed with HTTP \$response"
            exit 1
          fi

      - name: Smoke test
        run: |
          curl -f https://teamboard.workermill.com/api/health || exit 1
          echo "Health check passed"
\`\`\`

### GitHub Secrets (pre-configured)

| Secret | Status |
|--------|--------|
| \`DATABASE_URL\` | Set |
| \`DIRECT_DATABASE_URL\` | Set |
| \`NEON_API_TOKEN\` | Set |
| \`VERCEL_TOKEN\` | Set |
| \`VERCEL_ORG_ID\` | Set |
| \`VERCEL_PROJECT_ID\` | Set |
| \`NEXTAUTH_SECRET\` | Set |
| \`SEED_TOKEN\` | Set |

### Vercel (pre-configured)

| Resource | Status |
|----------|--------|
| Vercel project (\`teamboard\`) | Created |
| GitHub repo linked | \`workermill-examples/teamboard\` |
| Framework | Next.js, Node 22 |
| Custom domain | \`teamboard.workermill.com\` (verified) |
| Env vars | DATABASE_URL, DIRECT_DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, SEED_TOKEN |
| Auto-deploy on push | **DISABLED during build** (see "Final Deployment" below) |

### Neon PostgreSQL (pre-configured)

| Resource | Status |
|----------|--------|
| Neon project | Created (\`neondb\` database) |
| Pooled connection (\`DATABASE_URL\`) | In GitHub secrets + Vercel env |
| Direct connection (\`DIRECT_DATABASE_URL\`) | In GitHub secrets + Vercel env |
| Neon API token (\`NEON_API_TOKEN\`) | In GitHub secrets |

### Vercel Production Config

**\`vercel.json\`:**
\`\`\`json
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
\`\`\`

**\`next.config.js\` production optimizations:**
- \`output: 'standalone'\`
- \`poweredByHeader: false\`
- \`compress: true\`
- \`optimizePackageImports: ['lucide-react', '@radix-ui/*']\`
- \`images.formats: ['image/avif', 'image/webp']\`

### Vercel Deployment — Known Failure Modes

**All verified from actual deployments:**

1. **Serverless function timeout:** API routes using Prisma with cold-start connection pooling can exceed the default 10s limit. The \`vercel.json\` sets \`maxDuration: 10\` — if seed or heavy queries still timeout, increase to 30. The SSE stream endpoint MUST use edge runtime or a long-running function config.

2. **Build output size:** Next.js standalone output can exceed Vercel's 250MB limit if \`node_modules\` are not properly tree-shaken. \`output: 'standalone'\` fixes this — do NOT remove it.

3. **Environment variable availability at build time:** \`NEXTAUTH_URL\` and \`AUTH_TRUST_HOST\` must be available at build time for NextAuth.js to generate the correct callback URLs. Verify they are set in Vercel's "Environment Variables" section (not just GitHub Secrets).

4. **Prisma binary targets:** Vercel's serverless runtime uses \`rhel-openssl-3.0.x\`. The Prisma schema should include \`binaryTargets = ["native", "rhel-openssl-3.0.x"]\` in the generator block if builds fail with missing Prisma engine errors.

5. **Service worker path:** The service worker (\`sw.js\`) must be served from the root path (\`/sw.js\`). Next.js serves files from \`public/\` at the root. If the SW fails to register, check that \`public/sw.js\` exists and the scope is \`/\`.

---

## E2E Tests

Playwright tests run against the local dev server (backed by docker-compose PostgreSQL).

### Test File Structure

\`\`\`
tests/e2e/
  global-setup.ts     — Seeds demo data via Prisma before all tests
  auth.spec.ts        — Login, bad credentials, demo mode, signup page, redirect to login
  workspace.spec.ts   — List workspaces, navigate into workspace, role badges
  dashboard.spec.ts   — Stat cards render, chart data loads, sidebar nav
  board.spec.ts       — Columns visible, cards visible, priority badges, drag handles, card move
  card-detail.spec.ts — Open card, edit title, comments, checklist, labels, priority
  activity.spec.ts    — Activity feed shows entries, pagination
  members.spec.ts     — Member list, invite flow, role change
  mobile.spec.ts      — Sidebar hidden, bottom nav, viewport sizing, bottom sheet card detail
  pwa.spec.ts         — Install prompt, offline banner, service worker registration
\`\`\`

### Playwright Config

\`\`\`typescript
export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://localhost:3000',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
\`\`\`

The \`global-setup.ts\` creates the demo user with \`prisma.user.upsert()\` (always updating the password hash to ensure it matches test credentials), then seeds workspace, boards, cards.

### Test Conventions

- Use \`getByRole\` with \`{ name }\` for interactive elements — NOT \`getByText\`
- Use \`{ exact: true }\` for text queries to avoid substring matching
- NEVER use Tailwind classes as selectors (\`.bg-red-50\`, \`.text-red-800\`)
- Use \`data-testid\` attributes for complex components
- Run \`npx prettier --write .\` after editing test files
- CI browser install: \`npx playwright install --with-deps\` (installs all configured browsers)
- Test against actual rendered content — check what components render before writing assertions

---

## Post-Deploy Smoke Test

Run after Vercel deployment completes (~30s after push to main):

\`\`\`bash
URL="https://teamboard.workermill.com"

# 1. Health check
curl -sf "\$URL/api/health" | grep -q '"status":"ok"' || { echo "FAIL: Health"; exit 1; }

# 2. Landing page loads
curl -sf "\$URL/" | grep -q "TeamBoard" || { echo "FAIL: Landing page"; exit 1; }

# 3. Login page loads
curl -sf "\$URL/login" | grep -q "Sign" || { echo "FAIL: Login page"; exit 1; }

# 4. Seed endpoint (idempotent)
SEED_RESP=\$(curl -s -o /dev/null -w "%{http_code}" -X POST "\$URL/api/seed" \
  -H "Authorization: Bearer \$SEED_TOKEN")
[ "\$SEED_RESP" = "200" ] || [ "\$SEED_RESP" = "409" ] || { echo "FAIL: Seed (HTTP \$SEED_RESP)"; exit 1; }

echo "PASS: All smoke tests passed"
\`\`\`

---

## Final Deployment

Vercel auto-deploy is disabled during the build phase to prevent unnecessary deployments while workers push changes. The Vercel project has \\\`commandForIgnoringBuildStep\\\` set to \\\`exit 0\\\`, which skips all builds on push.

After all tickets are merged to \\\`main\\\` and CI passes, the final deployment must be performed:

1. **Remove the build skip** — clear \\\`commandForIgnoringBuildStep\\\` (set to \\\`null\\\`) via the Vercel dashboard (Project Settings > Git > Ignored Build Step) or the Vercel API
2. **Trigger a production deploy** — push an empty commit (\\\`git commit --allow-empty -m "trigger deploy"\\\`) or click "Redeploy" in the Vercel dashboard
3. **Run database migrations** — \\\`npx prisma migrate deploy\\\` against production (uses \\\`DIRECT_DATABASE_URL\\\`)
4. **Seed production data** — \\\`POST https://teamboard.workermill.com/api/seed\\\` with \\\`Authorization: Bearer $SEED_TOKEN\\\`
5. **Run the post-deploy smoke test** (see section above)
6. **Verify acceptance criteria** — all production checks in the checklist below must pass

Do NOT re-enable auto-deploy until all PRs are merged and the codebase is in a deployable state.

---

## Acceptance Criteria

### Local
- [ ] \`docker compose up -d --wait\` starts PostgreSQL without errors
- [ ] \`npm install\` succeeds
- [ ] \`npm run dev\` starts on port 3000
- [ ] \`npm run typecheck\` passes
- [ ] \`npm run lint\` passes
- [ ] \`npm run test\` passes
- [ ] \`npm run test:e2e\` passes
- [ ] \`npm audit --audit-level=high\` passes
- [ ] \`GET /api/health\` returns \`{ "status": "ok" }\`
- [ ] Login with \`demo@workermill.com\` / \`demo1234\` works
- [ ] All 3 boards visible with correct card counts (12, 10, 8)
- [ ] Drag and drop works within and across columns, persists after reload
- [ ] Card detail shows comments, checklist, labels
- [ ] Board filtering works (by assignee, priority, label)
- [ ] Keyboard shortcuts work (N, E, Delete, Esc, arrows)
- [ ] Dashboard shows 4 charts with non-zero data
- [ ] Activity feed shows 25 seeded entries
- [ ] SSE stream connects and delivers real-time events
- [ ] Starred boards appear at top of sidebar
- [ ] Workspace search returns results across boards
- [ ] PWA: manifest valid, service worker registers
- [ ] PWA: offline banner appears when disconnected
- [ ] Responsive at 320px, 768px, 1024px, 1440px — no horizontal overflow
- [ ] Bottom navigation bar visible on mobile
- [ ] Lighthouse PWA audit: all checks pass
- [ ] Lighthouse Performance (mobile): >90

### Production
- [ ] \`https://teamboard.workermill.com\` loads landing page
- [ ] \`/api/health\` returns 200
- [ ] "Try the Demo" logs in as demo user
- [ ] All 3 boards visible with cards
- [ ] Drag and drop works and persists
- [ ] Dashboard charts render with real data
- [ ] Activity feed shows entries
- [ ] Card comments and checklists work
- [ ] Responsive on mobile
- [ ] PWA installable (Chrome/Safari "Add to Home Screen")
- [ ] CI pipeline runs on push (lint, typecheck, test, e2e) on \`ubuntu-latest\`
- [ ] Vercel auto-deploys on merge to main
- [ ] Post-deploy smoke test passes
- [ ] Page load time < 2 seconds
- [ ] "Built by WorkerMill" visible in footer

## Anti-Patterns (Do NOT)

- Do NOT use Next.js 14 — use 15
- Do NOT use \`useSearchParams()\` without \`<Suspense>\` boundary — build crashes
- Do NOT pass user-controlled URLs to \`router.push()\` without validation
- Do NOT fire-and-forget optimistic updates — always capture previous state for rollback
- Do NOT forget \`DIRECT_DATABASE_URL\` in any env running Prisma
- Do NOT forget \`AUTH_TRUST_HOST=true\` in CI — Auth.js v5 rejects localhost
- Do NOT create dynamic route directories without \`page.tsx\` — returns 404
- Do NOT use \`"vitest"\` as test script — hangs CI in watch mode
- Do NOT edit existing Prisma migrations — create new ones
- Do NOT skip CI before merge — even with deploy label
- Do NOT add \`@@map()\`, \`@@index()\`, or extra annotations to the Prisma schema
- Do NOT create Dockerfile or vercel.json during initial setup — Vercel auto-detects Next.js
- Do NOT create \`postcss.config.*\` — Next.js 15 includes PostCSS by default
- Do NOT ship default shadcn/ui styling without customization — it looks generic and hurts credibility
- Do NOT skip loading/empty/error states — they destroy the polished feel
- Do NOT use instant state changes without animation — feels cheap and unfinished
`;
