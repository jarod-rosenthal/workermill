# PRD-Driven Development — Design Document

> **Date:** 2026-02-18
> **Status:** Approved
> **Approach:** A+C — PRD Decomposer creates board with cards, each card runs through existing planner independently

---

## Overview

Add the ability to import a Product Requirements Document (PRD) and have WorkerMill automatically decompose it into a board of predictably-sized cards with inferred dependencies. Each card then runs through WorkerMill's existing planner → critic → execution pipeline independently. This is backwards-compatible with all existing task creation flows (Jira, Linear, GitHub Issues, internal boards).

**Entry points:** Dashboard UI and VS Code extension.

**Key constraint:** Cards must be sized so the planner decomposes each into ~10-12 stories — matching the proven scope of existing showcase boards (CalMill CM-1 through CM-7, TaskPulse TP-1 through TP-5, TeamBoard TB-7 through TB-12).

---

## Architecture

```
PRD (text/file/URL/repo)
  │
  ▼
POST /api/prd/decompose
  │
  ├─► PRD Decomposer (Claude CLI, single call)
  │     Outputs: boardName, cards[] with titles, detailed specs,
  │              personas, priorities, dependencyIndices
  │
  ├─► Create KbBoard + KbCards + KbCardDependencies
  │
  ├─► (Optional) Sync to external tracker (Jira/Linear/GitHub)
  │     Creates mirrored issues linked to cards
  │
  └─► If prdAutoRun: trigger processUnblockedCards()
        Otherwise: board in review state, user runs manually

Card execution (existing pipeline):
  KbCard → runCardAsWorkerTask() → WorkerTask (status: planning)
    → Planner decomposes into ~10 stories
    → Critic validates (threshold 85)
    → Workers execute stories in parallel
    → PR created, tech lead reviews
    → Card completes → processUnblockedCards() checks dependents → cascade
```

---

## 1. API — PRD Decomposition Endpoint

### New route file: `api/src/routes/prd.ts`

### `POST /api/prd/decompose`

**Auth:** JWT (dashboard) or API key (agent proxy).

**Request body:**

```typescript
{
  source: "text" | "file" | "url" | "repo";
  content?: string;              // for "text" source
  fileUrl?: string;              // for "url" source (Google Doc, Notion, etc.)
  repoPath?: string;             // for "repo" source — e.g., "docs/PRD.md"
  githubRepo?: string;           // target repo for all cards
  boardName?: string;            // optional, inferred from PRD title
  scmProvider?: string;          // defaults to org's scmProvider
  syncToTracker?: boolean;       // optional, defaults to true if org has external tracker
}
```

**Flow:**

1. **Resolve PRD content** based on `source`:
   - `text`: use `content` directly
   - `file`: read uploaded file from multipart (base64 in body)
   - `url`: fetch URL content, convert HTML → markdown
   - `repo`: call SCM API to read file at `repoPath` from `githubRepo` (uses org's SCM token)
2. **Validate**: non-empty, max ~100KB
3. **Run PRD Decomposer**: spawn Claude CLI (`runClaudeCli` pattern — stdin prompt, `--print --verbose --output-format stream-json`)
4. **Parse output**: validate JSON schema
5. **Create KbBoard**: `derivePrefix(boardName)`, default columns (To Do | In Progress | Review | Approved | Done), store `prdContent` and `githubRepo`
6. **Create KbCards** in order: title, description (detailed spec), priority, cardNumber, githubRepo, labels
7. **Create KbCardDependencies**: wire up `dependencyIndices` → actual card IDs
8. **Sync to external tracker** (if applicable — see Section 7)
9. **Check `prdAutoRun`**: if true, trigger `processUnblockedCards()` for the initial wave
10. **Return**: `{ boardId, boardUrl, cardCount, cards: [{ id, title, cardNumber, dependencies }] }`

**SSE progress streaming:** `GET /api/prd/decompose/:requestId/stream` — same pattern as log streaming. Dashboard shows real-time status during the 30-60 second decomposition.

### `POST /api/boards/:boardId/run-all`

New batch-run endpoint. Executes all cards respecting dependency order.

1. Load all cards with dependencies and linked WorkerTasks
2. Find cards with zero unmet dependencies and no active WorkerTask
3. Run them via `runCardAsWorkerTask()`
4. Return `{ triggered, blocked, alreadyComplete }`

### `POST /api/boards/:boardId/cancel-all`

Cancels all in-flight WorkerTasks for the board and stops the cascade.

---

## 2. Card Dependencies

### New join table: `kb_card_dependencies`

| Column | Type | Constraints |
|--------|------|-------------|
| `card_id` | uuid | PK, FK → kb_cards(id) CASCADE |
| `depends_on_card_id` | uuid | PK, FK → kb_cards(id) CASCADE |
| `created_at` | timestamptz | DEFAULT now() |

Composite unique index on `(card_id, depends_on_card_id)`. Check constraint: `card_id != depends_on_card_id`.

### New model: `api/src/models/KbCardDependency.ts`

Simple composite-key entity, same pattern as `KbCardLabel`.

### KbCard model additions

- `@OneToMany` relation `dependencies` → cards this card depends on (via join table)
- `@OneToMany` relation `dependents` → cards that depend on this card

### API endpoints for manual dependency management

- `POST /api/boards/:boardId/cards/:cardId/dependencies` — add dependency
- `DELETE /api/boards/:boardId/cards/:cardId/dependencies/:depCardId` — remove dependency

Dependencies are also bulk-created during PRD decomposition.

### Behavior

- A card is **unblocked** when ALL its dependency cards have their linked WorkerTask in `completed` or `deployed` status
- Blocked cards cannot be run — API returns 409, UI disables the Run button
- Failed cards do NOT unblock dependents — the chain stops until the user retries or manually skips

---

## 3. PRD Decomposer Agent

Single Claude CLI call. No critic loop, no repo clone. Reads a document, outputs structured cards.

### Spawn pattern

Same as existing planner — `runClaudeCli` with prompt via stdin, `--print --verbose --output-format stream-json`. Model: org's `defaultWorkerModel`.

### Sizing heuristic (baked into prompt)

> Each card should represent one cohesive epic — a vertical slice or architectural layer that produces a single PR. Target 7-12 deliverables per card. Use this calibration:
>
> - **Project Setup & Dev Environment** is always card 1 (scaffold, CI/CD, base config)
> - **Core Backend** — models, API routes, auth, seed data for one domain
> - **Feature UI** — all pages/components for one user-facing feature
> - **Integrations** — external APIs, email, calendar, webhooks
> - **Production Deploy & Validation** is always the last card
>
> A card with 15+ deliverables is too big — split it. A card with fewer than 4 deliverables is too small — merge it into a related card.

### Structural conventions enforced by prompt

- Card 1 is always "Project Setup & Dev Environment"
- Last card is always "Production Deploy & Validation"
- Each card description includes a **Scope Boundary** section (what prior cards created, what this card must NOT touch)
- Each card explicitly lists **Prerequisites** (which prior cards must complete first → these become `dependencyIndices`)
- Self-sizing check: decomposer reviews its output within the same call, splits cards >15 deliverables, merges cards <4

### Output schema

```json
{
  "boardName": "CalMill",
  "cards": [
    {
      "title": "Project Setup & Dev Environment",
      "description": "## Epic Overview\n\nScaffold the Next.js project...\n\n## Scope Boundary\n\n...\n\n## Deliverables\n\n1. ...",
      "persona": "devops_engineer",
      "priority": "high",
      "dependencyIndices": [],
      "labels": ["critic"],
      "estimatedSteps": 10
    },
    {
      "title": "Core Backend — Event Types, Schedules & Slots",
      "description": "...",
      "persona": "backend_developer",
      "priority": "high",
      "dependencyIndices": [0],
      "labels": [],
      "estimatedSteps": 8
    }
  ]
}
```

- `dependencyIndices` reference other cards by array position (avoids ID chicken-and-egg)
- `persona` uses existing persona set (`backend_developer`, `frontend_developer`, `devops_engineer`, etc.)
- `labels` are optional per card — user can add more from the board
- `estimatedSteps` is informational — shown on the card as a complexity indicator
- Card descriptions are detailed specs with file paths, API shapes, tech constraints — same level of detail as existing showcase cards (CM-3, TP-2)

### Where it lives

- Cloud: `api/src/services/prd-decomposer.ts`
- Remote agent: `agent/src/prd-decomposer.ts` (same logic, local Claude CLI, proxies result to cloud)

---

## 4. Dependency Execution Engine

### New service: `api/src/services/board-execution.ts`

Called by:
- `POST /api/boards/:boardId/run-all`
- `prdAutoRun` auto-trigger after decomposition
- `syncKbCardColumn()` in task-monitor when a card's task completes

### Core function: `processUnblockedCards(boardId)`

```
1. Load all cards for the board with dependencies and linked WorkerTasks
2. For each card:
   - Skip if already has an active WorkerTask (any status except completed/failed/cancelled)
   - Skip if any dependency card's WorkerTask is NOT in completed/deployed status
   - Card is unblocked and ready
3. For each unblocked card: call runCardAsWorkerTask()
4. Return { triggered, stillBlocked, alreadyComplete }
```

### Integration with task-monitor

`task-monitor.ts` already calls `syncKbCardColumn(taskId, status)` on task status change. Add after the column sync:

```typescript
if (isTerminalStatus(status) && card.boardId) {
  await processUnblockedCards(card.boardId);
}
```

This creates a cascade: card 1 completes → dependents unblock → run them → next card completes → more unblock.

### Guard rails

- Respects org `maxConcurrentWorkers` — unblocked cards queue as WorkerTasks, orchestrator claim logic still throttles
- Failed cards do NOT unblock dependents — chain stops, user must retry or skip
- `POST /api/boards/:boardId/cancel-all` cancels all in-flight tasks and stops cascade
- Board-level cascade only fires when `prdAutoRun` is true OR user has explicitly triggered `run-all`

### For `prdAutoRun: false` (default)

- User clicks "Run All" → triggers `processUnblockedCards` once for the initial wave
- After that, completed cards auto-trigger dependents (cascade is active once started)
- User can also run individual cards manually — dependencies enforced (409 on blocked cards)

---

## 5. VS Code Extension Integration

### New command: `workermill.buildFromPrd`

**Trigger methods:**
- Command palette: "WorkerMill: Build from PRD"
- Context menu: right-click `.md` file → "Build from PRD with WorkerMill"
- Editor title button: when a `.md` file is open, show build icon

**Flow:**

1. User triggers command
2. Extension reads active editor's file content (or prompts file picker if no file open)
3. Detects git remote to infer `githubRepo` (existing `git remote -v` parsing)
4. Quick input prompt for board name (pre-filled from PRD's first `# heading`)
5. POST to agent local API: `POST /api/prd/build` with `{ content, githubRepo, boardName }`
6. Agent proxies to cloud `POST /api/prd/decompose` (adds org auth)
7. Progress notification via `window.withProgress`
8. On success: notification with "Board created: 7 cards" + "Open in Dashboard" button
9. Board appears in sidebar tree via existing SSE event stream

### Agent local API addition

New route in `agent/src/local-api.ts`: `POST /api/prd/build` — thin proxy, same pattern as existing `POST /api/tasks/run`.

---

## 6. Frontend — PRD Import UI

### Create Board Modal Enhancement

New tab in the existing create-board modal: **"Import from PRD"**.

**Contents:**
- Source selector: "Paste Text" | "Upload File" | "From URL" | "From Repo"
- Content area (changes based on source):
  - Paste: markdown textarea with preview
  - Upload: drag-and-drop zone (`.md`, `.txt`, `.pdf`)
  - URL: text input
  - Repo: repo selector + file path input with autocomplete
- Board name input (auto-filled from PRD title)
- Target repo selector (required)
- "Decompose" button

**Progress state:** Modal stays open, shows SSE-streamed status. On completion: summary with card count, dependency overview, "View Board" button.

### Board View — Dependency Indicators

- Blocked cards: lock icon overlay, muted opacity
- Card hover tooltip: "Blocked by: CM-1, CM-2"
- Card detail panel: "Dependencies" section with upstream/downstream cards
- Run button disabled on blocked cards: "Waiting for CM-1 to complete"
- **"Run All" button** in board header — visible on boards with dependencies. Confirmation dialog before starting.

### Board Header — PRD Source Badge

Boards from PRD show a "From PRD" badge. Clicking opens the original PRD content in a read-only modal.

---

## 7. External Tracker Sync

When the org has an external issue tracker configured, PRD decomposition optionally syncs cards to that tracker.

### Sync behavior by tracker

| Org Tracker | Creates | Linking |
|-------------|---------|---------|
| `internal` | KbBoard + KbCards only | No external sync |
| `jira` | KbBoard + KbCards + Jira epic with child tickets | Cards store Jira key, status syncs both ways |
| `linear` | KbBoard + KbCards + Linear issues | Cards store Linear issue ID |
| `github` | KbBoard + KbCards + GitHub issues | Cards store GitHub issue number |

### Flow

After creating the KbBoard and KbCards (step 6-7 in the decompose flow), if `syncToTracker` is true (default when org has external tracker):

1. **Jira:** Create an Epic issue (`POST /rest/api/3/issue`), then create child Story issues linked to the epic. Each child gets the `workermill` label. Card's `jiraIssueKey` updated with the created key (e.g., `OCS-45`).
2. **Linear:** Create issues via Linear API. Link to cards.
3. **GitHub:** Create issues via GitHub API (`POST /repos/:owner/:repo/issues`). Add `workermill` label.

### Webhook dedup

When a Jira/Linear/GitHub webhook fires for a newly-created ticket that already has a linked KbCard with a `workerTaskId`, skip WorkerTask creation. Check: if the incoming issue key matches a card's `jiraIssueKey` on a board, and that card already has an active WorkerTask, return early from the webhook handler.

### What we add to existing clients

- **Jira client** (`api/src/services/jira.ts`): `createIssue()`, `createEpicWithChildren()` — currently read-only
- **Linear client**: `createIssue()` — currently read-only
- **GitHub client**: already has issue creation capability via `gh` CLI patterns

### Dependencies in external trackers

Dependencies are enforced by the board engine, not the external tracker. For visibility, we optionally add Jira "blocks/blocked by" issue links and Linear/GitHub cross-references, but these are informational only.

---

## 8. Data Model Changes

### New table: `kb_card_dependencies`

| Column | Type | Constraints |
|--------|------|-------------|
| `card_id` | uuid | PK, FK → kb_cards(id) CASCADE |
| `depends_on_card_id` | uuid | PK, FK → kb_cards(id) CASCADE |
| `created_at` | timestamptz | DEFAULT now() |

Composite unique index. Check constraint: `card_id != depends_on_card_id`.

### KbBoard — new columns

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `prd_content` | text | NULL | Original PRD text for reference |
| `prd_source` | varchar(20) | NULL | `"text"`, `"file"`, `"url"`, `"repo"` |
| `github_repo` | varchar(255) | NULL | Board-level default repo |

### Organization — new column

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `prd_auto_run` | boolean | false | Auto-execute cards after PRD decomposition |

### New model file

- `api/src/models/KbCardDependency.ts`

### Modified model files

- `api/src/models/KbBoard.ts` — add 3 columns + relation to KbCardDependency
- `api/src/models/KbCard.ts` — add dependency relations (OneToMany via join table)
- `api/src/models/Organization.ts` — add `prdAutoRun` boolean

### No changes to

`KbColumn`, `KbLabel`, `KbCardLabel`, `WorkerTask`, `KbComment`, `KbChecklist`, or any other existing table.

### Migration

Single migration file. All additions use `IF NOT EXISTS` / `IF EXISTS` for idempotency.

---

## 9. New Files Summary

| File | Purpose |
|------|---------|
| `api/src/routes/prd.ts` | PRD decompose endpoint, SSE progress stream |
| `api/src/services/prd-decomposer.ts` | Claude CLI spawn, prompt construction, output parsing |
| `api/src/services/board-execution.ts` | `processUnblockedCards()`, cascade logic |
| `api/src/models/KbCardDependency.ts` | Join table model |
| `api/src/db/migrations/XXXX-AddPrdDecomposition.ts` | Schema migration |
| `agent/src/prd-decomposer.ts` | Agent-side decomposer (local Claude CLI, proxies to cloud) |
| `packages/vscode-workermill/src/prd-command.ts` | VS Code command registration and handler |
| `frontend/src/components/Boards/PrdImportModal.tsx` | PRD import UI in create-board modal |
| `frontend/src/components/Boards/DependencyIndicators.tsx` | Lock icons, dependency chips on cards |

### Modified files

| File | Change |
|------|--------|
| `api/src/models/KbBoard.ts` | Add `prdContent`, `prdSource`, `githubRepo` columns |
| `api/src/models/KbCard.ts` | Add dependency relations |
| `api/src/models/Organization.ts` | Add `prdAutoRun` |
| `api/src/db/connection.ts` | Register migration |
| `api/src/routes/boards.ts` | Add `run-all`, `cancel-all`, dependency CRUD endpoints |
| `api/src/services/task-monitor.ts` | Call `processUnblockedCards()` on card task completion |
| `api/src/routes/webhooks/jira.ts` | Webhook dedup check for PRD-synced tickets |
| `api/src/routes/webhooks/linear.ts` | Webhook dedup check |
| `api/src/routes/webhooks/github-issues.ts` | Webhook dedup check |
| `api/src/services/jira.ts` | Add `createIssue()`, `createEpicWithChildren()` |
| `agent/src/local-api.ts` | Add `POST /api/prd/build` proxy route |
| `packages/vscode-workermill/src/extension.ts` | Register PRD command |
| `packages/vscode-workermill/package.json` | Add command, context menu, keybinding |
| `frontend/src/pages/Boards/BoardView.tsx` | Dependency indicators, Run All button, PRD badge |
| `frontend/src/components/Boards/CreateBoardModal.tsx` | PRD import tab |
| `frontend/src/components/Boards/CardDetail.tsx` | Dependencies section |

---

## Backwards Compatibility

- All existing task creation flows (Jira webhooks, Linear webhooks, GitHub Issues webhooks, dashboard `POST /api/tasks`, VS Code run issue, internal board card run) are completely untouched
- PRD import is an additive path that creates the same `KbBoard`/`KbCard`/`WorkerTask` records
- Once a card runs, it goes through the identical planner → critic → execution pipeline
- External tracker sync is optional and additive — existing webhook handlers gain a dedup check but no behavior change for non-PRD tickets
- The `prdAutoRun` org setting defaults to `false` — no behavior change for existing orgs
