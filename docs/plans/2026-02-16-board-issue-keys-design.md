# Sequential Issue Keys for Internal Boards

**Date:** 2026-02-16
**Status:** Approved

## Problem

When internal board cards are run as worker tasks, the displayed issue key is a UUID fragment (e.g., `CalMill-a1b2c3d4`) instead of a human-readable ticket number like `CM-1`. Additionally, clicking the issue key link navigates to `/boards?task=...` (the boards list page) rather than the specific card on its board.

## Solution

Add Jira/Linear-style sequential numbering to internal board cards, and fix the issue key link to navigate directly to the card's board.

## Schema Changes

### `kb_boards` — add 2 columns

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `prefix` | `VARCHAR(10)` | `NOT NULL`, `UNIQUE(org_id, prefix)` | Short key prefix, e.g., "CM", "TP" |
| `next_card_number` | `INT` | `NOT NULL DEFAULT 1` | Counter for next card number |

### `kb_cards` — add 1 column

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `card_number` | `INT` | `NULLABLE` | Sequential number within the board |

## Prefix Auto-Derivation

When creating a board, the prefix is auto-derived from the board name:

1. Split name into words
2. Take first letter of each word, uppercase: "CalMill" → "CM", "TaskPulse Dashboard" → "TPD"
3. Single word: take first 2-3 uppercase chars: "Bugs" → "BUG"
4. On collision within the org, append a digit: "CM" → "CM2"
5. User can override in the Create Board dialog

## Card Creation Flow

When `POST /:boardId/cards` is called:

1. Atomically increment `kb_boards.next_card_number` via `UPDATE kb_boards SET next_card_number = next_card_number + 1 WHERE id = :boardId RETURNING next_card_number - 1 AS card_number`
2. Set `card.card_number` to the returned value
3. Display key = `{board.prefix}-{card.card_number}` (e.g., `CM-1`)

## Worker Task Key Generation

In `runCardAsWorkerTask()` (boards.ts:163), change:

```typescript
// Before
jiraIssueKey: `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`

// After
jiraIssueKey: `${card.board?.prefix || "BOARD"}-${card.cardNumber || card.id.slice(0, 8)}`
```

## Link Fix

### Problem
`buildTicketUrl()` for `internal` provider returns `/boards?task=issueKey` — navigates to the boards list, not the card.

### Solution
Store `boardId` on the WorkerTask (via a new `kb_board_id` column or by using the existing card relation to look it up). Update `buildTicketUrl()`:

```typescript
// Before
case "internal":
  return `/boards?task=${encodeURIComponent(issueKey)}`;

// After
case "internal":
  return `/boards/${boardId}?card=${cardId}`;
```

The control center API response needs to include `boardId` and `cardId` for internal board tasks. These come from joining WorkerTask → KbCard → KbBoard via `worker_task_id`.

Frontend `buildTicketUrl` signature changes to accept optional `boardId`/`cardId` params for internal links. The BoardView component opens the card detail when `?card=` query param is present.

## Backfill Migration

1. Derive `prefix` for each existing board from its name
2. Handle collisions within the same org by appending digits
3. Assign sequential `card_number` to existing cards ordered by `created_at`
4. Set each board's `next_card_number` to `MAX(card_number) + 1`

## Frontend Changes

| File | Change |
|------|--------|
| `CreateBoardDialog.tsx` | Add "Key Prefix" field, auto-populated from name, editable |
| `boards-api.ts` | Add `prefix` to `CreateBoardData`, `Board`, `BoardDetail` types |
| `lib/utils.ts` | Update `buildTicketUrl` to accept `boardId`/`cardId` for internal links |
| `MainDashboard.tsx` | Pass `boardId`/`cardId` to `buildTicketUrl` for internal tasks |
| `TaskCard.tsx` | Same — pass board context for internal links |
| `BoardView.tsx` | Handle `?card=` query param to auto-open card detail |

## What Stays the Same

- External issue trackers (Jira, Linear, GitHub Issues) unaffected — they set `jiraIssueKey` from webhooks
- `getDisplayKey()` on WorkerTask works unchanged (shows `CM-1` instead of `CalMill-a1b2c3d4`)
- TaskCard rendering logic unchanged — already displays `task.jiraKey`
- No changes to worker containers or agent package

## Files Touched

### Backend
- `api/src/models/KbBoard.ts` — add `prefix`, `nextCardNumber`
- `api/src/models/KbCard.ts` — add `cardNumber`
- `api/src/routes/boards.ts` — card creation counter logic, board creation prefix, `runCardAsWorkerTask` key generation
- `api/src/routes/control-center/helpers.ts` — include `boardId`/`cardId` in task response for internal tasks
- `api/src/db/migrations/TIMESTAMP-AddBoardIssueKeys.ts` — schema + backfill
- `api/src/db/connection.ts` — register migration

### Frontend
- `frontend/src/pages/Boards/CreateBoardDialog.tsx` — prefix field
- `frontend/src/lib/boards-api.ts` — type updates
- `frontend/src/lib/utils.ts` — `buildTicketUrl` internal link fix
- `frontend/src/pages/Dashboard/MainDashboard.tsx` — pass board context
- `frontend/src/components/dashboards/TaskCard.tsx` — pass board context
- `frontend/src/pages/Boards/BoardView.tsx` — handle `?card=` query param
