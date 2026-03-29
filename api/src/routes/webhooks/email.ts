import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import {
  WorkerTask,
  Organization,
  User,
  AuthorizedEmailSender,
  InboundEmailMapping,
} from "../../models/index.js";
import type { WorkerPersona } from "../../models/WorkerTask.js";
import { logger } from "../../utils/logger.js";
import { logTaskCreated } from "../../services/audit.js";
import { trackLegacyWebhookUsage } from "../../services/legacy-webhook-alert.js";
import { body, validateRequest } from "../../middleware/validation.js";
import {
  normalizeRepoWithOwner,
  isDuplicateWebhook,
  verifyEmailSignature,
  extractLabelsFromSubject,
  parseRecipientAction,
} from "./helpers.js";

const router = Router();

/**
 * POST /api/webhooks/email
 * Handle inbound email webhooks from AWS SES Lambda
 *
 * The Lambda function parses incoming emails and forwards them here with:
 * - messageId: SES message ID
 * - source: Sender email address
 * - recipients: Array of recipient addresses
 * - timestamp: When email was received
 * - content: Parsed email content (subject, body, html)
 */
router.post(
  "/email",
  body("messageId")
    .notEmpty()
    .isString()
    .withMessage("messageId is required"),
  body("source")
    .notEmpty()
    .isEmail()
    .withMessage("source must be a valid email"),
  body("recipients")
    .isArray()
    .withMessage("recipients must be an array"),
  body("timestamp").optional().isString(),
  body("content").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      // Log webhook receipt with deprecation warning
      logger.warn(
        "DEPRECATED: Legacy /email webhook endpoint used. Consider migrating to URL-based routing for multi-tenant isolation."
      );

      const signature = req.headers["x-email-signature"] as string;
      const rawBody = JSON.stringify(req.body);

      const { messageId, source, recipients, timestamp, content } =
        req.body;

      logger.info("Email webhook received", {
        messageId,
        source,
        recipients,
        hasContent: !!content,
      });

      // Find org from recipient email pattern
      // Recipients could be: task@workermill.com, backend@workermill.com, orgslug@workermill.com
      const orgRepo = AppDataSource.getRepository(Organization);
      const mappingRepo =
        AppDataSource.getRepository(InboundEmailMapping);
      const senderRepo = AppDataSource.getRepository(
        AuthorizedEmailSender
      );
      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Try to find org from email mapping or by matching recipient patterns
      let org: Organization | null = null;
      let matchedMapping: InboundEmailMapping | null = null;

      for (const recipient of recipients) {
        // Check for explicit email mapping
        const mapping = await mappingRepo
          .createQueryBuilder("mapping")
          .where("mapping.is_active = true")
          .andWhere(
            ":recipient LIKE REPLACE(mapping.email_pattern, '*', '%')",
            { recipient }
          )
          .orderBy("mapping.created_at", "ASC")
          .getOne();

        if (mapping) {
          matchedMapping = mapping;
          org = await orgRepo.findOne({
            where: { id: mapping.orgId },
          });
          break;
        }
      }

      // SECURITY FIX: Only fall back to active user's org, NEVER to arbitrary org selection
      if (!org) {
        const userRepo = AppDataSource.getRepository(User);
        const activeUser = await userRepo.findOne({
          where: { status: "active" },
          relations: ["organization"],
        });
        org = activeUser?.organization ?? null;
      }

      // SECURITY: Do NOT fall back to arbitrary org - require explicit org identification
      if (!org) {
        logger.error("Email webhook: cannot identify organization", {
          recipients,
          hint: "Configure email mapping or ensure active users exist",
        });
        res.status(400).json({
          error: "Cannot identify organization for this email",
          hint: "Configure an inbound email mapping in Settings > Integrations > Inbound Email",
        });
        return;
      }

      // Track legacy endpoint usage for alerting
      await trackLegacyWebhookUsage({
        integrationType: "email",
        orgId: org.id,
        orgName: org.name,
        sourceIp: req.ip || req.socket.remoteAddress,
        userAgent: req.headers["user-agent"],
      });

      // Get email webhook secret from org's provider settings
      const emailWebhookSecret = (
        org.providerSettings as Record<string, unknown>
      )?.emailWebhookSecret as string | undefined;

      if (!emailWebhookSecret) {
        logger.error("Email webhook secret not configured", {
          orgId: org.id,
        });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      // Verify signature
      if (
        !verifyEmailSignature(rawBody, signature, emailWebhookSecret)
      ) {
        logger.warn("Invalid email webhook signature", {
          orgId: org.id,
          messageId,
        });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Idempotency check
      if (
        await isDuplicateWebhook(
          messageId,
          "email",
          org.id,
          "inbound"
        )
      ) {
        res.json({
          status: "duplicate",
          reason: "Email already processed",
        });
        return;
      }

      // Check if sender is authorized
      const authorizedSenders = await senderRepo.find({
        where: { orgId: org.id, isActive: true },
      });

      const senderAuthorized =
        authorizedSenders.length === 0 || // No whitelist = allow all
        authorizedSenders.some((sender) => sender.matches(source));

      if (!senderAuthorized) {
        logger.warn("Unauthorized email sender", {
          orgId: org.id,
          source,
          messageId,
        });
        res.json({
          status: "ignored",
          reason: "Sender not authorized",
        });
        return;
      }

      // Parse first recipient to determine action
      const primaryRecipient = recipients[0] || "";
      const {
        action,
        persona: inferredPersona,
        taskId,
      } = parseRecipientAction(primaryRecipient);

      // Extract subject and body from content
      const subject = content?.subject || "";
      const body = content?.body || "";

      // Handle reply_to_task action
      if (action === "reply_to_task" && taskId) {
        const existingTask = await taskRepo.findOne({
          where: { id: taskId, orgId: org.id },
        });

        if (!existingTask) {
          logger.warn("Task not found for email reply", {
            taskId,
            messageId,
          });
          res.json({
            status: "ignored",
            reason: "Task not found",
          });
          return;
        }

        // Append email content to task notes
        const noteEntry = `\n\n---\n**Email from ${source}** (${timestamp || new Date().toISOString()})\n\n${subject ? `**Subject:** ${subject}\n\n` : ""}${body}`;
        existingTask.taskNotes =
          (existingTask.taskNotes || "") + noteEntry;
        await taskRepo.save(existingTask);

        logger.info("Appended email content to task", {
          taskId,
          messageId,
          source,
        });

        res.json({
          status: "updated",
          taskId,
          message: "Email content appended to task notes",
        });
        return;
      }

      // Create new task from email
      const labels = extractLabelsFromSubject(subject);

      // Determine workflow flags from labels
      const deploymentEnabled = labels.includes("deploy");
      const skipManagerReview = !labels.includes("review");
      const managerEnabled = labels.includes("manager");

      // Determine persona (from recipient, labels, or mapping config)
      let persona: WorkerPersona =
        (inferredPersona as WorkerPersona) || "backend_developer";
      const personaLabels = [
        "backend",
        "frontend",
        "devops",
        "qa",
        "security",
        "docs",
        "pm",
      ];
      const labelPersona = labels.find((l) =>
        personaLabels.includes(l)
      );
      if (labelPersona) {
        const personaMap: Record<string, WorkerPersona> = {
          backend: "backend_developer",
          frontend: "frontend_developer",
          devops: "devops_engineer",
          qa: "qa_engineer",
          security: "security_engineer",
          docs: "tech_writer",
          pm: "project_manager",
        };
        persona = personaMap[labelPersona] || persona;
      }
      if (matchedMapping?.actionConfig?.defaultPersona) {
        persona = matchedMapping.actionConfig
          .defaultPersona as WorkerPersona;
      }

      // Determine model from labels
      let model = org.defaultWorkerModel || "";
      if (labels.includes("opus")) {
        model = "claude-opus-4-6";
      } else if (labels.includes("sonnet")) {
        model = "claude-sonnet-4-6";
      } else if (labels.includes("haiku")) {
        model = "claude-haiku-4-5-20251001";
      }

      // Check for repo override in labels
      const repoLabel = labels.find((l) => l.startsWith("repo:"));
      const repoOverride = repoLabel
        ? repoLabel.substring(5)
        : null;
      const targetRepo = normalizeRepoWithOwner(
        repoOverride,
        org.getDefaultRepo()
      );

      // Generate issue key from email
      const issueKey = `EMAIL-${messageId.substring(0, 8)}`;

      // Clean subject for summary (remove label brackets)
      const cleanSubject =
        subject.replace(/\[[^\]]{0,200}\]/g, "").trim() ||
        "Task from email";

      // Epic mode is now the DEFAULT (standard workflow deprecated)
      // Use 'standard' or 'v1' label to explicitly opt-out
      const hasStandardLabel = labels.some(
        (l: string) =>
          l.toLowerCase() === "standard" ||
          l.toLowerCase() === "v1"
      );
      const isV2Pipeline = !hasStandardLabel;
      const isMultiProvider = labels.some(
        (l: string) => l.toLowerCase() === "multi-provider"
      );
      const hasCriticLabel = labels.some(
        (l: string) => l.toLowerCase() === "critic"
      );

      // Check if Epic mode can be used (Anthropic only, no routing overrides)
      const hasRoutingOverrides =
        org.providerRouting &&
        Object.keys(
          org.providerRouting as Record<string, unknown>
        ).length > 0;
      const canUseEpicMode =
        (org.primaryProvider === "anthropic" ||
          !org.primaryProvider) &&
        !hasRoutingOverrides;

      // Tasks needing planning: Epic (default) or Multi-Provider
      const needsPlanning = isV2Pipeline || isMultiProvider;
      const initialStatus = needsPlanning ? "planning" : "queued";
      const taskPersona = needsPlanning
        ? "project_manager"
        : persona;

      // Pipeline and execution mode
      let pipelineVersion: "v1" | "v2" | null = null;
      let executionMode:
        | "single"
        | "sequential"
        | "parallel"
        | "multi-expert" = "single";
      if (isV2Pipeline && canUseEpicMode) {
        pipelineVersion = "v2";
        executionMode = "parallel"; // Epic mode (Anthropic only)
      } else if (isV2Pipeline || isMultiProvider) {
        pipelineVersion = "v2";
        executionMode = "multi-expert"; // Multi-provider mode (any provider)
      }

      // Create task
      const task = taskRepo.create({
        orgId: org.id,
        jiraIssueKey: issueKey,
        jiraIssueId: messageId,
        summary: cleanSubject,
        description: body,
        jiraFields: {
          source: "email",
          emailFrom: source,
          emailRecipients: recipients,
          emailTimestamp: timestamp,
          originalSubject: subject,
        },
        workerPersona: taskPersona,
        workerModel: model,
        workerProvider: org.primaryProvider || "anthropic",
        scmProvider: org.scmProvider || "github",
        githubRepo: targetRepo,
        status: initialStatus,
        pipelineVersion,
        executionMode,
        criticEnabled: hasCriticLabel,
        deploymentEnabled,
        skipManagerReview,
        managerEnabled,
        retryCount: 0,
        maxRetries: 3,
      });

      await taskRepo.save(task);

      // Log audit event
      try {
        await logTaskCreated(
          { organizationId: org.id },
          task.id,
          issueKey,
          persona
        );
      } catch (auditError) {
        logger.warn("Failed to log audit event for email task", {
          error: auditError,
        });
      }

      logger.info("Created worker task from email", {
        taskId: task.id,
        issueKey,
        messageId,
        source,
        persona,
        model,
        orgId: org.id,
      });

      res.status(201).json({
        status: "created",
        taskId: task.id,
        issueKey,
        persona,
        model,
      });
    } catch (error) {
      logger.error("Error processing email webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
