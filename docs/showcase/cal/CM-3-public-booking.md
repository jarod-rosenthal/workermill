# CM-3: Public Booking Experience

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Build the public-facing booking experience — the most important user-facing feature of CalMill. This includes the user profile page, event type selection, an interactive calendar date picker, timezone-aware slot grid, booking form with custom questions, confirmation page, and cancel/reschedule flows. All pages are public (no authentication required).

**Deliverables:**

1. Public user profile page showing active event types
2. Event type booking page with interactive calendar
3. Timezone selector with auto-detection
4. Available slots grid with loading states
5. Booking form with custom question support
6. Booking confirmation page with calendar add links
7. Booking cancellation and reschedule pages
8. E2E tests for the complete booking flow

---

## Technical Specification

### URL Structure

```
/demo                    → User profile (list of event types)
/demo/30min              → Booking page for "30 Minute Meeting"
/demo/30min?date=2026-02-20&month=2026-02  → With pre-selected date
/booking/[uid]           → Booking confirmation/details
/booking/[uid]/cancel    → Cancellation form
/booking/[uid]/reschedule → Reschedule flow
```

### Public User Profile Page

**`src/app/(public)/[username]/page.tsx`** — Server component.

**Data fetching:** Call `GET /api/users/[username]` and `GET /api/users/[username]/event-types` on the server using `fetch` with `{ cache: "no-store" }` (availability changes frequently).

**Layout:**
- User avatar (or initials fallback), name, bio at the top
- Grid of event type cards below (2 columns on desktop, 1 on mobile)
- Each card shows:
  - Color dot (from event type color) + title
  - Duration badge ("30 min", "1 hr")
  - Description (truncated to 2 lines)
  - Location icon (video, in-person, phone)
  - Price if non-zero ("$50")
  - Arrow icon linking to `/[username]/[slug]`

**Empty state:** If user has no active event types, show "No available event types" message.

**404 handling:** If username doesn't exist, render Next.js `notFound()`.

### Booking Page

**`src/app/(public)/[username]/[slug]/page.tsx`** — Server component wrapper.
**`src/components/booking/booking-page-client.tsx`** — Client component with all interactive state.

This is the most complex UI in CalMill. It has 3 states:

#### State 1: Date & Time Selection

**Left panel (calendar):**
- Month/year header with prev/next navigation arrows
- Day-of-week headers (respecting user's `weekStart` preference)
- Calendar grid showing days of the month
- Days with available slots are clickable (normal weight)
- Days with no available slots are grayed out and not clickable
- Past days are grayed out
- Selected date has primary-color background
- Today has a dot indicator

**Right panel (time slots):**
- Timezone selector at the top (dropdown with search, auto-detected from browser `Intl.DateTimeFormat().resolvedOptions().timeZone`)
- Date header showing selected date in attendee's timezone ("Thursday, February 20")
- Available slots as clickable buttons arranged in a vertical list
- Each slot shows time in attendee's timezone ("10:00 AM", "10:30 AM", etc.)
- Clicking a slot highlights it and shows a "Confirm" button
- Loading skeleton while slots are being fetched
- Empty state: "No available times on this date"

**Data flow:**
1. On mount, detect timezone from browser
2. Fetch slots for the current month: `GET /api/slots?eventTypeId=xxx&startDate=YYYY-MM-01&endDate=YYYY-MM-31&timezone=yyy`
3. Mark calendar days with availability
4. On date click, show slots for that date (already fetched)
5. On month change, fetch new month's slots
6. On timezone change, re-fetch all slots

**Event type header (above panels):**
- Back arrow to profile page
- Event type title, duration, location
- Color bar at top matching event type color

#### State 2: Booking Form

After selecting a time slot and clicking "Confirm":

- Slide/animate from calendar view to form view
- **Selected time summary** at top: "Thursday, February 20, 2026 at 10:00 AM (EST)" with edit link back to calendar
- **Required fields:**
  - Name (text input)
  - Email (email input)
- **Optional standard field:**
  - Notes / additional info (textarea)
- **Custom questions** (rendered dynamically from event type's `customQuestions` array):
  - `text` → text input
  - `textarea` → textarea
  - `select` → dropdown select
  - `radio` → radio button group
  - `checkbox` → checkbox
  - `phone` → phone input with country code
  - Respect `required` flag
- **"Schedule Meeting" button** at the bottom
- Loading state during submission
- Error state with retry option

**Form submission:** POST to `/api/bookings` with all data. On success, redirect to `/booking/[uid]`.

#### State 3: Booking Confirmation

This is a separate page at `/booking/[uid]`.

### Booking Confirmation Page

**`src/app/(public)/booking/[uid]/page.tsx`:**

- Success icon (checkmark in green circle)
- "Your meeting has been scheduled!" heading
- Event type title and duration
- Date and time in attendee's timezone
- Host name and avatar
- Location / meeting link
- **"Add to Calendar" buttons:**
  - Google Calendar (link: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&details=...`)
  - Outlook (.ics file download)
  - Apple Calendar (.ics file download)
- Attendee info (name, email)
- Custom question responses (if any)
- **Actions:** "Reschedule" link, "Cancel" link
- Booking UID displayed for reference

**ICS file generation:** Create a utility `src/lib/ics.ts` that generates valid iCalendar (.ics) format:
```
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
DTSTART:20260220T150000Z
DTEND:20260220T153000Z
SUMMARY:30 Minute Meeting with Alex Demo
DESCRIPTION:...
LOCATION:...
END:VEVENT
END:VCALENDAR
```

### Cancel Page

**`src/app/(public)/booking/[uid]/cancel/page.tsx`:**

- Booking details summary (date, time, event type, host)
- "Are you sure you want to cancel?" warning
- Reason textarea (optional)
- "Cancel Meeting" button (red/danger style)
- "Go Back" link
- On cancel: PATCH `/api/bookings/[uid]` with `{ action: "cancel", reason }`
- Success state: "Meeting cancelled" with option to rebook

### Reschedule Page

**`src/app/(public)/booking/[uid]/reschedule/page.tsx`:**

- Shows the same calendar + slot picker as the booking page
- Pre-selected with the original event type and settings
- Header shows "Reschedule your meeting" with original time crossed out
- Reason textarea (optional)
- On submit: PUT `/api/bookings/[uid]/reschedule` with new time
- Success: redirect to new booking confirmation page

### Shared Components

**`src/components/booking/calendar-picker.tsx`:**
- Month grid component with day cells
- Props: `availableDates: Set<string>`, `selectedDate: string | null`, `onSelect: (date: string) => void`, `weekStart: number`
- Previous/next month navigation
- Responsive: full-size on desktop, compact on mobile

**`src/components/booking/slot-list.tsx`:**
- Vertical list of time slot buttons
- Props: `slots: AvailableSlot[]`, `selectedSlot: AvailableSlot | null`, `onSelect: (slot: AvailableSlot) => void`, `timezone: string`
- Loading skeleton (6 placeholder rectangles)
- Empty state message

**`src/components/booking/timezone-select.tsx`:**
- Searchable dropdown of all IANA timezones
- Grouped by region (America, Europe, Asia, etc.)
- Auto-detected default from browser
- Shows UTC offset next to each timezone: "America/New_York (UTC-5)"
- Props: `value: string`, `onChange: (tz: string) => void`

**`src/components/booking/booking-form.tsx`:**
- Dynamic form rendering based on event type custom questions
- Zod validation for all fields
- Loading/error states
- Props: `eventType: EventType`, `selectedSlot: AvailableSlot`, `timezone: string`, `onSubmit: (data) => void`

---

## Worker Stories

### Story 1: Public User Profile Page
**Persona:** `frontend_developer`

Build the public profile page at `/(public)/[username]/page.tsx`:
- Server component fetching user profile and event types
- Event type card grid (responsive 2-col/1-col)
- Avatar with initials fallback, bio display
- 404 handling for unknown usernames
- Event type cards with color dot, duration badge, location icon, price, description

**Target files:** `src/app/(public)/[username]/page.tsx`, `src/components/booking/event-type-card.tsx`

---

### Story 2: Calendar Date Picker Component
**Persona:** `frontend_developer`

Build the reusable calendar picker:
- `src/components/booking/calendar-picker.tsx` — Full month grid with day cells, prev/next navigation, available date highlighting, today indicator, selected date styling
- Must support configurable week start day (Sunday or Monday)
- Past dates grayed out and non-clickable
- Accessible: keyboard navigation (arrow keys), ARIA labels for each day

**Target files:** `src/components/booking/calendar-picker.tsx`

---

### Story 3: Timezone Select and Slot List Components
**Persona:** `frontend_developer`

Build the timezone and slot UI:
- `src/components/booking/timezone-select.tsx` — Searchable timezone dropdown with region grouping, UTC offset display, browser auto-detection
- `src/components/booking/slot-list.tsx` — Vertical time slot buttons with loading skeleton and empty state
- Use `Intl.supportedValuesOf('timeZone')` for timezone list
- Format times with `date-fns` format functions

**Target files:** `src/components/booking/timezone-select.tsx`, `src/components/booking/slot-list.tsx`

---

### Story 4: Booking Page — Calendar + Slot Selection
**Persona:** `frontend_developer`

Build the main booking page (State 1):
- `src/app/(public)/[username]/[slug]/page.tsx` — Server component loading event type data
- `src/components/booking/booking-page-client.tsx` — Client component managing all interactive state: month navigation, date selection, timezone changes, slot fetching (SWR or useEffect + fetch), slot selection
- Two-panel layout (calendar left, slots right) on desktop; stacked on mobile
- Event type header with color bar, title, duration, location
- Fetch slots on mount and on month/timezone change
- Loading, error, and empty states

**Target files:** `src/app/(public)/[username]/[slug]/page.tsx`, `src/components/booking/booking-page-client.tsx`

---

### Story 5: Booking Form Component
**Persona:** `frontend_developer`

Build the booking form (State 2):
- `src/components/booking/booking-form.tsx` — Dynamic form with name, email, notes, and custom questions rendered from event type config
- Custom question type renderers (text, textarea, select, radio, checkbox, phone)
- Zod validation with inline error messages
- Selected time summary header with "change" link
- "Schedule Meeting" submit button with loading state
- POST to `/api/bookings`, redirect to confirmation on success
- Error handling with user-friendly messages

**Target files:** `src/components/booking/booking-form.tsx`

---

### Story 6: Booking Confirmation Page
**Persona:** `frontend_developer`

Build the confirmation page:
- `src/app/(public)/booking/[uid]/page.tsx` — Server component fetching booking details
- Success state with green checkmark, event details, host info, meeting link
- "Add to Calendar" buttons (Google Calendar link, Outlook/Apple .ics download)
- `src/lib/ics.ts` — ICS file generation utility
- "Reschedule" and "Cancel" action links
- 404 handling for invalid UIDs

**Target files:** `src/app/(public)/booking/[uid]/page.tsx`, `src/lib/ics.ts`

---

### Story 7: Cancel and Reschedule Pages
**Persona:** `frontend_developer`

Build the cancel and reschedule flows:
- `src/app/(public)/booking/[uid]/cancel/page.tsx` — Confirmation dialog with reason textarea, cancel action, success state with rebook option
- `src/app/(public)/booking/[uid]/reschedule/page.tsx` — Re-uses booking page calendar/slot picker in reschedule mode, shows original time crossed out, reason field, submits to reschedule API
- Both pages load booking details server-side, handle 404 for invalid UIDs

**Target files:** `src/app/(public)/booking/[uid]/cancel/page.tsx`, `src/app/(public)/booking/[uid]/reschedule/page.tsx`

---

### Story 8: E2E Tests — Public Booking Flow
**Persona:** `qa_engineer`

End-to-end test coverage:
- `e2e/booking-flow.spec.ts` — 15+ tests:
  - Navigate to `/demo` profile page, verify event type cards displayed
  - Click event type, verify calendar renders with available dates
  - Select a date, verify slots appear
  - Change timezone, verify slots update
  - Navigate months, verify slot refetch
  - Select slot, fill form, submit booking
  - Verify confirmation page shows correct details
  - Test "Add to Calendar" button generates valid link
  - Navigate to cancel page, submit cancellation
  - Navigate to reschedule page, select new time, submit
  - Test 404 for invalid username and slug
  - Test empty state when no slots available
  - Mobile responsive layout verification

**Target files:** `e2e/booking-flow.spec.ts`, `e2e/helpers/booking-helpers.ts`

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
| **Blocks** | CM-4 (Dashboard & Management UI) |
