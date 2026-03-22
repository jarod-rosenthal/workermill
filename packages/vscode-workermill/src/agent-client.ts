/**
 * Agent Client — connects to the WorkerMill agent's local API.
 *
 * Discovers the agent via ~/.workermill/agent.port, connects via HTTP,
 * and maintains SSE streams for real-time updates.
 */

import { EventEmitter } from "events";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PORT_FILE = path.join(os.homedir(), ".workermill", "agent.port");
const TOKEN_FILE = path.join(os.homedir(), ".workermill", "agent.token");
const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

export interface GpuStatus {
  available: boolean;
  vendor: "nvidia" | "apple" | "amd" | "none";
  model: string | null;
  memoryMb: number | null;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version: string | null;
  models: string[];
  port: number;
}

export interface RagStatus {
  gpu: GpuStatus;
  ollama: OllamaStatus;
  localRagEnabled: boolean;
}

export interface AgentStatus {
  version: string;
  agentId: string;
  apiUrl: string;
  uptime: number;
  tasks: TaskInfo[];
  sandbox?: "docker";
  mode?: "local" | "cloud";
}

export interface TaskInfo {
  id: string;
  summary: string;
  description?: string;
  status:
    // Planning
    | "planning" | "pending_plan_approval"
    // Active
    | "queued" | "dispatching" | "claimed" | "environment_setup" | "executing"
    | "running"  // legacy alias for executing
    | "consolidating" | "integration_check" | "deploying"
    // Waiting
    | "blocked" | "pr_created" | "review_requested" | "manager_review"
    | "revision_needed" | "pr_approved" | "review_approved" | "escalated"
    // Terminal
    | "completed" | "deployed" | "failed" | "cancelled" | "review_rejected";
  persona?: string;
  model?: string;
  repo?: string;
  startedAt: string;
  cost?: number;
  errorMessage?: string;
  jiraIssueKey?: string;
  prUrl?: string;
  githubPrUrl?: string;
}

export interface LogLine {
  id: string;
  line: string;
  severity: "info" | "error";
}

export interface IssueInfo {
  key: string;
  summary: string;
  description: string | null;
  status: string | null;
  assignee: { displayName: string; accountId: string } | null;
  issueType: string | null;
  priority: string | null;
  labels: string[];
  project: { key: string; name: string } | null;
  /** Number of unmet dependencies (0 = unblocked). Only set for board cards. */
  blockedByCount?: number;
  /** Total dependency count. Only set for board cards. */
  dependencyCount?: number;
}

export interface DependencyWarning {
  severity: "error" | "warning";
  category: string;
  message: string;
  suggestion: string;
  affectedPackages: string[];
}

export interface CodeEventRecord {
  id: string;
  filePath: string | null;
  message: string;
  metadata: {
    toolName: "Write" | "Edit";
    expert: string | null;
    oldStr: string | null;
    newStr: string | null;
    isWrite?: boolean;
  } | null;
  createdAt: string;
}

export class AgentClient extends EventEmitter {
  private port: number | null = null;
  private token: string | null = null;
  private connected = false;
  private taskStream: http.ClientRequest | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private reconnectAttempts = 0;
  private ragOfferShown = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Try to discover and connect to the agent */
  async connect(): Promise<boolean> {
    this.reconnectAttempts = 0;
    this.port = this.discoverPort();
    this.token = this.discoverToken();
    if (!this.port) {
      this.connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
      return false;
    }

    try {
      const status = await this.getStatus();
      this.connected = true;
      this.reconnectAttempts = 0; // Reset on successful connection
      this.emit("connected", status);
      this.startTaskStream();
      this.checkRagAutoOffer();
      return true;
    } catch {
      this.connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
      return false;
    }
  }

  /** Check if connected to the agent */
  isConnected(): boolean {
    return this.connected;
  }

  /** Get agent status */
  async getStatus(): Promise<AgentStatus> {
    return this.get<AgentStatus>("/api/status");
  }

  /** Get GPU, Ollama, and local RAG status */
  async getRagStatus(): Promise<RagStatus> {
    return this.get<RagStatus>("/api/rag/status");
  }

  /** Get all tasks */
  async getTasks(): Promise<TaskInfo[]> {
    return this.get<TaskInfo[]>("/api/tasks");
  }

  /** Get single task */
  async getTask(id: string): Promise<TaskInfo> {
    return this.get<TaskInfo>(`/api/tasks/${id}`);
  }

  /** Send a message to a running worker */
  async talkToWorker(taskId: string, message: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/talk`, { message });
  }

  /** Respond to a blocker */
  async respondToBlocker(taskId: string, blockerId: string, action: "retry" | "skip" | "abort", guidance?: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/blocker`, { blockerId, action, guidance });
  }

  /** Approve an execution plan */
  async approvePlan(taskId: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/plan/approve`, {});
  }

  /** Reject an execution plan */
  async rejectPlan(taskId: string, feedback: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/plan/reject`, { feedback });
  }

  /** Cancel a task */
  async cancelTask(taskId: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/cancel`, {});
  }

  /** Retry a failed or cancelled task */
  async retryTask(taskId: string): Promise<void> {
    await this.post(`/api/tasks/${taskId}/retry`, {});
  }

  /** Get coordination feed for a task (proxied from cloud API) */
  async getCoordinationFeed(taskId: string): Promise<unknown> {
    return this.get(`/api/tasks/${taskId}/coordination`);
  }

  /** Get rich task detail including story progress (proxied from cloud API) */
  async getTaskDetail(taskId: string): Promise<unknown> {
    return this.get(`/api/tasks/${taskId}/detail`);
  }

  /** Search Jira issues */
  async searchIssues(query?: string, project?: string, status?: string): Promise<{ issues: IssueInfo[] }> {
    const params: string[] = [];
    if (query) params.push(`q=${encodeURIComponent(query)}`);
    if (project) params.push(`project=${encodeURIComponent(project)}`);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    const qs = params.length > 0 ? `?${params.join("&")}` : "";
    return this.get<{ issues: IssueInfo[] }>(`/api/issues${qs}`);
  }

  /** List Jira projects */
  async getProjects(): Promise<{ projects: Array<{ key: string; name: string }> }> {
    return this.get<{ projects: Array<{ key: string; name: string }> }>("/api/issues/projects");
  }

  /** Delete a board card from the backlog */
  async deleteCard(boardId: string, cardId: string): Promise<void> {
    await this.del(`/api/boards/${boardId}/cards/${cardId}`);
  }

  /** Delete a completed/pr_approved/failed task */
  async deleteTask(taskId: string): Promise<void> {
    await this.del(`/api/tasks/${taskId}`);
  }

  /** Run a Jira issue or board card as a WorkerMill task */
  async runIssue(issueKey: string, cardId?: string, boardId?: string): Promise<unknown> {
    return this.post("/api/tasks/run", { jiraIssueKey: issueKey, _cardId: cardId, _boardId: boardId });
  }

  /** Run a markdown file as a single worker task (creates a Quick Tasks card) */
  async runFileAsTask(summary: string, description: string, githubRepo?: string): Promise<unknown> {
    return this.post("/api/tasks/run-file", { summary, description, githubRepo });
  }

  /** Get available repositories from org settings */
  async getRepos(): Promise<{ repos: string[]; defaultRepo: string | null; scmProvider?: string }> {
    return this.get<{ repos: string[]; defaultRepo: string | null; scmProvider?: string }>("/api/repos");
  }

  /** Get cloud-stored logs for a task (all phases: planning + execution) */
  async getCloudLogs(taskId: string, since?: string): Promise<unknown[]> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.get<unknown[]>(`/api/tasks/${taskId}/logs${qs}`);
  }

  /** Build a board from a spec document — streams progress via SSE */
  buildFromPrdStreaming(
    payload: {
      source: string;
      content: string;
      githubRepo?: string;
      boardName?: string;
    },
    onProgress: (message: string) => void,
    callbacks?: {
      onSpecReview?: (warnings: DependencyWarning[]) => Promise<"proceed" | "fix" | "cancel">;
      onRepairComplete?: (diff: string, fixedPrd: string) => Promise<"accept" | "reject">;
    },
  ): Promise<{ boardId: string | null; boardName: string; cardCount: number; parentIssueUrl?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error("Not connected"));
      const body = JSON.stringify(payload);
      const prdHeaders: Record<string, string | number> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Accept: "text/event-stream",
      };
      if (this.token) prdHeaders["Authorization"] = `Bearer ${this.token}`;

      // Event queue for handling async callbacks without dropping SSE events
      const eventQueue: unknown[] = [];
      let processing = false;
      let settled = false;

      const processQueue = async () => {
        if (processing) return;
        processing = true;
        while (eventQueue.length > 0 && !settled) {
          const event = eventQueue.shift() as Record<string, unknown>;
          try {
            await handleEvent(event);
          } catch (err) {
            if (!settled) { settled = true; reject(err instanceof Error ? err : new Error(String(err))); }
          }
        }
        processing = false;
      };

      const handleEvent = async (event: Record<string, unknown>) => {
        if (event.type === "progress" && event.message) {
          onProgress(event.message as string);
        } else if (event.type === "repairing_spec" && event.message) {
          onProgress(event.message as string);
        } else if (event.type === "spec_review" && callbacks?.onSpecReview && event.warnings) {
          const action = await callbacks.onSpecReview(event.warnings as DependencyWarning[]);
          if (action === "cancel") {
            settled = true;
            reject(new Error("Build cancelled by user"));
            return;
          }
          await this.postJson("/api/prd/build/proceed", { action });
        } else if (event.type === "repair_complete" && callbacks?.onRepairComplete && event.diff) {
          const action = await callbacks.onRepairComplete(event.diff as string, (event.fixedPrd || "") as string);
          await this.postJson("/api/prd/build/confirm-fix", { action });
        } else if (event.type === "done" && event.result) {
          settled = true;
          resolve(event.result as { boardId: string | null; boardName: string; cardCount: number; parentIssueUrl?: string });
        } else if (event.type === "error") {
          settled = true;
          reject(new Error((event.error as string) || "Full Build failed"));
        }
      };

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.port,
          path: "/api/prd/build",
          method: "POST",
          headers: prdHeaders,
        },
        (res) => {
          let buffer = "";
          res.on("data", (chunk) => {
            buffer += chunk.toString();
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const dataLine = part
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (!dataLine) continue;
              try {
                const event = JSON.parse(dataLine.slice(6));
                eventQueue.push(event);
                processQueue();
              } catch {
                /* ignore unparseable events (heartbeats, etc.) */
              }
            }
          });
          res.on("end", () => {
            if (buffer.trim()) {
              const dataLine = buffer
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  const event = JSON.parse(dataLine.slice(6));
                  eventQueue.push(event);
                  processQueue();
                  return;
                } catch { /* ignore */ }
              }
            }
            if (!settled) {
              settled = true;
              reject(new Error("Full Build stream ended without result"));
            }
          });
          res.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
        },
      );
      req.on("error", (err) => { if (!settled) { settled = true; reject(err); } });
      req.write(body);
      req.end();
    });
  }

  /** POST JSON to the agent local API (for build proceed/confirm-fix) */
  private postJson(urlPath: string, body: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const headers: Record<string, string | number> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      };
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        method: "POST",
        headers,
      }, (res) => {
        let buf = "";
        res.on("data", (chunk) => { buf += chunk; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(buf || `HTTP ${res.statusCode}`));
          } else {
            resolve();
          }
        });
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }

  /** Get code events (Write/Edit) for a task, supports incremental polling via since */
  async getCodeEvents(taskId: string, since?: string): Promise<CodeEventRecord[]> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.get<CodeEventRecord[]>(`/api/tasks/${taskId}/code-events${qs}`);
  }

  /** Subscribe to log stream for a task */
  subscribeToLogs(taskId: string, callback: (log: LogLine) => void): () => void {
    if (!this.port) return () => {};

    const logHeaders: Record<string, string> = { Accept: "text/event-stream" };
    if (this.token) logHeaders["Authorization"] = `Bearer ${this.token}`;
    const req = http.get({
      hostname: "127.0.0.1",
      port: this.port,
      path: `/api/stream/logs/${taskId}`,
      headers: logHeaders,
    }, (res) => {
      let buffer = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (dataLine) {
            try {
              const data = JSON.parse(dataLine.slice(6));
              callback(data);
            } catch { /* ignore parse errors */ }
          }
        }
      });
    });

    req.on("error", () => { /* stream closed */ });

    return () => {
      try { req.destroy(); } catch { /* ignore */ }
    };
  }

  /** Stop reconnecting and close SSE, but keep the instance usable (re-connectable). */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.taskStream) {
      try { this.taskStream.destroy(); } catch { /* ignore */ }
      this.taskStream = null;
    }
    this.port = null;
    this.token = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.emit("disconnected");
  }

  /** Clean up all connections */
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.taskStream) {
      try { this.taskStream.destroy(); } catch { /* ignore */ }
    }
    this.removeAllListeners();
  }

  // ── Private ──

  private async checkRagAutoOffer(): Promise<void> {
    if (this.ragOfferShown || this.disposed) return;
    try {
      const ragStatus = await this.getRagStatus();
      if (ragStatus.gpu?.available && !ragStatus.localRagEnabled) {
        this.ragOfferShown = true;
        this.emit("ragAutoOffer", ragStatus.gpu);
      }
    } catch {
      // Agent doesn't support RAG endpoint yet or not reachable — ignore
    }
  }

  private discoverPort(): number | null {
    try {
      if (fs.existsSync(PORT_FILE)) {
        const port = parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);
        return isNaN(port) ? null : port;
      }
    } catch { /* ignore */ }
    return null;
  }

  private discoverToken(): string | null {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        return fs.readFileSync(TOKEN_FILE, "utf-8").trim();
      }
    } catch { /* ignore */ }
    return null;
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;

    // Don't reconnect if there's no config file (user signed out or never set up)
    if (!fs.existsSync(path.join(os.homedir(), ".workermill", "config.json"))) return;

    // Give up after MAX_RECONNECT_ATTEMPTS — user can manually reconnect
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.emit("reconnectGaveUp");
      return;
    }

    // Exponential backoff: 2s → 4s → 8s → 16s → 30s (capped)
    const delay = Math.min(
      INITIAL_RECONNECT_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startTaskStream(): void {
    if (!this.port || this.disposed) return;

    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    this.taskStream = http.get({
      hostname: "127.0.0.1",
      port: this.port,
      path: "/api/stream/tasks",
      headers,
    }, (res) => {
      let buffer = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
          const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
          if (eventLine && dataLine) {
            const event = eventLine.slice(7);
            try {
              const data = JSON.parse(dataLine.slice(6));
              this.emit(event, data);
            } catch { /* ignore */ }
          }
        }
      });

      res.on("end", () => {
        this.connected = false;
        this.emit("disconnected");
        this.scheduleReconnect();
      });
    });

    this.taskStream.on("error", () => {
      this.connected = false;
      this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  private get<T>(urlPath: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error("Not connected"));
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const req = http.get({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        headers,
      }, (res) => {
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error((parsed as { error?: string })?.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(parsed as T);
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
    });
  }

  private post(urlPath: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error("Not connected"));
      const body = JSON.stringify(data);
      const headers: Record<string, string | number> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      };
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        method: "POST",
        headers,
      }, (res) => {
        let respBody = "";
        res.on("data", (c) => respBody += c);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(respBody);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error((parsed as { error?: string })?.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch {
            resolve(respBody);
          }
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

  private del(urlPath: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error("Not connected"));
      const headers: Record<string, string> = {};
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        method: "DELETE",
        headers,
      }, (res) => {
        let respBody = "";
        res.on("data", (c) => respBody += c);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(respBody);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error((parsed as { error?: string })?.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch {
            resolve(respBody);
          }
        });
      });
      req.on("error", reject);
      req.end();
    });
  }
}
