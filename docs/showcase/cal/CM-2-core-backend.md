# CM-2: Core Backend — Event Types, Schedules & Slots

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Build the complete backend API for CalMill — auth middleware, event type CRUD, schedule/availability management, the **slot calculation engine** (the algorithmic core of the product), booking creation/cancellation, and comprehensive unit tests. This epic transforms the CM-1 skeleton into a fully functional scheduling backend.

**Deliverables:**

1. Auth middleware with session validation and ownership checks
2. Event type CRUD (create, read, update, delete, toggle active)
3. Schedule and availability CRUD with date overrides
4. **Slot calculation engine** — timezone-aware available time slot computation
5. Booking creation, confirmation, cancellation, and rescheduling
6. Expanded seed data (6 event types, 15 bookings, 2 schedules)
7. Comprehensive unit test suite (50+ tests)

---

## Technical Specification

### Auth Middleware

**`src/lib/api-auth.ts`:**

```typescript
// Helper to get authenticated user in API routes
export async function getAuthenticatedUser(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user: session.user };
}

// Helper to verify resource ownership
export async function verifyOwnership(userId: string, resourceUserId: string) {
  if (userId !== resourceUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
```

All mutating routes MUST validate:
1. User is authenticated (valid session)
2. User owns the resource being modified (event type, schedule, booking)
3. Input passes Zod validation before database operations

### Event Type Routes

**`src/app/api/event-types/route.ts`:**
- `GET /api/event-types` — List authenticated user's event types. Include booking counts. Ordered by `createdAt` DESC.
- `POST /api/event-types` — Create event type. Validate with `eventTypeCreateSchema`. Auto-generate slug from title (lowercase, hyphenated, deduped with `-2`, `-3` suffix). Assign user's default schedule if `scheduleId` not provided.

**`src/app/api/event-types/[id]/route.ts`:**
- `GET /api/event-types/[id]` — Get single event type with schedule, bookings count, and custom questions.
- `PUT /api/event-types/[id]` — Update event type. Validate with `eventTypeUpdateSchema`. Verify ownership.
- `DELETE /api/event-types/[id]` — Delete event type. Verify ownership. Cascade-delete bookings with status CANCELLED.

**`src/app/api/event-types/[id]/toggle/route.ts`:**
- `PATCH /api/event-types/[id]/toggle` — Toggle `isActive` boolean. Verify ownership.

### Zod Schemas for Event Types

```typescript
export const eventTypeCreateSchema = z.object({
  title: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).optional(), // auto-generated if omitted
  description: z.string().max(500).optional(),
  duration: z.number().int().min(5).max(720), // 5 min to 12 hours
  locations: z.array(z.object({
    type: z.enum(["inPerson", "link", "phone"]),
    value: z.string(),
  })).optional(),
  requiresConfirmation: z.boolean().optional(),
  price: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  minimumNotice: z.number().int().min(0).optional(),
  beforeBuffer: z.number().int().min(0).max(120).optional(),
  afterBuffer: z.number().int().min(0).max(120).optional(),
  slotInterval: z.number().int().min(5).max(120).optional(),
  maxBookingsPerDay: z.number().int().min(1).optional(),
  maxBookingsPerWeek: z.number().int().min(1).optional(),
  futureLimit: z.number().int().min(1).max(365).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  customQuestions: z.array(z.object({
    id: z.string(),
    label: z.string().min(1),
    type: z.enum(["text", "textarea", "select", "radio", "checkbox", "phone"]),
    required: z.boolean(),
    options: z.array(z.string()).optional(),
  })).optional(),
  scheduleId: z.string().cuid().optional(),
  recurringEnabled: z.boolean().optional(),
  recurringMaxOccurrences: z.number().int().min(1).max(52).optional(),
  recurringFrequency: z.enum(["weekly", "biweekly", "monthly"]).optional(),
});
```

### Schedule & Availability Routes

**`src/app/api/schedules/route.ts`:**
- `GET /api/schedules` — List user's schedules with availability and date overrides.
- `POST /api/schedules` — Create schedule with availability windows. If `isDefault: true`, unset any existing default schedule. Validate timezone string against Intl.supportedValuesOf('timeZone').

**`src/app/api/schedules/[id]/route.ts`:**
- `GET /api/schedules/[id]` — Single schedule with all availability rows and date overrides.
- `PUT /api/schedules/[id]` — Update schedule. Supports full availability replacement: delete existing rows and recreate from payload. This is simpler than partial updates.
- `DELETE /api/schedules/[id]` — Delete schedule. Fail if any event types reference this schedule (return 409). Cannot delete if it's the only schedule.

**`src/app/api/schedules/[id]/overrides/route.ts`:**
- `GET /api/schedules/[id]/overrides` — List date overrides for a schedule, ordered by date ASC.
- `POST /api/schedules/[id]/overrides` — Create date override. Validate date is in the future. Prevent duplicate overrides for the same date.
- `DELETE /api/schedules/[id]/overrides/[overrideId]` — Delete a date override.

### Zod Schemas for Schedules

```typescript
export const scheduleCreateSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1), // validated against Intl.supportedValuesOf
  isDefault: z.boolean().optional(),
  availability: z.array(z.object({
    day: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/), // HH:mm
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  })).min(1),
});

export const dateOverrideSchema = z.object({
  date: z.string().date(), // YYYY-MM-DD
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  isUnavailable: z.boolean().optional(),
});
```

### Slot Calculation Engine (CRITICAL — the core algorithm)

**`src/lib/slots.ts`:**

This is the most complex piece of the entire CalMill application. The slot calculator must be timezone-aware, respect buffers, check booking conflicts, and enforce booking limits.

**Function signature:**
```typescript
export async function getAvailableSlots(params: {
  eventTypeId: string;
  startDate: string;     // YYYY-MM-DD in attendee's timezone
  endDate: string;       // YYYY-MM-DD in attendee's timezone
  timezone: string;      // Attendee's IANA timezone (e.g., "Europe/London")
}): Promise<AvailableSlot[]>

type AvailableSlot = {
  time: string;          // ISO 8601 datetime in UTC
  localTime: string;     // HH:mm in attendee's timezone
  duration: number;      // minutes
};
```

**Algorithm (step by step):**

1. **Load event type** with its associated schedule, availability rows, and date overrides.

2. **Load existing bookings** for the date range (status NOT CANCELLED/REJECTED). Include buffer times in the conflict window:
   ```
   conflictStart = booking.startTime - eventType.beforeBuffer
   conflictEnd = booking.endTime + eventType.afterBuffer
   ```

3. **For each day in the requested range:**

   a. **Determine availability windows for this day:**
      - Check date overrides first (they take priority):
        - If `isUnavailable === true` → skip this day entirely
        - If override has `startTime/endTime` → use those instead of regular availability
      - If no override, look up `Availability` rows where `day` matches the day-of-week
      - Convert availability times from schedule timezone to UTC using `@date-fns/tz`

   b. **Generate candidate slots within each availability window:**
      - Slot interval = `eventType.slotInterval ?? eventType.duration`
      - Start from window start time, increment by slot interval
      - Each slot spans: `[slotStart, slotStart + duration]`
      - Stop when `slotStart + duration > window end time`

   c. **Filter out invalid slots:**
      - **Minimum notice:** Remove slots where `slotStart < now + minimumNotice`
      - **Future limit:** Remove slots where `slotStart > now + futureLimit days`
      - **Booking conflicts:** Remove slots where `[slotStart - beforeBuffer, slotStart + duration + afterBuffer]` overlaps with any existing booking's conflict window
      - **Daily booking limit:** If `maxBookingsPerDay` is set, count existing bookings for this day and skip if at limit
      - **Weekly booking limit:** If `maxBookingsPerWeek` is set, count existing bookings for this week (Mon-Sun) and skip if at limit

   d. **Convert remaining slots to attendee's timezone** for the response.

4. **Return sorted array** of available slots grouped by date.

**Timezone handling rules:**
- Schedule availability times are stored in the **schedule's timezone** (e.g., "09:00" in "America/New_York")
- Bookings are stored in **UTC**
- Slot calculation converts everything to UTC for comparison, then converts results to the **attendee's timezone**
- Use `@date-fns/tz` functions: `TZDate`, `toZonedTime`, `fromZonedTime`
- NEVER use `new Date()` directly for timezone conversions

**Public endpoint:**

**`src/app/api/slots/route.ts`:**
- `GET /api/slots?eventTypeId=xxx&startDate=2026-02-20&endDate=2026-02-27&timezone=Europe/London`
- No authentication required (public endpoint for booking pages)
- Validate query params with Zod
- Call `getAvailableSlots()` and return results
- Cache response for 60 seconds (stale-while-revalidate)

### Booking Routes

**`src/app/api/bookings/route.ts`:**
- `GET /api/bookings` — List authenticated user's bookings. Query params: `status` (filter), `startDate`/`endDate` (range), `page`/`limit` (pagination). Include event type title and attendee info. Ordered by `startTime` ASC for upcoming, DESC for past.
- `POST /api/bookings` — Create booking (public endpoint, no auth required). Validate with `bookingCreateSchema`. Steps:
  1. Validate the requested slot is still available (call `getAvailableSlots` and check)
  2. Create booking with status `PENDING` (or `ACCEPTED` if event type does not require confirmation)
  3. Return booking with UID for confirmation page

**`src/app/api/bookings/[uid]/route.ts`:**
- `GET /api/bookings/[uid]` — Get booking by UID. Public endpoint (attendees access via emailed link). Return event type details, host info (name, avatar), meeting details.
- `PATCH /api/bookings/[uid]` — Update booking status. Actions:
  - `accept` — Set status to ACCEPTED (host only, requires auth)
  - `reject` — Set status to REJECTED with reason (host only)
  - `cancel` — Set status to CANCELLED with reason (host or attendee via UID)
- `PUT /api/bookings/[uid]/reschedule` — Reschedule booking. Validate new time slot is available. Create new booking, mark old one as RESCHEDULED. Link via `recurringEventId` field.

### Zod Schemas for Bookings

```typescript
export const bookingCreateSchema = z.object({
  eventTypeId: z.string().cuid(),
  startTime: z.string().datetime(), // ISO 8601 UTC
  attendeeName: z.string().min(1).max(100),
  attendeeEmail: z.string().email(),
  attendeeTimezone: z.string(),
  attendeeNotes: z.string().max(1000).optional(),
  location: z.string().optional(),
  responses: z.record(z.string(), z.any()).optional(), // custom question responses
  recurringCount: z.number().int().min(1).max(52).optional(), // for recurring bookings
});

export const bookingActionSchema = z.object({
  action: z.enum(["accept", "reject", "cancel"]),
  reason: z.string().max(500).optional(),
});

export const bookingRescheduleSchema = z.object({
  startTime: z.string().datetime(),
  reason: z.string().max(500).optional(),
});
```

### Seed Data Expansion

Expand the CM-1 seed to include:
- **6 event types** for demo user:
  1. "Quick Chat" — 15min, no confirmation, free
  2. "30 Minute Meeting" — 30min, no confirmation, free (existing)
  3. "60 Minute Consultation" — 60min, requires confirmation, free (existing)
  4. "Technical Interview" — 45min, requires confirmation, $0, 24h minimum notice
  5. "Pair Programming" — 90min, link location (Google Meet stub), 2h buffer after
  6. "Coffee Chat" — 20min, in-person location "123 Main St", free, inactive
- **2 schedules:**
  1. "Business Hours" — Mon-Fri 09:00-17:00, America/New_York (default)
  2. "Extended Hours" — Mon-Fri 08:00-20:00, Sat 10:00-14:00
- **15 bookings** spread across the next 30 days with mixed statuses (8 ACCEPTED, 3 PENDING, 2 CANCELLED, 2 past/completed)
- **2 date overrides** — one blocking a specific date, one with modified hours

---

## Worker Stories

### Story 1: Auth Middleware and Shared Helpers
**Persona:** `backend_developer`

Create authentication and authorization helpers:
- `src/lib/api-auth.ts` — `getAuthenticatedUser()`, `verifyOwnership()`, `withAuth()` HOF wrapper
- Additional Zod schemas in `src/lib/validations.ts` — all schemas defined in this spec
- Extended types in `src/types/index.ts` — `AvailableSlot`, `BookingWithDetails`, `EventTypeWithSchedule`

**Target files:** `src/lib/api-auth.ts`, `src/lib/validations.ts` (extend), `src/types/index.ts` (extend)

---

### Story 2: Event Type CRUD Routes
**Persona:** `backend_developer`

Full event type management:
- `src/app/api/event-types/route.ts` — GET (list) and POST (create)
- `src/app/api/event-types/[id]/route.ts` — GET, PUT, DELETE
- `src/app/api/event-types/[id]/toggle/route.ts` — PATCH toggle isActive
- Auto-slug generation with deduplication
- Ownership verification on all mutations
- Include booking counts in list response

**Target files:** `src/app/api/event-types/route.ts`, `src/app/api/event-types/[id]/route.ts`, `src/app/api/event-types/[id]/toggle/route.ts`

---

### Story 3: Schedule & Availability Routes
**Persona:** `backend_developer`

Schedule management with full availability replacement:
- `src/app/api/schedules/route.ts` — GET (list) and POST (create)
- `src/app/api/schedules/[id]/route.ts` — GET, PUT (full replacement), DELETE (with reference check)
- `src/app/api/schedules/[id]/overrides/route.ts` — GET, POST for date overrides
- `src/app/api/schedules/[id]/overrides/[overrideId]/route.ts` — DELETE
- Timezone validation against `Intl.supportedValuesOf('timeZone')`
- Default schedule management (only one can be default)

**Target files:** `src/app/api/schedules/route.ts`, `src/app/api/schedules/[id]/route.ts`, `src/app/api/schedules/[id]/overrides/route.ts`, `src/app/api/schedules/[id]/overrides/[overrideId]/route.ts`

---

### Story 4: Slot Calculation Engine
**Persona:** `backend_developer`

The core scheduling algorithm:
- `src/lib/slots.ts` — `getAvailableSlots()` function implementing the full algorithm specified above
- Must handle: timezone conversions, buffer times, booking conflicts, date overrides, daily/weekly limits, minimum notice, future limit
- Use `@date-fns/tz` for all timezone operations. Import `TZDate` for timezone-aware date construction.
- `src/app/api/slots/route.ts` — Public GET endpoint with query param validation
- Include helper functions: `generateSlotsForWindow()`, `isSlotConflicting()`, `countBookingsForDay()`, `countBookingsForWeek()`

**Target files:** `src/lib/slots.ts`, `src/app/api/slots/route.ts`

---

### Story 5: Booking Routes
**Persona:** `backend_developer`

Booking lifecycle management:
- `src/app/api/bookings/route.ts` — GET (authenticated list with filters) and POST (public creation)
- `src/app/api/bookings/[uid]/route.ts` — GET (public by UID), PATCH (status actions), PUT reschedule
- Slot availability re-verification on booking creation (prevent race conditions)
- Status transition validation (PENDING → ACCEPTED/REJECTED, ACCEPTED → CANCELLED, etc.)
- Attendee access via UID (no auth required for their own booking)

**Target files:** `src/app/api/bookings/route.ts`, `src/app/api/bookings/[uid]/route.ts`

---

### Story 6: Public Profile Route
**Persona:** `backend_developer`

Public API for booking pages:
- `src/app/api/users/[username]/route.ts` — GET public user profile (name, username, avatarUrl, bio). No email, no private data.
- `src/app/api/users/[username]/event-types/route.ts` — GET active event types for a user. Only return: title, slug, description, duration, locations, price, currency. No internal IDs or scheduling config.

**Target files:** `src/app/api/users/[username]/route.ts`, `src/app/api/users/[username]/event-types/route.ts`

---

### Story 7: Seed Data Expansion
**Persona:** `backend_developer`

Expand `prisma/seed.ts` with comprehensive demo data as specified above. All seed operations must be idempotent (upsert). Bookings should have realistic times spread across the next 30 days. Include variety in statuses, durations, and attendee info.

**Target files:** `prisma/seed.ts`

---

### Story 8: Unit Test Suite
**Persona:** `qa_engineer`

Comprehensive test coverage:
- `tests/unit/event-types.test.ts` — 12+ tests: CRUD operations, slug generation, ownership, toggle
- `tests/unit/schedules.test.ts` — 10+ tests: CRUD, timezone validation, default schedule, override management
- `tests/unit/slots.test.ts` — 15+ tests: basic slot generation, buffer times, booking conflicts, date overrides, timezone conversions, daily/weekly limits, minimum notice, future limit, edge cases (midnight crossing, DST transitions)
- `tests/unit/bookings.test.ts` — 12+ tests: creation, status transitions, cancellation, reschedule, slot re-verification

Slot calculation tests are the most important — cover edge cases thoroughly.

**Target files:** `tests/unit/event-types.test.ts`, `tests/unit/schedules.test.ts`, `tests/unit/slots.test.ts`, `tests/unit/bookings.test.ts`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 8 |
| **Personas** | `backend_developer`, `qa_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | CM-3 (Public Booking Experience) |
