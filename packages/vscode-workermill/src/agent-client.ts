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
const RECONNECT_INTERVAL = 5_000;

export interface AgentStatus {
  version: string;
  agentId: string;
  apiUrl: string;
  uptime: number;
  tasks: TaskInfo[];
}

export interface TaskInfo {
  id: string;
  summary: string;
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
  async searchIssues(query?: string, project?: string): Promise<{ issues: IssueInfo[] }> {
    const params: string[] = [];
    if (query) params.push(`q=${encodeURIComponent(query)}`);
    if (project) params.push(`project=${encodeURIComponent(project)}`);
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

  /** Get cloud-stored logs for a task (all phases: planning + execution) */
  async getCloudLogs(taskId: string, since?: string): Promise<unknown[]> {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.get<unknown[]>(`/api/tasks/${taskId}/logs${qs}`);
  }

  /** Build a board from a PRD document */
  async buildFromPrd(payload: {
    source: string;
    content: string;
    githubRepo?: string;
    boardName?: string;
  }): Promise<{ boardId: string; boardName: string; cardCount: number }> {
    return this.post("/api/prd/build", payload) as Promise<{
      boardId: string;
      boardName: string;
      cardCount: number;
    }>;
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_INTERVAL);
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
      req.setTimeout(10_000, () => { req.destroy(); reject(new Error("Timeout")); });
      req.write(body);
      req.end();
    });
  }
}
