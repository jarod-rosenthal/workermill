import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runQualityGates } from "../orchestrator/gates.js";
import type { OrchestrationOutput } from "../orchestrator/types.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function output(): OrchestrationOutput {
  return {
    log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(),
    confirm: vi.fn(async () => true), toolCall: vi.fn(),
  };
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) throw new Error("required command did not start");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("orchestrator required-command cancellation", () => {
  it("cancels a started required command and returns before review", async () => {
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-r08-gate-"));
    tempDirs.push(workingDir);
    const marker = path.join(workingDir, "started");
    const controller = new AbortController();
    const command = `printf started > ${JSON.stringify(marker)}; sleep 30`;
    const promise = runQualityGates({
      config: { providers: {}, default: "ollama" },
      output: output(),
      sorted: [{ id: "gate", title: "Gate", persona: "backend_developer", description: "gate", requiredCommands: [command] }],
      completedStoryIds: ["gate"],
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      workingDir,
      abortSignal: controller.signal,
      runId: "run-r08-gate",
    });

    await waitForFile(marker);
    controller.abort();

    await expect(promise).resolves.toMatchObject({ earlyExit: true });
  });

  it("uses the effective OS scope for real post-story commands", async (test) => {
    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length) {
      const reason = status.errors.join(", ") || "unsupported platform";
      if (process.env.WM_REQUIRE_OS_SANDBOX === "1") throw new Error(reason);
      test.skip(reason);
      return;
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-os-"));
    tempDirs.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    const outside = path.join(root, "outside");
    const run = (command: string) => runQualityGates({
      // The runtime's effective mode must override this path-mode setting.
      config: { providers: {}, default: "ollama", sandbox: true },
      sandboxed: "os",
      output: output(),
      sorted: [{ id: "gate", title: "Gate", persona: "worker", description: "gate", requiredCommands: [command] }],
      completedStoryIds: ["gate"], context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      workingDir: workspace, runId: "gate-os",
    });
    const probe = await run("printf allowed > inside");
    if (probe.earlyExit && /unshare|operation not permitted|sandbox unavailable/i.test(probe.gateResultsSection) && process.env.WM_REQUIRE_OS_SANDBOX !== "1") {
      test.skip(`OS kernel unavailable: ${probe.gateResultsSection}`);
      return;
    }
    expect(probe.earlyExit).toBe(false);
    expect(fs.readFileSync(path.join(workspace, "inside"), "utf8")).toBe("allowed");
    const denied = await run(`printf forbidden > ${JSON.stringify(outside)}`);
    expect(denied.earlyExit).toBe(true);
    expect(fs.existsSync(outside)).toBe(false);
  }, 15_000);
});
