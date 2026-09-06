import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// These adapters are intentionally fake; fingerprinting, gate execution,
// candidate preparation, review interpretation, and completion stay real.
let onLifecycleHook: ((event: string, workingDir: string) => void) | undefined;

vi.mock("../logger.js", () => ({
  debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(),
}));

vi.mock("../personas.js", () => ({
  loadPersona: vi.fn((slug: string) => ({
    name: slug,
    slug,
    systemPrompt: `You are ${slug}.`,
    tools: ["bash", "read_file", "glob", "grep", "write_file"],
  })),
}));

vi.mock("../instructions.js", () => ({ formatProjectInstructions: vi.fn(() => "") }));
vi.mock("../project-context.js", () => ({ formatPromptProjectContext: vi.fn(() => "") }));
vi.mock("../memory.js", () => ({
  loadMemories: vi.fn(() => []), addMemory: vi.fn(),
  extractMemoryMarkers: vi.fn(() => []), formatMemoriesForPrompt: vi.fn(() => ""),
}));
vi.mock("../hooks.js", () => ({
  runHooks: vi.fn(),
  runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })),
  runLifecycleHooks: vi.fn((event: string, _hooks: unknown, workingDir: string) => onLifecycleHook?.(event, workingDir)),
}));
vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServersForRun: vi.fn(async (value: unknown) => value),
  createMCPRunResources: () => ({ register: vi.fn(), ensureStarted: vi.fn(async () => {}), getToolDefinitions: () => ({}), close: vi.fn(async () => {}) }),
}));
vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "scripted", provider: "ollama" })),
  buildOllamaOptions: vi.fn(() => ({})),
  ensureOllamaContext: vi.fn().mockResolvedValue(undefined),
  ensureLmStudioContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../engine/tools/index.js", () => ({ createToolDefinitions: vi.fn(() => ({})) }));
vi.mock("../safety.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../safety.js")>(),
  isDangerous: vi.fn(() => null),
  READ_TOOLS: new Set(["read_file", "glob", "grep", "list_files"]),
  checkPermissionRules: vi.fn(() => "none"),
}));

vi.mock("../orchestrator/completion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../orchestrator/completion.js")>();
  return { ...actual, runCompletion: vi.fn(actual.runCompletion) };
});

type StreamOptions = { prompt?: string; onStepFinish?: (step: { text: string; toolCalls: unknown[] }) => void };
let scriptPhase = 0;
let reviewBehavior: "normal" | "large-success" | "large-failure" = "normal";
const observedReviewArtifacts: Array<{ path: string; readable: boolean }> = [];

vi.mock("ai", () => ({
  stepCountIs: vi.fn(() => () => false),
  generateObject: vi.fn().mockResolvedValue({ object: { complexity: "single", reason: "test" } }),
  generateText: vi.fn().mockResolvedValue({ text: "", usage: {} }),
  streamText: vi.fn((options: StreamOptions) => {
    scriptPhase += 1;
    const prompt = options.prompt ?? "";
    let text: string;
    if (scriptPhase === 1) {
      text = '```json\n{"stories":[{"id":"impl","title":"Implement evidence fixture","persona":"backend_developer","description":"Write the fixture."}]}\n```';
    } else if (prompt.includes("REVISION REQUIRED")) {
      fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), "src", "impl.ts"), "bad\n");
      text = "Revised the fixture.";
    } else if (prompt.includes("Review the actual code")) {
      const artifact = /Full diff saved to:\*{0,2}\s*`([^`]+)`/.exec(prompt)?.[1];
      if (artifact) {
        observedReviewArtifacts.push({
          path: artifact,
          readable: fs.existsSync(artifact) && fs.readFileSync(artifact, "utf8").includes("large fixture"),
        });
      }
      if (reviewBehavior === "large-failure") throw new Error("scripted reviewer failure");
      text = reviewBehavior === "large-success" || scriptPhase >= 4
        ? "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 10\nFEEDBACK: Approved"
        : "REVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 1\nFEEDBACK: Fix the fixture\nBLOCKING_EVIDENCE: fixture is incomplete\nACTIONABLE_FIX: Replace it\nAFFECTED_STORIES: [1]\nAFFECTED_REASONS: {\"1\":\"Replace it\"}";
    } else {
      fs.mkdirSync(path.join(process.cwd(), "src"), { recursive: true });
      fs.writeFileSync(
        path.join(process.cwd(), "src", "impl.ts"),
        reviewBehavior.startsWith("large") ? `// large fixture\n${"x".repeat(8_000)}\n` : "good\n",
      );
      text = "Implemented the fixture.";
    }
    options.onStepFinish?.({
      text,
      toolCalls: scriptPhase === 1 || prompt.includes("Review")
        ? []
        : [{ toolName: "write_file", input: { file_path: "src/impl.ts", content: text } }],
    });
    return {
      textStream: (async function* () { yield text; })(),
      text: Promise.resolve(text),
      totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    };
  }),
}));

import type { CliConfig } from "../config.js";
import { CostTracker } from "../cost-tracker.js";
import { runOrchestration, type OrchestrationOutput } from "../orchestrator.js";
import { runCompletion } from "../orchestrator/completion.js";
import { captureRepositoryFingerprint } from "../repository-fingerprint.js";
import { saveShipRun } from "../ship-state.js";
import { getStateRoot } from "../state-root.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repository(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wm-final-evidence-")));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

function output(confirm: () => Promise<boolean> = async () => true): OrchestrationOutput & { errors: string[]; logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];
  return {
    errors, logs,
    log: vi.fn((persona: string, message: string) => logs.push(`[${persona}] ${message}`)),
    coordinatorLog: vi.fn((message: string) => logs.push(`[coordinator] ${message}`)),
    error: vi.fn((message: string) => errors.push(message)),
    status: vi.fn(), statusDone: vi.fn(), confirm: vi.fn(confirm), toolCall: vi.fn(),
    updateBranch: vi.fn(), updateCost: vi.fn(), updateUsageSummary: vi.fn(),
  };
}

function config(review: CliConfig["review"]): CliConfig {
  return {
    providers: { ollama: { model: "scripted", host: "http://127.0.0.1:1", contextLength: 4096 } },
    default: "ollama",
    review,
    sandbox: false,
  };
}

async function completionArgs(dir: string, overrides: Partial<Parameters<typeof runCompletion>[0]> = {}) {
  const fingerprint = await captureRepositoryFingerprint(dir);
  if (!fingerprint.verified) throw new Error(fingerprint.reason);
  const featureBranch = git(dir, ["branch", "--show-current"]);
  return {
    config: config({ enabled: false }), output: output(),
    sorted: [{ id: "impl", title: "Implement fixture", persona: "backend_developer", description: "fixture" }],
    completedStoryIds: ["impl"], featureBranch, mainBranch: featureBranch,
    workingDir: dir, userTask: "fixture", costTracker: new CostTracker(), finalReviewText: "",
    ticketOps: null, resolvedTicketSystem: "github", hooks: undefined,
    evidence: { fingerprint, gateResults: [], reviewOutcome: { kind: "disabled", approved: false } },
    ...overrides,
  };
}

describe("final evidence runtime", () => {
  let dir: string;
  let priorCwd: string;

  beforeEach(() => {
    dir = repository();
    priorCwd = process.cwd();
    process.chdir(dir);
    scriptPhase = 0;
    reviewBehavior = "normal";
    observedReviewArtifacts.length = 0;
    onLifecycleHook = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(priorCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not repeat unchanged gates before disabled-review completion", async () => {
    const result = await runOrchestration({
      ...config({ enabled: false }),
      qualityGates: [{ name: "unchanged", commands: ["git diff --quiet"] }],
    }, "Implement fixture", true, false, output());

    expect(result.featureBranch).toBeTruthy();
    expect(vi.mocked(runCompletion)).toHaveBeenCalledTimes(1);
    const orchestrationOutput = vi.mocked(runCompletion).mock.calls[0][0].output as ReturnType<typeof output>;
    expect(orchestrationOutput.logs.filter((line) => line.includes("Running 1 quality gate"))).toHaveLength(1);
  });

  it("blocks publication when a reviewer revision makes the final gate fail", async () => {
    const runOutput = output();
    const result = await runOrchestration({
      ...config({ enabled: true, strict: false, autoRevise: true, maxRevisions: 2, approvalThreshold: 9 }),
      qualityGates: [{ name: "fixture is good", commands: ["bash -lc 'test \"$(cat src/impl.ts)\" = good'"] }],
    }, "Implement fixture", true, false, runOutput);

    expect(result.featureBranch).toBeTruthy();
    expect(fs.readFileSync(path.join(dir, "src", "impl.ts"), "utf8")).toBe("bad\n");
    expect(vi.mocked(runCompletion)).not.toHaveBeenCalled();
    expect(runOutput.errors.some((message) => message.includes("required quality gates") || message.includes("required_command_failed"))).toBe(true);
  });

  it("requires strict approval but permits disabled review", async () => {
    const strictOutput = output();
    const strictArgs = await completionArgs(dir, {
      config: config({ enabled: true, strict: true }), output: strictOutput,
      evidence: { fingerprint: (await captureRepositoryFingerprint(dir)) as Extract<Awaited<ReturnType<typeof captureRepositoryFingerprint>>, { verified: true }>, gateResults: [], reviewOutcome: { kind: "revision_needed", approved: false } },
    });
    await runCompletion(strictArgs);
    expect(strictOutput.errors).toContain("Publication blocked: strict mode requires reviewer approval (review: revision_needed).");

    const disabledOutput = output();
    const disabledArgs = await completionArgs(dir, { output: disabledOutput });
    const disabledResult = await runCompletion(disabledArgs);
    expect(disabledResult.completionInvalidated).toBe(false);
    expect(disabledOutput.errors).toEqual([]);
  });

  it("rechecks evidence after the push prompt before publishing", async () => {
    git(dir, ["remote", "add", "origin", "file:///nonexistent/final-evidence-remote"]);
    const promptOutput = output(async () => {
      fs.writeFileSync(path.join(dir, "changed-during-prompt.txt"), "changed\n");
      return true;
    });
    const args = await completionArgs(dir, { output: promptOutput });

    await runCompletion(args);

    expect(promptOutput.errors.some((message) => message.includes("final evidence is stale"))).toBe(true);
    expect(promptOutput.status).not.toHaveBeenCalledWith("Pushing branch...");
    expect(promptOutput.logs.some((line) => line.includes("Pull request created"))).toBe(false);
  });

  it("preserves retry state and suppresses ordinary success when ship_complete mutates source", async () => {
    const branch = git(dir, ["branch", "--show-current"]);
    saveShipRun({ workingDir: dir, featureBranch: branch, mainBranch: branch, userTask: "fixture", stories: [
      { id: "impl", title: "Implement fixture", persona: "backend_developer", description: "fixture" },
    ], completedStoryIds: [] });
    const liveView = { emitRunComplete: vi.fn() };
    onLifecycleHook = (event, workingDir) => {
      if (event === "ship_complete") fs.writeFileSync(path.join(workingDir, "hook-change.txt"), "changed\n");
    };
    const hookOutput = output();
    const args = await completionArgs(dir, { output: hookOutput, liveViewServer: liveView as never, hooks: { on: { ship_complete: [] } } });

    const result = await runCompletion(args);

    expect(result.completionInvalidated).toBe(true);
    expect(liveView.emitRunComplete).not.toHaveBeenCalled();
    expect(hookOutput.errors.some((message) => message.includes("ship_complete changed local source"))).toBe(true);
    const saved = JSON.parse(fs.readFileSync(path.join(getStateRoot(), "ship-runs.json"), "utf8")) as Record<string, unknown>;
    expect(saved[branch]).toBeDefined();
  });

  it("bounds source-mutating gates and leaves their local work inspectable", async () => {
    const runOutput = output();
    const result = await runOrchestration({
      ...config({ enabled: false }),
      qualityGates: [{ name: "generator", commands: ["printf x >> generated-by-gate.txt"] }],
    }, "Implement fixture", true, false, runOutput);

    expect(result.featureBranch).toBeTruthy();
    expect(fs.readFileSync(path.join(dir, "generated-by-gate.txt"), "utf8")).toBe("xx");
    expect(runOutput.logs.filter((line) => line.includes("Running 1 quality gate"))).toHaveLength(2);
    expect(runOutput.errors).toContain("Quality gates changed the candidate repeatedly; publication is blocked with local work preserved.");
    expect(vi.mocked(runCompletion)).not.toHaveBeenCalled();
  });

  it("blocks a moved expected feature ref while the checked-out tree still matches evidence", async () => {
    const args = await completionArgs(dir);
    const originalHead = args.evidence.fingerprint.head;
    const branch = args.featureBranch!;
    git(dir, ["commit", "--allow-empty", "-m", "same tree but moved ref"]);
    const alternateHead = git(dir, ["rev-parse", "HEAD"]);
    git(dir, ["checkout", "--detach", originalHead]);
    git(dir, ["branch", "-f", branch, alternateHead]);
    const movedOutput = output();

    await runCompletion({ ...args, output: movedOutput });

    expect(git(dir, ["rev-parse", "HEAD"])).toBe(originalHead);
    expect(movedOutput.errors).toContain("Publication blocked: the expected feature branch no longer points at the verified candidate.");
    expect(movedOutput.confirm).not.toHaveBeenCalled();
    expect(movedOutput.logs.some((line) => line.includes("Pushing branch") || line.includes("Pull request created"))).toBe(false);
  });

  it.each([
    ["success", "large-success"],
    ["review failure", "large-failure"],
  ] as const)("cleans its unique large-review artifact on %s without deleting a user file", async (_label, behavior) => {
    reviewBehavior = behavior;
    const fixedUserFile = path.join(dir, ".workermill-review-diff.tmp");
    fs.writeFileSync(fixedUserFile, "do not delete\n");
    const runOutput = output();

    await runOrchestration(config({ enabled: true, strict: false, maxRevisions: 1, approvalThreshold: 9 }), "Implement fixture", true, false, runOutput);

    expect(observedReviewArtifacts).toHaveLength(1);
    expect(observedReviewArtifacts[0].readable).toBe(true);
    expect(fs.existsSync(observedReviewArtifacts[0].path)).toBe(false);
    expect(fs.readFileSync(fixedUserFile, "utf8")).toBe("do not delete\n");
  });
});
