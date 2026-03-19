import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask, Organization } from "../../models/index.js";
import {
  verifyWebhookBySlug,
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
 * POST /api/webhooks/gitlab
 * Handle GitLab webhook events (MR approvals and merges)
 *
 * GitLab sends merge request events. We process:
 * - merge_request with action="approved" -> PR approved flow
 * - merge_request with action="merge" -> unblock dependents
 */
router.post(
  "/gitlab",
  header("x-gitlab-event")
    .optional()
    .isString()
    .withMessage("x-gitlab-event must be a string"),
  body("object_kind")
    .optional()
    .isString()
    .withMessage("object_kind must be a string"),
  body("object_attributes")
    .optional()
    .isObject()
    .withMessage("object_attributes must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const event = req.headers["x-gitlab-event"] as string;
      const token = req.headers["x-gitlab-token"] as string;
      const deliveryId =
        (req.headers["x-gitlab-delivery"] as string) ||
        req.body.object_attributes?.id?.toString();
      const rawBody =
        (req as Request & { rawBody?: Buffer }).rawBody?.toString() ||
        JSON.stringify(req.body);

      logger.info("GitLab webhook received", {
        event,
        hasToken: !!token,
        deliveryId,
      });

      // Only process merge request events
      if (req.body.object_kind !== "merge_request") {
        res.json({ status: "ignored", reason: "Not a merge request event" });
        return;
      }

      const { object_attributes: mr, project, user } = req.body;
      const mrIid = mr?.iid;
      const mrState = mr?.state;
      const mrAction = mr?.action;
      const projectPath = project?.path_with_namespace;
      const mrUrl = mr?.url;

      logger.info("GitLab MR event", {
        mrIid,
        mrState,
        mrAction,
        projectPath,
      });

      // Find task by MR URL or project+MR number
      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const orgRepo = AppDataSource.getRepository(Organization);

      // Try to find task by PR URL first
      let task = await taskRepo
        .createQueryBuilder("task")
        .where("task.prUrl = :mrUrl", { mrUrl })
        .getOne();

      // If not found, try by PR number and repo
      if (!task && mrIid && projectPath) {
        task = await taskRepo
          .createQueryBuilder("task")
          .where("task.githubPrNumber = :mrIid", { mrIid })
          .andWhere("task.githubRepo = :projectPath", { projectPath })
          .getOne();
      }

      if (!task) {
        logger.info("No matching task for GitLab MR", {
          mrIid,
          projectPath,
          mrUrl,
        });
        res.json({
          status: "ignored",
          reason: "No matching task for this MR",
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

      // Verify webhook token - GitLab uses a simple token in x-gitlab-token header
      if (!org.gitlabWebhookSecret) {
        logger.error("GitLab webhook secret not configured", {
          orgId: org.id,
        });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      if (token !== org.gitlabWebhookSecret) {
        logger.warn("Invalid GitLab webhook token", {
          orgId: org.id,
          mrIid,
        });
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      // Idempotency check
      if (
        await isDuplicateWebhook(
          deliveryId,
          "gitlab",
          org.id,
          `merge_request.${mrAction}`
        )
      ) {
        res.json({
          status: "duplicate",
          reason: "Webhook already processed",
        });
        return;
      }

      // Handle MR merge - unblock dependent tasks
      if (mrAction === "merge" || mrState === "merged") {
        try {
          await checkAndUnblockDependentTasks(task);
          logger.info("Checked dependent tasks for merged GitLab MR", {
            taskId: task.id,
            mrUrl,
            jiraIssueKey: task.jiraIssueKey,
          });
        } catch (error) {
          logger.warn(
            "Failed to unblock dependent tasks for merged GitLab MR",
            {
              taskId: task.id,
              mrUrl,
              error:
                error instanceof Error ? error.message : String(error),
            }
          );
        }

        res.json({
          status: "processed",
          message: "Checked for dependent tasks to unblock",
          mrUrl,
          mrIid,
          taskId: task.id,
        });
        return;
      }

      // Handle MR approval
      if (mrAction === "approved") {
        const approvedBy = user?.username || user?.name;

        if (task.skipManagerReview === false) {
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
            logger.warn("Failed to sync KbCard column from GitLab webhook", { taskId: task.id, error: err instanceof Error ? err.message : String(err) });
          });

          logger.info("GitLab MR approved, awaiting manager review", {
            taskId: task.id,
            mrIid,
            approvedBy,
            jiraIssueKey: task.jiraIssueKey,
          });

          res.json({
            status: "processed",
            taskId: task.id,
            newStatus: "pr_approved",
            message:
              "MR approved, awaiting manager review before deployment",
          });
          return;
        }

        // No review label - re-queue for deployment — atomic update
        const requeueResult = await taskRepo
          .createQueryBuilder()
          .update(WorkerTask)
          .set({
            status: "queued",
            githubApprovedBy: approvedBy || null,
            taskNotes: `DEPLOYMENT_RUN: MR !${mrIid} approved by ${approvedBy}. Deploy and merge.`,
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

        logger.info("GitLab MR approved, task re-queued for deployment", {
          taskId: task.id,
          mrIid,
          approvedBy,
          jiraIssueKey: task.jiraIssueKey,
        });

        res.json({
          status: "processed",
          taskId: task.id,
          newStatus: "queued",
          message: "Task re-queued for deployment run",
        });
        return;
      }

      // Other MR actions we don't handle
      res.json({
        status: "ignored",
        reason: `Unhandled MR action: ${mrAction}`,
      });
    } catch (error) {
      logger.error("Error processing GitLab webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * POST /api/webhooks/:orgSlug/gitlab
 * Multi-tenant GitLab webhook handler
 */
router.post(
  "/:orgSlug/gitlab",
  header("x-gitlab-event").optional().isString(),
  body("object_kind").optional().isString(),
  body("object_attributes").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody =
        (req as Request & { rawBody?: Buffer }).rawBody?.toString() ||
        JSON.stringify(req.body);
      const token = req.headers["x-gitlab-token"] as string;
      const deliveryId = getDeliveryIdFromHeaders(
        req.headers,
        "gitlab",
        req.body
      );

      const verification = await verifyWebhookBySlug(
        orgSlug,
        "gitlab",
        rawBody,
        token as string | undefined
      );
      if (!verification.success) {
        res
          .status(verification.statusCode || 401)
          .json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      if (req.body.object_kind !== "merge_request") {
        res.json({
          status: "ignored",
          reason: "Not a merge request event",
        });
        return;
      }

      const { object_attributes: mr, project, user } = req.body;
      const mrIid = mr?.iid;
      const mrState = mr?.state;
      const mrAction = mr?.action;
      const mrUrl = mr?.url;

      // Idempotency
      if (
        deliveryId &&
        (await isDuplicateWebhook(
          deliveryId,
          "gitlab",
          org.id,
          `merge_request.${mrAction}`
        ))
      ) {
        res.json({ status: "duplicate" });
        return;
      }

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      let task = await taskRepo
        .createQueryBuilder("task")
        .where("task.prUrl = :mrUrl", { mrUrl })
        .andWhere("task.orgId = :orgId", { orgId: org.id })
        .getOne();

      if (!task && mrIid) {
        task = await taskRepo
          .createQueryBuilder("task")
          .where("task.githubPrNumber = :mrIid", { mrIid })
          .andWhere("task.orgId = :orgId", { orgId: org.id })
          .getOne();
      }

      if (!task) {
        res.json({ status: "ignored", reason: "No matching task" });
        return;
      }

      if (mrAction === "merge" || mrState === "merged") {
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

      if (mrAction === "approved") {
        const approvedBy = user?.username || user?.name;

        if (task.skipManagerReview === false) {
          // Atomic update — guard against concurrent webhook deliveries
          const approveResult2 = await taskRepo
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

          if (approveResult2.affected === 0) {
            res.json({ status: "ignored", reason: "Task status already changed" });
            return;
          }

          // Sync KbCard column to "Approved"
          syncKbCardColumn(task.id, "pr_approved").catch((err) => {
            logger.warn("Failed to sync KbCard column from GitLab webhook", { taskId: task.id, error: err instanceof Error ? err.message : String(err) });
          });
          res.json({
            status: "processed",
            taskId: task.id,
            newStatus: "pr_approved",
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
            taskNotes: `DEPLOYMENT_RUN: MR !${mrIid} approved by ${approvedBy}. Deploy and merge.`,
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
        });
        return;
      }

      res.json({
        status: "ignored",
        reason: `Unhandled MR action: ${mrAction}`,
      });
    } catch (error) {
      logger.error("Error processing multi-tenant GitLab webhook", {
        error,
      });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
