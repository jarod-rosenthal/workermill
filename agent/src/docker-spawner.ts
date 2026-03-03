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
import { AGENT_VERSION, DOCKER_IMAGE_TAG } from "./version.js";
import { getGpuInfo } from "./gpu-detector.js";
import { getOllamaStatus } from "./ollama-manager.js";
import {
  getOrCreateWorkspace,
  releaseWorkspace,
  discoverRepoPath,
  hasClonedRepo,
  getDockerVolumeName,
  cleanupDockerVolume,
} from "./workspace-manager.js";
import { reportDiagnostic } from "./poller.js";

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
 * Detect if Docker Desktop is in use (Windows, WSL, or macOS).
 * Docker Desktop doesn't support --network host.
 */
function isDockerDesktop(): boolean {
  return process.platform === "win32" || isWSL() || process.platform === "darwin";
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

  // os.homedir() and process.env.HOME can differ — check both
  const envHome = process.env.HOME || process.env.USERPROFILE || "";
  if (envHome) {
    const envDir = path.join(envHome, ".claude");
    if (envDir !== standardDir && fs.existsSync(envDir)) return envDir;
  }

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

/** Track when we last pulled the image to avoid re-pulling on every spawn. */
let lastPullTimestamp = 0;
const PULL_INTERVAL_MS = 4 * 60 * 60 * 1000; // Re-pull every 4 hours

/**
 * Ensure the Docker image is available and up-to-date.
 * Image tag is pinned to the agent version at build time (e.g. :v0.10.117).
 * Falls back to :latest in dev mode.
 */
export async function ensureImage(config: AgentConfig): Promise<string> {
  const versionedTag = `${config.dockerImage}:${DOCKER_IMAGE_TAG}`;
  const latestTag = `${config.dockerImage}:latest`;
  const docker = findDockerBin();
  const hasLatestFallback = versionedTag !== latestTag;

  // Try versioned tag first, fall back to :latest if versioned isn't available
  const candidates = [versionedTag, ...(hasLatestFallback ? [latestTag] : [])];

  for (const imageTag of candidates) {
    const isVersioned = imageTag === versionedTag && hasLatestFallback;
    // Short timeout for versioned tag (fails fast if tag doesn't exist in registry),
    // long timeout for :latest (large image download can take a while)
    const pullTimeout = isVersioned ? 30_000 : 300_000;

    // Check if image exists locally
    let imageExists = false;
    try {
      execFileSync(docker, ["image", "inspect", imageTag], { stdio: "pipe", windowsHide: true });
      imageExists = true;
    } catch {
      // Not found locally
    }

    // Re-pull if image is missing OR if we haven't pulled recently (picks up :latest updates)
    const needsPull = !imageExists || (Date.now() - lastPullTimestamp > PULL_INTERVAL_MS);

    if (needsPull) {
      const reason = imageExists ? "checking for updates" : "not found locally";
      console.log(`${ts()} ${chalk.dim(`Pulling Docker sandbox image ${imageTag} (${reason})...`)}`);
      try {
        execFileSync(docker, ["pull", imageTag], { stdio: "pipe", timeout: pullTimeout, windowsHide: true });
        lastPullTimestamp = Date.now();
        logImageDigest(docker, imageTag);
        return imageTag;
      } catch {
        if (imageExists) {
          // Pull failed but we have a cached image — use it with a warning
          console.log(`${ts()} ${chalk.yellow("⚠")} Pull failed, using cached image`);
          logImageDigest(docker, imageTag);
          return imageTag;
        }
        // If versioned tag failed and we have a :latest fallback, try that next
        if (imageTag !== latestTag) {
          console.log(`${ts()} ${chalk.dim(`Versioned image ${imageTag} not available, trying :latest...`)}`);
          continue;
        }
        throw new Error(
          `Failed to pull Docker sandbox image ${imageTag}.\n` +
            `Ensure Docker is running and you have access to the image registry.`,
        );
      }
    }

    logImageDigest(docker, imageTag);
    return imageTag;
  }

  // Should not reach here, but satisfy TypeScript
  return versionedTag;
}

/**
 * Log the image digest and creation date so the user can verify which image is running.
 */
function logImageDigest(docker: string, imageTag: string): void {
  try {
    const info = execFileSync(
      docker,
      ["image", "inspect", imageTag, "--format", "{{.Id}} {{.Created}}"],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    ).trim();
    const [id, created] = info.split(" ", 2);
    const shortId = id?.replace("sha256:", "").slice(0, 12) || "unknown";
    const createdDate = created ? new Date(created).toISOString().replace("T", " ").slice(0, 19) : "unknown";
    console.log(`${ts()} ${chalk.green("✓")} Docker image: ${chalk.cyan(shortId)} (built ${createdDate})`);
  } catch {
    // Non-critical — just skip the log
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

/**
 * Find the credentials file, using the same search logic as findClaudeConfigDir().
 * Returns the absolute path to .credentials.json or null.
 */
function findCredentialsFile(): string | null {
  const configDir = findClaudeConfigDir();
  if (configDir) {
    const credFile = path.join(configDir, ".credentials.json");
    if (fs.existsSync(credFile)) return credFile;
  }
  return null;
}

function hasOAuthCredentials(): boolean {
  return findCredentialsFile() !== null;
}

/**
 * Read the OAuth token from ~/.claude/.credentials.json.
 * Returns the token string or "" if not available.
 *
 * Uses findClaudeConfigDir() to search multiple locations (WSL Windows paths, etc.)
 * so the token is found regardless of where Claude CLI stored it.
 *
 * Known credential file formats:
 *   { claudeAiOauth: { accessToken: "..." } }   — Claude CLI OAuth (primary)
 *   { oauthToken: "..." }                        — legacy format
 */
function readOAuthToken(): string {
  const credPath = findCredentialsFile();
  if (!credPath) {
    console.log(`${ts()} ${chalk.yellow("⚠")} No Claude credentials file found`);
    return "";
  }
  try {
    const raw = fs.readFileSync(credPath, "utf-8");
    const data = JSON.parse(raw);
    const token =
      data?.claudeAiOauth?.accessToken ||
      data?.claudeAiOauth?.token ||
      data?.oauthToken ||
      "";
    if (!token) {
      const keys = Object.keys(data || {});
      const oauthKeys = data?.claudeAiOauth ? Object.keys(data.claudeAiOauth) : [];
      console.log(
        `${ts()} ${chalk.yellow("⚠")} OAuth token not found in credentials file (${credPath}). ` +
        `Top-level keys: [${keys.join(", ")}], claudeAiOauth keys: [${oauthKeys.join(", ")}]`
      );
    }
    return token;
  } catch (err) {
    console.log(
      `${ts()} ${chalk.yellow("⚠")} Could not read OAuth credentials: ${err instanceof Error ? err.message : String(err)} (path: ${credPath})`,
    );
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
    reportDiagnostic("error", "docker", `Docker pre-flight failed: ${msg}`);
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
    console.log(`${ts()} ${taskLabel} ${chalk.dim(`Claude config dir: ${claudeConfigDir}`)}`);
    const credFile = path.join(claudeConfigDir, ".credentials.json");
    try {
      fs.chmodSync(credFile, 0o666);
    } catch {
      // File may not exist
    }
  } else {
    console.log(`${ts()} ${taskLabel} ${chalk.yellow("⚠")} Claude config dir not found — credentials will NOT be mounted into container`);
  }

  // Build docker args
  const dockerArgs: string[] = [
    "run",
    "--name", containerName,

    // Security hardening: resource limits and privilege restrictions
    "--memory", `${config.dockerMemoryGb}g`,
    "--memory-swap", `${config.dockerMemoryGb + 2}g`,
    "--cpus", "2",
    "--pids-limit", "512",
    "--cap-drop", "ALL",
    "--cap-add", "NET_RAW",       // DNS resolution
    "--cap-add", "DAC_OVERRIDE",  // File permission overrides needed by sudo
    "--cap-add", "SETUID",        // Required by sudo to switch user ID
    "--cap-add", "SETGID",        // Required by sudo to switch group ID
    "--cap-add", "FOWNER",        // Required by sudo audit plugin
  ];

  // GPU passthrough: add --gpus=all when NVIDIA is detected
  const gpuInfo = getGpuInfo();
  if (gpuInfo.available && gpuInfo.vendor === "nvidia") {
    dockerArgs.push("--gpus=all");
  }

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

  // Mount Claude credentials — read-write so Claude CLI can refresh expired OAuth tokens.
  // The credentials file contains a refresh token (long-lived) that Claude CLI exchanges
  // for a short-lived access token, writing the result back to the file.
  const oauthToken = readOAuthToken();
  if (claudeConfigDir) {
    const credFile = path.join(claudeConfigDir, ".credentials.json");
    const credExists = fs.existsSync(credFile);
    const dockerClaudeDir = toDockerPath(claudeConfigDir);
    dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude`);
    console.log(
      `${ts()} ${taskLabel} ${chalk.dim(`Credentials: mount=${dockerClaudeDir} file=${credExists ? "yes" : "MISSING"} oauth=${oauthToken ? "yes" : "no"}`)}`,
    );
  } else {
    console.log(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} No Claude config dir found — container needs ANTHROPIC_API_KEY`,
    );
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

  // Persistent workspace volume for batch board executions
  let persistentWorkspace = false;
  if (task.boardExecutionId) {
    const volumeName = getDockerVolumeName(task.boardExecutionId);
    dockerArgs.push("-v", `${volumeName}:/app/workspace`);
    persistentWorkspace = true;
    // Track workspace in the manager (for first-task discovery)
    getOrCreateWorkspace(task.boardExecutionId);
  }

  // Mount Ollama models cache (read-only) if local RAG is enabled
  let localOllamaHost = "";
  if (config.localRag) {
    const ollamaStatus = await getOllamaStatus(config.ollamaPort);
    if (ollamaStatus.running) {
      // Docker Desktop uses host.docker.internal; Linux --network host uses localhost
      localOllamaHost = dockerDesktop
        ? `http://host.docker.internal:${config.ollamaPort}`
        : `http://localhost:${config.ollamaPort}`;

      // Mount Ollama models directory so the container doesn't re-download
      const ollamaModelsDir = path.join(os.homedir(), ".ollama", "models");
      if (fs.existsSync(ollamaModelsDir)) {
        const dockerModelsDir = toDockerPath(ollamaModelsDir);
        dockerArgs.push("-v", `${dockerModelsDir}:/home/worker/.ollama/models:ro`);
      }
    }
  }

  // Mount Docker socket so workers can spin up sibling containers (DBs, etc.)
  // The sandbox still isolates the filesystem — only Docker API access is shared.
  //
  // Docker Desktop (Windows/macOS/WSL) handles socket path translation internally:
  // passing `-v /var/run/docker.sock:/var/run/docker.sock` works even though
  // that path doesn't exist on the host filesystem — Docker Desktop maps it to
  // its internal VM socket or named pipe (//./pipe/docker_engine on Windows).
  // We must NOT gate on fs.existsSync() for Docker Desktop platforms.
  if (dockerDesktop) {
    // Docker Desktop: always mount the standard path — Docker translates it
    const mountPath = "/var/run/docker.sock";
    console.log(chalk.dim(`  Docker socket: ${mountPath} (Docker Desktop — no host path check needed)`));
    dockerArgs.push("-v", `${mountPath}:${mountPath}`);
    // Docker Desktop socket is owned by root inside the container — add root group
    // so the non-root worker user can access it
    dockerArgs.push("--group-add", "0");
  } else {
    // Native Linux Docker: check actual socket paths on the host filesystem
    const dockerSocketCandidates = [
      "/var/run/docker.sock",
      path.join(os.homedir(), ".docker/run/docker.sock"),
    ];
    const dockerSocket = dockerSocketCandidates.find((s) => fs.existsSync(s));
    if (dockerSocket) {
      console.log(chalk.dim(`  Docker socket: ${dockerSocket}`));
      dockerArgs.push("-v", `${dockerSocket}:/var/run/docker.sock`);
      // Add the host's docker socket GID so the non-root worker user can access it
      try {
        const socketStat = fs.statSync(dockerSocket);
        dockerArgs.push("--group-add", String(socketStat.gid));
      } catch {
        // Socket exists but can't stat — proceed without group-add
      }
    } else {
      console.log(chalk.yellow("  ⚠ No Docker socket found — workers cannot run docker/docker-compose"));
    }
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

    MANAGER_PROVIDER: credentials?.managerProvider || "",
    MANAGER_MODEL: credentials?.managerModelId || "",
    BITBUCKET_EMAIL: credentials?.bitbucketEmail || "",

    DEPLOYMENT_ENABLED:
      task.deploymentEnabled || task.parentTaskId ? "true" : "false",
    PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvementEnabled ? "true" : "false",
    QUALITY_GATE_BYPASS: task.qualityGateBypass ? "true" : "false",
    QUALITY_GATE_COMMANDS: task.jiraFields?.qualityGates
      ? JSON.stringify(task.jiraFields.qualityGates)
      : "",
    CI_WORKFLOW_PATH: (task.jiraFields?.ciWorkflowPath as string) || "",
    STANDARD_SDK_MODE: task.standardSdkMode ? "true" : "false",
    MAX_REVIEW_REVISIONS: String(orgConfig.maxReviewRevisions),
    MAX_PER_STORY_REVISIONS: String(orgConfig.maxPerStoryRevisions),
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

    // Authentication: When the credentials file is mounted, don't pass
    // CLAUDE_CODE_OAUTH_TOKEN — let Claude CLI read the file directly so it
    // can refresh expired tokens mid-run. The env var is a static snapshot.
    ANTHROPIC_API_KEY: credentials?.anthropicApiKey || "",
    CLAUDE_CODE_OAUTH_TOKEN: claudeConfigDir ? "" : oauthToken,
    WORKER_PROVIDER: task.workerProvider || "anthropic",
    OPENAI_API_KEY: credentials?.openaiApiKey || "",
    GOOGLE_API_KEY: credentials?.googleApiKey || "",
    GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || "",
    OLLAMA_HOST: localOllamaHost || credentials?.ollamaBaseUrl || "",
    OLLAMA_CONTEXT_WINDOW: credentials?.ollamaContextWindow
      ? String(credentials.ollamaContextWindow)
      : "",
    VLLM_BASE_URL: credentials?.vllmBaseUrl || "",

    BLOCKER_MAX_AUTO_RETRIES: String(orgConfig.blockerMaxAutoRetries),
    BLOCKER_AUTO_RETRY_ENABLED:
      orgConfig.blockerAutoRetryEnabled !== false ? "true" : "false",
    QUALITY_GATE_MAX_RETRIES: String(orgConfig.qualityGateMaxRetries ?? 5),
    MAX_CI_FIX_RETRIES: String(orgConfig.maxCiFixRetries ?? 3),
    BLOCKER_WAIT_TIMEOUT_MINUTES: String(orgConfig.blockerWaitTimeoutMinutes ?? 20),
    PUSH_AFTER_COMMIT:
      orgConfig.pushAfterCommit !== false ? "true" : "false",
    GRACEFUL_SHUTDOWN_ENABLED:
      orgConfig.gracefulShutdownEnabled !== false ? "true" : "false",
    MAX_PARALLEL_EXPERTS: String(orgConfig.maxParallelExperts),
    REVIEW_ENABLED:
      task.skipManagerReview === false ? "true" : "false",
    SELF_REVIEW_ENABLED:
      hasSelfReviewLabel(task) || (orgConfig.selfReviewEnabled === true) ? "true" : "false",

    // Quality gate thresholds (from org settings via /api/agent/config)
    QUALITY_THRESHOLDS: orgConfig.qualityThresholds ? JSON.stringify(orgConfig.qualityThresholds) : "",

    // Persistent workspace for batch board executions
    ...(task.boardExecutionId ? { PERSISTENT_WORKSPACE: "/app/workspace" } : {}),
    ...(task.boardExecutionId && hasClonedRepo(task.boardExecutionId)
      ? { REPO_PATH: "/app/workspace/repo" }
      : {}),
  };

  // Write env vars to a temp file instead of passing as -e flags.
  // On Windows, the total command-line length is capped at 32,767 chars.
  // Long task descriptions + JSON fields easily exceed this, causing ENAMETOOLONG.
  const envFileDir = path.join(os.tmpdir(), "workermill-docker");
  fs.mkdirSync(envFileDir, { recursive: true });
  const envFilePath = path.join(envFileDir, `${containerName}.env`);
  const envFileLines: string[] = [];
  for (const [k, v] of Object.entries(envVars)) {
    if (v !== "") {
      // Docker --env-file format: KEY=VALUE (no quoting needed, one per line)
      // Newlines in values would break the format, so replace with spaces
      envFileLines.push(`${k}=${v.replace(/\n/g, " ")}`);
    }
  }
  fs.writeFileSync(envFilePath, envFileLines.join("\n"), { mode: 0o600 });

  // Use --env-file for Docker Desktop (Windows/WSL/macOS) where command-line limits apply.
  // On Linux with --network host, -e flags are fine but --env-file works everywhere.
  dockerArgs.push("--env-file", envFilePath);

  // Image
  dockerArgs.push(imageTag);

  // Snapshot container IDs before spawn for cleanup (detect worker-spawned containers)
  let preSpawnContainerIds = new Set<string>();
  try {
    const ids = execFileSync(dockerBin, ["ps", "-a", "-q"], {
      encoding: "utf-8", stdio: "pipe", timeout: 10_000, windowsHide: true,
    }).trim();
    preSpawnContainerIds = new Set(ids ? ids.split("\n").filter(Boolean) : []);
  } catch { /* non-critical */ }

  const reviewEnabled = task.skipManagerReview === false;
  console.log(
    `${ts()} ${taskLabel} ${chalk.blue("🐳")} Starting Docker worker`,
  );
  console.log(
    `${ts()} ${taskLabel} ${chalk.dim(`  image=${imageTag} review=${reviewEnabled} model=${task.workerModel} repo=${task.githubRepo}`)}`,
  );
  // Log credential path for debugging auth failures
  const hasOAuth = !!envVars.CLAUDE_CODE_OAUTH_TOKEN;
  const hasApiKey = !!envVars.ANTHROPIC_API_KEY;
  const hasMountedCreds = !!claudeConfigDir;
  console.log(
    `${ts()} ${taskLabel} ${chalk.dim(`  auth: oauth=${hasOAuth} apiKey=${hasApiKey} mount=${hasMountedCreds}${hasMountedCreds ? ` (${claudeConfigDir})` : ""}`)}`,
  );
  if (!hasOAuth && !hasApiKey && !hasMountedCreds) {
    console.error(
      `${ts()} ${taskLabel} ${chalk.red("✗")} No credentials will reach worker! ` +
      `OAuth token extraction failed, no API key, and no config dir to mount. ` +
      `Checked: os.homedir()=${os.homedir()}, HOME=${process.env.HOME || "(unset)"}, ` +
      `hasOAuthFile=${hasOAuthCredentials()}`,
    );
  }

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
        /rate.limit|429|too many requests|over_quota/i.test(
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

    // Clean up env file immediately (no longer needed after container starts)
    try {
      fs.unlinkSync(envFilePath);
    } catch {
      /* best effort */
    }

    // Clean up container and process reference after delay
    setTimeout(() => {
      activeProcesses.delete(task.id);
      const docker = findDockerBin();

      // Clean up sibling containers spawned by the worker (DBs, docker compose, etc.)
      try {
        const currentIds = execFileSync(docker, ["ps", "-a", "-q"], {
          encoding: "utf-8", stdio: "pipe", timeout: 10_000, windowsHide: true,
        }).trim();
        if (currentIds) {
          const newIds = currentIds.split("\n").filter((id) => id && !preSpawnContainerIds.has(id));
          for (const id of newIds) {
            // Skip our own worker containers (wm-* prefix)
            try {
              const name = execFileSync(docker, ["inspect", "--format", "{{.Name}}", id], {
                encoding: "utf-8", stdio: "pipe", timeout: 5_000, windowsHide: true,
              }).trim();
              if (name.startsWith("/wm-")) continue;
            } catch { continue; }
            try {
              execFileSync(docker, ["rm", "-f", id], { stdio: "pipe", timeout: 15_000, windowsHide: true });
            } catch { /* best effort */ }
          }
          if (newIds.length > 0) {
            console.log(`${ts()} ${taskLabel} ${chalk.dim(`Cleaned up ${newIds.length} worker-spawned container(s)`)}`);
          }
        }
      } catch { /* non-critical */ }

      // Clean up dangling networks left by docker compose
      try {
        execFileSync(docker, ["network", "prune", "-f"], { stdio: "pipe", timeout: 10_000, windowsHide: true });
      } catch { /* best effort */ }

      // Remove dead worker container
      try {
        execFileSync(docker, ["rm", "-f", containerName], { stdio: "pipe", windowsHide: true });
      } catch {
        /* best effort cleanup */
      }
      // Manage persistent workspace lifecycle
      if (persistentWorkspace && task.boardExecutionId) {
        discoverRepoPath(task.boardExecutionId);
        releaseWorkspace(task.boardExecutionId);
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
