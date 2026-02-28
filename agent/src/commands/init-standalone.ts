/**
 * workermill-agent init --standalone
 *
 * Zero-friction setup for standalone mode.
 * Auto-detects Claude OAuth + GitHub credentials.
 * Only prompts when something is genuinely missing.
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

/** Try to detect the git remote URL from the current directory. */
function detectRepoFromCwd(): string | null {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (url) return url;
  } catch { /* not a git repo or no origin */ }
  return null;
}

/** Try to get a GitHub token from `gh auth token`, then env vars. */
function detectGitHubToken(): string | null {
  // 1. gh CLI (most reliable)
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (token) return token;
  } catch { /* gh not installed or not authed */ }

  // 2. GH_TOKEN / GITHUB_TOKEN env vars
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  return null;
}

export async function initStandaloneCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  WorkerMill Standalone Setup"));
  console.log(chalk.dim("  ─────────────────────────────────────"));
  console.log();

  const existing = loadStandaloneConfig();
  let needsPrompt = false;

  // ── AI provider: auto-detect Claude OAuth or ANTHROPIC_API_KEY ──
  const aiKey = detectExistingKey("anthropic");
  if (aiKey) {
    const masked = aiKey.slice(0, 12) + "..." + aiKey.slice(-4);
    console.log(`  ${chalk.green("✓")} AI provider: Anthropic (${masked})`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No Claude OAuth or ANTHROPIC_API_KEY found`);
    needsPrompt = true;
  }

  // ── GitHub: auto-detect from gh CLI or env ──
  const ghToken = existing.scm?.token || detectGitHubToken();
  if (ghToken) {
    const masked = ghToken.slice(0, 8) + "..." + ghToken.slice(-4);
    console.log(`  ${chalk.green("✓")} GitHub token: ${masked}`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} No GitHub token found`);
    needsPrompt = true;
  }

  // ── Default repo: auto-detect from cwd, not required ──
  const defaultRepo = existing.defaultRepo || detectRepoFromCwd() || "";
  if (defaultRepo) {
    console.log(`  ${chalk.green("✓")} Target repo: ${defaultRepo}`);
  }

  console.log();

  // ── Only prompt for what's missing ──
  let finalAiKey = aiKey || "";
  let finalGhToken = ghToken || "";

  if (!aiKey) {
    const { key } = await inquirer.prompt([{
      type: "password",
      name: "key",
      message: "Anthropic API key (or run 'claude' to set up OAuth first):",
      mask: "*",
      validate: (v: string) => v.length > 0 || "API key is required",
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

  // ── Save config with defaults ──
  const config: StandaloneConfig = {
    mode: "standalone",
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
  console.log();
  process.exit(0);
}
