# Spec Engineering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make specifications a first-class entity in WorkerMill — stored, versioned, scored with 5-dimension quality rubric, org-level templates, quality gates, and public documentation.

**Architecture:** Three new TypeORM entities (KbSpec, KbSpecTemplate, KbSpecVersion), new Express route file, Zustand store, and three frontend pages (list, editor, docs). Quality scoring calls Anthropic Claude API with a structured rubric prompt. Org settings gate decomposition on minimum quality score. The existing PRD decompose endpoint is enhanced to accept a specId.

**Tech Stack:** TypeORM entities + migrations, Express routes, Zustand store, React pages with TailwindCSS, Anthropic Claude API for scoring.

**Design Doc:** `docs/plans/2026-02-27-spec-engineering-design.md`

---

## Task 1: Database Migrations

**Files:**
- Create: `api/src/db/migrations/1741800000000-AddSpecEngineering.ts`
- Modify: `api/src/db/connection.ts` (register migration)

**Step 1: Create the migration file**

```typescript
// api/src/db/migrations/1741800000000-AddSpecEngineering.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSpecEngineering1741800000000 implements MigrationInterface {
  name = "AddSpecEngineering1741800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Spec templates table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_spec_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        name varchar(255) NOT NULL,
        description text,
        content text NOT NULL,
        required_sections jsonb DEFAULT '[]',
        is_default boolean DEFAULT false,
        is_public boolean DEFAULT false,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_template_org FOREIGN KEY (org_id)
          REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spec_templates_org_id ON kb_spec_templates(org_id)
    `);

    // Specs table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_specs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        title varchar(500) NOT NULL,
        content text,
        status varchar(50) NOT NULL DEFAULT 'draft',
        quality_score int,
        quality_feedback jsonb,
        template_id uuid,
        version int NOT NULL DEFAULT 1,
        created_by uuid,
        board_id uuid,
        metadata jsonb DEFAULT '{}',
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_org FOREIGN KEY (org_id)
          REFERENCES organizations(id) ON DELETE CASCADE,
        CONSTRAINT fk_spec_template FOREIGN KEY (template_id)
          REFERENCES kb_spec_templates(id) ON DELETE SET NULL,
        CONSTRAINT fk_spec_board FOREIGN KEY (board_id)
          REFERENCES kb_boards(id) ON DELETE SET NULL,
        CONSTRAINT fk_spec_created_by FOREIGN KEY (created_by)
          REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_org_id ON kb_specs(org_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_board_id ON kb_specs(board_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_specs_status ON kb_specs(status)
    `);

    // Spec version history table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kb_spec_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        spec_id uuid NOT NULL,
        content text NOT NULL,
        quality_score int,
        version int NOT NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_spec_version_spec FOREIGN KEY (spec_id)
          REFERENCES kb_specs(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_spec_versions_spec_id ON kb_spec_versions(spec_id)
    `);

    // Add spec_id to kb_boards for lineage
    await queryRunner.query(`
      ALTER TABLE kb_boards
      ADD COLUMN IF NOT EXISTS spec_id uuid,
      ADD CONSTRAINT fk_board_spec FOREIGN KEY (spec_id)
        REFERENCES kb_specs(id) ON DELETE SET NULL
    `);

    // Add org-level spec settings
    await queryRunner.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS spec_min_quality_score int DEFAULT 0,
      ADD COLUMN IF NOT EXISTS spec_required_sections jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS spec_required_sections`);
    await queryRunner.query(`ALTER TABLE organizations DROP COLUMN IF EXISTS spec_min_quality_score`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP CONSTRAINT IF EXISTS fk_board_spec`);
    await queryRunner.query(`ALTER TABLE kb_boards DROP COLUMN IF EXISTS spec_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_spec_versions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_specs CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS kb_spec_templates CASCADE`);
  }
}
```

**Step 2: Register migration in connection.ts**

In `api/src/db/connection.ts`:
- Import: `import { AddSpecEngineering1741800000000 } from "./migrations/1741800000000-AddSpecEngineering.js";`
- Add `AddSpecEngineering1741800000000` to the `migrations` array (at the end)

**Step 3: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/db/migrations/1741800000000-AddSpecEngineering.ts api/src/db/connection.ts
git commit -m "feat(db): add spec engineering tables — KbSpec, KbSpecTemplate, KbSpecVersion"
```

---

## Task 2: TypeORM Entity Models

**Files:**
- Create: `api/src/models/KbSpec.ts`
- Create: `api/src/models/KbSpecTemplate.ts`
- Create: `api/src/models/KbSpecVersion.ts`
- Modify: `api/src/models/KbBoard.ts` (add specId column)
- Modify: `api/src/models/Organization.ts` (add spec settings columns)
- Modify: `api/src/models/index.ts` (export new entities)
- Modify: `api/src/db/connection.ts` (register entities)

**Step 1: Create KbSpecTemplate entity**

```typescript
// api/src/models/KbSpecTemplate.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";

@Entity("kb_spec_templates")
@Index(["orgId"])
export class KbSpecTemplate {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 255 })
  name: string;

  @Column({ type: "text", nullable: true })
  description: string | null;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "required_sections", type: "jsonb", default: () => "'[]'" })
  requiredSections: string[];

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault: boolean;

  @Column({ name: "is_public", type: "boolean", default: false })
  isPublic: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;
}
```

**Step 2: Create KbSpec entity**

```typescript
// api/src/models/KbSpec.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { Organization } from "./Organization.js";
import { KbSpecTemplate } from "./KbSpecTemplate.js";
import { KbSpecVersion } from "./KbSpecVersion.js";

export type SpecStatus = "draft" | "validated" | "decomposed" | "archived";

export interface QualityDimensionScore {
  score: number;
  feedback: string;
}

export interface QualityFeedback {
  overall: number;
  dimensions: {
    completeness: QualityDimensionScore;
    clarity: QualityDimensionScore;
    decomposability: QualityDimensionScore;
    constraints: QualityDimensionScore;
    testability: QualityDimensionScore;
  };
  suggestions: string[];
}

@Entity("kb_specs")
@Index(["orgId"])
@Index(["boardId"])
@Index(["status"])
export class KbSpec {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "org_id", type: "uuid" })
  orgId: string;

  @Column({ type: "varchar", length: 500 })
  title: string;

  @Column({ type: "text", nullable: true })
  content: string | null;

  @Column({ type: "varchar", length: 50, default: "draft" })
  status: SpecStatus;

  @Column({ name: "quality_score", type: "int", nullable: true })
  qualityScore: number | null;

  @Column({ name: "quality_feedback", type: "jsonb", nullable: true })
  qualityFeedback: QualityFeedback | null;

  @Column({ name: "template_id", type: "uuid", nullable: true })
  templateId: string | null;

  @Column({ type: "int", default: 1 })
  version: number;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy: string | null;

  @Column({ name: "board_id", type: "uuid", nullable: true })
  boardId: string | null;

  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => Organization, { onDelete: "CASCADE" })
  @JoinColumn({ name: "org_id" })
  organization: Organization;

  @ManyToOne(() => KbSpecTemplate, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "template_id" })
  template: KbSpecTemplate | null;

  @OneToMany(() => KbSpecVersion, (v) => v.spec)
  versions: KbSpecVersion[];
}
```

**Step 3: Create KbSpecVersion entity**

```typescript
// api/src/models/KbSpecVersion.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { KbSpec } from "./KbSpec.js";

@Entity("kb_spec_versions")
@Index(["specId"])
export class KbSpecVersion {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "spec_id", type: "uuid" })
  specId: string;

  @Column({ type: "text" })
  content: string;

  @Column({ name: "quality_score", type: "int", nullable: true })
  qualityScore: number | null;

  @Column({ type: "int" })
  version: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @ManyToOne(() => KbSpec, (s) => s.versions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "spec_id" })
  spec: KbSpec;
}
```

**Step 4: Add specId column to KbBoard**

In `api/src/models/KbBoard.ts`, add:
```typescript
@Column({ name: "spec_id", type: "uuid", nullable: true })
specId: string | null;
```

**Step 5: Add org spec settings to Organization**

In `api/src/models/Organization.ts`, add:
```typescript
@Column({ name: "spec_min_quality_score", type: "int", default: 0 })
specMinQualityScore: number;

@Column({ name: "spec_required_sections", type: "jsonb", nullable: true })
specRequiredSections: string[] | null;
```

**Step 6: Export from models/index.ts**

Add to `api/src/models/index.ts`:
```typescript
export { KbSpec, type SpecStatus, type QualityFeedback, type QualityDimensionScore } from "./KbSpec.js";
export { KbSpecTemplate } from "./KbSpecTemplate.js";
export { KbSpecVersion } from "./KbSpecVersion.js";
```

**Step 7: Register entities in connection.ts**

In `api/src/db/connection.ts`:
- Import the 3 new entities
- Add them to the `entities` array

**Step 8: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 9: Commit**

```bash
git add api/src/models/KbSpec.ts api/src/models/KbSpecTemplate.ts api/src/models/KbSpecVersion.ts api/src/models/KbBoard.ts api/src/models/Organization.ts api/src/models/index.ts api/src/db/connection.ts
git commit -m "feat(models): add KbSpec, KbSpecTemplate, KbSpecVersion entities"
```

---

## Task 3: Spec Quality Scoring Service

**Files:**
- Create: `api/src/services/spec-scorer.ts`

**Step 1: Create the scoring service**

```typescript
// api/src/services/spec-scorer.ts
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import type { QualityFeedback } from "../models/KbSpec.js";

const SCORING_RUBRIC = `You are a specification quality evaluator for AI coding agents. Score the following specification on 5 dimensions.

## Scoring Dimensions (total = 100 weighted)

### Completeness (weight: 30%)
Does the spec include these sections?
- Overview/deliverables
- Technical specification with version constraints
- Data model (database schema)
- Architecture (file structure, patterns)
- API specification (endpoints)
- Component specification (UI)
- Quality gates (lint, test, typecheck commands)
- Acceptance criteria
- Scope boundary ("DO NOT" section)
Score 0-100 based on coverage. Missing critical sections (scope boundary, version constraints) penalize heavily.

### Clarity (weight: 20%)
- Are requirements testable and unambiguous?
- No vague language ("should be fast", "nice UI", "good UX")
- Specific values instead of qualitative descriptions
- Clear input/output expectations
Score 0-100.

### Decomposability (weight: 20%)
- Can this be broken into independent stories?
- Are dependencies between components explicit?
- Are stories small enough for a single worker?
- Is execution order clear?
Score 0-100.

### Constraints (weight: 15%)
- Are dependency versions pinned (exact or semver range)?
- Is the tech stack specific (not "a modern framework")?
- Are "DO NOT" sections present and specific?
- Are scope boundaries clear?
Score 0-100.

### Testability (weight: 15%)
- Are acceptance criteria measurable (not subjective)?
- Are quality gate commands specified?
- Are test expectations concrete?
- Can a machine verify success?
Score 0-100.

## Response Format

Return ONLY valid JSON matching this schema:
{
  "overall": <weighted score 0-100>,
  "dimensions": {
    "completeness": { "score": <0-100>, "feedback": "<specific feedback>" },
    "clarity": { "score": <0-100>, "feedback": "<specific feedback>" },
    "decomposability": { "score": <0-100>, "feedback": "<specific feedback>" },
    "constraints": { "score": <0-100>, "feedback": "<specific feedback>" },
    "testability": { "score": <0-100>, "feedback": "<specific feedback>" }
  },
  "suggestions": [
    "<actionable suggestion 1>",
    "<actionable suggestion 2>",
    "<actionable suggestion 3>"
  ]
}

Return 3-5 suggestions, ordered by impact. Each suggestion must be actionable (tell the user exactly what to add or change).`;

export async function scoreSpec(
  specContent: string,
  orgRequiredSections?: string[] | null,
): Promise<QualityFeedback> {
  const anthropic = new Anthropic();

  let systemPrompt = SCORING_RUBRIC;
  if (orgRequiredSections?.length) {
    systemPrompt += `\n\n## Organization Required Sections\nThis organization requires these additional sections: ${orgRequiredSections.join(", ")}. Penalize completeness if missing.`;
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Score this specification:\n\n${specContent}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.error("Failed to parse scoring response", { text });
    throw new Error("Failed to parse quality score response");
  }

  const feedback = JSON.parse(jsonMatch[0]) as QualityFeedback;

  // Validate the weighted overall score
  const d = feedback.dimensions;
  const expectedOverall = Math.round(
    d.completeness.score * 0.3 +
      d.clarity.score * 0.2 +
      d.decomposability.score * 0.2 +
      d.constraints.score * 0.15 +
      d.testability.score * 0.15,
  );
  // Use the LLM's overall if close, recalculate if off by more than 5
  if (Math.abs(feedback.overall - expectedOverall) > 5) {
    feedback.overall = expectedOverall;
  }

  return feedback;
}
```

**Step 2: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/services/spec-scorer.ts
git commit -m "feat(services): add spec quality scoring service with 5-dimension rubric"
```

---

## Task 4: Spec API Routes

**Files:**
- Create: `api/src/routes/specs.ts`
- Modify: `api/src/routes/index.ts` (export new router)
- Modify: `api/src/index.ts` (mount route)

**Step 1: Create specs route file**

```typescript
// api/src/routes/specs.ts
import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { KbSpec, KbSpecTemplate, KbSpecVersion, KbBoard } from "../models/index.js";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";
import { scoreSpec } from "../services/spec-scorer.js";
import { logger } from "../utils/logger.js";

const router = Router();

router.use(authenticateUser);
router.use(requireCurrentTos);

// =============================================================================
// GET /api/specs — List specs for org
// =============================================================================
router.get(
  "/",
  query("status").optional().isString(),
  query("templateId").optional().isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { status, templateId } = req.query;

      const qb = AppDataSource.getRepository(KbSpec)
        .createQueryBuilder("spec")
        .where("spec.orgId = :orgId", { orgId: org.id })
        .andWhere("spec.status != :archived", { archived: "archived" })
        .orderBy("spec.updatedAt", "DESC");

      if (status) qb.andWhere("spec.status = :status", { status });
      if (templateId) qb.andWhere("spec.templateId = :templateId", { templateId });

      const specs = await qb.getMany();
      res.json(specs);
    } catch (error) {
      logger.error("Error listing specs", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to list specs" });
    }
  },
);

// =============================================================================
// POST /api/specs — Create spec
// =============================================================================
router.post(
  "/",
  body("title").isString().isLength({ min: 1, max: 500 }).withMessage("title must be 1-500 chars"),
  body("content").optional().isString(),
  body("templateId").optional().isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user;
      const { title, content, templateId } = req.body;

      const repo = AppDataSource.getRepository(KbSpec);

      // If templateId provided, load template content as starting point
      let specContent = content || null;
      if (templateId && !content) {
        const template = await AppDataSource.getRepository(KbSpecTemplate).findOne({
          where: [
            { id: templateId, orgId: org.id },
            { id: templateId, isPublic: true },
          ],
        });
        if (template) {
          specContent = template.content;
        }
      }

      const spec = repo.create({
        orgId: org.id,
        title,
        content: specContent,
        templateId: templateId || null,
        createdBy: user?.id || null,
        status: "draft",
        version: 1,
      });
      await repo.save(spec);

      logger.info("Spec created", { specId: spec.id, orgId: org.id });
      res.status(201).json(spec);
    } catch (error) {
      logger.error("Error creating spec", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to create spec" });
    }
  },
);

// =============================================================================
// GET /api/specs/:specId — Get single spec
// =============================================================================
router.get(
  "/:specId",
  param("specId").isUUID().withMessage("specId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { specId } = req.params;

      const spec = await AppDataSource.getRepository(KbSpec).findOne({
        where: { id: specId, orgId: org.id },
      });
      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      res.json(spec);
    } catch (error) {
      logger.error("Error fetching spec", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to fetch spec" });
    }
  },
);

// =============================================================================
// PUT /api/specs/:specId — Update spec content (creates version snapshot)
// =============================================================================
router.put(
  "/:specId",
  param("specId").isUUID(),
  body("title").optional().isString().isLength({ min: 1, max: 500 }),
  body("content").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { specId } = req.params;
      const { title, content } = req.body;

      const repo = AppDataSource.getRepository(KbSpec);
      const spec = await repo.findOne({ where: { id: specId, orgId: org.id } });
      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      // Save current version as snapshot before updating
      if (content && content !== spec.content) {
        const versionRepo = AppDataSource.getRepository(KbSpecVersion);
        await versionRepo.save(
          versionRepo.create({
            specId: spec.id,
            content: spec.content || "",
            qualityScore: spec.qualityScore,
            version: spec.version,
          }),
        );
        spec.version += 1;
        spec.content = content;
        // Invalidate quality score when content changes
        spec.qualityScore = null;
        spec.qualityFeedback = null;
      }

      if (title) spec.title = title;

      await repo.save(spec);

      logger.info("Spec updated", { specId: spec.id, version: spec.version });
      res.json(spec);
    } catch (error) {
      logger.error("Error updating spec", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to update spec" });
    }
  },
);

// =============================================================================
// DELETE /api/specs/:specId — Archive spec (soft delete)
// =============================================================================
router.delete(
  "/:specId",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { specId } = req.params;

      const result = await AppDataSource.getRepository(KbSpec).update(
        { id: specId, orgId: org.id },
        { status: "archived" as const },
      );

      if (result.affected === 0) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      logger.error("Error archiving spec", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to archive spec" });
    }
  },
);

// =============================================================================
// POST /api/specs/:specId/score — Run quality scoring
// =============================================================================
router.post(
  "/:specId/score",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { specId } = req.params;

      const repo = AppDataSource.getRepository(KbSpec);
      const spec = await repo.findOne({ where: { id: specId, orgId: org.id } });
      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      if (!spec.content || spec.content.trim().length < 50) {
        res.status(400).json({ error: "Spec content is too short to score (minimum 50 characters)" });
        return;
      }

      logger.info("Scoring spec", { specId: spec.id });
      const feedback = await scoreSpec(spec.content, org.specRequiredSections);

      // Update spec with score
      await repo.update(
        { id: spec.id },
        {
          qualityScore: feedback.overall,
          qualityFeedback: feedback,
          status: spec.status === "draft" ? "validated" : spec.status,
        },
      );

      res.json(feedback);
    } catch (error) {
      logger.error("Error scoring spec", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to score spec" });
    }
  },
);

// =============================================================================
// GET /api/specs/:specId/versions — List version history
// =============================================================================
router.get(
  "/:specId/versions",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { specId } = req.params;

      // Verify spec belongs to org
      const spec = await AppDataSource.getRepository(KbSpec).findOne({
        where: { id: specId, orgId: org.id },
      });
      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      const versions = await AppDataSource.getRepository(KbSpecVersion).find({
        where: { specId },
        order: { version: "DESC" },
      });

      res.json(versions);
    } catch (error) {
      logger.error("Error fetching spec versions", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to fetch spec versions" });
    }
  },
);

// =============================================================================
// Spec Templates
// =============================================================================

// GET /api/specs/templates — List available templates (org + public)
router.get(
  "/templates/list",
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;

      const templates = await AppDataSource.getRepository(KbSpecTemplate)
        .createQueryBuilder("t")
        .where("t.orgId = :orgId OR t.isPublic = true", { orgId: org.id })
        .orderBy("t.isPublic", "ASC")
        .addOrderBy("t.name", "ASC")
        .getMany();

      res.json(templates);
    } catch (error) {
      logger.error("Error listing templates", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to list templates" });
    }
  },
);

// POST /api/specs/templates — Create org template
router.post(
  "/templates",
  body("name").isString().isLength({ min: 1, max: 255 }),
  body("content").isString().isLength({ min: 1 }),
  body("description").optional().isString(),
  body("requiredSections").optional().isArray(),
  body("isDefault").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { name, content, description, requiredSections, isDefault } = req.body;

      const repo = AppDataSource.getRepository(KbSpecTemplate);

      // If setting as default, unset other defaults
      if (isDefault) {
        await repo.update({ orgId: org.id, isDefault: true }, { isDefault: false });
      }

      const template = repo.create({
        orgId: org.id,
        name,
        content,
        description: description || null,
        requiredSections: requiredSections || [],
        isDefault: isDefault || false,
        isPublic: false,
      });
      await repo.save(template);

      res.status(201).json(template);
    } catch (error) {
      logger.error("Error creating template", { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({ error: "Failed to create template" });
    }
  },
);

export default router;
```

**Step 2: Register in routes/index.ts**

Add to `api/src/routes/index.ts`:
```typescript
export { default as specsRouter } from "./specs.js";
```

**Step 3: Mount in api/src/index.ts**

Add import and mount:
```typescript
// In the import block:
specsRouter,

// After the boards mount:
app.use("/api/specs", authenticatedLimiter, specsRouter);
```

**Step 4: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/routes/specs.ts api/src/routes/index.ts api/src/index.ts
git commit -m "feat(api): add /api/specs routes — CRUD, scoring, templates, versions"
```

---

## Task 5: Enhance PRD Decompose to Accept specId

**Files:**
- Modify: `api/src/routes/prd.ts`

**Step 1: Add specId support to the decompose endpoint**

In `api/src/routes/prd.ts`, in the POST `/decompose` handler:

1. Add optional `specId` to the body validation:
```typescript
body("specId").optional().isUUID(),
```

2. After extracting request body, add spec handling:
```typescript
// If specId provided, load spec and validate quality gate
let specContent = content;
let spec: KbSpec | null = null;
if (req.body.specId) {
  const specRepo = AppDataSource.getRepository(KbSpec);
  spec = await specRepo.findOne({ where: { id: req.body.specId, orgId: org.id } });
  if (!spec) {
    res.status(404).json({ error: "Spec not found" });
    return;
  }
  if (!spec.content) {
    res.status(400).json({ error: "Spec has no content" });
    return;
  }

  // Check quality gate
  if (org.specMinQualityScore > 0 && (spec.qualityScore === null || spec.qualityScore < org.specMinQualityScore)) {
    res.status(400).json({
      error: `Spec quality score (${spec.qualityScore ?? "not scored"}) is below org minimum (${org.specMinQualityScore})`,
    });
    return;
  }

  specContent = spec.content;
}
```

3. After board creation, link spec to board:
```typescript
// After board is created and saved:
if (spec) {
  await AppDataSource.getRepository(KbSpec).update(
    { id: spec.id },
    { boardId: board.id, status: "decomposed" },
  );
  await AppDataSource.getRepository(KbBoard).update(
    { id: board.id },
    { specId: spec.id },
  );
}
```

4. Add import for KbSpec at the top of the file.

**Step 2: Run typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/routes/prd.ts
git commit -m "feat(prd): accept specId param — quality gate enforcement + board lineage"
```

---

## Task 6: Frontend API Client + Store

**Files:**
- Create: `frontend/src/lib/specs-api.ts`
- Create: `frontend/src/store/specs-store.ts`

**Step 1: Create API client**

```typescript
// frontend/src/lib/specs-api.ts
import apiClient from "./api-client";

export interface Spec {
  id: string;
  orgId: string;
  title: string;
  content: string | null;
  status: "draft" | "validated" | "decomposed" | "archived";
  qualityScore: number | null;
  qualityFeedback: QualityFeedback | null;
  templateId: string | null;
  version: number;
  createdBy: string | null;
  boardId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface QualityDimensionScore {
  score: number;
  feedback: string;
}

export interface QualityFeedback {
  overall: number;
  dimensions: {
    completeness: QualityDimensionScore;
    clarity: QualityDimensionScore;
    decomposability: QualityDimensionScore;
    constraints: QualityDimensionScore;
    testability: QualityDimensionScore;
  };
  suggestions: string[];
}

export interface SpecTemplate {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  content: string;
  requiredSections: string[];
  isDefault: boolean;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpecVersion {
  id: string;
  specId: string;
  content: string;
  qualityScore: number | null;
  version: number;
  createdAt: string;
}

export interface CreateSpecData {
  title: string;
  content?: string;
  templateId?: string;
}

export interface UpdateSpecData {
  title?: string;
  content?: string;
}

export async function getSpecs(params?: { status?: string; templateId?: string }): Promise<Spec[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.templateId) searchParams.set("templateId", params.templateId);
  const qs = searchParams.toString();
  const response = await apiClient.get(`/api/specs${qs ? `?${qs}` : ""}`);
  return response.data;
}

export async function getSpec(specId: string): Promise<Spec> {
  const response = await apiClient.get(`/api/specs/${specId}`);
  return response.data;
}

export async function createSpec(data: CreateSpecData): Promise<Spec> {
  const response = await apiClient.post("/api/specs", data);
  return response.data;
}

export async function updateSpec(specId: string, data: UpdateSpecData): Promise<Spec> {
  const response = await apiClient.put(`/api/specs/${specId}`, data);
  return response.data;
}

export async function deleteSpec(specId: string): Promise<void> {
  await apiClient.delete(`/api/specs/${specId}`);
}

export async function scoreSpec(specId: string): Promise<QualityFeedback> {
  const response = await apiClient.post(`/api/specs/${specId}/score`);
  return response.data;
}

export async function getSpecVersions(specId: string): Promise<SpecVersion[]> {
  const response = await apiClient.get(`/api/specs/${specId}/versions`);
  return response.data;
}

export async function getSpecTemplates(): Promise<SpecTemplate[]> {
  const response = await apiClient.get("/api/specs/templates/list");
  return response.data;
}

export async function createSpecTemplate(data: {
  name: string;
  content: string;
  description?: string;
  requiredSections?: string[];
  isDefault?: boolean;
}): Promise<SpecTemplate> {
  const response = await apiClient.post("/api/specs/templates", data);
  return response.data;
}
```

**Step 2: Create Zustand store**

```typescript
// frontend/src/store/specs-store.ts
import { create } from "zustand";
import type { Spec, QualityFeedback, SpecTemplate, SpecVersion, CreateSpecData, UpdateSpecData } from "../lib/specs-api";
import * as specsApi from "../lib/specs-api";

interface SpecsState {
  specs: Spec[];
  currentSpec: Spec | null;
  templates: SpecTemplate[];
  versions: SpecVersion[];
  isLoading: boolean;
  isScoring: boolean;
  error: string | null;

  fetchSpecs: (params?: { status?: string; templateId?: string }) => Promise<void>;
  fetchSpec: (specId: string) => Promise<void>;
  createSpec: (data: CreateSpecData) => Promise<Spec>;
  updateSpec: (specId: string, data: UpdateSpecData) => Promise<void>;
  deleteSpec: (specId: string) => Promise<void>;
  scoreSpec: (specId: string) => Promise<QualityFeedback>;
  fetchVersions: (specId: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;

  setCurrentSpec: (spec: Spec | null) => void;
  clearError: () => void;
}

export const useSpecsStore = create<SpecsState>((set, get) => ({
  specs: [],
  currentSpec: null,
  templates: [],
  versions: [],
  isLoading: false,
  isScoring: false,
  error: null,

  fetchSpecs: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const specs = await specsApi.getSpecs(params);
      set({ specs, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch specs", isLoading: false });
    }
  },

  fetchSpec: async (specId) => {
    set({ isLoading: true, error: null });
    try {
      const spec = await specsApi.getSpec(specId);
      set({ currentSpec: spec, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch spec", isLoading: false });
    }
  },

  createSpec: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const spec = await specsApi.createSpec(data);
      set((state) => ({ specs: [spec, ...state.specs], isLoading: false }));
      return spec;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to create spec", isLoading: false });
      throw error;
    }
  },

  updateSpec: async (specId, data) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await specsApi.updateSpec(specId, data);
      set((state) => ({
        specs: state.specs.map((s) => (s.id === specId ? updated : s)),
        currentSpec: state.currentSpec?.id === specId ? updated : state.currentSpec,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to update spec", isLoading: false });
      throw error;
    }
  },

  deleteSpec: async (specId) => {
    set({ isLoading: true, error: null });
    try {
      await specsApi.deleteSpec(specId);
      set((state) => ({
        specs: state.specs.filter((s) => s.id !== specId),
        currentSpec: state.currentSpec?.id === specId ? null : state.currentSpec,
        isLoading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to delete spec", isLoading: false });
      throw error;
    }
  },

  scoreSpec: async (specId) => {
    set({ isScoring: true, error: null });
    try {
      const feedback = await specsApi.scoreSpec(specId);
      // Refresh the spec to get updated score
      const spec = await specsApi.getSpec(specId);
      set((state) => ({
        specs: state.specs.map((s) => (s.id === specId ? spec : s)),
        currentSpec: state.currentSpec?.id === specId ? spec : state.currentSpec,
        isScoring: false,
      }));
      return feedback;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to score spec", isScoring: false });
      throw error;
    }
  },

  fetchVersions: async (specId) => {
    try {
      const versions = await specsApi.getSpecVersions(specId);
      set({ versions });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch versions" });
    }
  },

  fetchTemplates: async () => {
    try {
      const templates = await specsApi.getSpecTemplates();
      set({ templates });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Failed to fetch templates" });
    }
  },

  setCurrentSpec: (spec) => set({ currentSpec: spec }),
  clearError: () => set({ error: null }),
}));
```

**Step 3: Run typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/lib/specs-api.ts frontend/src/store/specs-store.ts
git commit -m "feat(frontend): add specs API client and Zustand store"
```

---

## Task 7: Specs List Page

**Files:**
- Create: `frontend/src/pages/Specs/SpecsList.tsx`
- Create: `frontend/src/pages/Specs/CreateSpecDialog.tsx`
- Modify: `frontend/src/App.tsx` (add route)
- Modify: `frontend/src/pages/Dashboard/MainDashboard.tsx` (add nav link)

**Step 1: Create SpecsList page**

Create `frontend/src/pages/Specs/SpecsList.tsx` — a table view of all specs with:
- Header with title "Specifications" and "New Spec" button
- Table columns: Title, Status (badge), Quality Score (color-coded 0-100), Template, Created, Board (link)
- Status badge colors: draft=gray, validated=blue, decomposed=green, archived=muted
- Quality score colors: <40=red, 40-69=amber, 70-84=blue, 85+=green, null=gray "Not scored"
- Empty state: "No specifications yet. Create one to get started."
- Click row → navigate to `/specs/:specId`
- "New Spec" button opens CreateSpecDialog

Follow the exact pattern from `BoardsList.tsx`: `useEffect` to fetch on mount, loading/error states, lucide icons.

**Step 2: Create CreateSpecDialog**

Create `frontend/src/pages/Specs/CreateSpecDialog.tsx` — a dialog with:
- Title input
- Template selector (dropdown from `fetchTemplates()`, option "Blank" for no template)
- Content textarea (pre-filled from template if selected)
- Cancel / Create buttons
- On create: calls `createSpec()`, navigates to `/specs/:newSpecId`

Follow the pattern from `frontend/src/pages/Boards/EditBoardDialog.tsx`.

**Step 3: Add route in App.tsx**

In `frontend/src/App.tsx`:
- Import: `import SpecsList from "./pages/Specs/SpecsList";`
- Add route after the Boards routes:
```tsx
{/* Specifications */}
<Route
  path="/specs"
  element={
    <ProtectedRoute>
      <SpecsList />
    </ProtectedRoute>
  }
/>
```

**Step 4: Add nav link in MainDashboard.tsx**

In `MainDashboard.tsx`, after the Boards link (~line 2110), add:
```tsx
{/* Specs Link */}
<Link
  to="/specs"
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
>
  <FileText className="w-4 h-4 text-violet-500" />
  <span className="text-sm font-medium">Specs</span>
</Link>
```

Import `FileText` from `lucide-react` if not already imported.

**Step 5: Run typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 6: Commit**

```bash
git add frontend/src/pages/Specs/SpecsList.tsx frontend/src/pages/Specs/CreateSpecDialog.tsx frontend/src/App.tsx frontend/src/pages/Dashboard/MainDashboard.tsx
git commit -m "feat(frontend): add Specs list page with create dialog and nav link"
```

---

## Task 8: Spec Editor Page with Quality Scoring Panel

**Files:**
- Create: `frontend/src/pages/Specs/SpecEditor.tsx`
- Create: `frontend/src/pages/Specs/QualityScorePanel.tsx`
- Modify: `frontend/src/App.tsx` (add editor route)

**Step 1: Create QualityScorePanel component**

Create `frontend/src/pages/Specs/QualityScorePanel.tsx`:
- Displays the 5-dimension quality score as a vertical list of score bars
- Each dimension: name, score bar (colored by score), feedback text
- Overall score at top as large number with color coding
- Suggestions list below with checkmark icons
- Loading state when `isScoring` is true (pulsing animation)
- Empty state when no score yet: "Click 'Score' to evaluate your spec"

Score bar: a horizontal bar filled proportionally (0-100), color by score range.

**Step 2: Create SpecEditor page**

Create `frontend/src/pages/Specs/SpecEditor.tsx`:
- Two-panel layout: left = editor, right = quality panel
- **Left panel:**
  - Title field (editable, auto-saves on blur)
  - Status badge (draft/validated/decomposed)
  - Content textarea (monospace, full height, auto-saves on debounced input — 2s debounce)
  - "Score" button in the toolbar
  - "Decompose" button (disabled if: no score, or score < org minimum)
- **Right panel:**
  - `QualityScorePanel` component
  - Version history tab (list of versions with dates + scores)
- **Top bar:**
  - Back arrow → `/specs`
  - Title display
  - Status badge
  - "Score" and "Decompose" buttons

**Decompose flow:**
- Click "Decompose" → calls existing decompose API with `specId` param
- On success: navigates to `/boards/:newBoardId`
- On error: shows error toast

Use `useSpecsStore` for all state. Load spec on mount via `fetchSpec(specId)`.

**Step 3: Add route in App.tsx**

```tsx
import SpecEditor from "./pages/Specs/SpecEditor";

<Route
  path="/specs/:specId"
  element={
    <ProtectedRoute>
      <SpecEditor />
    </ProtectedRoute>
  }
/>
```

**Step 4: Run typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/Specs/SpecEditor.tsx frontend/src/pages/Specs/QualityScorePanel.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add Spec editor page with quality scoring panel"
```

---

## Task 9: Built-in Starter Templates (Seed Data)

**Files:**
- Create: `api/src/services/spec-templates.ts`
- Modify: `api/src/routes/specs.ts` (seed templates on first access)

**Step 1: Create built-in templates**

Create `api/src/services/spec-templates.ts` with 4 starter template definitions:

1. **SaaS Web App** — Full-stack template with sections: Overview, Technical Spec (version constraints), Database Schema, File Structure, API Specification, Component Specification, Quality Gates, Acceptance Criteria, Scope Boundary, Pre-Provisioned Infrastructure
2. **API Service** — Backend-only template: Overview, Technical Spec, Data Models, API Endpoints (REST), Error Handling, Authentication, Quality Gates, Acceptance Criteria, Scope Boundary
3. **CLI Tool** — Command-line template: Overview, Commands & Flags, Configuration, Installation, Testing, Quality Gates, Acceptance Criteria, Scope Boundary
4. **Mobile App** — Mobile template: Overview, Screens & Navigation, State Management, Native APIs, Store Deployment, Quality Gates, Acceptance Criteria, Scope Boundary

Each template is a markdown string with section headers and placeholder guidance comments like:
```markdown
## Overview

<!-- Describe what this project builds. List 5-10 deliverables as numbered items. -->

## Technical Specification

### Version Constraints (MUST follow exactly)

<!-- Pin all major dependency versions. Example: -->
\`\`\`json
{
  "dependencies": {
    "next": "^16.1.0",
    "react": "^19.2.0"
  }
}
\`\`\`
```

Export a function `getBuiltInTemplates()` that returns the array.

**Step 2: Seed public templates**

Add a function `ensureBuiltInTemplates(orgId: string)` to `spec-templates.ts` that:
- Checks if any `isPublic: true` templates exist
- If not, creates the 4 built-in templates with `isPublic: true` and a sentinel `orgId` (the first org or a system org)
- Uses upsert logic so it's idempotent

Call this from the GET `/api/specs/templates/list` endpoint (lazy initialization).

**Step 3: Commit**

```bash
git add api/src/services/spec-templates.ts api/src/routes/specs.ts
git commit -m "feat(api): add 4 built-in spec starter templates"
```

---

## Task 10: Documentation Page — Spec Engineering Guide

**Files:**
- Create: `frontend/src/pages/Docs/SpecEngineering.tsx`
- Modify: `frontend/src/pages/Docs/index.ts` (export)
- Modify: `frontend/src/pages/Docs/DocsLayout.tsx` (add nav item)
- Modify: `frontend/src/App.tsx` (add route)

**Step 1: Create SpecEngineering docs page**

Create `frontend/src/pages/Docs/SpecEngineering.tsx` following the pattern of existing docs pages (e.g., `Epics.tsx`, `TaskLifecycle.tsx`). Content sections:

1. **What is Specification Engineering?** — Why specs matter for AI coding agents. Reference industry shift (Addy Osmani, GitHub Spec Kit, Thoughtworks).
2. **The WorkerMill Spec Format** — Standard template sections with descriptions of each (overview, technical spec, data model, architecture, API spec, components, quality gates, acceptance criteria, scope boundary, infrastructure).
3. **Quality Scoring** — The 5 dimensions with descriptions and tips for improving each.
4. **Writing Better Specs** — Principles distilled from showcase examples:
   - Pin dependency versions explicitly
   - Define scope boundaries with "DO NOT" sections
   - Make acceptance criteria measurable
   - Include complete file structure
   - Specify quality gate commands
   - Show, don't tell (include code examples in specs)
5. **Before & After** — Side-by-side comparison of a weak spec vs a strong spec.
6. **Organization Standards** — How admins set templates, required sections, and quality gates.

**Step 2: Add to DocsLayout nav and routing**

- Export from `frontend/src/pages/Docs/index.ts`
- Add nav item in `DocsLayout.tsx` sidebar (after "Epics" or similar)
- Add route in `App.tsx` under the docs section: `path="/docs/specifications"`

**Step 3: Commit**

```bash
git add frontend/src/pages/Docs/SpecEngineering.tsx frontend/src/pages/Docs/index.ts frontend/src/pages/Docs/DocsLayout.tsx frontend/src/App.tsx
git commit -m "feat(docs): add Spec Engineering documentation page"
```

---

## Task 11: Org Settings UI for Spec Governance

**Files:**
- Modify: `api/src/routes/settings/general.ts` (add spec settings to org update)
- Modify: Frontend settings page (add spec settings section)

**Step 1: Add spec settings to org settings API**

In `api/src/routes/settings/general.ts`, add validation for the new fields in the org update handler:
```typescript
body("specMinQualityScore").optional().isInt({ min: 0, max: 100 }),
body("specRequiredSections").optional().isArray(),
```

And include them in the update:
```typescript
if (req.body.specMinQualityScore !== undefined) org.specMinQualityScore = req.body.specMinQualityScore;
if (req.body.specRequiredSections !== undefined) org.specRequiredSections = req.body.specRequiredSections;
```

**Step 2: Add spec settings section to frontend settings**

Add a "Spec Engineering" section in the org settings page with:
- Minimum quality score slider (0-100, 0 = no gate)
- Required sections checklist (overview, technical_spec, data_model, architecture, api_spec, components, quality_gates, acceptance_criteria, scope_boundary)

**Step 3: Commit**

```bash
git add api/src/routes/settings/general.ts frontend/src/pages/Settings/...
git commit -m "feat(settings): add org-level spec engineering governance settings"
```

---

## Task 12: Final Integration + Typecheck + Lint

**Step 1: Run full API typecheck**

Run: `cd api && npm run typecheck`
Expected: PASS

**Step 2: Run full frontend typecheck**

Run: `cd frontend && npx tsc -b`
Expected: PASS

**Step 3: Run API lint**

Run: `cd api && npm run lint`
Expected: PASS (fix any issues)

**Step 4: Run frontend lint**

Run: `cd frontend && npm run lint`
Expected: PASS (fix any issues)

**Step 5: Final commit if any fixes needed**

```bash
git commit -m "chore: lint and typecheck fixes for spec engineering feature"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Database migrations | 1 new migration, 1 modified |
| 2 | TypeORM entities | 3 new models, 3 modified |
| 3 | Scoring service | 1 new service |
| 4 | API routes | 1 new route file, 2 modified |
| 5 | PRD decompose integration | 1 modified |
| 6 | Frontend API + store | 2 new files |
| 7 | Specs list page | 2 new components, 2 modified |
| 8 | Spec editor page | 2 new components, 1 modified |
| 9 | Built-in templates | 1 new service, 1 modified |
| 10 | Documentation page | 1 new page, 3 modified |
| 11 | Org settings | 1 API modified, 1 frontend modified |
| 12 | Final typecheck + lint | Validation only |

**Total:** ~15 new files, ~10 modified files, 12 tasks
