import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization } from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { checkAndUnblockDependentTasks } from "../../services/task-monitor.js";
import { logger } from "../../utils/logger.js";
import {
  body,
  header,
  validateRequest,
} from "../../middleware/validation.js";
import { isDuplicateWebhook } from "./helpers.js";

const router = Router();

/**
 * POST /api/webhooks/bitbucket
 * Handle BitBucket webhook events (PR approvals and merges)
 *
 * BitBucket sends pullrequest events. We process:
 * - pullrequest:approved -> PR approved flow
 * - pullrequest:fulfilled -> unblock dependents (merged)
 */
router.post(
  "/bitbucket",
  header("x-event-key")
    .optional()
    .isString()
    .withMessage("x-event-key must be a string"),
  body("pullrequest")
    .optional()
    .isObject()
    .withMessage("pullrequest must be an object"),
  body("repository")
    .optional()
    .isObject()
    .withMessage("repository must be an object"),
  body("approval")
    .optional()
    .isObject()
    .withMessage("approval must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const eventKey = req.headers["x-event-key"] as string;
      const hookUuid = req.headers["x-hook-uuid"] as string;
      const requestUuid = req.headers["x-request-uuid"] as string;
      const rawBody =
        (req as Request & { rawBody?: Buffer }).rawBody?.toString() ||
        JSON.stringify(req.body);

      logger.info("BitBucket webhook received", {
        eventKey,
        hookUuid,
        hasRequestUuid: !!requestUuid,
      });

      // Only process PR events
      if (!eventKey?.startsWith("pullrequest:")) {
        res.json({
          status: "ignored",
          reason: "Not a pull request event",
        });
        return;
      }

      const { pullrequest: pr, repository, approval, actor } = req.body;
      const prId = pr?.id;
      const prState = pr?.state;
      const repoFullName = repository?.full_name;
      const prUrl = pr?.links?.html?.href;

      logger.info("BitBucket PR event", {
        prId,
        prState,
        eventKey,
        repoFullName,
      });

      // Find task by PR URL or repo+PR number
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const orgRepo = AppDataSource.getRepository(Organization);

      // Try to find task by PR URL first
      let task = await taskRepo
        .createQueryBuilder("task")
        .where("task.prUrl = :prUrl", { prUrl })
        .getOne();

      // If not found, try by PR number and repo
      if (!task && prId && repoFullName) {
        task = await taskRepo
          .createQueryBuilder("task")
          .where("task.githubPrNumber = :prId", { prId })
          .andWhere("task.githubRepo = :repoFullName", { repoFullName })
          .getOne();
      }

      if (!task) {
        logger.info("No matching task for BitBucket PR", {
          prId,
          repoFullName,
          prUrl,
        });
        res.json({
          status: "ignored",
          reason: "No matching task for this PR",
        });
        return;
      }

      // Get org to verify webhook
      const org = await orgRepo.findOne({ where: { id: task.orgId } });
      if (!org) {
        logger.error("Organization not found for task", {
          taskId: task.id,
        });
        res.status(500).json({ error: "Organization not found" });
        return;
      }

      // Verify webhook signature - BitBucket uses HMAC-SHA256 similar to GitHub
      if (!org.bitbucketWebhookSecret) {
        logger.error("BitBucket webhook secret not configured", {
          orgId: org.id,
        });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      // BitBucket signature is in x-hub-signature header (same as GitHub)
      // SECURITY: Signature verification is REQUIRED - reject unsigned webhooks
      const signature = req.headers["x-hub-signature"] as string;
      if (!signature) {
        logger.warn("BitBucket webhook rejected - missing signature", {
          orgId: org.id,
          hookUuid,
          hint: "Configure webhook secret in BitBucket settings",
        });
        res.status(401).json({ error: "Missing webhook signature" });
        return;
      }

      const expectedSignature =
        "sha256=" +
        crypto
          .createHmac("sha256", org.bitbucketWebhookSecret)
          .update(rawBody)
          .digest("hex");

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        logger.warn("Invalid BitBucket webhook signature", {
          orgId: org.id,
          prId,
        });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Idempotency check
      const deliveryId =
        requestUuid || `${hookUuid}-${prId}-${eventKey}`;
      if (
        await isDuplicateWebhook(
          deliveryId,
          "bitbucket",
          org.id,
          eventKey
        )
      ) {
        res.json({
          status: "duplicate",
          reason: "Webhook already processed",
        });
        return;
      }

      // Handle PR merged (fulfilled)
      if (
        eventKey === "pullrequest:fulfilled" ||
        prState === "MERGED"
      ) {
        try {
          await checkAndUnblockDependentTasks(task);
          logger.info(
            "Checked dependent tasks for merged BitBucket PR",
            {
              taskId: task.id,
              prUrl,
              jiraIssueKey: task.jiraIssueKey,
            }
          );
        } catch (error) {
          logger.warn(
            "Failed to unblock dependent tasks for merged BitBucket PR",
            {
              taskId: task.id,
              prUrl,
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            }
          );
        }

        res.json({
          status: "processed",
          message: "Checked for dependent tasks to unblock",
          prUrl,
          prId,
          taskId: task.id,
        });
        return;
      }

      // Handle PR approval
      if (eventKey === "pullrequest:approved") {
        const approvedBy =
          approval?.user?.display_name ||
          actor?.display_name ||
          actor?.nickname;
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          // Task has 'review' label - await manager review
          task.status = "pr_approved";
          await taskRepo.save(task);

          logger.info(
            "BitBucket PR approved, awaiting manager review",
            {
              taskId: task.id,
              prId,
              approvedBy,
              jiraIssueKey: task.jiraIssueKey,
            }
          );

          res.json({
            status: "processed",
            taskId: task.id,
            newStatus: "pr_approved",
            message:
              "PR approved, awaiting manager review before deployment",
          });
          return;
        }

        // No review label - re-queue for deployment
        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: PR ***REMOVED***${prId} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;

        await taskRepo.save(task);

        logger.info(
          "BitBucket PR approved, task re-queued for deployment",
          {
            taskId: task.id,
            prId,
            approvedBy,
            jiraIssueKey: task.jiraIssueKey,
          }
        );

        res.json({
          status: "processed",
          taskId: task.id,
          newStatus: "queued",
          message: "Task re-queued for deployment run",
        });
        return;
      }

      // Other PR actions we don't handle
      res.json({
        status: "ignored",
        reason: `Unhandled PR event: ${eventKey}`,
      });
    } catch (error) {
      logger.error("Error processing BitBucket webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * POST /api/webhooks/:orgSlug/bitbucket
 * Multi-tenant BitBucket webhook handler
 */
router.post(
  "/:orgSlug/bitbucket",
  header("x-event-key").optional().isString(),
  body("pullrequest").optional().isObject(),
  body("repository").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody =
        (req as Request & { rawBody?: Buffer }).rawBody?.toString() ||
        JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature"] as string;
      const eventKey = req.headers["x-event-key"] as string;
      const deliveryId = getDeliveryIdFromHeaders(
        req.headers,
        "bitbucket"
      );

      const verification = await verifyWebhookBySlug(
        orgSlug,
        "bitbucket",
        rawBody,
        signature as string | undefined
      );
      if (!verification.success) {
        res
          .status(verification.statusCode || 401)
          .json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      if (!eventKey?.startsWith("pullrequest:")) {
        res.json({
          status: "ignored",
          reason: "Not a pull request event",
        });
        return;
      }

      const { pullrequest: pr, repository, approval, actor } =
        req.body;
      const prId = pr?.id;
      const prState = pr?.state;
      const repoFullName = repository?.full_name;
      const prUrl = pr?.links?.html?.href;

      // Idempotency
      if (
        deliveryId &&
        (await isDuplicateWebhook(
          deliveryId,
          "bitbucket",
          org.id,
          eventKey
        ))
      ) {
        res.json({ status: "duplicate" });
        return;
      }

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      let task = await taskRepo
        .createQueryBuilder("task")
        .where("task.prUrl = :prUrl", { prUrl })
        .andWhere("task.orgId = :orgId", { orgId: org.id })
        .getOne();

      if (!task && prId && repoFullName) {
        task = await taskRepo
          .createQueryBuilder("task")
          .where("task.githubPrNumber = :prId", { prId })
          .andWhere("task.githubRepo = :repoFullName", {
            repoFullName,
          })
          .andWhere("task.orgId = :orgId", { orgId: org.id })
          .getOne();
      }

      if (!task) {
        res.json({
          status: "ignored",
          reason: "No matching task",
        });
        return;
      }

      if (
        eventKey === "pullrequest:fulfilled" ||
        prState === "MERGED"
      ) {
        try {
          await checkAndUnblockDependentTasks(task);
        } catch (error) {
          logger.warn("Failed to unblock dependent tasks", {
            taskId: task.id,
          });
        }
        res.json({
          status: "processed",
          message: "Checked dependent tasks",
        });
        return;
      }

      if (eventKey === "pullrequest:approved") {
        const approvedBy =
          approval?.user?.display_name ||
          actor?.display_name ||
          actor?.nickname;
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          task.status = "pr_approved";
          await taskRepo.save(task);
          res.json({
            status: "processed",
            taskId: task.id,
            newStatus: "pr_approved",
          });
          return;
        }

        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: PR ***REMOVED***${prId} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;
        await taskRepo.save(task);
        res.json({
          status: "processed",
          taskId: task.id,
          newStatus: "queued",
        });
        return;
      }

      res.json({
        status: "ignored",
        reason: `Unhandled PR event: ${eventKey}`,
      });
    } catch (error) {
      logger.error("Error processing multi-tenant BitBucket webhook", {
        error,
      });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
