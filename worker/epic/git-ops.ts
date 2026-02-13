/**
 * Git Operations for Epic Executor
 *
 * Handles repository cloning, branching, committing, and PR creation.
 * Each story gets its own branch for isolation.
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync } from "fs";
import { execFile, execSync, spawn } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import * as https from "https";
import type { ResilienceConfig } from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * Build the correct Authorization header for Bitbucket API calls.
 * API Tokens (ATATT prefix) require email:token Basic auth.
 * Repository Access Tokens use Bearer auth.
 */
function getBitbucketAuthHeader(token: string): string {
  const bitbucketEmail = process.env.BITBUCKET_EMAIL;

  // API Tokens (start with ATATT) require email:token Basic auth
  if (bitbucketEmail) {
    const credentials = Buffer.from(`${bitbucketEmail}:${token}`).toString("base64");
    return `Basic ${credentials}`;
  }

  // Fallback to Bearer (for Repository Access Tokens)
  return `Bearer ${token}`;
}

/**
 * Create a PR using Bitbucket REST API directly (bypasses subprocess issues)
 */
async function createBitbucketPRDirect(
  workspace: string,
  repoSlug: string,
  title: string,
  sourceBranch: string,
  destBranch: string,
  description: string,
  token: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests`;

  const body = JSON.stringify({
    title,
    source: { branch: { name: sourceBranch } },
    destination: { branch: { name: destBranch } },
    description,
    close_source_branch: false,
  });

  const authHeader = getBitbucketAuthHeader(token);

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 201) {
          try {
            const pr = JSON.parse(data);
            resolve({
              prUrl: pr.links.html.href,
              prNumber: pr.id,
            });
          } catch {
            reject(new Error(`Failed to parse Bitbucket response: ${data}`));
          }
        } else if (res.statusCode === 409) {
          // PR already exists - return null to trigger search
          resolve(null);
        } else {
          reject(new Error(`Bitbucket API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

/**
 * Find existing Bitbucket PR for a branch
 */
async function findExistingBitbucketPR(
  workspace: string,
  repoSlug: string,
  sourceBranch: string,
  token: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests?q=source.branch.name="${sourceBranch}"&state=OPEN`;
  const authHeader = getBitbucketAuthHeader(token);

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: { Authorization: authHeader },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const response = JSON.parse(data);
            if (response.values && response.values.length > 0) {
              const pr = response.values[0];
              resolve({ prUrl: pr.links.html.href, prNumber: pr.id });
            } else {
              resolve(null);
            }
          } catch {
            reject(new Error(`Failed to parse Bitbucket search response: ${data}`));
          }
        } else {
          reject(new Error(`Bitbucket API search error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.end();
  });
}

/**
 * Create a PR using GitHub REST API directly (bypasses subprocess/gh CLI issues)
 */
async function createGitHubPRDirect(
  owner: string,
  repo: string,
  title: string,
  sourceBranch: string,
  baseBranch: string,
  body: string,
  token: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const apiPath = `/repos/${owner}/${repo}/pulls`;

  const requestBody = JSON.stringify({
    title,
    head: sourceBranch,
    base: baseBranch,
    body,
  });

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      path: apiPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "WorkerMill-Epic-Agent",
        Accept: "application/vnd.github+json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 201) {
          try {
            const pr = JSON.parse(data);
            resolve({ prUrl: pr.html_url, prNumber: pr.number });
          } catch {
            reject(new Error(`Failed to parse GitHub response: ${data}`));
          }
        } else if (res.statusCode === 422) {
          // PR may already exist
          resolve(null);
        } else {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(requestBody);
    req.end();
  });
}

/**
 * Find existing GitHub PR for a branch
 */
async function findExistingGitHubPR(
  owner: string,
  repo: string,
  sourceBranch: string,
  token: string
): Promise<{ prUrl: string; prNumber: number } | null> {
  const apiPath = `/repos/${owner}/${repo}/pulls?head=${owner}:${sourceBranch}&state=open`;

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: "api.github.com",
      path: apiPath,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "WorkerMill-Epic-Agent",
        Accept: "application/vnd.github+json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const prs = JSON.parse(data);
            if (prs && prs.length > 0) {
              resolve({ prUrl: prs[0].html_url, prNumber: prs[0].number });
            } else {
              resolve(null);
            }
          } catch {
            reject(new Error(`Failed to parse GitHub search response: ${data}`));
          }
        } else {
          reject(new Error(`GitHub API search error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.end();
  });
}

/**
 * Get the path to execution scripts.
 * In Docker: /app/execution-compiled/
 * In local mode: relative to this file's location or WORKER_DIR env var
 */
function getExecutionScriptPath(scriptName: string): string {
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  // First, check if WORKER_DIR is set (explicit override for local mode)
  const workerDir = process.env.WORKER_DIR;
  if (workerDir) {
    const explicitPath = path.join(workerDir, "execution-compiled", scriptName);
    console.log(`[GitOps] Using WORKER_DIR script path: ${explicitPath}`);
    if (existsSync(explicitPath)) {
      return explicitPath;
    }
    console.warn(`[GitOps] Script not found at WORKER_DIR path, trying fallbacks...`);
  }

  if (isLocalMode) {
    // Local mode: use path relative to this file
    // git-ops.ts is at worker/epic/git-ops.ts
    // scripts are at worker/execution-compiled/
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const localPath = path.join(__dirname, "..", "execution-compiled", scriptName);
      console.log(`[GitOps] Using local execution script: ${localPath}`);
      if (existsSync(localPath)) {
        return localPath;
      }
      console.warn(`[GitOps] Script not found at ${localPath}, trying Docker path...`);
    } catch (e) {
      console.warn(`[GitOps] Could not resolve local path: ${e}`);
    }
  }

  // Docker container: use /app path
  const dockerPath = `/app/execution-compiled/${scriptName}`;
  console.log(`[GitOps] Using Docker script path: ${dockerPath}`);
  return dockerPath;
}

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
  // Skip clone if repo is already cloned by entrypoint
  skipClone?: boolean;
}

/**
 * Result of creating a story branch/worktree.
 */
export interface StoryBranchResult {
  branchName: string;
  /** Path to the worktree directory (isolated working dir for this story) */
  worktreePath: string;
}

/**
 * Git operations manager for Epic executor.
 */
export class GitOps {
  private git: SimpleGit;
  private config: GitOpsConfig;
  private repoPath: string;
  private mainBranch: string = "main";
  private worktreesPath: string;

  // Mutex for serializing branch operations to prevent race conditions
  // when multiple experts run in parallel
  private branchOperationLock: Promise<void> = Promise.resolve();

  // Track active worktrees for cleanup
  private activeWorktrees: Map<string, string> = new Map(); // branchName -> worktreePath

  // Optional callback for posting logs to dashboard
  private postLog?: (msg: string) => void;

  // Resilience configuration (set via setResilience)
  private resilience?: ResilienceConfig;

  constructor(config: GitOpsConfig, postLog?: (msg: string) => void) {
    // Populate SCM provider settings from environment if not provided
    this.config = {
      ...config,
      scmProvider: config.scmProvider || (process.env.SCM_PROVIDER as GitOpsConfig["scmProvider"]) || "github",
      scmBaseUrl: config.scmBaseUrl || process.env.SCM_BASE_URL,
      bitbucketUsername: config.bitbucketUsername || process.env.BITBUCKET_USERNAME,
    };
    this.repoPath = path.join(config.workDir, "repo");
    this.worktreesPath = path.join(config.workDir, "worktrees");

    // Create directories if they don't exist
    // Both workDir and repoPath must exist before initializing simpleGit
    if (!existsSync(config.workDir)) {
      mkdirSync(config.workDir, { recursive: true });
    }
    if (!existsSync(this.repoPath)) {
      mkdirSync(this.repoPath, { recursive: true });
    }
    if (!existsSync(this.worktreesPath)) {
      mkdirSync(this.worktreesPath, { recursive: true });
    }

    const options: Partial<SimpleGitOptions> = {
      baseDir: this.repoPath,
      binary: "git",
      maxConcurrentProcesses: 1,
      trimmed: false,
    };

    this.git = simpleGit(options);
    this.postLog = postLog;
  }

  /** Log a message to dashboard (via callback) and console */
  private log(msg: string): void {
    console.log(msg);
    this.postLog?.(msg);
  }

  /**
   * Set resilience configuration (called by coordinator after construction).
   */
  setResilience(config: ResilienceConfig): void {
    this.resilience = config;
  }

  /**
   * Clone the target repository if not already cloned.
   * If skipClone is true (repo cloned by entrypoint), just verify and configure git.
   */
  async cloneIfNeeded(): Promise<void> {
    // If skipClone is set, repo was cloned by entrypoint - just configure and verify
    if (this.config.skipClone) {
      console.log("[GitOps] Repo pre-cloned by entrypoint, verifying...");
      if (!existsSync(path.join(this.repoPath, ".git"))) {
        throw new Error(`[GitOps] REPO_PATH set but no .git found at ${this.repoPath}`);
      }
      await this.git.cwd(this.repoPath);
      // Ensure git identity is set
      await this.git.addConfig("user.name", "WorkerMill Epic Agent");
      await this.git.addConfig("user.email", process.env.AUTHOR_EMAIL || "epic@workermill.com");
      // Set main branch from env if available
      if (process.env.MAIN_BRANCH) {
        this.mainBranch = process.env.MAIN_BRANCH;
      }
      console.log("[GitOps] Pre-cloned repo verified, main branch:", this.mainBranch);
      return;
    }

    if (existsSync(path.join(this.repoPath, ".git"))) {
      console.log("[GitOps] Repository already cloned, resetting to clean state...");
      await this.git.cwd(this.repoPath);
      // Ensure git identity and line ending config is set (may not be set from previous run)
      await this.git.addConfig("user.name", "WorkerMill Epic Agent");
      await this.git.addConfig("user.email", process.env.AUTHOR_EMAIL || "epic@workermill.com");
      await this.git.addConfig("core.autocrlf", "false");
      await this.git.addConfig("core.safecrlf", "false");
      await this.git.addConfig("core.eol", "lf");
      // CRITICAL: Reset and clean BEFORE checkout to handle leftover changes from previous runs
      await this.git.reset(["--hard", "HEAD"]);
      await this.git.clean("f", ["-d", "-x"]); // -x removes ignored files too
      // Now fetch and checkout main branch
      await this.git.fetch("origin");
      await this.git.checkout(["-f", this.mainBranch]); // -f forces checkout
      await this.git.reset(["--hard", `origin/${this.mainBranch}`]);
      await this.git.clean("f", ["-d"]);

      // CRITICAL: Remove .gitattributes AFTER reset (reset restores it from origin)
      // Then force re-checkout to prevent line ending normalization
      const gitattributesPath = path.join(this.repoPath, ".gitattributes");
      if (existsSync(gitattributesPath)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(gitattributesPath);
        await this.git.checkout(["-f", "."]);
        console.log("[GitOps] Removed .gitattributes and re-checked out files");
      }
      console.log("[GitOps] Reset to clean state from origin");
      return;
    }

    console.log("[GitOps] Cloning " + this.config.targetRepo + "...");
    console.log("[GitOps] SCM Provider: " + this.config.scmProvider);
    console.log("[GitOps] Bitbucket Username: " + (this.config.bitbucketUsername || "not set"));
    console.log("[GitOps] Token present: " + (this.config.githubToken ? "yes (" + this.config.githubToken.slice(0, 10) + "...)" : "NO"));
    const repoUrl = this.getAuthenticatedUrl();
    // Log URL with token masked
    const maskedUrl = repoUrl.replace(/:[^@]+@/, ':***@');
    console.log("[GitOps] Clone URL: " + maskedUrl);

    // CRITICAL: Set global git config BEFORE clone to prevent line ending issues
    // This prevents CRLF/LF normalization from making files appear modified
    const preCloneGit = simpleGit();
    await preCloneGit.raw(["config", "--global", "core.autocrlf", "false"]);
    await preCloneGit.raw(["config", "--global", "core.safecrlf", "false"]);
    await preCloneGit.raw(["config", "--global", "core.eol", "lf"]);
    // Disable .gitattributes-based normalization globally for this clone
    await preCloneGit.raw(["config", "--global", "core.attributesfile", "/dev/null"]);
    console.log("[GitOps] Configured global git settings (line endings disabled)");

    // Note: repoPath directory is already created in constructor
    await preCloneGit.clone(repoUrl, this.repoPath);
    await this.git.cwd(this.repoPath);

    // Configure git identity for commits
    await this.git.addConfig("user.name", "WorkerMill Epic Agent");
    await this.git.addConfig("user.email", process.env.AUTHOR_EMAIL || "epic@workermill.com");

    // Also set line ending config locally in repo
    await this.git.addConfig("core.autocrlf", "false");
    await this.git.addConfig("core.safecrlf", "false");
    await this.git.addConfig("core.eol", "lf");
    console.log("[GitOps] Configured git identity and line endings");

    // CRITICAL: Remove .gitattributes to prevent line ending normalization
    // The repo's .gitattributes causes files to appear modified after checkout
    const gitattributesPath = path.join(this.repoPath, ".gitattributes");
    if (existsSync(gitattributesPath)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(gitattributesPath);
      console.log("[GitOps] Removed .gitattributes to prevent line ending normalization");
    }

    // CRITICAL: Force re-checkout all files AFTER removing .gitattributes
    // The clone already applied line ending normalization based on .gitattributes
    // git checkout -f . replaces working tree files with blob content (no normalization)
    await this.git.checkout(["-f", "."]);
    console.log("[GitOps] Force re-checked out all files without .gitattributes");

    // Clean any leftover untracked files
    await this.git.clean("f", ["-d"]);
    console.log("[GitOps] Cleaned working directory");

    // Detect main branch - check common names first, then fall back to remote HEAD
    const branches = await this.git.branch(["-r"]);
    if (branches.all.includes("origin/main")) {
      this.mainBranch = "main";
    } else if (branches.all.includes("origin/master")) {
      this.mainBranch = "master";
    } else {
      // Neither main nor master exists - detect the actual default branch
      try {
        // Try to get the default branch from remote HEAD
        const headRef = await this.git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
        const defaultBranch = headRef.trim().replace("refs/remotes/origin/", "");
        if (defaultBranch && branches.all.includes(`origin/${defaultBranch}`)) {
          this.mainBranch = defaultBranch;
          console.log(`[GitOps] Detected non-standard default branch: ${defaultBranch}`);
        }
      } catch {
        // symbolic-ref failed, try to find any branch that looks like a default
        const possibleDefaults = branches.all
          .filter(b => b.startsWith("origin/"))
          .map(b => b.replace("origin/", ""))
          .filter(b => !b.includes("/"));  // Exclude feature branches with slashes

        if (possibleDefaults.length > 0) {
          // Pick the first non-feature branch (dev, develop, dev-master, trunk, etc.)
          const defaultBranch = possibleDefaults.find(b =>
            b === "develop" || b === "dev" || b === "dev-master" || b === "trunk"
          ) || possibleDefaults[0];
          this.mainBranch = defaultBranch;
          console.log(`[GitOps] Using fallback default branch: ${defaultBranch}`);
        }
      }
    }

    console.log("[GitOps] Repository cloned, main branch: " + this.mainBranch);
  }

  /**
   * Create a branch and worktree for a story.
   * Each story gets its own isolated worktree directory to enable parallel execution.
   * Uses a mutex to serialize branch operations and prevent race conditions.
   *
   * @returns StoryBranchResult with branch name and worktree path
   */
  async createStoryBranch(
    storyIndex: number,
    storyTitle: string,
    jiraKey?: string
  ): Promise<StoryBranchResult> {
    // Serialize branch creation to prevent race conditions
    // Wait for any pending operation to complete
    const currentLock = this.branchOperationLock;
    let releaseLock: () => void;
    this.branchOperationLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      await currentLock; // Wait for previous operation
      return await this.createStoryBranchInternal(storyIndex, storyTitle, jiraKey);
    } finally {
      releaseLock!(); // Release lock for next operation
    }
  }

  /**
   * Internal implementation of branch/worktree creation (called under lock).
   * Creates an isolated worktree for each story to enable true parallel execution.
   */
  private async createStoryBranchInternal(
    storyIndex: number,
    storyTitle: string,
    jiraKey?: string
  ): Promise<StoryBranchResult> {
    const branchName = this.generateBranchName(storyIndex, storyTitle, jiraKey);
    const worktreePath = path.join(this.worktreesPath, `story-${storyIndex}`);

    console.log(`[GitOps] Creating worktree for story ${storyIndex}: ${worktreePath}`);

    // Check if repo has any commits (HEAD exists)
    let hasCommits = true;
    try {
      await this.git.revparse(["HEAD"]);
    } catch {
      hasCommits = false;
      console.log("[GitOps] Repository is empty (no commits yet)");
    }

    // Fetch from origin - may fail if remote branch doesn't exist (empty repo)
    try {
      await this.git.fetch(["origin", this.mainBranch]);
    } catch (fetchError) {
      console.log(`[GitOps] Could not fetch origin/${this.mainBranch} - repo may be empty`);
    }

    // For empty repos, create an initial commit so we have something to branch from
    if (!hasCommits) {
      console.log("[GitOps] Creating initial commit for empty repository...");
      const readmePath = path.join(this.repoPath, "README.md");
      if (!existsSync(readmePath)) {
        const { writeFileSync } = await import("fs");
        writeFileSync(readmePath, `# ${this.config.targetRepo.split("/").pop()}\n\nInitialized by WorkerMill.\n`);
      }
      await this.git.add(".");
      await this.git.commit(`Initial commit\n\nCo-Authored-By: WorkerMill <${process.env.AUTHOR_EMAIL || "bot@workermill.com"}>`);
      try {
        await this.git.push("origin", this.mainBranch, ["--set-upstream"]);
        console.log("[GitOps] Pushed initial commit to origin/" + this.mainBranch);
      } catch (pushError) {
        console.log("[GitOps] Could not push initial commit:", pushError);
      }
      hasCommits = true;
    }

    // Ensure main repo is on main branch and up to date
    await this.git.checkout(["-f", this.mainBranch]);
    try {
      await this.git.reset(["--hard", `origin/${this.mainBranch}`]);
    } catch {
      // May fail if origin/main doesn't exist yet
    }

    // Remove existing worktree if it exists (from previous failed run)
    if (existsSync(worktreePath)) {
      console.log(`[GitOps] Removing existing worktree: ${worktreePath}`);
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      } catch {
        // Force remove the directory if git worktree remove fails
        const { rmSync } = await import("fs");
        rmSync(worktreePath, { recursive: true, force: true });
      }
      // Prune stale worktree references
      try {
        execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
      } catch {
        // Ignore prune errors
      }
    }

    // Check if branch already exists on remote or locally
    const branches = await this.git.branch(["-a"]);
    const branchExists = branches.all.includes(branchName) ||
                         branches.all.includes(`remotes/origin/${branchName}`);

    if (branchExists) {
      console.log(`[GitOps] Branch ${branchName} exists, creating worktree from it...`);
      // Create worktree with existing branch
      try {
        execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      } catch (e) {
        // Branch might be checked out elsewhere, force it
        execSync(`git worktree add -f "${worktreePath}" "${branchName}"`, {
          cwd: this.repoPath,
          stdio: "pipe",
        });
      }
    } else {
      console.log(`[GitOps] Creating new branch ${branchName} with worktree...`);
      // Create worktree with new branch based on main
      execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${this.mainBranch}"`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });
    }

    // Configure git identity in the worktree
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.addConfig("user.name", "WorkerMill Epic Agent");
    await worktreeGit.addConfig("user.email", process.env.AUTHOR_EMAIL || "epic@workermill.com");

    // Remove .gitattributes in worktree to prevent line ending issues
    const gitattributesPath = path.join(worktreePath, ".gitattributes");
    if (existsSync(gitattributesPath)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(gitattributesPath);
      console.log("[GitOps] Removed .gitattributes from worktree");
    }

    // Hard-link copy node_modules from main repo into worktree (avoids runtime npm install OOM)
    this.copyDependencies(worktreePath);

    // Track this worktree
    this.activeWorktrees.set(branchName, worktreePath);

    console.log(`[GitOps] Created worktree for branch ${branchName} at ${worktreePath}`);

    return { branchName, worktreePath };
  }

  /**
   * Hard-link copy node_modules from main repo into worktree.
   * Uses cp -al: each worktree gets its own directory structure (no cross-mutation
   * between parallel stories) but shares file contents via hard links (no extra disk).
   * Prevents agents from running npm install at runtime, which causes OOM
   * when combined with the review phase in memory-constrained containers.
   */
  private copyDependencies(worktreePath: string): void {
    const dirsWithNodeModules = this.findNodeModulesDirs(this.repoPath, 3);

    for (const relDir of dirsWithNodeModules) {
      const src = relDir
        ? path.join(this.repoPath, relDir, "node_modules")
        : path.join(this.repoPath, "node_modules");
      const dest = relDir
        ? path.join(worktreePath, relDir, "node_modules")
        : path.join(worktreePath, "node_modules");

      if (!existsSync(dest)) {
        try {
          execSync(`cp -al "${src}" "${dest}"`, { stdio: "pipe" });
          console.log(`[GitOps] Hard-linked node_modules: ${relDir || "root"}`);
        } catch (e) {
          console.warn(`[GitOps] Failed to copy node_modules (${relDir || "root"}): ${e}`);
        }
      }
    }
  }

  /**
   * Find directories containing node_modules up to maxDepth.
   * Returns relative paths from baseDir (empty string for root).
   */
  private findNodeModulesDirs(
    baseDir: string,
    maxDepth: number,
    currentDepth: number = 0,
    relativePath: string = ""
  ): string[] {
    if (currentDepth > maxDepth) return [];
    const results: string[] = [];
    try {
      const entries = readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "node_modules") {
          results.push(relativePath);
        } else if (entry.name !== ".git") {
          const subPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
          results.push(
            ...this.findNodeModulesDirs(
              path.join(baseDir, entry.name),
              maxDepth,
              currentDepth + 1,
              subPath
            )
          );
        }
      }
    } catch {
      // Ignore permission errors
    }
    return results;
  }

  /**
   * Integrate completed dependency branches into a story's worktree.
   * This gives the story agent access to code from its dependencies on disk.
   *
   * Uses cherry-picking (not git merge) to avoid the "diamond merge" problem:
   * When Story 9 depends on Stories 1-8, and Story 8's branch already contains
   * Stories 1-7 merged into it, merging both Story 7 and Story 8 independently
   * creates duplicate changes and conflicts. Cherry-picking only each story's
   * own commits (excluding merge commits) avoids this entirely.
   *
   * Strategy per branch:
   * 1. Extract non-merge commits (story's own work) via git log --no-merges
   * 2. Cherry-pick those commits into the worktree
   * 3. On conflict: retry with -X theirs (accept dependency's version)
   * 4. Last resort: fall back to git merge
   *
   * @returns Summary of merged, conflicted, and errored branches
   */
  async mergeDependencyBranches(
    worktreePath: string,
    dependencyBranches: string[]
  ): Promise<{
    merged: string[];
    conflicted: string[];
    errors: Array<{ branch: string; error: string }>;
  }> {
    const merged: string[] = [];
    const conflicted: string[] = [];
    const errors: Array<{ branch: string; error: string }> = [];

    if (dependencyBranches.length === 0) {
      return { merged, conflicted, errors };
    }

    const worktreeGit = simpleGit(worktreePath);

    // Fetch origin to get latest branch refs
    try {
      await worktreeGit.fetch(["origin"]);
    } catch (fetchError) {
      const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(`[GitOps] Failed to fetch origin in worktree: ${msg}`);
      // Continue anyway - branches might already be available locally
    }

    for (const branch of dependencyBranches) {
      const remoteBranch = `origin/${branch}`;

      // Verify branch exists
      try {
        await worktreeGit.revparse([remoteBranch]);
      } catch {
        console.warn(`[GitOps] Dependency branch not found on remote: ${branch}`);
        errors.push({ branch, error: "Branch not found on remote" });
        continue;
      }

      // Extract only the story's own non-merge commits (same approach as createConsolidatedPR)
      let workerCommits: string[];
      try {
        const commitLog = (
          await worktreeGit.raw([
            "log",
            "--first-parent",
            "--no-merges",
            "--reverse",
            "--format=%H",
            `origin/${this.mainBranch}..${remoteBranch}`,
          ])
        ).trim();
        workerCommits = commitLog ? commitLog.split("\n").filter(Boolean) : [];
      } catch {
        console.warn(`[GitOps] Could not list commits for dependency branch ${branch}`);
        errors.push({ branch, error: "Could not list commits" });
        continue;
      }

      if (workerCommits.length === 0) {
        console.log(`[GitOps] No worker commits on dependency branch ${branch} — skipping`);
        merged.push(branch); // Nothing to apply, count as success
        continue;
      }

      const headBefore = (await worktreeGit.revparse(["HEAD"])).trim();
      console.log(`[GitOps] Cherry-picking ${workerCommits.length} commit(s) from dependency ${branch}`);

      // Strategy 1: Cherry-pick commits one by one (cleanest)
      let success = true;
      for (const commit of workerCommits) {
        try {
          await worktreeGit.raw(["cherry-pick", commit]);
        } catch {
          success = false;
          await worktreeGit.raw(["cherry-pick", "--abort"]).catch(() => {});
          break;
        }
      }

      if (success) {
        merged.push(branch);
        console.log(`[GitOps] Cherry-picked dependency branch: ${branch}`);
        continue;
      }

      // Strategy 2: Cherry-pick with -X theirs (accept dependency's version on conflict)
      console.log(`[GitOps] Cherry-pick conflicts for ${branch}, retrying with -X theirs`);
      await worktreeGit.reset(["--hard", headBefore]);

      success = true;
      for (const commit of workerCommits) {
        try {
          await worktreeGit.raw(["cherry-pick", commit, "-X", "theirs"]);
        } catch {
          success = false;
          await worktreeGit.raw(["cherry-pick", "--abort"]).catch(() => {});
          break;
        }
      }

      if (success) {
        merged.push(branch);
        console.log(`[GitOps] Cherry-picked dependency branch (with -X theirs): ${branch}`);
        continue;
      }

      // Strategy 3: Fall back to git merge (last resort)
      console.warn(`[GitOps] Cherry-pick failed for ${branch}, falling back to git merge`);
      await worktreeGit.reset(["--hard", headBefore]);

      try {
        await worktreeGit.merge([remoteBranch, "--no-edit"]);
        merged.push(branch);
        console.log(`[GitOps] Merged dependency branch (merge fallback): ${branch}`);
      } catch (mergeError) {
        const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);

        // Check if there's a conflict
        try {
          const status = await worktreeGit.status();
          if (status.conflicted.length > 0) {
            console.warn(`[GitOps] Merge conflict with dependency branch ${branch}: ${status.conflicted.join(", ")}`);
            await worktreeGit.merge(["--abort"]);
            conflicted.push(branch);
            continue;
          }
        } catch {
          // status or abort failed
        }

        // Not a conflict - some other error; reset to recover
        console.error(`[GitOps] Failed to integrate dependency branch ${branch}: ${msg}`);
        try {
          await worktreeGit.reset(["--hard", headBefore]);
        } catch {
          // Ignore reset errors
        }
        errors.push({ branch, error: msg });
      }
    }

    return { merged, conflicted, errors };
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
   * Get the worktree path for a branch.
   */
  getWorktreePath(branchName: string): string | undefined {
    return this.activeWorktrees.get(branchName);
  }

  /**
   * Commit changes in a specific worktree.
   */
  async commitChangesInWorktree(
    worktreePath: string,
    message: string,
    persona: string,
    storyIndex: number
  ): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);

    // Log pre-add status for debugging
    const preAddStatus = await worktreeGit.status();
    console.log("[GitOps] Pre-add status (worktree):", {
      cwd: worktreePath,
      modified: preAddStatus.modified,
      created: preAddStatus.created,
      not_added: preAddStatus.not_added,
      staged: preAddStatus.staged,
    });

    // Ensure node_modules is in .gitignore before staging (prevents 100MB+ binaries from being committed)
    this.ensureNodeModulesIgnored(worktreePath);

    // Stage all changes
    await worktreeGit.add(".");

    // Check if there are changes to commit
    const status = await worktreeGit.status();
    console.log("[GitOps] Post-add status (worktree):", {
      staged: status.staged,
      modified: status.modified,
      created: status.created,
      not_added: status.not_added,
    });

    if (status.staged.length === 0) {
      console.log("[GitOps] No changes to commit in worktree");
      return "";
    }

    // Format commit message with attribution
    const formattedMessage = message + "\n\nStory: S" + storyIndex + "\nCo-Authored-By: " + this.formatPersonaForCommit(persona);

    const result = await worktreeGit.commit(formattedMessage);
    console.log("[GitOps] Committed in worktree:", result.commit, "Files:", status.staged.length);

    return result.commit;
  }

  /**
   * Push a branch from a worktree.
   */
  async pushBranchFromWorktree(worktreePath: string, branchName: string): Promise<void> {
    const worktreeGit = simpleGit(worktreePath);
    const isStoryBranch = branchName.startsWith("story/");

    console.log(`[GitOps] Pushing branch ${branchName} from worktree...`);

    // Story branches may need force push if we're retrying after a previous run
    const pushArgs = isStoryBranch
      ? ["--set-upstream", "--force"]
      : ["--set-upstream"];

    try {
      await worktreeGit.push("origin", branchName, pushArgs);
      console.log(`[GitOps] Pushed branch ${branchName} from worktree`);
    } catch (e) {
      console.error(`[GitOps] Failed to push branch ${branchName}:`, e);
      throw e;
    }
  }

  /**
   * Get modified files in a worktree.
   */
  async getModifiedFilesInWorktree(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    const status = await worktreeGit.status();
    const allFiles = [
      ...status.modified,
      ...status.created,
      ...status.not_added,
    ];
    // Filter out hard-linked node_modules (copied into worktrees to avoid npm install OOM)
    return allFiles.filter((f) => !f.includes("node_modules"));
  }

  /**
   * Check if worktree has commits ahead of main.
   */
  async hasCommitsAheadOfMainInWorktree(worktreePath: string): Promise<boolean> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      await worktreeGit.fetch("origin", this.mainBranch);
      const log = await worktreeGit.log([`origin/${this.mainBranch}..HEAD`]);
      return log.total > 0;
    } catch {
      return false;
    }
  }

  /**
   * Push branch from worktree if there are commits ahead of main.
   * Used for incremental checkpoint pushes to preserve work.
   * Returns true if pushed, false if no commits to push.
   */
  async pushBranchIfCommitsExist(worktreePath: string, branchName: string): Promise<boolean> {
    const hasCommits = await this.hasCommitsAheadOfMainInWorktree(worktreePath);
    if (hasCommits) {
      await this.pushBranchFromWorktree(worktreePath, branchName);
      return true;
    }
    return false;
  }

  /**
   * List remote story branches for a given jira key.
   * Used to detect partial work from previous runs.
   */
  async listRemoteStoryBranches(jiraKey: string): Promise<string[]> {
    await this.git.fetch(["--all", "--prune"]);
    const branches = await this.git.branch(["-r"]);
    const prefix = `origin/story/${jiraKey.toLowerCase()}-s`;

    return branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""));
  }

  /**
   * Commit any uncommitted work with a WIP message.
   * Used during graceful shutdown to preserve partial work.
   */
  async commitUncommittedWork(worktreePath: string, message: string = "WIP: Interrupted"): Promise<string> {
    const worktreeGit = simpleGit(worktreePath);

    // Ensure node_modules is in .gitignore before staging (prevents 100MB+ binaries from being committed)
    this.ensureNodeModulesIgnored(worktreePath);

    // Stage all changes
    await worktreeGit.add(".");

    const status = await worktreeGit.status();
    if (status.staged.length === 0) {
      return "";
    }

    const result = await worktreeGit.commit(message);
    console.log(`[GitOps] Committed WIP in worktree: ${result.commit}`);
    return result.commit;
  }

  /**
   * Get files changed vs main in a worktree.
   */
  async getFilesChangedVsMainInWorktree(worktreePath: string): Promise<string[]> {
    const worktreeGit = simpleGit(worktreePath);
    try {
      const diff = await worktreeGit.diff(["--name-only", `origin/${this.mainBranch}...HEAD`]);
      return diff.split("\n").filter((f) => f.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Cleanup a worktree after story completion.
   */
  async cleanupWorktree(branchName: string): Promise<void> {
    const worktreePath = this.activeWorktrees.get(branchName);
    if (!worktreePath) {
      return;
    }

    console.log(`[GitOps] Cleaning up worktree for ${branchName}: ${worktreePath}`);

    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.repoPath,
        stdio: "pipe",
      });
    } catch {
      // Force remove the directory if git worktree remove fails
      try {
        const { rmSync } = await import("fs");
        rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    this.activeWorktrees.delete(branchName);
  }

  /**
   * Cleanup all worktrees.
   */
  async cleanupAllWorktrees(): Promise<void> {
    console.log(`[GitOps] Cleaning up all worktrees (${this.activeWorktrees.size} active)`);

    for (const [branchName] of this.activeWorktrees) {
      await this.cleanupWorktree(branchName);
    }

    // Prune any stale worktree references
    try {
      execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
    } catch {
      // Ignore prune errors
    }
  }

  /**
   * Commit changes with proper attribution.
   */
  async commitChanges(
    message: string,
    persona: string,
    storyIndex: number
  ): Promise<string> {
    // Log pre-add status for debugging
    const preAddStatus = await this.git.status();
    console.log("[GitOps] Pre-add status:", {
      cwd: this.repoPath,
      modified: preAddStatus.modified,
      created: preAddStatus.created,
      not_added: preAddStatus.not_added,
      staged: preAddStatus.staged,
    });

    // Ensure node_modules is in .gitignore before staging (prevents 100MB+ binaries from being committed)
    this.ensureNodeModulesIgnored(this.repoPath);

    // Stage all changes
    await this.git.add(".");

    // Check if there are changes to commit
    const status = await this.git.status();
    console.log("[GitOps] Post-add status:", {
      staged: status.staged,
      modified: status.modified,
      created: status.created,
      not_added: status.not_added,
    });

    if (status.staged.length === 0) {
      console.log("[GitOps] No changes to commit after git add");
      // Also check if there are any unstaged changes that weren't added
      if (status.modified.length > 0 || status.not_added.length > 0) {
        console.error("[GitOps] WARNING: Unstaged changes exist but git add . didn't stage them!");
        console.error("[GitOps] Modified:", status.modified);
        console.error("[GitOps] Not added:", status.not_added);
      }
      return "";
    }

    // Format commit message with attribution
    const formattedMessage = message + "\n\nStory: S" + storyIndex + "\nCo-Authored-By: " + this.formatPersonaForCommit(persona);

    const result = await this.git.commit(formattedMessage);
    console.log("[GitOps] Committed:", result.commit, "Files:", status.staged.length);

    return result.commit;
  }

  /**
   * Format persona for commit co-author line.
   */
  /**
   * Ensure node_modules is listed in .gitignore so `git add .` never stages it.
   * Greenfield projects may not have a .gitignore yet when the first commit runs.
   */
  private ensureNodeModulesIgnored(repoPath: string): void {
    const gitignorePath = path.join(repoPath, ".gitignore");
    try {
      const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
      if (!content.split("\n").some(line => line.trim() === "node_modules" || line.trim() === "node_modules/")) {
        appendFileSync(gitignorePath, "\nnode_modules\n");
        console.log("[GitOps] Added node_modules to .gitignore");
      }
    } catch (e) {
      console.warn("[GitOps] Failed to ensure node_modules in .gitignore:", e);
    }
  }

  private formatPersonaForCommit(persona: string): string {
    const email = process.env.AUTHOR_EMAIL || "bot@workermill.com";
    const nameMap: Record<string, string> = {
      frontend_developer: `Frontend Developer <${email}>`,
      backend_developer: `Backend Developer <${email}>`,
      security_engineer: `Security Engineer <${email}>`,
      qa_engineer: `QA Engineer <${email}>`,
      devops_engineer: `DevOps Engineer <${email}>`,
    };
    return nameMap[persona] ?? `${persona} <${email}>`;
  }

  /**
   * Push branch to remote.
   * Uses --force for story branches since they're recreated fresh each run.
   * This is safe because story branches are ephemeral and not protected.
   */
  async pushBranch(branchName: string): Promise<void> {
    console.log(`[GitOps] Pushing branch ${branchName} to origin...`);
    try {
      // Story branches are ephemeral and recreated fresh each run
      // Use force push to handle the case where remote branch exists from a previous attempt
      const isStoryBranch = branchName.startsWith("story/");
      const pushArgs = isStoryBranch
        ? ["--set-upstream", "--force"]
        : ["--set-upstream"];

      console.log(`[GitOps] Push args: ${pushArgs.join(" ")} (isStoryBranch: ${isStoryBranch})`);

      const pushResult = await this.git.push("origin", branchName, pushArgs);
      console.log("[GitOps] Push successful:", {
        branch: branchName,
        pushed: pushResult.pushed,
        update: pushResult.update,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[GitOps] Push FAILED for ${branchName}:`, msg);
      throw error;
    }
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
      // Reset any dirty state before checkout
      await this.git.reset(["--hard", "HEAD"]);
      await this.git.clean("f", ["-d"]);
      await this.git.checkout(["-f", branchName]);
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
   * Local mode uses the same remote URLs as cloud mode - only the worker execution differs.
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
        // Bitbucket API tokens use x-bitbucket-api-token-auth as username
        // Repository Access Tokens use x-token-auth, but API tokens are more common now
        const bbUsername = bitbucketUsername || "x-bitbucket-api-token-auth";
        // URL-encode the password (may contain special chars like @ and =)
        const encodedBbPassword = encodeURIComponent(githubToken);
        authPrefix = `${bbUsername}:${encodedBbPassword}`;
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
   * Ensure the main repo is on the PR's head branch before tech lead review.
   * After single-story PR creation or WORKERMILL.md update, the repo may
   * have been left on main or a detached HEAD. This fetches and checks out
   * the correct branch so the reviewer reads the right files.
   */
  async checkoutForReview(prNumber: number): Promise<void> {
    const scmProvider = process.env.SCM_PROVIDER || "github";

    try {
      await this.git.fetch(["origin"]);

      if (scmProvider === "github") {
        // Use gh pr view to get the head branch name
        const { stdout } = await execFileAsync(
          "gh",
          ["pr", "view", String(prNumber), "--json", "headRefName", "-q", ".headRefName"],
          { cwd: this.repoPath }
        );
        const headBranch = stdout.trim();
        if (headBranch) {
          await this.git.checkout(["-f", headBranch]);
          console.log(`[GitOps] Checked out PR #${prNumber} branch: ${headBranch}`);
          return;
        }
      }

      // Fallback for Bitbucket/GitLab or if gh fails: find the branch from story branches
      const jiraKey = process.env.JIRA_ISSUE_KEY || "";
      if (jiraKey) {
        // Check for feature branch first (multi-story)
        const featureBranch = `feature/${jiraKey.toLowerCase()}-epic`;
        const branches = await this.git.branch(["-a"]);
        if (branches.all.includes(featureBranch) || branches.all.includes(`remotes/origin/${featureBranch}`)) {
          await this.git.checkout(["-f", featureBranch]);
          console.log(`[GitOps] Checked out feature branch: ${featureBranch}`);
          return;
        }

        // Try story branch (single-story)
        const storyBranches = await this.getStoryBranches();
        if (storyBranches.length > 0) {
          await this.git.checkout(["-f", storyBranches[0]]);
          console.log(`[GitOps] Checked out story branch: ${storyBranches[0]}`);
          return;
        }
      }

      console.warn("[GitOps] Could not determine PR branch for review checkout");
    } catch (e) {
      console.warn(`[GitOps] checkoutForReview failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Get list of modified files (uncommitted changes in working tree).
   * Includes: modified, staged new files, renamed, AND untracked new files.
   */
  async getModifiedFiles(): Promise<string[]> {
    const status = await this.git.status();
    return [
      ...status.modified,
      ...status.created,
      ...status.renamed.map(r => r.to),
      ...status.not_added,  // IMPORTANT: Include untracked new files!
    ];
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
      const createPrScript = getExecutionScriptPath("git/create_pr.js");
      console.log(`[GitOps] Executing PR script: ${createPrScript}`);
      const { stdout } = await execFileAsync(
        "node",
        [createPrScript],
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
    // Fetch with prune to ensure we have latest remote state
    console.log("[GitOps] Fetching all remote branches before searching for story branches...");
    await this.git.fetch(["--all", "--prune"]);

    const branches = await this.git.branch(["-r"]);
    const prefix = jiraKey
      ? `origin/story/${jiraKey.toLowerCase()}-s`
      : "origin/story/s";

    // Log ALL remote branches for debugging
    console.log(`[GitOps] All remote branches: ${branches.all.join(", ")}`);

    // Log available story branches for debugging
    const storyBranches = branches.all.filter((b) => b.includes("/story/"));
    if (storyBranches.length > 0) {
      console.log(`[GitOps] Story branches found: ${storyBranches.join(", ")}`);
    } else {
      console.log(`[GitOps] NO story branches found on remote!`);
    }
    console.log(`[GitOps] Looking for branches with prefix: ${prefix}`);

    const allMatching = branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""));

    // Deduplicate: retried stories leave stale branches (e.g. 4 branches for s0).
    // Group by story index and keep only the branch with the latest commit per index.
    const byIndex = new Map<number, string[]>();
    for (const b of allMatching) {
      const idx = parseInt(b.match(/-s(\d+)-/)?.[1] || "-1");
      if (idx < 0) continue;
      if (!byIndex.has(idx)) byIndex.set(idx, []);
      byIndex.get(idx)!.push(b);
    }

    const deduplicated: string[] = [];
    for (const [idx, group] of Array.from(byIndex.entries()).sort((a, b) => a[0] - b[0])) {
      if (group.length === 1) {
        deduplicated.push(group[0]);
      } else {
        // Multiple branches for same story index — pick the one with the latest commit
        let latest = group[0];
        let latestTs = 0;
        for (const branch of group) {
          try {
            const ts = parseInt(
              (await this.git.raw(["log", "-1", "--format=%ct", `origin/${branch}`])).trim()
            );
            if (ts > latestTs) {
              latestTs = ts;
              latest = branch;
            }
          } catch {
            // If we can't read the branch, skip it
          }
        }
        console.log(`[GitOps] Story s${idx} has ${group.length} branches, using latest: ${latest}`);
        deduplicated.push(latest);
      }
    }

    console.log(`[GitOps] Found ${allMatching.length} matching branches (${deduplicated.length} after dedup): ${deduplicated.join(", ") || "none"}`);
    return deduplicated;
  }

  /**
   * Delete all story branches for this epic from remote and local.
   * Used during revision to force fresh branches from main so that
   * stale branch history doesn't contaminate re-execution.
   */
  async deleteStoryBranches(jiraKey?: string): Promise<void> {
    console.log(
      `[GitOps] Deleting story branches for revision (jiraKey: ${jiraKey || "none"})...`,
    );

    await this.git.fetch(["--all", "--prune"]);
    const branches = await this.git.branch(["-r"]);
    const prefix = jiraKey
      ? `origin/story/${jiraKey.toLowerCase()}-s`
      : "origin/story/s";

    const storyBranches = branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""));

    if (storyBranches.length === 0) {
      console.log("[GitOps] No story branches to delete");
      return;
    }

    console.log(
      `[GitOps] Deleting ${storyBranches.length} story branches: ${storyBranches.join(", ")}`,
    );

    // Prune worktrees first (story branches may be checked out in worktrees)
    try {
      execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
    } catch {}

    for (const branch of storyBranches) {
      // Delete remote branch
      try {
        await this.git.push("origin", `:${branch}`);
        console.log(`[GitOps] Deleted remote branch: ${branch}`);
      } catch (e) {
        console.warn(`[GitOps] Could not delete remote branch ${branch}: ${e}`);
      }

      // Delete local branch
      try {
        await this.git.branch(["-D", branch]);
      } catch {
        // Local branch may not exist
      }
    }

    console.log("[GitOps] Story branch cleanup complete");
  }

  /**
   * Attempt to resolve rebase conflicts using a Claude agent.
   * Called when clean rebase (Strategy 1) fails during consolidation.
   * Returns true if all conflicts were resolved successfully.
   */
  private async resolveConflictsWithAgent(
    storyBranch: string,
    featureBranch: string,
    storyTitle: string
  ): Promise<boolean> {
    this.log(`[GitOps] Merge agent: attempting AI conflict resolution for ${storyBranch}...`);

    try {
      // Get list of conflicted files
      let conflictedFiles: string[];
      try {
        const diffOutput = (
          await this.git.raw(["diff", "--name-only", "--diff-filter=U"])
        ).trim();
        conflictedFiles = diffOutput ? diffOutput.split("\n").filter(Boolean) : [];
      } catch {
        this.log("[GitOps] Merge agent: could not detect conflicted files");
        return false;
      }

      if (conflictedFiles.length === 0) {
        this.log("[GitOps] Merge agent: no conflicted files detected");
        return false;
      }

      // Cap at 10 files to bound cost
      const filesToProcess = conflictedFiles.slice(0, 10);
      if (conflictedFiles.length > 10) {
        this.log(`[GitOps] Merge agent: capping at 10 files (${conflictedFiles.length} total)`);
      }

      // Read conflict markers from each file
      const fileContents: string[] = [];
      for (const file of filesToProcess) {
        const filePath = path.join(this.repoPath, file);
        if (!existsSync(filePath)) continue;
        try {
          let content = readFileSync(filePath, "utf-8");
          // Truncate at 5KB per file
          if (content.length > 5120) {
            content = content.slice(0, 5120) + "\n... (truncated)";
          }
          fileContents.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          fileContents.push(`### ${file}\n(could not read file)`);
        }
      }

      // Build prompt
      const prompt = `You are resolving git merge conflicts during a rebase operation.

## Context
- **Feature branch** (accumulated work from previous stories): \`${featureBranch}\`
- **Story branch** (being rebased onto feature): \`${storyBranch}\`
- **Story**: ${storyTitle}

## Conflicting Files

${fileContents.join("\n\n")}

## Instructions
1. For each conflicting file, resolve the conflict by combining the intent from BOTH sides intelligently.
2. The feature branch contains work from earlier stories that must be preserved.
3. The story branch contains new work that should be integrated.
4. After resolving each file, run \`git add <file>\` to mark it resolved.
5. After all files are resolved, run \`git rebase --continue\` to complete the rebase.
6. Do NOT use \`git rebase --abort\`.
7. If you encounter additional conflicts during \`--continue\`, resolve those too.`;

      // Spawn Claude CLI
      const model = process.env.MODEL || "claude-sonnet-4-20250514";
      const args = [
        "--print",
        "--model", model,
        "--permission-mode", "bypassPermissions",
      ];

      this.log(`[GitOps] Merge agent: spawning Claude (model: ${model}) for ${filesToProcess.length} conflicted file(s)`);

      const result = await new Promise<boolean>((resolve) => {
        const proc = spawn("claude", args, {
          cwd: this.repoPath,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        // Write prompt via stdin (same pattern as runClaudeCli)
        proc.stdin?.write(prompt);
        proc.stdin?.end();

        // 5 minute timeout
        const timeout = setTimeout(() => {
          this.log("[GitOps] Merge agent: timeout after 5 minutes");
          proc.kill("SIGTERM");
          resolve(false);
        }, 300_000);

        proc.on("close", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            this.log(`[GitOps] Merge agent: Claude exited with code ${code}`);
            if (stderr) {
              this.log(`[GitOps] Merge agent stderr: ${stderr.slice(0, 500)}`);
            }
            resolve(false);
          } else {
            resolve(true);
          }
        });

        proc.on("error", (err) => {
          clearTimeout(timeout);
          this.log(`[GitOps] Merge agent: spawn error: ${err.message}`);
          resolve(false);
        });
      });

      if (!result) {
        return false;
      }

      // Verify: no rebase-merge directory remaining
      const rebaseMergePath = path.join(this.repoPath, ".git", "rebase-merge");
      if (existsSync(rebaseMergePath)) {
        this.log("[GitOps] Merge agent: .git/rebase-merge still exists — rebase not completed");
        return false;
      }

      // Verify: no conflicted files in git status
      try {
        const statusOutput = (await this.git.raw(["diff", "--name-only", "--diff-filter=U"])).trim();
        if (statusOutput) {
          this.log(`[GitOps] Merge agent: conflicts remain after resolution: ${statusOutput}`);
          return false;
        }
      } catch {
        // If diff command fails, assume conflicts remain
        return false;
      }

      this.log("[GitOps] Merge agent: all conflicts resolved successfully");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`[GitOps] Merge agent error: ${msg}`);
      return false;
    }
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
      console.log(`[GitOps] Looking for story branches with jiraKey: ${jiraKey}`);
      const storyBranches = await this.getStoryBranches(jiraKey);
      if (storyBranches.length === 0) {
        console.error("[GitOps] ❌ NO STORY BRANCHES FOUND TO CONSOLIDATE");
        console.error("[GitOps] This likely means:");
        console.error("[GitOps] 1. Story execution made no changes (no commits)");
        console.error("[GitOps] 2. Story branch was not pushed to remote");
        console.error("[GitOps] 3. Branch naming mismatch (check jiraKey format)");
        return undefined;
      }

      console.log(`[GitOps] Found ${storyBranches.length} story branches to consolidate`);

      // OPTIMIZATION: For single-story tasks, skip consolidation and create PR from story branch directly
      // This avoids merge issues caused by CRLF/line-ending differences in the working tree
      if (storyBranches.length === 1) {
        const singleBranch = storyBranches[0];
        console.log(`[GitOps] Single story - creating PR directly from ${singleBranch}`);
        // Build description from story completions
        const storyDesc = storyCompletions.length > 0
          ? `Story: ${storyCompletions[0].title}`
          : "";
        return await this.createPRFromBranch(singleBranch, jiraKey, epicTitle, storyDesc, storyDesc, qualityMetrics);
      }

      // 2. Aggressive cleanup to ensure clean state before creating feature branch
      // This is critical: story execution may leave uncommitted files that block checkout/merge
      // IMPORTANT: Files may appear "modified" due to CRLF/LF line ending differences from .gitattributes
      console.log("[GitOps] Cleaning working tree before consolidation...");

      // Disable autocrlf to prevent line ending issues causing "modified" status
      try {
        await this.git.raw(["config", "core.autocrlf", "false"]);
        await this.git.raw(["config", "core.safecrlf", "false"]);
      } catch {
        // Non-fatal if config fails
      }

      // First: reset current branch to HEAD to discard all uncommitted changes
      try {
        await this.git.reset(["--hard", "HEAD"]);
      } catch {
        console.log("[GitOps] HEAD reset failed (may be in detached state), continuing...");
      }

      // Second: force checkout to main (--force discards local changes)
      console.log("[GitOps] Force checkout to main branch...");
      await this.git.checkout(["-f", this.mainBranch]);

      // Third: reset to origin/main to get latest remote state
      await this.git.reset(["--hard", `origin/${this.mainBranch}`]);

      // Fourth: clean untracked files AND ignored files
      await this.git.clean("f", ["-d", "-x"]);

      // CRLF phantom changes are handled by core.autocrlf=false above.
      // Previously this step nuked the index with `git rm -rf --cached .` then tried
      // to rebuild it — if the rebuild failed, the uncaught error killed PR creation.

      // Verify working tree is clean before proceeding
      const status = await this.git.status();
      if (status.modified.length > 0 || status.staged.length > 0 || status.not_added.length > 0) {
        console.error("[GitOps] Working tree not clean after reset! Modified:", status.modified);
        console.error("[GitOps] Staged:", status.staged, "Not added:", status.not_added);
        // Nuclear option: stash everything including untracked, then drop the stash
        try {
          await this.git.stash(["push", "--all", "-m", "consolidation-cleanup"]);
          await this.git.stash(["drop"]);
          await this.git.reset(["--hard", `origin/${this.mainBranch}`]);
        } catch {
          // Last resort: just proceed and hope merge works
          console.log("[GitOps] Stash cleanup failed, proceeding anyway...");
        }
      }

      const featureBranch = `feature/${jiraKey.toLowerCase()}-epic`;

      // Delete local feature branch if it exists
      try {
        await this.git.branch(["-D", featureBranch]);
      } catch {
        // Branch doesn't exist locally, that's fine
      }

      await this.git.checkoutBranch(featureBranch, this.mainBranch);
      console.log(`[GitOps] Created feature branch: ${featureBranch}`);

      // 3. Rebase-and-merge train: replay each story's commits onto the feature branch.
      // Unlike cherry-pick, git rebase automatically drops already-applied commits
      // via patch-id matching. This eliminates the "stale dependency" problem where
      // dependency cherry-picks (from mergeDependencyBranches) were treated as worker
      // commits and overrode earlier stories' changes during consolidation.
      this.log(
        `[GitOps] Rebase-and-merge train: replaying ${storyBranches.length} story branches onto ${featureBranch}...`,
      );
      const mergeResults: Array<{
        branch: string;
        status: "merged" | "skipped" | "failed";
        reason?: string;
      }> = [];
      for (const storyBranch of storyBranches) {
        this.log(`[GitOps] Processing ${storyBranch}...`);

        const headBefore = (await this.git.revparse(["HEAD"])).trim();
        const tempBranch = `temp-rebase-${storyBranch.replace(/\//g, "-")}`;

        // Cleanup any leftover temp branch from a previous failed attempt
        try {
          await this.git.branch(["-D", tempBranch]);
        } catch {}

        // Check if story branch has any commits ahead of main
        let commitCount: number;
        try {
          const count = (
            await this.git.raw([
              "rev-list",
              "--count",
              `origin/${this.mainBranch}..origin/${storyBranch}`,
            ])
          ).trim();
          commitCount = parseInt(count);
        } catch {
          this.log(`[GitOps] ✗ Could not count commits for ${storyBranch}`);
          mergeResults.push({
            branch: storyBranch,
            status: "failed",
            reason: "could not count commits",
          });
          continue;
        }

        if (commitCount === 0) {
          this.log(
            `[GitOps] ⊘ No commits on ${storyBranch} ahead of main`,
          );
          mergeResults.push({
            branch: storyBranch,
            status: "skipped",
            reason: "no commits ahead of main",
          });
          continue;
        }

        this.log(
          `[GitOps] ${storyBranch} has ${commitCount} commit(s) ahead of main`,
        );

        // Strategy 1: Clean rebase (fails on conflicts)
        // Creates a temp branch from the story, rebases it onto the feature branch.
        // git rebase --onto replays commits from origin/main..story onto the feature tip.
        // Already-applied commits (from dependency integration) are auto-dropped by patch-id.
        let strategy1Success = false;
        try {
          await this.git.raw([
            "checkout",
            "-b",
            tempBranch,
            `origin/${storyBranch}`,
          ]);
          await this.git.raw([
            "rebase",
            "--onto",
            featureBranch,
            `origin/${this.mainBranch}`,
            tempBranch,
          ]);
          await this.git.checkout(featureBranch);
          await this.git.raw(["merge", "--ff-only", tempBranch]);
          await this.git.branch(["-D", tempBranch]);
          strategy1Success = true;
        } catch {
          await this.git.raw(["rebase", "--abort"]).catch(() => {});
          try {
            await this.git.checkout(featureBranch);
          } catch {}
          try {
            await this.git.branch(["-D", tempBranch]);
          } catch {}
          await this.git.reset(["--hard", headBefore]);
        }

        if (strategy1Success) {
          const headAfter = (await this.git.revparse(["HEAD"])).trim();
          if (headAfter === headBefore) {
            this.log(
              `[GitOps] ⊘ All commits from ${storyBranch} were already applied (patch-id match)`,
            );
          } else {
            this.log(
              `[GitOps] ✓ Rebased ${storyBranch} (${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`,
            );
          }
          mergeResults.push({
            branch: storyBranch,
            status: "merged",
            reason: "clean rebase",
          });
          continue;
        }

        // Strategy 1.5: Merge agent (AI conflict resolution)
        // Re-attempt rebase to get conflict markers, then let Claude resolve them
        if (this.resilience?.mergeAgentEnabled) {
          this.log(
            `[GitOps] Clean rebase conflicted for ${storyBranch}, trying AI merge agent...`,
          );
          let strategy15Success = false;
          try {
            // Re-create temp branch and attempt rebase to produce conflict state
            await this.git.raw([
              "checkout",
              "-b",
              tempBranch,
              `origin/${storyBranch}`,
            ]);
            // Start rebase — this will pause with conflicts
            await this.git.raw([
              "rebase",
              "--onto",
              featureBranch,
              `origin/${this.mainBranch}`,
              tempBranch,
            ]).catch(() => {}); // Expected to fail with conflicts

            // Find story title from branch name for context
            const storyTitle = storyBranch.replace(/^story\/\d+-/, "").replace(/-/g, " ");
            const resolved = await this.resolveConflictsWithAgent(storyBranch, featureBranch, storyTitle);

            if (resolved) {
              // Agent resolved conflicts — merge result into feature branch
              await this.git.checkout(featureBranch);
              await this.git.raw(["merge", "--ff-only", tempBranch]);
              await this.git.branch(["-D", tempBranch]);
              strategy15Success = true;
            }
          } catch {
            // Strategy 1.5 failed
          }

          if (!strategy15Success) {
            // Cleanup after failed merge agent attempt
            await this.git.raw(["rebase", "--abort"]).catch(() => {});
            try {
              await this.git.checkout(featureBranch);
            } catch {}
            try {
              await this.git.branch(["-D", tempBranch]);
            } catch {}
            await this.git.reset(["--hard", headBefore]);
          }

          if (strategy15Success) {
            const headAfter = (await this.git.revparse(["HEAD"])).trim();
            this.log(
              `[GitOps] ✓ Rebased ${storyBranch} via AI merge agent (${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`,
            );
            mergeResults.push({
              branch: storyBranch,
              status: "merged",
              reason: "AI merge agent",
            });
            continue;
          }

          this.log(
            `[GitOps] AI merge agent failed for ${storyBranch}, falling back to -X theirs...`,
          );
        }

        // Strategy 2: Rebase with -X theirs (auto-resolve conflicts preferring story's version)
        // In rebase context, "theirs" = the commit being replayed (story's commit).
        this.log(
          `[GitOps] Clean rebase conflicted for ${storyBranch}, retrying with -X theirs...`,
        );
        let strategy2Success = false;
        try {
          await this.git.raw([
            "checkout",
            "-b",
            tempBranch,
            `origin/${storyBranch}`,
          ]);
          await this.git.raw([
            "rebase",
            "--onto",
            featureBranch,
            `origin/${this.mainBranch}`,
            tempBranch,
            "-X",
            "theirs",
          ]);
          await this.git.checkout(featureBranch);
          await this.git.raw(["merge", "--ff-only", tempBranch]);
          await this.git.branch(["-D", tempBranch]);
          strategy2Success = true;
        } catch {
          await this.git.raw(["rebase", "--abort"]).catch(() => {});
          try {
            await this.git.checkout(featureBranch);
          } catch {}
          try {
            await this.git.branch(["-D", tempBranch]);
          } catch {}
          await this.git.reset(["--hard", headBefore]);
        }

        if (strategy2Success) {
          const headAfter = (await this.git.revparse(["HEAD"])).trim();
          this.log(
            `[GitOps] ✓ Rebased ${storyBranch} with -X theirs (${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`,
          );
          mergeResults.push({
            branch: storyBranch,
            status: "merged",
            reason: "rebase with -X theirs",
          });
          continue;
        }

        // Strategy 3: File-level checkout (last resort)
        // Gets all files that differ between main and story branch, checks them out
        this.log(
          `[GitOps] Rebase strategies failed for ${storyBranch}, trying file-level checkout...`,
        );
        try {
          const diffOutput = (
            await this.git.raw([
              "diff",
              "--name-only",
              `origin/${this.mainBranch}...origin/${storyBranch}`,
            ])
          ).trim();
          const storyFiles = diffOutput.split("\n").filter(Boolean);

          if (storyFiles.length > 0) {
            for (const file of storyFiles) {
              try {
                await this.git.raw([
                  "checkout",
                  `origin/${storyBranch}`,
                  "--",
                  file,
                ]);
              } catch {
                // File may have been deleted in story branch
              }
            }
            await this.git.add(".");
            await this.git.commit(
              `Merge story ${storyBranch} (file checkout of ${storyFiles.length} files)`,
            );
            const headAfter = (await this.git.revparse(["HEAD"])).trim();
            this.log(
              `[GitOps] ✓ Merged ${storyBranch} via file checkout (${storyFiles.length} files, ${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`,
            );
            mergeResults.push({
              branch: storyBranch,
              status: "merged",
              reason: `file checkout (${storyFiles.length} files)`,
            });
            continue;
          }
        } catch (checkoutErr) {
          const checkoutMsg =
            checkoutErr instanceof Error
              ? checkoutErr.message
              : String(checkoutErr);
          this.log(
            `[GitOps] File-level checkout failed: ${checkoutMsg.slice(0, 150)}`,
          );
          await this.git.reset(["--hard", headBefore]).catch(() => {});
        }

        // All strategies exhausted
        this.log(
          `[GitOps] ✗ FAILED to merge ${storyBranch} — all rebase strategies failed`,
        );
        mergeResults.push({
          branch: storyBranch,
          status: "failed",
          reason: "all strategies exhausted",
        });
      }

      // Log merge summary to dashboard
      const merged = mergeResults.filter(r => r.status === "merged").length;
      const failed = mergeResults.filter(r => r.status === "failed").length;
      this.log(`[GitOps] Merge summary: ${merged}/${storyBranches.length} merged, ${failed} failed`);
      if (failed > 0) {
        const failedBranches = mergeResults.filter(r => r.status === "failed").map(r => `${r.branch} (${r.reason})`);
        this.log(`[GitOps] ⚠ Failed branches: ${failedBranches.join(", ")}`);
      }

      // 3.5. Verify we have commits to push BEFORE pushing
      const featureHead = (await this.git.revparse(["HEAD"])).trim();
      const mainHead = (await this.git.revparse([`origin/${this.mainBranch}`])).trim();
      console.log(`[GitOps] After merges - feature HEAD: ${featureHead.slice(0, 7)}, main HEAD: ${mainHead.slice(0, 7)}`);

      if (featureHead === mainHead) {
        console.error(`[GitOps] Feature branch has no commits beyond main after all merges`);
        console.error(`[GitOps] This likely means all story branches were already merged or empty`);
        return undefined;
      }

      // Show commits that will be in PR
      const commitLog = await this.git.raw(["log", "--oneline", `origin/${this.mainBranch}..HEAD`]);
      console.log(`[GitOps] Commits to be included in PR:\n${commitLog || "(none)"}`);

      // 4. Push the feature branch
      this.log(`[GitOps] Pushing feature branch to remote...`);
      try {
        await this.git.push("origin", featureBranch, ["--set-upstream", "--force"]);
        console.log(`[GitOps] Pushed feature branch: ${featureBranch}`);
      } catch (pushError) {
        const pushMsg = pushError instanceof Error ? pushError.message : String(pushError);
        console.error(`[GitOps] Push failed: ${pushMsg}`);
        // Try alternative push method
        try {
          console.log(`[GitOps] Trying raw git push...`);
          await this.git.raw(["push", "-u", "--force", "origin", featureBranch]);
          console.log(`[GitOps] Raw push succeeded for ${featureBranch}`);
        } catch (rawPushError) {
          const rawMsg = rawPushError instanceof Error ? rawPushError.message : String(rawPushError);
          console.error(`[GitOps] Raw push also failed: ${rawMsg}`);
          // Continue anyway - branch may already be pushed from story execution
          console.log(`[GitOps] Continuing without push - branch may already exist on remote`);
        }
      }

      // 4.25. Verify there are actual changes compared to main before creating PR
      try {
        const diffStat = await this.git.raw(["diff", "--stat", `origin/${this.mainBranch}...${featureBranch}`]);
        if (!diffStat || diffStat.trim() === "") {
          console.error(`[GitOps] No differences between ${featureBranch} and origin/${this.mainBranch}`);
          console.error("[GitOps] Story branches may have been empty or already merged. Checking commit count...");

          // Check commit count
          const commitCount = await this.git.raw(["rev-list", "--count", `origin/${this.mainBranch}..${featureBranch}`]);
          console.log(`[GitOps] Commits ahead of main: ${commitCount.trim()}`);

          if (parseInt(commitCount.trim()) === 0) {
            console.error("[GitOps] Feature branch has no new commits - cannot create PR");
            return undefined;
          }
        } else {
          console.log(`[GitOps] Feature branch has changes:\n${diffStat.slice(0, 500)}`);
        }
      } catch (diffError) {
        console.warn(`[GitOps] Could not verify diff: ${diffError}`);
      }

      // 4.5. Check if a PR already exists for this branch
      try {
        const { stdout: existingPrJson } = await execFileAsync(
          "gh",
          ["pr", "view", featureBranch, "--json", "url,state"],
          { cwd: this.repoPath }
        );
        const existingPr = JSON.parse(existingPrJson.trim());
        if (existingPr.url && existingPr.state === "OPEN") {
          console.log(`[GitOps] Open PR already exists for ${featureBranch}: ${existingPr.url}`);
          return existingPr.url;
        } else if (existingPr.state === "MERGED") {
          console.log(`[GitOps] PR for ${featureBranch} was already merged: ${existingPr.url} — creating new PR`);
          // Fall through to create a new PR (branch has new commits from this run)
        } else if (existingPr.state === "CLOSED") {
          console.log(`[GitOps] PR for ${featureBranch} was closed: ${existingPr.url} — creating new PR`);
          // Fall through to create a new PR
        }
      } catch {
        // No existing PR found, proceed to create one
        console.log(`[GitOps] No existing PR for ${featureBranch}, creating new one...`);
      }

      // 5. Build PR description
      let description = `## Epic Implementation\n\n`;
      description += `This PR consolidates all stories from Epic ${jiraKey}.\n\n`;
      description += `### Stories Included\n\n`;
      for (const story of storyCompletions) {
        description += `- **Story ${story.storyIndex}**: ${story.title}\n`;
        if (story.filesModified && story.filesModified.length > 0) {
          const filesList = story.filesModified.slice(0, 3).join(", ");
          const moreCount = story.filesModified.length > 3 ? ` (+${story.filesModified.length - 3} more)` : "";
          description += `  - Files: ${filesList}${moreCount}\n`;
        }
      }
      description += `\n### Branches Merged\n\n`;
      for (const branch of storyBranches) {
        description += `- \`${branch}\`\n`;
      }

      // Add quality metrics if available
      if (qualityMetrics) {
        description += `\n### Code Quality\n\n`;
        description += `| Metric | Score | Details |\n`;
        description += `|--------|-------|--------|\n`;
        description += `| **Overall** | **${qualityMetrics.qualityScore}%** | |\n`;
        description += `| TypeCheck | ${qualityMetrics.typeErrors === 0 ? '✅ Pass' : `❌ ${qualityMetrics.typeErrors} errors`} | |\n`;
        description += `| Lint | ${qualityMetrics.lintErrors === 0 ? '✅ Pass' : `⚠️ ${qualityMetrics.lintErrors} errors`} | ${qualityMetrics.lintWarnings} warnings |\n`;
        description += `| Tests | ${qualityMetrics.testsFailed === 0 ? '✅ Pass' : `❌ ${qualityMetrics.testsFailed} failed`} | ${qualityMetrics.testsPassed} passed |\n`;
        description += `| Security | ${qualityMetrics.securityHigh === 0 ? '✅ Clean' : `🔴 ${qualityMetrics.securityHigh} high`} | ${qualityMetrics.securityMedium}M/${qualityMetrics.securityLow}L |\n`;
      }

      // 6. Create the PR - use direct API calls (bypasses subprocess issues)
      const prTitle = `${jiraKey}: ${epicTitle}`;
      const [owner, repo] = this.config.targetRepo.split("/");

      if (this.config.scmProvider === "bitbucket") {
        const bitbucketToken = process.env.SCM_TOKEN || process.env.BITBUCKET_TOKEN || this.config.githubToken;

        this.log(`[GitOps] Creating Bitbucket PR via API: ${owner}/${repo}`);
        console.log(`[GitOps] Creating Bitbucket PR via API: ${owner}/${repo}`);
        console.log(`[GitOps] Source: ${featureBranch} -> Destination: ${this.mainBranch}`);

        let prResult = await createBitbucketPRDirect(
          owner, repo, prTitle, featureBranch, this.mainBranch,
          description, bitbucketToken
        );

        if (!prResult) {
          console.log(`[GitOps] PR may already exist, searching...`);
          prResult = await findExistingBitbucketPR(owner, repo, featureBranch, bitbucketToken);
        }

        if (prResult) {
          console.log(`[GitOps] Bitbucket PR created: ${prResult.prUrl}`);
          return prResult.prUrl;
        }
        console.error(`[GitOps] Failed to create or find Bitbucket PR`);
        return undefined;

      } else if (this.config.scmProvider === "github" || !this.config.scmProvider) {
        const githubToken = process.env.SCM_TOKEN || process.env.GITHUB_TOKEN || this.config.githubToken;

        this.log(`[GitOps] Creating GitHub PR via API: ${owner}/${repo}`);
        console.log(`[GitOps] Creating GitHub PR via API: ${owner}/${repo}`);
        console.log(`[GitOps] Source: ${featureBranch} -> Destination: ${this.mainBranch}`);

        let prResult = await createGitHubPRDirect(
          owner, repo, prTitle, featureBranch, this.mainBranch,
          description, githubToken
        );

        if (!prResult) {
          console.log(`[GitOps] PR may already exist, searching...`);
          prResult = await findExistingGitHubPR(owner, repo, featureBranch, githubToken);
        }

        if (prResult) {
          console.log(`[GitOps] GitHub PR created: ${prResult.prUrl}`);
          return prResult.prUrl;
        }
        console.error(`[GitOps] Failed to create or find GitHub PR`);
        return undefined;

      } else {
        // GitLab: fallback to subprocess (can add direct API later if needed)
        const env = {
          ...process.env,
          TICKET_KEY: jiraKey,
          TICKET_SUMMARY: epicTitle,
          REPO_PATH: this.repoPath,
          BASE_BRANCH: this.mainBranch,
          DESCRIPTION: description,
        };

        const createPrScript = getExecutionScriptPath("git/create_pr.js");
        console.log(`[GitOps] Executing consolidated PR script: ${createPrScript}`);
        const { stdout, stderr } = await execFileAsync(
          "node",
          [createPrScript],
          { env, cwd: this.repoPath }
        );

        if (stderr) {
          stderr.split("\n").forEach((line) => {
            if (line.trim()) console.log(line);
          });
        }

        const result = JSON.parse(stdout.trim());

        if (result.success && result.prUrl) {
          console.log(`[GitOps] Consolidated PR created: ${result.prUrl}`);
          return result.prUrl;
        }
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
   * Create PR directly from a story branch.
   * Used for PR-per-story architecture (each story gets its own PR)
   * and for single-story tasks (bypasses consolidation).
   */
  async createPRFromBranch(
    storyBranch: string,
    jiraKey: string,
    epicTitle: string,
    prDescription: string,
    description: string,
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
      // Verify branch exists on remote
      const remoteBranch = `origin/${storyBranch}`;
      console.log(`[GitOps] Verifying ${remoteBranch} exists...`);

      // Build PR description for single story
      let fullDescription = `## Story Implementation\n\n`;
      fullDescription += `This PR implements ${jiraKey}: ${epicTitle}\n\n`;
      fullDescription += description || prDescription;

      // Add quality metrics if available
      if (qualityMetrics) {
        fullDescription += `\n### Code Quality\n\n`;
        fullDescription += `| Metric | Score | Details |\n`;
        fullDescription += `|--------|-------|--------|\n`;
        fullDescription += `| **Overall** | **${qualityMetrics.qualityScore}%** | |\n`;
        fullDescription += `| TypeCheck | ${qualityMetrics.typeErrors === 0 ? '✅ Pass' : `❌ ${qualityMetrics.typeErrors} errors`} | |\n`;
        fullDescription += `| Lint | ${qualityMetrics.lintErrors === 0 ? '✅ Pass' : `⚠️ ${qualityMetrics.lintErrors} errors`} | ${qualityMetrics.lintWarnings} warnings |\n`;
        fullDescription += `| Tests | ${qualityMetrics.testsFailed === 0 ? '✅ Pass' : `❌ ${qualityMetrics.testsFailed} failed`} | ${qualityMetrics.testsPassed} passed |\n`;
        fullDescription += `| Security | ${qualityMetrics.securityHigh === 0 ? '✅ Clean' : `🔴 ${qualityMetrics.securityHigh} high`} | ${qualityMetrics.securityMedium}M/${qualityMetrics.securityLow}L |\n`;
      }

      // Checkout the story branch to create PR from it
      // CRITICAL: First remove any worktree that has this branch checked out
      // This prevents "branch already checked out" errors
      try {
        const worktreeList = execSync("git worktree list --porcelain", {
          cwd: this.repoPath,
          encoding: "utf-8",
        });
        // Parse worktree list to find if our branch is checked out somewhere
        const lines = worktreeList.split("\n");
        let currentWorktreePath: string | null = null;
        for (const line of lines) {
          if (line.startsWith("worktree ")) {
            currentWorktreePath = line.substring(9);
          } else if (line.startsWith("branch ") && currentWorktreePath) {
            const branch = line.substring(7).replace("refs/heads/", "");
            if (branch === storyBranch) {
              console.log(`[GitOps] Removing worktree at ${currentWorktreePath} (has ${storyBranch} checked out)`);
              try {
                execSync(`git worktree remove "${currentWorktreePath}" --force`, {
                  cwd: this.repoPath,
                  stdio: "pipe",
                });
              } catch {
                // Force remove directory if git worktree remove fails
                const { rmSync } = await import("fs");
                rmSync(currentWorktreePath, { recursive: true, force: true });
              }
              execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe" });
              break;
            }
          }
        }
      } catch (e) {
        console.warn(`[GitOps] Could not check/remove worktrees: ${e}`);
      }

      // CRITICAL: Reset and clean before checkout to avoid dirty file errors
      await this.git.reset(["--hard", "HEAD"]);
      await this.git.clean("f", ["-d", "-x"]);
      await this.git.checkout(["-f", storyBranch]);

      // Create the PR using the execution script
      const env = {
        ...process.env,
        TICKET_KEY: jiraKey,
        TICKET_SUMMARY: epicTitle,
        REPO_PATH: this.repoPath,
        BASE_BRANCH: this.mainBranch,
        DESCRIPTION: fullDescription,
        // Tell create_pr.js to use current branch (story branch)
        STORY_BRANCH: storyBranch,
      };

      console.log(`[GitOps] Creating PR from story branch: ${storyBranch}`);

      const createPrScript = getExecutionScriptPath("git/create_pr.js");
      console.log(`[GitOps] Executing story PR script: ${createPrScript}`);
      const { stdout, stderr } = await execFileAsync(
        "node",
        [createPrScript],
        { env, cwd: this.repoPath }
      );

      // Log stderr for debugging
      if (stderr) {
        stderr.split("\n").forEach((line) => {
          if (line.trim()) console.log(line);
        });
      }

      const result = JSON.parse(stdout.trim());

      if (result.success && result.prUrl) {
        console.log(`[GitOps] PR created from story branch: ${result.prUrl}`);
        return result.prUrl;
      } else {
        console.error(`[GitOps] PR creation from story branch failed: ${result.error || "unknown error"}`);
        return undefined;
      }
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string; message: string };
      const msg = execError.message || String(error);

      if (execError.stderr) {
        execError.stderr.split("\n").forEach((line) => {
          if (line.trim()) console.error(line);
        });
      }

      // Log stdout too - it contains JSON with the actual error message
      if (execError.stdout) {
        try {
          const result = JSON.parse(execError.stdout.trim());
          if (result.error) {
            console.error(`[GitOps] PR creation error: ${result.error}`);
          }
        } catch {
          // Not JSON, log raw stdout
          execError.stdout.split("\n").forEach((line) => {
            if (line.trim()) console.error(`[GitOps] stdout: ${line}`);
          });
        }
      }

      console.error(`[GitOps] Failed to create PR from story branch: ${msg}`);
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
      // Reset any dirty state before fetching/checking out
      await this.git.reset(["--hard", "HEAD"]);
      await this.git.clean("f", ["-d", "-x"]);

      // Fetch all remote branches
      await this.git.fetch("origin");
      const branches = await this.git.branch(["-r"]);

      for (const branchName of branchCandidates) {
        const remoteBranch = `origin/${branchName}`;
        if (branches.all.includes(remoteBranch)) {
          console.log(`[GitOps] Found existing branch: ${branchName}`);

          // Checkout the existing branch (force to handle any remaining state)
          await this.git.checkout(["-f", "-b", branchName, remoteBranch]);
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

    lines.push(`## 🔄 PRIOR WORK CONTEXT (RETRY SCENARIO)`);
    lines.push(``);
    lines.push(`**IMPORTANT:** This is a RETRY. Previous work exists on branch \`${ctx.branchName}\`.`);
    lines.push(`Do NOT start from scratch. Review what's already done and CONTINUE from there.`);
    lines.push(``);

    // Show commits
    if (ctx.commits.length > 0) {
      lines.push(`### Previous Commits (${ctx.commits.length} total)`);
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
      lines.push(`### Existing Pull Request`);
      lines.push(`- PR: ${ctx.prUrl}`);
      lines.push(`- Status: ${ctx.prState || "unknown"}`);
      lines.push(``);

      if (ctx.prReviewComments && ctx.prReviewComments.length > 0) {
        lines.push(`### Review Feedback (CRITICAL - Address These)`);
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

    lines.push(`### Your Instructions for This Retry`);
    lines.push(`1. **Review existing code** - Check what's already implemented on this branch`);
    lines.push(`2. **Check git log** - See what commits were made: \`git log --oneline -10\``);
    lines.push(`3. **Address feedback** - If there are review comments above, fix those issues first`);
    lines.push(`4. **Continue work** - Only implement what's missing or broken`);
    lines.push(`5. **Commit incrementally** - Make small, focused commits`);
    lines.push(``);

    return lines.join("\n") + "\n";
  }
}
