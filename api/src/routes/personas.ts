/**
 * Persona Studio API Routes
 *
 * Provides CRUD endpoints for managing personas, directives, and scripts.
 * Admin-only for mutations, authenticated for reads.
 */

import { Router, Request, Response } from "express";
import { authenticateUser, requireAdmin, authenticateApiKey } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import * as personaService from "../services/persona.js";
import * as directiveValidation from "../services/directive-validation.js";
import type { DirectiveType } from "../models/index.js";

const router = Router();

// ============================================================================
// Persona Routes
// ============================================================================

/**
 * GET /api/personas
 * List all personas (system + org-specific)
 */
router.get("/", authenticateUser, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization?.id || null;
    const personas = await personaService.listPersonas(orgId);

    res.json({
      personas: personas.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        emoji: p.emoji,
        color: p.color,
        shortLabel: p.shortLabel,
        description: p.description,
        enabled: p.enabled,
        isSystem: p.isSystem,
        priority: p.priority,
        skills: p.skills,
        riskLevel: p.riskLevel,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing personas", { error });
    res.status(500).json({ error: "Failed to list personas" });
  }
});

/**
 * GET /api/personas/common/directives
 * List common directives (shared across all personas)
 */
router.get("/common/directives", authenticateUser, async (req: Request, res: Response) => {
  try {
    const directives = await personaService.listCommonDirectives();

    res.json({
      directives: directives.map((d) => ({
        id: d.id,
        filename: d.filename,
        version: d.version,
        changeSummary: d.changeSummary,
        createdAt: d.createdAt,
        contentPreview: d.content.substring(0, 200) + (d.content.length > 200 ? "..." : ""),
      })),
    });
  } catch (error) {
    logger.error("Error listing common directives", { error });
    res.status(500).json({ error: "Failed to list common directives" });
  }
});

/**
 * POST /api/personas/common/directives
 * Create or update a common directive
 */
router.post(
  "/common/directives",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id || null;
      const { filename, content, changeSummary } = req.body;

      if (!filename || typeof filename !== "string") {
        res.status(400).json({ error: "filename is required" });
        return;
      }

      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const directive = await personaService.createCommonDirective(
        userId,
        filename,
        content,
        changeSummary
      );

      res.status(201).json({
        directive: {
          id: directive.id,
          filename: directive.filename,
          version: directive.version,
          changeSummary: directive.changeSummary,
          createdAt: directive.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error creating common directive", { error });
      res.status(500).json({ error: "Failed to create common directive" });
    }
  }
);

// ============================================================================
// Templates Route
// ============================================================================

/**
 * GET /api/personas/templates
 * List available starter templates for new personas
 */
router.get("/templates", authenticateUser, async (_req: Request, res: Response) => {
  try {
    const templates = personaService.getDirectiveTemplates();
    res.json({ templates });
  } catch (error) {
    logger.error("Error getting templates", { error });
    res.status(500).json({ error: "Failed to get templates" });
  }
});

// ============================================================================
// Persona CRUD Routes
// ============================================================================

/**
 * GET /api/personas/:id
 * Get a persona with active directives and scripts
 */
router.get("/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization?.id || null;
    const id = req.params.id as string;
    const persona = await personaService.getPersonaById(id, orgId);

    if (!persona) {
      res.status(404).json({ error: "Persona not found" });
      return;
    }

    res.json({
      persona: {
        id: persona.id,
        slug: persona.slug,
        name: persona.name,
        emoji: persona.emoji,
        color: persona.color,
        shortLabel: persona.shortLabel,
        description: persona.description,
        enabled: persona.enabled,
        isSystem: persona.isSystem,
        priority: persona.priority,
        skills: persona.skills,
        riskLevel: persona.riskLevel,
        createdAt: persona.createdAt,
        updatedAt: persona.updatedAt,
        directives: persona.directives.map((d) => ({
          id: d.id,
          type: d.type,
          filename: d.filename,
          version: d.version,
          changeSummary: d.changeSummary,
          createdAt: d.createdAt,
          contentPreview: d.content.substring(0, 200) + (d.content.length > 200 ? "..." : ""),
        })),
        scripts: persona.scripts.map((s) => ({
          id: s.id,
          category: s.category,
          name: s.name,
          version: s.version,
          changeSummary: s.changeSummary,
          createdAt: s.createdAt,
        })),
      },
    });
  } catch (error) {
    logger.error("Error getting persona", { error, personaId: req.params.id });
    res.status(500).json({ error: "Failed to get persona" });
  }
});

/**
 * POST /api/personas
 * Create a new persona
 */
router.post("/", authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization!.id;
    const { slug, name, emoji, color, shortLabel, description, enabled, priority, skills, riskLevel } =
      req.body;

    if (!slug || typeof slug !== "string") {
      res.status(400).json({ error: "slug is required" });
      return;
    }

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    // Validate slug format (lowercase alphanumeric with underscores)
    if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
      res.status(400).json({
        error: "slug must start with a letter and contain only lowercase letters, numbers, and underscores",
      });
      return;
    }

    const persona = await personaService.createPersona(orgId, {
      slug,
      name,
      emoji,
      color,
      shortLabel,
      description,
      enabled,
      priority,
      skills,
      riskLevel,
    });

    res.status(201).json({
      persona: {
        id: persona.id,
        slug: persona.slug,
        name: persona.name,
        emoji: persona.emoji,
        color: persona.color,
        shortLabel: persona.shortLabel,
        description: persona.description,
        enabled: persona.enabled,
        isSystem: persona.isSystem,
        priority: persona.priority,
        skills: persona.skills,
        riskLevel: persona.riskLevel,
        createdAt: persona.createdAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create persona";
    logger.error("Error creating persona", { error });
    res.status(400).json({ error: message });
  }
});

/**
 * PUT /api/personas/:id
 * Update a persona's metadata
 */
router.put("/:id", authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization!.id;
    const id = req.params.id as string;
    const { name, emoji, color, shortLabel, description, enabled, priority, skills, riskLevel } =
      req.body;

    const persona = await personaService.updatePersona(id, orgId, {
      name,
      emoji,
      color,
      shortLabel,
      description,
      enabled,
      priority,
      skills,
      riskLevel,
    });

    res.json({
      persona: {
        id: persona.id,
        slug: persona.slug,
        name: persona.name,
        emoji: persona.emoji,
        color: persona.color,
        shortLabel: persona.shortLabel,
        description: persona.description,
        enabled: persona.enabled,
        isSystem: persona.isSystem,
        priority: persona.priority,
        skills: persona.skills,
        riskLevel: persona.riskLevel,
        updatedAt: persona.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update persona";
    logger.error("Error updating persona", { error, personaId: req.params.id });
    res.status(400).json({ error: message });
  }
});

/**
 * DELETE /api/personas/:id
 * Delete a persona (not allowed for system personas)
 */
router.delete("/:id", authenticateUser, requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization!.id;
    const id = req.params.id as string;

    await personaService.deletePersona(id, orgId);

    res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete persona";
    logger.error("Error deleting persona", { error, personaId: req.params.id });
    res.status(400).json({ error: message });
  }
});

// ============================================================================
// Directive Routes
// ============================================================================

/**
 * GET /api/personas/:personaId/directives
 * List active directives for a persona
 */
router.get("/:personaId/directives", authenticateUser, async (req: Request, res: Response) => {
  try {
    const personaId = req.params.personaId as string;
    const directives = await personaService.listDirectives(personaId);

    res.json({
      directives: directives.map((d) => ({
        id: d.id,
        type: d.type,
        filename: d.filename,
        version: d.version,
        changeSummary: d.changeSummary,
        createdAt: d.createdAt,
        contentPreview: d.content.substring(0, 200) + (d.content.length > 200 ? "..." : ""),
      })),
    });
  } catch (error) {
    logger.error("Error listing directives", { error, personaId: req.params.personaId });
    res.status(500).json({ error: "Failed to list directives" });
  }
});

/**
 * GET /api/personas/:personaId/directives/:id
 * Get a specific directive with full content
 */
router.get("/:personaId/directives/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const personaId = req.params.personaId as string;
    const id = req.params.id as string;
    const directives = await personaService.listDirectives(personaId);
    const directive = directives.find((d) => d.id === id);

    if (!directive) {
      res.status(404).json({ error: "Directive not found" });
      return;
    }

    res.json({
      directive: {
        id: directive.id,
        type: directive.type,
        filename: directive.filename,
        content: directive.content,
        version: directive.version,
        changeSummary: directive.changeSummary,
        createdAt: directive.createdAt,
      },
    });
  } catch (error) {
    logger.error("Error getting directive", { error });
    res.status(500).json({ error: "Failed to get directive" });
  }
});

/**
 * GET /api/personas/:personaId/directives/:id/history
 * Get version history for a directive
 */
router.get(
  "/:personaId/directives/:id/history",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const id = req.params.id as string;
      // First get the directive to find its type and filename
      const directives = await personaService.listDirectives(personaId);
      const currentDirective = directives.find((d) => d.id === id);

      if (!currentDirective) {
        res.status(404).json({ error: "Directive not found" });
        return;
      }

      const history = await personaService.getDirectiveHistory(
        personaId,
        currentDirective.type as DirectiveType,
        currentDirective.filename
      );

      res.json({
        history: history.map((d) => ({
          id: d.id,
          version: d.version,
          isActive: d.isActive,
          changeSummary: d.changeSummary,
          createdAt: d.createdAt,
          createdBy: d.createdBy
            ? {
                id: d.createdBy.id,
                fullName: d.createdBy.fullName,
              }
            : null,
        })),
      });
    } catch (error) {
      logger.error("Error getting directive history", { error });
      res.status(500).json({ error: "Failed to get directive history" });
    }
  }
);

/**
 * POST /api/personas/:personaId/directives
 * Create a new directive version
 */
router.post(
  "/:personaId/directives",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const userId = req.user?.id || null;
      const { type, filename, content, changeSummary } = req.body;

      if (!type || !["readme", "common"].includes(type)) {
        res.status(400).json({ error: 'type must be "readme" or "common"' });
        return;
      }

      if (type === "common" && !filename) {
        res.status(400).json({ error: "filename is required for common directives" });
        return;
      }

      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const directive = await personaService.createDirectiveVersion(
        personaId,
        userId,
        { type, filename, content, changeSummary }
      );

      res.status(201).json({
        directive: {
          id: directive.id,
          type: directive.type,
          filename: directive.filename,
          version: directive.version,
          changeSummary: directive.changeSummary,
          createdAt: directive.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error creating directive", { error });
      res.status(500).json({ error: "Failed to create directive" });
    }
  }
);

/**
 * POST /api/personas/:personaId/directives/:id/rollback
 * Rollback to a previous directive version
 */
router.post(
  "/:personaId/directives/:id/rollback",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || null;

      const directive = await personaService.rollbackDirective(id, userId);

      res.json({
        directive: {
          id: directive.id,
          type: directive.type,
          filename: directive.filename,
          version: directive.version,
          changeSummary: directive.changeSummary,
          createdAt: directive.createdAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rollback directive";
      logger.error("Error rolling back directive", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * DELETE /api/personas/:personaId/directives/:id
 * Delete all versions of a directive
 */
router.delete(
  "/:personaId/directives/:id",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const id = req.params.id as string;
      // First get the directive to find its type and filename
      const directives = await personaService.listDirectives(personaId);
      const directive = directives.find((d) => d.id === id);

      if (!directive) {
        res.status(404).json({ error: "Directive not found" });
        return;
      }

      await personaService.deleteDirective(
        personaId,
        directive.type as DirectiveType,
        directive.filename
      );

      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting directive", { error });
      res.status(500).json({ error: "Failed to delete directive" });
    }
  }
);

// ============================================================================
// Script Routes
// ============================================================================

/**
 * GET /api/personas/:personaId/scripts
 * List active scripts for a persona
 */
router.get("/:personaId/scripts", authenticateUser, async (req: Request, res: Response) => {
  try {
    const personaId = req.params.personaId as string;
    const scripts = await personaService.listScripts(personaId);

    res.json({
      scripts: scripts.map((s) => ({
        id: s.id,
        category: s.category,
        name: s.name,
        version: s.version,
        changeSummary: s.changeSummary,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing scripts", { error, personaId: req.params.personaId });
    res.status(500).json({ error: "Failed to list scripts" });
  }
});

/**
 * GET /api/personas/:personaId/scripts/:id
 * Get a specific script with full content
 */
router.get("/:personaId/scripts/:id", authenticateUser, async (req: Request, res: Response) => {
  try {
    const personaId = req.params.personaId as string;
    const id = req.params.id as string;
    const scripts = await personaService.listScripts(personaId);
    const script = scripts.find((s) => s.id === id);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    res.json({
      script: {
        id: script.id,
        category: script.category,
        name: script.name,
        content: script.content,
        version: script.version,
        changeSummary: script.changeSummary,
        createdAt: script.createdAt,
      },
    });
  } catch (error) {
    logger.error("Error getting script", { error });
    res.status(500).json({ error: "Failed to get script" });
  }
});

/**
 * GET /api/personas/:personaId/scripts/:id/history
 * Get version history for a script
 */
router.get(
  "/:personaId/scripts/:id/history",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const id = req.params.id as string;
      const scripts = await personaService.listScripts(personaId);
      const currentScript = scripts.find((s) => s.id === id);

      if (!currentScript) {
        res.status(404).json({ error: "Script not found" });
        return;
      }

      const history = await personaService.getScriptHistory(
        personaId,
        currentScript.category,
        currentScript.name
      );

      res.json({
        history: history.map((s) => ({
          id: s.id,
          version: s.version,
          isActive: s.isActive,
          changeSummary: s.changeSummary,
          createdAt: s.createdAt,
          createdBy: s.createdBy
            ? {
                id: s.createdBy.id,
                fullName: s.createdBy.fullName,
              }
            : null,
        })),
      });
    } catch (error) {
      logger.error("Error getting script history", { error });
      res.status(500).json({ error: "Failed to get script history" });
    }
  }
);

/**
 * POST /api/personas/:personaId/scripts
 * Create a new script version
 */
router.post(
  "/:personaId/scripts",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const userId = req.user?.id || null;
      const { category, name, content, changeSummary } = req.body;

      if (!category || typeof category !== "string") {
        res.status(400).json({ error: "category is required" });
        return;
      }

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }

      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const script = await personaService.createScriptVersion(personaId, userId, {
        category,
        name,
        content,
        changeSummary,
      });

      res.status(201).json({
        script: {
          id: script.id,
          category: script.category,
          name: script.name,
          version: script.version,
          changeSummary: script.changeSummary,
          createdAt: script.createdAt,
        },
      });
    } catch (error) {
      logger.error("Error creating script", { error });
      res.status(500).json({ error: "Failed to create script" });
    }
  }
);

/**
 * POST /api/personas/:personaId/scripts/:id/rollback
 * Rollback to a previous script version
 */
router.post(
  "/:personaId/scripts/:id/rollback",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const userId = req.user?.id || null;

      const script = await personaService.rollbackScript(id, userId);

      res.json({
        script: {
          id: script.id,
          category: script.category,
          name: script.name,
          version: script.version,
          changeSummary: script.changeSummary,
          createdAt: script.createdAt,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to rollback script";
      logger.error("Error rolling back script", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * DELETE /api/personas/:personaId/scripts/:id
 * Delete all versions of a script
 */
router.delete(
  "/:personaId/scripts/:id",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.personaId as string;
      const id = req.params.id as string;
      const scripts = await personaService.listScripts(personaId);
      const script = scripts.find((s) => s.id === id);

      if (!script) {
        res.status(404).json({ error: "Script not found" });
        return;
      }

      await personaService.deleteScript(personaId, script.category, script.name);

      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting script", { error });
      res.status(500).json({ error: "Failed to delete script" });
    }
  }
);

// ============================================================================
// Worker Bundle Route (API Key Auth)
// ============================================================================

/**
 * GET /api/personas/worker/:slug/bundle
 * Get the complete persona bundle for a worker
 * Uses API key authentication (for workers)
 */
router.get(
  "/worker/:slug/bundle",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const slug = req.params.slug as string;

      const bundle = await personaService.getPersonaBundle(slug, orgId);

      if (!bundle) {
        res.status(404).json({ error: "Persona not found or disabled" });
        return;
      }

      res.json(bundle);
    } catch (error) {
      logger.error("Error getting persona bundle", { error, slug: req.params.slug });
      res.status(500).json({ error: "Failed to get persona bundle" });
    }
  }
);

// ============================================================================
// Customize Route
// ============================================================================

/**
 * POST /api/personas/:id/customize
 * Create an org-specific copy of a system persona
 */
router.post(
  "/:id/customize",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.id as string;
      const orgId = req.organization?.id;

      if (!orgId) {
        res.status(401).json({ error: "Organization required" });
        return;
      }

      const customizedPersona = await personaService.customizePersona(personaId, orgId);

      res.status(201).json({
        persona: {
          id: customizedPersona.id,
          slug: customizedPersona.slug,
          name: customizedPersona.name,
          emoji: customizedPersona.emoji,
          color: customizedPersona.color,
          shortLabel: customizedPersona.shortLabel,
          description: customizedPersona.description,
          enabled: customizedPersona.enabled,
          isSystem: customizedPersona.isSystem,
          priority: customizedPersona.priority,
          skills: customizedPersona.skills,
          riskLevel: customizedPersona.riskLevel,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to customize persona";
      logger.error("Error customizing persona", { error, personaId: req.params.id });
      res.status(400).json({ error: message });
    }
  }
);

// ============================================================================
// AI Generation Route
// ============================================================================

/**
 * POST /api/personas/:id/generate-directive
 * Use AI to generate initial directive content based on persona metadata
 */
router.post(
  "/:id/generate-directive",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.id as string;
      const orgId = req.organization?.id || null;
      const { templateId } = req.body;

      const persona = await personaService.getPersonaById(personaId, orgId);
      if (!persona) {
        res.status(404).json({ error: "Persona not found" });
        return;
      }

      const content = await personaService.generateDirectiveContent(persona, templateId);

      res.json({ content });
    } catch (error) {
      logger.error("Error generating directive", { error });
      res.status(500).json({ error: "Failed to generate directive" });
    }
  }
);

// ============================================================================
// Test Route
// ============================================================================

/**
 * POST /api/personas/:id/test
 * Test a persona by showing the rendered directive
 */
router.post(
  "/:id/test",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.id as string;
      const orgId = req.organization?.id || null;

      const result = await personaService.testPersona(personaId, orgId);

      if (!result) {
        res.status(404).json({ error: "Persona not found" });
        return;
      }

      res.json(result);
    } catch (error) {
      logger.error("Error testing persona", { error });
      res.status(500).json({ error: "Failed to test persona" });
    }
  }
);

// ============================================================================
// Diff Route
// ============================================================================

/**
 * GET /api/personas/:id/diff
 * Compare org persona directives against the original system persona
 */
router.get(
  "/:id/diff",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaId = req.params.id as string;
      const orgId = req.organization?.id || null;

      const diff = await personaService.getPersonaDiff(personaId, orgId);

      if (!diff) {
        res.status(404).json({ error: "Persona not found or not a customized persona" });
        return;
      }

      res.json(diff);
    } catch (error) {
      logger.error("Error getting persona diff", { error });
      res.status(500).json({ error: "Failed to get persona diff" });
    }
  }
);

// ============================================================================
// Validation Route
// ============================================================================

/**
 * POST /api/personas/validate-directive
 * Validate directive content before saving
 */
router.post(
  "/validate-directive",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const { content, type } = req.body;

      if (!content || typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const result = directiveValidation.validateDirective(content, type || "readme");

      res.json(result);
    } catch (error) {
      logger.error("Error validating directive", { error });
      res.status(500).json({ error: "Failed to validate directive" });
    }
  }
);

// ============================================================================
// Admin Seed Route
// ============================================================================

/**
 * POST /api/personas/admin/seed-directives
 * Seed system persona directives from provided content
 * Admin only - used to populate directives from file system
 */
router.post(
  "/admin/seed-directives",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const directives: personaService.SeedDirectiveInput[] = req.body.directives;

      if (!Array.isArray(directives)) {
        res.status(400).json({ error: "directives array required" });
        return;
      }

      const results = await personaService.seedSystemDirectives(directives);

      res.json({
        success: true,
        seeded: results.seeded,
        skipped: results.skipped,
        errors: results.errors,
      });
    } catch (error) {
      logger.error("Error seeding directives", { error });
      res.status(500).json({ error: "Failed to seed directives" });
    }
  }
);

export default router;
