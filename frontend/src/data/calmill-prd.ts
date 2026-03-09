// Sanitized PRD — the original specification that defined the CalMill showcase build
// Connection strings, project IDs, and secret references removed

export const calMillPrd = `# CalMill — Full Build Specification

## Purpose

This is a **showcase build** — a polished demo app designed to demonstrate what WorkerMill can build autonomously. A full-stack open scheduling platform with event types, timezone-aware availability, public booking pages, team round-robin scheduling, Google Calendar integration, email notifications, embeddable booking widgets, and webhooks. When a visitor clicks "Try the Demo", they should see a populated dashboard with realistic event types, bookings, and availability. Every page should have data. Empty states are failure.

## Source of Truth

- **Repo:** \`workermill-examples/calmill\` (GitHub)
- **Live URL:** https://calmill.workermill.com
- **Deployment:** Vercel (app) + Neon PostgreSQL (database)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.1 |
| Language | TypeScript | 5.7 |
| UI | React | 19.2 |
| ORM | Prisma | 7.4 |
| Database | PostgreSQL (Neon) | Serverless with \`@prisma/adapter-neon\` |
| Auth | NextAuth.js v5 | 5.0.0-beta.30 (JWT strategy, bcrypt) |
| Styling | TailwindCSS v4 | CSS-first config (NO \`tailwind.config.js\`) |
| Validation | Zod | 4.3 |
| Date/Timezone | date-fns + @date-fns/tz | 4.1 |
| Email | Resend + React Email | Latest |
| Charts | Recharts | 3 |
| Unit Tests | Vitest | 4.0 |
| E2E Tests | Playwright | 1.58 |
| Linting | ESLint + Prettier | ESLint 9, Prettier 3 |
| CI/CD | GitHub Actions | \`ubuntu-latest\` |
| Hosting | Vercel | Manual deploy via CLI |

## Global Constraints

- **Node.js:** >=24.0.0
- **Prisma 7 Breaking Changes:**
  - \`earlyAccess\` is NOT a valid config property
  - \`url\` and \`directUrl\` have been **removed from schema.prisma** — connection URLs go in \`prisma.config.ts\`
  - Generated client imports from \`@/generated/prisma/client\` (NOT \`@prisma/client\`)
  - Requires \`PrismaNeon\` adapter for Neon connections
- **TailwindCSS 4:** CSS-first configuration only. NO \`tailwind.config.js\` or \`tailwind.config.ts\`. All customization via \`@theme\` block in CSS.
- **Next.js 16 Route Params:** Dynamic route params are \`Promise<{ slug?: string }>\` — must await and guard.
- **Auto-deploy DISABLED** — deployments are manual via Vercel CLI in deploy workflow only.

---

## Prisma 7 Configuration

### \`prisma.config.ts\` (root of project)

\`\`\`typescript
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || "postgresql://localhost:5432/calmill",
  },
});
\`\`\`

### Generator Block

\`\`\`prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}
\`\`\`

### Client Initialization (Neon Adapter Required)

\`\`\`typescript
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!;
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}
\`\`\`

---

## Database Schema (13 models, 3 enums)

### Enums

- **BookingStatus:** PENDING, ACCEPTED, CANCELLED, REJECTED, RESCHEDULED
- **SchedulingType:** ROUND_ROBIN, COLLECTIVE
- **TeamRole:** OWNER, ADMIN, MEMBER

### Models

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| Account | NextAuth OAuth accounts | provider, providerAccountId, access_token |
| Session | NextAuth sessions | sessionToken, expires |
| User | Core user model | email, username, passwordHash, timezone, weekStart, theme |
| EventType | Scheduling event types | title, slug, duration, locations, isActive, customQuestions, schedulingType |
| Booking | Scheduled bookings | uid, startTime, endTime, status, attendeeName/Email/Timezone, responses |
| Schedule | Weekly availability schedules | name, isDefault, timezone |
| Availability | Recurring time windows | day (0-6), startTime, endTime |
| DateOverride | Schedule exceptions | date, startTime, endTime, isUnavailable |
| Team | Team scheduling groups | name, slug, logoUrl, bio |
| TeamMember | Team membership | role (OWNER/ADMIN/MEMBER), accepted |
| CalendarConnection | External calendar OAuth | provider, accessToken, refreshToken, email, isPrimary |
| Webhook | Event webhook subscriptions | url, eventTriggers[], active, secret |

### Key Relationships

- User 1:N EventType, Booking, Schedule, TeamMember, Webhook, CalendarConnection, Account, Session
- Schedule 1:N Availability, DateOverride, EventType
- EventType 1:N Booking
- Team 1:N TeamMember, EventType
- Cascade deletes: User→Account, User→Session, User→Schedule, Schedule→Availability, Schedule→DateOverride, User→TeamMember, Team→TeamMember

### EventType Scheduling Constraints

| Field | Default | Description |
|-------|---------|-------------|
| duration | 30 | Minutes |
| minimumNotice | 120 | Minutes before event can be booked |
| beforeBuffer | 0 | Minutes gap before event |
| afterBuffer | 0 | Minutes gap after event |
| slotInterval | null | Minutes between slot starts (null = use duration) |
| maxBookingsPerDay | null | Daily limit |
| maxBookingsPerWeek | null | Weekly limit |
| futureLimit | 60 | Days into the future |

---

## NextAuth v5 Configuration

- **Providers:** Credentials (email/password with bcryptjs) + Google OAuth
- **Adapter:** PrismaAdapter
- **Session strategy:** JWT
- **Custom callbacks:** Expose \`id\`, \`username\`, \`timezone\` on session
- **Pages:** \`signIn: "/login"\`, \`newUser: "/getting-started"\`

---

## TailwindCSS 4 Theme

\`\`\`css
@import "tailwindcss";

@theme {
  --color-primary-50: #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-200: #bfdbfe;
  --color-primary-300: #93c5fd;
  --color-primary-400: #60a5fa;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-primary-800: #1e40af;
  --color-primary-900: #1e3a8a;

  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;

  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --radius-lg: 0.75rem;
  --radius-md: 0.5rem;
  --radius-sm: 0.25rem;
}
\`\`\`

---

## Seed Data

### Demo User
- **Email:** demo@workermill.com
- **Password:** demo1234
- **Username:** demo
- **Name:** Alex Demo
- **Timezone:** America/New_York

### Event Types (6)
1. "Quick Chat" — 15min, no confirmation, free
2. "30 Minute Meeting" — 30min, no confirmation, free
3. "60 Minute Consultation" — 60min, requires confirmation, free
4. "Technical Interview" — 45min, requires confirmation, 24h minimum notice
5. "Pair Programming" — 90min, link location, 2h buffer after
6. "Coffee Chat" — 20min, in-person, free, **inactive**

### Schedules (2)
1. "Business Hours" — Mon-Fri 09:00-17:00, America/New_York (default)
2. "Extended Hours" — Mon-Fri 08:00-20:00, Sat 10:00-14:00

### Bookings (15)
Spread across the next 30 days: 8 ACCEPTED, 3 PENDING, 2 CANCELLED, 2 past/completed

### Date Overrides (2)
One blocking a specific date, one with modified hours

### Team
- "CalMill Demo Team" (slug: calmill-demo-team)
- Members: Demo user (OWNER) + Alice + Bob (MEMBER, accepted)
- Team event types: "Team Standup" (15min, ROUND_ROBIN), "Group Demo" (30min, COLLECTIVE)

### Webhooks (2)
One active (httpbin.org/post for demo), one inactive

### Recurring Bookings (3)
Weekly series of 4 occurrences

---

## Application Structure

### URL Map

| URL | Auth | Description |
|-----|------|-------------|
| \`/\` | No | Landing page |
| \`/login\` | No | Login form with "Try Demo" button |
| \`/signup\` | No | Registration form |
| \`/getting-started\` | Yes | Post-signup onboarding |
| \`/(dashboard)\` | Yes | Dashboard home with analytics |
| \`/event-types\` | Yes | Event type list with create dialog |
| \`/event-types/[id]\` | Yes | Event type editor (5 tabs) |
| \`/event-types/[id]/embed\` | Yes | Embed code generator |
| \`/bookings\` | Yes | Bookings list (Upcoming/Past/Cancelled) |
| \`/bookings/[uid]\` | Yes | Booking detail with actions |
| \`/availability\` | Yes | Visual schedule editor |
| \`/settings\` | Yes | Profile & account settings |
| \`/settings/calendars\` | Yes | Google Calendar connections |
| \`/settings/webhooks\` | Yes | Webhook management |
| \`/teams\` | Yes | Team list with create dialog |
| \`/teams/[slug]\` | Yes | Team detail (Members/Event Types/Settings) |
| \`/[username]\` | No | Public user profile |
| \`/[username]/[slug]\` | No | Public booking page |
| \`/booking/[uid]\` | No | Booking confirmation |
| \`/booking/[uid]/cancel\` | No | Cancellation form |
| \`/booking/[uid]/reschedule\` | No | Reschedule flow |
| \`/team/[slug]\` | No | Public team profile |
| \`/team/[slug]/[eventSlug]\` | No | Team booking page |
| \`/embed/[username]/[slug]\` | No | Embeddable booking (iframe) |

### API Routes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | \`/api/health\` | No | Health check |
| POST | \`/api/seed\` | Token | Seed demo data |
| POST | \`/api/auth/signup\` | No | User registration |
| GET/POST | \`/api/auth/[...nextauth]\` | — | NextAuth handler |
| GET/POST | \`/api/event-types\` | Yes | List / create event types |
| GET/PUT/DELETE | \`/api/event-types/[id]\` | Yes | Event type CRUD |
| PATCH | \`/api/event-types/[id]/toggle\` | Yes | Toggle active/inactive |
| GET/POST | \`/api/schedules\` | Yes | List / create schedules |
| GET/PUT/DELETE | \`/api/schedules/[id]\` | Yes | Schedule CRUD |
| GET/POST | \`/api/schedules/[id]/overrides\` | Yes | Date override management |
| DELETE | \`/api/schedules/[id]/overrides/[overrideId]\` | Yes | Delete override |
| GET | \`/api/slots\` | No | Available time slots (public) |
| GET/POST | \`/api/bookings\` | Mixed | List (auth) / create (public) |
| GET/PATCH/PUT | \`/api/bookings/[uid]\` | Mixed | Detail / status / reschedule |
| GET | \`/api/users/[username]\` | No | Public user profile |
| GET | \`/api/users/[username]/event-types\` | No | Public event types |
| GET | \`/api/dashboard\` | Yes | Dashboard analytics data |
| GET/PATCH | \`/api/user\` | Yes | Current user / update profile |
| PUT | \`/api/user/password\` | Yes | Change password |
| GET/POST | \`/api/teams\` | Yes | List / create teams |
| GET/PUT/DELETE | \`/api/teams/[slug]\` | Yes | Team CRUD |
| GET/POST | \`/api/teams/[slug]/members\` | Yes | Member management |
| PUT/DELETE | \`/api/teams/[slug]/members/[memberId]\` | Yes | Member role / remove |
| GET/POST | \`/api/teams/[slug]/event-types\` | Yes | Team event types |
| GET | \`/api/teams/[slug]/public\` | No | Public team info |
| GET | \`/api/teams/[slug]/public/event-types\` | No | Public team event types |
| GET | \`/api/teams/invitations\` | Yes | Pending invitations |
| POST | \`/api/teams/invitations/[memberId]/accept\` | Yes | Accept invitation |
| POST | \`/api/teams/invitations/[memberId]/reject\` | Yes | Reject invitation |
| GET | \`/api/integrations/google/connect\` | Yes | Google OAuth URL |
| GET | \`/api/integrations/google/callback\` | — | OAuth callback |
| DELETE | \`/api/integrations/google/disconnect\` | Yes | Disconnect calendar |
| GET/POST | \`/api/webhooks\` | Yes | List / create webhooks |
| GET/PUT/DELETE | \`/api/webhooks/[id]\` | Yes | Webhook CRUD |
| POST | \`/api/webhooks/[id]/test\` | Yes | Send test payload |

---

## Slot Calculation Engine

This is the most complex piece of CalMill — the core scheduling algorithm.

### Function Signature

\`\`\`typescript
export async function getAvailableSlots(params: {
  eventTypeId: string;
  startDate: string;     // YYYY-MM-DD in attendee's timezone
  endDate: string;       // YYYY-MM-DD in attendee's timezone
  timezone: string;      // Attendee's IANA timezone
}): Promise<AvailableSlot[]>

type AvailableSlot = {
  time: string;          // ISO 8601 datetime in UTC
  localTime: string;     // HH:mm in attendee's timezone
  duration: number;      // minutes
};
\`\`\`

### Algorithm

1. **Load event type** with schedule, availability rows, and date overrides.

2. **Load existing bookings** for the date range (status NOT CANCELLED/REJECTED). Include buffer times:
   - \`conflictStart = booking.startTime - eventType.beforeBuffer\`
   - \`conflictEnd = booking.endTime + eventType.afterBuffer\`

3. **If user has CalendarConnection(s):** Fetch busy times from Google Calendar API, merge into conflict array.

4. **For each day in the range:**
   - a. Check date overrides first (priority over regular availability)
   - b. If no override, use Availability rows matching day-of-week
   - c. Convert availability times from schedule timezone to UTC
   - d. Generate candidate slots (interval = \`slotInterval ?? duration\`)
   - e. Filter out: minimum notice, future limit, booking conflicts, daily/weekly limits

5. **Convert remaining slots** to attendee's timezone. Return sorted array.

### Timezone Rules
- Schedule availability = stored in schedule's timezone (e.g., "09:00" in "America/New_York")
- Bookings = stored in UTC
- Use \`@date-fns/tz\`: \`TZDate\`, \`toZonedTime\`, \`fromZonedTime\`
- NEVER use \`new Date()\` directly for timezone conversions

---

## Team Scheduling Algorithms

### Round-Robin (\`getRoundRobinSlots\`)

1. Load team event type with accepted members
2. For each member, compute available slots via \`getAvailableSlots()\`
3. **Union** all member slots — available if ANY member is free
4. Assign host with fewest bookings in last 30 days; tiebreak by least-recently-assigned
5. Re-evaluate assignment at booking time to handle races

### Collective (\`getCollectiveSlots\`)

1. Load team event type with accepted members
2. For each member, compute available slots
3. **Intersect** all member slots — available ONLY if ALL members are free
4. All members attend (no assignment needed)

### Slot Route Dispatch

\`/api/slots\` detects \`schedulingType\`:
- \`null\` (personal) → \`getAvailableSlots()\`
- \`ROUND_ROBIN\` → \`getRoundRobinSlots()\`
- \`COLLECTIVE\` → \`getCollectiveSlots()\`

---

## Public Booking Flow

### Booking Page (3 States)

**State 1 — Date & Time Selection:**
- Left panel: Interactive month calendar with available/unavailable days
- Right panel: Timezone selector (auto-detected) + time slot buttons
- Data flow: detect timezone → fetch month's slots → mark calendar → show slots on date click

**State 2 — Booking Form:**
- Name, email (required), notes (optional)
- Custom questions rendered dynamically from event type config
- Zod validation, loading/error states

**State 3 — Confirmation:**
- Success icon, event details, host info, meeting link
- "Add to Calendar" (Google Calendar link, Outlook/Apple .ics download)
- Reschedule and Cancel links

### Cancel Flow
Booking summary → reason textarea → "Cancel Meeting" button → success with rebook option.

### Reschedule Flow
Same calendar/slot picker → original time crossed out → reason field → submit.

---

## Dashboard

### Dashboard Home
- **4 stat cards:** Upcoming bookings, pending action, this month total, most popular event type
- **Upcoming bookings list:** Next 5 with join button
- **3 charts (Recharts):** Bookings/day line chart, bookings by event type bar chart, bookings by status donut chart

### Event Type Management
- Card list with color bar, title, slug URL preview, duration badge, active toggle, booking count
- "New Event Type" modal (quick create: title, duration, location)
- **Event Type Editor (5 tabs):**
  - General: title, slug, description, duration, locations (repeatable), color picker
  - Availability: schedule selector with preview grid, date overrides
  - Limits & Buffers: minimum notice, buffers, slot interval, booking limits, future limit
  - Booking Form: confirmation toggle, custom questions builder, success redirect
  - Recurring: enable toggle, frequency (weekly/biweekly/monthly), max occurrences

### Bookings Management
- Tabs: Upcoming, Past, Cancelled
- Filters: date range, event type, search by attendee
- Status badges (color-coded), quick actions per status
- Detail view with accept/reject/cancel actions and status timeline

### Availability Schedule Editor
- Schedule selector + create new
- **Visual weekly grid:** 7 day rows, toggle per day, time range inputs (15-min increments), add/remove windows
- **Date overrides:** List with date picker, unavailable toggle, custom time range

### Profile Settings
- Profile: name, username (availability check), email, avatar URL, bio
- Preferences: timezone, week start, theme (light/dark/system)
- Password change, danger zone (delete account with type-to-confirm)

---

## Google Calendar Integration

### OAuth Flow
- **Scopes:** \`calendar.readonly\` + \`calendar.events\`
- Connect → OAuth popup → callback exchanges code for tokens → store CalendarConnection
- Disconnect → revoke token → delete record

### GoogleCalendarService
- \`getValidAccessToken()\` — refresh if within 5 min of expiry
- \`getBusyTimes()\` — POST to freeBusy API
- \`createEvent()\` / \`updateEvent()\` / \`deleteEvent()\` — Calendar event CRUD
- Uses native \`fetch\` (no Google SDK dependency)

### Calendar Sync (Best-Effort)
- On booking ACCEPTED: create event, store \`calendarEventId\`
- On cancellation: delete event
- On reschedule: delete old, create new
- Wrapped in try/catch — never fails the booking operation

---

## Email Notifications (Resend + React Email)

### Templates
| Template | Recipient | Trigger |
|----------|-----------|---------|
| booking-confirmed | Attendee | Booking created (no confirmation required) |
| booking-notification | Host | Booking created |
| booking-accepted | Attendee | Host accepts booking |
| booking-cancelled | Both | Booking cancelled or rejected |
| booking-reminder | Both | Upcoming meeting reminder |

### Sending
- Via Resend SDK with graceful degradation (skip if no API key)
- Fire-and-forget (non-blocking)
- Shared email layout component with CalMill branding

---

## Embed Widgets

### Inline Embed
\`\`\`html
<div data-calmill-embed="demo/30min" data-calmill-theme="light"></div>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
\`\`\`

### Popup Embed
\`\`\`html
<button data-calmill-popup="demo/30min">Book a Meeting</button>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
\`\`\`

### Embed Script (\`calmill-embed.js\`, <3KB)
- Finds \`data-calmill-embed\` divs → creates iframes
- Finds \`data-calmill-popup\` elements → opens overlay on click
- Handles resize via \`postMessage\`
- Sends booking callbacks: \`{ type: "calmill:booked", booking: { uid, title, startTime } }\`
- Popup: full-screen overlay, close on Escape/outside click, scroll lock

### Embed Pages
- No header/footer, transparent background
- Query params: \`?theme=light|dark\`, \`?hideEventDetails=true\`, \`?timezone=xxx\`

### Required Headers
- \`/embed/calmill-embed.js\` → \`Access-Control-Allow-Origin: *\`
- \`/embed/*\` pages → \`X-Frame-Options: ALLOWALL\`, \`frame-ancestors *\`

---

## Webhook System

### CRUD
- Create webhook with URL, event triggers, auto-generated HMAC secret
- Edit URL, triggers, active toggle
- Delivery history (last 10)
- Test endpoint sends sample payload

### Event Triggers
\`BOOKING_CREATED\`, \`BOOKING_CANCELLED\`, \`BOOKING_RESCHEDULED\`, \`BOOKING_ACCEPTED\`, \`BOOKING_REJECTED\`

### Delivery
- HMAC-SHA256 signature in \`X-CalMill-Signature\` header
- \`X-CalMill-Event\` and \`X-CalMill-Delivery\` headers
- 10 second timeout
- Fire-and-forget (non-blocking)

### Payload Format
\`\`\`json
{
  "event": "BOOKING_CREATED",
  "createdAt": "2026-02-20T15:00:00Z",
  "data": {
    "booking": {
      "uid": "clxyz...",
      "title": "30 Minute Meeting",
      "startTime": "2026-02-25T15:00:00Z",
      "endTime": "2026-02-25T15:30:00Z",
      "status": "ACCEPTED",
      "attendee": { "name": "Jane Doe", "email": "jane@example.com", "timezone": "Europe/London" },
      "eventType": { "title": "30 Minute Meeting", "slug": "30min", "duration": 30 }
    }
  }
}
\`\`\`

---

## Recurring Bookings

- Event type enables recurring with frequency (weekly/biweekly/monthly) and max occurrences
- Attendee specifies \`recurringCount\` when booking
- System validates all N slot times, creates linked bookings with shared \`recurringEventId\`
- Date progression: weekly +7d, biweekly +14d, monthly via \`addMonths\`
- Cancel single occurrence or cancel all future (\`?cancelFuture=true\`)

---

## Testing

### Unit Tests (Vitest — 202 tests)
- Event type CRUD (12+ tests)
- Schedule management (10+ tests)
- **Slot calculation (15+ tests):** basic slots, buffers, conflicts, overrides, timezone conversions, daily/weekly limits, minimum notice, future limit, DST transitions
- Booking lifecycle (12+ tests)
- Google Calendar service (8+ tests)
- Email sending (5+ tests)
- Round-robin scheduling (10+ tests)
- Collective scheduling (8+ tests)
- Team routes (8+ tests)

### E2E Tests (Playwright — 297 tests across 10 spec files)
- Auth flows (8), booking flow (15), dashboard (10), event types (12), availability (8), team scheduling (10), embeds (6), webhooks (5), recurring (6), mobile responsive (8)

---

## CI/CD

### GitHub Actions CI (\`ci.yml\`)
- Triggered on push and PR to main
- Jobs: lint, typecheck, unit tests (Vitest), build
- Node.js 24, Postgres service container for tests

### Deploy Workflow (\`deploy.yml\`)
- Run migration (\`prisma db push\`), seed demo data
- Deploy via Vercel CLI: \`vercel pull\` → \`vercel build --prod\` → \`vercel deploy --prebuilt --prod\`
- Post-deploy health check verification

---

## Deployment Checklist

1. Database migration applied to Neon production
2. Environment variables set in Vercel
3. Demo data seeded
4. Health check passing at \`/api/health\`
5. Public booking page accessible at \`/demo/30min\`
6. Embed script accessible at \`/embed/calmill-embed.js\`
7. Email delivery working
`;
