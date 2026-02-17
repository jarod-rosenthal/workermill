/**
 * Remote Agent Configuration
 *
 * Supports two modes:
 *   1. File-based config (~/.workermill/config.json) — for npm-installed CLI
 *   2. Environment variable config (.env.remote) — for bin/remote-agent backward compat
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { execSync } from "child_process";
import { hostname, homedir } from "os";
import { join } from "path";

export interface AgentConfig {
  apiUrl: string;
  apiKey: string;
  agentId: string;
  maxWorkers: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  githubToken: string;
  bitbucketToken: string;
  gitlabToken: string;
  githubReviewerToken: string;
}

export interface FileConfig {
  apiUrl: string;
  apiKey: string;
  agentId: string;
  maxWorkers: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  tokens: {
    github: string;
    bitbucket: string;
    gitlab: string;
    githubReviewer?: string;
  };
  setupCompletedAt: string;
}

const CONFIG_DIR = join(homedir(), ".workermill");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const PID_FILE = join(CONFIG_DIR, "agent.pid");
const LOG_FILE = join(CONFIG_DIR, "agent.log");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigFile(): string {
  return CONFIG_FILE;
}

export function getPidFile(): string {
  return PID_FILE;
}

export function getLogFile(): string {
  return LOG_FILE;
}

/**
 * Load config from ~/.workermill/config.json (CLI mode).
 */
export function loadConfigFromFile(): AgentConfig {
  if (!existsSync(CONFIG_FILE)) {
    console.error("No config found. Run 'workermill-agent setup' first.");
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_FILE, "utf-8");
  } catch {
    console.error("Failed to read config file:", CONFIG_FILE);
    process.exit(1);
  }

  let fc: FileConfig;
  try {
    fc = JSON.parse(raw);
  } catch {
    console.error("Config file is corrupted. Re-run 'workermill-agent setup'.");
    process.exit(1);
  }

  if (!fc.apiUrl || !fc.apiKey) {
    console.error("Config file is missing required fields (apiUrl, apiKey). Re-run 'workermill-agent setup'.");
    process.exit(1);
  }

  return {
    apiUrl: fc.apiUrl,
    apiKey: fc.apiKey,
    agentId: fc.agentId,
    maxWorkers: fc.maxWorkers || 4,
    pollIntervalMs: fc.pollIntervalMs || 5000,
    heartbeatIntervalMs: fc.heartbeatIntervalMs || 30000,
    githubToken: fc.tokens?.github || "",
    bitbucketToken: fc.tokens?.bitbucket || "",
    gitlabToken: fc.tokens?.gitlab || "",
    githubReviewerToken: fc.tokens?.githubReviewer || "",
  };
}

/**
 * Save config to ~/.workermill/config.json with restricted permissions.
 */
export function saveConfigToFile(fc: FileConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(fc, null, 2), "utf-8");

  // Restrict permissions (owner-only read/write)
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // chmod may not work on Windows, that's OK
  }
}

/**
 * Load config from environment variables (backward compat with bin/remote-agent).
 */
export function loadConfig(): AgentConfig {
  const apiUrl = process.env.WORKERMILL_API_URL;
  const apiKey = process.env.WORKERMILL_API_KEY;

  if (!apiUrl) {
    console.error("WORKERMILL_API_URL is required in .env.remote");
    process.exit(1);
  }

  if (!apiKey) {
    console.error("WORKERMILL_API_KEY is required in .env.remote");
    console.error("Get your API key from Settings > Integrations on the WorkerMill dashboard.");
    process.exit(1);
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ""), // Strip trailing slash
    apiKey,
    agentId: process.env.AGENT_ID || `agent-${hostname()}`,
    maxWorkers: parseInt(process.env.MAX_WORKERS || "4", 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10),
    githubToken: process.env.GITHUB_TOKEN || "",
    bitbucketToken: process.env.BITBUCKET_TOKEN || "",
    gitlabToken: process.env.GITLAB_TOKEN || "",
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN || "",
  };
}

/**
 * Find claude binary. Checks PATH, then known install locations.
 */
export function findClaudePath(): string | null {
  const isWin = process.platform === "win32";
  const which = isWin ? "where" : "which";

  // Check PATH first
  try {
    execSync(`${which} claude`, { stdio: "ignore", timeout: 10000 });
    return "claude";
  } catch { /* not in PATH */ }

  const candidates: string[] = [];

  if (isWin) {
    candidates.push(
      join(process.env.ProgramFiles || "C:\\Program Files", "ClaudeCode", "claude.exe"),
      join(process.env.LOCALAPPDATA || "", "Programs", "ClaudeCode", "claude.exe"),
      join(homedir(), "AppData", "Local", "Programs", "ClaudeCode", "claude.exe"),
      join(homedir(), ".local", "bin", "claude.exe"),
    );
  } else {
    candidates.push(
      join(homedir(), ".local", "bin", "claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    );
  }

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  return null;
}

export interface PrerequisiteResult {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * Check all prerequisites and return results (non-exiting version for setup wizard).
 */
export function checkPrerequisites(): PrerequisiteResult[] {
  const results: PrerequisiteResult[] = [];
  const isWin = process.platform === "win32";
  const which = isWin ? "where" : "which";

  // Git
  try {
    execSync(`${which} git`, { stdio: "ignore", timeout: 10000 });
    const version = execSync("git --version", { encoding: "utf-8", timeout: 10000 }).trim();
    results.push({ name: "Git", ok: true, detail: version });
  } catch {
    results.push({ name: "Git", ok: false, detail: "Not installed" });
  }

  // Claude CLI (search known install locations, not just PATH)
  const claudePath = findClaudePath();
  if (claudePath) {
    try {
      const version = execSync(`"${claudePath}" --version`, { encoding: "utf-8", timeout: 10000 }).trim();
      results.push({ name: "Claude CLI", ok: true, detail: version });
    } catch {
      results.push({ name: "Claude CLI", ok: true, detail: claudePath });
    }
  } else {
    results.push({ name: "Claude CLI", ok: false, detail: "Not installed" });
  }

  // Claude credentials
  const home = homedir();
  const credsPath = join(home, ".claude", ".credentials.json");
  if (existsSync(credsPath)) {
    results.push({ name: "Claude auth", ok: true, detail: "Credentials found" });
  } else {
    results.push({ name: "Claude auth", ok: false, detail: "Run 'claude' and complete sign-in" });
  }

  return results;
}

/**
 * Validate prerequisites (exits on failure — backward compat).
 */
export function validatePrerequisites(): void {
  // Check Git
  const isWin = process.platform === "win32";
  const which = isWin ? "where" : "which";
  try {
    execSync(`${which} git`, { stdio: "ignore", timeout: 10000 });
  } catch {
    console.error("Git is not installed. Install Git and ensure it's in PATH.");
    process.exit(1);
  }

  // Check Claude CLI
  if (!findClaudePath()) {
    console.error("Claude CLI is not installed.");
    console.error("Install it: curl -fsSL https://claude.ai/install.sh | bash");
    process.exit(1);
  }

  // Check Claude credentials
  const home = homedir();
  const credsPath = join(home, ".claude", ".credentials.json");
  if (!existsSync(credsPath)) {
    console.error("Claude credentials not found.");
    console.error("Run 'claude' and complete the sign-in flow to authenticate.");
    process.exit(1);
  }
}

/**
 * Get system info for agent registration.
 */
export function getSystemInfo(): {
  hostname: string;
  platform: string;
  nodeVersion: string;
  claudeVersion: string;
} {
  let claudeVersion = "unknown";
  const claudeBin = findClaudePath();
  if (claudeBin) {
    try {
      claudeVersion = execSync(`"${claudeBin}" --version`, {
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
    } catch {
      /* ignore */
    }
  }

  return {
    hostname: hostname(),
    platform: process.platform,
    nodeVersion: process.version,
    claudeVersion,
  };
}
