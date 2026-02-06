/**
 * Remote Agent Spawner
 *
 * Spawns Docker worker containers that talk directly to the cloud WorkerMill API.
 * Extracted from api/src/services/local-epic-spawner.ts with key differences:
 *   - API_BASE_URL points to cloud (https://workermill.com)
 *   - ORG_API_KEY is the real org API key
 *   - Container logs stream to cloud dashboard via SSE
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { AgentConfig } from "./config.js";

interface ActiveContainer {
  taskId: string;
  containerName: string;
  process: ChildProcess;
  startedAt: Date;
  status: "running" | "completed" | "failed";
}

// Track active containers
const activeContainers = new Map<string, ActiveContainer>();

/**
 * Detect if running in WSL.
 */
function detectWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf-8");
    return procVersion.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

const isWSL = detectWSL();
const isDockerDesktop = isWSL || process.platform === "darwin";

/**
 * Convert WSL paths to Windows paths for Docker volume mounts.
 */
function toDockerPath(unixPath: string): string {
  if (!isWSL) return unixPath;
  const match = unixPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (match) return `${match[1].toUpperCase()}:/${match[2]}`;
  return unixPath;
}

/**
 * Find Claude config directory (handles WSL).
 */
function findClaudeConfigDir(): string | null {
  const standardDir = path.join(os.homedir(), ".claude");
  if (fs.existsSync(standardDir)) return standardDir;

  if (isWSL) {
    const windowsUsersDir = "/mnt/c/Users";
    if (fs.existsSync(windowsUsersDir)) {
      try {
        for (const user of fs.readdirSync(windowsUsersDir)) {
          if (["Public", "Default", "Default User", "All Users"].includes(user)) continue;
          const claudeDir = path.join(windowsUsersDir, user, ".claude");
          if (fs.existsSync(claudeDir)) return claudeDir;
        }
      } catch { /* ignore */ }
    }
  }

  return null;
}

/**
 * Get SCM token based on provider.
 */
function getScmToken(scmProvider: string, config: AgentConfig): string {
  switch (scmProvider) {
    case "bitbucket": return config.bitbucketToken;
    case "gitlab": return config.gitlabToken;
    default: return config.githubToken;
  }
}

export interface SpawnableTask {
  id: string;
  summary: string;
  description: string | null;
  jiraIssueKey: string | null;
  workerModel: string;
  githubRepo: string;
  scmProvider: string;
  executionPlanV2: unknown;
  jiraFields: Record<string, unknown>;
}

/**
 * Spawn a Docker worker container for a task.
 */
export async function spawnWorker(
  task: SpawnableTask,
  config: AgentConfig,
  orgConfig: Record<string, unknown>,
): Promise<void> {
  if (activeContainers.has(task.id)) {
    console.log(`[spawner] Task ${task.id.slice(0, 8)} already running, skipping.`);
    return;
  }

  const containerName = `workermill-${task.id.slice(0, 8)}`;

  // Build Docker run arguments
  const dockerArgs = ["run", "--name", containerName];

  // Network mode
  if (isDockerDesktop) {
    dockerArgs.push("--add-host=host.docker.internal:host-gateway");
  } else {
    dockerArgs.push("--network", "host");
  }

  // Mount Claude credentials
  const claudeConfigDir = findClaudeConfigDir();
  if (!claudeConfigDir) {
    console.error("[spawner] Claude credentials not found. Run 'claude auth login'.");
    return;
  }

  // Relax permissions for container access
  const credFile = path.join(claudeConfigDir, ".credentials.json");
  try { fs.chmodSync(credFile, 0o644); } catch { /* ignore */ }

  const dockerClaudeDir = toDockerPath(claudeConfigDir);
  dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude`);

  // Build environment variables — KEY DIFFERENCE: API_BASE_URL points to cloud
  const scmProvider = (task.scmProvider || "github") as string;
  const scmToken = getScmToken(scmProvider, config);

  const envVars: Record<string, string> = {
    EPIC_MODE: "true",
    EXECUTION_MODE: "local",
    TASK_ID: task.id,
    PARENT_TASK_ID: task.id,
    JIRA_ISSUE_KEY: task.jiraIssueKey || "",
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",

    // Cloud API — this is what makes remote agent mode work
    API_BASE_URL: config.apiUrl,
    ORG_API_KEY: config.apiKey,

    // SCM configuration
    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    GITHUB_TOKEN: config.githubToken,
    GH_TOKEN: config.githubToken,
    BITBUCKET_TOKEN: config.bitbucketToken,
    BITBUCKET_USERNAME: "x-bitbucket-api-token-auth",
    GITLAB_TOKEN: config.gitlabToken,

    // Target repository
    TARGET_REPO: task.githubRepo || "",
    GITHUB_REPO: task.githubRepo || "",

    // Worker model
    WORKER_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || "sonnet"),

    // Anthropic API key (if available)
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",

    // Resilience settings from org config
    BLOCKER_MAX_AUTO_RETRIES: String(orgConfig.blockerMaxAutoRetries ?? 3),
    BLOCKER_AUTO_RETRY_ENABLED: orgConfig.blockerAutoRetryEnabled !== false ? "true" : "false",
    PUSH_AFTER_COMMIT: orgConfig.pushAfterCommit !== false ? "true" : "false",
    GRACEFUL_SHUTDOWN_ENABLED: orgConfig.gracefulShutdownEnabled !== false ? "true" : "false",
    SELF_REVIEW_ENABLED: orgConfig.selfReviewEnabled !== false ? "true" : "false",
  };

  // Build -e args, filtering empty values
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") {
      dockerArgs.push("-e", `${k}=${v}`);
    }
  }

  // Worker image
  dockerArgs.push("workermill-worker:local");

  console.log(`[spawner] Starting container ${containerName} for task ${task.id.slice(0, 8)}...`);

  // Spawn Docker container
  const proc = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!proc.pid) {
    console.error(`[spawner] Failed to spawn container for task ${task.id.slice(0, 8)}`);
    return;
  }

  const container: ActiveContainer = {
    taskId: task.id,
    containerName,
    process: proc,
    startedAt: new Date(),
    status: "running",
  };
  activeContainers.set(task.id, container);

  // Stream stdout/stderr to console (logs go to cloud via container's own HTTP calls)
  proc.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(`[${task.id.slice(0, 8)}] ${data.toString()}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(`[${task.id.slice(0, 8)} ERR] ${data.toString()}`);
  });

  // Handle exit
  proc.on("exit", (code) => {
    container.status = code === 0 ? "completed" : "failed";
    console.log(
      `[spawner] Container ${containerName} exited (code=${code}, ` +
      `duration=${Math.round((Date.now() - container.startedAt.getTime()) / 1000)}s)`,
    );

    // Clean up after delay
    setTimeout(() => activeContainers.delete(task.id), 60_000);
  });

  proc.on("error", (err) => {
    container.status = "failed";
    console.error(`[spawner] Container ${containerName} error:`, err.message);
  });
}

/**
 * Get count of actively running containers.
 */
export function getActiveCount(): number {
  return Array.from(activeContainers.values()).filter((c) => c.status === "running").length;
}

/**
 * Get IDs of all active tasks.
 */
export function getActiveTaskIds(): string[] {
  return Array.from(activeContainers.values())
    .filter((c) => c.status === "running")
    .map((c) => c.taskId);
}

/**
 * Stop all running containers.
 */
export async function stopAll(): Promise<void> {
  console.log(`[spawner] Stopping ${activeContainers.size} containers...`);
  for (const [taskId, container] of activeContainers) {
    if (container.status === "running") {
      try {
        execSync(`docker stop ${container.containerName}`, { stdio: "ignore", timeout: 15_000 });
        container.status = "completed";
      } catch { /* may have already exited */ }
    }
  }
}
