/**
 * SSE Subscriber for Real-Time Coordination
 *
 * Connects to the API's SSE endpoint for instant push notifications
 * instead of HTTP polling. Falls back gracefully if connection fails.
 *
 * Uses raw https/http to avoid adding dependencies — the worker binary
 * is compiled with esbuild and every dependency adds to bundle size.
 */

import { EventEmitter } from "events";
import https from "https";
import http from "http";

export interface SseSubscriberOptions {
  /** Full URL to SSE endpoint */
  url: string;
  /** Headers to send (auth, etc.) */
  headers: Record<string, string>;
  /** Logger function */
  logger?: (msg: string) => void;
}

/**
 * Events emitted:
 * - "context" (data: object) — coordination context message received
 * - "connected" () — SSE connection established
 * - "disconnected" () — SSE connection lost (will auto-reconnect)
 */
export class SseSubscriber extends EventEmitter {
  private req: http.ClientRequest | null = null;
  private options: SseSubscriberOptions;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private stopped = false;
  private reconnectAttempts = 0;
  private log: (msg: string) => void;

  constructor(options: SseSubscriberOptions) {
    super();
    this.options = options;
    this.log = options.logger ?? console.log;
  }

  /**
   * Start the SSE connection. Auto-reconnects on failure.
   */
  connect(): void {
    this.stopped = false;
    this.doConnect();
  }

  private doConnect(): void {
    if (this.stopped) return;

    const parsedUrl = new URL(this.options.url);
    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        ...this.options.headers,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    };

    this.req = transport.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        this.log(`[SSE] Unexpected status ${res.statusCode}, will retry`);
        res.resume(); // Drain response
        this.scheduleReconnect();
        return;
      }

      this._connected = true;
      this.reconnectAttempts = 0;
      this.emit("connected");
      this.log("[SSE] Connected to coordination stream");

      let buffer = "";

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;

        // Parse SSE frames: lines separated by \n\n
        const frames = buffer.split("\n\n");
        // Last element is incomplete — keep it in the buffer
        buffer = frames.pop() || "";

        for (const frame of frames) {
          this.parseFrame(frame);
        }
      });

      res.on("end", () => {
        this._connected = false;
        this.emit("disconnected");
        this.log("[SSE] Connection ended, reconnecting...");
        this.scheduleReconnect();
      });

      res.on("error", (err) => {
        this._connected = false;
        this.emit("disconnected");
        this.log(`[SSE] Stream error: ${err.message}`);
        this.scheduleReconnect();
      });
    });

    this.req.on("error", (err) => {
      this._connected = false;
      this.emit("disconnected");
      this.log(`[SSE] Request error: ${err.message}`);
      this.scheduleReconnect();
    });

    // Timeout the initial connection attempt (30s)
    this.req.setTimeout(30000, () => {
      this.log("[SSE] Connection timeout");
      this.req?.destroy();
    });

    this.req.end();
  }

  private parseFrame(frame: string): void {
    let eventType = "";
    let data = "";

    for (const line of frame.split("\n")) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        data += line.slice(6);
      } else if (line.startsWith(":")) {
        // Comment line (heartbeat) — ignore
      }
    }

    if (eventType === "context" && data) {
      try {
        const parsed = JSON.parse(data);
        this.emit("context", parsed);
      } catch {
        this.log(`[SSE] Failed to parse context data`);
      }
    }
    // "connected" event from server — already handled by status 200
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    this.log(`[SSE] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, delay);
  }

  /**
   * Disconnect and stop auto-reconnecting.
   */
  disconnect(): void {
    this.stopped = true;
    this._connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.req) {
      this.req.destroy();
      this.req = null;
    }
    this.removeAllListeners();
  }

  get isConnected(): boolean {
    return this._connected;
  }
}
