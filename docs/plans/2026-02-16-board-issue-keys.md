# Sequential Issue Keys for Internal Boards — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace UUID-fragment issue keys (e.g., `CalMill-a1b2c3d4`) with sequential Jira/Linear-style keys (e.g., `CM-1`) on internal board cards, and fix the issue key link to navigate to the card on its board instead of a generic boards list page.

**Architecture:** Add `prefix` + `next_card_number` to `KbBoard`, `card_number` to `KbCard`. Atomically assign numbers on card creation. Derive prefix from board name. Pass `boardId`/`cardId` through the control center API so the frontend can build direct `/boards/:boardId?card=:cardId` links.

**Tech Stack:** TypeORM migrations, Express routes, React + React Router

---

### Task 1: Database Migration — Add Issue Key Columns

**Files:**
- Create: `api/src/db/migrations/1706688000050-AddBoardIssueKeys.ts`
- Modify: `api/src/db/connection.ts:230-231` (import) and `api/src/db/connection.ts:475` (migrations array)

**Step 1: Create the migration file**

```typescript
// api/src/db/migrations/1706688000050-AddBoardIssueKeys.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddBoardIssueKeys1706688000050 implements MigrationInterface {
  name = "AddBoardIssueKeys1706688000050";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add prefix and next_card_number to kb_boards
    await queryRunner.query(`
      ALTER TABLE kb_boards
        ADD COLUMN IF NOT EXISTS prefix VARCHAR(10),
        ADD COLUMN IF NOT EXISTS next_card_number INT NOT NULL DEFAULT 1
    `);

    // 2. Add card_number to kb_cards
    await queryRunner.query(`
      ALTER TABLE kb_cards
        ADD COLUMN IF NOT EXISTS card_number INT
    `);

    // 3. Backfill prefixes for existing boards
    // Derive prefix from board name: take first letter of each camelCase/word boundary
    const boards = await queryRunner.query(`
      SELECT id, name, org_id FROM kb_boards ORDER BY created_at ASC
    `);

    // Track used prefixes per org to avoid collisions
    const usedPrefixes = new Map<string, Set<string>>();

    for (const board of boards) {
      const orgId = board.org_id;
      if (!usedPrefixes.has(orgId)) usedPrefixes.set(orgId, new Set());
      const orgPrefixes = usedPrefixes.get(orgId)!;

      let prefix = derivePrefix(board.name);
      let attempt = 2;
      while (orgPrefixes.has(prefix)) {
        prefix = derivePrefix(board.name) + attempt;
        attempt++;
      }
      orgPrefixes.add(prefix);

      await queryRunner.query(
        `UPDATE kb_boards SET prefix = $1 WHERE id = $2`,
        [prefix, board.id]
      );
    }

    // 4. Backfill card_number for existing cards (ordered by created_at per board)
    await queryRunner.query(`
      WITH numbered AS (
        SELECT id, board_id,
          ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY created_at ASC) AS rn
        FROM kb_cards
      )
      UPDATE kb_cards SET card_number = numbered.rn
      FROM numbered WHERE kb_cards.id = numbered.id
    `);

    // 5. Update next_card_number for each board
    await queryRunner.query(`
      UPDATE kb_boards SET next_card_number = COALESCE(
        (SELECT MAX(card_number) + 1 FROM kb_cards WHERE kb_cards.board_id = kb_boards.id),
        1
      )
    `);

    // 6. Make prefix NOT NULL now that backfill is done
    await queryRunner.query(`
      ALTER TABLE kb_boards ALTER COLUMN prefix SET NOT NULL
    `);

    // 7. Add unique constraint on (org_id, prefix)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_boards_org_prefix
        ON kb_boards (org_id, prefix)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_kb_boards_org_prefix`);
    await queryRunner.query(`ALTER TABLE kb_cards DROP COLUMN IF EXISTS card_number`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS prefix`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS next_card_number`);
  }
}

// Helper: derive a short prefix from a board name
// "CalMill" → "CM", "TaskPulse Dashboard" → "TPD", "Bugs" → "BUG"
function derivePrefix(name: string): string {
  // Split on spaces, hyphens, underscores, and camelCase boundaries
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    // Take first letter of each word, max 5
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  // Single word: take first 2-3 chars
  const word = words[0] || "BD";
  return word.slice(0, Math.min(3, Math.max(2, word.length))).toUpperCase();
}
```

**Step 2: Register migration in connection.ts**

Add at the end of the import block (after line 230):
```typescript
import { AddBoardIssueKeys1706688000050 } from "./migrations/1706688000050-AddBoardIssueKeys.js";
```

Add at the end of the migrations array (after `AddGithubRepoToKbCards1706688000049` on line 475):
```typescript
    AddBoardIssueKeys1706688000050,
```

**Step 3: Run the migration locally to verify**

Run: `cd api && npm run typecheck`
Expected: No new errors (pre-existing dotenv error only)

**Step 4: Commit**

```bash
git add api/src/db/migrations/1706688000050-AddBoardIssueKeys.ts api/src/db/connection.ts
git commit -m "feat: add migration for board issue key columns (prefix, card_number)"
```

---

### Task 2: Update KbBoard and KbCard Models

**Files:**
- Modify: `api/src/models/KbBoard.ts:33-34` (add columns after `template`)
- Modify: `api/src/models/KbCard.ts:55-57` (add column after `coverColor`)

**Step 1: Add `prefix` and `nextCardNumber` to KbBoard**

In `api/src/models/KbBoard.ts`, add after the `template` column (after line 37):

```typescript
  @Column({ type: "varchar", length: 10 })
  prefix: string;

  @Column({ name: "next_card_number", type: "int", default: 1 })
  nextCardNumber: number;
```

**Step 2: Add `cardNumber` to KbCard**

In `api/src/models/KbCard.ts`, add after the `coverColor` column (after line 55):

```typescript
  @Column({ name: "card_number", type: "int", nullable: true })
  cardNumber: number | null;
```

**Step 3: Verify types compile**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 4: Commit**

```bash
git add api/src/models/KbBoard.ts api/src/models/KbCard.ts
git commit -m "feat: add prefix/nextCardNumber to KbBoard, cardNumber to KbCard"
```

---

### Task 3: Board Creation — Prefix Derivation + Collision Handling

**Files:**
- Modify: `api/src/routes/boards.ts:28` (add helper function after imports)
- Modify: `api/src/routes/boards.ts:296` (add `prefix` to POST body validation)
- Modify: `api/src/routes/boards.ts:317-325` (set prefix on board creation)

**Step 1: Add `derivePrefix` helper to boards.ts**

Add after the router declaration (after line 32, before the `logActivity` function):

```typescript
/**
 * Derive a short prefix from a board name for issue keys.
 * "CalMill" → "CM", "TaskPulse Dashboard" → "TPD", "Bugs" → "BUG"
 */
function derivePrefix(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  const word = words[0] || "BD";
  return word.slice(0, Math.min(3, Math.max(2, word.length))).toUpperCase();
}

/**
 * Generate a unique prefix for a board within an org.
 * Appends incrementing digits on collision.
 */
async function generateUniquePrefix(
  boardRepo: import("typeorm").Repository<KbBoard>,
  orgId: string,
  name: string,
  preferredPrefix?: string,
): Promise<string> {
  let prefix = preferredPrefix?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || derivePrefix(name);

  const existing = await boardRepo
    .createQueryBuilder("b")
    .where("b.orgId = :orgId", { orgId })
    .select("b.prefix")
    .getMany();
  const usedPrefixes = new Set(existing.map((b) => b.prefix));

  if (!usedPrefixes.has(prefix)) return prefix;

  let attempt = 2;
  const base = prefix;
  while (usedPrefixes.has(prefix)) {
    prefix = `${base}${attempt}`;
    attempt++;
  }
  return prefix;
}
```

**Step 2: Update POST /api/boards validation to accept optional `prefix`**

In the POST `/` route (line 296-298), add prefix to body validation:

```typescript
  body("name").isString().notEmpty().isLength({ max: 200 }).withMessage("name is required (max 200 chars)"),
  body("description").optional().isString().isLength({ max: 2000 }),
  body("prefix").optional().isString().isLength({ max: 10 }),
  body("template").optional().isString().isIn(["project", "sprint", "bugs"]),
```

**Step 3: Set prefix on board creation**

In the POST `/` handler, destructure `prefix` from body (line 304):

```typescript
const { name, description, template, prefix: requestedPrefix } = req.body;
```

Before `boardRepo.save(board)` (around line 317-325), generate the prefix:

```typescript
        const prefix = await generateUniquePrefix(boardRepo, org.id, name, requestedPrefix);

        const board = boardRepo.create({
          orgId: org.id,
          name,
          description: description || null,
          position: (maxPos?.max ?? -1) + 1,
          template: template || null,
          createdById: user.id,
          prefix,
        });
```

**Step 4: Include `prefix` in the board creation response**

In the response (line 349-365), add `prefix`:

```typescript
          id: result.board.id,
          name: result.board.name,
          description: result.board.description,
          prefix: result.board.prefix,
          position: result.board.position,
```

**Step 5: Include `prefix` in GET /api/boards list response**

In the GET `/` response mapping (around line 270-282), add `prefix`:

```typescript
        id: board.id,
        name: board.name,
        prefix: board.prefix,
        description: board.description,
```

**Step 6: Verify types compile**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 7: Commit**

```bash
git add api/src/routes/boards.ts
git commit -m "feat: auto-derive board prefix on creation with collision handling"
```

---

### Task 4: Card Creation — Atomic Counter + Number Assignment

**Files:**
- Modify: `api/src/routes/boards.ts:1049-1068` (POST `/:boardId/cards` handler)

**Step 1: Add atomic card number assignment to card creation**

Replace the card creation block (lines 1057-1068) with:

```typescript
      // Atomically claim the next card number
      const [{ next_num }] = await AppDataSource.query(
        `UPDATE kb_boards SET next_card_number = next_card_number + 1 WHERE id = $1 RETURNING next_card_number - 1 AS next_num`,
        [boardId]
      );

      const maxPos = await cardRepo
        .createQueryBuilder("c")
        .where("c.columnId = :columnId", { columnId })
        .select("MAX(c.position)", "max")
        .getRawOne();

      const card = cardRepo.create({
        boardId,
        columnId,
        title,
        description: description || null,
        position: (maxPos?.max ?? -1) + 1,
        priority: priority || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        coverColor: coverColor || null,
        githubRepo: githubRepo || null,
        cardNumber: next_num,
      });
      await cardRepo.save(card);
```

**Step 2: Include `cardNumber` in the card response**

The current response is `res.status(201).json({ card })` which returns the full card entity. Since `cardNumber` is now on the entity, it will be included automatically. Also include the board prefix for display. Update the response (line 1072):

```typescript
      const boardPrefix = board.prefix;
      await logActivity(boardId, req.user!.id, "created", "card", card.id, { title });

      res.status(201).json({ card: { ...card, issueKey: `${boardPrefix}-${card.cardNumber}` } });
```

**Step 3: Verify types compile**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 4: Commit**

```bash
git add api/src/routes/boards.ts
git commit -m "feat: atomically assign sequential card numbers on creation"
```

---

### Task 5: Worker Task Key — Use Board Prefix + Card Number

**Files:**
- Modify: `api/src/routes/boards.ts:163` (jiraIssueKey generation in `runCardAsWorkerTask`)

**Step 1: Update the jiraIssueKey line**

Change line 163 from:

```typescript
    jiraIssueKey: `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`,
```

to:

```typescript
    jiraIssueKey: card.board?.prefix && card.cardNumber
      ? `${card.board.prefix}-${card.cardNumber}`
      : `${card.board?.name?.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "BOARD"}-${card.id.slice(0, 8)}`,
```

This falls back to the old format if prefix/cardNumber aren't set (shouldn't happen after migration, but safe).

**Step 2: Verify types compile**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 3: Commit**

```bash
git add api/src/routes/boards.ts
git commit -m "feat: use board prefix + card number for worker task issue key"
```

---

### Task 6: Control Center API — Include Board Context for Internal Tasks

**Files:**
- Modify: `api/src/routes/control-center/helpers.ts:345-415` (formatTaskData)
- Modify: `api/src/routes/control-center/dashboard.ts` (add KbCard join to task queries)

**Step 1: Add boardId/cardId to formatTaskData response**

In `api/src/routes/control-center/helpers.ts`, the `formatTaskData` function returns a task object. We need to look up the card link. But to avoid N+1 queries, it's simpler to add two fields to the response that the caller populates.

Add a new optional parameter to `formatTaskData` (after `orgMaxReviewRevisions` on line 333):

```typescript
  cardContext?: { boardId: string; cardId: string } | null,
```

Add to the return object (after line 414, before the closing `};`):

```typescript
    // Internal board card context (for direct link to card)
    cardBoardId: cardContext?.boardId ?? null,
    cardId: cardContext?.cardId ?? null,
```

**Step 2: Look up card context in the dashboard endpoint**

In `api/src/routes/control-center/dashboard.ts`, after loading active tasks, do a single batch query to get card context for all tasks that have internal board cards.

Find where `formatTaskData` is called for active tasks (around line 211-231). Before the map, add:

```typescript
    // Batch-fetch card context for internal board cards (for direct links)
    const taskIds = runningTasks.map((t) => t.id);
    const cardContextMap = new Map<string, { boardId: string; cardId: string }>();
    if (taskIds.length > 0) {
      const cardRows = await AppDataSource.getRepository(KbCard)
        .createQueryBuilder("card")
        .select(["card.workerTaskId", "card.boardId", "card.id"])
        .where("card.workerTaskId IN (:...taskIds)", { taskIds })
        .getMany();
      for (const row of cardRows) {
        if (row.workerTaskId) {
          cardContextMap.set(row.workerTaskId, { boardId: row.boardId, cardId: row.id });
        }
      }
    }
```

Then pass it into each `formatTaskData` call:

```typescript
    return formatTaskData(task, ralphData, checkpointData, epicProgressData, org.maxReviewRevisions, cardContextMap.get(task.id) ?? null);
```

Do the same for queued tasks and recent completed tasks in the same file (search for other `formatTaskData` calls).

**Step 3: Verify types compile**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 4: Commit**

```bash
git add api/src/routes/control-center/helpers.ts api/src/routes/control-center/dashboard.ts
git commit -m "feat: include boardId/cardId in control center task response for internal links"
```

---

### Task 7: Frontend — Fix buildTicketUrl for Internal Links

**Files:**
- Modify: `frontend/src/lib/utils.ts:11-16` (IssueTrackerConfig type)
- Modify: `frontend/src/lib/utils.ts:26-63` (buildTicketUrl function)

**Step 1: Update buildTicketUrl to accept board context**

Change the `buildTicketUrl` signature and internal case (lines 26-63):

```typescript
export function buildTicketUrl(
  issueKey: string | null | undefined,
  config?: IssueTrackerConfig,
  boardContext?: { boardId: string; cardId: string } | null,
): string | null {
  if (!issueKey) return null;

  // Internal board cards: direct link if we have board context
  if (boardContext?.boardId) {
    return `/boards/${boardContext.boardId}?card=${boardContext.cardId}`;
  }

  if (!config) return null;
  // ... rest of switch statement unchanged
```

Remove the `case "internal":` block from the switch statement since board context is now handled above the switch. Or keep it as a fallback — but the `boardContext` path takes priority.

Actually, cleaner: keep the `case "internal"` as fallback for tasks without card context:

```typescript
    case "internal": {
      return `/boards?task=${encodeURIComponent(issueKey)}`;
    }
```

**Step 2: Verify frontend types compile**

Run: `cd frontend && npx tsc -b`
Expected: No new errors

**Step 3: Commit**

```bash
git add frontend/src/lib/utils.ts
git commit -m "feat: buildTicketUrl supports direct board card links via boardContext"
```

---

### Task 8: Frontend — Pass Board Context Through Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx` — all `buildTicketUrl` call sites

**Step 1: Pass boardContext to buildTicketUrl calls**

There are ~5 call sites in MainDashboard.tsx where `buildTicketUrl(task.jiraIssueKey, issueTrackerConfig)` is called. Each needs to also pass `{ boardId: task.cardBoardId, cardId: task.cardId }` when those fields are present.

Find every call to `buildTicketUrl` and change from:

```typescript
buildTicketUrl(task.jiraIssueKey, issueTrackerConfig ?? undefined)
```

to:

```typescript
buildTicketUrl(
  task.jiraIssueKey,
  issueTrackerConfig ?? undefined,
  task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null,
)
```

The `task` object comes from the API response which now includes `cardBoardId` and `cardId` (added in Task 6). TypeScript won't complain since `task` is typed as `any` in the SSE update handler.

**Step 2: Do the same for TaskCard.tsx**

In `frontend/src/components/dashboards/TaskCard.tsx`, the `TaskCard` component calls `buildTicketUrl(task.jiraKey, issueTrackerConfig)`. Since `TaskCardData` doesn't include `cardBoardId`/`cardId`, add optional fields to the interface.

In `frontend/src/types/dashboard.ts`, add to `TaskCardData` (after line 77):

```typescript
  cardBoardId?: string | null;
  cardId?: string | null;
```

Then update the `buildTicketUrl` call in TaskCard.tsx (line 92):

```typescript
  const ticketUrl = buildTicketUrl(
    task.jiraKey,
    issueTrackerConfig ?? undefined,
    task.cardBoardId && task.cardId ? { boardId: task.cardBoardId, cardId: task.cardId } : null,
  );
```

**Step 3: Verify frontend types compile**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/pages/Dashboard/MainDashboard.tsx frontend/src/components/dashboards/TaskCard.tsx frontend/src/types/dashboard.ts
git commit -m "feat: pass board context to buildTicketUrl for direct card links"
```

---

### Task 9: Frontend — BoardView Handles `?card=` Query Param

**Files:**
- Modify: `frontend/src/pages/Boards/BoardView.tsx:1-2` (add useSearchParams import)
- Modify: `frontend/src/pages/Boards/BoardView.tsx:121-141` (handle card query param)

**Step 1: Import useSearchParams**

Change line 2 from:

```typescript
import { useParams, Link } from "react-router-dom";
```

to:

```typescript
import { useParams, useSearchParams, Link } from "react-router-dom";
```

**Step 2: Auto-open card from query param**

After the `useParams` call (line 122), add:

```typescript
  const [searchParams, setSearchParams] = useSearchParams();
```

Then add a `useEffect` after the existing effects to handle the `?card=` param. Find a good location (after the board data loads). Add:

```typescript
  // Auto-open card detail when ?card= query param is present
  useEffect(() => {
    const cardId = searchParams.get("card");
    if (!cardId || !currentBoard?.columns) return;

    for (const col of currentBoard.columns) {
      const card = col.cards.find((c) => c.id === cardId);
      if (card) {
        setSelectedCard(card);
        // Clear the query param so it doesn't re-trigger
        setSearchParams({}, { replace: true });
        break;
      }
    }
  }, [searchParams, currentBoard?.columns, setSearchParams]);
```

**Step 3: Verify frontend types compile**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/pages/Boards/BoardView.tsx
git commit -m "feat: auto-open card detail when navigating with ?card= query param"
```

---

### Task 10: Frontend — Add Prefix Field to CreateBoardDialog

**Files:**
- Modify: `frontend/src/lib/boards-api.ts:96-100` (CreateBoardData type)
- Modify: `frontend/src/lib/boards-api.ts:5-14` (Board type)
- Modify: `frontend/src/pages/Boards/CreateBoardDialog.tsx` (add prefix input)

**Step 1: Update API types**

In `boards-api.ts`, add `prefix` to `CreateBoardData` (line 96-100):

```typescript
export interface CreateBoardData {
  name: string;
  description?: string;
  prefix?: string;
  template?: "empty" | "project" | "bug_tracker";
}
```

Add `prefix` to `Board` (after `name` on line 7):

```typescript
export interface Board {
  id: string;
  name: string;
  prefix: string;
  description: string | null;
```

**Step 2: Add prefix field to CreateBoardDialog**

In `CreateBoardDialog.tsx`, add state (after line 35):

```typescript
  const [prefix, setPrefix] = useState("");
```

Add auto-derive when name changes. Replace the name `onChange` handler or add a `useEffect`:

```typescript
  // Auto-derive prefix from board name
  const autoDerivePrefix = (boardName: string) => {
    const words = boardName
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[\s\-_]+/)
      .filter(Boolean);
    if (words.length >= 2) {
      return words.slice(0, 5).map((w) => w[0]).join("").toUpperCase();
    }
    const word = words[0] || "";
    return word.slice(0, Math.min(3, Math.max(2, word.length))).toUpperCase();
  };
```

Update the name input's onChange to also auto-derive prefix (only if user hasn't manually edited it). Track with a ref:

```typescript
  const [prefixManuallyEdited, setPrefixManuallyEdited] = useState(false);
```

In the name input onChange:

```typescript
  onChange={(e) => {
    setName(e.target.value);
    if (!prefixManuallyEdited) {
      setPrefix(autoDerivePrefix(e.target.value));
    }
  }}
```

Add the prefix input field after the name field (after line 105):

```html
<div>
  <label className="block text-sm font-medium mb-1">
    Key Prefix
  </label>
  <div className="flex items-center gap-2">
    <input
      type="text"
      value={prefix}
      onChange={(e) => {
        setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10));
        setPrefixManuallyEdited(true);
      }}
      placeholder="e.g., CM"
      maxLength={10}
      className="w-24 px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 uppercase"
    />
    <span className="text-sm text-muted-foreground">
      Cards will be numbered {prefix || "XX"}-1, {prefix || "XX"}-2, ...
    </span>
  </div>
</div>
```

Pass `prefix` in the `onCreate` call (line 53):

```typescript
      await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        prefix: prefix || undefined,
        template,
      });
```

Reset prefix on close (line 58-60):

```typescript
      setName("");
      setPrefix("");
      setPrefixManuallyEdited(false);
      setDescription("");
```

**Step 3: Verify frontend types compile**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 4: Commit**

```bash
git add frontend/src/lib/boards-api.ts frontend/src/pages/Boards/CreateBoardDialog.tsx
git commit -m "feat: add key prefix field to create board dialog with auto-derivation"
```

---

### Task 11: Verify End-to-End + Type Check All

**Step 1: Type check backend**

Run: `cd api && npm run typecheck`
Expected: No new errors (pre-existing dotenv error only)

**Step 2: Type check frontend**

Run: `cd frontend && npx tsc -b`
Expected: No errors

**Step 3: Run API tests**

Run: `cd api && npm run test`
Expected: All existing tests pass

**Step 4: Commit any fixes needed, then final commit**

```bash
git add -A
git commit -m "feat: sequential issue keys for internal board cards (CM-1 style)"
```
