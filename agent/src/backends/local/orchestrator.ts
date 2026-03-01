/**
 * Local Orchestrator for Standalone Mode
 *
 * Claims tasks from SQLite, spawns worker processes, monitors liveness.
 * Workers are self-invocations (process.execPath with __WORKERMILL_MODE=worker).
 *
 * Unlike the cloud orchestrator, this is event-driven (not polling).
 * Tasks are picked up immediately when created.
 */

import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { getDb, generateId, getSettingInt } from "./db.js";
import { emitStreamEvent } from "./event-bus.js";
import { loadStandaloneConfig, getRoleConfig, resolveApiKey } from "./config.js";

interface ActiveWorker {
  taskId: string;
  process: ChildProcess;
  startedAt: number;
}

const activeWorkers = new Map<string, ActiveWorker>();
let staleCheckInterval: ReturnType<typeof setInterval> | null = null;
let localApiPort: number | null = null;

/**
 * Initialize the local orchestrator.
 * Starts the stale task sweep and sets the local API port for worker communication.
 */
export function initOrchestrator(port: number): void {
  localApiPort = port;

  // Sweep for stale tasks every 60s
  staleCheckInterval = setInterval(sweepStaleWorkers, 60_000);
}

/** Shut down the orchestrator and kill all active workers. */
export function shutdownOrchestrator(): void {
  if (staleCheckInterval) {
    clearInterval(staleCheckInterval);
    staleCheckInterval = null;
  }

  for (const [taskId, worker] of activeWorkers) {
    try {
      worker.process.kill("SIGTERM");
    } catch { /* already dead */ }
    activeWorkers.delete(taskId);
  }
}

/**
 * Process a queued task — claim it and spawn a worker.
 * Called when a task is created or retried.
 */
export async function processQueuedTask(taskId: string): Promise<void> {
  const db = getDb();

  // Check concurrency limit
  const maxParallel = getSettingInt("max_parallel_experts", 8);
  const config = loadStandaloneConfig();
  const limit = config.settings?.maxParallelExperts ?? maxParallel;

  const { count } = db.prepare(
    "SELECT COUNT(*) as count FROM tasks WHERE status = 'executing'"
  ).get() as { count: number };

  if (count >= limit) {
    // At capacity — task stays queued, will be picked up when a slot opens
    return;
  }

  // Atomic claim
  const result = db.prepare(
    "UPDATE tasks SET status = 'executing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'queued'"
  ).run(taskId);

  if (result.changes === 0) return; // Already claimed or status changed

  emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "executing" });

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
  if (!task) return;

  await spawnLocalWorker(task);
}

/** Spawn a worker process for a task. */
async function spawnLocalWorker(task: any): Promise<void> {
  if (!localApiPort) {
    throw new Error("Local orchestrator not initialized — call initOrchestrator(port) first");
  }

  const config = loadStandaloneConfig();
  const taskId = task.id;

  // Working directory
  const workDir = path.join(os.tmpdir(), `workermill-${taskId.slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  // Resolve spawn command (same pattern as spawner.ts:37-49)
  const execName = path.basename(process.execPath).replace(/\.exe$/i, "");
  let command: string;
  let args: string[];
  if (execName === "node" || execName === "nodejs") {
    const thisFile = fileURLToPath(import.meta.url);
    const distDir = path.resolve(path.dirname(thisFile), "../..");
    const entryScript = path.join(distDir, "entry.js");
    command = process.execPath;
    args = [entryScript];
  } else {
    command = process.execPath;
    args = [];
  }

  // Environment for the worker
  const apiUrl = `http://127.0.0.1:${localApiPort}`;
  // Worker expects owner/repo format — strip full URLs like https://github.com/owner/repo.git
  const rawRepo = task.github_repo || config.defaultRepo || "";
  const repoSlug = rawRepo.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") || rawRepo;
  // Read agent auth token so worker can authenticate to local API
  const agentToken = (() => {
    try { return fs.readFileSync(path.join(os.homedir(), ".workermill", "agent.token"), "utf-8").trim(); } catch { return "standalone"; }
  })();
  // Copy process.env but strip Claude Code session vars to prevent
  // "cannot be launched inside another Claude Code session" error
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT" || k.startsWith("CLAUDE_CODE_")) continue;
    // Strip inherited ANTHROPIC_API_KEY — Claude CLI reads ~/.claude/.credentials.json directly.
    // OAuth tokens (sk-ant-oat*) fail when passed as API keys. Real API keys (sk-ant-api*) are
    // set explicitly below if configured.
    if (k === "ANTHROPIC_API_KEY") continue;
    cleanEnv[k] = v;
  }

  const env: Record<string, string> = {
    ...cleanEnv,
    __WORKERMILL_MODE: "worker",
    WORKERMILL_API_URL: apiUrl,
    API_BASE_URL: apiUrl,
    ORG_API_KEY: agentToken,
    TASK_ID: taskId,
    PARENT_TASK_ID: task.parent_task_id || taskId,
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",
    GITHUB_REPO: repoSlug,
    SCM_PROVIDER: task.scm_provider || config.scm?.provider || "github",
    WORKER_MODEL: task.worker_model || getRoleConfig(config, "worker").model,
    SCM_TOKEN: config.scm?.token || "",
    GITHUB_TOKEN: config.scm?.token || "",
    MAX_PER_STORY_REVISIONS: String(config.settings?.maxPerStoryRevisions ?? 1),
    MAX_REVIEW_REVISIONS: String(config.settings?.maxReviewRevisions ?? 3),
    QUALITY_GATE_MAX_RETRIES: String(config.settings?.qualityGateMaxRetries ?? 5),
    MAX_CI_FIX_RETRIES: String(config.settings?.maxCiFixRetries ?? 3),
    BLOCKER_WAIT_TIMEOUT_MINUTES: String(config.settings?.blockerWaitTimeoutMinutes ?? 20),
    PUSH_AFTER_COMMIT: config.settings?.pushAfterCommit !== false ? "true" : "false",
  };

  // LLM API keys — set all providers that have keys so workers can use any
  const workerKey = resolveApiKey(config, "worker");
  const workerProvider = getRoleConfig(config, "worker").provider;
  if (workerProvider === "anthropic") {
    // Only set ANTHROPIC_API_KEY if user explicitly configured a real API key in config.json.
    // Otherwise Claude CLI reads ~/.claude/.credentials.json directly.
    if (workerKey && config.roles?.worker?.apiKey) {
      env.ANTHROPIC_API_KEY = workerKey;
    }
  } else if (workerProvider === "openai") {
    env.OPENAI_API_KEY = workerKey;
  } else if (workerProvider === "google") {
    env.GOOGLE_API_KEY = workerKey;
    env.GOOGLE_GENERATIVE_AI_API_KEY = workerKey;
  }

  // Execution plan (if this is a sub-task of a planned epic)
  if (task.execution_plan) {
    env.EXECUTION_PLAN = typeof task.execution_plan === "string"
      ? task.execution_plan
      : JSON.stringify(JSON.parse(task.execution_plan));
  }

  console.log(`[orchestrator] Spawning worker: ${command} ${args.join(" ")} (cwd: ${workDir}, task: ${taskId})`);

  const child = spawn(command, args, {
    env,
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Store PID in database for stale detection
  if (child.pid) {
    getDb().prepare("UPDATE tasks SET worker_pid = ? WHERE id = ?").run(child.pid, taskId);
  }

  activeWorkers.set(taskId, {
    taskId,
    process: child,
    startedAt: Date.now(),
  });

  // Pipe stdout/stderr as log events (store in SQLite + SSE broadcast)
  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
      // Store in SQLite so polling terminals can read them
      try {
        getDb().prepare(
          "INSERT INTO task_logs (task_id, type, message, severity) VALUES (?, ?, ?, ?)"
        ).run(taskId, "execution", line, "info");
      } catch { /* ignore db errors */ }
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: line,
        severity: "info",
        createdAt: new Date().toISOString(),
      });
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
      try {
        getDb().prepare(
          "INSERT INTO task_logs (task_id, type, message, severity) VALUES (?, ?, ?, ?)"
        ).run(taskId, "execution", line, "error");
      } catch { /* ignore db errors */ }
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: line,
        severity: "error",
        createdAt: new Date().toISOString(),
      });
    }
  });

  child.on("error", (err) => {
    console.error(`[orchestrator] Worker spawn error for task ${taskId}:`, err.message);
  });

  // Handle worker exit
  child.on("exit", (exitCode) => {
    console.log(`[orchestrator] Worker exited for task ${taskId} with code ${exitCode}`);
    activeWorkers.delete(taskId);

    const db = getDb();
    if (exitCode === 0) {
      db.prepare(
        "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed" });

      // Trigger dependency cascade
      triggerDependentCards(taskId);
    } else {
      db.prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "failed", exitCode });
    }

    // Check if there are queued tasks waiting for a slot
    processNextQueued();
  });
}

/** Process the next queued task (called when a slot opens). */
function processNextQueued(): void {
  const db = getDb();
  const next = db.prepare(
    "SELECT id FROM tasks WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
  ).get() as { id: string } | null;

  if (next) {
    processQueuedTask(next.id).catch((err) => {
      console.error("[local-orchestrator] Failed to process queued task:", err);
    });
  }
}

/** Board dependency cascade — when a card's task completes, trigger dependent cards. */
function triggerDependentCards(completedTaskId: string): void {
  const db = getDb();

  // Find the card associated with this task
  const card = db.prepare(
    "SELECT id, board_id FROM cards WHERE task_id = ?"
  ).get(completedTaskId) as { id: string; board_id: string } | null;

  if (!card) return;

  // Find cards that depend on this card
  const dependents = db.prepare(
    "SELECT card_id FROM card_dependencies WHERE depends_on_card_id = ?"
  ).all(card.id) as { card_id: string }[];

  for (const dep of dependents) {
    // Check if ALL dependencies of this dependent card are complete
    const blockers = db.prepare(`
      SELECT cd.depends_on_card_id
      FROM card_dependencies cd
      JOIN cards c ON c.id = cd.depends_on_card_id
      LEFT JOIN tasks t ON t.id = c.task_id
      WHERE cd.card_id = ? AND (t.status IS NULL OR t.status != 'completed')
    `).all(dep.card_id) as any[];

    if (blockers.length === 0) {
      // All dependencies met — create and queue a task for this card
      const depCard = db.prepare("SELECT * FROM cards WHERE id = ?").get(dep.card_id) as any;
      if (depCard && !depCard.task_id) {
        const config = loadStandaloneConfig();
        const taskId = generateId();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO tasks (id, summary, description, github_repo, scm_provider, worker_model, board_id, card_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `).run(
          taskId, depCard.title, depCard.description,
          config.defaultRepo || null, config.scm?.provider || null,
          getRoleConfig(config, "worker").model, depCard.board_id, depCard.id,
          now, now,
        );

        db.prepare("UPDATE cards SET task_id = ? WHERE id = ?").run(taskId, depCard.id);
        emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "queued" });

        // Try to process immediately
        processQueuedTask(taskId).catch(() => {});
      }
    }
  }
}

/** Sweep for stale workers — tasks in 'executing' with dead PIDs. */
function sweepStaleWorkers(): void {
  const db = getDb();
  const executing = db.prepare(
    "SELECT id, worker_pid FROM tasks WHERE status = 'executing' AND worker_pid IS NOT NULL"
  ).all() as { id: string; worker_pid: number }[];

  for (const task of executing) {
    try {
      // Check if PID is alive (signal 0 doesn't kill, just checks)
      process.kill(task.worker_pid, 0);
    } catch {
      // Process is dead — mark task as failed
      db.prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(task.id);
      activeWorkers.delete(task.id);
      emitStreamEvent("org:local:tasks", "task_state", {
        taskId: task.id,
        status: "failed",
        error: "Worker process exited unexpectedly",
      });
    }
  }
}

/** Stop a specific worker task. */
export function stopWorkerTask(taskId: string): void {
  const worker = activeWorkers.get(taskId);
  if (worker) {
    try {
      worker.process.kill("SIGTERM");
    } catch { /* already dead */ }
    activeWorkers.delete(taskId);
  }
}

/** Get count of active workers. */
export function getActiveWorkerCount(): number {
  return activeWorkers.size;
}
