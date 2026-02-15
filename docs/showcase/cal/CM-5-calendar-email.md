# CM-5: Calendar Integration & Email Notifications

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Add Google Calendar integration (OAuth, busy time fetching, event creation) and transactional email notifications (booking confirmation, cancellation, reminders) using Resend and React Email. This epic connects CalMill to the real world — checking actual calendar availability and sending professional emails.

**Deliverables:**

1. Google Calendar OAuth connection flow
2. Busy time fetching integrated into slot calculation
3. Booking-to-calendar event creation (write events to connected calendar)
4. React Email templates for all booking lifecycle events
5. Email sending via Resend for confirmations, cancellations, and reminders
6. Calendar settings UI in dashboard
7. Integration tests for calendar and email flows

---

## Technical Specification

### Google Calendar OAuth Flow

**Setup required (env vars):**
```bash
GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxx"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/integrations/google/callback"
```

**Scopes requested:**
```
https://www.googleapis.com/auth/calendar.readonly    # Read busy times
https://www.googleapis.com/auth/calendar.events       # Create/update/delete events
```

**OAuth endpoints:**

**`src/app/api/integrations/google/connect/route.ts`:**
- `GET /api/integrations/google/connect` — Authenticated. Generates Google OAuth URL with state parameter (user ID encrypted), scopes, and redirect URI. Returns `{ url: "https://accounts.google.com/o/oauth2/v2/auth?..." }`.

**`src/app/api/integrations/google/callback/route.ts`:**
- `GET /api/integrations/google/callback?code=xxx&state=xxx` — Exchanges code for tokens. Creates `CalendarConnection` record with:
  - `provider: "google"`
  - `accessToken` (encrypted at rest)
  - `refreshToken`
  - `expiresAt` (from token response)
  - `email` (from Google userinfo endpoint)
  - `isPrimary: true` if first connection
- Redirects to `/settings/calendars` with `?connected=true` query param.

**`src/app/api/integrations/google/disconnect/route.ts`:**
- `DELETE /api/integrations/google/disconnect` — Authenticated. Revokes token with Google, deletes `CalendarConnection` record.

**Token refresh utility:**

**`src/lib/google-calendar.ts`:**
```typescript
export class GoogleCalendarService {
  private connection: CalendarConnection;

  constructor(connection: CalendarConnection) {
    this.connection = connection;
  }

  // Refresh token if expired (within 5 min of expiry)
  async getValidAccessToken(): Promise<string> {
    if (this.connection.expiresAt && this.connection.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
      // POST to https://oauth2.googleapis.com/token with refresh_token
      // Update CalendarConnection with new accessToken and expiresAt
    }
    return this.connection.accessToken;
  }

  // Fetch busy times for a date range
  async getBusyTimes(startDate: Date, endDate: Date): Promise<BusyTime[]> {
    // POST to https://www.googleapis.com/calendar/v3/freeBusy
    // Body: { timeMin, timeMax, items: [{ id: "primary" }] }
    // Returns array of { start, end } busy periods
  }

  // Create calendar event for a booking
  async createEvent(booking: BookingWithDetails): Promise<string> {
    // POST to https://www.googleapis.com/calendar/v3/calendars/primary/events
    // Body: { summary, description, start, end, attendees, location }
    // Returns event ID (store as calendarEventId on Booking)
  }

  // Update calendar event (for reschedule)
  async updateEvent(eventId: string, booking: BookingWithDetails): Promise<void> {
    // PATCH to https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}
  }

  // Delete calendar event (for cancellation)
  async deleteEvent(eventId: string): Promise<void> {
    // DELETE to https://www.googleapis.com/calendar/v3/calendars/primary/events/{eventId}
  }
}

type BusyTime = {
  start: Date;
  end: Date;
};
```

### Busy Time Integration with Slot Calculation

**Modify `src/lib/slots.ts`** to include Google Calendar busy times:

In `getAvailableSlots()`, after loading existing bookings (step 2), add:

```
2b. If user has CalendarConnection(s):
    - For each connection, call getBusyTimes(startDate, endDate)
    - Merge busy times into the booking conflicts array
    - Treat busy times exactly like existing bookings for conflict detection
```

This means the slot calculation now checks:
- Internal CalMill bookings
- External Google Calendar events
- Buffer times around both

### Email Templates (React Email)

**Template directory:** `src/emails/`

All templates use `@react-email/components` for cross-client compatible HTML emails.

**Shared layout:** `src/emails/components/email-layout.tsx`
- CalMill logo header
- White card container on light gray background
- Footer with "Powered by CalMill" and unsubscribe link

#### Template 1: Booking Confirmation (to attendee)
**`src/emails/booking-confirmed.tsx`:**
- Subject: "Your meeting with {hostName} is confirmed"
- Body:
  - Green checkmark icon
  - "Your meeting has been scheduled"
  - Event type title and duration
  - Date and time in attendee's timezone
  - Host name
  - Location / meeting link
  - "Add to Calendar" button (Google Calendar link)
  - "Reschedule" and "Cancel" links (to public booking pages)

#### Template 2: Booking Notification (to host)
**`src/emails/booking-notification.tsx`:**
- Subject: "New booking: {attendeeName} - {eventTypeTitle}"
- Body:
  - "You have a new booking"
  - Event type title and duration
  - Date and time in host's timezone
  - Attendee name and email
  - Attendee notes (if any)
  - Custom question responses (if any)
  - "Accept" and "Reject" buttons (link to dashboard booking detail)

#### Template 3: Booking Accepted (to attendee)
**`src/emails/booking-accepted.tsx`:**
- Subject: "Meeting confirmed: {eventTypeTitle} with {hostName}"
- Body: similar to confirmation but with "confirmed by host" messaging

#### Template 4: Booking Cancelled (to both parties)
**`src/emails/booking-cancelled.tsx`:**
- Subject: "Meeting cancelled: {eventTypeTitle}"
- Body:
  - Red X icon
  - "Your meeting has been cancelled"
  - Original date and time
  - Cancellation reason (if provided)
  - "Rebook" button (link to public booking page)

#### Template 5: Booking Reminder (to both parties)
**`src/emails/booking-reminder.tsx`:**
- Subject: "Reminder: {eventTypeTitle} in {timeUntil}"
- Body:
  - Clock icon
  - "Your meeting is coming up"
  - Event details, time, location
  - "Join Meeting" button (if video link)
  - "Reschedule" and "Cancel" links

### Email Sending Service

**`src/lib/email.ts`:**
```typescript
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail<T>(params: {
  to: string;
  subject: string;
  template: React.ReactElement;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email] Skipping send to ${params.to}: No RESEND_API_KEY`);
    return; // Graceful degradation in dev
  }

  await resend.emails.send({
    from: process.env.EMAIL_FROM || "CalMill <noreply@calmill.workermill.com>",
    to: params.to,
    subject: params.subject,
    react: params.template,
  });
}
```

### Email Trigger Points

Integrate email sending into existing booking routes:

| Event | Recipients | Template | Trigger Location |
|-------|-----------|----------|-----------------|
| Booking created (no confirmation required) | Attendee + Host | booking-confirmed + booking-notification | POST `/api/bookings` |
| Booking created (confirmation required) | Host only | booking-notification | POST `/api/bookings` |
| Booking accepted | Attendee | booking-accepted | PATCH `/api/bookings/[uid]` (accept action) |
| Booking cancelled | Both parties | booking-cancelled | PATCH `/api/bookings/[uid]` (cancel action) |
| Booking rejected | Attendee | booking-cancelled (with "rejected" variant) | PATCH `/api/bookings/[uid]` (reject action) |

**Reminders** are handled separately — they would need a cron job or scheduled task. For the showcase, implement the email template but wire up sending as a TODO/stretch goal (document the cron approach in comments).

### Calendar Settings UI

**`src/app/(dashboard)/settings/calendars/page.tsx`:**
- Connected calendars list:
  - Google Calendar card with email, connected date, "Disconnect" button
  - Primary calendar indicator
- "Connect Google Calendar" button → calls `/api/integrations/google/connect`, opens OAuth popup
- Success message when `?connected=true` query param present
- Explanation text: "CalMill checks your connected calendars for conflicts when calculating available time slots."

### Calendar Event Management

When a booking is created/updated/cancelled, sync to Google Calendar:

**On booking creation (status ACCEPTED):**
- If host has CalendarConnection, create event via `GoogleCalendarService.createEvent()`
- Store returned event ID as `booking.calendarEventId`

**On booking cancellation:**
- If `booking.calendarEventId` exists, delete event via `GoogleCalendarService.deleteEvent()`

**On booking reschedule:**
- Delete old calendar event, create new one for the new booking

Wrap all calendar operations in try/catch — calendar sync failures should log errors but NOT fail the booking operation. Calendar sync is best-effort.

---

## Worker Stories

### Story 1: Google Calendar OAuth Routes
**Persona:** `backend_developer`

Build the OAuth connection flow:
- `src/app/api/integrations/google/connect/route.ts` — Generate OAuth URL
- `src/app/api/integrations/google/callback/route.ts` — Exchange code for tokens, create CalendarConnection
- `src/app/api/integrations/google/disconnect/route.ts` — Revoke token, delete connection
- `src/app/api/integrations/google/calendars/route.ts` — GET list of connected calendars

**Target files:** `src/app/api/integrations/google/connect/route.ts`, `callback/route.ts`, `disconnect/route.ts`, `calendars/route.ts`

---

### Story 2: Google Calendar Service
**Persona:** `backend_developer`

Build the Google Calendar client:
- `src/lib/google-calendar.ts` — `GoogleCalendarService` class with token refresh, busy time fetching, event CRUD
- Uses native `fetch` (no Google SDK dependency to keep bundle small)
- Token refresh handles expiry with 5-minute buffer
- Error handling with typed errors for quota limits, auth failures, network issues

**Target files:** `src/lib/google-calendar.ts`

---

### Story 3: Busy Time Integration in Slot Calculator
**Persona:** `backend_developer`

Modify slot calculation to include calendar conflicts:
- Update `src/lib/slots.ts` — After loading bookings, fetch busy times from all CalendarConnections
- Merge busy times into conflict array
- Handle calendar fetch failures gracefully (log warning, continue without external conflicts)
- Add `includeBusyTimes: boolean` parameter (default true) for testing

**Target files:** `src/lib/slots.ts` (modify)

---

### Story 4: Email Templates (React Email)
**Persona:** `frontend_developer`

Build all 5 email templates:
- `src/emails/components/email-layout.tsx` — Shared layout with logo, card, footer
- `src/emails/booking-confirmed.tsx` — Attendee confirmation
- `src/emails/booking-notification.tsx` — Host notification
- `src/emails/booking-accepted.tsx` — Attendee acceptance
- `src/emails/booking-cancelled.tsx` — Cancellation (both parties)
- `src/emails/booking-reminder.tsx` — Reminder (both parties)
- All templates accept typed props and render cross-client HTML

**Target files:** `src/emails/components/email-layout.tsx`, plus 5 template files

---

### Story 5: Email Sending Service and Integration
**Persona:** `backend_developer`

Wire up email sending:
- `src/lib/email.ts` — `sendEmail()` function using Resend with graceful degradation
- Modify `src/app/api/bookings/route.ts` — Send confirmation/notification emails on booking creation
- Modify `src/app/api/bookings/[uid]/route.ts` — Send accepted/cancelled/rejected emails on status change
- All email sends are fire-and-forget (don't await in the request path, or use `Promise.allSettled`)
- Log email send results for debugging

**Target files:** `src/lib/email.ts`, `src/app/api/bookings/route.ts` (modify), `src/app/api/bookings/[uid]/route.ts` (modify)

---

### Story 6: Calendar Settings UI and Event Sync
**Persona:** `frontend_developer`

Build the calendar management UI and booking-to-calendar sync:
- `src/app/(dashboard)/settings/calendars/page.tsx` — Connected calendars list, connect/disconnect buttons, OAuth popup flow
- Modify booking API routes to create/delete Google Calendar events on booking create/cancel
- Calendar sync is best-effort — wrap in try/catch, log errors, never fail the booking
- Add link to calendar settings from main settings page

**Target files:** `src/app/(dashboard)/settings/calendars/page.tsx`, modify booking routes for calendar sync

---

### Story 7: Integration Tests
**Persona:** `qa_engineer`

Test calendar and email flows:
- `tests/unit/google-calendar.test.ts` — 8+ tests: token refresh, busy time parsing, event creation, error handling, token expiry
- `tests/unit/slots-with-calendar.test.ts` — 5+ tests: slot calculation with busy times, graceful fallback on calendar error
- `tests/unit/email.test.ts` — 5+ tests: email sending (mock Resend), graceful skip without API key, correct template selection per booking action
- Mock Google Calendar API responses and Resend API

**Target files:** `tests/unit/google-calendar.test.ts`, `tests/unit/slots-with-calendar.test.ts`, `tests/unit/email.test.ts`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 7 |
| **Personas** | `backend_developer`, `frontend_developer`, `qa_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | CM-6 (Team Scheduling) |
