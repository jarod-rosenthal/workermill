# CM-4: Dashboard & Management UI

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Build the authenticated dashboard — the management interface where users create and configure event types, view and manage bookings, edit their availability schedules visually, update profile settings, and view analytics. All pages require authentication via NextAuth.

**Deliverables:**

1. Event type list with create dialog and quick actions
2. Event type editor with multi-tab configuration form
3. Bookings list with status tabs, filters, and bulk actions
4. Booking detail view with accept/reject/cancel actions
5. Visual availability schedule editor (weekly grid)
6. Profile and account settings page
7. Dashboard home with analytics charts and upcoming bookings
8. E2E tests for dashboard flows

---

## Technical Specification

### Event Type List Page

**`src/app/(dashboard)/event-types/page.tsx`** — Server component.

**Layout:**
- Page title: "Event Types" with "New Event Type" button (top-right)
- List of event type cards (not a table — cards provide richer display)
- Each card shows:
  - Color bar (left edge, 4px wide, event type color)
  - Title and slug (`/demo/30min` preview URL)
  - Duration badge, location icons
  - Active/inactive toggle switch (PATCH to `/api/event-types/[id]/toggle`)
  - Booking count (last 30 days)
  - Quick actions: Copy link, Edit, Duplicate, Delete
- Cards ordered by `createdAt` DESC
- Empty state: illustration + "Create your first event type" CTA

**Create Event Type Dialog:**
- Modal/dialog triggered by "New Event Type" button
- Quick-create form: title, duration (15/30/45/60/90/120 dropdown), location type
- Slug auto-generated from title (shown as preview)
- "Create" button → POST to `/api/event-types` → redirect to editor

### Event Type Editor

**`src/app/(dashboard)/event-types/[id]/page.tsx`** — Full-page editor.

Multi-tab form with tabs:

#### Tab 1: General
- Title (text input)
- Slug (text input with `/username/` prefix preview)
- Description (textarea, max 500 chars)
- Duration (number input with quick-select buttons: 15, 30, 45, 60, 90, 120 min)
- Locations (repeatable field group):
  - Type dropdown: "In Person", "Video Link", "Phone Call"
  - Value input: address, URL, or phone number
  - Add/remove buttons
- Color picker (8 preset colors + custom hex input)

#### Tab 2: Availability
- Schedule selector dropdown (list of user's schedules)
- Preview of selected schedule's availability (read-only weekly grid)
- "Edit Schedule" link → opens `/availability` in new tab
- Date-specific overrides section:
  - List of existing overrides for this event type's schedule
  - "Add Override" button → date picker + time range or "Unavailable all day"

#### Tab 3: Limits & Buffers
- Minimum notice: number input with unit selector (minutes/hours/days)
- Buffer before event: number input (0-120 minutes)
- Buffer after event: number input (0-120 minutes)
- Slot interval: number input (optional, defaults to duration)
- Max bookings per day: number input (optional)
- Max bookings per week: number input (optional)
- Future booking limit: number input (days, 1-365)

#### Tab 4: Booking Form
- "Require confirmation" toggle
- Custom questions builder:
  - Drag-to-reorder list of questions (simple up/down arrows, no drag library needed)
  - Each question: label, type (text/textarea/select/radio/checkbox/phone), required toggle
  - For select/radio types: options list with add/remove
  - Add new question button
  - Delete question button with confirmation
- Success redirect URL (optional text input)

#### Tab 5: Recurring (if enabled)
- "Enable recurring bookings" toggle
- Frequency: weekly / biweekly / monthly
- Max occurrences: number input (1-52)

**Save behavior:** Auto-save on field blur with debounce (500ms), or manual "Save" button. Show "Saved" indicator. Optimistic UI with error rollback.

**Header:** Event type title, active/inactive toggle, "Preview" button (opens public booking page in new tab), "Delete" button (with confirmation dialog).

### Bookings List Page

**`src/app/(dashboard)/bookings/page.tsx`** — Server component.

**Layout:**
- Tab bar: "Upcoming" (default), "Past", "Cancelled"
- Filters row: date range picker, event type dropdown, search by attendee name/email
- Booking cards (list layout, not table):
  - Date and time (in host's timezone)
  - Attendee name + email
  - Event type title + duration
  - Status badge (color-coded: green=accepted, yellow=pending, red=cancelled, blue=rescheduled)
  - Quick actions based on status:
    - PENDING: Accept, Reject
    - ACCEPTED: Cancel
    - CANCELLED: no actions
- Pagination (page-based, 20 per page)
- Empty state per tab

### Booking Detail View

**`src/app/(dashboard)/bookings/[uid]/page.tsx`:**

- Full booking details:
  - Status badge (large, top of page)
  - Date and time with timezone
  - Event type title and duration
  - Attendee: name, email, timezone, notes
  - Location / meeting URL
  - Custom question responses (if any)
  - Cancellation reason (if cancelled)
- Action buttons based on status:
  - PENDING: "Accept" (green), "Reject" (red with reason dialog)
  - ACCEPTED: "Cancel" (red with reason dialog)
  - CANCELLED/REJECTED: "Rebook" link (opens public page)
- Timeline: creation date, status changes with timestamps

### Availability Schedule Editor

**`src/app/(dashboard)/availability/page.tsx`:**

**Layout:**
- Schedule selector dropdown (with "Create New Schedule" option)
- Schedule name input (editable inline)
- Timezone selector dropdown
- "Set as Default" toggle

**Visual Weekly Grid:**
- 7 rows (one per day of week, starting from user's `weekStart`)
- Each row shows:
  - Day name (Monday, Tuesday, etc.)
  - Toggle switch (available/unavailable for this day)
  - Time range inputs when enabled: start time and end time (HH:mm select dropdowns in 15-min increments)
  - "+" button to add additional time windows for the same day (e.g., 09:00-12:00 and 13:00-17:00)
  - "×" button to remove a time window

**Date Overrides section (below weekly grid):**
- List of existing overrides with date, time range (or "Unavailable"), delete button
- "Add Date Override" button:
  - Date picker (calendar popup)
  - Toggle: "Unavailable all day" or custom time range
  - Time range inputs if custom

**Save:** PUT to `/api/schedules/[id]` with full availability replacement. Show success toast.

**Delete schedule:** Button at bottom with confirmation. Fails if event types reference it.

### Profile Settings Page

**`src/app/(dashboard)/settings/page.tsx`:**

Multi-section form:

**Profile section:**
- Name (text input)
- Username (text input with availability check on blur)
- Email (text input, readonly if OAuth-linked)
- Avatar URL (text input — no file upload for simplicity)
- Bio (textarea, max 300 chars)
- Public profile preview link

**Preferences section:**
- Timezone (searchable dropdown, same component as booking page)
- Week start day: Sunday / Monday
- Theme: Light / Dark / System
- Default schedule selector

**Password section (if credentials auth):**
- Current password
- New password
- Confirm new password
- Save password button

**Danger zone:**
- "Delete Account" button with type-to-confirm dialog (type username)
- Deletes user and all associated data

### Dashboard Home

**`src/app/(dashboard)/page.tsx`** (redirected from `/(dashboard)/dashboard/page.tsx`):

**Summary cards row (4 cards):**
1. "Upcoming" — count of ACCEPTED bookings in the next 7 days
2. "Pending" — count of PENDING bookings requiring action
3. "This Month" — total bookings created this calendar month
4. "Popular" — most-booked event type name + count

**Upcoming bookings list (below cards):**
- Next 5 upcoming ACCEPTED bookings
- Each shows: date/time, attendee name, event type, join button (if video link)
- "View All" link to bookings page

**Charts section (Recharts 3):**
- **Bookings over time** — Line chart showing bookings per day for the last 30 days
- **Bookings by event type** — Horizontal bar chart showing distribution across event types
- **Bookings by status** — Donut chart showing ACCEPTED/PENDING/CANCELLED distribution

**API endpoint for dashboard data:**
- `src/app/api/dashboard/route.ts` — GET, authenticated. Returns:
  ```json
  {
    "upcomingCount": 12,
    "pendingCount": 3,
    "monthlyCount": 45,
    "popularEventType": { "title": "30 Minute Meeting", "count": 28 },
    "upcomingBookings": [...],
    "bookingsByDay": [{ "date": "2026-02-01", "count": 3 }, ...],
    "bookingsByEventType": [{ "title": "30min", "count": 28 }, ...],
    "bookingsByStatus": { "ACCEPTED": 35, "PENDING": 5, "CANCELLED": 5 }
  }
  ```

---

## Worker Stories

### Story 1: Event Type List Page and Create Dialog
**Persona:** `frontend_developer`

Build the event type management list:
- `src/app/(dashboard)/event-types/page.tsx` — Server component fetching event types
- `src/components/event-types/event-type-card.tsx` — Card with color bar, title, slug, duration, toggle, quick actions
- `src/components/event-types/create-dialog.tsx` — Modal with quick-create form (title, duration, location type)
- Toggle switch calls PATCH `/api/event-types/[id]/toggle`
- Copy link copies public booking URL to clipboard
- Delete with confirmation dialog
- Empty state with CTA

**Target files:** `src/app/(dashboard)/event-types/page.tsx`, `src/components/event-types/event-type-card.tsx`, `src/components/event-types/create-dialog.tsx`

---

### Story 2: Event Type Editor (Multi-Tab Form)
**Persona:** `frontend_developer`

Build the full event type configuration editor:
- `src/app/(dashboard)/event-types/[id]/page.tsx` — Server component loading event type
- `src/components/event-types/editor.tsx` — Client component with tab navigation
- `src/components/event-types/general-tab.tsx` — Title, slug, description, duration, locations, color
- `src/components/event-types/availability-tab.tsx` — Schedule selector with preview grid
- `src/components/event-types/limits-tab.tsx` — Minimum notice, buffers, slot interval, booking limits
- `src/components/event-types/booking-tab.tsx` — Confirmation toggle, custom questions builder, success redirect
- `src/components/event-types/recurring-tab.tsx` — Recurring enable, frequency, max occurrences
- Auto-save with debounce on field blur, or manual save button
- Header with title, toggle, preview link, delete

**Target files:** `src/app/(dashboard)/event-types/[id]/page.tsx`, `src/components/event-types/editor.tsx`, plus 5 tab components

---

### Story 3: Bookings List Page
**Persona:** `frontend_developer`

Build the bookings management interface:
- `src/app/(dashboard)/bookings/page.tsx` — Server component with initial data
- `src/components/bookings/bookings-list.tsx` — Client component with tab switching (Upcoming/Past/Cancelled), filters (date range, event type, search), pagination
- `src/components/bookings/booking-card.tsx` — Card showing date/time, attendee, event type, status badge, quick actions
- Accept/reject/cancel actions call PATCH `/api/bookings/[uid]`
- Status filter maps to API query params
- Empty states per tab

**Target files:** `src/app/(dashboard)/bookings/page.tsx`, `src/components/bookings/bookings-list.tsx`, `src/components/bookings/booking-card.tsx`

---

### Story 4: Booking Detail View
**Persona:** `frontend_developer`

Build the booking detail page:
- `src/app/(dashboard)/bookings/[uid]/page.tsx` — Full booking details with status badge, attendee info, event type details, custom question responses, meeting link
- Action buttons based on booking status (accept, reject with reason dialog, cancel with reason dialog)
- Status timeline showing creation and changes
- "Rebook" link for cancelled bookings

**Target files:** `src/app/(dashboard)/bookings/[uid]/page.tsx`, `src/components/bookings/booking-actions.tsx`, `src/components/bookings/status-timeline.tsx`

---

### Story 5: Availability Schedule Editor
**Persona:** `frontend_developer`

Build the visual schedule editor:
- `src/app/(dashboard)/availability/page.tsx` — Schedule selector, inline name editing, timezone dropdown
- `src/components/availability/weekly-grid.tsx` — 7 day rows with toggle, time range inputs (HH:mm dropdowns in 15-min increments), add/remove time windows
- `src/components/availability/date-overrides.tsx` — Override list with date picker, unavailable toggle, custom time range, delete button
- Save: full availability replacement PUT to `/api/schedules/[id]`
- Create new schedule flow
- Delete schedule with reference check handling (show error if event types use it)

**Target files:** `src/app/(dashboard)/availability/page.tsx`, `src/components/availability/weekly-grid.tsx`, `src/components/availability/date-overrides.tsx`

---

### Story 6: Profile Settings Page
**Persona:** `frontend_developer`

Build the settings page:
- `src/app/(dashboard)/settings/page.tsx` — Multi-section form
- Profile section: name, username (with availability check), email, avatar URL, bio
- Preferences: timezone selector, week start, theme toggle
- Password change section (conditional on credentials auth)
- Danger zone: delete account with type-to-confirm
- All fields save individually on blur or via section save buttons
- API routes:
  - `src/app/api/user/route.ts` — GET (current user), PATCH (update profile)
  - `src/app/api/user/password/route.ts` — PUT (change password with current password verification)

**Target files:** `src/app/(dashboard)/settings/page.tsx`, `src/app/api/user/route.ts`, `src/app/api/user/password/route.ts`

---

### Story 7: Dashboard Home with Analytics
**Persona:** `frontend_developer`

Build the dashboard home page:
- `src/app/(dashboard)/page.tsx` — Server component redirecting to dashboard or rendering directly
- `src/components/dashboard/stat-cards.tsx` — 4 summary cards (upcoming, pending, monthly, popular)
- `src/components/dashboard/upcoming-list.tsx` — Next 5 bookings with join button
- `src/components/dashboard/charts.tsx` — 3 Recharts visualizations (line, bar, donut)
- `src/app/api/dashboard/route.ts` — Dashboard data aggregation endpoint
- Responsive layout: cards in 2x2 grid on mobile, 4-col on desktop

**Target files:** `src/app/(dashboard)/page.tsx`, `src/components/dashboard/stat-cards.tsx`, `src/components/dashboard/upcoming-list.tsx`, `src/components/dashboard/charts.tsx`, `src/app/api/dashboard/route.ts`

---

### Story 8: E2E Tests — Dashboard Flows
**Persona:** `qa_engineer`

End-to-end tests:
- `e2e/dashboard.spec.ts` — 15+ tests:
  - Login and verify dashboard renders with stat cards and charts
  - Navigate to event types, verify list displays
  - Create new event type via dialog, verify it appears
  - Open event type editor, modify fields, verify save
  - Toggle event type active/inactive
  - Delete event type with confirmation
  - Navigate to bookings, verify tabs work (upcoming/past/cancelled)
  - Accept a pending booking, verify status changes
  - Cancel an accepted booking with reason
  - Navigate to availability, modify schedule, save
  - Add date override, verify it appears
  - Update profile settings, verify persistence
  - Verify responsive layout on mobile viewport

**Target files:** `e2e/dashboard.spec.ts`, `e2e/helpers/dashboard-helpers.ts`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 8 |
| **Personas** | `frontend_developer`, `qa_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | CM-5 (Calendar Integration & Email) |
