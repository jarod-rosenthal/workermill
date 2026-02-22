import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { checkAndUnblockDependentTasks, syncKbCardColumn } from "../../services/task-monitor.js";
import { logger } from "../../utils/logger.js";
import {
  body,
  header,
  validateRequest,
} from "../../middleware/validation.js";
import { isDuplicateWebhook } from "./helpers.js";

const router = Router();

/**
 * POST /api/webhooks/github
 * REMOVED: Legacy GitHub webhook endpoint had an org routing vulnerability.
 * It looked up the org by finding the first matching task, which meant tasks
 * from multiple orgs referencing the same PR number could cause the wrong
 * org's webhook secret to be used for signature verification.
 *
 * Use the org-scoped endpoint instead: POST /api/webhooks/:orgSlug/github
 */
router.post(
  "/github",
  async (_req: Request, res: Response) => {
    logger.warn(
      "Legacy /github webhook endpoint called - endpoint removed for security (org routing vulnerability)",
    );
    res.status(410).json({
      error:
        "This endpoint has been removed due to an org routing security vulnerability",
      migration:
        "Update your GitHub webhook URL to: /api/webhooks/{your-org-slug}/github",
      docs: "https://workermill.com/docs/integrations",
    });
  },
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

      // Check if task already went through inline review (Epic + review label)
      const alreadyInlineReviewed = task.status === "pr_approved";

      if (task.skipManagerReview === false && !alreadyInlineReviewed) {
        // Atomic update — guard against concurrent webhook deliveries
        const approveResult = await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            status: "pr_approved",
            githubApprovedBy: approvedBy || null,
          } as Record<string, unknown>)
          .where("id = :id AND status IN (:...statuses)", {
            id: task.id,
            statuses: ["pr_created", "review_requested"],
          })
          .execute();

        if (approveResult.affected === 0) {
          res.json({ status: "ignored", reason: "Task status already changed" });
          return;
        }

        // Sync KbCard column to "Approved"
        syncKbCardColumn(task.id, "pr_approved").catch((err) => {
          logger.warn("Failed to sync KbCard column from GitHub webhook", { taskId: task.id, error: err instanceof Error ? err.message : String(err) });
        });

        res.json({
          status: "processed",
          taskId: task.id,
          newStatus: "pr_approved",
          message: "PR approved, awaiting manager review",
        });
        return;
      }

      // Atomic update — guard against concurrent webhook deliveries
      const requeueResult = await taskRepo
        .createQueryBuilder()
        .update(WorkerTask)
        .set({
          status: "queued",
          githubApprovedBy: approvedBy || null,
          taskNotes: `DEPLOYMENT_RUN: PR ***REMOVED***${prNumber} approved by ${approvedBy}. Deploy and merge.`,
          completedAt: null,
          ecsTaskArn: null,
          ecsTaskId: null,
          startedAt: null,
        } as Record<string, unknown>)
        .where("id = :id AND status IN (:...statuses)", {
          id: task.id,
          statuses: ["pr_created", "review_requested", "pr_approved"],
        })
        .execute();

      if (requeueResult.affected === 0) {
        res.json({ status: "ignored", reason: "Task status already changed" });
        return;
      }

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
