import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization, User } from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { logger } from "../../utils/logger.js";
import { logTaskCreated } from "../../services/audit.js";
import { trackLegacyWebhookUsage } from "../../services/legacy-webhook-alert.js";
import { syncIssueRelationships } from "../../services/task-relationship-sync.js";
import { KbCard } from "../../models/KbCard.js";
import { fetchLinearIssue } from "../../utils/linear.js";
import { body, validateRequest } from "../../middleware/validation.js";
import {
  normalizeRepoWithOwner,
  isDuplicateWebhook,
  verifyLinearSignature,
} from "./helpers.js";
import { resetCancelledTask } from "../tasks/lifecycle.js";

const router = Router();

/**
 * POST /api/webhooks/linear
 * Handle Linear webhook events
 *
 * Linear webhook handler (DEPRECATED — use org-scoped /:orgSlug/linear instead).
 * Triggers on issue create/update events. Requires `workermill` label on the issue.
 * Note: Linear label-based triggering is not currently active in production.
 */
router.post(
  "/linear",
  // Validate Linear webhook payload
  body("action")
    .optional()
    .isString()
    .withMessage("action must be a string"),
  body("type")
    .optional()
    .isString()
    .withMessage("type must be a string"),
  body("data")
    .optional()
    .isObject()
    .withMessage("data must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
    // Log webhook receipt with deprecation warning
    logger.warn("DEPRECATED: Legacy /linear webhook endpoint used. Migrate to /:orgSlug/linear for proper multi-tenant isolation.");

    const signature = req.headers["linear-signature"] as string;
    const rawBody = JSON.stringify(req.body);

    // SECURITY: Legacy endpoint - try to identify org, but NEVER fall back to arbitrary org selection
    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Try to find org with active users
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    const org = activeUser?.organization;

    // SECURITY FIX: Do NOT fall back to arbitrary org - require explicit org identification
    if (!org) {
      logger.error("Legacy Linear webhook: cannot identify organization", {
        hint: "Use org-scoped endpoint: /api/webhooks/:orgSlug/linear",
      });
      res.status(400).json({
        error: "Cannot identify organization for this webhook",
        hint: "Please update your Linear webhook URL to use the org-scoped format: /api/webhooks/{your-org-slug}/linear",
      });
      return;
    }

    // Track legacy endpoint usage for alerting
    await trackLegacyWebhookUsage({
      integrationType: "linear",
      orgId: org.id,
      orgName: org.name,
      sourceIp: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    logger.warn("Legacy Linear webhook endpoint used - consider migrating to org-scoped URL", {
      orgId: org.id,
      recommendedUrl: `/api/webhooks/${org.slug || org.id}/linear`,
    });

    // Verify signature - secret configuration is REQUIRED for security
    const linearSecret = (org.providerSettings as Record<string, unknown>)?.linearWebhookSecret as string | undefined;
    if (!linearSecret) {
      logger.error("Linear webhook secret not configured", { orgId: org.id });
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }
    if (!verifyLinearSignature(rawBody, signature, linearSecret)) {
      logger.warn("Invalid or missing Linear webhook signature", { orgId: org.id });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Idempotency check - prevent duplicate processing
    const deliveryId = req.headers["x-linear-delivery"] as string || req.headers["linear-delivery"] as string;
    const { action, type, data } = req.body;
    if (await isDuplicateWebhook(deliveryId, "linear", org.id, `${type}.${action}`)) {
      res.json({ status: "duplicate", reason: "Webhook already processed" });
      return;
    }

    // Only process issue events
    if (type !== "Issue") {
      res.json({ status: "ignored", reason: "Not an issue event" });
      return;
    }

    // Only process create/update events
    if (!["create", "update"].includes(action)) {
      res.json({ status: "ignored", reason: `Ignoring action: ${action}` });
      return;
    }

    const issue = data;
    const labels = issue.labels || [];
    const labelNames = labels.map((l: { name: string }) => l.name.toLowerCase());

    // Check for workermill label
    if (!labelNames.includes("workermill")) {
      res.json({ status: "ignored", reason: "Missing workermill label" });
      return;
    }

    const issueId = issue.id;
    const issueIdentifier = issue.identifier; // e.g., "LIN-123"
    const title = issue.title || "";
    let description = issue.description || "";

    // Backfill description from Linear API when webhook payload lacks it
    // (label-change update payloads only include changed fields, not description)
    if (!description && issueIdentifier) {
      try {
        const fullIssue = await fetchLinearIssue(org.id, issueIdentifier);
        if (fullIssue) {
          description = fullIssue.description;
        }
      } catch (err) {
        logger.warn("Failed to backfill Linear issue description", { issueIdentifier, error: err });
      }
    }

    // Check if task already exists
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey: issueIdentifier, orgId: org.id },
    });

    // Workflow labels
    const deploymentEnabled = labelNames.includes("deploy");
    const skipManagerReview = !labelNames.includes("review");
    const managerEnabled = labelNames.includes("manager");

    if (existingTask && !existingTask.isTerminal()) {
      // Handle deploy label being added to approved task
      if (
        existingTask.status === "pr_approved" &&
        deploymentEnabled &&
        !existingTask.deploymentEnabled
      ) {
        existingTask.deploymentEnabled = true;
        await taskRepo.save(existingTask);

        logger.info("Updated existing Linear task with deploy label", {
          taskId: existingTask.id,
          issueIdentifier,
        });

        res.json({
          status: "updated",
          reason: "Deploy label added",
          taskId: existingTask.id,
        });
        return;
      }

      // Calculate task age for debugging stuck tasks
      const taskAgeMs = existingTask.createdAt ? Date.now() - new Date(existingTask.createdAt).getTime() : 0;
      const taskAgeHours = Math.round(taskAgeMs / (1000 * 60 * 60) * 10) / 10;

      logger.warn("Linear webhook ignored - existing non-terminal task", {
        issueIdentifier,
        existingTaskId: existingTask.id,
        existingStatus: existingTask.status,
        taskAgeHours,
        startedAt: existingTask.startedAt,
        createdAt: existingTask.createdAt,
        hint: taskAgeHours > 2 ? "Task may be stuck - consider manually failing it" : undefined,
      });

      res.json({
        status: "ignored",
        reason: "Task already exists and is not complete",
        taskId: existingTask.id,
        taskStatus: existingTask.status,
        taskAgeHours,
      });
      return;
    }

    // If a terminal task exists (completed, failed, deployed), delete it to allow re-run
    // NOTE: Cancelled tasks are handled separately below (reset in-place instead of delete+recreate)
    // BUT: Do NOT delete PRD parent tasks with children - cascade delete would wipe all child work!
    const deletableTerminalStates = ["completed", "deployed", "failed"];
    if (existingTask && deletableTerminalStates.includes(existingTask.status)) {
      const hasChildren = existingTask.childTaskIds && existingTask.childTaskIds.length > 0;
      if (hasChildren) {
        logger.warn("Ignoring Linear webhook for terminal PRD parent - has children that would be cascade deleted", {
          taskId: existingTask.id,
          issueIdentifier,
          status: existingTask.status,
          childCount: existingTask.childTaskIds?.length,
        });
        res.json({
          status: "ignored",
          reason: "PRD workflow completed - children exist, cannot restart without losing work",
          taskId: existingTask.id,
          taskStatus: existingTask.status,
          childCount: existingTask.childTaskIds?.length,
        });
        return;
      }
      logger.info("Deleting terminal Linear task to allow re-run", {
        taskId: existingTask.id,
        issueIdentifier,
        oldStatus: existingTask.status,
      });
      await taskRepo.remove(existingTask);
    }

    // If task was cancelled, reset it for re-execution
    if (existingTask && existingTask.status === "cancelled") {
      await resetCancelledTask(existingTask);
      logger.info("Reset cancelled task from Linear webhook", {
        taskId: existingTask.id,
        issueIdentifier,
        newStatus: existingTask.status,
      });
      res.json({
        status: "reset",
        reason: "Cancelled task reset for re-execution",
        taskId: existingTask.id,
        taskStatus: existingTask.status,
      });
      return;
    }

    // PRD dedup: skip task creation if this issue was created by PRD decomposition
    const boardCardRepo = AppDataSource.getRepository(KbCard);
    const prdCard = await boardCardRepo
      .createQueryBuilder("card")
      .innerJoin("card.board", "board")
      .where("board.orgId = :orgId", { orgId: org.id })
      .andWhere("board.prd_content IS NOT NULL")
      .andWhere("card.title = :title", { title })
      .getOne();

    if (prdCard) {
      logger.info("Linear webhook: skipping PRD-synced ticket", { issueIdentifier, title });
      res.json({ status: "ignored", reason: "PRD-managed ticket" });
      return;
    }

    // Check for repo override label (e.g., "repo:astrofog")
    // If repo doesn't include owner (no "/"), prepend owner from defaultGithubRepo
    const repoLabel = labelNames.find((l: string) => l.startsWith("repo:"));
    const repoOverride = repoLabel ? repoLabel.substring(5) : null;
    const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

    // Infer persona from labels/content
    const persona = await inferPersonaFromJiraIssue(
      {
        summary: title,
        description,
        labels: labelNames,
        fields: { labels: labelNames },
      },
      undefined, // explicitPersona
      org.id     // orgId for org-specific inference rules
    );

    // Determine model
    let model = org.defaultWorkerModel || "";
    if (labelNames.includes("opus")) {
      model = "claude-opus-4-6";
    } else if (labelNames.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    } else if (labelNames.includes("haiku")) {
      model = "claude-haiku-4-5-20251001";
    }

    // Epic mode is now the DEFAULT (standard workflow deprecated)
    // Use 'standard' or 'v1' label to explicitly opt-out
    const hasStandardLabel = labelNames.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
    const isV2Pipeline = !hasStandardLabel;
    const isMultiProvider = labelNames.some((l: string) => l.toLowerCase() === "multi-provider");
    const hasCriticLabel = labelNames.some((l: string) => l.toLowerCase() === "critic");

    // Tasks needing planning: Epic (default) or Multi-Provider
    const needsPlanning = isV2Pipeline || isMultiProvider;
    const initialStatus = needsPlanning ? "planning" : "queued";
    const taskPersona = needsPlanning ? "project_manager" : persona;

    // Pipeline and execution mode
    // Epic mode only works with Anthropic and no routing overrides
    const hasRoutingOverrides = org.providerRouting &&
      Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
    const canUseEpicMode = org.primaryProvider === "anthropic" && !hasRoutingOverrides;

    let pipelineVersion: "v1" | "v2" | null = null;
    let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
    if (isV2Pipeline && canUseEpicMode) {
      pipelineVersion = "v2";
      executionMode = "parallel";
    } else if (isV2Pipeline || isMultiProvider) {
      pipelineVersion = "v2";
      executionMode = "multi-expert";
    }

    // Create task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueIdentifier,
      jiraIssueId: issueId,
      summary: title,
      description,
      jiraFields: issue,
      workerPersona: taskPersona,
      workerModel: model,
      workerProvider: "anthropic",
      ticketSystem: "linear",
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
        issueIdentifier,
        persona
      );
    } catch (auditError) {
      logger.warn("Failed to log audit event", { error: auditError });
    }

    logger.info("Created worker task from Linear webhook", {
      taskId: task.id,
      issueIdentifier,
      persona,
      model,
      orgId: org.id,
    });

    // Fire-and-forget: sync issue relationships (blocks/depends_on) from Linear
    syncIssueRelationships(task, org, "linear", issueId);

    res.status(201).json({
      status: "created",
      taskId: task.id,
      persona,
      model,
    });
    } catch (error) {
      logger.error("Error processing Linear webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * POST /api/webhooks/:orgSlug/linear
 * Multi-tenant Linear webhook handler
 */
router.post(
  "/:orgSlug/linear",
  body("action").optional().isString(),
  body("type").optional().isString(),
  body("data").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody = JSON.stringify(req.body);
      const signature = getSignatureFromHeaders(req.headers, "linear");
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "linear");

      const verification = await verifyWebhookBySlug(orgSlug, "linear", rawBody, signature as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;
      const { action, type, data } = req.body;

      // Idempotency
      if (deliveryId && await isDuplicateWebhook(deliveryId, "linear", org.id, `${type}.${action}`)) {
        res.json({ status: "duplicate" });
        return;
      }

      if (type !== "Issue" || !["create", "update"].includes(action)) {
        res.json({ status: "ignored", reason: "Not a relevant issue event" });
        return;
      }

      const issue = data;
      const labels = issue.labels || [];
      const labelNames = labels.map((l: { name: string }) => l.name.toLowerCase());

      if (!labelNames.includes("workermill")) {
        res.json({ status: "ignored", reason: "Missing workermill label" });
        return;
      }

      const issueIdentifier = issue.identifier;
      const title = issue.title || "";
      let description = issue.description || "";

      // Backfill description from Linear API when webhook payload lacks it
      // (label-change update payloads only include changed fields, not description)
      if (!description && issueIdentifier) {
        try {
          const fullIssue = await fetchLinearIssue(org.id, issueIdentifier);
          if (fullIssue) {
            description = fullIssue.description;
          }
        } catch (err) {
          logger.warn("Failed to backfill Linear issue description", { issueIdentifier, error: err });
        }
      }

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const existingTask = await taskRepo.findOne({
        where: { jiraIssueKey: issueIdentifier, orgId: org.id },
      });

      const deploymentEnabled = labelNames.includes("deploy");
      const skipManagerReview = !labelNames.includes("review");
      const managerEnabled = labelNames.includes("manager");

      if (existingTask && !existingTask.isTerminal()) {
        if (existingTask.status === "pr_approved" && deploymentEnabled && !existingTask.deploymentEnabled) {
          existingTask.deploymentEnabled = true;
          await taskRepo.save(existingTask);
          res.json({ status: "updated", taskId: existingTask.id });
          return;
        }
        res.json({
          status: "ignored",
          reason: "Task already exists",
          taskId: existingTask.id,
        });
        return;
      }

      if (existingTask && ["completed", "deployed", "failed"].includes(existingTask.status)) {
        if (!(existingTask.childTaskIds && existingTask.childTaskIds.length > 0)) {
          await taskRepo.remove(existingTask);
        } else {
          res.json({ status: "ignored", reason: "PRD with children" });
          return;
        }
      }

      if (existingTask && existingTask.status === "cancelled") {
        await resetCancelledTask(existingTask);
        res.json({ status: "reset", reason: "Cancelled task reset for re-execution", taskId: existingTask.id });
        return;
      }

      // PRD dedup: skip task creation if this issue was created by PRD decomposition
      const boardCardRepo = AppDataSource.getRepository(KbCard);
      const prdCard = await boardCardRepo
        .createQueryBuilder("card")
        .innerJoin("card.board", "board")
        .where("board.orgId = :orgId", { orgId: org.id })
        .andWhere("board.prd_content IS NOT NULL")
        .andWhere("card.title = :title", { title })
        .getOne();

      if (prdCard) {
        logger.info("Linear webhook: skipping PRD-synced ticket", { issueIdentifier, title });
        res.json({ status: "ignored", reason: "PRD-managed ticket" });
        return;
      }

      const repoLabel = labelNames.find((l: string) => l.startsWith("repo:"));
      const repoOverride = repoLabel ? repoLabel.substring(5) : null;
      const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

      const persona = await inferPersonaFromJiraIssue(
        {
          summary: title,
          description,
          labels: labelNames,
          fields: { labels: labelNames },
        },
        undefined, // explicitPersona
        org.id     // orgId for org-specific inference rules
      );

      let model = org.defaultWorkerModel || "";
      if (labelNames.includes("opus")) model = "claude-opus-4-6";
      else if (labelNames.includes("sonnet")) model = "claude-sonnet-4-5-20250929";
      else if (labelNames.includes("haiku")) model = "claude-haiku-4-5-20251001";

      // Epic mode is now the DEFAULT (standard workflow deprecated)
      const hasStandardLabel = labelNames.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
      const isV2Pipeline = !hasStandardLabel;
      const isMultiProvider = labelNames.some((l: string) => l.toLowerCase() === "multi-provider");
      const hasCriticLabel = labelNames.some((l: string) => l.toLowerCase() === "critic");

      // Check if Epic mode can be used (Anthropic only, no routing overrides)
      const hasRoutingOverrides = org.providerRouting &&
        Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
      const canUseEpicMode = (org.primaryProvider === "anthropic" || !org.primaryProvider) && !hasRoutingOverrides;

      const needsPlanning = isV2Pipeline || isMultiProvider;
      const initialStatus = needsPlanning ? "planning" : "queued";
      const taskPersona = needsPlanning ? "project_manager" : persona;

      let pipelineVersion: "v1" | "v2" | null = null;
      let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
      if (isV2Pipeline && canUseEpicMode) {
        pipelineVersion = "v2";
        executionMode = "parallel"; // Epic mode (Anthropic only)
      } else if (isV2Pipeline || isMultiProvider) {
        pipelineVersion = "v2";
        executionMode = "multi-expert"; // Multi-provider mode (any provider)
      }

      const task = taskRepo.create({
        orgId: org.id,
        jiraIssueKey: issueIdentifier,
        jiraIssueId: issue.id,
        summary: title,
        description,
        jiraFields: issue,
        workerPersona: taskPersona,
        workerModel: model,
        workerProvider: org.primaryProvider || "anthropic",
        ticketSystem: "linear",
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

      logger.info("Created task from multi-tenant Linear webhook", {
        taskId: task.id,
        issueIdentifier,
        orgSlug,
        pipelineVersion,
        initialStatus,
      });

      // Fire-and-forget: sync issue relationships (blocks/depends_on) from Linear
      syncIssueRelationships(task, org, "linear", issue.id);

      res.status(201).json({
        status: "created",
        taskId: task.id,
        persona,
        model,
      });
    } catch (error) {
      logger.error("Error processing multi-tenant Linear webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
