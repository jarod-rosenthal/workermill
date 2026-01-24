/**
 * Git Operations for Epic Executor
 *
 * Handles repository cloning, branching, committing, and PR creation.
 * Each story gets its own branch for isolation.
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync } from "fs";
import path from "path";

/**
 * Configuration for git operations.
 */
export interface GitOpsConfig {
  targetRepo: string;
  githubToken: string;
  workDir: string;
}

/**
 * Git operations manager for Epic executor.
 */
export class GitOps {
  private git: SimpleGit;
  private config: GitOpsConfig;
  private repoPath: string;
  private mainBranch: string = "main";

  constructor(config: GitOpsConfig) {
    this.config = config;
    this.repoPath = path.join(config.workDir, "repo");

    // Create directories if they don't exist
    // Both workDir and repoPath must exist before initializing simpleGit
    if (!existsSync(config.workDir)) {
      mkdirSync(config.workDir, { recursive: true });
    }
    if (!existsSync(this.repoPath)) {
      mkdirSync(this.repoPath, { recursive: true });
    }

    const options: Partial<SimpleGitOptions> = {
      baseDir: this.repoPath,
      binary: "git",
      maxConcurrentProcesses: 1,
      trimmed: false,
    };

    this.git = simpleGit(options);
  }

  /**
   * Clone the target repository if not already cloned.
   */
  async cloneIfNeeded(): Promise<void> {
    if (existsSync(path.join(this.repoPath, ".git"))) {
      console.log("[GitOps] Repository already cloned, pulling latest...");
      await this.git.cwd(this.repoPath);
      // Ensure git identity is configured (may not be set from previous run)
      await this.git.addConfig("user.name", "WorkerMill Epic Agent");
      await this.git.addConfig("user.email", "epic@workermill.ai");
      await this.git.fetch("origin");
      await this.git.checkout(this.mainBranch);
      await this.git.pull("origin", this.mainBranch);
      return;
    }

    console.log("[GitOps] Cloning " + this.config.targetRepo + "...");
    const repoUrl = this.getAuthenticatedUrl();

    // Note: repoPath directory is already created in constructor
    await simpleGit().clone(repoUrl, this.repoPath);
    await this.git.cwd(this.repoPath);

    // Configure git identity for commits
    await this.git.addConfig("user.name", "WorkerMill Epic Agent");
    await this.git.addConfig("user.email", "epic@workermill.ai");
    console.log("[GitOps] Configured git identity");

    // Detect main branch (could be main or master)
    const branches = await this.git.branch(["-r"]);
    if (branches.all.includes("origin/main")) {
      this.mainBranch = "main";
    } else if (branches.all.includes("origin/master")) {
      this.mainBranch = "master";
    }

    console.log("[GitOps] Repository cloned, main branch: " + this.mainBranch);
  }

  /**
   * Create a branch for a story.
   */
  async createStoryBranch(
    storyIndex: number,
    storyTitle: string,
    jiraKey?: string
  ): Promise<string> {
    const branchName = this.generateBranchName(storyIndex, storyTitle, jiraKey);

    // Ensure we're on main and up to date
    await this.git.checkout(this.mainBranch);
    await this.git.pull("origin", this.mainBranch);

    // Check if branch already exists
    const branches = await this.git.branch(["-a"]);
    if (branches.all.includes(branchName)) {
      console.log("[GitOps] Branch " + branchName + " already exists, checking out...");
      await this.git.checkout(branchName);
      return branchName;
    }

    // Create new branch
    await this.git.checkoutBranch(branchName, this.mainBranch);
    console.log("[GitOps] Created branch: " + branchName);

    return branchName;
  }

  /**
   * Generate a branch name for a story.
   */
  private generateBranchName(
    storyIndex: number,
    storyTitle: string,
    jiraKey?: string
  ): string {
    // Sanitize title for branch name
    const sanitizedTitle = storyTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 30);

    if (jiraKey) {
      return "story/" + jiraKey.toLowerCase() + "-s" + storyIndex + "-" + sanitizedTitle;
    }
    return "story/s" + storyIndex + "-" + sanitizedTitle;
  }

  /**
   * Commit changes with proper attribution.
   */
  async commitChanges(
    message: string,
    persona: string,
    storyIndex: number
  ): Promise<string> {
    // Stage all changes
    await this.git.add(".");

    // Check if there are changes to commit
    const status = await this.git.status();
    if (status.staged.length === 0) {
      console.log("[GitOps] No changes to commit");
      return "";
    }

    // Format commit message with attribution
    const formattedMessage = message + "\n\nStory: S" + storyIndex + "\nCo-Authored-By: " + this.formatPersonaForCommit(persona);

    const result = await this.git.commit(formattedMessage);
    console.log("[GitOps] Committed: " + result.commit);

    return result.commit;
  }

  /**
   * Format persona for commit co-author line.
   */
  private formatPersonaForCommit(persona: string): string {
    const nameMap: Record<string, string> = {
      frontend_developer: "Frontend Developer <frontend@workermill.ai>",
      backend_developer: "Backend Developer <backend@workermill.ai>",
      security_engineer: "Security Engineer <security@workermill.ai>",
      qa_engineer: "QA Engineer <qa@workermill.ai>",
      devops_engineer: "DevOps Engineer <devops@workermill.ai>",
    };
    return nameMap[persona] ?? (persona + " <" + persona + "@workermill.ai>");
  }

  /**
   * Push branch to remote.
   */
  async pushBranch(branchName: string): Promise<void> {
    await this.git.push("origin", branchName, ["--set-upstream"]);
    console.log("[GitOps] Pushed branch: " + branchName);
  }

  /**
   * Create a pull request (returns the PR creation command).
   * The actual PR creation is done via gh CLI for proper authentication.
   */
  async getPrCreationCommand(
    branchName: string,
    title: string,
    body: string
  ): Promise<string> {
    return 'gh pr create --base ' + this.mainBranch + ' --head ' + branchName + ' --title "' + title + '" --body "' + body.replace(/"/g, '\\"') + '"';
  }

  /**
   * Check for merge conflicts with main.
   */
  async checkForConflicts(branchName: string): Promise<boolean> {
    try {
      await this.git.checkout(branchName);
      await this.git.fetch("origin", this.mainBranch);

      // Try a merge dry-run
      const result = await this.git.raw([
        "merge",
        "--no-commit",
        "--no-ff",
        "origin/" + this.mainBranch,
      ]);

      // Abort the merge
      await this.git.raw(["merge", "--abort"]);

      return false; // No conflicts
    } catch (error) {
      // Abort any partial merge
      try {
        await this.git.raw(["merge", "--abort"]);
      } catch {
        // Ignore abort errors
      }
      return true; // Has conflicts
    }
  }

  /**
   * Get the authenticated URL for cloning.
   */
  private getAuthenticatedUrl(): string {
    const { targetRepo, githubToken } = this.config;

    if (targetRepo.startsWith("https://")) {
      // Insert token into URL
      return targetRepo.replace(
        "https://",
        "https://" + githubToken + "@"
      );
    }

    // Assume owner/repo format
    return "https://" + githubToken + "@github.com/" + targetRepo + ".git";
  }

  /**
   * Get the repository path.
   */
  getRepoPath(): string {
    return this.repoPath;
  }

  /**
   * Get current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    const branch = await this.git.revparse(["--abbrev-ref", "HEAD"]);
    return branch.trim();
  }

  /**
   * Get list of modified files.
   */
  async getModifiedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [...status.modified, ...status.created, ...status.renamed.map(r => r.to)];
  }
}
