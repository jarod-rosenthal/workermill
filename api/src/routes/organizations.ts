import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "crypto";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/organizations/current
 * Get current organization details
 */
router.get("/current", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    res.json({
      id: org.id,
      name: org.name,
      plan: org.plan,
      defaultGithubRepo: org.defaultGithubRepo,
      createdAt: org.createdAt,
    });
  } catch (error) {
    logger.error("Error getting organization", { error });
    res.status(500).json({ error: "Failed to get organization" });
  }
});

/**
 * PATCH /api/organizations/current
 * Update current organization (admin only)
 */
router.patch(
  "/current",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { name, defaultGithubRepo } = req.body;

      const orgRepo = AppDataSource.getRepository(Organization);

      if (name) org.name = name;
      if (defaultGithubRepo !== undefined) org.defaultGithubRepo = defaultGithubRepo;

      await orgRepo.save(org);

      logger.info("Organization updated", { orgId: org.id });
      res.json(org);
    } catch (error) {
      logger.error("Error updating organization", { error });
      res.status(500).json({ error: "Failed to update organization" });
    }
  }
);

/**
 * POST /api/organizations/current/rotate-api-key
 * Rotate organization API key (admin only)
 */
router.post(
  "/current/rotate-api-key",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const orgRepo = AppDataSource.getRepository(Organization);

      org.apiKey = `org_${randomUUID().replace(/-/g, "")}`;
      await orgRepo.save(org);

      logger.info("Organization API key rotated", { orgId: org.id });
      res.json({
        apiKey: org.apiKey,
        message: "API key rotated successfully. Update your integrations.",
      });
    } catch (error) {
      logger.error("Error rotating API key", { error });
      res.status(500).json({ error: "Failed to rotate API key" });
    }
  }
);

export default router;
