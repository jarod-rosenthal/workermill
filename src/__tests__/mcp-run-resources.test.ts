import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMCPRunResources } from "../mcp-client.js";

const fixture = fileURLToPath(new URL("./fixtures/mcp-jsonrpc-server.mjs", import.meta.url));
const config = (mode = "normal", marker?: string) => ({
  command: process.execPath,
  args: marker ? [fixture, mode, marker] : [fixture, mode],
});

describe("run-owned MCP resources", () => {
  it("lazily starts the registered configuration within its own run", async () => {
    const abort = new AbortController();
    const resources = createMCPRunResources({ runId: "lazy", workspace: process.cwd(), signal: abort.signal, terminationGraceMs: 50 });
    resources.register({ fixture: config() });
    expect(resources.hasServers()).toBe(false);
    const firstEnsure = resources.ensureStarted();
    const secondEnsure = resources.ensureStarted();
    await firstEnsure;
    expect(resources.getTools()).toHaveLength(1);
    await secondEnsure;
    expect(resources.getTools()).toHaveLength(1);
    await expect(resources.callTool("fixture", "ping", {})).resolves.toMatch(/:pong$/);
    await resources.close();
  });

  it("keeps equal server names isolated and closing one run does not close the other", async () => {
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = createMCPRunResources({ runId: "first", workspace: process.cwd(), signal: firstAbort.signal, terminationGraceMs: 50 });
    const second = createMCPRunResources({ runId: "second", workspace: process.cwd(), signal: secondAbort.signal, terminationGraceMs: 50 });

    await Promise.all([first.startServer("shared", config()), second.startServer("shared", config())]);
    await first.close();

    await expect(second.callTool("shared", "ping", {})).resolves.toMatch(/:pong$/);
    await second.close();
  });

  it("settles a pending stdio request and startup when the owned run aborts", async () => {
    const callAbort = new AbortController();
    const callRun = createMCPRunResources({ runId: "call", workspace: process.cwd(), signal: callAbort.signal, terminationGraceMs: 50 });
    await callRun.startServer("hang", config("hang-call"));
    const perCallAbort = new AbortController();
    const pendingCall = callRun.callTool("hang", "ping", {}, perCallAbort.signal);
    callAbort.abort(new Error("cancelled by test"));
    await expect(pendingCall).rejects.toThrow("cancelled by test");
    await expect(callRun.close()).resolves.toBeUndefined();

    const startupAbort = new AbortController();
    const startupRun = createMCPRunResources({ runId: "startup", workspace: process.cwd(), signal: startupAbort.signal, startupTimeoutMs: 5_000, terminationGraceMs: 50 });
    const pendingStart = startupRun.startServer("partial", config("hang-initialize"));
    await expect(startupRun.close()).resolves.toBeUndefined();
    expect(startupAbort.signal.aborted).toBe(false);
    await expect(pendingStart).rejects.toThrow("MCP run startup closed");
    expect(startupRun.hasServers()).toBe(false);
  });

  it("does not spawn a subprocess when the run was already aborted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wm-mcp-preabort-"));
    const marker = join(directory, "spawned");
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const resources = createMCPRunResources({ runId: "pre-aborted", workspace: process.cwd(), signal: abort.signal });
    await expect(resources.startServer("never", config("write-marker", marker))).rejects.toThrow("already cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(marker)).toBe(false);
    await resources.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("bounds oversized stdio responses", async () => {
    const abort = new AbortController();
    const resources = createMCPRunResources({
      runId: "oversized",
      workspace: process.cwd(),
      signal: abort.signal,
      maxResponseBytes: 128,
      terminationGraceMs: 50,
    });
    await resources.startServer("fixture", config("oversized-response"));
    await expect(resources.callTool("fixture", "ping", {})).rejects.toThrow("response buffer exceeded 128 bytes");
    await resources.close();
  });

  it("reaches an exited parent through owned state and kills its descendant", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wm-mcp-orphan-"));
    const marker = join(directory, "late-marker");
    const abort = new AbortController();
    const resources = createMCPRunResources({
      runId: "orphan",
      workspace: process.cwd(),
      signal: abort.signal,
      requestTimeoutMs: 5_000,
      terminationGraceMs: 50,
    });
    await resources.startServer("fixture", config("orphan-after-start", marker));
    const pending = resources.callTool("fixture", "ping", {});
    const pendingResult = expect(pending).rejects.toThrow();
    await expect(resources.close()).resolves.toBeUndefined();
    await pendingResult;
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(existsSync(marker)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });
});
