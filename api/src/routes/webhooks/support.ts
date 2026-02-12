import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization } from "../../models/index.js";
import type { WorkerPersona } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { logTaskCreated, type AuditContext } from "../../services/audit.js";
import { body, validateRequest } from "../../middleware/validation.js";

const router = Router();

/**
 * POST /api/webhooks/support
 * Internal webhook to trigger AI support agent for a new support ticket
 *
 * This is called by the support routes after ticket creation when:
 * 1. Support agent is enabled (SUPPORT_AGENT_ENABLED=true)
 * 2. Ticket category is in the auto-response list
 * 3. Ticket priority is not in the escalation list
 *
 * Creates a WorkerTask with sourceType: "support_ticket" that the orchestrator
 * will pick up and spawn the support_agent persona.
 */
router.post(
  "/support",
  body("ticketId")
    .isUUID()
    .withMessage("ticketId must be a valid UUID"),
  body("ticketKey")
    .isString()
    .notEmpty()
    .withMessage("ticketKey is required"),
  body("subject")
    .isString()
    .notEmpty()
    .withMessage("subject is required"),
  body("description")
    .isString()
    .withMessage("description must be a string"),
  body("category")
    .isString()
    .withMessage("category must be a string"),
  body("priority")
    .isString()
    .withMessage("priority must be a string"),
  body("orgId")
    .isUUID()
    .withMessage("orgId must be a valid UUID"),
  body("createdBy")
    .isUUID()
    .withMessage("createdBy must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const {
        ticketId,
        ticketKey,
        subject,
        description,
        category,
        priority,
        orgId,
        createdBy,
      } = req.body;

      // Check if support agent is enabled
      if (!config.supportAgent.enabled) {
        logger.info(
          "Support agent disabled, skipping auto-response",
          { ticketKey }
        );
        res.json({
          status: "skipped",
          reason: "Support agent disabled",
        });
        return;
      }

      // Check if category is in auto-response list
      if (
        !config.supportAgent.autoResponseCategories.includes(
          category
        )
      ) {
        logger.info("Category not in auto-response list", {
          ticketKey,
          category,
        });
        res.json({
          status: "skipped",
          reason: `Category '${category}' not configured for auto-response`,
        });
        return;
      }

      // Check if priority requires immediate escalation
      if (
        config.supportAgent.escalationPriorities.includes(priority)
      ) {
        logger.info(
          "Priority requires escalation, skipping auto-response",
          { ticketKey, priority }
        );
        res.json({
          status: "skipped",
          reason: `Priority '${priority}' requires human escalation`,
        });
        return;
      }

      // Get the organization to verify it exists
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: orgId } });

      if (!org) {
        logger.error(
          "Organization not found for support ticket",
          { orgId, ticketKey }
        );
        res
          .status(404)
          .json({ error: "Organization not found" });
        return;
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
        logger.info(
          "Support task already exists for ticket",
          { ticketKey, taskId: existingTask.id }
        );
        res.json({
          status: "exists",
          taskId: existingTask.id,
        });
        return;
      }

      // Create the support agent task
      const task = taskRepo.create({
        jiraIssueKey: ticketKey, // Use ticketKey as identifier
        summary: `Support: ${subject}`,
        description: description || null,
        workerPersona: "support_agent" as WorkerPersona,
        workerModel: config.supportAgent.defaultModel,
        scmProvider: org.scmProvider || "github",
        githubRepo: "", // Support tasks don't need a repo
        status: "queued",
        orgId,
        skipManagerReview: true, // Support responses don't need manager review
        jiraFields: {
          ticketId,
          ticketKey,
          category,
          priority,
          supportAgentVersion: "1.0",
          sourceType: "support_ticket",
        },
      });

      await taskRepo.save(task);

      logger.info("Support agent task created", {
        taskId: task.id,
        ticketKey,
        category,
        priority,
        model: config.supportAgent.defaultModel,
      });

      // Log audit event
      const auditContext: AuditContext = {
        organizationId: orgId,
        userId: createdBy || null,
      };
      await logTaskCreated(
        auditContext,
        task.id,
        ticketKey,
        "support_agent"
      );

      res.status(202).json({
        status: "created",
        taskId: task.id,
        ticketKey,
        message: "Support agent task queued for processing",
      });
    } catch (error) {
      logger.error("Error creating support agent task", { error });
      res
        .status(500)
        .json({ error: "Failed to create support agent task" });
    }
  }
);

export default router;
