/**
 * SCM Providers Module
 *
 * Factory and exports for multi-SCM provider support.
 * Supports: GitHub, GitLab, BitBucket
 */

import type { Organization } from "../models/Organization.js";
import type { IScmProvider, ScmProviderId } from "./types.js";
import { GitHubProvider, getGitHubProvider } from "./github-provider.js";
import { GitLabProvider, getGitLabProvider } from "./gitlab-provider.js";
import { BitBucketProvider, getBitBucketProvider } from "./bitbucket-provider.js";

// Re-export types
export * from "./types.js";
export { GitHubProvider, getGitHubProvider } from "./github-provider.js";
export { GitLabProvider, getGitLabProvider } from "./gitlab-provider.js";
export { BitBucketProvider, getBitBucketProvider } from "./bitbucket-provider.js";
export { BaseScmProvider } from "./base-provider.js";

/**
 * Provider registry
 */
const providerFactories: Record<ScmProviderId, (orgId?: string) => IScmProvider> = {
  github: (orgId) => new GitHubProvider(orgId),
  gitlab: (orgId) => new GitLabProvider(orgId),
  bitbucket: (orgId) => new BitBucketProvider(orgId),
};

/**
 * Get an SCM provider by ID
 *
 * @param providerId - The provider identifier (github, gitlab, bitbucket)
 * @param orgId - Optional organization ID for org-specific credentials
 * @returns The SCM provider instance
 *
 * @example
 * ```typescript
 * const github = getScmProviderById('github');
 * const repo = github.parseRepoIdentifier('owner/repo');
 * await github.createBranch(repo, 'feature/new-feature');
 * ```
 */
export function getScmProviderById(
  providerId: ScmProviderId,
  orgId?: string
): IScmProvider {
  const factory = providerFactories[providerId];
  if (!factory) {
    throw new Error(`Unknown SCM provider: ${providerId}`);
  }
  return factory(orgId);
}

/**
 * Get the SCM provider for an organization
 *
 * Uses the organization's configured SCM provider (defaults to GitHub).
 * This is the primary way to get a provider in production code.
 *
 * @param org - The organization entity or organization config
 * @returns The configured SCM provider instance
 *
 * @example
 * ```typescript
 * const org = await orgRepo.findOne({ where: { id: orgId } });
 * const scm = getScmProvider(org);
 * const repo = scm.parseRepoIdentifier(task.githubRepo);
 * await scm.createPullRequest(repo, { ... });
 * ```
 */
export function getScmProvider(
  org: Pick<Organization, "id"> & { scmProvider?: ScmProviderId }
): IScmProvider {
  // Default to GitHub for backwards compatibility
  const providerId = org.scmProvider || "github";
  return getScmProviderById(providerId, org.id);
}

/**
 * Get the default SCM provider (GitHub)
 *
 * For use when no organization context is available.
 * Uses the global GitHub token from Secrets Manager.
 *
 * @returns The default GitHub provider instance
 */
export function getDefaultScmProvider(): IScmProvider {
  return getGitHubProvider();
}

/**
 * Check if a provider ID is valid
 */
export function isValidScmProviderId(id: string): id is ScmProviderId {
  return id === "github" || id === "gitlab" || id === "bitbucket";
}

/**
 * Get display name for a provider
 */
export function getScmProviderDisplayName(providerId: ScmProviderId): string {
  const names: Record<ScmProviderId, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    bitbucket: "BitBucket",
  };
  return names[providerId] || providerId;
}

/**
 * Get all supported provider IDs
 */
export function getSupportedScmProviders(): ScmProviderId[] {
  return ["github", "gitlab", "bitbucket"];
}

/**
 * Get providers that are currently implemented
 */
export function getImplementedScmProviders(): ScmProviderId[] {
  return ["github", "gitlab", "bitbucket"];
}
