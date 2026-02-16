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
 */
router.post("/classify-error", (req: Request, res: Response) => {
  try {
    const result = classifyError(req.body);
    res.json(result);
  } catch (error) {
    logger.error("classify-error failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to classify error" });
  }
});

/**
 * POST /api/worker-decisions/evaluate-quality
 *
 * Evaluate quality metrics against configured thresholds.
 */
router.post("/evaluate-quality", (req: Request, res: Response) => {
  try {
    const result = evaluateQuality(req.body);
    res.json(result);
  } catch (error) {
    logger.error("evaluate-quality failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to evaluate quality" });
  }
});

/**
 * POST /api/worker-decisions/review-outcome
 *
 * Parse the output of a code reviewer into a structured decision.
 */
router.post("/review-outcome", (req: Request, res: Response) => {
  try {
    const result = parseReviewOutcome(req.body);
    res.json(result);
  } catch (error) {
    logger.error("review-outcome failed", {
      error: error instanceof Error ? error.message : String(error),
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
