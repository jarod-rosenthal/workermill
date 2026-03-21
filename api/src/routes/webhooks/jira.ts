import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { logger } from "../../utils/logger.js";
import { extractTextFromADF } from "../../utils/jira.js";
import { syncIssueRelationships } from "../../services/task-relationship-sync.js";
import { KbCard } from "../../models/KbCard.js";
import { body, validateRequest } from "../../middleware/validation.js";
import {
  normalizeRepoWithOwner,
  isDuplicateWebhook,
} from "./helpers.js";
import { resetCancelledTask } from "../tasks/lifecycle.js";

const router = Router();

/**
 * POST /api/webhooks/jira
 * REMOVED: Legacy Jira webhook endpoint had a multi-tenancy vulnerability.
 * It selected "any active user" to determine the org, meaning a webhook for
 * Org A could be processed under Org B's context.
 *
 * Use the org-scoped endpoint instead: POST /api/webhooks/:orgSlug/jira
 */
router.post(
  "/jira",
  async (_req: Request, res: Response) => {
    logger.warn("Legacy /jira webhook endpoint called - endpoint removed for security (multi-tenancy vulnerability)");
    res.status(410).json({
      error: "This endpoint has been removed due to a multi-tenancy security vulnerability",
      migration: "Update your Jira webhook URL to: /api/webhooks/{your-org-slug}/jira",
      docs: "https://workermill.com/docs/integrations",
    });
  }
);

/**
 * POST /api/webhooks/jira/test
 * REMOVED: Legacy test endpoint - use org-scoped endpoint instead
 */
router.post(
  "/jira/test",
  async (_req: Request, res: Response) => {
    logger.warn("Legacy /jira/test webhook endpoint called - endpoint removed");
    res.status(410).json({
      error: "This endpoint has been removed",
      migration: "Update your Jira webhook URL to: /api/webhooks/{your-org-slug}/jira",
    });
  }
);

/**
 * POST /api/webhooks/:orgSlug/jira
 * Multi-tenant Jira webhook handler with URL-based org routing
 */
router.post(
  "/:orgSlug/jira",
  body("webhookEvent").optional().isString().withMessage("webhookEvent must be a string"),
  body("issue").optional().isObject().withMessage("issue must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgSlug = req.params.orgSlug as string;
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);
      const signature = getSignatureFromHeaders(req.headers, "jira");

      // Verify webhook with org-specific secret
      const verification = await verifyWebhookBySlug(orgSlug, "jira", rawBody, signature as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      // Idempotency check
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "jira");
      const { webhookEvent, issue } = req.body;
      if (deliveryId && await isDuplicateWebhook(deliveryId, "jira", org.id, webhookEvent)) {
        res.json({ status: "duplicate", reason: "Webhook already processed" });
        return;
      }

      // Process webhook (same logic as legacy endpoint)
      if (!webhookEvent?.startsWith("jira:issue_")) {
        res.json({ status: "ignored", reason: "Not an issue event" });
        return;
      }

      if (!issue) {
        res.json({ status: "ignored", reason: "No issue in payload" });
        return;
      }

      const labels = issue.fields?.labels || [];
      const changelog = req.body.changelog;
      const labelJustAdded = changelog?.items?.some(
        (item: { field?: string; toString?: string }) =>
          item.field === "labels" && item.toString?.includes("workermill")
      );

      if (!labels.includes("workermill") && !labelJustAdded) {
        res.json({ status: "ignored", reason: "Missing workermill label" });
        return;
      }

      const issueKey = issue.key;
      const summary = issue.fields?.summary || "";
      const rawDescription = issue.fields?.description;
      const description = typeof rawDescription === "string"
        ? rawDescription
        : extractTextFromADF(rawDescription);

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const existingTask = await taskRepo.findOne({
        where: { jiraIssueKey: issueKey, orgId: org.id },
      });

      // Check for workflow labels
      const hasReviewLabel = labels.includes("review");
      const hasDeployLabel = labels.includes("deploy");
      const managerEnabled = labels.includes("manager");
      const skipManagerReview = !hasReviewLabel && !org?.autoReviewEnabled;
      const deploymentEnabled = hasDeployLabel || (org?.autoDeployEnabled ?? false);
      const hasImproveLabel = labels.includes("improve");
      const improvementEnabled = hasImproveLabel || (org?.autoImproveEnabled ?? false);
      const qualityGateBypass = labels.includes("bypass-quality-gate") || labels.includes("force-merge");
      const hasSdkLabel = labels.includes("sdk");
      const standardSdkMode = hasSdkLabel;

      // Check for repo override label
      const repoLabel = labels.find((l: string) => l.toLowerCase().startsWith("repo:"));
      const repoOverride = repoLabel ? repoLabel.substring(5) : null;
      const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

      // Detect PRD/Epic/Multi-expert modes
      const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
      const isPrdTicket = labels.some((l: string) => prdLabels.includes(l.toLowerCase()));
      const epicLabelJustAdded = changelog?.items?.some(
        (item: { field?: string; toString?: string }) =>
          item.field === "labels" && item.toString?.toLowerCase().includes("epic")
      );
      // Epic mode is now the DEFAULT (standard workflow deprecated)
      // Use 'standard' or 'v1' label to explicitly opt-out
      const hasStandardLabel = labels.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
      const isV2Pipeline = !hasStandardLabel;
      const criticLabelJustAdded = changelog?.items?.some(
        (item: { field?: string; toString?: string }) =>
          item.field === "labels" && item.toString?.toLowerCase().includes("critic")
      );
      const hasCriticLabel = labels.some((l: string) => l.toLowerCase() === "critic") || criticLabelJustAdded;
      const multiProviderLabelJustAdded = changelog?.items?.some(
        (item: { field?: string; toString?: string }) =>
          item.field === "labels" && item.toString?.toLowerCase().includes("multi-provider")
      );
      const isMultiProvider = labels.some((l: string) => l.toLowerCase() === "multi-provider") || multiProviderLabelJustAdded;

      if (existingTask && !existingTask.isTerminal()) {
        if (existingTask.status === "pr_approved" && deploymentEnabled && !existingTask.deploymentEnabled) {
          existingTask.deploymentEnabled = true;
          await taskRepo.save(existingTask);
          res.json({
            status: "updated",
            reason: "Deploy label added to approved task",
            taskId: existingTask.id,
          });
          return;
        }

        const taskAgeMs = existingTask.createdAt ? Date.now() - new Date(existingTask.createdAt).getTime() : 0;
        const taskAgeHours = Math.round(taskAgeMs / (1000 * 60 * 60) * 10) / 10;

        res.json({
          status: "ignored",
          reason: "Task already exists and is not complete",
          taskId: existingTask.id,
          taskStatus: existingTask.status,
          taskAgeHours,
        });
        return;
      }

      // Handle terminal tasks
      const deletableTerminalStates = ["completed", "deployed", "failed"];
      if (existingTask && deletableTerminalStates.includes(existingTask.status)) {
        const hasChildren = existingTask.childTaskIds && existingTask.childTaskIds.length > 0;
        if (hasChildren) {
          res.json({
            status: "ignored",
            reason: "PRD workflow completed - children exist",
            taskId: existingTask.id,
          });
          return;
        }
        if (existingTask.pipelineVersion === "v2" || existingTask.workerProvider === "ai-sdk") {
          res.json({
            status: "ignored",
            reason: "Epic/Multi-expert task completed - remove and re-add label to restart",
            taskId: existingTask.id,
          });
          return;
        }
        await taskRepo.remove(existingTask);
      }

      if (existingTask && existingTask.status === "cancelled") {
        await resetCancelledTask(existingTask);
        res.json({
          status: "reset",
          reason: "Cancelled task reset for re-execution",
          taskId: existingTask.id,
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
        .andWhere("card.title = :title", { title: summary })
        .getOne();

      if (prdCard) {
        logger.info("Jira webhook: skipping PRD-synced ticket", { issueKey, summary });
        res.json({ status: "ignored", reason: "PRD-managed ticket" });
        return;
      }

      // Infer persona and determine provider/model
      const persona = await inferPersonaFromJiraIssue(
        {
          summary,
          description,
          labels,
          fields: issue.fields,
        },
        undefined, // explicitPersona
        org.id     // orgId for org-specific inference rules
      );

      const routing = org.providerRouting?.[persona];
      const hasRouting = routing && routing.provider;

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
      if (isMultiProvider) {
        workerProvider = "ai-sdk";
      } else if (detectedProviderLabel) {
        workerProvider = providerMap[detectedProviderLabel.toLowerCase()];
      } else if (hasRouting) {
        workerProvider = routing.provider;
      } else {
        workerProvider = org.primaryProvider || "anthropic";
      }

      const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
        anthropic: "claude-haiku-4-5-20251001",
        openai: "gpt-5.1-codex",
        google: "gemini-3-pro-preview",
        ollama: "qwen2.5-coder:32b",
      };

      let model: string;
      if (labels.includes("opus")) {
        model = "claude-opus-4-6";
      } else if (labels.includes("sonnet")) {
        model = "claude-sonnet-4-6";
      } else if (labels.includes("haiku")) {
        model = "claude-haiku-4-5-20251001";
      } else if (hasRouting && routing.model) {
        model = routing.model;
      } else {
        model = PROVIDER_DEFAULT_MODELS[workerProvider] || PROVIDER_DEFAULT_MODELS.anthropic;
      }

      // Check if Epic mode can be used (Anthropic only, no routing overrides)
      const hasRoutingOverrides = org.providerRouting &&
        Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
      const canUseEpicMode = (org.primaryProvider === "anthropic" || !org.primaryProvider) && !hasRoutingOverrides;

      // Create task
      // Mock worker mode: skip planning entirely — tasks go straight to queued
      // so mock workers can pick them up immediately for E2E testing
      const needsPlanning = process.env.MOCK_WORKERS !== "true" && (isPrdTicket || isV2Pipeline || isMultiProvider);
      const initialStatus = needsPlanning ? "planning" : "queued";
      const taskPersona = needsPlanning ? "project_manager" : persona;

      let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
      let pipelineVersion: "v1" | "v2" | null = null;
      if (isV2Pipeline && canUseEpicMode) {
        executionMode = "parallel"; // Epic mode (Anthropic only)
        pipelineVersion = "v2";
      } else if (isV2Pipeline || isMultiProvider) {
        executionMode = "multi-expert"; // Multi-provider mode (any provider)
        pipelineVersion = "v2";
      }

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
        ticketSystem: "jira",
        scmProvider: org.scmProvider || "github",
        githubRepo: targetRepo,
        status: initialStatus,
        deploymentEnabled,
        skipManagerReview,
        improvementEnabled,
        qualityGateBypass,
        managerEnabled,
        standardSdkMode,
        retryCount: 0,
        maxRetries: 3,
        pipelineVersion,
        executionMode,
        criticEnabled: hasCriticLabel,
      });

      await taskRepo.save(task);

      logger.info("Created worker task from multi-tenant Jira webhook", {
        taskId: task.id,
        jiraIssueKey: issueKey,
        persona: taskPersona,
        model,
        provider: workerProvider,
        orgId: org.id,
        orgSlug,
        initialStatus,
      });

      // Sync issue relationships (blocks/depends_on) from Jira
      await syncIssueRelationships(task, org, "jira", issueKey);

      res.status(201).json({
        status: "created",
        taskId: task.id,
        persona: taskPersona,
        model,
        provider: workerProvider,
        initialStatus,
      });
    } catch (error) {
      logger.error("Error processing multi-tenant Jira webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

export default router;
