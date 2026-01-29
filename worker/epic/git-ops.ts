/**
 * Git Operations for Epic Executor
 *
 * Handles repository cloning, branching, committing, and PR creation.
 * Each story gets its own branch for isolation.
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

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
   * Get list of modified files (uncommitted changes in working tree).
   */
  async getModifiedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [...status.modified, ...status.created, ...status.renamed.map(r => r.to)];
  }

  /**
   * Check if current branch has commits ahead of main.
   * This detects commits made by the agent that need to be pushed.
   */
  async hasCommitsAheadOfMain(): Promise<boolean> {
    try {
      // Fetch latest from origin to ensure we have current state
      await this.git.fetch("origin", this.mainBranch);

      // Count commits on current branch that aren't on origin/main
      const currentBranch = await this.getCurrentBranch();
      const result = await this.git.raw([
        "rev-list",
        "--count",
        `origin/${this.mainBranch}..${currentBranch}`,
      ]);

      const commitsAhead = parseInt(result.trim(), 10);
      return commitsAhead > 0;
    } catch (error) {
      console.warn("[GitOps] Could not check commits ahead:", error);
      return false;
    }
  }

  /**
   * Get list of files changed in commits on current branch vs main.
   * This shows all files modified by the agent, even if already committed.
   */
  async getFilesChangedVsMain(): Promise<string[]> {
    try {
      const result = await this.git.raw([
        "diff",
        "--name-only",
        `origin/${this.mainBranch}...HEAD`,
      ]);

      return result
        .split("\n")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } catch (error) {
      console.warn("[GitOps] Could not get files changed vs main:", error);
      return [];
    }
  }

  /**
   * Create a pull request using the execution script.
   * Returns the PR URL if successful, undefined otherwise.
   */
  async createPullRequest(
    storyIndex: number,
    storyTitle: string,
    jiraKey?: string
  ): Promise<string | undefined> {
    const ticketKey = jiraKey || `Epic-S${storyIndex}`;
    const ticketSummary = `Story ${storyIndex}: ${storyTitle}`;

    const env = {
      ...process.env,
      TICKET_KEY: ticketKey,
      TICKET_SUMMARY: ticketSummary,
      REPO_PATH: this.repoPath,
      BASE_BRANCH: this.mainBranch,
      DESCRIPTION: `Epic story implementation.\n\nStory ${storyIndex}: ${storyTitle}`,
    };

    try {
      const { stdout } = await execFileAsync(
        "node",
        ["/app/execution-compiled/git/create_pr.js"],
        { env, cwd: this.repoPath }
      );

      // Parse JSON output from the script
      const result = JSON.parse(stdout.trim());

      if (result.success && result.prUrl) {
        console.log(`[GitOps] PR created: ${result.prUrl}`);
        return result.prUrl;
      } else {
        console.warn(`[GitOps] PR creation returned: ${result.error || "unknown error"}`);
        return undefined;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[GitOps] PR creation failed: ${msg}`);
      // Don't crash - PR creation is best-effort
      return undefined;
    }
  }

  /**
   * Get all story branches for this epic.
   * Story branches follow the pattern: story/<jiraKey>-s<N>-* or story/s<N>-*
   */
  async getStoryBranches(jiraKey?: string): Promise<string[]> {
    const branches = await this.git.branch(["-r"]);
    const prefix = jiraKey
      ? `origin/story/${jiraKey.toLowerCase()}-s`
      : "origin/story/s";

    return branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""))
      .sort((a, b) => {
        // Sort by story number
        const numA = parseInt(a.match(/-s(\d+)-/)?.[1] || "0");
        const numB = parseInt(b.match(/-s(\d+)-/)?.[1] || "0");
        return numA - numB;
      });
  }

  /**
   * Create a consolidated PR that merges all story branches.
   * Creates a feature branch, merges all story branches into it, then creates a PR.
   */
  async createConsolidatedPR(
    jiraKey: string,
    epicTitle: string,
    storyCompletions: Array<{ storyIndex: number; title: string; filesModified?: string[] }>,
    qualityMetrics?: {
      qualityScore: number;
      qualityGrade: string;
      lintErrors: number;
      lintWarnings: number;
      typeErrors: number;
      testsPassed: number;
      testsFailed: number;
      securityHigh: number;
      securityMedium: number;
      securityLow: number;
    }
  ): Promise<string | undefined> {
    try {
      // 1. Get all story branches
      const storyBranches = await this.getStoryBranches(jiraKey);
      if (storyBranches.length === 0) {
        console.log("[GitOps] No story branches found to consolidate");
        return undefined;
      }

      console.log(`[GitOps] Found ${storyBranches.length} story branches to consolidate`);

      // 2. Create feature branch from main
      const featureBranch = `feature/${jiraKey.toLowerCase()}-epic`;
      await this.git.checkout(this.mainBranch);
      await this.git.pull("origin", this.mainBranch);

      // Delete local feature branch if it exists
      try {
        await this.git.branch(["-D", featureBranch]);
      } catch {
        // Branch doesn't exist locally, that's fine
      }

      await this.git.checkoutBranch(featureBranch, this.mainBranch);
      console.log(`[GitOps] Created feature branch: ${featureBranch}`);

      // 3. Merge each story branch into the feature branch
      for (const storyBranch of storyBranches) {
        console.log(`[GitOps] Merging ${storyBranch}...`);
        try {
          await this.git.merge([`origin/${storyBranch}`, "--no-edit"]);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[GitOps] Merge conflict on ${storyBranch}: ${msg}`);
          // Abort merge and continue with what we have
          try {
            await this.git.merge(["--abort"]);
          } catch {
            // Ignore abort errors
          }
          console.warn(`[GitOps] Skipping ${storyBranch} due to conflicts`);
        }
      }

      // 4. Push the feature branch
      await this.git.push("origin", featureBranch, ["--set-upstream", "--force"]);
      console.log(`[GitOps] Pushed feature branch: ${featureBranch}`);

      // 4.5. Check if a PR already exists for this branch
      try {
        const { stdout: existingPrJson } = await execFileAsync(
          "gh",
          ["pr", "view", featureBranch, "--json", "url"],
          { cwd: this.repoPath }
        );
        const existingPr = JSON.parse(existingPrJson.trim());
        if (existingPr.url) {
          console.log(`[GitOps] PR already exists for ${featureBranch}: ${existingPr.url}`);
          return existingPr.url;
        }
      } catch {
        // No existing PR found, proceed to create one
        console.log(`[GitOps] No existing PR for ${featureBranch}, creating new one...`);
      }

      // 5. Build PR description
      let description = `***REMOVED******REMOVED*** Epic Implementation\n\n`;
      description += `This PR consolidates all stories from Epic ${jiraKey}.\n\n`;
      description += `***REMOVED******REMOVED******REMOVED*** Stories Included\n\n`;
      for (const story of storyCompletions) {
        description += `- **Story ${story.storyIndex}**: ${story.title}\n`;
        if (story.filesModified && story.filesModified.length > 0) {
          const filesList = story.filesModified.slice(0, 3).join(", ");
          const moreCount = story.filesModified.length > 3 ? ` (+${story.filesModified.length - 3} more)` : "";
          description += `  - Files: ${filesList}${moreCount}\n`;
        }
      }
      description += `\n***REMOVED******REMOVED******REMOVED*** Branches Merged\n\n`;
      for (const branch of storyBranches) {
        description += `- \`${branch}\`\n`;
      }

      // Add quality metrics if available
      if (qualityMetrics) {
        description += `\n***REMOVED******REMOVED******REMOVED*** Code Quality\n\n`;
        description += `| Metric | Score | Details |\n`;
        description += `|--------|-------|--------|\n`;
        description += `| **Overall** | ${qualityMetrics.qualityScore}/100 ${qualityMetrics.qualityGrade} | |\n`;
        description += `| TypeCheck | ${qualityMetrics.typeErrors === 0 ? '✅ Pass' : `❌ ${qualityMetrics.typeErrors} errors`} | |\n`;
        description += `| Lint | ${qualityMetrics.lintErrors === 0 ? '✅ Pass' : `⚠️ ${qualityMetrics.lintErrors} errors`} | ${qualityMetrics.lintWarnings} warnings |\n`;
        description += `| Tests | ${qualityMetrics.testsFailed === 0 ? '✅ Pass' : `❌ ${qualityMetrics.testsFailed} failed`} | ${qualityMetrics.testsPassed} passed |\n`;
        description += `| Security | ${qualityMetrics.securityHigh === 0 ? '✅ Clean' : `🔴 ${qualityMetrics.securityHigh} high`} | ${qualityMetrics.securityMedium}M/${qualityMetrics.securityLow}L |\n`;
      }

      // 6. Create the PR using the execution script
      const env = {
        ...process.env,
        TICKET_KEY: jiraKey,
        TICKET_SUMMARY: epicTitle,
        REPO_PATH: this.repoPath,
        BASE_BRANCH: this.mainBranch,
        DESCRIPTION: description,
      };

      const { stdout, stderr } = await execFileAsync(
        "node",
        ["/app/execution-compiled/git/create_pr.js"],
        { env, cwd: this.repoPath }
      );

      // Log stderr for debugging (contains [create_pr] messages)
      if (stderr) {
        stderr.split("\n").forEach((line) => {
          if (line.trim()) console.log(line);
        });
      }

      const result = JSON.parse(stdout.trim());

      if (result.success && result.prUrl) {
        console.log(`[GitOps] Consolidated PR created: ${result.prUrl}`);
        return result.prUrl;
      } else {
        console.error(`[GitOps] Consolidated PR creation failed: ${result.error || "unknown error"}`);
        return undefined;
      }
    } catch (error) {
      // Extract detailed error info
      const execError = error as { stdout?: string; stderr?: string; message: string };
      const msg = execError.message || String(error);

      // Log stderr if available (contains [create_pr] messages)
      if (execError.stderr) {
        execError.stderr.split("\n").forEach((line) => {
          if (line.trim()) console.error(line);
        });
      }

      // Try to parse JSON output for more detail
      if (execError.stdout) {
        try {
          const result = JSON.parse(execError.stdout.trim());
          if (result.error) {
            console.error(`[GitOps] PR creation error detail: ${result.error}`);
          }
        } catch {
          // stdout wasn't valid JSON
        }
      }

      console.error(`[GitOps] Failed to create consolidated PR: ${msg}`);
      return undefined;
    }
  }
}
