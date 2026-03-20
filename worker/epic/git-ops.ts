/**
 * Git Operations for Epic Executor
 *
 * Handles repository cloning, branching, committing, and PR creation.
 * Each story gets its own branch for isolation.
 */

import { simpleGit, SimpleGit, SimpleGitOptions } from "simple-git";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, lstatSync, rmSync, chmodSync } from "fs";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import * as https from "https";

const execFileAsync = promisify(execFile);

/**
 * Build the correct Authorization header for Bitbucket API calls.
 *
 * Bitbucket API tokens (the only supported credential type since app passwords
 * were deprecated Sept 2025) require Basic auth with email:token.
 * Git clone uses x-bitbucket-api-token-auth:{token} — but REST API calls
 * MUST use the account email, not the git username.
 */
export function getBitbucketAuthHeader(token: string): string {
  const bitbucketEmail = process.env.BITBUCKET_EMAIL;

  if (!bitbucketEmail) {
    console.error("[Bitbucket] WARNING: BITBUCKET_EMAIL not set — API calls will fail. Bitbucket REST API requires Basic auth with email:token.");
  }

  // Always Basic auth: email:token (or just :token if email missing — will 401 but with a clear log above)
  const credentials = Buffer.from(`${bitbucketEmail || ""}:${token}`).toString("base64");
  return `Basic ${credentials}`;
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
    console.log("[GitOps] Token present: " + (this.config.githubToken ? "yes" : "NO"));
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

    // Fetch all branches from origin (not just main) so story branch refs are up to date
    try {
      await this.git.fetch(["origin"]);
    } catch (fetchError) {
      console.log(`[GitOps] Could not fetch origin - repo may be empty`);
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

    // Remove existing worktree if it exists (from previous failed run or revision)
    // Must handle: directory exists, git internal tracking exists, or both
    await this.forceRemoveWorktree(worktreePath);

    // Check if branch already exists on remote or locally
    const branches = await this.git.branch(["-a"]);
    const branchExists = branches.all.includes(branchName) ||
                         branches.all.includes(`remotes/origin/${branchName}`);

    if (branchExists) {
      console.log(`[GitOps] Branch ${branchName} exists, creating worktree from it...`);

      // If branch exists on remote, reset local ref to match remote
      // (prevents stale local branch from being used when remote was updated externally)
      const remoteRef = `remotes/origin/${branchName}`;
      if (branches.all.includes(remoteRef)) {
        try {
          execSync(`git branch -f "${branchName}" "origin/${branchName}"`, {
            cwd: this.repoPath,
            stdio: "pipe",
            timeout: 30_000,
          });
          console.log(`[GitOps] Reset local branch ${branchName} to match remote`);
        } catch (resetErr) {
          // May fail if branch is checked out — will still use local ref
          console.log(`[GitOps] Could not reset local branch to remote (non-blocking): ${resetErr instanceof Error ? resetErr.message : resetErr}`);
        }
      }

      // Create worktree with existing branch
      try {
        execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
          cwd: this.repoPath,
          stdio: "pipe",
          timeout: 120_000,
        });
      } catch (e) {
        // Branch might be checked out elsewhere, force it
        execSync(`git worktree add -f "${worktreePath}" "${branchName}"`, {
          cwd: this.repoPath,
          stdio: "pipe",
          timeout: 120_000,
        });
      }
    } else {
      console.log(`[GitOps] Creating new branch ${branchName} with worktree...`);
      // Create worktree with new branch based on main
      execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${this.mainBranch}"`, {
        cwd: this.repoPath,
        stdio: "pipe",
        timeout: 120_000,
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

    // Install pre-commit hook to enforce .gitignore entries even when
    // workers bypass git-ops and run `git add .` + `git commit` via Bash
    this.installPreCommitHook(worktreePath);

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
          execSync(`cp -al "${src}" "${dest}"`, { stdio: "pipe", timeout: 120_000 });
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
   * For each branch:
   * - Verify it exists on the remote
   * - Attempt merge with --no-edit
   * - On conflict: abort and skip that branch
   * - On error: reset and skip that branch
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

      // Attempt merge
      try {
        await worktreeGit.merge([remoteBranch, "--no-edit"]);
        merged.push(branch);
        console.log(`[GitOps] Merged dependency branch: ${branch}`);
      } catch (mergeError) {
        const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);

        // Check if there's a conflict — resolve at file level instead of aborting the entire merge
        try {
          const status = await worktreeGit.status();
          if (status.conflicted.length > 0) {
            const conflictedFiles = [...status.conflicted];
            console.warn(`[GitOps] Merge conflict with dependency branch ${branch}: ${conflictedFiles.join(", ")}`);

            // Resolve each conflicting file by keeping the current worktree's version (--ours)
            // This preserves non-conflicting files from the sibling branch while keeping our version
            // of the files that both branches modified.
            for (const file of conflictedFiles) {
              try {
                execSync(`git -C "${worktreePath}" checkout --ours -- "${file}"`, { encoding: "utf-8", timeout: 120_000 });
                execSync(`git -C "${worktreePath}" add -- "${file}"`, { encoding: "utf-8", timeout: 120_000 });
              } catch (resolveErr) {
                console.warn(`[GitOps] Failed to resolve conflict for ${file}: ${resolveErr instanceof Error ? resolveErr.message : resolveErr}`);
              }
            }

            // Complete the merge with resolved conflicts
            try {
              execSync(`git -C "${worktreePath}" -c core.editor=true commit --no-edit`, { encoding: "utf-8", timeout: 120_000 });
              merged.push(branch);
              console.log(`[GitOps] Merged dependency branch ${branch} (resolved ${conflictedFiles.length} conflicting file(s) with --ours)`);
            } catch (commitErr) {
              // If commit fails, abort and fall back to old behavior
              console.warn(`[GitOps] Failed to commit resolved merge for ${branch}, aborting`);
              await worktreeGit.merge(["--abort"]);
              conflicted.push(branch);
            }
            continue;
          }
        } catch {
          // status failed
        }

        // Not a conflict - some other error; reset to recover
        console.error(`[GitOps] Failed to merge dependency branch ${branch}: ${msg}`);
        try {
          await worktreeGit.reset(["--hard", "HEAD"]);
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
    // Strip "Story N:" prefix — storyIndex already provides ordering
    const stripped = storyTitle.replace(/^story\s*\d+\s*:\s*/i, "");
    // Sanitize title for branch name — short, readable slug
    const sanitizedTitle = stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 30)
      .replace(/-$/, "");

    if (jiraKey) {
      return `story/${jiraKey.toLowerCase()}/${storyIndex}-${sanitizedTitle}`;
    }
    return `story/${storyIndex}-${sanitizedTitle}`;
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
    this.removeWindowsReservedFiles(worktreePath);

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

    // --no-verify: skip husky/pre-commit hooks — the executor runs its own quality gates
    // with full retry + fixer support. Letting husky run a second uncontrolled gate bypasses
    // the gate retry system and causes spurious failures.
    const result = await worktreeGit.commit(formattedMessage, { "--no-verify": null });
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
      const errMsg = e instanceof Error ? e.message.replace(/:[^@:]+@/g, ':***@') : String(e);
      console.error(`[GitOps] Failed to push branch ${branchName}: ${errMsg}`);
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
    const prefix = `origin/story/${jiraKey.toLowerCase()}/`;

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
    this.removeWindowsReservedFiles(worktreePath);

    // Stage all changes
    await worktreeGit.add(".");

    const status = await worktreeGit.status();
    if (status.staged.length === 0) {
      return "";
    }

    const result = await worktreeGit.commit(message, { "--no-verify": null });
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
   * Aggressively remove a worktree path and all git internal tracking for it.
   * Handles: directory exists, git internal tracking exists, or both.
   * Uses multiple fallback strategies for reliability in Docker containers.
   */
  async forceRemoveWorktree(worktreePath: string): Promise<void> {
    const worktreeName = path.basename(worktreePath);
    const needsCleanup = existsSync(worktreePath) ||
      existsSync(path.join(this.repoPath, ".git", "worktrees", worktreeName));

    if (!needsCleanup) return;

    console.log(`[GitOps] Force-removing worktree: ${worktreePath}`);

    // 1. Try git worktree remove --force
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.repoPath,
        stdio: "pipe",
        timeout: 120_000,
      });
    } catch {
      // Expected to fail if worktree is in a bad state
    }

    // 2. Force-remove the directory via shell (more reliable than rmSync in Docker)
    if (existsSync(worktreePath)) {
      try {
        execSync(`rm -rf "${worktreePath}"`, { cwd: this.repoPath, stdio: "pipe", timeout: 120_000 });
      } catch {
        // Fallback to Node's rmSync
        const { rmSync } = await import("fs");
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // 3. Remove git's internal worktree tracking (.git/worktrees/<name>/)
    const internalWorktreePath = path.join(this.repoPath, ".git", "worktrees", worktreeName);
    if (existsSync(internalWorktreePath)) {
      try {
        execSync(`rm -rf "${internalWorktreePath}"`, { cwd: this.repoPath, stdio: "pipe", timeout: 120_000 });
      } catch {
        const { rmSync } = await import("fs");
        rmSync(internalWorktreePath, { recursive: true, force: true });
      }
    }

    // 4. Prune stale references
    try {
      execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe", timeout: 120_000 });
    } catch {
      // Ignore prune errors
    }

    // 5. Verify cleanup succeeded
    if (existsSync(worktreePath)) {
      console.error(`[GitOps] WARNING: Failed to remove worktree directory: ${worktreePath}`);
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
    await this.forceRemoveWorktree(worktreePath);
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
      execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe", timeout: 120_000 });
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
    this.removeWindowsReservedFiles(this.repoPath);

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

    const result = await this.git.commit(formattedMessage, { "--no-verify": null });
    console.log("[GitOps] Committed:", result.commit, "Files:", status.staged.length);

    return result.commit;
  }

  /**
   * Format persona for commit co-author line.
   */
  /**
   * Ensure node_modules, build outputs, and workermill temp files are in .gitignore
   * so `git add .` never stages them.
   * Greenfield projects may not have a .gitignore yet when the first commit runs.
   */
  private ensureNodeModulesIgnored(repoPath: string): void {
    const gitignorePath = path.join(repoPath, ".gitignore");
    try {
      const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
      const lines = content.split("\n").map(l => l.trim());
      let additions = "";

      // Always ignore WorkerMill internal files
      for (const wmFile of [".workermill-message.md", ".workermill-response.md", ".workermill-answer.md"]) {
        if (!lines.some(line => line === wmFile)) {
          additions += `\n${wmFile}`;
          console.log(`[GitOps] Added ${wmFile} to .gitignore`);
        }
      }

      // Only add build artifact dirs that are relevant to the detected project type.
      // If the repo already has a .gitignore with specific entries, respect it —
      // the PRD may specify exact .gitignore content and reviewers flag deviations.
      const hasPackageJson = existsSync(path.join(repoPath, "package.json"));
      if (hasPackageJson) {
        if (!lines.some(line => line === "node_modules" || line === "node_modules/")) {
          additions += "\nnode_modules";
          console.log("[GitOps] Added node_modules to .gitignore");
        }
        // Only add JS/TS build dirs for Node projects
        for (const buildDir of [".next", "out", ".nuxt", ".output", ".svelte-kit"]) {
          if (!lines.some(line => line === buildDir || line === `${buildDir}/`)) {
            additions += `\n${buildDir}`;
            console.log(`[GitOps] Added ${buildDir} to .gitignore`);
          }
        }
      }

      if (additions) {
        appendFileSync(gitignorePath, additions + "\n");
      }
    } catch (e) {
      console.warn("[GitOps] Failed to ensure entries in .gitignore:", e);
    }
  }

  /**
   * Install a pre-commit hook in the worktree that enforces .gitignore entries.
   * This catches workers that bypass git-ops and run `git add .` + `git commit`
   * directly via the Bash tool — the hook unstages forbidden directories before
   * the commit is finalized.
   */
  private installPreCommitHook(worktreePath: string): void {
    try {
      // In a worktree, .git is a file (pointer), not a directory.
      // Skip hook installation — the quality runner handles gate enforcement
      // after execution, so hooks here are redundant.
      const gitPath = path.join(worktreePath, ".git");
      if (existsSync(gitPath) && !lstatSync(gitPath).isDirectory()) {
        return;
      }

      const hooksDir = path.join(worktreePath, ".git", "hooks");
      mkdirSync(hooksDir, { recursive: true });

      // Only unstage dangerous dirs — do NOT modify .gitignore (PRD may specify exact content)
      const UNSTAGE_DIRS = [".next", "dist", "build", "out", ".nuxt", ".output", ".svelte-kit", "node_modules", "__pycache__", ".venv", "venv"];
      const hookScript = `#!/bin/sh
# WorkerMill pre-commit hook — safety net for build artifacts and secrets
# Unstages dangerous directories if a worker runs 'git add .' directly.
# Does NOT modify .gitignore — that's the worker's responsibility per the PRD.

${UNSTAGE_DIRS.map(d => `git rm -r --cached --quiet "${d}/" 2>/dev/null || true`).join("\n")}

# Also unstage .env* files (security)
git rm --cached --quiet .env.local 2>/dev/null || true
git rm --cached --quiet .env 2>/dev/null || true
`;
      writeFileSync(path.join(hooksDir, "pre-commit"), hookScript);
      chmodSync(path.join(hooksDir, "pre-commit"), 0o755);
      console.log("[GitOps] Installed pre-commit hook in worktree");
    } catch (e) {
      console.warn("[GitOps] Could not install pre-commit hook:", e);
      // Non-fatal — ensureNodeModulesIgnored still runs as backup
    }
  }

  private removeWindowsReservedFiles(dirPath: string): void {
    // Windows reserved device names — cannot exist as files on NTFS
    const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..+)?$/i;
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        if (RESERVED.test(entry)) {
          try {
            rmSync(full, { recursive: true, force: true });
            console.log(`[GitOps] Removed Windows-reserved file: ${full}`);
          } catch {
            /* may already be gone */
          }
        } else {
          try {
            // lstatSync avoids following symlinks (prevents infinite loops)
            const stat = lstatSync(full);
            if (stat.isDirectory() && entry !== "node_modules" && entry !== ".git") {
              walk(full);
            }
          } catch {
            /* stat failure, skip */
          }
        }
      }
    };
    walk(dirPath);
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
   * Return to the main branch.
   */
  async checkoutMain(): Promise<void> {
    await this.git.checkout(this.mainBranch);
  }

  /**
   * Revert the last merge commit on a branch and force-push.
   */
  async revertLastMerge(branch: string): Promise<void> {
    await this.git.checkout(branch);
    await this.git.reset(["--hard", "HEAD~1"]);
    await this.git.push(["origin", branch, "--force"]);
    await this.git.checkout(this.mainBranch);
    this.log(`[GitOps] Reverted last merge on ${branch}`);
  }

  /**
   * Create an integration branch for incremental story merging.
   * The integration branch starts from the main branch and stories
   * merge into it one at a time as they complete.
   */
  async createIntegrationBranch(jiraKey: string): Promise<string> {
    const branchName = `integration/${jiraKey.toLowerCase()}`;

    // Fetch latest
    await this.git.fetch(["origin"]);

    // Delete local branch if it exists (stale from previous run)
    try {
      await this.git.branch(["-D", branchName]);
    } catch {
      // Branch doesn't exist locally, fine
    }

    // Delete remote branch if it exists (stale from previous run)
    try {
      await this.git.push(["origin", "--delete", branchName]);
    } catch {
      // Branch doesn't exist on remote, fine
    }

    // Create from main
    await this.git.checkoutBranch(branchName, `origin/${this.mainBranch}`);
    await this.git.push(["origin", branchName, "-u"]);

    // Return to main
    await this.git.checkout(this.mainBranch);

    this.log(`[GitOps] Created integration branch: ${branchName}`);
    return branchName;
  }

  /**
   * Merge a single story branch into the integration branch.
   * Returns merge success status and any error details.
   */
  async mergeStoryIntoIntegration(
    integrationBranch: string,
    storyBranch: string,
    storyIndex: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Fetch latest state
      await this.git.fetch(["origin"]);

      // Checkout integration branch
      await this.git.checkout(integrationBranch);
      await this.git.reset(["--hard", `origin/${integrationBranch}`]);

      // Merge the story branch
      const remoteBranch = `origin/${storyBranch}`;
      try {
        await this.git.merge([remoteBranch, "--no-edit", "--no-ff"]);
      } catch (mergeError) {
        const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);

        // Capture conflicted files BEFORE aborting — status is clean after abort
        const status = await this.git.status();
        const conflictedFiles = status.conflicted;

        // Conflicts mean this story's code clashes with previously integrated stories.
        // Do NOT auto-resolve — abort and route back for revision so the expert can
        // fix the conflict with full context about what the other stories did.
        try {
          await this.git.merge(["--abort"]);
        } catch {
          // Reset hard as fallback
          await this.git.reset(["--hard", `origin/${integrationBranch}`]);
        }

        const conflictInfo = conflictedFiles.length > 0
          ? ` (conflicting files: ${conflictedFiles.join(", ")})`
          : "";
        return { success: false, error: `Merge conflict with integration branch${conflictInfo}: ${msg}` };
      }

      // Push integration branch
      await this.git.push(["origin", integrationBranch]);

      this.log(`[GitOps] Merged story ${storyIndex} (${storyBranch}) into ${integrationBranch}`);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.log(`[GitOps] Failed to merge story ${storyIndex} into integration: ${msg}`);

      // Try to recover to a clean state
      try {
        await this.git.checkout(this.mainBranch);
      } catch {
        // Best effort
      }

      return { success: false, error: msg };
    }
  }

  /**
   * Rename a branch (local + remote).
   */
  async renameBranch(oldName: string, newName: string): Promise<void> {
    // No-op if names are identical — deleting the old remote when old === new
    // would destroy the branch (and auto-close any PR targeting it).
    if (oldName === newName) {
      this.log(`[GitOps] renameBranch: old === new (${oldName}) — skipping`);
      return;
    }

    await this.git.fetch(["origin"]);
    await this.git.checkout(oldName);
    await this.git.branch(["-m", oldName, newName]);
    await this.git.push(["origin", newName]);
    try {
      await this.git.push(["origin", "--delete", oldName]);
    } catch {
      // Old branch may not exist on remote
    }
    await this.git.checkout(this.mainBranch);
    this.log(`[GitOps] Renamed branch ${oldName} -> ${newName}`);
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
    const repoFlag = this.config.targetRepo ? ' -R ' + this.config.targetRepo : '';
    return 'gh pr create' + repoFlag + ' --base ' + this.mainBranch + ' --head ' + branchName + ' --title "' + title + '" --body "' + body.replace(/"/g, '\\"') + '"';
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

  getMainBranch(): string {
    return this.mainBranch;
  }

  /**
   * Get the HEAD commit SHA of the current branch.
   */
  getHeadSha(): string {
    try {
      const sha = execSync("git rev-parse HEAD", {
        cwd: this.repoPath,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      return sha;
    } catch {
      return "";
    }
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
   * After single-story PR creation, the repo may
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
        const featureBranch = `feature/${jiraKey.toLowerCase()}`;
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
    const ticketSummary = storyTitle;

    const env = {
      ...process.env,
      TICKET_KEY: ticketKey,
      TICKET_SUMMARY: ticketSummary,
      REPO_PATH: this.repoPath,
      BASE_BRANCH: this.mainBranch,
      DESCRIPTION: `Epic story implementation.\n\n${storyTitle}`,
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
   * Story branches follow the pattern: story/<jiraKey>/<N>-<title> or story/<N>-<title>
   */
  async getStoryBranches(jiraKey?: string): Promise<string[]> {
    // Fetch with prune to ensure we have latest remote state
    console.log("[GitOps] Fetching all remote branches before searching for story branches...");
    await this.git.fetch(["--all", "--prune"]);

    const branches = await this.git.branch(["-r"]);
    const prefix = jiraKey
      ? `origin/story/${jiraKey.toLowerCase()}/`
      : "origin/story/";

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
    // Format: story/tb-7/0-title → index is segment after last "/"
    const byIndex = new Map<number, string[]>();
    for (const b of allMatching) {
      const match = b.match(/\/(\d+)-/);
      const idx = parseInt(match?.[1] ?? "-1");
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
   * Capture git log and diff summary from story branches before they are deleted.
   * Returns a map of story index → human-readable summary of prior work.
   */
  async captureStoryBranchSummaries(
    jiraKey: string | undefined,
    storyIndices: Set<number>
  ): Promise<Record<number, string>> {
    const result: Record<number, string> = {};
    if (!jiraKey) return result;

    await this.git.fetch(["--all", "--prune"]);
    const branches = await this.git.branch(["-r"]);
    const prefix = `origin/story/${jiraKey.toLowerCase()}/`;

    for (const idx of storyIndices) {
      const storyBranch = branches.all.find((b) => {
        if (!b.startsWith(prefix)) return false;
        const afterPrefix = b.substring(prefix.length);
        const storyIdx = parseInt(afterPrefix.split("-")[0], 10);
        return storyIdx === idx;
      });
      if (!storyBranch) continue;

      try {
        // Get commit log (story commits only, not merge base ancestors)
        const logOutput = await this.git.log([
          `origin/${this.mainBranch}..${storyBranch}`,
          "--oneline",
          "--no-merges",
          "-20",
        ]);
        const commits = logOutput.all.map(
          (c) => `- \`${c.hash.substring(0, 7)}\` ${c.message}`
        );

        // Get files changed vs main
        let filesChanged: string[] = [];
        try {
          const diffOutput = await this.git.raw([
            "diff", "--name-only",
            `origin/${this.mainBranch}...${storyBranch}`,
          ]);
          filesChanged = diffOutput.trim().split("\n").filter(Boolean);
        } catch {
          // diff may fail if branches have diverged significantly
        }

        if (commits.length === 0 && filesChanged.length === 0) continue;

        const lines: string[] = [];
        lines.push(`### Prior Attempt (Revision ${idx})`);
        lines.push(`Branch: \`${storyBranch.replace("origin/", "")}\``);
        if (commits.length > 0) {
          lines.push(`\n**Commits from previous attempt:**`);
          lines.push(...commits);
        }
        if (filesChanged.length > 0) {
          lines.push(`\n**Files changed (${filesChanged.length}):** ${filesChanged.join(", ")}`);
        }
        result[idx] = lines.join("\n");
      } catch (e) {
        console.warn(`[GitOps] Could not capture prior work for story ${idx}: ${e}`);
      }
    }

    return result;
  }

  /**
   * Delete story branches for this epic from remote and local.
   * Used during revision to force fresh branches from main so that
   * stale branch history doesn't contaminate re-execution.
   *
   * @param jiraKey - Jira issue key to scope branch search (e.g., "TB-8")
   * @param storyIndicesToDelete - If provided, only delete branches for these story indices.
   *   Branches are named `story/{jiraKey}/{storyIndex}-{slug}`, so we match on the index prefix.
   *   If omitted, deletes ALL story branches (full revision).
   */
  async deleteStoryBranches(jiraKey?: string, storyIndicesToDelete?: Set<number>): Promise<void> {
    console.log(
      `[GitOps] Deleting story branches for revision (jiraKey: ${jiraKey || "none"}, indices: ${storyIndicesToDelete ? `[${Array.from(storyIndicesToDelete).join(", ")}]` : "all"})...`,
    );

    await this.git.fetch(["--all", "--prune"]);
    const branches = await this.git.branch(["-r"]);
    const prefix = jiraKey
      ? `origin/story/${jiraKey.toLowerCase()}/`
      : "origin/story/";

    let storyBranches = branches.all
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.replace("origin/", ""));

    // If selective revision, only delete branches for affected story indices
    if (storyIndicesToDelete) {
      storyBranches = storyBranches.filter((branch) => {
        // Branch format: story/{jiraKey}/{storyIndex}-{slug}
        // Extract the segment after the prefix to get "{storyIndex}-{slug}"
        const afterPrefix = branch.substring(prefix.replace("origin/", "").length);
        const dashIdx = afterPrefix.indexOf("-");
        const indexStr = dashIdx >= 0 ? afterPrefix.substring(0, dashIdx) : afterPrefix;
        const storyIndex = parseInt(indexStr, 10);
        return !isNaN(storyIndex) && storyIndicesToDelete.has(storyIndex);
      });
    }

    if (storyBranches.length === 0) {
      console.log("[GitOps] No story branches to delete");
      return;
    }

    console.log(
      `[GitOps] Deleting ${storyBranches.length} story branches: ${storyBranches.join(", ")}`,
    );

    // Force-remove worktrees that have story branches checked out.
    // Without this, `git branch -D` fails silently because the branch
    // is still "checked out" in the worktree from the previous execution.
    for (const branch of storyBranches) {
      const worktreePath = this.activeWorktrees.get(branch);
      if (worktreePath) {
        try {
          await this.forceRemoveWorktree(worktreePath);
          this.activeWorktrees.delete(branch);
          console.log(`[GitOps] Removed worktree for branch ${branch}`);
        } catch (e) {
          console.warn(`[GitOps] Could not remove worktree for ${branch}: ${e}`);
        }
      }
    }

    // Prune any remaining stale worktree references
    try {
      execSync("git worktree prune", { cwd: this.repoPath, stdio: "pipe", timeout: 120_000 });
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
   * Post-merge cleanup: delete story/feature branches.
   * Called after a consolidated PR is merged. Never throws — cleanup failure
   * must not fail the task. Does NOT close PRs — PRs are kept for history.
   */
  async postMergeCleanup(jiraKey: string): Promise<void> {
    try {
      console.log(`[GitOps] Starting post-merge cleanup for ${jiraKey}`);

      // 1. Delete story branches (reuse existing proven method)
      try {
        await this.deleteStoryBranches(jiraKey);
      } catch (e) {
        console.warn(`[GitOps] Story branch cleanup failed: ${e}`);
      }

      // 2. Delete feature branch if still on remote (squash merge doesn't always auto-delete)
      try {
        const featureBranch = `feature/${jiraKey.toLowerCase()}`;
        await this.git.push("origin", `:${featureBranch}`);
        console.log(`[GitOps] Deleted remote feature branch: ${featureBranch}`);
      } catch {
        // Feature branch may already be deleted or never existed
      }

      console.log(`[GitOps] Post-merge cleanup complete for ${jiraKey}`);
    } catch (e) {
      console.warn(`[GitOps] Post-merge cleanup failed (non-fatal): ${e}`);
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
    // Defense-in-depth: never create a PR with failing tests
    if (qualityMetrics?.testsFailed && qualityMetrics.testsFailed > 0) {
      console.error(`[GitOps] BLOCKED: Cannot create PR with ${qualityMetrics.testsFailed} failing test(s)`);
      return undefined;
    }

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
      try {
        await this.git.checkout(["-f", this.mainBranch]);
      } catch (checkoutErr) {
        const msg = checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
        console.warn(`[GitOps] Force checkout failed: ${msg} — cleaning and retrying`);
        // Remove Windows-reserved files that git can't delete (e.g. nul, con, aux)
        this.removeWindowsReservedFiles(this.repoPath);
        await this.git.clean("f", ["-d", "-x"]);
        await this.git.checkout(["-f", this.mainBranch]);
      }

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

      const featureBranch = `feature/${jiraKey.toLowerCase()}`;

      // Delete local feature branch if it exists
      try {
        await this.git.branch(["-D", featureBranch]);
      } catch {
        // Branch doesn't exist locally, that's fine
      }

      await this.git.checkoutBranch(featureBranch, this.mainBranch);
      console.log(`[GitOps] Created feature branch: ${featureBranch}`);

      // 3. Merge each story branch into the feature branch
      // Using raw git commands to avoid simple-git throwing on stderr output
      this.log(`[GitOps] Merging ${storyBranches.length} story branches into ${featureBranch}...`);
      const mergeResults: Array<{ branch: string; status: "merged" | "skipped" | "failed"; reason?: string }> = [];
      for (const storyBranch of storyBranches) {
        this.log(`[GitOps] Merging ${storyBranch}...`);

        // Record HEAD before merge to verify it advances
        const headBefore = (await this.git.revparse(["HEAD"])).trim();
        const storyCommit = (await this.git.revparse([`origin/${storyBranch}`])).trim();

        // Check if already merged (story commit is ancestor of HEAD)
        // IMPORTANT: Only skip if the story's TIP commit is an ancestor AND the story
        // has no unique non-merge commits that might be missing. Incremental rebase
        // creates dependency merges that can make merge-base falsely report "ancestor".
        try {
          const mergeBase = (await this.git.raw(["merge-base", "HEAD", storyCommit])).trim();
          if (mergeBase === storyCommit) {
            // Verify that all of the story's OWN commits are also ancestors of HEAD
            const ownCommitsRaw = (await this.git.raw([
              "log", "--first-parent", "--no-merges", "--reverse", "--format=%H",
              `origin/${this.mainBranch}..origin/${storyBranch}`
            ])).trim();
            const ownCommits = ownCommitsRaw ? ownCommitsRaw.split("\n").filter(Boolean) : [];
            let allOwnMerged = true;
            for (const oc of ownCommits) {
              try {
                const ocBase = (await this.git.raw(["merge-base", "--is-ancestor", oc, "HEAD"]));
              } catch {
                // --is-ancestor exits non-zero if NOT an ancestor
                allOwnMerged = false;
                break;
              }
            }
            if (allOwnMerged) {
              this.log(`[GitOps] Story branch ${storyBranch} already merged (commit ${storyCommit.slice(0, 7)} is ancestor of HEAD, ${ownCommits.length} own commits verified)`);
              mergeResults.push({ branch: storyBranch, status: "merged", reason: "already merged" });
              continue;
            }
            this.log(`[GitOps] Story branch ${storyBranch} tip is ancestor of HEAD but has unmerged own commits — proceeding with merge`);
          }
        } catch {
          // merge-base failed, try to merge anyway
        }

        // Fix: Extract story's own commits (excluding dependency merge commits)
        // to detect if content was already applied via another story's dependency merge
        try {
          const ownCommits = (await this.git.raw([
            "log", "--first-parent", "--no-merges", "--reverse", "--format=%H",
            `origin/${this.mainBranch}..origin/${storyBranch}`
          ])).trim().split("\n").filter(Boolean);

          if (ownCommits.length === 0) {
            this.log(`[GitOps] ⊘ ${storyBranch} has no own commits (only dependency merges) — skipping`);
            mergeResults.push({ branch: storyBranch, status: "skipped", reason: "no own commits" });
            continue;
          }
        } catch {
          // If commit listing fails, proceed with merge attempt
        }

        // Clean working tree before merge to avoid "local changes would be overwritten"
        await this.git.reset(["--hard", "HEAD"]);
        await this.git.clean("f", ["-d", "-x"]);

        // Try merge using raw git command to handle stderr properly
        try {
          // Use raw to get actual exit code behavior
          await this.git.raw(["merge", `origin/${storyBranch}`, "--no-edit", "--no-ff"]);
          const headAfter = (await this.git.revparse(["HEAD"])).trim();

          // CRITICAL: Detect silent no-op merges where git says "Already up to date"
          // but the story branch has unique commits (e.g. .tsx files) that should be included.
          // This happens when story branches have dependency merges that make git think
          // the content is reachable, even though the story's OWN commits aren't merged.
          if (headAfter === headBefore) {
            this.log(`[GitOps] ⚠️ Merge of ${storyBranch} was a no-op (HEAD unchanged) — cherry-picking own commits...`);
            try {
              // Find commits unique to this story (exclude dependency merge commits)
              const ownCommits = (await this.git.raw([
                "log", "--first-parent", "--no-merges", "--reverse", "--format=%H",
                `origin/${this.mainBranch}..origin/${storyBranch}`
              ])).trim().split("\n").filter(Boolean);

              if (ownCommits.length > 0) {
                for (const commit of ownCommits) {
                  try {
                    await this.git.raw(["cherry-pick", commit, "--no-commit"]);
                  } catch {
                    // If cherry-pick conflicts, accept theirs
                    await this.git.raw(["checkout", "--theirs", "."]);
                    await this.git.raw(["add", "-A"]);
                  }
                }
                // Commit all cherry-picked changes as one merge-like commit
                await this.git.raw(["commit", "--allow-empty", "-m",
                  `Merge story branch '${storyBranch}' (cherry-picked ${ownCommits.length} commits)`]);
                const headFixed = (await this.git.revparse(["HEAD"])).trim();
                this.log(`[GitOps] ✓ Cherry-picked ${ownCommits.length} commits from ${storyBranch} (${headBefore.slice(0, 7)} → ${headFixed.slice(0, 7)})`);
                mergeResults.push({ branch: storyBranch, status: "merged", reason: "cherry-picked (merge was no-op)" });
              } else {
                this.log(`[GitOps] ⊘ ${storyBranch} has no own commits to cherry-pick — skipping`);
                mergeResults.push({ branch: storyBranch, status: "skipped", reason: "no own commits after no-op merge" });
              }
            } catch (cherryErr) {
              const cherryMsg = cherryErr instanceof Error ? cherryErr.message : String(cherryErr);
              this.log(`[GitOps] ⚠️ Cherry-pick fallback failed for ${storyBranch}: ${cherryMsg}`);
              // Reset to clean state
              await this.git.reset(["--hard", headBefore]);
              mergeResults.push({ branch: storyBranch, status: "failed", reason: `no-op merge, cherry-pick failed: ${cherryMsg}` });
            }
            continue;
          }

          this.log(`[GitOps] ✓ Merged ${storyBranch} (${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`);
          mergeResults.push({ branch: storyBranch, status: "merged" });
          continue;
        } catch (mergeError) {
          // raw() throws on non-zero exit code, which means real failure
          const msg = mergeError instanceof Error ? mergeError.message : String(mergeError);

          // Check if merge actually succeeded despite error
          const headAfter = (await this.git.revparse(["HEAD"])).trim();
          if (headAfter !== headBefore) {
            this.log(`[GitOps] ✓ Merged ${storyBranch} (HEAD moved despite error: ${headBefore.slice(0, 7)} → ${headAfter.slice(0, 7)})`);
            mergeResults.push({ branch: storyBranch, status: "merged" });
            continue;
          }

          // Check for conflicts — try fallback strategies before giving up
          const status = await this.git.status();
          if (status.conflicted.length > 0) {
            this.log(`[GitOps] Merge conflict on ${storyBranch}: ${status.conflicted.join(", ")} — trying fallback strategies...`);
            await this.git.merge(["--abort"]).catch(() => {});

            // Fallback 1: merge with -X theirs (prefer incoming story changes for conflicting hunks)
            // This works well for additive changes where stories add similar imports/hooks
            try {
              await this.git.reset(["--hard", "HEAD"]);
              await this.git.raw(["merge", `origin/${storyBranch}`, "--no-edit", "--no-ff", "-X", "theirs"]);
              const headAfterTheirs = (await this.git.revparse(["HEAD"])).trim();
              this.log(`[GitOps] ✓ Merged ${storyBranch} with -X theirs (${headBefore.slice(0, 7)} → ${headAfterTheirs.slice(0, 7)})`);
              mergeResults.push({ branch: storyBranch, status: "merged", reason: "resolved with -X theirs" });
              continue;
            } catch {
              await this.git.merge(["--abort"]).catch(() => {});
            }

            // Fallback 2: cherry-pick the story branch's commits on top of current HEAD
            try {
              await this.git.reset(["--hard", "HEAD"]);
              // Find commits unique to the story branch (not on main)
              const cherryCommits = (await this.git.raw([
                "log", "--reverse", "--format=%H",
                `origin/${this.mainBranch}..origin/${storyBranch}`
              ])).trim().split("\n").filter(Boolean);

              if (cherryCommits.length > 0) {
                for (const commit of cherryCommits) {
                  await this.git.raw(["cherry-pick", commit, "--no-commit"]);
                }
                await this.git.commit(`Merge story ${storyBranch} (cherry-picked ${cherryCommits.length} commits)`, { "--no-verify": null });
                const headAfterCherry = (await this.git.revparse(["HEAD"])).trim();
                this.log(`[GitOps] ✓ Merged ${storyBranch} via cherry-pick (${cherryCommits.length} commits, ${headBefore.slice(0, 7)} → ${headAfterCherry.slice(0, 7)})`);
                mergeResults.push({ branch: storyBranch, status: "merged", reason: "cherry-picked" });
                continue;
              }
            } catch {
              // Cherry-pick also conflicted, reset and try next fallback
              await this.git.raw(["cherry-pick", "--abort"]).catch(() => {});
              await this.git.reset(["--hard", "HEAD"]).catch(() => {});
            }

            // Fallback 3: take the story branch's file versions directly for conflicted files
            try {
              await this.git.reset(["--hard", "HEAD"]);
              // Get list of files changed by the story branch
              const changedFiles = (await this.git.raw([
                "diff", "--name-only", `origin/${this.mainBranch}...origin/${storyBranch}`
              ])).trim().split("\n").filter(Boolean);

              if (changedFiles.length > 0) {
                // Checkout each changed file from the story branch
                for (const file of changedFiles) {
                  try {
                    await this.git.raw(["checkout", `origin/${storyBranch}`, "--", file]);
                  } catch {
                    // File may not exist in story branch (deleted), skip
                  }
                }
                await this.git.add(".");
                await this.git.commit(`Merge story ${storyBranch} (file-level checkout of ${changedFiles.length} files)`, { "--no-verify": null });
                const headAfterCheckout = (await this.git.revparse(["HEAD"])).trim();
                this.log(`[GitOps] ✓ Merged ${storyBranch} via file checkout (${changedFiles.length} files, ${headBefore.slice(0, 7)} → ${headAfterCheckout.slice(0, 7)})`);
                mergeResults.push({ branch: storyBranch, status: "merged", reason: "file-level checkout" });
                continue;
              }
            } catch (checkoutErr) {
              const checkoutMsg = checkoutErr instanceof Error ? checkoutErr.message : String(checkoutErr);
              console.error(`[GitOps] File checkout fallback failed for ${storyBranch}: ${checkoutMsg.slice(0, 200)}`);
              await this.git.reset(["--hard", "HEAD"]).catch(() => {});
            }

            // All fallbacks exhausted
            this.log(`[GitOps] ✗ FAILED to merge ${storyBranch} — all merge strategies failed (conflicts: ${status.conflicted.join(", ")})`);
            mergeResults.push({ branch: storyBranch, status: "failed", reason: `conflicts: ${status.conflicted.join(", ")}` });
            continue;
          }

          // Merge failed for unknown reason - try fast-forward directly
          this.log(`[GitOps] Standard merge failed (${msg.slice(0, 100)}), trying fast-forward...`);
          try {
            // If story branch is ahead of current HEAD, just reset to it
            const isAncestor = await this.git.raw(["merge-base", "--is-ancestor", "HEAD", storyCommit])
              .then(() => true)
              .catch(() => false);

            if (isAncestor) {
              // Current HEAD is ancestor of story commit - safe to fast-forward
              await this.git.reset(["--hard", storyCommit]);
              this.log(`[GitOps] ✓ Fast-forwarded to ${storyBranch} via reset`);
              mergeResults.push({ branch: storyBranch, status: "merged", reason: "fast-forward" });
              continue;
            }
          } catch {
            // Fast-forward attempt failed
          }

          this.log(`[GitOps] ✗ FAILED to merge ${storyBranch}: ${msg.slice(0, 200)}`);
          mergeResults.push({ branch: storyBranch, status: "failed", reason: msg.slice(0, 100) });
        }
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
        description += `- **${story.title}**\n`;
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
    },
    worktreePath?: string
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

      // Determine the working directory for PR creation
      // If a worktree path is provided, use it directly (branch already checked out there)
      // This avoids removing the worktree (which kills self-review subprocesses)
      // and avoids checkout races on the shared main repo with parallel stories
      const prCwd = worktreePath || this.repoPath;

      if (worktreePath) {
        console.log(`[GitOps] Using existing worktree for PR creation: ${worktreePath}`);
      } else {
        // Fallback: no worktree available, checkout in main repo (legacy behavior)
        // CRITICAL: First remove any worktree that has this branch checked out
        // This prevents "branch already checked out" errors
        try {
          const worktreeList = execSync("git worktree list --porcelain", {
            cwd: this.repoPath,
            encoding: "utf-8",
            timeout: 120_000,
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
                await this.forceRemoveWorktree(currentWorktreePath);
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
      }

      // Create the PR using the execution script
      const env = {
        ...process.env,
        TICKET_KEY: jiraKey,
        TICKET_SUMMARY: epicTitle,
        REPO_PATH: prCwd,
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
        { env, cwd: prCwd }
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
   * Checks for existing ai/{jiraKey} or feature/{jiraKey} branch.
   * Returns prior work context if found.
   */
  async detectAndCheckoutExistingBranch(jiraKey: string): Promise<PriorWorkContext | null> {
    // Try ai/ branch first (used by multi-provider), then feature/ branch
    const branchCandidates = [
      `ai/${jiraKey.toLowerCase()}`,
      `feature/${jiraKey.toLowerCase()}`,
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

  /**
   * Merge a PR via SCM API (squash merge, delete source branch).
   * Used by PRD auto-run to merge approved PRs so dependent stories
   * don't stack up with merge conflicts.
   */
  async mergePR(prUrl: string, prNumber: number): Promise<boolean> {
    const scmProvider = this.config.scmProvider || "github";
    const token = this.config.githubToken;
    const targetRepo = this.config.targetRepo;

    try {
      switch (scmProvider) {
        case "github": {
          // GitHub: PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge
          const [owner, repo] = targetRepo.split("/");
          if (!owner || !repo) {
            console.error(`[GitOps] Invalid targetRepo for GitHub merge: ${targetRepo}`);
            return false;
          }
          return await this.mergeGitHubPR(owner, repo, prNumber, token);
        }
        case "bitbucket": {
          // Bitbucket: POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{id}/merge
          const [workspace, repoSlug] = targetRepo.split("/");
          if (!workspace || !repoSlug) {
            console.error(`[GitOps] Invalid targetRepo for Bitbucket merge: ${targetRepo}`);
            return false;
          }
          return await this.mergeBitbucketPR(workspace, repoSlug, prNumber, token);
        }
        case "gitlab": {
          // GitLab: PUT /api/v4/projects/{id}/merge_requests/{iid}/merge
          const encodedProject = encodeURIComponent(targetRepo);
          const baseUrl = this.config.scmBaseUrl || "https://gitlab.com";
          return await this.mergeGitLabMR(baseUrl, encodedProject, prNumber, token);
        }
        default:
          console.error(`[GitOps] Unsupported SCM provider for merge: ${scmProvider}`);
          return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[GitOps] PR merge failed: ${msg}`);
      return false;
    }
  }

  private mergeGitHubPR(owner: string, repo: string, prNumber: number, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        merge_method: "squash",
      });
      const options: https.RequestOptions = {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/pulls/${prNumber}/merge`,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "WorkerMill-Epic-Agent",
          Accept: "application/vnd.github+json",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log(`[GitOps] GitHub PR #${prNumber} merged successfully`);
            resolve(true);
          } else {
            console.error(`[GitOps] GitHub merge failed (${res.statusCode}): ${data.substring(0, 200)}`);
            resolve(false);
          }
        });
      });

      req.on("error", (e) => {
        console.error(`[GitOps] GitHub merge request error: ${e.message}`);
        resolve(false);
      });
      req.write(body);
      req.end();
    });
  }

  private mergeBitbucketPR(workspace: string, repoSlug: string, prNumber: number, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        merge_strategy: "squash",
        close_source_branch: true,
      });
      const authHeader = getBitbucketAuthHeader(token);
      const options: https.RequestOptions = {
        hostname: "api.bitbucket.org",
        path: `/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prNumber}/merge`,
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
          if (res.statusCode === 200) {
            console.log(`[GitOps] Bitbucket PR #${prNumber} merged successfully`);
            resolve(true);
          } else {
            console.error(`[GitOps] Bitbucket merge failed (${res.statusCode}): ${data.substring(0, 200)}`);
            resolve(false);
          }
        });
      });

      req.on("error", (e) => {
        console.error(`[GitOps] Bitbucket merge request error: ${e.message}`);
        resolve(false);
      });
      req.write(body);
      req.end();
    });
  }

  private mergeGitLabMR(baseUrl: string, encodedProject: string, mrIid: number, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        squash: true,
        should_remove_source_branch: true,
      });
      const url = new URL(`${baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${mrIid}/merge`);
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": token,
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log(`[GitOps] GitLab MR !${mrIid} merged successfully`);
            resolve(true);
          } else {
            console.error(`[GitOps] GitLab merge failed (${res.statusCode}): ${data.substring(0, 200)}`);
            resolve(false);
          }
        });
      });

      req.on("error", (e) => {
        console.error(`[GitOps] GitLab merge request error: ${e.message}`);
        resolve(false);
      });
      req.write(body);
      req.end();
    });
  }
}
