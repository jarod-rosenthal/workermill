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

export default router;
