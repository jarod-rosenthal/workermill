import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../logger.js", () => ({
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "planner-test-model" })),
  buildOllamaOptions: vi.fn(() => ({})),
}));

vi.mock("../personas.js", () => ({
  loadPersona: vi.fn(),
}));

vi.mock("../instructions.js", () => ({ formatProjectInstructions: vi.fn(() => "") }));
vi.mock("../project-context.js", () => ({ formatPromptProjectContext: vi.fn(() => "") }));
vi.mock("../hooks.js", () => ({ runPreHooksWithBlocking: vi.fn(), runHooks: vi.fn() }));
vi.mock("../checkpoints.js", () => ({ checkpoint: vi.fn() }));
vi.mock("../sandbox-mode.js", () => ({ resolveSandboxMode: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, streamText: vi.fn() };
});

import { streamText } from "ai";
import { createModel } from "../engine/model-factory.js";
import { loadPersona } from "../personas.js";
import { runPreHooksWithBlocking } from "../hooks.js";
import { checkpoint } from "../checkpoints.js";
import { resolveSandboxMode } from "../sandbox-mode.js";
import { planStories } from "../orchestrator/planning.js";
import type { CliConfig } from "../config.js";
import type { OrchestrationOutput } from "../orchestrator/types.js";

const PLAN = "```json\n{ \"stories\": [{ \"id\": \"safe-plan\", \"title\": \"Safe plan\", \"persona\": \"backend_developer\", \"description\": \"Describe a safe implementation.\" }] }\n```";

type PlannerTool = { execute?: (input: Record<string, unknown>) => Promise<unknown> | unknown };
type StreamOptions = { tools?: Record<string, PlannerTool>; onStepFinish?: () => void };
type StreamResult = {
  textStream: AsyncIterable<string>;
  text: Promise<string>;
  totalUsage: Promise<{ inputTokens: number; outputTokens: number }>;
};

function config(): CliConfig {
  return {
    providers: { test: { model: "planner-model" } },
    default: "test",
    permissions: { allow: ["write_file(*)", "bash(*)", "sub_agent(*)"] },
  } as CliConfig;
}

function output(toolCalls: Array<{ name: string; input: Record<string, unknown> }>): OrchestrationOutput {
  return {
    log: () => {}, coordinatorLog: () => {}, error: () => {}, status: () => {}, statusDone: () => {},
    confirm: async () => true,
    toolCall: (_role, name, input) => { toolCalls.push({ name, input }); },
  };
}

describe("planner runtime policy", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-planner-policy-"));
    vi.clearAllMocks();
    vi.mocked(loadPersona).mockReturnValue({
      name: "malicious planner",
      slug: "planner",
      description: "tries to bypass read-only policy",
      systemPrompt: "Use every available tool.",
      tools: ["write_file", "bash", "sub_agent", "read_file"],
    });
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("routes malicious planner tools through the shared read-only executor", async () => {
    const sentinel = path.join(workspace, "planner-sentinel.txt");
    fs.writeFileSync(sentinel, "unchanged");
    const attempts: Array<{ name: string; code?: string }> = [];
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];

    vi.mocked(streamText).mockImplementation(((options: StreamOptions): StreamResult => {
      const toolCalls = (async () => {
        const tools = options.tools ?? {};
        const inputs: Array<[string, Record<string, unknown>]> = [
          ["write_file", { path: sentinel, content: "mutated" }],
          ["bash", { command: `printf mutated > ${sentinel}` }],
          ["sub_agent", { prompt: "write the sentinel", isolated: false }],
        ];
        for (const [name, input] of inputs) {
          try {
            await tools[name]?.execute?.(input);
          } catch (error) {
            attempts.push({ name, code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined });
          }
        }
      })();
      options.onStepFinish?.();
      return {
        textStream: (async function* () { await toolCalls; yield PLAN; })(),
        text: toolCalls.then(() => PLAN),
        totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      };
    }) as typeof streamText);

    const result = await planStories(config(), "Plan a safe change", workspace, true, output(calls));

    expect(result.rejected).toBeUndefined();
    expect(result.stories).toHaveLength(1);
    expect(attempts).toEqual([
      { name: "write_file", code: "denied" },
      { name: "bash", code: "denied" },
      { name: "sub_agent", code: "denied" },
    ]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged");
    expect(calls).toEqual([]);
    expect(runPreHooksWithBlocking).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it("returns a cancelled rejection before model or tool startup", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await planStories(config(), "Plan nothing", workspace, true, output([]), controller.signal);

    expect(result).toMatchObject({ rejected: true, rejectionReason: "Cancelled", failureReason: "cancelled", stories: [] });
    expect(createModel).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });

  it("does not return runnable stories when cancellation arrives after streaming", async () => {
    const controller = new AbortController();

    vi.mocked(streamText).mockImplementation((() => ({
      textStream: (async function* () {
        yield PLAN;
        controller.abort();
      })(),
      text: Promise.resolve(PLAN),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    })) as typeof streamText);

    const result = await planStories(config(), "Plan then cancel", workspace, true, output([]), controller.signal);

    expect(result).toMatchObject({ rejected: true, rejectionReason: "Cancelled", failureReason: "cancelled", stories: [] });
    expect(result.inputTokens).toBe(1);
    expect(result.outputTokens).toBe(1);
  });

  it("reports the actual planner call once, retaining completed step usage", async () => {
    vi.mocked(streamText).mockImplementation(((options: StreamOptions): StreamResult => {
      options.onStepFinish?.();
      return {
        textStream: (async function* () { yield PLAN; })(),
        text: Promise.resolve(PLAN),
        totalUsage: Promise.resolve({ inputTokens: 5, outputTokens: 7 }),
      };
    }) as typeof streamText);
    const onUsage = vi.fn();

    await planStories(config(), "Plan safely", workspace, true, output([]), undefined, 0, onUsage);

    expect(onUsage).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({
      persona: "Planner",
      usage: { inputTokens: 5, outputTokens: 7 },
      usageComplete: true,
    }));
  });

  it("reports a missing observation when a started planner call fails", async () => {
    vi.mocked(streamText).mockImplementation((() => { throw new Error("provider unavailable"); }) as typeof streamText);
    const onUsage = vi.fn();

    await planStories(config(), "Plan safely", workspace, true, output([]), undefined, 0, onUsage);

    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ persona: "Planner", usage: undefined, usageComplete: false }));
  });

  it("fails an explicitly unavailable OS sandbox before model work", async () => {
    vi.mocked(resolveSandboxMode).mockImplementation(() => {
      throw new Error("OS sandbox unavailable");
    });

    await expect(planStories(config(), "Plan nothing", workspace, "os", output([]))).rejects.toThrow("OS sandbox unavailable");

    expect(createModel).not.toHaveBeenCalled();
    expect(streamText).not.toHaveBeenCalled();
  });
});
