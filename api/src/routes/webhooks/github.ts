import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization } from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { checkAndUnblockDependentTasks } from "../../services/task-monitor.js";
import { logger } from "../../utils/logger.js";
import {
  body,
  header,
  validateRequest,
} from "../../middleware/validation.js";
import { isDuplicateWebhook, verifyGitHubSignature } from "./helpers.js";

const router = Router();

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
  header("x-github-event")
    .optional()
    .isString()
    .withMessage("x-github-event must be a string"),
  // Validate payload structure
  body("action")
    .optional()
    .isString()
    .withMessage("action must be a string"),
  body("review")
    .optional()
    .isObject()
    .withMessage("review must be an object"),
  body("pull_request")
    .optional()
    .isObject()
    .withMessage("pull_request must be an object"),
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
    // pr_approved: inline Tech Lead already approved, waiting for GitHub human approval to trigger deployment
    const task = await taskRepo
      .createQueryBuilder("task")
      .where("task.githubPrNumber = :prNumber", { prNumber })
      .andWhere("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested", "pr_approved"] })
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

    // Check if task already went through inline review (Epic + review label)
    // If task is already pr_approved, inline Tech Lead review completed - now trigger deployment
    const alreadyInlineReviewed = task.status === "pr_approved";

    // Check if task needs manager review (review label present) AND hasn't been inline reviewed yet
    if (task.skipManagerReview === false && !alreadyInlineReviewed) {
      // Task has 'review' label but inline review hasn't run yet
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

    // If task was already pr_approved (inline review completed), log that we're proceeding to deployment
    if (alreadyInlineReviewed) {
      logger.info("Inline review already completed, GitHub approval triggers deployment", {
        taskId: task.id,
        prNumber,
        approvedBy,
        jiraIssueKey: task.jiraIssueKey,
      });
    }

    // No review label - re-queue for deployment directly
    // The `deploy` label controls AUTO-deploy (skip PR approval), not whether to deploy at all
    // When a human approves the PR and no review is needed, merge and deploy
    task.status = "queued";  // Re-queue for orchestrator to pick up
    task.taskNotes = `DEPLOYMENT_RUN: PR ***REMOVED***${prNumber} approved by ${approvedBy}. Deploy and merge.`;
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
 * POST /api/webhooks/:orgSlug/github
 * Multi-tenant GitHub webhook handler (PR reviews)
 */
router.post(
  "/:orgSlug/github",
  header("x-github-event").optional().isString(),
  body("action").optional().isString(),
  body("review").optional().isObject(),
  body("pull_request").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody = JSON.stringify(req.body);
      const signature = getSignatureFromHeaders(req.headers, "github");
      const event = req.headers["x-github-event"] as string;
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "github");

      // Verify webhook
      const verification = await verifyWebhookBySlug(orgSlug, "github", rawBody, signature as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      logger.info("Multi-tenant GitHub webhook received", { event, orgSlug, deliveryId });

      // Handle PR merged
      if (event === "pull_request") {
        const { action, pull_request } = req.body;
        if (action !== "closed" || !pull_request?.merged) {
          res.json({ status: "ignored", reason: "Not a merged PR" });
          return;
        }

        // Idempotency
        if (deliveryId && await isDuplicateWebhook(deliveryId, "github", org.id, `pull_request.${action}`)) {
          res.json({ status: "duplicate" });
          return;
        }

        const prUrl = pull_request.html_url;
        const taskRepo = AppDataSource.getRepository(WorkerTask);
        const tasksWithPr = await taskRepo
          .createQueryBuilder("task")
          .where("task.prUrl = :prUrl", { prUrl })
          .andWhere("task.orgId = :orgId", { orgId: org.id })
          .getMany();

        for (const task of tasksWithPr) {
          try {
            await checkAndUnblockDependentTasks(task);
          } catch (error) {
            logger.warn("Failed to unblock dependent tasks", { taskId: task.id, error });
          }
        }

        res.json({
          status: "processed",
          message: `Checked ${tasksWithPr.length} task(s)`,
          prUrl,
        });
        return;
      }

      // Handle PR review approval
      if (event !== "pull_request_review") {
        res.json({ status: "ignored", reason: "Not a PR review event" });
        return;
      }

      const { action, review, pull_request } = req.body;
      if (action !== "submitted" || review?.state !== "approved") {
        res.json({ status: "ignored", reason: "Not an approval" });
        return;
      }

      // Idempotency
      if (deliveryId && await isDuplicateWebhook(deliveryId, "github", org.id, `pull_request_review.${action}`)) {
        res.json({ status: "duplicate" });
        return;
      }

      const prNumber = pull_request?.number;
      const approvedBy = review?.user?.login;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      // Include pr_approved for tasks that completed inline review (Epic + review label)
      const task = await taskRepo
        .createQueryBuilder("task")
        .where("task.githubPrNumber = :prNumber", { prNumber })
        .andWhere("task.orgId = :orgId", { orgId: org.id })
        .andWhere("task.status IN (:...statuses)", { statuses: ["pr_created", "review_requested", "pr_approved"] })
        .getOne();

      if (!task) {
        res.json({ status: "ignored", reason: "No matching task" });
        return;
      }

      task.githubApprovedBy = approvedBy || null;

      // Check if task already went through inline review (Epic + review label)
      const alreadyInlineReviewed = task.status === "pr_approved";

      if (task.skipManagerReview === false && !alreadyInlineReviewed) {
        // Task has 'review' label but inline review hasn't run yet
        task.status = "pr_approved";
        await taskRepo.save(task);
        res.json({
          status: "processed",
          taskId: task.id,
          newStatus: "pr_approved",
          message: "PR approved, awaiting manager review",
        });
        return;
      }

      task.status = "queued";
      task.taskNotes = `DEPLOYMENT_RUN: PR ***REMOVED***${prNumber} approved by ${approvedBy}. Deploy and merge.`;
      task.completedAt = null;
      task.ecsTaskArn = null;
      task.ecsTaskId = null;
      task.startedAt = null;
      await taskRepo.save(task);

      res.json({
        status: "processed",
        taskId: task.id,
        newStatus: "queued",
        message: "Task re-queued for deployment",
      });
    } catch (error) {
      logger.error("Error processing multi-tenant GitHub webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
