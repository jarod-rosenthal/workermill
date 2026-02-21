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
const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

export interface AgentStatus {
  version: string;
  agentId: string;
  apiUrl: string;
  uptime: number;
  tasks: TaskInfo[];
  sandbox?: "none" | "docker";
}

export interface TaskInfo {
  id: string;
  summary: string;
  description?: string;
  status: "planning" | "running" | "completed" | "failed";
  persona?: string;
  model?: string;
  repo?: string;
  startedAt: string;
  cost?: number;
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
  private connected = false;
  private taskStream: http.ClientRequest | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  private reconnectAttempts = 0;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Try to discover and connect to the agent */
  async connect(): Promise<boolean> {
    this.port = this.discoverPort();
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

  /** Run a Jira issue as a WorkerMill task */
  async runIssue(issueKey: string): Promise<unknown> {
    return this.post("/api/tasks/run", { jiraIssueKey: issueKey });
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
  ): Promise<{ boardId: string; boardName: string; cardCount: number }> {
    return new Promise((resolve, reject) => {
      if (!this.port) return reject(new Error("Not connected"));
      const body = JSON.stringify(payload);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.port,
          path: "/api/prd/build",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Accept: "text/event-stream",
          },
        },
        (res) => {
          let buffer = "";
          res.on("data", (chunk) => {
            buffer += chunk.toString();
            // Parse SSE events from buffer
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";
            for (const part of parts) {
              const dataLine = part
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (!dataLine) continue;
              try {
                const event = JSON.parse(dataLine.slice(6));
                if (event.type === "progress" && event.message) {
                  onProgress(event.message);
                } else if (event.type === "done" && event.result) {
                  resolve(event.result);
                } else if (event.type === "error") {
                  reject(new Error(event.error || "Full Build failed"));
                }
              } catch {
                /* ignore unparseable events */
              }
            }
          });
          res.on("end", () => {
            // Process remaining buffer
            if (buffer.trim()) {
              const dataLine = buffer
                .split("\n")
                .find((l) => l.startsWith("data: "));
              if (dataLine) {
                try {
                  const event = JSON.parse(dataLine.slice(6));
                  if (event.type === "done" && event.result) {
                    resolve(event.result);
                    return;
                  } else if (event.type === "error") {
                    reject(new Error(event.error || "Full Build failed"));
                    return;
                  }
                } catch {
                  /* ignore */
                }
              }
            }
            // If we haven't resolved/rejected yet, stream ended unexpectedly
            reject(new Error("Full Build stream ended without result"));
          });
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      // 5 minute timeout for full decomposition
      req.setTimeout(300_000, () => {
        req.destroy();
        reject(new Error("Full Build timed out (5 minutes)"));
      });
      req.write(body);
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

    const req = http.get({
      hostname: "127.0.0.1",
      port: this.port,
      path: `/api/stream/logs/${taskId}`,
      headers: { Accept: "text/event-stream" },
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

  private discoverPort(): number | null {
    try {
      if (fs.existsSync(PORT_FILE)) {
        const port = parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);
        return isNaN(port) ? null : port;
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

    this.taskStream = http.get({
      hostname: "127.0.0.1",
      port: this.port,
      path: "/api/stream/tasks",
      headers: { Accept: "text/event-stream" },
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
      const req = http.get({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        headers: { Accept: "application/json" },
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
      const req = http.request({
        hostname: "127.0.0.1",
        port: this.port,
        path: urlPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
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
      // Full Build via Agent SDK can take 2+ minutes — use 5min timeout for POST
      req.setTimeout(300_000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }
}
