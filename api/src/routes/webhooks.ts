import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, Organization, User } from "../models/index.js";
import { inferPersonaFromJiraIssue } from "../services/persona-inference.js";
import { checkAndUnblockDependentTasks } from "../services/orchestrator.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { logTaskCreated } from "../services/audit.js";
import { extractTextFromADF } from "../utils/jira.js";
import {
  body,
  header,
  validateRequest,
} from "../middleware/validation.js";

const router = Router();

/**
 * Check if a webhook delivery has already been processed (idempotency)
 * Returns true if this is a duplicate that should be skipped
 */
async function isDuplicateWebhook(
  deliveryId: string,
  source: "jira" | "github" | "linear" | "github-issues",
  orgId?: string,
  eventType?: string
): Promise<boolean> {
  if (!deliveryId) {
    // No delivery ID means we can't check for duplicates - allow processing
    return false;
  }

  try {
    // Check if already processed
    const existing = await AppDataSource.query(
      `SELECT id FROM webhook_deliveries WHERE delivery_id = $1 AND source = $2 LIMIT 1`,
      [deliveryId, source]
    );

    if (existing.length > 0) {
      logger.info("Duplicate webhook detected, skipping", { deliveryId, source });
      return true;
    }

    // Record this delivery (use INSERT ... ON CONFLICT for race condition safety)
    await AppDataSource.query(
      `INSERT INTO webhook_deliveries (delivery_id, source, org_id, event_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (delivery_id, source) DO NOTHING`,
      [deliveryId, source, orgId || null, eventType || null]
    );

    return false;
  } catch (error) {
    // Don't block webhook processing if idempotency check fails
    logger.warn("Failed to check webhook idempotency", { error, deliveryId, source });
    return false;
  }
}

/**
 * Cleanup old webhook deliveries (run periodically)
 * Keeps deliveries for 24 hours to handle delayed retries
 */
export async function cleanupOldWebhookDeliveries(): Promise<number> {
  try {
    const result = await AppDataSource.query(
      `DELETE FROM webhook_deliveries WHERE created_at < NOW() - INTERVAL '24 hours' RETURNING id`
    );
    const count = result.length;
    if (count > 0) {
      logger.info("Cleaned up old webhook deliveries", { count });
    }
    return count;
  } catch (error) {
    logger.error("Failed to cleanup webhook deliveries", { error });
    return 0;
  }
}

/**
 * Verify Jira webhook signature
 * Jira sends signature in x-atlassian-webhook-signature header with sha256= prefix
 */
function verifyJiraSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  // Jira webhook signature format: sha256=<hex_digest>
  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // Handle both formats: with or without sha256= prefix for backwards compatibility
  const normalizedSignature = signature.startsWith("sha256=")
    ? signature
    : `sha256=${signature}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * POST /api/webhooks/jira
 * Handle Jira webhook events
 */
router.post(
  "/jira",
  // Validate webhook payload structure
  body("webhookEvent").optional().isString().withMessage("webhookEvent must be a string"),
  body("issue").optional().isObject().withMessage("issue must be an object"),
  body("issue.key").optional().isString().withMessage("issue.key must be a string"),
  body("issue.id").optional().isString().withMessage("issue.id must be a string"),
  body("issue.fields").optional().isObject().withMessage("issue.fields must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
  try {
    // Log webhook receipt
    logger.info("Jira webhook received");

    // Get the organization that has users (the active org)
    // This ensures tasks are created for the org that users authenticate with
    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Find org with active users - that's the real org being used
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    let org = activeUser?.organization;

    // Fallback to first org if no active users found
    if (!org) {
      org = await orgRepo.findOne({ where: {} }) ?? undefined;
    }

    if (!org) {
      logger.error("No organization found for Jira webhook");
      res.status(500).json({ error: "No organization configured" });
      return;
    }

    logger.info("Jira webhook using org", { orgId: org.id, orgName: org.name });

    // Verify webhook signature - secret configuration is REQUIRED for security
    // Jira uses X-Hub-Signature header (WebSub standard), not x-atlassian-webhook-signature
    const signature = (req.headers["x-hub-signature"] || req.headers["x-atlassian-webhook-signature"]) as string;
    // Use actual raw body for signature verification (captured by middleware in index.ts)
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);
    if (!org.jiraWebhookSecret) {
      logger.error("Jira webhook secret not configured", { orgId: org.id });
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }
    if (!verifyJiraSignature(rawBody, signature, org.jiraWebhookSecret)) {
      // Debug logging to diagnose signature mismatch
      const expectedSig = "sha256=" + crypto.createHmac("sha256", org.jiraWebhookSecret).update(rawBody).digest("hex");
      logger.warn("Invalid or missing Jira webhook signature", {
        orgId: org.id,
        receivedSignature: signature?.substring(0, 20) + "...",
        expectedSignaturePrefix: expectedSig.substring(0, 30) + "...",
        secretLength: org.jiraWebhookSecret.length,
        bodyLength: rawBody.length
      });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Idempotency check - prevent duplicate processing of the same webhook
    const webhookId = req.headers["x-atlassian-webhook-id"] as string;
    const { webhookEvent, issue } = req.body;
    if (await isDuplicateWebhook(webhookId, "jira", org.id, webhookEvent)) {
      res.json({ status: "duplicate", reason: "Webhook already processed" });
      return;
    }

    // Only process issue created/updated events with ai-worker label
    if (!webhookEvent?.startsWith("jira:issue_")) {
      res.json({ status: "ignored", reason: "Not an issue event" });
      return;
    }

    if (!issue) {
      res.json({ status: "ignored", reason: "No issue in payload" });
      return;
    }

    const labels = issue.fields?.labels || [];

    // Check if workermill label was just added in this event (changelog)
    // This handles the race condition where Jira fires the webhook before
    // the labels array is updated in the payload
    const changelog = req.body.changelog;
    const labelJustAdded = changelog?.items?.some(
      (item: { field?: string; toString?: string }) =>
        item.field === "labels" && item.toString?.includes("workermill")
    );

    if (!labels.includes("workermill") && !labelJustAdded) {
      res.json({ status: "ignored", reason: "Missing workermill label" });
      return;
    }

    // Log if we're using the changelog fallback (helps debug race conditions)
    if (labelJustAdded && !labels.includes("workermill")) {
      logger.info("Workermill label detected via changelog (race condition workaround)", {
        issueKey: issue.key,
      });
    }

    const issueKey = issue.key;
    const summary = issue.fields?.summary || "";
    // Handle both string (wiki markup) and ADF (object) description formats
    const rawDescription = issue.fields?.description;
    const description = typeof rawDescription === "string"
      ? rawDescription
      : extractTextFromADF(rawDescription);

    // Check if task already exists for this issue
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const existingTask = await taskRepo.findOne({
      where: { jiraIssueKey: issueKey, orgId: org.id },
    });

    // Check for workflow labels
    const deploymentEnabled = labels.includes("deploy");
    const skipManagerReview = !labels.includes("review");
    const managerEnabled = labels.includes("manager");

    // Detect PRD/Epic tickets that need multi-story planning
    // These labels trigger the Planning Agent for execution plan creation
    const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
    const isPrdTicket = labels.some((l: string) =>
      prdLabels.includes(l.toLowerCase())
    );

    if (existingTask && !existingTask.isTerminal()) {
      // If task is in pr_approved and deploy label was added, update the flag
      // The orchestrator will pick it up and re-queue for deployment
      if (existingTask.status === "pr_approved" && deploymentEnabled && !existingTask.deploymentEnabled) {
        existingTask.deploymentEnabled = true;
        await taskRepo.save(existingTask);

        logger.info("Updated existing task with deploy label", {
          taskId: existingTask.id,
          jiraIssueKey: issueKey,
          status: existingTask.status,
        });

        res.json({
          status: "updated",
          reason: "Deploy label added to approved task - will be re-queued for deployment",
          taskId: existingTask.id,
        });
        return;
      }

      // Calculate task age for debugging stuck tasks
      const taskAgeMs = existingTask.createdAt ? Date.now() - new Date(existingTask.createdAt).getTime() : 0;
      const taskAgeHours = Math.round(taskAgeMs / (1000 * 60 * 60) * 10) / 10;

      logger.warn("Jira webhook ignored - existing non-terminal task", {
        jiraIssueKey: issueKey,
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
    // BUT: Do NOT delete cancelled tasks - user explicitly stopped these
    // BUT: Do NOT delete PRD parent tasks with children - cascade delete would wipe all child work!
    const deletableTerminalStates = ["completed", "deployed", "failed"];
    if (existingTask && deletableTerminalStates.includes(existingTask.status)) {
      const hasChildren = existingTask.childTaskIds && existingTask.childTaskIds.length > 0;
      if (hasChildren) {
        logger.warn("Ignoring webhook for terminal PRD parent - has children that would be cascade deleted", {
          taskId: existingTask.id,
          jiraIssueKey: issueKey,
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
      logger.info("Deleting terminal task to allow re-run", {
        taskId: existingTask.id,
        jiraIssueKey: issueKey,
        oldStatus: existingTask.status,
      });
      await taskRepo.remove(existingTask);
    }

    // If task was cancelled, don't re-create it - user explicitly stopped it
    if (existingTask && existingTask.status === "cancelled") {
      logger.info("Ignoring webhook for cancelled task - user explicitly cancelled", {
        taskId: existingTask.id,
        jiraIssueKey: issueKey,
      });
      res.json({
        status: "ignored",
        reason: "Task was cancelled by user - remove workermill label and re-add to restart",
        taskId: existingTask.id,
        taskStatus: existingTask.status,
      });
      return;
    }

    // Infer persona from ticket content
    const persona = inferPersonaFromJiraIssue({
      summary,
      description,
      labels,
      fields: issue.fields,
    });

    // Check provider routing rules for this persona
    // Format: { "qa_engineer": { "provider": "ollama", "model": "qwen2.5-coder:32b" } }
    const routing = org.providerRouting?.[persona];
    const hasRouting = routing && routing.provider;

    // Determine AI provider based on:
    // 1. Jira labels (explicit override)
    // 2. Provider routing rules for persona (org-level auto-routing)
    // 3. Org's primary provider (fallback)
    const providerLabels = ["anthropic", "openai", "gemini", "google", "ollama"];
    const detectedProviderLabel = labels.find((l: string) =>
      providerLabels.includes(l.toLowerCase())
    );

    const providerMap: Record<string, string> = {
      anthropic: "anthropic",
      openai: "openai",
      gemini: "google",
      google: "google",
      ollama: "ollama",
    };

    let workerProvider: string;
    if (detectedProviderLabel) {
      // Explicit label takes priority
      workerProvider = providerMap[detectedProviderLabel.toLowerCase()];
    } else if (hasRouting) {
      // Use routing rule for this persona
      workerProvider = routing.provider;
      logger.info("Auto-routing persona to provider", {
        persona,
        provider: routing.provider,
        model: routing.model,
        orgId: org.id,
      });
    } else {
      // Fall back to org's primary provider
      workerProvider = org.primaryProvider || "anthropic";
    }

    // Determine model based on:
    // 1. Jira labels (explicit override)
    // 2. Provider routing rules (auto-routing)
    // 3. Org default model (if provider matches org's primary provider)
    // 4. Provider-specific defaults
    let model: string;
    if (labels.includes("opus")) {
      model = "claude-opus-4-5-20251101";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    } else if (labels.includes("haiku")) {
      model = "claude-haiku-4-5-20251001";
    } else if (hasRouting && routing.model) {
      // Use routed model
      model = routing.model;
    } else if (workerProvider === "ollama") {
      // Use org's default model if Ollama is the primary provider, otherwise use fallback
      model = org.primaryProvider === "ollama" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : "qwen2.5-coder:32b";
    } else if (workerProvider === "openai") {
      model = org.primaryProvider === "openai" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : "gpt-4o";
    } else if (workerProvider === "google") {
      model = org.primaryProvider === "google" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : "gemini-2.0-flash";
    } else {
      // Anthropic or fallback
      model = org.primaryProvider === "anthropic" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : "claude-haiku-4-5-20251001";
    }

    // Create new task (workflow labels already extracted above)
    // PRD tickets start in "planning" status to trigger the Planning Agent
    // Regular tickets start in "queued" status for immediate execution
    const initialStatus = isPrdTicket ? "planning" : "queued";

    // For PRD tasks, use project_manager persona for the planning phase
    // The planning agent will create child tasks with their own personas
    const taskPersona = isPrdTicket ? "project_manager" : persona;

    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueKey,
      jiraIssueId: issue.id || issueKey,
      summary,
      description,
      jiraFields: issue.fields || {},
      workerPersona: taskPersona,
      workerModel: model,
      workerProvider,
      githubRepo: org.defaultGithubRepo || "",
      status: initialStatus,
      deploymentEnabled,
      skipManagerReview,
      managerEnabled,
      retryCount: 0,
      maxRetries: 3,
    });

    await taskRepo.save(task);

    logger.info("Created worker task from Jira webhook", {
      taskId: task.id,
      jiraIssueKey: issueKey,
      persona: taskPersona,
      inferredPersona: persona,
      model,
      provider: workerProvider,
      orgId: org.id,
      isPrdTicket,
      initialStatus,
    });

    res.status(201).json({
      status: "created",
      taskId: task.id,
      persona: taskPersona,
      model,
      provider: workerProvider,
      isPrdTicket,
      initialStatus,
    });
  } catch (error) {
    logger.error("Error processing Jira webhook", { error });
    res.status(500).json({ error: "Failed to process webhook" });
  }
  }
);

/**
 * POST /api/webhooks/jira/test
 * Test endpoint for verifying webhook configuration
 */
router.post(
  "/jira/test",
  header("x-api-key").notEmpty().withMessage("x-api-key header is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    const apiKey = req.headers["x-api-key"] as string;

    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { apiKey } });

    if (!org) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    res.json({
      status: "ok",
      message: "Webhook endpoint is configured correctly",
      organization: org.name,
      timestamp: new Date().toISOString(),
    });
  }
);

/**
 * Verify GitHub webhook signature
 */
function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /api/webhooks/github
 * Handle GitHub webhook events (PR approvals)
 *
 * GitHub webhooks cannot send custom headers, so we find the task
 * by PR number directly (matching Jira webhook pattern).
 * Signature verification is done per-org if webhook secret is configured.
 */
router.post(
  "/github",
  // Validate GitHub webhook headers
  header("x-github-event").optional().isString().withMessage("x-github-event must be a string"),
  // Validate payload structure
  body("action").optional().isString().withMessage("action must be a string"),
  body("review").optional().isObject().withMessage("review must be an object"),
  body("pull_request").optional().isObject().withMessage("pull_request must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
    const signature = req.headers["x-hub-signature-256"] as string;
    const event = req.headers["x-github-event"] as string;
    const deliveryId = req.headers["x-github-delivery"] as string;
    const rawBody = JSON.stringify(req.body);

    logger.info("GitHub webhook received", { event, hasSignature: !!signature, deliveryId });

    // Handle pull_request events (PR merged) - for unblocking dependent tasks
    if (event === "pull_request") {
      const { action, pull_request } = req.body;

      // Only process closed PRs that were merged
      if (action !== "closed" || !pull_request?.merged) {
        res.json({ status: "ignored", reason: "Not a merged PR" });
        return;
      }

      const prUrl = pull_request.html_url;
      const prNumber = pull_request.number;
      const repoFullName = pull_request.base?.repo?.full_name;
      const mergedBy = pull_request.merged_by?.login;

      logger.info("GitHub PR merged", { prNumber, prUrl, repoFullName, mergedBy });

      // Find any tasks that have this PR URL and may have dependents waiting
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const orgRepo = AppDataSource.getRepository(Organization);

      // Look for tasks with this PR URL that are in a completed-like state
      const tasksWithPr = await taskRepo
        .createQueryBuilder("task")
        .where("task.prUrl = :prUrl", { prUrl })
        .getMany();

      if (tasksWithPr.length === 0) {
        logger.info("No matching tasks for merged PR", { prNumber, prUrl });
        res.json({ status: "ignored", reason: "No matching tasks for this PR" });
        return;
      }

      // Verify signature - secret configuration is REQUIRED for security
      // Get the first task's org for signature verification
      const firstTask = tasksWithPr[0];
      const org = await orgRepo.findOne({ where: { id: firstTask.orgId } });

      if (!org) {
        logger.error("Organization not found for task", { taskId: firstTask.id });
        res.status(500).json({ error: "Organization not found" });
        return;
      }
      if (!org.githubWebhookSecret) {
        logger.error("GitHub webhook secret not configured", { orgId: org.id });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }
      if (!verifyGitHubSignature(rawBody, signature, org.githubWebhookSecret)) {
        logger.warn("Invalid GitHub webhook signature for PR merge", { orgId: org.id, prNumber });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Idempotency check - prevent duplicate processing
      if (await isDuplicateWebhook(deliveryId, "github", org.id, `pull_request.${action}`)) {
        res.json({ status: "duplicate", reason: "Webhook already processed" });
        return;
      }

      // Check and unblock dependent tasks for each task with this PR
      let unblocked = 0;
      for (const task of tasksWithPr) {
        try {
          await checkAndUnblockDependentTasks(task);
          unblocked++;
          logger.info("Checked dependent tasks for merged PR", {
            taskId: task.id,
            prUrl,
            jiraIssueKey: task.jiraIssueKey,
          });
        } catch (error) {
          logger.warn("Failed to unblock dependent tasks for merged PR", {
            taskId: task.id,
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      res.json({
        status: "processed",
        message: `Checked ${tasksWithPr.length} task(s) for dependent unblocking`,
        prUrl,
        prNumber,
        tasksChecked: tasksWithPr.map(t => t.id),
      });
      return;
    }

    // Only process pull_request_review events (for PR approvals)
    if (event !== "pull_request_review") {
      res.json({ status: "ignored", reason: "Not a PR review or merged PR event" });
      return;
    }

    const { action, review, pull_request } = req.body;

    // Only process approved reviews
    if (action !== "submitted" || review?.state !== "approved") {
      res.json({ status: "ignored", reason: "Not an approval" });
      return;
    }

    const prNumber = pull_request?.number;
    const repoFullName = pull_request?.base?.repo?.full_name;
    const approvedBy = review?.user?.login;

    if (!prNumber) {
      res.json({ status: "ignored", reason: "No PR number" });
      return;
    }

    logger.info("GitHub PR approved", { prNumber, repoFullName, approvedBy });

    // Find task by PR number across all orgs (we'll verify signature per-org if secret exists)
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const orgRepo = AppDataSource.getRepository(Organization);

    // Look for task in any status that could receive approval
    // pr_created: waiting for GitHub review
    // review_requested: waiting for review (legacy status)
    const task = await taskRepo
      .createQueryBuilder("task")
      .where("task.githubPrNumber = :prNumber", { prNumber })
      .andWhere("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested"] })
      .getOne();

    if (!task) {
      logger.info("No matching task for PR", { prNumber });
      res.json({ status: "ignored", reason: "No matching task for this PR" });
      return;
    }

    // Get the org to verify signature if secret is configured
    const org = await orgRepo.findOne({ where: { id: task.orgId } });

    if (!org) {
      logger.error("Organization not found for task", { taskId: task.id, orgId: task.orgId });
      res.status(500).json({ error: "Organization not found" });
      return;
    }

    // Verify webhook signature - secret configuration is REQUIRED for security
    if (!org.githubWebhookSecret) {
      logger.error("GitHub webhook secret not configured", { orgId: org.id });
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }
    if (!verifyGitHubSignature(rawBody, signature, org.githubWebhookSecret)) {
      logger.warn("Invalid GitHub webhook signature", { orgId: org.id, prNumber });
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Idempotency check - prevent duplicate processing
    if (await isDuplicateWebhook(deliveryId, "github", org.id, `pull_request_review.${action}`)) {
      res.json({ status: "duplicate", reason: "Webhook already processed" });
      return;
    }

    // Record the GitHub approval
    task.githubApprovedBy = approvedBy || null;

    // Check if task needs manager review (review label present)
    if (task.skipManagerReview === false) {
      // Task has 'review' label - let manager review process handle deployment
      // Just record the GitHub approval, don't re-queue for deployment yet
      // The manager review will handle the full review cycle
      task.status = "pr_approved";  // Mark as approved, manager review will pick it up
      await taskRepo.save(task);

      logger.info("PR approved, awaiting manager review", {
        taskId: task.id,
        prNumber,
        approvedBy,
        jiraIssueKey: task.jiraIssueKey,
        skipManagerReview: task.skipManagerReview,
      });

      res.json({
        status: "processed",
        taskId: task.id,
        newStatus: "pr_approved",
        message: "PR approved, awaiting manager review before deployment",
      });
      return;
    }

    // No review label - re-queue for deployment directly
    // The `deploy` label controls AUTO-deploy (skip PR approval), not whether to deploy at all
    // When a human approves the PR and no review is needed, merge and deploy
    task.status = "queued";  // Re-queue for orchestrator to pick up
    task.taskNotes = `DEPLOYMENT_RUN: PR #${prNumber} approved by ${approvedBy}. Deploy and merge.`;
    task.completedAt = null;  // Reset completion time
    task.ecsTaskArn = null;   // Clear previous ECS task info
    task.ecsTaskId = null;
    task.startedAt = null;

    await taskRepo.save(task);

    logger.info("PR approved, task re-queued for deployment run", {
      taskId: task.id,
      prNumber,
      approvedBy,
      jiraIssueKey: task.jiraIssueKey,
    });

    res.json({
      status: "processed",
      taskId: task.id,
      newStatus: "queued",
      message: "Task re-queued for deployment run",
    });
    } catch (error) {
      logger.error("Error processing GitHub webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * Verify Linear webhook signature
 */
function verifyLinearSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /api/webhooks/linear
 * Handle Linear webhook events
 *
 * Linear labels work the same as Jira:
 * - `workermill` label triggers task creation
 * - `deploy` label enables auto-deployment
 * - `review` label requires manager review
 * - `haiku`, `sonnet`, `opus` labels select model
 */
router.post(
  "/linear",
  // Validate Linear webhook payload
  body("action").optional().isString().withMessage("action must be a string"),
  body("type").optional().isString().withMessage("type must be a string"),
  body("data").optional().isObject().withMessage("data must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
    logger.info("Linear webhook received");

    const signature = req.headers["linear-signature"] as string;
    const rawBody = JSON.stringify(req.body);

    // Get org for Linear (look for org with linear settings)
    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Find org with active users
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    let org = activeUser?.organization;

    if (!org) {
      org = (await orgRepo.findOne({ where: {} })) ?? undefined;
    }

    if (!org) {
      logger.error("No organization found for Linear webhook");
      res.status(500).json({ error: "No organization configured" });
      return;
    }

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
    const description = issue.description || "";

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
    // BUT: Do NOT delete cancelled tasks - user explicitly stopped these
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

    // If task was cancelled, don't re-create it - user explicitly stopped it
    if (existingTask && existingTask.status === "cancelled") {
      logger.info("Ignoring Linear webhook for cancelled task - user explicitly cancelled", {
        taskId: existingTask.id,
        issueIdentifier,
      });
      res.json({
        status: "ignored",
        reason: "Task was cancelled by user - remove workermill label and re-add to restart",
        taskId: existingTask.id,
        taskStatus: existingTask.status,
      });
      return;
    }

    // Infer persona from labels/content
    const persona = inferPersonaFromJiraIssue({
      summary: title,
      description,
      labels: labelNames,
      fields: { labels: labelNames },
    });

    // Determine model
    let model = "claude-haiku-4-5-20251001";
    if (labelNames.includes("opus")) {
      model = "claude-opus-4-5-20251101";
    } else if (labelNames.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    }

    // Create task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueIdentifier,
      jiraIssueId: issueId,
      summary: title,
      description,
      jiraFields: issue,
      workerPersona: persona,
      workerModel: model,
      workerProvider: "anthropic",
      githubRepo: org.defaultGithubRepo || "",
      status: "queued",
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
 * POST /api/webhooks/github-issues
 * Handle GitHub Issues webhook events (separate from PR reviews)
 *
 * Triggers task creation when issues are labeled with 'workermill'
 */
router.post(
  "/github-issues",
  // Validate GitHub Issues webhook headers and payload
  header("x-github-event").optional().isString().withMessage("x-github-event must be a string"),
  body("action").optional().isString().withMessage("action must be a string"),
  body("issue").optional().isObject().withMessage("issue must be an object"),
  body("repository").optional().isObject().withMessage("repository must be an object"),
  body("label").optional().isObject().withMessage("label must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
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

    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Find org
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    let org = activeUser?.organization;

    if (!org) {
      org = (await orgRepo.findOne({ where: {} })) ?? undefined;
    }

    if (!org) {
      logger.error("No organization found for GitHub Issues webhook");
      res.status(500).json({ error: "No organization configured" });
      return;
    }

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

    // Workflow labels
    const deploymentEnabled = labels.includes("deploy");
    const skipManagerReview = !labels.includes("review");
    const managerEnabled = labels.includes("manager");

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
    // BUT: Do NOT delete cancelled tasks - user explicitly stopped these
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

    // If task was cancelled, don't re-create it - user explicitly stopped it
    if (existingTask && existingTask.status === "cancelled") {
      logger.info("Ignoring GitHub Issues webhook for cancelled task - user explicitly cancelled", {
        taskId: existingTask.id,
        issueKey,
      });
      res.json({
        status: "ignored",
        reason: "Task was cancelled by user - remove workermill label and re-add to restart",
        taskId: existingTask.id,
        taskStatus: existingTask.status,
      });
      return;
    }

    // Infer persona
    const persona = inferPersonaFromJiraIssue({
      summary: title,
      description: body,
      labels,
      fields: { labels },
    });

    // Determine model
    let model = "claude-haiku-4-5-20251001";
    if (labels.includes("opus")) {
      model = "claude-opus-4-5-20251101";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    }

    // Create task
    const task = taskRepo.create({
      orgId: org.id,
      jiraIssueKey: issueKey,
      jiraIssueId: String(issue.id),
      summary: title,
      description: body,
      jiraFields: { issue, repository },
      workerPersona: persona,
      workerModel: model,
      workerProvider: "anthropic",
      githubRepo: repoFullName || org.defaultGithubRepo || "",
      status: "queued",
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

export default router;
