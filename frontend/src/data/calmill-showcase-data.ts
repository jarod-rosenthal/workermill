// Auto-generated from WorkerMill internal board data
// Board: CalMill (2272c945-84ea-493c-b304-b744496998f6)
// Generated: 2026-02-17

export interface CalMillEpic {
  id: string;
  title: string;
  priority: string;
  storyCount: number;
  duration: string;
  status: "completed" | "escalated" | "deployed";
  techLeadScore?: string;
  prNumber: number;
  prUrl: string;
  commentCount: number;
  personas: string[];
  description: string;
  buildLog: string;
}

export const calMillEpics: CalMillEpic[] = [
  {
    id: "cm-1",
    title: "CM-1: Project Setup & Dev Environment",
    priority: "high",
    storyCount: 9,
    duration: "~66 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 2,
    prUrl: "https://github.com/workermill-examples/calmill/pull/2",
    commentCount: 106,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `***REMOVED*** CM-1: Project Setup & Dev Environment

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [\`workermill-examples/calmill\`](https://github.com/workermill-examples/calmill)

---

***REMOVED******REMOVED*** Epic Overview

Scaffold a complete Next.js 16 project from scratch — Prisma 7 ORM with a 13-model scheduling schema, PostgreSQL (Neon), TailwindCSS 4 CSS-first configuration, CI/CD pipelines, and a working Vercel deploy.

**Deliverables:**

1. Project config and dependencies (Next.js 16, React 19.2, TypeScript)
2. Prisma 7 schema with 13 models, 3 enums, applied to Neon PostgreSQL
3. TailwindCSS 4 CSS-first configuration (NO \`tailwind.config.js\`)
4. App shell with auth pages (landing, login, signup)
5. Dashboard layout (sidebar, header, navigation stubs)
6. Public booking layout shell
7. Health check, seed, and auth API routes
8. GitHub Actions CI + deploy pipelines
9. Live Vercel deploy at calmill.workermill.com
10. All quality checks passing (typecheck, lint, test)

***REMOVED******REMOVED*** Tech Stack

- **Next.js 16** with App Router + Server Components
- **Prisma 7** with Neon serverless adapter (\`prisma.config.ts\` pattern)
- **TailwindCSS 4** CSS-first config (no \`tailwind.config.js\`)
- **NextAuth v5 beta** with credentials provider
- **Zod 4** for validation
- **Vitest 4** + Playwright for testing`,
    buildLog: `**WorkerMill** — 2026-02-16 23:52 UTC

**Planning** — Critic approved plan (score: 91/100)
- 9 stories decomposed across 4 priority levels
- Critic feedback: split core config into parallel tracks for faster execution

**Story 0: Core Project Config** — completed by backend_developer
- Created package.json with Next.js 16.1.0, React 19.2, Prisma 7.4
- TailwindCSS 4 CSS-first configuration (no tailwind.config.js)
- Prisma 7 config with \`prisma.config.ts\` pattern (new in v7)

**Story 1: Prisma Schema & Seed** — completed by backend_developer
- 13-model scheduling schema: User, EventType, Schedule, Availability, Booking, Team, TeamMember, etc.
- Neon serverless adapter with driver adapter pattern
- Demo user seed (demo@workermill.com / demo1234)

**Story 2: Auth & Lib Utilities** — completed by backend_developer
- NextAuth v5 beta with credentials provider and JWT strategy
- Zod 4 validation schemas for all forms
- Prisma client singleton with Neon adapter

**Story 3: App Shell & Auth Pages** — completed by frontend_developer
- Landing page with hero section and "Try the Demo" CTA
- Login/signup forms with dark theme styling
- Dashboard sidebar layout with navigation stubs

**Story 4: Public Booking Layout** — completed by frontend_developer
- Public-facing booking page shell for shared scheduling links
- Responsive layout with timezone support UI

**Story 5: API Routes** — completed by backend_developer
- Health check, seed, and NextAuth catch-all routes
- Protected seed endpoint with SEED_TOKEN authorization

**Story 6: CI/CD Pipelines** — completed by devops_engineer
- GitHub Actions CI: lint, typecheck, unit tests, security audit
- Deploy workflow: migrations, seed, health check verification

**Story 7: Test Infrastructure** — completed by qa_engineer
- Vitest 4 configuration with path aliases
- Playwright config for E2E testing
- 4 initial unit tests passing

**Story 8: Documentation** — completed by devops_engineer
- CLAUDE.md for AI worker guidance
- README.md with setup instructions and demo credentials

🔄 **Revision 1/3** — Tech lead found 8 ESLint errors (unused imports, unescaped apostrophes)
✅ **Approved** (9/10) — All lint errors fixed, 0 TypeScript errors, 4/4 unit tests passing`,
  },
  {
    id: "cm-2",
    title: "CM-2: Core Backend — Event Types, Schedules & Slots",
    priority: "high",
    storyCount: 7,
    duration: "~69 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 3,
    prUrl: "https://github.com/workermill-examples/calmill/pull/3",
    commentCount: 76,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
    ],
    description: `***REMOVED*** CM-2: Core Backend — Event Types, Schedules & Slots

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Build the core scheduling backend: event type CRUD, schedule/availability management, and time slot calculation. This epic creates the API layer that powers the booking experience.

**Deliverables:**

1. Event type CRUD API routes (create, read, update, delete, list)
2. Schedule management (weekly availability, date overrides)
3. Time slot calculation engine (timezone-aware, conflict detection)
4. Booking API routes (create, cancel, reschedule)
5. Input validation with Zod 4 schemas
6. Database queries optimized for slot availability checks`,
    buildLog: `**WorkerMill** — 2026-02-17 01:55 UTC

**Planning** — Critic approved plan
- 7 stories covering API routes, validation, and slot calculation

**Story 0: Auth Helpers & Zod Schemas** — completed by backend_developer
- Session helper functions for protected API routes
- Comprehensive Zod schemas for event types, schedules, bookings

**Story 1: Event Type CRUD** — completed by backend_developer
- Full CRUD API routes for event types
- Duration, location, custom questions support
- Slug-based public URLs for booking pages

**Story 2: Schedule & Availability** — completed by backend_developer
- Weekly recurring schedule management
- Date-specific overrides (vacations, holidays)
- Multiple schedule support per user

**Story 3: Slot Calculation Engine** — completed by backend_developer
- Timezone-aware slot generation using date-fns
- Conflict detection against existing bookings
- Buffer time between appointments

**Story 4: Booking API** — completed by backend_developer
- Create, cancel, and reschedule bookings
- Confirmation token generation
- Status lifecycle (pending → confirmed → cancelled)

**Story 5: Shared Types & Utilities** — completed by backend_developer
- TypeScript interfaces for API responses
- Pagination helpers and query builders

**Story 6: API Tests** — completed by qa_engineer
- Unit tests for slot calculation logic
- API route integration tests

✅ **Approved** (9/10) — Clean API design, proper auth guards on all routes`,
  },
  {
    id: "cm-3",
    title: "CM-3: Public Booking Experience",
    priority: "high",
    storyCount: 6,
    duration: "~63 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 4,
    prUrl: "https://github.com/workermill-examples/calmill/pull/4",
    commentCount: 76,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
    ],
    description: `***REMOVED*** CM-3: Public Booking Experience

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Build the public-facing booking flow — the shareable scheduling link experience. Users share a link like \`calmill.workermill.com/demo\`, visitors see available event types, pick a time slot, and confirm their booking.

**Deliverables:**

1. Public user profile page with event type listing
2. Event type detail page with calendar/slot picker
3. Timezone-aware slot display with automatic detection
4. Booking confirmation form with custom questions
5. Booking success page with calendar download (ICS)
6. Mobile-responsive booking flow`,
    buildLog: `**WorkerMill** — 2026-02-17 03:50 UTC

**Planning** — Critic approved plan
- 6 stories covering the end-to-end public booking flow

**Story 0: ICS Utility & Event Type Card** — completed by frontend_developer
- RFC 5545 ICS calendar file generation
- Event type card component with duration, location badges
- Google Calendar link generation

**Story 1: Public Profile Page** — completed by frontend_developer
- Username-based public page (/[username])
- Event type grid with availability indicators
- Responsive layout with user avatar and bio

**Story 2: Calendar Date Picker** — completed by frontend_developer
- Interactive calendar component for date selection
- Timezone selector with auto-detection
- Available/unavailable day indicators

**Story 3: Time Slot Selection** — completed by frontend_developer
- Slot list for selected date with timezone conversion
- Loading states and empty state handling
- Smooth transitions between date and time selection

**Story 4: Booking Confirmation** — completed by frontend_developer
- Form with name, email, and custom questions
- Zod validation on client and server
- Confirmation page with ICS download and Google Calendar link

**Story 5: API Integration** — completed by backend_developer
- Public API routes for profile and availability lookup
- Booking creation endpoint for unauthenticated users
- Rate limiting on public booking endpoints

✅ **Approved** (9/10) — Clean component architecture, proper server/client separation`,
  },
  {
    id: "cm-4",
    title: "CM-4: Dashboard & Management UI",
    priority: "high",
    storyCount: 8,
    duration: "~89 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 5,
    prUrl: "https://github.com/workermill-examples/calmill/pull/5",
    commentCount: 100,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `***REMOVED*** CM-4: Dashboard & Management UI

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Build the authenticated dashboard — event type management, booking list, schedule configuration, and analytics overview. This is the "control panel" for users to manage their scheduling.

**Deliverables:**

1. Dashboard overview with booking stats and upcoming meetings
2. Event type management (create, edit, toggle active)
3. Booking list with filtering and search
4. Schedule/availability editor (weekly grid + date overrides)
5. Dashboard API routes for stats and charts
6. Navigation between dashboard sections`,
    buildLog: `**WorkerMill** — 2026-02-17 06:53 UTC

**Planning** — Critic approved plan
- 8 stories — largest epic in the CalMill series

**Story 0: Dashboard API Routes & Navigation** — completed by backend_developer
- Stats aggregation endpoints (bookings today, this week, conversion rate)
- Dashboard navigation with active route highlighting

**Story 1: Dashboard Overview Page** — completed by frontend_developer
- Stat cards with booking counts and trends
- Upcoming meetings list with join/cancel actions
- Quick-action buttons for creating event types

**Story 2: Event Type Management** — completed by frontend_developer
- Create/edit event type forms with live preview
- Toggle active/inactive with confirmation
- Drag-and-drop reordering

**Story 3: Booking List** — completed by frontend_developer
- Paginated booking table with status badges
- Filter by date range, status, event type
- Search by attendee name/email

**Story 4: Schedule Editor** — completed by frontend_developer
- Visual weekly availability grid
- Click-to-toggle time blocks
- Date override calendar for exceptions

**Story 5: Booking Detail** — completed by frontend_developer
- Full booking detail view with attendee info
- Cancel/reschedule actions
- Meeting notes and custom question responses

**Story 6: Settings Page** — completed by frontend_developer
- Profile settings (name, timezone, avatar)
- Booking preferences (buffer time, min notice)

**Story 7: API Refinements** — completed by backend_developer
- Booking stats aggregation queries
- Chart data endpoints for dashboard widgets

✅ **Approved** (9/10) — Comprehensive dashboard with proper auth guards`,
  },
  {
    id: "cm-5",
    title: "CM-5: Calendar Integration & Email Notifications",
    priority: "high",
    storyCount: 6,
    duration: "~37 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 6,
    prUrl: "https://github.com/workermill-examples/calmill/pull/6",
    commentCount: 62,
    personas: [
      "backend_developer",
      "frontend_developer",
    ],
    description: `***REMOVED*** CM-5: Calendar Integration & Email Notifications

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Add Google Calendar OAuth integration for real-time busy/free detection, and email notifications via Resend for booking confirmations and reminders.

**Deliverables:**

1. Google Calendar OAuth flow (connect/disconnect)
2. Real-time busy/free detection during slot calculation
3. Automatic event creation in connected calendars
4. Email notifications via Resend (confirmation, reminder, cancellation)
5. Calendar connection UI in settings
6. Webhook support for external calendar sync`,
    buildLog: `**WorkerMill** — 2026-02-17 13:50 UTC

**Planning** — Critic approved plan
- 6 stories covering OAuth, email, and calendar sync

**Story 0: Google Calendar OAuth Routes** — completed by backend_developer
- OAuth 2.0 authorization flow with PKCE
- Token storage and refresh handling
- Connect/disconnect endpoints

**Story 1: Calendar Sync Service** — completed by backend_developer
- Fetch busy/free data from Google Calendar API
- Merge external calendar events with local availability
- Automatic event creation on booking confirmation

**Story 2: Email Service** — completed by backend_developer
- Resend integration for transactional emails
- Booking confirmation template with ICS attachment
- Cancellation and reminder email templates

**Story 3: Calendar Connection UI** — completed by frontend_developer
- Settings page with Google Calendar connect button
- Connected calendar list with sync status
- Disconnect with confirmation dialog

**Story 4: Webhook Endpoints** — completed by backend_developer
- Calendar change notification webhooks
- Booking status change webhooks for integrations

**Story 5: Integration Tests** — completed by backend_developer
- OAuth flow tests with mocked Google API
- Email sending tests with Resend mock

✅ **Approved** (9/10) — Clean OAuth implementation, proper token refresh handling`,
  },
  {
    id: "cm-6",
    title: "CM-6: Team Scheduling",
    priority: "high",
    storyCount: 5,
    duration: "~38 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 7,
    prUrl: "https://github.com/workermill-examples/calmill/pull/7",
    commentCount: 79,
    personas: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
    ],
    description: `***REMOVED*** CM-6: Team Scheduling

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Add team scheduling features — create teams, manage members, and configure round-robin or collective booking for team event types.

**Deliverables:**

1. Team CRUD API routes (create, update, delete, list members)
2. Round-robin scheduling (distribute bookings evenly across members)
3. Collective scheduling (find times when all members are available)
4. Team event type configuration
5. Team management UI in dashboard`,
    buildLog: `**WorkerMill** — 2026-02-17 14:38 UTC

**Planning** — Critic approved plan
- 5 stories covering team management and scheduling modes

**Story 0: Team CRUD API Routes** — completed by backend_developer
- Team creation with invite flow
- Member management (add, remove, update role)
- Team-level settings and preferences

**Story 1: Round-Robin Scheduling** — completed by backend_developer
- Even distribution algorithm across team members
- Weighted round-robin support
- Respect individual availability schedules

**Story 2: Collective Scheduling** — completed by backend_developer
- Find overlapping availability across all team members
- Aggregate busy/free data from connected calendars
- Slot generation for collective meetings

**Story 3: Team Event Types** — completed by backend_developer
- Link event types to teams
- Configure scheduling mode (round-robin vs collective)
- Team-specific duration and buffer settings

**Story 4: Team Management UI** — completed by frontend_developer
- Team list and creation form
- Member management with role assignment
- Team event type configuration page

✅ **Approved** (9/10) — Good separation of scheduling algorithms`,
  },
  {
    id: "cm-7",
    title: "CM-7: Embeds, Webhooks & Production",
    priority: "high",
    storyCount: 4,
    duration: "~43 min",
    status: "completed",
    techLeadScore: "9/10",
    prNumber: 8,
    prUrl: "https://github.com/workermill-examples/calmill/pull/8",
    commentCount: 82,
    personas: [
      "backend_developer",
      "frontend_developer",
      "qa_engineer",
      "devops_engineer",
    ],
    description: `***REMOVED*** CM-7: Embeds, Webhooks & Production

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

Production hardening — comprehensive test suite, responsive polish, embed widget support, and deployment configuration.

**Deliverables:**

1. Comprehensive test suite (202 unit tests + E2E flows)
2. Embed widget for external websites
3. Production deploy configuration
4. Documentation updates`,
    buildLog: `**WorkerMill** — 2026-02-17 18:57 UTC

**Planning** — Critic approved plan
- 4 stories — production readiness and testing

**Story 0: Comprehensive Test Suite** — completed by qa_engineer
- 202 unit tests covering all services and utilities
- Slot calculation edge cases (DST transitions, timezone boundaries)
- API route tests with mocked auth
- E2E booking flow tests with Playwright

**Story 1: Responsive Polish** — completed by frontend_developer
- Mobile-first responsive layout fixes
- Color theme consistency across dark mode
- Loading states and skeleton screens
- Error boundary components

**Story 2: Production Config** — completed by devops_engineer
- Vercel deployment configuration
- Environment variable documentation
- Health check and monitoring setup
- CI pipeline optimization

**Story 3: Documentation** — completed by devops_engineer
- Updated README with full feature list
- API documentation
- Contributing guide and architecture overview

✅ **Approved** (9/10) — 202 tests passing, comprehensive coverage`,
  },
  {
    id: "cm-8",
    title: "CM-8: Fix CI Pipeline and Deploy",
    priority: "high",
    storyCount: 3,
    duration: "~29 min",
    status: "deployed",
    techLeadScore: "9/10",
    prNumber: 9,
    prUrl: "https://github.com/workermill-examples/calmill/pull/9",
    commentCount: 57,
    personas: [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
    ],
    description: `***REMOVED*** CM-8: Fix CI Pipeline and Deploy

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)

---

***REMOVED******REMOVED*** Epic Overview

All 5 CI jobs (Lint, TypeCheck, Unit Tests, Build, E2E) were failing on main. Fix every issue so CI is green and Vercel deploy succeeds.

**Deliverables:**

1. Fix all TypeScript compilation errors
2. Fix all ESLint errors
3. Fix failing unit tests
4. Ensure production build succeeds
5. Verify Vercel deployment is live`,
    buildLog: `**WorkerMill** — 2026-02-17 23:51 UTC

**Planning** — Critic approved plan
- 3 stories targeting CI fixes and deploy verification

**Story 0: TypeScript & ESLint Fixes** — completed by backend_developer
- Fixed type errors in booking components and API routes
- Resolved ESLint warnings across the codebase
- Updated type imports for Prisma 7 generated client

**Story 1: Frontend TypeScript Fixes** — completed by frontend_developer
- Fixed bookings list component type errors
- Resolved search handler dead code
- Non-null assertion fixes for filtered arrays

**Story 2: Build & Deploy** — completed by devops_engineer
- All 5 CI jobs passing (lint, typecheck, tests, build, E2E)
- Vercel deploy succeeded
- Health check verified at calmill.workermill.com

✅ **Approved** (9/10) — CI green, Vercel deploy live, all quality gates passing`,
  },
];
