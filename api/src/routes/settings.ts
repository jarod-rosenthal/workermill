import { Router, Request, Response } from "express";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { authenticateUser, authenticateRequest, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import {
  config,
  hasProviderCredentials,
  clearProviderCredentialsCache,
} from "../config/index.js";
import {
  listProviders,
  getProvider,
  hasProvider,
} from "../providers/index.js";
import { isValidProviderId, type ProviderId } from "../providers/types.js";
import { body, param, validateRequest } from "../middleware/validation.js";
import {
  getOrCreateExternalId,
  getAwsRoleConfig,
  saveAwsRoleConfig,
  isValidAwsRoleArn,
  extractAccountIdFromArn,
  type AwsRoleConfig,
} from "../services/external-id.js";

const router = Router();

// Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// All routes require authentication (supports both JWT and API key)
router.use(authenticateRequest);

/**
 * GET /api/settings
 * Get all organization settings
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    res.json({
      // Data Management
      logRetentionDays: org.logRetentionDays,
      taskRetentionDays: org.taskRetentionDays,

      // Worker Settings
      maxConcurrentWorkers: org.maxConcurrentWorkers,
      defaultMaxRetries: org.defaultMaxRetries,
      taskCooldownSeconds: org.taskCooldownSeconds,
      defaultWorkerModel: org.defaultWorkerModel,
      defaultWorkerPersona: org.defaultWorkerPersona,

      // AI Provider Settings
      primaryProvider: org.primaryProvider || "anthropic",
      providerRouting: org.providerRouting || {},
      ollamaBaseUrl: org.ollamaBaseUrl || null,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || null,

      // Ralph Execution Settings
      useRalphExecution: org.useRalphExecution || false,
      ralphMaxStories: org.ralphMaxStories || 10,

      // Cost Settings
      costAlertThresholdUsd: org.costAlertThresholdUsd,

      // Display Settings
      completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
      intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,
      dryRunVisibilityMinutes: org.dryRunVisibilityMinutes,

      // Virtual Manager Settings
      managerProvider: org.managerProvider || "openai",
      managerModelId: org.managerModelId || "gpt-5.1-codex",

      // Planning Agent Settings (Project Manager)
      planningAgentProvider: org.planningAgentProvider || "anthropic",
      planningAgentModel: org.planningAgentModel || "claude-sonnet-4-5-20250929",
      storyCalibrationMultiplier: org.storyCalibrationMultiplier ?? 0.4,

      // Email Settings
      emailFromAddress: org.emailFromAddress,
      emailNotificationsEnabled: org.emailNotificationsEnabled,
      emailLogRetentionDays: org.emailLogRetentionDays,
      defaultEmailPreferences: org.defaultEmailPreferences,

      // SCM Provider Settings
      scmProvider: org.scmProvider || "github",
      scmBaseUrl: org.scmBaseUrl || null,

      // System Settings (read-only for reference)
      systemEnabled: org.systemEnabled,
      orchestratorRunning: org.orchestratorRunning,
      managerEnabled: org.managerEnabled,
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
      defaultMaxRetries,
      taskCooldownSeconds,
      defaultWorkerModel,
      defaultWorkerPersona,

      // AI Provider Settings
      primaryProvider,
      providerRouting,
      ollamaBaseUrl,
      ollamaContextWindow,
      vllmBaseUrl,

      // Ralph Execution Settings
      useRalphExecution,
      ralphMaxStories,

      // Virtual Manager Settings
      managerProvider,
      managerModelId,

      // Planning Agent Settings (Project Manager)
      planningAgentProvider,
      planningAgentModel,
      storyCalibrationMultiplier,

      // Cost Settings
      costAlertThresholdUsd,

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
    } = req.body;

    // Validate and update Data Management settings
    if (logRetentionDays !== undefined) {
      const days = parseInt(logRetentionDays, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        res.status(400).json({ error: "logRetentionDays must be between 1 and 365" });
        return;
      }
      org.logRetentionDays = days;
    }

    if (taskRetentionDays !== undefined) {
      const days = parseInt(taskRetentionDays, 10);
      if (isNaN(days) || days < 1 || days > 730) {
        res.status(400).json({ error: "taskRetentionDays must be between 1 and 730" });
        return;
      }
      org.taskRetentionDays = days;
    }

    // Validate and update Worker Settings
    if (maxConcurrentWorkers !== undefined) {
      const max = parseInt(maxConcurrentWorkers, 10);
      if (isNaN(max) || max < 1 || max > 10) {
        res.status(400).json({ error: "maxConcurrentWorkers must be between 1 and 10" });
        return;
      }
      org.maxConcurrentWorkers = max;
    }

    if (defaultMaxRetries !== undefined) {
      const retries = parseInt(defaultMaxRetries, 10);
      if (isNaN(retries) || retries < 0 || retries > 10) {
        res.status(400).json({ error: "defaultMaxRetries must be between 0 and 10" });
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
    }

    if (defaultWorkerPersona !== undefined) {
      const validPersonas = [
        "frontend_developer",
        "backend_developer",
        "devops_engineer",
        "security_engineer",
        "qa_engineer",
        "tech_writer",
        "project_manager",
      ];
      if (!validPersonas.includes(defaultWorkerPersona)) {
        res.status(400).json({ error: "Invalid defaultWorkerPersona" });
        return;
      }
      org.defaultWorkerPersona = defaultWorkerPersona;
    }

    // Validate and update AI Provider Settings
    if (primaryProvider !== undefined) {
      const validProviders = ["anthropic", "openai", "google", "ollama"];
      if (!validProviders.includes(primaryProvider)) {
        res.status(400).json({ error: "Invalid primaryProvider. Must be: anthropic, openai, google, or ollama" });
        return;
      }
      org.primaryProvider = primaryProvider;
    }

    // Validate and update Provider Routing
    // Format: { "persona_name": { "provider": "ollama", "model": "qwen2.5-coder:32b" } }
    if (providerRouting !== undefined) {
      if (typeof providerRouting !== "object" || providerRouting === null) {
        res.status(400).json({ error: "providerRouting must be an object" });
        return;
      }
      const validProviders = ["anthropic", "openai", "google", "ollama"];
      const validPersonas = [
        "frontend_developer",
        "backend_developer",
        "devops_engineer",
        "security_engineer",
        "qa_engineer",
        "tech_writer",
        "project_manager",
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
      const validProviders = ["anthropic", "openai", "google", "ollama"];
      if (!validProviders.includes(managerProvider)) {
        res.status(400).json({ error: "Invalid managerProvider. Must be: anthropic, openai, google, or ollama" });
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
    }

    // Validate and update Planning Agent Settings (Project Manager)
    if (planningAgentProvider !== undefined) {
      const validProviders = ["anthropic", "openai", "google"];
      if (!validProviders.includes(planningAgentProvider)) {
        res.status(400).json({ error: "Invalid planningAgentProvider. Must be: anthropic, openai, or google" });
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
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

    await orgRepo.save(org);

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
        planningAgentProvider: org.planningAgentProvider,
        planningAgentModel: org.planningAgentModel,
        storyCalibrationMultiplier: org.storyCalibrationMultiplier,
        costAlertThresholdUsd: org.costAlertThresholdUsd,
        completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
        intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,
        dryRunVisibilityMinutes: org.dryRunVisibilityMinutes,
        emailFromAddress: org.emailFromAddress,
        emailNotificationsEnabled: org.emailNotificationsEnabled,
        emailLogRetentionDays: org.emailLogRetentionDays,
        defaultEmailPreferences: org.defaultEmailPreferences,
        scmProvider: org.scmProvider,
        scmBaseUrl: org.scmBaseUrl,
      },
    });
  } catch (error) {
    logger.error("Error updating settings", { error });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

/**
 * Helper to get secret with org-specific fallback to platform-wide
 */
async function getSecretWithFallback(
  orgId: string,
  secretName: string,
  secretPrefix: string
): Promise<string | null> {
  // Try org-specific first
  try {
    const orgSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/orgs/${orgId}/${secretName}`,
      })
    );
    if (orgSecret.SecretString) return orgSecret.SecretString;
  } catch {
    // Not found at org level, try platform level
  }

  // Fall back to platform-wide
  try {
    const platformSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/${secretName}`,
      })
    );
    return platformSecret.SecretString || null;
  } catch {
    return null;
  }
}

/**
 * Helper to save secret to org-specific path
 */
async function saveOrgSecret(
  orgId: string,
  secretName: string,
  secretValue: string,
  secretPrefix: string,
  description: string
): Promise<void> {
  const secretPath = `${secretPrefix}/orgs/${orgId}/${secretName}`;

  try {
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretPath,
        SecretString: secretValue,
      })
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretPath,
          SecretString: secretValue,
          Description: description,
        })
      );
    } else {
      throw error;
    }
  }
}

/**
 * GET /api/settings/integrations
 * Get integration status (whether credentials are configured)
 */
router.get("/integrations", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Check if secrets exist (without exposing values)
    let jiraConfigured = false;
    let githubConfigured = false;
    let linearConfigured = false;
    let jiraBaseUrl = "";
    let jiraEmail = "";  // Not sensitive - can be returned
    let githubDefaultRepo = org.defaultGithubRepo || "";

    // Check Jira (org-specific with fallback)
    const jiraSecret = await getSecretWithFallback(org.id, "jira-credentials", secretPrefix);
    if (jiraSecret) {
      try {
        const jiraCreds = JSON.parse(jiraSecret);
        jiraConfigured = !!(jiraCreds.api_token && jiraCreds.email);
        jiraBaseUrl = jiraCreds.base_url || jiraCreds.domain || "";
        jiraEmail = jiraCreds.email || "";
      } catch {
        logger.debug("Failed to parse Jira credentials");
      }
    }

    // Check GitHub (org-specific with fallback)
    const githubSecret = await getSecretWithFallback(org.id, "github-token", secretPrefix);
    githubConfigured = !!githubSecret;

    // Check GitHub reviewer token (separate token for PR approvals)
    // Check org-specific and platform-wide github-reviewer-token, plus legacy manager-github-token
    let githubReviewerConfigured = false;
    const githubReviewerSecret = await getSecretWithFallback(org.id, "github-reviewer-token", secretPrefix);
    if (githubReviewerSecret) {
      githubReviewerConfigured = true;
    } else {
      // Check legacy manager-github-token path
      try {
        const legacySecret = await secretsClient.send(
          new GetSecretValueCommand({
            SecretId: `${secretPrefix}/manager-github-token`,
          })
        );
        githubReviewerConfigured = !!legacySecret.SecretString;
      } catch {
        // Not found
      }
    }

    // Check Linear (org-specific with fallback)
    const linearSecret = await getSecretWithFallback(org.id, "linear-credentials", secretPrefix);
    if (linearSecret) {
      try {
        const linearCreds = JSON.parse(linearSecret);
        linearConfigured = !!(linearCreds.api_key || linearCreds.webhook_secret);
      } catch {
        logger.debug("Failed to parse Linear credentials");
      }
    }

    // Check Teams webhook
    const teamsSecret = await getSecretWithFallback(org.id, "teams-webhook", secretPrefix);
    const teamsConfigured = !!teamsSecret;

    // Check Slack webhook
    const slackSecret = await getSecretWithFallback(org.id, "slack-webhook", secretPrefix);
    const slackConfigured = !!slackSecret;

    // Check OnCallShift credentials
    let oncallshiftConfigured = false;
    const oncallshiftSecret = await getSecretWithFallback(org.id, "oncallshift-credentials", secretPrefix);
    if (oncallshiftSecret) {
      try {
        const oncallshiftCreds = JSON.parse(oncallshiftSecret);
        oncallshiftConfigured = !!oncallshiftCreds.api_key;
      } catch {
        logger.debug("Failed to parse OnCallShift credentials");
      }
    }

    // Check AWS credentials (legacy static credentials)
    let awsConfigured = false;
    const awsSecret = await getSecretWithFallback(org.id, "aws-credentials", secretPrefix);
    if (awsSecret) {
      try {
        const awsCreds = JSON.parse(awsSecret);
        awsConfigured = !!(awsCreds.access_key_id && awsCreds.secret_access_key);
      } catch {
        logger.debug("Failed to parse AWS credentials");
      }
    }

    // Check AWS cross-account role config (secure role assumption)
    let awsRoleConfigured = false;
    let awsRoleArn = "";
    let awsExternalId = "";
    try {
      const roleConfig = await getAwsRoleConfig(org.id);
      if (roleConfig && roleConfig.roleArn) {
        awsRoleConfigured = true;
        awsRoleArn = roleConfig.roleArn;
        awsExternalId = roleConfig.externalId;
      } else {
        // Generate external ID even if role not configured yet
        awsExternalId = await getOrCreateExternalId(org.id);
      }
    } catch {
      logger.debug("Failed to get AWS role config");
    }

    // Check GCP credentials
    let gcpConfigured = false;
    const gcpSecret = await getSecretWithFallback(org.id, "gcp-credentials", secretPrefix);
    if (gcpSecret) {
      try {
        const gcpCreds = JSON.parse(gcpSecret);
        gcpConfigured = !!(gcpCreds.project_id && gcpCreds.service_account);
      } catch {
        logger.debug("Failed to parse GCP credentials");
      }
    }

    // Check Azure credentials
    let azureConfigured = false;
    const azureSecret = await getSecretWithFallback(org.id, "azure-credentials", secretPrefix);
    if (azureSecret) {
      try {
        const azureCreds = JSON.parse(azureSecret);
        azureConfigured = !!(azureCreds.client_id && azureCreds.client_secret && azureCreds.tenant_id);
      } catch {
        logger.debug("Failed to parse Azure credentials");
      }
    }

    res.json({
      jira: {
        configured: jiraConfigured,
        baseUrl: jiraBaseUrl,
        email: jiraEmail,
        webhookSecretConfigured: !!org.jiraWebhookSecret,
      },
      github: {
        configured: githubConfigured,
        defaultRepo: githubDefaultRepo,
        webhookSecretConfigured: !!org.githubWebhookSecret,
        reviewerTokenConfigured: githubReviewerConfigured,
      },
      linear: {
        configured: linearConfigured,
      },
      slack: {
        configured: slackConfigured,
      },
      teams: {
        configured: teamsConfigured,
      },
      oncallshift: {
        configured: oncallshiftConfigured,
      },
      aws: {
        configured: awsConfigured,
        roleConfigured: awsRoleConfigured,
        roleArn: awsRoleArn || null,
        externalId: awsExternalId || null,
      },
      gcp: {
        configured: gcpConfigured,
      },
      azure: {
        configured: azureConfigured,
      },
    });
  } catch (error) {
    logger.error("Error getting integration status", { error });
    res.status(500).json({ error: "Failed to get integration status" });
  }
});

/**
 * PUT /api/settings/integrations/jira
 * Save Jira credentials to Secrets Manager (org-specific)
 * Supports partial updates by merging with existing credentials
 */
router.put(
  "/integrations/jira",
  requireAdmin,
  body("baseUrl").optional().isURL().withMessage("baseUrl must be a valid URL"),
  body("email").optional().isEmail().withMessage("email must be a valid email address"),
  body("apiToken").optional().isString().withMessage("apiToken must be a string"),
  body("webhookSecret").optional().isString().withMessage("webhookSecret must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { baseUrl, email, apiToken, webhookSecret } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      // Require at least one field to update
      if (!baseUrl && !email && !apiToken && !webhookSecret) {
        res.status(400).json({ error: "At least one field is required" });
        return;
      }

      let credentialsUpdated = false;

      // Handle API credentials (merge with existing if partial update)
      if (baseUrl || email || apiToken) {
        // Fetch existing credentials to merge
        let existingCreds: { base_url?: string; email?: string; api_token?: string } = {};
        const existingSecret = await getSecretWithFallback(org.id, "jira-credentials", secretPrefix);
        if (existingSecret) {
          try {
            existingCreds = JSON.parse(existingSecret);
          } catch {
            // Ignore parse errors - start fresh
          }
        }

        // Merge new values with existing
        const mergedCreds = {
          base_url: baseUrl || existingCreds.base_url || "",
          email: email || existingCreds.email || "",
          api_token: apiToken || existingCreds.api_token || "",
        };

        // Only save if we have all required fields after merge
        if (mergedCreds.base_url && mergedCreds.email && mergedCreds.api_token) {
          const jiraCredentials = JSON.stringify(mergedCreds);

          await saveOrgSecret(
            org.id,
            "jira-credentials",
            jiraCredentials,
            secretPrefix,
            `Jira credentials for org ${org.id}`
          );
          logger.info("Jira API credentials updated", { orgId: org.id });
          credentialsUpdated = true;
        } else {
          // Return error if trying to save incomplete credentials
          const missing = [];
          if (!mergedCreds.base_url) missing.push("Base URL");
          if (!mergedCreds.email) missing.push("Email");
          if (!mergedCreds.api_token) missing.push("API Token");

          res.status(400).json({
            error: `Incomplete Jira credentials. Missing: ${missing.join(", ")}`,
            hint: "All three fields (Base URL, Email, API Token) are required for API access"
          });
          return;
        }
      }

      // Save webhook secret to organization table if provided
      if (webhookSecret) {
        const orgRepo = AppDataSource.getRepository(Organization);
        await orgRepo.update(org.id, { jiraWebhookSecret: webhookSecret });
        logger.info("Jira webhook secret updated", { orgId: org.id });
      }

      res.json({
        success: true,
        message: "Jira settings saved successfully",
        credentialsUpdated,
        webhookSecretUpdated: !!webhookSecret
      });
    } catch (error) {
      logger.error("Error saving Jira credentials", { error });
      res.status(500).json({ error: "Failed to save Jira credentials" });
    }
  }
);

/**
 * PUT /api/settings/integrations/github
 * Save GitHub token to Secrets Manager (org-specific) and/or default repo to org
 * Token is optional if only updating the default repo
 */
router.put(
  "/integrations/github",
  requireAdmin,
  body("token").optional().isString().withMessage("token must be a string"),
  body("reviewerToken").optional().isString().withMessage("reviewerToken must be a string"),
  body("defaultRepo").optional().isString().withMessage("defaultRepo must be a string"),
  body("webhookSecret").optional().isString().withMessage("webhookSecret must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { token, reviewerToken, defaultRepo, webhookSecret } = req.body;
      const org = req.organization!;

      // Require at least one field to update
      if (!token && !reviewerToken && defaultRepo === undefined && !webhookSecret) {
        res.status(400).json({ error: "At least one field is required" });
        return;
      }

      const secretPrefix = `workermill/${config.environment}`;

      // Save token to org-specific path in Secrets Manager if provided
      if (token) {
        await saveOrgSecret(
          org.id,
          "github-token",
          token,
          secretPrefix,
          `GitHub token for org ${org.id}`
        );
      }

      // Save reviewer token to org-specific path in Secrets Manager if provided
      // This separate token is used for PR approvals to avoid GitHub's self-approval restriction
      if (reviewerToken) {
        await saveOrgSecret(
          org.id,
          "github-reviewer-token",
          reviewerToken,
          secretPrefix,
          `GitHub reviewer token for org ${org.id} (PR approvals)`
        );
      }

      // Save default repo and/or webhook secret to organization if provided
      if (defaultRepo !== undefined || webhookSecret) {
        const orgRepo = AppDataSource.getRepository(Organization);
        if (defaultRepo !== undefined) {
          org.defaultGithubRepo = defaultRepo;
        }
        if (webhookSecret) {
          org.githubWebhookSecret = webhookSecret;
        }
        await orgRepo.save(org);
      }

      logger.info("GitHub settings updated", {
        orgId: org.id,
        tokenUpdated: !!token,
        reviewerTokenUpdated: !!reviewerToken,
        repoUpdated: defaultRepo !== undefined,
        webhookSecretUpdated: !!webhookSecret,
      });

      res.json({ success: true, message: "GitHub settings saved successfully" });
    } catch (error) {
      logger.error("Error saving GitHub credentials", { error });
      res.status(500).json({ error: "Failed to save GitHub credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/jira/test
 * Test Jira connection (uses org-specific with fallback)
 */
router.post("/integrations/jira/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get Jira credentials (org-specific with fallback)
    const jiraSecretString = await getSecretWithFallback(org.id, "jira-credentials", secretPrefix);

    if (!jiraSecretString) {
      res.status(400).json({ error: "Jira credentials not configured" });
      return;
    }

    const jiraCreds = JSON.parse(jiraSecretString);
    const { base_url, email, api_token } = jiraCreds;

    if (!base_url || !email || !api_token) {
      res.status(400).json({ error: "Incomplete Jira credentials" });
      return;
    }

    // Test connection by fetching current user
    const authHeader = Buffer.from(`${email}:${api_token}`).toString("base64");
    const response = await fetch(`${base_url}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Jira connection test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `Jira connection failed: ${response.status}` });
      return;
    }

    const userData = await response.json() as { displayName?: string; emailAddress?: string };
    res.json({
      success: true,
      message: "Jira connection successful",
      user: userData.displayName || userData.emailAddress,
    });
  } catch (error) {
    logger.error("Error testing Jira connection", { error });
    res.status(500).json({ error: "Failed to test Jira connection" });
  }
});

/**
 * POST /api/settings/integrations/github/test
 * Test GitHub connection (uses org-specific with fallback)
 */
router.post("/integrations/github/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get GitHub token (org-specific with fallback)
    const githubToken = await getSecretWithFallback(org.id, "github-token", secretPrefix);

    if (!githubToken) {
      res.status(400).json({ error: "GitHub token not configured" });
      return;
    }

    // Test connection by fetching current user
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("GitHub connection test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `GitHub connection failed: ${response.status}` });
      return;
    }

    const userData = (await response.json()) as { login?: string };
    res.json({
      success: true,
      message: "GitHub connection successful",
      user: userData.login,
    });
  } catch (error) {
    logger.error("Error testing GitHub connection", { error });
    res.status(500).json({ error: "Failed to test GitHub connection" });
  }
});

/**
 * POST /api/settings/integrations/github/migrate-reviewer-token
 * Migrate the legacy manager-github-token to the new org-specific github-reviewer-token path.
 * This is a one-time migration utility for moving from the old platform-wide token to org-specific storage.
 */
router.post("/integrations/github/migrate-reviewer-token", requireAdmin, async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;
    const { cleanupLegacy } = req.body;

    // Check if org-specific token already exists
    const orgSpecificPath = `${secretPrefix}/orgs/${org.id}/github-reviewer-token`;
    let orgTokenExists = false;
    try {
      const existingOrgSecret = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: orgSpecificPath })
      );
      orgTokenExists = !!existingOrgSecret.SecretString;
    } catch {
      // Not found, will migrate
    }

    if (orgTokenExists) {
      res.json({
        success: true,
        migrated: false,
        message: "Org-specific reviewer token already exists, no migration needed",
        orgSpecificPath,
      });
      return;
    }

    // Try to get the legacy manager-github-token
    const legacyPath = `${secretPrefix}/manager-github-token`;
    let legacyToken: string | null = null;
    try {
      const legacySecret = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: legacyPath })
      );
      legacyToken = legacySecret.SecretString || null;
    } catch {
      // Not found
    }

    if (!legacyToken) {
      res.status(404).json({
        error: "No legacy manager-github-token found to migrate",
        legacyPath,
      });
      return;
    }

    // Save to org-specific path
    await saveOrgSecret(
      org.id,
      "github-reviewer-token",
      legacyToken,
      secretPrefix,
      `GitHub reviewer token for org ${org.id} (migrated from manager-github-token)`
    );

    logger.info("Migrated reviewer token to org-specific path", {
      orgId: org.id,
      from: legacyPath,
      to: orgSpecificPath,
    });

    // Optionally clean up the legacy secret
    let legacyDeleted = false;
    if (cleanupLegacy === true) {
      try {
        await secretsClient.send(
          new DeleteSecretCommand({
            SecretId: legacyPath,
            ForceDeleteWithoutRecovery: false, // Allow recovery for 30 days
          })
        );
        legacyDeleted = true;
        logger.info("Deleted legacy manager-github-token", { path: legacyPath });
      } catch (deleteError) {
        logger.warn("Failed to delete legacy secret", { path: legacyPath, error: deleteError });
      }
    }

    res.json({
      success: true,
      migrated: true,
      message: `Reviewer token migrated to org-specific path${legacyDeleted ? " and legacy secret scheduled for deletion" : ""}`,
      from: legacyPath,
      to: orgSpecificPath,
      legacyDeleted,
    });
  } catch (error) {
    logger.error("Error migrating reviewer token", { error });
    res.status(500).json({ error: "Failed to migrate reviewer token" });
  }
});

/**
 * PUT /api/settings/integrations/linear
 * Save Linear credentials to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/linear",
  requireAdmin,
  body("apiKey").optional().isString().withMessage("apiKey must be a string"),
  body("webhookSecret").optional().isString().withMessage("webhookSecret must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { apiKey, webhookSecret } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      // Require at least one field
      if (!apiKey && !webhookSecret) {
        res.status(400).json({ error: "At least one of apiKey or webhookSecret is required" });
        return;
      }

      // Get existing credentials to merge
      let existingCreds: { api_key?: string; webhook_secret?: string } = {};
      const existingSecret = await getSecretWithFallback(org.id, "linear-credentials", secretPrefix);
      if (existingSecret) {
        try {
          existingCreds = JSON.parse(existingSecret);
        } catch {
          // Ignore parse errors
        }
      }

      // Merge with new values
      const linearCredentials = JSON.stringify({
        api_key: apiKey || existingCreds.api_key || "",
        webhook_secret: webhookSecret || existingCreds.webhook_secret || "",
      });

      await saveOrgSecret(
        org.id,
        "linear-credentials",
        linearCredentials,
        secretPrefix,
        `Linear credentials for org ${org.id}`
      );

      // Also update the org's providerSettings for webhook verification
      if (webhookSecret) {
        const orgRepo = AppDataSource.getRepository(Organization);
        const providerSettings = (org.providerSettings as Record<string, unknown>) || {};
        providerSettings.linearWebhookSecret = webhookSecret;
        org.providerSettings = providerSettings;
        await orgRepo.save(org);
      }

      logger.info("Linear credentials updated", { orgId: org.id });

      res.json({ success: true, message: "Linear credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving Linear credentials", { error });
      res.status(500).json({ error: "Failed to save Linear credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/linear/test
 * Test Linear connection (uses org-specific with fallback)
 */
router.post("/integrations/linear/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get Linear credentials (org-specific with fallback)
    const linearSecretString = await getSecretWithFallback(org.id, "linear-credentials", secretPrefix);

    if (!linearSecretString) {
      res.status(400).json({ error: "Linear credentials not configured" });
      return;
    }

    const linearCreds = JSON.parse(linearSecretString);
    const { api_key } = linearCreds;

    if (!api_key) {
      res.status(400).json({ error: "Linear API key not configured" });
      return;
    }

    // Test connection by fetching current user via GraphQL
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: api_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query { viewer { id name email } }`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Linear connection test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `Linear connection failed: ${response.status}` });
      return;
    }

    const data = (await response.json()) as { data?: { viewer?: { name?: string; email?: string } }; errors?: Array<{ message: string }> };

    if (data.errors && data.errors.length > 0) {
      logger.warn("Linear API error", { errors: data.errors });
      res.status(400).json({ error: `Linear API error: ${data.errors[0].message}` });
      return;
    }

    res.json({
      success: true,
      message: "Linear connection successful",
      user: data.data?.viewer?.name || data.data?.viewer?.email,
    });
  } catch (error) {
    logger.error("Error testing Linear connection", { error });
    res.status(500).json({ error: "Failed to test Linear connection" });
  }
});

// =============================================================================
// Teams Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/teams
 * Save Teams webhook URL to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/teams",
  requireAdmin,
  body("webhookUrl").isURL().withMessage("webhookUrl must be a valid URL"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { webhookUrl } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      await saveOrgSecret(
        org.id,
        "teams-webhook",
        webhookUrl,
        secretPrefix,
        `Teams webhook URL for org ${org.id}`
      );

      logger.info("Teams webhook URL updated", { orgId: org.id });

      res.json({ success: true, message: "Teams webhook saved successfully" });
    } catch (error) {
      logger.error("Error saving Teams webhook", { error });
      res.status(500).json({ error: "Failed to save Teams webhook" });
    }
  }
);

/**
 * POST /api/settings/integrations/teams/test
 * Test Teams webhook by sending a test message
 */
router.post("/integrations/teams/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const webhookUrl = await getSecretWithFallback(org.id, "teams-webhook", secretPrefix);

    if (!webhookUrl) {
      res.status(400).json({ error: "Teams webhook not configured" });
      return;
    }

    // Send test message to Teams
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: "0076D7",
        summary: "WorkerMill Test Message",
        sections: [{
          activityTitle: "WorkerMill Notification Test",
          activitySubtitle: `Test from ${org.name}`,
          activityImage: "https://workermill.com/favicon.ico",
          facts: [{
            name: "Status",
            value: "Connection successful"
          }, {
            name: "Time",
            value: new Date().toISOString()
          }],
          markdown: true
        }]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Teams webhook test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `Teams webhook failed: ${response.status}` });
      return;
    }

    res.json({
      success: true,
      message: "Teams webhook test successful! Check your Teams channel.",
    });
  } catch (error) {
    logger.error("Error testing Teams webhook", { error });
    res.status(500).json({ error: "Failed to test Teams webhook" });
  }
});

// =============================================================================
// Slack Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/slack
 * Save Slack webhook URL to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/slack",
  requireAdmin,
  body("webhookUrl").isURL().withMessage("webhookUrl must be a valid URL"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { webhookUrl } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      await saveOrgSecret(
        org.id,
        "slack-webhook",
        webhookUrl,
        secretPrefix,
        `Slack webhook URL for org ${org.id}`
      );

      logger.info("Slack webhook URL updated", { orgId: org.id });

      res.json({ success: true, message: "Slack webhook saved successfully" });
    } catch (error) {
      logger.error("Error saving Slack webhook", { error });
      res.status(500).json({ error: "Failed to save Slack webhook" });
    }
  }
);

/**
 * POST /api/settings/integrations/slack/test
 * Test Slack webhook by sending a test message
 */
router.post("/integrations/slack/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const webhookUrl = await getSecretWithFallback(org.id, "slack-webhook", secretPrefix);

    if (!webhookUrl) {
      res.status(400).json({ error: "Slack webhook not configured" });
      return;
    }

    // Send test message to Slack
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "WorkerMill Notification Test",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "🔧 WorkerMill Notification Test",
              emoji: true
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Organization:*\n${org.name}`
              },
              {
                type: "mrkdwn",
                text: `*Status:*\n✅ Connection successful`
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Sent at ${new Date().toISOString()}`
              }
            ]
          }
        ]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Slack webhook test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `Slack webhook failed: ${response.status}` });
      return;
    }

    res.json({
      success: true,
      message: "Slack webhook test successful! Check your Slack channel.",
    });
  } catch (error) {
    logger.error("Error testing Slack webhook", { error });
    res.status(500).json({ error: "Failed to test Slack webhook" });
  }
});

// =============================================================================
// Cloud Provider Integrations
// =============================================================================

/**
 * PUT /api/settings/integrations/aws
 * Save AWS credentials to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/aws",
  requireAdmin,
  body("accessKeyId").isString().notEmpty().withMessage("accessKeyId is required"),
  body("secretAccessKey").isString().notEmpty().withMessage("secretAccessKey is required"),
  body("region").optional().isString().withMessage("region must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { accessKeyId, secretAccessKey, region } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      const awsCredentials = JSON.stringify({
        access_key_id: accessKeyId,
        secret_access_key: secretAccessKey,
        region: region || "us-east-1",
      });

      await saveOrgSecret(
        org.id,
        "aws-credentials",
        awsCredentials,
        secretPrefix,
        `AWS credentials for org ${org.id}`
      );

      logger.info("AWS credentials updated", { orgId: org.id });

      res.json({ success: true, message: "AWS credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving AWS credentials", { error });
      res.status(500).json({ error: "Failed to save AWS credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/aws/test
 * Test AWS credentials by calling STS GetCallerIdentity
 */
router.post("/integrations/aws/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const awsSecretString = await getSecretWithFallback(org.id, "aws-credentials", secretPrefix);

    if (!awsSecretString) {
      res.status(400).json({ error: "AWS credentials not configured" });
      return;
    }

    const awsCreds = JSON.parse(awsSecretString);
    const { access_key_id, secret_access_key, region } = awsCreds;

    if (!access_key_id || !secret_access_key) {
      res.status(400).json({ error: "Incomplete AWS credentials" });
      return;
    }

    // Use AWS SDK to test credentials
    const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
    const stsClient = new STSClient({
      region: region || "us-east-1",
      credentials: {
        accessKeyId: access_key_id,
        secretAccessKey: secret_access_key,
      },
    });

    const identity = await stsClient.send(new GetCallerIdentityCommand({}));

    res.json({
      success: true,
      message: "AWS connection successful",
      account: identity.Account,
      arn: identity.Arn,
    });
  } catch (error) {
    logger.error("Error testing AWS credentials", { error });
    const message = error instanceof Error ? error.message : "AWS connection failed";
    res.status(400).json({ error: message });
  }
});

// =============================================================================
// AWS Cross-Account Role Configuration (Secure Multi-Cloud Deployment)
// =============================================================================

/**
 * GET /api/settings/integrations/aws/external-id
 * Get or generate the external ID for AWS cross-account role assumption
 * This ID is unique per organization and prevents confused deputy attacks
 */
router.get("/integrations/aws/external-id", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const externalId = await getOrCreateExternalId(org.id);

    res.json({
      externalId,
      usage: "Add this External ID as a condition in your IAM role's trust policy",
      trustPolicyExample: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              AWS: "arn:aws:iam::593971626975:role/workermill-dev-worker-task",
            },
            Action: "sts:AssumeRole",
            Condition: {
              StringEquals: {
                "sts:ExternalId": externalId,
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    logger.error("Error generating external ID", { error });
    res.status(500).json({ error: "Failed to generate external ID" });
  }
});

/**
 * GET /api/settings/integrations/aws/role
 * Get the current AWS role configuration for cross-account deployments
 */
router.get("/integrations/aws/role", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const roleConfig = await getAwsRoleConfig(org.id);

    if (!roleConfig) {
      // Return empty config with just the external ID
      const externalId = await getOrCreateExternalId(org.id);
      res.json({
        configured: false,
        externalId,
        roleArn: null,
        region: null,
      });
      return;
    }

    res.json({
      configured: true,
      externalId: roleConfig.externalId,
      roleArn: roleConfig.roleArn,
      region: roleConfig.region,
      createdAt: roleConfig.createdAt,
      updatedAt: roleConfig.updatedAt,
    });
  } catch (error) {
    logger.error("Error getting AWS role config", { error });
    res.status(500).json({ error: "Failed to get AWS role configuration" });
  }
});

/**
 * PUT /api/settings/integrations/aws/role
 * Configure the IAM role ARN that workers will assume for deployments
 */
router.put(
  "/integrations/aws/role",
  requireAdmin,
  body("roleArn").isString().notEmpty().withMessage("roleArn is required"),
  body("region").optional().isString().withMessage("region must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { roleArn, region } = req.body;
      const org = req.organization!;

      // Validate role ARN format
      if (!isValidAwsRoleArn(roleArn)) {
        res.status(400).json({
          error: "Invalid role ARN format",
          hint: "Expected format: arn:aws:iam::{account-id}:role/{role-name}",
        });
        return;
      }

      // Extract and log the target account
      const targetAccount = extractAccountIdFromArn(roleArn);
      logger.info("Configuring AWS role for cross-account access", {
        orgId: org.id,
        roleArn,
        targetAccount,
        region: region || "us-east-1",
      });

      // Save the role configuration
      const roleConfig = await saveAwsRoleConfig(org.id, roleArn, region || "us-east-1");

      res.json({
        success: true,
        message: "AWS role configuration saved",
        config: {
          roleArn: roleConfig.roleArn,
          externalId: roleConfig.externalId,
          region: roleConfig.region,
          updatedAt: roleConfig.updatedAt,
        },
        nextSteps: [
          "Ensure the IAM role exists in your AWS account",
          "The role must trust WorkerMill's worker role as a principal",
          "The role's trust policy must require the external ID: " + roleConfig.externalId,
          "Use 'Test Connection' to verify the configuration",
        ],
      });
    } catch (error) {
      logger.error("Error saving AWS role config", { error });
      res.status(500).json({ error: "Failed to save AWS role configuration" });
    }
  }
);

/**
 * POST /api/settings/integrations/aws/role/test
 * Test the AWS role configuration by attempting to assume the role
 */
router.post("/integrations/aws/role/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const roleConfig = await getAwsRoleConfig(org.id);

    if (!roleConfig || !roleConfig.roleArn) {
      res.status(400).json({ error: "AWS role not configured" });
      return;
    }

    const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");

    // Use the default credentials (from the ECS task role or environment)
    const stsClient = new STSClient({ region: roleConfig.region || "us-east-1" });

    try {
      const assumeRoleResult = await stsClient.send(
        new AssumeRoleCommand({
          RoleArn: roleConfig.roleArn,
          ExternalId: roleConfig.externalId,
          RoleSessionName: `workermill-test-${org.id.substring(0, 8)}`,
          DurationSeconds: 900, // 15 minutes (minimum)
        })
      );

      if (assumeRoleResult.Credentials) {
        res.json({
          success: true,
          message: "Successfully assumed customer role",
          assumedRole: {
            arn: assumeRoleResult.AssumedRoleUser?.Arn,
            assumedAt: new Date().toISOString(),
            expiresAt: assumeRoleResult.Credentials.Expiration?.toISOString(),
          },
        });
      } else {
        res.status(400).json({
          error: "Role assumption returned no credentials",
        });
      }
    } catch (assumeError) {
      const errorMessage = assumeError instanceof Error ? assumeError.message : String(assumeError);

      // Provide helpful error messages based on common issues
      let hint = "";
      if (errorMessage.includes("AccessDenied")) {
        hint = "Check that the role's trust policy includes WorkerMill's worker role and the correct external ID";
      } else if (errorMessage.includes("MalformedPolicyDocument")) {
        hint = "The role's trust policy may have syntax errors";
      } else if (errorMessage.includes("NoSuchEntity") || errorMessage.includes("not found")) {
        hint = "The role does not exist. Verify the role ARN and that the role is created in your AWS account";
      }

      res.status(400).json({
        error: `Failed to assume role: ${errorMessage}`,
        hint: hint || "Check your role's trust policy and permissions",
        roleArn: roleConfig.roleArn,
        externalId: roleConfig.externalId,
      });
    }
  } catch (error) {
    logger.error("Error testing AWS role assumption", { error });
    const message = error instanceof Error ? error.message : "Role test failed";
    res.status(500).json({ error: message });
  }
});

/**
 * PUT /api/settings/integrations/gcp
 * Save GCP credentials to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/gcp",
  requireAdmin,
  body("projectId").isString().notEmpty().withMessage("projectId is required"),
  body("serviceAccountJson").isString().notEmpty().withMessage("serviceAccountJson is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { projectId, serviceAccountJson } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      // Validate JSON format
      try {
        JSON.parse(serviceAccountJson);
      } catch {
        res.status(400).json({ error: "Invalid service account JSON format" });
        return;
      }

      const gcpCredentials = JSON.stringify({
        project_id: projectId,
        service_account: serviceAccountJson,
      });

      await saveOrgSecret(
        org.id,
        "gcp-credentials",
        gcpCredentials,
        secretPrefix,
        `GCP credentials for org ${org.id}`
      );

      logger.info("GCP credentials updated", { orgId: org.id });

      res.json({ success: true, message: "GCP credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving GCP credentials", { error });
      res.status(500).json({ error: "Failed to save GCP credentials" });
    }
  }
);

/**
 * PUT /api/settings/integrations/azure
 * Save Azure credentials to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/azure",
  requireAdmin,
  body("clientId").isString().notEmpty().withMessage("clientId is required"),
  body("clientSecret").isString().notEmpty().withMessage("clientSecret is required"),
  body("tenantId").isString().notEmpty().withMessage("tenantId is required"),
  body("subscriptionId").isString().notEmpty().withMessage("subscriptionId is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { clientId, clientSecret, tenantId, subscriptionId } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      const azureCredentials = JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        tenant_id: tenantId,
        subscription_id: subscriptionId,
      });

      await saveOrgSecret(
        org.id,
        "azure-credentials",
        azureCredentials,
        secretPrefix,
        `Azure credentials for org ${org.id}`
      );

      logger.info("Azure credentials updated", { orgId: org.id });

      res.json({ success: true, message: "Azure credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving Azure credentials", { error });
      res.status(500).json({ error: "Failed to save Azure credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/azure/test
 * Test Azure credentials by getting an access token
 */
router.post("/integrations/azure/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const azureSecretString = await getSecretWithFallback(org.id, "azure-credentials", secretPrefix);

    if (!azureSecretString) {
      res.status(400).json({ error: "Azure credentials not configured" });
      return;
    }

    const azureCreds = JSON.parse(azureSecretString);
    const { client_id, client_secret, tenant_id } = azureCreds;

    if (!client_id || !client_secret || !tenant_id) {
      res.status(400).json({ error: "Incomplete Azure credentials" });
      return;
    }

    // Get access token from Azure AD
    const tokenUrl = `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id,
        client_secret,
        scope: "https://management.azure.com/.default",
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Azure authentication failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `Azure authentication failed: ${response.status}` });
      return;
    }

    res.json({
      success: true,
      message: "Azure connection successful",
      tenantId: tenant_id,
    });
  } catch (error) {
    logger.error("Error testing Azure credentials", { error });
    const message = error instanceof Error ? error.message : "Azure connection failed";
    res.status(400).json({ error: message });
  }
});

// =============================================================================
// Dynamic Model Discovery
// =============================================================================

interface DiscoveredModel {
  id: string;
  displayName: string;
  provider: string;
  tier?: string;
  contextWindow?: number;
  source: "curated" | "discovered";
}

// Cache for discovered models (60 second TTL)
const modelCache = new Map<string, { models: DiscoveredModel[]; timestamp: number }>();
const MODEL_CACHE_TTL_MS = 60000;

// Curated model lists for providers without dynamic discovery
const CURATED_MODELS: Record<string, DiscoveredModel[]> = {
  anthropic: [
    { id: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", provider: "anthropic", tier: "premium", contextWindow: 200000, source: "curated" },
    { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "anthropic", tier: "economy", contextWindow: 200000, source: "curated" },
    // Legacy models for backwards compatibility
    { id: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku (Legacy)", provider: "anthropic", tier: "economy", contextWindow: 200000, source: "curated" },
    { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet (Legacy)", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-3-opus-20240229", displayName: "Claude 3 Opus (Legacy)", provider: "anthropic", tier: "premium", contextWindow: 200000, source: "curated" },
  ],
  openai: [
    { id: "gpt-5.1-codex", displayName: "GPT-5.1 Codex", provider: "openai", tier: "premium", contextWindow: 128000, source: "curated" },
    { id: "gpt-4o", displayName: "GPT-4o", provider: "openai", tier: "standard", contextWindow: 128000, source: "curated" },
    { id: "gpt-4o-mini", displayName: "GPT-4o Mini", provider: "openai", tier: "economy", contextWindow: 128000, source: "curated" },
    { id: "o1", displayName: "O1", provider: "openai", tier: "premium", contextWindow: 128000, source: "curated" },
    { id: "o1-mini", displayName: "O1 Mini", provider: "openai", tier: "standard", contextWindow: 128000, source: "curated" },
  ],
  google: [
    { id: "gemini-3-pro-preview", displayName: "Gemini 3 Pro Preview", provider: "google", tier: "premium", contextWindow: 1000000, source: "curated" },
    { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", provider: "google", tier: "economy", contextWindow: 1000000, source: "curated" },
    { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro", provider: "google", tier: "standard", contextWindow: 1000000, source: "curated" },
    { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash", provider: "google", tier: "economy", contextWindow: 1000000, source: "curated" },
  ],
};

/**
 * Fetch available models from Ollama server
 */
async function discoverOllamaModels(ollamaHost: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(`${ollamaHost}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.warn("Ollama models endpoint returned error", { status: response.status });
      return [];
    }

    const data = await response.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };

    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models.map((model) => ({
      id: model.name,
      displayName: formatOllamaModelName(model.name, model.details?.parameter_size),
      provider: "ollama",
      source: "discovered" as const,
    }));
  } catch (error) {
    logger.warn("Failed to discover Ollama models", {
      error: error instanceof Error ? error.message : String(error),
      host: ollamaHost
    });
    return [];
  }
}

/**
 * Format Ollama model name for display
 * e.g., "qwen2.5-coder:32b" -> "Qwen 2.5 Coder (32B)"
 */
function formatOllamaModelName(modelId: string, paramSize?: string): string {
  const [baseName, tag] = modelId.split(":");

  // Capitalize and clean up the base name
  const formatted = baseName
    .replace(/-/g, " ")
    .replace(/(\d+)\.(\d+)/g, "$1.$2") // Keep version numbers
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Add parameter size if available
  const size = paramSize || (tag ? tag.toUpperCase() : "");
  return size ? `${formatted} (${size})` : formatted;
}

/**
 * Get all available models for an organization
 */
async function getAvailableModels(org: { id: string; ollamaBaseUrl?: string | null }): Promise<{
  models: DiscoveredModel[];
  ollamaStatus: "connected" | "disconnected" | "not_configured";
}> {
  const cacheKey = `models-${org.id}`;
  const cached = modelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < MODEL_CACHE_TTL_MS) {
    // Determine ollama status from cached models
    const hasOllamaModels = cached.models.some(m => m.provider === "ollama" && m.source === "discovered");
    return {
      models: cached.models,
      ollamaStatus: hasOllamaModels ? "connected" : (org.ollamaBaseUrl ? "disconnected" : "not_configured"),
    };
  }

  // Start with curated models
  const models: DiscoveredModel[] = [
    ...CURATED_MODELS.anthropic,
    ...CURATED_MODELS.openai,
    ...CURATED_MODELS.google,
  ];

  // Discover Ollama models if configured
  let ollamaStatus: "connected" | "disconnected" | "not_configured" = "not_configured";
  const ollamaHost = org.ollamaBaseUrl || process.env.OLLAMA_HOST;

  if (ollamaHost) {
    const ollamaModels = await discoverOllamaModels(ollamaHost);
    if (ollamaModels.length > 0) {
      models.push(...ollamaModels);
      ollamaStatus = "connected";
    } else {
      ollamaStatus = "disconnected";
    }
  }

  // Cache the results
  modelCache.set(cacheKey, { models, timestamp: Date.now() });

  return { models, ollamaStatus };
}

/**
 * Check if a model ID is valid (either in available models or Ollama format)
 */
function isValidModelId(modelId: string, availableModels: DiscoveredModel[]): boolean {
  // Check if in available models list
  if (availableModels.some(m => m.id === modelId)) {
    return true;
  }

  // Accept any Ollama format model (name:tag) as fallback
  // This ensures models work even if Ollama server is temporarily unreachable
  if (modelId.includes(":")) {
    return true;
  }

  return false;
}

/**
 * GET /api/settings/models
 * Get all available models from all providers (with dynamic Ollama discovery)
 */
router.get("/models", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const result = await getAvailableModels(org);

    res.json({
      models: result.models,
      ollamaStatus: result.ollamaStatus,
      ollamaHost: org.ollamaBaseUrl || process.env.OLLAMA_HOST || null,
    });
  } catch (error) {
    logger.error("Error fetching available models", { error });
    res.status(500).json({ error: "Failed to fetch available models" });
  }
});

/**
 * POST /api/settings/models/refresh
 * Force refresh the model cache (clears cache and re-discovers)
 */
router.post("/models/refresh", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const cacheKey = `models-${org.id}`;

    // Clear cache
    modelCache.delete(cacheKey);

    // Re-discover
    const result = await getAvailableModels(org);

    logger.info("Model cache refreshed", { orgId: org.id, modelCount: result.models.length });

    res.json({
      models: result.models,
      ollamaStatus: result.ollamaStatus,
      ollamaHost: org.ollamaBaseUrl || process.env.OLLAMA_HOST || null,
      refreshed: true,
    });
  } catch (error) {
    logger.error("Error refreshing models", { error });
    res.status(500).json({ error: "Failed to refresh models" });
  }
});

// =============================================================================
// Provider Management Endpoints
// =============================================================================

/**
 * GET /api/settings/providers
 * List all available providers with their configuration status
 */
router.get("/providers", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const providers = listProviders();

    // Check credentials status for each provider
    const providerStatuses = await Promise.all(
      providers.map(async (provider) => {
        const hasCredentials = await hasProviderCredentials(
          org.id,
          provider.id as ProviderId
        );

        return {
          id: provider.id,
          name: provider.name,
          defaultModel: provider.defaultModel,
          requiresApiKey: provider.requiresApiKey,
          configured: hasCredentials,
          models: provider.pricingEngine.getModels().map((m) => ({
            id: m.id,
            displayName: m.displayName,
            tier: m.tier,
            contextWindow: m.contextWindow,
          })),
        };
      })
    );

    res.json({
      providers: providerStatuses,
      primaryProvider: org.primaryProvider || "anthropic",
    });
  } catch (error) {
    logger.error("Error listing providers", { error });
    res.status(500).json({ error: "Failed to list providers" });
  }
});

/**
 * POST /api/settings/providers/:providerId/test
 * Test provider credentials by making a simple API call
 */
router.post("/providers/:providerId/test", async (req: Request, res: Response) => {
  try {
    const providerId = req.params.providerId as string;
    const org = req.organization!;

    if (!isValidProviderId(providerId)) {
      res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
      return;
    }

    if (!hasProvider(providerId)) {
      res.status(404).json({ error: `Provider not found: ${providerId}` });
      return;
    }

    const provider = getProvider(providerId);

    // For Ollama, just check if the host is reachable
    if (providerId === "ollama") {
      const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
      try {
        const response = await fetch(`${ollamaHost}/api/tags`, {
          method: "GET",
        });
        if (response.ok) {
          res.json({
            success: true,
            message: "Ollama connection successful",
            host: ollamaHost,
          });
        } else {
          res.status(400).json({ error: `Ollama not reachable at ${ollamaHost}` });
        }
      } catch {
        res.status(400).json({ error: `Ollama not reachable at ${ollamaHost}` });
      }
      return;
    }

    // Try to fetch credentials
    const secretPrefix = `workermill/${config.environment}`;
    const orgSecretPath = `${secretPrefix}/orgs/${org.id}/providers/${providerId}`;
    const platformSecretPath = `${secretPrefix}/${providerId}-api-key`;

    let apiKey: string | null = null;

    // Try org-specific first
    try {
      const orgSecret = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: orgSecretPath })
      );
      apiKey = orgSecret.SecretString || null;
    } catch {
      // Try platform default
      try {
        const platformSecret = await secretsClient.send(
          new GetSecretValueCommand({ SecretId: platformSecretPath })
        );
        apiKey = platformSecret.SecretString || null;
      } catch {
        // No credentials found
      }
    }

    // Special fallback for anthropic
    if (!apiKey && providerId === "anthropic") {
      apiKey = config.secrets.anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
    }

    if (!apiKey) {
      res.status(400).json({
        error: `No credentials configured for ${provider.name}`,
        configured: false,
      });
      return;
    }

    // Test the API key based on provider
    let testResult: { success: boolean; message: string; details?: unknown };

    switch (providerId) {
      case "anthropic":
        testResult = await testAnthropicApiKey(apiKey);
        break;
      case "openai":
        testResult = await testOpenAIApiKey(apiKey);
        break;
      case "google":
        testResult = await testGoogleApiKey(apiKey);
        break;
      default:
        testResult = { success: false, message: `Testing not implemented for ${providerId}` };
    }

    if (testResult.success) {
      res.json(testResult);
    } else {
      res.status(400).json(testResult);
    }
  } catch (error) {
    logger.error("Error testing provider credentials", { error });
    res.status(500).json({ error: "Failed to test provider credentials" });
  }
});

/**
 * PUT /api/settings/providers/:providerId/credentials
 * Save provider credentials to Secrets Manager
 */
router.put(
  "/providers/:providerId/credentials",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const providerId = req.params.providerId as string;
      const { apiKey } = req.body;
      const org = req.organization!;

      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
        return;
      }

      if (!hasProvider(providerId)) {
        res.status(404).json({ error: `Provider not found: ${providerId}` });
        return;
      }

      const provider = getProvider(providerId);

      // Ollama doesn't need credentials
      if (providerId === "ollama") {
        res.json({
          success: true,
          message: "Ollama does not require API credentials",
        });
        return;
      }

      if (!apiKey) {
        res.status(400).json({ error: "Missing required field: apiKey" });
        return;
      }

      // Save to org-specific secret path
      const secretPrefix = `workermill/${config.environment}`;
      const secretPath = `${secretPrefix}/orgs/${org.id}/providers/${providerId}`;

      try {
        // Try to update existing secret
        await secretsClient.send(
          new PutSecretValueCommand({
            SecretId: secretPath,
            SecretString: apiKey,
          })
        );
      } catch (error) {
        // If secret doesn't exist, create it
        if (error instanceof ResourceNotFoundException) {
          await secretsClient.send(
            new CreateSecretCommand({
              Name: secretPath,
              SecretString: apiKey,
              Description: `${provider.name} API key for org ${org.id}`,
            })
          );
        } else {
          throw error;
        }
      }

      // Clear the credentials cache for this org/provider
      clearProviderCredentialsCache(org.id, providerId as ProviderId);

      logger.info("Provider credentials updated", {
        orgId: org.id,
        providerId,
      });

      res.json({
        success: true,
        message: `${provider.name} credentials saved successfully`,
      });
    } catch (error) {
      logger.error("Error saving provider credentials", { error });
      res.status(500).json({ error: "Failed to save provider credentials" });
    }
  }
);

/**
 * DELETE /api/settings/providers/:providerId/credentials
 * Remove provider credentials from Secrets Manager
 */
router.delete(
  "/providers/:providerId/credentials",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const providerId = req.params.providerId as string;
      const org = req.organization!;

      if (!isValidProviderId(providerId)) {
        res.status(400).json({ error: `Invalid provider ID: ${providerId}` });
        return;
      }

      // Don't allow deleting anthropic credentials (platform default)
      if (providerId === "anthropic") {
        res.status(400).json({
          error: "Cannot delete Anthropic credentials. This is the platform default provider.",
        });
        return;
      }

      const secretPrefix = `workermill/${config.environment}`;
      const secretPath = `${secretPrefix}/orgs/${org.id}/providers/${providerId}`;

      // We don't actually delete the secret, just clear it (to keep the secret structure)
      // This allows the secret to be re-used without needing create permissions
      try {
        await secretsClient.send(
          new PutSecretValueCommand({
            SecretId: secretPath,
            SecretString: "", // Empty string to "delete" credentials
          })
        );
      } catch (error) {
        if (!(error instanceof ResourceNotFoundException)) {
          throw error;
        }
        // Secret doesn't exist, that's fine
      }

      // Clear the credentials cache
      clearProviderCredentialsCache(org.id, providerId as ProviderId);

      logger.info("Provider credentials removed", {
        orgId: org.id,
        providerId,
      });

      res.json({
        success: true,
        message: `${providerId} credentials removed successfully`,
      });
    } catch (error) {
      logger.error("Error removing provider credentials", { error });
      res.status(500).json({ error: "Failed to remove provider credentials" });
    }
  }
);

// =============================================================================
// OnCallShift Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/oncallshift
 * Save OnCallShift API key to Secrets Manager (org-specific)
 */
router.put(
  "/integrations/oncallshift",
  requireAdmin,
  body("apiKey").notEmpty().isString().withMessage("apiKey is required"),
  body("baseUrl").optional().isString().withMessage("baseUrl must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { apiKey, baseUrl } = req.body;
      const org = req.organization!;
      const secretPrefix = `workermill/${config.environment}`;

      // Store API key and optional base URL together
      const oncallshiftCredentials = JSON.stringify({
        api_key: apiKey,
        base_url: baseUrl || "https://api.oncallshift.com",
      });

      await saveOrgSecret(
        org.id,
        "oncallshift-credentials",
        oncallshiftCredentials,
        secretPrefix,
        `OnCallShift credentials for org ${org.id}`
      );

      logger.info("OnCallShift credentials saved", { orgId: org.id });
      res.json({ success: true, message: "OnCallShift credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving OnCallShift credentials", { error });
      res.status(500).json({ error: "Failed to save OnCallShift credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/oncallshift/test
 * Test OnCallShift connection by listing services
 */
router.post("/integrations/oncallshift/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get OnCallShift credentials (org-specific with fallback)
    const oncallshiftSecret = await getSecretWithFallback(org.id, "oncallshift-credentials", secretPrefix);

    if (!oncallshiftSecret) {
      res.status(400).json({ error: "OnCallShift API key not configured" });
      return;
    }

    let apiKey: string;
    let baseUrl: string;
    try {
      const creds = JSON.parse(oncallshiftSecret);
      apiKey = creds.api_key;
      baseUrl = creds.base_url || "https://api.oncallshift.com";
    } catch {
      res.status(400).json({ error: "Invalid OnCallShift credentials format" });
      return;
    }

    // Test connection by listing services
    const response = await fetch(`${baseUrl}/api/v1/services`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("OnCallShift connection test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `OnCallShift connection failed: ${response.status} - ${errorText}` });
      return;
    }

    const data = await response.json() as { services?: unknown[]; data?: unknown[] };
    const serviceCount = data.services?.length || data.data?.length || 0;

    res.json({
      success: true,
      message: "OnCallShift connection successful",
      serviceCount,
    });
  } catch (error) {
    logger.error("Error testing OnCallShift connection", { error });
    res.status(500).json({ error: `Failed to test OnCallShift connection: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// =============================================================================
// Provider Test Helper Functions
// =============================================================================

/**
 * Test Anthropic API key by listing models
 */
async function testAnthropicApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (response.ok) {
      return { success: true, message: "Anthropic API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `Anthropic API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to Anthropic API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test OpenAI API key by listing models
 */
async function testOpenAIApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true, message: "OpenAI API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `OpenAI API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test Google API key by listing models
 */
async function testGoogleApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      {
        method: "GET",
      }
    );

    if (response.ok) {
      return { success: true, message: "Google API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `Google API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to Google API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export default router;
