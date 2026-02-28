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
import { loadStandaloneConfig } from "./config.js";

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
  const maxParallel = getSettingInt("max_parallel_experts", 4);
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
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    __WORKERMILL_MODE: "worker",
    WORKERMILL_API_URL: `http://127.0.0.1:${localApiPort}`,
    TASK_ID: taskId,
    PARENT_TASK_ID: task.parent_task_id || taskId,
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",
    GITHUB_REPO: task.github_repo || config.defaultRepo || "",
    SCM_PROVIDER: task.scm_provider || config.scm?.provider || "github",
    WORKER_MODEL: task.worker_model || config.llm?.model || "claude-sonnet-4-20250514",
    SCM_TOKEN: config.scm?.token || "",
  };

  // LLM API key
  if (config.llm?.provider === "anthropic" || !config.llm?.provider) {
    env.ANTHROPIC_API_KEY = config.llm?.apiKey || "";
  } else if (config.llm?.provider === "openai") {
    env.OPENAI_API_KEY = config.llm?.apiKey || "";
  } else if (config.llm?.provider === "google") {
    env.GOOGLE_API_KEY = config.llm?.apiKey || "";
  }

  // Execution plan (if this is a sub-task of a planned epic)
  if (task.execution_plan) {
    env.EXECUTION_PLAN = typeof task.execution_plan === "string"
      ? task.execution_plan
      : JSON.stringify(JSON.parse(task.execution_plan));
  }

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

  // Pipe stdout/stderr as log events
  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
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
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: line,
        severity: "error",
        createdAt: new Date().toISOString(),
      });
    }
  });

  // Handle worker exit
  child.on("exit", (exitCode) => {
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
          config.llm?.model || null, depCard.board_id, depCard.id,
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
