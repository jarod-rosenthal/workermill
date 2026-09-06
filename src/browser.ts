/**
 * Run-owned Chrome/CDP resources. Chrome is useful for browser verification;
 * it is not OS-sandbox containment. Every launch gets a private profile and
 * a private DevTools endpoint discovered from that profile.
 */
import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, realpathSync } from "fs";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import crypto from "crypto";
import * as logger from "./logger.js";
import { boundedFetch } from "./engine/http-request.js";

const STARTUP_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TERMINATION_GRACE_MS = 1_500;
const MAX_DISCOVERY_BYTES = 256 * 1024;
const MAX_CDP_MESSAGE_BYTES = 6 * 1024 * 1024;
const MAX_CONSOLE_MESSAGES = 100;
const MAX_CONSOLE_BYTES = 32 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_TEXT_RESULT_CHARS = 16_000;

const CHROME_PATHS: Record<string, string[]> = {
  linux: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

export interface BrowserRunResources {
  open(): Promise<string>;
  navigate(url: string): Promise<string>;
  screenshot(): Promise<{ base64: string; description: string }>;
  click(selector: string): Promise<string>;
  fill(selector: string, value: string): Promise<string>;
  evaluate(expression: string): Promise<string>;
  console(): Promise<string>;
  close(): Promise<string>;
  dispose(): Promise<string>;
  isOpen(): boolean;
}

/** Bounded test seams; production callers only provide ownership context. */
export interface BrowserRunOptions {
  runId: string;
  workspace: string;
  signal: AbortSignal;
  chromePath?: string | null;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  terminationGraceMs?: number;
  profileRoot?: string;
  spawnProcess?: typeof spawn;
  fetchImpl?: typeof fetch;
  killProcess?: typeof process.kill;
}

interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  onAbort(): void;
}

interface DebugTarget {
  type?: string;
  webSocketDebuggerUrl?: string;
}

class EndpointSecurityError extends Error {}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}… [truncated]`;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Browser operation cancelled");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function isWsl(): boolean {
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8")
      .toLowerCase()
      .includes("microsoft");
  } catch {
    return false;
  }
}

function findChrome(): string | null {
  // WSL can safely launch a Linux Chrome/Chromium. Only a Windows executable
  // is rejected below, because it cannot belong to this Unix process group.
  for (const candidate of CHROME_PATHS[process.platform] ?? []) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
      const candidatePath = path.join(directory, candidate);
      if (existsSync(candidatePath)) return candidatePath;
    }
  }
  return null;
}

function isWindowsExecutable(executable: string): boolean {
  let resolved = executable;
  try { resolved = realpathSync(executable); } catch { /* spawn reports a missing executable */ }
  return process.platform === "linux" && (/\.exe$/i.test(executable) || /\.exe$/i.test(resolved));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForAbortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    function done(): void {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const response = await boundedFetch(url, {}, {
    signal, timeoutMs, maxResponseBytes: MAX_DISCOVERY_BYTES, fetchImpl,
  });
  if (!response.ok) throw new Error(`Browser discovery returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}

function privateWebSocketUrl(raw: string, port: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new EndpointSecurityError("Chrome supplied an invalid DevTools WebSocket URL");
  }
  if (endpoint.protocol !== "ws:" || endpoint.username || endpoint.password || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.port !== port) {
    throw new EndpointSecurityError("Chrome DevTools endpoint was not the private loopback endpoint");
  }
  endpoint.hostname = "127.0.0.1";
  return endpoint;
}

async function waitForEndpoint(
  profile: string,
  signal: AbortSignal,
  startupTimeoutMs: number,
  requestTimeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const deadline = Date.now() + startupTimeoutMs;
  const portFile = path.join(profile, "DevToolsActivePort");
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      const [port, browserPath] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
      if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !browserPath?.startsWith("/")) {
        throw new EndpointSecurityError("Chrome wrote an invalid DevToolsActivePort file");
      }
      const remaining = Math.max(1, deadline - Date.now());
      const requestLimit = Math.min(requestTimeoutMs, remaining);
      const base = `http://127.0.0.1:${port}`;
      const version = await fetchJson(fetchImpl, `${base}/json/version`, signal, requestLimit) as DebugTarget;
      const browserEndpoint = privateWebSocketUrl(String(version.webSocketDebuggerUrl ?? ""), port);
      if (browserEndpoint.pathname !== browserPath) {
        throw new EndpointSecurityError("Chrome DevTools identity did not match the private profile handshake");
      }
      const targets = await fetchJson(fetchImpl, `${base}/json/list`, signal, Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())));
      if (!Array.isArray(targets)) throw new Error("Chrome returned an invalid target list");
      const page = (targets as DebugTarget[]).find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return privateWebSocketUrl(page.webSocketDebuggerUrl, port).toString();
    } catch (error) {
      if (error instanceof EndpointSecurityError || signal.aborted) throw error;
      // The profile file and HTTP service are published independently. Retry
      // only transient/incomplete startup errors until the bounded deadline.
    }
    await waitForAbortableDelay(Math.min(100, Math.max(1, deadline - Date.now())), signal);
  }
  throw new Error("Timed out waiting for Chrome's private DevTools endpoint");
}

class CDPClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly consoleMessages: Array<{ type: string; text: string }> = [];
  private consoleBytes = 0;

  constructor(
    private readonly signal: AbortSignal,
    private readonly timeoutMs: number,
  ) {}

  async connect(wsUrl: string): Promise<void> {
    throwIfAborted(this.signal);
    await new Promise<void>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.ws = ws;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.signal.removeEventListener("abort", onAbort);
        if (error) {
          try { ws.close(); } catch { /* best effort */ }
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(
        () => finish(new Error("CDP connection timed out")),
        this.timeoutMs,
      );
      const onAbort = (): void => finish(abortError(this.signal));
      this.signal.addEventListener("abort", onAbort, { once: true });
      ws.onopen = () => finish();
      ws.onerror = () => finish(new Error("CDP WebSocket connection failed"));
      ws.onclose = () => {
        if (!settled) finish(new Error("CDP WebSocket closed during connection"));
        this.rejectPending(new Error("CDP connection closed"));
      };
      ws.onmessage = (event) => this.onMessage(String(event.data));
    });
  }

  private onMessage(raw: string): void {
    if (Buffer.byteLength(raw) > MAX_CDP_MESSAGE_BYTES) {
      this.close(new Error("CDP response exceeded size limit"));
      return;
    }
    try {
      const message = JSON.parse(raw) as CDPMessage;
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          this.signal.removeEventListener("abort", pending.onAbort);
          if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed"));
          else pending.resolve(message.result ?? {});
        }
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params) {
        const args = (message.params.args as Array<{ value?: unknown; description?: string }> | undefined) ?? [];
        const text = bounded(args.map((argument) => String(argument.value ?? argument.description ?? "")).join(" "), 2_048);
        const bytes = Buffer.byteLength(text);
        if (this.consoleMessages.length < MAX_CONSOLE_MESSAGES && this.consoleBytes + bytes <= MAX_CONSOLE_BYTES) {
          this.consoleMessages.push({ type: String(message.params.type ?? "log"), text });
          this.consoleBytes += bytes;
        }
      }
    } catch (error) {
      logger.debug("Malformed CDP WebSocket message", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP not connected"));
    }
    throwIfAborted(this.signal);
    const ws = this.ws;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        reject(abortError(this.signal));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.signal.removeEventListener("abort", onAbort);
        reject(new Error(`CDP command timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onAbort });
      this.signal.addEventListener("abort", onAbort, { once: true });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        this.signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  takeConsole(): Array<{ type: string; text: string }> {
    const output = this.consoleMessages.splice(0);
    this.consoleBytes = 0;
    return output;
  }

  close(reason = new Error("CDP connection closed")): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(reason);
    try { this.ws?.close(); } catch { /* best effort */ }
    this.ws = null;
  }

  private rejectPending(reason: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.signal.removeEventListener("abort", pending.onAbort);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

const liveResources = new Set<BrowserRunResources>();

export function createBrowserRunResources(options: BrowserRunOptions): BrowserRunResources {
  const startupTimeoutMs = Math.max(100, Math.min(options.startupTimeoutMs ?? STARTUP_TIMEOUT_MS, 30_000));
  const requestTimeoutMs = Math.max(100, Math.min(options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, 30_000));
  const terminationGraceMs = Math.max(0, Math.min(options.terminationGraceMs ?? TERMINATION_GRACE_MS, 10_000));
  const spawnProcess = options.spawnProcess ?? spawn;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const killProcess = options.killProcess ?? process.kill;
  const controller = new AbortController();

  let child: ChildProcess | null = null;
  let profile: string | null = null;
  let cdp: CDPClient | null = null;
  let opening: Promise<string> | null = null;
  let startupController: AbortController | null = null;
  let cleanup: Promise<void> | null = null;
  let cleanupFailure: Error | undefined;
  let stderr = "";
  let closed = false;

  controller.signal.addEventListener("abort", () => {
    startupController?.abort(abortError(controller.signal));
  }, { once: true });

  const cleanupInternal = async (): Promise<void> => {
    if (cleanup) return cleanup;
    cleanup = (async () => {
      const failures: Error[] = [];
      cdp?.close(new Error("Browser closed"));
      cdp = null;
      const owned = child;
      const ownedProfile = profile;
      let processStopped = !owned;
      try {
        if (owned?.pid) await stopProcessGroup(owned, killProcess, terminationGraceMs);
        processStopped = true;
        if (child === owned) child = null;
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
      // Keep ownership of both the process and its exact profile on failure.
      // Removing a live browser's profile would make recovery less safe.
      if (ownedProfile && processStopped) {
        try {
          await rm(ownedProfile, { recursive: true, force: true });
          if (profile === ownedProfile) profile = null;
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (failures.length > 0) {
        const failure = new AggregateError(failures, "Browser cleanup failed");
        cleanupFailure ??= failure;
        throw failure;
      }
    })();
    try {
      await cleanup;
    } finally {
      cleanup = null;
    }
  };

  const teardown = async (permanent: boolean): Promise<string> => {
    if (permanent) {
      closed = true;
      options.signal.removeEventListener("abort", onParentAbort);
      controller.abort(new Error("Browser run disposed"));
    }
    startupController?.abort(new Error("Browser startup closed"));
    // The opening workflow observes the same signal. Await it before the
    // final cleanup pass so a late mkdtemp/spawn cannot escape close().
    const inFlightOpen = opening;
    const firstCleanup = cleanupInternal();
    await Promise.allSettled([firstCleanup, inFlightOpen ?? Promise.resolve()]);
    await Promise.allSettled([cleanupInternal()]);
    if (permanent && !child && !profile) liveResources.delete(resources);
    // An automatic cancellation cleanup may finish before the awaited owner.
    // Never turn that earlier failure into an ordinary successful finalizer.
    if (cleanupFailure) throw cleanupFailure;
    return "Browser closed.";
  };

  // A model may explicitly close and reopen its own browser during a turn.
  // Disposal is reserved for owner cancellation/finalization and is terminal.
  const close = async (): Promise<string> => teardown(false);
  const dispose = async (): Promise<string> => teardown(true);

  const open = async (): Promise<string> => {
    if (cleanupFailure) throw cleanupFailure;
    if (closed || controller.signal.aborted) return "Browser startup cancelled.";
    if (child && cdp) return "Browser already open.";
    if (opening) return opening;
    const startup = new AbortController();
    startupController = startup;
    opening = (async () => {
      const chromePath = options.chromePath === undefined ? findChrome() : options.chromePath;
      if (!chromePath) {
        return "Chrome/Chromium not found. Install Linux Chrome/Chromium to use browser tools.";
      }
      if (process.platform === "win32" || isWindowsExecutable(chromePath)) {
        return "Browser automation requires a qualified native lifecycle on this platform. Use Linux Chrome/Chromium; Windows Chrome via WSL is unsupported.";
      }
      try {
        throwIfAborted(startup.signal);
        profile = await mkdtemp(path.join(options.profileRoot ?? tmpdir(), "workermill-browser-"));
        throwIfAborted(startup.signal);
        const args = [
          "--headless=new",
          "--remote-debugging-address=127.0.0.1",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--window-size=1280,720",
          "about:blank",
        ];
        child = spawnProcess(chromePath, args, {
          cwd: options.workspace,
          stdio: ["ignore", "ignore", "pipe"],
          detached: true,
        });
        const launched = child;
        launched.once("exit", () => {
          cdp?.close(new Error("Chrome process exited"));
        });
        launched.once("error", () => cdp?.close(new Error("Chrome launch failed")));
        launched.stderr?.on("data", (chunk: Buffer | string) => {
          stderr = bounded(stderr + String(chunk), MAX_STDERR_BYTES);
        });
        const endpoint = await waitForEndpoint(profile, startup.signal, startupTimeoutMs, requestTimeoutMs, fetchImpl);
        throwIfAborted(startup.signal);
        cdp = new CDPClient(controller.signal, requestTimeoutMs);
        await cdp.connect(endpoint);
        throwIfAborted(startup.signal);
        await cdp.send("Page.enable");
        throwIfAborted(startup.signal);
        await cdp.send("Runtime.enable");
        throwIfAborted(startup.signal);
        await cdp.send("Network.enable");
        throwIfAborted(startup.signal);
        logger.info("Chrome connected via private CDP endpoint", { runId: options.runId });
        return "Browser open (private headless Chrome session).";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await cleanupInternal();
        return controller.signal.aborted || startup.signal.aborted
          ? "Browser startup cancelled."
          : `Failed to start Chrome: ${bounded(message || stderr, 500)}`;
      }
    })();
    try {
      return await opening;
    } finally {
      opening = null;
      if (startupController === startup) startupController = null;
    }
  };

  const notOpen = (): string => "Browser not open. Use browser_open first.";
  const operation = async (name: string, work: () => Promise<string>): Promise<string> => {
    if (!cdp) return notOpen();
    try {
      return await work();
    } catch (error) {
      return `${name} failed: ${bounded(error instanceof Error ? error.message : String(error), 500)}`;
    }
  };
  const resultValue = (result: unknown): string => {
    const response = result as {
      result?: { value?: unknown; description?: string };
      exceptionDetails?: { text?: string };
    };
    if (response.exceptionDetails) return `Error: ${response.exceptionDetails.text ?? "evaluation error"}`;
    if (response.result?.value === undefined) return response.result?.description ?? "(undefined)";
    const value = typeof response.result.value === "string"
      ? response.result.value
      : JSON.stringify(response.result.value);
    return bounded(value, MAX_TEXT_RESULT_CHARS);
  };
  const selectorResult = (prefix: string, selector: string): string => JSON.stringify(`${prefix}: ${selector}`);

  const resources: BrowserRunResources = {
    open,
    navigate: (url) => operation("Navigation", async () => {
      await cdp!.send("Page.navigate", { url });
      const title = resultValue(await cdp!.send("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      }));
      return `Navigated to ${url} — "${title}"`;
    }),
    screenshot: async () => {
      if (!cdp) return { base64: "", description: notOpen() };
      try {
        const response = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data?: string };
        const base64 = response.data ?? "";
        if (Buffer.byteLength(base64) > MAX_CDP_MESSAGE_BYTES) {
          return { base64: "", description: "Screenshot failed: response exceeded size limit" };
        }
        return {
          base64,
          description: `Screenshot captured (${Math.round(base64.length * 0.75 / 1024)}KB).`,
        };
      } catch (error) {
        return {
          base64: "",
          description: `Screenshot failed: ${bounded(error instanceof Error ? error.message : String(error), 500)}`,
        };
      }
    },
    click: (selector) => operation("Click", async () => resultValue(await cdp!.send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return ${selectorResult("Element not found", selector)}; el.click(); return ${selectorResult("Clicked", selector)}; })()`,
      returnByValue: true,
    }))),
    fill: (selector, value) => operation("Fill", async () => resultValue(await cdp!.send("Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return ${selectorResult("Element not found", selector)}; el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return ${selectorResult("Filled", selector)}; })()`,
      returnByValue: true,
    }))),
    evaluate: (expression) => operation("Evaluate", async () => resultValue(await cdp!.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    }))),
    console: async () => {
      if (!cdp) return notOpen();
      const messages = cdp.takeConsole();
      return messages.length
        ? messages.map((message) => `[${message.type}] ${message.text}`).join("\n")
        : "(no console messages)";
    },
    close,
    dispose,
    isOpen: () => child !== null && cdp !== null && !closed,
  };
  liveResources.add(resources);
  const onParentAbort = (): void => {
    void dispose().catch(() => logger.warn("Browser cleanup failed; the awaited owner will report the failure", { runId: options.runId }));
  };
  options.signal.addEventListener("abort", onParentAbort, { once: true });
  if (options.signal.aborted) onParentAbort();
  return resources;
}

async function stopProcessGroup(
  child: ChildProcess,
  killProcess: typeof process.kill,
  graceMs: number,
): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try { child.kill("SIGTERM"); } catch { /* native Windows is not qualified */ }
    return;
  }
  const groupPid = -child.pid;
  const failures: Error[] = [];
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      killProcess(groupPid, signal);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  };
  // Do this even after the direct parent has exited: descendants retain the
  // original process group and a TERM-ignoring orphan needs SIGKILL.
  signalGroup("SIGTERM");
  await waitForGroupGone(groupPid, killProcess, graceMs);
  signalGroup("SIGKILL");
  // Some launchers can leave a descendant visible while the group leader has
  // already exited. Preserve group signalling as the primary operation, then
  // make the final kill explicit for every remaining live member.
  for (const memberPid of (await liveGroupMembers(-groupPid)) ?? []) {
    try {
      killProcess(memberPid, "SIGKILL");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if (!await waitForGroupGone(groupPid, killProcess, graceMs)) {
    throw new Error("Browser process group did not exit within the cleanup grace period");
  }
  if (failures.length > 0) throw new AggregateError(failures, "Failed to signal browser process group");
}

async function waitForGroupGone(
  groupPid: number,
  killProcess: typeof process.kill,
  graceMs: number,
): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    try {
      killProcess(groupPid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    if (!await groupHasLiveMember(-groupPid)) return true;
    await delay(25);
  }
  // A final probe makes teardown failure visible rather than pretending a
  // TERM-ignoring descendant was gone because its parent exited.
  try {
    killProcess(groupPid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw error;
  }
  if (!await groupHasLiveMember(-groupPid)) return true;
  return false;
}

async function groupHasLiveMember(groupId: number): Promise<boolean> {
  const members = await liveGroupMembers(groupId);
  return members === null || members.length > 0;
}

async function liveGroupMembers(groupId: number): Promise<number[] | null> {
  if (process.platform !== "linux") return null;
  try {
    const entries = await readdir("/proc");
    const members: number[] = [];
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const stat = await readFile(`/proc/${entry}/stat`, "utf8");
        const closing = stat.lastIndexOf(")");
        const fields = stat.slice(closing + 2).split(" ");
        // /proc/<pid>/stat after comm: state, ppid, pgrp, ...
        if (Number(fields[2]) === groupId && fields[0] !== "Z") members.push(Number(entry));
      } catch {
        // A process can exit between readdir and readFile.
      }
    }
    return members;
  } catch {
    // Keep the portable conservative behavior when /proc is unavailable.
    return null;
  }
}

// Explicit /browser controls are session-owned. Model-turn resources are
// closures above, so a model cannot close this browser or another turn's run.
let sessionBrowser: BrowserRunResources | null = null;
let sessionController: AbortController | null = null;

function explicitBrowser(): BrowserRunResources {
  if (!sessionBrowser) {
    sessionController = new AbortController();
    sessionBrowser = createBrowserRunResources({
      runId: `session-${crypto.randomUUID()}`,
      workspace: process.cwd(),
      signal: sessionController.signal,
    });
  }
  return sessionBrowser;
}

export async function browserOpen(): Promise<string> { return explicitBrowser().open(); }
export async function browserNavigate(url: string): Promise<string> { return explicitBrowser().navigate(url); }
export async function browserScreenshot(): Promise<{ base64: string; description: string }> { return explicitBrowser().screenshot(); }
export async function browserClick(selector: string): Promise<string> { return explicitBrowser().click(selector); }
export async function browserFill(selector: string, value: string): Promise<string> { return explicitBrowser().fill(selector, value); }
export async function browserEvaluate(expression: string): Promise<string> { return explicitBrowser().evaluate(expression); }
export async function browserConsole(): Promise<string> { return explicitBrowser().console(); }
export async function browserClose(): Promise<string> {
  const owner = sessionBrowser;
  sessionBrowser = null;
  sessionController?.abort(new Error("Browser session closed"));
  sessionController = null;
  return owner ? owner.dispose() : "Browser closed.";
}

/** CLI exit is the only intentionally broad browser cleanup boundary. */
export async function closeAllBrowserResources(): Promise<void> {
  const results = await Promise.allSettled([...liveResources].map((resource) => resource.dispose()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, "Browser exit cleanup failed");
}

export function isBrowserOpen(): boolean {
  return sessionBrowser?.isOpen() ?? false;
}
