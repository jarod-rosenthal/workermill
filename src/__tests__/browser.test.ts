import { spawn as realSpawn } from "child_process";
import { EventEmitter } from "events";
import { writeFileSync } from "fs";
import { mkdir, readFile, readdir, symlink, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAllBrowserResources, createBrowserRunResources } from "../browser.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  static sent: string[] = [];
  constructor(_url: string) { queueMicrotask(() => this.onopen?.()); }
  send(raw: string): void {
    FakeWebSocket.sent.push(raw);
    const request = JSON.parse(raw) as { id: number; method: string };
    if (request.method === "Runtime.evaluate") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: { result: { value: "title" } } }) }));
    else if (request.method === "Page.captureScreenshot") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: { data: "image" } }) }));
    else queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: {} }) }));
  }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

const originalWebSocket = globalThis.WebSocket;
const roots: string[] = [];
afterEach(async () => { FakeWebSocket.sent = []; globalThis.WebSocket = originalWebSocket; await Promise.all(roots.splice(0).map(async (root) => { try { await import("fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })); } catch { /* test cleanup */ } })); });

async function fixture(signal = new AbortController().signal, options: { startupTimeoutMs?: number; fetchImpl?: typeof fetch; killProcess?: typeof process.kill } = {}) {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const root = path.join(tmpdir(), `workermill-browser-test-${crypto.randomUUID()}`); roots.push(root); await mkdir(root);
  let child: EventEmitter & { pid: number; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
    const profile = args.find((arg) => arg.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
    child = Object.assign(new EventEmitter(), { pid: 999_999, stderr: new EventEmitter(), kill: vi.fn(() => child.emit("exit", 0)) });
    // Publish the fake handshake before discovery starts. An async write can
    // lose the entire short startup window to the 100 ms discovery retry,
    // so the response/cancellation fixture would never be exercised.
    writeFileSync(path.join(profile, "DevToolsActivePort"), "9333\n/devtools/browser/owned\n");
    return child as unknown as ReturnType<typeof import("child_process").spawn>;
  });
  const fetchImpl = options.fetchImpl ?? vi.fn(async (url: string) => {
    if (url.endsWith("/json/version")) {
      return new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/owned" }), { status: 200 });
    }
    return new Response(JSON.stringify([{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/owned" }]), { status: 200 });
  });
  const browser = createBrowserRunResources({ runId: crypto.randomUUID(), workspace: root, signal, chromePath: "/fake/chrome", profileRoot: root, spawnProcess, fetchImpl, killProcess: options.killProcess, startupTimeoutMs: options.startupTimeoutMs ?? 500, terminationGraceMs: 10 });
  return { browser, root, spawnProcess, getChild: () => child!, fetchImpl };
}

describe("browser resources", () => {
  it("keeps two run owners separate and gives each a private profile", async () => {
    const first = await fixture(); const second = await fixture();
    await expect(first.browser.open()).resolves.toContain("private headless");
    await expect(second.browser.open()).resolves.toContain("private headless");
    expect(first.browser.isOpen()).toBe(true); expect(second.browser.isOpen()).toBe(true);
    const firstArgs = first.spawnProcess.mock.calls[0]![1] as string[];
    const secondArgs = second.spawnProcess.mock.calls[0]![1] as string[];
    expect(firstArgs.find((arg) => arg.startsWith("--remote-debugging-port="))).toBe("--remote-debugging-port=0");
    expect(firstArgs.find((arg) => arg.startsWith("--user-data-dir="))).not.toBe(secondArgs.find((arg) => arg.startsWith("--user-data-dir=")));
    await first.browser.close();
    expect(second.browser.isOpen()).toBe(true);
    await second.browser.close();
  });

  it("allows a model-owned browser to close and reopen within the same turn", async () => {
    const { browser, spawnProcess } = await fixture();
    await browser.open();
    await browser.close();
    await expect(browser.open()).resolves.toContain("private headless");
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    await browser.dispose();
  });

  it("cancels startup after a process has started and removes its profile", async () => {
    const controller = new AbortController();
    const { browser, root, getChild } = await fixture(controller.signal, {
      fetchImpl: vi.fn(async () => new Promise<Response>(() => undefined)) as typeof fetch,
    });
    const opening = browser.open();
    await vi.waitFor(() => expect(getChild()).toBeDefined());
    controller.abort(new Error("cancelled"));
    await expect(opening).resolves.toContain("cancelled");
    expect(await readdir(root)).toEqual([]);
  });

  it("fails bounded startup without attaching to an arbitrary port", async () => {
    const { browser, fetchImpl, getChild } = await fixture(new AbortController().signal, { fetchImpl: vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch, startupTimeoutMs: 500 });
    await expect(browser.open()).resolves.toContain("Failed to start Chrome");
    expect(fetchImpl).toHaveBeenCalled(); expect(getChild()).toBeDefined();
  });

  it("rejects a pending CDP request when close disconnects it", async () => {
    globalThis.WebSocket = class extends FakeWebSocket { override send(raw: string): void { const request = JSON.parse(raw) as { method: string }; if (request.method !== "Runtime.evaluate") super.send(raw); } } as unknown as typeof WebSocket;
    const { browser } = await fixture();
    // fixture installs its normal socket, replace it before open with a socket that leaves evaluate pending.
    globalThis.WebSocket = class extends FakeWebSocket { override send(raw: string): void { const request = JSON.parse(raw) as { method: string }; if (request.method !== "Runtime.evaluate") super.send(raw); } } as unknown as typeof WebSocket;
    await browser.open(); const pending = browser.evaluate("never"); await browser.close();
    await expect(pending).resolves.toContain("Browser closed");
  });

  it("still cleans the owned process group/profile after Chrome's parent exits", async () => {
    const { browser, root, getChild } = await fixture();
    await browser.open();
    getChild().emit("exit", 1);
    await browser.close();
    // Group signalling may fail once the parent has exited; the direct-child
    // fallback still runs, and only this exact private profile is removed.
    expect(await readdir(root)).toEqual([]);
  });

  it("does not expose a browser before its owner opens it", async () => {
    const { browser } = await fixture();
    await expect(browser.navigate("https://example.test")).resolves.toContain("Browser not open");
    expect(browser.isOpen()).toBe(false);
  });

  it("does not spawn when the owner was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before open"));
    const { browser, spawnProcess } = await fixture(controller.signal);
    await expect(browser.open()).resolves.toContain("cancelled");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("rejects a Windows executable rather than trying to manage it from WSL", async () => {
    const root = path.join(tmpdir(), `workermill-browser-windows-${crypto.randomUUID()}`);
    roots.push(root);
    await mkdir(root);
    const spawnProcess = vi.fn();
    const browser = createBrowserRunResources({
      runId: crypto.randomUUID(),
      workspace: root,
      signal: new AbortController().signal,
      chromePath: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
      profileRoot: root,
      spawnProcess,
    });
    const result = await browser.open();
    if (process.platform === "linux") {
      expect(result).toContain("Windows Chrome via WSL is unsupported");
      expect(spawnProcess).not.toHaveBeenCalled();
    }
    await browser.close();
  });

  it("CLI exit closes every run-owned browser without sharing ownership", async () => {
    const first = await fixture();
    const second = await fixture();
    await first.browser.open();
    await second.browser.open();
    await closeAllBrowserResources();
    expect(first.browser.isOpen()).toBe(false);
    expect(second.browser.isOpen()).toBe(false);
  });

  it("close during startup aborts and drains the opening attempt", async () => {
    const { browser, root, spawnProcess } = await fixture(new AbortController().signal, {
      fetchImpl: vi.fn(async () => new Promise<Response>(() => undefined)) as typeof fetch,
    });
    const opening = browser.open();
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    await expect(browser.close()).resolves.toBe("Browser closed.");
    await expect(opening).resolves.toContain("cancelled");
    expect(await readdir(root)).toEqual([]);
  });

  it("bounds slow/oversized discovery and rejects a non-private endpoint", async () => {
    const cancelled = vi.fn();
    const slow = await fixture(new AbortController().signal, {
      startupTimeoutMs: 100,
      fetchImpl: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode("{")); },
        cancel: cancelled,
      }))) as typeof fetch,
    });
    await expect(slow.browser.open()).resolves.toContain("Failed to start Chrome");
    expect(cancelled).toHaveBeenCalled();

    const oversizedCancelled = vi.fn();
    const oversized = await fixture(new AbortController().signal, {
      startupTimeoutMs: 100,
      fetchImpl: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
        cancel: oversizedCancelled,
      }))) as typeof fetch,
    });
    await expect(oversized.browser.open()).resolves.toContain("Failed to start Chrome");
    expect(oversizedCancelled).toHaveBeenCalled();

    const malicious = await fixture(new AbortController().signal, {
      fetchImpl: vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/json/version")
        ? { webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/owned" }
        : [{ type: "page", webSocketDebuggerUrl: "ws://attacker.test:9333/devtools/page/stolen" }]
      ), { status: 200 })) as typeof fetch,
    });
    await expect(malicious.browser.open()).resolves.toContain("private loopback");
  });

  it("bounds discovery cleanup when a response cancellation never settles", async () => {
    const cancelled = vi.fn(() => new Promise<void>(() => undefined));
    const stalled = await fixture(new AbortController().signal, {
      startupTimeoutMs: 100,
      fetchImpl: vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
        cancel: cancelled,
      }))) as typeof fetch,
    });
    const startedAt = Date.now();
    await expect(stalled.browser.open()).resolves.toContain("Failed to start Chrome");
    expect(cancelled).toHaveBeenCalled();
    expect(Date.now() - startedAt).toBeLessThan(300);
  });

  it("quotes selector-derived JavaScript literals", async () => {
    const { browser } = await fixture();
    await browser.open();
    const selector = "button['x']; globalThis.pwned=true; //";
    await browser.click(selector);
    const raw = FakeWebSocket.sent.find((entry) => JSON.parse(entry).method === "Runtime.evaluate") ?? "{}";
    const evaluate = JSON.parse(raw) as { params?: { expression?: string } };
    expect(evaluate.params?.expression).toContain(JSON.stringify(selector));
    await browser.close();
  });

  it("returns cleanup failures to the awaited owner", async () => {
    let denied = true;
    const { browser, root } = await fixture(new AbortController().signal, {
      killProcess: (() => { const error = new Error(denied ? "permission denied" : "already exited") as NodeJS.ErrnoException; error.code = denied ? "EPERM" : "ESRCH"; throw error; }) as typeof process.kill,
    });
    await browser.open();
    await expect(browser.close()).rejects.toThrow("Browser cleanup failed");
    expect(await readdir(root)).toHaveLength(1);
    denied = false;
    await expect(browser.dispose()).rejects.toThrow("Browser cleanup failed");
    expect(await readdir(root)).toEqual([]);
  });

  it("retains automatic abort cleanup failures for the awaited finalizer", async () => {
    const controller = new AbortController();
    let denied = true;
    const killProcess = vi.fn(() => {
      const error = new Error("fixture cleanup failure") as NodeJS.ErrnoException;
      error.code = denied ? "EPERM" : "ESRCH";
      throw error;
    });
    const { browser, root } = await fixture(controller.signal, { killProcess });
    await browser.open();
    controller.abort();
    await vi.waitFor(() => expect(killProcess).toHaveBeenCalled());
    await expect(browser.dispose()).rejects.toThrow("Browser cleanup failed");
    expect(await readdir(root)).toHaveLength(1);
    denied = false;
    await expect(browser.dispose()).rejects.toThrow("Browser cleanup failed");
    expect(await readdir(root)).toEqual([]);
  });

  it.skipIf(process.platform !== "linux")("rejects Linux symlinks to Windows Chrome", async () => {
    const root = path.join(tmpdir(), `workermill-browser-symlink-${crypto.randomUUID()}`);
    roots.push(root);
    await mkdir(root);
    await writeFile(path.join(root, "chrome.exe"), "fixture");
    await symlink(path.join(root, "chrome.exe"), path.join(root, "chrome"));
    const spawnProcess = vi.fn();
    const browser = createBrowserRunResources({ runId: crypto.randomUUID(), workspace: root,
      signal: new AbortController().signal, chromePath: path.join(root, "chrome"), spawnProcess });
    await expect(browser.open()).resolves.toContain("Windows Chrome via WSL is unsupported");
    expect(spawnProcess).not.toHaveBeenCalled();
    await browser.dispose();
  });

  it.skipIf(process.platform === "win32")("kills a TERM-ignoring descendant after its browser parent exits", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const root = path.join(tmpdir(), `workermill-browser-orphan-${crypto.randomUUID()}`);
    roots.push(root);
    await mkdir(root);
    const descendantScript = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
    const parentScript = [
      "const { spawn } = require('child_process');",
      "const fs = require('fs');",
      "const profile = process.argv[1];",
      `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
      "child.unref();",
      "fs.writeFileSync(profile + '/descendant.pid', String(child.pid));",
      "fs.writeFileSync(profile + '/DevToolsActivePort', '9333\\n/devtools/browser/owned\\n');",
    ].join("");
    const spawnProcess = (_command: string, args: readonly string[], spawnOptions: Parameters<typeof realSpawn>[2]) => {
      const profile = args.find((arg) => arg.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
      return realSpawn(process.execPath, ["-e", parentScript, profile], {
        ...spawnOptions,
        detached: true,
      });
    };
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/json/version")
      ? { webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/browser/owned" }
      : [{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/owned" }]
    ), { status: 200 })) as typeof fetch;
    const browser = createBrowserRunResources({
      runId: crypto.randomUUID(),
      workspace: root,
      signal: new AbortController().signal,
      chromePath: "/fake/chrome",
      profileRoot: root,
      spawnProcess,
      fetchImpl,
      terminationGraceMs: 1_000,
    });
    await expect(browser.open()).resolves.toContain("private headless");
    const [profile] = await readdir(root);
    const descendantPid = Number(await readFile(path.join(root, profile!, "descendant.pid"), "utf8"));
    await browser.close();
    expect(() => process.kill(descendantPid, 0)).toThrow();
  });
});
