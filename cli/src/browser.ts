/**
 * Lightweight browser automation via Chrome DevTools Protocol (CDP).
 * Zero external dependencies — uses Node's built-in fetch and WebSocket (Node 22+)
 * or falls back to raw HTTP + ws package.
 *
 * Spawns headless Chrome, connects via CDP websocket, exposes tools for
 * navigate, screenshot, click, fill, evaluate, and console reading.
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import * as logger from "./logger.js";

// ---------------------------------------------------------------------------
// Chrome binary detection
// ---------------------------------------------------------------------------

const CHROME_PATHS: Record<string, string[]> = {
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function findChrome(): string | null {
  const platform = process.platform as string;

  // WSL: try Windows Chrome via /mnt/c
  if (platform === "linux") {
    try {
      const wslCheck = execSync("uname -r 2>/dev/null", { encoding: "utf-8" });
      if (wslCheck.toLowerCase().includes("microsoft")) {
        const wslPaths = [
          "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
          "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        ];
        for (const p of wslPaths) {
          try {
            execSync(`test -f "${p}"`, { stdio: "pipe" });
            return p;
          } catch { /* not found */ }
        }
      }
    } catch { /* not WSL */ }
  }

  const candidates = CHROME_PATHS[platform] || CHROME_PATHS.linux;
  for (const candidate of candidates) {
    try {
      if (candidate.startsWith("/")) {
        execSync(`test -f "${candidate}"`, { stdio: "pipe" });
        return candidate;
      } else {
        execSync(`which "${candidate}" 2>/dev/null`, { stdio: "pipe", encoding: "utf-8" });
        return candidate;
      }
    } catch { /* not found */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// CDP client (raw JSON-RPC over WebSocket)
// ---------------------------------------------------------------------------

interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private consoleMessages: Array<{ type: string; text: string }> = [];
  private eventHandlers = new Map<string, ((params: Record<string, unknown>) => void)[]>();

  async connect(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WebSocket error: ${e}`));

      this.ws.onmessage = (event) => {
        try {
          const msg: CDPMessage = JSON.parse(String(event.data));

          // Response to a command
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            const { resolve: res, reject: rej } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) rej(new Error(msg.error.message));
            else res(msg.result || {});
          }

          // Event
          if (msg.method) {
            // Capture console messages
            if (msg.method === "Runtime.consoleAPICalled" && msg.params) {
              const args = (msg.params.args as Array<{ value?: string; description?: string }>) || [];
              const text = args.map(a => a.value || a.description || "").join(" ");
              this.consoleMessages.push({ type: String(msg.params.type || "log"), text });
            }

            // Fire event handlers
            const handlers = this.eventHandlers.get(msg.method);
            if (handlers) {
              for (const handler of handlers) handler(msg.params || {});
            }
          }
        } catch { /* malformed message */ }
      };
    });
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP not connected");
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, params: params || {} }));

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 30000);
    });
  }

  getConsoleMessages(): Array<{ type: string; text: string }> {
    const msgs = [...this.consoleMessages];
    this.consoleMessages = [];
    return msgs;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Browser manager
// ---------------------------------------------------------------------------

let chromeProcess: ChildProcess | null = null;
let cdpClient: CDPClient | null = null;
let debugPort = 9222;

/** Get the host to connect to CDP — Windows host IP for WSL, localhost otherwise. */
function getCDPHost(): string {
  try {
    const uname = execSync("uname -r 2>/dev/null", { encoding: "utf-8" });
    if (uname.toLowerCase().includes("microsoft")) {
      // WSL — Chrome runs on Windows side, connect via gateway IP
      const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
      if (gateway) return gateway;
    }
  } catch { /* not WSL */ }
  return "127.0.0.1";
}

export async function browserOpen(): Promise<string> {
  if (chromeProcess && cdpClient) {
    return "Browser already open.";
  }

  const chromePath = findChrome();
  if (!chromePath) {
    return "Chrome/Chromium not found. Install Google Chrome to use browser tools.";
  }

  // Find a free port
  debugPort = 9222 + Math.floor(Math.random() * 100);

  const args = [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--window-size=1280,720",
    "about:blank",
  ];

  logger.info("Launching Chrome", { path: chromePath, port: debugPort });

  chromeProcess = spawn(chromePath, args, {
    stdio: "pipe",
    detached: true,
  });

  chromeProcess.on("error", (err) => {
    logger.error(`Chrome launch failed: ${err.message}`);
    chromeProcess = null;
  });

  chromeProcess.on("exit", () => {
    chromeProcess = null;
    cdpClient?.close();
    cdpClient = null;
  });

  // Wait for Chrome to start and expose CDP
  const cdpHost = getCDPHost();
  let wsUrl: string | null = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    try {
      const res = await globalThis.fetch(`http://${cdpHost}:${debugPort}/json/version`);
      if (res.ok) {
        const data = (await res.json()) as { webSocketDebuggerUrl: string };
        // Replace 127.0.0.1 in the WS URL with the actual CDP host
        // (Chrome reports its own localhost, but WSL needs the gateway IP)
        wsUrl = data.webSocketDebuggerUrl.replace("127.0.0.1", cdpHost);
        break;
      }
    } catch { /* not ready yet */ }
  }

  if (!wsUrl) {
    chromeProcess?.kill();
    chromeProcess = null;
    return "Failed to connect to Chrome — timed out waiting for CDP.";
  }

  // Connect CDP
  cdpClient = new CDPClient();
  await cdpClient.connect(wsUrl);

  // Enable domains
  await cdpClient.send("Page.enable");
  await cdpClient.send("Runtime.enable");
  await cdpClient.send("Network.enable");

  logger.info("Chrome connected via CDP", { wsUrl });
  return `Browser open (Chrome headless on port ${debugPort}).`;
}

export async function browserNavigate(url: string): Promise<string> {
  if (!cdpClient) return "Browser not open. Use browser_open first.";

  try {
    await cdpClient.send("Page.navigate", { url });
    // Wait for load
    await cdpClient.send("Page.loadEventFired").catch(() => {
      // loadEventFired is an event, not a command — wait manually
    });
    await new Promise(r => setTimeout(r, 1000)); // Brief settle time
    const result = await cdpClient.send("Runtime.evaluate", {
      expression: "document.title",
    }) as { result?: { value?: string } };
    const title = result?.result?.value || "(no title)";
    return `Navigated to ${url} — "${title}"`;
  } catch (err) {
    return `Navigation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function browserScreenshot(): Promise<{ base64: string; description: string }> {
  if (!cdpClient) return { base64: "", description: "Browser not open. Use browser_open first." };

  try {
    const result = await cdpClient.send("Page.captureScreenshot", {
      format: "png",
      quality: 80,
    }) as { data?: string };

    const base64 = result?.data || "";
    return {
      base64,
      description: `Screenshot captured (${Math.round(base64.length * 0.75 / 1024)}KB).`,
    };
  } catch (err) {
    return { base64: "", description: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function browserClick(selector: string): Promise<string> {
  if (!cdpClient) return "Browser not open. Use browser_open first.";

  try {
    const result = await cdpClient.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'Element not found: ${selector}';
        el.click();
        return 'Clicked: ${selector}';
      })()`,
    }) as { result?: { value?: string } };
    return result?.result?.value || "Click executed.";
  } catch (err) {
    return `Click failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function browserFill(selector: string, value: string): Promise<string> {
  if (!cdpClient) return "Browser not open. Use browser_open first.";

  try {
    const result = await cdpClient.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'Element not found: ${selector}';
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'Filled: ${selector}';
      })()`,
    }) as { result?: { value?: string } };
    return result?.result?.value || "Fill executed.";
  } catch (err) {
    return `Fill failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function browserEvaluate(expression: string): Promise<string> {
  if (!cdpClient) return "Browser not open. Use browser_open first.";

  try {
    const result = await cdpClient.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    }) as { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } };

    if (result?.exceptionDetails) {
      return `Error: ${result.exceptionDetails.text || "evaluation error"}`;
    }

    const val = result?.result?.value;
    if (val === undefined) return result?.result?.description || "(undefined)";
    return typeof val === "string" ? val : JSON.stringify(val);
  } catch (err) {
    return `Evaluate failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function browserConsole(): Promise<string> {
  if (!cdpClient) return "Browser not open. Use browser_open first.";

  const msgs = cdpClient.getConsoleMessages();
  if (msgs.length === 0) return "(no console messages)";
  return msgs.map(m => `[${m.type}] ${m.text}`).join("\n");
}

export async function browserClose(): Promise<string> {
  if (cdpClient) {
    cdpClient.close();
    cdpClient = null;
  }
  if (chromeProcess) {
    try {
      process.kill(-chromeProcess.pid!, "SIGTERM");
    } catch {
      chromeProcess.kill();
    }
    chromeProcess = null;
  }
  return "Browser closed.";
}

export function isBrowserOpen(): boolean {
  return chromeProcess !== null && cdpClient !== null;
}
