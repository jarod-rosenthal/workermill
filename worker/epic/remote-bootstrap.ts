/**
 * Remote Bootstrap for Epic Workers
 *
 * TypeScript port of epic-entrypoint.sh. Handles:
 * 1. Environment variable validation
 * 2. Git configuration & credential setup
 * 3. Repository cloning
 * 4. Main branch detection
 * 5. Heartbeat loop
 * 6. Dependency pre-install
 * 7. Epic coordinator startup
 *
 * This is the entry point for remote agent workers (npm package path).
 * It replaces the shell entrypoint for Docker-free execution.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import axios from "axios";
import { EpicCoordinator } from "./coordinator.js";
import { DecisionClient } from "./decision-client.js";
import type { EpicConfig, ResilienceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Environment Validation
// ---------------------------------------------------------------------------

function validateEnv(): void {
  const required = ["PARENT_TASK_ID", "API_BASE_URL", "ORG_API_KEY"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  // Auth check: need ANTHROPIC_API_KEY or OAuth credentials
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const credPath = join(
      process.env.HOME || process.env.USERPROFILE || "~",
      ".claude",
      ".credentials.json",
    );
    if (!existsSync(credPath)) {
      missing.push("ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN or ~/.claude/.credentials.json");
    }
  }

  // SCM token check
  if (!process.env.GITHUB_TOKEN && !process.env.SCM_TOKEN) {
    missing.push("GITHUB_TOKEN or SCM_TOKEN");
  }

  // TARGET_REPO check
  if (!process.env.TARGET_REPO && !process.env.GITHUB_REPO) {
    missing.push("TARGET_REPO or GITHUB_REPO");
  }

  if (missing.length > 0) {
    console.error("[Bootstrap] Missing required environment variables:");
    for (const v of missing) console.error(`  - ${v}`);
    process.exit(1);
  }

  // Normalize: set TARGET_REPO from GITHUB_REPO if needed
  if (!process.env.TARGET_REPO && process.env.GITHUB_REPO) {
    process.env.TARGET_REPO = process.env.GITHUB_REPO;
  }

  // Normalize: set GITHUB_TOKEN from SCM_TOKEN for backwards compat
  if (!process.env.GITHUB_TOKEN && process.env.SCM_TOKEN) {
    process.env.GITHUB_TOKEN = process.env.SCM_TOKEN;
  }
}

// ---------------------------------------------------------------------------
// Git Configuration
// ---------------------------------------------------------------------------

async function resolveAuthorEmail(): Promise<string> {
  if (process.env.AUTHOR_EMAIL) return process.env.AUTHOR_EMAIL;

  const scmProvider = process.env.SCM_PROVIDER || "github";
  const token = process.env.SCM_TOKEN || process.env.GITHUB_TOKEN;

  if (scmProvider === "github" && token) {
    try {
      const res = await axios.get("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      });
      const id = res.data?.id;
      const login = res.data?.login;
      if (id && login) {
        const email = `${id}+${login}@users.noreply.github.com`;
        console.log(`[Bootstrap] Resolved git author email: ${email}`);
        return email;
      }
    } catch {
      // Fall through to default
    }
  }

  return "epic@workermill.com";
}

function configureGit(authorEmail: string): void {
  const cmds = [
    `git config --global user.name "WorkerMill Epic Agent"`,
    `git config --global user.email "${authorEmail}"`,
    `git config --global credential.helper store`,
    `git config --global core.autocrlf false`,
    `git config --global core.safecrlf false`,
    `git config --global core.eol lf`,
  ];
  for (const cmd of cmds) {
    execSync(cmd, { stdio: "pipe" });
  }
}

function setupCredentials(): string {
  const scmProvider = process.env.SCM_PROVIDER || "github";
  const scmBaseUrl = process.env.SCM_BASE_URL || "";
  const targetRepo = process.env.TARGET_REPO!;
  const token = process.env.SCM_TOKEN || process.env.GITHUB_TOKEN || "";

  let repoUrl: string;
  let credLine: string;
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const gitCredPath = join(home, ".git-credentials");

  switch (scmProvider) {
    case "github": {
      const base = scmBaseUrl || "github.com";
      repoUrl = `https://x-access-token:${token}@${base}/${targetRepo}.git`;
      credLine = `https://x-access-token:${token}@${base}`;

      // Configure gh CLI auth (best effort)
      try {
        const proc = spawnSync("gh", ["auth", "login", "--with-token"], {
          input: token,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10_000,
        });
        if (proc.status !== 0) {
          console.log("[Bootstrap] gh auth login skipped (gh CLI not available)");
        }
      } catch {
        // gh CLI not installed — not required
      }
      break;
    }
    case "gitlab": {
      const base = scmBaseUrl || "gitlab.com";
      repoUrl = `https://oauth2:${token}@${base}/${targetRepo}.git`;
      credLine = `https://oauth2:${token}@${base}`;
      break;
    }
    case "bitbucket": {
      const base = scmBaseUrl || "bitbucket.org";
      const encodedToken = encodeURIComponent(token);
      repoUrl = `https://x-token-auth:${encodedToken}@${base}/${targetRepo}.git`;
      credLine = `https://x-token-auth:${encodedToken}@${base}`;
      break;
    }
    default:
      console.error(`[Bootstrap] Unknown SCM provider: ${scmProvider}`);
      process.exit(1);
  }

  writeFileSync(gitCredPath, credLine + "\n", { mode: 0o600 });

  // Log masked URL
  const masked = repoUrl
    .replace(/:x-access-token:[^@]*@/, ":x-access-token:***@")
    .replace(/:oauth2:[^@]*@/, ":oauth2:***@")
    .replace(/:x-token-auth:[^@]*@/, ":x-token-auth:***@");
  console.log(`[Bootstrap] SCM Provider: ${scmProvider}`);
  console.log(`[Bootstrap] Clone URL: ${masked}`);

  return repoUrl;
}

// ---------------------------------------------------------------------------
// Repository Clone & Branch Detection
// ---------------------------------------------------------------------------

function cloneRepo(repoUrl: string, workDir: string): string {
  const repoDir = join(workDir, "repo");
  mkdirSync(workDir, { recursive: true });

  console.log(`[Bootstrap] Cloning repository...`);
  try {
    execSync(`git clone "${repoUrl}" repo`, {
      cwd: workDir,
      stdio: "pipe",
      timeout: 300_000, // 5 minutes
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Bootstrap] Failed to clone repository: ${msg}`);
    console.error(`[Bootstrap] Check that your SCM token has read access to ${process.env.TARGET_REPO}`);
    process.exit(1);
  }

  console.log(`[Bootstrap] Repository cloned to ${repoDir}`);
  return repoDir;
}

function detectMainBranch(repoDir: string): string {
  try {
    execSync("git rev-parse --verify origin/main", { cwd: repoDir, stdio: "pipe" });
    return "main";
  } catch { /* not main */ }

  try {
    execSync("git rev-parse --verify origin/master", { cwd: repoDir, stdio: "pipe" });
    return "master";
  } catch { /* not master */ }

  try {
    const head = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: repoDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    return head.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): NodeJS.Timeout {
  const apiBaseUrl = process.env.API_BASE_URL!;
  const orgApiKey = process.env.ORG_API_KEY!;
  const taskId = process.env.PARENT_TASK_ID!;

  const sendHeartbeat = () => {
    axios
      .post(
        `${apiBaseUrl}/api/coordination/heartbeat`,
        {
          taskId,
          workerId: process.env.ECS_TASK_ID || "remote-worker",
          status: "working",
          persona: "epic_coordinator",
        },
        {
          headers: { "x-api-key": orgApiKey, "Content-Type": "application/json" },
          timeout: 10_000,
        },
      )
      .catch(() => {
        // Heartbeat failures are non-fatal
      });
  };

  // Send first heartbeat immediately, then every 30s
  sendHeartbeat();
  return setInterval(sendHeartbeat, 30_000);
}

// ---------------------------------------------------------------------------
// Dependency Pre-install
// ---------------------------------------------------------------------------

function preInstallDeps(repoDir: string): void {
  console.log("[Bootstrap] Pre-installing dependencies...");

  const installAt = (dir: string, label: string) => {
    try {
      if (existsSync(join(dir, "pnpm-lock.yaml"))) {
        console.log(`[Bootstrap]   ${label}: pnpm install --frozen-lockfile`);
        spawnSync("corepack", ["enable"], { cwd: dir, stdio: "pipe" });
        spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "pipe", timeout: 300_000 });
      } else if (existsSync(join(dir, "yarn.lock"))) {
        console.log(`[Bootstrap]   ${label}: yarn install --frozen-lockfile`);
        spawnSync("corepack", ["enable"], { cwd: dir, stdio: "pipe" });
        spawnSync("yarn", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "pipe", timeout: 300_000 });
      } else if (existsSync(join(dir, "package-lock.json"))) {
        console.log(`[Bootstrap]   ${label}: npm ci`);
        spawnSync("npm", ["ci"], { cwd: dir, stdio: "pipe", timeout: 300_000 });
      }
    } catch {
      console.log(`[Bootstrap]   ${label}: install failed (non-fatal)`);
    }
  };

  // Root
  if (existsSync(join(repoDir, "package.json"))) {
    installAt(repoDir, "root");
  }

  // Monorepo subprojects (one level deep)
  try {
    for (const entry of readdirSync(repoDir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const sub = join(repoDir, entry);
      if (!statSync(sub).isDirectory()) continue;
      const hasLock =
        existsSync(join(sub, "package-lock.json")) ||
        existsSync(join(sub, "yarn.lock")) ||
        existsSync(join(sub, "pnpm-lock.yaml"));
      if (hasLock) installAt(sub, entry);
    }
  } catch {
    // Non-fatal
  }

  console.log("[Bootstrap] Dependency pre-install complete");
}

// ---------------------------------------------------------------------------
// Config Loaders (mirrored from index.ts — kept in sync)
// ---------------------------------------------------------------------------

function loadConfig(repoDir: string, mainBranch: string): EpicConfig {
  const isLocalMode = process.env.EXECUTION_MODE === "local";

  return {
    parentTaskId: process.env.PARENT_TASK_ID!,
    apiBaseUrl: process.env.API_BASE_URL!,
    orgApiKey: process.env.ORG_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    githubToken: process.env.SCM_TOKEN || process.env.GITHUB_TOKEN!,
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN || undefined,
    targetRepo: process.env.TARGET_REPO!,
    model: process.env.WORKER_MODEL || process.env.MODEL,
    jiraIssueKey: process.env.JIRA_ISSUE_KEY || process.env.TICKET_KEY || "",
    ticketSystem:
      (process.env.TICKET_SYSTEM as "jira" | "linear" | "github" | "internal") || "jira",
    reviewEnabled: process.env.REVIEW_ENABLED === "true",
    deploymentEnabled: process.env.DEPLOYMENT_ENABLED === "true",
    prdChildTask: process.env.PRD_CHILD_TASK === "true",
    improvementEnabled: process.env.IMPROVEMENT_ENABLED === "true",
    reviewFeedback: process.env.REVIEW_FEEDBACK || undefined,
    qualityGateBypass: process.env.QUALITY_GATE_BYPASS === "true",
    maxParallelExperts: parseInt(process.env.MAX_PARALLEL_EXPERTS || "4", 10),
    qualityThresholds: process.env.QUALITY_THRESHOLDS
      ? JSON.parse(process.env.QUALITY_THRESHOLDS)
      : undefined,
  };
}

function loadResilienceConfig(): ResilienceConfig {
  return {
    blockerMaxAutoRetries: parseInt(process.env.BLOCKER_MAX_AUTO_RETRIES || "3", 10),
    blockerAutoRetryEnabled: process.env.BLOCKER_AUTO_RETRY_ENABLED !== "false",
    pushAfterCommit: process.env.PUSH_AFTER_COMMIT !== "false",
    gracefulShutdownEnabled: process.env.GRACEFUL_SHUTDOWN_ENABLED !== "false",
    selfReviewEnabled: process.env.SELF_REVIEW_ENABLED === "true",
    fileOverlapGatingEnabled: process.env.FILE_OVERLAP_GATING_ENABLED !== "false",
    incrementalRebaseEnabled: process.env.INCREMENTAL_REBASE_ENABLED !== "false",
    mergeAgentEnabled: process.env.MERGE_AGENT_ENABLED !== "false",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("REMOTE BOOTSTRAP - WorkerMill Epic Agent");
  console.log("=".repeat(60));
  console.log();
  console.log(`Parent Task ID: ${process.env.PARENT_TASK_ID || "not set"}`);
  console.log(`Target Repo: ${process.env.TARGET_REPO || process.env.GITHUB_REPO || "not set"}`);
  console.log(`API Base URL: ${process.env.API_BASE_URL || "not set"}`);
  console.log();

  // 1. Validate environment
  validateEnv();

  // 2. Configure git
  const authorEmail = await resolveAuthorEmail();
  configureGit(authorEmail);
  process.env.AUTHOR_EMAIL = authorEmail;

  // 3. Setup SCM credentials and get clone URL
  const repoUrl = setupCredentials();

  // 4. Create isolated temp working directory
  const taskId = process.env.PARENT_TASK_ID!;
  const workDir = join(tmpdir(), `workermill-${taskId}`);

  // Clean up any leftover from a previous attempt
  if (existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true });
  }

  // 5. Clone repository
  const repoDir = cloneRepo(repoUrl, workDir);
  const mainBranch = detectMainBranch(repoDir);
  console.log(`[Bootstrap] Main branch: ${mainBranch}`);

  // Export for coordinator/git-ops
  process.env.REPO_PATH = repoDir;
  process.env.MAIN_BRANCH = mainBranch;

  // 6. Start heartbeat
  const heartbeatTimer = startHeartbeat();

  // 7. Pre-install dependencies
  preInstallDeps(repoDir);

  // 8. Start Epic coordinator
  let exitCode = 0;
  try {
    const config = loadConfig(repoDir, mainBranch);
    const resilience = loadResilienceConfig();

    const decisionClient = new DecisionClient({
      apiBaseUrl: config.apiBaseUrl,
      orgApiKey: config.orgApiKey,
      logger: (msg) => console.log(msg),
    });

    const coordinator = new EpicCoordinator(config, resilience, decisionClient);

    // Graceful shutdown handler
    let shutdownInProgress = false;
    const shutdown = async () => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;
      console.log("\n[Bootstrap] Received shutdown signal");
      await coordinator.gracefulShutdown();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await coordinator.start();
    console.log("[Bootstrap] Epic session ended");
  } catch (error) {
    console.error("[Bootstrap] Fatal error:", error);
    exitCode = 1;
  } finally {
    // 9. Cleanup
    clearInterval(heartbeatTimer);

    // Remove temp working directory after a delay (let git processes finish)
    setTimeout(() => {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }, 5_000);
  }

  process.exit(exitCode);
}

main();
