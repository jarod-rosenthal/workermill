import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { logger } from "../utils/logger.js";
import { body, validateRequest } from "../middleware/validation.js";

const router = Router();
router.use(authenticateUser);

const VALID_MODELS = [
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
];

/**
 * GET /api/manager/status
 * Get manager status
 */
router.get("/status", async (req: Request, res: Response) => {
  const org = req.organization!;
  res.json({
    enabled: org.managerEnabled,
    modelId: org.managerModelId,
    reviewCount: 0,
    approvalRate: 100,
    queue: {
      awaitingReview: 0,
      underReview: 0,
      revisionNeeded: 0,
    },
  });
});

/**
 * PATCH /api/manager/model
 * Update manager model
 */
router.patch(
  "/model",
  body("modelId")
    .isString()
    .isIn(VALID_MODELS)
    .withMessage(`modelId must be one of: ${VALID_MODELS.join(", ")}`),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { modelId } = req.body;

      const orgRepo = AppDataSource.getRepository(Organization);
      org.managerModelId = modelId;
      await orgRepo.save(org);

    logger.info("Manager model updated", { orgId: org.id, modelId });
    res.json({ success: true, message: "Manager model updated", modelId });
    } catch (error) {
      logger.error("Failed to update manager model", { error });
      res.status(500).json({ error: "Failed to update manager model" });
    }
  }
);

/**
 * POST /api/manager/enable
 * Enable manager
 */
router.post("/enable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.managerEnabled = true;
    await orgRepo.save(org);
    logger.info("Manager enabled", { orgId: org.id });
    res.json({ success: true, message: "Manager enabled", enabled: true });
  } catch (error) {
    logger.error("Failed to enable manager", { error });
    res.status(500).json({ error: "Failed to enable manager" });
  }
});

router.post("/disable", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);
    org.managerEnabled = false;
    await orgRepo.save(org);
    logger.info("Manager disabled", { orgId: org.id });
    res.json({ success: true, message: "Manager disabled", enabled: false });
  } catch (error) {
    logger.error("Failed to disable manager", { error });
    res.status(500).json({ error: "Failed to disable manager" });
  }
});

export default router;
