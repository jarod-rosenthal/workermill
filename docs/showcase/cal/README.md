# CalMill Showcase

> A full-stack scheduling platform built entirely by autonomous AI workers, orchestrated by [WorkerMill](https://workermill.com). Inspired by [Cal.com](https://cal.com).

**Live demo:** [calmmill.workermill.com](https://calmill.workermill.com)
**Repository:** [workermill-examples/calmill](https://github.com/workermill-examples/calmill)

---

## What is CalMill?

CalMill is a Cal.com-inspired open scheduling platform with event types, public booking pages, availability management, Google Calendar integration, team scheduling, email notifications, and embeddable widgets. It was built across 7 epics by WorkerMill's autonomous AI workers to demonstrate the platform's capabilities on a product with real algorithmic complexity (timezone-aware slot calculation, calendar conflict detection, round-robin distribution).

**Tech stack:** Next.js 16, React 19.2, TypeScript, Prisma 7, PostgreSQL (Neon), TailwindCSS 4, Zod 4, Recharts 3, Resend, React Email 5, date-fns 4, NextAuth v5, Playwright 1.58, Vitest 4, Vercel.

---

## Epic Execution Timeline

| Epic | Title | Date | Stories | Personas | Score | PR |
|------|-------|------|---------|----------|-------|-----|
| [CM-1](./CM-1-project-setup.md) | Project Setup & Dev Environment | — | 10 | 4 | — | — |
| [CM-2](./CM-2-core-backend.md) | Core Backend — Event Types, Schedules & Slots | — | 8 | 2 | — | — |
| [CM-3](./CM-3-public-booking.md) | Public Booking Experience | — | 8 | 2 | — | — |
| [CM-4](./CM-4-dashboard.md) | Dashboard & Management UI | — | 8 | 2 | — | — |
| [CM-5](./CM-5-calendar-email.md) | Calendar Integration & Email Notifications | — | 7 | 2 | — | — |
| [CM-6](./CM-6-team-scheduling.md) | Team Scheduling | — | 8 | 2 | — | — |
| [CM-7](./CM-7-embeds-webhooks-production.md) | Embeds, Webhooks & Production | — | 8 | 3 | — | — |

---

## By the Numbers

| Metric | Value |
|--------|-------|
| **Total epics** | 7 |
| **Total worker stories** | 57 |
| **Unique personas used** | 4 (`backend_developer`, `frontend_developer`, `qa_engineer`, `devops_engineer`) |
| **Prisma models** | 13 |
| **API routes** | 45+ |
| **React components** | 60+ |
| **E2E tests** | 80+ |
| **Unit tests** | 150+ |
| **Total execution time** | TBD |

---

## How It Works

Each epic follows the same pattern:

1. **Planning** — WorkerMill's planner agent decomposes the ticket into parallel stories, each assigned to a persona (backend_developer, frontend_developer, etc.)
2. **Parallel execution** — Workers execute their stories simultaneously in isolated git worktrees, each writing to their assigned files
3. **Consolidation** — Changes are merged into a single branch, resolving any conflicts
4. **Tech Lead review** — An AI tech lead reviews the consolidated PR for quality, correctness, and adherence to the spec
5. **Revision** — If issues are found, affected stories are re-executed with targeted feedback
6. **Approval** — Once the tech lead is satisfied, the PR is marked ready for merge

---

## Why CalMill?

CalMill was chosen as the second WorkerMill showcase (after [TeamBoard](../README.md)) because it demonstrates capabilities that a Kanban board cannot:

| Capability | TeamBoard | CalMill |
|-----------|-----------|---------|
| Public-facing pages | No (auth-only) | Yes (booking pages, embeds) |
| Algorithmic complexity | Drag-and-drop reorder | Timezone-aware slot calculation with conflict detection |
| External integrations | None | Google Calendar OAuth, Resend email |
| Distributable components | No | Embeddable booking widget |
| Team coordination logic | RBAC roles | Round-robin + collective scheduling algorithms |
| Email system | None | Transactional emails with React Email templates |

**Narrative:** "WorkerMill's AI workers built a fully functional scheduling platform — from timezone-aware slot calculation to Google Calendar integration to embeddable booking widgets — across 7 epics."

---

## Tech Stack Details

### Version Constraints (CRITICAL — follow exactly)

| Package | Version | Why This Version |
|---------|---------|-----------------|
| Node.js | 24 LTS | Current LTS as of Feb 2026 |
| Next.js | ^16.1.0 | Latest stable, new routing system |
| React | ^19.2.0 | Latest stable |
| TypeScript | ^5.7.0 | Latest stable |
| Prisma | ^7.2.0 | Rust-free client, generated code outside node_modules |
| TailwindCSS | ^4.1.0 | CSS-first configuration (no tailwind.config.js) |
| next-auth | 5.0.0-beta.25 | v5 beta — use `next-auth@beta` to install |
| Zod | ^4.3.0 | Latest stable with improved inference |
| Vitest | ^4.0.0 | Latest stable |
| @playwright/test | ^1.58.0 | Latest stable |
| Recharts | ^3.7.0 | Latest stable (v3 API) |
| Resend | ^6.9.0 | Email delivery service |
| react-email | ^5.2.0 | Email template components |
| @react-email/components | ^1.0.0 | Email building blocks |
| date-fns | ^4.1.0 | Date manipulation |
| @date-fns/tz | latest | Timezone-aware date operations |

### Key Architecture Differences from TeamBoard

**Prisma 7 (NEW):** Generated client code goes to a specified output directory (not `node_modules`). Configuration uses a `prisma.config.ts` file instead of `generator` blocks in the schema. Import from the output path, not `@prisma/client`.

**TailwindCSS 4 (NEW):** No `tailwind.config.js` or `tailwind.config.ts`. Configuration is CSS-first using `@import "tailwindcss"` and `@theme` directives in `globals.css`. Custom colors, fonts, and spacing defined in CSS, not JavaScript.

**Next.js 16 (NEW):** Refined routing and navigation system. Faster page transitions. Otherwise similar App Router patterns to Next.js 15.

---

## Database Schema Overview

13 models across 3 domains:

**Core Scheduling:**
- `User` — Account with username, timezone, preferences
- `EventType` — Bookable meeting type with duration, buffers, limits, pricing
- `Booking` — Confirmed/pending/cancelled meeting instance
- `Schedule` — Named availability template (e.g., "Business Hours", "Weekends")
- `Availability` — Day-of-week time windows within a schedule
- `DateOverride` — Per-date availability exceptions

**Teams:**
- `Team` — Organization with slug, logo, bio
- `TeamMember` — User-team membership with role (OWNER/ADMIN/MEMBER)

**Integrations:**
- `CalendarConnection` — OAuth tokens for Google/Outlook calendar sync
- `Webhook` — HTTP callback subscriptions for booking events
- `Account` — OAuth provider accounts (NextAuth)
- `Session` — User sessions (NextAuth)

**Enums:** `BookingStatus` (PENDING, ACCEPTED, CANCELLED, REJECTED, RESCHEDULED), `SchedulingType` (ROUND_ROBIN, COLLECTIVE), `TeamRole` (OWNER, ADMIN, MEMBER)
