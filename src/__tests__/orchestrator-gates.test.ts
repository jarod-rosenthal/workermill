import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../engine/tools/lsp.js", () => ({
  loadTsconfigExcludes: vi.fn(() => []),
  execute: vi.fn(),
}));

const mockRunGate = vi.fn();
vi.mock("../gate-runner.js", () => ({
  runGate: (...args: unknown[]) => mockRunGate(...args),
}));

import { runPostExecutionQualityGates } from "../orchestrator/gates.js";
import type { OrchestrationOutput, Story } from "../orchestrator/types.js";

function createOutput(): OrchestrationOutput {
  return {
    log: vi.fn(),
    coordinatorLog: vi.fn(),
    error: vi.fn(),
    status: vi.fn(),
    statusDone: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    toolCall: vi.fn(),
  };
}

describe("runPostExecutionQualityGates", () => {
  beforeEach(() => {
    mockRunGate.mockReset();
  });

  it("returns blocking required command failures separately from reviewer-context failures", async () => {
    const output = createOutput();
    const stories: Story[] = [
      {
        id: "stats",
        title: "Add wm stats",
        persona: "backend_developer",
        description: "Build the stats command.",
        requiredCommands: ["npm run build"],
        verificationCommands: ["npm test -- stats"],
      },
    ];

    mockRunGate
      .mockResolvedValueOnce({ name: "required: Add wm stats", passed: false, output: "build failed" })
      .mockResolvedValueOnce({ name: "verify: Add wm stats", passed: false, output: "test failed" });

    const result = await runPostExecutionQualityGates({
      config: { providers: {}, default: "ollama", review: { verifyEnabled: true } },
      stories,
      completedStoryIds: ["stats"],
      workingDir: process.cwd(),
      output,
      getStoryDefinitionOfDone: (story) => ({
        requiredFiles: [],
        requiredTests: [],
        requiredCommands: story.requiredCommands ?? [],
      }),
    });

    expect(mockRunGate).toHaveBeenCalledTimes(2);
    expect(result.requiredFailures).toEqual([
      expect.objectContaining({ name: "required: Add wm stats", passed: false }),
    ]);
    expect(result.gateResultsSection).toContain("## Quality Gate Results — 2 FAILED");
    expect(result.gateResultsSection).toContain("required: Add wm stats");
    expect(result.gateResultsSection).toContain("verify: Add wm stats");
  });

  it("returns an all-passed summary when no gates fail", async () => {
    const output = createOutput();
    const stories: Story[] = [
      {
        id: "stats",
        title: "Add wm stats",
        persona: "backend_developer",
        description: "Build the stats command.",
        verificationCommands: ["npm test -- stats"],
      },
    ];

    mockRunGate.mockResolvedValueOnce({ name: "verify: Add wm stats", passed: true, output: "" });

    const result = await runPostExecutionQualityGates({
      config: { providers: {}, default: "ollama", review: { verifyEnabled: true } },
      stories,
      completedStoryIds: ["stats"],
      workingDir: process.cwd(),
      output,
      getStoryDefinitionOfDone: () => ({
        requiredFiles: [],
        requiredTests: [],
        requiredCommands: [],
      }),
    });

    expect(result.requiredFailures).toEqual([]);
    expect(result.gateResultsSection).toContain("## Quality Gate Results — ALL PASSED");
    expect(result.gateResultsSection).toContain("verify: Add wm stats");
  });

  it("threads the active run cancellation and ID to required commands", async () => {
    const output = createOutput();
    const controller = new AbortController();
    mockRunGate.mockResolvedValue({ name: "required: Build", passed: false, output: "Command cancelled" });

    const result = await runPostExecutionQualityGates({
      config: { providers: {}, default: "ollama" },
      stories: [{ id: "build", title: "Build", persona: "backend_developer", description: "Build", requiredCommands: ["npm run build"] }],
      completedStoryIds: ["build"],
      workingDir: process.cwd(),
      output,
      abortSignal: controller.signal,
      runId: "run-r08",
      getStoryDefinitionOfDone: (story) => ({ requiredFiles: [], requiredTests: [], requiredCommands: story.requiredCommands ?? [] }),
    });

    expect(mockRunGate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "required: Build" }),
      process.cwd(),
      expect.objectContaining({ signal: controller.signal, runId: "run-r08" }),
    );
    expect(result.requiredFailures).toHaveLength(1);
  });
});
