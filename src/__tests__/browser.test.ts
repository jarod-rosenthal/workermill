import { EventEmitter } from "events";
import { mkdir, readdir, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserRunResources } from "../browser.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(_url: string) { queueMicrotask(() => this.onopen?.()); }
  send(raw: string): void {
    const request = JSON.parse(raw) as { id: number; method: string };
    if (request.method === "Runtime.evaluate") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: { result: { value: "title" } } }) }));
    else if (request.method === "Page.captureScreenshot") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: { data: "image" } }) }));
    else queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: {} }) }));
  }
  close(): void { this.readyState = 3; this.onclose?.(); }
}

const originalWebSocket = globalThis.WebSocket;
const roots: string[] = [];
afterEach(async () => { globalThis.WebSocket = originalWebSocket; await Promise.all(roots.splice(0).map(async (root) => { try { await import("fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true })); } catch { /* test cleanup */ } })); });

async function fixture(signal = new AbortController().signal, options: { startupTimeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const root = path.join(tmpdir(), `workermill-browser-test-${crypto.randomUUID()}`); roots.push(root); await mkdir(root);
  let child: EventEmitter & { pid: number; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };
  const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
    const profile = args.find((arg) => arg.startsWith("--user-data-dir="))!.slice("--user-data-dir=".length);
    child = Object.assign(new EventEmitter(), { pid: 999_999, stderr: new EventEmitter(), kill: vi.fn(() => child.emit("exit", 0)) });
    void writeFile(path.join(profile, "DevToolsActivePort"), "9333\n/devtools/browser/owned\n");
    return child as unknown as ReturnType<typeof import("child_process").spawn>;
  });
  const fetchImpl = options.fetchImpl ?? vi.fn(async () => new Response(JSON.stringify([{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/owned" }]), { status: 200 }));
  const browser = createBrowserRunResources({ runId: crypto.randomUUID(), workspace: root, signal, chromePath: "/fake/chrome", profileRoot: root, spawnProcess, fetchImpl, startupTimeoutMs: options.startupTimeoutMs ?? 500, terminationGraceMs: 10 });
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

  it("cancels startup after a process has started and removes its profile", async () => {
    const controller = new AbortController();
    const { browser, root, getChild } = await fixture(controller.signal, { fetchImpl: vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch });
    const opening = browser.open();
    await vi.waitFor(() => expect(getChild()).toBeDefined());
    controller.abort(new Error("cancelled"));
    await expect(opening).resolves.toContain("cancelled");
    expect(getChild().kill).toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("fails bounded startup without attaching to an arbitrary port", async () => {
    const { browser, fetchImpl, getChild } = await fixture(new AbortController().signal, { fetchImpl: vi.fn(async () => new Response("[]", { status: 200 })) as typeof fetch, startupTimeoutMs: 100 });
    await expect(browser.open()).resolves.toContain("Failed to start Chrome");
    expect(fetchImpl).toHaveBeenCalled(); expect(getChild().kill).toHaveBeenCalled();
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
    expect(getChild().kill).toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it("does not expose a browser before its owner opens it", async () => {
    const { browser } = await fixture();
    await expect(browser.navigate("https://example.test")).resolves.toContain("Browser not open");
    expect(browser.isOpen()).toBe(false);
  });
});
