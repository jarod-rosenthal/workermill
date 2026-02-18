# PRD-Driven Development — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to import a PRD and have WorkerMill decompose it into a board of dependency-ordered cards that each run through the existing planner/execution pipeline.

**Architecture:** New `POST /api/prd/decompose` endpoint accepts PRD content, spawns a Claude CLI decomposer agent, creates a KbBoard with KbCards and dependency relationships. Each card runs independently through the existing WorkerTask pipeline. A cascade engine auto-triggers dependent cards as predecessors complete.

**Tech Stack:** Express + TypeORM (API), Claude CLI (decomposer), React + TailwindCSS (frontend), VS Code Extension API (IDE)

**Design doc:** `docs/plans/2026-02-18-prd-driven-development-design.md`

---

## Task 1: Database Migration — Card Dependencies + Board PRD Fields

**Files:**
- Create: `api/src/db/migrations/1739750400003-AddPrdDecomposition.ts`
- Modify: `api/src/db/connection.ts` (import + register migration)

**Step 1: Create the migration file**

```typescript
// api/src/db/migrations/1739750400003-AddPrdDecomposition.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrdDecomposition1739750400003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Card dependencies join table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_card_dependencies (
        card_id uuid NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
        depends_on_card_id uuid NOT NULL REFERENCES kb_cards(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (card_id, depends_on_card_id),
        CHECK (card_id != depends_on_card_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kb_card_deps_depends_on
      ON kb_card_dependencies(depends_on_card_id)
    `);

    // 2. KbBoard PRD fields
    await queryRunner.query(`
      ALTER TABLE kb_boards
      ADD COLUMN IF NOT EXISTS prd_content text,
      ADD COLUMN IF NOT EXISTS prd_source varchar(20),
      ADD COLUMN IF NOT EXISTS github_repo varchar(255)
    `);

    // 3. Organization prdAutoRun setting
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS prd_auto_run boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS prd_auto_run`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS github_repo`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS prd_source`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS prd_content`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_card_dependencies`);
  }
}
```

**Step 2: Register the migration in `api/src/db/connection.ts`**

Add import after line ~235 (after `HashOrgApiKeys1739750400002`):
```typescript
import { AddPrdDecomposition1739750400003 } from "./migrations/1739750400003-AddPrdDecomposition.js";
```

Add to the `migrations` array just before the closing `]` (after `HashOrgApiKeys1739750400002`):
```typescript
    AddPrdDecomposition1739750400003,
```

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS (migration is standalone SQL, no model deps yet)

**Step 4: Commit**

```bash
git add api/src/db/migrations/1739750400003-AddPrdDecomposition.ts api/src/db/connection.ts
git commit -m "feat: add migration for PRD decomposition — card deps, board PRD fields, org setting"
```

---

## Task 2: KbCardDependency Model + Update KbCard/KbBoard/Organization Models

**Files:**
- Create: `api/src/models/KbCardDependency.ts`
- Modify: `api/src/models/KbCard.ts` (add dependency relations)
- Modify: `api/src/models/KbBoard.ts` (add `prdContent`, `prdSource`, `githubRepo`)
- Modify: `api/src/models/Organization.ts` (add `prdAutoRun`)
- Modify: `api/src/db/connection.ts` (register entity)

**Step 1: Create `KbCardDependency` model**

Follow the exact pattern from `api/src/models/KbCardLabel.ts`:

```typescript
// api/src/models/KbCardDependency.ts
import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { KbCard } from "./KbCard.js";

@Entity("kb_card_dependencies")
export class KbCardDependency {
  @PrimaryColumn({ name: "card_id", type: "uuid" })
  cardId: string;

  @PrimaryColumn({ name: "depends_on_card_id", type: "uuid" })
  dependsOnCardId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => KbCard, (card) => card.dependencies, { onDelete: "CASCADE" })
  @JoinColumn({ name: "card_id" })
  card: KbCard;

  @ManyToOne(() => KbCard, (card) => card.dependents, { onDelete: "CASCADE" })
  @JoinColumn({ name: "depends_on_card_id" })
  dependsOnCard: KbCard;
}
```

**Step 2: Add dependency relations to `KbCard`**

In `api/src/models/KbCard.ts`, add import and relations after the existing `cardLabels` relation:

```typescript
// Import at top (KbCardDependency uses string forward ref, so no circular import needed)

// Add after the cardLabels OneToMany:
@OneToMany("KbCardDependency", "card")
dependencies: KbCardDependency[];

@OneToMany("KbCardDependency", "dependsOnCard")
dependents: KbCardDependency[];
```

**Step 3: Add PRD columns to `KbBoard`**

In `api/src/models/KbBoard.ts`, add after the existing `template` column:

```typescript
@Column({ name: "prd_content", type: "text", nullable: true })
prdContent: string | null;

@Column({ name: "prd_source", type: "varchar", length: 20, nullable: true })
prdSource: string | null;

@Column({ name: "github_repo", type: "varchar", length: 255, nullable: true })
githubRepo: string | null;
```

**Step 4: Add `prdAutoRun` to `Organization`**

In `api/src/models/Organization.ts`, add after the existing `remoteAgentOnly` boolean (around line 397):

```typescript
@Column({ name: "prd_auto_run", type: "boolean", default: false })
prdAutoRun: boolean;
```

**Step 5: Register entity in `api/src/db/connection.ts`**

Add import with the other Kb model imports:
```typescript
import { KbCardDependency } from "../models/KbCardDependency.js";
```

Add `KbCardDependency` to the `entities` array (after the other Kb entities around line 300).

**Step 6: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 7: Commit**

```bash
git add api/src/models/KbCardDependency.ts api/src/models/KbCard.ts api/src/models/KbBoard.ts api/src/models/Organization.ts api/src/db/connection.ts
git commit -m "feat: add KbCardDependency model, PRD fields on KbBoard, prdAutoRun on Organization"
```

---

## Task 3: Card Dependency API Endpoints

**Files:**
- Modify: `api/src/routes/boards.ts` (add dependency CRUD + run-all + cancel-all)
- Modify: `frontend/src/lib/boards-api.ts` (add dependency types + API calls)

**Step 1: Add dependency CRUD endpoints in `api/src/routes/boards.ts`**

Add these routes after the existing card label routes. Import `KbCardDependency` at the top.

```typescript
// POST /api/boards/:boardId/cards/:cardId/dependencies — add dependency
router.post(
  "/:boardId/cards/:cardId/dependencies",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  body("dependsOnCardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { boardId, cardId } = req.params;
    const { dependsOnCardId } = req.body;
    const org = (req as any).org;

    // Verify both cards belong to this board
    const cardRepo = AppDataSource.getRepository(KbCard);
    const [card, depCard] = await Promise.all([
      cardRepo.findOne({ where: { id: cardId, boardId } }),
      cardRepo.findOne({ where: { id: dependsOnCardId, boardId } }),
    ]);
    if (!card || !depCard) return res.status(404).json({ error: "Card not found" });
    if (cardId === dependsOnCardId) return res.status(400).json({ error: "Card cannot depend on itself" });

    const depRepo = AppDataSource.getRepository(KbCardDependency);
    const existing = await depRepo.findOne({ where: { cardId, dependsOnCardId } });
    if (existing) return res.status(409).json({ error: "Dependency already exists" });

    const dep = depRepo.create({ cardId, dependsOnCardId });
    await depRepo.save(dep);
    res.status(201).json(dep);
  },
);

// DELETE /api/boards/:boardId/cards/:cardId/dependencies/:depCardId
router.delete(
  "/:boardId/cards/:cardId/dependencies/:depCardId",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  param("depCardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { cardId, depCardId } = req.params;
    const depRepo = AppDataSource.getRepository(KbCardDependency);
    const result = await depRepo.delete({ cardId, dependsOnCardId: depCardId });
    if (result.affected === 0) return res.status(404).json({ error: "Dependency not found" });
    res.json({ success: true });
  },
);

// GET /api/boards/:boardId/cards/:cardId/dependencies
router.get(
  "/:boardId/cards/:cardId/dependencies",
  param("boardId").isUUID(),
  param("cardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { cardId } = req.params;
    const depRepo = AppDataSource.getRepository(KbCardDependency);
    const deps = await depRepo.find({
      where: { cardId },
      relations: ["dependsOnCard"],
    });
    res.json(deps.map(d => ({
      cardId: d.dependsOnCardId,
      title: d.dependsOnCard?.title,
    })));
  },
);
```

**Step 2: Add `run-all` endpoint**

```typescript
// POST /api/boards/:boardId/run-all — execute all cards respecting dependencies
router.post(
  "/:boardId/run-all",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { boardId } = req.params;
    const org = (req as any).org;

    // Verify board belongs to org
    const boardRepo = AppDataSource.getRepository(KbBoard);
    const board = await boardRepo.findOne({ where: { id: boardId, orgId: org.id } });
    if (!board) return res.status(404).json({ error: "Board not found" });

    const { processUnblockedCards } = await import("../services/board-execution.js");
    const result = await processUnblockedCards(boardId, org.id);
    res.json(result);
  },
);
```

**Step 3: Add `cancel-all` endpoint**

```typescript
// POST /api/boards/:boardId/cancel-all — cancel all in-flight tasks for board
router.post(
  "/:boardId/cancel-all",
  param("boardId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    const { boardId } = req.params;
    const org = (req as any).org;

    const cardRepo = AppDataSource.getRepository(KbCard);
    const cards = await cardRepo.find({
      where: { boardId },
      relations: ["workerTask"],
    });

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    let cancelled = 0;
    for (const card of cards) {
      if (card.workerTask && !card.workerTask.isTerminal()) {
        await taskRepo.update(
          { id: card.workerTask.id },
          { status: "cancelled" },
        );
        cancelled++;
      }
    }
    res.json({ cancelled });
  },
);
```

**Step 4: Add frontend types and API calls in `frontend/src/lib/boards-api.ts`**

Add to the `Card` interface:
```typescript
dependencies?: { cardId: string; title: string }[];
dependents?: { cardId: string; title: string }[];
```

Add API functions:
```typescript
export async function runAllCards(boardId: string): Promise<{ triggered: number; stillBlocked: number; alreadyComplete: number }> {
  const { data } = await apiClient.post(`/api/boards/${boardId}/run-all`);
  return data;
}

export async function cancelAllCards(boardId: string): Promise<{ cancelled: number }> {
  const { data } = await apiClient.post(`/api/boards/${boardId}/cancel-all`);
  return data;
}

export async function addCardDependency(boardId: string, cardId: string, dependsOnCardId: string) {
  const { data } = await apiClient.post(`/api/boards/${boardId}/cards/${cardId}/dependencies`, { dependsOnCardId });
  return data;
}

export async function removeCardDependency(boardId: string, cardId: string, depCardId: string) {
  const { data } = await apiClient.delete(`/api/boards/${boardId}/cards/${cardId}/dependencies/${depCardId}`);
  return data;
}

export async function getCardDependencies(boardId: string, cardId: string) {
  const { data } = await apiClient.get(`/api/boards/${boardId}/cards/${cardId}/dependencies`);
  return data;
}
```

**Step 5: Run typecheck**

Run: `cd api && npm run typecheck && cd ../frontend && npx tsc -b`
Expected: PASS

**Step 6: Commit**

```bash
git add api/src/routes/boards.ts frontend/src/lib/boards-api.ts
git commit -m "feat: add card dependency CRUD, run-all, cancel-all API endpoints"
```

---

## Task 4: Board Execution Engine

**Files:**
- Create: `api/src/services/board-execution.ts`
- Modify: `api/src/services/task-monitor.ts` (call `processUnblockedCards` on card task completion)

**Step 1: Create `board-execution.ts`**

```typescript
// api/src/services/board-execution.ts
import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbCardDependency } from "../models/KbCardDependency.js";
import { KbBoard } from "../models/KbBoard.js";
import { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";

const TERMINAL_STATUSES = ["completed", "deployed"];
const ACTIVE_NON_TERMINAL = ["queued", "claimed", "planning", "executing", "environment_setup",
  "consolidating", "deploying", "dispatching", "pending_plan_approval", "review_requested",
  "pr_created", "pr_approved"];

export async function processUnblockedCards(
  boardId: string,
  orgId: string,
): Promise<{ triggered: number; stillBlocked: number; alreadyComplete: number }> {
  const cardRepo = AppDataSource.getRepository(KbCard);
  const depRepo = AppDataSource.getRepository(KbCardDependency);

  // Load all cards for this board with their linked worker tasks
  const cards = await cardRepo.find({
    where: { boardId },
    relations: ["workerTask"],
    order: { position: "ASC" },
  });

  // Load all dependencies for cards on this board
  const allDeps = await depRepo
    .createQueryBuilder("dep")
    .where("dep.card_id IN (:...cardIds)", {
      cardIds: cards.map((c) => c.id),
    })
    .getMany();

  // Build a map: cardId -> [dependsOnCardIds]
  const depsMap = new Map<string, string[]>();
  for (const dep of allDeps) {
    const list = depsMap.get(dep.cardId) || [];
    list.push(dep.dependsOnCardId);
    depsMap.set(dep.cardId, list);
  }

  // Build a map: cardId -> card (for status lookups)
  const cardMap = new Map(cards.map((c) => [c.id, c]));

  let triggered = 0;
  let stillBlocked = 0;
  let alreadyComplete = 0;

  // Dynamically import runCardAsWorkerTask to avoid circular deps
  const { runCardAsWorkerTask } = await import("../routes/boards.js");

  for (const card of cards) {
    // Skip cards that already have an active or complete task
    if (card.workerTask) {
      const status = card.workerTask.status;
      if (TERMINAL_STATUSES.includes(status)) {
        alreadyComplete++;
        continue;
      }
      if (ACTIVE_NON_TERMINAL.includes(status)) {
        continue; // already running
      }
      // Failed/cancelled — eligible for re-run but don't auto-trigger
      continue;
    }

    // Check if all dependencies are satisfied
    const depCardIds = depsMap.get(card.id) || [];
    const allDepsMet = depCardIds.every((depId) => {
      const depCard = cardMap.get(depId);
      return depCard?.workerTask && TERMINAL_STATUSES.includes(depCard.workerTask.status);
    });

    if (!allDepsMet) {
      stillBlocked++;
      continue;
    }

    // Card is unblocked — trigger it
    try {
      await runCardAsWorkerTask(card.id, orgId);
      triggered++;
      logger.info("PRD cascade: triggered card", {
        boardId,
        cardId: card.id,
        cardTitle: card.title,
      });
    } catch (err) {
      logger.error("PRD cascade: failed to trigger card", {
        boardId,
        cardId: card.id,
        error: String(err),
      });
    }
  }

  return { triggered, stillBlocked, alreadyComplete };
}
```

**Step 2: Export `runCardAsWorkerTask` from `boards.ts`**

In `api/src/routes/boards.ts`, change the function declaration from:
```typescript
async function runCardAsWorkerTask(cardId: string, orgId: string): Promise<WorkerTask> {
```
to:
```typescript
export async function runCardAsWorkerTask(cardId: string, orgId: string): Promise<WorkerTask> {
```

**Step 3: Integrate with `task-monitor.ts`**

In `api/src/services/task-monitor.ts`, after the existing `syncKbCardColumn` call (around line 1634), add:

```typescript
// After syncKbCardColumn succeeds, check if this unblocks dependent cards
if (["completed", "deployed"].includes(newStatus)) {
  try {
    const cardRepo = AppDataSource.getRepository(KbCard);
    const card = await cardRepo.findOne({
      where: { workerTaskId: task.id },
      relations: ["board"],
    });
    if (card?.board) {
      const org = await AppDataSource.getRepository(Organization).findOne({
        where: { id: card.board.orgId },
      });
      if (org?.prdAutoRun) {
        const { processUnblockedCards } = await import("./board-execution.js");
        await processUnblockedCards(card.board.id, card.board.orgId);
      }
    }
  } catch (cascadeErr) {
    logger.error("PRD cascade check failed", { taskId: task.id, error: String(cascadeErr) });
  }
}
```

Add necessary imports at the top of `task-monitor.ts`:
```typescript
import { KbCard } from "../models/KbCard.js";
import { Organization } from "../models/Organization.js";
```

**Step 4: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/services/board-execution.ts api/src/routes/boards.ts api/src/services/task-monitor.ts
git commit -m "feat: add board execution engine — cascade-triggers dependent cards on completion"
```

---

## Task 5: PRD Decomposer Service

**Files:**
- Create: `api/src/services/prd-decomposer.ts`

**Step 1: Create the decomposer service**

This service takes PRD content and returns structured card data. For the cloud API path, it uses the Vercel AI SDK (same as existing multi-provider support) to call Claude. For the remote agent path, the agent will have its own decomposer that uses Claude CLI.

```typescript
// api/src/services/prd-decomposer.ts
import { logger } from "../utils/logger.js";

export interface DecomposedCard {
  title: string;
  description: string;
  persona: string;
  priority: "urgent" | "high" | "medium" | "low";
  dependencyIndices: number[];
  labels: string[];
  estimatedSteps: number;
}

export interface DecomposedPrd {
  boardName: string;
  cards: DecomposedCard[];
}

const DECOMPOSER_SYSTEM_PROMPT = `You are a product decomposer for WorkerMill, an AI worker orchestration platform. Given a PRD (Product Requirements Document), break it into discrete, implementable epic-sized cards.

## Card Sizing Rules

Each card should represent one cohesive epic — a vertical slice or architectural layer that produces a single PR. Target 7-12 deliverables per card.

Calibration:
- "Project Setup & Dev Environment" is ALWAYS card 1 (scaffold, CI/CD, base config, shared types, auth setup)
- "Core Backend" — models, API routes, auth middleware, seed data for one domain
- "Feature UI" — all pages/components for one user-facing feature
- "Integrations" — external APIs, email, calendar, webhooks
- "Production Deploy & Validation" is ALWAYS the last card (deploy scripts, smoke tests, monitoring, final polish)

A card with 15+ deliverables is too big — split it. A card with fewer than 4 deliverables is too small — merge it into a related card.

## Card Description Format

Each card description MUST include these sections:

### Epic Overview
2-3 sentences describing what this card delivers.

### Scope Boundary
- What prior cards already created (do NOT recreate)
- What this card creates
- What future cards will create (do NOT touch)

### Prerequisites
Which prior cards must complete first.

### Deliverables
Numbered list of concrete deliverables (files, endpoints, components, tests).

### Technical Specification
Specific implementation details: file paths, API shapes, data models, UI layouts.

## Output Format

Return ONLY valid JSON (no markdown fences, no commentary):

{
  "boardName": "Project Name",
  "cards": [
    {
      "title": "Card 1: Project Setup & Dev Environment",
      "description": "## Epic Overview\\n\\n...",
      "persona": "devops_engineer",
      "priority": "high",
      "dependencyIndices": [],
      "labels": [],
      "estimatedSteps": 10
    }
  ]
}

## Self-Check

Before returning, verify:
1. Card 1 is always project setup. Last card is always deploy/validation.
2. Every card has 4-15 deliverables.
3. Every card has a Scope Boundary section.
4. dependencyIndices reference valid array positions (0-based).
5. No circular dependencies.
6. Personas are from: backend_developer, frontend_developer, devops_engineer, security_engineer, qa_engineer, tech_writer, project_manager.`;

export async function decomposePrd(
  prdContent: string,
  model: string,
  apiKey?: string,
): Promise<DecomposedPrd> {
  const userPrompt = `Decompose this PRD into implementation cards:\n\n${prdContent}`;

  // Use Anthropic API directly (same pattern as critic-agent.ts)
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("No Anthropic API key available for PRD decomposition");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: DECOMPOSER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as {
    content: { type: string; text: string }[];
  };
  const text = data.content.find((c) => c.type === "text")?.text || "";

  // Parse JSON — handle potential markdown fences
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: DecomposedPrd;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.error("PRD decomposer returned invalid JSON", { text: text.substring(0, 500) });
    throw new Error("PRD decomposer returned invalid JSON");
  }

  // Validate structure
  if (!parsed.boardName || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    throw new Error("PRD decomposer returned empty or invalid structure");
  }

  for (const card of parsed.cards) {
    if (!card.title || !card.description) {
      throw new Error(`Card missing title or description: ${JSON.stringify(card).substring(0, 200)}`);
    }
    // Validate dependency indices are in range
    for (const idx of card.dependencyIndices || []) {
      if (idx < 0 || idx >= parsed.cards.length) {
        throw new Error(`Card "${card.title}" has invalid dependency index: ${idx}`);
      }
    }
  }

  return parsed;
}
```

**Step 2: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/services/prd-decomposer.ts
git commit -m "feat: add PRD decomposer service — Claude API call with sizing heuristics"
```

---

## Task 6: PRD API Route

**Files:**
- Create: `api/src/routes/prd.ts`
- Modify: `api/src/routes/index.ts` or main Express app file (register route)

**Step 1: Find where routes are registered**

Check `api/src/index.ts` or `api/src/app.ts` for the `app.use("/api/...", router)` pattern. Follow existing pattern exactly.

**Step 2: Create `api/src/routes/prd.ts`**

```typescript
// api/src/routes/prd.ts
import { Router, type Request, type Response } from "express";
import { body, validationResult } from "express-validator";
import { authenticateRequest } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { KbBoard } from "../models/KbBoard.js";
import { KbCard } from "../models/KbCard.js";
import { KbColumn } from "../models/KbColumn.js";
import { KbCardDependency } from "../models/KbCardDependency.js";
import { KbLabel } from "../models/KbLabel.js";
import { KbCardLabel } from "../models/KbCardLabel.js";
import { decomposePrd } from "../services/prd-decomposer.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.use(authenticateRequest);

// ─── Helper: derive board prefix (same as boards.ts) ───────────────────────

function derivePrefix(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 5).map((w) => w[0]).join("").toUpperCase();
  }
  const word = words[0] || "";
  if (word.length <= 3) return word.toUpperCase();
  return word.substring(0, 3).toUpperCase();
}

async function generateUniquePrefix(orgId: string, name: string): Promise<string> {
  const boardRepo = AppDataSource.getRepository(KbBoard);
  let prefix = derivePrefix(name);
  const existing = await boardRepo
    .createQueryBuilder("b")
    .select("b.prefix")
    .where("b.orgId = :orgId", { orgId })
    .getMany();
  const usedPrefixes = new Set(existing.map((b) => b.prefix));
  if (!usedPrefixes.has(prefix)) return prefix;
  for (let i = 2; i < 100; i++) {
    const candidate = `${prefix}${i}`;
    if (!usedPrefixes.has(candidate)) return candidate;
  }
  return `${prefix}${Date.now() % 1000}`;
}

// ─── POST /api/prd/decompose ────────────────────────────────────────────────

router.post(
  "/decompose",
  body("source").isIn(["text", "file", "url", "repo"]),
  body("content").optional().isString(),
  body("fileUrl").optional().isString(),
  body("repoPath").optional().isString(),
  body("githubRepo").optional().isString(),
  body("boardName").optional().isString().isLength({ max: 200 }),
  body("syncToTracker").optional().isBoolean(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const org = (req as any).org;
    const { source, content, fileUrl, repoPath, githubRepo, boardName, syncToTracker } = req.body;

    // 1. Resolve PRD content
    let prdContent: string;
    try {
      if (source === "text") {
        if (!content) return res.status(400).json({ error: "content is required for text source" });
        prdContent = content;
      } else if (source === "url") {
        if (!fileUrl) return res.status(400).json({ error: "fileUrl is required for url source" });
        const resp = await fetch(fileUrl, { signal: AbortSignal.timeout(30000) });
        if (!resp.ok) throw new Error(`Failed to fetch URL: ${resp.status}`);
        prdContent = await resp.text();
      } else if (source === "repo") {
        if (!repoPath || !githubRepo) {
          return res.status(400).json({ error: "repoPath and githubRepo are required for repo source" });
        }
        // Fetch file from SCM API
        prdContent = await fetchRepoFile(org, githubRepo, repoPath);
      } else if (source === "file") {
        if (!content) return res.status(400).json({ error: "content (base64) is required for file source" });
        prdContent = Buffer.from(content, "base64").toString("utf-8");
      } else {
        return res.status(400).json({ error: "Invalid source" });
      }
    } catch (err) {
      logger.error("PRD content resolution failed", { source, error: String(err) });
      return res.status(400).json({ error: `Failed to resolve PRD content: ${(err as Error).message}` });
    }

    if (!prdContent || prdContent.length < 10) {
      return res.status(400).json({ error: "PRD content is too short" });
    }
    if (prdContent.length > 100000) {
      return res.status(400).json({ error: "PRD content exceeds 100KB limit" });
    }

    // 2. Run PRD Decomposer
    let decomposed;
    try {
      decomposed = await decomposePrd(prdContent, org.defaultWorkerModel || "claude-sonnet-4-20250514");
    } catch (err) {
      logger.error("PRD decomposition failed", { error: String(err) });
      return res.status(500).json({ error: `PRD decomposition failed: ${(err as Error).message}` });
    }

    // 3. Create KbBoard
    const boardRepo = AppDataSource.getRepository(KbBoard);
    const colRepo = AppDataSource.getRepository(KbColumn);
    const cardRepo = AppDataSource.getRepository(KbCard);
    const depRepo = AppDataSource.getRepository(KbCardDependency);

    const finalBoardName = boardName || decomposed.boardName;
    const prefix = await generateUniquePrefix(org.id, finalBoardName);

    const board = boardRepo.create({
      orgId: org.id,
      name: finalBoardName,
      prefix,
      prdContent,
      prdSource: source,
      githubRepo: githubRepo || null,
      createdById: (req as any).user?.id || null,
    });
    await boardRepo.save(board);

    // Create default columns
    const columnDefs = [
      { name: "To Do", position: 0, color: "#6b7280" },
      { name: "In Progress", position: 1, color: "#f59e0b" },
      { name: "Review", position: 2, color: "#8b5cf6" },
      { name: "Approved", position: 3, color: "#3b82f6" },
      { name: "Done", position: 4, color: "#10b981" },
    ];
    const columns: KbColumn[] = [];
    for (const def of columnDefs) {
      const col = colRepo.create({ boardId: board.id, ...def });
      await colRepo.save(col);
      columns.push(col);
    }
    const todoColumn = columns[0];

    // 4. Create KbCards with auto-incrementing card numbers
    const createdCards: KbCard[] = [];
    for (let i = 0; i < decomposed.cards.length; i++) {
      const cardDef = decomposed.cards[i];

      // Atomically get next card number
      const result = await boardRepo
        .createQueryBuilder()
        .update(KbBoard)
        .set({ nextCardNumber: () => "next_card_number + 1" })
        .where("id = :id", { id: board.id })
        .returning("next_card_number - 1 as card_number")
        .execute();
      const cardNumber = result.raw[0]?.card_number ?? i + 1;

      const card = cardRepo.create({
        boardId: board.id,
        columnId: todoColumn.id,
        title: cardDef.title,
        description: cardDef.description,
        priority: cardDef.priority || "high",
        position: i,
        cardNumber,
        githubRepo: githubRepo || null,
      });
      await cardRepo.save(card);
      createdCards.push(card);

      // Create persona label if specified
      if (cardDef.persona) {
        await ensureCardLabel(org.id, card.id, cardDef.persona);
      }
      // Create additional labels
      for (const labelName of cardDef.labels || []) {
        await ensureCardLabel(org.id, card.id, labelName);
      }
    }

    // 5. Create dependencies
    for (let i = 0; i < decomposed.cards.length; i++) {
      const cardDef = decomposed.cards[i];
      for (const depIdx of cardDef.dependencyIndices || []) {
        if (depIdx >= 0 && depIdx < createdCards.length && depIdx !== i) {
          const dep = depRepo.create({
            cardId: createdCards[i].id,
            dependsOnCardId: createdCards[depIdx].id,
          });
          await depRepo.save(dep);
        }
      }
    }

    // 6. (Optional) Sync to external tracker — Task 8

    // 7. If prdAutoRun, trigger first wave
    if (org.prdAutoRun) {
      const { processUnblockedCards } = await import("../services/board-execution.js");
      await processUnblockedCards(board.id, org.id).catch((err: unknown) => {
        logger.error("PRD auto-run failed", { boardId: board.id, error: String(err) });
      });
    }

    // 8. Return result
    res.status(201).json({
      boardId: board.id,
      boardName: finalBoardName,
      prefix,
      cardCount: createdCards.length,
      cards: createdCards.map((c, i) => ({
        id: c.id,
        cardNumber: c.cardNumber,
        title: c.title,
        dependencies: decomposed.cards[i].dependencyIndices,
        estimatedSteps: decomposed.cards[i].estimatedSteps,
      })),
    });
  },
);

// ─── Helper: fetch file from repo via SCM API ──────────────────────────────

async function fetchRepoFile(org: any, repo: string, filePath: string): Promise<string> {
  const scmProvider = org.scmProvider || "github";

  if (scmProvider === "github") {
    const token = org.githubToken;
    if (!token) throw new Error("No GitHub token configured for this organization");
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}: file not found at ${filePath}`);
    return resp.text();
  } else if (scmProvider === "bitbucket") {
    const token = org.bitbucketToken;
    if (!token) throw new Error("No Bitbucket token configured");
    const url = `https://api.bitbucket.org/2.0/repositories/${repo}/src/HEAD/${encodeURIComponent(filePath)}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Bitbucket API ${resp.status}: file not found`);
    return resp.text();
  } else if (scmProvider === "gitlab") {
    const token = org.gitlabToken;
    if (!token) throw new Error("No GitLab token configured");
    const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(repo)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=HEAD`;
    const resp = await fetch(url, {
      headers: { "PRIVATE-TOKEN": token },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`GitLab API ${resp.status}: file not found`);
    return resp.text();
  }
  throw new Error(`Unsupported SCM provider: ${scmProvider}`);
}

// ─── Helper: ensure label exists and attach to card ─────────────────────────

async function ensureCardLabel(orgId: string, cardId: string, labelName: string): Promise<void> {
  const labelRepo = AppDataSource.getRepository(KbLabel);
  const cardLabelRepo = AppDataSource.getRepository(KbCardLabel);

  let label = await labelRepo.findOne({ where: { orgId, name: labelName } });
  if (!label) {
    label = labelRepo.create({ orgId, name: labelName, color: "#6b7280" });
    await labelRepo.save(label);
  }

  const existing = await cardLabelRepo.findOne({ where: { cardId, labelId: label.id } });
  if (!existing) {
    const cl = cardLabelRepo.create({ cardId, labelId: label.id });
    await cardLabelRepo.save(cl);
  }
}

export default router;
```

**Step 3: Register the route**

Find the main app file (likely `api/src/app.ts` or `api/src/index.ts`) where routes are registered. Add:

```typescript
import prdRoutes from "./routes/prd.js";
// ...
app.use("/api/prd", prdRoutes);
```

**Step 4: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/prd.ts api/src/app.ts
git commit -m "feat: add POST /api/prd/decompose — PRD import creates board with dependency-ordered cards"
```

---

## Task 7: Webhook Dedup for PRD-Synced Tickets

**Files:**
- Modify: `api/src/routes/webhooks/jira.ts`
- Modify: `api/src/routes/webhooks/github-issues.ts`
- Modify: `api/src/routes/webhooks/linear.ts`

**Step 1: Add dedup check in Jira webhook**

In `api/src/routes/webhooks/jira.ts`, after the existing task lookup (around line 182, after `existingTask` is fetched), add:

```typescript
// Check if this issue was created by PRD decomposition (linked to a board card)
const prdCard = await AppDataSource.getRepository(KbCard).findOne({
  where: { workerTaskId: existingTask?.id },
  relations: ["board"],
});
if (!prdCard) {
  // Also check by issue key — the card may not have a workerTask yet
  // (PRD-synced tickets have jiraIssueKey matching a card on a PRD board)
  const boardCardRepo = AppDataSource.getRepository(KbCard);
  const matchingCard = await boardCardRepo
    .createQueryBuilder("card")
    .innerJoin("card.board", "board")
    .where("board.orgId = :orgId", { orgId: org.id })
    .andWhere("board.prd_content IS NOT NULL")
    .andWhere("CONCAT(board.prefix, '-', card.card_number) = :key", { key: issueKey })
    .getOne();
  if (matchingCard) {
    logger.info("Jira webhook: skipping PRD-synced ticket (managed by board)", { issueKey });
    return res.json({ status: "ignored", reason: "PRD-managed ticket" });
  }
}
```

Import `KbCard` at the top of the file.

**Step 2: Apply same pattern to GitHub Issues and Linear webhooks**

Same dedup check — if the incoming issue key matches a card on a PRD board, skip task creation. The exact insertion point varies per webhook but the logic is identical.

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/webhooks/jira.ts api/src/routes/webhooks/github-issues.ts api/src/routes/webhooks/linear.ts
git commit -m "feat: add webhook dedup for PRD-synced tickets — skip task creation for board-managed issues"
```

---

## Task 8: External Tracker Sync (Jira/Linear/GitHub Issue Creation)

**Files:**
- Create: `api/src/services/tracker-sync.ts`
- Modify: `api/src/routes/prd.ts` (call sync after board creation)

**Step 1: Create `tracker-sync.ts`**

```typescript
// api/src/services/tracker-sync.ts
import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbBoard } from "../models/KbBoard.js";
import { Organization } from "../models/Organization.js";
import { getOrgCredentials } from "./org-credentials.js";
import { logger } from "../utils/logger.js";

interface SyncResult {
  synced: number;
  failed: number;
  tracker: string;
  issueKeys: string[];
}

export async function syncBoardToTracker(
  boardId: string,
  orgId: string,
): Promise<SyncResult | null> {
  const org = await AppDataSource.getRepository(Organization).findOneBy({ id: orgId });
  if (!org) throw new Error("Organization not found");

  const tracker = org.issueTrackerProvider;
  if (!tracker || tracker === "internal") return null;

  const creds = await getOrgCredentials(orgId);
  const board = await AppDataSource.getRepository(KbBoard).findOneBy({ id: boardId });
  if (!board) throw new Error("Board not found");

  const cards = await AppDataSource.getRepository(KbCard).find({
    where: { boardId },
    order: { position: "ASC" },
  });

  const result: SyncResult = { synced: 0, failed: 0, tracker, issueKeys: [] };

  if (tracker === "jira") {
    await syncToJira(org, creds, board, cards, result);
  } else if (tracker === "github") {
    await syncToGitHub(org, creds, board, cards, result);
  } else if (tracker === "linear") {
    await syncToLinear(org, creds, board, cards, result);
  }

  return result;
}

async function syncToJira(
  org: Organization,
  creds: any,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const baseUrl = creds.jiraBaseUrl;
  const auth = `Basic ${Buffer.from(`${creds.jiraEmail}:${creds.jiraApiToken}`).toString("base64")}`;
  const projectKey = org.jiraProjectKey || board.prefix;

  for (const card of cards) {
    try {
      const resp = await fetch(`${baseUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: card.title,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: card.description || card.title }],
                },
              ],
            },
            issuetype: { name: "Story" },
            labels: ["workermill"],
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data = (await resp.json()) as { key: string };
        // Update card with Jira key — don't use jiraIssueKey column on card,
        // store as a reference for the workerTask when card runs
        const cardRepo = AppDataSource.getRepository(KbCard);
        // Store the external key in the card title prefix for now
        // The workerTask created by runCardAsWorkerTask will use board prefix + card number
        result.issueKeys.push(data.key);
        result.synced++;
        logger.info("Synced card to Jira", { cardId: card.id, jiraKey: data.key });
      } else {
        const errText = await resp.text().catch(() => "");
        logger.warn("Failed to sync card to Jira", { cardId: card.id, status: resp.status, error: errText });
        result.failed++;
      }
    } catch (err) {
      logger.error("Jira sync error", { cardId: card.id, error: String(err) });
      result.failed++;
    }
  }
}

async function syncToGitHub(
  org: Organization,
  creds: any,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const token = creds.githubToken;
  const repo = board.githubRepo || org.githubDefaultRepo;
  if (!repo || !token) {
    logger.warn("GitHub sync skipped: no repo or token");
    return;
  }

  for (const card of cards) {
    try {
      const resp = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          title: card.title,
          body: card.description || card.title,
          labels: ["workermill"],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data = (await resp.json()) as { number: number };
        result.issueKeys.push(`#${data.number}`);
        result.synced++;
      } else {
        result.failed++;
      }
    } catch (err) {
      logger.error("GitHub sync error", { cardId: card.id, error: String(err) });
      result.failed++;
    }
  }
}

async function syncToLinear(
  org: Organization,
  creds: any,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const token = creds.linearApiKey;
  const teamId = creds.linearTeamId;
  if (!token || !teamId) {
    logger.warn("Linear sync skipped: no token or team");
    return;
  }

  for (const card of cards) {
    try {
      const resp = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `mutation { issueCreate(input: { teamId: "${teamId}", title: "${card.title.replace(/"/g, '\\"')}", description: "${(card.description || "").replace(/"/g, '\\"').replace(/\n/g, '\\n')}" }) { success issue { identifier } } }`,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const data = (await resp.json()) as { data?: { issueCreate?: { issue?: { identifier: string } } } };
        const id = data.data?.issueCreate?.issue?.identifier;
        if (id) {
          result.issueKeys.push(id);
          result.synced++;
        } else {
          result.failed++;
        }
      } else {
        result.failed++;
      }
    } catch (err) {
      logger.error("Linear sync error", { cardId: card.id, error: String(err) });
      result.failed++;
    }
  }
}
```

**Step 2: Wire sync into `prd.ts`**

In `api/src/routes/prd.ts`, replace the `// 6. (Optional) Sync to external tracker — Task 8` comment with:

```typescript
// 6. Sync to external tracker if applicable
const shouldSync = syncToTracker !== false && org.issueTrackerProvider && org.issueTrackerProvider !== "internal";
let trackerSync = null;
if (shouldSync) {
  try {
    const { syncBoardToTracker } = await import("../services/tracker-sync.js");
    trackerSync = await syncBoardToTracker(board.id, org.id);
  } catch (err) {
    logger.warn("External tracker sync failed (non-blocking)", { error: String(err) });
  }
}
```

Add `trackerSync` to the response JSON.

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/services/tracker-sync.ts api/src/routes/prd.ts
git commit -m "feat: add external tracker sync — creates Jira/GitHub/Linear issues from PRD cards"
```

---

## Task 9: Agent Local API — PRD Proxy Route

**Files:**
- Modify: `agent/src/local-api.ts` (add POST /api/prd/build proxy)

**Step 1: Add the proxy route**

In `agent/src/local-api.ts`, after the existing `POST /api/tasks/run` block (around line 383), add:

```typescript
// POST /api/prd/build — decompose PRD via cloud API
if (req.method === "POST" && path === "/api/prd/build") {
  if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
  try {
    const body = JSON.parse(await readBody(req));
    const result = await cloudProxy("POST", "/api/prd/decompose", body);
    return json(res, result, 201);
  } catch (err: unknown) {
    const e = err as { status?: number; data?: unknown; message?: string };
    const status = e.status || 500;
    if (e.data) return json(res, e.data, status);
    return json(res, { error: e.message || String(err) }, status);
  }
}
```

**Step 2: Run typecheck**

Run: `cd agent && npm run typecheck`
Expected: PASS (ignore the known `dotenv/config` type error)

**Step 3: Commit**

```bash
git add agent/src/local-api.ts
git commit -m "feat: add POST /api/prd/build proxy route to agent local API"
```

---

## Task 10: VS Code Extension — Build from PRD Command

**Files:**
- Modify: `packages/vscode-workermill/package.json` (add command + context menu)
- Modify: `packages/vscode-workermill/src/extension.ts` (register command handler)

**Step 1: Add command to `package.json`**

In `packages/vscode-workermill/package.json`, add to the `contributes.commands` array:

```json
{
  "command": "workermill.buildFromPrd",
  "title": "WorkerMill: Build from PRD",
  "icon": "$(rocket)"
}
```

Add context menu entry for `.md` files in `contributes.menus`:

```json
"explorer/context": [
  {
    "command": "workermill.buildFromPrd",
    "when": "resourceExtname == .md",
    "group": "workermill@1"
  }
]
```

Add editor title button:

```json
"editor/title": [
  {
    "command": "workermill.buildFromPrd",
    "when": "resourceExtname == .md",
    "group": "navigation"
  }
]
```

**Step 2: Register command in `extension.ts`**

Add after the existing command registrations (inside `context.subscriptions.push(...)`):

```typescript
vscode.commands.registerCommand(
  "workermill.buildFromPrd",
  async (uri?: vscode.Uri) => {
    if (!client.isConnected()) {
      vscode.window.showErrorMessage(
        "WorkerMill agent is not running. Start with: workermill-agent start",
      );
      return;
    }

    // Get file content — from context menu URI or active editor
    let fileContent: string;
    let fileName: string;
    if (uri) {
      const doc = await vscode.workspace.openTextDocument(uri);
      fileContent = doc.getText();
      fileName = uri.fsPath.split("/").pop() || "PRD.md";
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No file open. Open a PRD markdown file first.");
        return;
      }
      fileContent = editor.document.getText();
      fileName = editor.document.fileName.split("/").pop() || "PRD.md";
    }

    if (!fileContent.trim()) {
      vscode.window.showErrorMessage("File is empty.");
      return;
    }

    // Detect git remote for githubRepo
    let githubRepo: string | undefined;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      try {
        const { exec } = require("child_process");
        const result = await new Promise<string>((resolve) => {
          exec(
            "git remote get-url origin",
            { cwd: workspaceFolder.uri.fsPath },
            (_err: unknown, stdout: string) => resolve(stdout?.trim() || ""),
          );
        });
        // Parse "git@github.com:owner/repo.git" or "https://github.com/owner/repo.git"
        const match = result.match(/github\.com[:/](.+?)(?:\.git)?$/);
        if (match) githubRepo = match[1];
      } catch {
        // Ignore — githubRepo is optional
      }
    }

    // Infer board name from first heading
    const headingMatch = fileContent.match(/^#\s+(.+)$/m);
    const defaultName = headingMatch ? headingMatch[1].trim() : fileName.replace(/\.md$/, "");

    const boardName = await vscode.window.showInputBox({
      prompt: "Board name for this PRD",
      value: defaultName,
      placeHolder: "My Project",
    });
    if (!boardName) return; // User cancelled

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "WorkerMill: Decomposing PRD...",
        cancellable: false,
      },
      async () => {
        try {
          const result = await client.post("/api/prd/build", {
            source: "text",
            content: fileContent,
            githubRepo,
            boardName,
          });

          const cardCount = result.cardCount || result.cards?.length || 0;
          const action = await vscode.window.showInformationMessage(
            `Board "${result.boardName}" created with ${cardCount} cards`,
            "Open in Dashboard",
          );
          if (action === "Open in Dashboard") {
            vscode.env.openExternal(
              vscode.Uri.parse(`https://workermill.com/boards/${result.boardId}`),
            );
          }
        } catch (err: unknown) {
          const msg = (err as { message?: string })?.message || String(err);
          vscode.window.showErrorMessage(`PRD decomposition failed: ${msg}`);
        }
      },
    );
  },
),
```

**Step 3: Build and typecheck**

Run: `cd packages/vscode-workermill && npm run typecheck && npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/vscode-workermill/package.json packages/vscode-workermill/src/extension.ts
git commit -m "feat: VS Code extension — Build from PRD command with context menu and editor button"
```

---

## Task 11: Frontend — PRD Import Tab in Create Board Dialog

**Files:**
- Modify: `frontend/src/pages/Boards/CreateBoardDialog.tsx` (add PRD import tab)
- Modify: `frontend/src/lib/boards-api.ts` (add decompose API call)

**Step 1: Add decompose API function to `boards-api.ts`**

```typescript
export interface DecomposeResult {
  boardId: string;
  boardName: string;
  prefix: string;
  cardCount: number;
  cards: { id: string; cardNumber: number; title: string; dependencies: number[]; estimatedSteps: number }[];
  trackerSync?: { synced: number; failed: number; tracker: string; issueKeys: string[] } | null;
}

export async function decomposePrd(data: {
  source: "text" | "file" | "url" | "repo";
  content?: string;
  fileUrl?: string;
  repoPath?: string;
  githubRepo?: string;
  boardName?: string;
}): Promise<DecomposeResult> {
  const { data: result } = await apiClient.post("/api/prd/decompose", data);
  return result;
}
```

**Step 2: Add PRD import tab to `CreateBoardDialog.tsx`**

This is a significant UI addition. Add a tab selector at the top of the dialog: "New Board" | "Import from PRD". When "Import from PRD" is selected, show:

- Source selector (4 buttons: Paste, Upload, URL, Repo)
- Content area (textarea for paste, file drop zone for upload, text input for URL, repo+path inputs for repo)
- Board name input
- Target repo input
- "Decompose" button
- Progress/result state

The full component code is lengthy — implement it following the existing dialog's styling patterns (TailwindCSS classes, Lucide icons, same button/input styles). Key states:

```typescript
type PrdSource = "text" | "file" | "url" | "repo";
type DialogMode = "template" | "prd";
type PrdState = "input" | "loading" | "success" | "error";

// In the component:
const [mode, setMode] = useState<DialogMode>("template");
const [prdSource, setPrdSource] = useState<PrdSource>("text");
const [prdContent, setPrdContent] = useState("");
const [prdUrl, setPrdUrl] = useState("");
const [prdRepoPath, setPrdRepoPath] = useState("");
const [prdGithubRepo, setPrdGithubRepo] = useState("");
const [prdState, setPrdState] = useState<PrdState>("input");
const [prdResult, setPrdResult] = useState<DecomposeResult | null>(null);
const [prdError, setPrdError] = useState<string | null>(null);
```

**Step 3: Run typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/Boards/CreateBoardDialog.tsx frontend/src/lib/boards-api.ts
git commit -m "feat: frontend — PRD import tab in Create Board dialog with multi-source input"
```

---

## Task 12: Frontend — Dependency Indicators on Board

**Files:**
- Modify: `frontend/src/pages/Boards/CardItem.tsx` (lock icon, muted state for blocked cards)
- Modify: `frontend/src/pages/Boards/CardDetail.tsx` (dependency section)
- Modify: `frontend/src/pages/Boards/BoardView.tsx` (Run All button, PRD badge, load dependencies)

**Step 1: Update `CardItem.tsx`**

Add blocked state detection and visual indicators:

```typescript
// Add to CardItemProps:
isBlocked?: boolean;
dependencyCount?: number;

// In the component render, wrap the card content:
// If blocked, add opacity-50 and a Lock icon overlay
{isBlocked && (
  <div className="absolute top-1 right-1 text-gray-400" title="Blocked by dependencies">
    <Lock className="w-3.5 h-3.5" />
  </div>
)}
```

Import `Lock` from `lucide-react`.

**Step 2: Update `CardDetail.tsx`**

Add a "Dependencies" section showing upstream and downstream cards:

```typescript
// After existing card detail sections, add:
{card.dependencies && card.dependencies.length > 0 && (
  <div className="mt-4">
    <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">Depends on</h4>
    <div className="flex flex-wrap gap-1.5">
      {card.dependencies.map((dep) => (
        <span key={dep.cardId} className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">
          {dep.title}
        </span>
      ))}
    </div>
  </div>
)}
```

**Step 3: Update `BoardView.tsx`**

Add "Run All" button in the board header (visible when board has `prdContent`):

```typescript
// In the board header area, after the board name:
{board.prdContent && (
  <>
    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-xs">
      From PRD
    </span>
    <button
      onClick={() => handleRunAll()}
      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center gap-1.5"
    >
      <Play className="w-3.5 h-3.5" />
      Run All
    </button>
  </>
)}
```

Add the board type to include PRD fields — update the `BoardDetail` interface in `boards-api.ts`:

```typescript
export interface BoardDetail {
  // ... existing fields
  prdContent: string | null;
  prdSource: string | null;
  githubRepo: string | null;
}
```

**Step 4: Run typecheck and lint**

Run: `cd frontend && npx tsc -b && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/Boards/CardItem.tsx frontend/src/pages/Boards/CardDetail.tsx frontend/src/pages/Boards/BoardView.tsx frontend/src/lib/boards-api.ts
git commit -m "feat: frontend — dependency indicators on cards, Run All button, PRD badge on boards"
```

---

## Task 13: Organization Settings — prdAutoRun Toggle

**Files:**
- Modify: `api/src/routes/settings.ts` (expose prdAutoRun in settings CRUD)
- Modify: Frontend settings page (add toggle)

**Step 1: Add `prdAutoRun` to settings route**

In `api/src/routes/settings.ts`, find the settings update handler and add `prdAutoRun` to the list of allowed boolean fields. Follow the same pattern as `autoReviewEnabled`, `autoDeployEnabled`, etc.

**Step 2: Add toggle to frontend settings**

Find the org settings page in the frontend (likely `frontend/src/pages/Settings/` or similar). Add a toggle switch for "Auto-run PRD cards" in the automation section, following the pattern of existing toggles (auto-review, auto-deploy).

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck && cd ../frontend && npx tsc -b`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/settings.ts frontend/src/pages/Settings/
git commit -m "feat: add prdAutoRun toggle to org settings"
```

---

## Task 14: Include Dependencies in Board API Response

**Files:**
- Modify: `api/src/routes/boards.ts` (include dependencies when returning board detail and cards)

**Step 1: Update the GET board detail endpoint**

Find the `GET /api/boards/:boardId` handler that returns the full board with columns and cards. Add dependency loading:

When loading cards, add `relations: ["dependencies", "dependencies.dependsOnCard"]` or a query builder join. Then include dependencies in the card response:

```typescript
// In the card serialization:
dependencies: (card.dependencies || []).map((d) => ({
  cardId: d.dependsOnCardId,
  title: d.dependsOnCard?.title || null,
})),
```

Also include the new board fields in the response: `prdContent`, `prdSource`, `githubRepo`.

**Step 2: Update the run-card endpoint to enforce dependencies**

In `api/src/routes/boards.ts`, in the `POST /:boardId/cards/:cardId/run` handler, add a dependency check before calling `runCardAsWorkerTask`:

```typescript
// Check if card has unmet dependencies
const depRepo = AppDataSource.getRepository(KbCardDependency);
const deps = await depRepo.find({
  where: { cardId },
  relations: ["dependsOnCard", "dependsOnCard.workerTask"],
});
const unmetDeps = deps.filter((d) => {
  const depTask = d.dependsOnCard?.workerTask;
  return !depTask || !["completed", "deployed"].includes(depTask.status);
});
if (unmetDeps.length > 0) {
  const blockers = unmetDeps.map((d) => d.dependsOnCard?.title).join(", ");
  return res.status(409).json({
    error: `Card is blocked by: ${blockers}`,
    blockedBy: unmetDeps.map((d) => d.dependsOnCardId),
  });
}
```

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/boards.ts
git commit -m "feat: include card dependencies in board API response, enforce deps on card run"
```

---

## Task 15: Integration Testing

**Files:**
- Create: `api/src/services/prd-decomposer.test.ts`
- Create: `api/src/services/board-execution.test.ts`

**Step 1: Test the decomposer output parsing**

```typescript
// api/src/services/prd-decomposer.test.ts
import { describe, it, expect } from "vitest";

describe("PRD Decomposer", () => {
  it("validates dependency indices are in range", () => {
    // Test that invalid dependency indices throw
  });

  it("rejects empty card arrays", () => {
    // Test validation
  });

  it("rejects cards without title or description", () => {
    // Test validation
  });
});
```

**Step 2: Test the board execution engine**

```typescript
// api/src/services/board-execution.test.ts
import { describe, it, expect, vi } from "vitest";

describe("processUnblockedCards", () => {
  it("triggers cards with no dependencies", () => {
    // Mock card repo, verify runCardAsWorkerTask called
  });

  it("skips cards with unmet dependencies", () => {
    // Mock card with incomplete dependency, verify NOT called
  });

  it("triggers cards when all dependencies complete", () => {
    // Mock card with all deps completed, verify called
  });

  it("does not re-trigger cards with active tasks", () => {
    // Mock card with running task, verify NOT called
  });
});
```

**Step 3: Run tests**

Run: `cd api && npx vitest run src/services/prd-decomposer.test.ts src/services/board-execution.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/services/prd-decomposer.test.ts api/src/services/board-execution.test.ts
git commit -m "test: add unit tests for PRD decomposer and board execution engine"
```

---

## Task 16: Final Typecheck + Lint Pass

**Step 1: Full typecheck across all packages**

Run: `cd api && npm run typecheck`
Run: `cd frontend && npx tsc -b`
Run: `cd agent && npm run typecheck`
Run: `cd packages/vscode-workermill && npm run typecheck`

Expected: All PASS

**Step 2: Lint**

Run: `cd api && npm run lint`
Run: `cd frontend && npm run lint`

Expected: All PASS (or only pre-existing warnings)

**Step 3: Run existing test suites**

Run: `cd api && npm run test`

Expected: All existing tests still pass, no regressions

**Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: fix lint and type errors from PRD-driven development feature"
```

---

## Execution Order & Dependencies

```
Task 1 (Migration)
  └─► Task 2 (Models)
        └─► Task 3 (Dependency API)
        └─► Task 4 (Execution Engine)
        └─► Task 5 (Decomposer Service)
              └─► Task 6 (PRD Route)
                    └─► Task 7 (Webhook Dedup)
                    └─► Task 8 (Tracker Sync)
              └─► Task 9 (Agent Proxy)
                    └─► Task 10 (VS Code Command)
        └─► Task 11 (Frontend PRD Import)
        └─► Task 12 (Frontend Deps UI)
        └─► Task 13 (Settings Toggle)
        └─► Task 14 (Board API Response)
Task 15 (Tests) — can run after Tasks 4-5
Task 16 (Final checks) — runs last
```

Tasks 3, 4, 5, 11, 12, 13, 14 can run in parallel after Task 2 completes.
