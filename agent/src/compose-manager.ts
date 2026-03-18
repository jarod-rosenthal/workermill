/**
 * Compose Manager — start/stop the self-hosted Docker Compose stack.
 *
 * The agent binary calls this to bring up PostgreSQL, Redis, API, and Frontend
 * before entering cloud-agent mode pointed at localhost:3001.
 */

import { execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as http from "http";
import { fileURLToPath } from "url";
import { findDockerBin } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SELF_HOSTED_API_URL = "http://localhost:3001";
const HEALTH_ENDPOINT = `${SELF_HOSTED_API_URL}/health`;

/**
 * Find the Claude config directory, checking WSL Windows paths.
 * Matches docker-spawner.ts findClaudeConfigDir() logic.
 */
function findClaudeConfigDirForCompose(): string {
  const standardDir = path.join(os.homedir(), ".claude");
  if (fs.existsSync(path.join(standardDir, ".credentials.json"))) return standardDir;

  // Check USERPROFILE (Windows via WSL)
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    const wslPath = userProfile
      .replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`)
      .replace(/\\/g, "/");
    const wslClaudeDir = path.join(wslPath, ".claude");
    if (fs.existsSync(path.join(wslClaudeDir, ".credentials.json"))) return wslClaudeDir;
  }

  // Scan /mnt/c/Users for any .claude directory with credentials
  const windowsUsersDir = "/mnt/c/Users";
  if (fs.existsSync(windowsUsersDir)) {
    try {
      for (const user of fs.readdirSync(windowsUsersDir)) {
        if (["Public", "Default", "Default User", "All Users"].includes(user)) continue;
        const claudeDir = path.join(windowsUsersDir, user, ".claude");
        if (fs.existsSync(path.join(claudeDir, ".credentials.json"))) return claudeDir;
      }
    } catch { /* ignore */ }
  }

  // Fallback to standard dir even if credentials don't exist yet
  return standardDir;
}

/**
 * Find the docker-compose.yml bundled with the agent or in the repo.
 * The agent binary bundles it at build time; fallback to repo root for dev.
 */
function findComposeFile(): string {
  // Check ~/.workermill/ first (written during `init --self-hosted`)
  const wmDir = path.join(os.homedir(), ".workermill", "docker-compose.yml");
  if (fs.existsSync(wmDir)) return wmDir;

  // Bundled with agent binary (adjacent to the binary)
  const bundled = path.join(path.dirname(process.execPath), "docker-compose.yml");
  if (fs.existsSync(bundled)) return bundled;

  // Dev mode: repo root
  const repoRoot = path.resolve(__dirname, "../../..");
  const repoCompose = path.join(repoRoot, "docker-compose.yml");
  if (fs.existsSync(repoCompose)) return repoCompose;

  throw new Error(
    "docker-compose.yml not found. Run 'workermill-agent init --self-hosted' first, or reinstall the agent."
  );
}

/**
 * Check if the self-hosted stack is already running and healthy.
 */
export function isStackHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_ENDPOINT, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Start the self-hosted Docker Compose stack.
 * Idempotent — safe to call if already running.
 */
export async function startCompose(
  log?: (msg: string) => void,
): Promise<void> {
  const docker = findDockerBin();
  const composeFile = findComposeFile();
  const composeDir = path.dirname(composeFile);

  // Ensure .env has the host Claude config path for the API container volume mount.
  // Written on every startup so it stays current if the user's home dir changes.
  // Use the same discovery logic as docker-spawner: check WSL Windows paths too.
  const envPath = path.join(composeDir, ".env");
  const claudeConfigDir = findClaudeConfigDirForCompose();
  try {
    // Read existing .env and update/add CLAUDE_CONFIG_DIR without clobbering other vars
    let envContent = "";
    try { envContent = fs.readFileSync(envPath, "utf-8"); } catch { /* doesn't exist yet */ }
    if (envContent.includes("CLAUDE_CONFIG_DIR=")) {
      envContent = envContent.replace(/CLAUDE_CONFIG_DIR=.*/g, `CLAUDE_CONFIG_DIR=${claudeConfigDir}`);
    } else {
      envContent = envContent.trimEnd() + (envContent ? "\n" : "") + `CLAUDE_CONFIG_DIR=${claudeConfigDir}\n`;
    }
    fs.writeFileSync(envPath, envContent, { encoding: "utf-8" });
  } catch { /* best effort — compose will use fallback */ }

  // All compose images use :latest tags. No version pinning — avoids
  // stacking old copies on disk (each version set was ~6 GB).
  // Users get updates via `init --standalone` or `docker compose pull`.

  const alreadyRunning = await isStackHealthy();
  log?.(alreadyRunning
    ? "Updating self-hosted stack..."
    : `Starting self-hosted stack from ${composeFile}`);

  // Start services — only pull images that don't exist locally.
  // Use spawn instead of execFileSync to avoid output buffer deadlock.
  try {
    const { spawnSync } = await import("child_process");
    const result = spawnSync(docker, ["compose", "-f", composeFile, "up", "-d", "--pull", "missing"], {
      cwd: composeDir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000, // 10 minutes — first-time image pulls can be slow
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString?.() || "";
      throw new Error(stderr || `docker compose exited with code ${result.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("docker compose")) throw err;
    throw new Error(`Failed to start self-hosted stack: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Wait for API to be healthy
  log?.("Waiting for API to be ready...");
  const maxWaitMs = 300_000; // 5 minutes — first-time builds + migrations + image pulls can be slow
  const pollMs = 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    if (await isStackHealthy()) {
      log?.("API is healthy");
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error("API did not become healthy within 5 minutes. Check: docker compose logs api");
}

/**
 * Stop the self-hosted Docker Compose stack.
 */
export async function stopCompose(
  log?: (msg: string) => void,
): Promise<void> {
  const docker = findDockerBin();

  let composeFile: string;
  try {
    composeFile = findComposeFile();
  } catch {
    log?.("No compose file found — nothing to stop");
    return;
  }

  log?.("Stopping self-hosted stack...");
  try {
    execFileSync(docker, ["compose", "-f", composeFile, "down"], {
      cwd: path.dirname(composeFile),
      stdio: "pipe",
      timeout: 30_000,
      windowsHide: true,
    });
    log?.("Self-hosted stack stopped");
  } catch (err) {
    log?.(`Warning: compose down failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export { SELF_HOSTED_API_URL };
