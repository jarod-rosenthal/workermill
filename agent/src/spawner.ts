/**
 * Remote Agent Spawner
 *
 * Spawns Docker worker containers that talk directly to the cloud WorkerMill API.
 * Extracted from api/src/services/local-epic-spawner.ts with key differences:
 *   - API_BASE_URL points to cloud (https://workermill.com)
 *   - ORG_API_KEY is the real org API key
 *   - Container logs stream to cloud dashboard via SSE
 */

import chalk from "chalk";
import { spawn, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { AgentConfig } from "./config.js";

/** Timestamp prefix */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

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
const isDockerDesktop = isWSL || process.platform === "darwin" || process.platform === "win32";

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
  workerProvider?: string;
  githubRepo: string;
  scmProvider: string;
  skipManagerReview?: boolean;
  executionPlanV2: unknown;
  jiraFields: Record<string, unknown>;
  taskNotes?: string;
}

/** Org credentials returned by /api/agent/claim */
export interface ClaimCredentials {
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  linearApiKey?: string;
  managerProvider?: string;
  managerModelId?: string;
  customerAwsAccessKeyId?: string;
  customerAwsSecretAccessKey?: string;
  customerAwsRegion?: string;
  issueTrackerProvider?: string;
  bitbucketEmail?: string;
  // AI provider API keys for multi-provider planning & execution
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
}

/** Check if a task has the self-review label (works across Jira, GitHub, GitLab, Linear) */
function hasSelfReviewLabel(task: SpawnableTask): boolean {
  const fields = task.jiraFields;
  if (!fields) return false;
  // Jira: labels is a string array at top level
  const jiraLabels = fields.labels;
  if (Array.isArray(jiraLabels) && jiraLabels.some((l: unknown) => typeof l === "string" && (l as string).toLowerCase() === "self-review")) return true;
  // GitHub/GitLab: labels are in nested issue object with {name: string} shape
  const issue = fields.issue as Record<string, unknown> | undefined;
  const issueLabels = issue?.labels;
  if (Array.isArray(issueLabels) && issueLabels.some((l: unknown) => {
    if (typeof l === "string") return l.toLowerCase() === "self-review";
    if (l && typeof l === "object" && "name" in l) return ((l as { name: string }).name || "").toLowerCase() === "self-review";
    return false;
  })) return true;
  return false;
}

/**
 * Spawn a Docker worker container for a task.
 */
export async function spawnWorker(
  task: SpawnableTask,
  config: AgentConfig,
  orgConfig: Record<string, unknown>,
  credentials?: ClaimCredentials,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  if (activeContainers.has(task.id)) {
    console.log(`${ts()} ${taskLabel} ${chalk.dim("Already running, skipping")}`);
    return;
  }

  const containerName = `workermill-${task.id.slice(0, 8)}`;

  // Build Docker run arguments
  const dockerArgs = ["run", "--rm", "--pull", "always", "--name", containerName];

  // Resource limits — 6GB memory with swap for overflow.
  // NODE_OPTIONS caps V8 heap at 2GB; the extra room is for git, npm, Claude CLI subprocesses.
  const totalRamGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  if (totalRamGB <= 16) {
    dockerArgs.push("--memory", "6g", "--memory-swap", "10g", "--cpus", "2");
  } else if (totalRamGB <= 32) {
    dockerArgs.push("--memory", "6g", "--memory-swap", "12g", "--cpus", "4");
  } else {
    dockerArgs.push("--memory", "6g", "--memory-swap", "12g", "--cpus", "4");
  }

  // Network mode
  if (isDockerDesktop) {
    dockerArgs.push("--add-host=host.docker.internal:host-gateway");
  } else {
    dockerArgs.push("--network", "host");
  }

  // Mount Claude credentials (required for Anthropic workers, optional for others)
  const workerProvider = task.workerProvider || "anthropic";
  const claudeConfigDir = findClaudeConfigDir();
  if (!claudeConfigDir && workerProvider === "anthropic") {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Claude credentials not found. Run 'claude' and complete the sign-in flow.`);
    return;
  }

  if (claudeConfigDir) {
    const dockerClaudeDir = toDockerPath(claudeConfigDir);
    dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude`);
  } else {
    console.log(`${ts()} ${taskLabel} ${chalk.dim("Skipping Claude mount (non-Anthropic worker)")}`);
  }

  // Build environment variables — KEY DIFFERENCE: API_BASE_URL points to cloud
  const scmProvider = (task.scmProvider || "github") as string;
  const scmToken = getScmToken(scmProvider, config);

  const envVars: Record<string, string> = {
    // Cap V8 heap to 3GB — forces aggressive GC instead of bloating to fill container.
    // Each Claude CLI subprocess inherits this, preventing unbounded heap growth.
    // Container has 6GB total; this leaves room for git, npm, and OS overhead.
    NODE_OPTIONS: "--max-old-space-size=3072",
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
    BITBUCKET_USERNAME: "x-token-auth",
    GITLAB_TOKEN: config.gitlabToken,

    // Target repository
    TARGET_REPO: task.githubRepo || "",
    GITHUB_REPO: task.githubRepo || "",

    // Worker model
    WORKER_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || "sonnet"),

    // Jira credentials (from org Secrets Manager via /api/agent/claim)
    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",

    // Issue tracker system (jira, linear, github-issues)
    TICKET_SYSTEM: credentials?.issueTrackerProvider || "jira",
    LINEAR_API_KEY: credentials?.linearApiKey || "",

    // AWS credentials (from org Secrets Manager for workers that deploy infrastructure)
    AWS_ACCESS_KEY_ID: credentials?.customerAwsAccessKeyId || "",
    AWS_SECRET_ACCESS_KEY: credentials?.customerAwsSecretAccessKey || "",
    AWS_DEFAULT_REGION: credentials?.customerAwsRegion || "",
    AWS_REGION: credentials?.customerAwsRegion || "",

    // Manager provider and model for tech lead review
    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",

    // Bitbucket email (needed for API calls with API tokens)
    BITBUCKET_EMAIL: credentials?.bitbucketEmail || "",

    // Task notes from dashboard
    TASK_NOTES: task.taskNotes || "",

    // AI provider configuration
    ANTHROPIC_API_KEY: claudeConfigDir ? "" : (credentials?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ""),
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",
    GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || "",
    OLLAMA_HOST: credentials?.ollamaBaseUrl || "",

    // Resilience settings from org config
    BLOCKER_MAX_AUTO_RETRIES: String(orgConfig.blockerMaxAutoRetries ?? 3),
    BLOCKER_AUTO_RETRY_ENABLED: orgConfig.blockerAutoRetryEnabled !== false ? "true" : "false",
    PUSH_AFTER_COMMIT: orgConfig.pushAfterCommit !== false ? "true" : "false",
    GRACEFUL_SHUTDOWN_ENABLED: orgConfig.gracefulShutdownEnabled !== false ? "true" : "false",
    MAX_PARALLEL_EXPERTS: String(orgConfig.maxParallelExperts ?? 4),
    REVIEW_ENABLED: task.skipManagerReview === false ? "true" : "false",
    SELF_REVIEW_ENABLED: hasSelfReviewLabel(task) || (orgConfig.selfReviewEnabled !== false) ? "true" : "false",
  };

  // Build -e args, filtering empty values
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") {
      dockerArgs.push("-e", `${k}=${v}`);
    }
  }

  // Worker image (configurable: Docker Hub for CLI users, local for bin/remote-agent)
  dockerArgs.push(config.workerImage || "public.ecr.aws/a7k5r0v0/workermill-worker:latest");

  const reviewEnabled = task.skipManagerReview === false;
  console.log(`${ts()} ${taskLabel} ${chalk.dim("Starting container")} ${chalk.yellow(containerName)}`);
  console.log(`${ts()} ${taskLabel} ${chalk.dim(`  skipManagerReview=${task.skipManagerReview} → REVIEW_ENABLED=${reviewEnabled}`)}`);
  console.log(`${ts()} ${taskLabel} ${chalk.dim(`  model=${task.workerModel} repo=${task.githubRepo}`)}`);
  console.log(`${ts()} ${taskLabel} ${chalk.dim(`  totalRamGB=${totalRamGB} docker args:`)} ${dockerArgs.slice(0, 10).join(" ")}`);

  // Spawn Docker container
  const proc = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!proc.pid) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed to spawn container`);
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
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.dim(line)}`);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.red(line)}`);
    }
  });

  // Handle exit
  proc.on("exit", (code) => {
    container.status = code === 0 ? "completed" : "failed";
    const duration = Math.round((Date.now() - container.startedAt.getTime()) / 1000);
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status = code === 0 ? chalk.green("completed") : chalk.red(`failed (exit ${code})`);
    console.log(`${ts()} ${taskLabel} ${icon} Container ${status} ${chalk.dim(`(${duration}s)`)}`);

    // Clean up after delay
    setTimeout(() => activeContainers.delete(task.id), 60_000);
  });

  proc.on("error", (err) => {
    container.status = "failed";
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Container error: ${err.message}`);
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
 * Stop a specific task's container by task ID.
 */
export function stopTask(taskId: string): void {
  const container = activeContainers.get(taskId);
  if (!container || container.status !== "running") return;

  const taskLabel = chalk.cyan(taskId.slice(0, 8));
  console.log(`${ts()} ${taskLabel} ${chalk.red("■")} Stopping container (cancelled by dashboard)`);
  try {
    execSync(`docker stop ${container.containerName}`, { stdio: "ignore", timeout: 15_000 });
    container.status = "completed";
  } catch { /* may have already exited */ }
  activeContainers.delete(taskId);
}

/**
 * Stop all running containers.
 */
export async function stopAll(): Promise<void> {
  console.log(`${ts()} ${chalk.dim(`Stopping ${activeContainers.size} containers...`)}`);
  for (const [, container] of activeContainers) {
    if (container.status === "running") {
      try {
        execSync(`docker stop ${container.containerName}`, { stdio: "ignore", timeout: 15_000 });
        container.status = "completed";
      } catch { /* may have already exited */ }
    }
  }
  activeContainers.clear();
}
