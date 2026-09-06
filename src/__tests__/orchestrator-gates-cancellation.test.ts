import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runQualityGates } from "../orchestrator/gates.js";
import type { OrchestrationOutput } from "../orchestrator/types.js";

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
});
