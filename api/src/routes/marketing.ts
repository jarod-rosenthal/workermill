/**
 * Marketing Agent Routes
 *
 * Platform-level marketing agent management routes.
 * All routes require platform admin access.
 */

import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { requireCurrentTos } from "../middleware/tos.js";
import { requirePlatformAdmin } from "../middleware/platform-auth.js";
import { AppDataSource } from "../db/connection.js";
import {
  Organization,
  MarketingCampaign,
  MarketingContent,
  MarketingAction,
} from "../models/index.js";
import { executeMarketingAgentMission } from "../services/marketing-agent-executor.js";
import { logger } from "../utils/logger.js";

const router = Router();

// Apply authentication and platform admin check to all routes
router.use(authenticateUser);
router.use(requireCurrentTos);
router.use(requirePlatformAdmin);

/**
 * GET /api/marketing/stats
 * Aggregate marketing metrics across all campaigns
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
    const contentRepo = AppDataSource.getRepository(MarketingContent);

    const campaigns = await campaignRepo.find({
      where: { orgId: platformOrg.id },
    });

    const totalBudgetCents = campaigns.reduce(
      (sum, c) => sum + c.budgetCents,
      0,
    );
    const totalSpentCents = campaigns.reduce(
      (sum, c) => sum + c.spentCents,
      0,
    );
    const totalImpressions = campaigns.reduce(
      (sum, c) => sum + c.impressions,
      0,
    );
    const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
    const totalConversions = campaigns.reduce(
      (sum, c) => sum + c.conversions,
      0,
    );
    const costPerAcquisition =
      totalConversions > 0 ? totalSpentCents / totalConversions : 0;

    const pendingCount = await contentRepo.count({
      where: { orgId: platformOrg.id, status: "pending_review" },
    });

    res.json({
      totalBudgetCents,
      totalSpentCents,
      totalImpressions,
      totalClicks,
      totalConversions,
      costPerAcquisitionCents: Math.round(costPerAcquisition),
      pendingContentCount: pendingCount,
    });
  } catch (error) {
    logger.error("Failed to get marketing stats", { error });
    res.status(500).json({ error: "Failed to retrieve marketing statistics" });
  }
});

/**
 * GET /api/marketing/campaigns
 * List all campaigns ordered by most recently updated
 */
router.get("/campaigns", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
    const campaigns = await campaignRepo.find({
      where: { orgId: platformOrg.id },
      order: { updatedAt: "DESC" },
    });

    res.json({ campaigns });
  } catch (error) {
    logger.error("Failed to list marketing campaigns", { error });
    res.status(500).json({ error: "Failed to retrieve campaigns" });
  }
});

/**
 * GET /api/marketing/campaigns/:id
 * Get a single campaign with details
 */
router.get("/campaigns/:id", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const campaignRepo = AppDataSource.getRepository(MarketingCampaign);
    const campaign = await campaignRepo.findOne({
      where: { id: req.params.id as string, orgId: platformOrg.id },
    });

    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }

    // Get associated content
    const contentRepo = AppDataSource.getRepository(MarketingContent);
    const content = await contentRepo.find({
      where: { campaignId: campaign.id, orgId: platformOrg.id },
      order: { createdAt: "DESC" },
    });

    res.json({ campaign, content });
  } catch (error) {
    logger.error("Failed to get campaign details", {
      error,
      campaignId: req.params.id,
    });
    res.status(500).json({ error: "Failed to retrieve campaign details" });
  }
});

/**
 * GET /api/marketing/content
 * List all content, optionally filtered by status
 */
router.get("/content", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const contentRepo = AppDataSource.getRepository(MarketingContent);
    const where: Record<string, unknown> = { orgId: platformOrg.id };

    if (req.query.status) {
      where.status = req.query.status as string;
    }

    const content = await contentRepo.find({
      where,
      order: { createdAt: "DESC" },
    });

    res.json({ content });
  } catch (error) {
    logger.error("Failed to list marketing content", { error });
    res.status(500).json({ error: "Failed to retrieve content" });
  }
});

/**
 * POST /api/marketing/content/:id/approve
 * Approve pending content (atomic update)
 */
router.post("/content/:id/approve", async (req: Request, res: Response) => {
  try {
    const contentRepo = AppDataSource.getRepository(MarketingContent);

    const result = await contentRepo.update(
      { id: req.params.id as string, status: "pending_review" as const },
      { status: "approved" },
    );

    if (result.affected === 0) {
      res.status(404).json({
        error: "Content not found or not in pending_review status",
      });
      return;
    }

    res.json({ success: true, status: "approved" });
  } catch (error) {
    logger.error("Failed to approve content", {
      error,
      contentId: req.params.id,
    });
    res.status(500).json({ error: "Failed to approve content" });
  }
});

/**
 * POST /api/marketing/content/:id/reject
 * Reject pending content (atomic update)
 */
router.post("/content/:id/reject", async (req: Request, res: Response) => {
  try {
    const contentRepo = AppDataSource.getRepository(MarketingContent);

    const result = await contentRepo.update(
      { id: req.params.id as string, status: "pending_review" as const },
      { status: "rejected" },
    );

    if (result.affected === 0) {
      res.status(404).json({
        error: "Content not found or not in pending_review status",
      });
      return;
    }

    res.json({ success: true, status: "rejected" });
  } catch (error) {
    logger.error("Failed to reject content", {
      error,
      contentId: req.params.id,
    });
    res.status(500).json({ error: "Failed to reject content" });
  }
});

/**
 * GET /api/marketing/actions
 * Action log, filterable by missionRunId and actionType
 */
router.get("/actions", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const actionRepo = AppDataSource.getRepository(MarketingAction);
    const where: Record<string, unknown> = { orgId: platformOrg.id };

    if (req.query.missionRunId) {
      where.missionRunId = req.query.missionRunId as string;
    }
    if (req.query.actionType) {
      where.actionType = req.query.actionType as string;
    }

    const actions = await actionRepo.find({
      where,
      order: { createdAt: "DESC" },
    });

    res.json({ actions });
  } catch (error) {
    logger.error("Failed to list marketing actions", { error });
    res.status(500).json({ error: "Failed to retrieve actions" });
  }
});

/**
 * GET /api/marketing/config
 * Current marketing config (credentials redacted)
 */
router.get("/config", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    // Redact credential values — only show which channels are enabled
    const credentials = platformOrg.marketingChannelCredentials || {};
    const channels: Record<string, { enabled: boolean }> = {};
    for (const [channel, value] of Object.entries(credentials)) {
      channels[channel] = {
        enabled: Boolean(value && typeof value === "object"),
      };
    }

    res.json({
      enabled: platformOrg.marketingAgentEnabled,
      intervalMinutes: platformOrg.marketingAgentIntervalMinutes,
      monthlyBudgetCents: platformOrg.marketingMonthlyBudgetCents,
      escalationThresholdCents: platformOrg.marketingEscalationThresholdCents,
      config: platformOrg.marketingAgentConfig,
      channels,
    });
  } catch (error) {
    logger.error("Failed to get marketing config", { error });
    res.status(500).json({ error: "Failed to retrieve marketing config" });
  }
});

/**
 * PUT /api/marketing/config
 * Update marketing config
 */
router.put("/config", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    const orgRepo = AppDataSource.getRepository("Organization");
    const updates: Record<string, unknown> = {};

    if (typeof req.body.enabled === "boolean") {
      updates.marketingAgentEnabled = req.body.enabled;
    }
    if (typeof req.body.intervalMinutes === "number") {
      updates.marketingAgentIntervalMinutes = req.body.intervalMinutes;
    }
    if (typeof req.body.monthlyBudgetCents === "number") {
      updates.marketingMonthlyBudgetCents = req.body.monthlyBudgetCents;
    }
    if (typeof req.body.escalationThresholdCents === "number") {
      updates.marketingEscalationThresholdCents =
        req.body.escalationThresholdCents;
    }
    if (req.body.config && typeof req.body.config === "object") {
      updates.marketingAgentConfig = req.body.config;
    }
    if (req.body.credentials && typeof req.body.credentials === "object") {
      updates.marketingChannelCredentials = req.body.credentials;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid fields to update" });
      return;
    }

    await orgRepo.update(platformOrg.id, updates);

    res.json({ success: true });
  } catch (error) {
    logger.error("Failed to update marketing config", { error });
    res.status(500).json({ error: "Failed to update marketing config" });
  }
});

/**
 * POST /api/marketing/run-now
 * Trigger an immediate marketing agent mission (async)
 */
router.post("/run-now", async (_req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.status(404).json({ error: "Platform organization not found" });
      return;
    }

    // Fire and forget — don't block the request
    executeMarketingAgentMission(platformOrg).catch((error) => {
      logger.error("Marketing agent mission failed", { error });
    });

    res.json({ success: true, message: "Marketing agent mission triggered" });
  } catch (error) {
    logger.error("Failed to trigger marketing agent mission", { error });
    res
      .status(500)
      .json({ error: "Failed to trigger marketing agent mission" });
  }
});

export default router;
