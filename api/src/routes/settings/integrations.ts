import { Router, Request, Response } from "express";
import {
  GetSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../../db/connection.js";
import { Organization } from "../../models/index.js";
import { requireAdmin } from "../../middleware/auth.js";
import { body, validateRequest } from "../../middleware/validation.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import {
  getOrCreateExternalId,
  getAwsRoleConfig,
  saveAwsRoleConfig,
  isValidAwsRoleArn,
  extractAccountIdFromArn,
} from "../../services/external-id.js";
import { getOrgSecret, saveOrgSecret, secretsClient } from "./helpers.js";

const router = Router();

// =============================================================================
// Integration Status
// =============================================================================

/**
 * GET /api/settings/integrations
 * Get the status of all configured integrations
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Check if secrets exist (without exposing values)
    let jiraConfigured = false;
    let githubConfigured = false;
    let linearConfigured = false;
    let jiraBaseUrl = "";
    let jiraEmail = "";  // Not sensitive - can be returned
    const githubDefaultRepo = org.defaultGithubRepo || "";

    // Check Jira (org-specific with fallback)
    const jiraSecret = await getOrgSecret(org.id, "jira-credentials", secretPrefix);
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
    const githubSecret = await getOrgSecret(org.id, "github-token", secretPrefix);
    githubConfigured = !!githubSecret;

    // Check GitHub reviewer token (separate token for PR approvals)
    // Check org-specific and platform-wide github-reviewer-token, plus legacy manager-github-token
    let githubReviewerConfigured = false;
    const githubReviewerSecret = await getOrgSecret(org.id, "github-reviewer-token", secretPrefix);
    githubReviewerConfigured = !!githubReviewerSecret;
    // Note: Legacy manager-github-token fallback removed for multi-tenancy security

    // Check GitLab
    const gitlabSecret = await getOrgSecret(org.id, "gitlab-token", secretPrefix);
    const gitlabConfigured = !!gitlabSecret;

    // Check BitBucket
    let bitbucketConfigured = false;
    let bitbucketUsername = "";
    const bitbucketSecret = await getOrgSecret(org.id, "bitbucket-token", secretPrefix);
    if (bitbucketSecret) {
      try {
        const bbCreds = JSON.parse(bitbucketSecret);
        // Support both key formats: username/app_password OR email/api_token
        const hasCredentials =
          (bbCreds.username && bbCreds.app_password) || (bbCreds.email && bbCreds.api_token);
        bitbucketConfigured = !!hasCredentials;
        bitbucketUsername = bbCreds.username || bbCreds.email || "";
      } catch {
        // Plain string format (username:password) is also valid
        bitbucketConfigured = bitbucketSecret.includes(":");
        if (bitbucketConfigured) {
          bitbucketUsername = bitbucketSecret.split(":")[0];
        }
      }
    }

    // Check Linear (org-specific with fallback)
    let linearWorkspace = "";
    const linearSecret = await getOrgSecret(org.id, "linear-credentials", secretPrefix);
    if (linearSecret) {
      try {
        const linearCreds = JSON.parse(linearSecret);
        linearConfigured = !!(linearCreds.api_key || linearCreds.webhook_secret);
        linearWorkspace = linearCreds.workspace || "";
      } catch {
        logger.debug("Failed to parse Linear credentials");
      }
    }

    // Check Teams webhook
    const teamsSecret = await getOrgSecret(org.id, "teams-webhook", secretPrefix);
    const teamsConfigured = !!teamsSecret;

    // Check Slack webhook
    const slackSecret = await getOrgSecret(org.id, "slack-webhook", secretPrefix);
    const slackConfigured = !!slackSecret;

    // Check OnCallShift credentials
    let oncallshiftConfigured = false;
    const oncallshiftSecret = await getOrgSecret(org.id, "oncallshift-credentials", secretPrefix);
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
    const awsSecret = await getOrgSecret(org.id, "aws-credentials", secretPrefix);
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
    const gcpSecret = await getOrgSecret(org.id, "gcp-credentials", secretPrefix);
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
    const azureSecret = await getOrgSecret(org.id, "azure-credentials", secretPrefix);
    if (azureSecret) {
      try {
        const azureCreds = JSON.parse(azureSecret);
        azureConfigured = !!(azureCreds.client_id && azureCreds.client_secret && azureCreds.tenant_id);
      } catch {
        logger.debug("Failed to parse Azure credentials");
      }
    }

    res.json({
      defaultIssueTracker: org.issueTrackerProvider || "jira",
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
      gitlab: {
        configured: gitlabConfigured,
        defaultRepo: org.defaultGitlabRepo || "",
      },
      bitbucket: {
        configured: bitbucketConfigured,
        username: bitbucketUsername,
        defaultRepo: org.defaultBitbucketRepo || "",
        webhookSecretConfigured: !!org.bitbucketWebhookSecret,
      },
      linear: {
        configured: linearConfigured,
        workspace: linearWorkspace,
        webhookSecretConfigured: !!(org.providerSettings as Record<string, unknown>)?.linearWebhookSecret,
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

// =============================================================================
// Jira Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/jira
 * Save Jira credentials to Secrets Manager (org-specific)
 * Supports partial updates by merging with existing credentials
 */
router.put(
  "/jira",
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
        const existingSecret = await getOrgSecret(org.id, "jira-credentials", secretPrefix);
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

// =============================================================================
// GitHub Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/github
 * Save GitHub token to Secrets Manager (org-specific) and/or default repo to org
 * Token is optional if only updating the default repo
 */
router.put(
  "/github",
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
router.post("/jira/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get Jira credentials (org-specific with fallback)
    const jiraSecretString = await getOrgSecret(org.id, "jira-credentials", secretPrefix);

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
 * Test GitHub connection for both worker token and reviewer token
 */
router.post("/github/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Helper to test a GitHub token
    const testGitHubToken = async (
      token: string | null,
      tokenType: string
    ): Promise<{ success: boolean; user?: string; error?: string }> => {
      if (!token) {
        return { success: false, error: "Not configured" };
      }

      try {
        const response = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.warn(`GitHub ${tokenType} test failed`, { status: response.status, error: errorText });
          return { success: false, error: `HTTP ${response.status}` };
        }

        const userData = (await response.json()) as { login?: string };
        return { success: true, user: userData.login };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
    };

    // Get both tokens
    const workerToken = await getOrgSecret(org.id, "github-token", secretPrefix);
    const reviewerToken = await getOrgSecret(org.id, "github-reviewer-token", secretPrefix);

    // Test both tokens in parallel
    const [workerResult, reviewerResult] = await Promise.all([
      testGitHubToken(workerToken, "worker token"),
      testGitHubToken(reviewerToken, "reviewer token"),
    ]);

    // Determine overall success (at least worker token must work)
    const overallSuccess = workerResult.success;

    res.json({
      success: overallSuccess,
      message: overallSuccess ? "GitHub connection successful" : "GitHub worker token failed",
      workerToken: {
        configured: !!workerToken,
        success: workerResult.success,
        user: workerResult.user,
        error: workerResult.error,
      },
      reviewerToken: {
        configured: !!reviewerToken,
        success: reviewerResult.success,
        user: reviewerResult.user,
        error: reviewerResult.error,
      },
    });
  } catch (error) {
    logger.error("Error testing GitHub connection", { error });
    res.status(500).json({ error: "Failed to test GitHub connection" });
  }
});

// =============================================================================
// GitLab Integration
// =============================================================================

/**
 * POST /api/settings/integrations/gitlab/test
 * Test GitLab connection using stored credentials
 */
router.post("/gitlab/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get GitLab token from Secrets Manager
    const gitlabToken = await getOrgSecret(org.id, "gitlab-token", secretPrefix);

    if (!gitlabToken) {
      res.status(400).json({ error: "GitLab token not configured" });
      return;
    }

    // Get base URL from org settings (for self-hosted instances)
    const baseUrl = org.scmBaseUrl && org.scmProvider === "gitlab"
      ? `${org.scmBaseUrl.replace(/\/$/, "")}/api/v4`
      : "https://gitlab.com/api/v4";

    // Test by fetching current user
    const response = await fetch(`${baseUrl}/user`, {
      headers: {
        "PRIVATE-TOKEN": gitlabToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("GitLab test failed", { status: response.status, error: errorText });
      res.json({
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
      });
      return;
    }

    const userData = (await response.json()) as { username?: string; name?: string };
    res.json({
      success: true,
      message: "GitLab connection successful",
      user: userData.username || userData.name,
    });
  } catch (error) {
    logger.error("Error testing GitLab connection", { error });
    res.status(500).json({ error: "Failed to test GitLab connection" });
  }
});

// =============================================================================
// BitBucket Integration
// =============================================================================

/**
 * POST /api/settings/integrations/bitbucket/test
 * Test BitBucket connection using stored credentials
 */
router.post("/bitbucket/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get BitBucket credentials from Secrets Manager
    // Expected format: { "username": "...", "app_password": "..." } or plain "username:password"
    const bitbucketSecret = await getOrgSecret(org.id, "bitbucket-token", secretPrefix);

    if (!bitbucketSecret) {
      res.status(400).json({ error: "BitBucket credentials not configured" });
      return;
    }

    // Parse credentials - support both key formats
    let authString: string;
    try {
      const creds = JSON.parse(bitbucketSecret) as {
        username?: string;
        app_password?: string;
        email?: string;
        api_token?: string;
      };
      if (creds.username && creds.app_password) {
        authString = `${creds.username}:${creds.app_password}`;
      } else if (creds.email && creds.api_token) {
        authString = `${creds.email}:${creds.api_token}`;
      } else {
        authString = bitbucketSecret;
      }
    } catch {
      // Plain string format: "username:password"
      authString = bitbucketSecret;
    }

    // Test by fetching current user
    const response = await fetch("https://api.bitbucket.org/2.0/user", {
      headers: {
        Authorization: `Basic ${Buffer.from(authString).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("BitBucket test failed", { status: response.status, error: errorText });
      res.json({
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`,
      });
      return;
    }

    const userData = (await response.json()) as { username?: string; display_name?: string };
    res.json({
      success: true,
      message: "BitBucket connection successful",
      user: userData.display_name || userData.username,
    });
  } catch (error) {
    logger.error("Error testing BitBucket connection", { error });
    res.status(500).json({ error: "Failed to test BitBucket connection" });
  }
});

/**
 * PUT /api/settings/integrations/gitlab
 * Save GitLab credentials to Secrets Manager (org-specific)
 */
router.put(
  "/gitlab",
  requireAdmin,
  body("token").optional().isString().withMessage("token must be a string"),
  body("webhookSecret").optional().isString().withMessage("webhookSecret must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { token, webhookSecret } = req.body;
      const org = req.organization!;

      // Require at least one field to update
      if (!token && !webhookSecret) {
        res.status(400).json({ error: "At least one field is required (token or webhookSecret)" });
        return;
      }

      const secretPrefix = `workermill/${config.environment}`;

      // Save token to org-specific path in Secrets Manager if provided
      if (token) {
        await saveOrgSecret(
          org.id,
          "gitlab-token",
          token,
          secretPrefix,
          `GitLab token for org ${org.id}`
        );
      }

      // Save webhook secret to organization if provided
      if (webhookSecret) {
        const orgRepo = AppDataSource.getRepository(Organization);
        org.gitlabWebhookSecret = webhookSecret;
        await orgRepo.save(org);
      }

      logger.info("GitLab settings updated", {
        orgId: org.id,
        tokenUpdated: !!token,
        webhookSecretUpdated: !!webhookSecret,
      });

      res.json({ success: true, message: "GitLab settings saved successfully" });
    } catch (error) {
      logger.error("Error saving GitLab credentials", { error });
      res.status(500).json({ error: "Failed to save GitLab credentials" });
    }
  }
);

/**
 * PUT /api/settings/integrations/bitbucket
 * Save BitBucket credentials to Secrets Manager (org-specific)
 */
router.put(
  "/bitbucket",
  requireAdmin,
  body("username").optional().isString().withMessage("username must be a string"),
  body("appPassword").optional().isString().withMessage("appPassword must be a string"),
  body("defaultRepo").optional().isString().withMessage("defaultRepo must be a string"),
  body("webhookSecret").optional().isString().withMessage("webhookSecret must be a string"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { username, appPassword, defaultRepo, webhookSecret } = req.body;
      const org = req.organization!;

      // Require at least one field to update
      if (!username && !appPassword && defaultRepo === undefined && !webhookSecret) {
        res.status(400).json({ error: "At least one field is required (username, appPassword, defaultRepo, or webhookSecret)" });
        return;
      }

      const secretPrefix = `workermill/${config.environment}`;

      // Save credentials to org-specific path in Secrets Manager if provided
      if (username || appPassword) {
        // Get existing credentials to merge
        let existingCreds: { username?: string; app_password?: string } = {};
        const existingSecret = await getOrgSecret(org.id, "bitbucket-token", secretPrefix);
        if (existingSecret) {
          try {
            existingCreds = JSON.parse(existingSecret);
          } catch {
            // Plain string format - parse username:password
            const parts = existingSecret.split(":");
            if (parts.length === 2) {
              existingCreds = { username: parts[0], app_password: parts[1] };
            }
          }
        }

        // Merge with new values
        const newCreds = {
          username: username || existingCreds.username || "",
          app_password: appPassword || existingCreds.app_password || "",
        };

        await saveOrgSecret(
          org.id,
          "bitbucket-token",
          JSON.stringify(newCreds),
          secretPrefix,
          `BitBucket credentials for org ${org.id}`
        );
      }

      // Save default repo and/or webhook secret to organization if provided
      if (defaultRepo !== undefined || webhookSecret) {
        const orgRepo = AppDataSource.getRepository(Organization);
        if (defaultRepo !== undefined) {
          org.defaultBitbucketRepo = defaultRepo;
        }
        if (webhookSecret) {
          org.bitbucketWebhookSecret = webhookSecret;
        }
        await orgRepo.save(org);
      }

      logger.info("BitBucket settings updated", {
        orgId: org.id,
        credentialsUpdated: !!(username || appPassword),
        repoUpdated: defaultRepo !== undefined,
        webhookSecretUpdated: !!webhookSecret,
      });

      res.json({ success: true, message: "BitBucket settings saved successfully" });
    } catch (error) {
      logger.error("Error saving BitBucket credentials", { error });
      res.status(500).json({ error: "Failed to save BitBucket credentials" });
    }
  }
);

// =============================================================================
// GitHub Reviewer Token Migration
// =============================================================================

/**
 * POST /api/settings/integrations/github/migrate-reviewer-token
 * Migrate the legacy manager-github-token to the new org-specific github-reviewer-token path.
 * This is a one-time migration utility for moving from the old platform-wide token to org-specific storage.
 */
router.post("/github/migrate-reviewer-token", requireAdmin, async (req: Request, res: Response) => {
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

// =============================================================================
// Linear Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/linear
 * Save Linear credentials to Secrets Manager (org-specific)
 */
router.put(
  "/linear",
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
      let existingCreds: { api_key?: string; webhook_secret?: string; workspace?: string } = {};
      const existingSecret = await getOrgSecret(org.id, "linear-credentials", secretPrefix);
      if (existingSecret) {
        try {
          existingCreds = JSON.parse(existingSecret);
        } catch {
          // Ignore parse errors
        }
      }

      // If API key is provided, fetch the organization workspace URL key
      let workspace = existingCreds.workspace || "";
      if (apiKey) {
        try {
          const orgResponse = await fetch("https://api.linear.app/graphql", {
            method: "POST",
            headers: {
              Authorization: apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `query { organization { urlKey } }`,
            }),
          });
          if (orgResponse.ok) {
            const orgData = (await orgResponse.json()) as { data?: { organization?: { urlKey?: string } } };
            if (orgData.data?.organization?.urlKey) {
              workspace = orgData.data.organization.urlKey;
              logger.info("Fetched Linear workspace URL key", { orgId: org.id, workspace });
            }
          }
        } catch (e) {
          logger.warn("Failed to fetch Linear workspace URL key", { error: e });
        }
      }

      // Merge with new values
      const linearCredentials = JSON.stringify({
        api_key: apiKey || existingCreds.api_key || "",
        webhook_secret: webhookSecret || existingCreds.webhook_secret || "",
        workspace,
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
router.post("/linear/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get Linear credentials (org-specific with fallback)
    const linearSecretString = await getOrgSecret(org.id, "linear-credentials", secretPrefix);

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

/**
 * GET /api/settings/integrations/linear/teams
 * Get Linear teams for issue creation
 */
router.get("/linear/teams", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { getLinearTeams } = await import("../../utils/linear.js");
    const teams = await getLinearTeams(org.id);
    if (!teams) {
      res.status(400).json({ error: "Failed to fetch Linear teams" });
      return;
    }
    res.json({ teams });
  } catch (error) {
    logger.error("Error fetching Linear teams", { error });
    res.status(500).json({ error: "Failed to fetch Linear teams" });
  }
});

/**
 * GET /api/settings/integrations/linear/labels
 * Get Linear labels for issue creation
 */
router.get("/linear/labels", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const teamId = req.query.teamId as string | undefined;
    const { getLinearLabels } = await import("../../utils/linear.js");
    const labels = await getLinearLabels(org.id, teamId);
    if (!labels) {
      res.status(400).json({ error: "Failed to fetch Linear labels" });
      return;
    }
    res.json({ labels });
  } catch (error) {
    logger.error("Error fetching Linear labels", { error });
    res.status(500).json({ error: "Failed to fetch Linear labels" });
  }
});

/**
 * POST /api/settings/integrations/linear/issues
 * Create a Linear issue (for testing)
 */
router.post("/linear/issues", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const { teamId, title, description, labelIds } = req.body;

    if (!teamId || !title) {
      res.status(400).json({ error: "teamId and title are required" });
      return;
    }

    const { createLinearIssue } = await import("../../utils/linear.js");
    const issue = await createLinearIssue(org.id, teamId, title, description, labelIds);

    if (!issue) {
      res.status(500).json({ error: "Failed to create Linear issue" });
      return;
    }

    logger.info("Created Linear issue via API", { orgId: org.id, issue });
    res.json({ success: true, issue });
  } catch (error) {
    logger.error("Error creating Linear issue", { error });
    res.status(500).json({ error: "Failed to create Linear issue" });
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
  "/teams",
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
router.post("/teams/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const webhookUrl = await getOrgSecret(org.id, "teams-webhook", secretPrefix);

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
  "/slack",
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
router.post("/slack/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const webhookUrl = await getOrgSecret(org.id, "slack-webhook", secretPrefix);

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
  "/aws",
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
router.post("/aws/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const awsSecretString = await getOrgSecret(org.id, "aws-credentials", secretPrefix);

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
router.get("/aws/external-id", async (req: Request, res: Response) => {
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
              AWS: "arn:aws:iam::AWS_ACCOUNT_ID:role/workermill-dev-worker-task",
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
router.get("/aws/role", async (req: Request, res: Response) => {
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
  "/aws/role",
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
router.post("/aws/role/test", async (req: Request, res: Response) => {
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
  "/gcp",
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
  "/azure",
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
router.post("/azure/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    const azureSecretString = await getOrgSecret(org.id, "azure-credentials", secretPrefix);

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
// OnCallShift Integration
// =============================================================================

/**
 * PUT /api/settings/integrations/oncallshift
 * Save OnCallShift API key to Secrets Manager (org-specific)
 */
router.put(
  "/oncallshift",
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
router.post("/oncallshift/test", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const secretPrefix = `workermill/${config.environment}`;

    // Get OnCallShift credentials (org-specific with fallback)
    const oncallshiftSecret = await getOrgSecret(org.id, "oncallshift-credentials", secretPrefix);

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

export default router;
