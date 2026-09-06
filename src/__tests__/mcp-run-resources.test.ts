import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createMCPRunResources } from "../mcp-client.js";

const fixture = fileURLToPath(new URL("./fixtures/mcp-jsonrpc-server.mjs", import.meta.url));
const config = (mode = "normal") => ({ command: process.execPath, args: [fixture, mode] });

describe("run-owned MCP resources", () => {
  it("lazily starts the registered configuration within its own run", async () => {
    const abort = new AbortController();
    const resources = createMCPRunResources({ runId: "lazy", workspace: process.cwd(), signal: abort.signal, terminationGraceMs: 50 });
    resources.register({ fixture: config() });
    expect(resources.hasServers()).toBe(false);
    await Promise.all([resources.ensureStarted(), resources.ensureStarted()]);
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
    const pendingCall = callRun.callTool("hang", "ping", {});
    callAbort.abort(new Error("cancelled by test"));
    await expect(pendingCall).rejects.toThrow("cancelled by test");
    await expect(callRun.close()).resolves.toBeUndefined();

    const startupAbort = new AbortController();
    const startupRun = createMCPRunResources({ runId: "startup", workspace: process.cwd(), signal: startupAbort.signal, startupTimeoutMs: 5_000, terminationGraceMs: 50 });
    const pendingStart = startupRun.startServer("partial", config("hang-initialize"));
    startupAbort.abort(new Error("startup cancelled by test"));
    await expect(pendingStart).rejects.toThrow("startup cancelled by test");
    await expect(startupRun.close()).resolves.toBeUndefined();
    expect(startupRun.hasServers()).toBe(false);
  });

  it("does not spawn a subprocess when the run was already aborted", async () => {
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const resources = createMCPRunResources({ runId: "pre-aborted", workspace: process.cwd(), signal: abort.signal });
    await expect(resources.startServer("never", config())).rejects.toThrow("already cancelled");
    await resources.close();
  });
});
