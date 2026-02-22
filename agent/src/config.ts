/**
 * Remote Agent Configuration
 *
 * Supports two modes:
 *   1. File-based config (~/.workermill/config.json) — for npm-installed CLI
 *   2. Environment variable config (.env.remote) — for bin/remote-agent backward compat
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "fs";
import { execSync, execFileSync } from "child_process";
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
  sandbox: "none" | "docker";
  dockerImage: string;
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
  sandbox?: "docker";
  dockerImage?: string;
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
    sandbox: fc.sandbox || "none",
    dockerImage: fc.dockerImage || "ghcr.io/workermill/worker",
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

  const sandboxEnv = process.env.WORKERMILL_SANDBOX;
  return {
    apiUrl: apiUrl.replace(/\/$/, ""), // Strip trailing slash
    apiKey,
    agentId: process.env.AGENT_ID || hostname(),
    maxWorkers: parseInt(process.env.MAX_WORKERS || "4", 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "30000", 10),
    githubToken: process.env.GITHUB_TOKEN || "",
    bitbucketToken: process.env.BITBUCKET_TOKEN || "",
    gitlabToken: process.env.GITLAB_TOKEN || "",
    githubReviewerToken: process.env.GITHUB_REVIEWER_TOKEN || "",
    sandbox: sandboxEnv === "docker" ? "docker" : "none",
    dockerImage: process.env.WORKERMILL_DOCKER_IMAGE || "ghcr.io/workermill/worker",
  };
}

/**
 * On Windows, search for a binary on the fresh PATH read from the registry.
 * This detects binaries installed after the process started (stale PATH).
 * Returns the full path if found, null otherwise. No-op on non-Windows.
 */
function findOnFreshWindowsPath(name: string): string | null {
  if (process.platform !== "win32") return null;

  const allDirs: string[] = [];

  // System PATH (HKLM — where Git installer writes)
  try {
    const sysOut = execFileSync(
      "reg",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = sysOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) allDirs.push(...match[1].trim().split(";").filter(Boolean));
  } catch { /* registry read failed */ }

  // User PATH (HKCU — where some winget installs write)
  try {
    const userOut = execFileSync(
      "reg",
      ["query", "HKCU\\Environment", "/v", "Path"],
      { encoding: "utf-8", timeout: 5000, windowsHide: true },
    );
    const match = userOut.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
    if (match) allDirs.push(...match[1].trim().split(";").filter(Boolean));
  } catch { /* registry read failed */ }

  for (const dir of allDirs) {
    const expanded = dir.replace(/%([^%]+)%/g, (_, v) => process.env[v] || "");
    const candidate = join(expanded, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Find Git binary. Checks GIT_EXEC_PATH env, then PATH, then Windows registry PATH,
 * then known locations.
 */
export function findGitPath(): string | null {
  // Check explicit env var first (set by VS Code extension)
  const envPath = process.env.WORKERMILL_GIT_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const isWin = process.platform === "win32";
  const name = isWin ? "git.exe" : "git";

  // Check PATH first (use execFileSync to avoid spawning cmd.exe shell on Windows)
  try {
    const cmd = isWin ? "where.exe" : "which";
    const resolved = execFileSync(cmd, [name], { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }).trim().split("\n")[0];
    if (resolved && existsSync(resolved)) return resolved;
  } catch { /* not on PATH */ }

  // On Windows, re-read PATH from registry (detects post-startup installs)
  if (isWin) {
    const freshResult = findOnFreshWindowsPath(name);
    if (freshResult) return freshResult;

    // Check known install locations
    const candidates = [
      join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd", "git.exe"),
      join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "git.exe"),
      join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "cmd", "git.exe"),
      join(homedir(), "AppData", "Local", "Programs", "Git", "cmd", "git.exe"),
      join(homedir(), "AppData", "Local", "Programs", "Git", "bin", "git.exe"),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }

  return null;
}

/**
 * Find claude binary. Checks CLAUDE_CLI_PATH env, then PATH, then Windows registry PATH,
 * then known install locations.
 */
export function findClaudePath(): string | null {
  // Check explicit env var first (set by VS Code extension)
  const envPath = process.env.CLAUDE_CLI_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const isWin = process.platform === "win32";
  const which = isWin ? "where" : "which";

  // Check PATH first — return absolute path for SDK compatibility
  // Use execFileSync to avoid spawning cmd.exe shell on Windows (prevents terminal flash)
  try {
    const resolved = execFileSync(isWin ? "where.exe" : "which", [isWin ? "claude.exe" : "claude"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim().split("\n")[0];
    if (resolved && existsSync(resolved)) return resolved;
    return "claude"; // fallback to bare name if resolution fails
  } catch { /* not in PATH */ }

  // On Windows, re-read PATH from registry (detects post-startup installs)
  if (isWin) {
    const freshResult = findOnFreshWindowsPath("claude.exe");
    if (freshResult) return freshResult;
  }

  const candidates: string[] = [];

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    candidates.push(
      // winget install locations
      join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"),
      join(localAppData, "Microsoft", "WindowsApps", "claude.exe"),
      // Standard install locations
      join(process.env.ProgramFiles || "C:\\Program Files", "ClaudeCode", "claude.exe"),
      join(localAppData, "Programs", "ClaudeCode", "claude.exe"),
      join(localAppData, "Programs", "claude-code", "claude.exe"),
      // npm global
      join(appData, "npm", "claude.cmd"),
      join(localAppData, "npm", "claude.cmd"),
      // Other
      join(homedir(), ".local", "bin", "claude.exe"),
      join(homedir(), ".claude", "bin", "claude.exe"),
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

  // Git — use findGitPath() which checks PATH, registry, and known locations
  const gitPath = findGitPath();
  if (gitPath) {
    try {
      // Use execFileSync to avoid cmd.exe shell flash on Windows
      const version = execFileSync(gitPath, ["--version"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim();
      results.push({ name: "Git", ok: true, detail: version });
    } catch {
      results.push({ name: "Git", ok: true, detail: gitPath });
    }
  } else {
    results.push({ name: "Git", ok: false, detail: "Not installed" });
  }

  // Claude CLI (search known install locations, not just PATH)
  const claudePath = findClaudePath();
  if (claudePath) {
    try {
      // .cmd files (npm global) need shell — but .exe files can use execFileSync
      const isCmdFile = claudePath.endsWith(".cmd");
      const version = isCmdFile
        ? execSync(`"${claudePath}" --version`, { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim()
        : execFileSync(claudePath, ["--version"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim();
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
  // Check Git — use findGitPath() which checks PATH, registry, and known locations
  if (!findGitPath()) {
    console.error("Git is not installed. Install Git and ensure it's in PATH.");
    process.exit(1);
  }

  // Check Claude CLI
  if (!findClaudePath()) {
    console.error("Claude Code CLI is not installed.");
    console.error("Install Claude Code and ensure it's available on your PATH.");
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
      // .cmd files (npm global) need shell — .exe files use execFileSync to avoid terminal flash
      const isCmdFile = claudeBin.endsWith(".cmd");
      claudeVersion = isCmdFile
        ? execSync(`"${claudeBin}" --version`, { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim()
        : execFileSync(claudeBin, ["--version"], { encoding: "utf-8", timeout: 10000, windowsHide: true }).trim();
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

/**
 * Check if Docker is available and running.
 */
export function checkDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "pipe", timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Docker CLI is installed (even if the daemon is not running).
 * `docker --version` prints version info without contacting the daemon.
 */
export function isDockerInstalled(): boolean {
  try {
    execFileSync("docker", ["--version"], { stdio: "pipe", timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
