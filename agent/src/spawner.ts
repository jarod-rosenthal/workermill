/**
 * Remote Agent Spawner
 *
 * Spawns native Node.js worker processes that talk directly to the cloud WorkerMill API.
 * Workers execute as child processes on the user's machine (no Docker required).
 *
 * v0.10.0: Replaced Docker container spawning with native Node.js processes.
 */

import chalk from "chalk";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { AgentConfig } from "./config.js";

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

interface ActiveProcess {
  taskId: string;
  process: ChildProcess;
  startedAt: Date;
  status: "running" | "completed" | "failed";
  /** True if we saw a ::result:: marker in stdout */
  resultEmitted: boolean;
  /** Temp working directory for this task */
  workDir: string;
}

// Track active worker processes
const activeProcesses = new Map<string, ActiveProcess>();

/**
 * Resolve the path to dist/worker.js bundled with the agent package.
 */
function resolveWorkerPath(): string {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "worker.js");
}

/**
 * Resolve the path to dist/manager-worker.js bundled with the agent package.
 */
function resolveManagerWorkerPath(): string {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "manager-worker.js");
}

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
 * Spawn a native Node.js worker process for a task.
 */
export async function spawnWorker(
  task: SpawnableTask,
  config: AgentConfig,
  orgConfig: Record<string, unknown>,
  credentials?: ClaimCredentials,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  if (activeProcesses.has(task.id)) {
    console.log(`${ts()} ${taskLabel} ${chalk.dim("Already running, skipping")}`);
    return;
  }

  // Create isolated temp working directory for this task
  const workDir = path.join(os.tmpdir(), `workermill-${task.id.slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // Build environment variables
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
    // Node.js process — use reasonable heap limit
    NODE_OPTIONS: "--max-old-space-size=4096",
    EPIC_MODE: "true",
    EXECUTION_MODE: "remote",
    TASK_ID: task.id,
    ORG_ID: task.orgId || "",
    JIRA_ISSUE_KEY: task.jiraIssueKey || "",
    JIRA_SUMMARY: task.summary || "",
    JIRA_DESCRIPTION: task.description || "",
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",
    WORKER_PERSONA: task.workerPersona || "",
    RETRY_NUMBER: String(task.retryCount ?? 0),
    TICKET_KEY: task.jiraIssueKey || "",

    // API configuration — direct connection (no Docker networking translation)
    API_BASE_URL: config.apiUrl,
    ORG_API_KEY: config.apiKey,

    // SCM configuration
    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    SCM_BASE_URL: credentials?.scmBaseUrl || "",
    GITHUB_TOKEN: githubToken,
    GH_TOKEN: githubToken,
    GITHUB_REVIEWER_TOKEN: credentials?.githubReviewerToken || config.githubReviewerToken || "",
    BITBUCKET_TOKEN: bitbucketToken,
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-token-auth",
    GITLAB_TOKEN: gitlabToken,

    // Target repository
    TARGET_REPO: task.githubRepo || "",
    GITHUB_REPO: task.githubRepo || "",

    // Worker model
    WORKER_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || ""),
    CLAUDE_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || ""),

    // Jira credentials
    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",

    // Issue tracker
    TICKET_SYSTEM: credentials?.issueTrackerProvider || "jira",
    LINEAR_API_KEY: credentials?.linearApiKey || "",

    // AWS credentials
    AWS_ACCESS_KEY_ID: credentials?.customerAwsAccessKeyId || "",
    AWS_SECRET_ACCESS_KEY: credentials?.customerAwsSecretAccessKey || "",
    AWS_DEFAULT_REGION: credentials?.customerAwsRegion || "",
    AWS_REGION: credentials?.customerAwsRegion || "",
    CUSTOMER_AWS_ROLE_ARN: credentials?.customerAwsRoleArn || "",
    CUSTOMER_AWS_EXTERNAL_ID: credentials?.customerAwsExternalId || "",
    CUSTOMER_AWS_REGION: credentials?.customerAwsRegion || "",

    // Manager settings
    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",
    BITBUCKET_EMAIL: credentials?.bitbucketEmail || "",

    // Workflow control flags
    DEPLOYMENT_ENABLED: task.deploymentEnabled || task.parentTaskId ? "true" : "false",
    PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvementEnabled ? "true" : "false",
    QUALITY_GATE_BYPASS: task.qualityGateBypass ? "true" : "false",
    STANDARD_SDK_MODE: task.standardSdkMode ? "true" : "false",
    MAX_REVIEW_REVISIONS: String(orgConfig.maxReviewRevisions ?? 3),
    MAX_PER_STORY_REVISIONS: String(orgConfig.maxPerStoryRevisions ?? 2),
    CODEBASE_INDEXING_ENABLED: orgConfig.codebaseIndexingEnabled === true ? "true" : "false",

    // Existing PR info
    EXISTING_PR_URL: task.githubPrUrl || "",
    EXISTING_PR_NUMBER: task.githubPrNumber ? String(task.githubPrNumber) : "",

    // PRD Orchestration
    PARENT_TASK_ID: task.parentTaskId || task.id,
    PARENT_JIRA_KEY: task.jiraIssueKey && /-S\d+$/.test(task.jiraIssueKey)
      ? (task.jiraFields?.parentJiraKey as string) || ""
      : "",
    TARGET_BRANCH: (task.jiraFields?.targetBranch as string) || "",
    STORY_BRANCH: (task.jiraFields?.storyBranch as string) || "",

    // Task notes
    TASK_NOTES: task.taskNotes || "",

    // File targeting
    TARGET_FILES: JSON.stringify((task.jiraFields?.targetFiles as string[]) || []),
    REFERENCE_FILES: JSON.stringify((task.jiraFields?.referenceFiles as string[]) || []),

    // V2 Pipeline
    PIPELINE_VERSION: (task.jiraFields?.pipelineVersion as string) || task.pipelineVersion || "",
    V2_STEP_INPUT: task.jiraFields?.v2StepInput ? JSON.stringify(task.jiraFields.v2StepInput) : "",

    // Execution mode
    EXECUTION_MODE_SETTING: (task.jiraFields?.executionMode as string) || "autonomous",

    // AI provider configuration — Claude CLI reads ~/.claude/.credentials.json natively (OAuth).
    // If OAuth credentials exist, DON'T pass ANTHROPIC_API_KEY — it would override OAuth
    // with a potentially low-balance API key from org settings.
    ANTHROPIC_API_KEY: hasOAuthCredentials() ? "" : (credentials?.anthropicApiKey || ""),
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",
    GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || "",
    OLLAMA_HOST: credentials?.ollamaBaseUrl || "",
    OLLAMA_CONTEXT_WINDOW: credentials?.ollamaContextWindow ? String(credentials.ollamaContextWindow) : "",
    VLLM_BASE_URL: credentials?.vllmBaseUrl || "",

    // Resilience settings
    BLOCKER_MAX_AUTO_RETRIES: String(orgConfig.blockerMaxAutoRetries ?? 3),
    BLOCKER_AUTO_RETRY_ENABLED: orgConfig.blockerAutoRetryEnabled !== false ? "true" : "false",
    PUSH_AFTER_COMMIT: orgConfig.pushAfterCommit !== false ? "true" : "false",
    GRACEFUL_SHUTDOWN_ENABLED: orgConfig.gracefulShutdownEnabled !== false ? "true" : "false",
    MAX_PARALLEL_EXPERTS: String(orgConfig.maxParallelExperts ?? 4),
    REVIEW_ENABLED: task.skipManagerReview === false ? "true" : "false",
    SELF_REVIEW_ENABLED: hasSelfReviewLabel(task) || (orgConfig.selfReviewEnabled !== false) ? "true" : "false",
  };

  // Build env object, filtering empty values and inheriting PATH
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || process.env.USERPROFILE || "",
    LANG: process.env.LANG || "en_US.UTF-8",
  };
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") childEnv[k] = v;
  }

  // Resolve worker entry point
  const workerPath = resolveWorkerPath();
  if (!fs.existsSync(workerPath)) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Worker bundle not found at ${workerPath}`);
    return;
  }

  const reviewEnabled = task.skipManagerReview === false;
  console.log(`${ts()} ${taskLabel} ${chalk.dim("Starting worker process")}`);
  console.log(`${ts()} ${taskLabel} ${chalk.dim(`  review=${reviewEnabled} model=${task.workerModel} repo=${task.githubRepo}`)}`);

  // Spawn Node.js process
  const proc = spawn("node", [workerPath], {
    env: childEnv,
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!proc.pid) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed to spawn worker process`);
    return;
  }

  const active: ActiveProcess = {
    taskId: task.id,
    process: proc,
    startedAt: new Date(),
    status: "running",
    resultEmitted: false,
    workDir,
  };
  activeProcesses.set(task.id, active);

  // Stream stdout/stderr
  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.dim(redactSecrets(line))}`);
      if (line.includes("::result::")) {
        active.resultEmitted = true;
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.red(redactSecrets(line))}`);
    }
  });

  // Handle exit
  proc.on("exit", (code) => {
    active.status = code === 0 ? "completed" : "failed";
    const duration = Math.round((Date.now() - active.startedAt.getTime()) / 1000);
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status = code === 0 ? chalk.green("completed") : chalk.red(`failed (exit ${code})`);
    console.log(`${ts()} ${taskLabel} ${icon} Worker ${status} ${chalk.dim(`(${duration}s)`)}`);

    // Safety net: post fallback completion if no ::result:: marker
    if (!active.resultEmitted) {
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} No ::result:: marker — posting fallback completion in 15s`);
      setTimeout(async () => {
        try {
          const fallbackResult = code === 0 ? "completed" : "failed";
          const errorMsg = code !== 0 ? `Worker process exited with code ${code} without reporting completion` : undefined;
          const resp = await fetch(`${config.apiUrl}/api/tasks/${task.id}/worker-complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config.apiKey,
            },
            body: JSON.stringify({
              exitCode: code ?? 1,
              result: fallbackResult,
              errorMessage: errorMsg,
            }),
          });
          const respData = await resp.json() as Record<string, unknown>;
          if (respData.status === "ignored") {
            console.log(`${ts()} ${taskLabel} ${chalk.dim("Fallback completion ignored (task already transitioned)")}`);
          } else {
            console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Fallback completion applied: ${fallbackResult}`);
          }
        } catch (err) {
          console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Fallback completion failed:`, err instanceof Error ? err.message : err);
        }
      }, 15_000);
    }

    // Clean up working directory and process reference after delay
    setTimeout(() => {
      activeProcesses.delete(task.id);
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch { /* best effort cleanup */ }
    }, 90_000);
  });

  proc.on("error", (err) => {
    active.status = "failed";
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Process error: ${err.message}`);
  });
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
 */
export function stopTask(taskId: string): void {
  const active = activeProcesses.get(taskId);
  if (!active || active.status !== "running") return;

  const taskLabel = chalk.cyan(taskId.slice(0, 8));
  console.log(`${ts()} ${taskLabel} ${chalk.red("■")} Stopping worker (cancelled by dashboard)`);
  try {
    active.process.kill("SIGTERM");
    active.status = "completed";
  } catch { /* may have already exited */ }
  activeProcesses.delete(taskId);
}

/**
 * Stop all running workers.
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
    NODE_OPTIONS: "--max-old-space-size=3072",
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
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-token-auth",
    GITLAB_TOKEN: gitlabToken,

    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",

    ANTHROPIC_API_KEY: hasOAuthCredentials() ? "" : (credentials?.anthropicApiKey || ""),
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",

    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",
    TICKET_SYSTEM: credentials?.issueTrackerProvider || "jira",
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

  const managerPath = resolveManagerWorkerPath();
  if (!fs.existsSync(managerPath)) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Manager worker bundle not found at ${managerPath}`);
    return;
  }

  console.log(`${ts()} ${taskLabel} ${chalk.magenta("◆ MANAGER")} Starting ${task.managerAction}`);

  const proc = spawn("node", [managerPath], {
    env: childEnv,
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

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
