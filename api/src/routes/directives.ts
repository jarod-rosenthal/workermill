/**
 * Directive Effectiveness Tracking API Routes
 *
 * Provides endpoints for:
 * - Recording directive usage
 * - Getting effectiveness metrics
 * - Analyzing directive health
 * - Managing A/B experiments
 */

import { Router, Request, Response } from "express";
import {
  authenticateUser,
  requireAdmin,
  authenticateApiKey,
} from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import * as directiveTracker from "../services/directive-tracker.js";
import type { DirectiveUsage } from "../services/directive-tracker.js";
import * as directiveAnalyzer from "../services/directive-analyzer.js";
import * as experimentRunner from "../services/experiment-runner.js";

const router = Router();

// ============================================================================
// Usage Tracking (Worker-facing endpoints)
// ============================================================================

/**
 * POST /api/directives/usage
 * Record which directives were used for a task.
 * Called by workers when they load directives before execution.
 */
router.post(
  "/usage",
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const { taskId, directives } = req.body;

      if (!taskId || typeof taskId !== "string") {
        res.status(400).json({ error: "taskId is required" });
        return;
      }

      if (!Array.isArray(directives)) {
        res.status(400).json({ error: "directives array is required" });
        return;
      }

      // Validate directive structure
      for (const d of directives as DirectiveUsage[]) {
        if (!d.directiveId || !d.version || !d.type || !d.personaSlug) {
          res.status(400).json({
            error:
              "Each directive must have directiveId, version, type, and personaSlug",
          });
          return;
        }
      }

      await directiveTracker.recordDirectiveUsage(taskId, directives);

      res.json({ success: true });
    } catch (error) {
      logger.error("Error recording directive usage", { error });
      res.status(500).json({ error: "Failed to record directive usage" });
    }
  }
);

// ============================================================================
// Effectiveness Metrics (Dashboard-facing endpoints)
// ============================================================================

/**
 * GET /api/directives/effectiveness
 * Get effectiveness metrics for all directives in the organization.
 */
router.get(
  "/effectiveness",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const activeOnly = req.query.activeOnly === "true";
      const minUsage = parseInt(req.query.minUsage as string) || undefined;

      const metrics = await directiveTracker.getOrgDirectiveMetrics(orgId, {
        activeOnly,
        minUsage,
      });

      res.json({ metrics });
    } catch (error) {
      logger.error("Error getting directive effectiveness", { error });
      res.status(500).json({ error: "Failed to get directive effectiveness" });
    }
  }
);

/**
 * GET /api/directives/effectiveness/:id
 * Get effectiveness metrics for a specific directive.
 */
router.get(
  "/effectiveness/:id",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const directiveId = req.params.id as string;

      const metrics = await directiveTracker.getDirectiveMetrics(directiveId);

      if (!metrics) {
        res.status(404).json({ error: "Directive not found" });
        return;
      }

      res.json({ metrics });
    } catch (error) {
      logger.error("Error getting directive metrics", { error });
      res.status(500).json({ error: "Failed to get directive metrics" });
    }
  }
);

/**
 * GET /api/directives/compare/:personaSlug
 * Compare different versions of a directive.
 */
router.get(
  "/compare/:personaSlug",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const personaSlug = req.params.personaSlug as string;
      const type = (req.query.type as string) || "readme";
      const filename = req.query.filename as string | undefined;

      if (type !== "readme" && type !== "common") {
        res.status(400).json({ error: 'type must be "readme" or "common"' });
        return;
      }

      const versions = await directiveTracker.compareDirectiveVersions(
        personaSlug,
        type,
        filename
      );

      res.json({ versions });
    } catch (error) {
      logger.error("Error comparing directive versions", { error });
      res.status(500).json({ error: "Failed to compare directive versions" });
    }
  }
);

// ============================================================================
// Health Analysis
// ============================================================================

/**
 * GET /api/directives/health
 * Get health report for all directives.
 */
router.get("/health", authenticateUser, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization!.id;

    const report = await directiveAnalyzer.getDirectiveHealthReport(orgId);

    // Calculate summary stats
    const summary = {
      total: report.length,
      healthy: report.filter((d) => d.healthStatus === "healthy").length,
      warning: report.filter((d) => d.healthStatus === "warning").length,
      critical: report.filter((d) => d.healthStatus === "critical").length,
      unknown: report.filter((d) => d.healthStatus === "unknown").length,
    };

    res.json({ summary, directives: report });
  } catch (error) {
    logger.error("Error getting directive health report", { error });
    res.status(500).json({ error: "Failed to get directive health report" });
  }
});

/**
 * GET /api/directives/deprecation-candidates
 * Get directives that are candidates for deprecation.
 */
router.get(
  "/deprecation-candidates",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;

      const candidates = await directiveAnalyzer.getDeprecationCandidates(orgId);

      res.json({ candidates });
    } catch (error) {
      logger.error("Error getting deprecation candidates", { error });
      res.status(500).json({ error: "Failed to get deprecation candidates" });
    }
  }
);

/**
 * GET /api/directives/gaps
 * Identify gaps in directive coverage.
 */
router.get("/gaps", authenticateUser, async (req: Request, res: Response) => {
  try {
    const orgId = req.organization!.id;

    const gaps = await directiveAnalyzer.identifyDirectiveGaps(orgId);

    res.json({ gaps });
  } catch (error) {
    logger.error("Error identifying directive gaps", { error });
    res.status(500).json({ error: "Failed to identify directive gaps" });
  }
});

/**
 * GET /api/directives/:id/failures
 * Analyze failure patterns for a specific directive.
 */
router.get(
  "/:id/failures",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const directiveId = req.params.id as string;

      const analysis =
        await directiveAnalyzer.analyzeFailurePatterns(directiveId);

      if (!analysis) {
        res.status(404).json({ error: "Directive not found" });
        return;
      }

      res.json({ analysis });
    } catch (error) {
      logger.error("Error analyzing failure patterns", { error });
      res.status(500).json({ error: "Failed to analyze failure patterns" });
    }
  }
);

/**
 * POST /api/directives/:id/deprecate
 * Mark a directive as deprecated.
 */
router.post(
  "/:id/deprecate",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const directiveId = req.params.id as string;
      const { reason, supersededById } = req.body;

      if (!reason || typeof reason !== "string") {
        res.status(400).json({ error: "reason is required" });
        return;
      }

      await directiveTracker.deprecateDirective(
        directiveId,
        reason,
        supersededById
      );

      res.json({ success: true });
    } catch (error) {
      logger.error("Error deprecating directive", { error });
      res.status(500).json({ error: "Failed to deprecate directive" });
    }
  }
);

// ============================================================================
// A/B Experiments
// ============================================================================

/**
 * GET /api/directives/experiments
 * List experiments for the organization.
 */
router.get(
  "/experiments",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const status = req.query.status as string | undefined;
      const personaSlug = req.query.personaSlug as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const experiments = await experimentRunner.listExperiments(orgId, {
        status: status as
          | "draft"
          | "running"
          | "completed"
          | "cancelled"
          | undefined,
        personaSlug,
        limit,
        offset,
      });

      res.json({ experiments });
    } catch (error) {
      logger.error("Error listing experiments", { error });
      res.status(500).json({ error: "Failed to list experiments" });
    }
  }
);

/**
 * POST /api/directives/experiments
 * Create a new experiment.
 */
router.post(
  "/experiments",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user?.id || null;
      const {
        name,
        description,
        personaSlug,
        directiveType,
        directiveFilename,
        controlDirectiveId,
        variantDirectiveIds,
        trafficAllocation,
        minSamplesPerVariant,
      } = req.body;

      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }

      if (!personaSlug || typeof personaSlug !== "string") {
        res.status(400).json({ error: "personaSlug is required" });
        return;
      }

      if (!directiveType || !["readme", "common"].includes(directiveType)) {
        res
          .status(400)
          .json({ error: 'directiveType must be "readme" or "common"' });
        return;
      }

      if (!controlDirectiveId || typeof controlDirectiveId !== "string") {
        res.status(400).json({ error: "controlDirectiveId is required" });
        return;
      }

      const experiment = await experimentRunner.createExperiment(
        orgId,
        userId,
        {
          name,
          description,
          personaSlug,
          directiveType,
          directiveFilename,
          controlDirectiveId,
          variantDirectiveIds,
          trafficAllocation,
          minSamplesPerVariant,
        }
      );

      res.status(201).json({ experiment });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create experiment";
      logger.error("Error creating experiment", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/directives/experiments/:id
 * Get experiment details.
 */
router.get(
  "/experiments/:id",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const experimentId = req.params.id as string;

      const experiment = await experimentRunner.getExperiment(experimentId);

      if (!experiment) {
        res.status(404).json({ error: "Experiment not found" });
        return;
      }

      // Also get significance check
      let significance = null;
      if (experiment.isRunning()) {
        try {
          significance =
            await experimentRunner.checkExperimentSignificance(experimentId);
        } catch (err) {
          console.error("[directives] experiment significance check failed:", err instanceof Error ? err.message : err);
        }
      }

      res.json({ experiment, significance });
    } catch (error) {
      logger.error("Error getting experiment", { error });
      res.status(500).json({ error: "Failed to get experiment" });
    }
  }
);

/**
 * POST /api/directives/experiments/:id/start
 * Start an experiment.
 */
router.post(
  "/experiments/:id/start",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const experimentId = req.params.id as string;

      const experiment = await experimentRunner.startExperiment(experimentId);

      res.json({ experiment });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start experiment";
      logger.error("Error starting experiment", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * POST /api/directives/experiments/:id/conclude
 * End experiment with a winner.
 */
router.post(
  "/experiments/:id/conclude",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const experimentId = req.params.id as string;
      const { winnerDirectiveId, reason } = req.body;

      if (!winnerDirectiveId || typeof winnerDirectiveId !== "string") {
        res.status(400).json({ error: "winnerDirectiveId is required" });
        return;
      }

      const experiment = await experimentRunner.concludeExperiment(
        experimentId,
        winnerDirectiveId,
        reason
      );

      res.json({ experiment });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to conclude experiment";
      logger.error("Error concluding experiment", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * DELETE /api/directives/experiments/:id
 * Cancel an experiment.
 */
router.delete(
  "/experiments/:id",
  authenticateUser,
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const experimentId = req.params.id as string;

      await experimentRunner.cancelExperiment(experimentId);

      res.status(204).send();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel experiment";
      logger.error("Error cancelling experiment", { error });
      res.status(400).json({ error: message });
    }
  }
);

/**
 * GET /api/directives/experiments/:id/significance
 * Check statistical significance of an experiment.
 */
router.get(
  "/experiments/:id/significance",
  authenticateUser,
  async (req: Request, res: Response) => {
    try {
      const experimentId = req.params.id as string;

      const result =
        await experimentRunner.checkExperimentSignificance(experimentId);

      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to check significance";
      logger.error("Error checking experiment significance", { error });
      res.status(400).json({ error: message });
    }
  }
);

export default router;
