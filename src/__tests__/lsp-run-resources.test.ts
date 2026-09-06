import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPathScope } from "../engine/path-policy.js";
import type { ToolExecutionContext } from "../engine/tool-executor.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import * as lspTool from "../engine/tools/lsp.js";
import { createLSPRunResources, shutdownLSPRun, type LSPRunResources } from "../engine/tools/lsp.js";

const fixture = fileURLToPath(new URL("./fixtures/lsp-jsonrpc-server.mjs", import.meta.url));
const directories: string[] = [];
const resourceCleanups: LSPRunResources[] = [];

async function workspace(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  await writeFile(join(directory, "sample.ts"), "export const sample = 1;\n");
  return directory;
}

async function waitForFile(filePath: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for fixture readiness: ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() >= deadline) throw new Error(`Fixture descendant ${pid} remained alive after teardown`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function resources(runId: string, directory: string, signal: AbortSignal, mode = "normal", marker?: string) {
  const resource = createLSPRunResources({
    runId,
    workspace: directory,
    signal,
    startupTimeoutMs: 2_000,
    requestTimeoutMs: 2_000,
    terminationGraceMs: 50,
    server: {
      language: "typescript",
      command: process.execPath,
      args: marker ? [fixture, mode, marker] : [fixture, mode],
    },
  });
  resourceCleanups.push(resource);
  return resource;
}

function context(runId: string, directory: string, signal: AbortSignal): ToolExecutionContext {
  const scope = createPathScope(directory);
  return {
    runId,
    workspace: scope.workspace,
    scope,
    effectiveSandbox: "path",
    signal,
    getPermissionState: () => ({ mode: "default", trustAll: false, sessionAllow: new Set(), rules: {}, readOnlyRole: false, workspace: scope.workspace }),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(resourceCleanups.splice(0).map((resource) => resource.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("run-owned LSP resources", () => {
  it("acquires registry resources lazily and never gives a child a supplied parent resource", async () => {
    const parentDirectory = await workspace("wm-lsp-registry-parent-");
    const childDirectory = await workspace("wm-lsp-registry-child-");
    const parentAbort = new AbortController();
    const childAbort = new AbortController();
    const parent = resources("parent", parentDirectory, parentAbort.signal);
    const childContext = context("child", childDirectory, childAbort.signal);
    const originalCreate = lspTool.createLSPRunResources;
    const create = vi.spyOn(lspTool, "createLSPRunResources").mockImplementation((options) => {
      const resource = originalCreate({
        ...options,
        server: { language: "typescript", command: process.execPath, args: [fixture] },
        terminationGraceMs: 50,
      });
      resourceCleanups.push(resource);
      return resource;
    });

    const definitions = createToolDefinitions(childDirectory, undefined, true, {
      executionContext: childContext,
      lspResources: parent,
    }) as Record<string, { execute: (input: { action: "symbols"; file: string }) => Promise<string> }>;
    expect(create).not.toHaveBeenCalled();

    await expect(definitions.lsp.execute({ action: "symbols", file: "sample.ts" })).resolves.toContain("fixtureSymbol");
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[0]).toMatchObject({ runId: "child", workspace: childContext.scope.workspace, signal: childAbort.signal });
    expect(parent.isRunning()).toBe(false);
    await shutdownLSPRun("child");
  });

  it("keeps matching language servers isolated across runs and workspaces", async () => {
    const firstDirectory = await workspace("wm-lsp-first-");
    const secondDirectory = await workspace("wm-lsp-second-");
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const first = resources("first", firstDirectory, firstAbort.signal);
    const second = resources("second", secondDirectory, secondAbort.signal);

    await expect(first.execute({ action: "symbols", file: join(firstDirectory, "sample.ts") })).resolves.toMatchObject({ success: true });
    await expect(second.execute({ action: "symbols", file: join(secondDirectory, "sample.ts") })).resolves.toMatchObject({ success: true });
    await shutdownLSPRun("first");
    await expect(second.execute({ action: "symbols", file: join(secondDirectory, "sample.ts") })).resolves.toMatchObject({ success: true });
    await second.close();
  });

  it("settles a started request and partial startup on close or abort", async () => {
    const callDirectory = await workspace("wm-lsp-call-");
    const callAbort = new AbortController();
    const callMarker = join(callDirectory, "call");
    const callRun = resources("call", callDirectory, callAbort.signal, "hang-request", callMarker);
    const pendingCall = callRun.execute({ action: "symbols", file: join(callDirectory, "sample.ts") });
    await waitForFile(`${callMarker}.request`);
    callAbort.abort(new Error("cancelled by test"));
    await expect(pendingCall).resolves.toMatchObject({ success: false, error: expect.stringContaining("cancelled by test") });
    await expect(callRun.close()).resolves.toBeUndefined();

    const startupDirectory = await workspace("wm-lsp-startup-");
    const startupAbort = new AbortController();
    const startupMarker = join(startupDirectory, "startup");
    const startupRun = resources("startup", startupDirectory, startupAbort.signal, "hang-initialize", startupMarker);
    const pendingStart = startupRun.execute({ action: "symbols", file: join(startupDirectory, "sample.ts") });
    await waitForFile(`${startupMarker}.initialize`);
    await expect(startupRun.close()).resolves.toBeUndefined();
    await expect(pendingStart).resolves.toMatchObject({ success: false, error: expect.stringContaining("LSP run startup closed") });
  });

  it("does not spawn when the owning run has already been aborted", async () => {
    const directory = await workspace("wm-lsp-preabort-");
    const marker = join(directory, "spawned");
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const run = resources("pre-aborted", directory, abort.signal, "write-marker", marker);
    await expect(run.execute({ action: "symbols", file: join(directory, "sample.ts") })).resolves.toMatchObject({ success: false });
    expect(existsSync(marker)).toBe(false);
    await run.close();
  });

  it("bounds an oversized response buffer", async () => {
    const directory = await workspace("wm-lsp-buffer-");
    const abort = new AbortController();
    const run = createLSPRunResources({
      runId: "buffer",
      workspace: directory,
      signal: abort.signal,
      maxResponseBytes: 128,
      terminationGraceMs: 50,
      server: { language: "typescript", command: process.execPath, args: [fixture, "oversized-response"] },
    });
    await expect(run.execute({ action: "symbols", file: join(directory, "sample.ts") })).resolves.toMatchObject({ success: false, error: expect.stringContaining("response buffer exceeded 128 bytes") });
    await run.close();
  });

  it("keeps an exited parent owned until its descendant process group is cleaned", async () => {
    const directory = await workspace("wm-lsp-orphan-");
    const marker = join(directory, "late-marker");
    const abort = new AbortController();
    const run = resources("orphan", directory, abort.signal, "orphan-after-ready", marker);
    const pending = run.execute({ action: "symbols", file: join(directory, "sample.ts") });
    await expect(pending).resolves.toMatchObject({ success: false });
    await waitForFile(marker);
    const childPid = Number(readFileSync(marker, "utf8"));
    expect(childPid).toBeGreaterThan(0);
    await expect(run.close()).resolves.toBeUndefined();
    await waitForProcessExit(childPid);
  });
});
