import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../../db/connection.js";
import {
  WorkerTask,
  Organization,
  User,
  WebhookEndpoint,
} from "../../models/index.js";
import {
  verifyWebhookBySlug,
  getSignatureFromHeaders,
  getDeliveryIdFromHeaders,
} from "../../services/webhook.js";
import { inferPersonaFromJiraIssue } from "../../services/persona-inference.js";
import { logger } from "../../utils/logger.js";
import { extractTextFromADF } from "../../utils/jira.js";
import { trackLegacyWebhookUsage } from "../../services/legacy-webhook-alert.js";
import { syncIssueRelationships } from "../../services/task-relationship-sync.js";
import {
  body,
  header,
  validateRequest,
} from "../../middleware/validation.js";
import {
  normalizeRepoWithOwner,
  isDuplicateWebhook,
  verifyJiraSignature,
} from "./helpers.js";

const router = Router();

/**
 * POST /api/webhooks/jira
 * Handle Jira webhook events
 */
router.post(
  "/jira",
  // Validate webhook payload structure
  body("webhookEvent")
    .optional()
    .isString()
    .withMessage("webhookEvent must be a string"),
  body("issue")
    .optional()
    .isObject()
    .withMessage("issue must be an object"),
  body("issue.key")
    .optional()
    .isString()
    .withMessage("issue.key must be a string"),
  body("issue.id")
    .optional()
    .isString()
    .withMessage("issue.id must be a string"),
  body("issue.fields")
    .optional()
    .isObject()
    .withMessage("issue.fields must be an object"),
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

    // Fire-and-forget: sync issue relationships (blocks/depends_on) from Jira
    syncIssueRelationships(task, org, "jira", issueKey);

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

      // Fire-and-forget: sync issue relationships (blocks/depends_on) from Jira
      syncIssueRelationships(task, org, "jira", issueKey);

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
