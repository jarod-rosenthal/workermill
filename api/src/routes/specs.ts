/**
 * Spec Engineering API Routes
 *
 * CRUD for specs, quality scoring, version history, and templates.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { KbSpec, KbSpecTemplate, KbSpecVersion } from "../models/index.js";
import { scoreSpec } from "../services/spec-scorer.js";
import { ensureBuiltInTemplates } from "../services/spec-templates.js";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { logger } from "../utils/logger.js";
import {
  body,
  param,
  query,
  validateRequest,
} from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);
router.use(requireCurrentTos);

// =============================================================================
// Templates (static paths MUST come before :specId param routes)
// =============================================================================

/**
 * GET /api/specs/templates/list
 * List templates — org's own + public templates.
 */
router.get("/templates/list", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    await ensureBuiltInTemplates(org.id);

    const templates = await AppDataSource.getRepository(KbSpecTemplate)
      .createQueryBuilder("t")
      .where("t.orgId = :orgId OR t.isPublic = true", { orgId: org.id })
      .orderBy("t.isPublic", "ASC")
      .addOrderBy("t.name", "ASC")
      .getMany();

    res.json({ templates });
  } catch (error) {
    logger.error("Error listing spec templates", { error });
    res.status(500).json({ error: "Failed to list templates" });
  }
});

/**
 * POST /api/specs/templates
 * Create an org template.
 */
router.post(
  "/templates",
  body("name")
    .isString()
    .notEmpty()
    .isLength({ max: 255 })
    .withMessage("name is required (max 255 chars)"),
  body("content").isString().notEmpty().withMessage("content is required"),
  body("description").optional().isString(),
  body("requiredSections").optional().isArray(),
  body("requiredSections.*").optional().isString(),
  body("isDefault").optional().isBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { name, content, description, requiredSections, isDefault } =
        req.body;

      const templateRepo = AppDataSource.getRepository(KbSpecTemplate);

      // If isDefault, unset other defaults for this org first
      if (isDefault) {
        await templateRepo.update(
          { orgId: org.id, isDefault: true },
          { isDefault: false },
        );
      }

      const template = templateRepo.create({
        orgId: org.id,
        name,
        content,
        description: description || null,
        requiredSections: requiredSections || [],
        isDefault: isDefault || false,
      });
      await templateRepo.save(template);

      logger.info("Spec template created", {
        templateId: template.id,
        orgId: org.id,
      });

      res.status(201).json({ template });
    } catch (error) {
      logger.error("Error creating spec template", { error });
      res.status(500).json({ error: "Failed to create template" });
    }
  },
);

// =============================================================================
// Spec CRUD
// =============================================================================

/**
 * GET /api/specs
 * List specs for org. Supports status and templateId filters. Excludes archived.
 */
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
        .andWhere("spec.status != :archived", { archived: "archived" });

      if (status) {
        qb.andWhere("spec.status = :status", { status });
      }
      if (templateId) {
        qb.andWhere("spec.templateId = :templateId", { templateId });
      }

      qb.orderBy("spec.updatedAt", "DESC");

      const specs = await qb.getMany();

      res.json({ specs });
    } catch (error) {
      logger.error("Error listing specs", { error });
      res.status(500).json({ error: "Failed to list specs" });
    }
  },
);

/**
 * POST /api/specs
 * Create a spec.
 */
router.post(
  "/",
  body("title")
    .isString()
    .notEmpty()
    .isLength({ min: 1, max: 500 })
    .withMessage("title is required (1-500 chars)"),
  body("content").optional().isString(),
  body("templateId").optional().isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { title, content, templateId } = req.body;

      let specContent: string | null = content || null;

      // If templateId provided and no content, load template content
      if (templateId && !specContent) {
        const template = await AppDataSource.getRepository(
          KbSpecTemplate,
        ).findOneBy({ id: templateId });
        if (!template) {
          res.status(404).json({ error: "Template not found" });
          return;
        }
        specContent = template.content;
      }

      const specRepo = AppDataSource.getRepository(KbSpec);
      const spec = specRepo.create({
        orgId: org.id,
        title,
        content: specContent,
        templateId: templateId || null,
        createdBy: req.user?.id || null,
      });
      await specRepo.save(spec);

      logger.info("Spec created", { specId: spec.id, orgId: org.id });

      res.status(201).json({ spec });
    } catch (error) {
      logger.error("Error creating spec", { error });
      res.status(500).json({ error: "Failed to create spec" });
    }
  },
);

/**
 * GET /api/specs/:specId
 * Get a single spec by ID, scoped to org.
 */
router.get(
  "/:specId",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const specId = req.params.specId as string;

      const spec = await AppDataSource.getRepository(KbSpec).findOneBy({
        id: specId,
        orgId: org.id,
      });

      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      res.json({ spec });
    } catch (error) {
      logger.error("Error fetching spec", { error });
      res.status(500).json({ error: "Failed to fetch spec" });
    }
  },
);

/**
 * PUT /api/specs/:specId
 * Update a spec. When content changes, snapshot current version before updating.
 */
router.put(
  "/:specId",
  param("specId").isUUID(),
  body("title").optional().isString().isLength({ min: 1, max: 500 }),
  body("content").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const specId = req.params.specId as string;
      const { title, content } = req.body;

      const specRepo = AppDataSource.getRepository(KbSpec);
      const spec = await specRepo.findOneBy({ id: specId, orgId: org.id });

      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      // If content is changing and there is existing content, snapshot current version
      if (content !== undefined && spec.content && content !== spec.content) {
        const versionRepo = AppDataSource.getRepository(KbSpecVersion);
        await versionRepo.save(
          versionRepo.create({
            specId: spec.id,
            content: spec.content,
            qualityScore: spec.qualityScore,
            version: spec.version,
          }),
        );

        spec.version += 1;
        spec.qualityScore = null;
        spec.qualityFeedback = null;
      }

      if (title !== undefined) {
        spec.title = title;
      }
      if (content !== undefined) {
        spec.content = content;
      }

      await specRepo.save(spec);

      logger.info("Spec updated", { specId: spec.id, orgId: org.id });

      res.json({ spec });
    } catch (error) {
      logger.error("Error updating spec", { error });
      res.status(500).json({ error: "Failed to update spec" });
    }
  },
);

/**
 * DELETE /api/specs/:specId
 * Soft delete — set status to "archived".
 */
router.delete(
  "/:specId",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const specId = req.params.specId as string;

      const specRepo = AppDataSource.getRepository(KbSpec);
      const result = await specRepo.update(
        { id: specId, orgId: org.id },
        { status: "archived" as const },
      );

      if (result.affected === 0) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      res.status(204).send();
    } catch (error) {
      logger.error("Error archiving spec", { error });
      res.status(500).json({ error: "Failed to archive spec" });
    }
  },
);

// =============================================================================
// Scoring
// =============================================================================

/**
 * POST /api/specs/:specId/score
 * Run quality scoring on a spec.
 */
router.post(
  "/:specId/score",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const specId = req.params.specId as string;

      const specRepo = AppDataSource.getRepository(KbSpec);
      const spec = await specRepo.findOneBy({ id: specId, orgId: org.id });

      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      if (!spec.content || spec.content.length < 50) {
        res
          .status(400)
          .json({ error: "Spec content must be at least 50 characters" });
        return;
      }

      // Load template required sections if applicable
      let requiredSections: string[] | null = null;
      if (spec.templateId) {
        const template = await AppDataSource.getRepository(
          KbSpecTemplate,
        ).findOneBy({ id: spec.templateId });
        if (template?.requiredSections?.length) {
          requiredSections = template.requiredSections;
        }
      }

      const feedback = await scoreSpec(spec.content, requiredSections);

      // Atomic update to avoid clobbering concurrent changes
      await specRepo.update(
        { id: spec.id },
        {
          qualityScore: feedback.overall,
          qualityFeedback: feedback,
          status:
            spec.status === "draft"
              ? ("validated" as const)
              : (spec.status as "draft" | "validated" | "decomposed"),
        },
      );

      logger.info("Spec scored", {
        specId: spec.id,
        score: feedback.overall,
        orgId: org.id,
      });

      res.json({ spec: { ...spec, qualityScore: feedback.overall, qualityFeedback: feedback } });
    } catch (error) {
      logger.error("Error scoring spec", { error });
      res.status(500).json({ error: "Failed to score spec" });
    }
  },
);

// =============================================================================
// Version History
// =============================================================================

/**
 * GET /api/specs/:specId/versions
 * List versions for a spec, ordered by version DESC.
 */
router.get(
  "/:specId/versions",
  param("specId").isUUID(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const specId = req.params.specId as string;

      // Verify spec belongs to org
      const spec = await AppDataSource.getRepository(KbSpec).findOneBy({
        id: specId,
        orgId: org.id,
      });

      if (!spec) {
        res.status(404).json({ error: "Spec not found" });
        return;
      }

      const versions = await AppDataSource.getRepository(KbSpecVersion).find({
        where: { specId },
        order: { version: "DESC" },
      });

      res.json({ versions });
    } catch (error) {
      logger.error("Error listing spec versions", { error });
      res.status(500).json({ error: "Failed to list versions" });
    }
  },
);

export default router;
