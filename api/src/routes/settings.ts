import { Router, Request, Response } from "express";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

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
        "claude-opus-4-5-20251101",
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
      ];
      if (!validModels.includes(defaultWorkerModel)) {
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
router.put("/integrations/jira", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { baseUrl, email, apiToken } = req.body;

    if (!baseUrl || !email || !apiToken) {
      res.status(400).json({ error: "Missing required fields: baseUrl, email, apiToken" });
      return;
    }

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
});

/**
 * PUT /api/settings/integrations/github
 * Save GitHub token to Secrets Manager and default repo to org
 */
router.put("/integrations/github", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { token, defaultRepo } = req.body;

    if (!token) {
      res.status(400).json({ error: "Missing required field: token" });
      return;
    }

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
});

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
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("GitHub connection test failed", { status: response.status, error: errorText });
      res.status(400).json({ error: `GitHub connection failed: ${response.status}` });
      return;
    }

    const userData = await response.json() as { login?: string };
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

export default router;
