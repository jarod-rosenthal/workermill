# CM-7: Embeds, Webhooks & Production

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

The final epic — add embeddable booking widgets (inline and popup), a webhook system for booking events, recurring booking support, a comprehensive E2E test suite, and production deployment validation. This epic makes CalMill distributable (embeds), programmable (webhooks), and production-ready.

**Deliverables:**

1. Inline embed widget (renders booking page inside an iframe)
2. Popup embed widget (floating button that opens booking overlay)
3. Webhook CRUD and event delivery system
4. Recurring booking creation and management
5. Comprehensive E2E test suite covering all features
6. Production deployment to Vercel with health checks
7. Final demo data seeding and documentation
8. Embed code generator in dashboard

---

## Technical Specification

### Embed Widget System

CalMill embeds allow website owners to add scheduling directly to their pages without visitors leaving the site. Two modes: inline (rendered in-page) and popup (floating button).

#### Inline Embed

**How it works:** An iframe pointing to the CalMill booking page, styled to blend into the host page.

**Embed script:** `src/app/embed/calmill-embed.js` — A lightweight (<3KB) vanilla JavaScript file that:
1. Finds all `<div data-calmill-embed="username/slug"></div>` elements on the page
2. Creates an iframe for each, pointing to `{CALMILL_URL}/embed/[username]/[slug]`
3. Handles iframe resizing via `postMessage` (the embedded page sends its content height)
4. Applies default styles (no border, rounded corners, width: 100%)

**Embed pages:** Specialized versions of the booking page optimized for iframe embedding:

**`src/app/embed/[username]/[slug]/page.tsx`:**
- Same booking flow as `/(public)/[username]/[slug]` but:
  - No header/footer (clean, borderless)
  - Background transparent
  - Sends `postMessage({ type: "calmill:resize", height: N })` on content change
  - Sends `postMessage({ type: "calmill:booked", booking: { uid, title, startTime } })` on successful booking
  - Accepts query params: `?theme=light|dark`, `?hideEventDetails=true`, `?timezone=America/New_York`

**Embed page layout:** `src/app/embed/layout.tsx` — Minimal layout, no navigation, transparent background.

**Usage (on external site):**
```html
<!-- Inline embed -->
<div data-calmill-embed="demo/30min" data-calmill-theme="light"></div>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
```

#### Popup Embed

**How it works:** A floating button that, when clicked, opens the booking page as a modal overlay.

**Extended embed script** (same `calmill-embed.js`):
1. Also finds `<button data-calmill-popup="username/slug">` elements
2. On click, creates a full-screen overlay with the booking iframe centered
3. Close button in top-right corner
4. Escape key closes the popup
5. Click outside the iframe closes the popup
6. Prevents body scroll when popup is open

**Usage (on external site):**
```html
<!-- Popup embed -->
<button data-calmill-popup="demo/30min">Book a Meeting</button>
<script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
```

#### Element Click Embed

A variant where clicking any element opens the popup:
```html
<a href="#" data-calmill-popup="demo/30min">Schedule a call with us</a>
```

### Embed Code Generator (Dashboard)

**`src/app/(dashboard)/event-types/[id]/embed/page.tsx`:**

UI for generating embed code:
- Tab selection: "Inline", "Popup", "Element Click"
- Live preview showing the embed in action (inside an iframe on the page)
- Configuration options:
  - Theme: Light / Dark
  - Hide event details: checkbox
  - Pre-set timezone: dropdown (optional)
- Generated code display (read-only textarea with copy button):
  ```html
  <!-- CalMill Inline Embed -->
  <div data-calmill-embed="demo/30min" data-calmill-theme="light"></div>
  <script src="https://calmill.workermill.com/embed/calmill-embed.js" async></script>
  ```
- "Copy Code" button that copies to clipboard

### Webhook System

Webhooks allow external systems to react to CalMill events (booking created, cancelled, etc.).

#### Webhook CRUD Routes

**`src/app/api/webhooks/route.ts`:**
- `GET /api/webhooks` — List user's webhooks with last delivery status.
- `POST /api/webhooks` — Create webhook. Validate URL is HTTPS (except localhost for dev). Generate `secret` for payload signing (HMAC-SHA256). Validate `eventTriggers` is a non-empty array of valid trigger names.

**`src/app/api/webhooks/[id]/route.ts`:**
- `GET /api/webhooks/[id]` — Webhook details with recent delivery history (last 10).
- `PUT /api/webhooks/[id]` — Update URL, triggers, active status.
- `DELETE /api/webhooks/[id]` — Delete webhook and delivery history.

**Zod schema:**
```typescript
export const webhookCreateSchema = z.object({
  url: z.string().url(),
  eventTriggers: z.array(z.enum([
    "BOOKING_CREATED",
    "BOOKING_CANCELLED",
    "BOOKING_RESCHEDULED",
    "BOOKING_ACCEPTED",
    "BOOKING_REJECTED",
  ])).min(1),
  active: z.boolean().optional(),
});
```

#### Webhook Event Delivery

**`src/lib/webhooks.ts`:**

```typescript
export async function deliverWebhookEvent(params: {
  userId: string;
  eventType: string; // "BOOKING_CREATED" etc.
  payload: Record<string, unknown>;
}): Promise<void> {
  // 1. Find all active webhooks for this user that subscribe to this event type
  // 2. For each webhook:
  //    a. Create HMAC-SHA256 signature: HMAC(secret, JSON.stringify(payload))
  //    b. POST to webhook URL with headers:
  //       - Content-Type: application/json
  //       - X-CalMill-Signature: sha256=<signature>
  //       - X-CalMill-Event: <eventType>
  //       - X-CalMill-Delivery: <unique delivery ID>
  //    c. Timeout: 10 seconds
  //    d. Log delivery result (status code, success/failure)
  // 3. Fire-and-forget (don't block the booking flow)
}
```

**Webhook payload format:**
```json
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
      "attendee": {
        "name": "Jane Doe",
        "email": "jane@example.com",
        "timezone": "Europe/London"
      },
      "eventType": {
        "title": "30 Minute Meeting",
        "slug": "30min",
        "duration": 30
      }
    }
  }
}
```

**Integration points:** Add `deliverWebhookEvent()` calls to:
- `POST /api/bookings` → `BOOKING_CREATED`
- `PATCH /api/bookings/[uid]` → `BOOKING_ACCEPTED`, `BOOKING_REJECTED`, `BOOKING_CANCELLED`
- `PUT /api/bookings/[uid]/reschedule` → `BOOKING_RESCHEDULED`

### Webhook Management UI

**`src/app/(dashboard)/settings/webhooks/page.tsx`:**
- List of webhooks with URL, event triggers (badges), active toggle, last delivery status (green/red dot)
- "Add Webhook" button → dialog with URL input, event trigger checkboxes, create button
- Webhook detail view: edit URL/triggers, delivery history table (last 10: timestamp, event, status code, success/failure)
- "Test" button that sends a test payload to the webhook URL
- Secret display (show once on creation, then masked)

### Recurring Booking Support

Extend existing booking creation to support recurring bookings.

**How it works:**
- Event type has `recurringEnabled`, `recurringFrequency`, and `recurringMaxOccurrences`
- When a booking is created for a recurring event type, the attendee specifies `recurringCount` (how many occurrences)
- The system creates N individual bookings, each with the same `recurringEventId` (shared UUID linking them)
- Each recurring booking is at the same time on subsequent weeks/biweeks/months

**Modification to `POST /api/bookings`:**

If `recurringCount > 1` and event type has `recurringEnabled`:
1. Validate all N slot times are available
2. Generate a `recurringEventId` (shared UUID)
3. Create N booking records, each with incrementing dates:
   - `weekly`: +7 days per occurrence
   - `biweekly`: +14 days per occurrence
   - `monthly`: +1 month per occurrence (using `date-fns addMonths`)
4. Return array of booking UIDs

**Recurring booking management:**
- `GET /api/bookings?recurringEventId=xxx` — List all bookings in a recurring series
- Cancelling a single occurrence: normal cancel on that booking
- Cancelling all future: `PATCH /api/bookings/[uid]?cancelFuture=true` — cancels this and all future bookings with the same `recurringEventId` and `startTime > this.startTime`

**UI updates:**
- On booking confirmation page, show "This is a recurring event (X occurrences)" with list of all dates
- In dashboard bookings list, recurring bookings show a "recurring" badge and "X of Y" indicator
- Cancel dialog for recurring: "Cancel this occurrence" or "Cancel this and all future"

### Comprehensive E2E Test Suite

**`e2e/` directory structure:**
```
e2e/
├── helpers/
│   ├── auth-helpers.ts        # Login, signup utilities
│   ├── booking-helpers.ts     # Create bookings, navigate flows
│   └── seed-helpers.ts        # Database seeding for test isolation
├── auth.spec.ts               # Authentication flows
├── booking-flow.spec.ts       # Complete booking journey (from CM-3)
├── dashboard.spec.ts          # Dashboard management (from CM-4)
├── event-types.spec.ts        # Event type CRUD + editor
├── availability.spec.ts       # Schedule editing
├── team-scheduling.spec.ts    # Team booking flows
├── embeds.spec.ts             # Embed widget rendering
├── webhooks.spec.ts           # Webhook management
├── recurring.spec.ts          # Recurring booking flows
└── mobile.spec.ts             # Mobile responsive tests
```

**Test counts by file:**
- `auth.spec.ts` — 8 tests (login, signup, demo login, logout, session persistence, invalid credentials, redirect after login, protected route redirect)
- `booking-flow.spec.ts` — 15 tests (from CM-3, extended)
- `dashboard.spec.ts` — 10 tests (stat cards, charts, upcoming bookings, navigation)
- `event-types.spec.ts` — 12 tests (list, create, edit tabs, toggle, delete, slug preview, custom questions)
- `availability.spec.ts` — 8 tests (view schedule, toggle days, change times, add override, delete schedule)
- `team-scheduling.spec.ts` — 10 tests (create team, invite member, round-robin booking, collective booking, team page)
- `embeds.spec.ts` — 6 tests (inline render, popup open/close, theme param, postMessage resize, booking in embed)
- `webhooks.spec.ts` — 5 tests (create webhook, edit, toggle, test delivery, delete)
- `recurring.spec.ts` — 6 tests (create recurring, view series, cancel single, cancel future, date progression)
- `mobile.spec.ts` — 8 tests (responsive layout, sidebar collapse, touch interactions, calendar on mobile)

**Total: 88 E2E tests**

### Production Deployment

**Vercel configuration (`vercel.json`):**
```json
{
  "framework": "nextjs",
  "buildCommand": "npx prisma generate && npm run build",
  "env": {
    "DATABASE_URL": "@calmill-database-url",
    "AUTH_SECRET": "@calmill-auth-secret"
  },
  "headers": [
    {
      "source": "/embed/calmill-embed.js",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/embed/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "ALLOWALL" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors *" }
      ]
    }
  ]
}
```

**Critical headers for embeds:**
- `/embed/calmill-embed.js` needs `Access-Control-Allow-Origin: *` (loaded from external sites)
- `/embed/*` pages need `X-Frame-Options: ALLOWALL` and `frame-ancestors *` CSP (rendered in iframes on external sites)
- All other pages keep default security headers

**Deployment checklist:**
1. Database migration applied to Neon production
2. Environment variables set in Vercel (DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY, etc.)
3. Demo data seeded
4. Health check passing at `/api/health`
5. Public booking page accessible at `/demo/30min`
6. Embed script accessible at `/embed/calmill-embed.js`
7. Email delivery working (test booking triggers confirmation email)

---

## Worker Stories

### Story 1: Inline Embed Widget
**Persona:** `frontend_developer`

Build the inline embed system:
- `src/app/embed/layout.tsx` — Minimal layout (no nav, transparent bg)
- `src/app/embed/[username]/[slug]/page.tsx` — Booking page variant for embeds (no header/footer, postMessage for resize and booking events, query param support for theme/timezone)
- `public/embed/calmill-embed.js` — Lightweight vanilla JS embed loader for inline mode (finds `data-calmill-embed` divs, creates iframes, handles resize messages)

**Target files:** `src/app/embed/layout.tsx`, `src/app/embed/[username]/[slug]/page.tsx`, `public/embed/calmill-embed.js`

---

### Story 2: Popup Embed Widget
**Persona:** `frontend_developer`

Extend the embed script with popup mode:
- Add popup handling to `public/embed/calmill-embed.js` — finds `data-calmill-popup` elements, creates overlay on click, close on Escape/outside click, scroll lock
- Popup overlay styling (full-screen semi-transparent backdrop, centered white container, close button)
- Element click variant: any element with `data-calmill-popup` attribute triggers popup
- Smooth open/close animations (CSS transitions)

**Target files:** `public/embed/calmill-embed.js` (extend)

---

### Story 3: Webhook System (Backend)
**Persona:** `backend_developer`

Build webhook CRUD and delivery:
- `src/app/api/webhooks/route.ts` — GET (list) and POST (create with secret generation)
- `src/app/api/webhooks/[id]/route.ts` — GET, PUT, DELETE
- `src/app/api/webhooks/[id]/test/route.ts` — POST (send test payload)
- `src/lib/webhooks.ts` — `deliverWebhookEvent()` with HMAC signing, timeout, logging
- Integrate delivery into booking routes (BOOKING_CREATED, CANCELLED, ACCEPTED, REJECTED, RESCHEDULED)
- Webhook delivery is fire-and-forget (non-blocking)

**Target files:** `src/app/api/webhooks/route.ts`, `src/app/api/webhooks/[id]/route.ts`, `src/app/api/webhooks/[id]/test/route.ts`, `src/lib/webhooks.ts`, modify booking routes

---

### Story 4: Recurring Booking Support
**Persona:** `backend_developer`

Add recurring booking creation and management:
- Modify `POST /api/bookings` — Handle `recurringCount` parameter, validate all N slots, create linked bookings with shared `recurringEventId`
- Modify `PATCH /api/bookings/[uid]` — Add `cancelFuture=true` query param for cancelling future occurrences
- Modify `GET /api/bookings` — Include `recurringEventId` grouping info
- Date progression logic: weekly (+7d), biweekly (+14d), monthly (addMonths)

**Target files:** Modify `src/app/api/bookings/route.ts`, `src/app/api/bookings/[uid]/route.ts`

---

### Story 5: Webhook and Embed Dashboard UI
**Persona:** `frontend_developer`

Build management UIs:
- `src/app/(dashboard)/settings/webhooks/page.tsx` — Webhook list, create dialog, detail view with delivery history, test button
- `src/app/(dashboard)/event-types/[id]/embed/page.tsx` — Embed code generator with inline/popup tabs, live preview, config options, copy button
- Recurring booking UI updates: recurring badge on booking cards, "cancel future" option in cancel dialog, series view on confirmation page

**Target files:** `src/app/(dashboard)/settings/webhooks/page.tsx`, `src/app/(dashboard)/event-types/[id]/embed/page.tsx`, modify booking components

---

### Story 6: Comprehensive E2E Test Suite
**Persona:** `qa_engineer`

Build the full E2E test suite (88 tests across 10 spec files):
- `e2e/helpers/` — Shared utilities for auth, booking creation, seeding
- `e2e/auth.spec.ts` — 8 authentication tests
- `e2e/event-types.spec.ts` — 12 event type management tests
- `e2e/availability.spec.ts` — 8 schedule editing tests
- `e2e/team-scheduling.spec.ts` — 10 team booking tests
- `e2e/embeds.spec.ts` — 6 embed rendering tests
- `e2e/webhooks.spec.ts` — 5 webhook management tests
- `e2e/recurring.spec.ts` — 6 recurring booking tests
- `e2e/mobile.spec.ts` — 8 mobile responsive tests
- Extend `e2e/booking-flow.spec.ts` and `e2e/dashboard.spec.ts` from earlier epics

**Target files:** 10 spec files + 3 helper files in `e2e/`

---

### Story 7: Production Deploy Configuration and Documentation
**Persona:** `devops_engineer`

Production deployment setup:
- `vercel.json` — Framework config, build command, CORS headers for embeds, iframe security headers
- Update `.github/workflows/deploy.yml` — Add production env vars, post-deploy health check, embed script accessibility check
- Update `README.md` — Production setup guide, environment variable documentation, embed usage instructions
- Update `CLAUDE.md` — Add embed conventions, webhook testing commands

**Target files:** `vercel.json`, `.github/workflows/deploy.yml` (modify), `README.md` (modify), `CLAUDE.md` (modify)

---

### Story 8: Final Seed Data and Demo Polish
**Persona:** `backend_developer`

Production-ready demo data:
- Expand `prisma/seed.ts` with:
  - 2 webhooks (one active pointing to httpbin.org/post for demo, one inactive)
  - 3 recurring bookings (weekly series of 4)
  - Date overrides showing a blocked day and a modified-hours day
  - Realistic attendee names and emails across all bookings
- Verify all seeded data renders correctly in dashboard and public pages
- Add `calmill-embed-demo.html` in `public/` — Static page demonstrating both inline and popup embeds using the demo user's event types

**Target files:** `prisma/seed.ts` (modify), `public/calmill-embed-demo.html`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 8 |
| **Personas** | `backend_developer`, `frontend_developer`, `qa_engineer`, `devops_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | None (final epic) |
