import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  Organization,
  User,
  AuthorizedEmailSender,
  InboundEmailMapping,
  WebhookEndpoint,
  type IntegrationType,
} from "../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../services/webhook.js";
import type { WorkerPersona } from "../models/WorkerTask.js";
import { inferPersonaFromJiraIssue } from "../services/persona-inference.js";
import { checkAndUnblockDependentTasks } from "../services/orchestrator.js";
import { getECSTaskRunner } from "../services/ecs-task-runner.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { logTaskCreated, type AuditContext } from "../services/audit.js";
import { extractTextFromADF } from "../utils/jira.js";
import { trackLegacyWebhookUsage } from "../services/legacy-webhook-alert.js";
import {
  body,
  header,
  validateRequest,
} from "../middleware/validation.js";

const router = Router();

/**
 * Normalize repository string to include owner if missing
 * If repo doesn't contain "/", prepend the owner from defaultGithubRepo
 */
function normalizeRepoWithOwner(
  repo: string | null,
  defaultGithubRepo: string | null
): string {
  if (!repo) {
    return defaultGithubRepo || "";
  }

  // If repo already has owner/repo format, return as-is
  if (repo.includes("/")) {
    return repo;
  }

  // Extract owner from defaultGithubRepo (format: "owner/repo")
  if (defaultGithubRepo && defaultGithubRepo.includes("/")) {
    const owner = defaultGithubRepo.split("/")[0];
    return `${owner}/${repo}`;
  }

  // Fallback: return repo as-is (will likely fail to clone, but that's expected)
  return repo;
}

/**
 * Check if a webhook delivery has already been processed (idempotency)
 * Returns true if this is a duplicate that should be skipped
 */
async function isDuplicateWebhook(
  deliveryId: string,
  source: "jira" | "github" | "linear" | "github-issues" | "email" | "gitlab" | "bitbucket",
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
    // Log webhook receipt with deprecation warning
    logger.warn("DEPRECATED: Legacy /jira webhook endpoint used. Migrate to /:orgSlug/jira for proper multi-tenant isolation.");

    // SECURITY: Legacy endpoint - try to identify org, but NEVER fall back to arbitrary org selection
    const orgRepo = AppDataSource.getRepository(Organization);
    const userRepo = AppDataSource.getRepository(User);

    // Try to find org with active users - this is a best-effort for legacy compatibility
    const activeUser = await userRepo.findOne({
      where: { status: "active" },
      relations: ["organization"],
    });
    const org = activeUser?.organization;

    // SECURITY FIX: Do NOT fall back to arbitrary org - require explicit org identification
    if (!org) {
      logger.error("Legacy Jira webhook: cannot identify organization", {
        hint: "Use org-scoped endpoint: /api/webhooks/:orgSlug/jira",
      });
      res.status(400).json({
        error: "Cannot identify organization for this webhook",
        hint: "Please update your Jira webhook URL to use the org-scoped format: /api/webhooks/{your-org-slug}/jira",
      });
      return;
    }

    logger.warn("Legacy Jira webhook endpoint used - consider migrating to org-scoped URL", {
      orgId: org.id,
      orgName: org.name,
      recommendedUrl: `/api/webhooks/${org.slug || org.id}/jira`,
    });

    // Track legacy endpoint usage for alerting
    await trackLegacyWebhookUsage({
      integrationType: "jira",
      orgId: org.id,
      orgName: org.name,
      sourceIp: req.ip || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

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
    // Label takes precedence, then org setting, then default
    const hasReviewLabel = labels.includes("review");
    const hasDeployLabel = labels.includes("deploy");
    const managerEnabled = labels.includes("manager");

    // If review label present → require review
    // If no review label but org.autoReviewEnabled → require review
    // Otherwise → skip review
    const skipManagerReview = !hasReviewLabel && !org?.autoReviewEnabled;

    // If deploy label present → enable deployment
    // If no deploy label but org.autoDeployEnabled → enable deployment
    // Otherwise → disabled
    const deploymentEnabled = hasDeployLabel || (org?.autoDeployEnabled ?? false);

    // If improve label present → enable self-improvement analysis
    // If no improve label but org.autoImproveEnabled → enable improvement
    // Otherwise → disabled
    const hasImproveLabel = labels.includes("improve");
    const improvementEnabled = hasImproveLabel || (org?.autoImproveEnabled ?? false);

    // If bypass-quality-gate label present → bypass quality gate checks
    const qualityGateBypass = labels.includes("bypass-quality-gate") || labels.includes("force-merge");

    // If sdk label present → use SDK-based standard executor (single-task with Epic-level features)
    // This provides inline review/deploy/improve for non-Epic tasks
    const hasSdkLabel = labels.includes("sdk");
    const standardSdkMode = hasSdkLabel;

    // Check for repo override label (e.g., "repo:astrofog" or "repo:pagerduty-lite")
    // Falls back to org.getDefaultRepo() if not specified
    // If repo doesn't include owner (no "/"), prepend owner from defaultGithubRepo
    const repoLabel = labels.find((l: string) => l.toLowerCase().startsWith("repo:"));
    const repoOverride = repoLabel ? repoLabel.substring(5) : null; // Remove "repo:" prefix
    const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

    // Detect PRD/Epic tickets that need multi-story planning
    // These labels trigger the Planning Agent for execution plan creation
    const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
    const isPrdTicket = labels.some((l: string) =>
      prdLabels.includes(l.toLowerCase())
    );

    // Epic mode is now the DEFAULT for all tasks (standard workflow deprecated)
    // Use 'standard' or 'v1' label to explicitly opt-out to legacy single-persona execution
    // Also check changelog for race condition (like workermill label)
    const epicLabelJustAdded = changelog?.items?.some(
      (item: { field?: string; toString?: string }) =>
        item.field === "labels" && item.toString?.toLowerCase().includes("epic")
    );
    const hasStandardLabel = labels.some(
      (l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1"
    );
    // Default to Epic (v2 pipeline) unless explicitly opting out with 'standard' or 'v1' label
    const isV2Pipeline = !hasStandardLabel;

    // Detect critic label for optional Planner-Critic validation
    // When present, run Planner-Critic validation loop before execution
    // Also check changelog for race condition
    const criticLabelJustAdded = changelog?.items?.some(
      (item: { field?: string; toString?: string }) =>
        item.field === "labels" && item.toString?.toLowerCase().includes("critic")
    );
    const hasCriticLabel = labels.some(
      (l: string) => l.toLowerCase() === "critic"
    ) || criticLabelJustAdded;

    // Detect multi-provider label for Vercel AI SDK execution mode
    // When present, uses AI SDK with per-persona provider routing from org settings
    // Also check changelog for race condition
    const multiProviderLabelJustAdded = changelog?.items?.some(
      (item: { field?: string; toString?: string }) =>
        item.field === "labels" && item.toString?.toLowerCase().includes("multi-provider")
    );
    const isMultiProvider = labels.some(
      (l: string) => l.toLowerCase() === "multi-provider"
    ) || multiProviderLabelJustAdded;

    // Log if labels detected via changelog (helps debug race conditions)
    if (epicLabelJustAdded && !labels.some((l: string) => l.toLowerCase() === "epic")) {
      logger.info("Epic label detected via changelog (race condition workaround)", { issueKey });
    }
    if (multiProviderLabelJustAdded && !labels.some((l: string) => l.toLowerCase() === "multi-provider")) {
      logger.info("Multi-provider label detected via changelog (race condition workaround)", { issueKey });
    }

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
      // Don't auto-restart Epic (v2 pipeline) tasks - they manage sub-agents internally
      // and completing them triggers Jira updates which would cause infinite loops
      if (existingTask.pipelineVersion === "v2") {
        logger.info("Ignoring webhook for completed Epic task - remove workermill label to restart", {
          taskId: existingTask.id,
          jiraIssueKey: issueKey,
          status: existingTask.status,
          pipelineVersion: existingTask.pipelineVersion,
        });
        res.json({
          status: "ignored",
          reason: "Epic workflow completed - remove workermill label and re-add to restart",
          taskId: existingTask.id,
          taskStatus: existingTask.status,
        });
        return;
      }
      // Don't auto-restart multi-expert (ai-sdk) tasks - transitioning to Done triggers
      // Jira webhook which would cause infinite restart loops
      if (existingTask.workerProvider === "ai-sdk") {
        logger.info("Ignoring webhook for completed multi-expert task - remove workermill label to restart", {
          taskId: existingTask.id,
          jiraIssueKey: issueKey,
          status: existingTask.status,
          workerProvider: existingTask.workerProvider,
        });
        res.json({
          status: "ignored",
          reason: "Multi-expert task completed - remove workermill label and re-add to restart",
          taskId: existingTask.id,
          taskStatus: existingTask.status,
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
    if (isMultiProvider) {
      // Multi-expert mode uses AI SDK executor with per-persona provider routing
      workerProvider = "ai-sdk";
      logger.info("Multi-expert mode enabled, using AI SDK executor", {
        persona,
        hasRouting,
        routingProvider: routing?.provider,
        routingModel: routing?.model,
        orgId: org.id,
      });
    } else if (detectedProviderLabel) {
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

    // Default models per provider (updated 2024-01)
    const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
      anthropic: "claude-haiku-4-5-20251001",
      openai: "gpt-5.1-codex",
      google: "gemini-3-pro-preview",
      ollama: "qwen2.5-coder:32b",
    };

    // Determine model based on:
    // 1. Jira labels (explicit override)
    // 2. Provider routing rules (auto-routing)
    // 3. Org default model (if provider matches org's primary provider)
    // 4. Provider-specific defaults
    let model: string;
    if (labels.includes("opus")) {
      model = "claude-opus-4-6";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
    } else if (labels.includes("haiku")) {
      model = "claude-haiku-4-5-20251001";
    } else if (hasRouting && routing.model) {
      // Use routed model
      model = routing.model;
    } else if (isMultiProvider && hasRouting) {
      // Multi-expert mode uses routing model or provider default
      const routingProvider = routing.provider || "anthropic";
      model = PROVIDER_DEFAULT_MODELS[routingProvider] || PROVIDER_DEFAULT_MODELS.anthropic;
    } else if (workerProvider === "ai-sdk") {
      // AI SDK mode without routing - use anthropic default
      model = PROVIDER_DEFAULT_MODELS.anthropic;
    } else if (workerProvider === "ollama") {
      // Use org's default model if Ollama is the primary provider, otherwise use fallback
      model = org.primaryProvider === "ollama" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : PROVIDER_DEFAULT_MODELS.ollama;
    } else if (workerProvider === "openai") {
      model = org.primaryProvider === "openai" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : PROVIDER_DEFAULT_MODELS.openai;
    } else if (workerProvider === "google") {
      model = org.primaryProvider === "google" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : PROVIDER_DEFAULT_MODELS.google;
    } else {
      // Anthropic or fallback
      model = org.primaryProvider === "anthropic" && org.defaultWorkerModel
        ? org.defaultWorkerModel
        : PROVIDER_DEFAULT_MODELS.anthropic;
    }

    // Create new task (workflow labels already extracted above)
    // PRD/Epic/Multi-expert tickets start in "planning" status to trigger the Planning Agent
    // Regular tickets start in "queued" status for immediate execution
    const needsPlanning = isPrdTicket || isV2Pipeline || isMultiProvider;
    const initialStatus = needsPlanning ? "planning" : "queued";

    // For tasks that need planning, use project_manager persona for the planning phase
    // The planning agent will create stories with their own personas
    const taskPersona = needsPlanning ? "project_manager" : persona;

    // Determine execution mode based on labels and provider configuration
    // - Epic mode (parallel): Only for Anthropic with no routing overrides
    // - Multi-expert mode: For non-Anthropic providers or when routing overrides exist
    // - Single: No planning labels
    let executionMode: "single" | "sequential" | "parallel" | "multi-expert" = "single";
    let pipelineVersion: "v1" | "v2" | null = null;

    // Epic mode only works with Anthropic and no routing overrides
    const hasRoutingOverrides = org.providerRouting &&
      Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
    const canUseEpicMode = org.primaryProvider === "anthropic" && !hasRoutingOverrides;

    if (isV2Pipeline && canUseEpicMode) {
      executionMode = "parallel"; // Epic mode (Anthropic only)
      pipelineVersion = "v2";
    } else if (isV2Pipeline || isMultiProvider) {
      executionMode = "multi-expert"; // Multi-provider with AI SDK
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
      // V2 Pipeline: for Epic and multi-expert execution
      pipelineVersion,
      // Execution mode: parallel (Epic), multi-expert (AI SDK multi-provider), or single
      executionMode,
      // Critic mode: enable Planner-Critic validation when "critic" label is present
      criticEnabled: hasCriticLabel,
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
      isV2Pipeline,
      isMultiProvider,
      pipelineVersion: task.pipelineVersion,
      executionMode: task.executionMode,
      criticEnabled: task.criticEnabled,
      improvementEnabled: task.improvementEnabled,
      standardSdkMode: task.standardSdkMode,
      initialStatus,
      githubRepo: targetRepo,
      repoOverride: repoOverride || "(using org default)",
    });

    res.status(201).json({
      status: "created",
      taskId: task.id,
      persona: taskPersona,
      model,
      provider: workerProvider,
      isPrdTicket,
      isV2Pipeline,
      isMultiProvider,
      pipelineVersion: task.pipelineVersion,
      executionMode: task.executionMode,
      criticEnabled: task.criticEnabled,
      standardSdkMode: task.standardSdkMode,
      initialStatus,
      githubRepo: targetRepo,
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
    let model = org.defaultWorkerModel || "claude-sonnet-4-5-20250929";
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
    let model = org.defaultWorkerModel || "claude-sonnet-4-5-20250929";
    if (labels.includes("opus")) {
      model = "claude-opus-4-6";
    } else if (labels.includes("sonnet")) {
      model = "claude-sonnet-4-5-20250929";
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
 * POST /api/webhooks/gitlab
 * Handle GitLab webhook events (MR approvals and merges)
 *
 * GitLab sends merge request events. We process:
 * - merge_request with action="approved" -> PR approved flow
 * - merge_request with action="merge" -> unblock dependents
 */
router.post(
  "/gitlab",
  header("x-gitlab-event").optional().isString().withMessage("x-gitlab-event must be a string"),
  body("object_kind").optional().isString().withMessage("object_kind must be a string"),
  body("object_attributes").optional().isObject().withMessage("object_attributes must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const event = req.headers["x-gitlab-event"] as string;
      const token = req.headers["x-gitlab-token"] as string;
      const deliveryId = req.headers["x-gitlab-delivery"] as string || req.body.object_attributes?.id?.toString();
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);

      logger.info("GitLab webhook received", { event, hasToken: !!token, deliveryId });

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

      logger.info("GitLab MR event", { mrIid, mrState, mrAction, projectPath });

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
        logger.info("No matching task for GitLab MR", { mrIid, projectPath, mrUrl });
        res.json({ status: "ignored", reason: "No matching task for this MR" });
        return;
      }

      // Get org to verify webhook
      const org = await orgRepo.findOne({ where: { id: task.orgId } });
      if (!org) {
        logger.error("Organization not found for task", { taskId: task.id });
        res.status(500).json({ error: "Organization not found" });
        return;
      }

      // Verify webhook token - GitLab uses a simple token in x-gitlab-token header
      if (!org.gitlabWebhookSecret) {
        logger.error("GitLab webhook secret not configured", { orgId: org.id });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      if (token !== org.gitlabWebhookSecret) {
        logger.warn("Invalid GitLab webhook token", { orgId: org.id, mrIid });
        res.status(401).json({ error: "Invalid token" });
        return;
      }

      // Idempotency check
      if (await isDuplicateWebhook(deliveryId, "gitlab", org.id, `merge_request.${mrAction}`)) {
        res.json({ status: "duplicate", reason: "Webhook already processed" });
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
          logger.warn("Failed to unblock dependent tasks for merged GitLab MR", {
            taskId: task.id,
            mrUrl,
            error: error instanceof Error ? error.message : String(error),
          });
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
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          // Task has 'review' label - await manager review
          task.status = "pr_approved";
          await taskRepo.save(task);

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
            message: "MR approved, awaiting manager review before deployment",
          });
          return;
        }

        // No review label - re-queue for deployment
        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: MR !${mrIid} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;

        await taskRepo.save(task);

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
      res.json({ status: "ignored", reason: `Unhandled MR action: ${mrAction}` });
    } catch (error) {
      logger.error("Error processing GitLab webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

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
  header("x-event-key").optional().isString().withMessage("x-event-key must be a string"),
  body("pullrequest").optional().isObject().withMessage("pullrequest must be an object"),
  body("repository").optional().isObject().withMessage("repository must be an object"),
  body("approval").optional().isObject().withMessage("approval must be an object"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const eventKey = req.headers["x-event-key"] as string;
      const hookUuid = req.headers["x-hook-uuid"] as string;
      const requestUuid = req.headers["x-request-uuid"] as string;
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);

      logger.info("BitBucket webhook received", { eventKey, hookUuid, hasRequestUuid: !!requestUuid });

      // Only process PR events
      if (!eventKey?.startsWith("pullrequest:")) {
        res.json({ status: "ignored", reason: "Not a pull request event" });
        return;
      }

      const { pullrequest: pr, repository, approval, actor } = req.body;
      const prId = pr?.id;
      const prState = pr?.state;
      const repoFullName = repository?.full_name;
      const prUrl = pr?.links?.html?.href;

      logger.info("BitBucket PR event", { prId, prState, eventKey, repoFullName });

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
        logger.info("No matching task for BitBucket PR", { prId, repoFullName, prUrl });
        res.json({ status: "ignored", reason: "No matching task for this PR" });
        return;
      }

      // Get org to verify webhook
      const org = await orgRepo.findOne({ where: { id: task.orgId } });
      if (!org) {
        logger.error("Organization not found for task", { taskId: task.id });
        res.status(500).json({ error: "Organization not found" });
        return;
      }

      // Verify webhook signature - BitBucket uses HMAC-SHA256 similar to GitHub
      if (!org.bitbucketWebhookSecret) {
        logger.error("BitBucket webhook secret not configured", { orgId: org.id });
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
        crypto.createHmac("sha256", org.bitbucketWebhookSecret).update(rawBody).digest("hex");

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        logger.warn("Invalid BitBucket webhook signature", { orgId: org.id, prId });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Idempotency check
      const deliveryId = requestUuid || `${hookUuid}-${prId}-${eventKey}`;
      if (await isDuplicateWebhook(deliveryId, "bitbucket", org.id, eventKey)) {
        res.json({ status: "duplicate", reason: "Webhook already processed" });
        return;
      }

      // Handle PR merged (fulfilled)
      if (eventKey === "pullrequest:fulfilled" || prState === "MERGED") {
        try {
          await checkAndUnblockDependentTasks(task);
          logger.info("Checked dependent tasks for merged BitBucket PR", {
            taskId: task.id,
            prUrl,
            jiraIssueKey: task.jiraIssueKey,
          });
        } catch (error) {
          logger.warn("Failed to unblock dependent tasks for merged BitBucket PR", {
            taskId: task.id,
            prUrl,
            error: error instanceof Error ? error.message : String(error),
          });
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
        const approvedBy = approval?.user?.display_name || actor?.display_name || actor?.nickname;
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          // Task has 'review' label - await manager review
          task.status = "pr_approved";
          await taskRepo.save(task);

          logger.info("BitBucket PR approved, awaiting manager review", {
            taskId: task.id,
            prId,
            approvedBy,
            jiraIssueKey: task.jiraIssueKey,
          });

          res.json({
            status: "processed",
            taskId: task.id,
            newStatus: "pr_approved",
            message: "PR approved, awaiting manager review before deployment",
          });
          return;
        }

        // No review label - re-queue for deployment
        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: PR #${prId} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;

        await taskRepo.save(task);

        logger.info("BitBucket PR approved, task re-queued for deployment", {
          taskId: task.id,
          prId,
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

      // Other PR actions we don't handle
      res.json({ status: "ignored", reason: `Unhandled PR event: ${eventKey}` });
    } catch (error) {
      logger.error("Error processing BitBucket webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

/**
 * Verify email webhook signature from Lambda
 */
function verifyEmailSignature(
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

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Extract labels from email subject
 * Format: [label1, label2] or [label1][label2]
 * Example: "[backend, deploy] Fix login bug" -> ["backend", "deploy"]
 */
function extractLabelsFromSubject(subject: string): string[] {
  const labels: string[] = [];

  // Match [label1, label2, ...] format
  const bracketMatch = subject.match(/\[([^\]]+)\]/g);
  if (bracketMatch) {
    for (const match of bracketMatch) {
      // Remove brackets and split by comma or space
      const content = match.slice(1, -1);
      const parts = content.split(/[,\s]+/).filter(Boolean);
      labels.push(...parts.map(p => p.toLowerCase().trim()));
    }
  }

  return [...new Set(labels)]; // Dedupe
}

/**
 * Parse recipient email to determine action
 * Patterns:
 * - task@domain -> create_task
 * - task+{taskId}@domain -> reply_to_task (with taskId)
 * - backend@domain -> create_task with persona
 * - frontend@domain -> create_task with persona
 * - {anything}+{taskId}@domain -> reply_to_task
 */
function parseRecipientAction(recipient: string): {
  action: "create_task" | "reply_to_task";
  persona?: string;
  taskId?: string;
} {
  const atIndex = recipient.indexOf("@");
  if (atIndex === -1) {
    return { action: "create_task" };
  }

  const localPart = recipient.substring(0, atIndex).toLowerCase();

  // Check for +taskId pattern (e.g., task+abc123@domain or backend+abc123@domain)
  const plusIndex = localPart.indexOf("+");
  if (plusIndex !== -1) {
    const taskId = localPart.substring(plusIndex + 1);
    const prefix = localPart.substring(0, plusIndex);

    // If taskId looks like a UUID, it's a reply
    if (taskId && taskId.length > 8) {
      return { action: "reply_to_task", taskId };
    }

    // Otherwise treat the part after + as a suffix hint
    return { action: "create_task", persona: prefix };
  }

  // Known persona addresses
  const personaMap: Record<string, string> = {
    backend: "backend_developer",
    frontend: "frontend_developer",
    devops: "devops_engineer",
    qa: "qa_engineer",
    security: "security_engineer",
    docs: "tech_writer",
    pm: "project_manager",
  };

  if (personaMap[localPart]) {
    return { action: "create_task", persona: personaMap[localPart] };
  }

  return { action: "create_task" };
}

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
  body("messageId").notEmpty().isString().withMessage("messageId is required"),
  body("source").notEmpty().isEmail().withMessage("source must be a valid email"),
  body("recipients").isArray().withMessage("recipients must be an array"),
  body("timestamp").optional().isString(),
  body("content").optional().isObject(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      // Log webhook receipt with deprecation warning
      logger.warn("DEPRECATED: Legacy /email webhook endpoint used. Consider migrating to URL-based routing for multi-tenant isolation.");

      const signature = req.headers["x-email-signature"] as string;
      const rawBody = JSON.stringify(req.body);

      const { messageId, source, recipients, timestamp, content } = req.body;

      logger.info("Email webhook received", {
        messageId,
        source,
        recipients,
        hasContent: !!content,
      });

      // Find org from recipient email pattern
      // Recipients could be: task@workermill.com, backend@workermill.com, orgslug@workermill.com
      const orgRepo = AppDataSource.getRepository(Organization);
      const mappingRepo = AppDataSource.getRepository(InboundEmailMapping);
      const senderRepo = AppDataSource.getRepository(AuthorizedEmailSender);
      const taskRepo = AppDataSource.getRepository(WorkerTask);

      // Try to find org from email mapping or by matching recipient patterns
      let org: Organization | null = null;
      let matchedMapping: InboundEmailMapping | null = null;

      for (const recipient of recipients) {
        // Check for explicit email mapping
        const mapping = await mappingRepo
          .createQueryBuilder("mapping")
          .where("mapping.is_active = true")
          .andWhere(":recipient LIKE REPLACE(mapping.email_pattern, '*', '%')", { recipient })
          .orderBy("mapping.created_at", "ASC")
          .getOne();

        if (mapping) {
          matchedMapping = mapping;
          org = await orgRepo.findOne({ where: { id: mapping.orgId } });
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
      const emailWebhookSecret = (org.providerSettings as Record<string, unknown>)?.emailWebhookSecret as string | undefined;

      if (!emailWebhookSecret) {
        logger.error("Email webhook secret not configured", { orgId: org.id });
        res.status(500).json({ error: "Webhook not configured" });
        return;
      }

      // Verify signature
      if (!verifyEmailSignature(rawBody, signature, emailWebhookSecret)) {
        logger.warn("Invalid email webhook signature", { orgId: org.id, messageId });
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      // Idempotency check
      if (await isDuplicateWebhook(messageId, "email", org.id, "inbound")) {
        res.json({ status: "duplicate", reason: "Email already processed" });
        return;
      }

      // Check if sender is authorized
      const authorizedSenders = await senderRepo.find({
        where: { orgId: org.id, isActive: true },
      });

      const senderAuthorized = authorizedSenders.length === 0 || // No whitelist = allow all
        authorizedSenders.some(sender => sender.matches(source));

      if (!senderAuthorized) {
        logger.warn("Unauthorized email sender", { orgId: org.id, source, messageId });
        res.json({
          status: "ignored",
          reason: "Sender not authorized",
        });
        return;
      }

      // Parse first recipient to determine action
      const primaryRecipient = recipients[0] || "";
      const { action, persona: inferredPersona, taskId } = parseRecipientAction(primaryRecipient);

      // Extract subject and body from content
      const subject = content?.subject || "";
      const body = content?.body || "";

      // Handle reply_to_task action
      if (action === "reply_to_task" && taskId) {
        const existingTask = await taskRepo.findOne({
          where: { id: taskId, orgId: org.id },
        });

        if (!existingTask) {
          logger.warn("Task not found for email reply", { taskId, messageId });
          res.json({
            status: "ignored",
            reason: "Task not found",
          });
          return;
        }

        // Append email content to task notes
        const noteEntry = `\n\n---\n**Email from ${source}** (${timestamp || new Date().toISOString()})\n\n${subject ? `**Subject:** ${subject}\n\n` : ""}${body}`;
        existingTask.taskNotes = (existingTask.taskNotes || "") + noteEntry;
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
      let persona: WorkerPersona = (inferredPersona as WorkerPersona) || "backend_developer";
      const personaLabels = ["backend", "frontend", "devops", "qa", "security", "docs", "pm"];
      const labelPersona = labels.find(l => personaLabels.includes(l));
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
        persona = matchedMapping.actionConfig.defaultPersona as WorkerPersona;
      }

      // Determine model from labels
      let model = org.defaultWorkerModel || "claude-haiku-4-5-20251001";
      if (labels.includes("opus")) {
        model = "claude-opus-4-6";
      } else if (labels.includes("sonnet")) {
        model = "claude-sonnet-4-5-20250929";
      } else if (labels.includes("haiku")) {
        model = "claude-haiku-4-5-20251001";
      }

      // Check for repo override in labels
      const repoLabel = labels.find(l => l.startsWith("repo:"));
      const repoOverride = repoLabel ? repoLabel.substring(5) : null;
      const targetRepo = normalizeRepoWithOwner(repoOverride, org.getDefaultRepo());

      // Generate issue key from email
      const issueKey = `EMAIL-${messageId.substring(0, 8)}`;

      // Clean subject for summary (remove label brackets)
      const cleanSubject = subject.replace(/\[[^\]]*\]/g, "").trim() || "Task from email";

      // Epic mode is now the DEFAULT (standard workflow deprecated)
      // Use 'standard' or 'v1' label to explicitly opt-out
      const hasStandardLabel = labels.some((l: string) => l.toLowerCase() === "standard" || l.toLowerCase() === "v1");
      const isV2Pipeline = !hasStandardLabel;
      const isMultiProvider = labels.some((l: string) => l.toLowerCase() === "multi-provider");
      const hasCriticLabel = labels.some((l: string) => l.toLowerCase() === "critic");

      // Check if Epic mode can be used (Anthropic only, no routing overrides)
      const hasRoutingOverrides = org.providerRouting &&
        Object.keys(org.providerRouting as Record<string, unknown>).length > 0;
      const canUseEpicMode = (org.primaryProvider === "anthropic" || !org.primaryProvider) && !hasRoutingOverrides;

      // Tasks needing planning: Epic (default) or Multi-Provider
      const needsPlanning = isV2Pipeline || isMultiProvider;
      const initialStatus = needsPlanning ? "planning" : "queued";
      const taskPersona = needsPlanning ? "project_manager" : persona;

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
        logger.warn("Failed to log audit event for email task", { error: auditError });
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

// ============================================================================
// URL-BASED TENANT ROUTING (Multi-Tenant Isolation)
// ============================================================================
//
// New webhook URL format: /api/webhooks/:orgSlug/:integration
// Example: https://workermill.com/api/webhooks/acme-corp/jira
//
// This provides proper multi-tenant isolation by:
// 1. Explicit org identification via URL slug
// 2. Per-org webhook secrets stored in webhook_endpoints table
// 3. No ambiguous "find any org" logic
//
// Legacy endpoints above are kept for backwards compatibility but log deprecation warnings.

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
        res.json({
          status: "ignored",
          reason: "Task was cancelled - remove and re-add label to restart",
          taskId: existingTask.id,
        });
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
        model = "claude-sonnet-4-5-20250929";
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
      const needsPlanning = isPrdTicket || isV2Pipeline || isMultiProvider;
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
      task.taskNotes = `DEPLOYMENT_RUN: PR #${prNumber} approved by ${approvedBy}. Deploy and merge.`;
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
      const description = issue.description || "";

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
        res.json({ status: "ignored", reason: "Task cancelled" });
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

      let model = org.defaultWorkerModel || "claude-sonnet-4-5-20250929";
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
      const skipManagerReview = !labels.includes("review");
      const managerEnabled = labels.includes("manager");

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
        res.json({ status: "ignored", reason: "Task cancelled" });
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

      let model = org.defaultWorkerModel || "claude-sonnet-4-5-20250929";
      if (labels.includes("opus")) model = "claude-opus-4-6";
      else if (labels.includes("sonnet")) model = "claude-sonnet-4-5-20250929";
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
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);
      const token = req.headers["x-gitlab-token"] as string;
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "gitlab", req.body);

      const verification = await verifyWebhookBySlug(orgSlug, "gitlab", rawBody, token as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      if (req.body.object_kind !== "merge_request") {
        res.json({ status: "ignored", reason: "Not a merge request event" });
        return;
      }

      const { object_attributes: mr, project, user } = req.body;
      const mrIid = mr?.iid;
      const mrState = mr?.state;
      const mrAction = mr?.action;
      const mrUrl = mr?.url;

      // Idempotency
      if (deliveryId && await isDuplicateWebhook(deliveryId, "gitlab", org.id, `merge_request.${mrAction}`)) {
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
          logger.warn("Failed to unblock dependent tasks", { taskId: task.id });
        }
        res.json({ status: "processed", message: "Checked dependent tasks" });
        return;
      }

      if (mrAction === "approved") {
        const approvedBy = user?.username || user?.name;
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          task.status = "pr_approved";
          await taskRepo.save(task);
          res.json({ status: "processed", taskId: task.id, newStatus: "pr_approved" });
          return;
        }

        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: MR !${mrIid} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;
        await taskRepo.save(task);
        res.json({ status: "processed", taskId: task.id, newStatus: "queued" });
        return;
      }

      res.json({ status: "ignored", reason: `Unhandled MR action: ${mrAction}` });
    } catch (error) {
      logger.error("Error processing multi-tenant GitLab webhook", { error });
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
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody?.toString() || JSON.stringify(req.body);
      const signature = req.headers["x-hub-signature"] as string;
      const eventKey = req.headers["x-event-key"] as string;
      const deliveryId = getDeliveryIdFromHeaders(req.headers, "bitbucket");

      const verification = await verifyWebhookBySlug(orgSlug, "bitbucket", rawBody, signature as string | undefined);
      if (!verification.success) {
        res.status(verification.statusCode || 401).json({ error: verification.error });
        return;
      }

      const { org } = verification.context!;

      if (!eventKey?.startsWith("pullrequest:")) {
        res.json({ status: "ignored", reason: "Not a pull request event" });
        return;
      }

      const { pullrequest: pr, repository, approval, actor } = req.body;
      const prId = pr?.id;
      const prState = pr?.state;
      const repoFullName = repository?.full_name;
      const prUrl = pr?.links?.html?.href;

      // Idempotency
      if (deliveryId && await isDuplicateWebhook(deliveryId, "bitbucket", org.id, eventKey)) {
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
          .andWhere("task.githubRepo = :repoFullName", { repoFullName })
          .andWhere("task.orgId = :orgId", { orgId: org.id })
          .getOne();
      }

      if (!task) {
        res.json({ status: "ignored", reason: "No matching task" });
        return;
      }

      if (eventKey === "pullrequest:fulfilled" || prState === "MERGED") {
        try {
          await checkAndUnblockDependentTasks(task);
        } catch (error) {
          logger.warn("Failed to unblock dependent tasks", { taskId: task.id });
        }
        res.json({ status: "processed", message: "Checked dependent tasks" });
        return;
      }

      if (eventKey === "pullrequest:approved") {
        const approvedBy = approval?.user?.display_name || actor?.display_name || actor?.nickname;
        task.githubApprovedBy = approvedBy || null;

        if (task.skipManagerReview === false) {
          task.status = "pr_approved";
          await taskRepo.save(task);
          res.json({ status: "processed", taskId: task.id, newStatus: "pr_approved" });
          return;
        }

        task.status = "queued";
        task.taskNotes = `DEPLOYMENT_RUN: PR #${prId} approved by ${approvedBy}. Deploy and merge.`;
        task.completedAt = null;
        task.ecsTaskArn = null;
        task.ecsTaskId = null;
        task.startedAt = null;
        await taskRepo.save(task);
        res.json({ status: "processed", taskId: task.id, newStatus: "queued" });
        return;
      }

      res.json({ status: "ignored", reason: `Unhandled PR event: ${eventKey}` });
    } catch (error) {
      logger.error("Error processing multi-tenant BitBucket webhook", { error });
      res.status(500).json({ error: "Failed to process webhook" });
    }
  }
);

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
  body("ticketId").isUUID().withMessage("ticketId must be a valid UUID"),
  body("ticketKey").isString().notEmpty().withMessage("ticketKey is required"),
  body("subject").isString().notEmpty().withMessage("subject is required"),
  body("description").isString().withMessage("description must be a string"),
  body("category").isString().withMessage("category must be a string"),
  body("priority").isString().withMessage("priority must be a string"),
  body("orgId").isUUID().withMessage("orgId must be a valid UUID"),
  body("createdBy").isUUID().withMessage("createdBy must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { ticketId, ticketKey, subject, description, category, priority, orgId, createdBy } = req.body;

      // Check if support agent is enabled
      if (!config.supportAgent.enabled) {
        logger.info("Support agent disabled, skipping auto-response", { ticketKey });
        res.json({ status: "skipped", reason: "Support agent disabled" });
        return;
      }

      // Check if category is in auto-response list
      if (!config.supportAgent.autoResponseCategories.includes(category)) {
        logger.info("Category not in auto-response list", { ticketKey, category });
        res.json({ status: "skipped", reason: `Category '${category}' not configured for auto-response` });
        return;
      }

      // Check if priority requires immediate escalation
      if (config.supportAgent.escalationPriorities.includes(priority)) {
        logger.info("Priority requires escalation, skipping auto-response", { ticketKey, priority });
        res.json({ status: "skipped", reason: `Priority '${priority}' requires human escalation` });
        return;
      }

      // Get the organization to verify it exists
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: orgId } });

      if (!org) {
        logger.error("Organization not found for support ticket", { orgId, ticketKey });
        res.status(404).json({ error: "Organization not found" });
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
        logger.info("Support task already exists for ticket", { ticketKey, taskId: existingTask.id });
        res.json({ status: "exists", taskId: existingTask.id });
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
      await logTaskCreated(auditContext, task.id, ticketKey, "support_agent");

      res.status(202).json({
        status: "created",
        taskId: task.id,
        ticketKey,
        message: "Support agent task queued for processing",
      });
    } catch (error) {
      logger.error("Error creating support agent task", { error });
      res.status(500).json({ error: "Failed to create support agent task" });
    }
  }
);

// =============================================================================
// GitHub Actions Runner Webhook
// =============================================================================
// Receives workflow_job events from GitHub and spawns ephemeral ECS runners.
// Configure in GitHub repo Settings > Webhooks:
//   URL: https://workermill.com/api/webhooks/github-runner
//   Events: Workflow jobs
// =============================================================================

router.post("/github-runner", async (req: Request, res: Response) => {
  try {
    // Verify GitHub webhook signature
    const signature = req.headers["x-hub-signature-256"] as string;
    const webhookSecret = process.env.GITHUB_RUNNER_WEBHOOK_SECRET;

    if (webhookSecret) {
      if (!signature) {
        logger.warn("GitHub runner webhook missing signature");
        return res.status(401).json({ error: "Missing signature" });
      }

      const body = JSON.stringify(req.body);
      const expected = "sha256=" + crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        logger.warn("GitHub runner webhook invalid signature");
        return res.status(401).json({ error: "Invalid signature" });
      }
    } else {
      logger.warn("GITHUB_RUNNER_WEBHOOK_SECRET not configured - webhook signature verification disabled");
    }

    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    // Only handle workflow_job events
    if (event !== "workflow_job") {
      logger.debug("Ignoring non-workflow_job event", { event });
      return res.status(200).json({ status: "ignored", reason: "not workflow_job" });
    }

    const action = payload.action;
    const job = payload.workflow_job;
    const labels = job?.labels || [];

    logger.info("GitHub runner webhook received", { action, labels, jobId: job?.id });

    // Only start runner for queued jobs with self-hosted label
    if (action !== "queued") {
      return res.status(200).json({ status: "ignored", reason: `action is ${action}` });
    }

    if (!labels.includes("self-hosted")) {
      return res.status(200).json({ status: "ignored", reason: "not self-hosted" });
    }

    // Get registration token from GitHub API
    const githubToken = config.secrets.githubToken;
    if (!githubToken) {
      logger.error("GitHub token not configured");
      return res.status(500).json({ error: "GitHub token not configured" });
    }

    const repo = payload.repository;
    const owner = repo?.owner?.login || "jarodtowner";
    const repoName = repo?.name || "workermill";

    const tokenResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/runners/registration-token`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      logger.error("Failed to get runner registration token", { status: tokenResponse.status, error });
      return res.status(500).json({ error: "Failed to get registration token" });
    }

    const tokenData = (await tokenResponse.json()) as { token?: string };
    const runnerToken = tokenData.token;

    if (!runnerToken) {
      logger.error("No token in GitHub response", { tokenData });
      return res.status(500).json({ error: "No token in response" });
    }

    // Start ECS task
    const runner = getECSTaskRunner();
    const result = await runner.runGitHubRunnerTask(runnerToken);

    logger.info("GitHub runner started", { taskArn: result.taskArn, jobId: job?.id });

    res.status(200).json({
      status: "started",
      taskId: result.taskId,
      taskArn: result.taskArn,
    });
  } catch (error) {
    logger.error("Error handling GitHub runner webhook", { error });
    res.status(500).json({ error: "Failed to start runner" });
  }
});

export default router;
