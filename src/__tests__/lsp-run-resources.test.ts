import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLSPRunResources, shutdownLSPRun } from "../engine/tools/lsp.js";

const fixture = fileURLToPath(new URL("./fixtures/lsp-jsonrpc-server.mjs", import.meta.url));

async function workspace(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(directory, "sample.ts"), "export const sample = 1;\n");
  return directory;
}

function resources(runId: string, directory: string, signal: AbortSignal, mode = "normal", marker?: string) {
  return createLSPRunResources({
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
}

describe("run-owned LSP resources", () => {
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
    await Promise.all([rm(firstDirectory, { recursive: true, force: true }), rm(secondDirectory, { recursive: true, force: true })]);
  });

  it("settles a started request and partial startup on close or abort", async () => {
    const callDirectory = await workspace("wm-lsp-call-");
    const callAbort = new AbortController();
    const callRun = resources("call", callDirectory, callAbort.signal, "hang-request");
    const pendingCall = callRun.execute({ action: "symbols", file: join(callDirectory, "sample.ts") });
    await new Promise((resolve) => setTimeout(resolve, 100));
    callAbort.abort(new Error("cancelled by test"));
    await expect(pendingCall).resolves.toMatchObject({ success: false, error: expect.stringContaining("cancelled by test") });
    await expect(callRun.close()).resolves.toBeUndefined();

    const startupDirectory = await workspace("wm-lsp-startup-");
    const startupAbort = new AbortController();
    const startupRun = resources("startup", startupDirectory, startupAbort.signal, "hang-initialize");
    const pendingStart = startupRun.execute({ action: "symbols", file: join(startupDirectory, "sample.ts") });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(startupRun.close()).resolves.toBeUndefined();
    await expect(pendingStart).resolves.toMatchObject({ success: false, error: expect.stringContaining("LSP run startup closed") });
    await Promise.all([rm(callDirectory, { recursive: true, force: true }), rm(startupDirectory, { recursive: true, force: true })]);
  });

  it("does not spawn when the owning run has already been aborted", async () => {
    const directory = await workspace("wm-lsp-preabort-");
    const marker = join(directory, "spawned");
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const run = resources("pre-aborted", directory, abort.signal, "write-marker", marker);
    await expect(run.execute({ action: "symbols", file: join(directory, "sample.ts") })).resolves.toMatchObject({ success: false });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(marker)).toBe(false);
    await run.close();
    await rm(directory, { recursive: true, force: true });
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
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps an exited parent owned until its descendant process group is cleaned", async () => {
    const directory = await workspace("wm-lsp-orphan-");
    const marker = join(directory, "late-marker");
    const abort = new AbortController();
    const run = resources("orphan", directory, abort.signal, "orphan-after-ready", marker);
    const pending = run.execute({ action: "symbols", file: join(directory, "sample.ts") });
    await expect(pending).resolves.toMatchObject({ success: false });
    expect(existsSync(`${marker}.started`)).toBe(true);
    await expect(run.close()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(existsSync(marker)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });
});
