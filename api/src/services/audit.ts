/**
 * WorkerMill Audit Logging Service
 *
 * Provides comprehensive audit logging for security, compliance, and debugging.
 * Tracks all critical actions across the platform.
 */

import { AppDataSource } from "../db/connection.js";
import {
  AuditLog,
  type AuditAction,
  type AuditResourceType,
  type AuditChanges,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

export interface AuditContext {
  organizationId: string;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogEntry {
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  changes?: AuditChanges;
  description?: string | null;
}

/**
 * Log an audit event
 */
export async function logAuditEvent(
  context: AuditContext,
  entry: AuditLogEntry
): Promise<AuditLog> {
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const auditLog = auditRepo.create({
    organizationId: context.organizationId,
    userId: context.userId || null,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId || null,
    changes: entry.changes || {},
    description: entry.description || null,
  });

  await auditRepo.save(auditLog);

  logger.debug("Audit event logged", {
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    orgId: context.organizationId,
    userId: context.userId,
  });

  return auditLog;
}

/**
 * Log settings update
 */
export async function logSettingsUpdated(
  context: AuditContext,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changedFields: string[]
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "settings_updated",
    resourceType: "settings",
    resourceId: context.organizationId,
    changes: {
      before,
      after,
      fields: changedFields,
    },
    description: `Updated settings: ${changedFields.join(", ")}`,
  });
}

/**
 * Log member invited
 */
export async function logMemberInvited(
  context: AuditContext,
  inviteEmail: string,
  inviteRole: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "member_invited",
    resourceType: "user",
    changes: {
      metadata: { email: inviteEmail, role: inviteRole },
    },
    description: `Invited ${inviteEmail} with role ${inviteRole}`,
  });
}

/**
 * Log member removed
 */
export async function logMemberRemoved(
  context: AuditContext,
  removedUserId: string,
  removedUserEmail: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "member_removed",
    resourceType: "user",
    resourceId: removedUserId,
    changes: {
      metadata: { email: removedUserEmail },
    },
    description: `Removed member ${removedUserEmail}`,
  });
}

/**
 * Log member role changed
 */
export async function logMemberRoleChanged(
  context: AuditContext,
  targetUserId: string,
  targetUserEmail: string,
  oldRole: string,
  newRole: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "member_role_changed",
    resourceType: "user",
    resourceId: targetUserId,
    changes: {
      before: { role: oldRole },
      after: { role: newRole },
      metadata: { email: targetUserEmail },
    },
    description: `Changed ${targetUserEmail} role from ${oldRole} to ${newRole}`,
  });
}

/**
 * Log task created
 */
export async function logTaskCreated(
  context: AuditContext,
  taskId: string,
  jiraKey?: string,
  persona?: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "task_created",
    resourceType: "task",
    resourceId: taskId,
    changes: {
      metadata: { jiraKey, persona },
    },
    description: jiraKey
      ? `Created task from ${jiraKey}`
      : `Created task ${taskId}`,
  });
}

/**
 * Log task deleted
 */
export async function logTaskDeleted(
  context: AuditContext,
  taskId: string,
  jiraKey?: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "task_deleted",
    resourceType: "task",
    resourceId: taskId,
    changes: {
      metadata: { jiraKey },
    },
    description: jiraKey
      ? `Deleted task for ${jiraKey}`
      : `Deleted task ${taskId}`,
  });
}

/**
 * Log task cancelled
 */
export async function logTaskCancelled(
  context: AuditContext,
  taskId: string,
  jiraKey?: string,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "task_cancelled",
    resourceType: "task",
    resourceId: taskId,
    changes: {
      metadata: { jiraKey, reason },
    },
    description: jiraKey
      ? `Cancelled task for ${jiraKey}`
      : `Cancelled task ${taskId}`,
  });
}

/**
 * Log task retried
 */
export async function logTaskRetried(
  context: AuditContext,
  taskId: string,
  jiraKey?: string,
  retryCount?: number
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "task_retried",
    resourceType: "task",
    resourceId: taskId,
    changes: {
      metadata: { jiraKey, retryCount },
    },
    description: jiraKey
      ? `Retried task for ${jiraKey}`
      : `Retried task ${taskId}`,
  });
}

/**
 * Log API key created
 */
export async function logApiKeyCreated(
  context: AuditContext,
  keyId: string,
  keyName: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "api_key_created",
    resourceType: "api_key",
    resourceId: keyId,
    changes: {
      metadata: { name: keyName },
    },
    description: `Created API key "${keyName}"`,
  });
}

/**
 * Log API key revoked
 */
export async function logApiKeyRevoked(
  context: AuditContext,
  keyId: string,
  keyName: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "api_key_revoked",
    resourceType: "api_key",
    resourceId: keyId,
    changes: {
      metadata: { name: keyName },
    },
    description: `Revoked API key "${keyName}"`,
  });
}

/**
 * Log billing plan changed
 */
export async function logBillingPlanChanged(
  context: AuditContext,
  oldPlan: string,
  newPlan: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "billing_plan_changed",
    resourceType: "billing",
    resourceId: context.organizationId,
    changes: {
      before: { plan: oldPlan },
      after: { plan: newPlan },
    },
    description: `Changed plan from ${oldPlan} to ${newPlan}`,
  });
}

/**
 * Log billing subscription created
 */
export async function logSubscriptionCreated(
  context: AuditContext,
  subscriptionId: string,
  plan: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "billing_subscription_created",
    resourceType: "billing",
    resourceId: subscriptionId,
    changes: {
      metadata: { plan },
    },
    description: `Created ${plan} subscription`,
  });
}

/**
 * Log billing subscription cancelled
 */
export async function logSubscriptionCancelled(
  context: AuditContext,
  subscriptionId: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "billing_subscription_cancelled",
    resourceType: "billing",
    resourceId: subscriptionId,
    description: "Cancelled subscription",
  });
}

/**
 * Log orchestrator started
 */
export async function logOrchestratorStarted(
  context: AuditContext
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "orchestrator_started",
    resourceType: "organization",
    resourceId: context.organizationId,
    description: "Started orchestrator",
  });
}

/**
 * Log orchestrator stopped
 */
export async function logOrchestratorStopped(
  context: AuditContext
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "orchestrator_stopped",
    resourceType: "organization",
    resourceId: context.organizationId,
    description: "Stopped orchestrator",
  });
}

/**
 * Log webhook configured
 */
export async function logWebhookConfigured(
  context: AuditContext,
  webhookType: string,
  enabled: boolean
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "webhook_configured",
    resourceType: "integration",
    changes: {
      metadata: { type: webhookType, enabled },
    },
    description: enabled
      ? `Configured ${webhookType} webhook`
      : `Disabled ${webhookType} webhook`,
  });
}

/**
 * Log integration connected
 */
export async function logIntegrationConnected(
  context: AuditContext,
  integrationType: string,
  integrationName?: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "integration_connected",
    resourceType: "integration",
    changes: {
      metadata: { type: integrationType, name: integrationName },
    },
    description: `Connected ${integrationType} integration${integrationName ? `: ${integrationName}` : ""}`,
  });
}

/**
 * Log integration disconnected
 */
export async function logIntegrationDisconnected(
  context: AuditContext,
  integrationType: string
): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "integration_disconnected",
    resourceType: "integration",
    changes: {
      metadata: { type: integrationType },
    },
    description: `Disconnected ${integrationType} integration`,
  });
}

/**
 * Log user login
 */
export async function logLogin(context: AuditContext): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "login",
    resourceType: "user",
    resourceId: context.userId || undefined,
    description: "User logged in",
  });
}

/**
 * Log user logout
 */
export async function logLogout(context: AuditContext): Promise<AuditLog> {
  return logAuditEvent(context, {
    action: "logout",
    resourceType: "user",
    resourceId: context.userId || undefined,
    description: "User logged out",
  });
}

/**
 * Query audit logs with filters
 */
export interface AuditLogFilters {
  organizationId: string;
  userId?: string;
  action?: AuditAction;
  resourceType?: AuditResourceType;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogQueryResult {
  logs: AuditLog[];
  total: number;
  hasMore: boolean;
}

export async function queryAuditLogs(
  filters: AuditLogFilters
): Promise<AuditLogQueryResult> {
  const auditRepo = AppDataSource.getRepository(AuditLog);
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const qb = auditRepo
    .createQueryBuilder("log")
    .leftJoinAndSelect("log.user", "user")
    .where("log.organization_id = :orgId", { orgId: filters.organizationId })
    .orderBy("log.created_at", "DESC");

  if (filters.userId) {
    qb.andWhere("log.user_id = :userId", { userId: filters.userId });
  }

  if (filters.action) {
    qb.andWhere("log.action = :action", { action: filters.action });
  }

  if (filters.resourceType) {
    qb.andWhere("log.resource_type = :resourceType", {
      resourceType: filters.resourceType,
    });
  }

  if (filters.resourceId) {
    qb.andWhere("log.resource_id = :resourceId", {
      resourceId: filters.resourceId,
    });
  }

  if (filters.startDate) {
    qb.andWhere("log.created_at >= :startDate", {
      startDate: filters.startDate,
    });
  }

  if (filters.endDate) {
    qb.andWhere("log.created_at <= :endDate", { endDate: filters.endDate });
  }

  const [logs, total] = await qb.skip(offset).take(limit).getManyAndCount();

  return {
    logs,
    total,
    hasMore: offset + logs.length < total,
  };
}

/**
 * Get audit log retention period (days) for an organization
 * Based on plan: Free = 14 days, Pro = 90 days, Enterprise = 365 days
 */
export function getAuditRetentionDays(plan: string): number {
  switch (plan) {
    case "enterprise":
      return 365;
    case "pro":
      return 90;
    case "free":
    default:
      return 14;
  }
}

/**
 * Cleanup old audit logs based on retention policy
 */
export async function cleanupOldAuditLogs(
  organizationId: string,
  retentionDays: number
): Promise<number> {
  const auditRepo = AppDataSource.getRepository(AuditLog);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await auditRepo
    .createQueryBuilder()
    .delete()
    .from(AuditLog)
    .where("organization_id = :orgId", { orgId: organizationId })
    .andWhere("created_at < :cutoff", { cutoff: cutoffDate })
    .execute();

  const deletedCount = result.affected || 0;

  if (deletedCount > 0) {
    logger.info("Cleaned up old audit logs", {
      orgId: organizationId,
      deletedCount,
      retentionDays,
    });
  }

  return deletedCount;
}

/**
 * Get audit log summary for an organization
 */
export async function getAuditSummary(
  organizationId: string,
  days: number = 30
): Promise<{
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByUser: Array<{ userId: string; email: string; count: number }>;
  recentActivity: AuditLog[];
}> {
  const auditRepo = AppDataSource.getRepository(AuditLog);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Get total events
  const totalEvents = await auditRepo
    .createQueryBuilder("log")
    .where("log.organization_id = :orgId", { orgId: organizationId })
    .andWhere("log.created_at >= :startDate", { startDate })
    .getCount();

  // Get events by action
  const actionCounts = await auditRepo
    .createQueryBuilder("log")
    .select("log.action", "action")
    .addSelect("COUNT(*)", "count")
    .where("log.organization_id = :orgId", { orgId: organizationId })
    .andWhere("log.created_at >= :startDate", { startDate })
    .groupBy("log.action")
    .getRawMany();

  const eventsByAction: Record<string, number> = {};
  for (const row of actionCounts) {
    eventsByAction[row.action] = parseInt(row.count, 10);
  }

  // Get events by user
  const userCounts = await auditRepo
    .createQueryBuilder("log")
    .leftJoin("log.user", "user")
    .select("log.user_id", "userId")
    .addSelect("user.email", "email")
    .addSelect("COUNT(*)", "count")
    .where("log.organization_id = :orgId", { orgId: organizationId })
    .andWhere("log.created_at >= :startDate", { startDate })
    .andWhere("log.user_id IS NOT NULL")
    .groupBy("log.user_id")
    .addGroupBy("user.email")
    .orderBy("count", "DESC")
    .limit(10)
    .getRawMany();

  const eventsByUser = userCounts.map((row) => ({
    userId: row.userId,
    email: row.email || "Unknown",
    count: parseInt(row.count, 10),
  }));

  // Get recent activity
  const recentActivity = await auditRepo.find({
    where: { organizationId },
    order: { createdAt: "DESC" },
    take: 10,
    relations: ["user"],
  });

  return {
    totalEvents,
    eventsByAction,
    eventsByUser,
    recentActivity,
  };
}

/**
 * Export audit logs to JSON (for compliance/data export)
 */
export async function exportAuditLogs(
  organizationId: string,
  startDate?: Date,
  endDate?: Date
): Promise<AuditLog[]> {
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const qb = auditRepo
    .createQueryBuilder("log")
    .leftJoinAndSelect("log.user", "user")
    .where("log.organization_id = :orgId", { orgId: organizationId })
    .orderBy("log.created_at", "ASC");

  if (startDate) {
    qb.andWhere("log.created_at >= :startDate", { startDate });
  }

  if (endDate) {
    qb.andWhere("log.created_at <= :endDate", { endDate });
  }

  return qb.getMany();
}
