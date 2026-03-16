/**
 * workermill-agent init --self-hosted
 *
 * Setup for self-hosted mode (Docker Compose stack).
 * Checks Docker is running, detects credentials, writes config.
 */

import chalk from "chalk";
import inquirer from "inquirer";
import { execFileSync } from "child_process";
import {
  loadStandaloneConfig,
  saveStandaloneConfig,
  detectExistingKey,
  type StandaloneConfig,
} from "../backends/local/config.js";
import { findDockerBin, checkDockerAvailable } from "../config.js";

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

  // Auto-detect GitHub token
  const ghToken = existing.scm?.token || detectGitHubToken();
  if (ghToken) {
    const masked = ghToken.slice(0, 8) + "..." + ghToken.slice(-4);
    console.log(`  ${chalk.green("✓")} GitHub token: ${masked}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No GitHub token found`);
    needsPrompt = true;
  }

  // Auto-detect repo
  const defaultRepo = existing.defaultRepo || detectRepoFromCwd() || "";
  if (defaultRepo) {
    console.log(`  ${chalk.green("✓")} Target repo: ${defaultRepo}`);
  }

  console.log();

  // Prompt for missing credentials
  let finalAiKey = aiKey || "";
  let finalGhToken = ghToken || "";

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

  if (!ghToken) {
    console.log(chalk.dim("  Tip: Run 'gh auth login' first for automatic detection."));
    const { token } = await inquirer.prompt([{
      type: "password",
      name: "token",
      message: "GitHub token (for pushing branches/PRs):",
      mask: "*",
      validate: (v: string) => v.length > 0 || "Token is required to push code",
    }]);
    finalGhToken = token;
  }

  // Save config
  const config: StandaloneConfig = {
    mode: "self-hosted",
    roles: {
      planner: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
      worker: { provider: "anthropic", model: "claude-sonnet-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
      techLead: { provider: "anthropic", model: "claude-opus-4-6", ...(finalAiKey && !aiKey ? { apiKey: finalAiKey } : {}) },
    },
    scm: {
      provider: "github",
      token: finalGhToken,
    },
    defaultRepo: defaultRepo || undefined,
    sandbox: "docker",
    settings: existing.settings || { maxStories: 8 },
  };

  saveStandaloneConfig(config);

  console.log();
  console.log(`  ${chalk.green("✓")} Configuration saved to ~/.workermill/config.json`);
  console.log();
  if (!needsPrompt) {
    console.log(chalk.green("  All credentials auto-detected — zero prompts needed!"));
    console.log();
  }
  console.log(`  Run ${chalk.cyan("workermill-agent start")} to launch.`);
  console.log(`  Dashboard will be at ${chalk.cyan("http://localhost:5173")}`);
  console.log();
  process.exit(0);
}
