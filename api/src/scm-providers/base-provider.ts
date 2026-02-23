/**
 * Base SCM Provider
 *
 * Abstract base class with shared logic for all SCM providers.
 * Subclasses implement provider-specific API calls.
 */

import { getOrgSecretFromDb } from "../utils/org-secret-store.js";
import { logger } from "../utils/logger.js";
import type {
  IScmProvider,
  ScmProviderId,
  ScmRepoIdentifier,
  ScmCredentials,
  CreatePullRequestOptions,
  CreatePullRequestResult,
  PullRequestStatus,
  MergePullRequestOptions,
  UpdateBranchResult,
  PullRequestConflicts,
  CodebaseContext,
  WebhookEvent,
} from "./types.js";

/**
 * Token cache entry
 */
interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

/**
 * Abstract base class for SCM providers
 */
export abstract class BaseScmProvider implements IScmProvider {
  abstract readonly id: ScmProviderId;
  abstract readonly displayName: string;

  /** Token cache (5 minute TTL) */
  protected tokenCache: Map<string, TokenCacheEntry> = new Map();
  protected readonly TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

  /** Organization ID for this provider instance */
  protected orgId?: string;

  constructor(orgId?: string) {
    this.orgId = orgId;
  }

  // =========================================================================
  // Shared Helper Methods
  // =========================================================================

  /**
   * Get token from environment variable (for local mode) or AWS Secrets Manager with caching
   * @param secretPath - Path to the secret in Secrets Manager
   */
  protected async getTokenFromSecrets(secretPath: string): Promise<string | null> {
    // LOCAL MODE: Check environment variables first
    if (process.env.EXECUTION_MODE === "local") {
      const envToken = this.getTokenFromEnv();
      if (envToken) {
        logger.debug("Using token from environment variable", { provider: this.id });
        return envToken;
      }
      // Fall through to Secrets Manager if env var not set
    }

    const now = Date.now();
    const credentialKey = secretPath; // secretPath is now the credential key
    const cached = this.tokenCache.get(credentialKey);

    if (cached && cached.expiresAt > now) {
      return cached.token;
    }

    if (!this.orgId) {
      logger.warn("No orgId set on provider, cannot fetch token from DB", { provider: this.id });
      return null;
    }

    const token = await getOrgSecretFromDb(this.orgId, credentialKey);
    if (!token) {
      logger.warn("Token not found in org credentials", { credentialKey, orgId: this.orgId });
      return null;
    }

    this.tokenCache.set(credentialKey, {
      token,
      expiresAt: now + this.TOKEN_CACHE_TTL_MS,
    });

    return token;
  }

  /**
   * Get token from environment variable based on provider ID.
   * Override in subclasses for provider-specific env var names.
   */
  protected getTokenFromEnv(): string | null {
    const envVarMap: Record<string, string> = {
      github: "GITHUB_TOKEN",
      gitlab: "GITLAB_TOKEN",
      bitbucket: "BITBUCKET_TOKEN",
    };
    const envVar = envVarMap[this.id];
    return envVar ? (process.env[envVar] || null) : null;
  }

  /**
   * Parse JSON from Secrets Manager that may contain complex credentials
   * @param secretPath - Path to the secret
   */
  protected async getJsonFromSecrets<T extends Record<string, unknown>>(
    secretPath: string
  ): Promise<T | null> {
    const raw = await this.getTokenFromSecrets(secretPath);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      // Not JSON, might be a plain token - return as-is in a wrapper
      return { token: raw } as unknown as T;
    }
  }

  /**
   * Get the default secret path for this provider
   * Can be overridden for org-specific secrets
   */
  protected getDefaultSecretPath(): string {
    return `${this.id}-token`;
  }

  /**
   * Make an HTTP request with standard error handling
   */
  protected async httpRequest<T>(
    url: string,
    options: RequestInit,
    context: string
  ): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn(`${context} failed`, {
          url,
          status: response.status,
          error: errorText.substring(0, 500),
        });
        return { ok: false, status: response.status, error: errorText };
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) {
        return { ok: true, status: response.status };
      }

      try {
        const data = JSON.parse(text) as T;
        return { ok: true, status: response.status, data };
      } catch {
        // Response was not JSON
        return { ok: true, status: response.status };
      }
    } catch (error) {
      logger.error(`${context} error`, { url, error });
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Build common headers for API requests
   */
  protected abstract buildHeaders(token: string): Record<string, string>;

  /**
   * Get the base API URL for this provider
   */
  protected abstract getApiBaseUrl(): string;

  // =========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // =========================================================================

  abstract parseRepoIdentifier(repoString: string): ScmRepoIdentifier;

  abstract getCloneUrl(repo: ScmRepoIdentifier, credentials: ScmCredentials): string;

  abstract createBranch(
    repo: ScmRepoIdentifier,
    branchName: string,
    baseBranch?: string
  ): Promise<boolean>;

  abstract branchExists(repo: ScmRepoIdentifier, branchName: string): Promise<boolean>;

  abstract deleteBranch(repo: ScmRepoIdentifier, branchName: string): Promise<boolean>;

  abstract branchContainsCommit(
    repo: ScmRepoIdentifier,
    branchName: string,
    commitSha: string
  ): Promise<boolean>;

  abstract createPullRequest(
    repo: ScmRepoIdentifier,
    options: CreatePullRequestOptions
  ): Promise<CreatePullRequestResult>;

  abstract getPullRequestStatus(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestStatus | null>;

  abstract mergePullRequest(
    repo: ScmRepoIdentifier,
    prNumber: number,
    options?: MergePullRequestOptions
  ): Promise<boolean>;

  abstract updatePullRequestBranch(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<UpdateBranchResult>;

  abstract getPullRequestConflicts(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestConflicts>;

  abstract fetchCodebaseContext(
    repo: ScmRepoIdentifier,
    branch?: string
  ): Promise<CodebaseContext>;

  abstract verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    secret: string
  ): boolean;

  abstract parseWebhookEvent(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>
  ): WebhookEvent | null;
}
