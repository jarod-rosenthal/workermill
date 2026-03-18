/**
 * GitLab SCM Provider
 *
 * Implementation of IScmProvider for GitLab (gitlab.com and self-hosted).
 *
 * Key differences from GitHub:
 * - Auth header: PRIVATE-TOKEN instead of Bearer
 * - PR terminology: Merge Request (MR) instead of Pull Request (PR)
 * - Merge methods: merge, squash, rebase (similar)
 * - Webhook header: X-Gitlab-Event instead of x-github-event
 * - API base: gitlab.com/api/v4 or {self-hosted}/api/v4
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
 * GitLab-specific API response types
 */
interface GitLabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
}

interface GitLabBranch {
  name: string;
  commit: { id: string };
}

interface GitLabMergeRequest {
  iid: number;
  web_url: string;
  state: "opened" | "closed" | "merged";
  merged_at: string | null;
  sha: string;
  merge_status: string;
  has_conflicts: boolean;
}

interface GitLabTree {
  id: string;
  name: string;
  type: string;
  path: string;
  mode: string;
}

interface GitLabCompare {
  commits: Array<{ id: string }>;
}

/**
 * GitLab SCM Provider implementation
 */
export class GitLabProvider extends BaseScmProvider {
  readonly id: ScmProviderId = "gitlab";
  readonly displayName = "GitLab";

  private static readonly DEFAULT_API_BASE = "https://gitlab.com/api/v4";
  private static readonly USER_AGENT = "WorkerMill-API";

  private customBaseUrl?: string;

  constructor(orgId?: string, baseUrl?: string) {
    super(orgId);
    this.customBaseUrl = baseUrl;
  }

  protected getApiBaseUrl(): string {
    if (this.customBaseUrl) {
      // Ensure it ends with /api/v4
      const base = this.customBaseUrl.replace(/\/$/, "");
      return base.includes("/api/v4") ? base : `${base}/api/v4`;
    }
    return GitLabProvider.DEFAULT_API_BASE;
  }

  protected buildHeaders(token: string): Record<string, string> {
    return {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
      "User-Agent": GitLabProvider.USER_AGENT,
    };
  }

  /**
   * Get GitLab token from Secrets Manager
   */
  async getToken(): Promise<string | null> {
    return this.getTokenFromSecrets(this.getDefaultSecretPath());
  }

  // =========================================================================
  // Repository Operations
  // =========================================================================

  parseRepoIdentifier(repoString: string): ScmRepoIdentifier {
    // GitLab supports nested groups: group/subgroup/repo
    const parts = repoString.split("/");
    if (parts.length < 2) {
      logger.warn("Invalid GitLab repo format", { repoString });
      return { owner: "", name: repoString, fullPath: repoString };
    }
    const name = parts[parts.length - 1];
    const owner = parts.slice(0, -1).join("/");
    return {
      owner,
      name,
      fullPath: repoString,
    };
  }

  getCloneUrl(repo: ScmRepoIdentifier, credentials: ScmCredentials): string {
    const token = credentials.token || "";
    const host = this.customBaseUrl
      ? new URL(this.customBaseUrl).host
      : "gitlab.com";
    return `https://oauth2:${token}@${host}/${repo.fullPath}.git`;
  }

  /**
   * Get GitLab project ID from path
   * GitLab API requires URL-encoded project path or project ID
   */
  private encodeProjectPath(path: string): string {
    return encodeURIComponent(path);
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
      logger.warn("Cannot create branch - no GitLab token", {
        repo: repo.fullPath,
        branchName,
      });
      return false;
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);

    // Try the specified base branch, then fall back to master
    const branchesToTry = [baseBranch];
    if (baseBranch === "main") {
      branchesToTry.push("master");
    } else if (baseBranch === "master") {
      branchesToTry.push("main");
    }

    let actualBaseBranch: string | null = null;

    for (const tryBranch of branchesToTry) {
      const result = await this.httpRequest<GitLabBranch>(
        `${this.getApiBaseUrl()}/projects/${projectPath}/repository/branches/${encodeURIComponent(tryBranch)}`,
        { headers: this.buildHeaders(token) },
        `Get branch ${tryBranch}`
      );

      if (result.ok) {
        actualBaseBranch = tryBranch;
        break;
      }
    }

    if (!actualBaseBranch) {
      logger.warn("Failed to find base branch", {
        repo: repo.fullPath,
        attempted: branchesToTry,
      });
      return false;
    }

    // Create the new branch
    const createResult = await this.httpRequest<GitLabBranch>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/branches?branch=${encodeURIComponent(branchName)}&ref=${encodeURIComponent(actualBaseBranch)}`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
      },
      "Create branch"
    );

    if (createResult.status === 400 && createResult.error?.includes("already exists")) {
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

    const projectPath = this.encodeProjectPath(repo.fullPath);
    const result = await this.httpRequest<GitLabBranch>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/branches/${encodeURIComponent(branchName)}`,
      { headers: this.buildHeaders(token) },
      "Check branch exists"
    );

    return result.ok;
  }

  async deleteBranch(repo: ScmRepoIdentifier, branchName: string): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot delete branch - no GitLab token", {
        repo: repo.fullPath,
        branchName,
      });
      return false;
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);
    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/branches/${encodeURIComponent(branchName)}`,
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

    const projectPath = this.encodeProjectPath(repo.fullPath);

    // Use compare API to check if commit is in branch
    const result = await this.httpRequest<GitLabCompare>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/compare?from=${commitSha}&to=${encodeURIComponent(branchName)}`,
      { headers: this.buildHeaders(token) },
      "Compare commits"
    );

    if (!result.ok || !result.data) return false;

    // If commits array is empty or has commits, the branch is ahead or at the commit
    return result.data.commits.length >= 0;
  }

  // =========================================================================
  // Merge Request Operations
  // =========================================================================

  async createPullRequest(
    repo: ScmRepoIdentifier,
    options: CreatePullRequestOptions
  ): Promise<CreatePullRequestResult> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot create MR - no GitLab token", { repo: repo.fullPath });
      return { success: false, error: "No GitLab token" };
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);

    const result = await this.httpRequest<GitLabMergeRequest>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/merge_requests`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          source_branch: options.head,
          target_branch: options.base,
          title: options.title,
          description: options.body,
        }),
      },
      "Create MR"
    );

    if (result.status === 409) {
      // MR already exists - try to find it
      const existing = await this.findMergeRequest(repo, options.head, options.base);
      if (existing) {
        logger.info("MR already exists", { repo: repo.fullPath, ...existing });
        return { success: true, ...existing };
      }
      return { success: false, error: "MR already exists" };
    }

    if (!result.ok || !result.data) {
      return { success: false, error: result.error };
    }

    logger.info("Created merge request", {
      repo: repo.fullPath,
      prUrl: result.data.web_url,
      prNumber: result.data.iid,
    });

    return {
      success: true,
      prUrl: result.data.web_url,
      prNumber: result.data.iid,
    };
  }

  /**
   * Find existing merge request by source and target branch
   */
  private async findMergeRequest(
    repo: ScmRepoIdentifier,
    sourceBranch: string,
    targetBranch: string
  ): Promise<{ prUrl: string; prNumber: number } | null> {
    const token = await this.getToken();
    if (!token) return null;

    const projectPath = this.encodeProjectPath(repo.fullPath);

    const result = await this.httpRequest<GitLabMergeRequest[]>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/merge_requests?source_branch=${encodeURIComponent(sourceBranch)}&target_branch=${encodeURIComponent(targetBranch)}&state=opened`,
      { headers: this.buildHeaders(token) },
      "Find MR"
    );

    if (!result.ok || !result.data || result.data.length === 0) {
      return null;
    }

    return {
      prUrl: result.data[0].web_url,
      prNumber: result.data[0].iid,
    };
  }

  async getPullRequestStatus(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestStatus | null> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot get MR status - no GitLab token", {
        repo: repo.fullPath,
        prNumber,
      });
      return null;
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);
    const result = await this.httpRequest<GitLabMergeRequest>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/merge_requests/${prNumber}`,
      { headers: this.buildHeaders(token) },
      "Get MR status"
    );

    if (!result.ok || !result.data) {
      logger.warn("Failed to get MR status", {
        repo: repo.fullPath,
        prNumber,
        status: result.status,
      });
      return null;
    }

    const mr = result.data;
    return {
      state: mr.state === "opened" ? "open" : mr.state,
      merged: mr.state === "merged",
      mergeable: !mr.has_conflicts && mr.merge_status === "can_be_merged",
      mergedAt: mr.merged_at,
      headSha: mr.sha,
    };
  }

  async mergePullRequest(
    repo: ScmRepoIdentifier,
    prNumber: number,
    options?: MergePullRequestOptions
  ): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot merge MR - no GitLab token", {
        repo: repo.fullPath,
        prNumber,
      });
      return false;
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);

    // Map merge methods
    const mergeMethodMap: Record<string, string> = {
      merge: "merge",
      squash: "squash",
      rebase: "rebase_merge",
    };

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/merge_requests/${prNumber}/merge`,
      {
        method: "PUT",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          merge_commit_message: options?.commitMessage,
          squash: options?.mergeMethod === "squash",
          should_remove_source_branch: options?.deleteBranch ?? false,
        }),
      },
      "Merge MR"
    );

    if (!result.ok) {
      logger.warn("Failed to merge MR", {
        repo: repo.fullPath,
        prNumber,
        status: result.status,
        error: result.error,
      });
      return false;
    }

    logger.info("Merged merge request", { repo: repo.fullPath, prNumber });
    return true;
  }

  async updatePullRequestBranch(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<UpdateBranchResult> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot update MR branch - no GitLab token", {
        repo: repo.fullPath,
        prNumber,
      });
      return { success: false, message: "No GitLab token" };
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);

    // GitLab uses rebase to update MR branch
    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/merge_requests/${prNumber}/rebase`,
      {
        method: "PUT",
        headers: this.buildHeaders(token),
      },
      "Rebase MR"
    );

    if (result.ok) {
      logger.info("Updated MR branch with rebase", { repo: repo.fullPath, prNumber });
      return { success: true, message: "Branch rebased" };
    }

    if (result.status === 409 || result.error?.includes("conflict")) {
      logger.warn("MR rebase has conflicts", { repo: repo.fullPath, prNumber });
      return { success: false, message: "Merge conflicts exist" };
    }

    logger.warn("Failed to rebase MR", {
      repo: repo.fullPath,
      prNumber,
      status: result.status,
      error: result.error,
    });
    return { success: false, message: result.error || "Failed to rebase" };
  }

  async getPullRequestConflicts(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestConflicts> {
    const token = await this.getToken();
    if (!token) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    const status = await this.getPullRequestStatus(repo, prNumber);
    if (!status || status.mergeable !== false) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // GitLab doesn't expose conflict files easily, return status only
    logger.info("MR has merge conflicts", {
      repo: repo.fullPath,
      prNumber,
    });

    return {
      hasConflicts: true,
      conflictingFiles: [], // Would need additional API calls to get specific files
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
      logger.warn("Cannot fetch codebase context - no GitLab token", {
        repo: repo.fullPath,
      });
      return {
        fileTree: "Unable to fetch file tree (no GitLab token)",
        readme: null,
        techStack: null,
      };
    }

    const projectPath = this.encodeProjectPath(repo.fullPath);
    const startTime = Date.now();

    // Step 1: Get file tree
    let fileTree = "Unable to fetch file tree";
    const treeResult = await this.httpRequest<GitLabTree[]>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/tree?ref=${encodeURIComponent(branch)}&recursive=true&per_page=100`,
      { headers: this.buildHeaders(token) },
      "Get file tree"
    );

    if (treeResult.ok && treeResult.data) {
      fileTree = this.formatFileTree(repo, branch, treeResult.data);
    }

    // Step 2: Get README.md
    let readme: string | null = null;
    const readmeResult = await this.httpRequest<{ content: string }>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/files/README.md/raw?ref=${encodeURIComponent(branch)}`,
      { headers: this.buildHeaders(token) },
      "Get README"
    );

    if (readmeResult.ok) {
      readme = (readmeResult.data as unknown as string) || null;
      if (readme && readme.length > 2000) {
        readme = readme.slice(0, 2000) + "\n... [truncated]";
      }
    }

    // Step 3: Get tech stack
    const techStack = await this.fetchTechStack(repo, branch, token);

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
    tree: GitLabTree[]
  ): string {
    // Filter to top 2 levels
    const filteredPaths = new Set<string>();
    filteredPaths.add(".");

    for (const item of tree) {
      const parts = item.path.split("/");

      if (parts.length >= 1) {
        filteredPaths.add(parts[0]);
      }
      if (parts.length >= 2) {
        filteredPaths.add(`${parts[0]}/${parts[1]}`);
      }

      if (filteredPaths.size > 150) break;
    }

    const sortedPaths = Array.from(filteredPaths)
      .sort()
      .filter((p) => !p.startsWith("."));

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
    branch: string,
    token: string
  ): Promise<Record<string, unknown> | null> {
    const projectPath = this.encodeProjectPath(repo.fullPath);

    // Try package.json
    const packageResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/files/package.json/raw?ref=${encodeURIComponent(branch)}`,
      { headers: this.buildHeaders(token) },
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

    // Try pyproject.toml
    const pyprojectResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/files/pyproject.toml/raw?ref=${encodeURIComponent(branch)}`,
      { headers: this.buildHeaders(token) },
      "Get pyproject.toml"
    );

    if (pyprojectResult.ok && pyprojectResult.data) {
      return {
        type: "Python",
        configFile: "pyproject.toml",
        preview: (pyprojectResult.data as unknown as string).slice(0, 500),
      };
    }

    // Try requirements.txt
    const reqResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/files/requirements.txt/raw?ref=${encodeURIComponent(branch)}`,
      { headers: this.buildHeaders(token) },
      "Get requirements.txt"
    );

    if (reqResult.ok && reqResult.data) {
      return {
        type: "Python",
        configFile: "requirements.txt",
        preview: (reqResult.data as unknown as string).slice(0, 500),
      };
    }

    return null;
  }

  // =========================================================================
  // CI/CD Status Operations
  // =========================================================================

  /**
   * Get commit statuses via GitLab Commit Statuses API.
   *
   * API: GET /api/v4/projects/{id}/repository/commits/{sha}/statuses
   * Response has status: success | failed | canceled | running | pending
   */
  async getCommitStatuses(
    repo: ScmRepoIdentifier,
    commitSha: string
  ): Promise<CommitStatus[]> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot get commit statuses - no GitLab token", {
        repo: repo.fullPath,
        commitSha: commitSha.substring(0, 7),
      });
      return [];
    }

    const projectPath = encodeURIComponent(repo.fullPath);
    const result = await this.httpRequest<Array<{
      status: string;
      name: string;
      target_url: string | null;
    }>>(
      `${this.getApiBaseUrl()}/projects/${projectPath}/repository/commits/${commitSha}/statuses`,
      { headers: this.buildHeaders(token) },
      "Get commit statuses"
    );

    if (!result.ok || !result.data) {
      logger.warn("Failed to get commit statuses", {
        repo: repo.fullPath,
        commitSha: commitSha.substring(0, 7),
        status: result.status,
      });
      return [];
    }

    return result.data.map((s) => {
      let state: CommitStatus["state"];
      switch (s.status) {
        case "success":
          state = "passed";
          break;
        case "running":
        case "pending":
        case "created":
          state = "pending";
          break;
        case "failed":
        case "canceled":
        default:
          state = "failed";
          break;
      }

      return {
        state,
        name: s.name,
        url: s.target_url || undefined,
        rawState: s.status,
      };
    });
  }

  // =========================================================================
  // Webhook Operations
  // =========================================================================

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    secret: string
  ): boolean {
    // GitLab uses X-Gitlab-Token header for webhook verification
    const token = headers["x-gitlab-token"];
    if (!token || !secret) {
      return false;
    }

    const sig = Array.isArray(token) ? token[0] : token;

    // GitLab sends the secret token directly (not hashed)
    return sig === secret;
  }

  parseWebhookEvent(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>
  ): WebhookEvent | null {
    const eventHeader = headers["x-gitlab-event"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (!event) {
      return null;
    }

    const objectKind = (body.object_kind as string) || "";
    const objectAttributes = body.object_attributes as Record<string, unknown> | undefined;
    const project = body.project as { path_with_namespace?: string } | undefined;
    const user = body.user as { username?: string } | undefined;

    // Map GitLab events to normalized types
    let type: WebhookEventType;
    let action = "";

    switch (objectKind) {
      case "push":
        type = "push";
        break;
      case "merge_request":
        type = "merge_request";
        action = (objectAttributes?.action as string) || "";
        break;
      case "issue":
        type = "issue";
        action = (objectAttributes?.action as string) || "";
        break;
      case "note":
        type = "comment";
        break;
      default:
        return null;
    }

    // Extract MR info if present
    const mrAttributes = objectAttributes as {
      iid?: number;
      url?: string;
      source_branch?: string;
      state?: string;
    } | undefined;

    return {
      type,
      action,
      repository: project?.path_with_namespace || "",
      prNumber: mrAttributes?.iid,
      prUrl: mrAttributes?.url,
      branch: mrAttributes?.source_branch,
      sender: user?.username,
      merged: mrAttributes?.state === "merged",
      raw: body,
    };
  }
}

/**
 * Get a GitLab provider instance
 */
export function getGitLabProvider(orgId?: string, baseUrl?: string): GitLabProvider {
  return new GitLabProvider(orgId, baseUrl);
}
