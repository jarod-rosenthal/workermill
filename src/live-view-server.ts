import { createServer } from "http";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { LIVE_VIEW_HTML } from "./ui/live-view-html.js";
import { PRISM_JS, PRISM_THEME_CSS } from "./ui/prism-bundle.js";

export type LiveViewEvent =
  | { type: "file-changed"; persona: string; storyIndex: number; storyTitle: string; filePath: string; tool: "created" | "edited"; diff: string; timestamp: number }
  | { type: "story-start"; storyIndex: number; storyTitle: string; persona: string; total: number; timestamp: number }
  | { type: "story-complete"; storyIndex: number; elapsed: number; timestamp: number }
  | { type: "run-complete"; branch: string; commitCount: number; timestamp: number };

export interface LiveViewServer {
  port: number;
  stop(): void;
  setAbortController(controller: AbortController): void;
  emitFileChange(persona: string, storyIndex: number, storyTitle: string, filePath: string, tool: "created" | "edited"): void;
  emitStoryStart(storyIndex: number, storyTitle: string, persona: string, total: number): void;
  emitStoryComplete(storyIndex: number, elapsed: number): void;
  emitRunComplete(branch: string, commitCount: number): void;
}

let sharedServer: LiveViewServer | null = null;
let sharedServerDir: string | null = null;

export function createLiveViewServer(workingDir: string, _mainBranch: string): LiveViewServer {
  if (sharedServer && sharedServerDir === workingDir) {
    return sharedServer;
  }

  const server = createServer();
  const clients = new Set<{ res: any; replay: LiveViewEvent[] }>();
  const allEvents: LiveViewEvent[] = [];

  let abortController: AbortController | null = null;
  let stopped = false;

  server.on("request", (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      // Serve the live view HTML
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });
      res.end(LIVE_VIEW_HTML);
    } else if (req.method === "GET" && req.url === "/prism.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(PRISM_JS);
    } else if (req.method === "GET" && req.url === "/prism-theme.css") {
      res.writeHead(200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      });
      res.end(PRISM_THEME_CSS);
    } else if (req.method === "GET" && req.url === "/events") {
      // SSE endpoint — disable Nagle's algorithm so every write is sent
      // immediately.  Without this, small SSE frames (~300 bytes) sit in
      // the OS TCP send buffer waiting for an ACK, which over WSL2's
      // virtual network causes the browser to stay on "Connecting..." forever.
      req.socket.setNoDelay(true);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      });
      // Flush an initial SSE heartbeat so clients transition from
      // "Connecting..." even before the first live event arrives.
      if (typeof (res as { flushHeaders?: () => void }).flushHeaders === "function") {
        (res as { flushHeaders: () => void }).flushHeaders();
      }
      // Send initial padding/comment + first data frame.
      // Some browser/proxy paths buffer tiny chunks; this forces the
      // stream to flush and lets EventSource transition off "Connecting...".
      res.write(`:${" ".repeat(2048)}\n\n`);
      // Send a lightweight first data frame so clients that wait for
      // initial payload bytes can transition from "Connecting..." quickly.
      res.write(`data: ${JSON.stringify({ type: "ready", timestamp: Date.now() })}\n\n`);

      const client = { res, replay: allEvents.slice() };
      clients.add(client);

      // Send replay of current state
      for (const event of client.replay) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      // Keep the connection warm for intermediaries that time out idle SSE.
      const heartbeat = setInterval(() => {
        if (res.writableEnded) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 15000);

      req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(client);
      });
    } else if (req.method === "GET" && req.url === "/events-snapshot") {
      // Polling fallback — returns all events as JSON for clients where SSE
      // doesn't connect (WSL2 long-lived connection issues).
      const body = JSON.stringify(allEvents);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(body);
    } else if (req.method === "POST" && req.url === "/abort") {
      // Abort endpoint
      if (abortController) {
        abortController.abort();
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Disable Nagle's algorithm on every connection so SSE frames are
  // sent immediately — without this, small writes stall on WSL2.
  server.on("connection", (socket) => {
    socket.setNoDelay(true);
  });

  server.listen(0);

  const port = (server.address() as any).port;

  function broadcast(event: LiveViewEvent): void {
    allEvents.push(event);
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.res.write(data);
      client.replay.push(event);
    }
  }

  function runGitDiff(args: string[]): string {
    try {
      return execFileSync("git", args, {
        cwd: workingDir,
        encoding: "utf-8",
        stdio: "pipe",
      }).trimEnd();
    } catch (err) {
      const stdout = (err as { stdout?: unknown })?.stdout;
      if (typeof stdout === "string" && stdout.trim()) return stdout.trimEnd();
      if (Buffer.isBuffer(stdout) && stdout.length > 0) return stdout.toString("utf-8").trimEnd();
      return "";
    }
  }

  function normalizeFilePath(filePath: string): string {
    const trimmed = filePath.trim();
    if (!trimmed) return "";
    const unixPath = trimmed.replaceAll("\\", "/");
    if (!path.isAbsolute(unixPath)) return unixPath;
    const relative = path.relative(workingDir, unixPath).replaceAll("\\", "/");
    if (!relative || relative.startsWith("../") || relative === "..") return unixPath;
    return relative;
  }

  function getLiveDiff(filePath: string, tool: "created" | "edited"): string {
    const normalizedPath = normalizeFilePath(filePath);
    if (!normalizedPath) return "";

    let diff = runGitDiff(["diff", "--no-ext-diff", "--unified=3", "HEAD", "--", normalizedPath]);
    if (diff) return diff;

    diff = runGitDiff(["diff", "--no-ext-diff", "--unified=3", "--", normalizedPath]);
    if (diff) return diff;

    // Untracked file creation: synthesize a standard unified diff against /dev/null
    const absolutePath = path.resolve(workingDir, normalizedPath);
    if (tool === "created" && fs.existsSync(absolutePath)) {
      diff = runGitDiff(["diff", "--no-index", "--unified=3", "/dev/null", absolutePath]);
      if (diff) {
        return diff.replaceAll(absolutePath, normalizedPath);
      }
    }

    return "";
  }

  const liveViewServer: LiveViewServer = {
    port,
    stop() {
      if (stopped) return;
      stopped = true;
      server.close();
      if (sharedServer === liveViewServer) {
        sharedServer = null;
        sharedServerDir = null;
      }
    },
    setAbortController(controller: AbortController) {
      abortController = controller;
    },
    emitFileChange(persona: string, storyIndex: number, storyTitle: string, filePath: string, tool: "created" | "edited") {
      const event: LiveViewEvent = {
        type: "file-changed",
        persona,
        storyIndex,
        storyTitle,
        filePath,
        tool,
        diff: getLiveDiff(filePath, tool),
        timestamp: Date.now(),
      };
      broadcast(event);
    },
    emitStoryStart(storyIndex: number, storyTitle: string, persona: string, total: number) {
      const event: LiveViewEvent = {
        type: "story-start",
        storyIndex,
        storyTitle,
        persona,
        total,
        timestamp: Date.now(),
      };
      broadcast(event);
    },
    emitStoryComplete(storyIndex: number, elapsed: number) {
      const event: LiveViewEvent = {
        type: "story-complete",
        storyIndex,
        elapsed,
        timestamp: Date.now(),
      };
      broadcast(event);
    },
    emitRunComplete(branch: string, commitCount: number) {
      const event: LiveViewEvent = {
        type: "run-complete",
        branch,
        commitCount,
        timestamp: Date.now(),
      };
      broadcast(event);
    },
  };

  sharedServer = liveViewServer;
  sharedServerDir = workingDir;

  return liveViewServer;
}

export function setAbortController(server: LiveViewServer, controller: AbortController): void {
  // Store reference to abort controller for POST /abort
  (server as any).abortController = controller;
}
