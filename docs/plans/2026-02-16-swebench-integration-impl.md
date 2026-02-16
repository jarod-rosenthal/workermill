# SWE-bench Lite Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add repo override to KbCards and build a SWE-bench Lite benchmark runner script.

**Architecture:** Migration adds `github_repo` to `kb_cards` table, model and routes pass it through to `WorkerTask.githubRepo`. Standalone `bin/swebench` script downloads SWE-bench instances, clones repos, creates board cards, runs them, and collects diffs into JSONL predictions.

**Tech Stack:** TypeScript, TypeORM migrations, Express routes, node-fetch, child_process (git)

**Design doc:** `docs/plans/2026-02-16-swebench-integration-design.md`

---

## Part 1 — KbCard Repo Override

### Task 1: Migration — Add `github_repo` to `kb_cards`

**Files:**
- Create: `api/src/db/migrations/1706688000049-AddGithubRepoToKbCards.ts`
- Modify: `api/src/db/connection.ts:473` (register migration)

**Step 1: Create migration file**

Follow the exact pattern from `1706688000042-AddWorkerTaskToKbCards.ts`. Next available timestamp is `1706688000049`.

```typescript
// api/src/db/migrations/1706688000049-AddGithubRepoToKbCards.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddGithubRepoToKbCards1706688000049 implements MigrationInterface {
  name = "AddGithubRepoToKbCards1706688000049";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_cards"
      ADD COLUMN IF NOT EXISTS "github_repo" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kb_cards" DROP COLUMN IF EXISTS "github_repo"`);
  }
}
```

**Step 2: Register migration in connection.ts**

In `api/src/db/connection.ts`, add import at the top with the other migration imports, and add to the `migrations` array after `AddLogDeletionSafeguard1706688000048` (line 473):

```typescript
// Import (add with other migration imports)
import { AddGithubRepoToKbCards1706688000049 } from "./migrations/1706688000049-AddGithubRepoToKbCards.js";

// In migrations array, after AddLogDeletionSafeguard1706688000048:
    AddGithubRepoToKbCards1706688000049,
```

**Step 3: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: No new errors (pre-existing dotenv error is OK)

**Step 4: Commit**

```bash
git add api/src/db/migrations/1706688000049-AddGithubRepoToKbCards.ts api/src/db/connection.ts
git commit -m "feat: add github_repo column to kb_cards table"
```

---

### Task 2: KbCard model — Add `githubRepo` field

**Files:**
- Modify: `api/src/models/KbCard.ts:55` (add column after `workerTaskId`)

**Step 1: Add column to KbCard model**

After the `workerTaskId` column (line 57) and before `createdAt` (line 59), add:

```typescript
  @Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
  githubRepo: string | null;
```

**Step 2: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 3: Commit**

```bash
git add api/src/models/KbCard.ts
git commit -m "feat: add githubRepo field to KbCard model"
```

---

### Task 3: boards.ts — Wire repo override through card creation and task execution

**Files:**
- Modify: `api/src/routes/boards.ts:1021` (card creation — accept `githubRepo`)
- Modify: `api/src/routes/boards.ts:1185` (card update — accept `githubRepo`)
- Modify: `api/src/routes/boards.ts:149` (runCardAsWorkerTask — use `card.githubRepo`)
- Modify: `api/src/routes/boards.ts:572` (board GET response — include `githubRepo`)

**Step 1: Accept `githubRepo` in card creation POST**

In `POST /api/boards/:boardId/cards` (around line 1021), add validation:

```typescript
  body("githubRepo").optional().isString().isLength({ max: 255 }),
```

In the handler body destructuring (line 1030), add `githubRepo`:

```typescript
const { columnId, title, description, priority, dueDate, coverColor, githubRepo } = req.body;
```

In `cardRepo.create()` (line 1054), add:

```typescript
        githubRepo: githubRepo || null,
```

**Step 2: Accept `githubRepo` in card update PUT**

In the PUT handler (around line 1175), add validation:

```typescript
  body("githubRepo").optional().isString().isLength({ max: 255 }),
```

In the handler body destructuring (line 1185), add `githubRepo`:

```typescript
const { title, description, priority, dueDate, assigneeId, coverColor, githubRepo } = req.body;
```

After the existing field updates (after line 1206), add:

```typescript
      if (githubRepo !== undefined) card.githubRepo = githubRepo || null;
```

**Step 3: Use `card.githubRepo` in `runCardAsWorkerTask()`**

In `runCardAsWorkerTask()` (around line 148-152), change repo selection from:

```typescript
  // Repo
  const githubRepo = org.getDefaultRepo();
  if (!githubRepo) {
    throw new Error("No repository configured for organization");
  }
```

To:

```typescript
  // Repo — card-level override takes priority over org default
  const githubRepo = card.githubRepo || org.getDefaultRepo();
  if (!githubRepo) {
    throw new Error("No repository configured for organization");
  }
```

This requires loading `card.githubRepo` — check that the card query at line 68 already loads all columns (it does via `findOne`).

**Step 4: Include `githubRepo` in board GET response**

In the card mapping (around line 572), add `githubRepo` to the response object:

```typescript
              githubRepo: card.githubRepo,
```

Add it after `workerStatus` (line 585).

**Step 5: Verify typecheck**

Run: `cd api && npm run typecheck`
Expected: No new errors

**Step 6: Commit**

```bash
git add api/src/routes/boards.ts
git commit -m "feat: wire githubRepo override through board card creation and task execution"
```

---

## Part 2 — SWE-bench Runner Script

### Task 4: Create `bin/swebench` script — download and setup

**Files:**
- Create: `bin/swebench`

**Step 1: Create the script**

`bin/swebench` is a standalone executable TypeScript script using `tsx`. It handles the full benchmark workflow:

1. **Download** — Fetches SWE-bench Lite test split from HuggingFace Datasets API (Parquet → JSON)
2. **Sample** — Picks N instances (default 50), stratified across repos
3. **Clone** — Shallow-clones each unique repo, creates worktree per instance at `base_commit`
4. **Board setup** — Creates a "SWE-bench" KbBoard via the local API, adds one KbCard per instance
5. **Run** — Triggers cards via `POST /api/boards/:boardId/cards/:cardId/run` with concurrency limit
6. **Poll** — Watches task status until all complete or fail
7. **Collect** — Extracts diffs from worker branches, writes `swebench_predictions.jsonl`
8. **Report** — Prints summary table (pass/fail/error counts, cost, time)

The script uses:
- `node-fetch` or native fetch for API calls
- `child_process.execSync` for git operations
- No external npm dependencies beyond what's already in the monorepo

Key CLI flags:
- `--count N` (default 50) — number of instances to sample
- `--concurrency N` (default 4) — max concurrent workers
- `--api-url` (default `http://localhost:3001`) — WorkerMill API URL
- `--output` (default `swebench_predictions.jsonl`) — output file path
- `--repos-dir` (default `~/.swebench/repos`) — where to clone repos
- `--dry-run` — create board/cards but don't run them

Auth: The script needs a Bearer token to call the API. It reads from `WORKERMILL_TOKEN` env var or prompts for it.

**Step 2: Make executable**

```bash
chmod +x bin/swebench
```

**Step 3: Test download**

```bash
./bin/swebench --dry-run --count 5
```

Expected: Downloads dataset, samples 5 instances, prints their instance_ids, creates board, creates 5 cards, but doesn't run them.

**Step 4: Commit**

```bash
git add bin/swebench
git commit -m "feat: add SWE-bench Lite benchmark runner script"
```

---

### Task 5: End-to-end pilot run (manual verification)

**Prerequisites:**
- Local WorkerMill running (`./bin/local-workermill start`)
- GitHub token configured in org settings (for cloning public repos)

**Step 1: Run a 2-instance test**

```bash
./bin/swebench --count 2 --concurrency 1
```

Watch the WorkerMill dashboard at `http://localhost:5173` to see tasks appear and execute.

**Step 2: Verify predictions file**

```bash
cat swebench_predictions.jsonl | python3 -m json.tool
```

Each line should have `instance_id`, `model_name_or_path`, and `model_patch` fields.

**Step 3: Run the full 50-instance pilot**

```bash
./bin/swebench --count 50 --concurrency 4
```

Expected: ~40 minutes, produces `swebench_predictions.jsonl` with 50 entries.

**Step 4: Evaluate with SWE-bench harness (separate Python environment)**

```bash
pip install swebench
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path swebench_predictions.jsonl \
  --max_workers 8 \
  --run_id workermill_pilot
```

---

## Summary

| Task | Files | Estimated Time |
|------|-------|---------------|
| 1. Migration | 2 files (create + modify) | 2 min |
| 2. KbCard model | 1 file (modify) | 1 min |
| 3. boards.ts wiring | 1 file (modify, 4 spots) | 5 min |
| 4. bin/swebench script | 1 file (create) | 30 min |
| 5. End-to-end pilot | manual | ~40 min |
