/**
 * GitHub Utilities
 *
 * Backwards-compatible wrapper around the SCM provider abstraction.
 * New code should use getScmProvider() from scm-providers/index.ts instead.
 *
 * @deprecated Use getScmProvider(org) or getGitHubProvider() from scm-providers/index.ts
 */

import { getGitHubProvider } from "../scm-providers/index.js";

// Re-export the provider for direct access
export { getGitHubProvider } from "../scm-providers/index.js";

/**
 * Get the default GitHub provider instance
 */
function getProvider() {
  return getGitHubProvider();
}

/**
 * Parse GitHub repo string (owner/repo) into parts
 * @deprecated Use provider.parseRepoIdentifier() instead
 */
function parseRepo(repo: string): { owner: string; name: string } {
  const identifier = getProvider().parseRepoIdentifier(repo);
  return { owner: identifier.owner, name: identifier.name };
}

/**
 * Create a new branch from a base branch (usually main)
 * Automatically falls back to "master" if "main" doesn't exist
 *
 * @deprecated Use getScmProvider(org).createBranch() instead
 */
export async function createBranch(
  repo: string,
  branchName: string,
  baseBranch = "main"
): Promise<boolean> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.createBranch(repoId, branchName, baseBranch);
}

/**
 * Create a pull request
 *
 * @deprecated Use getScmProvider(org).createPullRequest() instead
 */
export async function createPullRequest(
  repo: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
  }
): Promise<{ success: boolean; prUrl?: string; prNumber?: number }> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.createPullRequest(repoId, options);
}

/**
 * Merge a pull request
 *
 * @deprecated Use getScmProvider(org).mergePullRequest() instead
 */
export async function mergePullRequest(
  repo: string,
  prNumber: number,
  options?: {
    commitTitle?: string;
    commitMessage?: string;
    mergeMethod?: "merge" | "squash" | "rebase";
  }
): Promise<boolean> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.mergePullRequest(repoId, prNumber, options);
}

/**
 * Check if a branch exists
 *
 * @deprecated Use getScmProvider(org).branchExists() instead
 */
export async function branchExists(repo: string, branchName: string): Promise<boolean> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.branchExists(repoId, branchName);
}

/**
 * Delete a branch
 *
 * @deprecated Use getScmProvider(org).deleteBranch() instead
 */
export async function deleteBranch(repo: string, branchName: string): Promise<boolean> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.deleteBranch(repoId, branchName);
}

/**
 * Get pull request details including merge status
 *
 * @deprecated Use getScmProvider(org).getPullRequestStatus() instead
 */
export async function getPullRequestStatus(
  repo: string,
  prNumber: number
): Promise<{
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  mergedAt: string | null;
  headSha: string;
} | null> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  const status = await provider.getPullRequestStatus(repoId, prNumber);
  if (!status) return null;

  // Map the provider's normalized state to the legacy format
  return {
    state: status.state === "merged" ? "closed" : status.state,
    merged: status.merged,
    mergeable: status.mergeable,
    mergedAt: status.mergedAt,
    headSha: status.headSha,
  };
}

/**
 * Check if a commit exists on a branch (i.e., the branch contains the commit)
 *
 * @deprecated Use getScmProvider(org).branchContainsCommit() instead
 */
export async function branchContainsCommit(
  repo: string,
  branchName: string,
  commitSha: string
): Promise<boolean> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.branchContainsCommit(repoId, branchName, commitSha);
}

/**
 * Update a PR branch with the latest from base branch
 * Uses GitHub's "Update branch" API to merge base into head
 * Returns true if successful, false if conflicts exist
 *
 * @deprecated Use getScmProvider(org).updatePullRequestBranch() instead
 */
export async function updatePullRequestBranch(
  repo: string,
  prNumber: number
): Promise<{ success: boolean; message: string }> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.updatePullRequestBranch(repoId, prNumber);
}

/**
 * Get PR merge conflict details (which files conflict)
 *
 * @deprecated Use getScmProvider(org).getPullRequestConflicts() instead
 */
export async function getPullRequestConflicts(
  repo: string,
  prNumber: number
): Promise<{ hasConflicts: boolean; conflictingFiles: string[] }> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.getPullRequestConflicts(repoId, prNumber);
}

/**
 * Fetch codebase context for planning agent
 *
 * Retrieves:
 * 1. File tree (top 2 levels) for repository structure
 * 2. README.md content for project overview
 * 3. Tech stack info from package.json, pyproject.toml, or requirements.txt
 *
 * This helps the planning agent make grounded decisions about targetFiles
 * instead of hallucinating files that don't exist.
 *
 * @deprecated Use getScmProvider(org).fetchCodebaseContext() instead
 */
export async function fetchCodebaseContext(
  repo: string,
  branch = "main"
): Promise<{
  fileTree: string;
  readme: string | null;
  techStack: Record<string, unknown> | null;
}> {
  const provider = getProvider();
  const repoId = provider.parseRepoIdentifier(repo);
  return provider.fetchCodebaseContext(repoId, branch);
}
