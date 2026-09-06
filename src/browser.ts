/** Run-owned Chrome/CDP resources. Chrome is a browser helper, not OS isolation. */
import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import * as logger from "./logger.js";

const STARTUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TERMINATION_GRACE_MS = 1_500;
const MAX_CDP_MESSAGE_BYTES = 6 * 1024 * 1024;
const MAX_CONSOLE_MESSAGES = 100;
const MAX_CONSOLE_BYTES = 32 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_TEXT_RESULT_CHARS = 16_000;
const CHROME_PATHS: Record<string, string[]> = {
  linux: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  win32: ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
};

export interface BrowserRunResources {
  open(): Promise<string>; navigate(url: string): Promise<string>;
  screenshot(): Promise<{ base64: string; description: string }>;
  click(selector: string): Promise<string>; fill(selector: string, value: string): Promise<string>;
  evaluate(expression: string): Promise<string>; console(): Promise<string>;
  close(): Promise<string>; isOpen(): boolean;
}
/** Bounded test seams; production callers only provide run ownership. */
export interface BrowserRunOptions {
  runId: string; workspace: string; signal: AbortSignal;
  chromePath?: string | null; startupTimeoutMs?: number; requestTimeoutMs?: number;
  terminationGraceMs?: number; profileRoot?: string; spawnProcess?: typeof spawn; fetchImpl?: typeof fetch;
}
interface CDPMessage { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string }; }
interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout; onAbort(): void; }

function bounded(value: string, maximum: number): string { return value.length <= maximum ? value : `${value.slice(0, maximum)}… [truncated]`; }
function abortError(signal: AbortSignal): Error { return signal.reason instanceof Error ? signal.reason : new Error("Browser operation cancelled"); }
function isWsl(): boolean { try { return readFileSync("/proc/sys/kernel/osrelease", "utf8").toLowerCase().includes("microsoft"); } catch { return false; } }
function findChrome(): string | null {
  // Never use Windows Chrome from WSL: its descendants are not a Unix group.
  if (process.platform === "linux" && isWsl()) return null;
  for (const candidate of CHROME_PATHS[process.platform] ?? []) {
    if (candidate.includes("/") || candidate.includes("\\")) { if (existsSync(candidate)) return candidate; continue; }
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) if (existsSync(path.join(directory, candidate))) return path.join(directory, candidate);
  }
  return null;
}
function waitFor(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = (): void => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(abortError(signal)); };
    function done(): void { signal.removeEventListener("abort", onAbort); resolve(); }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function fetchWithDeadline(fetchImpl: typeof fetch, url: string, signal: AbortSignal, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Browser HTTP request timed out")), timeoutMs);
  const onAbort = (): void => controller.abort(abortError(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  try { return await fetchImpl(url, { signal: controller.signal }); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
}

class CDPClient {
  private ws: WebSocket | null = null; private nextId = 1; private closed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly messages: Array<{ type: string; text: string }> = []; private messageBytes = 0;
  constructor(private readonly signal: AbortSignal, private readonly timeoutMs: number) {}
  async connect(wsUrl: string): Promise<void> {
    if (this.signal.aborted) throw abortError(this.signal);
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl); this.ws = ws; let settled = false;
      const finish = (error?: Error): void => { if (settled) return; settled = true; clearTimeout(timer); this.signal.removeEventListener("abort", onAbort); error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { try { ws.close(); } catch { /* best effort */ } finish(new Error("CDP connection timed out")); }, this.timeoutMs);
      const onAbort = (): void => { try { ws.close(); } catch { /* best effort */ } finish(abortError(this.signal)); };
      this.signal.addEventListener("abort", onAbort, { once: true });
      ws.onopen = () => finish(); ws.onerror = () => finish(new Error("CDP WebSocket connection failed"));
      ws.onclose = () => { if (!settled) finish(new Error("CDP WebSocket closed during connection")); this.rejectPending(new Error("CDP connection closed")); };
      ws.onmessage = (event) => this.onMessage(String(event.data));
    });
  }
  private onMessage(raw: string): void {
    if (raw.length > MAX_CDP_MESSAGE_BYTES) { this.close(new Error("CDP response exceeded size limit")); return; }
    try {
      const message = JSON.parse(raw) as CDPMessage;
      if (message.id !== undefined) { const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); clearTimeout(pending.timer); this.signal.removeEventListener("abort", pending.onAbort); message.error ? pending.reject(new Error(message.error.message ?? "CDP command failed")) : pending.resolve(message.result ?? {}); } }
      if (message.method === "Runtime.consoleAPICalled" && message.params) {
        const args = (message.params.args as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
        const text = bounded(args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" "), 2_048); const bytes = Buffer.byteLength(text);
        if (this.messages.length < MAX_CONSOLE_MESSAGES && this.messageBytes + bytes <= MAX_CONSOLE_BYTES) { this.messages.push({ type: String(message.params.type ?? "log"), text }); this.messageBytes += bytes; }
      }
    } catch (error) { logger.debug("Malformed CDP WebSocket message", { error: error instanceof Error ? error.message : String(error) }); }
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("CDP not connected"));
    if (this.signal.aborted) return Promise.reject(abortError(this.signal));
    const id = this.nextId++;
    const ws = this.ws;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.signal.removeEventListener("abort", onAbort); reject(new Error(`CDP command timed out: ${method}`)); }, this.timeoutMs);
      const onAbort = (): void => { const pending = this.pending.get(id); if (!pending) return; this.pending.delete(id); clearTimeout(timer); reject(abortError(this.signal)); };
      this.pending.set(id, { resolve, reject, timer, onAbort }); this.signal.addEventListener("abort", onAbort, { once: true });
      try { ws.send(JSON.stringify({ id, method, params })); } catch (error) { this.pending.delete(id); clearTimeout(timer); this.signal.removeEventListener("abort", onAbort); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  takeConsole(): Array<{ type: string; text: string }> { const output = this.messages.splice(0); this.messageBytes = 0; return output; }
  close(reason = new Error("CDP connection closed")): void { if (this.closed) return; this.closed = true; this.rejectPending(reason); try { this.ws?.close(); } catch { /* best effort */ } this.ws = null; }
  private rejectPending(reason: Error): void { for (const [, pending] of this.pending) { clearTimeout(pending.timer); this.signal.removeEventListener("abort", pending.onAbort); pending.reject(reason); } this.pending.clear(); }
}

async function waitForEndpoint(profile: string, signal: AbortSignal, startupTimeoutMs: number, fetchImpl: typeof fetch, requestTimeoutMs: number): Promise<string> {
  const deadline = Date.now() + startupTimeoutMs; const portFile = path.join(profile, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (signal.aborted) throw abortError(signal);
    try {
      const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (port && /^\d+$/.test(port)) {
        const response = await fetchWithDeadline(fetchImpl, `http://127.0.0.1:${port}/json/list`, signal, Math.min(requestTimeoutMs, 1_000));
        const pages = response.ok ? await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }> : [];
        const page = pages.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl.replace(/localhost|127\.0\.0\.1/, "127.0.0.1");
      }
    } catch { /* Chrome has not finished its private endpoint handshake. */ }
    await waitFor(Math.min(100, Math.max(1, deadline - Date.now())), signal);
  }
  throw new Error("Timed out waiting for Chrome's private DevTools endpoint");
}

export function createBrowserRunResources(options: BrowserRunOptions): BrowserRunResources {
  const startupTimeoutMs = Math.max(100, Math.min(options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS, 30_000));
  const requestTimeoutMs = Math.max(100, Math.min(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, 30_000));
  const terminationGraceMs = Math.max(0, Math.min(options.terminationGraceMs ?? TERMINATION_GRACE_MS, 10_000));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch; const spawnProcess = options.spawnProcess ?? spawn;
  let child: ChildProcess | null = null; let cdp: CDPClient | null = null; let profile: string | null = null; let stderr = "";
  let opening: Promise<string> | null = null; let closing: Promise<string> | null = null; let exited: Promise<void> | null = null;
  const notOpen = (): string => "Browser not open. Use browser_open first.";
  const close = async (): Promise<string> => {
    if (closing) return closing;
    closing = (async () => {
      cdp?.close(new Error("Browser closed")); cdp = null; const owned = child; const ownedExit = exited;
      if (owned?.pid && process.platform !== "win32") {
        try { process.kill(-owned.pid, "SIGTERM"); } catch { try { owned.kill("SIGTERM"); } catch { /* parent may already have exited */ } }
      } else { try { owned?.kill("SIGTERM"); } catch { /* best effort */ } }
      if (ownedExit) {
        let ended = false; void ownedExit.then(() => { ended = true; });
        await Promise.race([ownedExit, waitFor(terminationGraceMs, new AbortController().signal)]);
        if (!ended) { if (owned?.pid && process.platform !== "win32") { try { process.kill(-owned.pid, "SIGKILL"); } catch { try { owned.kill("SIGKILL"); } catch { /* best effort */ } } } else { try { owned?.kill("SIGKILL"); } catch { /* best effort */ } } await Promise.race([ownedExit, waitFor(terminationGraceMs, new AbortController().signal)]); }
      }
      child = null; exited = null;
      if (profile) { const ownedProfile = profile; profile = null; await rm(ownedProfile, { recursive: true, force: true }); }
      return "Browser closed.";
    })();
    try { return await closing; } finally { closing = null; }
  };
  const open = async (): Promise<string> => {
    if (child && cdp) return "Browser already open."; if (opening) return opening;
    opening = (async () => {
      const chromePath = options.chromePath === undefined ? findChrome() : options.chromePath;
      if (!chromePath) return process.platform === "linux" && isWsl() ? "Browser automation requires Linux Chrome/Chromium under WSL; Windows Chrome cannot be safely managed as a Unix process group." : "Chrome/Chromium not found. Install Google Chrome to use browser tools.";
      if (process.platform === "win32" || (process.platform === "linux" && /\\.exe$/i.test(chromePath))) return "Browser automation requires a qualified native lifecycle on this platform. Use Linux Chrome/Chromium; Windows Chrome via WSL is unsupported.";
      try {
        profile = await mkdtemp(path.join(options.profileRoot ?? tmpdir(), "workermill-browser-"));
        const args = ["--headless=new", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions", "--disable-background-networking", "--window-size=1280,720", "about:blank"];
        child = spawnProcess(chromePath, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
        const launched = child;
        exited = new Promise((resolve) => launched.once("exit", () => { cdp?.close(new Error("Chrome process exited")); resolve(); }));
        launched.once("error", () => cdp?.close(new Error("Chrome launch failed")));
        launched.stderr?.on("data", (chunk: Buffer | string) => { stderr = bounded(stderr + String(chunk), MAX_STDERR_BYTES); });
        const endpoint = await waitForEndpoint(profile, options.signal, startupTimeoutMs, fetchImpl, requestTimeoutMs);
        const client = new CDPClient(options.signal, requestTimeoutMs); cdp = client; await client.connect(endpoint); await client.send("Page.enable"); await client.send("Runtime.enable"); await client.send("Network.enable");
        logger.info("Chrome connected via private CDP endpoint", { runId: options.runId }); return "Browser open (private headless Chrome session).";
      } catch (error) { const message = error instanceof Error ? error.message : String(error); await close(); return options.signal.aborted ? "Browser startup cancelled." : `Failed to start Chrome: ${bounded(message || stderr, 500)}`; }
    })();
    try { return await opening; } finally { opening = null; }
  };
  const operation = async (name: string, work: () => Promise<string>): Promise<string> => { if (!cdp) return notOpen(); try { return await work(); } catch (error) { return `${name} failed: ${bounded(error instanceof Error ? error.message : String(error), 500)}`; } };
  const resultValue = (result: unknown): string => { const response = result as { result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } }; if (response.exceptionDetails) return `Error: ${response.exceptionDetails.text ?? "evaluation error"}`; if (response.result?.value === undefined) return response.result?.description ?? "(undefined)"; return bounded(typeof response.result.value === "string" ? response.result.value : JSON.stringify(response.result.value), MAX_TEXT_RESULT_CHARS); };
  return {
    open,
    navigate: (url) => operation("Navigation", async () => { await cdp!.send("Page.navigate", { url }); return `Navigated to ${url} — "${resultValue(await cdp!.send("Runtime.evaluate", { expression: "document.title", returnByValue: true }))}"`; }),
    screenshot: async () => { if (!cdp) return { base64: "", description: notOpen() }; try { const response = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data?: string }; const base64 = bounded(response.data ?? "", MAX_CDP_MESSAGE_BYTES); return { base64, description: `Screenshot captured (${Math.round(base64.length * 0.75 / 1024)}KB).` }; } catch (error) { return { base64: "", description: `Screenshot failed: ${bounded(error instanceof Error ? error.message : String(error), 500)}` }; } },
    click: (selector) => operation("Click", async () => resultValue(await cdp!.send("Runtime.evaluate", { expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'Element not found: ${selector}'; el.click(); return 'Clicked: ${selector}'; })()`, returnByValue: true }))),
    fill: (selector, value) => operation("Fill", async () => resultValue(await cdp!.send("Runtime.evaluate", { expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'Element not found: ${selector}'; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'Filled: ${selector}'; })()`, returnByValue: true }))),
    evaluate: (expression) => operation("Evaluate", async () => resultValue(await cdp!.send("Runtime.evaluate", { expression, returnByValue: true }))),
    console: async () => { if (!cdp) return notOpen(); const messages = cdp.takeConsole(); return messages.length ? messages.map((message) => `[${message.type}] ${message.text}`).join("\n") : "(no console messages)"; }, close, isOpen: () => child !== null && cdp !== null,
  };
}

// Explicit /browser controls own a separate session resource. Model-turn
// resources are closures above, so a model cannot close this browser.
let sessionBrowser: BrowserRunResources | null = null; let sessionController: AbortController | null = null;
function explicitBrowser(): BrowserRunResources { if (!sessionBrowser) { sessionController = new AbortController(); sessionBrowser = createBrowserRunResources({ runId: `session-${crypto.randomUUID()}`, workspace: process.cwd(), signal: sessionController.signal }); } return sessionBrowser; }
export async function browserOpen(): Promise<string> { return explicitBrowser().open(); }
export async function browserNavigate(url: string): Promise<string> { return explicitBrowser().navigate(url); }
export async function browserScreenshot(): Promise<{ base64: string; description: string }> { return explicitBrowser().screenshot(); }
export async function browserClick(selector: string): Promise<string> { return explicitBrowser().click(selector); }
export async function browserFill(selector: string, value: string): Promise<string> { return explicitBrowser().fill(selector, value); }
export async function browserEvaluate(expression: string): Promise<string> { return explicitBrowser().evaluate(expression); }
export async function browserConsole(): Promise<string> { return explicitBrowser().console(); }
export async function browserClose(): Promise<string> { sessionController?.abort(new Error("Browser session closed")); const owner = sessionBrowser; sessionBrowser = null; sessionController = null; return owner ? owner.close() : "Browser closed."; }
export async function closeAllBrowserResources(): Promise<void> { await browserClose(); }
export function isBrowserOpen(): boolean { return sessionBrowser?.isOpen() ?? false; }
