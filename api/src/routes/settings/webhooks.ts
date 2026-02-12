import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  Organization,
  WebhookEndpoint,
  AuditLog,
  type IntegrationType,
  type AuditAction,
} from "../../models/index.js";
import {
  ensureWebhookEndpoint,
  generateWebhookSecret,
  getWebhookEndpointsWithUrls,
} from "../../services/webhook.js";
import { requireAdmin } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { param, validateRequest } from "../../middleware/validation.js";
import { getLegacyWebhookStats } from "../../services/legacy-webhook-alert.js";

const router = Router();

// ============================================================================
// WEBHOOK ENDPOINT MANAGEMENT (Multi-Tenant Isolation)
// ============================================================================

/**
 * GET /api/settings/webhooks
 * Get all webhook endpoints for the organization with URLs
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const baseUrl = config.apiBaseUrl || `${req.protocol}://${req.get("host")}`;

    // Get existing endpoints
    const endpoints = await getWebhookEndpointsWithUrls(org.id, baseUrl);

    // Define all supported integration types
    const allIntegrationTypes: IntegrationType[] = [
      "jira",
      "github",
      "github-issues",
      "gitlab",
      "bitbucket",
      "linear",
    ];

    // Create a map of existing endpoints
    const existingMap = new Map(endpoints.map((e) => [e.integrationType, e]));

    // Build response with all integration types
    const result = allIntegrationTypes.map((type) => {
      const existing = existingMap.get(type);
      const slug = org.slug || "";

      return {
        integrationType: type,
        webhookUrl: slug ? `${baseUrl}/api/webhooks/${slug}/${type}` : null,
        isConfigured: !!existing,
        isActive: existing?.isActive ?? false,
        lastReceivedAt: existing?.lastReceivedAt ?? null,
        hasSecret: existing?.hasSecret ?? false,
      };
    });

    res.json({
      orgSlug: org.slug,
      endpoints: result,
      legacyWarning: org.slug
        ? null
        : "Organization slug not set. Please update your organization to enable URL-based webhooks.",
    });
  } catch (error) {
    logger.error("Error fetching webhook endpoints", { error });
    res.status(500).json({ error: "Failed to fetch webhook endpoints" });
  }
});

/**
 * POST /api/settings/webhooks/:integrationType
 * Create or regenerate a webhook endpoint for an integration type
 */
router.post(
  "/:integrationType",
  param("integrationType")
    .isIn(["jira", "github", "github-issues", "gitlab", "bitbucket", "linear"])
    .withMessage("Invalid integration type"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { integrationType } = req.params as {
        integrationType: IntegrationType;
      };

      if (!org.slug) {
        res.status(400).json({
          error:
            "Organization slug not set. Please set a slug before configuring webhooks.",
        });
        return;
      }

      // Create or update the endpoint with a new secret
      const newSecret = generateWebhookSecret();
      const endpoint = await ensureWebhookEndpoint(
        org.id,
        integrationType,
        newSecret,
      );

      const baseUrl =
        config.apiBaseUrl || `${req.protocol}://${req.get("host")}`;
      const webhookUrl = endpoint.getWebhookUrl(baseUrl, org.slug);

      logger.info("Created/updated webhook endpoint", {
        orgId: org.id,
        integrationType,
        endpointId: endpoint.id,
      });

      res.status(201).json({
        integrationType,
        webhookUrl,
        webhookSecret: newSecret, // Only returned on creation/regeneration
        isActive: endpoint.isActive,
        message:
          "Webhook endpoint configured. Use the secret to verify webhook signatures.",
      });
    } catch (error) {
      logger.error("Error creating webhook endpoint", { error });
      res.status(500).json({ error: "Failed to create webhook endpoint" });
    }
  },
);

/**
 * DELETE /api/settings/webhooks/:integrationType
 * Deactivate a webhook endpoint (soft delete)
 */
router.delete(
  "/:integrationType",
  param("integrationType")
    .isIn(["jira", "github", "github-issues", "gitlab", "bitbucket", "linear"])
    .withMessage("Invalid integration type"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { integrationType } = req.params as {
        integrationType: IntegrationType;
      };

      const endpointRepo = AppDataSource.getRepository(WebhookEndpoint);
      const endpoint = await endpointRepo.findOne({
        where: { orgId: org.id, integrationType },
      });

      if (!endpoint) {
        res.status(404).json({ error: "Webhook endpoint not found" });
        return;
      }

      // Soft delete - just deactivate
      endpoint.isActive = false;
      await endpointRepo.save(endpoint);

      logger.info("Deactivated webhook endpoint", {
        orgId: org.id,
        integrationType,
        endpointId: endpoint.id,
      });

      res.json({
        message: "Webhook endpoint deactivated",
        integrationType,
      });
    } catch (error) {
      logger.error("Error deactivating webhook endpoint", { error });
      res
        .status(500)
        .json({ error: "Failed to deactivate webhook endpoint" });
    }
  },
);

/**
 * PATCH /api/settings/webhooks/:integrationType/activate
 * Reactivate a previously deactivated webhook endpoint
 */
router.patch(
  "/:integrationType/activate",
  param("integrationType")
    .isIn(["jira", "github", "github-issues", "gitlab", "bitbucket", "linear"])
    .withMessage("Invalid integration type"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { integrationType } = req.params as {
        integrationType: IntegrationType;
      };

      const endpointRepo = AppDataSource.getRepository(WebhookEndpoint);
      const endpoint = await endpointRepo.findOne({
        where: { orgId: org.id, integrationType },
      });

      if (!endpoint) {
        res.status(404).json({ error: "Webhook endpoint not found" });
        return;
      }

      endpoint.isActive = true;
      await endpointRepo.save(endpoint);

      const baseUrl =
        config.apiBaseUrl || `${req.protocol}://${req.get("host")}`;
      const webhookUrl = org.slug
        ? endpoint.getWebhookUrl(baseUrl, org.slug)
        : null;

      logger.info("Reactivated webhook endpoint", {
        orgId: org.id,
        integrationType,
        endpointId: endpoint.id,
      });

      res.json({
        message: "Webhook endpoint activated",
        integrationType,
        webhookUrl,
        isActive: true,
      });
    } catch (error) {
      logger.error("Error activating webhook endpoint", { error });
      res
        .status(500)
        .json({ error: "Failed to activate webhook endpoint" });
    }
  },
);

// =============================================================================
// Legacy Webhook Monitoring
// =============================================================================

/**
 * GET /api/settings/webhooks/legacy-usage
 * Get legacy (deprecated) webhook endpoint usage stats for this org
 */
router.get("/legacy-usage", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const stats = getLegacyWebhookStats(org.id);

    // Also get audit log count for more accurate historical data
    const auditRepo = AppDataSource.getRepository(AuditLog);
    const legacyUsageCount = await auditRepo.count({
      where: {
        organizationId: org.id,
        action: "webhook_legacy_used" as AuditAction,
      },
    });

    res.json({
      currentSession: stats,
      totalHistorical: legacyUsageCount,
      message: Object.values(stats).some((v) => v > 0)
        ? "Legacy webhook endpoints are being used. Please migrate to URL-based endpoints for proper multi-tenant isolation."
        : "No legacy webhook usage detected.",
    });
  } catch (error) {
    logger.error("Error fetching legacy webhook stats", { error });
    res.status(500).json({ error: "Failed to fetch legacy webhook stats" });
  }
});

export default router;
