/**
 * Audit Log Routes
 *
 * Provides endpoints for viewing and exporting audit logs.
 * Access is restricted to organization admins.
 */

import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import {
  queryAuditLogs,
  getAuditSummary,
  exportAuditLogs,
  getAuditRetentionDays,
} from "../services/audit.js";
import { type AuditAction, type AuditResourceType } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/audit/logs
 * Query audit logs with filters
 */
router.get("/logs", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    // Only admins can view audit logs
    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    // Parse query parameters
    const {
      userId,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      limit,
      offset,
    } = req.query;

    const result = await queryAuditLogs({
      organizationId: org.id,
      userId: userId as string | undefined,
      action: action as AuditAction | undefined,
      resourceType: resourceType as AuditResourceType | undefined,
      resourceId: resourceId as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    res.json({
      logs: result.logs.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        changes: log.changes,
        description: log.description,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
        user: log.user
          ? {
              id: log.user.id,
              email: log.user.email,
              fullName: log.user.fullName,
            }
          : null,
      })),
      total: result.total,
      hasMore: result.hasMore,
    });
  } catch (error) {
    logger.error("Error querying audit logs", { error });
    res.status(500).json({ error: "Failed to query audit logs" });
  }
});

/**
 * GET /api/audit/summary
 * Get audit log summary for dashboard
 */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    // Only admins can view audit summary
    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const days = req.query.days
      ? parseInt(req.query.days as string, 10)
      : 30;

    const summary = await getAuditSummary(org.id, days);

    // Get retention info
    const retentionDays = getAuditRetentionDays(org.plan);

    res.json({
      ...summary,
      retentionDays,
      plan: org.plan,
      recentActivity: summary.recentActivity.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        description: log.description,
        createdAt: log.createdAt,
        user: log.user
          ? {
              id: log.user.id,
              email: log.user.email,
              fullName: log.user.fullName,
            }
          : null,
      })),
    });
  } catch (error) {
    logger.error("Error getting audit summary", { error });
    res.status(500).json({ error: "Failed to get audit summary" });
  }
});

/**
 * GET /api/audit/export
 * Export audit logs as JSON (for compliance)
 */
router.get("/export", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    // Only admins can export audit logs
    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { startDate, endDate } = req.query;

    const logs = await exportAuditLogs(
      org.id,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    // Set headers for file download
    const filename = `audit-logs-${org.name.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.json({
      organization: {
        id: org.id,
        name: org.name,
      },
      exportedAt: new Date().toISOString(),
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null,
      },
      totalLogs: logs.length,
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        changes: log.changes,
        description: log.description,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt,
        user: log.user
          ? {
              id: log.user.id,
              email: log.user.email,
              fullName: log.user.fullName,
            }
          : null,
      })),
    });
  } catch (error) {
    logger.error("Error exporting audit logs", { error });
    res.status(500).json({ error: "Failed to export audit logs" });
  }
});

/**
 * GET /api/audit/actions
 * Get list of valid audit actions (for filtering UI)
 */
router.get("/actions", async (_req: Request, res: Response) => {
  const actions: { value: AuditAction; label: string; category: string }[] = [
    // Settings
    { value: "settings_updated", label: "Settings Updated", category: "Settings" },

    // Members
    { value: "member_invited", label: "Member Invited", category: "Team" },
    { value: "member_removed", label: "Member Removed", category: "Team" },
    { value: "member_role_changed", label: "Role Changed", category: "Team" },

    // Tasks
    { value: "task_created", label: "Task Created", category: "Tasks" },
    { value: "task_deleted", label: "Task Deleted", category: "Tasks" },
    { value: "task_cancelled", label: "Task Cancelled", category: "Tasks" },
    { value: "task_retried", label: "Task Retried", category: "Tasks" },

    // API Keys
    { value: "api_key_created", label: "API Key Created", category: "Security" },
    { value: "api_key_revoked", label: "API Key Revoked", category: "Security" },
    { value: "api_key_rotated", label: "API Key Rotated", category: "Security" },

    // Billing
    { value: "billing_plan_changed", label: "Plan Changed", category: "Billing" },
    { value: "billing_subscription_created", label: "Subscription Created", category: "Billing" },
    { value: "billing_subscription_cancelled", label: "Subscription Cancelled", category: "Billing" },

    // System
    { value: "orchestrator_started", label: "Orchestrator Started", category: "System" },
    { value: "orchestrator_stopped", label: "Orchestrator Stopped", category: "System" },

    // Integrations
    { value: "webhook_configured", label: "Webhook Configured", category: "Integrations" },
    { value: "integration_connected", label: "Integration Connected", category: "Integrations" },
    { value: "integration_disconnected", label: "Integration Disconnected", category: "Integrations" },

    // Auth
    { value: "login", label: "Login", category: "Authentication" },
    { value: "logout", label: "Logout", category: "Authentication" },
    { value: "password_changed", label: "Password Changed", category: "Authentication" },
    { value: "mfa_enabled", label: "MFA Enabled", category: "Authentication" },
    { value: "mfa_disabled", label: "MFA Disabled", category: "Authentication" },
  ];

  res.json({ actions });
});

/**
 * GET /api/audit/resource-types
 * Get list of valid resource types (for filtering UI)
 */
router.get("/resource-types", async (_req: Request, res: Response) => {
  const resourceTypes: { value: AuditResourceType; label: string }[] = [
    { value: "organization", label: "Organization" },
    { value: "user", label: "User" },
    { value: "task", label: "Task" },
    { value: "api_key", label: "API Key" },
    { value: "billing", label: "Billing" },
    { value: "integration", label: "Integration" },
    { value: "settings", label: "Settings" },
  ];

  res.json({ resourceTypes });
});

export default router;
