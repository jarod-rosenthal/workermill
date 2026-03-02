/**
 * Agent Local API Server
 *
 * Lightweight HTTP + SSE server that exposes agent state to local clients
 * (VS Code extension, CLI tools, etc). Binds to localhost only.
 *
 * Discovery: writes port to ~/.workermill/agent.port
 * Auth: Bearer token from ~/.workermill/agent.token (0o600 permissions)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { EventEmitter } from "events";
import { AGENT_VERSION } from "./version.js";
import { findClaudePath, type AgentConfig } from "./config.js";
import { triggerPoll } from "./poller.js";
import { detectGpu } from "./gpu-detector.js";
import { getOllamaStatus, generateEmbeddings, ensureOllamaRunning, pullModel, installOllama, findOllamaPath } from "./ollama-manager.js";
import { indexRepositoryLocally } from "./local-indexer.js";
import { getActiveBackend, getBackend } from "./backends/selector.js";
import { processQueuedTask, planAndProcessTask, stopWorkerTask } from "./backends/local/orchestrator.js";
import { loadStandaloneConfig, getRoleConfig } from "./backends/local/config.js";
import { getDb as getLocalDb, generateId } from "./backends/local/db.js";
import { onStreamEvent } from "./backends/local/event-bus.js";
import {
  searchJiraIssues,
  listJiraProjects,
  searchLinearIssues,
  listLinearTeams,
  searchGitHubIssues,
  listGitHubRepos,
} from "./issue-fetchers.js";
// Decision engine — pure functions from the API service, bundled by esbuild.
// @ts-ignore — esbuild resolves cross-package imports at bundle time (outside tsc rootDir)
import { classifyError, evaluateQuality, parseReviewOutcome, routeQuestion, routeProvider, getWorkerConfig } from "../../api/src/services/worker-decision-engine.js";

// ── Types ──────────────────────────────────────────────

export interface LocalTaskInfo {
  id: string;
  parentTaskId?: string;
  summary: string;
  description?: string;
  status: "planning" | "running" | "completed" | "failed" | "cancelled" | "pr_approved" | "escalated";
  persona?: string;
  model?: string;
  repo?: string;
  startedAt: string;
  cost?: number;
}

export interface AgentState {
  version: string;
  agentId: string;
  apiUrl: string;
  uptime: number;
  sandbox: "none" | "docker";
  tasks: LocalTaskInfo[];
}

type SSEClient = {
  res: ServerResponse;
  channel: string;
};

// ── Event Bus ──────────────────────────────────────────

/**
 * Global event bus for agent state changes.
 * Modules (spawner, poller) emit events here.
 * SSE streams subscribe to relevant events.
 */
export const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(100);

// Event types:
//   "task:started"       { id, summary, description?, persona, model, repo }
//   "task:completed"     { id, exitCode }
//   "task:failed"        { id, exitCode, error }
//   "task:rate_limited"  { id }
//   "task:log"           { id, line, severity }
//   "task:planning"      { id, summary, description? }
//   "task:plan_done"     { id, success }
//   "state:changed"      {} (generic — triggers full state refresh for clients)

// ── State Registry ─────────────────────────────────────

/**
 * Tracks tasks known to the local API.
 * Populated by event handlers, read by HTTP endpoints.
 */
const localTasks = new Map<string, LocalTaskInfo>();

// ── Coordination Store (standalone mode) ──────────────
// In-memory context store per task. Mirrors the cloud coordination API.
// When first queried, hydrates story_ready messages from:
//   1. EXECUTION_PLAN (if task was decomposed) — full stories with personas,
//      dependencies, targetFiles, mutexGroups (same logic as publishStoriesReady)
//   2. Task summary/description (single-story fallback)

interface CoordContext {
  id: string;
  parentTaskId: string;
  taskId: string;
  persona: string;
  messageType: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface CoordStore {
  contexts: CoordContext[];
  initialized: boolean;
}

const coordStores = new Map<string, CoordStore>();

// SSE clients subscribed to coordination streams (for real-time push)
const coordSseClients = new Map<string, Set<ServerResponse>>();

function getCoordStore(taskId: string): CoordStore {
  let store = coordStores.get(taskId);
  if (store) return store;

  store = { contexts: [], initialized: false };
  coordStores.set(taskId, store);

  try {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      const db = getLocalDb();
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
      if (task) {
        // Check for execution plan (from PRD decomposition or planning)
        let plan: { steps?: Array<Record<string, unknown>> } | null = null;
        if (task.execution_plan) {
          try {
            plan = JSON.parse(String(task.execution_plan));
          } catch { /* invalid JSON, fall through to single-story */ }
        }

        if (plan?.steps?.length) {
          // Hydrate stories from execution plan — same logic as publishStoriesReady()
          hydrateStoriesFromPlan(store, taskId, plan.steps);
        } else {
          // Single story fallback — use task summary/description
          store.contexts.push({
            id: `story-${taskId.slice(0, 8)}`,
            parentTaskId: taskId,
            taskId,
            persona: "backend_developer",
            messageType: "story_ready",
            content: String(task.summary || "Implement task"),
            metadata: {
              storyIndex: 0,
              persona: "backend_developer",
              description: String(task.description || task.summary || ""),
              dependencies: [],
              targetFiles: [],
              mutexGroups: [],
            },
            createdAt: new Date().toISOString(),
          });
        }

        // Hydrate persisted coordination messages from SQLite
        // These are messages posted during previous execution (survives restarts)
        try {
          const persisted = db.prepare(
            "SELECT * FROM coordination_messages WHERE parent_task_id = ? ORDER BY created_at ASC",
          ).all(taskId) as any[];
          for (const row of persisted) {
            // Avoid duplicating story_ready messages already hydrated from execution_plan
            if (row.message_type === "story_ready") continue;
            let content = row.content || "";
            try { content = JSON.parse(content); content = JSON.stringify(content); } catch { /* keep as-is */ }
            store.contexts.push({
              id: `db-${row.id}`,
              parentTaskId: row.parent_task_id,
              taskId: row.task_id || taskId,
              persona: "",
              messageType: row.message_type,
              content: typeof content === "string" ? content : JSON.stringify(content),
              metadata: {},
              createdAt: row.created_at,
            });
          }
        } catch { /* SQLite read failed — proceed with what we have */ }

        store.initialized = true;
      }
    }
  } catch {
    // If we can't read the task, create a minimal story
    if (!store.initialized) {
      store.contexts.push({
        id: `story-${taskId.slice(0, 8)}`,
        parentTaskId: taskId,
        taskId,
        persona: "backend_developer",
        messageType: "story_ready",
        content: "Implement task",
        metadata: {
          storyIndex: 0,
          persona: "backend_developer",
          description: "",
          dependencies: [],
          targetFiles: [],
          mutexGroups: [],
        },
        createdAt: new Date().toISOString(),
      });
      store.initialized = true;
    }
  }

  return store;
}

/**
 * Hydrate story_ready messages from an execution plan.
 * Mirrors publishStoriesReady() in api/src/services/pipeline-executor.ts:
 * - Computes file-level overlap mutex groups across stories
 * - Derives directory-level mutex groups from targetFiles
 * - Assigns __unscoped__ mutex to stories without targetFiles
 * - Publishes ALL stories upfront with dependencies in metadata
 */
function hydrateStoriesFromPlan(
  store: CoordStore,
  taskId: string,
  steps: Array<Record<string, unknown>>,
): void {
  // Pre-compute file-level overlap mutex groups across all stories
  const fileOverlapMutexByStep = new Map<number, string[]>();
  for (let i = 0; i < steps.length; i++) {
    const stepA = steps[i];
    const idxA = (stepA.index as number) ?? i;
    const filesA = (stepA.targetFiles as string[]) || [];
    if (filesA.length === 0) continue;
    for (let j = i + 1; j < steps.length; j++) {
      const stepB = steps[j];
      const idxB = (stepB.index as number) ?? j;
      const filesB = (stepB.targetFiles as string[]) || [];
      if (filesB.length === 0) continue;
      const shared = filesA.filter((f) => filesB.includes(f));
      if (shared.length > 0) {
        const fileMutexes = shared.map((f) => `file:${f}`);
        fileOverlapMutexByStep.set(
          idxA,
          [...(fileOverlapMutexByStep.get(idxA) || []), ...fileMutexes],
        );
        fileOverlapMutexByStep.set(
          idxB,
          [...(fileOverlapMutexByStep.get(idxB) || []), ...fileMutexes],
        );
      }
    }
  }

  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const index = (step.index as number) ?? si;
    const persona = (step.persona as string) || "backend_developer";
    const title = (step.title as string) || "Implement step";
    const description = (step.description as string) || title;
    const targetFiles = (step.targetFiles as string[]) || [];
    const referenceFiles = (step.referenceFiles as string[]) || [];
    const verificationType = (step.verificationType as string) || undefined;
    const dependencies = (step.dependsOn as number[]) || (step.dependencies as number[]) || [];

    // Compute mutex groups (same logic as publishStoriesReady)
    let mutexGroups = (step.mutexGroups as string[]) || [];
    if (mutexGroups.length === 0 && targetFiles.length > 0) {
      const dirs = new Set<string>();
      for (const file of targetFiles) {
        const lastSlash = file.lastIndexOf("/");
        const dir = lastSlash > 0 ? file.substring(0, lastSlash) : "root";
        dirs.add(`dir:${dir}`);
      }
      mutexGroups = Array.from(dirs);
    } else if (mutexGroups.length === 0) {
      mutexGroups = ["__unscoped__"];
    }

    // Merge in file-level overlap mutex groups
    const overlapMutexes = fileOverlapMutexByStep.get(index) || [];
    if (overlapMutexes.length > 0) {
      mutexGroups = [...new Set([...mutexGroups, ...overlapMutexes])];
    }

    store.contexts.push({
      id: `story-${taskId.slice(0, 8)}-${index}`,
      parentTaskId: taskId,
      taskId,
      persona,
      messageType: "story_ready",
      content: title,
      metadata: {
        storyIndex: index,
        persona,
        title,
        description,
        targetFiles,
        referenceFiles,
        verificationType,
        dependencies,
        mutexGroups,
      },
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * Push a coordination event to all SSE subscribers for a task.
 */
function pushCoordEvent(taskId: string, context: CoordContext): void {
  const clients = coordSseClients.get(taskId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type: "context", data: context });
  for (const res of clients) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

/**
 * Fallback worker config when getWorkerConfig() fails (bundled binary
 * won't have api/data/ on disk). Same values as the decision engine constants.
 */
async function getWorkerConfigFallback(): Promise<Record<string, unknown>> {
  return {
    agentsMd: "",
    personaIcons: {
      architect: "\uD83C\uDFD7\uFE0F",
      frontend_developer: "\uD83C\uDFA8",
      backend_developer: "\uD83D\uDCBB",
      devops_engineer: "\uD83D\uDD27",
      security_engineer: "\uD83D\uDEE1\uFE0F",
      qa_engineer: "\uD83E\uDDEA",
      tech_writer: "\uD83D\uDCDD",
      project_manager: "\uD83D\uDCCB",
      data_ml_engineer: "\uD83D\uDCCA",
      mobile_developer: "\uD83D\uDCF1",
      tech_lead: "\uD83D\uDC51",
      planning_agent: "\uD83D\uDCA1",
      manager: "\uD83D\uDC54",
    },
    providerIcons: {
      anthropic: "\uD83E\uDD16",
      openai: "\uD83D\uDD37",
      google: "\uD83D\uDD35",
      gemini: "\uD83D\uDD35",
      ollama: "\uD83C\uDFE0",
    },
    reviewSchema: {
      decision: ["approved", "revision_needed", "rejected"],
      scoreRange: [1, 10],
    },
    claudeMdTemplate: "***REMOVED*** Project\n\nThis project uses TypeScript and follows standard patterns.\n",
    defaults: {
      blockerMaxAutoRetries: 3,
      maxReviewRevisions: 3,
      maxPerStoryRevisions: 1, // matches org DB default and worker env fallback
    },
  };
}

agentEvents.on("task:started", (info: { id: string; parentTaskId?: string; summary: string; description?: string; persona?: string; model?: string; repo?: string }) => {
  localTasks.set(info.id, {
    id: info.id,
    parentTaskId: info.parentTaskId,
    summary: info.summary,
    description: info.description,
    status: "running",
    persona: info.persona,
    model: info.model,
    repo: info.repo,
    startedAt: new Date().toISOString(),
  });
});

agentEvents.on("task:planning", (info: { id: string; summary: string; description?: string }) => {
  localTasks.set(info.id, {
    id: info.id,
    summary: info.summary,
    description: info.description,
    status: "planning",
    startedAt: new Date().toISOString(),
  });
});

agentEvents.on("task:completed", (info: { id: string }) => {
  const task = localTasks.get(info.id);
  if (task) task.status = "completed";
});

agentEvents.on("task:failed", (info: { id: string }) => {
  const task = localTasks.get(info.id);
  if (task) task.status = "failed";
});

agentEvents.on("task:plan_done", (info: { id: string; success: boolean }) => {
  const task = localTasks.get(info.id);
  if (task && info.success) {
    task.status = "running"; // Transitions from planning to execution
  } else if (task && !info.success) {
    task.status = "failed";
  }
});

// Clean up old completed/failed tasks after 10 minutes
let cleanupInterval: ReturnType<typeof setInterval> | null = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  let didDelete = false;
  for (const [id, task] of localTasks) {
    if ((task.status === "completed" || task.status === "failed" || task.status === "pr_approved" || task.status === "cancelled") &&
        new Date(task.startedAt).getTime() < cutoff) {
      localTasks.delete(id);
      coordStores.delete(id);
      // Close and remove any lingering coordination SSE clients
      const coordClients = coordSseClients.get(id);
      if (coordClients) {
        for (const c of coordClients) { try { c.end(); } catch { /* ignore */ } }
        coordSseClients.delete(id);
      }
      didDelete = true;
    }
  }
  // Notify connected clients about the updated task list
  if (didDelete) {
    broadcastSSE("tasks", "snapshot", Array.from(localTasks.values()));
  }
}, 60_000);

// ── SSE Management ─────────────────────────────────────

const sseClients: Set<SSEClient> = new Set();

function addSSEClient(res: ServerResponse, channel: string): SSEClient {
  const client: SSEClient = { res, channel };
  sseClients.add(client);
  res.on("close", () => sseClients.delete(client));
  return client;
}

function broadcastSSE(channel: string, event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.channel === channel || client.channel === "*") {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

// Forward agent events to SSE clients
agentEvents.on("task:started", (info) => broadcastSSE("tasks", "task:started", info));
agentEvents.on("task:completed", (info) => broadcastSSE("tasks", "task:completed", info));
agentEvents.on("task:failed", (info) => broadcastSSE("tasks", "task:failed", info));
agentEvents.on("task:rate_limited", (info) => broadcastSSE("tasks", "task:rate_limited", info));
agentEvents.on("task:planning", (info) => broadcastSSE("tasks", "task:planning", info));
agentEvents.on("task:plan_done", (info) => broadcastSSE("tasks", "task:plan_done", info));
agentEvents.on("task:log", (info) => broadcastSSE(`logs:${info.id}`, "log", info));
agentEvents.on("state:changed", () => broadcastSSE("tasks", "state:changed", {}));

// Forward local event bus (orchestrator/worker) to SSE clients
onStreamEvent((event) => {
  broadcastSSE(event.ch, event.t, event.p);
  // Also broadcast task state changes as agentEvents-style events
  if (event.ch === "org:local:tasks" && event.t === "task_state") {
    broadcastSSE("tasks", "state:changed", {});
  }
});

// ── Cloud Task Merging ─────────────────────────────────

/**
 * Map cloud task statuses (17+) to the 5 the extension understands.
 */
function mapCloudStatus(
  cloudStatus: string,
): LocalTaskInfo["status"] {
  switch (cloudStatus) {
    case "planning":
    case "pending_plan_approval":
      return "planning";
    case "queued":
    case "claimed":
    case "environment_setup":
    case "dispatching":
    case "executing":
    case "reviewing":
    case "consolidating":
    case "deploying":
      return "running";
    case "completed":
    case "deployed":
      return "completed";
    case "pr_approved":
    case "review_approved":
      return "pr_approved";
    case "escalated":
      return "escalated";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "running";
  }
}

/**
 * Merge local in-memory tasks with cloud tasks from the control center.
 * Local tasks take priority (they have real-time status from event handlers).
 * Cloud tasks fill in gaps — queued tasks, tasks where events were missed, etc.
 * Falls back to local-only on any cloud fetch error.
 */
/**
 * Get all visible tasks: in-memory + SQLite (local backend) + cloud.
 * Deduplicates by ID, with in-memory tasks taking priority.
 */
async function getAllVisibleTasks(): Promise<LocalTaskInfo[]> {
  const seenIds = new Set<string>();
  const result: LocalTaskInfo[] = [];

  // 1. In-memory tasks (real-time from event bus)
  for (const task of localTasks.values()) {
    seenIds.add(task.id);
    result.push(task);
  }

  // 2. SQLite tasks (standalone mode — orchestrator writes here)
  const backend = getActiveBackend();
  if (backend?.mode === "local") {
    try {
      const db = getLocalDb();
      const rows = db.prepare(
        "SELECT id, summary, description, status, github_repo, worker_model, created_at FROM tasks WHERE status IN ('queued','executing','completed','failed','cancelled','escalated','pr_approved') ORDER BY created_at DESC LIMIT 50"
      ).all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const id = String(row.id);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        result.push({
          id,
          summary: String(row.summary || ""),
          description: row.description ? String(row.description) : undefined,
          status: mapLocalStatus(String(row.status || "queued")),
          model: row.worker_model ? String(row.worker_model) : undefined,
          repo: row.github_repo ? String(row.github_repo) : undefined,
          startedAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
        });
      }
    } catch {
      // SQLite not available — continue with what we have
    }
  }

  // 3. Cloud tasks (if cloud proxy is available)
  if (cloudProxy) {
    try {
      const merged = await getMergedTasks();
      for (const task of merged) {
        if (!seenIds.has(task.id)) {
          seenIds.add(task.id);
          result.push(task);
        }
      }
    } catch { /* ignore cloud failures */ }
  }

  return result;
}

function mapLocalStatus(status: string): LocalTaskInfo["status"] {
  switch (status) {
    case "queued": return "running";
    case "executing": return "running";
    case "completed": return "completed";
    case "failed": return "failed";
    case "cancelled": return "cancelled";
    case "escalated": return "escalated";
    default: return "running";
  }
}

async function getMergedTasks(): Promise<LocalTaskInfo[]> {
  const localList = Array.from(localTasks.values());

  if (!cloudProxy) return localList;

  try {
    type CloudTask = {
        id: string;
        summary?: string;
        description?: string;
        status?: string;
        workerPersona?: string;
        workerModel?: string;
        githubRepo?: string;
        startedAt?: string;
        createdAt?: string;
      };
    const dashboard = (await cloudProxy("GET", "/api/control-center")) as {
      activeTasks?: CloudTask[];
      queuedTasks?: CloudTask[];
      recentCompleted?: CloudTask[];
    };

    const seenIds = new Set(localList.map((t) => t.id));
    const cloudTasks: LocalTaskInfo[] = [];

    for (const list of [dashboard.activeTasks, dashboard.queuedTasks, dashboard.recentCompleted]) {
      if (!Array.isArray(list)) continue;
      for (const ct of list) {
        if (seenIds.has(ct.id)) continue; // local takes priority, skip duplicates across lists
        seenIds.add(ct.id);
        cloudTasks.push({
          id: ct.id,
          summary: ct.summary || "Unknown task",
          description: ct.description || undefined,
          status: mapCloudStatus(ct.status || "queued"),
          persona: ct.workerPersona || undefined,
          model: ct.workerModel || undefined,
          repo: ct.githubRepo || undefined,
          startedAt: ct.startedAt || ct.createdAt || new Date().toISOString(),
        });
      }
    }

    return [...localList, ...cloudTasks];
  } catch {
    // Cloud fetch failed — fall back to local-only silently
    return localList;
  }
}

// ── HTTP Routing ───────────────────────────────────────

/** Get active backend, lazy-initializing if needed (handles startup race). */
async function ensureBackend() {
  const b = getActiveBackend();
  if (b) return b;
  try { return await getBackend(); } catch { return null; }
}

function parseUrl(url: string): { path: string; params: Record<string, string> } {
  const [pathPart, queryPart] = url.split("?");
  const params: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      const [k, v] = pair.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return { path: pathPart, params };
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(data));
}

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();
}

function notFound(res: ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ── Server Config ──────────────────────────────────────

let agentConfig: AgentConfig | null = null;
let startTime = 0;

// Cloud API proxy function — set by the integration module
let cloudProxy: ((method: string, path: string, body?: unknown) => Promise<unknown>) | null = null;

export function setCloudProxy(fn: (method: string, path: string, body?: unknown) => Promise<unknown>): void {
  cloudProxy = fn;
}

// ── Request Handler ────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // No CORS — local API is accessed via Node.js http (VS Code extension), not browsers.
  // Reject preflight requests to prevent browser-based attacks.
  if (req.method === "OPTIONS") {
    res.writeHead(403);
    res.end();
    return;
  }

  // Authenticate: require Bearer token or x-api-key matching agent.token
  if (authToken) {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (authHeader === `Bearer ${authToken}` || apiKey === authToken) {
      // Authenticated
    } else {
      return json(res, { error: "Unauthorized" }, 401);
    }
  }

  const { path } = parseUrl(req.url || "/");

  // ── GET endpoints ──

  if (req.method === "GET" && path === "/api/status") {
    const backend = getActiveBackend();
    const tasks = await getAllVisibleTasks();
    const state: AgentState & { mode?: string } = {
      version: AGENT_VERSION,
      agentId: agentConfig?.agentId || "unknown",
      apiUrl: agentConfig?.apiUrl || "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      sandbox: agentConfig?.sandbox || "none",
      tasks,
      mode: backend?.mode || "cloud",
    };
    return json(res, state);
  }

  if (req.method === "GET" && path === "/api/tasks") {
    const merged = await getAllVisibleTasks();
    return json(res, merged);
  }

  // GET /api/tasks/:id
  const taskMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
  if (req.method === "GET" && taskMatch) {
    const task = localTasks.get(taskMatch[1]);
    if (task) return json(res, task);
    // Fall through to SQLite for worker-spawned tasks
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskMatch[1]) as Record<string, unknown> | undefined;
        if (row) {
          return json(res, {
            id: row.id,
            summary: row.summary || "",
            description: row.description || "",
            status: row.status,
            github_repo: row.github_repo,
          });
        }
      } catch { /* fall through to 404 */ }
    }
    return json(res, { error: "Task not found" }, 404);
  }

  // GET /api/tasks/:id/coordination — proxy coordination feed from cloud
  const coordMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/coordination$/);
  if (req.method === "GET" && coordMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", `/api/coordination/context/${coordMatch[1]}?limit=200`);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/tasks/:id/detail — local SQLite or cloud control center
  const detailMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/detail$/);
  if (req.method === "GET" && detailMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const task = await backend.getTask(detailMatch[1]);
        if (!task) return json(res, { error: "Task not found" }, 404);
        return json(res, task);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const dashboard = await cloudProxy("GET", "/api/control-center") as {
        activeTasks?: Array<{ id: string }>;
        queuedTasks?: Array<{ id: string }>;
        recentCompleted?: Array<{ id: string }>;
      };
      const taskId = detailMatch[1];
      const found =
        dashboard.activeTasks?.find((t) => t.id === taskId) ||
        dashboard.queuedTasks?.find((t) => t.id === taskId) ||
        dashboard.recentCompleted?.find((t) => t.id === taskId);
      if (!found) return json(res, { error: "Task not found in dashboard" }, 404);
      return json(res, found);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/tasks/:id/logs — local SQLite or cloud proxy
  const logsMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "GET" && logsMatch) {
    const backend = getActiveBackend();
    // Standalone mode — read from SQLite task_logs
    if (backend?.mode === "local") {
      try {
        const { params: qp } = parseUrl(req.url || "");
        const since = qp.since || undefined;
        const lim = parseInt(qp.limit || "500", 10);
        const result = await backend.getLogBackfill(logsMatch[1], since, lim);
        return json(res, result.data);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Cloud mode — proxy to cloud API
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const { params: qp } = parseUrl(req.url || "");
      const since = qp.since || "";
      const limit = qp.limit || "500";
      let apiPath = `/api/control-center/logs/${logsMatch[1]}/all?limit=${limit}`;
      if (since) apiPath += `&since=${encodeURIComponent(since)}`;
      const result = await cloudProxy("GET", apiPath);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/tasks/:id/code-events — local SQLite or cloud proxy
  const codeEventsMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/code-events$/);
  if (req.method === "GET" && codeEventsMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const { params: qp } = parseUrl(req.url || "");
        const since = qp.since || undefined;
        const result = await backend.getCodeBackfill(codeEventsMatch[1], since);
        return json(res, result.data);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const { params: qp } = parseUrl(req.url || "");
      const since = qp.since || "";
      let apiPath = `/api/control-center/code-events/${codeEventsMatch[1]}`;
      if (since) apiPath += `?since=${encodeURIComponent(since)}`;
      const result = await cloudProxy("GET", apiPath);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── SSE streams ──

  if (req.method === "GET" && path === "/api/stream/tasks") {
    sseHeaders(res);
    addSSEClient(res, "tasks");
    // Send initial state (includes SQLite + in-memory + cloud tasks)
    getAllVisibleTasks().then((merged) => {
      try { res.write(`event: snapshot\ndata: ${JSON.stringify(merged)}\n\n`); } catch { /* client gone */ }
    }).catch(() => {
      try { res.write(`event: snapshot\ndata: ${JSON.stringify(Array.from(localTasks.values()))}\n\n`); } catch { /* client gone */ }
    });
    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); }
    }, 30_000);
    res.on("close", () => clearInterval(keepAlive));
    return;
  }

  // SSE /api/stream/logs/:taskId
  const logStreamMatch = path.match(/^\/api\/stream\/logs\/([a-f0-9-]+)$/);
  if (req.method === "GET" && logStreamMatch) {
    sseHeaders(res);
    addSSEClient(res, `logs:${logStreamMatch[1]}`);
    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); }
    }, 30_000);
    res.on("close", () => clearInterval(keepAlive));
    return;
  }

  // SSE /api/stream/coordination/:taskId
  const coordStreamMatch = path.match(/^\/api\/stream\/coordination\/([a-f0-9-]+)$/);
  if (req.method === "GET" && coordStreamMatch) {
    sseHeaders(res);
    addSSEClient(res, `coordination:${coordStreamMatch[1]}`);
    const keepAlive = setInterval(() => {
      try { res.write(": keepalive\n\n"); } catch { clearInterval(keepAlive); }
    }, 30_000);
    res.on("close", () => clearInterval(keepAlive));
    return;
  }

  // SSE /api/stream/rag — indexing progress, completion, and error events
  if (req.method === "GET" && path === "/api/stream/rag") {
    sseHeaders(res);
    addSSEClient(res, "rag");
    const keepAlive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepAlive);
      }
    }, 30_000);
    res.on("close", () => clearInterval(keepAlive));
    return;
  }

  // ── POST commands ──

  // POST /api/tasks/run — create a task via the cloud API or local backend
  if (req.method === "POST" && path === "/api/tasks/run") {
    const backend = await ensureBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));

        // Handle card run via jiraIssueKey (standalone: "***REMOVED***N" or card/board IDs)
        if (body.jiraIssueKey || body._cardId) {
          const cardId = body._cardId;
          const boardId = body._boardId;
          if (cardId && boardId) {
            const task = await backend.runCard(boardId, cardId);
            processQueuedTask(task.id).catch((e) => console.error("[orchestrator] processQueuedTask failed:", e));
            return json(res, task, 201);
          }
          // Fallback: find card by key like "***REMOVED***3"
          const keyMatch = String(body.jiraIssueKey).match(/^***REMOVED***(\d+)$/);
          if (keyMatch) {
            const db = (await import("./backends/local/db.js")).getDb();
            const card = db.prepare(
              "SELECT c.id, c.board_id FROM cards c WHERE c.card_number = ?",
            ).get(parseInt(keyMatch[1], 10)) as any;
            if (card) {
              const task = await backend.runCard(card.board_id, card.id);
              processQueuedTask(task.id).catch((e) => console.error("[orchestrator] processQueuedTask failed:", e));
              return json(res, task, 201);
            }
          }
          return json(res, { error: "Card not found" }, 404);
        }

        const task = await backend.createTask({
          summary: body.summary,
          description: body.description,
          githubRepo: body.githubRepo || body.repo,
          scmProvider: body.scmProvider,
          workerModel: body.workerModel,
        });
        // If plan=true, run through planner first; otherwise execute directly
        if (body.plan) {
          planAndProcessTask(task.id).catch((e) => console.error("[orchestrator] planAndProcessTask failed:", e));
        } else {
          processQueuedTask(task.id).catch((e) => console.error("[orchestrator] processQueuedTask failed:", e));
        }
        return json(res, task, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", "/api/tasks", body);
      // Trigger immediate poll so agent discovers the new task right away
      triggerPoll();
      return json(res, result, 201);
    } catch (err: unknown) {
      const e = err as { status?: number; data?: unknown; message?: string };
      const status = e.status || 500;
      if (e.data) return json(res, e.data, status);
      return json(res, { error: e.message || String(err) }, status);
    }
  }

  // POST /api/tasks/run-file — create a Quick Tasks card + run as worker task
  if (req.method === "POST" && path === "/api/tasks/run-file") {
    const backend = await ensureBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const config = (await import("./backends/local/config.js")).loadStandaloneConfig();
        const workerConfig = (await import("./backends/local/config.js")).getRoleConfig(config, "worker");
        const task = await backend.createTask({
          summary: body.summary,
          description: body.description,
          githubRepo: body.githubRepo || config.defaultRepo,
          scmProvider: config.scm?.provider,
          workerModel: workerConfig.model,
        });
        processQueuedTask(task.id).catch((e) => console.error("[run-file] processQueuedTask failed:", e));
        return json(res, task, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", "/api/tasks/run-file", body);
      triggerPoll();
      return json(res, result, 201);
    } catch (err: unknown) {
      const e = err as { status?: number; data?: unknown; message?: string };
      const status = e.status || 500;
      if (e.data) return json(res, e.data, status);
      return json(res, { error: e.message || String(err) }, status);
    }
  }

  // GET /api/repos — lightweight repos endpoint for VS Code repo picker
  if (req.method === "GET" && path === "/api/repos") {
    const backend = await ensureBackend();
    if (backend?.mode === "local") {
      try {
        const repos = await backend.getRepos();
        return json(res, {
          repos: repos.map(r => r.url),
          defaultRepo: repos.find(r => r.isDefault)?.url || null,
          scmProvider: (await backend.getSettings()).scmProvider || "github",
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const settings = await cloudProxy("GET", "/api/settings") as Record<string, unknown>;
      const repos = (settings?.repositories ?? []) as string[];
      const scmProvider = (settings?.scmProvider ?? "github") as string;
      let defaultRepo: string | null = null;
      if (scmProvider === "bitbucket") {
        defaultRepo = (settings?.defaultBitbucketRepo as string) || null;
      } else if (scmProvider === "gitlab") {
        defaultRepo = (settings?.defaultGitlabRepo as string) || null;
      } else {
        defaultRepo = (settings?.defaultGithubRepo as string) || null;
      }
      return json(res, { repos, defaultRepo, scmProvider });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/prd/build — decompose PRD locally with SSE streaming
  if (req.method === "POST" && path === "/api/prd/build") {
    const backend = getActiveBackend();
    if (!backend && !cloudProxy) return json(res, { error: "No backend available" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const prdContent = body.content;
      if (!prdContent || typeof prdContent !== "string" || !prdContent.trim()) {
        return json(res, { error: "content is required" }, 400);
      }

      // Switch to SSE mode for real-time progress
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendEvent = (type: string, data: unknown) => {
        res.write(`data: ${JSON.stringify({ type, ...data as Record<string, unknown> })}\n\n`);
      };

      // Fetch planning agent config
      let planningConfig: { provider: string; model: string; apiKey?: string } = {
        provider: "anthropic",
        model: "",
      };
      if (backend?.mode === "local") {
        // Standalone: read from local config
        const { loadStandaloneConfig: lsc, getRoleConfig: grc, resolveApiKey: rak } = await import("./backends/local/config.js");
        const sc = lsc();
        const plannerRole = grc(sc, "planner");
        planningConfig = { provider: plannerRole.provider, model: plannerRole.model, apiKey: rak(sc, "planner") };
      } else if (cloudProxy) {
        // Cloud: fetch from server
        try {
          const settings = await cloudProxy("GET", "/api/settings") as Record<string, unknown>;
          if (settings?.planningAgentProvider) planningConfig.provider = settings.planningAgentProvider as string;
          if (settings?.planningAgentModel) planningConfig.model = settings.planningAgentModel as string;
          if (settings?.planningApiKey) planningConfig.apiKey = settings.planningApiKey as string;
        } catch { /* fall back to defaults */ }
      }

      // Fetch PRD system prompt from the API (single source of truth)
      let prdSystemPrompt: string | undefined;
      if (cloudProxy) {
        try {
          const promptData = await cloudProxy("GET", "/api/agent/prd-prompt") as { systemPrompt?: string };
          if (promptData?.systemPrompt) {
            prdSystemPrompt = promptData.systemPrompt;
            sendEvent("progress", { message: `Fetched PRD prompt from server` });
          }
        } catch {
          sendEvent("progress", { message: `Using local PRD prompt (server unavailable)` });
        }
      }

      sendEvent("progress", { message: `Starting PRD decomposition...` });

      // Decompose PRD locally — routes to Claude Agent SDK (Anthropic) or Vercel AI SDK (others)
      const decomposed = await decomposePrdLocal(prdContent, planningConfig, prdSystemPrompt, (msg) => {
        sendEvent("progress", { message: msg });
      });

      sendEvent("progress", { message: `Creating board with ${decomposed.cards.length} cards...` });

      if (backend?.mode === "local") {
        // Standalone: create board directly in SQLite
        const board = await backend.createBoard({ name: decomposed.boardName, description: `Generated from PRD` });
        const backlogCol = board.columns.find(c => c.name === "Backlog")!;
        const cardIds: string[] = [];

        for (let i = 0; i < decomposed.cards.length; i++) {
          const c = decomposed.cards[i] as any;
          const card = await backend.createCard(board.id, {
            columnId: backlogCol.id,
            title: c.title,
            description: c.description,
            priority: c.priority || "medium",
            position: i,
          });
          cardIds.push(card.id);
        }

        // Create dependencies
        const db = (await import("./backends/local/db.js")).getDb();
        for (let i = 0; i < decomposed.cards.length; i++) {
          const c = decomposed.cards[i] as any;
          if (Array.isArray(c.dependencyIndices)) {
            for (const depIdx of c.dependencyIndices) {
              if (depIdx >= 0 && depIdx < cardIds.length) {
                db.prepare(
                  "INSERT INTO card_dependencies (id, card_id, depends_on_card_id) VALUES (?, ?, ?)",
                ).run(generateId(), cardIds[i], cardIds[depIdx]);
              }
            }
          }
        }

        // Store quality gates on board
        if ((decomposed as any).qualityGates) {
          db.prepare("UPDATE boards SET quality_gate_commands = ? WHERE id = ?")
            .run(JSON.stringify((decomposed as any).qualityGates), board.id);
        }
        if ((decomposed as any).ciWorkflowPath) {
          db.prepare("UPDATE boards SET ci_workflow_path = ? WHERE id = ?")
            .run((decomposed as any).ciWorkflowPath, board.id);
        }

        sendEvent("done", {
          result: { boardId: board.id, boardName: board.name, cardCount: cardIds.length },
        });
      } else {
        // Cloud: send pre-decomposed cards to cloud API to create the board
        const result = await cloudProxy!("POST", "/api/prd/decompose", {
          ...body,
          preDecomposed: decomposed,
        });
        sendEvent("done", { result });
      }
      res.end();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: unknown; message?: string };
      const errDetail = e.data
        ? JSON.stringify(e.data)
        : err instanceof Error ? err.message : String(err);
      console.error("[local-api] PRD build error:", errDetail);

      // If headers already sent (SSE mode), send error event
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", error: errDetail })}\n\n`);
        res.end();
        return;
      } else {
        const status = e.status || 500;
        if (e.data) return json(res, e.data, status);
        return json(res, { error: errDetail }, status);
      }
    }
    return; // Response already ended in try or catch
  }

  // ── Agent Planning Endpoints (standalone mode) ──

  // GET /api/agent/planning-prompt — assemble planning prompt for a task
  if (req.method === "GET" && path === "/api/agent/planning-prompt") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const taskId = new URL(req.url || "", "http://localhost").searchParams.get("taskId");
        if (!taskId) return json(res, { error: "taskId query parameter is required" }, 400);

        const db = getLocalDb();
        const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
        if (!task) return json(res, { error: "Task not found" }, 404);
        if (task.status !== "planning") {
          return json(res, { error: `Task is in '${task.status}' state, expected 'planning'` }, 409);
        }

        const config = loadStandaloneConfig();
        const maxStories = config.settings?.maxStories ?? 8;
        const plannerConfig = getRoleConfig(config, "planner");

        // Get available personas from worker-config
        let validPersonas: string[] = [];
        try {
          const wc = await getWorkerConfig();
          validPersonas = Object.keys(wc.personaIcons || {});
        } catch { /* use defaults below */ }

        // Build a planning prompt from task data
        const prompt = `You are a technical planning agent. Your job is to analyze a task and break it down into executable stories.

***REMOVED******REMOVED*** Task Details

**Title:** ${task.summary || "Unnamed Task"}

**Description:**
${task.description || "No description provided."}

***REMOVED******REMOVED*** Instructions

**EXPLORE FIRST:** Before creating your plan, use your tools to explore the repository. Run Glob to see the directory structure, read key files (package.json, README, config files), and search for code related to the task. Ground your targetFiles in actual paths you discovered — do NOT guess file paths.

Then analyze this task and create an execution plan with stories. For each story, provide: id, title, a 2-3 line scope description, persona, priority, estimatedEffort, dependencies, and targetFiles.

***REMOVED******REMOVED*** Available Personas

You MUST use one of these exact persona values for each story:

- \`architect\` — System decomposition, task planning, architecture design
- \`backend_developer\` — REST APIs, database, server-side logic, GraphQL, OpenAPI, query optimization
- \`frontend_developer\` — React, TypeScript, Tailwind, UI components, accessibility
- \`mobile_developer\` — iOS (Swift, SwiftUI), Android (Kotlin, Jetpack Compose), React Native
- \`devops_engineer\` — Terraform, Docker, CI/CD, AWS, infrastructure
- \`security_engineer\` — OWASP, vulnerability assessment, security auditing
- \`qa_engineer\` — Test automation, Playwright, Jest, quality assurance
- \`data_ml_engineer\` — ETL/ELT, data pipelines, ML model training, MLOps
- \`tech_writer\` — Documentation, API docs, technical guides
- \`tech_lead\` — Code review, architecture review, quality gate
- \`project_manager\` — Task breakdown, planning, coordination

Do NOT invent personas (e.g., "fullstack_developer" does not exist). For full-stack work, split into \`backend_developer\` and \`frontend_developer\` stories.

***REMOVED******REMOVED*** Planning Advice

- **No circular dependencies.** If A depends on B, B must not depend on A (directly or transitively).
- **No operational stories.** \`npm install\`, etc. are NOT stories — include them as pre-step instructions in the story that needs the output.
- **Maximize parallelism via persona diversity.** Each unique persona runs as a separate parallel expert.
- **targetFiles must be COMPLETE.** List EVERY file the story will create or modify.
- **No overlapping targetFiles.** Two stories MUST NOT list the same file in their targetFiles.
- **Target ${Math.max(1, Math.round(maxStories * 0.7))}-${maxStories} stories.** Prefer fewer, well-scoped stories over many small ones.

***REMOVED******REMOVED*** Output Format — YOU MUST OUTPUT THIS JSON

After exploring the repo, output a \`\`\`json code block with this EXACT structure:

\`\`\`json
{
  "summary": "Brief summary of the overall plan",
  "stories": [
    {
      "id": "story-0",
      "title": "Foundation — shared types and config",
      "description": "Shared layout and type definitions.",
      "persona": "backend_developer",
      "priority": 1,
      "estimatedEffort": "small",
      "dependencies": [],
      "targetFiles": ["src/types/feature.ts", "src/config.ts"]
    }
  ],
  "risks": ["Risk 1"],
  "assumptions": ["Assumption 1"]
}
\`\`\`
`;

        // Extract preComputedStories from jiraFields if present
        let jiraFields: Record<string, unknown> = {};
        try {
          jiraFields = task.jira_fields ? JSON.parse(task.jira_fields) : {};
        } catch { /* ignore malformed JSON */ }
        const preComputedStories = Array.isArray(jiraFields.preComputedStories) && jiraFields.preComputedStories.length > 0
          ? jiraFields.preComputedStories
          : undefined;

        return json(res, {
          taskId,
          prompt,
          model: plannerConfig.model,
          provider: plannerConfig.provider,
          maxStories,
          maxTargetFiles: 8,
          planningMode: "strict",
          validPersonas,
          ...(preComputedStories ? { preComputedStories } : {}),
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Cloud proxy fallback
    if (cloudProxy) {
      try {
        const qs = new URL(req.url || "", "http://localhost").search;
        const data = await cloudProxy("GET", `/api/agent/planning-prompt${qs}`);
        return json(res, data);
      } catch (err: any) {
        return json(res, err.data || { error: String(err) }, err.status || 503);
      }
    }
    return json(res, { error: "No backend available" }, 503);
  }

  // POST /api/agent/plan-result — store approved plan on task
  if (req.method === "POST" && path === "/api/agent/plan-result") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { taskId, rawOutput, criticScore, criticIterations } = body;
        if (!taskId || !rawOutput) return json(res, { error: "taskId and rawOutput are required" }, 400);

        const db = getLocalDb();

        // Parse execution plan from raw output (reuse plan-validator.ts logic)
        const { parseExecutionPlan, applyFileCap, applyStoryCap, resolveFileOverlaps, fixInvalidPersonas } = await import("./plan-validator.js");
        const rawPlan = parseExecutionPlan(rawOutput);

        // Apply safety caps
        const config = loadStandaloneConfig();
        const maxStories = config.settings?.maxStories ?? 8;
        applyStoryCap(rawPlan, maxStories);
        applyFileCap(rawPlan);
        resolveFileOverlaps(rawPlan);
        fixInvalidPersonas(rawPlan, [
          "architect", "backend_developer", "frontend_developer", "mobile_developer",
          "devops_engineer", "security_engineer", "qa_engineer", "data_ml_engineer",
          "tech_writer", "tech_lead", "project_manager",
        ]);

        // Store execution plan and transition to queued
        const planJson = JSON.stringify(rawPlan);
        const result = db.prepare(
          "UPDATE tasks SET execution_plan = ?, status = 'queued', updated_at = datetime('now') WHERE id = ? AND status = 'planning'",
        ).run(planJson, taskId);

        if (result.changes === 0) {
          return json(res, { error: "Task not in planning status" }, 409);
        }

        broadcastSSE("tasks", "state:changed", { taskId, status: "queued" });

        // Re-trigger processing — task is now queued with a plan
        processQueuedTask(taskId).catch(() => {});

        return json(res, { success: true, taskId, stories: rawPlan.stories.length, criticScore });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Cloud proxy fallback
    if (cloudProxy) {
      try {
        const body = JSON.parse(await readBody(req));
        const data = await cloudProxy("POST", "/api/agent/plan-result", body);
        return json(res, data);
      } catch (err: any) {
        return json(res, err.data || { error: String(err) }, err.status || 503);
      }
    }
    return json(res, { error: "No backend available" }, 503);
  }

  // POST /api/agent/plan-failed — mark planning as failed
  if (req.method === "POST" && path === "/api/agent/plan-failed") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { taskId, reason, status } = body;
        if (!taskId) return json(res, { error: "taskId is required" }, 400);

        const db = getLocalDb();
        const finalStatus = status === "escalated" ? "failed" : (status || "failed");
        db.prepare(
          "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
        ).run(finalStatus, taskId);
        broadcastSSE("tasks", "state:changed", { taskId, status: finalStatus, error: reason });

        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Cloud proxy fallback
    if (cloudProxy) {
      try {
        const body = JSON.parse(await readBody(req));
        const data = await cloudProxy("POST", "/api/agent/plan-failed", body);
        return json(res, data);
      } catch (err: any) {
        return json(res, err.data || { error: String(err) }, err.status || 503);
      }
    }
    return json(res, { error: "No backend available" }, 503);
  }

  // POST /api/agent/planning-progress — log planning progress (no-op in standalone, planner prints to console)
  if (req.method === "POST" && path === "/api/agent/planning-progress") {
    return json(res, { success: true });
  }

  // POST /api/control-center/logs/batch — batch log posting from planner
  if (req.method === "POST" && path === "/api/control-center/logs/batch") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const entries = body.entries || [];
        for (const entry of entries) {
          if (entry.taskId && entry.message) {
            await backend.postLog({
              taskId: entry.taskId,
              type: entry.type || "execution",
              message: entry.message,
              severity: entry.severity || "info",
            });
          }
        }
      } catch { /* best-effort */ }
    }
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/talk — send message to worker
  const talkMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/talk$/);
  if (req.method === "POST" && talkMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = talkMatch[1];
        // Resolve parentTaskId — Epic workers poll PARENT_TASK_ID for commands
        const localTask = localTasks.get(taskId);
        const parentId = localTask?.parentTaskId || taskId;
        // Post as user_message to in-memory coordination store + SSE push
        const store = getCoordStore(parentId);
        const ctx: CoordContext = {
          id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parentTaskId: parentId,
          taskId: parentId,
          persona: "",
          messageType: "user_message",
          content: JSON.stringify({ message: body.message || body.content }),
          metadata: {},
          createdAt: new Date().toISOString(),
        };
        store.contexts.push(ctx);
        pushCoordEvent(parentId, ctx);
        // Also persist to SQLite coordination_messages
        await backend.talkToWorker(parentId, body.message || body.content);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const localTask = localTasks.get(talkMatch[1]);
      const commandTaskId = localTask?.parentTaskId || talkMatch[1];
      const result = await cloudProxy("POST", "/api/coordination/commands", {
        taskId: commandTaskId,
        type: "message",
        content: body.message || body.content,
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/blocker — respond to blocker
  const blockerMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/blocker$/);
  if (req.method === "POST" && blockerMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = blockerMatch[1];
        const localTask = localTasks.get(taskId);
        const parentId = localTask?.parentTaskId || taskId;
        // Post blocker_resolved to in-memory coordination store + SSE push
        const store = getCoordStore(parentId);
        const ctx: CoordContext = {
          id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parentTaskId: parentId,
          taskId: parentId,
          persona: "",
          messageType: "blocker_resolved",
          content: JSON.stringify({
            blockerId: body.blockerId,
            action: body.action,
            guidance: body.guidance,
          }),
          metadata: {},
          createdAt: new Date().toISOString(),
        };
        store.contexts.push(ctx);
        pushCoordEvent(parentId, ctx);
        // Also persist to SQLite
        await backend.respondToBlocker(parentId, {
          blockerId: body.blockerId,
          action: body.action,
          guidance: body.guidance,
        });
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const localTask = localTasks.get(blockerMatch[1]);
      const parentId = localTask?.parentTaskId || blockerMatch[1];
      const result = await cloudProxy("POST", "/api/coordination/blocker-response", {
        parentTaskId: parentId,
        blockerId: body.blockerId,
        action: body.action,
        guidance: body.guidance,
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/plan/approve — local backend or cloud proxy
  const approveMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const taskId = approveMatch[1];
        await backend.approvePlan(taskId);
        // Also push to in-memory coordination store so worker picks it up
        const store = getCoordStore(taskId);
        const ctx: CoordContext = {
          id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parentTaskId: taskId,
          taskId,
          persona: "",
          messageType: "plan_approved",
          content: JSON.stringify({ approved: true }),
          metadata: {},
          createdAt: new Date().toISOString(),
        };
        store.contexts.push(ctx);
        pushCoordEvent(taskId, ctx);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", `/api/tasks/${approveMatch[1]}/plan/approve`, {});
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/plan/reject — local backend or cloud proxy
  const rejectMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = rejectMatch[1];
        await backend.rejectPlan(taskId, body.feedback || "");
        const store = getCoordStore(taskId);
        const ctx: CoordContext = {
          id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parentTaskId: taskId,
          taskId,
          persona: "",
          messageType: "plan_rejected",
          content: JSON.stringify({ feedback: body.feedback }),
          metadata: {},
          createdAt: new Date().toISOString(),
        };
        store.contexts.push(ctx);
        pushCoordEvent(taskId, ctx);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", `/api/tasks/${rejectMatch[1]}/plan/request-changes`, {
        feedback: body.feedback,
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/cancel — always kill local process, best-effort cloud update
  const cancelMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    const taskId = cancelMatch[1];

    // Always kill the local worker process first — this is the critical action
    try {
      const { stopTask } = await import("./spawner.js");
      stopTask(taskId);
    } catch { /* process may have already exited */ }

    // Update local task state so the UI reflects cancellation immediately
    const localTask = localTasks.get(taskId);
    if (localTask) localTask.status = "failed";
    agentEvents.emit("task:failed", { id: taskId });

    // Update local backend if in standalone mode
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      stopWorkerTask(taskId);
      await backend.cancelTask(taskId);
      return json(res, { success: true, message: "Task cancelled" });
    }

    // Best-effort cloud status update — don't fail if cloud is stale
    if (cloudProxy) {
      try {
        await cloudProxy("POST", `/api/tasks/${taskId}/cancel`, {});
      } catch { /* cloud may already consider it complete — that's OK */ }
    }

    return json(res, { success: true, message: "Task cancelled" });
  }

  // DELETE /api/tasks/:id — remove a completed/failed/cancelled task from SQLite
  const deleteTaskMatch = path.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "DELETE" && deleteTaskMatch) {
    const taskId = deleteTaskMatch[1];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const task = db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined;
        if (!task) return json(res, { error: "Task not found" }, 404);
        if (task.status === "executing" || task.status === "queued") {
          return json(res, { error: "Cannot delete an active task — cancel it first" }, 400);
        }
        db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
        localTasks.delete(taskId);
        coordStores.delete(taskId);
        const coordClients = coordSseClients.get(taskId);
        if (coordClients) {
          for (const c of coordClients) { try { c.end(); } catch { /* ignore */ } }
          coordSseClients.delete(taskId);
        }
        broadcastSSE("tasks", "state:changed", {});
        return json(res, { success: true });
      } catch (err: unknown) {
        return json(res, { error: String(err) }, 500);
      }
    }
    return json(res, { error: "Delete not supported in cloud mode" }, 400);
  }

  // POST /api/tasks/clear — bulk delete completed/failed/cancelled tasks
  if (req.method === "POST" && path === "/api/tasks/clear") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const result = db.prepare(
          "DELETE FROM tasks WHERE status IN ('completed', 'failed', 'cancelled')"
        ).run();
        // Clear matching entries from in-memory maps
        for (const [id, task] of localTasks) {
          if (["completed", "failed"].includes(task.status)) {
            localTasks.delete(id);
            coordStores.delete(id);
            const coordClients = coordSseClients.get(id);
            if (coordClients) {
              for (const c of coordClients) { try { c.end(); } catch { /* ignore */ } }
              coordSseClients.delete(id);
            }
          }
        }
        broadcastSSE("tasks", "state:changed", {});
        return json(res, { success: true, deleted: result.changes });
      } catch (err: unknown) {
        return json(res, { error: String(err) }, 500);
      }
    }
    return json(res, { error: "Clear not supported in cloud mode" }, 400);
  }

  // POST /api/tasks/:id/retry — local SQLite or cloud proxy
  const retryMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/retry$/);
  if (req.method === "POST" && retryMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const taskId = retryMatch[1];
        await backend.retryTask(taskId);
        // Clear in-memory coordination state for a fresh start
        coordStores.delete(taskId);
        // Re-process the now-queued task
        const { processQueuedTask } = await import("./backends/local/orchestrator.js");
        await processQueuedTask(taskId);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", `/api/tasks/${retryMatch[1]}/retry`, {});
      triggerPoll();
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/issues — search issues (board cards in standalone, Jira in cloud)
  if (req.method === "GET" && path === "/api/issues") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const { params: qp } = parseUrl(req.url || "");
        const config = loadStandaloneConfig();
        const provider = config.issueTracker?.provider || "internal";
        const filters = {
          q: qp.q,
          project: qp.project,
          status: qp.status,
          maxResults: Math.min(Number(qp.maxResults) || 20, 50),
        };

        switch (provider) {
          case "jira": {
            const creds = config.issueTracker?.jira;
            if (!creds?.baseUrl || !creds.email || !creds.apiToken) {
              return json(res, { error: "Jira not configured. Open Settings to add credentials." }, 400);
            }
            const issues = await searchJiraIssues(creds, filters);
            return json(res, { issues });
          }
          case "linear": {
            const apiKey = config.issueTracker?.linear?.apiKey;
            if (!apiKey) {
              return json(res, { error: "Linear not configured. Open Settings to add your API key." }, 400);
            }
            const issues = await searchLinearIssues(apiKey, filters);
            return json(res, { issues });
          }
          case "github-issues": {
            const token = config.scm?.token;
            const repo = config.defaultRepo;
            if (!token) {
              return json(res, { error: "GitHub token not configured. Open Settings to add your SCM token." }, 400);
            }
            if (!repo) {
              return json(res, { error: "No default repository configured. Set a target repo in Settings." }, 400);
            }
            const issues = await searchGitHubIssues(token, repo, filters);
            return json(res, { issues });
          }
          case "internal":
          default: {
            // Existing board cards logic
            const statusFilter = qp.status?.toLowerCase();
            const projectFilter = qp.project;
            const boards = await backend.getBoards();
            const issues: unknown[] = [];
            for (const board of boards) {
              if (projectFilter && board.id !== projectFilter) continue;
              const cards = await backend.getBoardCards(board.id);
              const colMap = new Map(board.columns.map(c => [c.id, c.name]));
              const db = (await import("./backends/local/db.js")).getDb();
              for (const card of cards) {
                const colName = colMap.get(card.columnId) || "Backlog";
                if (statusFilter && colName.toLowerCase() !== statusFilter) continue;
                const totalDeps = (db.prepare(
                  "SELECT COUNT(*) as cnt FROM card_dependencies WHERE card_id = ?",
                ).get(card.id) as any)?.cnt || 0;
                const unmetDeps = totalDeps > 0
                  ? (db.prepare(`
                      SELECT COUNT(*) as cnt FROM card_dependencies cd
                      JOIN cards dep ON dep.id = cd.depends_on_card_id
                      LEFT JOIN tasks t ON t.id = dep.task_id
                      WHERE cd.card_id = ? AND (t.id IS NULL OR t.status != 'completed')
                    `).get(card.id) as any)?.cnt || 0
                  : 0;
                issues.push({
                  key: `***REMOVED***${card.cardNumber || card.id.slice(0, 6)}`,
                  summary: card.title,
                  description: card.description || null,
                  status: colName,
                  issueType: "Story",
                  priority: card.priority || "medium",
                  labels: [board.name],
                  project: { key: board.id, name: board.name },
                  assignee: null,
                  blockedByCount: unmetDeps,
                  dependencyCount: totalDeps,
                  _cardId: card.id,
                  _boardId: board.id,
                });
              }
            }
            return json(res, { issues });
          }
        }
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const { params: qp } = parseUrl(req.url || "");
      const qs = Object.entries(qp)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      const apiPath = `/api/issues${qs ? `?${qs}` : ""}`;
      const result = await cloudProxy("GET", apiPath);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/issues/projects — list projects (boards in standalone, Jira in cloud)
  if (req.method === "GET" && path === "/api/issues/projects") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const config = loadStandaloneConfig();
        const provider = config.issueTracker?.provider || "internal";

        switch (provider) {
          case "jira": {
            const creds = config.issueTracker?.jira;
            if (!creds?.baseUrl || !creds.email || !creds.apiToken) {
              return json(res, { error: "Jira not configured" }, 400);
            }
            const projects = await listJiraProjects(creds);
            return json(res, { projects });
          }
          case "linear": {
            const apiKey = config.issueTracker?.linear?.apiKey;
            if (!apiKey) {
              return json(res, { error: "Linear not configured" }, 400);
            }
            const projects = await listLinearTeams(apiKey);
            return json(res, { projects });
          }
          case "github-issues": {
            const token = config.scm?.token;
            if (!token) {
              return json(res, { error: "GitHub token not configured" }, 400);
            }
            // If a default repo is set, return just that; otherwise list user repos
            const repo = config.defaultRepo;
            if (repo) {
              return json(res, { projects: [{ key: repo, name: repo }] });
            }
            const projects = await listGitHubRepos(token);
            return json(res, { projects });
          }
          case "internal":
          default: {
            const boards = await backend.getBoards();
            return json(res, { projects: boards.map(b => ({ key: b.id, name: b.name })) });
          }
        }
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/issues/projects");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Persona CRUD endpoints ──

  // Seed system personas into SQLite if not yet present.
  // Idempotent — only inserts missing slugs.
  function seedSystemPersonas(): void {
    const db = getLocalDb();
    const existing = db.prepare("SELECT slug FROM personas WHERE is_system = 1").all() as { slug: string }[];
    const existingSlugs = new Set(existing.map((r: { slug: string }) => r.slug));

    const SYSTEM_PERSONAS: Record<string, { name: string; emoji: string; color: string; shortLabel: string; description: string; skills: string; riskLevel: string; priority: number }> = {
      architect: { name: "Architect", emoji: "🏗️", color: "purple-500", shortLabel: "Arch", description: "Designs system architecture, defines component boundaries, and ensures scalability.", skills: "Architecture,System Design,Scalability", riskLevel: "high", priority: 1 },
      frontend_developer: { name: "Frontend Developer", emoji: "🎨", color: "pink-500", shortLabel: "Frontend", description: "Builds user interfaces with React, CSS, and modern frontend frameworks.", skills: "React,TypeScript,CSS,UI/UX", riskLevel: "low", priority: 2 },
      backend_developer: { name: "Backend Developer", emoji: "💻", color: "blue-500", shortLabel: "Backend", description: "Implements server-side logic, APIs, and database operations.", skills: "Node.js,TypeScript,APIs,Databases", riskLevel: "medium", priority: 3 },
      devops_engineer: { name: "DevOps Engineer", emoji: "🔧", color: "orange-500", shortLabel: "DevOps", description: "Manages infrastructure, CI/CD pipelines, and deployment automation.", skills: "Docker,Kubernetes,CI/CD,Infrastructure", riskLevel: "high", priority: 4 },
      security_engineer: { name: "Security Engineer", emoji: "🛡️", color: "red-500", shortLabel: "Security", description: "Performs security audits, implements auth, and hardens systems.", skills: "Security,Auth,Encryption,OWASP", riskLevel: "high", priority: 5 },
      qa_engineer: { name: "QA Engineer", emoji: "🧪", color: "green-500", shortLabel: "QA", description: "Writes tests, performs quality assurance, and validates features.", skills: "Testing,E2E,Unit Tests,QA", riskLevel: "low", priority: 6 },
      tech_writer: { name: "Tech Writer", emoji: "📝", color: "yellow-500", shortLabel: "Docs", description: "Creates documentation, API references, and technical guides.", skills: "Documentation,API Docs,Technical Writing", riskLevel: "low", priority: 7 },
      project_manager: { name: "Project Manager", emoji: "📋", color: "gray-500", shortLabel: "PM", description: "Coordinates tasks, manages project timelines, and stakeholder communication.", skills: "Project Management,Planning,Coordination", riskLevel: "low", priority: 8 },
      data_ml_engineer: { name: "Data/ML Engineer", emoji: "📊", color: "teal-500", shortLabel: "Data/ML", description: "Builds data pipelines, ML models, and analytics systems.", skills: "Python,ML,Data Pipelines,Analytics", riskLevel: "medium", priority: 9 },
      mobile_developer: { name: "Mobile Developer", emoji: "📱", color: "indigo-500", shortLabel: "Mobile", description: "Develops mobile applications with React Native or native platforms.", skills: "React Native,Mobile,iOS,Android", riskLevel: "medium", priority: 10 },
      tech_lead: { name: "Tech Lead", emoji: "👑", color: "amber-500", shortLabel: "Lead", description: "Reviews code, provides technical guidance, and ensures quality standards.", skills: "Code Review,Architecture,Mentoring", riskLevel: "medium", priority: 11 },
      planning_agent: { name: "Planning Agent", emoji: "💡", color: "cyan-500", shortLabel: "Planner", description: "Decomposes tasks into stories, assigns experts, and creates execution plans.", skills: "Planning,Decomposition,Estimation", riskLevel: "low", priority: 12 },
      manager: { name: "Manager", emoji: "👔", color: "slate-500", shortLabel: "Manager", description: "Manages review cycles, approves PRs, and coordinates team output.", skills: "Management,Review,Coordination", riskLevel: "low", priority: 13 },
    };

    const insert = db.prepare(
      "INSERT INTO personas (id, slug, name, emoji, color, short_label, description, enabled, is_system, priority, skills, risk_level) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)"
    );
    for (const [slug, p] of Object.entries(SYSTEM_PERSONAS)) {
      if (!existingSlugs.has(slug)) {
        insert.run(generateId(), slug, p.name, p.emoji, p.color, p.shortLabel, p.description, p.priority, p.skills, p.riskLevel);
      }
    }
  }

  // GET /api/personas — list all personas (system + user-created), cloud proxy in cloud mode
  if (req.method === "GET" && path === "/api/personas") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        const personas = db.prepare(
          "SELECT id, slug, name, emoji, color, short_label, description, enabled, is_system, priority, skills, risk_level, keyword_pattern, label_shortcuts, created_at, updated_at FROM personas WHERE slug != '__common__' ORDER BY priority ASC, name ASC"
        ).all() as any[];
        return json(res, personas.map((p: any) => ({
          ...p,
          enabled: !!p.enabled,
          isSystem: !!p.is_system,
          skills: p.skills ? p.skills.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
          labelShortcuts: p.label_shortcuts ? p.label_shortcuts.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
        })));
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/personas");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/personas — create a new persona (standalone only)
  if (req.method === "POST" && path === "/api/personas") {
    const body = JSON.parse(await readBody(req));
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        const { slug, name, emoji, color, shortLabel, description, skills, riskLevel, keywordPattern, labelShortcuts, priority } = body;
        if (!slug || !name) return json(res, { error: "slug and name are required" }, 400);
        if (!/^[a-z][a-z0-9_]*$/.test(slug)) return json(res, { error: "slug must match /^[a-z][a-z0-9_]*$/" }, 400);
        const existing = db.prepare("SELECT id FROM personas WHERE slug = ?").get(slug);
        if (existing) return json(res, { error: `Persona with slug '${slug}' already exists` }, 409);
        const id = generateId();
        db.prepare(
          "INSERT INTO personas (id, slug, name, emoji, color, short_label, description, enabled, is_system, priority, skills, risk_level, keyword_pattern, label_shortcuts) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)"
        ).run(
          id, slug, name,
          emoji || null, color || null, shortLabel || null, description || null,
          priority ?? 0,
          Array.isArray(skills) ? skills.join(",") : (skills || null),
          riskLevel || "medium",
          keywordPattern || null,
          Array.isArray(labelShortcuts) ? labelShortcuts.join(",") : (labelShortcuts || null),
        );
        const created = db.prepare("SELECT * FROM personas WHERE id = ?").get(id) as any;
        return json(res, { ...created, enabled: !!created.enabled, isSystem: false }, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", "/api/personas", body);
      return json(res, result, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/worker/:slug/bundle — persona bundle for worker directive injection
  if (req.method === "GET" && /^\/api\/personas\/worker\/[^/]+\/bundle$/.test(path)) {
    const slug = path.split("/")[5];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        const persona = db.prepare("SELECT * FROM personas WHERE slug = ? AND enabled = 1").get(slug) as any;
        if (!persona) return json(res, { error: `Persona '${slug}' not found` }, 404);

        // Get active readme directive
        const readmeDirective = db.prepare(
          "SELECT id, content, version FROM persona_directives WHERE persona_id = ? AND type = 'readme' AND is_active = 1 ORDER BY version DESC LIMIT 1"
        ).get(persona.id) as any;

        // Get active common directives for this persona
        const personaCommon = db.prepare(
          "SELECT id, filename, content, version FROM persona_directives WHERE persona_id = ? AND type = 'common' AND is_active = 1"
        ).all(persona.id) as any[];

        // Also get global __common__ directives
        const commonPersona = db.prepare("SELECT id FROM personas WHERE slug = '__common__'").get() as any;
        let globalCommon: any[] = [];
        if (commonPersona) {
          globalCommon = db.prepare(
            "SELECT id, filename, content, version FROM persona_directives WHERE persona_id = ? AND type = 'common' AND is_active = 1"
          ).all(commonPersona.id) as any[];
        }

        // Merge: global common first, persona-specific overrides by filename
        const commonMap: Record<string, string> = {};
        const commonMeta: Record<string, { id: string; version: number }> = {};
        for (const d of globalCommon) {
          if (d.filename) {
            commonMap[d.filename] = d.content;
            commonMeta[d.filename] = { id: d.id, version: d.version };
          }
        }
        for (const d of personaCommon) {
          if (d.filename) {
            commonMap[d.filename] = d.content;
            commonMeta[d.filename] = { id: d.id, version: d.version };
          }
        }

        return json(res, {
          persona: {
            id: persona.id,
            slug: persona.slug,
            name: persona.name,
            emoji: persona.emoji,
            color: persona.color,
            description: persona.description,
          },
          directives: {
            readme: readmeDirective?.content ?? null,
            readmeMeta: readmeDirective ? { id: readmeDirective.id, version: readmeDirective.version } : null,
            common: commonMap,
            commonMeta,
          },
          scripts: {},
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/worker/experts — expert registry for workers
  if (req.method === "GET" && path === "/api/personas/worker/experts") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        const personas = db.prepare(
          "SELECT id, slug, name, emoji, color, description, skills FROM personas WHERE enabled = 1 AND slug != '__common__' ORDER BY priority ASC"
        ).all() as any[];

        const experts = personas.map((p: any) => {
          // Get readme directive as systemPrompt
          const readmeDirective = db.prepare(
            "SELECT content FROM persona_directives WHERE persona_id = ? AND type = 'readme' AND is_active = 1 ORDER BY version DESC LIMIT 1"
          ).get(p.id) as any;

          return {
            slug: p.slug,
            name: p.name,
            emoji: p.emoji,
            color: p.color,
            description: p.description,
            systemPrompt: readmeDirective?.content || `You are a ${p.name}. ${p.description || ""}`,
            specialties: p.skills ? p.skills.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
            tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"],
            reviewOnly: p.slug === "tech_lead" || p.slug === "manager",
          };
        });
        return json(res, { experts });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/personas/worker/experts");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // PUT /api/personas/:id — update persona metadata (standalone only)
  if (req.method === "PUT" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/")) {
    const body = JSON.parse(await readBody(req));
    const personaId = path.split("/")[3];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(personaId) as any;
        if (!persona) return json(res, { error: "Persona not found" }, 404);

        const { name, emoji, color, shortLabel, description, enabled, priority, skills, riskLevel, keywordPattern, labelShortcuts } = body;
        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) { updates.push("name = ?"); values.push(name); }
        if (emoji !== undefined) { updates.push("emoji = ?"); values.push(emoji); }
        if (color !== undefined) { updates.push("color = ?"); values.push(color); }
        if (shortLabel !== undefined) { updates.push("short_label = ?"); values.push(shortLabel); }
        if (description !== undefined) { updates.push("description = ?"); values.push(description); }
        if (enabled !== undefined) { updates.push("enabled = ?"); values.push(enabled ? 1 : 0); }
        if (priority !== undefined) { updates.push("priority = ?"); values.push(priority); }
        if (skills !== undefined) { updates.push("skills = ?"); values.push(Array.isArray(skills) ? skills.join(",") : skills); }
        if (riskLevel !== undefined) { updates.push("risk_level = ?"); values.push(riskLevel); }
        if (keywordPattern !== undefined) { updates.push("keyword_pattern = ?"); values.push(keywordPattern); }
        if (labelShortcuts !== undefined) { updates.push("label_shortcuts = ?"); values.push(Array.isArray(labelShortcuts) ? labelShortcuts.join(",") : labelShortcuts); }

        if (updates.length > 0) {
          updates.push("updated_at = datetime('now')");
          db.prepare(`UPDATE personas SET ${updates.join(", ")} WHERE id = ?`).run(...values, personaId);
        }

        const updated = db.prepare("SELECT * FROM personas WHERE id = ?").get(personaId) as any;
        return json(res, { ...updated, enabled: !!updated.enabled, isSystem: !!updated.is_system });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("PUT", path, body);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // DELETE /api/personas/:id — delete a user-created persona (standalone only, system personas blocked)
  if (req.method === "DELETE" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/") && !path.includes("/directives")) {
    const personaId = path.split("/")[3];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(personaId) as any;
        if (!persona) return json(res, { error: "Persona not found" }, 404);
        if (persona.is_system) return json(res, { error: "Cannot delete system personas" }, 403);
        db.prepare("DELETE FROM personas WHERE id = ?").run(personaId);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("DELETE", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/:personaId/directives — list active directives for a persona
  if (req.method === "GET" && /^\/api\/personas\/[^/]+\/directives$/.test(path) && !path.includes("/worker/") && !path.includes("/common/")) {
    const personaId = path.split("/")[3];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const persona = db.prepare("SELECT id FROM personas WHERE id = ?").get(personaId) as any;
        if (!persona) return json(res, { error: "Persona not found" }, 404);
        const directives = db.prepare(
          "SELECT id, persona_id, type, filename, version, is_active, change_summary, created_at, length(content) as content_length FROM persona_directives WHERE persona_id = ? AND is_active = 1 ORDER BY type, filename"
        ).all(personaId) as any[];
        return json(res, directives.map((d: any) => ({
          ...d,
          isActive: !!d.is_active,
          contentPreview: undefined,
          contentLength: d.content_length,
        })));
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/:personaId/directives/:id — get full directive content
  if (req.method === "GET" && /^\/api\/personas\/[^/]+\/directives\/[^/]+$/.test(path) && !path.includes("/worker/")) {
    const directiveId = path.split("/")[5];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const directive = db.prepare("SELECT * FROM persona_directives WHERE id = ?").get(directiveId) as any;
        if (!directive) return json(res, { error: "Directive not found" }, 404);
        return json(res, { ...directive, isActive: !!directive.is_active });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/personas/:personaId/directives — create new directive version
  if (req.method === "POST" && /^\/api\/personas\/[^/]+\/directives$/.test(path) && !path.includes("/worker/") && !path.includes("/common/")) {
    const body = JSON.parse(await readBody(req));
    const personaId = path.split("/")[3];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const persona = db.prepare("SELECT id FROM personas WHERE id = ?").get(personaId) as any;
        if (!persona) return json(res, { error: "Persona not found" }, 404);

        const { type, filename, content, changeSummary } = body;
        if (!type || !content) return json(res, { error: "type and content are required" }, 400);
        if (type !== "readme" && type !== "common") return json(res, { error: "type must be 'readme' or 'common'" }, 400);
        if (type === "common" && !filename) return json(res, { error: "filename is required for common directives" }, 400);

        // Get current max version for this type+filename
        const maxRow = db.prepare(
          "SELECT MAX(version) as maxVer FROM persona_directives WHERE persona_id = ? AND type = ? AND (filename = ? OR (filename IS NULL AND ? IS NULL))"
        ).get(personaId, type, filename || null, filename || null) as any;
        const nextVersion = (maxRow?.maxVer ?? 0) + 1;

        // Deactivate previous active versions for this type+filename
        db.prepare(
          "UPDATE persona_directives SET is_active = 0 WHERE persona_id = ? AND type = ? AND (filename = ? OR (filename IS NULL AND ? IS NULL)) AND is_active = 1"
        ).run(personaId, type, filename || null, filename || null);

        // Insert new version
        const id = generateId();
        db.prepare(
          "INSERT INTO persona_directives (id, persona_id, type, filename, content, version, is_active, change_summary) VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
        ).run(id, personaId, type, filename || null, content, nextVersion, changeSummary || null);

        const created = db.prepare("SELECT * FROM persona_directives WHERE id = ?").get(id) as any;
        return json(res, { ...created, isActive: true }, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", path, body);
      return json(res, result, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // DELETE /api/personas/:personaId/directives/:id — delete all versions of a directive
  if (req.method === "DELETE" && /^\/api\/personas\/[^/]+\/directives\/[^/]+$/.test(path) && !path.includes("/worker/")) {
    const directiveId = path.split("/")[5];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const directive = db.prepare("SELECT * FROM persona_directives WHERE id = ?").get(directiveId) as any;
        if (!directive) return json(res, { error: "Directive not found" }, 404);
        // Delete all versions with same persona_id + type + filename
        db.prepare(
          "DELETE FROM persona_directives WHERE persona_id = ? AND type = ? AND (filename = ? OR (filename IS NULL AND ? IS NULL))"
        ).run(directive.persona_id, directive.type, directive.filename, directive.filename);
        return json(res, { success: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("DELETE", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/common/directives — list global common directives
  if (req.method === "GET" && path === "/api/personas/common/directives") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        // Ensure __common__ pseudo-persona exists
        let commonPersona = db.prepare("SELECT id FROM personas WHERE slug = '__common__'").get() as any;
        if (!commonPersona) {
          const id = generateId();
          db.prepare("INSERT INTO personas (id, slug, name, enabled, is_system, priority) VALUES (?, '__common__', 'Common Directives', 1, 1, 0)").run(id);
          commonPersona = { id };
        }
        const directives = db.prepare(
          "SELECT id, persona_id, type, filename, version, is_active, change_summary, created_at, length(content) as content_length FROM persona_directives WHERE persona_id = ? AND is_active = 1 ORDER BY filename"
        ).all(commonPersona.id) as any[];
        return json(res, directives.map((d: any) => ({ ...d, isActive: !!d.is_active, contentLength: d.content_length })));
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/personas/common/directives");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/personas/common/directives — create/update a common directive
  if (req.method === "POST" && path === "/api/personas/common/directives") {
    const body = JSON.parse(await readBody(req));
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        // Ensure __common__ pseudo-persona
        let commonPersona = db.prepare("SELECT id FROM personas WHERE slug = '__common__'").get() as any;
        if (!commonPersona) {
          const id = generateId();
          db.prepare("INSERT INTO personas (id, slug, name, enabled, is_system, priority) VALUES (?, '__common__', 'Common Directives', 1, 1, 0)").run(id);
          commonPersona = { id };
        }
        const { filename, content, changeSummary } = body;
        if (!filename || !content) return json(res, { error: "filename and content are required" }, 400);

        const maxRow = db.prepare(
          "SELECT MAX(version) as maxVer FROM persona_directives WHERE persona_id = ? AND type = 'common' AND filename = ?"
        ).get(commonPersona.id, filename) as any;
        const nextVersion = (maxRow?.maxVer ?? 0) + 1;

        db.prepare(
          "UPDATE persona_directives SET is_active = 0 WHERE persona_id = ? AND type = 'common' AND filename = ? AND is_active = 1"
        ).run(commonPersona.id, filename);

        const id = generateId();
        db.prepare(
          "INSERT INTO persona_directives (id, persona_id, type, filename, content, version, is_active, change_summary) VALUES (?, ?, 'common', ?, ?, ?, 1, ?)"
        ).run(id, commonPersona.id, filename, content, nextVersion, changeSummary || null);

        const created = db.prepare("SELECT * FROM persona_directives WHERE id = ?").get(id) as any;
        return json(res, { ...created, isActive: true }, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", "/api/personas/common/directives", body);
      return json(res, result, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/:id — get single persona with directives (standalone only)
  if (req.method === "GET" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/") && !path.includes("/common")) {
    const personaId = path.split("/")[3];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        seedSystemPersonas();
        const persona = db.prepare("SELECT * FROM personas WHERE id = ?").get(personaId) as any;
        if (!persona) return json(res, { error: "Persona not found" }, 404);
        const directives = db.prepare(
          "SELECT id, type, filename, version, is_active, change_summary, created_at, length(content) as content_length FROM persona_directives WHERE persona_id = ? AND is_active = 1 ORDER BY type, filename"
        ).all(personaId) as any[];
        return json(res, {
          ...persona,
          enabled: !!persona.enabled,
          isSystem: !!persona.is_system,
          skills: persona.skills ? persona.skills.split(",").map((s: string) => s.trim()).filter(Boolean) : [],
          directives: directives.map((d: any) => ({ ...d, isActive: !!d.is_active, contentLength: d.content_length })),
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", path);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── RAG endpoints ──

  // GET /api/rag/status — GPU, Ollama, and local RAG status
  if (req.method === "GET" && path === "/api/rag/status") {
    const gpu = detectGpu();
    const ollamaPort = (agentConfig as AgentConfig & { ollamaPort?: number })?.ollamaPort ?? 11434;
    const ollama = await getOllamaStatus(ollamaPort);
    const localRagEnabled = (agentConfig as AgentConfig & { localRag?: boolean })?.localRag ?? false;
    return json(res, { gpu, ollama, localRagEnabled });
  }

  // POST /api/rag/setup — install Ollama, ensure running, pull nomic-embed-text
  // Returns 202 immediately; progress streamed via SSE on "rag" channel.
  if (req.method === "POST" && path === "/api/rag/setup") {
    const ollamaPort = (agentConfig as AgentConfig & { ollamaPort?: number })?.ollamaPort ?? 11434;

    const sendProgress = (message: string) => {
      broadcastSSE("rag", "rag:setup-progress", { message });
    };

    // Run setup in background — return 202 immediately
    (async () => {
      try {
        // Step 1: Check if Ollama is installed
        let installed = findOllamaPath() !== null;
        if (!installed) {
          sendProgress("Ollama not found — installing...");
          const installOk = await installOllama((msg) => sendProgress(msg));
          if (!installOk) {
            broadcastSSE("rag", "rag:setup-error", { error: "Failed to install Ollama" });
            return;
          }
          installed = true;
        }
        sendProgress("Ollama is installed");

        // Step 2: Ensure Ollama is running
        sendProgress("Ensuring Ollama is running...");
        const running = await ensureOllamaRunning(ollamaPort);
        if (!running) {
          broadcastSSE("rag", "rag:setup-error", { error: "Failed to start Ollama" });
          return;
        }
        sendProgress("Ollama is running");

        // Step 3: Check if nomic-embed-text is already pulled
        const status = await getOllamaStatus(ollamaPort);
        const hasModel = status.models.some((m) => m.startsWith("nomic-embed-text"));
        if (hasModel) {
          sendProgress("nomic-embed-text model is already available");
          broadcastSSE("rag", "rag:setup-complete", { success: true });
          return;
        }

        // Step 4: Pull nomic-embed-text
        sendProgress("Pulling nomic-embed-text model...");
        const pullOk = await pullModel("nomic-embed-text", ollamaPort, (msg, completed, total) => {
          broadcastSSE("rag", "rag:setup-progress", { message: msg, completed, total });
        });

        if (!pullOk) {
          broadcastSSE("rag", "rag:setup-error", { error: "Failed to pull nomic-embed-text model" });
          return;
        }

        broadcastSSE("rag", "rag:setup-complete", { success: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        broadcastSSE("rag", "rag:setup-error", { error });
      }
    })();

    return json(res, { status: "setup_started" }, 202);
  }

  // POST /api/rag/index — start background indexing of a repository
  if (req.method === "POST" && path === "/api/rag/index") {
    if (!agentConfig) return json(res, { error: "Agent not configured" }, 503);
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);

    try {
      const body = JSON.parse(await readBody(req));
      const repository = body.repository;
      if (!repository || typeof repository !== "string") {
        return json(res, { error: "repository is required" }, 400);
      }

      // Fetch SCM token from cloud settings
      const settings = (await cloudProxy("GET", "/api/settings")) as Record<string, unknown>;
      const scmProvider = (settings?.scmProvider ?? "github") as string;
      let scmToken = "";
      if (scmProvider === "bitbucket") {
        scmToken = (settings?.bitbucketToken as string) || "";
      } else if (scmProvider === "gitlab") {
        scmToken = (settings?.gitlabToken as string) || "";
      } else {
        scmToken = (settings?.githubToken as string) || "";
      }

      if (!scmToken) {
        return json(res, { error: `No ${scmProvider} token configured in Settings` }, 400);
      }

      const ollamaPort = (agentConfig as AgentConfig & { ollamaPort?: number })?.ollamaPort ?? 11434;

      // Run indexing in background — return 202 immediately
      indexRepositoryLocally(agentConfig, {
        repository,
        branch: body.branch,
        scmProvider,
        scmToken,
        ollamaPort,
        onProgress: (msg, indexed, total) => {
          agentEvents.emit("rag:progress", { repository, message: msg, indexed, total });
          broadcastSSE("rag", "rag:progress", { repository, message: msg, indexed, total });
        },
      }).then((result) => {
        agentEvents.emit("rag:complete", result);
        broadcastSSE("rag", "rag:complete", result);
      }).catch((err) => {
        const error = err instanceof Error ? err.message : String(err);
        agentEvents.emit("rag:error", { repository, error });
        broadcastSSE("rag", "rag:error", { repository, error });
      });

      return json(res, { status: "indexing_started", repository }, 202);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/rag/search — embed query locally, search via cloud API
  if (req.method === "POST" && path === "/api/rag/search") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);

    try {
      const body = JSON.parse(await readBody(req));
      const { repository, query: searchQuery, limit } = body as {
        repository?: string;
        query?: string;
        limit?: number;
      };
      if (!repository || !searchQuery) {
        return json(res, { error: "repository and query are required" }, 400);
      }

      const ollamaPort = (agentConfig as AgentConfig & { ollamaPort?: number })?.ollamaPort ?? 11434;

      // Generate query embedding locally
      const embeddings = await generateEmbeddings([searchQuery], "nomic-embed-text", ollamaPort);
      const queryEmbedding = embeddings[0];

      // Forward to cloud search endpoint
      const result = await cloudProxy("POST", "/api/codebase/search-with-embedding", {
        repository,
        embedding: queryEmbedding,
        limit: limit ?? 10,
      });

      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Worker API stubs (standalone mode) ──
  // These endpoints are called by the worker process. In cloud mode they go
  // to the real API; in standalone we return sensible defaults so the worker
  // can operate without a cloud backend.

  // GET /api/worker-decisions/worker-config — real worker config (same as cloud API)
  if (req.method === "GET" && path === "/api/worker-decisions/worker-config") {
    try {
      const config = await getWorkerConfig();
      return json(res, config);
    } catch (err) {
      // Fallback to defaults if file read fails (bundled binary won't have api/data/)
      return json(res, await getWorkerConfigFallback());
    }
  }

  // POST /api/worker-decisions/* — real decision engine (same pure functions as cloud API)
  if (req.method === "POST" && path.startsWith("/api/worker-decisions/")) {
    const action = path.split("/").pop();
    try {
      const body = JSON.parse(await readBody(req));
      const standaloneConfig = loadStandaloneConfig();

      if (action === "evaluate-quality") {
        // Normalize: if client sends flat { diff, storyDescription } instead of { metrics, ... }
        let normalized = body;
        if (body.diff !== undefined && body.metrics === undefined) {
          const diffStr = String(body.diff);
          const scoreMatch = diffStr.match(/score=(\d+)/);
          const typeErrorsMatch = diffStr.match(/typeErrors=(true|false)/);
          const testsFailedMatch = diffStr.match(/testsFailed=(\d+|true|false)/);
          normalized = {
            metrics: {
              qualityScore: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
              typeErrors: typeErrorsMatch ? typeErrorsMatch[1] === "true" : false,
              testFailures: testsFailedMatch
                ? testsFailedMatch[1] === "true" || parseInt(testsFailedMatch[1], 10) > 0
                : false,
            },
            taskId: body.taskId,
            bypassRequested: false,
            qualityGateEnabled: true,
            thresholds: body.thresholds,
          };
        }
        // Default thresholds if not provided
        if (!normalized.thresholds) {
          normalized.thresholds = {
            blockOnTestFailures: true,
            blockOnTypeErrors: false,
          };
        }
        if (normalized.qualityGateEnabled === undefined) normalized.qualityGateEnabled = true;
        if (normalized.bypassRequested === undefined) normalized.bypassRequested = false;
        return json(res, evaluateQuality(normalized));
      }

      if (action === "classify-error") {
        const normalized = {
          errorText: body.errorText || body.errorOutput || "",
          retryCount: body.retryCount ?? 0,
          maxAutoRetries: body.maxAutoRetries ?? standaloneConfig.settings?.qualityGateMaxRetries ?? 3,
          storyContext:
            body.storyContext && typeof body.storyContext === "object"
              ? body.storyContext
              : {
                  title: typeof body.storyContext === "string" ? body.storyContext : "",
                  persona: body.persona || "",
                  targetFiles: body.affectedFiles || [],
                },
        };
        return json(res, classifyError(normalized));
      }

      if (action === "review-outcome") {
        const normalized = {
          reviewerOutput: body.reviewerOutput || body.reviewOutput || "",
          revisionCount: body.revisionCount ?? body.revisionNumber ?? 0,
          maxRevisions: body.maxRevisions ?? standaloneConfig.settings?.maxReviewRevisions ?? 3,
          perStoryRevisionCount: body.perStoryRevisionCount ?? 0,
          maxPerStoryRevisions: body.maxPerStoryRevisions ?? standaloneConfig.settings?.maxPerStoryRevisions ?? 1,
        };
        return json(res, parseReviewOutcome(normalized));
      }

      if (action === "route-question") {
        return json(res, routeQuestion(body));
      }

      if (action === "route-provider") {
        return json(res, routeProvider(body));
      }

      return json(res, {});
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/coordination/heartbeat — worker heartbeat (fire-and-forget)
  if (req.method === "POST" && path === "/api/coordination/heartbeat") {
    return json(res, { success: true });
  }

  // ── Coordination API (standalone mode) ──
  // The epic worker uses these endpoints for story claiming, context posting,
  // and multi-expert coordination. In standalone mode we serve a single story
  // derived from the task's summary/description.

  // GET /api/coordination/context/:taskId — get coordination contexts
  const coordCtxMatch = path.match(/^\/api\/coordination\/context\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && coordCtxMatch) {
    const taskId = coordCtxMatch[1];
    const store = getCoordStore(taskId);
    const { params: coordParams } = parseUrl(req.url || "");
    const messageType = coordParams.messageType;
    const messageTypes = coordParams.messageTypes;
    const types = messageType
      ? [messageType]
      : messageTypes
        ? messageTypes.split(",")
        : null;

    const contexts = types
      ? store.contexts.filter((c) => types.includes(c.messageType))
      : store.contexts;

    return json(res, { contexts });
  }

  // GET /api/coordination/context/:taskId/stream — SSE coordination stream
  // Real-time push when coordination contexts are posted (mirrors cloud Redis pub/sub)
  const workerSseMatch = path.match(
    /^\/api\/coordination\/context\/([a-zA-Z0-9_-]+)\/stream$/,
  );
  if (req.method === "GET" && workerSseMatch) {
    const sseTaskId = workerSseMatch[1];
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: {\"type\":\"connected\"}\n\n");

    // Register this client for coordination event push
    if (!coordSseClients.has(sseTaskId)) {
      coordSseClients.set(sseTaskId, new Set());
    }
    coordSseClients.get(sseTaskId)!.add(res);

    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepAlive);
      }
    }, 30_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      coordSseClients.get(sseTaskId)?.delete(res);
    });
    return; // Keep connection open
  }

  // POST /api/coordination/context — post a coordination context message
  if (req.method === "POST" && path === "/api/coordination/context") {
    try {
      const body = JSON.parse(await readBody(req));
      const taskId = body.parentTaskId || "";
      const store = getCoordStore(taskId);
      const msg: CoordContext = {
        id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        parentTaskId: taskId,
        taskId: body.taskId || taskId,
        persona: body.persona || "",
        messageType: body.messageType || "context",
        content: body.content || "",
        metadata: body.metadata || {},
        createdAt: new Date().toISOString(),
      };
      store.contexts.push(msg);
      // Push to SSE subscribers (mirrors cloud Redis pub/sub)
      pushCoordEvent(taskId, msg);
      // Emit prominent blocker notification so VS Code can show a dialog
      if (msg.messageType === "blocker_detected") {
        broadcastSSE("tasks", "blocker:detected", {
          taskId: msg.taskId,
          parentTaskId: taskId,
          persona: msg.persona,
          content: msg.content,
          metadata: msg.metadata,
          createdAt: msg.createdAt,
        });
      }
      // Write-through to SQLite for persistence across agent restarts
      const backend = getActiveBackend();
      if (backend?.mode === "local") {
        try {
          await backend.postCoordinationMessage({
            parentTaskId: taskId,
            taskId: body.taskId || taskId,
            messageType: msg.messageType,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          });
        } catch { /* best-effort persistence */ }
      }
      return json(res, msg, 201);
    } catch {
      return json(res, { success: true });
    }
  }

  // POST /api/coordination/claim — claim a story
  if (req.method === "POST" && path === "/api/coordination/claim") {
    try {
      const body = JSON.parse(await readBody(req));
      const parentTaskId = body.parentTaskId || "";
      const store = getCoordStore(parentTaskId);
      // Mark story as claimed
      const claimed: CoordContext = {
        id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        parentTaskId,
        taskId: parentTaskId,
        persona: body.claimedBy || "",
        messageType: "story_claimed",
        content: `Story claimed by ${body.claimedBy}`,
        metadata: {
          storyId: body.storyId,
          claimedBy: body.claimedBy,
          storyIndex: store.contexts.find(
            (c) => c.id === body.storyId,
          )?.metadata?.storyIndex ?? 0,
        },
        createdAt: new Date().toISOString(),
      };
      store.contexts.push(claimed);
      // Push to SSE subscribers
      pushCoordEvent(parentTaskId, claimed);
      // Write-through to SQLite
      const backend = getActiveBackend();
      if (backend?.mode === "local") {
        try {
          await backend.postCoordinationMessage({
            parentTaskId,
            taskId: parentTaskId,
            messageType: "story_claimed",
            content: claimed.content,
          });
        } catch { /* best-effort */ }
      }
      return json(res, { success: true, claimedBy: body.claimedBy });
    } catch {
      return json(res, { success: true });
    }
  }

  // POST /api/coordination/answer — post an answer to a question
  if (req.method === "POST" && path === "/api/coordination/answer") {
    try {
      const body = JSON.parse(await readBody(req));
      return json(res, {
        success: true,
        context: {
          id: `ctx-${Date.now()}`,
          messageType: "answer",
          content: body.answer || "",
          persona: body.persona || "",
          metadata: { questionId: body.messageId },
          createdAt: new Date().toISOString(),
        },
      });
    } catch {
      return json(res, { success: true });
    }
  }

  // POST /api/coordination/archive-claims — archive stale claims
  if (
    req.method === "POST" &&
    path === "/api/coordination/archive-claims"
  ) {
    return json(res, { success: true });
  }

  // GET /api/coordination/commands/:taskId/pending — dashboard commands
  const coordCmdMatch = path.match(
    /^\/api\/coordination\/commands\/([a-zA-Z0-9_-]+)\/pending$/,
  );
  if (req.method === "GET" && coordCmdMatch) {
    return json(res, { commands: [] });
  }

  // GET /api/coordination/blockers/:taskId — blocker contexts
  const coordBlockerMatch = path.match(
    /^\/api\/coordination\/blockers\/([a-zA-Z0-9_-]+)$/,
  );
  if (req.method === "GET" && coordBlockerMatch) {
    return json(res, { contexts: [] });
  }

  // POST /api/tasks/:id/worker-complete — worker signals task completion
  const workerCompleteMatch = path.match(
    /^\/api\/tasks\/([a-f0-9-]+)\/worker-complete$/,
  );
  if (req.method === "POST" && workerCompleteMatch) {
    try {
      const body = JSON.parse(await readBody(req));
      const backend = getActiveBackend();
      if (backend?.mode === "local") {
        const db = (await import("./backends/local/db.js")).getDb();
        const taskId = workerCompleteMatch[1];
        const status =
          body.exitCode === 0 ? (body.result || "completed") : "failed";
        db.prepare(
          "UPDATE tasks SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        ).run(status, taskId);
        // Store PR URL if provided
        if (body.prUrl || body.githubPrUrl) {
          db.prepare("UPDATE tasks SET github_pr_url = ? WHERE id = ?").run(body.prUrl || body.githubPrUrl, taskId);
        }
        const { emitStreamEvent } = await import(
          "./backends/local/event-bus.js"
        );
        emitStreamEvent("org:local:tasks", "task_state", {
          taskId,
          status,
        });
      }
      return json(res, { success: true });
    } catch {
      return json(res, { success: true });
    }
  }

  // POST /api/tasks/:id/manager-complete — manager review result
  const managerCompleteMatch = path.match(
    /^\/api\/tasks\/([a-f0-9-]+)\/manager-complete$/,
  );
  if (req.method === "POST" && managerCompleteMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = managerCompleteMatch[1];
        const { getDb } = await import("./backends/local/db.js");
        const db = getDb();
        const decision = body.decision || body.result || "approved";

        if (decision === "approved" || decision === "approve") {
          db.prepare(
            "UPDATE tasks SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
          ).run(taskId);
          broadcastSSE("tasks", "state:changed", { taskId, status: "completed" });
        } else if (decision === "revision_needed" || decision === "revise") {
          // Manager wants revisions — re-queue the task for another worker run
          db.prepare(
            "UPDATE tasks SET status = 'queued', updated_at = datetime('now') WHERE id = ?",
          ).run(taskId);
          broadcastSSE("tasks", "state:changed", { taskId, status: "queued" });
          // Store review feedback in coordination context
          if (body.feedback) {
            try {
              await backend.postCoordinationMessage({
                parentTaskId: taskId,
                taskId,
                messageType: "manager_feedback",
                content: JSON.stringify({ decision, feedback: body.feedback }),
              });
            } catch { /* best-effort */ }
          }
          processQueuedTask(taskId).catch(() => {});
        } else {
          // Rejected — mark as failed
          db.prepare(
            "UPDATE tasks SET status = 'failed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
          ).run(taskId);
          broadcastSSE("tasks", "state:changed", { taskId, status: "failed" });
        }
      } catch { /* best-effort */ }
    }
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/worker-progress — mid-task status update (non-terminal)
  const workerProgressMatch = path.match(
    /^\/api\/tasks\/([a-f0-9-]+)\/worker-progress$/,
  );
  if (req.method === "POST" && workerProgressMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = workerProgressMatch[1];
        const status = body.status || body.result;
        if (status) {
          const { getDb } = await import("./backends/local/db.js");
          const db = getDb();
          db.prepare(
            "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?",
          ).run(status, taskId);
          // Store PR URL if provided (used by manager review after completion)
          if (body.prUrl || body.githubPrUrl) {
            db.prepare("UPDATE tasks SET github_pr_url = ? WHERE id = ?").run(body.prUrl || body.githubPrUrl, taskId);
          }
          broadcastSSE("tasks", "state:changed", { taskId, status });
        }
      } catch { /* best-effort */ }
    }
    return json(res, { success: true });
  }

  // POST /api/control-center/logs/:id/classify-errors — mark errors as fatal/recoverable
  const classifyMatch = path.match(
    /^\/api\/control-center\/logs\/([a-f0-9-]+)\/classify-errors$/,
  );
  if (req.method === "POST" && classifyMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = classifyMatch[1];
        const exitCode = Number(body.exitCode);
        const { getDb } = await import("./backends/local/db.js");
        const db = getDb();

        // Get all error logs for this task, ordered by creation time
        const errorLogs = db.prepare(
          "SELECT id FROM task_logs WHERE task_id = ? AND severity = 'error' ORDER BY created_at ASC",
        ).all(taskId) as { id: number }[];

        if (errorLogs.length > 0) {
          let fatalCount = 0;
          let recoverableCount = 0;

          for (let i = 0; i < errorLogs.length; i++) {
            const isLastError = i === errorLogs.length - 1;
            const errorType = (exitCode !== 0 && isLastError) ? "fatal" : "recoverable";
            db.prepare("UPDATE task_logs SET error_type = ? WHERE id = ?").run(errorType, errorLogs[i].id);
            if (errorType === "fatal") fatalCount++;
            else recoverableCount++;
          }

          return json(res, {
            taskId,
            classified: errorLogs.length,
            fatal: fatalCount,
            recoverable: recoverableCount,
          });
        }
        return json(res, { taskId, classified: 0, message: "No error logs to classify" });
      } catch { /* non-fatal */ }
    }
    return json(res, { success: true });
  }

  // POST /api/control-center/logs — worker log posting (alias)
  if (req.method === "POST" && path === "/api/control-center/logs") {
    try {
      const body = JSON.parse(await readBody(req));
      const backend = getActiveBackend();
      if (backend?.mode === "local" && body.taskId) {
        await backend.postLog({
          taskId: body.taskId,
          type: body.type || "execution",
          message: body.message || body.log,
          severity: body.severity || "info",
        });
        // Broadcast to SSE so VS Code terminal sees the log in real-time
        broadcastSSE(`logs:${body.taskId}`, "log", {
          taskId: body.taskId,
          type: body.type || "execution",
          message: body.message || body.log,
          severity: body.severity || "info",
          createdAt: new Date().toISOString(),
        });
      }
      return json(res, { success: true });
    } catch { return json(res, { success: true }); }
  }

  // GET /api/tasks/:id/expert-registry — return empty registry
  const expertRegMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/expert-registry$/);
  if (req.method === "GET" && expertRegMatch) {
    return json(res, { experts: [] });
  }

  // POST /api/tasks/:id/status — worker updates task status
  const taskStatusMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/status$/);
  if (req.method === "POST" && taskStatusMatch) {
    try {
      const body = JSON.parse(await readBody(req));
      const backend = getActiveBackend();
      if (backend?.mode === "local") {
        const db = (await import("./backends/local/db.js")).getDb();
        if (body.status) {
          db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
            .run(body.status, taskStatusMatch[1]);
        }
      }
      return json(res, { success: true });
    } catch { return json(res, { success: true }); }
  }

  // POST /api/tasks/:id/usage/partial — incremental token usage from workers
  const usagePartialMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/partial$/,
  );
  if (req.method === "POST" && usagePartialMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = usagePartialMatch[1];
        const { getDb } = await import("./backends/local/db.js");
        const db = getDb();
        const mode = body.mode || "greatest";

        if (mode === "add") {
          db.prepare(`
            UPDATE tasks SET
              input_tokens = COALESCE(input_tokens, 0) + ?,
              output_tokens = COALESCE(output_tokens, 0) + ?,
              cache_creation_tokens = COALESCE(cache_creation_tokens, 0) + ?,
              cache_read_tokens = COALESCE(cache_read_tokens, 0) + ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).run(
            Number(body.inputTokens) || 0,
            Number(body.outputTokens) || 0,
            Number(body.cacheCreationTokens) || 0,
            Number(body.cacheReadTokens) || 0,
            taskId,
          );
        } else {
          db.prepare(`
            UPDATE tasks SET
              input_tokens = MAX(COALESCE(input_tokens, 0), ?),
              output_tokens = MAX(COALESCE(output_tokens, 0), ?),
              cache_creation_tokens = MAX(COALESCE(cache_creation_tokens, 0), ?),
              cache_read_tokens = MAX(COALESCE(cache_read_tokens, 0), ?),
              updated_at = datetime('now')
            WHERE id = ?
          `).run(
            Number(body.inputTokens) || 0,
            Number(body.outputTokens) || 0,
            Number(body.cacheCreationTokens) || 0,
            Number(body.cacheReadTokens) || 0,
            taskId,
          );
        }

        // Calculate estimated cost (Sonnet 3.5 pricing as reasonable default)
        const task = db.prepare("SELECT input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens FROM tasks WHERE id = ?").get(taskId) as any;
        if (task) {
          const cost =
            ((task.input_tokens || 0) * 3.0 / 1_000_000) +
            ((task.output_tokens || 0) * 15.0 / 1_000_000) +
            ((task.cache_creation_tokens || 0) * 3.75 / 1_000_000) +
            ((task.cache_read_tokens || 0) * 0.30 / 1_000_000);
          db.prepare("UPDATE tasks SET estimated_cost_usd = ? WHERE id = ?").run(cost, taskId);
          broadcastSSE("tasks", "usage:updated", { taskId, estimatedCostUsd: cost });
        }
      } catch { /* fire-and-forget */ }
    }
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/usage — final token usage report
  const usageFinalMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage$/,
  );
  if (req.method === "POST" && usageFinalMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = usageFinalMatch[1];
        const { getDb } = await import("./backends/local/db.js");
        const db = getDb();
        // Final usage — always overwrite (this is the definitive count)
        db.prepare(`
          UPDATE tasks SET
            input_tokens = ?,
            output_tokens = ?,
            cache_creation_tokens = ?,
            cache_read_tokens = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          Number(body.inputTokens) || 0,
          Number(body.outputTokens) || 0,
          Number(body.cacheCreationTokens) || 0,
          Number(body.cacheReadTokens) || 0,
          taskId,
        );
        // Calculate final cost
        const cost =
          ((Number(body.inputTokens) || 0) * 3.0 / 1_000_000) +
          ((Number(body.outputTokens) || 0) * 15.0 / 1_000_000) +
          ((Number(body.cacheCreationTokens) || 0) * 3.75 / 1_000_000) +
          ((Number(body.cacheReadTokens) || 0) * 0.30 / 1_000_000);
        db.prepare("UPDATE tasks SET estimated_cost_usd = ? WHERE id = ?").run(cost, taskId);
        broadcastSSE("tasks", "usage:updated", { taskId, estimatedCostUsd: cost });
      } catch { /* fire-and-forget */ }
    }
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/usage/phase — phase-level token usage (store as partial)
  const usagePhaseMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/phase$/,
  );
  if (req.method === "POST" && usagePhaseMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = usagePhaseMatch[1];
        const { getDb } = await import("./backends/local/db.js");
        const db = getDb();
        // Phase usage is additive (each phase is a separate session)
        db.prepare(`
          UPDATE tasks SET
            input_tokens = COALESCE(input_tokens, 0) + ?,
            output_tokens = COALESCE(output_tokens, 0) + ?,
            cache_creation_tokens = COALESCE(cache_creation_tokens, 0) + ?,
            cache_read_tokens = COALESCE(cache_read_tokens, 0) + ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          Number(body.inputTokens) || 0,
          Number(body.outputTokens) || 0,
          Number(body.cacheCreationTokens) || 0,
          Number(body.cacheReadTokens) || 0,
          taskId,
        );
      } catch { /* fire-and-forget */ }
    }
    return json(res, { success: true });
  }

  // GET /api/tasks/:id/usage/by-persona — usage breakdown (stub — full analytics not implemented)
  const usageByPersonaMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/by-persona$/,
  );
  if (req.method === "GET" && usageByPersonaMatch) {
    return json(res, { breakdown: [] });
  }

  // GET /api/tasks/:id/usage/by-operation-type — usage breakdown (stub)
  const usageByOpMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/by-operation-type$/,
  );
  if (req.method === "GET" && usageByOpMatch) {
    return json(res, { breakdown: [] });
  }

  // POST /api/directives/usage — track directive usage per task
  if (req.method === "POST" && path === "/api/directives/usage") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { taskId, directives } = body;
        if (taskId && Array.isArray(directives)) {
          const db = getLocalDb();
          const insert = db.prepare(
            "INSERT INTO directive_usage (id, task_id, directive_id, version, type, persona_slug) VALUES (?, ?, ?, ?, ?, ?)"
          );
          for (const d of directives) {
            insert.run(generateId(), taskId, d.directiveId || "", d.version || 1, d.type || "readme", d.personaSlug || "");
          }
        }
      } catch { /* non-fatal */ }
    }
    return json(res, { success: true });
  }

  // GET /api/directives/effectiveness — directive effectiveness metrics
  if (req.method === "GET" && path === "/api/directives/effectiveness") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const metrics = db.prepare(`
          SELECT
            du.directive_id,
            du.persona_slug,
            du.type,
            COUNT(DISTINCT du.task_id) as usage_count,
            COUNT(DISTINCT CASE WHEN t.status = 'completed' THEN du.task_id END) as success_count,
            COUNT(DISTINCT CASE WHEN t.status = 'failed' THEN du.task_id END) as failure_count
          FROM directive_usage du
          LEFT JOIN tasks t ON du.task_id = t.id
          GROUP BY du.directive_id, du.persona_slug, du.type
          ORDER BY usage_count DESC
        `).all() as any[];
        return json(res, { metrics });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { metrics: [] });
  }

  // POST /api/tasks/:id/ticket-comment — store as log entry in standalone
  const ticketCommentMatch = path.match(
    /^\/api\/tasks\/([a-f0-9-]+)\/ticket-comment$/,
  );
  if (req.method === "POST" && ticketCommentMatch) {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const taskId = ticketCommentMatch[1];
        const comment = body.comment;
        if (comment) {
          // Store as a log entry so it's visible in the task log stream
          await backend.postLog({
            taskId,
            type: "ticket_comment",
            message: comment,
            severity: "info",
          });
          broadcastSSE(`logs:${taskId}`, "log", {
            taskId,
            type: "ticket_comment",
            message: comment,
            severity: "info",
            createdAt: new Date().toISOString(),
          });
        }
      } catch { /* non-fatal */ }
    }
    return json(res, { success: true });
  }

  // ── Memory API (SQLite-backed) ──

  // POST /api/memory/search — search across all memory types by text
  if (req.method === "POST" && path === "/api/memory/search") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { query, repository, memoryTypes, limit } = body;
        const searchLimit = limit || 10;
        const types = memoryTypes || ["semantic", "episodic", "procedural"];
        const db = getLocalDb();
        const likeQuery = `%${(query || "").replace(/[%_]/g, "")}%`;

        const semantic = types.includes("semantic") ? db.prepare(
          `SELECT * FROM semantic_memories WHERE (subject LIKE ? OR knowledge LIKE ?) ${repository ? "AND repository = ?" : ""} ORDER BY confidence DESC, evidence_count DESC LIMIT ?`
        ).all(...(repository ? [likeQuery, likeQuery, repository, searchLimit] : [likeQuery, likeQuery, searchLimit])) as any[] : [];

        const episodic = types.includes("episodic") ? db.prepare(
          `SELECT * FROM episodic_memories WHERE (summary LIKE ? OR outcome_details LIKE ?) ${repository ? "AND repository = ?" : ""} ORDER BY created_at DESC LIMIT ?`
        ).all(...(repository ? [likeQuery, likeQuery, repository, searchLimit] : [likeQuery, likeQuery, searchLimit])) as any[] : [];

        const procedural = types.includes("procedural") ? db.prepare(
          `SELECT * FROM procedural_memories WHERE (name LIKE ? OR description LIKE ? OR insight LIKE ?) ${repository ? "AND repository = ?" : ""} ORDER BY success_count DESC LIMIT ?`
        ).all(...(repository ? [likeQuery, likeQuery, likeQuery, repository, searchLimit] : [likeQuery, likeQuery, likeQuery, searchLimit])) as any[] : [];

        // Bump retrieval counts
        for (const m of semantic) { db.prepare("UPDATE semantic_memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = datetime('now') WHERE id = ?").run(m.id); }
        for (const m of episodic) { db.prepare("UPDATE episodic_memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = datetime('now') WHERE id = ?").run(m.id); }
        for (const m of procedural) { db.prepare("UPDATE procedural_memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = datetime('now') WHERE id = ?").run(m.id); }

        return json(res, {
          query, repository,
          results: { semantic, episodic, procedural },
          totalResults: semantic.length + episodic.length + procedural.length,
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { query: "", results: { semantic: [], episodic: [], procedural: [] }, totalResults: 0 });
  }

  // POST /api/memory/similar-tasks — find similar past tasks
  if (req.method === "POST" && path === "/api/memory/similar-tasks") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { description, limit } = body;
        const searchLimit = limit || 10;
        const db = getLocalDb();
        const likeQuery = `%${(description || "").substring(0, 100).replace(/[%_]/g, "")}%`;
        const results = db.prepare(
          "SELECT * FROM episodic_memories WHERE (summary LIKE ? OR outcome_details LIKE ?) AND event_type IN ('task_completed', 'task_failed') ORDER BY created_at DESC LIMIT ?"
        ).all(likeQuery, likeQuery, searchLimit) as any[];
        return json(res, { query: description, totalResults: results.length, results });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { query: "", totalResults: 0, results: [] });
  }

  // GET /api/memory/semantic — list semantic memories
  if (req.method === "GET" && path === "/api/memory/semantic") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const repository = params.get("repository");
        const category = params.get("category");
        const limit = parseInt(params.get("limit") || "50", 10);
        const offset = parseInt(params.get("offset") || "0", 10);

        let sql = "SELECT * FROM semantic_memories WHERE 1=1";
        const args: any[] = [];
        if (repository) { sql += " AND repository = ?"; args.push(repository); }
        if (category) { sql += " AND category = ?"; args.push(category); }
        sql += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
        args.push(limit, offset);

        const memories = db.prepare(sql).all(...args) as any[];
        const countSql = sql.replace(/SELECT \*/, "SELECT COUNT(*) as total").replace(/ ORDER BY.*$/, "");
        const countArgs = args.slice(0, -2);
        const countRow = db.prepare(countSql).get(...countArgs) as any;
        return json(res, { memories, pagination: { total: countRow?.total || 0, limit, offset } });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { memories: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  // POST /api/memory/semantic — store semantic memory (upserts on subject+scope+category)
  if (req.method === "POST" && path === "/api/memory/semantic") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { repository, scope, category, subject, knowledge, confidence, source } = body;
        if (!subject || !knowledge) return json(res, { error: "subject and knowledge are required" }, 400);

        const db = getLocalDb();
        const existing = db.prepare(
          "SELECT id, evidence_count FROM semantic_memories WHERE subject = ? AND scope = ? AND category = ? AND (repository = ? OR (repository IS NULL AND ? IS NULL))"
        ).get(subject, scope || "repository", category || "convention", repository || null, repository || null) as any;

        if (existing) {
          db.prepare(
            "UPDATE semantic_memories SET knowledge = ?, confidence = ?, evidence_count = evidence_count + 1, updated_at = datetime('now') WHERE id = ?"
          ).run(knowledge, confidence ?? 0.5, existing.id);
          const updated = db.prepare("SELECT * FROM semantic_memories WHERE id = ?").get(existing.id);
          return json(res, { memory: updated, updated: true });
        }

        const id = generateId();
        db.prepare(
          "INSERT INTO semantic_memories (id, repository, scope, category, subject, knowledge, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, repository || null, scope || "repository", category || "convention", subject, knowledge, confidence ?? 0.5, source || "explicit");
        const created = db.prepare("SELECT * FROM semantic_memories WHERE id = ?").get(id);
        return json(res, { memory: created, updated: false });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { success: true, id: "none" });
  }

  // GET /api/memory/episodic — list episodic memories
  if (req.method === "GET" && path === "/api/memory/episodic") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const repository = params.get("repository");
        const eventType = params.get("eventType");
        const limit = parseInt(params.get("limit") || "50", 10);
        const offset = parseInt(params.get("offset") || "0", 10);

        let sql = "SELECT * FROM episodic_memories WHERE 1=1";
        const args: any[] = [];
        if (repository) { sql += " AND repository = ?"; args.push(repository); }
        if (eventType) { sql += " AND event_type = ?"; args.push(eventType); }
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
        args.push(limit, offset);

        const memories = db.prepare(sql).all(...args) as any[];
        return json(res, { memories, pagination: { total: memories.length, limit, offset } });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { memories: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  // POST /api/memory/episodic — store episodic memory
  if (req.method === "POST" && path === "/api/memory/episodic") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { repository, eventType, summary, details, outcome, outcomeDetails, taskId, persona, model } = body;
        if (!eventType || !summary) return json(res, { error: "eventType and summary are required" }, 400);

        const db = getLocalDb();
        const id = generateId();
        db.prepare(
          "INSERT INTO episodic_memories (id, task_id, repository, event_type, summary, details, outcome, outcome_details, persona, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, taskId || null, repository || null, eventType, summary, details ? JSON.stringify(details) : null, outcome || "success", outcomeDetails || null, persona || null, model || null);
        const created = db.prepare("SELECT * FROM episodic_memories WHERE id = ?").get(id);
        return json(res, { memory: created });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { success: true, id: "none" });
  }

  // GET /api/memory/procedural — list procedural memories (skills)
  if (req.method === "GET" && path === "/api/memory/procedural") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const repository = params.get("repository");
        const limit = parseInt(params.get("limit") || "50", 10);
        const offset = parseInt(params.get("offset") || "0", 10);

        let sql = "SELECT * FROM procedural_memories WHERE 1=1";
        const args: any[] = [];
        if (repository) { sql += " AND repository = ?"; args.push(repository); }
        sql += " ORDER BY success_count DESC, updated_at DESC LIMIT ? OFFSET ?";
        args.push(limit, offset);

        const skills = db.prepare(sql).all(...args) as any[];
        return json(res, { skills, pagination: { total: skills.length, limit, offset } });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { skills: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  // POST /api/memory/procedural — store procedural memory (skill)
  if (req.method === "POST" && path === "/api/memory/procedural") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const { name, description, steps, repository, applicableTo, prerequisites, sourceTaskId, insight } = body;
        if (!name || !steps) return json(res, { error: "name and steps are required" }, 400);

        const db = getLocalDb();
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        const id = generateId();
        db.prepare(
          "INSERT INTO procedural_memories (id, name, slug, description, insight, repository, applicable_to, steps, prerequisites, source_task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id, name, slug, description || null, insight || null, repository || null, applicableTo ? JSON.stringify(applicableTo) : null, JSON.stringify(steps), prerequisites ? JSON.stringify(prerequisites) : null, sourceTaskId || null);
        const created = db.prepare("SELECT * FROM procedural_memories WHERE id = ?").get(id);
        return json(res, { skill: created });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { success: true, id: "none" });
  }

  // DELETE /api/memory/:type/:id — delete a specific memory
  if (req.method === "DELETE" && /^\/api\/memory\/(semantic|episodic|procedural)\/[^/]+$/.test(path)) {
    const parts = path.split("/");
    const memoryType = parts[3];
    const memoryId = parts[4];
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const table = memoryType === "semantic" ? "semantic_memories" : memoryType === "episodic" ? "episodic_memories" : "procedural_memories";
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(memoryId);
        return json(res, { deleted: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    return json(res, { deleted: true });
  }

  // Catch-all for other memory sub-routes (feedback, routing, knowledge)
  if (path.startsWith("/api/memory/")) {
    if (req.method === "GET") return json(res, { skills: [], memories: [], results: [], scores: [], history: [] });
    if (req.method === "POST") return json(res, { success: true });
  }

  // POST /api/codebase/search — search code via cloud proxy (standalone returns empty)
  if (req.method === "POST" && path === "/api/codebase/search") {
    if (cloudProxy) {
      try {
        const body = JSON.parse(await readBody(req));
        const result = await cloudProxy("POST", "/api/codebase/search", body);
        return json(res, result);
      } catch (err) {
        return json(res, { snippets: [], formattedText: "", totalSnippets: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return json(res, { snippets: [], formattedText: "", totalSnippets: 0 });
  }

  // POST /api/codebase/search-with-embedding — search code by embedding vector
  if (req.method === "POST" && path === "/api/codebase/search-with-embedding") {
    if (cloudProxy) {
      try {
        const body = JSON.parse(await readBody(req));
        const result = await cloudProxy("POST", "/api/codebase/search-with-embedding", body);
        return json(res, result);
      } catch (err) {
        return json(res, { snippets: [], formattedText: "", totalSnippets: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return json(res, { snippets: [], formattedText: "", totalSnippets: 0 });
  }

  // POST /api/codebase/ingest — accept code chunks from local indexer
  if (req.method === "POST" && path === "/api/codebase/ingest") {
    if (cloudProxy) {
      try {
        const body = JSON.parse(await readBody(req));
        const result = await cloudProxy("POST", "/api/codebase/ingest", body);
        return json(res, result);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    // Standalone: acknowledge the ingest but don't store (no local vector DB yet)
    return json(res, { ingested: 0, message: "Codebase indexing not available in standalone mode" });
  }

  // GET /api/codebase/status/* — indexing status
  if (req.method === "GET" && path.startsWith("/api/codebase/status/")) {
    if (cloudProxy) {
      try {
        const result = await cloudProxy("GET", path);
        return json(res, result);
      } catch { /* fall through */ }
    }
    return json(res, { status: "not_indexed", totalFiles: 0, indexedFiles: 0, totalChunks: 0 });
  }

  // GET /api/codebase/stats — aggregate stats
  if (req.method === "GET" && path === "/api/codebase/stats") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", "/api/codebase/stats")); } catch { /* fall through */ }
    }
    return json(res, { totalRepositories: 0, totalChunks: 0, repositories: [] });
  }

  // POST /api/codebase/* — catch-all for remaining endpoints
  if (req.method === "POST" && path.startsWith("/api/codebase/")) {
    return json(res, { snippets: [], totalSnippets: 0 });
  }

  // GET /api/codebase/* — catch-all
  if (req.method === "GET" && path.startsWith("/api/codebase/")) {
    return json(res, { snippets: [], chunks: [], total: 0 });
  }

  // ── Worker ingestion endpoints (standalone mode) ──

  // POST /api/tasks/:id/logs — worker posts log entries
  const workerLogMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "POST" && workerLogMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      const taskId = workerLogMatch[1];
      await backend.postLog({
        taskId,
        type: body.type || "execution",
        message: body.message,
        severity: body.severity || "info",
      });
      broadcastSSE(`logs:${taskId}`, "log", {
        taskId,
        type: body.type || "execution",
        message: body.message,
        severity: body.severity || "info",
        createdAt: new Date().toISOString(),
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/coordination/messages — worker posts coordination messages
  if (req.method === "POST" && path === "/api/coordination/messages") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postCoordinationMessage({
        parentTaskId: body.parentTaskId,
        taskId: body.taskId,
        messageType: body.messageType || body.type,
        content: body.content,
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/control-center/code-events — worker posts code events
  if (req.method === "POST" && path === "/api/control-center/code-events") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postCodeEvent({
        taskId: body.taskId,
        filePath: body.filePath,
        toolName: body.toolName,
        expert: body.expert,
        metadata: body.metadata,
      });
      return json(res, { success: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Board endpoints (standalone mode) ──

  // GET /api/boards
  if (req.method === "GET" && path === "/api/boards") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") {
      if (cloudProxy) {
        try {
          const result = await cloudProxy("GET", "/api/boards");
          return json(res, result);
        } catch (err) {
          return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
        }
      }
      return json(res, { error: "No backend available" }, 503);
    }
    try {
      const boards = await backend.getBoards();
      return json(res, boards);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/boards
  if (req.method === "POST" && path === "/api/boards") {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const board = await backend.createBoard(body as { name: string; description?: string });
      return json(res, board, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/boards/:id/cards
  const boardCardsMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards$/);
  if (req.method === "GET" && boardCardsMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const cards = await backend.getBoardCards(boardCardsMatch[1]);
      return json(res, cards);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/boards/:id/cards
  const addCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards$/);
  if (req.method === "POST" && addCardMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const card = await backend.createCard(addCardMatch[1], body as { columnId: string; title: string; description?: string; priority?: string; position?: number });
      return json(res, card, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // DELETE /api/boards/:id/cards/:cardId
  const deleteCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)$/);
  if (req.method === "DELETE" && deleteCardMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      await backend.deleteCard(deleteCardMatch[2]);
      return json(res, { ok: true });
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/boards/:id/cards/:cardId/run
  const runCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)\/run$/);
  if (req.method === "POST" && runCardMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const task = await backend.runCard(runCardMatch[1], runCardMatch[2]);
      // Trigger orchestrator
      processQueuedTask(task.id).catch((e) => console.error("[orchestrator] processQueuedTask failed:", e));
      return json(res, task, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Analytics endpoints (standalone — query SQLite) ──

  // GET /api/analytics/tasks — task stats and daily breakdown
  if (req.method === "GET" && path === "/api/analytics/tasks") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const stats = db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN status IN ('running', 'planning') THEN 1 ELSE 0 END) as in_progress,
            SUM(estimated_cost_usd) as total_cost
          FROM tasks
          WHERE created_at >= datetime('now', ?)
        `).get(`-${days} days`) as any;

        const daily = db.prepare(`
          SELECT
            date(created_at) as date,
            COUNT(*) as tasks,
            SUM(estimated_cost_usd) as cost
          FROM tasks
          WHERE created_at >= datetime('now', ?)
          GROUP BY date(created_at)
          ORDER BY date ASC
        `).all(`-${days} days`) as any[];

        return json(res, {
          stats: {
            total: stats?.total || 0,
            completed: stats?.completed || 0,
            failed: stats?.failed || 0,
            inProgress: stats?.in_progress || 0,
          },
          daily,
          summary: {
            totalTasks: stats?.total || 0,
            totalCost: stats?.total_cost || 0,
            successRate: stats?.total > 0 ? ((stats?.completed || 0) / stats.total * 100).toFixed(1) : "0.0",
          },
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path + "?" + (new URL(req.url || "", "http://localhost").search || ""))); } catch { /* fall through */ }
    }
    return json(res, { stats: { total: 0, completed: 0, failed: 0, inProgress: 0 }, daily: [], summary: { totalTasks: 0, totalCost: 0, successRate: "0.0" } });
  }

  // GET /api/analytics/workers — per-persona worker stats
  if (req.method === "GET" && path === "/api/analytics/workers") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const workers = db.prepare(`
          SELECT
            worker_persona as persona,
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
            ROUND(SUM(CASE WHEN status = 'completed' THEN 1.0 ELSE 0 END) / COUNT(*) * 100, 1) as success_rate,
            AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL
              THEN (julianday(completed_at) - julianday(started_at)) * 86400
              ELSE NULL END) as avg_duration_seconds,
            SUM(estimated_cost_usd) as total_cost
          FROM tasks
          WHERE created_at >= datetime('now', ?) AND worker_persona IS NOT NULL
          GROUP BY worker_persona
          ORDER BY total DESC
        `).all(`-${days} days`) as any[];

        return json(res, {
          workers: workers.map((w: any) => ({
            persona: w.persona,
            total: w.total,
            success: w.success,
            successRate: w.success_rate || 0,
            avgDuration: w.avg_duration_seconds ? Math.round(w.avg_duration_seconds) : null,
            totalCost: w.total_cost || 0,
          })),
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { workers: [] });
  }

  // GET /api/analytics/costs — cost breakdown by model
  if (req.method === "GET" && path === "/api/analytics/costs") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const totals = db.prepare(`
          SELECT
            SUM(estimated_cost_usd) as total_cost,
            COUNT(*) as total_tasks,
            SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) as total_tokens
          FROM tasks
          WHERE created_at >= datetime('now', ?)
        `).get(`-${days} days`) as any;

        const byModel = db.prepare(`
          SELECT
            worker_model as model,
            COUNT(*) as tasks,
            SUM(estimated_cost_usd) as cost,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens
          FROM tasks
          WHERE created_at >= datetime('now', ?) AND worker_model IS NOT NULL
          GROUP BY worker_model
          ORDER BY cost DESC
        `).all(`-${days} days`) as any[];

        const daily = db.prepare(`
          SELECT
            date(created_at) as date,
            SUM(estimated_cost_usd) as cost,
            COUNT(*) as tasks
          FROM tasks
          WHERE created_at >= datetime('now', ?)
          GROUP BY date(created_at)
          ORDER BY date ASC
        `).all(`-${days} days`) as any[];

        return json(res, {
          totalCost: totals?.total_cost || 0,
          totalTasks: totals?.total_tasks || 0,
          totalTokens: totals?.total_tokens || 0,
          byModel,
          daily,
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { totalCost: 0, totalTasks: 0, totalTokens: 0, byModel: [], daily: [] });
  }

  // GET /api/analytics/failures — failure analysis
  if (req.method === "GET" && path === "/api/analytics/failures") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const summary = db.prepare(`
          SELECT
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as total_failures,
            COUNT(*) as total_tasks,
            ROUND(SUM(CASE WHEN status = 'failed' THEN 1.0 ELSE 0 END) / MAX(COUNT(*), 1) * 100, 1) as failure_rate
          FROM tasks
          WHERE created_at >= datetime('now', ?)
        `).get(`-${days} days`) as any;

        const byPersona = db.prepare(`
          SELECT worker_persona as persona, COUNT(*) as count
          FROM tasks
          WHERE status = 'failed' AND created_at >= datetime('now', ?) AND worker_persona IS NOT NULL
          GROUP BY worker_persona ORDER BY count DESC
        `).all(`-${days} days`) as any[];

        const byModel = db.prepare(`
          SELECT worker_model as model, COUNT(*) as count
          FROM tasks
          WHERE status = 'failed' AND created_at >= datetime('now', ?) AND worker_model IS NOT NULL
          GROUP BY worker_model ORDER BY count DESC
        `).all(`-${days} days`) as any[];

        return json(res, {
          period: `${days}d`,
          summary: {
            totalFailures: summary?.total_failures || 0,
            totalTasks: summary?.total_tasks || 0,
            failureRate: summary?.failure_rate || 0,
          },
          byPersona,
          byModel,
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { period: "30d", summary: { totalFailures: 0, totalTasks: 0, failureRate: 0 }, byPersona: [], byModel: [] });
  }

  // GET /api/analytics/token-usage — token breakdown
  if (req.method === "GET" && path === "/api/analytics/token-usage") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const totals = db.prepare(`
          SELECT
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(cache_creation_tokens) as cache_creation_tokens,
            SUM(cache_read_tokens) as cache_read_tokens,
            SUM(estimated_cost_usd) as total_cost
          FROM tasks
          WHERE created_at >= datetime('now', ?)
        `).get(`-${days} days`) as any;

        return json(res, {
          inputTokens: totals?.input_tokens || 0,
          outputTokens: totals?.output_tokens || 0,
          cacheCreationTokens: totals?.cache_creation_tokens || 0,
          cacheReadTokens: totals?.cache_read_tokens || 0,
          totalCost: totals?.total_cost || 0,
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 });
  }

  // GET /api/analytics/effectiveness — success and completion metrics
  if (req.method === "GET" && path === "/api/analytics/effectiveness") {
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const db = getLocalDb();
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const range = params.get("range") || "30d";
        const days = parseInt(range.replace("d", ""), 10) || 30;

        const stats = db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
            SUM(CASE WHEN github_pr_url IS NOT NULL THEN 1 ELSE 0 END) as prs_created,
            SUM(CASE WHEN status = 'pr_approved' THEN 1 ELSE 0 END) as prs_approved
          FROM tasks
          WHERE created_at >= datetime('now', ?)
        `).get(`-${days} days`) as any;

        const total = stats?.total || 0;
        return json(res, {
          successRate: total > 0 ? ((stats?.completed || 0) / total * 100).toFixed(1) : "0.0",
          prCreationRate: total > 0 ? ((stats?.prs_created || 0) / total * 100).toFixed(1) : "0.0",
          prApprovalRate: (stats?.prs_created || 0) > 0 ? ((stats?.prs_approved || 0) / stats.prs_created * 100).toFixed(1) : "0.0",
          totalTasks: total,
          completedTasks: stats?.completed || 0,
          failedTasks: stats?.failed || 0,
          prsCreated: stats?.prs_created || 0,
          prsApproved: stats?.prs_approved || 0,
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { successRate: "0.0", totalTasks: 0, completedTasks: 0, failedTasks: 0 });
  }

  // Catch-all for other analytics endpoints — proxy or empty response
  if (path.startsWith("/api/analytics/")) {
    if (cloudProxy) {
      try {
        const result = await cloudProxy(req.method || "GET", path);
        return json(res, result);
      } catch { /* fall through */ }
    }
    return json(res, {});
  }

  return notFound(res);
}

// ── PRD Decomposition via Claude Agent SDK ────────────

// Fallback prompt — used only when the server endpoint GET /api/agent/prd-prompt is unreachable.
// The canonical prompt lives in api/src/services/prd-decomposer.ts (SYSTEM_PROMPT).
export const PRD_SYSTEM_PROMPT = `You are a senior technical program manager who decomposes Product Requirements Documents (PRDs) into implementation cards for AI coding agents.

Each card represents ONE cohesive epic — a major functional slice that a single AI worker can execute independently (given its dependencies are met). Workers receive the FULL PRD as their specification, so cards define SCOPE (what to build), not specs (how to build it — the PRD has those).

***REMOVED******REMOVED*** Sizing Rules (CRITICAL)

- Target **3-4 total cards** for the entire project. Fewer cards = fewer handoffs = fewer integration bugs between workers.
- Target 15-30 deliverables per card. AI workers perform BETTER with larger, cohesive cards that cover a complete functional layer.
- Cards with >35 deliverables should be split. Cards with <8 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Foundation" — combines project scaffolding, CI/CD pipeline, AND all backend/server code (models, handlers, middleware, services, seed data, tests). CI deliverables are part of this card, NOT a separate card. Assigned to backend_developer.
- For full-stack projects: Card 1 = Foundation (backend + CI), Card 2 = Frontend (all UI), Last card = Deployment + Validation.
- For backend-only projects: Card 1 = Foundation (backend + CI), Card 2 = Deployment + Validation.
- The LAST card ALWAYS includes production deployment + validation — deployment pipeline, smoke tests, seed verification, go-live checklist.

***REMOVED******REMOVED*** Card Description Format (REQUIRED)

Each card description MUST include ALL of the following sections:

***REMOVED******REMOVED******REMOVED*** Epic Overview
A 2-3 sentence summary of what this card accomplishes and why it matters.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- What prior cards created that this card builds on (reference by card index)
- What this card must NOT touch (boundaries with other cards)

***REMOVED******REMOVED******REMOVED*** Prerequisites
- List card indices that must complete before this card can start

***REMOVED******REMOVED******REMOVED*** Deliverables
- Numbered list of concrete, testable outputs (files, endpoints, components, tests)
- Each deliverable should be independently verifiable

***REMOVED******REMOVED******REMOVED*** Technical Specification
- Key technical decisions, patterns, libraries, or APIs to use
- Any constraints or non-functional requirements

***REMOVED******REMOVED*** Persona Assignment

Assign exactly one persona per card from this list:
- backend_developer — API endpoints, database, server logic
- frontend_developer — UI components, pages, client-side logic
- devops_engineer — Infrastructure, CI/CD, deployment, monitoring
- security_engineer — Auth, encryption, vulnerability hardening
- qa_engineer — Test suites, E2E tests, coverage
- tech_writer — Documentation, guides, API docs
- project_manager — Coordination, planning, process

Choose the persona whose primary skillset best matches the card's dominant work.

***REMOVED******REMOVED*** Dependency Rules

- dependencyIndices are 0-based array positions referring to other cards
- No circular dependencies allowed — the dependency graph must be a DAG
- Card 0 (Foundation) has no dependencies (empty array)
- All subsequent cards depend on Card 0 (directly or transitively)
- The last card (Deployment) typically depends on all preceding cards

***REMOVED******REMOVED*** CI/CD Is a First-Class Citizen (Part of Card 1)

CI/CD is NOT a separate card. It is part of Card 1 (Foundation). The CI pipeline proves code compiles, passes lint, passes tests, and builds.

Card 1 CI deliverables MUST include:
1. CI workflow file (e.g., .github/workflows/ci.yml) with ALL quality steps (lint, typecheck, test, build)
2. A trivial passing test file so the test step succeeds on first run
3. CI workflow triggers MUST include BOTH \`push: [main]\` AND \`pull_request: [main]\` events. Without \`pull_request\` triggers, CI won't run on PRs and code merges without verification.

IMPORTANT: Do NOT create a separate "CI verification" story that pushes to main to test the pipeline. CI verification happens automatically when the PR is created — the \`pull_request\` trigger handles it. Workers must NEVER push directly to main. All code goes through story branches → consolidated PR → merge. A story that pushes to main bypasses the PR workflow and causes the task to complete without a PR.

CI workflow steps MUST run the EXACT SAME commands as the quality gates — no additions, no differences. This is critical: if the quality gate runs "go vet ./..." and "go test ./... -v -count=1 -race", the CI workflow MUST run those same commands, NOT golangci-lint or any other tool. The quality gates are the single source of truth for what "passing" means. Any divergence between the quality gates and CI creates a gap where code passes one but fails the other.

For Go CI: use "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server" (NOT golangci-lint, staticcheck, or other third-party linters). For Node.js CI: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python CI: use "python -m pytest", "python -m mypy .". Do NOT add third-party tools to CI that aren't already in the repo.

ALL subsequent cards MUST depend on Card 1 (directly or transitively).

***REMOVED******REMOVED*** Priority Assignment

- urgent: Card 1 — Foundation (setup + CI + backend)
- high: Feature cards (frontend, integration)
- medium: Deployment + validation (last card)
- low: Nice-to-have, polish, documentation

***REMOVED******REMOVED*** Output Format

Respond with ONLY a JSON object (no markdown fences, no explanation):

{
  "boardName": "Short descriptive board name derived from the PRD title",
  "qualityGates": [
    {
      "name": "backend",
      "trigger": "api/**",
      "commands": ["cd api && go vet ./...", "cd api && go test ./... -v -count=1 -race", "cd api && go build -o /dev/null ./cmd/server"]
    },
    {
      "name": "frontend",
      "trigger": "web/**",
      "commands": ["cd web && npm run lint", "cd web && npm run test", "cd web && npm run build"]
    },
    {
      "name": "typecheck",
      "trigger": "src/**/*.ts",
      "commands": ["npx tsc --noEmit"]
    }
  ],
  "ciWorkflowPath": ".github/workflows/ci.yml",
  "cards": [
    {
      "title": "Card title (concise, action-oriented)",
      "description": "Full description with all required sections",
      "persona": "one_of_the_valid_personas",
      "priority": "urgent|high|medium|low",
      "dependencyIndices": [0],
      "labels": ["relevant", "tags"],
      "estimatedSteps": 8
    }
  ]
}

qualityGates: Extract pre-commit quality gate commands from the PRD. Each gate has a name (e.g., "backend", "frontend"), a file trigger glob (e.g., "api/**"), and the exact shell commands to run. These commands run in a minimal container — ONLY use tools from the standard toolchain. For Go: use ONLY "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server", "gofmt -w ." (NOT "gofmt ./..." — gofmt doesn't support "..."). Do NOT use golangci-lint, staticcheck, or other third-party tools — they are not installed. For Node.js: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python: use "python -m pytest", "python -m mypy .". IMPORTANT: The CI workflow MUST use the exact same commands as the quality gates — no divergence allowed.
ciWorkflowPath: The path to the CI workflow file in the repo. GitHub repos use ".github/workflows/ci.yml", Bitbucket repos use "bitbucket-pipelines.yml". Used to detect when CI becomes available and to verify CI passes after push.
estimatedSteps is the number of deliverables in the card (used for progress tracking).
labels should include relevant technology or domain tags (e.g., "react", "api", "terraform", "auth").`;

/**
 * Decompose a PRD using the configured planning agent model.
 *
 * Routes to the appropriate SDK based on provider:
 * - Anthropic: Claude Agent SDK (query() async generator with OAuth)
 * - OpenAI/Google/Ollama: Vercel AI SDK (generateTextWithTools())
 */
export async function decomposePrdLocal(
  prdContent: string,
  planningConfig: { provider: string; model: string; apiKey?: string },
  serverPrompt?: string,
  onProgress?: (message: string) => void,
): Promise<{ boardName: string; cards: unknown[] }> {
  const systemPrompt = serverPrompt || PRD_SYSTEM_PROMPT;
  const startTime = Date.now();
  let resultText: string;

  if (planningConfig.provider === "anthropic" || !planningConfig.provider) {
    // Anthropic provider — use Claude Agent SDK with OAuth
    resultText = await decomposePrdViaAgentSdk(prdContent, systemPrompt, onProgress);
  } else {
    // Non-Anthropic provider — use Vercel AI SDK
    resultText = await decomposePrdViaAiSdk(prdContent, planningConfig, systemPrompt, onProgress);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  if (!resultText.trim()) {
    onProgress?.(`❌ Empty output after ${elapsed}s`);
    throw new Error("AI returned empty output");
  }

  onProgress?.(`✅ Generation complete. Finalizing board...`);

  // Strip markdown fences if present (greedy match for large content)
  let jsonStr = resultText.trim();
  const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n([\s\S]*)\n\s*```\s*$/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else if (jsonStr.startsWith("```")) {
    // Fallback: strip opening ``` line and closing ``` line
    const lines = jsonStr.split("\n");
    if (lines[0].match(/^```/)) lines.shift();
    if (lines[lines.length - 1]?.match(/^```\s*$/)) lines.pop();
    jsonStr = lines.join("\n").trim();
  }

  const parsed = JSON.parse(jsonStr);
  if (!parsed.boardName || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    throw new Error("Invalid PRD decomposition (missing boardName or cards)");
  }
  onProgress?.(`📊 Parsed ${parsed.cards.length} cards for board "${parsed.boardName}"`);
  return parsed;
}

// ── Anthropic path: Claude Agent SDK ──────────────────

/**
 * Decompose PRD via Claude Agent SDK (Anthropic provider).
 * Uses OAuth from ~/.claude/.credentials.json.
 */
async function decomposePrdViaAgentSdk(
  prdContent: string,
  systemPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const startTime = Date.now();
  let resultText = "";
  let textStarted = false;
  let lineBuffer = "";

  function processTextDelta(text: string): void {
    lineBuffer += text;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      flushJsonLine(line, onProgress);
    }
  }

  const claudePath = findClaudePath();
  if (!claudePath) {
    throw new Error("Claude Code CLI not found. Install Claude Code and ensure it's available on your PATH.");
  }
  onProgress?.("Analyzing PRD and generating implementation cards — this typically takes 1–3 minutes...");

  const phases = [
    "Reading and understanding your PRD...",
    "Identifying features and components...",
    "Breaking down into implementation cards...",
    "Defining dependencies and priorities...",
    "Structuring the project board...",
  ];
  let phaseIdx = 0;

  const heartbeat = setInterval(() => {
    if (!textStarted) {
      if (phaseIdx < phases.length) {
        onProgress?.(`⏳ ${phases[phaseIdx]}`);
        phaseIdx++;
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        onProgress?.(`⏳ Still working... (${elapsed}s)`);
      }
    }
  }, 15_000);

  // Clean env to prevent nested-session detection
  const cleanEnv: Record<string, string | undefined> = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

  try {
    const conversation = query({
      prompt: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
      options: {
        pathToClaudeCodeExecutable: claudePath,
        env: cleanEnv,
        systemPrompt,
        tools: [],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: 1,
        thinking: { type: "disabled" },
        includePartialMessages: true,
        persistSession: false,
        stderr: (data: string) => {
          onProgress?.(`[stderr] ${data.trim()}`);
        },
      },
    });

    for await (const message of conversation) {
      if (message.type === "stream_event" && message.event) {
        const event = message.event;
        if (event.type === "content_block_delta" && "delta" in event && event.delta && "text" in event.delta) {
          if (!textStarted) {
            textStarted = true;
            clearInterval(heartbeat);
            onProgress?.("✅ Cards are being generated...");
          }
          resultText += event.delta.text;
          processTextDelta(event.delta.text);
        }
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block && block.text && !resultText) {
            if (!textStarted) {
              textStarted = true;
              clearInterval(heartbeat);
            }
            resultText = block.text;
            processTextDelta(block.text);
          }
        }
      }

      if (message.type === "result") {
        if (message.is_error) {
          const errors = "errors" in message ? (message.errors as string[]).join("; ") : "Unknown error";
          throw new Error(`Claude Agent SDK error: ${errors}`);
        }
        // Only use result as fallback — streaming already captured the raw JSON
        if ("result" in message && message.result && !resultText) {
          resultText = message.result as string;
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
  }

  if (lineBuffer.trim()) flushJsonLine(lineBuffer, onProgress);
  return resultText;
}

// ── Non-Anthropic path: Vercel AI SDK ──────────────────

/**
 * Decompose PRD via Vercel AI SDK (any provider — OpenAI, Google, Ollama, Anthropic).
 * Uses the org's API key for the configured provider.
 */
async function decomposePrdViaAiSdk(
  prdContent: string,
  config: { provider: string; model: string; apiKey?: string },
  systemPrompt: string,
  onProgress?: (message: string) => void,
): Promise<string> {
  const { generateTextWithTools } = await import("./ai-sdk-generate.js");

  const startTime = Date.now();
  onProgress?.(`Generating cards (${config.model})...`);

  const apiKey = config.apiKey || process.env[`${config.provider.toUpperCase()}_API_KEY`] || "";
  if (!apiKey && config.provider !== "ollama") {
    throw new Error(`No API key for ${config.provider}. Configure it in Settings > Integrations.`);
  }

  const result = await generateTextWithTools({
    provider: config.provider as "anthropic" | "openai" | "google" | "ollama",
    model: config.model,
    apiKey,
    prompt: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
    systemPrompt,
    enableTools: false,
    maxTokens: 16384,
    temperature: 0.7,
  });

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  onProgress?.(`Response received (${elapsed}s)`);

  // Parse lines for progress display
  for (const line of result.split("\n")) {
    flushJsonLine(line, onProgress);
  }

  return result;
}

// ── Shared: JSON line parser for progress display ──────

function flushJsonLine(line: string, onProgress?: (message: string) => void): void {
  if (!line.trim()) return;
  const trimmed = line.trim();
  if (/^[{}\[\],]+$/.test(trimmed)) return;
  const kvMatch = trimmed.match(/^"(\w+)":\s*(.+?)[\s,]*$/);
  if (kvMatch) {
    const [, key, val] = kvMatch;
    if (key === "title" || key === "boardName") {
      onProgress?.(`📋 ${key}: ${val.replace(/^"|"$/g, "")}`);
    } else if (key === "persona") {
      onProgress?.(`👤 ${key}: ${val.replace(/^"|"$/g, "")}`);
    } else if (key === "priority") {
      onProgress?.(`⚡ ${key}: ${val.replace(/^"|"$/g, "")}`);
    } else if (key === "description") {
      const desc = val.replace(/^"|"$/g, "");
      const short = desc.length > 120 ? desc.substring(0, 120) + "..." : desc;
      onProgress?.(`   ${key}: ${short}`);
    } else if (key === "labels") {
      onProgress?.(`🏷️  ${key}: ${val}`);
    } else if (key === "dependencyIndices") {
      onProgress?.(`🔗 deps: ${val}`);
    }
  }
}

// ── Server Lifecycle ───────────────────────────────────

const PORT_FILE = join(homedir(), ".workermill", "agent.port");
const TOKEN_FILE = join(homedir(), ".workermill", "agent.token");
let authToken: string | null = null;
let server: ReturnType<typeof createServer> | null = null;

/**
 * Start the local API server.
 * Finds an available port on localhost and writes it to ~/.workermill/agent.port.
 */
export function startLocalApi(config: AgentConfig): Promise<number> {
  agentConfig = config;
  startTime = Date.now();

  // Set up cloud proxy using the agent's existing axios instance.
  // Extract response data from axios errors so callers get the real API error message.
  import("./api.js").then(({ api }) => {
    setCloudProxy(async (method: string, path: string, body?: unknown) => {
      try {
        const resp = method === "GET"
          ? await api.get(path)
          : await api.post(path, body);
        return resp.data;
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: unknown } };
        if (axiosErr.response?.data) {
          const data = axiosErr.response.data as { error?: string };
          const status = axiosErr.response.status || 500;
          const apiError = new Error(data.error || `API error ${status}`);
          (apiError as any).status = status;
          (apiError as any).data = data;
          throw apiError;
        }
        throw err;
      }
    });
  });

  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error("[local-api] Request error:", err);
        if (!res.headersSent) {
          json(res, { error: "Internal error" }, 500);
        }
      });
    });

    // Listen on random available port, localhost only
    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      const port = addr.port;

      // Write port file for client discovery
      try {
        writeFileSync(PORT_FILE, String(port), "utf-8");
      } catch {
        // Non-fatal — clients can still connect if they know the port
      }

      // Generate auth token for local IPC — clients read from TOKEN_FILE
      try {
        authToken = randomBytes(32).toString("hex");
        const tokenDir = join(homedir(), ".workermill");
        if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
        writeFileSync(TOKEN_FILE, authToken, { mode: 0o600 });
      } catch {
        // Non-fatal — if token file write fails, auth is still enforced via in-memory token
      }

      resolve(port);
    });

    server.on("error", reject);
  });
}

/**
 * Stop the local API server and clean up the port file.
 */
export function stopLocalApi(): Promise<void> {
  // Clear cleanup interval
  if (cleanupInterval) { clearInterval(cleanupInterval); cleanupInterval = null; }

  // Clean up port file and token file
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch { /* best effort */ }
  try {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } catch { /* best effort */ }
  authToken = null;

  // Close all SSE connections
  for (const client of sseClients) {
    try { client.res.end(); } catch { /* ignore */ }
  }
  sseClients.clear();

  // Close all coordination SSE connections and clear stores
  for (const [, clients] of coordSseClients) {
    for (const c of clients) { try { c.end(); } catch { /* ignore */ } }
  }
  coordSseClients.clear();
  coordStores.clear();

  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
