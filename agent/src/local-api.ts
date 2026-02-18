/**
 * Agent Local API Server
 *
 * Lightweight HTTP + SSE server that exposes agent state to local clients
 * (VS Code extension, CLI tools, etc). Binds to localhost only.
 *
 * Discovery: writes port to ~/.workermill/agent.port
 * Auth: none (localhost-only, user-scoped)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { AGENT_VERSION } from "./version.js";
import type { AgentConfig } from "./config.js";

// ── Types ──────────────────────────────────────────────

export interface LocalTaskInfo {
  id: string;
  summary: string;
  status: "planning" | "running" | "completed" | "failed";
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
//   "task:started"   { id, summary, persona, model, repo }
//   "task:completed" { id, exitCode }
//   "task:failed"    { id, exitCode, error }
//   "task:log"       { id, line, severity }
//   "task:planning"  { id, summary }
//   "task:plan_done" { id, success }
//   "state:changed"  {} (generic — triggers full state refresh for clients)

// ── State Registry ─────────────────────────────────────

/**
 * Tracks tasks known to the local API.
 * Populated by event handlers, read by HTTP endpoints.
 */
const localTasks = new Map<string, LocalTaskInfo>();

agentEvents.on("task:started", (info: { id: string; summary: string; persona?: string; model?: string; repo?: string }) => {
  localTasks.set(info.id, {
    id: info.id,
    summary: info.summary,
    status: "running",
    persona: info.persona,
    model: info.model,
    repo: info.repo,
    startedAt: new Date().toISOString(),
  });
});

agentEvents.on("task:planning", (info: { id: string; summary: string }) => {
  localTasks.set(info.id, {
    id: info.id,
    summary: info.summary,
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
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  let didDelete = false;
  for (const [id, task] of localTasks) {
    if ((task.status === "completed" || task.status === "failed") &&
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
agentEvents.on("task:planning", (info) => broadcastSSE("tasks", "task:planning", info));
agentEvents.on("task:plan_done", (info) => broadcastSSE("tasks", "task:plan_done", info));
agentEvents.on("task:log", (info) => broadcastSSE(`logs:${info.id}`, "log", info));
agentEvents.on("state:changed", () => broadcastSSE("tasks", "state:changed", {}));

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
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function sseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
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
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const { path } = parseUrl(req.url || "/");

  // ── GET endpoints ──

  if (req.method === "GET" && path === "/api/status") {
    const state: AgentState = {
      version: AGENT_VERSION,
      agentId: agentConfig?.agentId || "unknown",
      apiUrl: agentConfig?.apiUrl || "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      tasks: Array.from(localTasks.values()),
    };
    return json(res, state);
  }

  if (req.method === "GET" && path === "/api/tasks") {
    return json(res, Array.from(localTasks.values()));
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
    // Send initial state
    res.write(`event: snapshot\ndata: ${JSON.stringify(Array.from(localTasks.values()))}\n\n`);
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

  // ── POST commands ──

  // POST /api/tasks/run — create a task via the cloud API
  if (req.method === "POST" && path === "/api/tasks/run") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", "/api/tasks", body);
      return json(res, result, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/talk — send message to worker
  const talkMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/talk$/);
  if (req.method === "POST" && talkMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", "/api/coordination/commands", {
        taskId: talkMatch[1],
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
      const result = await cloudProxy("POST", "/api/coordination/blocker-response", {
        parentTaskId: blockerMatch[1],
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

  // POST /api/tasks/:id/cancel
  const cancelMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/cancel$/);
  if (req.method === "POST" && cancelMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      // Cancel locally
      const { stopTask } = await import("./spawner.js");
      stopTask(cancelMatch[1]);
      // Cancel on cloud
      const result = await cloudProxy("POST", `/api/tasks/${cancelMatch[1]}/cancel`, {});
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

  return notFound(res);
}

// ── Server Lifecycle ───────────────────────────────────

const PORT_FILE = join(homedir(), ".workermill", "agent.port");
let server: ReturnType<typeof createServer> | null = null;

/**
 * Start the local API server.
 * Finds an available port on localhost and writes it to ~/.workermill/agent.port.
 */
export function startLocalApi(config: AgentConfig): Promise<number> {
  agentConfig = config;
  startTime = Date.now();

  // Set up cloud proxy using the agent's existing axios instance
  import("./api.js").then(({ api }) => {
    setCloudProxy(async (method: string, path: string, body?: unknown) => {
      const resp = method === "GET"
        ? await api.get(path)
        : await api.post(path, body);
      return resp.data;
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

      resolve(port);
    });

    server.on("error", reject);
  });
}

/**
 * Stop the local API server and clean up the port file.
 */
export function stopLocalApi(): Promise<void> {
  // Clean up port file
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch { /* best effort */ }

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
