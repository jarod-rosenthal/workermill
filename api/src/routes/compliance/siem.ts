/**
 * SIEM Integration Routes
 *
 * Security Information and Event Management integration endpoints.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { AuditLog, type AuditAction } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { validateExternalUrl } from "../../utils/url-validator.js";
import { encrypt } from "../../utils/encryption.js";
import { Between, In } from "typeorm";

const router = Router();

/**
 * Event severity mapping for SIEM integration
 */
const EVENT_SEVERITY: Record<AuditAction, "info" | "low" | "medium" | "high" | "critical"> = {
  // High severity - security critical
  mfa_disabled: "high",
  api_key_revoked: "high",
  member_removed: "high",
  billing_subscription_cancelled: "high",

  // Medium severity - important changes
  password_changed: "medium",
  api_key_created: "medium",
  api_key_rotated: "medium",
  member_role_changed: "medium",
  settings_updated: "medium",
  webhook_configured: "medium",
  integration_connected: "medium",
  integration_disconnected: "medium",
  billing_plan_changed: "medium",

  // Low severity - routine operations
  login: "low",
  logout: "low",
  mfa_enabled: "low",
  member_invited: "low",
  orchestrator_started: "low",
  orchestrator_stopped: "low",
  task_created: "low",
  task_deleted: "low",
  task_cancelled: "low",
  task_retried: "low",
  billing_subscription_created: "low",
  webhook_legacy_used: "low",
  tos_accepted: "low",
};

const SEVERITY_LEVELS: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Convert audit log to Common Event Format (CEF)
 * CEF:Version|Device Vendor|Device Product|Device Version|Signature ID|Name|Severity|Extension
 */
function toCEF(log: AuditLog, orgName: string): string {
  const severity = EVENT_SEVERITY[log.action] || "info";
  const cefSeverity = SEVERITY_LEVELS[severity] * 2 + 1; // Map to 1-9 scale

  const extension = [
    `src=${log.ipAddress || "unknown"}`,
    `suser=${log.user?.email || "system"}`,
    `suid=${log.userId || "system"}`,
    `cs1=${log.resourceType}`,
    `cs1Label=ResourceType`,
    `cs2=${log.resourceId || "none"}`,
    `cs2Label=ResourceId`,
    `cs3=${orgName}`,
    `cs3Label=Organization`,
    `rt=${log.createdAt.getTime()}`,
    `msg=${(log.description || "").replace(/=/g, "\\=").replace(/\n/g, " ")}`,
  ].join(" ");

  return `CEF:0|WorkerMill|SecurityPlatform|1.0|${log.action}|${log.action}|${cefSeverity}|${extension}`;
}

/**
 * Convert audit log to JSON format for SIEM systems that prefer JSON
 */
function toSIEMJson(log: AuditLog, orgName: string): Record<string, unknown> {
  return {
    timestamp: log.createdAt.toISOString(),
    eventType: log.action,
    severity: EVENT_SEVERITY[log.action] || "info",
    source: {
      ip: log.ipAddress,
      userAgent: log.userAgent,
    },
    actor: {
      id: log.userId,
      email: log.user?.email,
    },
    organization: {
      id: log.organizationId,
      name: orgName,
    },
    resource: {
      type: log.resourceType,
      id: log.resourceId,
    },
    description: log.description,
    metadata: log.changes?.metadata,
  };
}

/**
 * GET /api/compliance/siem/config
 * Get current SIEM integration configuration
 */
router.get("/siem/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    res.json({
      enabled: org.siemEnabled,
      provider: org.siemProvider,
      webhookUrl: org.siemWebhookUrl ? "***configured***" : null,
      hasSecret: !!org.siemWebhookSecret,
      eventFilters: org.siemEventFilters,
      supportedProviders: [
        { id: "splunk", name: "Splunk", format: "CEF" },
        { id: "datadog", name: "Datadog", format: "JSON" },
        { id: "sumo_logic", name: "Sumo Logic", format: "JSON" },
        { id: "generic", name: "Generic Webhook", format: "JSON/CEF" },
      ],
      supportedFilters: {
        includeActions: Object.keys(EVENT_SEVERITY),
        excludeActions: Object.keys(EVENT_SEVERITY),
        minSeverity: ["info", "low", "medium", "high", "critical"],
      },
    });
  } catch (error) {
    logger.error("Error getting SIEM config", { error });
    res.status(500).json({ error: "Failed to get SIEM configuration" });
  }
});

/**
 * PUT /api/compliance/siem/config
 * Configure SIEM integration
 */
router.put("/siem/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { enabled, provider, webhookUrl, webhookSecret, eventFilters } = req.body;

    // Validate provider
    const validProviders = ["splunk", "datadog", "sumo_logic", "generic"];
    if (provider && !validProviders.includes(provider)) {
      res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(", ")}` });
      return;
    }

    // Validate webhook URL format
    if (webhookUrl) {
      try {
        new URL(webhookUrl);
      } catch {
        res.status(400).json({ error: "Invalid webhook URL format" });
        return;
      }
    }

    // Validate event filters
    if (eventFilters) {
      const validActions = Object.keys(EVENT_SEVERITY);
      if (eventFilters.includeActions) {
        const invalidInclude = eventFilters.includeActions.filter((a: string) => !validActions.includes(a));
        if (invalidInclude.length > 0) {
          res.status(400).json({ error: `Invalid includeActions: ${invalidInclude.join(", ")}` });
          return;
        }
      }
      if (eventFilters.excludeActions) {
        const invalidExclude = eventFilters.excludeActions.filter((a: string) => !validActions.includes(a));
        if (invalidExclude.length > 0) {
          res.status(400).json({ error: `Invalid excludeActions: ${invalidExclude.join(", ")}` });
          return;
        }
      }
      if (eventFilters.minSeverity && !SEVERITY_LEVELS[eventFilters.minSeverity]) {
        res.status(400).json({ error: "Invalid minSeverity. Must be: info, low, medium, high, or critical" });
        return;
      }
    }

    // Update organization
    // Note: orgRepo.update() bypasses TypeORM subscribers, so we must encrypt manually.
    const siemSecretValue = webhookSecret ?? org.siemWebhookSecret;
    const orgRepo = AppDataSource.getRepository("Organization");
    await orgRepo.update(org.id, {
      siemEnabled: enabled ?? org.siemEnabled,
      siemProvider: provider ?? org.siemProvider,
      siemWebhookUrl: webhookUrl ?? org.siemWebhookUrl,
      siemWebhookSecret: siemSecretValue ? encrypt(siemSecretValue) : siemSecretValue,
      siemEventFilters: eventFilters ?? org.siemEventFilters,
    });

    logger.info("SIEM configuration updated", { orgId: org.id, enabled, provider });

    res.json({
      success: true,
      message: "SIEM configuration updated",
      config: {
        enabled: enabled ?? org.siemEnabled,
        provider: provider ?? org.siemProvider,
        hasWebhookUrl: !!(webhookUrl ?? org.siemWebhookUrl),
        hasSecret: !!(webhookSecret ?? org.siemWebhookSecret),
        eventFilters: eventFilters ?? org.siemEventFilters,
      },
    });
  } catch (error) {
    logger.error("Error updating SIEM config", { error });
    res.status(500).json({ error: "Failed to update SIEM configuration" });
  }
});

/**
 * POST /api/compliance/siem/test
 * Test SIEM webhook connection by sending a test event
 */
router.post("/siem/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (!org.siemWebhookUrl) {
      res.status(400).json({ error: "SIEM webhook URL not configured" });
      return;
    }

    // Create a test event
    const testEvent = {
      timestamp: new Date().toISOString(),
      eventType: "siem_test",
      severity: "info",
      source: { ip: req.ip },
      actor: { id: user.id, email: user.email },
      organization: { id: org.id, name: org.name },
      resource: { type: "siem_integration", id: "test" },
      description: "SIEM integration test event from WorkerMill",
      isTest: true,
    };

    // Build CEF test event
    const cefEvent = `CEF:0|WorkerMill|SecurityPlatform|1.0|siem_test|SIEM Integration Test|1|src=${req.ip || "unknown"} suser=${user.email} cs1=siem_integration cs1Label=ResourceType cs3=${org.name} cs3Label=Organization rt=${Date.now()} msg=SIEM integration test event`;

    // Determine format based on provider
    const useCEF = org.siemProvider === "splunk";
    const payload = useCEF ? cefEvent : testEvent;
    const contentType = useCEF ? "text/plain" : "application/json";

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "User-Agent": "WorkerMill-SIEM/1.0",
    };

    // Add HMAC signature if secret is configured
    if (org.siemWebhookSecret) {
      const crypto = await import("crypto");
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", org.siemWebhookSecret)
        .update(body)
        .digest("hex");
      headers["X-WorkerMill-Signature"] = `sha256=${signature}`;
    }

    // Validate webhook URL against SSRF
    const urlCheck = await validateExternalUrl(org.siemWebhookUrl);
    if (!urlCheck.valid) {
      res.status(400).json({ error: `Invalid SIEM webhook URL: ${urlCheck.reason}` });
      return;
    }

    // Send test event
    const startTime = Date.now();
    const response = await fetch(org.siemWebhookUrl, {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.warn("SIEM test webhook failed", {
        orgId: org.id,
        status: response.status,
        error: errorText,
      });
      res.status(200).json({
        success: false,
        message: "SIEM webhook test failed",
        details: {
          statusCode: response.status,
          statusText: response.statusText,
          duration,
          error: errorText.substring(0, 200),
        },
      });
      return;
    }

    logger.info("SIEM test webhook succeeded", { orgId: org.id, duration });

    res.json({
      success: true,
      message: "SIEM webhook test successful",
      details: {
        statusCode: response.status,
        duration,
        format: useCEF ? "CEF" : "JSON",
        provider: org.siemProvider,
      },
    });
  } catch (error) {
    logger.error("Error testing SIEM webhook", { error });
    res.status(500).json({
      success: false,
      error: "Failed to test SIEM webhook",
    });
  }
});

/**
 * GET /api/compliance/siem/events
 * Get recent security events in SIEM format (CEF or JSON)
 * Supports pagination and filtering
 */
router.get("/siem/events", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    // Parse query parameters
    const format = (req.query.format as string) || "json";
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const minSeverity = (req.query.minSeverity as string) || "info";
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default 24 hours
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : new Date();

    // Validate format
    if (!["json", "cef", "ndjson"].includes(format)) {
      res.status(400).json({ error: "Invalid format. Must be: json, cef, or ndjson" });
      return;
    }

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Filter by severity
    const minSeverityLevel = SEVERITY_LEVELS[minSeverity] ?? 0;
    const filteredActions = Object.entries(EVENT_SEVERITY)
      .filter(([, severity]) => SEVERITY_LEVELS[severity] >= minSeverityLevel)
      .map(([action]) => action) as AuditAction[];

    // Query logs
    const logs = await auditRepo.find({
      where: {
        organizationId: org.id,
        action: In(filteredActions),
        createdAt: Between(startDate, endDate),
      },
      relations: ["user"],
      order: { createdAt: "DESC" },
      take: limit,
      skip: offset,
    });

    // Format response based on requested format
    if (format === "cef") {
      // Return CEF formatted events (one per line)
      const cefEvents = logs.map((log) => toCEF(log, org.name)).join("\n");
      res.setHeader("Content-Type", "text/plain");
      res.send(cefEvents);
      return;
    }

    if (format === "ndjson") {
      // Return newline-delimited JSON
      const ndjson = logs.map((log) => JSON.stringify(toSIEMJson(log, org.name))).join("\n");
      res.setHeader("Content-Type", "application/x-ndjson");
      res.send(ndjson);
      return;
    }

    // Default JSON array response
    res.json({
      events: logs.map((log) => toSIEMJson(log, org.name)),
      pagination: {
        limit,
        offset,
        total: logs.length,
        hasMore: logs.length === limit,
      },
      filters: {
        minSeverity,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error getting SIEM events", { error });
    res.status(500).json({ error: "Failed to get SIEM events" });
  }
});

/**
 * POST /api/compliance/siem/forward
 * Manually forward events to configured SIEM (for backfill or replay)
 */
router.post("/siem/forward", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (!org.siemEnabled || !org.siemWebhookUrl) {
      res.status(400).json({ error: "SIEM integration not enabled or configured" });
      return;
    }

    // Validate webhook URL against SSRF
    const urlCheck = await validateExternalUrl(org.siemWebhookUrl);
    if (!urlCheck.valid) {
      res.status(400).json({ error: `Invalid SIEM webhook URL: ${urlCheck.reason}` });
      return;
    }

    const { startDate, endDate, dryRun } = req.body;

    if (!startDate || !endDate) {
      res.status(400).json({ error: "startDate and endDate are required" });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Get events to forward
    const logs = await auditRepo.find({
      where: {
        organizationId: org.id,
        createdAt: Between(start, end),
      },
      relations: ["user"],
      order: { createdAt: "ASC" },
    });

    // Apply filters
    const filters = org.siemEventFilters || {};
    let filteredLogs = logs;

    if (filters.includeActions?.length) {
      filteredLogs = filteredLogs.filter((log) => filters.includeActions!.includes(log.action));
    }
    if (filters.excludeActions?.length) {
      filteredLogs = filteredLogs.filter((log) => !filters.excludeActions!.includes(log.action));
    }
    if (filters.minSeverity) {
      const minLevel = SEVERITY_LEVELS[filters.minSeverity];
      filteredLogs = filteredLogs.filter((log) => {
        const severity = EVENT_SEVERITY[log.action] || "info";
        return SEVERITY_LEVELS[severity] >= minLevel;
      });
    }

    if (dryRun) {
      res.json({
        dryRun: true,
        eventsFound: logs.length,
        eventsAfterFilters: filteredLogs.length,
        dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
        filters,
      });
      return;
    }

    // Forward events in batches
    const batchSize = 100;
    let forwarded = 0;
    let failed = 0;

    for (let i = 0; i < filteredLogs.length; i += batchSize) {
      const batch = filteredLogs.slice(i, i + batchSize);
      const useCEF = org.siemProvider === "splunk";

      let payload: string;
      let contentType: string;

      if (useCEF) {
        payload = batch.map((log) => toCEF(log, org.name)).join("\n");
        contentType = "text/plain";
      } else {
        payload = JSON.stringify(batch.map((log) => toSIEMJson(log, org.name)));
        contentType = "application/json";
      }

      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "User-Agent": "WorkerMill-SIEM/1.0",
      };

      if (org.siemWebhookSecret) {
        const crypto = await import("crypto");
        const signature = crypto
          .createHmac("sha256", org.siemWebhookSecret)
          .update(payload)
          .digest("hex");
        headers["X-WorkerMill-Signature"] = `sha256=${signature}`;
      }

      try {
        const response = await fetch(org.siemWebhookUrl, {
          method: "POST",
          headers,
          body: payload,
        });

        if (response.ok) {
          forwarded += batch.length;
        } else {
          failed += batch.length;
          logger.warn("SIEM batch forward failed", {
            orgId: org.id,
            status: response.status,
            batchIndex: i / batchSize,
          });
        }
      } catch (error) {
        failed += batch.length;
        logger.error("SIEM batch forward error", { error, orgId: org.id });
      }
    }

    logger.info("SIEM event forward completed", {
      orgId: org.id,
      total: filteredLogs.length,
      forwarded,
      failed,
    });

    res.json({
      success: true,
      eventsFound: logs.length,
      eventsAfterFilters: filteredLogs.length,
      forwarded,
      failed,
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
    });
  } catch (error) {
    logger.error("Error forwarding SIEM events", { error });
    res.status(500).json({ error: "Failed to forward events to SIEM" });
  }
});

export default router;
