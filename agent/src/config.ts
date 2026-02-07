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
  workerImage: string;
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
  };
  workerImage: string;
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

  // Migrate any stale image URLs to current default
  const defaultImage = "public.ecr.aws/a7k5r0v0/workermill-worker:latest";
  let workerImage = fc.workerImage || defaultImage;
  if (workerImage.includes("jarod1/") || !workerImage.includes("workermill-worker")) {
    workerImage = defaultImage;
    fc.workerImage = workerImage;
    try { writeFileSync(CONFIG_FILE, JSON.stringify(fc, null, 2), "utf-8"); } catch { /* best effort */ }
  }

  return {
    apiUrl: fc.apiUrl,
    apiKey: fc.apiKey,
    agentId: fc.agentId,
    maxWorkers: 1, // Hardcapped — concurrent containers share Claude creds and crash
    pollIntervalMs: fc.pollIntervalMs || 5000,
    heartbeatIntervalMs: fc.heartbeatIntervalMs || 30000,
    githubToken: fc.tokens?.github || "",
    bitbucketToken: fc.tokens?.bitbucket || "",
    gitlabToken: fc.tokens?.gitlab || "",
    workerImage,
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
    maxWorkers: 1, // Hardcapped — concurrent containers share Claude creds and crash
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10),
    githubToken: process.env.GITHUB_TOKEN || "",
    bitbucketToken: process.env.BITBUCKET_TOKEN || "",
    gitlabToken: process.env.GITLAB_TOKEN || "",
    workerImage: process.env.WORKER_IMAGE || "workermill-worker:local",
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
export function checkPrerequisites(workerImage?: string): PrerequisiteResult[] {
  const results: PrerequisiteResult[] = [];
  const image = workerImage || "public.ecr.aws/a7k5r0v0/workermill-worker:latest";

  // Docker
  try {
    const version = execSync("docker version --format {{.Server.Version}}", {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
    results.push({ name: "Docker", ok: true, detail: version });
  } catch {
    results.push({ name: "Docker", ok: false, detail: "Not running or not installed" });
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

  // Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  if (major >= 20) {
    results.push({ name: "Node.js", ok: true, detail: nodeVersion });
  } else {
    results.push({ name: "Node.js", ok: false, detail: `${nodeVersion} (need >= 20)` });
  }

  // Worker image
  try {
    execSync(`docker image inspect ${image}`, { stdio: "ignore", timeout: 10000 });
    results.push({ name: "Worker image", ok: true, detail: image });
  } catch {
    results.push({ name: "Worker image", ok: false, detail: `'${image}' not found` });
  }

  return results;
}

/**
 * Validate prerequisites (exits on failure — backward compat).
 */
export function validatePrerequisites(): void {
  // Check Docker
  try {
    execSync("docker version", { stdio: "ignore" });
  } catch {
    console.error("Docker is not available. Please install Docker and ensure it's running.");
    process.exit(1);
  }

  // Check worker image (use env-configured image or default)
  const image = process.env.WORKER_IMAGE || "workermill-worker:local";
  try {
    execSync(`docker image inspect ${image}`, { stdio: "ignore" });
  } catch {
    console.error(`Worker image '${image}' not found.`);
    if (image === "workermill-worker:local") {
      console.error("Build it with: ./bin/local-workermill build-worker");
    } else {
      console.error(`Pull it with: docker pull ${image}`);
    }
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
  dockerVersion: string;
  claudeVersion: string;
} {
  let dockerVersion = "unknown";
  try {
    dockerVersion = execSync("docker version --format {{.Server.Version}}", {
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch {
    /* ignore */
  }

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
    dockerVersion,
    claudeVersion,
  };
}
