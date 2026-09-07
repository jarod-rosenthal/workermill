import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";
import { runGateCommand } from "../gate-runner.js";
import {
  createScopedCommandRunner,
  createToolDefinitions,
} from "../engine/tools/index.js";
import { createPathScope } from "../engine/path-policy.js";
import * as background from "../engine/tools/bash-background.js";
import * as output from "../engine/tools/bash-output.js";
import * as kill from "../engine/tools/bash-kill.js";

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
    // Retained capture is 100 KiB, plus up to two UTF-8 replacement bytes and
    // one newline plus the visible truncation marker at presentation time.
    const visibleLimit = background.BACKGROUND_OUTPUT_MAX_BYTES
      + 2
      + 1
      + Buffer.byteLength(background.BACKGROUND_OUTPUT_TRUNCATION_MARKER, "utf8");
    expect(Buffer.byteLength(collected.output, "utf8")).toBeLessThanOrEqual(visibleLimit);
    expect(collected.output).toContain("[output truncated: background output exceeded 100 KiB]");
  });

  it("does not launch an already-aborted background command", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = vi.fn(async () => ({
      reason: "exited" as const,
      exitCode: 0,
      stdout: "",
      stderr: "",
      outputTruncated: false,
    }));

    await expect(background.execute({
      command: "printf should-not-run",
      cwd: temporaryDirectory(),
      signal: controller.signal,
      runProcess: runner,
    })).rejects.toThrow("cancelled before start");
    expect(runner).not.toHaveBeenCalled();
  });

  it("settles a runner throw as a failed shell without an unhandled task", async () => {
    const result = await background.execute({
      command: "printf ignored",
      cwd: temporaryDirectory(),
      runId: "throwing-runner",
      runProcess: async () => { throw new Error("runner teardown failed"); },
    });

    const collected = await output.execute({ shellId: result.shellId, runId: "throwing-runner", wait: true });
    expect(collected).toMatchObject({ done: true, status: "failed_to_start" });
    expect(collected.output).toContain("runner teardown failed");
  });

  it("rejects background execution in explicit OS mode before launch", async () => {
    const tools = createToolDefinitions(temporaryDirectory(), undefined, "os", { runId: "os-background" }) as Record<string, { execute: (input: { command: string }) => Promise<string> }>;
    await expect(tools.bash_background.execute({ command: "printf should-not-run" })).resolves.toContain("not available with OS sandbox");
  });

  it("keeps two tool-factory background contexts independent", async () => {
    const workspace = temporaryDirectory();
    const controllerA = new AbortController();
    const controllerB = new AbortController();
    const toolsA = createToolDefinitions(workspace, undefined, false, {
      runId: "factory-run-a",
      signal: controllerA.signal,
    }) as Record<string, { execute: (input: Record<string, unknown>) => Promise<string> }>;
    const toolsB = createToolDefinitions(workspace, undefined, false, {
      runId: "factory-run-b",
      signal: controllerB.signal,
    }) as Record<string, { execute: (input: Record<string, unknown>) => Promise<string> }>;
    const startedA = await toolsA.bash_background.execute({ command: "sleep 30" });
    const startedB = await toolsB.bash_background.execute({ command: "sleep 30" });
    const shellA = startedA.match(/Shell started: (wm_shell_[a-f0-9]+)/)?.[1];
    const shellB = startedB.match(/Shell started: (wm_shell_[a-f0-9]+)/)?.[1];
    expect(shellA).toBeTruthy();
    expect(shellB).toBeTruthy();

    controllerA.abort();
    await output.execute({ shellId: shellA!, runId: "factory-run-a", wait: true });
    const outputB = await toolsB.bash_output.execute({ shellId: shellB! });
    expect(outputB).toContain("Process running");
    expect(background.activeShells.get(shellB!)?.done).toBe(false);
  });
});

describe("actual OS containment", () => {
  it("keeps registered bash, verify, and gate runners inside the workspace", async (context) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length > 0) {
      const reason = status.errors.join(", ") || "unsupported host platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(`OS sandbox is required but unavailable: ${reason}`);
      context.skip(`OS sandbox unavailable: ${reason}`);
      return;
    }
    const workspace = temporaryDirectory();
    const token = Date.now();
    const sentinel = (name: string) => path.join(path.dirname(workspace), `wm-os-escape-${name}-${token}`);
    const tools = createToolDefinitions(workspace, undefined, "os", { runId: "containment-tools" }) as Record<string, { execute: (input: { command: string }) => Promise<string> }>;
    const gateRunner = createScopedCommandRunner({
      sandbox: "os",
      scope: createPathScope(workspace),
    });
    try {
      const bashAllowed = await tools.bash.execute({ command: "printf bash-ok > bash-allowed" });
      if (bashAllowed.startsWith("Error:") && /operation not permitted|unshare|unsupported/i.test(bashAllowed)) {
        if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(`OS sandbox is required but kernel setup failed: ${bashAllowed}`);
        context.skip(`OS sandbox kernel unavailable: ${bashAllowed}`);
        return;
      }
      expect(bashAllowed).not.toContain("Error:");
      expect(fs.readFileSync(path.join(workspace, "bash-allowed"), "utf8")).toBe("bash-ok");

      expect(await tools.bash.execute({ command: `printf escaped > ${sentinel("bash")}` })).toContain("Error:");
      expect(fs.existsSync(sentinel("bash"))).toBe(false);

      expect(await tools.verify.execute({ command: "printf verify-ok > verify-allowed" })).toContain("PASSED");
      expect(fs.readFileSync(path.join(workspace, "verify-allowed"), "utf8")).toBe("verify-ok");
      expect(await tools.verify.execute({ command: `printf escaped > ${sentinel("verify")}` })).toContain("Result: FAILED");
      expect(fs.existsSync(sentinel("verify"))).toBe(false);

      await expect(runGateCommand("printf gate-ok > gate-allowed", workspace, { runId: "containment-gate", runProcess: gateRunner })).resolves.toBeDefined();
      expect(fs.readFileSync(path.join(workspace, "gate-allowed"), "utf8")).toBe("gate-ok");
      await expect(runGateCommand(`printf escaped > ${sentinel("gate")}`, workspace, { runId: "containment-gate", runProcess: gateRunner })).rejects.toThrow();
      expect(fs.existsSync(sentinel("gate"))).toBe(false);
    } finally {
      for (const name of ["bash", "verify", "gate"]) fs.rmSync(sentinel(name), { force: true });
    }
  });
});
