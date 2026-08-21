import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "test-model" })),
  buildOllamaOptions: vi.fn(() => ({})),
}));

vi.mock("../instructions.js", () => ({
  formatProjectInstructions: vi.fn(() => ""),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
  stepCountIs: vi.fn(),
}));

import { generateObject, generateText } from "ai";
import { runPlanCritic, DEFAULT_CRITIC_THRESHOLD, MAX_CRITIC_ITERATIONS } from "../orchestrator/planning.js";
import type { Story, OrchestrationOutput } from "../orchestrator/types.js";
import type { CliConfig } from "../config.js";

const mockGenerateObject = generateObject as unknown as ReturnType<typeof vi.fn>;
const mockGenerateText = generateText as unknown as ReturnType<typeof vi.fn>;

function createOutput(): OrchestrationOutput & { logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    log: (_p: string, m: string) => { logs.push(m); },
    coordinatorLog: (m: string) => { logs.push(m); },
    error: (m: string) => { logs.push(m); },
    status: () => {},
    statusDone: () => {},
    confirm: async () => true,
    toolCall: () => {},
  };
}

function createConfig(review: Partial<NonNullable<CliConfig["review"]>> = {}): CliConfig {
  return {
    providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
    default: "anthropic",
    review: { critic: true, ...review },
  } as CliConfig;
}

const STORIES: Story[] = [
  { id: "one", title: "Add endpoint", persona: "backend_developer", description: "Add a health endpoint" },
];

function scored(score: number, issues: Array<{ dimension: string; problem: string; fix: string }> = []) {
  return {
    object: { score, summary: `scored ${score}`, issues },
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

describe("runPlanCritic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves a plan that meets the default threshold on the first pass", async () => {
    mockGenerateObject.mockResolvedValueOnce(scored(9));

    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", createOutput());

    expect(result.approved).toBe(true);
    expect(result.score).toBe(9);
    expect(result.iterations).toBe(1);
    expect(result.stories).toEqual(STORIES);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("honors a custom criticThreshold", async () => {
    mockGenerateObject.mockResolvedValueOnce(scored(6));

    const result = await runPlanCritic(
      createConfig({ criticThreshold: 5 }),
      "task",
      STORIES,
      "/work",
      createOutput(),
    );

    expect(result.approved).toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("refines the plan when the score is below threshold, then approves", async () => {
    mockGenerateObject
      .mockResolvedValueOnce(scored(4, [{ dimension: "completeness", problem: "no tests", fix: "add a test story" }]))
      .mockResolvedValueOnce(scored(9));
    mockGenerateText.mockResolvedValueOnce({
      text: '```json\n{ "stories": [{ "id": "one", "title": "Add endpoint", "persona": "backend_developer", "description": "Add a health endpoint" }, { "id": "two", "title": "Test endpoint", "persona": "qa_engineer", "description": "Cover the endpoint" }] }\n```',
      usage: { inputTokens: 200, outputTokens: 300 },
    });

    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", createOutput());

    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(result.approved).toBe(true);
    expect(result.score).toBe(9);
    expect(result.iterations).toBe(2);
    expect(result.stories).toHaveLength(2);
    // Token usage accumulates: two scoring calls (100/50 each) + one refinement (200/300)
    expect(result.inputTokens).toBe(400);
    expect(result.outputTokens).toBe(400);
  });

  it("gives up after MAX_CRITIC_ITERATIONS and reports the plan as unapproved", async () => {
    const issues = [{ dimension: "scope", problem: "too big", fix: "split it" }];
    mockGenerateObject.mockResolvedValue(scored(3, issues));
    mockGenerateText.mockResolvedValue({
      text: '```json\n{ "stories": [{ "id": "one", "title": "Add endpoint", "persona": "backend_developer", "description": "Add a health endpoint" }] }\n```',
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", createOutput());

    expect(result.approved).toBe(false);
    expect(result.score).toBe(3);
    expect(result.iterations).toBe(MAX_CRITIC_ITERATIONS);
    expect(mockGenerateObject).toHaveBeenCalledTimes(MAX_CRITIC_ITERATIONS);
    // One fewer refinement than scoring rounds — the last score has nothing to refine into
    expect(mockGenerateText).toHaveBeenCalledTimes(MAX_CRITIC_ITERATIONS - 1);
  });

  it("returns the original plan unchanged when scoring throws", async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error("model unavailable"));

    const output = createOutput();
    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", output);

    // Critic failure must never block a build
    expect(result.approved).toBe(true);
    expect(result.stories).toEqual(STORIES);
    expect(output.logs.some((l) => l.includes("Could not score the plan"))).toBe(true);
  });

  it("keeps the previous plan when refinement produces no parseable stories", async () => {
    mockGenerateObject.mockResolvedValueOnce(scored(4, [{ dimension: "risk", problem: "x", fix: "y" }]));
    mockGenerateText.mockResolvedValueOnce({ text: "sorry, I could not do that", usage: {} });

    const output = createOutput();
    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", output);

    expect(result.approved).toBe(false);
    expect(result.stories).toEqual(STORIES);
    expect(output.logs.some((l) => l.includes("no usable plan"))).toBe(true);
  });

  it("stops early when the abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runPlanCritic(createConfig(), "task", STORIES, "/work", createOutput(), controller.signal);

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(result.stories).toEqual(STORIES);
  });

  it("exposes a default threshold of 8", () => {
    expect(DEFAULT_CRITIC_THRESHOLD).toBe(8);
  });
});
