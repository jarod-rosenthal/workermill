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
  // Check if already running
  if (await isStackHealthy()) {
    log?.("Self-hosted stack already running");
    return;
  }

  const docker = findDockerBin();
  const composeFile = findComposeFile();
  const composeDir = path.dirname(composeFile);

  log?.(`Starting self-hosted stack from ${composeFile}`);

  // Build and start services
  try {
    execFileSync(docker, ["compose", "-f", composeFile, "up", "-d", "--pull", "always"], {
      cwd: composeDir,
      stdio: "pipe",
      timeout: 300_000, // 5 minutes for first build
      windowsHide: true,
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer })?.stderr?.toString?.() || "";
    throw new Error(`Failed to start self-hosted stack: ${stderr || (err instanceof Error ? err.message : String(err))}`);
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
