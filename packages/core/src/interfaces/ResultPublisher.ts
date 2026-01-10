/**
 * ResultPublisher Interface
 *
 * Abstraction for publishing task results (GitHub, GitLab, Bitbucket, etc.)
 * Implement this interface to integrate with different git hosting platforms.
 */

export interface PullRequest {
  number: number;
  url: string;
  branch: string;
  title: string;
  status: "open" | "merged" | "closed";
  approved: boolean;
  approvedBy?: string;
}

export interface BranchInfo {
  name: string;
  sha: string;
  url: string;
}

export interface ResultPublisherConfig {
  token: string;
  owner?: string;
  repo?: string;
  [key: string]: any;
}

export interface ResultPublisher {
  /**
   * Initialize the publisher connection
   */
  initialize(config: ResultPublisherConfig): Promise<void>;

  /**
   * Create a new branch from the default branch
   */
  createBranch(name: string): Promise<BranchInfo>;

  /**
   * Get information about a pull request
   */
  getPullRequest(repo: string, prNumber: number): Promise<PullRequest | null>;

  /**
   * Check if a PR has been approved
   */
  isPrApproved(repo: string, prNumber: number): Promise<boolean>;

  /**
   * Get the approver's username
   */
  getPrApprover(repo: string, prNumber: number): Promise<string | null>;

  /**
   * Merge a pull request
   */
  mergePullRequest(repo: string, prNumber: number): Promise<boolean>;
}

/**
 * Null implementation for when no result publisher is configured
 */
export class NullResultPublisher implements ResultPublisher {
  async initialize(): Promise<void> {}

  async createBranch(name: string): Promise<BranchInfo> {
    return { name, sha: "", url: "" };
  }

  async getPullRequest(): Promise<PullRequest | null> {
    return null;
  }

  async isPrApproved(): Promise<boolean> {
    return false;
  }

  async getPrApprover(): Promise<string | null> {
    return null;
  }

  async mergePullRequest(): Promise<boolean> {
    return false;
  }
}
