/**
 * Remote Agent Spawner
 *
 * Routes worker tasks to Docker containers and manages worker lifecycle.
 */

import chalk from "chalk";
import { spawn, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { AgentConfig } from "./config.js";
import { findDockerBin } from "./config.js";
import { activeProcesses, type ActiveProcess } from "./active-processes.js";
import { agentEvents } from "./local-api.js";
import { fileURLToPath } from "url";

/**
 * Detect whether we're running as a compiled binary or via Node.js.
 * Returns { command, args } for spawning child processes with __WORKERMILL_MODE.
 *
 * Binary mode: process.execPath IS the binary → spawn(binary, [])
 * Node.js mode: process.execPath is `node` → spawn(node, [entryScript])
 */
function getSpawnArgs(): { command: string; args: string[] } {
  // If process.execPath ends with 'node' or 'node.exe', we're in Node.js mode
  const execName = path.basename(process.execPath).replace(/\.exe$/i, "");
  if (execName === "node" || execName === "nodejs") {
    // Resolve the entry.js script path relative to this module
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = path.dirname(thisFile);
    const entryScript = path.join(distDir, "entry.js");
    return { command: process.execPath, args: [entryScript] };
  }
  // Compiled binary — re-invoke self
  return { command: process.execPath, args: [] };
}

/** Timestamp prefix */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

/** Patterns that match sensitive values in log output */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Tokens embedded in URLs: ://user:TOKEN@ → ://user:***@
  [/(:\/\/[^:/?#]+:)[^@]+(@)/g, "$1***$2"],
  // GitHub tokens
  [/\b(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]+/g, "$1***"],
  // GitLab tokens
  [/\bglpat-[A-Za-z0-9\-_]+/g, "glpat-***"],
  // AWS access keys
  [/\b(AKIA)[A-Z0-9]{16}\b/g, "$1***"],
  // Bearer tokens
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***"],
  // x-api-key header values
  [/(x-api-key:\s*)[^\s,'"]+/gi, "$1***"],
];

/** Scrub known sensitive patterns from a string before printing */
function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// Re-export from shared module (used by docker-spawner.ts and local-api.ts)
export { activeProcesses, type ActiveProcess } from "./active-processes.js";

/**
 * Check if Claude OAuth credentials exist on this machine.
 * When OAuth is available, we skip passing ANTHROPIC_API_KEY to workers
 * so Claude CLI uses OAuth instead of a potentially low-balance API key.
 */
function hasOAuthCredentials(): boolean {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return fs.existsSync(path.join(home, ".claude", ".credentials.json"));
}

/**
 * Get SCM token based on provider.
 * Prefers org credentials from API, falls back to local config.
 */
function getScmToken(
  scmProvider: string,
  config: AgentConfig,
  credentials?: ClaimCredentials | ManagerCredentials,
): string {
  if (credentials?.scmToken) return credentials.scmToken;
  switch (scmProvider) {
    case "bitbucket":
      return config.bitbucketToken;
    case "gitlab":
      return config.gitlabToken;
    default:
      return config.githubToken;
  }
}

export interface SpawnableTask {
  id: string;
  orgId?: string;
  summary: string;
  description: string | null;
  jiraIssueKey: string | null;
  workerModel: string;
  workerProvider?: string;
  workerPersona?: string;
  githubRepo: string;
  scmProvider: string;
  skipManagerReview?: boolean;
  executionPlanV2: unknown;
  jiraFields: Record<string, unknown>;
  taskNotes?: string;
  deploymentEnabled?: boolean;
  improvementEnabled?: boolean;
  qualityGateBypass?: boolean;
  standardSdkMode?: boolean;
  parentTaskId?: string;
  githubPrUrl?: string;
  githubPrNumber?: number;
  retryCount?: number;
  pipelineVersion?: string;
  boardExecutionId?: string;
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
  customerAwsRoleArn?: string;
  customerAwsExternalId?: string;
  issueTrackerProvider?: string;
  bitbucketEmail?: string;
  githubReviewerToken?: string;
  scmBaseUrl?: string;
  ollamaContextWindow?: number;
  scmToken?: string;
  githubToken?: string;
  bitbucketUsername?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  vllmBaseUrl?: string;
}

/** Check if a task has the self-review label */
function hasSelfReviewLabel(task: SpawnableTask): boolean {
  const fields = task.jiraFields;
  if (!fields) return false;
  const jiraLabels = fields.labels;
  if (Array.isArray(jiraLabels) && jiraLabels.some((l: unknown) => typeof l === "string" && (l as string).toLowerCase() === "self-review")) return true;
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
 * Spawn a Docker worker for a task.
 */
export async function spawnWorker(
  task: SpawnableTask,
  config: AgentConfig,
  orgConfig: Record<string, unknown>,
  credentials?: ClaimCredentials,
): Promise<void> {
  const { spawnDockerWorker } = await import("./docker-spawner.js");
  return spawnDockerWorker(task, config, orgConfig, credentials);
}

/**
 * Get count of actively running workers.
 */
export function getActiveCount(): number {
  return Array.from(activeProcesses.values()).filter((p) => p.status === "running").length;
}

/**
 * Get IDs of all active tasks.
 */
export function getActiveTaskIds(): string[] {
  return Array.from(activeProcesses.values())
    .filter((p) => p.status === "running")
    .map((p) => p.taskId);
}

/**
 * Stop a specific task's worker by task ID.
 * Tries native process kill first, then Docker stop as fallback.
 */
export function stopTask(taskId: string): void {
  const active = activeProcesses.get(taskId);
  if (active && active.status === "running") {
    const taskLabel = chalk.cyan(taskId.slice(0, 8));
    console.log(`${ts()} ${taskLabel} ${chalk.red("■")} Stopping worker (cancelled by dashboard)`);
    try {
      active.process.kill("SIGTERM");
      active.status = "completed";
    } catch { /* may have already exited */ }
    activeProcesses.delete(taskId);
    return;
  }

  // Fallback: try stopping a Docker container (may exist if sandbox mode)
  try {
    execFileSync(findDockerBin(), ["stop", `wm-${taskId.slice(0, 12)}`], { stdio: "pipe", timeout: 15_000, windowsHide: true });
  } catch {
    // Container doesn't exist or Docker not available
  }
}

/**
 * Stop all running workers (native processes + Docker containers).
 */
export async function stopAll(): Promise<void> {
  console.log(`${ts()} ${chalk.dim(`Stopping ${activeProcesses.size} workers...`)}`);
  for (const [, active] of activeProcesses) {
    if (active.status === "running") {
      try {
        active.process.kill("SIGTERM");
        active.status = "completed";
      } catch { /* may have already exited */ }
    }
  }
  activeProcesses.clear();

  // Also stop any Docker sandbox containers
  try {
    const { stopAllDocker } = await import("./docker-spawner.js");
    stopAllDocker();
  } catch {
    // docker-spawner not available — no Docker containers to stop
  }
}

/** Manager task returned by the poll endpoint */
export interface ManagerTask {
  id: string;
  summary: string;
  description: string | null;
  jiraIssueKey: string | null;
  githubRepo: string;
  scmProvider: string;
  githubPrUrl?: string;
  githubPrNumber?: number;
  managerAction: "analyze_logs" | "review_pr";
}

/** Credentials for manager tasks */
export interface ManagerCredentials {
  managerProvider?: string;
  managerModelId?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  linearApiKey?: string;
  issueTrackerProvider?: string;
  scmToken?: string;
  githubToken?: string;
  bitbucketUsername?: string;
}

/**
 * Spawn a manager worker process for PR review or log analysis.
 */
export async function spawnManagerWorker(
  task: ManagerTask,
  config: AgentConfig,
  credentials?: ManagerCredentials,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  const managerKey = `manager-${task.id}`;
  if (activeProcesses.has(managerKey)) {
    return;
  }

  // Create temp working directory
  const workDir = path.join(os.tmpdir(), `wm-manager-${task.id.slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  const scmProvider = (task.scmProvider || "github") as string;
  const scmToken = getScmToken(scmProvider, config, credentials);
  const githubToken = credentials?.githubToken || config.githubToken;
  const bitbucketToken =
    scmProvider === "bitbucket"
      ? credentials?.scmToken || config.bitbucketToken
      : config.bitbucketToken;
  const gitlabToken =
    scmProvider === "gitlab"
      ? credentials?.scmToken || config.gitlabToken
      : config.gitlabToken;

  const envVars: Record<string, string> = {
    TASK_ID: task.id,
    MANAGER_ACTION: task.managerAction,
    JIRA_ISSUE_KEY: task.jiraIssueKey || "",
    JIRA_SUMMARY: task.summary || "",
    JIRA_DESCRIPTION: task.description || "",
    GITHUB_REPO: task.githubRepo || "",
    PR_URL: task.githubPrUrl || "",
    PR_NUMBER: task.githubPrNumber ? String(task.githubPrNumber) : "",

    API_BASE_URL: config.apiUrl,
    ORG_API_KEY: config.apiKey,

    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    GITHUB_TOKEN: githubToken,
    GH_TOKEN: githubToken,
    BITBUCKET_TOKEN: bitbucketToken,
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-bitbucket-api-token-auth",
    GITLAB_TOKEN: gitlabToken,

    MANAGER_PROVIDER: credentials?.managerProvider || "",
    MANAGER_MODEL: credentials?.managerModelId || "",

    ANTHROPIC_API_KEY: hasOAuthCredentials() ? "" : (credentials?.anthropicApiKey || ""),
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",

    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",
    TICKET_SYSTEM: credentials?.issueTrackerProvider || "internal",
    LINEAR_API_KEY: credentials?.linearApiKey || "",
  };

  const childEnv: Record<string, string> = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || process.env.USERPROFILE || "",
    LANG: process.env.LANG || "en_US.UTF-8",
  };
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") childEnv[k] = v;
  }

  console.log(`${ts()} ${taskLabel} ${chalk.magenta("◆ MANAGER")} Starting ${task.managerAction}`);

  const { command: mgrCmd, args: mgrArgs } = getSpawnArgs();
  const mgrStdinFd = fs.openSync(os.devNull, "r");
  const proc = spawn(mgrCmd, mgrArgs, {
    env: { ...childEnv, __WORKERMILL_MODE: "manager" },
    cwd: workDir,
    stdio: [mgrStdinFd, "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });
  fs.closeSync(mgrStdinFd);

  if (!proc.pid) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed to spawn manager process`);
    return;
  }

  const active: ActiveProcess = {
    taskId: managerKey,
    process: proc,
    startedAt: new Date(),
    status: "running",
    resultEmitted: false,
    workDir,
  };
  activeProcesses.set(managerKey, active);

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.dim(redactSecrets(line))}`);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.red(redactSecrets(line))}`);
    }
  });

  proc.on("exit", (code) => {
    active.status = code === 0 ? "completed" : "failed";
    const duration = Math.round((Date.now() - active.startedAt.getTime()) / 1000);
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status = code === 0 ? chalk.green("completed") : chalk.red(`failed (exit ${code})`);
    console.log(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${icon} Manager ${task.managerAction} ${status} ${chalk.dim(`(${duration}s)`)}`);
    setTimeout(() => {
      activeProcesses.delete(managerKey);
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch { /* best effort cleanup */ }
    }, 60_000);
  });

  proc.on("error", (err) => {
    active.status = "failed";
    console.error(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.red("✗")} Process error: ${err.message}`);
  });
}
