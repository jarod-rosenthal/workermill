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

  // Working directory — shared per board so sequential cards see each other's work
  const workDir = task.board_id
    ? path.join(os.tmpdir(), `workermill-board-${task.board_id.slice(0, 12)}`)
    : path.join(os.tmpdir(), `workermill-${taskId.slice(0, 8)}`);
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

  // Parse task-level JSON fields
  const jiraFields = task.jira_fields ? JSON.parse(task.jira_fields) : {};
  const targetFiles = task.target_files ? JSON.parse(task.target_files) : [];
  const referenceFiles = task.reference_files ? JSON.parse(task.reference_files) : [];

  // Resolve worker provider and model
  const workerProvider = task.worker_provider || getRoleConfig(config, "worker").provider;
  const workerModel = task.worker_model || getRoleConfig(config, "worker").model;

  // Resolve LLM API key for the worker's provider
  const workerKey = resolveApiKey(config, "worker");

  // Issue tracker config
  const issueTracker = config.issueTracker;

  // Manager config
  const techLeadConfig = getRoleConfig(config, "techLead");

  // Build env vars — full cloud-parity (matches agent/src/spawner.ts)
  const env: Record<string, string> = {
    ...cleanEnv,
    __WORKERMILL_MODE: "worker",

    // Core identifiers
    WORKERMILL_API_URL: apiUrl,
    API_BASE_URL: apiUrl,
    ORG_API_KEY: agentToken,
    TASK_ID: taskId,
    PARENT_TASK_ID: task.parent_task_id || taskId,
    EPIC_MODE: "true",
    EXECUTION_MODE: "remote",

    // Task context
    TASK_SUMMARY: task.summary || "",
    TASK_DESCRIPTION: task.description || "",
    JIRA_SUMMARY: task.summary || "",
    JIRA_DESCRIPTION: task.description || "",
    JIRA_ISSUE_KEY: task.jira_issue_key || "",
    TICKET_KEY: task.jira_issue_key || "",
    TASK_NOTES: task.task_notes || "",
    WORKER_PERSONA: task.worker_persona || "",
    RETRY_NUMBER: String(task.retry_count ?? 0),

    // Target repository
    TARGET_REPO: repoSlug,
    GITHUB_REPO: repoSlug,

    // SCM configuration
    SCM_PROVIDER: task.scm_provider || config.scm?.provider || "github",
    SCM_TOKEN: config.scm?.token || "",
    GITHUB_TOKEN: config.scm?.token || "",
    GH_TOKEN: config.scm?.token || "",

    // Worker model/provider
    WORKER_MODEL: workerModel,
    CLAUDE_MODEL: workerModel,
    WORKER_PROVIDER: workerProvider,

    // Issue tracker
    TICKET_SYSTEM: issueTracker?.provider || "internal",
    JIRA_BASE_URL: issueTracker?.jira?.baseUrl || "",
    JIRA_EMAIL: issueTracker?.jira?.email || "",
    JIRA_API_TOKEN: issueTracker?.jira?.apiToken || "",
    LINEAR_API_KEY: issueTracker?.linear?.apiKey || "",

    // Manager settings
    MANAGER_PROVIDER: techLeadConfig.provider,
    MANAGER_MODEL: techLeadConfig.model,

    // Workflow control flags
    DEPLOYMENT_ENABLED: task.deployment_enabled || task.parent_task_id ? "true" : "false",
    PRD_CHILD_TASK: task.parent_task_id ? "true" : "false",
    IMPROVEMENT_ENABLED: task.improvement_enabled ? "true" : "false",
    QUALITY_GATE_BYPASS: task.quality_gate_bypass ? "true" : "false",
    STANDARD_SDK_MODE: task.standard_sdk_mode ? "true" : "false",
    REVIEW_ENABLED: task.skip_manager_review === 0 ? "true" : (config.settings?.maxReviewRevisions !== 0 ? "true" : "false"),
    SELF_REVIEW_ENABLED: config.settings?.selfReviewEnabled ? "true" : "false",
    EXECUTION_MODE_SETTING: (jiraFields.executionMode as string) || "autonomous",

    // File targeting
    TARGET_FILES: JSON.stringify(targetFiles),
    REFERENCE_FILES: JSON.stringify(referenceFiles),

    // PRD branching
    TARGET_BRANCH: task.target_branch || (jiraFields.targetBranch as string) || "",
    STORY_BRANCH: task.story_branch || (jiraFields.storyBranch as string) || "",
    PARENT_JIRA_KEY: task.jira_issue_key && /-S\d+$/.test(task.jira_issue_key)
      ? (jiraFields.parentJiraKey as string) || ""
      : "",

    // Existing PR info
    EXISTING_PR_URL: task.github_pr_url || "",
    EXISTING_PR_NUMBER: task.github_pr_url ? (task.github_pr_url.match(/\/pull\/(\d+)/)?.[1] || "") : "",

    // Resilience settings
    MAX_PER_STORY_REVISIONS: String(config.settings?.maxPerStoryRevisions ?? 1),
    MAX_REVIEW_REVISIONS: String(config.settings?.maxReviewRevisions ?? 3),
    QUALITY_GATE_MAX_RETRIES: String(config.settings?.qualityGateMaxRetries ?? 5),
    MAX_CI_FIX_RETRIES: String(config.settings?.maxCiFixRetries ?? 3),
    BLOCKER_WAIT_TIMEOUT_MINUTES: String(config.settings?.blockerWaitTimeoutMinutes ?? 20),
    PUSH_AFTER_COMMIT: config.settings?.pushAfterCommit !== false ? "true" : "false",
    BLOCKER_AUTO_RETRY_ENABLED: config.settings?.blockerAutoRetryEnabled !== false ? "true" : "false",
    BLOCKER_MAX_AUTO_RETRIES: String(config.settings?.blockerMaxAutoRetries ?? 3),
    GRACEFUL_SHUTDOWN_ENABLED: config.settings?.gracefulShutdownEnabled !== false ? "true" : "false",
    MAX_PARALLEL_EXPERTS: String(config.settings?.maxParallelExperts ?? 8),

    // Org guidelines
    ORG_GUIDELINES: config.settings?.aiGuidelines || "",

    // Quality gate thresholds
    QUALITY_THRESHOLDS: JSON.stringify({
      qualityGateEnabled: config.settings?.qualityGateEnabled ?? false,
      minQualityScore: config.settings?.minQualityScore ?? null,
      minTestCoveragePercent: config.settings?.minTestCoveragePercent ?? null,
      maxSecurityHighVulns: config.settings?.maxSecurityHighVulns ?? null,
      blockOnTypeErrors: config.settings?.blockOnTypeErrors ?? false,
      blockOnTestFailures: config.settings?.blockOnTestFailures ?? false,
      blockOnLintErrors: config.settings?.blockOnLintErrors ?? false,
      autoFixEnabled: config.settings?.autoFixEnabled ?? false,
      autoFixMaxIterations: config.settings?.autoFixMaxIterations ?? 3,
    }),

    // Codebase indexing
    CODEBASE_INDEXING_ENABLED: config.settings?.codebaseIndexingEnabled ? "true" : "false",

    // Board execution workspace
    ...(task.board_id ? { PERSISTENT_WORKSPACE: workDir } : {}),
  };

  // LLM API keys — set all providers that have keys so workers can use any
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

  // Also pass non-primary provider keys if they're available in the environment
  // (so multi-provider workers can access all configured providers)
  if (!env.OPENAI_API_KEY && process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY) env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY) env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (process.env.OLLAMA_HOST) env.OLLAMA_HOST = process.env.OLLAMA_HOST;
  if (process.env.VLLM_BASE_URL) env.VLLM_BASE_URL = process.env.VLLM_BASE_URL;

  // Execution plan (if this is a sub-task of a planned epic)
  if (task.execution_plan) {
    env.EXECUTION_PLAN = typeof task.execution_plan === "string"
      ? task.execution_plan
      : JSON.stringify(JSON.parse(task.execution_plan));
  }

  // Quality gates — read from the board if this task is linked to a card.
  // Foundation card (position 0) creates the project from scratch — its stories
  // build incrementally and can't pass full-project quality gates. Skip for position 0.
  if (task.board_id) {
    try {
      const board = getDb().prepare("SELECT quality_gate_commands, ci_workflow_path FROM boards WHERE id = ?").get(task.board_id) as any;
      let isFoundationCard = false;
      if (task.card_id) {
        const card = getDb().prepare("SELECT position FROM cards WHERE id = ?").get(task.card_id) as any;
        isFoundationCard = card?.position === 0;
      }
      if (board?.quality_gate_commands) {
        env.QUALITY_GATE_COMMANDS = board.quality_gate_commands;
      }
      if (isFoundationCard) {
        env.IS_FOUNDATION_CARD = "true";
      }
      if (board?.ci_workflow_path) {
        env.CI_WORKFLOW_PATH = board.ci_workflow_path;
      }
    } catch { /* board lookup failed — proceed without gates */ }
  }

  // Quality gates from task jiraFields (set via PRD decomposer or API)
  if (jiraFields.qualityGates) {
    env.QUALITY_GATE_COMMANDS = JSON.stringify(jiraFields.qualityGates);
  }
  if (jiraFields.isFoundationCard) {
    env.IS_FOUNDATION_CARD = "true";
  }
  if (jiraFields.ciWorkflowPath) {
    env.CI_WORKFLOW_PATH = jiraFields.ciWorkflowPath as string;
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
      // Check if worker created a PR — if so, mark as reviewing and spawn manager
      const updatedTask = db.prepare("SELECT github_pr_url FROM tasks WHERE id = ?").get(taskId) as any;
      const hasPr = !!updatedTask?.github_pr_url;

      if (hasPr && config.settings?.maxReviewRevisions !== 0) {
        // Worker completed with a PR — spawn manager review
        db.prepare(
          "UPDATE tasks SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?"
        ).run(taskId);
        emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "reviewing" });
        spawnManagerReview(task, updatedTask.github_pr_url).catch((err) => {
          console.error(`[orchestrator] Manager spawn failed for task ${taskId}:`, err);
          // Fall through to completed
          db.prepare(
            "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
          ).run(taskId);
          emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed" });
          triggerDependentCards(taskId);
          processNextQueued();
        });
      } else {
        db.prepare(
          "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(taskId);
        emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed" });
        triggerDependentCards(taskId);
        processNextQueued();
      }
    } else {
      db.prepare(
        "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "failed", exitCode });

      // Check if there are queued tasks waiting for a slot
      processNextQueued();
    }
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

        const workerRole = getRoleConfig(config, "worker");
        db.prepare(`
          INSERT INTO tasks (id, summary, description, github_repo, scm_provider, worker_model, worker_provider, board_id, card_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `).run(
          taskId, depCard.title, depCard.description,
          config.defaultRepo || null, config.scm?.provider || null,
          workerRole.model, workerRole.provider, depCard.board_id, depCard.id,
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

/**
 * Spawn a manager review process for a completed task with a PR.
 * The manager reviews the PR and posts the result via POST /api/tasks/:id/manager-complete.
 */
async function spawnManagerReview(task: any, prUrl: string): Promise<void> {
  if (!localApiPort) return;

  const config = loadStandaloneConfig();
  const taskId = task.id;
  const techLeadConfig = getRoleConfig(config, "techLead");

  // Extract PR number from URL
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? prNumberMatch[1] : "";

  // Working directory — reuse the task's workspace
  const workDir = task.board_id
    ? path.join(os.tmpdir(), `workermill-board-${task.board_id.slice(0, 12)}`)
    : path.join(os.tmpdir(), `workermill-${taskId.slice(0, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

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

  const apiUrl = `http://127.0.0.1:${localApiPort}`;
  const rawRepo = task.github_repo || config.defaultRepo || "";
  const repoSlug = rawRepo.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "") || rawRepo;
  const agentToken = (() => {
    try { return fs.readFileSync(path.join(os.homedir(), ".workermill", "agent.token"), "utf-8").trim(); } catch { return "standalone"; }
  })();

  // Clean environment (same as spawnLocalWorker)
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT" || k.startsWith("CLAUDE_CODE_")) continue;
    if (k === "ANTHROPIC_API_KEY") continue;
    cleanEnv[k] = v;
  }

  const issueTracker = config.issueTracker;

  const env: Record<string, string> = {
    ...cleanEnv,
    __WORKERMILL_MODE: "manager",
    TASK_ID: taskId,
    MANAGER_ACTION: "review_pr",
    GITHUB_REPO: repoSlug,
    PR_URL: prUrl,
    PR_NUMBER: prNumber,
    API_BASE_URL: apiUrl,
    ORG_API_KEY: agentToken,
    SCM_PROVIDER: task.scm_provider || config.scm?.provider || "github",
    SCM_TOKEN: config.scm?.token || "",
    GITHUB_TOKEN: config.scm?.token || "",
    GH_TOKEN: config.scm?.token || "",
    MANAGER_PROVIDER: techLeadConfig.provider,
    MANAGER_MODEL: techLeadConfig.model,
    JIRA_SUMMARY: task.summary || "",
    JIRA_DESCRIPTION: task.description || "",
    JIRA_ISSUE_KEY: task.jira_issue_key || "",
    TICKET_SYSTEM: issueTracker?.provider || "internal",
    JIRA_BASE_URL: issueTracker?.jira?.baseUrl || "",
    JIRA_EMAIL: issueTracker?.jira?.email || "",
    JIRA_API_TOKEN: issueTracker?.jira?.apiToken || "",
    LINEAR_API_KEY: issueTracker?.linear?.apiKey || "",
  };

  // Set LLM API key for the tech lead role
  const techLeadKey = resolveApiKey(config, "techLead");
  if (techLeadConfig.provider === "anthropic" && techLeadKey && config.roles?.techLead?.apiKey) {
    env.ANTHROPIC_API_KEY = techLeadKey;
  } else if (techLeadConfig.provider === "openai") {
    env.OPENAI_API_KEY = techLeadKey;
  } else if (techLeadConfig.provider === "google") {
    env.GOOGLE_API_KEY = techLeadKey;
  }

  console.log(`[orchestrator] Spawning manager review: ${command} (task: ${taskId}, PR: ${prUrl})`);

  const child = spawn(command, args, {
    env,
    cwd: workDir,
    stdio: ["pipe", "pipe", "pipe"],
    detached: false,
  });

  // Track as active worker (using manager- prefix to avoid collision)
  const managerKey = `manager-${taskId}`;
  activeWorkers.set(managerKey, {
    taskId: managerKey,
    process: child,
    startedAt: Date.now(),
  });

  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString("utf-8").trim();
    if (line) {
      try {
        getDb().prepare(
          "INSERT INTO task_logs (task_id, type, message, severity) VALUES (?, ?, ?, ?)"
        ).run(taskId, "manager_review", line, "info");
      } catch { /* ignore */ }
      emitStreamEvent(`logs:${taskId}`, "log", {
        taskId,
        message: `[Manager] ${line}`,
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
        ).run(taskId, "manager_review", line, "error");
      } catch { /* ignore */ }
    }
  });

  child.on("exit", (exitCode) => {
    console.log(`[orchestrator] Manager review exited for task ${taskId} with code ${exitCode}`);
    activeWorkers.delete(managerKey);

    const db = getDb();
    // Manager exit handling — check what the manager decided
    // The manager-complete endpoint updates the task status already,
    // so we only handle the case where the manager crashed
    const currentTask = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as any;
    if (currentTask?.status === "reviewing") {
      // Manager didn't update status — treat as completed (review skipped)
      db.prepare(
        "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      ).run(taskId);
      emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "completed" });
    }

    // Trigger cascade and next queued
    triggerDependentCards(taskId);
    processNextQueued();
  });
}

/**
 * Process a task through the planning pipeline before execution.
 * Transitions: queued → planning → (planner runs) → queued (with plan) → executing
 *
 * The planner talks to the local API endpoints:
 * - GET /api/agent/planning-prompt (returns assembled prompt)
 * - POST /api/agent/plan-result (stores approved plan, re-queues task)
 * - POST /api/agent/plan-failed (marks task as failed)
 *
 * After planning completes, the plan-result endpoint sets the task back to 'queued'
 * with an execution_plan, and calls processQueuedTask() to resume normal execution.
 */
export async function planAndProcessTask(taskId: string): Promise<void> {
  const db = getDb();

  // Transition to planning
  const result = db.prepare(
    "UPDATE tasks SET status = 'planning', updated_at = datetime('now') WHERE id = ? AND status = 'queued'",
  ).run(taskId);

  if (result.changes === 0) return;

  emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "planning" });

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
  if (!task) return;

  try {
    // Dynamic import to avoid circular dependency (planner imports api, api may not be initialized at import time)
    const { planTask } = await import("../../planner.js");
    const { loadConfig: loadAgentConfig } = await import("../../config.js");

    // Build a minimal PlanningTask for the planner
    const planningTask = {
      id: taskId,
      summary: task.summary || "",
      description: task.description || "",
      githubRepo: task.github_repo || undefined,
      scmProvider: task.scm_provider || undefined,
    };

    // Load agent config (needed for Claude CLI path, tokens, etc.)
    let agentConfig;
    try {
      agentConfig = loadAgentConfig();
    } catch {
      // Standalone may not have full agent config — build minimal one
      const config = loadStandaloneConfig();
      agentConfig = {
        apiUrl: `http://127.0.0.1:${localApiPort}`,
        apiKey: "standalone",
        agentId: "standalone",
        maxWorkers: config.settings?.maxParallelExperts ?? 8,
        pollIntervalMs: 5000,
        heartbeatIntervalMs: 30000,
        githubToken: config.scm?.token || "",
        bitbucketToken: config.scm?.token || "",
        gitlabToken: "",
        githubReviewerToken: "",
        sandbox: "none" as const,
        dockerImage: "",
        dockerMemoryGb: 4,
        localRag: false,
        ollamaPort: 11434,
      };
    }

    const success = await planTask(planningTask, agentConfig);

    if (!success) {
      console.log(`[orchestrator] Planning failed for task ${taskId}`);
      // planTask already called plan-failed endpoint which updated status
    }
    // On success, plan-result endpoint already set task back to queued and called processQueuedTask
  } catch (err) {
    console.error(`[orchestrator] Planning error for task ${taskId}:`, err);
    db.prepare(
      "UPDATE tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?",
    ).run(taskId);
    emitStreamEvent("org:local:tasks", "task_state", { taskId, status: "failed", error: String(err) });
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
