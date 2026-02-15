# CM-6: Team Scheduling

> **CalMill Showcase** | Built autonomously by [WorkerMill](https://workermill.com)
> Target repo: [`workermill-examples/calmill`](https://github.com/workermill-examples/calmill)
> Live: [calmill.workermill.com](https://calmill.workermill.com)

---

## Epic Overview

Add team scheduling capabilities — team creation and management, round-robin event types (distribute bookings across team members cyclically), collective event types (require all team members to be available), team booking pages, and team availability calculation. This is Cal.com's most popular team feature and demonstrates complex scheduling logic.

**Deliverables:**

1. Team CRUD routes with slug, logo, bio
2. Team member invitation, acceptance, and role management
3. Round-robin event type scheduling logic
4. Collective event type scheduling logic
5. Team public booking page
6. Team management dashboard UI
7. Team availability calculation (intersection and union)
8. Unit tests for team scheduling algorithms

---

## Technical Specification

### Team CRUD Routes

**`src/app/api/teams/route.ts`:**
- `GET /api/teams` — List teams the authenticated user belongs to. Include member count and user's role.
- `POST /api/teams` — Create team. Creator becomes OWNER. Auto-generate slug from name (same dedup logic as event type slugs). Create a team record and a TeamMember record for the creator.

**`src/app/api/teams/[slug]/route.ts`:**
- `GET /api/teams/[slug]` — Team details with members (names, roles, avatars) and event types. Requires membership.
- `PUT /api/teams/[slug]` — Update team name, slug, logo, bio. Requires ADMIN or OWNER role.
- `DELETE /api/teams/[slug]` — Delete team. OWNER only. Cascade-delete TeamMembers and team EventTypes.

### Team Member Management Routes

**`src/app/api/teams/[slug]/members/route.ts`:**
- `GET /api/teams/[slug]/members` — List team members with user details (name, email, avatar, timezone), role, and accepted status. Requires membership.
- `POST /api/teams/[slug]/members` — Invite member by email. ADMIN+ required. Creates TeamMember with `accepted: false`. If user doesn't exist, return 404 (no auto-registration for simplicity). Send notification (or log it).

**`src/app/api/teams/[slug]/members/[memberId]/route.ts`:**
- `PUT /api/teams/[slug]/members/[memberId]` — Update member role. OWNER only. Cannot change own role. Cannot have zero OWNERs (protect last OWNER).
- `DELETE /api/teams/[slug]/members/[memberId]` — Remove member. ADMIN+ to remove others, anyone can self-remove. Cannot remove last OWNER. Reassign any team event types that had this member as sole host.

**`src/app/api/teams/invitations/route.ts`:**
- `GET /api/teams/invitations` — List pending invitations for the authenticated user.
- `POST /api/teams/invitations/[memberId]/accept` — Accept invitation. Set `accepted: true`.
- `POST /api/teams/invitations/[memberId]/reject` — Reject invitation. Delete TeamMember record.

### Team Event Type Routes

**`src/app/api/teams/[slug]/event-types/route.ts`:**
- `GET /api/teams/[slug]/event-types` — List team event types.
- `POST /api/teams/[slug]/event-types` — Create team event type. ADMIN+ required. Must specify `schedulingType`: `ROUND_ROBIN` or `COLLECTIVE`. Assign `teamId` on the EventType.

Team event types use the same EventType model but with:
- `teamId` set (non-null)
- `schedulingType` set (ROUND_ROBIN or COLLECTIVE)
- `userId` set to the creating user (administrative owner)

### Round-Robin Scheduling Algorithm

**Purpose:** Distribute bookings evenly across team members. When someone books, the system picks the team member with the fewest recent bookings who is available at the requested time.

**Algorithm in `src/lib/team-slots.ts`:**

```typescript
export async function getRoundRobinSlots(params: {
  eventTypeId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}): Promise<AvailableSlot[]>
```

**Steps:**

1. **Load team event type** with team and accepted members.

2. **For each member**, compute their available slots using the existing `getAvailableSlots()` function (which already handles schedules, bookings, calendar conflicts, buffers).

3. **Union all member slots** — a time slot is available if ANY team member is free at that time.

4. **For each available slot, determine the assigned host:**
   a. Find all members who are free at this slot time.
   b. Among those, pick the member with the **fewest bookings in the last 30 days** for this event type.
   c. If tied, pick the member who was assigned least recently (by last booking date).
   d. Store the assignment: `{ time, assignedUserId, assignedUserName }`.

5. **Return slots** with assignment info (the attendee doesn't see who they'll meet — assignment happens at booking time, not display time).

**On booking creation for round-robin:**
- Re-evaluate the assignment at booking time (not at slot display time) to handle races
- The booking's `userId` is set to the assigned team member
- Send notification email to the assigned member, not all members

### Collective Scheduling Algorithm

**Purpose:** Find times when ALL team members are available simultaneously. Used for group meetings where every team member must attend.

**Algorithm in `src/lib/team-slots.ts`:**

```typescript
export async function getCollectiveSlots(params: {
  eventTypeId: string;
  startDate: string;
  endDate: string;
  timezone: string;
}): Promise<AvailableSlot[]>
```

**Steps:**

1. **Load team event type** with team and accepted members.

2. **For each member**, compute their available slots using `getAvailableSlots()`.

3. **Intersect all member slots** — a time slot is available ONLY if ALL team members are free at that time.

4. **Return intersected slots.** No assignment needed — all members attend.

**On booking creation for collective:**
- The booking's `userId` is set to the event type creator (administrative owner)
- Send notification email to ALL team members
- Create calendar events for ALL team members who have CalendarConnections

### Public Team Slots Endpoint

**Modify `src/app/api/slots/route.ts`:**

Add logic to detect if the event type has `schedulingType` set:
- If `null` (personal): use existing `getAvailableSlots()`
- If `ROUND_ROBIN`: use `getRoundRobinSlots()`
- If `COLLECTIVE`: use `getCollectiveSlots()`

The public booking page does NOT need to change — it still calls the same `/api/slots` endpoint. The backend handles the routing internally.

### Team Public Booking Page

**`src/app/(public)/team/[slug]/page.tsx`:**
- Team profile page showing team name, logo, bio, members (avatars in a row)
- Grid of team event types (same card format as personal event types)
- Each card links to `/team/[slug]/[event-slug]`

**`src/app/(public)/team/[slug]/[eventSlug]/page.tsx`:**
- Reuses the booking page client component from CM-3
- Only difference: the "host" section shows team info instead of individual user
- For round-robin, after booking: show "You'll be meeting with [assigned member name]"
- For collective, show "You'll be meeting with the [team name] team" and list all members

### Team Public API Routes

**`src/app/api/teams/[slug]/public/route.ts`:**
- `GET /api/teams/[slug]/public` — Public team info: name, slug, logoUrl, bio, member names and avatars (no emails). No auth required.

**`src/app/api/teams/[slug]/public/event-types/route.ts`:**
- `GET /api/teams/[slug]/public/event-types` — Active team event types. Same fields as personal public event types plus `schedulingType`.

### Team Dashboard UI

**`src/app/(dashboard)/teams/page.tsx`:**
- List of teams the user belongs to
- "Create Team" button → create dialog (name, slug)
- Each team card shows: name, slug, logo, member count, event type count, user's role badge

**`src/app/(dashboard)/teams/[slug]/page.tsx`:**
- Team detail/settings page with tabs:

**Tab 1: Members**
- Member list with name, email, role badge, avatar, accepted status
- "Invite Member" button → email input dialog
- Role change dropdown (OWNER only)
- Remove member button with confirmation
- Pending invitations shown with "Resend" / "Cancel" options

**Tab 2: Event Types**
- Same card layout as personal event types but filtered to this team
- "New Team Event Type" button → create dialog with scheduling type selector
- Each card shows scheduling type badge (Round Robin / Collective)

**Tab 3: Settings**
- Team name, slug, logo URL, bio
- "Delete Team" button (OWNER only, type-to-confirm)

### Seed Data for Teams

Add to `prisma/seed.ts`:
- **Team:** "CalMill Demo Team" (slug: `calmill-demo-team`)
- **Members:** Demo user as OWNER + 2 additional seeded users (Alice, Bob) as MEMBER (accepted)
- **Team event types:**
  1. "Team Standup" — 15min, ROUND_ROBIN, no confirmation
  2. "Group Demo" — 30min, COLLECTIVE, requires confirmation

---

## Worker Stories

### Story 1: Team CRUD Routes
**Persona:** `backend_developer`

Build team management:
- `src/app/api/teams/route.ts` — GET (list) and POST (create with auto-slug)
- `src/app/api/teams/[slug]/route.ts` — GET, PUT, DELETE with role checks
- Slug generation with deduplication
- OWNER/ADMIN role enforcement on mutations
- Cascade delete handling

**Target files:** `src/app/api/teams/route.ts`, `src/app/api/teams/[slug]/route.ts`

---

### Story 2: Team Member Management Routes
**Persona:** `backend_developer`

Build member invitation and management:
- `src/app/api/teams/[slug]/members/route.ts` — GET (list) and POST (invite by email)
- `src/app/api/teams/[slug]/members/[memberId]/route.ts` — PUT (role change) and DELETE (remove)
- `src/app/api/teams/invitations/route.ts` — GET pending invitations
- `src/app/api/teams/invitations/[memberId]/accept/route.ts` — POST accept
- `src/app/api/teams/invitations/[memberId]/reject/route.ts` — POST reject
- Last-OWNER protection, self-removal support

**Target files:** 5 route files under `src/app/api/teams/`

---

### Story 3: Round-Robin Scheduling Algorithm
**Persona:** `backend_developer`

Implement round-robin slot calculation:
- `src/lib/team-slots.ts` — `getRoundRobinSlots()` function
- Union of all member availability
- Assignment based on fewest recent bookings (30-day window), then least-recently-assigned tiebreaker
- Integration with existing `getAvailableSlots()` for per-member calculation
- Modify booking creation to re-evaluate assignment at booking time
- Helper: `getBookingCountByMember(eventTypeId, memberIds, days)` for load balancing

**Target files:** `src/lib/team-slots.ts`, modify `src/app/api/bookings/route.ts`

---

### Story 4: Collective Scheduling Algorithm
**Persona:** `backend_developer`

Implement collective slot calculation:
- Add `getCollectiveSlots()` to `src/lib/team-slots.ts`
- Intersection of all member availability
- Modify booking creation for collective: set booking userId to event type creator, notify all members
- Calendar event creation for all members with CalendarConnections
- Update `/api/slots` route to detect scheduling type and dispatch to correct algorithm

**Target files:** `src/lib/team-slots.ts` (extend), modify `src/app/api/slots/route.ts`, modify `src/app/api/bookings/route.ts`

---

### Story 5: Team Public Pages
**Persona:** `frontend_developer`

Build team booking pages:
- `src/app/(public)/team/[slug]/page.tsx` — Team profile with name, logo, bio, member avatars, event type grid
- `src/app/(public)/team/[slug]/[eventSlug]/page.tsx` — Reuses booking-page-client from CM-3, adapted for team context (show team info, assigned member after booking)
- `src/app/api/teams/[slug]/public/route.ts` — Public team info endpoint
- `src/app/api/teams/[slug]/public/event-types/route.ts` — Public team event types

**Target files:** 2 page files under `src/app/(public)/team/`, 2 API routes

---

### Story 6: Team Dashboard UI
**Persona:** `frontend_developer`

Build the team management dashboard:
- `src/app/(dashboard)/teams/page.tsx` — Team list with create dialog
- `src/app/(dashboard)/teams/[slug]/page.tsx` — Team detail with 3 tabs (Members, Event Types, Settings)
- `src/components/teams/member-list.tsx` — Member table with role badges, actions
- `src/components/teams/invite-dialog.tsx` — Email input invitation dialog
- `src/components/teams/team-event-type-card.tsx` — Event type card with scheduling type badge
- Team invitation pending banner (if user has pending invitations)

**Target files:** 2 dashboard pages, 3 components

---

### Story 7: Seed Data Expansion
**Persona:** `backend_developer`

Expand seed data with team scenarios:
- Create 2 additional users (Alice, Bob) with separate schedules
- Create team, add all 3 users
- Create round-robin and collective event types
- Create 5 team bookings (mix of round-robin assigned and collective)

**Target files:** `prisma/seed.ts` (modify)

---

### Story 8: Unit Tests for Team Scheduling
**Persona:** `qa_engineer`

Comprehensive test coverage:
- `tests/unit/round-robin.test.ts` — 10+ tests: slot union, load balancing, assignment fairness, handling member with no availability, re-evaluation at booking time, tiebreaker logic
- `tests/unit/collective.test.ts` — 8+ tests: slot intersection, all-members-required, single member unavailable blocks slot, empty result when no overlap, multiple availability windows
- `tests/unit/team-routes.test.ts` — 8+ tests: team CRUD, member invitation, role changes, last-owner protection, self-removal

**Target files:** `tests/unit/round-robin.test.ts`, `tests/unit/collective.test.ts`, `tests/unit/team-routes.test.ts`

---

## Execution Summary

_To be filled after execution._

| Metric | Value |
|--------|-------|
| **Executed** | — |
| **Duration** | — |
| **Stories** | 8 |
| **Personas** | `backend_developer`, `frontend_developer`, `qa_engineer` |
| **Tech Lead Score** | — |
| **Revision Cycles** | — |
| **Pull Request** | — |
| **Blocks** | CM-7 (Embeds, Webhooks & Production) |
