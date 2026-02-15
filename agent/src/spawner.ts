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

/** Patterns that match sensitive values in log output */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Tokens embedded in URLs: ://user:TOKEN@ → ://user:***@
  [/(:\/\/[^:/?***REMOVED***]+:)[^@]+(@)/g, "$1***$2"],
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

interface ActiveContainer {
  taskId: string;
  containerName: string;
  process: ChildProcess;
  startedAt: Date;
  status: "running" | "completed" | "failed";
  /** True if we saw a ::result:: marker in stdout — means container called worker-complete itself */
  resultEmitted: boolean;
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
 * Get WSL2 host IP for Docker --add-host override.
 * On WSL2, host-gateway resolves to the Docker VM, not WSL2 where the API runs.
 */
function getWSLHostIP(): string | null {
  if (!isWSL) return null;
  try {
    const ip = execSync("hostname -I", { encoding: "utf-8" }).trim().split(/\s+/)[0];
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch { /* fall through */ }
  return null;
}

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

/** Cache ECR login (token lasts 12h, refresh after 11h) */
let ecrLoginExpiresAt = 0;

/**
 * Extract ECR registry hostname from a Docker image URL.
 * Returns null if the image is not from ECR.
 */
function extractEcrRegistry(imageUrl: string): string | null {
  const match = imageUrl.match(/^(\d+\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com)/);
  return match ? match[1] : null;
}

/**
 * Extract AWS region from an ECR registry hostname.
 */
function extractEcrRegion(registry: string): string {
  const match = registry.match(/\.ecr\.([a-z0-9-]+)\.amazonaws\.com/);
  return match ? match[1] : "us-east-1";
}

/**
 * Ensure Docker is logged into private ECR.
 * Uses ambient AWS credentials (aws configure).
 */
function ensureEcrLogin(registry: string): boolean {
  if (Date.now() < ecrLoginExpiresAt) return true;
  const region = extractEcrRegion(registry);
  try {
    execSync(
      `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
      { stdio: "pipe", timeout: 30_000 },
    );
    ecrLoginExpiresAt = Date.now() + 11 * 60 * 60 * 1000;
    return true;
  } catch {
    return false;
  }
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
  // Org credentials from API are the primary source
  if (credentials?.scmToken) return credentials.scmToken;
  // Fall back to local config tokens
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
  // SCM tokens from org Settings > Integrations (primary source)
  scmToken?: string;
  githubToken?: string;
  bitbucketUsername?: string;
  // AI provider API keys for multi-provider planning & execution
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  vllmBaseUrl?: string;
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
  // Only pull from registry for remote images; local images (no '/' in name) are already on disk
  const isLocalImage = !config.workerImage.includes("/");
  const dockerArgs = ["run", "--rm", ...(isLocalImage ? [] : ["--pull", "always"]), "--name", containerName];

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

  // Network mode — WSL2: host-gateway resolves to Docker VM, not WSL2, so use actual WSL IP
  if (isDockerDesktop) {
    const wslIP = getWSLHostIP();
    dockerArgs.push(`--add-host=host.docker.internal:${wslIP || "host-gateway"}`);
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
    // Ensure credentials file is readable AND writable inside container.
    // Claude CLI creates .credentials.json with 600 permissions, but the container
    // runs as UID 1001 (worker) while the host user is UID 1000. Without this chmod,
    // the mounted file is unreadable inside the container → "Invalid API key" errors.
    const credFile = path.join(claudeConfigDir, ".credentials.json");
    try {
      fs.chmodSync(credFile, 0o666);
    } catch {
      // Ignore - file may not exist yet
    }

    const dockerClaudeDir = toDockerPath(claudeConfigDir);
    dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude`);
  } else {
    console.log(`${ts()} ${taskLabel} ${chalk.dim("Skipping Claude mount (non-Anthropic worker)")}`);
  }

  // Build environment variables — KEY DIFFERENCE: API_BASE_URL points to cloud
  // Docker containers can't reach host via "localhost" — translate for Docker networking
  const containerApiUrl = config.apiUrl.replace(/localhost|127\.0\.0\.1/, "host.docker.internal");
  const scmProvider = (task.scmProvider || "github") as string;
  const scmToken = getScmToken(scmProvider, config, credentials);
  // Derive per-provider tokens: prefer org credentials, fall back to local config
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
    // Cap V8 heap to 3GB — forces aggressive GC instead of bloating to fill container.
    // Each Claude CLI subprocess inherits this, preventing unbounded heap growth.
    // Container has 6GB total; this leaves room for git, npm, and OS overhead.
    NODE_OPTIONS: "--max-old-space-size=3072",
    EPIC_MODE: "true",
    EXECUTION_MODE: "local",
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

    // Cloud API — this is what makes remote agent mode work
    // Use containerApiUrl so Docker containers reach the host via host.docker.internal
    API_BASE_URL: containerApiUrl,
    ORG_API_KEY: config.apiKey,

    // SCM configuration — org credentials from API are primary, local config is fallback
    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    SCM_BASE_URL: credentials?.scmBaseUrl || "",
    GITHUB_TOKEN: githubToken,
    GH_TOKEN: githubToken,
    GITHUB_REVIEWER_TOKEN: credentials?.githubReviewerToken || "",
    BITBUCKET_TOKEN: bitbucketToken,
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-token-auth",
    GITLAB_TOKEN: gitlabToken,

    // Target repository
    TARGET_REPO: task.githubRepo || "",
    GITHUB_REPO: task.githubRepo || "",

    // Worker model — comes from task or org settings, no hardcoded fallbacks
    WORKER_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || ""),
    CLAUDE_MODEL: task.workerModel || String(orgConfig.defaultWorkerModel || ""),

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
    // AWS cross-account access (for customer infrastructure deployment)
    CUSTOMER_AWS_ROLE_ARN: credentials?.customerAwsRoleArn || "",
    CUSTOMER_AWS_EXTERNAL_ID: credentials?.customerAwsExternalId || "",
    CUSTOMER_AWS_REGION: credentials?.customerAwsRegion || "",

    // Manager provider and model for tech lead review
    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",

    // Bitbucket email (needed for API calls with API tokens)
    BITBUCKET_EMAIL: credentials?.bitbucketEmail || "",

    // Workflow control flags (match ECS and local spawner logic)
    DEPLOYMENT_ENABLED: task.deploymentEnabled || task.parentTaskId ? "true" : "false",
    PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvementEnabled ? "true" : "false",
    QUALITY_GATE_BYPASS: task.qualityGateBypass ? "true" : "false",
    STANDARD_SDK_MODE: task.standardSdkMode ? "true" : "false",
    MAX_REVIEW_REVISIONS: String(orgConfig.maxReviewRevisions ?? 3),
    MAX_PER_STORY_REVISIONS: String(orgConfig.maxPerStoryRevisions ?? 2),
    CODEBASE_INDEXING_ENABLED: orgConfig.codebaseIndexingEnabled === true ? "true" : "false",

    // Existing PR info (for deployment-only runs)
    EXISTING_PR_URL: task.githubPrUrl || "",
    EXISTING_PR_NUMBER: task.githubPrNumber ? String(task.githubPrNumber) : "",

    // PRD Orchestration
    PARENT_TASK_ID: task.parentTaskId || task.id,
    PARENT_JIRA_KEY: task.jiraIssueKey && /-S\d+$/.test(task.jiraIssueKey)
      ? (task.jiraFields?.parentJiraKey as string) || ""
      : "",
    TARGET_BRANCH: (task.jiraFields?.targetBranch as string) || "",
    STORY_BRANCH: (task.jiraFields?.storyBranch as string) || "",

    // Task notes from dashboard
    TASK_NOTES: task.taskNotes || "",

    // File targeting from planning agent (cost-first optimization)
    TARGET_FILES: JSON.stringify((task.jiraFields?.targetFiles as string[]) || []),
    REFERENCE_FILES: JSON.stringify((task.jiraFields?.referenceFiles as string[]) || []),

    // V2 Pipeline support
    PIPELINE_VERSION: (task.jiraFields?.pipelineVersion as string) || task.pipelineVersion || "",
    V2_STEP_INPUT: task.jiraFields?.v2StepInput ? JSON.stringify(task.jiraFields.v2StepInput) : "",

    // Execution mode for supervised/autonomous
    EXECUTION_MODE_SETTING: (task.jiraFields?.executionMode as string) || "autonomous",

    // AI provider configuration
    ANTHROPIC_API_KEY: claudeConfigDir ? "" : (credentials?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ""),
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",
    GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || "",
    OLLAMA_HOST: credentials?.ollamaBaseUrl || "",
    OLLAMA_CONTEXT_WINDOW: credentials?.ollamaContextWindow ? String(credentials.ollamaContextWindow) : "",
    VLLM_BASE_URL: credentials?.vllmBaseUrl || "",

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

  // Worker image — private ECR requires auth
  const workerImage = config.workerImage;
  const ecrRegistry = extractEcrRegistry(workerImage);
  if (ecrRegistry) {
    ensureEcrLogin(ecrRegistry);
  }
  dockerArgs.push(workerImage);

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
    resultEmitted: false,
  };
  activeContainers.set(task.id, container);

  // Stream stdout/stderr to console (logs go to cloud via container's own HTTP calls)
  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.dim(redactSecrets(line))}`);
      // Track if worker emitted ::result:: marker (means it called worker-complete itself)
      if (line.includes("::result::")) {
        container.resultEmitted = true;
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
    container.status = code === 0 ? "completed" : "failed";
    const duration = Math.round((Date.now() - container.startedAt.getTime()) / 1000);
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status = code === 0 ? chalk.green("completed") : chalk.red(`failed (exit ${code})`);
    console.log(`${ts()} ${taskLabel} ${icon} Container ${status} ${chalk.dim(`(${duration}s)`)}`);

    // Safety net: if worker didn't emit ::result::, it may have died without calling worker-complete.
    // Wait briefly for any in-flight API calls, then POST a fallback completion.
    if (!container.resultEmitted) {
      console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} No ::result:: marker seen — posting fallback completion in 15s`);
      setTimeout(async () => {
        try {
          const fallbackResult = code === 0 ? "completed" : "failed";
          const errorMsg = code !== 0 ? `Worker container exited with code ${code} without reporting completion` : undefined;
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
          const data = await resp.json() as Record<string, unknown>;
          if (data.status === "ignored") {
            console.log(`${ts()} ${taskLabel} ${chalk.dim("Fallback completion ignored (task already transitioned)")}`);
          } else {
            console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Fallback completion applied: ${fallbackResult}`);
          }
        } catch (err) {
          console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Fallback completion failed:`, err instanceof Error ? err.message : err);
        }
      }, 15_000);
    }

    // Clean up after delay (extended to allow fallback completion to finish)
    setTimeout(() => activeContainers.delete(task.id), 90_000);
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

/** Credentials for manager tasks (subset of ClaimCredentials) */
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
  // SCM tokens from org Settings > Integrations
  scmToken?: string;
  githubToken?: string;
  bitbucketUsername?: string;
}

/**
 * Spawn a manager Docker container for PR review or log analysis.
 * Uses the same worker image but overrides the entrypoint to manager-entrypoint.sh.
 */
export async function spawnManagerWorker(
  task: ManagerTask,
  config: AgentConfig,
  credentials?: ManagerCredentials,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 8));

  // Check if already running a manager for this task
  const managerKey = `manager-${task.id}`;
  if (activeContainers.has(managerKey)) {
    return;
  }

  const containerName = `wm-manager-${task.id.slice(0, 8)}-${Date.now()}`;

  // Mount Claude credentials
  const claudeConfigDir = findClaudeConfigDir();
  const dockerArgs: string[] = [
    "run", "--rm",
    "--name", containerName,
    "--memory=4g",
    "--cpus=2",
  ];

  // Network mode — same as main worker spawn
  if (isDockerDesktop) {
    const wslIP = getWSLHostIP();
    dockerArgs.push(`--add-host=host.docker.internal:${wslIP || "host-gateway"}`);
  } else {
    dockerArgs.push("--network", "host");
  }

  if (claudeConfigDir) {
    const dockerClaudeDir = toDockerPath(claudeConfigDir);
    dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude`);
  }

  // Manager-specific env vars (match ECS runManagerTask)
  const containerApiUrl = config.apiUrl.replace(/localhost|127\.0\.0\.1/, "host.docker.internal");
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

    // Cloud API — use containerApiUrl for Docker networking
    API_BASE_URL: containerApiUrl,
    ORG_API_KEY: config.apiKey,

    // SCM configuration — org credentials from API are primary, local config is fallback
    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    GITHUB_TOKEN: githubToken,
    GH_TOKEN: githubToken,
    BITBUCKET_TOKEN: bitbucketToken,
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-token-auth",
    GITLAB_TOKEN: gitlabToken,

    // Manager provider and model
    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",

    // AI provider API keys
    ANTHROPIC_API_KEY: claudeConfigDir ? "" : (credentials?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || ""),
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",

    // Jira credentials
    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",
    TICKET_SYSTEM: credentials?.issueTrackerProvider || "jira",
    LINEAR_API_KEY: credentials?.linearApiKey || "",
  };

  // Build -e args, filtering empty values
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") {
      dockerArgs.push("-e", `${k}=${v}`);
    }
  }

  // Worker image with manager entrypoint override — private ECR requires auth
  const workerImage = config.workerImage;
  const ecrRegistry = extractEcrRegistry(workerImage);
  if (ecrRegistry) {
    ensureEcrLogin(ecrRegistry);
  }
  dockerArgs.push("--entrypoint", "/bin/bash");
  dockerArgs.push(workerImage);
  dockerArgs.push("/app/manager-entrypoint.sh");

  console.log(`${ts()} ${taskLabel} ${chalk.magenta("◆ MANAGER")} Starting ${task.managerAction} container ${chalk.yellow(containerName)}`);

  const proc = spawn("docker", dockerArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!proc.pid) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Failed to spawn manager container`);
    return;
  }

  const container: ActiveContainer = {
    taskId: managerKey,
    containerName,
    process: proc,
    startedAt: new Date(),
    status: "running",
    resultEmitted: false,
  };
  activeContainers.set(managerKey, container);

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
    container.status = code === 0 ? "completed" : "failed";
    const duration = Math.round((Date.now() - container.startedAt.getTime()) / 1000);
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status = code === 0 ? chalk.green("completed") : chalk.red(`failed (exit ${code})`);
    console.log(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${icon} Manager ${task.managerAction} ${status} ${chalk.dim(`(${duration}s)`)}`);
    setTimeout(() => activeContainers.delete(managerKey), 60_000);
  });

  proc.on("error", (err) => {
    container.status = "failed";
    console.error(`${ts()} ${taskLabel} ${chalk.magenta("MGR")} ${chalk.red("✗")} Container error: ${err.message}`);
  });
}
