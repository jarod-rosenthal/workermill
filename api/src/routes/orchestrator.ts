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
    running: org.orchestratorRunning,
    desiredCount: 1,
  });
});

router.post("/start", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.orchestratorRunning = true;
    await orgRepo.save(org);
    logger.info("Orchestrator started", { orgId: org.id });
    res.json({ success: true, message: "Orchestrator started", running: true });
  } catch (error) {
    logger.error("Failed to start orchestrator", { error });
    res.status(500).json({ error: "Failed to start orchestrator" });
  }
});

router.post("/stop", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.orchestratorRunning = false;
    await orgRepo.save(org);
    logger.info("Orchestrator stopped", { orgId: org.id });
    res.json({ success: true, message: "Orchestrator stopped", running: false });
  } catch (error) {
    logger.error("Failed to stop orchestrator", { error });
    res.status(500).json({ error: "Failed to stop orchestrator" });
  }
});

export default router;
