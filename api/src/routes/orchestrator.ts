import { Router, Request, Response } from "express";
import { authenticateRequest } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { logger } from "../utils/logger.js";
import {
  startOrchestrator,
  stopOrchestrator,
  getOrchestratorStatus,
  isOrchestratorRunning,
} from "../services/orchestrator.js";

const router = Router();
// All routes support both JWT and API key authentication
router.use(authenticateRequest);
router.use(requireCurrentTos);

/**
 * GET /api/orchestrator/status
 * Get current orchestrator status
 */
router.get("/status", async (_req: Request, res: Response) => {
  const status = getOrchestratorStatus();
  res.json({
    running: status.running,
    lastPollAt: status.lastPollAt,
    tasksProcessed: status.tasksProcessed,
    errors: status.errors,
  });
});

/**
 * POST /api/orchestrator/start
 * Start the orchestrator polling loop
 */
router.post("/start", async (_req: Request, res: Response) => {
  try {
    if (isOrchestratorRunning()) {
      res.json({ success: true, message: "Orchestrator already running", running: true });
      return;
    }

    startOrchestrator();
    logger.info("Orchestrator started via API");
    res.json({ success: true, message: "Orchestrator started", running: true });
  } catch (error) {
    logger.error("Failed to start orchestrator", { error });
    res.status(500).json({ error: "Failed to start orchestrator" });
  }
});

/**
 * POST /api/orchestrator/stop
 * Stop the orchestrator polling loop
 */
router.post("/stop", async (_req: Request, res: Response) => {
  try {
    if (!isOrchestratorRunning()) {
      res.json({ success: true, message: "Orchestrator already stopped", running: false });
      return;
    }

    stopOrchestrator();
    logger.info("Orchestrator stopped via API");
    res.json({ success: true, message: "Orchestrator stopped", running: false });
  } catch (error) {
    logger.error("Failed to stop orchestrator", { error });
    res.status(500).json({ error: "Failed to stop orchestrator" });
  }
});

export default router;
