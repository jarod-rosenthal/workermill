import type { WorkerMillConfig } from "./config.js";

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  body?: unknown;
}

export class ApiClient {
  private baseUrl: string;
  private authToken: string;
  private logBuffer: string[] = [];
  private logFlushTimer: ReturnType<typeof setInterval> | null = null;
  private currentTaskId: string | null = null;
  private readonly LOG_FLUSH_INTERVAL_MS = 500;
  private readonly MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB
  private bufferBytes = 0;

  constructor(config: WorkerMillConfig) {
    this.baseUrl = config.apiBaseUrl;
    this.authToken = config.authToken ?? "";
  }

  // --- Worker API methods ---

  async getPlan(taskId: string): Promise<{ systemPrompt: string; userPrompt: string; model: string }> {
    return this.request({ method: "GET", path: `/api/worker/plan?taskId=${taskId}` });
  }

  async postPlanResult(taskId: string, rawOutput: string): Promise<unknown> {
    return this.request({ method: "POST", path: "/api/worker/plan-result", body: { taskId, rawOutput } });
  }

  async claimStory(taskId: string): Promise<{ storyId: string; storyIndex: number; persona: string; prompt: string; branch: string } | null> {
    return this.request({ method: "GET", path: `/api/worker/claim?taskId=${taskId}` });
  }

  async getStory(storyId: string): Promise<unknown> {
    return this.request({ method: "GET", path: `/api/worker/stories/${storyId}` });
  }

  async postStatus(taskId: string, storyId: string, status: string, details?: Record<string, unknown>): Promise<void> {
    await this.request({ method: "POST", path: "/api/worker/status", body: { taskId, storyId, status, ...details } });
  }

  async getCommands(taskId: string): Promise<Array<{ id: string; type: string; message: string }>> {
    return this.request({ method: "GET", path: `/api/worker/commands/${taskId}` });
  }

  async postBlocker(taskId: string, storyId: string, blocker: { summary: string; errorMessage: string; errorCategory: string }): Promise<void> {
    await this.request({ method: "POST", path: "/api/worker/blocker", body: { taskId, storyId, ...blocker } });
  }

  async getSkills(persona: string): Promise<Array<{ name: string; content: string }>> {
    return this.request({ method: "GET", path: `/api/worker/skills/${persona}` });
  }

  // --- Log streaming ---

  startLogStreaming(taskId: string): void {
    this.currentTaskId = taskId;
    this.logBuffer = [];
    this.bufferBytes = 0;
    this.logFlushTimer = setInterval(() => {
      void this.flushLogs();
    }, this.LOG_FLUSH_INTERVAL_MS);
  }

  bufferLogLine(line: string): void {
    if (this.bufferBytes >= this.MAX_BUFFER_BYTES) return; // Drop if buffer full
    this.logBuffer.push(line);
    this.bufferBytes += Buffer.byteLength(line, "utf-8");
  }

  async stopLogStreaming(): Promise<void> {
    if (this.logFlushTimer) {
      clearInterval(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    await this.flushLogs();
    this.currentTaskId = null;
  }

  private async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0 || !this.currentTaskId) return;
    const lines = this.logBuffer.splice(0);
    this.bufferBytes = 0;
    try {
      await this.request({
        method: "POST",
        path: `/api/tasks/${this.currentTaskId}/logs`,
        body: { logs: lines.join("\n") },
      });
    } catch {
      // Re-queue on failure (retry next flush)
      this.logBuffer.unshift(...lines);
      for (const l of lines) {
        this.bufferBytes += Buffer.byteLength(l, "utf-8");
      }
    }
  }

  // --- HTTP transport ---

  private async request<T>(opts: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${opts.path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.authToken}`,
    };
    const init: RequestInit = {
      method: opts.method,
      headers,
    };
    if (opts.body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${opts.method} ${opts.path} failed: ${res.status} ${text}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    return undefined as T;
  }
}
