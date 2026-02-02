/**
 * Git Operations for Epic Executor
 *
 * Handles repository cloning, branching, committing, and PR creation.
 * Each story gets its own branch for isolation.
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync } from "fs";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Prior work context from existing branch/PR.
 * Used to inform AI agents about work done in previous retry attempts.
 */
export interface PriorWorkContext {
  branchName: string;
  branchExists: boolean;
  commits: Array<{
    sha: string;
    message: string;
    filesChanged: number;
  }>;
  prNumber?: number;
  prUrl?: string;
  prState?: string;
  prReviewComments?: Array<{
    author: string;
    body: string;
    path?: string;
  }>;
}

/**
 * Configuration for git operations.
 */
export interface GitOpsConfig {
  targetRepo: string;
  githubToken: string;
  workDir: string;
  // Multi-SCM provider support (read from environment)
  scmProvider?: "github" | "gitlab" | "bitbucket";
  scmBaseUrl?: string;
  bitbucketUsername?: string;
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
    // Populate SCM provider settings from environment if not provided
    this.config = {
      ...config,
      scmProvider: config.scmProvider || (process.env.SCM_PROVIDER as GitOpsConfig["scmProvider"]) || "github",
      scmBaseUrl: config.scmBaseUrl || process.env.SCM_BASE_URL,
      bitbucketUsername: config.bitbucketUsername || process.env.BITBUCKET_USERNAME,
    };
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

    // Fetch latest from origin and reset to origin/main to ensure clean state
    // This removes any stale commits/files from previous failed runs
    console.log("[GitOps] Fetching and resetting to origin/main before branch creation...");
    await this.git.fetch(["origin", this.mainBranch]);
    await this.git.checkout(this.mainBranch);
    await this.git.reset(["--hard", `origin/${this.mainBranch}`]);
    await this.git.clean("f", ["-d"]);

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
   * Supports GitHub, GitLab, and BitBucket based on SCM_PROVIDER env var.
   */
  private getAuthenticatedUrl(): string {
    const { targetRepo, githubToken, scmProvider, scmBaseUrl, bitbucketUsername } = this.config;

    // If targetRepo is already a full URL, insert token appropriately
    if (targetRepo.startsWith("https://")) {
      if (scmProvider === "bitbucket" && bitbucketUsername) {
        // BitBucket uses username:token format - URL-encode both (may contain special chars)
        const encodedUsername = encodeURIComponent(bitbucketUsername);
        const encodedPassword = encodeURIComponent(githubToken);
        return targetRepo.replace("https://", `https://${encodedUsername}:${encodedPassword}@`);
      }
      return targetRepo.replace("https://", `https://${githubToken}@`);
    }

    // Build URL from owner/repo format based on SCM provider
    let baseUrl: string;
    let authPrefix: string;

    switch (scmProvider) {
      case "bitbucket":
        baseUrl = scmBaseUrl || "bitbucket.org";
        // BitBucket requires username:app_password format
        if (!bitbucketUsername) {
          throw new Error("BitBucket requires BITBUCKET_USERNAME environment variable");
        }
        // URL-encode both username and password (may contain special chars like @ and =)
        const encodedBbUsername = encodeURIComponent(bitbucketUsername);
        const encodedBbPassword = encodeURIComponent(githubToken);
        authPrefix = `${encodedBbUsername}:${encodedBbPassword}`;
        break;
      case "gitlab":
        baseUrl = scmBaseUrl || "gitlab.com";
        authPrefix = `oauth2:${githubToken}`;
        break;
      case "github":
      default:
        baseUrl = scmBaseUrl || "github.com";
        authPrefix = githubToken;
        break;
    }

    console.log(`[GitOps] Using SCM provider: ${scmProvider}, base: ${baseUrl}`);
    return `https://${authPrefix}@${baseUrl}/${targetRepo}.git`;
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

    // Log available story branches for debugging
    const storyBranches = branches.all.filter((b) => b.includes("/story/"));
    if (storyBranches.length > 0) {
      console.log(`[GitOps] Available story branches: ${storyBranches.join(", ")}`);
    }
    console.log(`[GitOps] Looking for branches with prefix: ${prefix}`);

    const matchingBranches = branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""))
      .sort((a, b) => {
        // Sort by story number
        const numA = parseInt(a.match(/-s(\d+)-/)?.[1] || "0");
        const numB = parseInt(b.match(/-s(\d+)-/)?.[1] || "0");
        return numA - numB;
      });

    console.log(`[GitOps] Found ${matchingBranches.length} matching branches: ${matchingBranches.join(", ") || "none"}`);
    return matchingBranches;
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
      // 0. Fetch all remote refs to ensure we see newly pushed story branches
      // This is critical because story branches are pushed just before this method is called,
      // and without a fetch, git branch -r won't see them
      console.log("[GitOps] Fetching all remote refs before consolidation...");
      await this.git.fetch(["--all"]);

      // 1. Get all story branches
      const storyBranches = await this.getStoryBranches(jiraKey);
      if (storyBranches.length === 0) {
        console.log("[GitOps] No story branches found to consolidate");
        return undefined;
      }

      console.log(`[GitOps] Found ${storyBranches.length} story branches to consolidate`);

      // 2. Reset to origin/main to ensure clean state before creating feature branch
      console.log("[GitOps] Resetting to origin/main before consolidation...");
      await this.git.checkout(this.mainBranch);
      await this.git.reset(["--hard", `origin/${this.mainBranch}`]);
      await this.git.clean("f", ["-d"]);

      const featureBranch = `feature/${jiraKey.toLowerCase()}-epic`;

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
          console.log(`[GitOps] Merged ${storyBranch} successfully`);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.log(`[GitOps] Merge threw, checking result. Error: ${msg}`);

          // simple-git throws on stderr output even for successful merges
          // ALWAYS use git status as source of truth to determine actual conflicts
          try {
            const status = await this.git.status();

            if (status.conflicted.length === 0) {
              // No conflicts - merge succeeded despite the error being thrown
              // This happens with fast-forward merges where git outputs to stderr
              console.log(`[GitOps] Merged ${storyBranch} successfully (verified via git status)`);
              continue; // Move to next branch
            }

            // Real conflicts exist - abort and skip this branch
            console.error(`[GitOps] Real conflict on ${storyBranch}: ${status.conflicted.join(", ")}`);
            try {
              await this.git.merge(["--abort"]);
            } catch {
              // Ignore abort errors
            }
            console.warn(`[GitOps] Skipping ${storyBranch} due to conflicts`);
          } catch (statusError) {
            // Can't determine status - check for known success patterns in error message
            const isLikelySuccess =
              msg.includes("Updating") ||
              msg.includes("Fast-forward") ||
              msg.includes("Already up to date") ||
              msg.includes("Already up-to-date");

            if (isLikelySuccess) {
              console.log(`[GitOps] Merged ${storyBranch} (inferred from message pattern)`);
              continue;
            }

            // Unknown state - log and try to continue
            console.warn(`[GitOps] Could not verify merge status for ${storyBranch}: ${statusError}`);
          }
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
        description += `| **Overall** | **${qualityMetrics.qualityScore}%** | |\n`;
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

  /**
   * Detect and checkout existing branch for retry scenarios.
   * Checks for existing ai/{jiraKey} or feature/{jiraKey}-epic branch.
   * Returns prior work context if found.
   */
  async detectAndCheckoutExistingBranch(jiraKey: string): Promise<PriorWorkContext | null> {
    // Try ai/ branch first (used by multi-provider), then feature/-epic branch
    const branchCandidates = [
      `ai/${jiraKey.toLowerCase()}`,
      `feature/${jiraKey.toLowerCase()}-epic`,
    ];

    console.log(`[GitOps] Checking for existing branches for retry scenario...`);

    try {
      // Fetch all remote branches
      await this.git.fetch("origin");
      const branches = await this.git.branch(["-r"]);

      for (const branchName of branchCandidates) {
        const remoteBranch = `origin/${branchName}`;
        if (branches.all.includes(remoteBranch)) {
          console.log(`[GitOps] Found existing branch: ${branchName}`);

          // Checkout the existing branch
          await this.git.checkout(["-b", branchName, remoteBranch]);
          console.log(`[GitOps] Checked out existing branch: ${branchName}`);

          // Get commit history and PR feedback
          const commits = await this.getCommitHistory(branchName);
          const prInfo = await this.getPrFeedback(branchName);

          return {
            branchName,
            branchExists: true,
            commits,
            prNumber: prInfo?.prNumber,
            prUrl: prInfo?.prUrl,
            prState: prInfo?.prState,
            prReviewComments: prInfo?.reviewComments,
          };
        }
      }

      console.log(`[GitOps] No existing branch found, starting fresh`);
      return null;
    } catch (error) {
      console.warn(`[GitOps] Failed to detect existing branch:`, error);
      return null;
    }
  }

  /**
   * Get commit history for a branch (commits not in main).
   */
  private async getCommitHistory(branchName: string): Promise<PriorWorkContext["commits"]> {
    try {
      // Get commits that are in this branch but not in main
      const logResult = await this.git.log([
        `origin/${this.mainBranch}..${branchName}`,
        "--stat",
      ]);

      const commits: PriorWorkContext["commits"] = [];
      for (const commit of logResult.all) {
        // Count files from diff stat
        let filesChanged = 0;
        if (commit.diff) {
          filesChanged = commit.diff.files?.length || 0;
        }

        commits.push({
          sha: commit.hash,
          message: commit.message,
          filesChanged,
        });
      }

      return commits;
    } catch (error) {
      console.warn("[GitOps] Failed to get commit history:", error);
      return [];
    }
  }

  /**
   * Get PR feedback (review comments) for a branch.
   */
  private async getPrFeedback(branchName: string): Promise<{
    prNumber: number;
    prUrl: string;
    prState: string;
    reviewComments: PriorWorkContext["prReviewComments"];
  } | null> {
    try {
      // Use GitHub CLI to find PR for this branch
      const { stdout: prListOutput } = await execFileAsync(
        "gh",
        ["pr", "list", "--head", branchName, "--json", "number,url,state", "--limit", "1"],
        { cwd: this.repoPath }
      );

      const prs = JSON.parse(prListOutput.trim());
      if (prs.length === 0) {
        return null;
      }

      const pr = prs[0];
      const reviewComments: PriorWorkContext["prReviewComments"] = [];

      // Get PR reviews
      try {
        const { stdout: reviewsOutput } = await execFileAsync(
          "gh",
          ["pr", "view", String(pr.number), "--json", "reviews"],
          { cwd: this.repoPath }
        );

        const reviewsData = JSON.parse(reviewsOutput.trim());
        for (const review of reviewsData.reviews || []) {
          if (review.body && review.body.trim()) {
            reviewComments.push({
              author: review.author?.login || "unknown",
              body: review.body,
            });
          }
        }
      } catch {
        // Reviews fetch failed, continue without them
      }

      // Get inline review comments
      try {
        const { stdout: commentsOutput } = await execFileAsync(
          "gh",
          ["api", `repos/{owner}/{repo}/pulls/${pr.number}/comments`],
          { cwd: this.repoPath }
        );

        const comments = JSON.parse(commentsOutput);
        for (const comment of comments) {
          if (comment.body && comment.body.trim()) {
            reviewComments.push({
              author: comment.user?.login || "unknown",
              body: comment.body,
              path: comment.path,
            });
          }
        }
      } catch {
        // Inline comments fetch failed, continue without them
      }

      return {
        prNumber: pr.number,
        prUrl: pr.url,
        prState: pr.state,
        reviewComments,
      };
    } catch (error) {
      console.warn("[GitOps] Failed to get PR feedback:", error);
      return null;
    }
  }

  /**
   * Format prior work context for injection into prompts.
   */
  formatPriorWorkContext(ctx: PriorWorkContext): string {
    const lines: string[] = [];

    lines.push(`***REMOVED******REMOVED*** 🔄 PRIOR WORK CONTEXT (RETRY SCENARIO)`);
    lines.push(``);
    lines.push(`**IMPORTANT:** This is a RETRY. Previous work exists on branch \`${ctx.branchName}\`.`);
    lines.push(`Do NOT start from scratch. Review what's already done and CONTINUE from there.`);
    lines.push(``);

    // Show commits
    if (ctx.commits.length > 0) {
      lines.push(`***REMOVED******REMOVED******REMOVED*** Previous Commits (${ctx.commits.length} total)`);
      for (const commit of ctx.commits.slice(0, 10)) {
        lines.push(`- \`${commit.sha.substring(0, 7)}\` ${commit.message} (${commit.filesChanged} files)`);
      }
      if (ctx.commits.length > 10) {
        lines.push(`- ... and ${ctx.commits.length - 10} more commits`);
      }
      lines.push(``);
    }

    // Show PR info and review feedback
    if (ctx.prUrl) {
      lines.push(`***REMOVED******REMOVED******REMOVED*** Existing Pull Request`);
      lines.push(`- PR: ${ctx.prUrl}`);
      lines.push(`- Status: ${ctx.prState || "unknown"}`);
      lines.push(``);

      if (ctx.prReviewComments && ctx.prReviewComments.length > 0) {
        lines.push(`***REMOVED******REMOVED******REMOVED*** Review Feedback (CRITICAL - Address These)`);
        lines.push(`The following feedback was given on the previous attempt. **You MUST address these issues:**`);
        lines.push(``);
        for (const comment of ctx.prReviewComments) {
          if (comment.path) {
            lines.push(`- **${comment.author}** on \`${comment.path}\`:`);
          } else {
            lines.push(`- **${comment.author}**:`);
          }
          lines.push(`  > ${comment.body.replace(/\n/g, "\n  > ")}`);
          lines.push(``);
        }
      }
    }

    lines.push(`***REMOVED******REMOVED******REMOVED*** Your Instructions for This Retry`);
    lines.push(`1. **Review existing code** - Check what's already implemented on this branch`);
    lines.push(`2. **Check git log** - See what commits were made: \`git log --oneline -10\``);
    lines.push(`3. **Address feedback** - If there are review comments above, fix those issues first`);
    lines.push(`4. **Continue work** - Only implement what's missing or broken`);
    lines.push(`5. **Commit incrementally** - Make small, focused commits`);
    lines.push(``);

    return lines.join("\n") + "\n";
  }
}
