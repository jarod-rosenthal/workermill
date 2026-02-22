/**
 * Docker Sandbox Spawner
 *
 * Spawns worker tasks inside Docker containers instead of native processes.
 * Opt-in via `sandbox: "docker"` in ~/.workermill/config.json.
 *
 * Reuses networking/platform patterns from api/src/services/local-epic-spawner.ts.
 * Manager tasks stay native — only worker tasks are containerized.
 */

import chalk from "chalk";
import { spawn, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import type { AgentConfig } from "./config.js";
import { findDockerBin } from "./config.js";
import type { SpawnableTask, ClaimCredentials } from "./spawner.js";
import { activeProcesses, type ActiveProcess } from "./active-processes.js";
import { agentEvents } from "./local-api.js";
import { AGENT_VERSION } from "./version.js";

// ── Platform Detection ─────────────────────────────────

/**
 * Detect if running in WSL (Windows Subsystem for Linux).
 */
function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf-8");
    return procVersion.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

/**
 * Detect if Docker Desktop is in use (WSL or macOS).
 * Docker Desktop doesn't support --network host.
 */
function isDockerDesktop(): boolean {
  return isWSL() || process.platform === "darwin";
}

/**
 * Get WSL2 IP address for Docker container → host communication.
 * Docker Desktop's host-gateway resolves to the Docker VM, not WSL2.
 */
function getWSLHostIP(): string | null {
  if (!isWSL()) return null;
  try {
    const ip = execFileSync("hostname", ["-I"], { encoding: "utf-8", windowsHide: true })
      .trim()
      .split(/\s+/)[0];
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return ip;
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Convert WSL /mnt/c/... paths to Windows C:/... paths for Docker volume mounts.
 */
function toDockerPath(unixPath: string): string {
  if (!isWSL()) return unixPath;
  const wslPathMatch = unixPath.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wslPathMatch) {
    const driveLetter = wslPathMatch[1].toUpperCase();
    const restOfPath = wslPathMatch[2];
    return `${driveLetter}:/${restOfPath}`;
  }
  return unixPath;
}

/**
 * Find the Claude config directory, handling WSL path differences.
 */
function findClaudeConfigDir(): string | null {
  const standardDir = path.join(os.homedir(), ".claude");
  if (fs.existsSync(standardDir)) return standardDir;

  if (isWSL()) {
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const wslPath = userProfile
        .replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`)
        .replace(/\\/g, "/");
      const wslClaudeDir = path.join(wslPath, ".claude");
      if (fs.existsSync(wslClaudeDir)) return wslClaudeDir;
    }

    const windowsUsersDir = "/mnt/c/Users";
    if (fs.existsSync(windowsUsersDir)) {
      try {
        const users = fs.readdirSync(windowsUsersDir);
        for (const user of users) {
          if (["Public", "Default", "Default User", "All Users"].includes(user)) continue;
          const claudeDir = path.join(windowsUsersDir, user, ".claude");
          if (fs.existsSync(claudeDir)) return claudeDir;
        }
      } catch {
        // Ignore
      }
    }
  }

  return null;
}

// ── Timestamp / Redaction (shared with spawner.ts) ─────

function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(:\/\/[^:/?***REMOVED***]+:)[^@]+(@)/g, "$1***$2"],
  [/\b(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]+/g, "$1***"],
  [/\bglpat-[A-Za-z0-9\-_]+/g, "glpat-***"],
  [/\b(AKIA)[A-Z0-9]{16}\b/g, "$1***"],
  [/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1***"],
  [/(x-api-key:\s*)[^\s,'"]+/gi, "$1***"],
];

function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ── Image Management ───────────────────────────────────

/**
 * Ensure the Docker image is available locally.
 * Pulls versioned tag first, falls back to :latest.
 */
export async function ensureImage(config: AgentConfig): Promise<string> {
  const imageTag = `${config.dockerImage}:latest`;

  // Check if image exists locally
  try {
    execFileSync(findDockerBin(), ["image", "inspect", imageTag], { stdio: "pipe", windowsHide: true });
    return imageTag;
  } catch {
    // Not found locally — pull it
  }

  console.log(`${ts()} ${chalk.dim(`Pulling Docker sandbox image ${imageTag}...`)}`);
  try {
    execFileSync(findDockerBin(), ["pull", imageTag], { stdio: "pipe", timeout: 300_000, windowsHide: true });
    return imageTag;
  } catch {
    throw new Error(
      `Failed to pull Docker sandbox image ${imageTag}.\n` +
        `Ensure Docker is running and you have access to the image registry.`,
    );
  }
}

// ── Helper: self-review label detection ────────────────

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

// ── Helper: OAuth detection ────────────────────────────

function hasOAuthCredentials(): boolean {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return fs.existsSync(path.join(home, ".claude", ".credentials.json"));
}

/**
 * Read the OAuth token from ~/.claude/.credentials.json.
 * Returns the token string or "" if not available.
 */
function readOAuthToken(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const credPath = path.join(home, ".claude", ".credentials.json");
  try {
    const data = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    // credentials.json has { claudeAiOauth: { token: "..." } } or { oauthToken: "..." }
    return data?.claudeAiOauth?.token || data?.oauthToken || "";
  } catch {
    return "";
  }
}

// ── Helper: SCM token ──────────────────────────────────

function getScmToken(
  scmProvider: string,
  config: AgentConfig,
  credentials?: ClaimCredentials,
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

// ── Helper: translate localhost API URL for Docker ─────

function translateApiUrl(apiUrl: string): string {
  if (!isDockerDesktop()) return apiUrl;
  // Replace localhost/127.0.0.1 with host.docker.internal for Docker Desktop
  return apiUrl
    .replace(/localhost/g, "host.docker.internal")
    .replace(/127\.0\.0\.1/g, "host.docker.internal");
}

// ── Core: Spawn Docker Worker ──────────────────────────

/**
 * Spawn a worker task inside a Docker container.
 */
export async function spawnDockerWorker(
  task: SpawnableTask,
  config: AgentConfig,
  orgConfig: Record<string, unknown>,
  credentials?: ClaimCredentials,
): Promise<void> {
  const taskLabel = chalk.cyan(task.id.slice(0, 12));

  if (activeProcesses.has(task.id)) {
    console.log(`${ts()} ${taskLabel} ${chalk.dim("Already running, skipping")}`);
    return;
  }

  // Pre-flight: verify Docker is running (retry once after 3s — daemon can be slow on Windows)
  const dockerBin = findDockerBin();
  let dockerOk = false;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      execFileSync(dockerBin, ["version"], { stdio: "pipe", timeout: 10_000, windowsHide: true });
      dockerOk = true;
      break;
    } catch (err: unknown) {
      lastErr = err;
      if (attempt === 0) {
        console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Docker pre-flight failed, retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  }
  if (!dockerOk) {
    const msg = lastErr instanceof Error ? (lastErr as Error).message : String(lastErr);
    const stderr = (lastErr as { stderr?: Buffer })?.stderr?.toString?.() || "";
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} Docker pre-flight failed (bin: ${dockerBin})`);
    console.error(`${ts()} ${taskLabel}   error: ${msg}`);
    if (stderr) console.error(`${ts()} ${taskLabel}   stderr: ${stderr.trim()}`);
    console.error(`${ts()} ${taskLabel}   PATH: ${process.env.PATH || "(empty)"}`);
    throw new Error(`Docker is not running or not accessible. Start Docker and try again. (${msg})`);
  }

  // Ensure image is available
  let imageTag: string;
  try {
    imageTag = await ensureImage(config);
  } catch (err) {
    console.error(`${ts()} ${taskLabel} ${chalk.red("✗")} ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  // Container naming
  const containerName = `wm-${task.id.slice(0, 12)}`;

  // Clean dead container with same name
  try {
    execFileSync(dockerBin, ["rm", "-f", containerName], { stdio: "pipe", windowsHide: true });
  } catch {
    // Container doesn't exist — fine
  }

  // Ensure Claude credentials are readable inside container
  const claudeConfigDir = findClaudeConfigDir();
  if (claudeConfigDir) {
    const credFile = path.join(claudeConfigDir, ".credentials.json");
    try {
      fs.chmodSync(credFile, 0o666);
    } catch {
      // File may not exist
    }
  }

  // Build docker args
  const dockerArgs: string[] = [
    "run",
    "--name", containerName,

    // Security hardening: resource limits and privilege restrictions
    "--memory", "8g",
    "--cpus", "2",
    "--pids-limit", "512",
    "--cap-drop", "ALL",
    "--cap-add", "NET_RAW",       // DNS resolution
    "--cap-add", "DAC_OVERRIDE",  // File permission overrides needed by sudo
    "--cap-add", "SETUID",        // Required by sudo to switch user ID
    "--cap-add", "SETGID",        // Required by sudo to switch group ID
    "--cap-add", "FOWNER",        // Required by sudo audit plugin
  ];

  // Network mode
  const dockerDesktop = isDockerDesktop();
  if (dockerDesktop) {
    const wslIP = getWSLHostIP();
    if (wslIP) {
      dockerArgs.push(`--add-host=host.docker.internal:${wslIP}`);
    } else {
      dockerArgs.push("--add-host=host.docker.internal:host-gateway");
    }
  } else {
    dockerArgs.push("--network", "host");
  }

  // Mount Claude credentials (read-only — token refreshed pre-spawn, lasts 8+ hours)
  if (claudeConfigDir) {
    const dockerClaudeDir = toDockerPath(claudeConfigDir);
    dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude:ro`);
  }

  // Tool cache volumes — persist installed tools across container runs.
  // install-tools.sh checks `command -v <tool>` before installing, so cached
  // tools in these volumes are found immediately and installation is skipped.
  const toolVolumes: Array<[string, string]> = [
    ["wm-tools-go", "/usr/local/go"],
    ["wm-tools-gomod", "/home/worker/go"],
    ["wm-tools-cargo", "/home/worker/.cargo"],
    ["wm-tools-rustup", "/home/worker/.rustup"],
    ["wm-tools-deno", "/home/worker/.deno"],
    ["wm-tools-bun", "/home/worker/.bun"],
  ];
  for (const [volumeName, containerPath] of toolVolumes) {
    dockerArgs.push("-v", `${volumeName}:${containerPath}`);
  }

  // Mount AWS credentials (read-only)
  const awsDir = path.join(os.homedir(), ".aws");
  if (fs.existsSync(awsDir)) {
    for (const file of ["credentials", "config"]) {
      const filePath = path.join(awsDir, file);
      try {
        if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o644);
      } catch {
        // Ignore
      }
    }
    const dockerAwsDir = toDockerPath(awsDir);
    dockerArgs.push("-v", `${dockerAwsDir}:/home/worker/.aws:ro`);
  }

  // Build environment variables — same set as native spawner
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

  const apiUrl = translateApiUrl(config.apiUrl);

  const envVars: Record<string, string> = {
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

    API_BASE_URL: apiUrl,
    ORG_API_KEY: config.apiKey,

    SCM_PROVIDER: scmProvider,
    SCM_TOKEN: scmToken,
    SCM_BASE_URL: credentials?.scmBaseUrl || "",
    GITHUB_TOKEN: githubToken,
    GH_TOKEN: githubToken,
    GITHUB_REVIEWER_TOKEN:
      credentials?.githubReviewerToken || config.githubReviewerToken || "",
    BITBUCKET_TOKEN: bitbucketToken,
    BITBUCKET_USERNAME: credentials?.bitbucketUsername || "x-token-auth",
    GITLAB_TOKEN: gitlabToken,

    TARGET_REPO: task.githubRepo || "",
    GITHUB_REPO: task.githubRepo || "",

    WORKER_MODEL:
      task.workerModel || String(orgConfig.defaultWorkerModel || ""),
    CLAUDE_MODEL:
      task.workerModel || String(orgConfig.defaultWorkerModel || ""),

    JIRA_BASE_URL: credentials?.jiraBaseUrl || "",
    JIRA_EMAIL: credentials?.jiraEmail || "",
    JIRA_API_TOKEN: credentials?.jiraApiToken || "",

    TICKET_SYSTEM: credentials?.issueTrackerProvider || "internal",
    LINEAR_API_KEY: credentials?.linearApiKey || "",

    AWS_ACCESS_KEY_ID: credentials?.customerAwsAccessKeyId || "",
    AWS_SECRET_ACCESS_KEY: credentials?.customerAwsSecretAccessKey || "",
    AWS_DEFAULT_REGION: credentials?.customerAwsRegion || "",
    AWS_REGION: credentials?.customerAwsRegion || "",
    CUSTOMER_AWS_ROLE_ARN: credentials?.customerAwsRoleArn || "",
    CUSTOMER_AWS_EXTERNAL_ID: credentials?.customerAwsExternalId || "",
    CUSTOMER_AWS_REGION: credentials?.customerAwsRegion || "",

    MANAGER_PROVIDER: credentials?.managerProvider || "anthropic",
    MANAGER_MODEL: credentials?.managerModelId || "",
    BITBUCKET_EMAIL: credentials?.bitbucketEmail || "",

    DEPLOYMENT_ENABLED:
      task.deploymentEnabled || task.parentTaskId ? "true" : "false",
    PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvementEnabled ? "true" : "false",
    QUALITY_GATE_BYPASS: task.qualityGateBypass ? "true" : "false",
    STANDARD_SDK_MODE: task.standardSdkMode ? "true" : "false",
    MAX_REVIEW_REVISIONS: String(orgConfig.maxReviewRevisions ?? 3),
    MAX_PER_STORY_REVISIONS: String(orgConfig.maxPerStoryRevisions ?? 2),
    CODEBASE_INDEXING_ENABLED:
      orgConfig.codebaseIndexingEnabled === true ? "true" : "false",

    EXISTING_PR_URL: task.githubPrUrl || "",
    EXISTING_PR_NUMBER: task.githubPrNumber
      ? String(task.githubPrNumber)
      : "",

    PARENT_TASK_ID: task.parentTaskId || task.id,
    PARENT_JIRA_KEY:
      task.jiraIssueKey && /-S\d+$/.test(task.jiraIssueKey)
        ? ((task.jiraFields?.parentJiraKey as string) || "")
        : "",
    TARGET_BRANCH: (task.jiraFields?.targetBranch as string) || "",
    STORY_BRANCH: (task.jiraFields?.storyBranch as string) || "",

    TASK_NOTES: task.taskNotes || "",

    TARGET_FILES: JSON.stringify(
      (task.jiraFields?.targetFiles as string[]) || [],
    ),
    REFERENCE_FILES: JSON.stringify(
      (task.jiraFields?.referenceFiles as string[]) || [],
    ),

    PIPELINE_VERSION:
      (task.jiraFields?.pipelineVersion as string) ||
      task.pipelineVersion ||
      "",
    V2_STEP_INPUT: task.jiraFields?.v2StepInput
      ? JSON.stringify(task.jiraFields.v2StepInput)
      : "",

    EXECUTION_MODE_SETTING:
      (task.jiraFields?.executionMode as string) || "autonomous",

    ANTHROPIC_API_KEY: hasOAuthCredentials()
      ? ""
      : credentials?.anthropicApiKey || "",
    CLAUDE_CODE_OAUTH_TOKEN: hasOAuthCredentials()
      ? readOAuthToken()
      : "",
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",
    GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || "",
    OLLAMA_HOST: credentials?.ollamaBaseUrl || "",
    OLLAMA_CONTEXT_WINDOW: credentials?.ollamaContextWindow
      ? String(credentials.ollamaContextWindow)
      : "",
    VLLM_BASE_URL: credentials?.vllmBaseUrl || "",

    BLOCKER_MAX_AUTO_RETRIES: String(orgConfig.blockerMaxAutoRetries ?? 3),
    BLOCKER_AUTO_RETRY_ENABLED:
      orgConfig.blockerAutoRetryEnabled !== false ? "true" : "false",
    PUSH_AFTER_COMMIT:
      orgConfig.pushAfterCommit !== false ? "true" : "false",
    GRACEFUL_SHUTDOWN_ENABLED:
      orgConfig.gracefulShutdownEnabled !== false ? "true" : "false",
    MAX_PARALLEL_EXPERTS: String(orgConfig.maxParallelExperts ?? 4),
    REVIEW_ENABLED:
      task.skipManagerReview === false ? "true" : "false",
    SELF_REVIEW_ENABLED:
      hasSelfReviewLabel(task) || (orgConfig.selfReviewEnabled !== false) ? "true" : "false",
  };

  // Add env vars as -e flags, filtering empty values
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") {
      dockerArgs.push("-e", `${k}=${v}`);
    }
  }

  // Image
  dockerArgs.push(imageTag);

  const reviewEnabled = task.skipManagerReview === false;
  console.log(
    `${ts()} ${taskLabel} ${chalk.blue("🐳")} Starting Docker worker`,
  );
  console.log(
    `${ts()} ${taskLabel} ${chalk.dim(`  image=${imageTag} review=${reviewEnabled} model=${task.workerModel} repo=${task.githubRepo}`)}`,
  );

  // Spawn container
  const dockerStdinFd = fs.openSync(os.devNull, "r");
  const proc = spawn(dockerBin, dockerArgs, {
    stdio: [dockerStdinFd, "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });
  fs.closeSync(dockerStdinFd);

  if (!proc.pid) {
    console.error(
      `${ts()} ${taskLabel} ${chalk.red("✗")} Failed to spawn Docker container`,
    );
    return;
  }

  const active: ActiveProcess = {
    taskId: task.id,
    process: proc,
    startedAt: new Date(),
    status: "running",
    resultEmitted: false,
    workDir: "", // No temp dir — container manages its own workspace
  };
  activeProcesses.set(task.id, active);

  // Notify local API clients
  agentEvents.emit("task:started", {
    id: task.id,
    parentTaskId: task.parentTaskId || task.id,
    summary: task.summary,
    description: task.description,
    persona: task.workerPersona,
    model: task.workerModel,
    repo: task.githubRepo,
  });

  // Stream stdout/stderr
  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.dim(redactSecrets(line))}`);
      agentEvents.emit("task:log", {
        id: task.id,
        line: redactSecrets(line),
        severity: "info",
      });
      if (line.includes("::result::")) {
        active.resultEmitted = true;
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      console.log(`${ts()} ${taskLabel} ${chalk.red(redactSecrets(line))}`);
      agentEvents.emit("task:log", {
        id: task.id,
        line: redactSecrets(line),
        severity: "error",
      });

      if (
        /rate.limit|429|too many requests|over_quota|overloaded|capacity/i.test(
          line,
        )
      ) {
        console.log(
          `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Rate limit detected`,
        );
        agentEvents.emit("task:rate_limited", { id: task.id });
      }
    }
  });

  // Handle exit
  proc.on("exit", (code) => {
    active.status = code === 0 ? "completed" : "failed";
    const duration = Math.round(
      (Date.now() - active.startedAt.getTime()) / 1000,
    );
    const icon = code === 0 ? chalk.green("✓") : chalk.red("✗");
    const status =
      code === 0
        ? chalk.green("completed")
        : chalk.red(`failed (exit ${code})`);
    console.log(
      `${ts()} ${taskLabel} ${chalk.blue("🐳")} ${icon} Worker ${status} ${chalk.dim(`(${duration}s)`)}`,
    );

    if (code === 0) {
      agentEvents.emit("task:completed", {
        id: task.id,
        exitCode: code,
        duration,
      });
    } else {
      agentEvents.emit("task:failed", {
        id: task.id,
        exitCode: code,
        duration,
      });
    }

    // Safety net: post fallback completion if no ::result:: marker
    if (!active.resultEmitted) {
      console.log(
        `${ts()} ${taskLabel} ${chalk.yellow("⚠")} No ::result:: marker — posting fallback completion in 15s`,
      );
      setTimeout(async () => {
        try {
          const fallbackResult = code === 0 ? "completed" : "failed";
          const errorMsg =
            code !== 0
              ? `Docker worker exited with code ${code} without reporting completion`
              : undefined;
          // Use original config.apiUrl (not translated) — this runs on the host, not inside the container
          const resp = await fetch(
            `${config.apiUrl}/api/tasks/${task.id}/worker-complete`,
            {
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
            },
          );
          const respData = (await resp.json()) as Record<string, unknown>;
          if (respData.status === "ignored") {
            console.log(
              `${ts()} ${taskLabel} ${chalk.dim("Fallback completion ignored (task already transitioned)")}`,
            );
          } else {
            console.log(
              `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Fallback completion applied: ${fallbackResult}`,
            );
          }
        } catch (err) {
          console.error(
            `${ts()} ${taskLabel} ${chalk.red("✗")} Fallback completion failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }, 15_000);
    }

    // Restore host credential file permissions (we set 0o666 pre-spawn)
    if (claudeConfigDir) {
      try {
        const credFile = path.join(claudeConfigDir, ".credentials.json");
        if (fs.existsSync(credFile)) fs.chmodSync(credFile, 0o600);
      } catch { /* best effort */ }
    }

    // Clean up container and process reference after delay
    setTimeout(() => {
      activeProcesses.delete(task.id);
      // Remove dead container
      try {
        execFileSync(findDockerBin(), ["rm", "-f", containerName], { stdio: "pipe", windowsHide: true });
      } catch {
        /* best effort cleanup */
      }
    }, 90_000);
  });

  proc.on("error", (err) => {
    active.status = "failed";
    console.error(
      `${ts()} ${taskLabel} ${chalk.red("✗")} Docker process error: ${err.message}`,
    );
  });
}

// ── Stop Functions ─────────────────────────────────────

/**
 * Stop a specific Docker worker container by task ID.
 */
export function stopDockerTask(taskId: string): boolean {
  const containerName = `wm-${taskId.slice(0, 8)}`;
  try {
    execFileSync(findDockerBin(), ["stop", containerName], {
      stdio: "pipe",
      timeout: 15_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop all Docker worker containers (wm-* prefix).
 */
export function stopAllDocker(): void {
  try {
    // On Windows, pipe commands don't work with execFileSync, so list then stop individually
    const docker = findDockerBin();
    const ids = execFileSync(docker, ["ps", "-q", "--filter", "name=wm-"], {
      encoding: "utf-8", stdio: "pipe", timeout: 10_000, windowsHide: true,
    }).trim();
    if (ids) {
      for (const id of ids.split("\n").filter(Boolean)) {
        try { execFileSync(docker, ["stop", id], { stdio: "pipe", timeout: 15_000, windowsHide: true }); } catch { /* best effort */ }
      }
    }
  } catch {
    // No containers to stop
  }
}
