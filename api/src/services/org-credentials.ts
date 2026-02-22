/**
 * Org Credentials — Single Source of Truth
 *
 * Extracted from orchestrator.ts and pipeline-executor.ts to eliminate
 * duplicate OrgCredentials interfaces, getOrgCredentials(), caches,
 * and cache invalidation functions.
 *
 * Based on pipeline-executor.ts implementation (more complete: has AWS
 * direct access keys) with v1-only fields added (useRalph, ralphMaxStories,
 * maxReviewRevisions).
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { config, getProviderCredentials } from "../config/index.js";
import { logger } from "../utils/logger.js";
import type { ProviderId } from "../providers/types.js";

export interface OrgCredentials {
  anthropicApiKey: string;
  githubToken?: string; // Optional - only required for GitHub SCM provider
  githubReviewerToken?: string; // Separate token for PR reviews (avoids self-approval)
  orgApiKey?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  // Multi-provider support
  providerApiKey?: string;
  providerId?: ProviderId;
  ollamaBaseUrl?: string;
  ollamaContextWindow?: number;
  vllmBaseUrl?: string;
  // From v1 only
  useRalph?: boolean;
  ralphMaxStories?: number;
  maxReviewRevisions?: number;
  maxPerStoryRevisions?: number;
  // Manager settings
  managerProvider?: string;
  managerModelId?: string; // No default — Settings UI is source of truth
  openaiApiKey?: string;
  googleApiKey?: string;
  // Customer AWS (direct access keys)
  customerAwsAccessKeyId?: string;
  customerAwsSecretAccessKey?: string;
  // Customer AWS (cross-account role)
  customerAwsRoleArn?: string;
  customerAwsExternalId?: string;
  customerAwsRegion?: string;
  // Multi-SCM
  scmProvider?: "github" | "gitlab" | "bitbucket";
  scmBaseUrl?: string;
  scmToken?: string;
  bitbucketUsername?: string;
  bitbucketEmail?: string;
  // Issue tracker
  linearApiKey?: string;
  issueTrackerProvider?: string;
}

// AWS Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// Cache for org credentials (5 minute TTL)
const credentialsCache = new Map<
  string,
  { credentials: OrgCredentials; expiresAt: number }
>();

// Cache for reviewer GitHub tokens per org (separate from worker token for PR approvals)
const reviewerTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

/**
 * Invalidate cached credentials for an organization.
 * Called when org settings change to ensure fresh credentials are fetched.
 * Clears both the credentials cache and the reviewer token cache.
 */
export function invalidateOrgCredentialsCache(orgId: string): void {
  const deletedCreds = credentialsCache.delete(orgId);
  const deletedReviewer = reviewerTokenCache.delete(orgId);
  if (deletedCreds || deletedReviewer) {
    logger.info("Invalidated credentials cache for org", { orgId });
  }
}

/**
 * Get the GitHub reviewer token (separate account for PR approvals)
 * This allows the Virtual Manager/Tech Lead to approve PRs created by workers.
 *
 * Priority:
 * 1. Org-specific github-reviewer-token (from Settings → GitHub)
 * 2. Platform-wide github-reviewer-token
 * 3. Legacy manager-github-token (backward compatibility)
 */
export async function getReviewerGitHubToken(
  orgId: string,
): Promise<string> {
  const now = Date.now();
  const cached = reviewerTokenCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const secretPrefix = `workermill/${config.environment}`;

  // Only use org-specific github-reviewer-token (no platform fallback for multi-tenancy)
  try {
    const orgSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/orgs/${orgId}/github-reviewer-token`,
      }),
    );
    if (orgSecret.SecretString) {
      reviewerTokenCache.set(orgId, {
        token: orgSecret.SecretString,
        expiresAt: now + 5 * 60 * 1000,
      });
      return orgSecret.SecretString;
    }
  } catch {
    // Not found at org level - no fallback to platform secrets for security
  }

  logger.warn("No GitHub reviewer token configured for org", { orgId });
  return ""; // Will fall back to worker token (may fail due to self-approval)
}

/**
 * Backward compatibility alias — fetches legacy manager-github-token
 * for manager tasks that don't have orgId context.
 */
export async function getManagerGitHubToken(): Promise<string> {
  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `workermill/${config.environment}/manager-github-token`,
      }),
    );
    return secret.SecretString || "";
  } catch {
    return "";
  }
}

/**
 * Get credentials for an organization from Secrets Manager
 *
 * SECURITY: All credentials are org-specific. NO global/platform fallbacks.
 * Each tenant must configure their own API keys in Settings.
 */
export async function getOrgCredentials(
  orgId: string,
): Promise<OrgCredentials> {
  const now = Date.now();
  const cached = credentialsCache.get(orgId);

  if (cached && cached.expiresAt > now) {
    return cached.credentials;
  }

  try {
    // Get org for API key and settings
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    const env = config.environment;
    const basePath = `workermill/${env}/orgs/${orgId}`;

    /**
     * Helper to fetch org-specific integration secrets
     * Tries both integrations/ path and root path (legacy)
     * NO platform fallback - returns null if not configured for this org
     */
    const getOrgIntegrationSecret = async (
      secretName: string,
    ): Promise<string | null> => {
      // Try integrations/ path first (new structure)
      try {
        const secret = await secretsClient.send(
          new GetSecretValueCommand({
            SecretId: `${basePath}/integrations/${secretName}`,
          }),
        );
        if (secret.SecretString) return secret.SecretString;
      } catch {
        // Not found in integrations/
      }

      // Try root path (legacy structure)
      try {
        const secret = await secretsClient.send(
          new GetSecretValueCommand({
            SecretId: `${basePath}/${secretName}`,
          }),
        );
        if (secret.SecretString) return secret.SecretString;
      } catch {
        // Not found at root either
      }

      return null; // Not configured for this org - NO platform fallback
    };

    // Fetch org-specific secrets (NO platform fallback for multi-tenancy security)
    const [jiraSecretString, anthropicKey] = await Promise.all([
      getOrgIntegrationSecret("jira-credentials"),
      getProviderCredentials(orgId, "anthropic").catch(() => null),
    ]);

    // Get SCM provider token based on org settings (NO cross-provider fallback)
    let scmToken: string | null = null;
    let bitbucketUsername: string | undefined;
    let bitbucketEmail: string | undefined;
    const scmProvider = org.scmProvider || "github";

    if (scmProvider !== "github") {
      // Non-GitHub SCM providers require their own token - no fallback to GitHub
      const scmSecretString = await getOrgIntegrationSecret(
        `${scmProvider}-token`,
      );

      if (!scmSecretString) {
        throw new Error(
          `${scmProvider} token not configured for organization '${org.name}'. ` +
            `Please configure at Settings > Integrations > ${scmProvider} before running workers.`,
        );
      }

      if (org.scmProvider === "bitbucket") {
        // BitBucket credentials - supports both new API token and legacy app password formats
        // New format (2025+): { email, api_token } - git uses x-bitbucket-api-token-auth as username
        //   - Git clone: https://x-bitbucket-api-token-auth:<token>@bitbucket.org/...
        //   - API calls: Basic auth with email:token (NOT x-bitbucket-api-token-auth:token!)
        // Legacy format: { username, app_password }
        //   - Both git and API use username:app_password
        try {
          const bbCreds = JSON.parse(scmSecretString);

          // New API token format
          if (bbCreds.api_token) {
            bitbucketUsername = "x-bitbucket-api-token-auth";
            bitbucketEmail = bbCreds.email; // CRITICAL: Required for API calls
            scmToken = bbCreds.api_token;
          }
          // Legacy app password format
          else if (bbCreds.username && bbCreds.app_password) {
            // Detect if app_password is actually an Atlassian API token (starts with ATATT)
            // API tokens require x-bitbucket-api-token-auth as username, not the email
            if (bbCreds.app_password.startsWith("ATATT")) {
              bitbucketUsername = "x-bitbucket-api-token-auth";
            } else {
              bitbucketUsername = bbCreds.username;
            }
            scmToken = bbCreds.app_password;
          }
          // Fallback
          else if (bbCreds.token) {
            bitbucketUsername = "x-bitbucket-api-token-auth";
            bitbucketEmail = bbCreds.email;
            scmToken = bbCreds.token;
          }

          if (!scmToken) {
            throw new Error(
              "BitBucket credentials missing api_token or app_password",
            );
          }
        } catch (parseError) {
          throw new Error(
            `Invalid BitBucket credentials format for organization '${org.name}'. ` +
              `Expected JSON with 'email' and 'api_token' (new) or 'username' and 'app_password' (legacy).`,
          );
        }
      } else {
        scmToken = scmSecretString;
      }
    } else {
      // GitHub SCM provider - fetch GitHub token
      const githubToken = await getOrgIntegrationSecret("github-token");
      if (!githubToken) {
        throw new Error(
          `GitHub token not configured for organization '${org.name}'. ` +
            `Please configure at Settings > Integrations > GitHub before running workers.`,
        );
      }
      scmToken = githubToken;
    }

    // Parse Jira credentials JSON (optional - not all orgs use Jira)
    let jiraCredentials: {
      domain?: string;
      base_url?: string;
      email?: string;
      api_token?: string;
    } = {};
    if (jiraSecretString) {
      try {
        jiraCredentials = JSON.parse(jiraSecretString);
      } catch {
        logger.warn("Failed to parse Jira credentials JSON", { orgId });
      }
    }

    // Handle both 'base_url' (full URL) and 'domain' (just domain) formats
    let jiraBaseUrl: string | undefined;
    if (jiraCredentials.base_url) {
      jiraBaseUrl = jiraCredentials.base_url;
    } else if (jiraCredentials.domain) {
      jiraBaseUrl = `https://${jiraCredentials.domain}`;
    }

    const credentials: OrgCredentials = {
      anthropicApiKey: anthropicKey || "",
      githubToken:
        scmProvider === "github" ? scmToken || undefined : undefined,
      orgApiKey: org.apiKey || undefined,
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
      ollamaBaseUrl: org.ollamaBaseUrl || undefined,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || undefined,
      // v1-only: Ralph execution settings from org
      useRalph: org.useRalphExecution ?? false,
      ralphMaxStories: org.ralphMaxStories ?? 10,
      maxReviewRevisions: org.maxReviewRevisions ?? 3,
      maxPerStoryRevisions: org.maxPerStoryRevisions ?? 2,
      // Manager provider and model for Epic/PRD workflows
      managerProvider: org.managerProvider || "openai",
      managerModelId: org.managerModelId || undefined,
      // Multi-SCM provider support
      scmProvider: org.scmProvider || "github",
      scmBaseUrl: org.scmBaseUrl || undefined,
      scmToken,
      bitbucketUsername,
      bitbucketEmail,
      // Issue tracker provider
      issueTrackerProvider: org.issueTrackerProvider,
    };

    // Fetch GitHub reviewer token (separate account for PR approvals)
    const reviewerToken =
      await getOrgIntegrationSecret("github-reviewer-token");
    if (reviewerToken) {
      credentials.githubReviewerToken = reviewerToken;
    }

    // Fetch manager provider API keys (for Epic inline reviewer)
    // These are needed when the manager uses non-Anthropic providers
    try {
      credentials.googleApiKey = await getProviderCredentials(
        orgId,
        "google",
      );
    } catch {
      // Google key is optional - only needed if org uses Google for manager
    }
    try {
      credentials.openaiApiKey = await getProviderCredentials(
        orgId,
        "openai",
      );
    } catch {
      // OpenAI key is optional - only needed if org uses OpenAI for manager
    }

    // Fetch Linear API key (only if org uses Linear for issue tracking)
    if (org.issueTrackerProvider === "linear") {
      const linearSecret =
        await getOrgIntegrationSecret("linear-credentials");
      if (linearSecret) {
        try {
          const linearCreds = JSON.parse(linearSecret);
          credentials.linearApiKey = linearCreds.api_key;
        } catch {
          logger.warn("Failed to parse Linear credentials", { orgId });
        }
      }
    }

    // Fetch customer AWS credentials (direct access keys from integration settings)
    try {
      const awsCredsSecret =
        await getOrgIntegrationSecret("aws-credentials");
      if (awsCredsSecret) {
        const awsCreds = JSON.parse(awsCredsSecret);
        if (awsCreds.access_key_id && awsCreds.secret_access_key) {
          credentials.customerAwsAccessKeyId = awsCreds.access_key_id;
          credentials.customerAwsSecretAccessKey =
            awsCreds.secret_access_key;
          if (awsCreds.region) {
            credentials.customerAwsRegion = awsCreds.region;
          }
        }
      }
    } catch {
      logger.debug("No AWS credentials configured for org", { orgId });
    }

    // Try to fetch customer AWS role configuration
    try {
      const awsRoleSecret = await secretsClient.send(
        new GetSecretValueCommand({
          SecretId: `workermill/${config.environment}/orgs/${orgId}/aws-role-config`,
        }),
      );
      if (awsRoleSecret.SecretString) {
        const awsRoleConfig = JSON.parse(awsRoleSecret.SecretString);
        if (awsRoleConfig.roleArn) {
          credentials.customerAwsRoleArn = awsRoleConfig.roleArn;
          credentials.customerAwsExternalId = awsRoleConfig.externalId;
          credentials.customerAwsRegion =
            awsRoleConfig.region || "us-east-1";
        }
      }
    } catch {
      // AWS role not configured - this is optional
      logger.debug("No customer AWS role configured for org", { orgId });
    }

    // Cache for 5 minutes
    credentialsCache.set(orgId, {
      credentials,
      expiresAt: now + 5 * 60 * 1000,
    });

    return credentials;
  } catch (error) {
    logger.error("Failed to fetch credentials from Secrets Manager", {
      error,
      orgId,
    });
    throw error;
  }
}
