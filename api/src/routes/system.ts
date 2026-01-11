import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { Organization, WorkerTask } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(authenticateUser);

router.get("/status", async (req: Request, res: Response) => {
  const org = req.organization!;
  res.json({
    systemEnabled: org.systemEnabled,
    orchestrator: { running: org.orchestratorRunning, desiredCount: 1 },
    executors: { running: 0 },
  });
});

router.post("/enable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.systemEnabled = true;
    await orgRepo.save(org);
    logger.info("System enabled", { orgId: org.id });
    res.json({ success: true, message: "System enabled", systemEnabled: true });
  } catch (error) {
    logger.error("Failed to enable system", { error });
    res.status(500).json({ error: "Failed to enable system" });
  }
});

router.post("/disable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.systemEnabled = false;
    await orgRepo.save(org);
    logger.info("System disabled", { orgId: org.id });
    res.json({ success: true, message: "System disabled", systemEnabled: false });
  } catch (error) {
    logger.error("Failed to disable system", { error });
    res.status(500).json({ error: "Failed to disable system" });
  }
});

/**
 * POST /api/system/fix-task
 * Admin endpoint to manually fix stuck tasks
 */
router.post("/fix-task", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { taskId, status, prUrl, prNumber } = req.body;

    if (!taskId || !status) {
      res.status(400).json({ error: "taskId and status are required" });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const task = await taskRepo.findOne({
      where: { id: taskId, orgId: org.id },
    });

    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const oldStatus = task.status;
    task.status = status;
    if (prUrl) task.githubPrUrl = prUrl;
    if (prNumber) task.githubPrNumber = Number(prNumber);
    if (!task.completedAt && ["completed", "deployed", "failed", "review_requested"].includes(status)) {
      task.completedAt = new Date();
    }

    await taskRepo.save(task);

    logger.info("Task manually fixed", {
      taskId,
      oldStatus,
      newStatus: status,
      orgId: org.id,
    });

    res.json({
      success: true,
      taskId,
      oldStatus,
      newStatus: status,
    });
  } catch (error) {
    logger.error("Failed to fix task", { error });
    res.status(500).json({ error: "Failed to fix task" });
  }
});

export default router;
