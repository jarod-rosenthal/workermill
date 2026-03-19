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

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import { getProviderCredentials } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { getOrgSecretFromDb } from "../utils/org-secret-store.js";
import { redis } from "./redis-client.js";
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
  // Broadcast to other instances
  redis.publish("cache-invalidate:org-credentials", { orgId });
}

/**
 * Subscribe to credential cache invalidation from other instances.
 * Call once after Redis connects.
 */
export function initCredentialCacheSubscription(): void {
  redis.subscribeToChannel("cache-invalidate:org-credentials", (msg) => {
    const orgId = msg.orgId as string;
    if (orgId) {
      credentialsCache.delete(orgId);
      reviewerTokenCache.delete(orgId);
      logger.debug("Credential cache invalidated via Redis", { orgId });
    }
  });
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

  // Only use org-specific github-reviewer-token (no platform fallback for multi-tenancy)
  const dbValue = await getOrgSecretFromDb(orgId, "github-reviewer-token");
  if (dbValue) {
    reviewerTokenCache.set(orgId, {
      token: dbValue,
      expiresAt: now + 5 * 60 * 1000,
    });
    return dbValue;
  }

  logger.warn("No GitHub reviewer token configured for org", { orgId });
  return ""; // Will fall back to worker token (may fail due to self-approval)
}

/**
 * Fetch the platform-wide manager GitHub token from the DB.
 * Stored under the platform org's ID in org_credentials with key "manager-github-token".
 */
export async function getManagerGitHubToken(): Promise<string> {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      logger.warn("No platform org found — cannot fetch manager GitHub token");
      return "";
    }
    return (await getOrgSecretFromDb(platformOrg.id, "manager-github-token")) || "";
  } catch (error) {
    logger.error("Failed to fetch manager GitHub token", { error: error instanceof Error ? error.message : String(error) });
    return "";
  }
}

/**
 * Get credentials for an organization from the database.
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

    /**
     * Helper to fetch org-specific integration secrets from the database.
     * NO platform fallback - returns null if not configured for this org.
     */
    const getOrgIntegrationSecret = async (
      secretName: string,
    ): Promise<string | null> => {
      return getOrgSecretFromDb(orgId, secretName);
    };

    // Fetch org-specific secrets (NO platform fallback for multi-tenancy security)
    const [jiraSecretString, anthropicKey, orgApiKeyPlaintext] = await Promise.all([
      getOrgIntegrationSecret("jira-credentials"),
      getProviderCredentials(orgId, "anthropic").catch(() => null),
      getOrgIntegrationSecret("org-api-key"),
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
        // Bitbucket credentials — simple two-field format:
        //   Git clone: https://x-bitbucket-api-token-auth:{token}@bitbucket.org/...
        //   API calls: Basic auth with email:{token}
        // Supports both { email, api_token } and legacy { username, app_password }.
        // App passwords (ATATT prefix) and API tokens both work with x-bitbucket-api-token-auth.
        try {
          const bbCreds = JSON.parse(scmSecretString);

          // Always use x-bitbucket-api-token-auth for git clone
          bitbucketUsername = "x-bitbucket-api-token-auth";
          // Email for API auth
          bitbucketEmail = bbCreds.email || "";
          // Token — accept any field name
          scmToken = bbCreds.api_token || bbCreds.app_password || bbCreds.token || "";

          if (!scmToken) {
            throw new Error(
              "BitBucket credentials missing token",
            );
          }
        } catch (parseError) {
          throw new Error(
            `Invalid BitBucket credentials format for organization '${org.name}'. ` +
              `Expected JSON with 'email' and 'api_token'.`,
          );
        }
      } else {
        scmToken = scmSecretString;
      }
    } else {
      // GitHub SCM provider — try GitHub App first, then PAT
      let githubToken: string | null = null;

      if (org.githubAppInstallationId) {
        try {
          const { getInstallationToken } = await import("./github-app.js");
          githubToken = await getInstallationToken(org.githubAppInstallationId);
        } catch (appErr) {
          logger.warn("GitHub App token generation failed, falling back to PAT", {
            orgId,
            installationId: org.githubAppInstallationId,
            error: appErr instanceof Error ? appErr.message : String(appErr),
          });
        }
      }

      if (!githubToken) {
        githubToken = await getOrgIntegrationSecret("github-token");
      }

      if (!githubToken) {
        throw new Error(
          `GitHub token not configured for organization '${org.name}'. ` +
            `Run 'WorkerMill: Configure Repository Access' in VS Code or visit Settings > Integrations.`,
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
      anthropicApiKey: anthropicKey && anthropicKey !== "LOCAL_OAUTH_MODE" ? anthropicKey : "",
      githubToken:
        scmProvider === "github" ? scmToken || undefined : undefined,
      orgApiKey: orgApiKeyPlaintext || undefined,
      jiraBaseUrl,
      jiraEmail: jiraCredentials.email,
      jiraApiToken: jiraCredentials.api_token,
      ollamaBaseUrl: org.ollamaBaseUrl || undefined,
      ollamaContextWindow: org.ollamaContextWindow || 65536,
      vllmBaseUrl: org.vllmBaseUrl || undefined,
      // v1-only: Ralph execution settings from org
      useRalph: org.useRalphExecution ?? false,
      ralphMaxStories: org.ralphMaxStories ?? 10,
      maxReviewRevisions: org.maxReviewRevisions,
      maxPerStoryRevisions: org.maxPerStoryRevisions,
      // Manager provider and model for Epic/PRD workflows
      managerProvider: org.managerProvider,
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
      const awsRoleSecretStr = await getOrgSecretFromDb(
        orgId,
        "aws-role-config",
      );
      if (awsRoleSecretStr) {
        const awsRoleConfig = JSON.parse(awsRoleSecretStr);
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
    logger.error("Failed to fetch org credentials", {
      error,
      orgId,
    });
    throw error;
  }
}
