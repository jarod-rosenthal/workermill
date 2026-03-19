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
import {
  body,
  header,
  validateRequest,
} from "../../middleware/validation.js";
import {
  normalizeRepoWithOwner,
  isDuplicateWebhook,
  verifyGitHubSignature,
} from "./helpers.js";
import { resetCancelledTask } from "../tasks/lifecycle.js";

const router = Router();

/**
 * POST /api/webhooks/github-issues
 * Handle GitHub Issues webhook events (separate from PR reviews)
 *
 * Triggers task creation when issues are labeled with 'workermill'
 */
router.post(
  "/github-issues",
  // Validate GitHub Issues webhook headers and payload
  header("x-github-event")
    .optional()
    .isString()
    .withMessage("x-github-event must be a string"),
  body("action")
    .optional()
    .isString()
    .withMessage("action must be a string"),
  body("issue")
    .optional()
    .isObject()
    .withMessage("issue must be an object"),
  body("repository")
    .optional()
    .isObject()
    .withMessage("repository must be an object"),
  body("label")
    .optional()
    .isObject()
    .withMessage("label must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
    // Log webhook receipt with deprecation warning
    logger.warn("DEPRECATED: Legacy /github-issues webhook endpoint used. Migrate to /:orgSlug/github-issues for proper multi-tenant isolation.");

    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;
    const deliveryId = req.headers["x-github-delivery"] as string;
    const rawBody = JSON.stringify(req.body);

    logger.info("GitHub Issues webhook received", { event, hasSignature: !!signature, deliveryId });

    // Only process issues events
    if (event !== "issues") {
      res.json({ status: "ignored", reason: "Not an issues event" });
      return;
    }

    const { action, issue, repository, label } = req.body;

    // Process when issue is opened with label, or when label is added
    if (!["opened", "labeled"].includes(action)) {
      res.json({ status: "ignored", reason: `Ignoring action: ${action}` });
      return;
    }

    // Get labels from issue
    const labels = issue?.labels?.map((l: { name: string }) => l.name.toLowerCase()) || [];

    // For 'labeled' action, check if the added label is 'workermill'
    if (action === "labeled" && label?.name?.toLowerCase() !== "workermill") {
      res.json({ status: "ignored", reason: "Added label is not workermill" });
      return;
    }

    // For 'opened' action, check if workermill label exists
    if (action === "opened" && !labels.includes("workermill")) {
      res.json({ status: "ignored", reason: "Missing workermill label" });
      return;
    }

    // If labeled action and workermill, make sure it's in the labels list
    if (action === "labeled" && !labels.includes("workermill")) {
      labels.push("workermill");
    }

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
      logger.error("Legacy GitHub Issues webhook: cannot identify organization", {
        hint: "Use org-scoped endpoint: /api/webhooks/:orgSlug/github-issues",
      });
      res.status(400).json({
        error: "Cannot identify organization for this webhook",
        hint: "Please update your GitHub webhook URL to use the org-scoped format: /api/webhooks/{your-org-slug}/github-issues",
      });
      return;
    }

    // Track legacy endpoint usage for alerting
    await trackLegacyWebhookUsage({
      integrationType: "github-issues",
      orgId: org.id,
      orgName: org.name,
      sourceIp: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    logger.warn("Legacy GitHub Issues webhook endpoint used - consider migrating to org-scoped URL", {
      orgId: org.id,
      recommendedUrl: `/api/webhooks/${org.slug || org.id}/github-issues`,
    });

    // Verify signature - secret configuration is REQUIRED for security
    if (!org.githubWebhookSecret) {
      logger.error("GitHub webhook secret not configured", { orgId: org.id });
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }
    if (!verifyGitHubSignature(rawBody, signature, org.githubWebhookSecret)) {
      logger.warn("Invalid GitHub Issues webhook signature", { orgId: org.id });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Idempotency check - prevent duplicate processing
    if (await isDuplicateWebhook(deliveryId, "github-issues", org.id, `issues.${action}`)) {
      res.json({ status: "duplicate", reason: "Webhook already processed" });
      return;
    }

    const issueNumber = issue.number;
    const repoFullName = repository?.full_name;
    const issueKey = `GH-${issueNumber}`;
    const title = issue.title || "";
    const body = issue.body || "";

    // Check if task already exists
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey: issueKey, orgId: org.id },
    });

    // Workflow labels — default to org settings, labels can override
    const deploymentEnabled = labels.includes("deploy");
    const skipManagerReview = labels.includes("no-review") ? true : labels.includes("review") ? false : !org.autoReviewEnabled;
    const managerEnabled = labels.includes("no-manager") ? false : labels.includes("manager") ? true : org.managerEnabled ?? false;

    if (existingTask && !existingTask.isTerminal()) {
      // Handle deploy label being added
      if (
        existingTask.status === "pr_approved" &&
        deploymentEnabled &&
        !existingTask.deploymentEnabled
      ) {
        existingTask.deploymentEnabled = true;
        await taskRepo.save(existingTask);

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

      logger.warn("GitHub Issues webhook ignored - existing non-terminal task", {
        issueKey,
        issueNumber,
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
        logger.warn("Ignoring GitHub Issues webhook for terminal PRD parent - has children that would be cascade deleted", {
          taskId: existingTask.id,
          issueKey,
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
      logger.info("Deleting terminal GitHub Issues task to allow re-run", {
        taskId: existingTask.id,
        issueKey,
        oldStatus: existingTask.status,
      });
      await taskRepo.remove(existingTask);
    }

    // If task was cancelled, reset it for re-execution
    if (existingTask && existingTask.status === "cancelled") {
      await resetCancelledTask(existingTask);
      logger.info("Reset cancelled task from GitHub Issues webhook", {
        taskId: existingTask.id,
        issueKey,
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

    // PRD dedup: skip if this issue is already linked to a child task (created by /prd/decompose dispatch)
    const existingChildTask = await taskRepo.findOne({
      where: { orgId: org.id, jiraIssueKey: issueKey },
      select: ["id", "parentTaskId"],
    });
    if (existingChildTask?.parentTaskId) {
      logger.info("GitHub Issues webhook: skipping PRD child issue", { issueKey, parentTaskId: existingChildTask.parentTaskId });
      res.json({ status: "ignored", reason: "PRD-managed ticket" });
      return;
    }

    // Check for repo override label (e.g., "repo:astrofog")
    // For GitHub Issues: label override > issue's repo > org default
    // If repo doesn't include owner (no "/"), prepend owner from defaultGithubRepo
    const repoLabel = labels.find((l: string) => l.startsWith("repo:"));
    const repoOverride = repoLabel ? repoLabel.substring(5) : null;
    // For GitHub Issues, the issue's own repo (repoFullName) takes precedence if no override
    const targetRepo = repoOverride
      ? normalizeRepoWithOwner(repoOverride, org.getDefaultRepo())
      : (repoFullName || org.getDefaultRepo() || "");

    // Infer persona
    const persona = await inferPersonaFromJiraIssue(
      {
        summary: title,
        description: body,
        labels,
        fields: { labels },
      },
      undefined, // explicitPersona
      org.id     // orgId for org-specific inference rules
    );

    // Determine model
    let model = org.defaultWorkerModel || "";
    if (labels.includes("opus")) {
      model = "claude-opus-4-6";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-6";
    } else if (labels.includes("haiku")) {
      model = "claude-haiku-4-5-20251001";
    }

    // Epic mode is now the DEFAULT (standard workflow deprecated)
    // Use 'standard' or 'v1' label to explicitly opt-out
    const hasStandardLabel = labels.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
    const isV2Pipeline = !hasStandardLabel;
    const isMultiProvider = labels.some((l: string) => l.toLowerCase() === "multi-provider");
    const hasCriticLabel = labels.some((l: string) => l.toLowerCase() === "critic");

    // Tasks needing planning: Epic (default) or Multi-Provider
    const needsPlanning = isV2Pipeline || isMultiProvider;
    const initialStatus = needsPlanning ? "planning" : "queued";
    const taskPersona = needsPlanning ? "project_manager" : persona;

    // Check if Epic mode can be used (Anthropic only, no routing overrides)
    const hasRoutingOverrides = org.providerRouting &&
      Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
    const canUseEpicMode = (org.primaryProvider === "anthropic" || !org.primaryProvider) && !hasRoutingOverrides;

    // Pipeline and execution mode
    let pipelineVersion: "v1" | "v2" | null = null;
    let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
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
      jiraIssueId: String(issue.id),
      summary: title,
      description: body,
      jiraFields: { issue, repository },
      workerPersona: taskPersona,
      workerModel: model,
      workerProvider: org.primaryProvider || "anthropic",
      ticketSystem: "github",
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
      logger.warn("Failed to log audit event", { error: auditError });
    }

    logger.info("Created worker task from GitHub Issues webhook", {
      taskId: task.id,
      issueKey,
      issueNumber,
      repo: repoFullName,
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
      logger.error("Error processing GitHub Issues webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * POST /api/webhooks/:orgSlug/github-issues
 * Multi-tenant GitHub Issues webhook handler
 */
router.post(
  "/:orgSlug/github-issues",
  header("x-github-event").optional().isString(),
  body("action").optional().isString(),
  body("issue").optional().isObject(),
  body("repository").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody = JSON.stringify(req.body);
      const signature = getSignatureFromHeaders(req.headers, "github-issues");
      const event = req.headers["x-github-event"] as string;
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "github-issues");

      const verification = await verifyWebhookBySlug(orgSlug, "github-issues", rawBody, signature as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      if (event !== "issues") {
        res.json({ status: "ignored", reason: "Not an issues event" });
        return;
      }

      const { action, issue, repository, label } = req.body;

      if (!["opened", "labeled"].includes(action)) {
        res.json({ status: "ignored", reason: `Ignoring action: ${action}` });
        return;
      }

      const labels = issue?.labels?.map((l: { name: string }) => l.name.toLowerCase()) || [];

      if (action === "labeled" && label?.name?.toLowerCase() !== "workermill") {
        res.json({ status: "ignored", reason: "Added label is not workermill" });
        return;
      }

      if (action === "opened" && !labels.includes("workermill")) {
        res.json({ status: "ignored", reason: "Missing workermill label" });
        return;
      }

      // Idempotency
      if (deliveryId && await isDuplicateWebhook(deliveryId, "github-issues", org.id, `issues.${action}`)) {
        res.json({ status: "duplicate" });
        return;
      }

      const issueNumber = issue.number;
      const repoFullName = repository?.full_name;
      const issueKey = `GH-${issueNumber}`;
      const title = issue.title || "";
      const body = issue.body || "";

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const existingTask = await taskRepo.findOne({
        where: { jiraIssueKey: issueKey, orgId: org.id },
      });

      const deploymentEnabled = labels.includes("deploy");
      // Default to org settings; labels can override (review label forces review on, no-review forces off)
      const skipManagerReview = labels.includes("no-review") ? true : labels.includes("review") ? false : !org.autoReviewEnabled;
      const managerEnabled = labels.includes("no-manager") ? false : labels.includes("manager") ? true : org.autoImproveEnabled ?? false;

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

      // PRD dedup: skip if this issue is already linked to a child task (created by /prd/decompose dispatch)
      const existingChildTask = await taskRepo.findOne({
        where: { orgId: org.id, jiraIssueKey: issueKey },
        select: ["id", "parentTaskId"],
      });
      if (existingChildTask?.parentTaskId) {
        logger.info("GitHub Issues webhook: skipping PRD child issue", { issueKey, parentTaskId: existingChildTask.parentTaskId });
        res.json({ status: "ignored", reason: "PRD-managed ticket" });
        return;
      }

      const repoLabel = labels.find((l: string) => l.startsWith("repo:"));
      const repoOverride = repoLabel ? repoLabel.substring(5) : null;
      const targetRepo = repoOverride
        ? normalizeRepoWithOwner(repoOverride, org.getDefaultRepo())
        : (repoFullName || org.getDefaultRepo() || "");

      const persona = await inferPersonaFromJiraIssue(
        {
          summary: title,
          description: body,
          labels,
          fields: { labels },
        },
        undefined, // explicitPersona
        org.id     // orgId for org-specific inference rules
      );

      let model = org.defaultWorkerModel || "";
      if (labels.includes("opus")) model = "claude-opus-4-6";
      else if (labels.includes("sonnet")) model = "claude-sonnet-4-6";
      else if (labels.includes("haiku")) model = "claude-haiku-4-5-20251001";

      // Epic mode is now the DEFAULT (standard workflow deprecated)
      const hasStandardLabel = labels.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
      const isV2Pipeline = !hasStandardLabel;
      const isMultiProvider = labels.some((l: string) => l.toLowerCase() === "multi-provider");
      const hasCriticLabel = labels.some((l: string) => l.toLowerCase() === "critic");

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
        jiraIssueKey: issueKey,
        jiraIssueId: String(issue.id),
        summary: title,
        description: body,
        jiraFields: { issue, repository },
        workerPersona: taskPersona,
        workerModel: model,
        workerProvider: org.primaryProvider || "anthropic",
        ticketSystem: "github",
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

      logger.info("Created task from multi-tenant GitHub Issues webhook", {
        taskId: task.id,
        issueKey,
        orgSlug,
        pipelineVersion,
        initialStatus,
      });

      res.status(201).json({
        status: "created",
        taskId: task.id,
        persona,
        model,
      });
    } catch (error) {
      logger.error("Error processing multi-tenant GitHub Issues webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
