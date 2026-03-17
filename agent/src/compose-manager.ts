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
import { DOCKER_IMAGE_TAG } from "./version.js";

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
  const docker = findDockerBin();
  const composeFile = findComposeFile();
  const composeDir = path.dirname(composeFile);

  // Pin API + frontend image tags to the agent version, fall back to :latest
  // Same pattern as docker-spawner: try versioned tag, use latest if not available
  try {
    let content = fs.readFileSync(composeFile, "utf-8");
    const versionedTag = DOCKER_IMAGE_TAG; // e.g. "0.10.242" or "latest" in dev
    let tag = versionedTag;

    // Check if the versioned API image exists in the registry
    if (versionedTag !== "latest") {
      try {
        execFileSync(docker, ["manifest", "inspect", `ghcr.io/jarod-rosenthal/api:${versionedTag}`], {
          stdio: "pipe", timeout: 15_000, windowsHide: true,
        });
      } catch {
        // Versioned tag not available yet — fall back to latest
        tag = "latest";
        log?.(`Image tag ${versionedTag} not available, falling back to latest`);
      }
    }

    content = content.replace(
      /ghcr\.io\/jarod-rosenthal\/api:[^\s"]+/g,
      `ghcr.io/jarod-rosenthal/api:${tag}`,
    );
    content = content.replace(
      /ghcr\.io\/jarod-rosenthal\/frontend:[^\s"]+/g,
      `ghcr.io/jarod-rosenthal/frontend:${tag}`,
    );
    fs.writeFileSync(composeFile, content);
    log?.(`Image tags pinned to ${tag}`);
  } catch {
    // Non-fatal — compose will use whatever tags are in the file
  }

  const alreadyRunning = await isStackHealthy();
  log?.(alreadyRunning
    ? "Updating self-hosted stack..."
    : `Starting self-hosted stack from ${composeFile}`);

  // Pull and start services — use spawn instead of execFileSync to avoid
  // output buffer deadlock on large image pulls
  try {
    const { spawnSync } = await import("child_process");
    const result = spawnSync(docker, ["compose", "-f", composeFile, "up", "-d", "--pull", "always"], {
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
