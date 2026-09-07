import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../engine/tools/lsp.js", () => {
  const execute = vi.fn();
  return {
    loadTsconfigExcludes: vi.fn(() => []), execute,
    createLSPRunResources: () => ({ execute, close: vi.fn(async () => {}) }),
    shutdownLSPRun: vi.fn(async () => {}),
  };
});

const mockRunGate = vi.fn();
vi.mock("../gate-runner.js", () => ({
  runGate: (...args: unknown[]) => mockRunGate(...args),
}));

import { runPostExecutionQualityGates, runQualityGates } from "../orchestrator/gates.js";
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
      expect.objectContaining({ id: "required:stats:0", source: "required_command", required: true, status: "failed" }),
    ]);
    expect(result.gateResultsSection).toContain("## Quality Gate Results — 2 FAILED");
    expect(result.gateResultsSection).toContain("required: Add wm stats");
    expect(result.gateResultsSection).toContain("verify: Add wm stats");
    expect(result.blockingFailures).toEqual([
      expect.objectContaining({ id: "required:stats:0" }),
    ]);
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
    expect(result.requiredFailures[0]).toMatchObject({ status: "failed", required: true });
  });

  it("defaults static gates to required and allows an explicit advisory opt-out", async () => {
    const output = createOutput();
    const stories: Story[] = [{ id: "story", title: "Story", persona: "backend_developer", description: "work" }];
    mockRunGate
      .mockResolvedValueOnce({ name: "default required", passed: false, output: "failed" })
      .mockResolvedValueOnce({ name: "explicit advisory", passed: false, output: "failed" });

    const result = await runPostExecutionQualityGates({
      config: {
        providers: {}, default: "ollama",
        qualityGates: [
          { name: "default required", commands: ["false"] },
          { name: "explicit advisory", commands: ["false"], required: false },
        ],
      },
      stories,
      completedStoryIds: ["story"],
      workingDir: process.cwd(),
      output,
      getStoryDefinitionOfDone: () => ({ requiredFiles: [], requiredTests: [], requiredCommands: [] }),
    });

    expect(result.gateResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "static:0", source: "static", required: true, status: "failed" }),
      expect.objectContaining({ id: "static:1", source: "static", required: false, status: "failed" }),
    ]));
    expect(result.blockingFailures).toEqual([expect.objectContaining({ id: "static:0" })]);
  });

  it("uses stable identities when same-title gates have different policy", async () => {
    const output = createOutput();
    const stories: Story[] = [
      { id: "required-story", title: "Duplicate title", persona: "backend_developer", description: "work", requiredCommands: ["false"] },
      { id: "planner-story", title: "Duplicate title", persona: "backend_developer", description: "work", verificationCommands: ["false"] },
    ];
    mockRunGate
      .mockResolvedValueOnce({ name: "required: Duplicate title", passed: false, output: "required failed" })
      .mockResolvedValueOnce({ name: "verify: Duplicate title", passed: false, output: "planner failed" });

    const result = await runPostExecutionQualityGates({
      config: { providers: {}, default: "ollama", review: { verifyEnabled: true } },
      stories,
      completedStoryIds: ["required-story", "planner-story"],
      workingDir: process.cwd(),
      output,
      getStoryDefinitionOfDone: (story) => ({ requiredFiles: [], requiredTests: [], requiredCommands: story.requiredCommands ?? [] }),
    });

    expect(result.gateResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "required:required-story:0", required: true, source: "required_command" }),
      expect.objectContaining({ id: "planner:planner-story:0", required: false, source: "planner_verification" }),
    ]));
    expect(result.blockingFailures).toEqual([expect.objectContaining({ id: "required:required-story:0" })]);
  });

  it("runs gate groups in order and strict mode promotes planner verification failures", async () => {
    const output = createOutput();
    const order: string[] = [];
    mockRunGate.mockImplementation(async (gate: { name: string }) => {
      order.push(gate.name);
      return { name: gate.name, passed: gate.name !== "verify: Story", output: "failed" };
    });

    const result = await runPostExecutionQualityGates({
      config: {
        providers: {}, default: "ollama", review: { strict: true },
        qualityGates: [{ name: "static", commands: ["true"], required: false }],
      },
      stories: [{ id: "story", title: "Story", persona: "backend_developer", description: "work", verificationCommands: ["false"] }],
      completedStoryIds: ["story"],
      workingDir: process.cwd(),
      output,
      getStoryDefinitionOfDone: () => ({ requiredFiles: [], requiredTests: [], requiredCommands: [] }),
    });

    expect(order).toEqual(["static", "verify: Story"]);
    expect(result.blockingFailures).toEqual([expect.objectContaining({ id: "planner:story:0" })]);
  });

  it("reports an already-aborted helper run as cancelled instead of all passed", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPostExecutionQualityGates({
      config: { providers: {}, default: "ollama", qualityGates: [{ name: "static", commands: ["true"] }] },
      stories: [{ id: "story", title: "Story", persona: "backend_developer", description: "work" }],
      completedStoryIds: ["story"],
      workingDir: process.cwd(),
      output: createOutput(),
      abortSignal: controller.signal,
      getStoryDefinitionOfDone: () => ({ requiredFiles: [], requiredTests: [], requiredCommands: [] }),
    });

    expect(mockRunGate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cancelled: true, gateResults: [], gateResultsSection: "Quality gates cancelled." });
  });

  it("cancels a stale passing result and does not start the next gate", async () => {
    const controller = new AbortController();
    mockRunGate.mockImplementationOnce(async (gate: { name: string }) => {
      controller.abort();
      return { name: gate.name, passed: true, status: "passed", output: "" };
    });
    const result = await runPostExecutionQualityGates({
      config: {
        providers: {}, default: "ollama",
        qualityGates: [{ name: "first", commands: ["true"] }, { name: "later", commands: ["true"] }],
      },
      stories: [{ id: "story", title: "Story", persona: "backend_developer", description: "work" }],
      completedStoryIds: ["story"],
      workingDir: process.cwd(),
      output: createOutput(),
      abortSignal: controller.signal,
      getStoryDefinitionOfDone: () => ({ requiredFiles: [], requiredTests: [], requiredCommands: [] }),
    });

    expect(mockRunGate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ cancelled: true });
    expect(result.gateResults).toEqual([expect.objectContaining({ id: "static:0", status: "cancelled", passed: false })]);
  });

  it("returns an early exit when cancellation follows the final passing gate", async () => {
    const controller = new AbortController();
    mockRunGate.mockImplementationOnce(async (gate: { name: string }) => {
      controller.abort();
      return { name: gate.name, passed: true, status: "passed", output: "" };
    });
    const result = await runQualityGates({
      config: { providers: {}, default: "ollama", qualityGates: [{ name: "only", commands: ["true"] }] },
      output: createOutput(),
      sorted: [{ id: "story", title: "Story", persona: "backend_developer", description: "work" }],
      completedStoryIds: ["story"],
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      workingDir: process.cwd(),
      abortSignal: controller.signal,
    });

    expect(result).toMatchObject({ earlyExit: true, cancelled: true });
    expect(result.gateResults).toEqual([expect.objectContaining({ id: "static:0", status: "cancelled", passed: false })]);
  });
});
