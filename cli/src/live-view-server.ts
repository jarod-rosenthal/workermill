import { createServer, type Server } from "http";
import { execSync } from "child_process";
import { LIVE_VIEW_HTML } from "./ui/live-view-html.js";

export type LiveViewEvent =
  | { type: "file-changed"; persona: string; storyIndex: number; storyTitle: string; filePath: string; tool: "created" | "edited"; diff: string; timestamp: number }
  | { type: "story-start"; storyIndex: number; storyTitle: string; persona: string; total: number; timestamp: number }
  | { type: "story-complete"; storyIndex: number; elapsed: number; timestamp: number }
  | { type: "run-complete"; branch: string; commitCount: number; timestamp: number };

export interface LiveViewServer {
  port: number;
  stop(): void;
  emitFileChange(persona: string, storyIndex: number, storyTitle: string, filePath: string, tool: "created" | "edited"): void;
  emitStoryStart(storyIndex: number, storyTitle: string, persona: string, total: number): void;
  emitStoryComplete(storyIndex: number, elapsed: number): void;
  emitRunComplete(branch: string, commitCount: number): void;
}

export function createLiveViewServer(workingDir: string, mainBranch: string): LiveViewServer & { setAbortController: (controller: AbortController) => void } {
  const server = createServer();
  const clients = new Set<{ res: any; replay: LiveViewEvent[] }>();
  const fileDiffs = new Map<string, string>();

  let abortController: AbortController | null = null;

  server.on("request", (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      // Serve the live view HTML
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(LIVE_VIEW_HTML);
    } else if (req.method === "GET" && req.url === "/events") {
      // SSE endpoint
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      });

      const client = { res, replay: Array.from(fileDiffs.values()).map(diff => JSON.parse(diff)) as LiveViewEvent[] };
      clients.add(client);

      // Send replay of current state
      for (const event of client.replay) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      req.on("close", () => {
        clients.delete(client);
      });
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

  server.listen(0, () => {
    // Port is assigned by OS
  });

  const port = (server.address() as any).port;

  function broadcast(event: LiveViewEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      client.res.write(data);
      client.replay.push(event);
    }
  }

  return {
    port,
    stop() {
      server.close();
    },
    setAbortController(controller: AbortController) {
      abortController = controller;
    },
    emitFileChange(persona: string, storyIndex: number, storyTitle: string, filePath: string, tool: "created" | "edited") {
      try {
        // Generate diff using git diff HEAD -- <filePath>
        const diff = execSync(`git diff HEAD -- "${filePath}"`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" });
        const event: LiveViewEvent = {
          type: "file-changed",
          persona,
          storyIndex,
          storyTitle,
          filePath,
          tool,
          diff,
          timestamp: Date.now(),
        };
        fileDiffs.set(filePath, JSON.stringify(event));
        broadcast(event);
      } catch (err) {
        // If git diff fails, use empty diff
        const event: LiveViewEvent = {
          type: "file-changed",
          persona,
          storyIndex,
          storyTitle,
          filePath,
          tool,
          diff: "",
          timestamp: Date.now(),
        };
        fileDiffs.set(filePath, JSON.stringify(event));
        broadcast(event);
      }
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
}

export function setAbortController(server: LiveViewServer, controller: AbortController): void {
  // Store reference to abort controller for POST /abort
  (server as any).abortController = controller;
}