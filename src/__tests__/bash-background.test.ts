import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import * as background from "../engine/tools/bash-background.js";
import * as output from "../engine/tools/bash-output.js";
import * as kill from "../engine/tools/bash-kill.js";
import { execute as executeBash } from "../engine/tools/bash.js";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wm-background-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const shell of [...background.activeShells.values()]) await background.cleanupScopedBackgroundProcesses(shell.runId);
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("background shell process boundary", () => {
  it("keeps output and cancellation owned by the creating run", async () => {
    const result = await background.execute({ command: "sleep 30", cwd: temporaryDirectory(), runId: "run-a" });
    await expect(output.execute({ shellId: result.shellId, runId: "run-b" })).rejects.toThrow("not found");
    await expect(kill.execute({ shellId: result.shellId, runId: "run-b" })).resolves.toEqual({ killed: false });
    await background.cleanupScopedBackgroundProcesses("run-a");
    await expect(output.execute({ shellId: result.shellId, runId: "run-a", wait: true })).resolves.toMatchObject({ done: true, status: "killed" });
  });

  it("aborts output waits instead of polling forever", async () => {
    const result = await background.execute({ command: "sleep 30", cwd: temporaryDirectory(), runId: "wait-run" });
    const controller = new AbortController();
    const waiting = output.execute({ shellId: result.shellId, runId: "wait-run", wait: true, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toThrow("wait cancelled");
  });

  it("bounds retained background output", async () => {
    const result = await background.execute({ command: "yes x | head -c 200000", cwd: temporaryDirectory(), runId: "bounded-run" });
    const collected = await output.execute({ shellId: result.shellId, runId: "bounded-run", wait: true });
    expect(Buffer.byteLength(collected.output, "utf8")).toBeLessThanOrEqual(110 * 1024);
  });

  it("rejects background execution in explicit OS mode before launch", async () => {
    const tools = createToolDefinitions(temporaryDirectory(), undefined, "os", { runId: "os-background" }) as Record<string, { execute: (input: { command: string }) => Promise<string> }>;
    await expect(tools.bash_background.execute({ command: "printf should-not-run" })).resolves.toContain("not available with OS sandbox");
  });
});

describe("actual OS containment", () => {
  it("does not write an out-of-root sentinel", async (context) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length > 0) {
      const reason = status.errors.join(", ") || "unsupported host platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(`OS sandbox is required but unavailable: ${reason}`);
      context.skip(`OS sandbox unavailable: ${reason}`);
      return;
    }
    const workspace = temporaryDirectory();
    const sentinel = path.join(path.dirname(workspace), `wm-os-escape-${Date.now()}`);
    try {
      const result = await executeBash({ command: `printf escaped > ${sentinel}`, cwd: workspace, osSandbox: true, timeout: 5_000 });
      expect(result.success).toBe(false);
      expect(fs.existsSync(sentinel)).toBe(false);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
  });
});
