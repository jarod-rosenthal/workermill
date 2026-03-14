/**
 * Worker Decision Engine API Routes
 *
 * Thin routing layer for the centralized decision engine.
 * All logic lives in services/worker-decision-engine.ts.
 *
 * Endpoints:
 *   GET  /api/worker-decisions/health           - Health check
 *   POST /api/worker-decisions/classify-error    - Classify an error and recommend action
 *   POST /api/worker-decisions/evaluate-quality  - Evaluate quality metrics against thresholds
 *   POST /api/worker-decisions/review-outcome    - Parse reviewer output into structured decision
 *   POST /api/worker-decisions/route-question    - Route a question to the best-fit expert
 *   POST /api/worker-decisions/route-provider    - Route a persona to an AI provider/model
 *   GET  /api/worker-decisions/worker-config     - Get static worker configuration
 */

import { Router, type Request, type Response } from "express";
import { authenticateApiKey } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/index.js";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
  getWorkerConfig,
} from "../services/worker-decision-engine.js";

const router = Router();

// All worker decision endpoints require API key authentication
router.use(authenticateApiKey);

/**
 * GET /api/worker-decisions/health
 *
 * Simple health check for the decision engine.
 */
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * POST /api/worker-decisions/classify-error
 *
 * Classify an error and determine the recommended action (auto_retry, escalate, skip).
 *
 * Normalizes client field names to match the service interface:
 *   client sends: { errorOutput, storyContext?, persona?, affectedFiles?, retryCount? }
 *   service expects: { errorText, retryCount, maxAutoRetries, storyContext: { title, persona, targetFiles } }
 */
router.post("/classify-error", (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const body = req.body;
    const normalized = {
      errorText: body.errorText || body.errorOutput || "",
      retryCount: body.retryCount ?? 0,
      maxAutoRetries: body.maxAutoRetries ?? org.blockerMaxAutoRetries,
      storyContext:
        body.storyContext && typeof body.storyContext === "object"
          ? body.storyContext
          : {
              title: typeof body.storyContext === "string" ? body.storyContext : "",
              persona: body.persona || "",
              targetFiles: body.affectedFiles || [],
            },
    };
    const result = classifyError(normalized);
    res.json(result);
  } catch (error) {
    logger.error("classify-error failed", {
      error: error instanceof Error ? error.message : String(error),
      body: JSON.stringify(req.body).substring(0, 500),
    });
    res.status(500).json({ error: "Failed to classify error" });
  }
});

/**
 * POST /api/worker-decisions/evaluate-quality
 *
 * Evaluate quality metrics against configured thresholds.
 *
 * Normalizes client field names to match the service interface:
 *   client sends: { diff, storyDescription? }
 *   service expects: { metrics: {...}, bypassRequested, qualityGateEnabled, thresholds? }
 */
router.post("/evaluate-quality", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    let body = req.body;

    // Normalize: if client sends flat { diff, storyDescription } instead of { metrics, ... },
    // build the service-expected shape. The "diff" field is a summary string like
    // "score=85/100, typeErrors=false, lintErrors=0, testsFailed=0".
    if (body.diff !== undefined && body.metrics === undefined) {
      const diffStr = String(body.diff);
      const scoreMatch = diffStr.match(/score=(\d+)/);
      const typeErrorsMatch = diffStr.match(/typeErrors=(true|false)/);
      const testsFailedMatch = diffStr.match(/testsFailed=(\d+|true|false)/);
      body = {
        metrics: {
          qualityScore: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
          typeErrors: typeErrorsMatch ? typeErrorsMatch[1] === "true" : false,
          testFailures: testsFailedMatch
            ? testsFailedMatch[1] === "true" || parseInt(testsFailedMatch[1], 10) > 0
            : false,
        },
        taskId: body.taskId,
        bypassRequested: body.bypassRequested ?? false,
        qualityGateEnabled: body.qualityGateEnabled ?? org.qualityGateEnabled,
        thresholds: body.thresholds,
      };
    }

    // Ensure qualityGateEnabled has a default from org settings
    if (body.qualityGateEnabled === undefined) {
      body.qualityGateEnabled = org.qualityGateEnabled;
    }

    // Ensure bypassRequested has a default
    if (body.bypassRequested === undefined) {
      body.bypassRequested = false;
    }

    // Inject org quality thresholds when client doesn't provide them
    if (!body.thresholds) {
      body.thresholds = {
        blockOnTestFailures: org.blockOnTestFailures ?? true,
        blockOnTypeErrors: org.blockOnTypeErrors ?? false,
        blockOnLintErrors: org.blockOnLintErrors ?? false,
        blockOnE2EFailures: org.blockOnE2EFailures ?? false,
        minQualityScore: org.minQualityScore ?? undefined,
        minTestCoveragePercent: org.minTestCoveragePercent ?? undefined,
        maxSecurityHighVulns: org.maxSecurityHighVulns ?? undefined,
      };
    }

    // Server-side bypass verification: don't trust the client's bypassRequested flag
    if (body.bypassRequested && body.taskId) {
      const task = await AppDataSource.getRepository(WorkerTask).findOneBy({ id: body.taskId });
      if (!task?.qualityGateBypass) {
        body = { ...body, bypassRequested: false };
      }
    } else if (body.bypassRequested) {
      // No taskId — can't verify, deny bypass
      body = { ...body, bypassRequested: false };
    }

    const result = evaluateQuality(body);
    res.json(result);
  } catch (error) {
    logger.error("evaluate-quality failed", {
      error: error instanceof Error ? error.message : String(error),
      body: JSON.stringify(req.body).substring(0, 500),
    });
    res.status(500).json({ error: "Failed to evaluate quality" });
  }
});

/**
 * POST /api/worker-decisions/review-outcome
 *
 * Parse the output of a code reviewer into a structured decision.
 *
 * Normalizes client field names to match the service interface:
 *   client sends: { reviewOutput, reviewerPersona?, revisionNumber? }
 *   service expects: { reviewerOutput, revisionCount, maxRevisions, perStoryRevisionCount, maxPerStoryRevisions }
 */
router.post("/review-outcome", (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const body = req.body;
    const normalized = {
      reviewerOutput: body.reviewerOutput || body.reviewOutput || "",
      revisionCount: body.revisionCount ?? body.revisionNumber ?? 0,
      maxRevisions: body.maxRevisions ?? org.maxReviewRevisions,
      perStoryRevisionCount: body.perStoryRevisionCount ?? 0,
      maxPerStoryRevisions: body.maxPerStoryRevisions ?? org.maxPerStoryRevisions,
    };
    const result = parseReviewOutcome(normalized);
    res.json(result);
  } catch (error) {
    logger.error("review-outcome failed", {
      error: error instanceof Error ? error.message : String(error),
      body: JSON.stringify(req.body).substring(0, 500),
    });
    res.status(500).json({ error: "Failed to parse review outcome" });
  }
});

/**
 * POST /api/worker-decisions/route-question
 *
 * Route a question to the best-fit expert using the 3-tier algorithm.
 */
router.post("/route-question", (req: Request, res: Response) => {
  try {
    const result = routeQuestion(req.body);
    res.json(result);
  } catch (error) {
    logger.error("route-question failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to route question" });
  }
});

/**
 * POST /api/worker-decisions/route-provider
 *
 * Route a persona to the appropriate AI provider and model.
 */
router.post("/route-provider", (req: Request, res: Response) => {
  try {
    const result = routeProvider(req.body);
    res.json(result);
  } catch (error) {
    logger.error("route-provider failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to route provider" });
  }
});

/**
 * GET /api/worker-decisions/worker-config
 *
 * Get static worker configuration (persona icons, review schema, defaults, AGENTS.md).
 */
router.get("/worker-config", async (_req: Request, res: Response) => {
  try {
    const result = await getWorkerConfig();
    res.json(result);
  } catch (error) {
    logger.error("worker-config failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to get worker config" });
  }
});

export default router;
