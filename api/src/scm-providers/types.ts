/**
 * SCM Provider Types
 *
 * Core interfaces and types for the multi-SCM provider abstraction layer.
 * Supports GitHub, GitLab, and BitBucket.
 */

/**
 * Supported SCM provider identifiers
 */
export type ScmProviderId = "github" | "gitlab" | "bitbucket";

/**
 * Parsed repository identifier with owner/namespace and repo name
 */
export interface ScmRepoIdentifier {
  /** Repository owner or namespace (e.g., "acme-org" or "mygroup/subgroup") */
  owner: string;
  /** Repository name (e.g., "my-app") */
  name: string;
  /** Full repository path (e.g., "acme-org/my-app") */
  fullPath: string;
}

/**
 * Pull/Merge Request creation options
 */
export interface CreatePullRequestOptions {
  /** PR/MR title */
  title: string;
  /** PR/MR body/description */
  body: string;
  /** Source branch name */
  head: string;
  /** Target branch name (default: main) */
  base: string;
  /** Draft PR (GitHub/GitLab only) */
  draft?: boolean;
}

/**
 * Pull/Merge Request creation result
 */
export interface CreatePullRequestResult {
  success: boolean;
  /** URL to the PR/MR */
  prUrl?: string;
  /** PR/MR number/IID */
  prNumber?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Pull/Merge Request status
 */
export interface PullRequestStatus {
  /** State: open, closed, merged */
  state: "open" | "closed" | "merged";
  /** Whether the PR has been merged */
  merged: boolean;
  /** Whether the PR can be merged (no conflicts) */
  mergeable: boolean | null;
  /** Timestamp when merged */
  mergedAt: string | null;
  /** Head commit SHA */
  headSha: string;
  /** Approval status */
  approved?: boolean;
  /** Number of approvals */
  approvalCount?: number;
}

/**
 * Merge options for Pull/Merge Requests
 */
export interface MergePullRequestOptions {
  /** Commit title for the merge */
  commitTitle?: string;
  /** Commit message/description */
  commitMessage?: string;
  /** Merge method */
  mergeMethod?: "merge" | "squash" | "rebase";
  /** Delete source branch after merge */
  deleteBranch?: boolean;
}

/**
 * Codebase context for planning agent
 */
export interface CodebaseContext {
  /** File tree structure (2 levels deep) */
  fileTree: string;
  /** README.md content (truncated) */
  readme: string | null;
  /** Tech stack info from package.json, pyproject.toml, etc. */
  techStack: Record<string, unknown> | null;
}

/**
 * Webhook event types supported across providers
 */
export type WebhookEventType =
  | "push"
  | "pull_request"
  | "pull_request_review"
  | "merge_request" // GitLab terminology
  | "issue"
  | "comment";

/**
 * Normalized webhook event payload
 */
export interface WebhookEvent {
  /** Event type */
  type: WebhookEventType;
  /** Action (e.g., "opened", "approved", "merged") */
  action: string;
  /** Repository full name */
  repository: string;
  /** PR/MR number if applicable */
  prNumber?: number;
  /** PR/MR URL if applicable */
  prUrl?: string;
  /** Branch name if applicable */
  branch?: string;
  /** User who triggered the event */
  sender?: string;
  /** Whether PR was merged (for closed events) */
  merged?: boolean;
  /** Review state for review events */
  reviewState?: "approved" | "changes_requested" | "commented";
  /** Raw provider-specific payload */
  raw: Record<string, unknown>;
}

/**
 * Token/credential configuration for a provider
 */
export interface ScmCredentials {
  /** Access token (GitHub, GitLab) */
  token?: string;
  /** Username for basic auth (BitBucket) */
  username?: string;
  /** App password for basic auth (BitBucket) */
  appPassword?: string;
}

/**
 * Provider configuration
 */
export interface ScmProviderConfig {
  /** Provider ID */
  providerId: ScmProviderId;
  /** Base URL for API calls (for self-hosted instances) */
  baseUrl?: string;
  /** Credentials */
  credentials: ScmCredentials;
  /** Webhook secret for signature verification */
  webhookSecret?: string;
}

/**
 * Branch update result
 */
export interface UpdateBranchResult {
  success: boolean;
  message: string;
}

/**
 * PR conflicts information
 */
export interface PullRequestConflicts {
  hasConflicts: boolean;
  conflictingFiles: string[];
}

/**
 * CI/CD commit status (normalized across providers)
 *
 * Maps provider-specific states:
 * - GitHub: success/failure/error/pending → passed/failed/failed/pending
 * - BitBucket: SUCCESSFUL/FAILED/STOPPED/INPROGRESS → passed/failed/failed/pending
 * - GitLab: success/failed/canceled/running/pending → passed/failed/failed/pending/pending
 */
export interface CommitStatus {
  /** Normalized status */
  state: "passed" | "failed" | "pending";
  /** Check/pipeline name */
  name: string;
  /** URL to the check details */
  url?: string;
  /** Provider-specific raw state (e.g. "SUCCESSFUL", "success") */
  rawState: string;
}

/**
 * Core SCM Provider interface
 *
 * All SCM providers must implement this interface to provide a consistent
 * abstraction layer for GitHub, GitLab, and BitBucket operations.
 */
export interface IScmProvider {
  /** Provider identifier */
  readonly id: ScmProviderId;

  /** Display name for the provider */
  readonly displayName: string;

  // =========================================================================
  // Repository Operations
  // =========================================================================

  /**
   * Parse a repository string into structured identifier
   * @param repoString - Repository string (e.g., "owner/repo" or "group/subgroup/repo")
   */
  parseRepoIdentifier(repoString: string): ScmRepoIdentifier;

  /**
   * Generate clone URL for a repository with embedded credentials
   * @param repo - Repository identifier
   * @param credentials - Access credentials
   */
  getCloneUrl(repo: ScmRepoIdentifier, credentials: ScmCredentials): string;

  // =========================================================================
  // Branch Operations
  // =========================================================================

  /**
   * Create a new branch from a base branch
   * @param repo - Repository identifier
   * @param branchName - Name for the new branch
   * @param baseBranch - Base branch to branch from (default: main)
   */
  createBranch(
    repo: ScmRepoIdentifier,
    branchName: string,
    baseBranch?: string
  ): Promise<boolean>;

  /**
   * Check if a branch exists
   * @param repo - Repository identifier
   * @param branchName - Branch name to check
   */
  branchExists(repo: ScmRepoIdentifier, branchName: string): Promise<boolean>;

  /**
   * Delete a branch
   * @param repo - Repository identifier
   * @param branchName - Branch name to delete
   */
  deleteBranch(repo: ScmRepoIdentifier, branchName: string): Promise<boolean>;

  /**
   * Check if a branch contains a specific commit
   * @param repo - Repository identifier
   * @param branchName - Branch name
   * @param commitSha - Commit SHA to check
   */
  branchContainsCommit(
    repo: ScmRepoIdentifier,
    branchName: string,
    commitSha: string
  ): Promise<boolean>;

  // =========================================================================
  // Pull/Merge Request Operations
  // =========================================================================

  /**
   * Create a pull/merge request
   * @param repo - Repository identifier
   * @param options - PR creation options
   */
  createPullRequest(
    repo: ScmRepoIdentifier,
    options: CreatePullRequestOptions
  ): Promise<CreatePullRequestResult>;

  /**
   * Get pull/merge request status
   * @param repo - Repository identifier
   * @param prNumber - PR/MR number
   */
  getPullRequestStatus(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestStatus | null>;

  /**
   * Merge a pull/merge request
   * @param repo - Repository identifier
   * @param prNumber - PR/MR number
   * @param options - Merge options
   */
  mergePullRequest(
    repo: ScmRepoIdentifier,
    prNumber: number,
    options?: MergePullRequestOptions
  ): Promise<boolean>;

  /**
   * Update a PR branch with latest from base branch
   * @param repo - Repository identifier
   * @param prNumber - PR/MR number
   */
  updatePullRequestBranch(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<UpdateBranchResult>;

  /**
   * Get PR merge conflict details
   * @param repo - Repository identifier
   * @param prNumber - PR/MR number
   */
  getPullRequestConflicts(
    repo: ScmRepoIdentifier,
    prNumber: number
  ): Promise<PullRequestConflicts>;

  // =========================================================================
  // Context Operations (for Planning Agent)
  // =========================================================================

  /**
   * Fetch codebase context for planning agent
   * Retrieves file tree, README, and tech stack info
   * @param repo - Repository identifier
   * @param branch - Branch to fetch from (default: main)
   */
  fetchCodebaseContext(
    repo: ScmRepoIdentifier,
    branch?: string
  ): Promise<CodebaseContext>;

  // =========================================================================
  // CI/CD Status Operations
  // =========================================================================

  /**
   * Get commit statuses/check-runs for a specific commit SHA.
   * Returns normalized status across all CI providers.
   * @param repo - Repository identifier
   * @param commitSha - The commit SHA to check
   */
  getCommitStatuses(
    repo: ScmRepoIdentifier,
    commitSha: string
  ): Promise<CommitStatus[]>;

  // =========================================================================
  // Webhook Operations
  // =========================================================================

  /**
   * Verify webhook signature
   * @param headers - Request headers
   * @param body - Raw request body
   * @param secret - Webhook secret
   */
  verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    body: string,
    secret: string
  ): boolean;

  /**
   * Parse webhook event into normalized format
   * @param headers - Request headers
   * @param body - Request body (parsed JSON)
   */
  parseWebhookEvent(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>
  ): WebhookEvent | null;
}
