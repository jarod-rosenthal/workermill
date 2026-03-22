/**
 * Local Epic Spawner
 *
 * Spawns Epic Coordinator as a local Node.js process instead of an ECS task.
 * Used for local development with Claude Max subscription (OAuth authentication).
 *
 * This replaces the ECS task spawning for EXECUTION_MODE=local.
 */

import { spawn, ChildProcess, execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import axios from "axios";
import { WorkerTask } from "../models/WorkerTask.js";
import { worktreeManager } from "./worktree-manager.js";
import { logger } from "../utils/logger.js";
import { ensureValidOAuthToken } from "./llm-backend.js";

/** Check if a task has the self-review label (works across Jira, GitHub, GitLab, Linear) */
function hasSelfReviewLabel(task: WorkerTask): boolean {
  const fields = task.jiraFields as Record<string, unknown> | undefined;
  if (!fields) return false;
  // Jira: labels is a string array at top level
  const jiraLabels = fields.labels;
  if (Array.isArray(jiraLabels) && jiraLabels.some((l: unknown) => typeof l === "string" && l.toLowerCase() === "self-review")) return true;
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

interface LocalEpicProcess {
  taskId: string;
  process: ChildProcess;
  containerName: string;
  worktreePath: string | null;
  startedAt: Date;
  status: "running" | "completed" | "failed";
}

class LocalEpicSpawner {
  private activeProcesses: Map<string, LocalEpicProcess> = new Map();
  private maxConcurrent: number;
  private apiBaseUrl: string;
  private isWSL: boolean;
  private isDockerDesktop: boolean;

  constructor() {
    this.maxConcurrent = parseInt(process.env.MAX_LOCAL_WORKERS || "4", 10);

    // Detect WSL environment
    this.isWSL = this.detectWSL();

    // Docker Desktop detection — used for API URL translation and --add-host
    this.isDockerDesktop = this.isWSL || process.platform === "darwin";

    // Set API URL based on Docker networking mode
    const port = process.env.PORT || 3001;
    this.apiBaseUrl = this.isDockerDesktop
      ? `http://host.docker.internal:${port}`
      : `http://localhost:${port}`;
  }

  /**
   * Detect if running in WSL (Windows Subsystem for Linux).
   */
  private detectWSL(): boolean {
    // Check WSL-specific environment variables
    if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
      return true;
    }

    // Check /proc/version for Microsoft
    try {
      const procVersion = fs.readFileSync("/proc/version", "utf-8");
      return procVersion.toLowerCase().includes("microsoft");
    } catch {
      return false;
    }
  }

  /**
   * Get WSL2 IP address for Docker container → host communication.
   * Docker Desktop's host-gateway resolves to the Docker VM, not WSL2.
   */
  private getWSLHostIP(): string | null {
    if (!this.isWSL) return null;
    try {
      const ip = execSync("hostname -I", { encoding: "utf-8" }).trim().split(/\s+/)[0];
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
   * Docker Desktop on Windows requires Windows-style paths for volume mounts.
   */
  private toDockerPath(unixPath: string): string {
    if (!this.isWSL) {
      return unixPath;
    }

    // Convert /mnt/c/path/to/file → C:/path/to/file
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
  private findClaudeConfigDir(): string | null {
    // First try the standard location
    const standardDir = path.join(os.homedir(), ".claude");
    if (fs.existsSync(standardDir)) {
      return standardDir;
    }

    // On WSL, os.homedir() might return /home/username instead of /mnt/c/Users/username
    if (this.isWSL) {
      // Try common WSL paths to Windows user home
      const userProfile = process.env.USERPROFILE;
      if (userProfile) {
        // USERPROFILE might be in Windows format (C:\Users\...) - convert to WSL path
        const wslPath = userProfile.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replace(/\\/g, "/");
        const wslClaudeDir = path.join(wslPath, ".claude");
        if (fs.existsSync(wslClaudeDir)) {
          return wslClaudeDir;
        }
      }

      // Try to find Windows home from /mnt/c/Users
      const windowsUsersDir = "/mnt/c/Users";
      if (fs.existsSync(windowsUsersDir)) {
        try {
          const users = fs.readdirSync(windowsUsersDir);
          for (const user of users) {
            if (user === "Public" || user === "Default" || user === "Default User" || user === "All Users") {
              continue;
            }
            const claudeDir = path.join(windowsUsersDir, user, ".claude");
            if (fs.existsSync(claudeDir)) {
              return claudeDir;
            }
          }
        } catch {
          // Ignore errors reading directory
        }
      }
    }

    return null;
  }

  /**
   * Check if we're in local execution mode.
   */
  isLocalMode(): boolean {
    return process.env.EXECUTION_MODE === "local";
  }

  /**
   * Spawn an Epic Coordinator for a task.
   * @param credentials Optional credentials from Secrets Manager (takes priority over .env.local)
   */
  async spawnEpicCoordinator(
    task: WorkerTask,
    credentials?: {
      githubToken?: string;
      githubReviewerToken?: string;
      scmToken?: string | null;
      bitbucketUsername?: string;
      bitbucketEmail?: string;
      jiraBaseUrl?: string;
      jiraEmail?: string;
      jiraApiToken?: string;
      managerProvider?: string;
      managerModelId?: string;
      linearApiKey?: string;
      customerAwsAccessKeyId?: string;
      customerAwsSecretAccessKey?: string;
      customerAwsRegion?: string;
      // AI provider API keys for multi-provider execution
      anthropicApiKey?: string;
      openaiApiKey?: string;
      googleApiKey?: string;
      ollamaBaseUrl?: string;
    },
  ): Promise<void> {
    if (!this.isLocalMode()) {
      throw new Error("LocalEpicSpawner can only be used in local execution mode");
    }

    if (this.activeProcesses.size >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent local workers (${this.maxConcurrent}) reached. ` +
        `Active: ${this.activeProcesses.size}`
      );
    }

    if (this.activeProcesses.has(task.id)) {
      // Task is already running - this is a duplicate spawn attempt, just log and return silently
      // This can happen due to race conditions in the orchestrator polling or retry logic
      logger.info("Task already running, skipping duplicate spawn", {
        taskId: task.id,
        summary: task.summary,
      });
      return;
    }

    // Ensure organization relation is loaded (queued task query doesn't join it)
    if (!task.organization) {
      const { AppDataSource } = await import("../db/connection.js");
      const org = await AppDataSource.getRepository("Organization").findOne({ where: { id: task.orgId } });
      if (org) {
        task.organization = org as WorkerTask["organization"];
      }
    }

    logger.info("Spawning local Epic Coordinator", {
      taskId: task.id,
      summary: task.summary,
    });

    // Acquire worktree for the coordinator (mounted into container)
    let worktreePath: string | null = null;
    try {
      if (process.env.TARGET_REPO_PATH) {
        worktreePath = await worktreeManager.acquireWorktree(task.id, "coordinator");
      }
    } catch (e) {
      logger.warn("Could not acquire worktree, container will clone repo", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Container name for tracking and stopping
    const containerName = `workermill-${task.id.slice(0, 8)}`;

    // Remove any existing dead container with the same name (from previous failed runs)
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
    } catch {
      // Ignore - container doesn't exist, which is fine
    }

    // Check if Docker is available
    try {
      execSync("docker version", { stdio: "ignore" });
    } catch {
      throw new Error(
        "Docker is not available. Please install Docker and ensure it's running.\n" +
        "Also verify the worker image exists: docker images workermill-worker:local"
      );
    }

    // Check if worker image exists
    try {
      execSync("docker image inspect workermill-worker:local", { stdio: "ignore" });
    } catch {
      throw new Error(
        "Worker image 'workermill-worker:local' not found.\n" +
        "Build it with: ./bin/local-workermill build-worker"
      );
    }

    // Validate SCM credentials before spawning (Secrets Manager credentials > .env.local)
    const scmProvider = task.organization?.scmProvider || "github";
    const scmTokenFromEnv = this.getScmToken(task);
    const scmTokenFromCreds = credentials?.scmToken || (scmProvider === "github" ? credentials?.githubToken : null);
    if (!scmTokenFromEnv && !scmTokenFromCreds) {
      const tokenEnvVar = scmProvider === "bitbucket" ? "BITBUCKET_TOKEN" :
                          scmProvider === "gitlab" ? "GITLAB_TOKEN" : "GITHUB_TOKEN";
      throw new Error(
        `No SCM token configured for provider '${scmProvider}'.\n` +
        `Set ${tokenEnvVar} in .env.local or configure in Settings > Integrations to clone ${task.githubRepo || "the target repository"}.`
      );
    }
    logger.info("SCM credentials validated", {
      taskId: task.id,
      scmProvider,
      targetRepo: task.githubRepo,
      tokenSource: scmTokenFromCreds ? "secrets-manager" : "env",
    });

    // Pre-spawn OAuth refresh: ensure the credentials file has a fresh access token.
    // Access tokens last ~8 hours. Tasks run < 1 hour. By refreshing here (and ONLY here),
    // the container's access token never expires mid-run, so Claude CLI never needs to use
    // the refresh token. This eliminates the race condition where multiple consumers
    // (orchestrator, planner, containers) compete over a single-use refresh token.
    try {
      const tokenValid = await ensureValidOAuthToken();
      if (!tokenValid) {
        logger.warn("OAuth token refresh failed pre-spawn — container may fail auth", {
          taskId: task.id,
        });
      }
    } catch (err) {
      logger.warn("OAuth token check failed pre-spawn", {
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Build Docker run arguments
    // Note: We don't use --rm so we can inspect logs after container exits
    const dockerArgs = [
      "run",
      "--name", containerName,

      // Security hardening: resource limits and privilege restrictions
      "--memory", "4g",
      "--memory-swap", "6g",
      "--cpus", "2",
      "--pids-limit", "512",
      "--cap-drop", "ALL",
      "--cap-add", "NET_RAW",       // DNS resolution
      "--cap-add", "DAC_OVERRIDE",  // File permission overrides needed by sudo for Kaniko
    ];

    // Only use --user when mounting external worktree (to match host file ownership)
    // When no worktree, let container run as default 'worker' user who owns /workspace
    if (worktreePath) {
      const currentUid = process.getuid?.() || 1000;
      const currentGid = process.getgid?.() || 1000;
      dockerArgs.push("--user", `${currentUid}:${currentGid}`);
    }

    // Network mode — always use host networking so docker compose services
    // (e.g. Postgres) are reachable at localhost from the worker process.
    // Docker Desktop 4.29+ (Windows/WSL2) and 4.34+ (macOS) support --network host.
    dockerArgs.push("--network", "host");
    if (this.isDockerDesktop) {
      // Add host.docker.internal for backward compat (API URL translation uses it)
      const wslIP = this.getWSLHostIP();
      if (wslIP) {
        dockerArgs.push(`--add-host=host.docker.internal:${wslIP}`);
      } else {
        dockerArgs.push("--add-host=host.docker.internal:host-gateway");
      }
      logger.info("Using Docker Desktop with host networking", {
        isWSL: this.isWSL,
        wslIP: wslIP || "host-gateway",
        apiBaseUrl: this.apiBaseUrl,
      });
    }

    // Mount worktree (convert path for Docker on WSL)
    if (worktreePath) {
      const dockerWorktreePath = this.toDockerPath(worktreePath);
      dockerArgs.push("-v", `${dockerWorktreePath}:/workspace`);
    }

    // Mount Claude credentials for OAuth authentication
    // Claude CLI inside the container manages its own token refresh via this file.
    // We do NOT pass CLAUDE_CODE_OAUTH_TOKEN as an env var because that bypasses
    // CLI's built-in refresh logic, causing 401 errors when tokens expire mid-run.
    const claudeConfigDir = this.findClaudeConfigDir();
    if (claudeConfigDir) {
      // Ensure credentials file is readable AND writable inside container.
      // Claude CLI creates .credentials.json with 600 permissions, but the container
      // runs as a different UID (worker:1001) than the host user (1000), so the
      // mounted file is unreadable/unwritable. Use 666 so the container's Claude CLI
      // can write refreshed tokens back to the host file when tokens expire mid-run.
      const credFile = path.join(claudeConfigDir, ".credentials.json");
      try {
        fs.chmodSync(credFile, 0o666);
      } catch {
        // Ignore - file may not exist yet
      }

      const dockerClaudeDir = this.toDockerPath(claudeConfigDir);
      dockerArgs.push("-v", `${dockerClaudeDir}:/home/worker/.claude:ro`);
      logger.info("Mounting Claude credentials for in-container auth (read-only)", {
        hostPath: claudeConfigDir,
        dockerPath: dockerClaudeDir,
      });
    } else {
      throw new Error(
        "Claude credentials not found for local execution.\n" +
        "Run 'claude auth login' to authenticate, then restart the API.\n" +
        "Expected credentials at ~/.claude/.credentials.json"
      );
    }

    // Mount AWS credentials for workers that need to deploy infrastructure
    // (terraform apply, aws cli commands, etc.)
    // Same chmod pattern as Claude credentials — container runs as UID 1001 (worker)
    // but host files are owned by UID 1000 with 600 permissions.
    const awsDir = path.join(os.homedir(), ".aws");
    if (fs.existsSync(awsDir)) {
      for (const file of ["credentials", "config"]) {
        const filePath = path.join(awsDir, file);
        try {
          if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o644);
        } catch {
          // Ignore - file may not exist
        }
      }
      const dockerAwsDir = this.toDockerPath(awsDir);
      dockerArgs.push("-v", `${dockerAwsDir}:/home/worker/.aws:ro`);
      logger.info("Mounting AWS credentials for infrastructure deployment", {
        hostPath: awsDir,
        dockerPath: dockerAwsDir,
      });
    }

    // Mount Docker socket so workers can spin up sibling containers (DBs, caches, etc.)
    // The sandbox still isolates the filesystem — only Docker API access is shared.
    const dockerSocketCandidates = [
      "/var/run/docker.sock",
      "/mnt/wsl/docker-desktop/shared-sockets/guest-services/docker.sock",
      path.join(os.homedir(), ".docker/run/docker.sock"),
    ];
    const dockerSocket = dockerSocketCandidates.find((s) => fs.existsSync(s));
    if (dockerSocket) {
      const dockerSocketPath = this.toDockerPath(dockerSocket);
      dockerArgs.push("-v", `${dockerSocketPath}:/var/run/docker.sock`);
      // Add the host's docker socket GID so the non-root worker user can access it
      try {
        const socketStat = fs.statSync(dockerSocket);
        dockerArgs.push("--group-add", String(socketStat.gid));
      } catch {
        // Socket exists but can't stat — proceed without group-add
      }
      logger.info("Mounting Docker socket for sibling container access", {
        hostPath: dockerSocket,
      });
    } else {
      logger.warn("No Docker socket found — workers cannot run docker/docker-compose");
    }

    // Add environment variables
    const envArgs = this.buildEnvArgs(task, credentials);

    // Pre-flight validation: ensure critical env vars are set before spawning a doomed container
    const envMap = new Map<string, string>();
    for (let i = 0; i < envArgs.length - 1; i += 2) {
      if (envArgs[i] === "-e") {
        const [key, ...rest] = envArgs[i + 1].split("=");
        envMap.set(key, rest.join("="));
      }
    }
    const requiredVars = ["TARGET_REPO", "API_BASE_URL", "ORG_API_KEY"];
    const envScmProvider = envMap.get("SCM_PROVIDER") || "github";
    // SCM_TOKEN is required for all providers to clone/push
    requiredVars.push("SCM_TOKEN");
    const missingVars = requiredVars.filter(
      (v) => !envMap.get(v) || envMap.get(v) === "",
    );
    if (missingVars.length > 0) {
      const msg = `Pre-flight validation failed: missing required env vars: ${missingVars.join(", ")}. SCM provider: ${envScmProvider}`;
      logger.error(msg, { taskId: task.id, missingVars, scmProvider: envScmProvider });
      throw new Error(msg);
    }

    logger.info("Container environment configured", {
      taskId: task.id,
      credentialsMounted: !!claudeConfigDir,
      awsMounted: fs.existsSync(awsDir),
      envArgCount: envArgs.length,
    });
    dockerArgs.push(...envArgs);

    // Add image name
    dockerArgs.push("workermill-worker:local");

    logger.info("Starting Epic Coordinator container", {
      taskId: task.id,
      containerName,
      worktreePath,
      isWSL: this.isWSL,
      isDockerDesktop: this.isDockerDesktop,
      dockerArgs: dockerArgs.slice(0, 15), // Log first 15 args for debugging
    });

    // Spawn Docker container
    const proc = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!proc.pid) {
      throw new Error("Failed to spawn Docker container process");
    }

    // Track the process
    const epicProcess: LocalEpicProcess = {
      taskId: task.id,
      process: proc,
      containerName,
      worktreePath,
      startedAt: new Date(),
      status: "running",
    };
    this.activeProcesses.set(task.id, epicProcess);

    // Stream output to API logs
    this.streamLogsToApi(proc, task.id);

    // Handle process exit
    proc.on("exit", (code) => this.handleExit(task.id, code));
    proc.on("error", (err) => this.handleError(task.id, err));

    logger.info("Epic Coordinator container spawned", {
      taskId: task.id,
      pid: proc.pid,
      containerName,
      worktreePath,
    });
  }

  /**
   * Stream process output to the WorkerMill API logs endpoint.
   */
  private streamLogsToApi(proc: ChildProcess, taskId: string): void {
    const postLog = async (content: string): Promise<void> => {
      try {
        await axios.post(
          `${this.apiBaseUrl}/api/tasks/${taskId}/logs`,
          { content },
          {
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": "local-dev",
            },
            timeout: 5000,
          }
        );
      } catch {
        // Ignore log posting errors - don't want to spam logs about log failures
      }
    };

    // Buffer for accumulating output
    let stdoutBuffer = "";
    let stderrBuffer = "";
    const flushInterval = 500; // ms

    // Flush buffers periodically
    const flushBuffers = (): void => {
      if (stdoutBuffer) {
        console.log(`[Epic ${taskId.slice(0, 8)}]`, stdoutBuffer.trim());
        postLog(stdoutBuffer);
        stdoutBuffer = "";
      }
      if (stderrBuffer) {
        console.error(`[Epic ${taskId.slice(0, 8)}] ERROR:`, stderrBuffer.trim());
        postLog(`[ERROR] ${stderrBuffer}`);
        stderrBuffer = "";
      }
    };

    const flushTimer = setInterval(flushBuffers, flushInterval);

    proc.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderrBuffer += data.toString();
    });

    proc.on("exit", () => {
      clearInterval(flushTimer);
      flushBuffers(); // Final flush
    });
  }

  /**
   * Handle process exit.
   */
  private async handleExit(taskId: string, code: number | null): Promise<void> {
    const epicProcess = this.activeProcesses.get(taskId);
    if (!epicProcess) return;

    logger.info("Epic Coordinator exited", {
      taskId,
      code,
      duration: Date.now() - epicProcess.startedAt.getTime(),
    });

    // Update status
    epicProcess.status = code === 0 ? "completed" : "failed";

    // Restore credential file permissions to 0o600 after container exits
    // (we set 0o666 pre-spawn so the container could read it)
    try {
      const claudeDir = this.findClaudeConfigDir();
      if (claudeDir) {
        const credFile = path.join(claudeDir, ".credentials.json");
        if (fs.existsSync(credFile)) fs.chmodSync(credFile, 0o600);
      }
    } catch { /* best effort */ }

    // Release worktree
    if (epicProcess.worktreePath) {
      try {
        await worktreeManager.releaseWorktree(epicProcess.worktreePath);
      } catch (e) {
        logger.warn("Failed to release worktree", {
          taskId,
          path: epicProcess.worktreePath,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Keep process info for a while for status queries
    setTimeout(() => {
      this.activeProcesses.delete(taskId);
    }, 60000); // Remove after 1 minute
  }

  /**
   * Handle process error.
   */
  private handleError(taskId: string, error: Error): void {
    logger.error("Epic Coordinator process error", {
      taskId,
      error: error.message,
    });

    const epicProcess = this.activeProcesses.get(taskId);
    if (epicProcess) {
      epicProcess.status = "failed";
    }
  }

  /**
   * Get the target repository for a task.
   * Local mode uses the SAME GitHub/GitLab/Bitbucket repos as cloud mode.
   * The only difference is the worker runs locally instead of in ECS.
   */
  private getTargetRepo(task: WorkerTask): string {
    // Check task-specific repo (set from ticket or labels)
    if (task.githubRepo) {
      return task.githubRepo;
    }

    // Check organization settings
    const org = task.organization;
    if (org) {
      if (org.scmProvider === "github" && org.defaultGithubRepo) {
        return org.defaultGithubRepo;
      }
      if (org.scmProvider === "bitbucket" && org.defaultBitbucketRepo) {
        return org.defaultBitbucketRepo;
      }
      if (org.scmProvider === "gitlab" && org.defaultGitlabRepo) {
        return org.defaultGitlabRepo;
      }
    }

    // Fall back - should not happen if org is configured correctly
    logger.warn("No target repo configured for task", { taskId: task.id });
    return "";
  }

  /**
   * Get the SCM token for a task based on the organization's SCM provider.
   */
  private getScmToken(task: WorkerTask): string {
    const org = task.organization;
    const provider = org?.scmProvider || "github";

    switch (provider) {
      case "bitbucket":
        return process.env.BITBUCKET_TOKEN || "";
      case "gitlab":
        return process.env.GITLAB_TOKEN || "";
      case "github":
      default:
        return process.env.GITHUB_TOKEN || "";
    }
  }

  /**
   * Build Docker -e environment variable arguments for the container.
   * Credentials from Secrets Manager take priority over .env.local values.
   */
  private buildEnvArgs(
    task: WorkerTask,
    credentials?: {
      githubToken?: string;
      githubReviewerToken?: string;
      scmToken?: string | null;
      bitbucketUsername?: string;
      bitbucketEmail?: string;
      jiraBaseUrl?: string;
      jiraEmail?: string;
      jiraApiToken?: string;
      managerProvider?: string;
      managerModelId?: string;
      linearApiKey?: string;
      customerAwsAccessKeyId?: string;
      customerAwsSecretAccessKey?: string;
      customerAwsRegion?: string;
      // AI provider API keys for multi-provider execution
      anthropicApiKey?: string;
      openaiApiKey?: string;
      googleApiKey?: string;
      ollamaBaseUrl?: string;
    },
  ): string[] {
    // Resolve tokens: Secrets Manager credentials > .env.local
    const scmProvider = task.organization?.scmProvider || "github";
    const githubToken = credentials?.githubToken || process.env.GITHUB_TOKEN || "";
    const scmToken = credentials?.scmToken || this.getScmToken(task);
    const bitbucketToken = (scmProvider === "bitbucket" && credentials?.scmToken) || process.env.BITBUCKET_TOKEN || "";
    const bitbucketUsername = "x-bitbucket-api-token-auth";
    const bitbucketEmail = credentials?.bitbucketEmail || process.env.BITBUCKET_EMAIL || "";

    const vars: Record<string, string> = {
      // Epic mode flag for container entrypoint
      EPIC_MODE: "true",
      EXECUTION_MODE: "local",

      // Task context
      TASK_ID: task.id,
      PARENT_TASK_ID: task.id,
      JIRA_ISSUE_KEY: task.jiraIssueKey || "",
      TASK_SUMMARY: task.summary || "",
      TASK_DESCRIPTION: task.description || "",

      // API configuration - uses host.docker.internal on Docker Desktop (WSL/macOS),
      // localhost on native Linux with --network host
      API_BASE_URL: this.apiBaseUrl,
      ORG_API_KEY: process.env.ORG_API_KEY || process.env.PLATFORM_API_KEY || "local-dev",

      // SCM provider configuration
      SCM_PROVIDER: scmProvider,
      SCM_BASE_URL: task.organization?.scmBaseUrl || "",
      SCM_TOKEN: scmToken,

      // Git tokens (Secrets Manager > .env.local)
      GITHUB_TOKEN: githubToken,
      GH_TOKEN: githubToken,
      GITHUB_REVIEWER_TOKEN: credentials?.githubReviewerToken || process.env.GITHUB_REVIEWER_TOKEN || "",
      BITBUCKET_TOKEN: bitbucketToken,
      BITBUCKET_USERNAME: bitbucketUsername,
      BITBUCKET_EMAIL: bitbucketEmail,
      GITLAB_TOKEN: process.env.GITLAB_TOKEN || "",

      // Target repository
      TARGET_REPO: this.getTargetRepo(task),
      GITHUB_REPO: this.getTargetRepo(task),

      // Jira credentials for ticket updates
      JIRA_BASE_URL: credentials?.jiraBaseUrl || process.env.JIRA_BASE_URL || "",
      JIRA_EMAIL: credentials?.jiraEmail || process.env.JIRA_EMAIL || "",
      JIRA_API_TOKEN: credentials?.jiraApiToken || process.env.JIRA_API_TOKEN || "",

      // Issue tracker system (jira, linear, github-issues)
      TICKET_SYSTEM: task.organization?.issueTrackerProvider === "github-issues" ? "github" : (task.organization?.issueTrackerProvider || "internal"),
      LINEAR_API_KEY: credentials?.linearApiKey || process.env.LINEAR_API_KEY || "",

      // AWS credentials (for workers that need to deploy infrastructure)
      AWS_ACCESS_KEY_ID: credentials?.customerAwsAccessKeyId || process.env.AWS_ACCESS_KEY_ID || "",
      AWS_SECRET_ACCESS_KEY: credentials?.customerAwsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "",
      AWS_DEFAULT_REGION: credentials?.customerAwsRegion || process.env.AWS_DEFAULT_REGION || "",
      AWS_REGION: credentials?.customerAwsRegion || process.env.AWS_REGION || "",

      // Review and deployment settings (match ECS spawner logic)
      MAX_REVIEW_REVISIONS: String(task.organization?.maxReviewRevisions),
      MAX_PER_STORY_REVISIONS: String(task.organization?.maxPerStoryRevisions),
      REVIEW_ENABLED: task.organization?.autoReviewEnabled !== false ? "true" : "false",
      DEPLOYMENT_ENABLED: task.deploymentEnabled || task.parentTaskId ? "true" : "false",
      PRD_CHILD_TASK: task.parentTaskId ? "true" : "false",

      // Worker model
      WORKER_MODEL: task.workerModel || process.env.WORKER_MODEL || task.organization?.defaultWorkerModel || "",

      // Manager provider and model for tech lead review
      MANAGER_PROVIDER: credentials?.managerProvider || process.env.MANAGER_PROVIDER || "anthropic",
      MANAGER_MODEL: credentials?.managerModelId || process.env.MANAGER_MODEL || "",

      // Task notes from dashboard
      TASK_NOTES: task.taskNotes || "",

      // Existing PR info (for deployment-only runs)
      EXISTING_PR_URL: task.githubPrUrl || "",
      EXISTING_PR_NUMBER: task.githubPrNumber ? String(task.githubPrNumber) : "",

      // AI provider configuration
      WORKER_PROVIDER: task.workerProvider || "anthropic",
      // Only pass a real API key — never the LOCAL_OAUTH_MODE sentinel.
      // Local mode uses OAuth via mounted ~/.claude/.credentials.json.
      // Passing the sentinel causes Claude CLI to reject it as an invalid key.
      ANTHROPIC_API_KEY: credentials?.anthropicApiKey && credentials.anthropicApiKey !== "LOCAL_OAUTH_MODE"
        ? credentials.anthropicApiKey
        : "",
      OPENAI_API_KEY: credentials?.openaiApiKey || process.env.OPENAI_API_KEY || "",
      GOOGLE_API_KEY: credentials?.googleApiKey || process.env.GOOGLE_API_KEY || "",
      GOOGLE_GENERATIVE_AI_API_KEY: credentials?.googleApiKey || process.env.GOOGLE_API_KEY || "",
      OLLAMA_HOST: credentials?.ollamaBaseUrl || process.env.OLLAMA_HOST || "",
      OLLAMA_CONTEXT_WINDOW: String(task.organization?.ollamaContextWindow || 32768),

      // Note: CLAUDE_CODE_OAUTH_TOKEN is NOT passed here. Claude CLI inside the
      // container uses the mounted ~/.claude credentials file which includes the
      // refresh token, allowing it to auto-refresh expired access tokens mid-run.

      // Resilience Settings (from org settings)
      BLOCKER_MAX_AUTO_RETRIES: String(task.organization?.blockerMaxAutoRetries),
      BLOCKER_AUTO_RETRY_ENABLED: task.organization?.blockerAutoRetryEnabled !== false ? "true" : "false",
      MAX_FIX_RETRIES: String(task.organization?.maxFixRetries),
      ...(task.organization?.maxAgentTurns != null ? { MAX_AGENT_TURNS: String(task.organization.maxAgentTurns) } : {}),
      BLOCKER_WAIT_TIMEOUT_MINUTES: String(task.organization?.blockerWaitTimeoutMinutes),
      QUALITY_GATE_COMMANDS: task.jiraFields?.qualityGates
        ? JSON.stringify(task.jiraFields.qualityGates)
        : "",
      IS_FOUNDATION_CARD: task.jiraFields?.isFoundationCard ? "true" : "false",
      CI_WORKFLOW_PATH: (task.jiraFields?.ciWorkflowPath as string) || "",
      PUSH_AFTER_COMMIT: task.organization?.pushAfterCommit !== false ? "true" : "false",
      GRACEFUL_SHUTDOWN_ENABLED: task.organization?.gracefulShutdownEnabled !== false ? "true" : "false",
      SELF_REVIEW_ENABLED: hasSelfReviewLabel(task) || (task.organization?.selfReviewEnabled === true) ? "true" : "false",
      MAX_PARALLEL_EXPERTS: String(task.organization?.maxParallelExperts),
      ORG_GUIDELINES: task.organization?.aiGuidelines || "",
      CODEBASE_INDEXING_ENABLED: task.organization?.codebaseIndexingEnabled === true ? "true" : "false",

      // Quality gate thresholds (from org settings)
      QUALITY_THRESHOLDS: JSON.stringify({
        qualityGateEnabled: task.organization?.qualityGateEnabled ?? false,
        minQualityScore: task.organization?.minQualityScore ?? null,
        minTestCoveragePercent: task.organization?.minTestCoveragePercent ?? null,
        maxSecurityHighVulns: task.organization?.maxSecurityHighVulns ?? null,
        blockOnTypeErrors: task.organization?.blockOnTypeErrors ?? false,
        blockOnTestFailures: task.organization?.blockOnTestFailures ?? false,
        blockOnLintErrors: task.organization?.blockOnLintErrors ?? false,
        blockOnE2EFailures: task.organization?.blockOnE2EFailures ?? false,
        autoFixEnabled: task.organization?.autoFixEnabled ?? false,
        autoFixMaxIterations: task.organization?.autoFixMaxIterations,
      }),
    };

    // Filter out empty values and build -e args
    return Object.entries(vars)
      .filter(([, v]) => v !== "")
      .flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  }

  /**
   * Find the project root directory.
   */
  private findProjectRoot(): string {
    let dir = __dirname;

    // Walk up until we find package.json at workermill root
    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        // Check if this is the API package (has workermill in name or is api)
        if (pkg.name === "workermill-api" || pkg.name?.includes("workermill")) {
          // Go up one more level to get project root
          return path.dirname(dir);
        }
      }

      // Check for worker directory (indicates we're at project root)
      if (fs.existsSync(path.join(dir, "worker"))) {
        return dir;
      }

      dir = path.dirname(dir);
    }

    // Fall back to current working directory
    return process.cwd();
  }

  /**
   * Stop a running Epic Coordinator container.
   */
  async stopTask(taskId: string): Promise<boolean> {
    const epicProcess = this.activeProcesses.get(taskId);
    if (!epicProcess || epicProcess.status !== "running") {
      return false;
    }

    logger.info("Stopping Epic Coordinator container", {
      taskId,
      containerName: epicProcess.containerName,
    });

    // Use docker stop for graceful shutdown (sends SIGTERM, waits 10s, then SIGKILL)
    try {
      execSync(`docker stop ${epicProcess.containerName}`, {
        stdio: "ignore",
        timeout: 15000, // 15 second timeout
      });
      epicProcess.status = "completed";
      return true;
    } catch {
      // Container may have already exited
      logger.warn("Container stop failed (may have already exited)", {
        taskId,
        containerName: epicProcess.containerName,
      });
      return false;
    }
  }

  /**
   * Get count of active processes.
   */
  getActiveCount(): number {
    return Array.from(this.activeProcesses.values()).filter(
      (p) => p.status === "running"
    ).length;
  }

  /**
   * Get status of a task.
   */
  getTaskStatus(taskId: string): LocalEpicProcess | undefined {
    return this.activeProcesses.get(taskId);
  }

  /**
   * Get all active processes.
   */
  getActiveProcesses(): LocalEpicProcess[] {
    return Array.from(this.activeProcesses.values());
  }

  /**
   * Stop all running containers.
   */
  async stopAll(): Promise<void> {
    logger.info("Stopping all local Epic Coordinator containers", {
      count: this.activeProcesses.size,
    });

    const stopPromises = Array.from(this.activeProcesses.keys()).map((taskId) =>
      this.stopTask(taskId)
    );

    await Promise.all(stopPromises);

    // Also stop any orphaned workermill containers (in case of crash)
    try {
      execSync('docker ps -q --filter "name=workermill-" | xargs -r docker stop', {
        stdio: "ignore",
        timeout: 30000,
      });
    } catch {
      // Ignore errors - no containers to stop
    }

    // Cleanup worktrees
    await worktreeManager.cleanup();
  }
}

// Singleton instance
export const localEpicSpawner = new LocalEpicSpawner();
