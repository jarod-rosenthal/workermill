import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { Organization, PLAN_MAX_WORKERS, PLAN_MAX_EXPERTS, PLAN_FEATURES, type OrganizationPlan } from "../../models/index.js";
import { RemoteAgent } from "../../models/RemoteAgent.js";
import { requireAdmin } from "../../middleware/auth.js";
import { body, validateRequest } from "../../middleware/validation.js";
import { logger } from "../../utils/logger.js";
import { invalidateOrgCredentialsCache, getOrgCredentials } from "../../services/org-credentials.js";
import {
  getAvailableModels,
  isValidModelId,
  inferProviderFromModelId,
} from "./helpers.js";

const router = Router();

/**
 * GET /api/settings
 * Get all organization settings
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    // Check remote agent status for this org
    const agentRepo = AppDataSource.getRepository(RemoteAgent);
    const agents = await agentRepo.find({ where: { orgId: org.id }, order: { lastHeartbeatAt: "DESC" } });
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const onlineAgent = agents.find(a => a.lastHeartbeatAt > twoMinutesAgo);
    const hasRemoteAgent = agents.length > 0;
    const remoteAgentOnline = !!onlineAgent;
    const remoteAgentHostname = onlineAgent?.hostname || agents[0]?.hostname || null;

    // Resolve planning API key — only return actual key for API key auth (agents),
    // return boolean for JWT auth (dashboard) to prevent leaking keys to all org members
    let planningApiKey: string | undefined;
    let hasPlanningApiKey = false;
    const planProvider = org.planningAgentProvider || "anthropic";
    const isApiKeyAuth = !req.user; // API key auth doesn't set req.user (only req.organization)
    if (planProvider !== "anthropic") { // Anthropic uses OAuth, doesn't need API key
      try {
        const orgCreds = await getOrgCredentials(org.id);
        if (planProvider === "openai") {
          hasPlanningApiKey = !!orgCreds.openaiApiKey;
          if (isApiKeyAuth) planningApiKey = orgCreds.openaiApiKey;
        } else if (planProvider === "google") {
          hasPlanningApiKey = !!orgCreds.googleApiKey;
          if (isApiKeyAuth) planningApiKey = orgCreds.googleApiKey;
        }
      } catch { /* credentials not configured */ }
    }

    res.json({
      // Organization Identity
      slug: org.slug,
      name: org.name,
      apiKeyPrefix: org.apiKeyPrefix || null,

      // Data Management
      logRetentionDays: org.logRetentionDays,
      taskRetentionDays: org.taskRetentionDays,

      // Worker Settings
      maxConcurrentWorkers: org.maxConcurrentWorkers,
      maxParallelExperts: org.maxParallelExperts,
      defaultMaxRetries: org.defaultMaxRetries,
      taskCooldownSeconds: org.taskCooldownSeconds,
      defaultWorkerModel: org.defaultWorkerModel,
      defaultWorkerPersona: org.defaultWorkerPersona,

      // Intent Engineering
      aiGuidelines: org.aiGuidelines ?? null,

      // Warm Container Pool Settings
      warmPoolSize: org.warmPoolSize,
      warmPoolHoursStart: org.warmPoolHoursStart,
      warmPoolHoursEnd: org.warmPoolHoursEnd,
      warmPoolTimezone: org.warmPoolTimezone,

      // AI Provider Settings
      primaryProvider: org.primaryProvider || "anthropic",
      providerRouting: org.providerRouting || {},
      ollamaBaseUrl: org.ollamaBaseUrl || null,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || null,

      // Ralph Execution Settings
      useRalphExecution: org.useRalphExecution,
      ralphMaxStories: org.ralphMaxStories || 10,

      // Cost Settings
      costAlertThresholdUsd: org.costAlertThresholdUsd,

      // Budget Limits (AI FinOps)
      dailyBudgetLimitUsd: org.dailyBudgetLimitUsd,
      weeklyBudgetLimitUsd: org.weeklyBudgetLimitUsd,
      monthlyBudgetLimitUsd: org.monthlyBudgetLimitUsd,
      perTaskCostCeilingUsd: org.perTaskCostCeilingUsd,

      // Display Settings
      completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
      intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,
      dryRunVisibilityMinutes: org.dryRunVisibilityMinutes,

      // Tech Lead Settings
      managerProvider: org.managerProvider,
      managerModelId: org.managerModelId || "",
      maxReviewRevisions: org.maxReviewRevisions,
      maxPerStoryRevisions: org.maxPerStoryRevisions,

      // Planning Agent Settings (Project Manager)
      planningAgentProvider: org.planningAgentProvider || "anthropic",
      planningAgentModel: org.planningAgentModel || "",
      planningMode: org.planningMode || "strict",
      prdPlanningMode: org.prdPlanningMode || org.planningMode || "simplified",
      criticApprovalThreshold: org.criticApprovalThreshold,
      maxTargetFiles: org.maxTargetFiles,
      storyCalibrationMultiplier: org.storyCalibrationMultiplier,
      hasPlanningApiKey,

      // Email Settings
      emailFromAddress: org.emailFromAddress,
      emailNotificationsEnabled: org.emailNotificationsEnabled,
      emailLogRetentionDays: org.emailLogRetentionDays,
      defaultEmailPreferences: org.defaultEmailPreferences,

      // SCM Provider Settings
      scmProvider: org.scmProvider || "github",
      scmBaseUrl: org.scmBaseUrl || null,

      // Issue Tracker Provider Settings
      issueTrackerProvider: org.issueTrackerProvider,

      // Auto-Workflow Settings
      autoReviewEnabled: org.autoReviewEnabled,
      autoDeployEnabled: org.autoDeployEnabled,
      autoImproveEnabled: org.autoImproveEnabled,
      autoSkillExtraction: org.autoSkillExtraction,
      prdAutoRun: org.prdAutoRun,

      // Remote Agent Mode
      remoteAgentOnly: org.remoteAgentOnly,
      hasRemoteAgent,
      remoteAgentOnline,
      remoteAgentHostname,

      // Quality Gate Settings
      qualityGateEnabled: org.qualityGateEnabled,
      minQualityScore: org.minQualityScore,
      minTestCoveragePercent: org.minTestCoveragePercent,
      maxSecurityHighVulns: org.maxSecurityHighVulns,
      blockOnTypeErrors: org.blockOnTypeErrors,
      blockOnTestFailures: org.blockOnTestFailures,
      blockOnLintErrors: org.blockOnLintErrors,
      blockOnE2EFailures: org.blockOnE2EFailures,

      // External Quality Tool Integrations
      sonarqubeUrl: org.sonarqubeUrl || null,
      sonarqubeToken: org.sonarqubeToken ? "***" : null, // Mask token in response
      coderabbitEnabled: org.coderabbitEnabled,
      coderabbitApiKey: org.coderabbitApiKey ? "***" : null, // Mask API key in response
      deepsourceEnabled: org.deepsourceEnabled,
      deepsourceToken: org.deepsourceToken ? "***" : null, // Mask token in response
      qualityWebhookUrl: org.qualityWebhookUrl || null,
      qualityWebhookSecret: org.qualityWebhookSecret ? "***" : null, // Mask secret in response

      // Auto-Fix Settings
      autoFixEnabled: org.autoFixEnabled,
      autoFixMaxIterations: org.autoFixMaxIterations,
      autoFixStats: org.autoFixStats || {},

      // System Settings (read-only for reference)
      systemEnabled: org.systemEnabled,
      orchestratorRunning: org.orchestratorRunning,
      managerEnabled: org.managerEnabled,

      // Resilience Settings
      blockerMaxAutoRetries: org.blockerMaxAutoRetries,
      blockerAutoRetryEnabled: org.blockerAutoRetryEnabled,
      maxFixRetries: org.maxFixRetries,
      maxAgentTurns: org.maxAgentTurns,
      blockerWaitTimeoutMinutes: org.blockerWaitTimeoutMinutes,
      pushAfterCommit: org.pushAfterCommit,
      gracefulShutdownEnabled: org.gracefulShutdownEnabled,
      selfReviewEnabled: org.selfReviewEnabled,

      // Repository List
      repositories: org.repositories || [],

      // Default repos per SCM provider (used by agent /api/repos endpoint)
      defaultGithubRepo: org.defaultGithubRepo ?? null,
      defaultBitbucketRepo: org.defaultBitbucketRepo ?? null,
      defaultGitlabRepo: org.defaultGitlabRepo ?? null,

      // Codebase RAG Settings
      codebaseIndexingEnabled: org.codebaseIndexingEnabled,
      codebaseMaxFilesPerRepo: org.codebaseMaxFilesPerRepo,
      codebaseMaxFileSizeKb: org.codebaseMaxFileSizeKb,
      codebaseExcludePatterns: org.codebaseExcludePatterns,
      codebaseIncludeLanguages: org.codebaseIncludeLanguages,
      codebaseAutoIndexOnTask: org.codebaseAutoIndexOnTask,
      codebaseMaxRetrievalChunks: org.codebaseMaxRetrievalChunks,

      // Spec Engineering Settings
      specMinQualityScore: org.specMinQualityScore,
      specRequiredSections: org.specRequiredSections,
    });
  } catch (error) {
    logger.error("Error getting settings", { error });
    res.status(500).json({ error: "Failed to get settings" });
  }
});

/**
 * PUT /api/settings
 * Update organization settings
 */
router.put("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const orgRepo = AppDataSource.getRepository(Organization);

    // Debug: log incoming request body
    logger.info("Settings update request", { body: req.body });

    const {
      // Data Management
      logRetentionDays,
      taskRetentionDays,

      // Worker Settings
      maxConcurrentWorkers,
      maxParallelExperts,
      defaultMaxRetries,
      taskCooldownSeconds,
      defaultWorkerModel,
      defaultWorkerPersona,

      // Intent Engineering
      aiGuidelines,

      // Warm Container Pool Settings
      warmPoolSize,
      warmPoolHoursStart,
      warmPoolHoursEnd,
      warmPoolTimezone,

      // AI Provider Settings
      primaryProvider,
      providerRouting,
      ollamaBaseUrl,
      ollamaContextWindow,
      vllmBaseUrl,

      // Ralph Execution Settings
      useRalphExecution,
      ralphMaxStories,

      // Tech Lead Settings
      managerProvider,
      managerModelId,
      maxReviewRevisions,
      maxPerStoryRevisions,

      // Planning Agent Settings (Project Manager)
      planningAgentProvider,
      planningAgentModel,
      planningMode,
      prdPlanningMode,
      criticApprovalThreshold,
      maxTargetFiles,
      storyCalibrationMultiplier,

      // Cost Settings
      costAlertThresholdUsd,

      // Budget Limits (AI FinOps)
      dailyBudgetLimitUsd,
      weeklyBudgetLimitUsd,
      monthlyBudgetLimitUsd,
      perTaskCostCeilingUsd,

      // Display Settings
      completedTaskDisplayMinutes,
      intermediateTaskDisplayMinutes,
      dryRunVisibilityMinutes,

      // Email Settings
      emailFromAddress,
      emailNotificationsEnabled,
      emailLogRetentionDays,
      defaultEmailPreferences,

      // SCM Provider Settings
      scmProvider,
      scmBaseUrl,

      // Issue Tracker Provider Settings
      issueTrackerProvider,

      // Auto-Workflow Settings
      autoReviewEnabled,
      autoDeployEnabled,
      autoImproveEnabled,
      autoSkillExtraction,
      prdAutoRun,
      remoteAgentOnly,

      // Quality Gate Settings
      qualityGateEnabled,
      minQualityScore,
      minTestCoveragePercent,
      maxSecurityHighVulns,
      blockOnTypeErrors,
      blockOnTestFailures,
      blockOnLintErrors,
      blockOnE2EFailures,

      // External Quality Tool Integrations
      sonarqubeUrl,
      sonarqubeToken,
      coderabbitEnabled,
      coderabbitApiKey,
      deepsourceEnabled,
      deepsourceToken,
      qualityWebhookUrl,
      qualityWebhookSecret,
      autoFixEnabled,
      autoFixMaxIterations,

      // Resilience Settings
      blockerMaxAutoRetries,
      blockerAutoRetryEnabled,
      maxFixRetries,
      maxAgentTurns,
      blockerWaitTimeoutMinutes,
      pushAfterCommit,
      gracefulShutdownEnabled,
      selfReviewEnabled,

      // Repository List
      repositories,

      // Codebase RAG Settings
      codebaseIndexingEnabled,
      codebaseMaxFilesPerRepo,
      codebaseMaxFileSizeKb,
      codebaseExcludePatterns,
      codebaseIncludeLanguages,
      codebaseAutoIndexOnTask,
      codebaseMaxRetrievalChunks,

      // Spec Engineering Settings
      specMinQualityScore,
      specRequiredSections,
    } = req.body;

    // Validate and update Data Management settings
    if (logRetentionDays !== undefined) {
      let days = parseInt(logRetentionDays, 10);
      if (isNaN(days) || (days !== -1 && (days < 1 || days > 90))) {
        res.status(400).json({ error: "logRetentionDays must be between 1 and 90 (or -1 for unlimited)" });
        return;
      }
      // Pro tier: silently clamp to 14 days (existing DB values may exceed limit)
      if (org.plan === "pro" && days > 14) {
        days = 14;
      }
      org.logRetentionDays = days;
    }

    if (taskRetentionDays !== undefined) {
      let days = parseInt(taskRetentionDays, 10);
      if (isNaN(days) || (days !== -1 && (days < 1 || days > 90))) {
        res.status(400).json({ error: "taskRetentionDays must be between 1 and 90 (or -1 for unlimited)" });
        return;
      }
      // Pro tier: silently clamp to 14 days (existing DB values may exceed limit)
      if (org.plan === "pro" && days > 14) {
        days = 14;
      }
      org.taskRetentionDays = days;
    }

    // Validate and update Worker Settings
    if (maxConcurrentWorkers !== undefined) {
      let max = parseInt(maxConcurrentWorkers, 10);
      if (isNaN(max) || max < 1 || max > 14) {
        res.status(400).json({ error: "maxConcurrentWorkers must be between 1 and 14" });
        return;
      }
      const planLimit = PLAN_MAX_WORKERS[org.plan as OrganizationPlan] ?? 1;
      // Silently clamp to plan limit (existing DB values may exceed limit)
      if (planLimit !== -1 && max > planLimit) {
        max = planLimit;
      }
      org.maxConcurrentWorkers = max;
    }

    if (maxParallelExperts !== undefined) {
      const max = parseInt(maxParallelExperts, 10);
      if (isNaN(max) || max < 1 || max > 14) {
        res.status(400).json({ error: "maxParallelExperts must be between 1 and 16" });
        return;
      }
      const planLimit = PLAN_MAX_EXPERTS[org.plan as OrganizationPlan] ?? 3;
      if (planLimit !== -1 && max > planLimit) {
        res.status(403).json({
          error: `Max parallel experts is limited to ${planLimit} on your ${org.plan} plan. Upgrade for more.`,
        });
        return;
      }
      org.maxParallelExperts = max;
    }

    // Validate and update Warm Container Pool Settings (Max+ only)
    const planFeatures = PLAN_FEATURES[org.plan as OrganizationPlan] ?? PLAN_FEATURES.pro;
    if (warmPoolSize !== undefined) {
      const size = parseInt(warmPoolSize, 10);
      if (isNaN(size) || size < 0 || size > 5) {
        res.status(400).json({ error: "warmPoolSize must be between 0 and 5" });
        return;
      }
      if (size > 0 && !planFeatures.warmPool) {
        res.status(403).json({ error: "Warm container pool requires Pro plan or higher." });
        return;
      }
      org.warmPoolSize = size;
    }

    if (warmPoolHoursStart !== undefined) {
      const hour = parseInt(warmPoolHoursStart, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        res.status(400).json({ error: "warmPoolHoursStart must be between 0 and 23" });
        return;
      }
      org.warmPoolHoursStart = hour;
    }

    if (warmPoolHoursEnd !== undefined) {
      const hour = parseInt(warmPoolHoursEnd, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        res.status(400).json({ error: "warmPoolHoursEnd must be between 0 and 23" });
        return;
      }
      org.warmPoolHoursEnd = hour;
    }

    if (warmPoolTimezone !== undefined) {
      // Validate timezone by trying to use it
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: warmPoolTimezone });
        org.warmPoolTimezone = warmPoolTimezone;
      } catch {
        res.status(400).json({ error: "Invalid warmPoolTimezone. Use IANA timezone format (e.g., America/New_York)" });
        return;
      }
    }

    if (defaultMaxRetries !== undefined) {
      const retries = parseInt(defaultMaxRetries, 10);
      if (isNaN(retries) || retries < 0 || retries > 5) {
        res.status(400).json({ error: "defaultMaxRetries must be between 0 and 5" });
        return;
      }
      org.defaultMaxRetries = retries;
    }

    if (taskCooldownSeconds !== undefined) {
      const cooldown = parseInt(taskCooldownSeconds, 10);
      if (isNaN(cooldown) || cooldown < 0 || cooldown > 86400) {
        res.status(400).json({ error: "taskCooldownSeconds must be between 0 and 86400 (24 hours)" });
        return;
      }
      org.taskCooldownSeconds = cooldown;
    }

    if (defaultWorkerModel !== undefined) {
      // Use dynamic model discovery for validation
      const { models: availableModels } = await getAvailableModels(org);

      if (!isValidModelId(defaultWorkerModel, availableModels)) {
        res.status(400).json({
          error: "Invalid defaultWorkerModel",
          hint: "Use GET /api/settings/models to see available models",
        });
        return;
      }
      org.defaultWorkerModel = defaultWorkerModel;

      // Auto-correct primaryProvider if it doesn't match the model
      const inferredProvider = inferProviderFromModelId(defaultWorkerModel);
      if (inferredProvider && inferredProvider !== org.primaryProvider && inferredProvider !== "ollama") {
        logger.info("Auto-correcting primaryProvider to match defaultWorkerModel", {
          orgId: org.id,
          model: defaultWorkerModel,
          oldProvider: org.primaryProvider,
          newProvider: inferredProvider,
        });
        org.primaryProvider = inferredProvider;
      }
    }

    if (defaultWorkerPersona !== undefined) {
      const validPersonas = [
        "auto",
        "architect",
        "backend_developer",
        "frontend_developer",
        "devops_engineer",
        "security_engineer",
        "qa_engineer",
        "tech_writer",
        "project_manager",
        "tech_lead",
        "data_ml_engineer",
        "mobile_developer",
        "manager",
        "support_agent",
      ];
      if (!validPersonas.includes(defaultWorkerPersona)) {
        res.status(400).json({ error: "Invalid defaultWorkerPersona" });
        return;
      }
      org.defaultWorkerPersona = defaultWorkerPersona;
    }

    // Intent Engineering
    if (aiGuidelines !== undefined) {
      org.aiGuidelines = aiGuidelines === "" ? null : String(aiGuidelines);
    }

    // Validate and update AI Provider Settings
    if (primaryProvider !== undefined) {
      const validProviders = ["anthropic", "openai", "google", "ollama", "openrouter", "groq", "deepseek", "mistral", "xai", "bedrock", "azure"];
      if (!validProviders.includes(primaryProvider)) {
        res.status(400).json({ error: "Invalid primaryProvider. Must be one of: anthropic, openai, google, ollama, openrouter, groq, deepseek, mistral, xai, bedrock, azure" });
        return;
      }
      if (!planFeatures.multiProvider && primaryProvider !== "anthropic") {
        res.status(403).json({ error: "Pro plan only supports Anthropic Claude. Upgrade to Max for all AI providers." });
        return;
      }
      org.primaryProvider = primaryProvider;
    }

    // Validate and update Provider Routing (Pro+ only — requires multiProvider)
    if (providerRouting !== undefined) {
      if (!planFeatures.multiProvider && providerRouting && Object.keys(providerRouting).length > 0) {
        res.status(403).json({ error: "Provider routing requires Pro plan or higher." });
        return;
      }
      if (typeof providerRouting !== "object" || providerRouting === null) {
        res.status(400).json({ error: "providerRouting must be an object" });
        return;
      }
      const validProviders = ["anthropic", "openai", "google", "ollama", "openrouter", "groq", "deepseek", "mistral", "xai", "bedrock", "azure"];
      const validPersonas = [
        "architect",
        "backend_developer",
        "frontend_developer",
        "devops_engineer",
        "security_engineer",
        "qa_engineer",
        "tech_writer",
        "project_manager",
        "tech_lead",
        "data_ml_engineer",
        "mobile_developer",
        "manager",
        "support_agent",
      ];
      for (const [persona, config] of Object.entries(providerRouting)) {
        if (!validPersonas.includes(persona)) {
          res.status(400).json({ error: `Invalid persona in providerRouting: ${persona}` });
          return;
        }
        const routeConfig = config as { provider?: string; model?: string };
        if (!routeConfig.provider || !validProviders.includes(routeConfig.provider)) {
          res.status(400).json({ error: `Invalid provider for persona ${persona}` });
          return;
        }
      }
      org.providerRouting = providerRouting;
    }

    // Validate and update Ollama Base URL
    if (ollamaBaseUrl !== undefined) {
      if (ollamaBaseUrl === null || ollamaBaseUrl === "") {
        org.ollamaBaseUrl = null;
      } else {
        // Basic URL validation
        try {
          new URL(ollamaBaseUrl);
          org.ollamaBaseUrl = ollamaBaseUrl;
        } catch {
          res.status(400).json({ error: "Invalid ollamaBaseUrl. Must be a valid URL." });
          return;
        }
      }
    }

    // Validate and update Ollama Context Window
    if (ollamaContextWindow !== undefined) {
      const ctxWindow = parseInt(ollamaContextWindow, 10);
      if (isNaN(ctxWindow) || ctxWindow < 2048 || ctxWindow > 262144) {
        res.status(400).json({ error: "ollamaContextWindow must be between 2048 and 262144 tokens" });
        return;
      }
      org.ollamaContextWindow = ctxWindow;
    }

    // Validate and update vLLM Base URL (GPU inference endpoint)
    if (vllmBaseUrl !== undefined) {
      if (vllmBaseUrl === null || vllmBaseUrl === "") {
        org.vllmBaseUrl = null;
      } else {
        // Basic URL validation
        try {
          new URL(vllmBaseUrl);
          org.vllmBaseUrl = vllmBaseUrl;
        } catch {
          res.status(400).json({ error: "Invalid vllmBaseUrl. Must be a valid URL." });
          return;
        }
      }
    }

    // Validate and update Ralph Execution Settings
    if (useRalphExecution !== undefined) {
      org.useRalphExecution = Boolean(useRalphExecution);
    }

    if (ralphMaxStories !== undefined) {
      const maxStories = parseInt(ralphMaxStories, 10);
      if (isNaN(maxStories) || maxStories < 1 || maxStories > 50) {
        res.status(400).json({ error: "ralphMaxStories must be between 1 and 50" });
        return;
      }
      org.ralphMaxStories = maxStories;
    }

    // Validate and update Virtual Manager Settings
    if (managerProvider !== undefined) {
      const validProviders = ["anthropic", "openai", "google", "ollama", "openrouter", "groq", "deepseek", "mistral", "xai", "bedrock", "azure"];
      if (!validProviders.includes(managerProvider)) {
        res.status(400).json({ error: "Invalid managerProvider. Must be one of: anthropic, openai, google, ollama, openrouter, groq, deepseek, mistral, xai, bedrock, azure" });
        return;
      }
      if (org.plan === "pro" && managerProvider !== "anthropic") {
        res.status(403).json({ error: "Pro plan Tech Lead is restricted to Anthropic. Upgrade to Max for all providers." });
        return;
      }
      org.managerProvider = managerProvider;
    }

    if (managerModelId !== undefined) {
      // Use dynamic model discovery for validation (same pool as worker models)
      const { models: availableModels } = await getAvailableModels(org);

      if (!isValidModelId(managerModelId, availableModels)) {
        res.status(400).json({
          error: "Invalid managerModelId",
          hint: "Use GET /api/settings/models to see available models",
        });
        return;
      }
      org.managerModelId = managerModelId;

      // Auto-correct provider if it doesn't match the model
      const inferredProvider = inferProviderFromModelId(managerModelId);
      if (inferredProvider && inferredProvider !== org.managerProvider) {
        logger.info("Auto-correcting managerProvider to match model", {
          orgId: org.id,
          model: managerModelId,
          oldProvider: org.managerProvider,
          newProvider: inferredProvider,
        });
        org.managerProvider = inferredProvider;
      }
    }

    if (maxReviewRevisions !== undefined) {
      const value = Number(maxReviewRevisions);
      // 0 = tech lead review disabled
      if (isNaN(value) || value < 0 || value > 10) {
        res.status(400).json({ error: "maxReviewRevisions must be between 0 and 10" });
        return;
      }
      org.maxReviewRevisions = value;
    }

    if (maxPerStoryRevisions !== undefined) {
      const value = Number(maxPerStoryRevisions);
      if (isNaN(value) || value < 0 || value > 10) {
        res.status(400).json({ error: "maxPerStoryRevisions must be between 0 and 10" });
        return;
      }
      org.maxPerStoryRevisions = value;
    }

    // Validate and update Planning Agent Settings (Project Manager)
    if (planningAgentProvider !== undefined) {
      const validProviders = ["anthropic", "openai", "google", "ollama", "openrouter", "groq", "deepseek", "mistral", "xai", "bedrock", "azure"];
      if (!validProviders.includes(planningAgentProvider)) {
        res.status(400).json({ error: "Invalid planningAgentProvider. Must be one of: anthropic, openai, google, ollama, openrouter, groq, deepseek, mistral, xai, bedrock, azure" });
        return;
      }
      if (org.plan === "pro" && planningAgentProvider !== "anthropic") {
        res.status(403).json({ error: "Pro plan Planning Agent is restricted to Anthropic. Upgrade to Max for all providers." });
        return;
      }
      org.planningAgentProvider = planningAgentProvider;
    }

    if (planningAgentModel !== undefined) {
      const { models: availableModels } = await getAvailableModels(org);

      if (!isValidModelId(planningAgentModel, availableModels)) {
        res.status(400).json({
          error: "Invalid planningAgentModel",
          hint: "Use GET /api/settings/models to see available models",
        });
        return;
      }
      org.planningAgentModel = planningAgentModel;

      // Auto-correct provider if it doesn't match the model
      const inferredProvider = inferProviderFromModelId(planningAgentModel);
      if (inferredProvider && inferredProvider !== org.planningAgentProvider) {
        logger.info("Auto-correcting planningAgentProvider to match model", {
          orgId: org.id,
          model: planningAgentModel,
          oldProvider: org.planningAgentProvider,
          newProvider: inferredProvider,
        });
        org.planningAgentProvider = inferredProvider;
      }
    }

    if (planningMode !== undefined) {
      const validModes = ["strict", "simplified"];
      if (!validModes.includes(planningMode)) {
        res.status(400).json({ error: "planningMode must be 'strict' or 'simplified'" });
        return;
      }
      if (org.plan === "pro" && planningMode !== "simplified") {
        res.status(403).json({ error: "Pro plan only supports Simplified planning mode. Upgrade to Max for more planning modes." });
        return;
      }
      org.planningMode = planningMode;
    }

    if (prdPlanningMode !== undefined) {
      // Accept decomposer_planned for backwards compat but treat as simplified
      const normalized = prdPlanningMode === "decomposer_planned" ? "simplified" : prdPlanningMode;
      const validModes = ["strict", "simplified"];
      if (!validModes.includes(normalized)) {
        res.status(400).json({ error: "prdPlanningMode must be 'strict' or 'simplified'" });
        return;
      }
      if (org.plan === "pro" && normalized !== "simplified") {
        res.status(403).json({ error: "Pro plan only supports Simplified planning mode. Upgrade to Max for more planning modes." });
        return;
      }
      org.prdPlanningMode = normalized;
    }

    if (criticApprovalThreshold !== undefined) {
      const val = parseInt(criticApprovalThreshold, 10);
      if (isNaN(val) || val < 50 || val > 100) {
        res.status(400).json({ error: "criticApprovalThreshold must be between 50 and 100" });
        return;
      }
      org.criticApprovalThreshold = val;
    }

    if (maxTargetFiles !== undefined) {
      const val = parseInt(maxTargetFiles, 10);
      if (isNaN(val) || val < 3 || val > 50) {
        res.status(400).json({ error: "maxTargetFiles must be between 3 and 50" });
        return;
      }
      org.maxTargetFiles = val;
    }

    if (storyCalibrationMultiplier !== undefined) {
      const multiplier = parseFloat(storyCalibrationMultiplier);
      if (isNaN(multiplier) || multiplier < 0.1 || multiplier > 2.0) {
        res.status(400).json({ error: "storyCalibrationMultiplier must be between 0.1 and 2.0" });
        return;
      }
      org.storyCalibrationMultiplier = multiplier;
    }

    // Validate and update Cost Settings
    if (costAlertThresholdUsd !== undefined) {
      if (costAlertThresholdUsd === null || costAlertThresholdUsd === "") {
        org.costAlertThresholdUsd = null;
      } else {
        const threshold = parseFloat(costAlertThresholdUsd);
        if (isNaN(threshold) || threshold < 0 || threshold > 100000) {
          res.status(400).json({ error: "costAlertThresholdUsd must be between 0 and 100000" });
          return;
        }
        org.costAlertThresholdUsd = threshold;
      }
    }

    // Validate and update Budget Limits (AI FinOps)
    if (dailyBudgetLimitUsd !== undefined) {
      if (dailyBudgetLimitUsd === null || dailyBudgetLimitUsd === "") {
        org.dailyBudgetLimitUsd = null;
      } else {
        const limit = parseFloat(dailyBudgetLimitUsd);
        if (isNaN(limit) || limit < 0 || limit > 100000) {
          res.status(400).json({ error: "dailyBudgetLimitUsd must be between 0 and 100000" });
          return;
        }
        org.dailyBudgetLimitUsd = limit;
      }
    }

    if (weeklyBudgetLimitUsd !== undefined) {
      if (weeklyBudgetLimitUsd === null || weeklyBudgetLimitUsd === "") {
        org.weeklyBudgetLimitUsd = null;
      } else {
        const limit = parseFloat(weeklyBudgetLimitUsd);
        if (isNaN(limit) || limit < 0 || limit > 100000) {
          res.status(400).json({ error: "weeklyBudgetLimitUsd must be between 0 and 100000" });
          return;
        }
        org.weeklyBudgetLimitUsd = limit;
      }
    }

    if (monthlyBudgetLimitUsd !== undefined) {
      if (monthlyBudgetLimitUsd === null || monthlyBudgetLimitUsd === "") {
        org.monthlyBudgetLimitUsd = null;
      } else {
        const limit = parseFloat(monthlyBudgetLimitUsd);
        if (isNaN(limit) || limit < 0 || limit > 100000) {
          res.status(400).json({ error: "monthlyBudgetLimitUsd must be between 0 and 100000" });
          return;
        }
        org.monthlyBudgetLimitUsd = limit;
      }
    }

    if (perTaskCostCeilingUsd !== undefined) {
      if (perTaskCostCeilingUsd === null || perTaskCostCeilingUsd === "") {
        org.perTaskCostCeilingUsd = null;
      } else {
        const ceiling = parseFloat(perTaskCostCeilingUsd);
        if (isNaN(ceiling) || ceiling < 0 || ceiling > 10000) {
          res.status(400).json({ error: "perTaskCostCeilingUsd must be between 0 and 10000" });
          return;
        }
        org.perTaskCostCeilingUsd = ceiling;
      }
    }

    // Validate and update Display Settings
    if (completedTaskDisplayMinutes !== undefined) {
      const minutes = parseInt(completedTaskDisplayMinutes, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 60) {
        res.status(400).json({ error: "completedTaskDisplayMinutes must be between 1 and 60" });
        return;
      }
      org.completedTaskDisplayMinutes = minutes;
    }

    if (intermediateTaskDisplayMinutes !== undefined) {
      const minutes = parseInt(intermediateTaskDisplayMinutes, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        res.status(400).json({ error: "intermediateTaskDisplayMinutes must be between 1 and 1440 (24 hours)" });
        return;
      }
      org.intermediateTaskDisplayMinutes = minutes;
    }

    if (dryRunVisibilityMinutes !== undefined) {
      const minutes = parseInt(dryRunVisibilityMinutes, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 60) {
        res.status(400).json({ error: "dryRunVisibilityMinutes must be between 1 and 60" });
        return;
      }
      org.dryRunVisibilityMinutes = minutes;
    }

    // Validate and update Email Settings
    if (emailFromAddress !== undefined) {
      if (emailFromAddress === null || emailFromAddress === "") {
        org.emailFromAddress = null;
      } else {
        // Basic email validation
        const emailRegex = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
        if (!emailRegex.test(emailFromAddress)) {
          res.status(400).json({ error: "emailFromAddress must be a valid email address" });
          return;
        }
        org.emailFromAddress = emailFromAddress;
      }
    }

    if (emailNotificationsEnabled !== undefined) {
      org.emailNotificationsEnabled = Boolean(emailNotificationsEnabled);
    }

    if (emailLogRetentionDays !== undefined) {
      const days = parseInt(emailLogRetentionDays, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        res.status(400).json({ error: "emailLogRetentionDays must be between 1 and 365" });
        return;
      }
      org.emailLogRetentionDays = days;
    }

    if (defaultEmailPreferences !== undefined) {
      if (typeof defaultEmailPreferences !== "object" || defaultEmailPreferences === null) {
        res.status(400).json({ error: "defaultEmailPreferences must be an object" });
        return;
      }
      const validKeys = ["taskCompleted", "taskFailed", "costAlerts", "prCreated", "frequency"];
      const invalidKeys = Object.keys(defaultEmailPreferences).filter((k) => !validKeys.includes(k));
      if (invalidKeys.length > 0) {
        res.status(400).json({ error: `Invalid keys in defaultEmailPreferences: ${invalidKeys.join(", ")}` });
        return;
      }
      org.defaultEmailPreferences = defaultEmailPreferences;
    }

    // Validate and update SCM Provider settings
    if (scmProvider !== undefined) {
      const validProviders = ["github", "gitlab", "bitbucket"];
      if (!validProviders.includes(scmProvider)) {
        res.status(400).json({ error: "scmProvider must be: github, gitlab, or bitbucket" });
        return;
      }
      org.scmProvider = scmProvider;
    }

    if (scmBaseUrl !== undefined) {
      if (scmBaseUrl === null || scmBaseUrl === "") {
        org.scmBaseUrl = null;
      } else {
        // Basic URL validation
        try {
          new URL(scmBaseUrl);
          org.scmBaseUrl = scmBaseUrl;
        } catch {
          res.status(400).json({ error: "scmBaseUrl must be a valid URL" });
          return;
        }
      }
    }

    // Validate and update Issue Tracker Provider settings
    if (issueTrackerProvider !== undefined) {
      const validTrackers = ["jira", "linear", "github-issues", "internal"];
      if (!validTrackers.includes(issueTrackerProvider)) {
        res.status(400).json({ error: "issueTrackerProvider must be: jira, linear, github-issues, or internal" });
        return;
      }
      org.issueTrackerProvider = issueTrackerProvider;
    }

    // Validate and update Auto-Workflow Settings
    if (autoReviewEnabled !== undefined) {
      org.autoReviewEnabled = Boolean(autoReviewEnabled);
    }

    if (autoDeployEnabled !== undefined) {
      org.autoDeployEnabled = Boolean(autoDeployEnabled);
    }

    if (autoImproveEnabled !== undefined) {
      org.autoImproveEnabled = Boolean(autoImproveEnabled);
    }

    if (autoSkillExtraction !== undefined) {
      if (org.plan === "pro" && Boolean(autoSkillExtraction)) {
        res.status(403).json({ error: "Memory & Learning requires Max plan or higher." });
        return;
      }
      org.autoSkillExtraction = Boolean(autoSkillExtraction);
    }

    if (prdAutoRun !== undefined) {
      org.prdAutoRun = Boolean(prdAutoRun);
    }

    if (remoteAgentOnly !== undefined) {
      if (!planFeatures.cloudExecution && Boolean(remoteAgentOnly)) {
        res.status(403).json({ error: "Remote agent mode requires Pro plan or higher." });
        return;
      }
      org.remoteAgentOnly = Boolean(remoteAgentOnly);
    }

    // Validate and update Quality Gate Settings
    if (qualityGateEnabled !== undefined) {
      org.qualityGateEnabled = Boolean(qualityGateEnabled);
    }

    if (minQualityScore !== undefined) {
      if (minQualityScore === null) {
        org.minQualityScore = null;
      } else {
        const score = parseInt(minQualityScore, 10);
        if (isNaN(score) || score < 0 || score > 100) {
          res.status(400).json({ error: "minQualityScore must be between 0 and 100" });
          return;
        }
        org.minQualityScore = score;
      }
    }

    if (minTestCoveragePercent !== undefined) {
      if (minTestCoveragePercent === null) {
        org.minTestCoveragePercent = null;
      } else {
        const coverage = parseInt(minTestCoveragePercent, 10);
        if (isNaN(coverage) || coverage < 0 || coverage > 100) {
          res.status(400).json({ error: "minTestCoveragePercent must be between 0 and 100" });
          return;
        }
        org.minTestCoveragePercent = coverage;
      }
    }

    if (maxSecurityHighVulns !== undefined) {
      if (maxSecurityHighVulns === null) {
        org.maxSecurityHighVulns = null;
      } else {
        const vulns = parseInt(maxSecurityHighVulns, 10);
        if (isNaN(vulns) || vulns < 0) {
          res.status(400).json({ error: "maxSecurityHighVulns must be 0 or greater" });
          return;
        }
        org.maxSecurityHighVulns = vulns;
      }
    }

    if (blockOnTypeErrors !== undefined) {
      org.blockOnTypeErrors = Boolean(blockOnTypeErrors);
    }

    if (blockOnTestFailures !== undefined) {
      org.blockOnTestFailures = Boolean(blockOnTestFailures);
    }

    if (blockOnLintErrors !== undefined) {
      org.blockOnLintErrors = Boolean(blockOnLintErrors);
    }

    if (blockOnE2EFailures !== undefined) {
      org.blockOnE2EFailures = Boolean(blockOnE2EFailures);
    }

    // Validate and update External Quality Tool Integrations
    if (sonarqubeUrl !== undefined) {
      if (sonarqubeUrl === null || sonarqubeUrl === "") {
        org.sonarqubeUrl = null;
      } else {
        // Basic URL validation
        try {
          new URL(sonarqubeUrl);
          org.sonarqubeUrl = sonarqubeUrl;
        } catch {
          res.status(400).json({ error: "sonarqubeUrl must be a valid URL" });
          return;
        }
      }
    }

    if (sonarqubeToken !== undefined) {
      // Allow clearing token with null/empty, or updating with new token
      // Don't update if token is the masked value "***"
      if (sonarqubeToken === null || sonarqubeToken === "") {
        org.sonarqubeToken = null;
      } else if (sonarqubeToken !== "***") {
        org.sonarqubeToken = sonarqubeToken;
      }
    }

    if (coderabbitEnabled !== undefined) {
      org.coderabbitEnabled = Boolean(coderabbitEnabled);
    }

    if (coderabbitApiKey !== undefined) {
      // Allow clearing key with null/empty, or updating with new key
      // Don't update if key is the masked value "***"
      if (coderabbitApiKey === null || coderabbitApiKey === "") {
        org.coderabbitApiKey = null;
      } else if (coderabbitApiKey !== "***") {
        org.coderabbitApiKey = coderabbitApiKey;
      }
    }

    if (deepsourceEnabled !== undefined) {
      org.deepsourceEnabled = Boolean(deepsourceEnabled);
    }

    if (deepsourceToken !== undefined) {
      // Allow clearing token with null/empty, or updating with new token
      // Don't update if token is the masked value "***"
      if (deepsourceToken === null || deepsourceToken === "") {
        org.deepsourceToken = null;
      } else if (deepsourceToken !== "***") {
        org.deepsourceToken = deepsourceToken;
      }
    }

    if (qualityWebhookUrl !== undefined) {
      if (qualityWebhookUrl === null || qualityWebhookUrl === "") {
        org.qualityWebhookUrl = null;
      } else {
        // Basic URL validation
        try {
          new URL(qualityWebhookUrl);
          org.qualityWebhookUrl = qualityWebhookUrl;
        } catch {
          res.status(400).json({ error: "qualityWebhookUrl must be a valid URL" });
          return;
        }
      }
    }

    if (qualityWebhookSecret !== undefined) {
      // Allow clearing secret with null/empty, or updating with new secret
      // Don't update if secret is the masked value "***"
      if (qualityWebhookSecret === null || qualityWebhookSecret === "") {
        org.qualityWebhookSecret = null;
      } else if (qualityWebhookSecret !== "***") {
        org.qualityWebhookSecret = qualityWebhookSecret;
      }
    }

    // Auto-Fix Settings
    if (autoFixEnabled !== undefined) {
      org.autoFixEnabled = autoFixEnabled === true;
    }

    if (autoFixMaxIterations !== undefined) {
      const maxIter = parseInt(autoFixMaxIterations, 10);
      if (isNaN(maxIter) || maxIter < 1 || maxIter > 10) {
        res.status(400).json({ error: "autoFixMaxIterations must be between 1 and 10" });
        return;
      }
      org.autoFixMaxIterations = maxIter;
    }

    // Resilience Settings
    if (blockerMaxAutoRetries !== undefined) {
      const maxRetries = parseInt(blockerMaxAutoRetries, 10);
      if (isNaN(maxRetries) || maxRetries < 0 || maxRetries > 10) {
        res.status(400).json({ error: "blockerMaxAutoRetries must be between 0 and 10" });
        return;
      }
      org.blockerMaxAutoRetries = maxRetries;
    }

    if (blockerAutoRetryEnabled !== undefined) {
      org.blockerAutoRetryEnabled = blockerAutoRetryEnabled === true;
    }

    if (maxFixRetries !== undefined) {
      const retries = parseInt(maxFixRetries, 10);
      if (isNaN(retries) || retries < 1 || retries > 10) {
        res.status(400).json({ error: "maxFixRetries must be between 1 and 10" });
        return;
      }
      org.maxFixRetries = retries;
    }

    if (maxAgentTurns !== undefined) {
      if (maxAgentTurns === null) {
        org.maxAgentTurns = null;
      } else {
        const turns = parseInt(maxAgentTurns, 10);
        if (isNaN(turns) || turns < 1) {
          res.status(400).json({ error: "maxAgentTurns must be a positive integer" });
          return;
        }
        org.maxAgentTurns = turns;
      }
    }

    if (blockerWaitTimeoutMinutes !== undefined) {
      const timeout = parseInt(blockerWaitTimeoutMinutes, 10);
      if (isNaN(timeout) || timeout < 1 || timeout > 120) {
        res.status(400).json({ error: "blockerWaitTimeoutMinutes must be between 1 and 120" });
        return;
      }
      org.blockerWaitTimeoutMinutes = timeout;
    }

    if (pushAfterCommit !== undefined) {
      org.pushAfterCommit = pushAfterCommit === true;
    }

    if (gracefulShutdownEnabled !== undefined) {
      org.gracefulShutdownEnabled = gracefulShutdownEnabled === true;
    }

    if (selfReviewEnabled !== undefined) {
      if (!planFeatures.memoryPersistence && selfReviewEnabled === true) {
        res.status(403).json({ error: "Self-review requires Pro plan or higher." });
        return;
      }
      org.selfReviewEnabled = selfReviewEnabled === true;
    }

    // Validate and update Repository List
    if (repositories !== undefined) {
      if (!Array.isArray(repositories)) {
        res.status(400).json({ error: "repositories must be an array of strings" });
        return;
      }
      if (repositories.length > 50) {
        res.status(400).json({ error: "repositories cannot exceed 50 entries" });
        return;
      }
      const repoPattern = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
      const invalid = repositories.filter((r: unknown) => typeof r !== "string" || !repoPattern.test(r as string));
      if (invalid.length > 0) {
        res.status(400).json({
          error: `Invalid repository format: ${invalid.join(", ")}. Use "owner/repo" format.`,
        });
        return;
      }
      // Deduplicate
      org.repositories = [...new Set(repositories as string[])];
    }

    // Validate and update Codebase RAG settings (Pro+ only)
    if (codebaseIndexingEnabled !== undefined) {
      if (org.plan === "pro" && codebaseIndexingEnabled === true) {
        res.status(403).json({ error: "Codebase RAG requires Max plan or higher." });
        return;
      }
      org.codebaseIndexingEnabled = codebaseIndexingEnabled === true;
    }
    if (codebaseMaxFilesPerRepo !== undefined) {
      const val = parseInt(codebaseMaxFilesPerRepo, 10);
      if (!isNaN(val) && val >= 100 && val <= 2000) {
        org.codebaseMaxFilesPerRepo = val;
      }
    }
    if (codebaseMaxFileSizeKb !== undefined) {
      const val = parseInt(codebaseMaxFileSizeKb, 10);
      if (!isNaN(val) && val >= 10 && val <= 500) {
        org.codebaseMaxFileSizeKb = val;
      }
    }
    if (codebaseExcludePatterns !== undefined && Array.isArray(codebaseExcludePatterns)) {
      org.codebaseExcludePatterns = codebaseExcludePatterns;
    }
    if (codebaseIncludeLanguages !== undefined && Array.isArray(codebaseIncludeLanguages)) {
      org.codebaseIncludeLanguages = codebaseIncludeLanguages;
    }
    if (codebaseAutoIndexOnTask !== undefined) {
      org.codebaseAutoIndexOnTask = codebaseAutoIndexOnTask === true;
    }
    if (codebaseMaxRetrievalChunks !== undefined) {
      const val = parseInt(codebaseMaxRetrievalChunks, 10);
      if (!isNaN(val) && val >= 1 && val <= 50) {
        org.codebaseMaxRetrievalChunks = val;
      }
    }

    // Validate and update Spec Engineering Settings
    if (specMinQualityScore !== undefined) {
      const score = parseInt(specMinQualityScore, 10);
      if (isNaN(score) || score < 0 || score > 100) {
        res.status(400).json({ error: "specMinQualityScore must be between 0 and 100" });
        return;
      }
      org.specMinQualityScore = score;
    }

    if (specRequiredSections !== undefined) {
      if (specRequiredSections === null) {
        org.specRequiredSections = null;
      } else {
        if (!Array.isArray(specRequiredSections)) {
          res.status(400).json({ error: "specRequiredSections must be an array of strings or null" });
          return;
        }
        const validSections = [
          "Overview",
          "Technical Specification",
          "Data Model",
          "File Structure",
          "API Specification",
          "Component Specification",
          "Quality Gates",
          "Acceptance Criteria",
          "Scope Boundary",
        ];
        const invalid = specRequiredSections.filter((s: unknown) => typeof s !== "string" || !validSections.includes(s as string));
        if (invalid.length > 0) {
          res.status(400).json({ error: `Invalid spec sections: ${invalid.join(", ")}` });
          return;
        }
        org.specRequiredSections = specRequiredSections.length > 0 ? specRequiredSections : null;
      }
    }

    await orgRepo.save(org);

    // Invalidate cached credentials so workers immediately pick up new settings
    // (e.g., managerProvider, managerModelId, providerRouting, scmProvider changes)
    invalidateOrgCredentialsCache(org.id);

    logger.info("Organization settings updated", {
      orgId: org.id,
      updatedFields: Object.keys(req.body),
    });

    res.json({
      success: true,
      message: "Settings updated successfully",
      settings: {
        logRetentionDays: org.logRetentionDays,
        taskRetentionDays: org.taskRetentionDays,
        maxConcurrentWorkers: org.maxConcurrentWorkers,
        maxParallelExperts: org.maxParallelExperts,
        defaultMaxRetries: org.defaultMaxRetries,
        taskCooldownSeconds: org.taskCooldownSeconds,
        defaultWorkerModel: org.defaultWorkerModel,
        defaultWorkerPersona: org.defaultWorkerPersona,
        primaryProvider: org.primaryProvider,
        providerRouting: org.providerRouting,
        ollamaBaseUrl: org.ollamaBaseUrl,
        ollamaContextWindow: org.ollamaContextWindow,
        vllmBaseUrl: org.vllmBaseUrl,
        useRalphExecution: org.useRalphExecution,
        ralphMaxStories: org.ralphMaxStories,
        managerProvider: org.managerProvider,
        managerModelId: org.managerModelId,
        maxReviewRevisions: org.maxReviewRevisions,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
        planningAgentProvider: org.planningAgentProvider,
        planningAgentModel: org.planningAgentModel,
        planningMode: org.planningMode,
        prdPlanningMode: org.prdPlanningMode,
        criticApprovalThreshold: org.criticApprovalThreshold,
        maxTargetFiles: org.maxTargetFiles,
        storyCalibrationMultiplier: org.storyCalibrationMultiplier,
        costAlertThresholdUsd: org.costAlertThresholdUsd,
        dailyBudgetLimitUsd: org.dailyBudgetLimitUsd,
        weeklyBudgetLimitUsd: org.weeklyBudgetLimitUsd,
        monthlyBudgetLimitUsd: org.monthlyBudgetLimitUsd,
        perTaskCostCeilingUsd: org.perTaskCostCeilingUsd,
        completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
        intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,
        dryRunVisibilityMinutes: org.dryRunVisibilityMinutes,
        emailFromAddress: org.emailFromAddress,
        emailNotificationsEnabled: org.emailNotificationsEnabled,
        emailLogRetentionDays: org.emailLogRetentionDays,
        defaultEmailPreferences: org.defaultEmailPreferences,
        scmProvider: org.scmProvider,
        scmBaseUrl: org.scmBaseUrl,
        issueTrackerProvider: org.issueTrackerProvider,
        autoReviewEnabled: org.autoReviewEnabled,
        autoDeployEnabled: org.autoDeployEnabled,
        autoImproveEnabled: org.autoImproveEnabled,
        autoSkillExtraction: org.autoSkillExtraction,
        prdAutoRun: org.prdAutoRun,
        remoteAgentOnly: org.remoteAgentOnly,
        qualityGateEnabled: org.qualityGateEnabled,
        minQualityScore: org.minQualityScore,
        minTestCoveragePercent: org.minTestCoveragePercent,
        maxSecurityHighVulns: org.maxSecurityHighVulns,
        blockOnTypeErrors: org.blockOnTypeErrors,
        blockOnTestFailures: org.blockOnTestFailures,
        blockOnLintErrors: org.blockOnLintErrors,
        blockOnE2EFailures: org.blockOnE2EFailures,
        sonarqubeUrl: org.sonarqubeUrl || null,
        sonarqubeToken: org.sonarqubeToken ? "***" : null,
        coderabbitEnabled: org.coderabbitEnabled,
        coderabbitApiKey: org.coderabbitApiKey ? "***" : null,
        deepsourceEnabled: org.deepsourceEnabled,
        deepsourceToken: org.deepsourceToken ? "***" : null,
        qualityWebhookUrl: org.qualityWebhookUrl || null,
        qualityWebhookSecret: org.qualityWebhookSecret ? "***" : null,
        autoFixEnabled: org.autoFixEnabled,
        autoFixMaxIterations: org.autoFixMaxIterations,
        autoFixStats: org.autoFixStats || {},
        // Resilience Settings
        blockerMaxAutoRetries: org.blockerMaxAutoRetries,
        blockerAutoRetryEnabled: org.blockerAutoRetryEnabled,
        maxFixRetries: org.maxFixRetries,
        maxAgentTurns: org.maxAgentTurns,
        blockerWaitTimeoutMinutes: org.blockerWaitTimeoutMinutes,
        pushAfterCommit: org.pushAfterCommit,
        gracefulShutdownEnabled: org.gracefulShutdownEnabled,
        selfReviewEnabled: org.selfReviewEnabled,
        // Repository List
        repositories: org.repositories || [],
        // Codebase RAG Settings
        codebaseIndexingEnabled: org.codebaseIndexingEnabled,
        codebaseMaxFilesPerRepo: org.codebaseMaxFilesPerRepo,
        codebaseMaxFileSizeKb: org.codebaseMaxFileSizeKb,
        codebaseExcludePatterns: org.codebaseExcludePatterns,
        codebaseIncludeLanguages: org.codebaseIncludeLanguages,
        codebaseAutoIndexOnTask: org.codebaseAutoIndexOnTask,
        codebaseMaxRetrievalChunks: org.codebaseMaxRetrievalChunks,
        // Spec Engineering Settings
        specMinQualityScore: org.specMinQualityScore,
        specRequiredSections: org.specRequiredSections,
      },
    });
  } catch (error) {
    logger.error("Error updating settings", { error });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

/**
 * POST /api/settings/test-email
 * Send a test email to the current user
 */
router.post("/test-email", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    // Import the email service
    const { sendTestEmail } = await import("../../services/email/index.js");

    const success = await sendTestEmail(user, org);

    if (success) {
      logger.info("Test email sent successfully", {
        userId: user.id,
        email: user.email,
        orgId: org.id,
      });
      res.json({ success: true, message: `Test email sent to ${user.email}` });
    } else {
      res.status(500).json({ success: false, error: "Failed to send test email" });
    }
  } catch (error) {
    logger.error("Error sending test email", { error });
    res.status(500).json({ success: false, error: "Failed to send test email" });
  }
});

/**
 * POST /api/settings/test-welcome-email
 * Send a test welcome email to the current user (for testing the welcome email template)
 */
router.post("/test-welcome-email", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    const { sendWelcomeEmail } = await import("../../services/email/index.js");

    // Send welcome email (joinedViaInvite = false for testing)
    const success = await sendWelcomeEmail(user, org, false);

    if (success) {
      logger.info("Test welcome email sent successfully", {
        userId: user.id,
        orgId: org.id,
        email: user.email,
      });
      res.json({ success: true, message: `Welcome email sent to ${user.email}` });
    } else {
      res.status(500).json({ success: false, error: "Failed to send welcome email" });
    }
  } catch (error) {
    logger.error("Error sending test welcome email", { error });
    res.status(500).json({ success: false, error: "Failed to send welcome email" });
  }
});

/**
 * PATCH /api/settings/slug
 * Update the organization's slug (URL-safe identifier)
 */
router.patch(
  "/slug",
  body("slug")
    .isString()
    .isLength({ min: 3, max: 100 })
    .matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .withMessage("Slug must be 3-100 characters, lowercase alphanumeric with hyphens, not starting/ending with hyphen"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { slug } = req.body;

      const orgRepo = AppDataSource.getRepository(Organization);

      // Check for conflicts
      const existing = await orgRepo.findOne({ where: { slug } });
      if (existing && existing.id !== org.id) {
        res.status(409).json({ error: "Slug already in use by another organization" });
        return;
      }

      const oldSlug = org.slug;
      org.slug = slug;
      await orgRepo.save(org);

      logger.info("Updated organization slug", {
        orgId: org.id,
        oldSlug,
        newSlug: slug,
      });

      res.json({
        message: "Organization slug updated",
        slug,
        warning: oldSlug
          ? "Webhook URLs have changed. Update your integrations with the new URLs."
          : null,
      });
    } catch (error) {
      logger.error("Error updating organization slug", { error });
      res.status(500).json({ error: "Failed to update organization slug" });
    }
  }
);

export default router;
