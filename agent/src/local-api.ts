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
import {
  searchJiraIssues,
  listJiraProjects,
  searchLinearIssues,
  listLinearTeams,
  searchGitHubIssues,
  listGitHubRepos,
} from "./issue-fetchers.js";
import { createPatch } from "diff";
import { parseDependencyWarnings } from "../../api/src/services/prd-dependency-validator.js";
import type { DependencyWarning } from "../../api/src/services/prd-dependency-validator.js";

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
  jiraIssueKey?: string;
  prUrl?: string;
}

export interface AgentState {
  version: string;
  agentId: string;
  apiUrl: string;
  uptime: number;
  sandbox: "docker";
  tasks: LocalTaskInfo[];
}

type SSEClient = {
  res: ServerResponse;
  channel: string;
};

// ── Spec Validation Gate Session ──────────────────────

interface BuildSession {
  originalPrd: string;
  fixedPrd?: string;
  warnings?: DependencyWarning[];
  status: "reviewing" | "repairing" | "decomposing" | "done";
  planningConfig: { provider: string; model: string; apiKey?: string };
  prdSystemPrompt: string;
  repairPrompt: string;
  source: string;
  githubRepo?: string;
  boardName?: string;
  sendEvent: (type: string, data: unknown) => void;
  res: ServerResponse;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

let activeBuildSession: BuildSession | null = null;

function clearBuildSession(): void {
  if (activeBuildSession?.heartbeatTimer) {
    clearInterval(activeBuildSession.heartbeatTimer);
  }
  activeBuildSession = null;
}

function startReviewHeartbeat(session: BuildSession): void {
  session.heartbeatTimer = setInterval(() => {
    try { session.res.write(": heartbeat\n\n"); } catch { clearBuildSession(); }
  }, 30_000);
}

function stopReviewHeartbeat(session: BuildSession): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = undefined;
  }
}

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

agentEvents.on("task:started", (info: { id: string; parentTaskId?: string; summary: string; description?: string; persona?: string; model?: string; repo?: string; jiraIssueKey?: string }) => {
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
    jiraIssueKey: info.jiraIssueKey,
  });
});

agentEvents.on("task:planning", (info: { id: string; summary: string; description?: string; jiraIssueKey?: string }) => {
  localTasks.set(info.id, {
    id: info.id,
    summary: info.summary,
    description: info.description,
    status: "planning",
    startedAt: new Date().toISOString(),
    jiraIssueKey: info.jiraIssueKey,
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
agentEvents.on("task:log", (info) => {
  broadcastSSE(`logs:${info.id}`, "log", info);
  // Forward stage-relevant log lines to the tasks channel so the sidebar
  // can show progress stages without subscribing to per-task log streams
  if (/\[CI Gate\]|\[validation\]|\[coordinator\]|quality.gate|cloning|pulling.*image|tech.lead|self.review/i.test(info.line)) {
    broadcastSSE("tasks", "task:log", { id: info.id, line: info.line });
  }
});
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

  // 2. Cloud tasks (if cloud proxy is available)
  // Cloud is the source of truth for status — update in-memory tasks
  if (cloudProxy) {
    try {
      const merged = await getMergedTasks();
      for (const task of merged) {
        if (seenIds.has(task.id)) {
          // Update in-memory status from cloud (cloud is authoritative)
          const local = localTasks.get(task.id);
          if (local && local.status !== task.status) {
            local.status = task.status;
            if (task.prUrl) local.prUrl = task.prUrl;
          }
        } else {
          seenIds.add(task.id);
          result.push(task);
        }
      }
    } catch { /* ignore cloud failures */ }
  }

  return result;
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
        jiraIssueKey?: string;
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
          jiraIssueKey: ct.jiraIssueKey || undefined,
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
    const tasks = await getAllVisibleTasks();
    const state: AgentState & { mode?: string } = {
      version: AGENT_VERSION,
      agentId: agentConfig?.agentId || "unknown",
      apiUrl: agentConfig?.apiUrl || "unknown",
      uptime: Math.round((Date.now() - startTime) / 1000),
      sandbox: "docker",
      tasks,
      mode: "cloud",
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

  // GET /api/tasks/:id/detail — cloud control center
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

  // GET /api/tasks/:id/logs — cloud proxy
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

  // GET /api/tasks/:id/code-events — cloud proxy
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

  // POST /api/tasks/run — create a task via the cloud API
  if (req.method === "POST" && path === "/api/tasks/run") {
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
    if (!cloudProxy) return json(res, { error: "No backend available" }, 503);
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
      // Cloud: fetch from server
      try {
        const settings = await cloudProxy("GET", "/api/settings") as Record<string, unknown>;
        if (settings?.planningAgentProvider) planningConfig.provider = settings.planningAgentProvider as string;
        if (settings?.planningAgentModel) planningConfig.model = settings.planningAgentModel as string;
        if (settings?.planningApiKey) planningConfig.apiKey = settings.planningApiKey as string;
      } catch { /* fall back to defaults */ }

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

      // ── Spec validation gate ──
      let repairPrompt = "";
      try {
        const valData = await cloudProxy("GET", "/api/agent/validation-prompt") as {
          validationPrompt?: string;
          repairPrompt?: string;
        };
        if (valData?.validationPrompt) {
          repairPrompt = valData.repairPrompt || "";
          sendEvent("progress", { message: "Checking spec for dependency and quality issues..." });

          const valPrompt = `${valData.validationPrompt}\n\n---\n\nAnalyze this project specification for dependency compatibility and content quality issues.\n\nSpec statistics: ${prdContent.split(/\s+/).length} words, ${prdContent.length} characters.\n\n---\n\n${prdContent}`;

          let validationResult: string;
          if (planningConfig.provider === "anthropic" || !planningConfig.provider) {
            validationResult = await decomposePrdViaAgentSdk(valPrompt, "", (msg) => {
              sendEvent("progress", { message: msg });
            });
          } else {
            validationResult = await decomposePrdViaAiSdk(valPrompt, { ...planningConfig }, "", (msg) => {
              sendEvent("progress", { message: msg });
            });
          }

          const warnings = parseDependencyWarnings(validationResult);

          if (warnings.length > 0) {
            activeBuildSession = {
              originalPrd: prdContent,
              warnings,
              status: "reviewing",
              planningConfig,
              prdSystemPrompt: prdSystemPrompt || "",
              repairPrompt,
              source: body.source || "text",
              githubRepo: body.githubRepo,
              boardName: body.boardName,
              sendEvent,
              res,
            };
            startReviewHeartbeat(activeBuildSession);
            req.on("close", () => clearBuildSession());

            sendEvent("spec_review", { warnings });
            return; // PAUSE — user calls /proceed or /confirm-fix
          }

          sendEvent("progress", { message: "No dependency issues found" });
        }
      } catch {
        sendEvent("progress", { message: "Spec validation skipped" });
      }

      sendEvent("progress", { message: `Starting PRD decomposition...` });

      // Decompose PRD locally — routes to Claude Agent SDK (Anthropic) or Vercel AI SDK (others)
      const decomposed = await decomposePrdLocal(prdContent, planningConfig, prdSystemPrompt, (msg) => {
        sendEvent("progress", { message: msg });
      });

      sendEvent("progress", { message: `Creating board with ${decomposed.cards.length} cards...` });

      // Cloud: send pre-decomposed cards to cloud API to create the board
      const result = await cloudProxy!("POST", "/api/prd/decompose", {
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

  // POST /api/prd/build/proceed — user action after spec_review
  if (req.method === "POST" && path === "/api/prd/build/proceed") {
    try {
      const body = JSON.parse(await readBody(req));
      const session = activeBuildSession;
      if (!session || session.status === "decomposing") {
        return json(res, { error: "No active build session" }, 404);
      }

      if (body.action === "proceed") {
        stopReviewHeartbeat(session);
        session.status = "decomposing";
        json(res, { accepted: true }, 202);

        (async () => {
          try {
            session.sendEvent("progress", { message: "Starting PRD decomposition..." });
            const decomposed = await decomposePrdLocal(
              session.originalPrd, session.planningConfig,
              session.prdSystemPrompt, (msg) => session.sendEvent("progress", { message: msg }),
            );
            session.sendEvent("progress", { message: `Creating board with ${decomposed.cards.length} cards...` });
            const result = await cloudProxy!("POST", "/api/prd/decompose", {
              source: session.source, content: session.originalPrd,
              githubRepo: session.githubRepo, boardName: session.boardName,
              preDecomposed: decomposed,
            });
            session.sendEvent("done", { result });
          } catch (err) {
            session.sendEvent("error", { error: err instanceof Error ? err.message : String(err) });
          } finally {
            try { session.res.end(); } catch { /* already closed */ }
            clearBuildSession();
          }
        })();
        return;
      }

      if (body.action === "fix") {
        stopReviewHeartbeat(session);
        session.status = "repairing";
        json(res, { accepted: true }, 202);

        (async () => {
          try {
            session.sendEvent("repairing_spec", { message: "Repairing spec..." });

            const warningsList = (session.warnings || [])
              .map((w, i) => `${i + 1}. [${w.severity}] ${w.category}: ${w.message}\n   Suggestion: ${w.suggestion}`)
              .join("\n");
            const repairFullPrompt = `${session.repairPrompt}\n\n---\n\nFix the following issues in this project specification:\n\n## Issues to Fix\n\n${warningsList}\n\n## Original Specification\n\n${session.originalPrd}`;

            let fixedPrd: string;
            if (session.planningConfig.provider === "anthropic" || !session.planningConfig.provider) {
              fixedPrd = await decomposePrdViaAgentSdk(repairFullPrompt, "", (msg) => {
                session.sendEvent("repairing_spec", { message: msg });
              });
            } else {
              fixedPrd = await decomposePrdViaAiSdk(repairFullPrompt, { ...session.planningConfig }, "", (msg) => {
                session.sendEvent("repairing_spec", { message: msg });
              });
            }

            const diff = createPatch("spec.md", session.originalPrd, fixedPrd, "original", "fixed");
            session.fixedPrd = fixedPrd;
            session.status = "reviewing";
            startReviewHeartbeat(session);
            session.sendEvent("repair_complete", { fixedPrd, diff });
          } catch (err) {
            session.status = "reviewing";
            startReviewHeartbeat(session);
            session.sendEvent("error", { error: `Repair failed: ${err instanceof Error ? err.message : String(err)}` });
          }
        })();
        return;
      }

      return json(res, { error: "Invalid action" }, 400);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/prd/build/confirm-fix — accept or reject repaired spec
  if (req.method === "POST" && path === "/api/prd/build/confirm-fix") {
    try {
      const body = JSON.parse(await readBody(req));
      const session = activeBuildSession;
      if (!session || session.status === "decomposing") {
        return json(res, { error: "No active build session" }, 404);
      }

      if (body.action === "reject") {
        session.fixedPrd = undefined;
        session.status = "reviewing";
        session.sendEvent("spec_review", { warnings: session.warnings });
        return json(res, { accepted: true }, 202);
      }

      if (body.action === "accept") {
        if (!session.fixedPrd) {
          return json(res, { error: "No fixed spec available" }, 400);
        }

        stopReviewHeartbeat(session);
        session.status = "decomposing";
        json(res, { accepted: true }, 202);

        (async () => {
          try {
            session.sendEvent("progress", { message: "Starting PRD decomposition with repaired spec..." });
            const decomposed = await decomposePrdLocal(
              session.fixedPrd!, session.planningConfig,
              session.prdSystemPrompt, (msg) => session.sendEvent("progress", { message: msg }),
            );
            session.sendEvent("progress", { message: `Creating board with ${decomposed.cards.length} cards...` });
            const result = await cloudProxy!("POST", "/api/prd/decompose", {
              source: session.source, content: session.fixedPrd,
              githubRepo: session.githubRepo, boardName: session.boardName,
              preDecomposed: decomposed,
            });
            session.sendEvent("done", { result });
          } catch (err) {
            session.sendEvent("error", { error: err instanceof Error ? err.message : String(err) });
          } finally {
            try { session.res.end(); } catch { /* already closed */ }
            clearBuildSession();
          }
        })();
        return;
      }

      return json(res, { error: "Invalid action" }, 400);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Agent Planning Endpoints ──

  // GET /api/agent/planning-prompt — assemble planning prompt for a task
  if (req.method === "GET" && path === "/api/agent/planning-prompt") {
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

  // POST /api/agent/planning-progress — log planning progress (no-op, planner prints to console)
  if (req.method === "POST" && path === "/api/agent/planning-progress") {
    return json(res, { success: true });
  }

  // POST /api/control-center/logs/batch — batch log posting from planner
  if (req.method === "POST" && path === "/api/control-center/logs/batch") {
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/talk — send message to worker
  const talkMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/talk$/);
  if (req.method === "POST" && talkMatch) {
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

  // POST /api/tasks/:id/plan/approve — cloud proxy
  const approveMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/approve$/);
  if (req.method === "POST" && approveMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", `/api/tasks/${approveMatch[1]}/plan/approve`, {});
      const approvedTask = localTasks.get(approveMatch[1]);
      if (approvedTask) approvedTask.status = "running";
      broadcastSSE("tasks", "state:changed", {});
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/tasks/:id/plan/reject — cloud proxy
  const rejectMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/plan\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const body = JSON.parse(await readBody(req));
      const result = await cloudProxy("POST", `/api/tasks/${rejectMatch[1]}/plan/request-changes`, {
        feedback: body.feedback,
      });
      const rejectedTask = localTasks.get(rejectMatch[1]);
      if (rejectedTask) rejectedTask.status = "cancelled";
      broadcastSSE("tasks", "state:changed", {});
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

    // Best-effort cloud status update — don't fail if cloud is stale
    if (cloudProxy) {
      try {
        await cloudProxy("POST", `/api/tasks/${taskId}/cancel`, {});
      } catch { /* cloud may already consider it complete — that's OK */ }
    }

    return json(res, { success: true, message: "Task cancelled" });
  }

  // DELETE /api/tasks/:id — remove task via cloud proxy
  const deleteTaskMatch = path.match(/^\/api\/tasks\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "DELETE" && deleteTaskMatch) {
    const taskId = deleteTaskMatch[1];
    if (cloudProxy) {
      try {
        const result = await cloudProxy("DELETE", `/api/tasks/${taskId}`);
        // Also remove from in-memory task list so the sidebar updates
        localTasks.delete(taskId);
        broadcastSSE("tasks", "state:changed", {});
        return json(res, result);
      } catch (err: any) {
        return json(res, err.data || { error: String(err) }, err.status || 500);
      }
    }
    return json(res, { error: "Delete not supported — no backend available" }, 400);
  }

  // POST /api/tasks/clear — bulk delete completed/failed/cancelled tasks
  if (req.method === "POST" && path === "/api/tasks/clear") {
    return json(res, { error: "Clear not supported in cloud mode" }, 400);
  }

  // POST /api/tasks/:id/retry — cloud proxy
  const retryMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/retry$/);
  if (req.method === "POST" && retryMatch) {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const taskId = retryMatch[1];
      const result = await cloudProxy("POST", `/api/tasks/${taskId}/retry`, {});
      const task = localTasks.get(taskId);
      if (task) {
        task.status = "running";
        // Emit task:started so the extension reopens/restarts the log terminal
        broadcastSSE("tasks", "task:started", {
          id: taskId,
          summary: task.summary,
          description: task.description,
          repo: task.repo,
        });
      }
      broadcastSSE("tasks", "state:changed", {});
      triggerPoll();
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/issues — search issues via cloud proxy
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

  // GET /api/issues/projects — list projects via cloud proxy
  if (req.method === "GET" && path === "/api/issues/projects") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/issues/projects");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Persona CRUD endpoints ──

  // GET /api/personas — list all personas via cloud proxy
  if (req.method === "GET" && path === "/api/personas") {
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/personas");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // POST /api/personas — create a new persona via cloud proxy
  if (req.method === "POST" && path === "/api/personas") {
    const body = JSON.parse(await readBody(req));
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
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("GET", "/api/personas/worker/experts");
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // PUT /api/personas/:id — update persona metadata via cloud proxy
  if (req.method === "PUT" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/")) {
    const body = JSON.parse(await readBody(req));
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("PUT", path, body);
      return json(res, result);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // DELETE /api/personas/:id — delete a persona via cloud proxy
  if (req.method === "DELETE" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/") && !path.includes("/directives")) {
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
    if (!cloudProxy) return json(res, { error: "Cloud API not connected" }, 503);
    try {
      const result = await cloudProxy("POST", "/api/personas/common/directives", body);
      return json(res, result, 201);
    } catch (err) {
      return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // GET /api/personas/:id — get single persona with directives
  if (req.method === "GET" && /^\/api\/personas\/[^/]+$/.test(path) && !path.includes("/worker/") && !path.includes("/common")) {
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

  // POST /api/control-center/logs/:id/classify-errors — mark errors as fatal/recoverable
  const classifyMatch = path.match(
    /^\/api\/control-center\/logs\/([a-f0-9-]+)\/classify-errors$/,
  );
  if (req.method === "POST" && classifyMatch) {
    return json(res, { success: true });
  }

  // POST /api/control-center/logs — worker log posting (alias)
  if (req.method === "POST" && path === "/api/control-center/logs") {
    return json(res, { success: true });
  }

  // GET /api/tasks/:id/expert-registry — return empty registry
  const expertRegMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/expert-registry$/);
  if (req.method === "GET" && expertRegMatch) {
    return json(res, { experts: [] });
  }

  // POST /api/tasks/:id/status — worker updates task status
  const taskStatusMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/status$/);
  if (req.method === "POST" && taskStatusMatch) {
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/usage/partial — incremental token usage from workers
  const usagePartialMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/partial$/,
  );
  if (req.method === "POST" && usagePartialMatch) {
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/usage — final token usage report
  const usageFinalMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage$/,
  );
  if (req.method === "POST" && usageFinalMatch) {
    return json(res, { success: true });
  }

  // POST /api/tasks/:id/usage/phase — phase-level token usage (store as partial)
  const usagePhaseMatch = path.match(
    /^\/api\/tasks\/([a-f0-9]+)\/usage\/phase$/,
  );
  if (req.method === "POST" && usagePhaseMatch) {
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
    return json(res, { success: true });
  }

  // GET /api/directives/effectiveness — directive effectiveness metrics
  if (req.method === "GET" && path === "/api/directives/effectiveness") {
    return json(res, { metrics: [] });
  }

  // POST /api/tasks/:id/ticket-comment — store as log entry
  const ticketCommentMatch = path.match(
    /^\/api\/tasks\/([a-f0-9-]+)\/ticket-comment$/,
  );
  if (req.method === "POST" && ticketCommentMatch) {
    return json(res, { success: true });
  }

  // ── Memory API (stubs — SQLite backend removed) ──

  if (req.method === "POST" && path === "/api/memory/search") {
    return json(res, { query: "", results: { semantic: [], episodic: [], procedural: [] }, totalResults: 0 });
  }

  if (req.method === "POST" && path === "/api/memory/similar-tasks") {
    return json(res, { query: "", totalResults: 0, results: [] });
  }

  if (req.method === "GET" && path === "/api/memory/semantic") {
    return json(res, { memories: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  if (req.method === "POST" && path === "/api/memory/semantic") {
    return json(res, { success: true, id: "none" });
  }

  if (req.method === "GET" && path === "/api/memory/episodic") {
    return json(res, { memories: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  if (req.method === "POST" && path === "/api/memory/episodic") {
    return json(res, { success: true, id: "none" });
  }

  if (req.method === "GET" && path === "/api/memory/procedural") {
    return json(res, { skills: [], pagination: { total: 0, limit: 50, offset: 0 } });
  }

  if (req.method === "POST" && path === "/api/memory/procedural") {
    return json(res, { success: true, id: "none" });
  }

  if (req.method === "DELETE" && /^\/api\/memory\/(semantic|episodic|procedural)\/[^/]+$/.test(path)) {
    return json(res, { deleted: true });
  }

  // Catch-all for other memory sub-routes (feedback, routing, knowledge)
  if (path.startsWith("/api/memory/")) {
    if (req.method === "GET") return json(res, { skills: [], memories: [], results: [], scores: [], history: [] });
    if (req.method === "POST") return json(res, { success: true });
  }

  // POST /api/codebase/search — search code via cloud proxy
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
    // No local vector DB — acknowledge but don't store
    return json(res, { ingested: 0, message: "Codebase indexing requires cloud backend" });
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

  // ── Worker ingestion endpoints (stubs — SQLite backend removed) ──

  const workerLogMatch = path.match(/^\/api\/tasks\/([a-f0-9-]+)\/logs$/);
  if (req.method === "POST" && workerLogMatch) {
    return notFound(res);
  }

  if (req.method === "POST" && path === "/api/coordination/messages") {
    return notFound(res);
  }

  if (req.method === "POST" && path === "/api/control-center/code-events") {
    return notFound(res);
  }

  // ── Board endpoints ──

  // GET /api/boards — proxy to cloud
  if (req.method === "GET" && path === "/api/boards") {
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

  // POST /api/boards — no longer supported without SQLite backend
  if (req.method === "POST" && path === "/api/boards") {
    return json(res, { error: "No backend available" }, 503);
  }

  // Board card endpoints — no longer supported without SQLite backend
  const boardCardsMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards$/);
  if (boardCardsMatch) {
    return json(res, { error: "No backend available" }, 503);
  }

  const deleteCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)$/);
  if (req.method === "DELETE" && deleteCardMatch) {
    return json(res, { error: "No backend available" }, 503);
  }

  const runCardMatch = path.match(/^\/api\/boards\/([a-f0-9]+)\/cards\/([a-f0-9]+)\/run$/);
  if (req.method === "POST" && runCardMatch) {
    return json(res, { error: "No backend available" }, 503);
  }

  // ── Analytics endpoints (proxy to cloud) ──

  // GET /api/analytics/tasks — task stats and daily breakdown
  if (req.method === "GET" && path === "/api/analytics/tasks") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path + "?" + (new URL(req.url || "", "http://localhost").search || ""))); } catch { /* fall through */ }
    }
    return json(res, { stats: { total: 0, completed: 0, failed: 0, inProgress: 0 }, daily: [], summary: { totalTasks: 0, totalCost: 0, successRate: "0.0" } });
  }

  // GET /api/analytics/workers — per-persona worker stats
  if (req.method === "GET" && path === "/api/analytics/workers") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { workers: [] });
  }

  // GET /api/analytics/costs — cost breakdown by model
  if (req.method === "GET" && path === "/api/analytics/costs") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { totalCost: 0, totalTasks: 0, totalTokens: 0, byModel: [], daily: [] });
  }

  // GET /api/analytics/failures — failure analysis
  if (req.method === "GET" && path === "/api/analytics/failures") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { period: "30d", summary: { totalFailures: 0, totalTasks: 0, failureRate: 0 }, byPersona: [], byModel: [] });
  }

  // GET /api/analytics/token-usage — token breakdown
  if (req.method === "GET" && path === "/api/analytics/token-usage") {
    if (cloudProxy) {
      try { return json(res, await cloudProxy("GET", path)); } catch { /* fall through */ }
    }
    return json(res, { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0 });
  }

  // GET /api/analytics/effectiveness — success and completion metrics
  if (req.method === "GET" && path === "/api/analytics/effectiveness") {
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

## Sizing Rules (CRITICAL)

- Target **3-4 total cards** for the entire project. Fewer cards = fewer handoffs = fewer integration bugs between workers.
- Target 15-30 deliverables per card. AI workers perform BETTER with larger, cohesive cards that cover a complete functional layer.
- Cards with >35 deliverables should be split. Cards with <8 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Foundation" — combines project scaffolding, CI/CD pipeline, AND all backend/server code (models, handlers, middleware, services, seed data, tests). CI deliverables are part of this card, NOT a separate card. Assigned to backend_developer. If the project uses external services (databases, caches, queues), Card 1 MUST include a docker-compose.yml that starts all required services. Workers spin up real Docker containers — they do NOT use mocks or stubs.
- For full-stack projects: Card 1 = Foundation (backend + CI), Card 2 = Frontend (all UI), Last card = Deployment + Validation.
- For backend-only projects: Card 1 = Foundation (backend + CI), Card 2 = Deployment + Validation.
- The LAST card ALWAYS includes production deployment + validation — deployment pipeline, smoke tests, seed verification, go-live checklist.

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

### Service Dependencies (if applicable)
- List all external services the code needs (databases, caches, message queues)
- Workers have Docker available and MUST spin up real service containers — no mocking
- Example: "Requires MongoDB 7 on port 27017 and Redis 7 on port 6379"
- Card 1 (Foundation) MUST include a deliverable for a docker-compose.yml or startup script that launches all required services

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
- Card 0 (Foundation) has no dependencies (empty array)
- All subsequent cards depend on Card 0 (directly or transitively)
- The last card (Deployment) typically depends on all preceding cards

## CI/CD Is a First-Class Citizen (Part of Card 1)

CI/CD is NOT a separate card. It is part of Card 1 (Foundation). The CI pipeline proves code compiles, passes lint, passes tests, and builds.

Card 1 CI deliverables MUST include:
1. CI workflow file (e.g., .github/workflows/ci.yml) with ALL quality steps (lint, typecheck, test, build)
2. A trivial passing test file so the test step succeeds on first run
3. CI workflow triggers MUST include BOTH \`push: [main]\` AND \`pull_request: [main]\` events. Without \`pull_request\` triggers, CI won't run on PRs and code merges without verification.

IMPORTANT: Do NOT create a separate "CI verification" story that pushes to main to test the pipeline. CI verification happens automatically when the PR is created — the \`pull_request\` trigger handles it. Workers must NEVER push directly to main. All code goes through story branches → consolidated PR → merge. A story that pushes to main bypasses the PR workflow and causes the task to complete without a PR.

CI workflow steps MUST run the EXACT SAME commands as the quality gates — no additions, no differences. This is critical: if the quality gate runs "go vet ./..." and "go test ./... -v -count=1 -race", the CI workflow MUST run those same commands, NOT golangci-lint or any other tool. The quality gates are the single source of truth for what "passing" means. Any divergence between the quality gates and CI creates a gap where code passes one but fails the other.

For Go CI: use "go vet ./...", "go test ./... -v -count=1 -race", "go build ./..." (NOT golangci-lint, staticcheck, or other third-party linters). For Node.js CI: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python CI: use "python -m pytest", "python -m mypy .". Do NOT add third-party tools to CI that aren't already in the repo.

ALL subsequent cards MUST depend on Card 1 (directly or transitively).

## Priority Assignment

- urgent: Card 1 — Foundation (setup + CI + backend)
- high: Feature cards (frontend, integration)
- medium: Deployment + validation (last card)
- low: Nice-to-have, polish, documentation

## Output Format

Respond with ONLY a JSON object (no markdown fences, no explanation):

{
  "boardName": "Short descriptive board name derived from the PRD title",
  "qualityGates": [
    {
      "name": "backend",
      "trigger": "api/**",
      "commands": ["cd api && go vet ./...", "cd api && go test ./... -v -count=1 -race", "cd api && go build ./..."]
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

qualityGates: Extract pre-commit quality gate commands from the PRD. Each gate has a name (e.g., "backend", "frontend"), a file trigger glob (e.g., "api/**"), and the exact shell commands to run. These commands run in a minimal container — ONLY use tools from the standard toolchain. For Go: use ONLY "go vet ./...", "go test ./... -v -count=1 -race", "go build ./...", "gofmt -w ." (NOT "gofmt ./..." — gofmt doesn't support "..."). Do NOT use golangci-lint, staticcheck, or other third-party tools — they are not installed. For Node.js: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python: use "python -m pytest", "python -m mypy .". IMPORTANT: The CI workflow MUST use the exact same commands as the quality gates — no divergence allowed.
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
export async function startLocalApi(config: AgentConfig): Promise<number> {
  agentConfig = config;
  startTime = Date.now();

  // Set up cloud proxy using the agent's existing axios instance.
  // Extract response data from axios errors so callers get the real API error message.
  import("./api.js").then(({ api }) => {
    setCloudProxy(async (method: string, path: string, body?: unknown) => {
      try {
        const resp = method === "GET"
          ? await api.get(path)
          : method === "DELETE"
          ? await api.delete(path)
          : method === "PUT"
          ? await api.put(path, body)
          : method === "PATCH"
          ? await api.patch(path, body)
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
