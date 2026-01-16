import { Router, Request, Response } from "express";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
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

const router = Router();

// Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// All routes require authentication
router.use(authenticateUser);

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

      // Ralph Execution Settings
      useRalphExecution: org.useRalphExecution || false,
      ralphMaxStories: org.ralphMaxStories || 10,

      // Cost Settings
      costAlertThresholdUsd: org.costAlertThresholdUsd,

      // Display Settings
      completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
      intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,

      // System Settings (read-only for reference)
      systemEnabled: org.systemEnabled,
      orchestratorRunning: org.orchestratorRunning,
      managerEnabled: org.managerEnabled,
      managerModelId: org.managerModelId,
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

      // Ralph Execution Settings
      useRalphExecution,
      ralphMaxStories,

      // Cost Settings
      costAlertThresholdUsd,

      // Display Settings
      completedTaskDisplayMinutes,
      intermediateTaskDisplayMinutes,
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
      const validModels = [
        // Anthropic models
        "claude-opus-4-5-20251101",
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-5-20251001",
        // Anthropic legacy models (backwards compatibility)
        "claude-3-5-haiku-20241022",
        "claude-3-5-sonnet-20241022",
        "claude-3-opus-20240229",
        // OpenAI models
        "gpt-4o",
        "gpt-4o-mini",
        "o1",
        "o1-mini",
        // Google models
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        // Ollama models - accept any model with colon (tag format)
        "qwen3-coder:30b",
        "qwen2.5-coder:32b",
        "devstral-small-2:24b-instruct-2512-q8_0",
        "deepseek-r1:70b",
        "llama3.3:70b",
      ];

      // For Ollama models, accept any format (they can have custom tags)
      const isOllamaModel = defaultWorkerModel.includes(":");
      const isValidModel = validModels.includes(defaultWorkerModel) || isOllamaModel;

      if (!isValidModel) {
        res.status(400).json({ error: "Invalid defaultWorkerModel" });
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
        useRalphExecution: org.useRalphExecution,
        ralphMaxStories: org.ralphMaxStories,
        costAlertThresholdUsd: org.costAlertThresholdUsd,
        completedTaskDisplayMinutes: org.completedTaskDisplayMinutes,
        intermediateTaskDisplayMinutes: org.intermediateTaskDisplayMinutes,
      },
    });
  } catch (error) {
    logger.error("Error updating settings", { error });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

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
    let jiraBaseUrl = "";
    let githubDefaultRepo = org.defaultGithubRepo || "";

    try {
      const jiraSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `${secretPrefix}/jira-credentials`,
        })
      );
      if (jiraSecret.SecretString) {
        const jiraCreds = JSON.parse(jiraSecret.SecretString);
        jiraConfigured = !!(jiraCreds.api_token && jiraCreds.email);
        jiraBaseUrl = jiraCreds.base_url || jiraCreds.domain || "";
      }
    } catch (err) {
      // Secret doesn't exist or access denied
      logger.debug("Jira credentials not found");
    }

    try {
      const githubSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `${secretPrefix}/github-token`,
        })
      );
      githubConfigured = !!githubSecret.SecretString;
    } catch (err) {
      // Secret doesn't exist or access denied
      logger.debug("GitHub token not found");
    }

    res.json({
      jira: {
        configured: jiraConfigured,
        baseUrl: jiraBaseUrl,
      },
      github: {
        configured: githubConfigured,
        defaultRepo: githubDefaultRepo,
      },
    });
  } catch (error) {
    logger.error("Error getting integration status", { error });
    res.status(500).json({ error: "Failed to get integration status" });
  }
});

/**
 * PUT /api/settings/integrations/jira
 * Save Jira credentials to Secrets Manager
 */
router.put(
  "/integrations/jira",
  requireAdmin,
  body("baseUrl").isURL().withMessage("baseUrl must be a valid URL"),
  body("email").isEmail().withMessage("email must be a valid email address"),
  body("apiToken").isString().notEmpty().withMessage("apiToken is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { baseUrl, email, apiToken } = req.body;

    const secretPrefix = `workermill/${config.environment}`;

    // Save to Secrets Manager
    const jiraCredentials = JSON.stringify({
      base_url: baseUrl,
      email: email,
      api_token: apiToken,
    });

    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: `${secretPrefix}/jira-credentials`,
        SecretString: jiraCredentials,
      })
    );

    logger.info("Jira credentials updated", { orgId: req.organization!.id });

    res.json({ success: true, message: "Jira credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving Jira credentials", { error });
      res.status(500).json({ error: "Failed to save Jira credentials" });
    }
  }
);

/**
 * PUT /api/settings/integrations/github
 * Save GitHub token to Secrets Manager and default repo to org
 */
router.put(
  "/integrations/github",
  requireAdmin,
  body("token").isString().notEmpty().withMessage("token is required"),
  body("defaultRepo").optional().isString().withMessage("defaultRepo must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { token, defaultRepo } = req.body;

    const secretPrefix = `workermill/${config.environment}`;

    // Save token to Secrets Manager
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: `${secretPrefix}/github-token`,
        SecretString: token,
      })
    );

    // Save default repo to organization
    if (defaultRepo !== undefined) {
      const org = req.organization!;
      const orgRepo = AppDataSource.getRepository(Organization);
      org.defaultGithubRepo = defaultRepo;
      await orgRepo.save(org);
    }

    logger.info("GitHub credentials updated", { orgId: req.organization!.id });

    res.json({ success: true, message: "GitHub credentials saved successfully" });
    } catch (error) {
      logger.error("Error saving GitHub credentials", { error });
      res.status(500).json({ error: "Failed to save GitHub credentials" });
    }
  }
);

/**
 * POST /api/settings/integrations/jira/test
 * Test Jira connection
 */
router.post("/integrations/jira/test", async (req: Request, res: Response) => {
  try {
    const secretPrefix = `workermill/${config.environment}`;

    // Get Jira credentials
    const jiraSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/jira-credentials`,
      })
    );

    if (!jiraSecret.SecretString) {
      res.status(400).json({ error: "Jira credentials not configured" });
      return;
    }

    const jiraCreds = JSON.parse(jiraSecret.SecretString);
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
 * Test GitHub connection
 */
router.post("/integrations/github/test", async (req: Request, res: Response) => {
  try {
    const secretPrefix = `workermill/${config.environment}`;

    // Get GitHub token
    const githubSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/github-token`,
      })
    );

    if (!githubSecret.SecretString) {
      res.status(400).json({ error: "GitHub token not configured" });
      return;
    }

    // Test connection by fetching current user
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubSecret.SecretString}`,
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
