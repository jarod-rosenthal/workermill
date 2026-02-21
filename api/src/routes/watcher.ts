import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();
router.use(authenticateUser);

router.get("/status", async (req: Request, res: Response) => {
  const org = req.organization!;
  res.json({
    enabled: org.watcherEnabled,
    lastRunAt: null,
    stuckTasks: 0,
    pendingRetries: 0,
  });
});

router.post("/enable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.watcherEnabled = true;
    await orgRepo.save(org);
    logger.info("Watcher enabled", { orgId: org.id });
    res.json({ success: true, message: "Watcher enabled", enabled: true });
  } catch (error) {
    logger.error("Failed to enable watcher", { error });
    res.status(500).json({ error: "Failed to enable watcher" });
  }
});

router.post("/disable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.watcherEnabled = false;
    await orgRepo.save(org);
    logger.info("Watcher disabled", { orgId: org.id });
    res.json({ success: true, message: "Watcher disabled", enabled: false });
  } catch (error) {
    logger.error("Failed to disable watcher", { error });
    res.status(500).json({ error: "Failed to disable watcher" });
  }
});

export default router;
