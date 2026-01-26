/**
 * BitBucket SCM Provider
 *
 * Implementation of IScmProvider for BitBucket Cloud.
 *
 * Key differences from GitHub:
 * - Auth: Basic auth with app password (not Bearer token)
 * - Repo format: workspace/repo_slug
 * - API base: api.bitbucket.org/2.0
 * - PR terminology: Pull Request (same as GitHub)
 * - Webhook signature: HMAC-SHA256 in X-Hub-Signature header
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
  CodebaseContext,
  WebhookEvent,
  WebhookEventType,
} from "./types.js";

/**
 * BitBucket-specific API response types
 */
interface BitBucketRef {
  target: { hash: string };
  name: string;
}

interface BitBucketPullRequest {
  id: number;
  links: { html: { href: string } };
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  merge_commit?: { hash: string } | null;
  source: { commit: { hash: string }; branch: { name: string } };
  destination: { branch: { name: string } };
}

interface BitBucketDiffStat {
  values: Array<{ new?: { path: string }; old?: { path: string } }>;
}

interface BitBucketTree {
  values: Array<{ path: string; type: string }>;
  next?: string;
}

interface BitBucketFile {
  data: string;
}

/**
 * BitBucket SCM Provider implementation
 */
export class BitBucketProvider extends BaseScmProvider {
  readonly id: ScmProviderId = "bitbucket";
  readonly displayName = "BitBucket";

  private static readonly API_BASE = "https://api.bitbucket.org/2.0";
  private static readonly USER_AGENT = "WorkerMill-API";

  protected getApiBaseUrl(): string {
    return BitBucketProvider.API_BASE;
  }

  protected buildHeaders(token: string): Record<string, string> {
    // BitBucket uses Basic auth with username:app_password
    // The token should be in format "username:app_password"
    const authHeader = token.includes(":")
      ? `Basic ${Buffer.from(token).toString("base64")}`
      : `Bearer ${token}`; // Fallback for OAuth tokens

    return {
      Authorization: authHeader,
      "Content-Type": "application/json",
      "User-Agent": BitBucketProvider.USER_AGENT,
    };
  }

  /**
   * Get BitBucket credentials from Secrets Manager
   * Expected format: { "username": "...", "app_password": "..." }
   * or just "username:app_password"
   */
  async getToken(): Promise<string | null> {
    const result = await this.getJsonFromSecrets<{
      username?: string;
      app_password?: string;
      token?: string;
    }>(this.getDefaultSecretPath());

    if (!result) return null;

    // Handle JSON format
    if (result.username && result.app_password) {
      return `${result.username}:${result.app_password}`;
    }

    // Handle plain string
    return result.token || null;
  }

  // =========================================================================
  // Repository Operations
  // =========================================================================

  parseRepoIdentifier(repoString: string): ScmRepoIdentifier {
    const parts = repoString.split("/");
    if (parts.length !== 2) {
      logger.warn("Invalid BitBucket repo format", { repoString });
    }
    const [workspace, repoSlug] = parts;
    return {
      owner: workspace || "",
      name: repoSlug || repoString,
      fullPath: repoString,
    };
  }

  getCloneUrl(repo: ScmRepoIdentifier, credentials: ScmCredentials): string {
    const username = credentials.username || "";
    const password = credentials.appPassword || credentials.token || "";
    return `https://${username}:${password}@bitbucket.org/${repo.fullPath}.git`;
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
      logger.warn("Cannot create branch - no BitBucket credentials", {
        repo: repo.fullPath,
        branchName,
      });
      return false;
    }

    // First, get the commit hash of the base branch
    const branchesToTry = [baseBranch];
    if (baseBranch === "main") {
      branchesToTry.push("master");
    } else if (baseBranch === "master") {
      branchesToTry.push("main");
    }

    let targetHash: string | null = null;
    let actualBaseBranch: string | null = null;

    for (const tryBranch of branchesToTry) {
      const result = await this.httpRequest<BitBucketRef>(
        `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/refs/branches/${tryBranch}`,
        { headers: this.buildHeaders(token) },
        `Get branch ${tryBranch}`
      );

      if (result.ok && result.data) {
        targetHash = result.data.target.hash;
        actualBaseBranch = tryBranch;
        break;
      }
    }

    if (!targetHash || !actualBaseBranch) {
      logger.warn("Failed to find base branch", {
        repo: repo.fullPath,
        attempted: branchesToTry,
      });
      return false;
    }

    // Create the new branch
    const createResult = await this.httpRequest<BitBucketRef>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/refs/branches`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          name: branchName,
          target: { hash: targetHash },
        }),
      },
      "Create branch"
    );

    // Check if branch already exists (BitBucket returns 400 with specific error)
    if (
      createResult.status === 400 &&
      createResult.error?.includes("already exists")
    ) {
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

    const result = await this.httpRequest<BitBucketRef>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/refs/branches/${branchName}`,
      { headers: this.buildHeaders(token) },
      "Check branch exists"
    );

    return result.ok;
  }

  async deleteBranch(repo: ScmRepoIdentifier, branchName: string): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot delete branch - no BitBucket credentials", {
        repo: repo.fullPath,
        branchName,
      });
      return false;
    }

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/refs/branches/${branchName}`,
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

    // Get the branch tip
    const branchResult = await this.httpRequest<BitBucketRef>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/refs/branches/${branchName}`,
      { headers: this.buildHeaders(token) },
      "Get branch"
    );

    if (!branchResult.ok || !branchResult.data) return false;

    // Check if commit is an ancestor using the commits endpoint
    // BitBucket doesn't have a direct compare API like GitHub
    // For now, just check if the commit matches the tip
    // A proper implementation would walk the commit history
    return branchResult.data.target.hash.startsWith(commitSha);
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
      logger.warn("Cannot create PR - no BitBucket credentials", {
        repo: repo.fullPath,
      });
      return { success: false, error: "No BitBucket credentials" };
    }

    const result = await this.httpRequest<BitBucketPullRequest>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/pullrequests`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          title: options.title,
          description: options.body,
          source: { branch: { name: options.head } },
          destination: { branch: { name: options.base } },
          close_source_branch: false,
        }),
      },
      "Create PR"
    );

    if (result.status === 400 || result.status === 409) {
      // PR might already exist
      const existing = await this.findPullRequest(repo, options.head, options.base);
      if (existing) {
        logger.info("PR already exists", { repo: repo.fullPath, ...existing });
        return { success: true, ...existing };
      }
      return { success: false, error: result.error || "PR creation failed" };
    }

    if (!result.ok || !result.data) {
      return { success: false, error: result.error };
    }

    const prUrl = result.data.links.html.href;
    const prNumber = result.data.id;

    logger.info("Created pull request", {
      repo: repo.fullPath,
      prUrl,
      prNumber,
    });

    return { success: true, prUrl, prNumber };
  }

  /**
   * Find existing pull request by source and target branch
   */
  private async findPullRequest(
    repo: ScmRepoIdentifier,
    sourceBranch: string,
    targetBranch: string
  ): Promise<{ prUrl: string; prNumber: number } | null> {
    const token = await this.getToken();
    if (!token) return null;

    const result = await this.httpRequest<{ values: BitBucketPullRequest[] }>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/pullrequests?state=OPEN`,
      { headers: this.buildHeaders(token) },
      "Find PR"
    );

    if (!result.ok || !result.data || result.data.values.length === 0) {
      return null;
    }

    // Find PR matching source and target branch
    const pr = result.data.values.find(
      (p) =>
        p.source.branch.name === sourceBranch &&
        p.destination.branch.name === targetBranch
    );

    if (!pr) return null;

    return {
      prUrl: pr.links.html.href,
      prNumber: pr.id,
    };
  }

  async getPullRequestStatus(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestStatus | null> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot get PR status - no BitBucket credentials", {
        repo: repo.fullPath,
        prNumber,
      });
      return null;
    }

    const result = await this.httpRequest<BitBucketPullRequest>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/pullrequests/${prNumber}`,
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
    const stateMap: Record<string, "open" | "closed" | "merged"> = {
      OPEN: "open",
      MERGED: "merged",
      DECLINED: "closed",
      SUPERSEDED: "closed",
    };

    return {
      state: stateMap[pr.state] || "open",
      merged: pr.state === "MERGED",
      mergeable: true, // BitBucket doesn't expose this easily
      mergedAt: pr.merge_commit ? new Date().toISOString() : null, // BitBucket doesn't include merge timestamp
      headSha: pr.source.commit.hash,
    };
  }

  async mergePullRequest(
    repo: ScmRepoIdentifier,
    prNumber: number,
    options?: MergePullRequestOptions
  ): Promise<boolean> {
    const token = await this.getToken();
    if (!token) {
      logger.warn("Cannot merge PR - no BitBucket credentials", {
        repo: repo.fullPath,
        prNumber,
      });
      return false;
    }

    // BitBucket merge strategies
    const mergeStrategyMap: Record<string, string> = {
      merge: "merge_commit",
      squash: "squash",
      rebase: "fast_forward", // BitBucket calls it fast_forward
    };

    const result = await this.httpRequest<unknown>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/pullrequests/${prNumber}/merge`,
      {
        method: "POST",
        headers: this.buildHeaders(token),
        body: JSON.stringify({
          message: options?.commitMessage,
          merge_strategy: mergeStrategyMap[options?.mergeMethod || "squash"],
          close_source_branch: options?.deleteBranch ?? false,
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

    logger.info("Merged pull request", { repo: repo.fullPath, prNumber });
    return true;
  }

  async updatePullRequestBranch(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<UpdateBranchResult> {
    // BitBucket doesn't have a built-in "update branch" API
    // The workaround is to merge destination into source branch manually
    // For now, we'll return a message indicating this needs manual intervention
    logger.warn(
      "BitBucket does not support automatic branch updates - manual merge required",
      { repo: repo.fullPath, prNumber }
    );

    return {
      success: false,
      message:
        "BitBucket requires manual merge of base branch - use git merge locally",
    };
  }

  async getPullRequestConflicts(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestConflicts> {
    const token = await this.getToken();
    if (!token) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // Get diffstat to check for conflicts
    const result = await this.httpRequest<BitBucketDiffStat>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/pullrequests/${prNumber}/diffstat`,
      { headers: this.buildHeaders(token) },
      "Get PR diffstat"
    );

    if (!result.ok || !result.data) {
      return { hasConflicts: false, conflictingFiles: [] };
    }

    // BitBucket API doesn't directly expose conflict status
    // We return the changed files as potentially conflicting
    const files = result.data.values.map(
      (d) => d.new?.path || d.old?.path || ""
    );

    return {
      hasConflicts: false, // Can't determine from API
      conflictingFiles: files.filter(Boolean),
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
      logger.warn("Cannot fetch codebase context - no BitBucket credentials", {
        repo: repo.fullPath,
      });
      return {
        fileTree: "Unable to fetch file tree (no BitBucket credentials)",
        readme: null,
        techStack: null,
      };
    }

    const startTime = Date.now();

    // Step 1: Get file tree
    let fileTree = "Unable to fetch file tree";
    const treeResult = await this.httpRequest<BitBucketTree>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/src/${branch}/?pagelen=100`,
      { headers: this.buildHeaders(token) },
      "Get file tree"
    );

    if (treeResult.ok && treeResult.data) {
      fileTree = this.formatFileTree(repo, branch, treeResult.data.values);
    }

    // Step 2: Get README.md
    let readme: string | null = null;
    const readmeResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/src/${branch}/README.md`,
      { headers: this.buildHeaders(token) },
      "Get README"
    );

    if (readmeResult.ok && readmeResult.data) {
      readme = readmeResult.data as unknown as string;
      if (readme.length > 2000) {
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
    tree: Array<{ path: string; type: string }>
  ): string {
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
    // Try package.json
    const packageResult = await this.httpRequest<string>(
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/src/${branch}/package.json`,
      { headers: this.buildHeaders(token) },
      "Get package.json"
    );

    if (packageResult.ok && packageResult.data) {
      try {
        const packageJson = JSON.parse(
          packageResult.data as unknown as string
        ) as Record<string, unknown>;
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
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/src/${branch}/pyproject.toml`,
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
      `${this.getApiBaseUrl()}/repositories/${repo.fullPath}/src/${branch}/requirements.txt`,
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
  // Webhook Operations
  // =========================================================================

  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    secret: string
  ): boolean {
    // BitBucket uses X-Hub-Signature header with HMAC-SHA256
    const signature = headers["x-hub-signature"];
    if (!signature || !secret) {
      return false;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;

    const expectedSignature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex");

    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>
  ): WebhookEvent | null {
    const eventHeader = headers["x-event-key"];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;

    if (!event) {
      return null;
    }

    const pullrequest = body.pullrequest as BitBucketPullRequest | undefined;
    const repository = body.repository as {
      full_name?: string;
    } | undefined;
    const actor = body.actor as { username?: string } | undefined;

    // Map BitBucket events to normalized types
    let type: WebhookEventType;
    let action = "";

    if (event.startsWith("repo:push")) {
      type = "push";
    } else if (event.startsWith("pullrequest:")) {
      type = "pull_request";
      action = event.replace("pullrequest:", "");
    } else if (event.startsWith("issue:")) {
      type = "issue";
      action = event.replace("issue:", "");
    } else if (event.startsWith("pullrequest:comment")) {
      type = "comment";
    } else {
      return null;
    }

    return {
      type,
      action,
      repository: repository?.full_name || "",
      prNumber: pullrequest?.id,
      prUrl: pullrequest?.links.html.href,
      branch: pullrequest?.source.branch.name,
      sender: actor?.username,
      merged: pullrequest?.state === "MERGED",
      raw: body,
    };
  }
}

/**
 * Get a BitBucket provider instance
 */
export function getBitBucketProvider(orgId?: string): BitBucketProvider {
  return new BitBucketProvider(orgId);
}
