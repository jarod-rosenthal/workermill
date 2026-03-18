/**
 * GitHub SCM Provider
 *
 * Implementation of IScmProvider for GitHub.
 * Extracted from api/src/utils/github.ts with the provider abstraction pattern.
 */

import crypto from "crypto";
import { BaseScmProvider } from "./base-provider.js";
import { logger } from "../utils/logger.js";
import type {
  ScmProviderId,
  ScmRepoIdentifier,
  ScmCredentials,
  CreatePullRequestOptions,
  CreatePullRequestResult,
  PullRequestStatus,
  MergePullRequestOptions,
  UpdateBranchResult,
  PullRequestConflicts,
  CommitStatus,
  CodebaseContext,
  WebhookEvent,
  WebhookEventType,
} from "./types.js";

/**
 * GitHub-specific API response types
 */
interface GitHubRef {
  object: { sha: string };
}

interface GitHubPullRequest {
  html_url: string;
  number: number;
  state: "open" | "closed";
  merged: boolean;
  mergeable: boolean | null;
  merged_at: string | null;
  head: { sha: string };
}

interface GitHubCompare {
  status: "diverged" | "ahead" | "behind" | "identical";
  behind_by: number;
}

interface GitHubFile {
  filename: string;
  status: string;
  patch?: string;
}

interface GitHubTree {
  tree: Array<{ path: string; type: string; size?: number }>;
}

/**
 * GitHub SCM Provider implementation
 */
export class GitHubProvider extends BaseScmProvider {
  readonly id: ScmProviderId = "github";
  readonly displayName = "GitHub";

  private static readonly API_BASE = "https://api.github.com";
  private static readonly USER_AGENT = "WorkerMill-API";

  protected getApiBaseUrl(): string {
    return GitHubProvider.API_BASE;
  }

  protected buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": GitHubProvider.USER_AGENT,
    };
  }

  /**
   * Get GitHub token from Secrets Manager
   */
  async getToken(): Promise<string | null> {
    return this.getTokenFromSecrets(this.getDefaultSecretPath());
  }

  // =========================================================================
  // Repository Operations
  // =========================================================================

  parseRepoIdentifier(repoString: string): ScmRepoIdentifier {
    const parts = repoString.split("/");
    if (parts.length !== 2) {
      logger.warn("Invalid GitHub repo format", { repoString });
    }
    const [owner, name] = parts;
    return {
      owner: owner || "",
      name: name || repoString,
      fullPath: repoString,
    };
  }

  getCloneUrl(repo: ScmRepoIdentifier, credentials: ScmCredentials): string {
    const token = credentials.token || "";
    return `https://x-access-token:${token}@github.com/${repo.fullPath}.git`;
  }

  // =========================================================================
  // Branch Operations
  // =========================================================================

  async createBranch(
    repo: ScmRepoIdentifier,
    branchName: string,
    baseBranch = "main"
  ): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot create branch - no GitHub token", { repo: repo.fullPath, branchName });
      return false;
    }

    // Try the specified base branch, then fall back to common alternatives
    const branchesToTry = [baseBranch];
    if (baseBranch === "main") {
      branchesToTry.push("master");
    } else if (baseBranch === "master") {
      branchesToTry.push("main");
    }

    let baseSha: string | null = null;
    let actualBaseBranch: string | null = null;

    for (const tryBranch of branchesToTry) {
      const result = await this.httpRequest<GitHubRef>(
        `${this.getApiBaseUrl()}/repos/${repo.fullPath}/git/refs/heads/${tryBranch}`,
        { headers: this.buildHeaders(token) },
        `Get ref for ${tryBranch}`
      );

      if (result.ok && result.data) {
        baseSha = result.data.object.sha;
        actualBaseBranch = tryBranch;
        if (tryBranch !== baseBranch) {
          logger.info("Using fallback base branch", {
            repo: repo.fullPath,
            requested: baseBranch,
            actual: tryBranch,
          });
        }
        break;
      }
    }

    if (!baseSha || !actualBaseBranch) {
      logger.warn("Failed to get any base branch ref", {
        repo: repo.fullPath,
        attempted: branchesToTry,
      });
      return false;
    }

    // Create the new branch
    const createResult = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/git/refs`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        }),
      },
      "Create branch"
    );

    if (createResult.status === 422) {
      // Branch already exists - this is OK
      logger.info("Branch already exists", { repo: repo.fullPath, branchName });
      return true;
    }

    if (!createResult.ok) {
      logger.warn("Failed to create branch", {
        repo: repo.fullPath,
        branchName,
        status: createResult.status,
        error: createResult.error,
      });
      return false;
    }

    logger.info("Created feature branch", {
      repo: repo.fullPath,
      branchName,
      baseBranch: actualBaseBranch,
    });
    return true;
  }

  async branchExists(repo: ScmRepoIdentifier, branchName: string): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;

    const result = await this.httpRequest<GitHubRef>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/git/refs/heads/${branchName}`,
      { headers: this.buildHeaders(token) },
      "Check branch exists"
    );

    return result.ok;
  }

  async deleteBranch(repo: ScmRepoIdentifier, branchName: string): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot delete branch - no GitHub token", { repo: repo.fullPath, branchName });
      return false;
    }

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/git/refs/heads/${branchName}`,
      {
        method: "DELETE",
        headers: this.buildHeaders(token),
      },
      "Delete branch"
    );

    if (!result.ok && result.status !== 404) {
      logger.warn("Failed to delete branch", {
        repo: repo.fullPath,
        branchName,
        status: result.status,
      });
      return false;
    }

    logger.info("Deleted branch", { repo: repo.fullPath, branchName });
    return true;
  }

  async branchContainsCommit(
    repo: ScmRepoIdentifier,
    branchName: string,
    commitSha: string
  ): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;

    const result = await this.httpRequest<GitHubCompare>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/compare/${commitSha}...${branchName}`,
      { headers: this.buildHeaders(token) },
      "Compare commits"
    );

    if (!result.ok || !result.data) return false;

    // If branch is "ahead" or "identical", it contains the commit
    return result.data.status === "ahead" || result.data.status === "identical";
  }

  // =========================================================================
  // Pull Request Operations
  // =========================================================================

  async createPullRequest(
    repo: ScmRepoIdentifier,
    options: CreatePullRequestOptions
  ): Promise<CreatePullRequestResult> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot create PR - no GitHub token", { repo: repo.fullPath });
      return { success: false, error: "No GitHub token" };
    }

    const result = await this.httpRequest<GitHubPullRequest>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          title: options.title,
          body: options.body,
          head: options.head,
          base: options.base,
          draft: options.draft,
        }),
      },
      "Create PR"
    );

    if (result.status === 422) {
      // PR already exists or no changes - try to find existing
      const existing = await this.findPullRequest(repo, options.head, options.base);
      if (existing) {
        logger.info("PR already exists", { repo: repo.fullPath, ...existing });
        return { success: true, ...existing };
      }

      // Parse error message
      let errorMsg = "Cannot create PR";
      try {
        const errorData = JSON.parse(result.error || "{}") as { errors?: Array<{ message: string }> };
        errorMsg = errorData.errors?.[0]?.message || errorMsg;
      } catch {
        // Ignore parse error
      }
      logger.warn("Cannot create PR", { repo: repo.fullPath, error: errorMsg });
      return { success: false, error: errorMsg };
    }

    if (!result.ok || !result.data) {
      return { success: false, error: result.error };
    }

    logger.info("Created pull request", {
      repo: repo.fullPath,
      prUrl: result.data.html_url,
      prNumber: result.data.number,
    });

    return {
      success: true,
      prUrl: result.data.html_url,
      prNumber: result.data.number,
    };
  }

  /**
   * Find an existing pull request by head and base branch
   */
  private async findPullRequest(
    repo: ScmRepoIdentifier,
    head: string,
    base: string
  ): Promise<{ prUrl: string; prNumber: number } | null> {
    const token = await this.getToken();
    if (!token) return null;

    const result = await this.httpRequest<GitHubPullRequest[]>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls?head=${repo.owner}:${head}&base=${base}&state=open`,
      { headers: this.buildHeaders(token) },
      "Find PR"
    );

    if (!result.ok || !result.data || result.data.length === 0) {
      return null;
    }

    return {
      prUrl: result.data[0].html_url,
      prNumber: result.data[0].number,
    };
  }

  async getPullRequestStatus(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestStatus | null> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot get PR status - no GitHub token", { repo: repo.fullPath, prNumber });
      return null;
    }

    const result = await this.httpRequest<GitHubPullRequest>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls/${prNumber}`,
      { headers: this.buildHeaders(token) },
      "Get PR status"
    );

    if (!result.ok || !result.data) {
      logger.warn("Failed to get PR status", {
        repo: repo.fullPath,
        prNumber,
        status: result.status,
      });
      return null;
    }

    const pr = result.data;
    return {
      state: pr.merged ? "merged" : pr.state,
      merged: pr.merged,
      mergeable: pr.mergeable,
      mergedAt: pr.merged_at,
      headSha: pr.head.sha,
    };
  }

  async mergePullRequest(
    repo: ScmRepoIdentifier,
    prNumber: number,
    options?: MergePullRequestOptions
  ): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot merge PR - no GitHub token", { repo: repo.fullPath, prNumber });
      return false;
    }

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls/${prNumber}/merge`,
      {
        method: "PUT",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          commit_title: options?.commitTitle,
          commit_message: options?.commitMessage,
          merge_method: options?.mergeMethod || "squash",
        }),
      },
      "Merge PR"
    );

    if (!result.ok) {
      logger.warn("Failed to merge PR", {
        repo: repo.fullPath,
        prNumber,
        status: result.status,
        error: result.error,
      });
      return false;
    }

    // Optionally delete branch after merge
    if (options?.deleteBranch) {
      const prStatus = await this.getPullRequestStatus(repo, prNumber);
      if (prStatus) {
        // We'd need the branch name - for now this is a no-op
        // Could be enhanced to store/retrieve branch name
      }
    }

    logger.info("Merged pull request", { repo: repo.fullPath, prNumber });
    return true;
  }

  async updatePullRequestBranch(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<UpdateBranchResult> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot update PR branch - no GitHub token", { repo: repo.fullPath, prNumber });
      return { success: false, message: "No GitHub token" };
    }

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls/${prNumber}/update-branch`,
      {
        method: "PUT",
        headers: this.buildHeaders(token),
        body: JSON.stringify({}),
      },
      "Update PR branch"
    );

    if (result.ok) {
      logger.info("Updated PR branch with base", { repo: repo.fullPath, prNumber });
      return { success: true, message: "Branch updated" };
    }

    // Parse error message
    let errorMessage = `HTTP ${result.status}`;
    try {
      const errorData = JSON.parse(result.error || "{}") as { message?: string };
      errorMessage = errorData.message || errorMessage;
    } catch {
      // Ignore parse error
    }

    // Handle specific error cases
    if (result.status === 422) {
      if (errorMessage.includes("merge conflict")) {
        logger.warn("PR branch update has merge conflicts", { repo: repo.fullPath, prNumber });
        return { success: false, message: "Merge conflicts exist" };
      }
      if (errorMessage.includes("already up to date")) {
        logger.info("PR branch already up to date", { repo: repo.fullPath, prNumber });
        return { success: true, message: "Already up to date" };
      }
    }

    logger.warn("Failed to update PR branch", {
      repo: repo.fullPath,
      prNumber,
      status: result.status,
      error: errorMessage,
    });
    return { success: false, message: errorMessage };
  }

  async getPullRequestConflicts(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestConflicts> {
    const token = await this.getToken();
    if (!token) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // Get the files changed in the PR
    const result = await this.httpRequest<GitHubFile[]>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/pulls/${prNumber}/files`,
      { headers: this.buildHeaders(token) },
      "Get PR files"
    );

    if (!result.ok || !result.data) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // Check merge status
    const prStatus = await this.getPullRequestStatus(repo, prNumber);
    if (!prStatus || prStatus.mergeable !== false) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // Note: GitHub's API doesn't directly expose which files conflict
    // We return all modified files as potentially conflicting
    const modifiedFiles = result.data.map((f) => f.filename);

    logger.info("PR has merge conflicts", {
      repo: repo.fullPath,
      prNumber,
      modifiedFileCount: modifiedFiles.length,
    });

    return {
      hasConflicts: true,
      conflictingFiles: modifiedFiles,
    };
  }

  // =========================================================================
  // Context Operations (for Planning Agent)
  // =========================================================================

  async fetchCodebaseContext(
    repo: ScmRepoIdentifier,
    branch = "main"
  ): Promise<CodebaseContext> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot fetch codebase context - no GitHub token", { repo: repo.fullPath });
      return {
        fileTree: "Unable to fetch file tree (no GitHub token)",
        readme: null,
        techStack: null,
      };
    }

    const startTime = Date.now();

    // Step 1: Get the file tree (recursive, then filter to top 2 levels)
    let fileTree = "Unable to fetch file tree";
    const treeResult = await this.httpRequest<GitHubTree>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/git/trees/${branch}?recursive=1`,
      { headers: this.buildHeaders(token) },
      "Get file tree"
    );

    if (treeResult.ok && treeResult.data) {
      fileTree = this.formatFileTree(repo, branch, treeResult.data.tree);
    }

    // Step 2: Get README.md
    let readme: string | null = null;
    const readmeResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/contents/README.md`,
      {
        headers: {
          ...this.buildHeaders(token),
          Accept: "application/vnd.github.raw",
        },
      },
      "Get README"
    );

    if (readmeResult.ok) {
      // For raw content, the response is a string
      readme = (readmeResult.data as unknown as string) || null;
      if (readme && readme.length > 2000) {
        readme = readme.slice(0, 2000) + "\n... [truncated]";
      }
    }

    // Step 3: Get tech stack from package.json, pyproject.toml, or requirements.txt
    const techStack = await this.fetchTechStack(repo, token);

    const durationMs = Date.now() - startTime;

    logger.info("Fetched codebase context successfully", {
      repo: repo.fullPath,
      durationMs,
      hasFileTree: fileTree !== "Unable to fetch file tree",
      hasReadme: readme !== null,
      hasTechStack: techStack !== null,
    });

    return { fileTree, readme, techStack };
  }

  /**
   * Format file tree for planning agent
   */
  private formatFileTree(
    repo: ScmRepoIdentifier,
    branch: string,
    tree: Array<{ path: string; type: string }>
  ): string {
    // Filter to top 2 levels of directory hierarchy
    const filteredPaths = new Set<string>();
    filteredPaths.add(".");

    for (const item of tree) {
      const parts = item.path.split("/");

      // Add first level
      if (parts.length >= 1) {
        filteredPaths.add(parts[0]);
      }

      // Add second level
      if (parts.length >= 2) {
        filteredPaths.add(`${parts[0]}/${parts[1]}`);
      }

      // Limit to 150 entries to avoid huge context
      if (filteredPaths.size > 150) {
        break;
      }
    }

    const sortedPaths = Array.from(filteredPaths)
      .sort()
      .filter((p) => !p.startsWith(".")); // Exclude hidden files at root

    // Format as tree structure
    const lines: string[] = [
      `Repository: ${repo.fullPath}`,
      `Branch: ${branch}`,
      "File Structure (2 levels):",
      "",
    ];

    for (const path of sortedPaths) {
      const depth = path === "." ? 0 : path.split("/").length - 1;
      const indent = "  ".repeat(depth);
      const name = path.split("/").pop() || path;
      lines.push(`${indent}${name || "."}`);
    }

    return lines.join("\n");
  }

  /**
   * Fetch tech stack info from common config files
   */
  private async fetchTechStack(
    repo: ScmRepoIdentifier,
    token: string
  ): Promise<Record<string, unknown> | null> {
    // Try package.json first (Node.js/JavaScript projects)
    const packageResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/contents/package.json`,
      {
        headers: {
          ...this.buildHeaders(token),
          Accept: "application/vnd.github.raw",
        },
      },
      "Get package.json"
    );

    if (packageResult.ok && packageResult.data) {
      try {
        const packageJson = JSON.parse(packageResult.data as unknown as string) as Record<
          string,
          unknown
        >;
        return {
          type: "Node.js/JavaScript",
          dependencies: packageJson.dependencies,
          devDependencies: packageJson.devDependencies,
          scripts: packageJson.scripts,
        };
      } catch {
        logger.debug("Failed to parse package.json", { repo: repo.fullPath });
      }
    }

    // Try pyproject.toml (Python projects)
    const pyprojectResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/contents/pyproject.toml`,
      {
        headers: {
          ...this.buildHeaders(token),
          Accept: "application/vnd.github.raw",
        },
      },
      "Get pyproject.toml"
    );

    if (pyprojectResult.ok && pyprojectResult.data) {
      const content = pyprojectResult.data as unknown as string;
      return {
        type: "Python",
        configFile: "pyproject.toml",
        preview: content.slice(0, 500),
      };
    }

    // Try requirements.txt (Python projects)
    const reqResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/contents/requirements.txt`,
      {
        headers: {
          ...this.buildHeaders(token),
          Accept: "application/vnd.github.raw",
        },
      },
      "Get requirements.txt"
    );

    if (reqResult.ok && reqResult.data) {
      const content = reqResult.data as unknown as string;
      return {
        type: "Python",
        configFile: "requirements.txt",
        preview: content.slice(0, 500),
      };
    }

    return null;
  }

  // =========================================================================
  // CI/CD Status Operations
  // =========================================================================

  /**
   * Get commit statuses via GitHub Check Runs API.
   * Covers GitHub Actions, third-party CI, and commit status API.
   */
  async getCommitStatuses(
    repo: ScmRepoIdentifier,
    commitSha: string
  ): Promise<CommitStatus[]> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot get commit statuses - no GitHub token", {
        repo: repo.fullPath,
        commitSha: commitSha.substring(0, 7),
      });
      return [];
    }

    const statuses: CommitStatus[] = [];

    // 1. Check Runs API (GitHub Actions and integrations)
    const checkRunsResult = await this.httpRequest<{
      total_count: number;
      check_runs: Array<{
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
      }>;
    }>(
      `${this.getApiBaseUrl()}/repos/${repo.fullPath}/commits/${commitSha}/check-runs`,
      { headers: this.buildHeaders(token) },
      "Get check runs"
    );

    if (checkRunsResult.ok && checkRunsResult.data) {
      for (const run of checkRunsResult.data.check_runs) {
        let state: CommitStatus["state"];
        if (run.status !== "completed") {
          state = "pending";
        } else if (
          run.conclusion === "success" ||
          run.conclusion === "skipped" ||
          run.conclusion === "neutral"
        ) {
          state = "passed";
        } else {
          state = "failed";
        }

        statuses.push({
          state,
          name: run.name,
          url: run.html_url,
          rawState: run.status === "completed" ? (run.conclusion || "unknown") : run.status,
        });
      }
    }

    // 2. Commit Status API (legacy status checks)
    // Only fetch if no check runs found — many repos use one or the other
    if (statuses.length === 0) {
      const statusResult = await this.httpRequest<{
        state: string;
        statuses: Array<{
          state: string;
          context: string;
          target_url: string | null;
        }>;
      }>(
        `${this.getApiBaseUrl()}/repos/${repo.fullPath}/commits/${commitSha}/status`,
        { headers: this.buildHeaders(token) },
        "Get commit status"
      );

      if (statusResult.ok && statusResult.data) {
        for (const s of statusResult.data.statuses) {
          let state: CommitStatus["state"];
          if (s.state === "success") {
            state = "passed";
          } else if (s.state === "pending") {
            state = "pending";
          } else {
            state = "failed";
          }

          statuses.push({
            state,
            name: s.context,
            url: s.target_url || undefined,
            rawState: s.state,
          });
        }
      }
    }

    return statuses;
  }

  // =========================================================================
  // Webhook Operations
  // =========================================================================

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    secret: string
  ): boolean {
    const signature = headers["x-hub-signature-256"];
    if (!signature || !secret) {
      return false;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    const expectedSignature =
      "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature));
    } catch {
      // timingSafeEqual throws if buffers have different lengths
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>
  ): WebhookEvent | null {
    const eventHeader = headers["x-github-event"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (!event) {
      return null;
    }

    const action = (body.action as string) || "";
    const repository = (body.repository as { full_name?: string })?.full_name || "";

    // Map GitHub events to our normalized types
    let type: WebhookEventType;
    switch (event) {
      case "push":
        type = "push";
        break;
      case "pull_request":
        type = "pull_request";
        break;
      case "pull_request_review":
        type = "pull_request_review";
        break;
      case "issues":
        type = "issue";
        break;
      case "issue_comment":
      case "pull_request_review_comment":
        type = "comment";
        break;
      default:
        return null;
    }

    // Extract PR info if present
    const pullRequest = body.pull_request as {
      number?: number;
      html_url?: string;
      merged?: boolean;
      head?: { ref?: string };
    } | undefined;

    // Extract review info if present
    const review = body.review as { state?: string } | undefined;
    let reviewState: WebhookEvent["reviewState"];
    if (review?.state) {
      switch (review.state.toLowerCase()) {
        case "approved":
          reviewState = "approved";
          break;
        case "changes_requested":
          reviewState = "changes_requested";
          break;
        case "commented":
          reviewState = "commented";
          break;
      }
    }

    return {
      type,
      action,
      repository,
      prNumber: pullRequest?.number,
      prUrl: pullRequest?.html_url,
      branch: pullRequest?.head?.ref,
      sender: (body.sender as { login?: string })?.login,
      merged: pullRequest?.merged,
      reviewState,
      raw: body,
    };
  }
}

/**
 * Singleton instance for backwards compatibility
 */
let defaultInstance: GitHubProvider | null = null;

/**
 * Get the default GitHub provider instance
 */
export function getGitHubProvider(orgId?: string): GitHubProvider {
  if (orgId) {
    // Return org-specific instance
    return new GitHubProvider(orgId);
  }
  // Return singleton for default usage
  if (!defaultInstance) {
    defaultInstance = new GitHubProvider();
  }
  return defaultInstance;
}
