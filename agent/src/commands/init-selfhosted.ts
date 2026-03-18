/**
 * workermill-agent init --self-hosted
 *
 * Setup for self-hosted mode (Docker Compose stack).
 * Checks Docker is running, detects credentials, writes config.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  loadStandaloneConfig,
  saveStandaloneConfig,
  detectExistingKey,
  type StandaloneConfig,
} from "../backends/local/config.js";
import { findDockerBin, checkDockerAvailable } from "../config.js";

/**
 * Embedded docker-compose.yml content.
 * Written to ~/.workermill/docker-compose.yml during init so the compiled
 * binary can find it without needing the repo on disk.
 */
const COMPOSE_FILE_CONTENT = `# WorkerMill Self-Hosted Stack
# Usage: docker compose up -d
# The agent binary manages this file — don't run manually.

services:
  postgres:
    image: pgvector/pgvector:pg15
    container_name: workermill-db
    environment:
      POSTGRES_USER: workermill
      POSTGRES_PASSWORD: localdev
      POSTGRES_DB: workermill
    ports:
      - "127.0.0.1:5434:5432"
    volumes:
      - workermill-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workermill"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: workermill-redis
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped

  api:
    image: ghcr.io/jarod-rosenthal/api:latest
    container_name: workermill-api
    ports:
      - "127.0.0.1:3001:3001"
    environment:
      # Must be 'development' — the API blocks EXECUTION_MODE=local in production mode (api/src/index.ts line 99)
      NODE_ENV: development
      PORT: "3001"
      EXECUTION_MODE: local
      DATABASE_URL: postgresql://workermill:localdev@postgres:5432/workermill
      REDIS_URL: redis://redis:6379
    volumes:
      # Mount host Claude credentials so the API can use Claude CLI for planning.
      # The agent writes the correct host path as CLAUDE_CONFIG_DIR in .env.
      - "\${CLAUDE_CONFIG_DIR:-./.claude}:/root/.claude:ro"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "const h=require('http');h.get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    restart: unless-stopped

  frontend:
    image: ghcr.io/jarod-rosenthal/frontend:latest
    container_name: workermill-frontend
    ports:
      - "127.0.0.1:5173:5173"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

volumes:
  workermill-data:
    name: workermill-data
`;

function detectGitHubToken(): string | null {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (token) return token;
  } catch { /* gh not installed or not authed */ }
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return null;
}

function detectRepoFromCwd(): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (url) return url;
  } catch { /* not a git repo */ }
  return null;
}

export async function initSelfHostedCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Self-Hosted Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  // Check Docker
  if (!checkDockerAvailable()) {
    console.log(`  ${chalk.red("✗")} Docker is not running`);
    console.log(`  Install Docker Desktop: ${chalk.cyan("https://www.docker.com/products/docker-desktop/")}`);
    process.exit(1);
  }
  console.log(`  ${chalk.green("✓")} Docker is running`);

  const existing = loadStandaloneConfig();
  let needsPrompt = false;

  // Auto-detect AI provider key
  const aiKey = detectExistingKey("anthropic");
  if (aiKey) {
    const masked = aiKey.slice(0, 12) + "..." + aiKey.slice(-4);
    console.log(`  ${chalk.green("✓")} AI provider: Anthropic (${masked})`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No Claude OAuth or ANTHROPIC_API_KEY found`);
    needsPrompt = true;
  }

  // Auto-detect SCM credentials from existing config or environment
  const existingScmProvider = existing.scm?.provider || "github";
  const autoGhToken = (existingScmProvider === "github" && existing.scm?.token) || detectGitHubToken();

  if (existing.scm?.token) {
    const masked = existing.scm.token.slice(0, 8) + "..." + existing.scm.token.slice(-4);
    console.log(`  ${chalk.green("✓")} ${existingScmProvider} credentials: ${masked}`);
  } else if (autoGhToken) {
    const masked = autoGhToken.slice(0, 8) + "..." + autoGhToken.slice(-4);
    console.log(`  ${chalk.green("✓")} GitHub token: ${masked}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No SCM credentials found`);
    needsPrompt = true;
  }

  // Auto-detect repo
  const defaultRepo = existing.defaultRepo || detectRepoFromCwd() || "";
  if (defaultRepo) {
    console.log(`  ${chalk.green("✓")} Target repo: ${defaultRepo}`);
  }

  console.log();

  // Prompt for missing AI key
  let finalAiKey = aiKey || "";

  if (!aiKey) {
    const { key } = await inquirer.prompt([{
      type: "password",
      name: "key",
      message: "Anthropic API key (or run 'claude' to set up OAuth first):",
      mask: "*",
      validate: (v: string) => v.length > 0 || "API key is required for AI workers",
    }]);
    finalAiKey = key;
  }

  // SCM provider selection and credentials
  let scmProvider = existingScmProvider;
  let scmToken = existing.scm?.token || autoGhToken || "";
  let scmUsername = (existing.scm as Record<string, string> | undefined)?.username || "";

  if (!scmToken) {
    const { provider } = await inquirer.prompt([{
      type: "list",
      name: "provider",
      message: "Source control provider:",
      choices: [
        { name: "GitHub", value: "github" },
        { name: "Bitbucket", value: "bitbucket" },
        // { name: "GitLab", value: "gitlab" }, // GitLab support not yet tested
      ],
      default: existingScmProvider,
    }]);
    scmProvider = provider;

    if (provider === "github") {
      console.log(chalk.dim("  Tip: Run 'gh auth login' first for automatic detection."));
      const { token } = await inquirer.prompt([{
        type: "password",
        name: "token",
        message: "GitHub token (for pushing branches/PRs):",
        mask: "*",
        validate: (v: string) => v.length > 0 || "Token is required to push code",
      }]);
      scmToken = token;
    } else if (provider === "bitbucket") {
      const { username } = await inquirer.prompt([{
        type: "input",
        name: "username",
        message: "Bitbucket username:",
        validate: (v: string) => v.length > 0 || "Username is required",
      }]);
      scmUsername = username;
      const { appPassword } = await inquirer.prompt([{
        type: "password",
        name: "appPassword",
        message: "Bitbucket app password (with repo + PR permissions):",
        mask: "*",
        validate: (v: string) => v.length > 0 || "App password is required to push code",
      }]);
      scmToken = appPassword;
    } else if (provider === "gitlab") {
      const { token } = await inquirer.prompt([{
        type: "password",
        name: "token",
        message: "GitLab personal access token (with api scope):",
        mask: "*",
        validate: (v: string) => v.length > 0 || "Token is required to push code",
      }]);
      scmToken = token;
    }
  }

  // Default repository
  let finalDefaultRepo = defaultRepo;
  if (!defaultRepo) {
    const repoExample = scmProvider === "bitbucket" ? "workspace/repo" : "owner/repo";
    const { repo } = await inquirer.prompt([{
      type: "input",
      name: "repo",
      message: `Default repository (e.g., ${repoExample}):`,
    }]);
    finalDefaultRepo = repo;
  }

  // Save config — preserve existing roles if present (re-run safety)
  const defaultRoles = {
    planner: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
    worker: { provider: "anthropic", model: "claude-sonnet-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
    techLead: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
  };
  const config: StandaloneConfig = {
    mode: "self-hosted",
    roles: existing.roles || defaultRoles,
    scm: {
      provider: scmProvider,
      token: scmToken,
      ...(scmUsername ? { username: scmUsername } : {}),
    },
    defaultRepo: finalDefaultRepo || undefined,
    sandbox: "docker",
    settings: existing.settings || {
      maxParallelExperts: 14,
      maxStories: 10,
      maxTargetFiles: 6,
      prdPlanningMode: "strict",
      planningMode: "simplified",
      criticApprovalThreshold: 90,
      maxPerStoryRevisions: 0,
      maxReviewRevisions: 4,
      maxFixRetries: 5,
      blockerWaitTimeoutMinutes: 20,
      pushAfterCommit: true,
      blockerAutoRetryEnabled: true,
      blockerMaxAutoRetries: 3,
      gracefulShutdownEnabled: true,
      selfReviewEnabled: false,
      qualityGateEnabled: true,
      blockOnTypeErrors: true,
      blockOnTestFailures: true,
      blockOnLintErrors: true,
      blockOnE2EFailures: true,
      autoFixEnabled: true,
      autoFixMaxIterations: 3,
    },
  };

  // Delete bootstrap-done flag so credentials are re-synced on next startup
  const bootstrapFlag = path.join(os.homedir(), ".workermill", ".bootstrap-done");
  if (fs.existsSync(bootstrapFlag)) {
    try { fs.unlinkSync(bootstrapFlag); } catch { /* best effort */ }
  }

  saveStandaloneConfig(config);

  // Write docker-compose.yml to ~/.workermill/ so the compiled binary can find it
  const wmDir = path.join(os.homedir(), ".workermill");
  if (!fs.existsSync(wmDir)) {
    fs.mkdirSync(wmDir, { recursive: true });
  }
  // Always write compose file — ensures volume mounts and image refs stay current
  const composePath = path.join(wmDir, "docker-compose.yml");
  fs.writeFileSync(composePath, COMPOSE_FILE_CONTENT, { encoding: "utf-8" });

  // Write .env for docker-compose with the host's Claude config path.
  // Docker Compose reads this automatically when running from ~/.workermill/.
  const claudeConfigDir = path.join(os.homedir(), ".claude");
  const envPath = path.join(wmDir, ".env");
  fs.writeFileSync(envPath, `CLAUDE_CONFIG_DIR=${claudeConfigDir}\n`, { encoding: "utf-8" });

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log(`  ${chalk.green("✓")} Docker Compose file written to ~/.workermill/docker-compose.yml`);
  console.log();
  if (!needsPrompt) {
    console.log(chalk.green("  All credentials auto-detected — zero prompts needed!"));
    console.log();
  }
  console.log(`  Dashboard will be at ${chalk.cyan("http://localhost:5173")}`);
  console.log();
  console.log(chalk.dim("  Starting agent..."));

  // Import and call startCommand with detach mode
  const { startCommand } = await import("./start.js");
  await startCommand({ detach: true });

  // Force exit — inquirer keeps stdin listeners open which prevents
  // Node from exiting naturally after the detached child is spawned.
  process.exit(0);
}
