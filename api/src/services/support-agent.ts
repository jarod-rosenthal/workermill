/**
 * Support Agent Service
 *
 * Handles triggering and managing AI support agent tasks for support tickets.
 *
 * DUAL ORG PATTERN:
 * Support agent tasks use two org IDs:
 * - orgId: Customer org (for ticket context, access control)
 * - billingOrgId: Platform org (for credentials, cost tracking)
 *
 * This allows support tasks to be billed to the platform (WorkerMill pays)
 * while still being associated with customer tickets.
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, SupportTicket } from "../models/index.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { logTaskCreated, type AuditContext } from "./audit.js";

interface TriggerSupportAgentParams {
  ticketId: string;
  ticketKey: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  orgId: string;
  userId?: string;
}

interface TriggerSupportAgentResult {
  status: "created" | "skipped" | "exists";
  taskId: string | null;
  reason?: string;
}

/**
 * Trigger an AI support agent task for a support ticket
 *
 * This function checks configuration and creates a WorkerTask for the support_agent persona.
 * The orchestrator will pick up the task and spawn a worker to respond to the ticket.
 */
export async function triggerSupportAgentTask(
  params: TriggerSupportAgentParams
): Promise<TriggerSupportAgentResult> {
  const { ticketId, ticketKey, subject, description, category, priority, orgId, userId } = params;

  // Check if support agent is enabled
  if (!config.supportAgent.enabled) {
    logger.debug("Support agent disabled, skipping auto-response", { ticketKey });
    return { status: "skipped", taskId: null, reason: "Support agent disabled" };
  }

  // Check if category is in auto-response list
  if (!config.supportAgent.autoResponseCategories.includes(category)) {
    logger.debug("Category not in auto-response list", { ticketKey, category });
    return {
      status: "skipped",
      taskId: null,
      reason: `Category '${category}' not configured for auto-response`,
    };
  }

  // Check if priority requires immediate escalation
  if (config.supportAgent.escalationPriorities.includes(priority)) {
    logger.debug("Priority requires escalation, skipping auto-response", { ticketKey, priority });
    return {
      status: "skipped",
      taskId: null,
      reason: `Priority '${priority}' requires human escalation`,
    };
  }

  // Get the organization to verify it exists
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    logger.error("Organization not found for support ticket", { orgId, ticketKey });
    throw new Error("Organization not found");
  }

  // Fetch platform org for billing (credentials + cost attribution)
  const platformOrg = await Organization.getPlatformOrg();
  if (!platformOrg) {
    logger.error("Platform organization not configured - support agent disabled", { ticketKey });
    return {
      status: "skipped",
      taskId: null,
      reason: "Platform organization not configured",
    };
  }

  // Check for existing support task for this ticket (use jiraIssueKey + persona)
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const existingTask = await taskRepo.findOne({
    where: {
      jiraIssueKey: ticketKey,
      workerPersona: "support_agent",
      orgId,
    },
  });

  if (existingTask) {
    logger.info("Support task already exists for ticket", { ticketKey, taskId: existingTask.id });
    return { status: "exists", taskId: existingTask.id };
  }

  // Create the support agent task in the PLATFORM ORG (Management tenant)
  // Customer should NOT see support agent tasks in their tenant
  const task = taskRepo.create({
    jiraIssueKey: ticketKey, // Use ticketKey as identifier
    summary: `Support: ${subject}`,
    description: description || null,
    workerPersona: "support_agent" as WorkerPersona,
    workerModel: config.supportAgent.defaultModel,
    githubRepo: "workermill/workermill", // Support agent searches WorkerMill codebase
    status: "queued",
    orgId: platformOrg.id, // Platform org - task runs here, visible only to platform admins
    isPlatformTask: true, // Mark as platform-initiated
    skipManagerReview: true, // Support responses don't need manager review
    jiraFields: {
      ticketId,
      ticketKey,
      category,
      priority,
      supportAgentVersion: "1.0",
      sourceType: "support_ticket",
      customerOrgId: orgId, // Store customer org ID for reference
      customerOrgName: org.name, // Store customer org name for reference
    },
  });

  await taskRepo.save(task);

  // Update the support ticket with AI task reference
  const ticketRepo = AppDataSource.getRepository(SupportTicket);
  await ticketRepo.update(ticketId, {
    autoResponseAttempted: true,
    aiResponseTaskId: task.id,
  });

  logger.info("Support agent task created", {
    taskId: task.id,
    ticketKey,
    category,
    priority,
    model: config.supportAgent.defaultModel,
    platformOrgId: platformOrg.id,
    customerOrgId: orgId,
    customerOrgName: org.name,
    isPlatformTask: true,
  });

  // Log audit event (log under platform org since task runs there)
  const auditContext: AuditContext = {
    organizationId: platformOrg.id,
    userId: userId || null,
  };
  await logTaskCreated(auditContext, task.id, ticketKey, "support_agent");

  return { status: "created", taskId: task.id };
}

/**
 * Update support ticket after AI response is posted
 *
 * Called by the support agent executor after successfully posting a response.
 */
export async function recordSupportAgentResponse(
  ticketId: string,
  taskId: string,
  confidenceScore: number,
  modelUsed: string
): Promise<void> {
  const ticketRepo = AppDataSource.getRepository(SupportTicket);

  await ticketRepo.update(ticketId, {
    aiConfidenceScore: confidenceScore,
    aiModelUsed: modelUsed,
    aiRespondedAt: new Date(),
  });

  logger.info("Support ticket AI response recorded", {
    ticketId,
    taskId,
    confidenceScore,
    modelUsed,
  });
}

/**
 * Record escalation reason when AI decides to escalate
 *
 * Called by the support agent executor when escalating to human support.
 */
export async function recordSupportAgentEscalation(
  ticketId: string,
  taskId: string,
  escalationReason: string,
  confidenceScore: number
): Promise<void> {
  const ticketRepo = AppDataSource.getRepository(SupportTicket);

  await ticketRepo.update(ticketId, {
    aiConfidenceScore: confidenceScore,
    aiEscalationReason: escalationReason,
    aiRespondedAt: new Date(),
    // Move ticket to in_progress when escalating
    status: "in_progress",
  });

  logger.info("Support ticket escalated by AI", {
    ticketId,
    taskId,
    escalationReason,
    confidenceScore,
  });
}

/**
 * Get support agent statistics for analytics
 */
export async function getSupportAgentStats(orgId: string): Promise<{
  totalTickets: number;
  autoResponded: number;
  escalated: number;
  avgConfidenceScore: number | null;
  avgResponseTimeSeconds: number | null;
}> {
  const ticketRepo = AppDataSource.getRepository(SupportTicket);

  // Total tickets with AI attempt
  const totalResult = await ticketRepo
    .createQueryBuilder("ticket")
    .where("ticket.orgId = :orgId", { orgId })
    .andWhere("ticket.autoResponseAttempted = true")
    .getCount();

  // Auto-responded (has aiRespondedAt and no escalation reason)
  const autoRespondedResult = await ticketRepo
    .createQueryBuilder("ticket")
    .where("ticket.orgId = :orgId", { orgId })
    .andWhere("ticket.aiRespondedAt IS NOT NULL")
    .andWhere("ticket.aiEscalationReason IS NULL")
    .getCount();

  // Escalated (has escalation reason)
  const escalatedResult = await ticketRepo
    .createQueryBuilder("ticket")
    .where("ticket.orgId = :orgId", { orgId })
    .andWhere("ticket.aiEscalationReason IS NOT NULL")
    .getCount();

  // Average confidence score
  const avgConfidenceResult = await ticketRepo
    .createQueryBuilder("ticket")
    .select("AVG(ticket.aiConfidenceScore)", "avgScore")
    .where("ticket.orgId = :orgId", { orgId })
    .andWhere("ticket.aiConfidenceScore IS NOT NULL")
    .getRawOne();

  // Average response time (from ticket creation to AI response)
  const avgResponseTimeResult = await ticketRepo
    .createQueryBuilder("ticket")
    .select(
      "AVG(EXTRACT(EPOCH FROM (ticket.aiRespondedAt - ticket.createdAt)))",
      "avgSeconds"
    )
    .where("ticket.orgId = :orgId", { orgId })
    .andWhere("ticket.aiRespondedAt IS NOT NULL")
    .getRawOne();

  return {
    totalTickets: totalResult,
    autoResponded: autoRespondedResult,
    escalated: escalatedResult,
    avgConfidenceScore: avgConfidenceResult?.avgScore
      ? parseFloat(avgConfidenceResult.avgScore)
      : null,
    avgResponseTimeSeconds: avgResponseTimeResult?.avgSeconds
      ? parseFloat(avgResponseTimeResult.avgSeconds)
      : null,
  };
}
