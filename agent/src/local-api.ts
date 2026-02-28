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
import { getActiveBackend } from "./backends/selector.js";
import { processQueuedTask, stopWorkerTask } from "./backends/local/orchestrator.js";

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

  // Authenticate: require Bearer token from ~/.workermill/agent.token
  if (authToken) {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${authToken}`) {
      return json(res, { error: "Unauthorized" }, 401);
    }
  }

  const { path } = parseUrl(req.url || "/");

  // ── GET endpoints ──

  if (req.method === "GET" && path === "/api/status") {
    const state: AgentState = {
      version: AGENT_VERSION,
      agentId: agentConfig?.agentId || "unknown",
      apiUrl: agentConfig?.apiUrl || "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      sandbox: agentConfig?.sandbox || "none",
      tasks: Array.from(localTasks.values()),
    };
    return json(res, state);
  }

  if (req.method === "GET" && path === "/api/tasks") {
    // Merge local tasks (real-time) with cloud tasks (queued, missed events, etc.)
    const merged = await getMergedTasks();
    return json(res, merged);
  }

  // GET /api/tasks/:id
  const taskMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
  if (req.method === "GET" && taskMatch) {
    const task = localTasks.get(taskMatch[1]);
    if (!task) return json(res, { error: "Task not found" }, 404);
    return json(res, task);
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

  // GET /api/tasks/:id/detail — proxy rich task detail from cloud control center
  const detailMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/detail$/);
  if (req.method === "GET" && detailMatch) {
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

  // GET /api/tasks/:id/logs — proxy logs from cloud API
  const logsMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "GET" && logsMatch) {
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

  // GET /api/tasks/:id/code-events — proxy code events from cloud API
  const codeEventsMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/code-events$/);
  if (req.method === "GET" && codeEventsMatch) {
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
    // Send initial state (merged with cloud tasks so completed/failed show up)
    getMergedTasks().then((merged) => {
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
    const backend = getActiveBackend();
    if (backend?.mode === "local") {
      try {
        const body = JSON.parse(await readBody(req));
        const task = await backend.createTask({
          summary: body.summary,
          description: body.description,
          githubRepo: body.githubRepo || body.repo,
          scmProvider: body.scmProvider,
          workerModel: body.workerModel,
        });
        processQueuedTask(task.id).catch(() => {});
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
    const backend = getActiveBackend();
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
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
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

      // Fetch planning agent config from the API (provider, model, API key)
      let planningConfig: { provider: string; model: string; apiKey?: string } = {
        provider: "anthropic",
        model: "",
      };
      try {
        const settings = await cloudProxy("GET", "/api/settings") as Record<string, unknown>;
        if (settings?.planningAgentProvider) planningConfig.provider = settings.planningAgentProvider as string;
        if (settings?.planningAgentModel) planningConfig.model = settings.planningAgentModel as string;
        if (settings?.planningApiKey) planningConfig.apiKey = settings.planningApiKey as string;
      } catch { /* fall back to defaults */ }

      // Fetch PRD system prompt from the API (single source of truth)
      let prdSystemPrompt: string | undefined;
      try {
        const promptData = await cloudProxy("GET", "/api/agent/prd-prompt") as { systemPrompt?: string };
        if (promptData?.systemPrompt) {
          prdSystemPrompt = promptData.systemPrompt;
          sendEvent("progress", { message: `Fetched PRD prompt from server` });
        }
      } catch {
        sendEvent("progress", { message: `Using local PRD prompt (server unavailable)` });
      }

      sendEvent("progress", { message: `Starting PRD decomposition...` });

      // Decompose PRD locally — routes to Claude Agent SDK (Anthropic) or Vercel AI SDK (others)
      const decomposed = await decomposePrdLocal(prdContent, planningConfig, prdSystemPrompt, (msg) => {
        sendEvent("progress", { message: msg });
      });

      sendEvent("progress", { message: `Creating board with ${decomposed.cards.length} cards...` });

      // Send pre-decomposed cards to cloud API to create the board
      const result = await cloudProxy("POST", "/api/prd/decompose", {
        ...body,
        preDecomposed: decomposed,
      });

      sendEvent("done", { result });
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

  // POST /api/tasks/:id/talk — send message to worker
  const talkMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/talk$/);
  if (req.method === "POST" && talkMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      // Use parentTaskId if available — Epic workers poll PARENT_TASK_ID for commands
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
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      // Use parentTaskId — Epic workers poll PARENT_TASK_ID for blocker responses
      const localTask = localTasks.get(blockerMatch[1]);
      const parentId = localTask?.parentTaskId || blockerMatch[1];
      const result = await cloudProxy("POST", "/api/coordination/blocker-response", {
        parentTaskId: parentId,
        blockerId: body.blockerId,
        action: body.action, // retry | skip | abort
        guidance: body.guidance,
      });
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/plan/approve
  const approveMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/approve$/);
  if (req.method === "POST" && approveMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", `/api/tasks/${approveMatch[1]}/plan/approve`, {});
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/plan/reject
  const rejectMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/reject$/);
  if (req.method === "POST" && rejectMatch) {
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

  // POST /api/tasks/:id/retry — proxy retry to cloud API
  const retryMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/retry$/);
  if (req.method === "POST" && retryMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", `/api/tasks/${retryMatch[1]}/retry`, {});
      triggerPoll();
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/issues — search Jira issues (proxied from cloud API)
  if (req.method === "GET" && path === "/api/issues") {
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

  // GET /api/issues/projects — list Jira projects (proxied from cloud API)
  if (req.method === "GET" && path === "/api/issues/projects") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/issues/projects");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas
  if (req.method === "GET" && path === "/api/personas") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/worker-decisions/worker-config", undefined);
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

  // ── Worker ingestion endpoints (standalone mode) ──

  // POST /api/tasks/:id/logs — worker posts log entries
  const workerLogMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "POST" && workerLogMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return notFound(res);
    try {
      const body = JSON.parse(await readBody(req));
      await backend.postLog({
        taskId: workerLogMatch[1],
        type: body.type || "execution",
        message: body.message,
        severity: body.severity || "info",
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

  // POST /api/boards/:id/cards/:cardId/run
  const runCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)\/run$/);
  if (req.method === "POST" && runCardMatch) {
    const backend = getActiveBackend();
    if (!backend || backend.mode !== "local") return json(res, { error: "No backend available" }, 503);
    try {
      const task = await backend.runCard(runCardMatch[1], runCardMatch[2]);
      // Trigger orchestrator
      processQueuedTask(task.id).catch(() => {});
      return json(res, task, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return notFound(res);
}

// ── PRD Decomposition via Claude Agent SDK ────────────

// Fallback prompt — used only when the server endpoint GET /api/agent/prd-prompt is unreachable.
// The canonical prompt lives in api/src/services/prd-decomposer.ts (SYSTEM_PROMPT).
export const PRD_SYSTEM_PROMPT = `You are a senior technical program manager who decomposes Product Requirements Documents (PRDs) into implementation cards for AI coding agents.

Each card represents ONE cohesive epic — a vertical slice or architectural layer that a single AI worker can execute independently (given its dependencies are met).

## Sizing Rules (CRITICAL)

- Target 7-12 deliverables per card. This is the sweet spot for AI worker execution.
- Cards with >15 deliverables MUST be split into smaller cards.
- Cards with <4 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Project Setup & Dev Environment" — repo scaffolding, tooling, environment config.
- Card 2 is ALWAYS "CI/CD Pipeline & Quality Gates" — the FULL CI pipeline (lint, typecheck, test, build) must be created and verified green BEFORE any feature work begins. This card must include a trivial passing test so CI actually runs. Assigned to devops_engineer. ALL subsequent feature cards MUST depend on this card (directly or transitively).
- The LAST card is ALWAYS "Production Deploy & Validation" — deployment pipeline, smoke tests, monitoring, go-live checklist.

## Card Description Format (REQUIRED)

Each card description MUST include ALL of the following sections:

### Epic Overview
A 2-3 sentence summary of what this card accomplishes and why it matters.

### Scope Boundary
- What prior cards created that this card builds on (reference by card index)
- What this card must NOT touch (boundaries with other cards)

### Prerequisites
- List card indices that must complete before this card can start

### Deliverables
- Numbered list of concrete, testable outputs (files, endpoints, components, tests)
- Each deliverable should be independently verifiable

### Technical Specification
- Key technical decisions, patterns, libraries, or APIs to use
- Any constraints or non-functional requirements

## Persona Assignment

Assign exactly one persona per card from this list:
- backend_developer — API endpoints, database, server logic
- frontend_developer — UI components, pages, client-side logic
- devops_engineer — Infrastructure, CI/CD, deployment, monitoring
- security_engineer — Auth, encryption, vulnerability hardening
- qa_engineer — Test suites, E2E tests, coverage
- tech_writer — Documentation, guides, API docs
- project_manager — Coordination, planning, process

Choose the persona whose primary skillset best matches the card's dominant work.

## Dependency Rules

- dependencyIndices are 0-based array positions referring to other cards
- No circular dependencies allowed — the dependency graph must be a DAG
- Card 0 (Project Setup) has no dependencies (empty array)
- The last card (Production Deploy) typically depends on all or most preceding cards

## CI/CD Is a First-Class Citizen

The CI/CD card (Card 2) is NOT a nice-to-have. It is the quality gate that proves code works. Every AI can generate code — the CI pipeline proves it compiles, passes lint, passes tests, and builds.

Card 2 deliverables MUST include:
1. CI workflow file (e.g., .github/workflows/ci.yml) with ALL quality steps (lint, typecheck, test, build)
2. A trivial passing test file so the test step succeeds on first run
3. Verification that the pipeline actually runs and passes (acceptance criterion, not just "file exists")

CI workflow steps MUST run the EXACT SAME commands as the quality gates — no additions, no differences. This is critical: if the quality gate runs "go vet ./..." and "go test ./... -v -count=1 -race", the CI workflow MUST run those same commands, NOT golangci-lint or any other tool. The quality gates are the single source of truth for what "passing" means. Any divergence between the quality gates and CI creates a gap where code passes one but fails the other.

For Go CI: use "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server" (NOT golangci-lint, staticcheck, or other third-party linters). For Node.js CI: use "npm run lint", "npm run test", "npm run build". For Python CI: use "python -m pytest", "python -m mypy .". Do NOT add third-party tools to CI that aren't already in the repo.

ALL feature cards (Card 3+) MUST have Card 2 in their transitive dependency chain.

## Priority Assignment

- urgent: Blocking all other work (Card 0 — setup, Card 1 — CI/CD pipeline)
- high: Core business logic, critical path items
- medium: Important but not blocking — features, integrations
- low: Nice-to-have, polish, documentation

## Output Format

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

qualityGates: Extract pre-commit quality gate commands from the PRD. Each gate has a name (e.g., "backend", "frontend"), a file trigger glob (e.g., "api/**"), and the exact shell commands to run. These commands run in a minimal container — ONLY use tools from the standard toolchain. For Go: use ONLY "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server", "gofmt -w ." (NOT "gofmt ./..." — gofmt doesn't support "..."). Do NOT use golangci-lint, staticcheck, or other third-party tools — they are not installed. For Node.js: use "npm run lint", "npm run test", "npm run build". For Python: use "python -m pytest", "python -m mypy .". IMPORTANT: The CI workflow MUST use the exact same commands as the quality gates — no divergence allowed.
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
        if ("result" in message && message.result) {
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

  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
