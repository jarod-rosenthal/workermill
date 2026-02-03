/**
 * Local Epic Spawner
 *
 * Spawns Epic Coordinator as a local Node.js process instead of an ECS task.
 * Used for local development with Claude Max subscription (OAuth authentication).
 *
 * This replaces the ECS task spawning for EXECUTION_MODE=local.
 */

import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";
import { WorkerTask } from "../models/WorkerTask.js";
import { worktreeManager } from "./worktree-manager.js";
import { logger } from "../utils/logger.js";

interface LocalEpicProcess {
  taskId: string;
  process: ChildProcess;
  worktreePath: string | null;
  startedAt: Date;
  status: "running" | "completed" | "failed";
}

class LocalEpicSpawner {
  private activeProcesses: Map<string, LocalEpicProcess> = new Map();
  private maxConcurrent: number;
  private apiBaseUrl: string;

  constructor() {
    this.maxConcurrent = parseInt(process.env.MAX_LOCAL_WORKERS || "4", 10);
    this.apiBaseUrl = `http://localhost:${process.env.PORT || 3001}`;
  }

  /**
   * Check if we're in local execution mode.
   */
  isLocalMode(): boolean {
    return process.env.EXECUTION_MODE === "local";
  }

  /**
   * Spawn an Epic Coordinator for a task.
   */
  async spawnEpicCoordinator(task: WorkerTask): Promise<void> {
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
      throw new Error(`Task ${task.id} is already running`);
    }

    logger.info("Spawning local Epic Coordinator", {
      taskId: task.id,
      title: task.title,
    });

    // Acquire worktree for the coordinator
    let worktreePath: string | null = null;
    try {
      if (process.env.TARGET_REPO_PATH) {
        worktreePath = await worktreeManager.acquireWorktree(task.id, "coordinator");
      }
    } catch (e) {
      logger.warn("Could not acquire worktree, using current directory", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const workingDir = worktreePath || process.cwd();

    // Build environment for Epic Coordinator
    const epicEnv: Record<string, string> = {
      // Inherit current environment
      ...process.env as Record<string, string>,

      // Task context
      TASK_ID: task.id,
      PARENT_TASK_ID: task.id,
      JIRA_ISSUE_KEY: task.jiraIssueKey || "",
      TASK_SUMMARY: task.title || "",
      TASK_DESCRIPTION: task.description || "",

      // API configuration
      API_BASE_URL: this.apiBaseUrl,
      ORG_API_KEY: task.organization?.apiKey || "local-dev",

      // OAuth token for Claude CLI (from environment)
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || "",

      // SCM tokens (if configured)
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || task.organization?.githubToken || "",
      GH_TOKEN: process.env.GITHUB_TOKEN || task.organization?.githubToken || "",
      BITBUCKET_TOKEN: process.env.BITBUCKET_TOKEN || task.organization?.bitbucketToken || "",
      GITLAB_TOKEN: process.env.GITLAB_TOKEN || task.organization?.gitlabToken || "",

      // Target repository
      TARGET_REPO: this.getTargetRepo(task),

      // Worktree configuration for parallel experts
      WORKTREE_BASE_PATH: process.env.WORKTREE_BASE_PATH || "../workermill-workers",
      MAX_PARALLEL_EXPERTS: process.env.MAX_PARALLEL_EXPERTS || "4",

      // Review settings
      MAX_REVIEW_REVISIONS: process.env.MAX_REVIEW_REVISIONS || "3",
      ENABLE_TECH_LEAD_REVIEW: process.env.ENABLE_TECH_LEAD_REVIEW || "true",

      // Local mode flag
      EXECUTION_MODE: "local",
    };

    // Determine the Epic Coordinator entry point
    const projectRoot = this.findProjectRoot();
    const epicIndexPath = path.join(projectRoot, "worker", "epic", "index.ts");

    // Check if TypeScript source exists
    if (!fs.existsSync(epicIndexPath)) {
      throw new Error(`Epic Coordinator not found at: ${epicIndexPath}`);
    }

    logger.info("Starting Epic Coordinator process", {
      taskId: task.id,
      workingDir,
      epicIndexPath,
    });

    // Spawn the process using tsx (TypeScript executor)
    const proc = spawn("npx", ["tsx", epicIndexPath], {
      cwd: workingDir,
      env: epicEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!proc.pid) {
      throw new Error("Failed to spawn Epic Coordinator process");
    }

    // Track the process
    const epicProcess: LocalEpicProcess = {
      taskId: task.id,
      process: proc,
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

    logger.info("Epic Coordinator spawned", {
      taskId: task.id,
      pid: proc.pid,
      workingDir,
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
   */
  private getTargetRepo(task: WorkerTask): string {
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

    // Fall back to environment
    return process.env.TARGET_REPO_PATH || ".";
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
   * Stop a running Epic Coordinator.
   */
  async stopTask(taskId: string): Promise<boolean> {
    const epicProcess = this.activeProcesses.get(taskId);
    if (!epicProcess || epicProcess.status !== "running") {
      return false;
    }

    logger.info("Stopping Epic Coordinator", { taskId });

    // Send SIGTERM first for graceful shutdown
    epicProcess.process.kill("SIGTERM");

    // Force kill after 10 seconds
    setTimeout(() => {
      if (epicProcess.status === "running") {
        epicProcess.process.kill("SIGKILL");
      }
    }, 10000);

    return true;
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
   * Stop all running processes.
   */
  async stopAll(): Promise<void> {
    logger.info("Stopping all local Epic Coordinators", {
      count: this.activeProcesses.size,
    });

    const stopPromises = Array.from(this.activeProcesses.keys()).map((taskId) =>
      this.stopTask(taskId)
    );

    await Promise.all(stopPromises);

    // Cleanup worktrees
    await worktreeManager.cleanup();
  }
}

// Singleton instance
export const localEpicSpawner = new LocalEpicSpawner();
