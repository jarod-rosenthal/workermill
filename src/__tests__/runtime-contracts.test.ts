import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { createScriptedModel, type ScriptedModel, type ScriptedResponse } from "./helpers/scripted-model.js";

// Keep the SDK, real tool definitions, executor, and permission policy in the
// call path. The factory seam is the only provider boundary replaced here.
let scripted: ScriptedModel;
vi.mock("../engine/model-factory.js", () => ({
  createModel: vi.fn(() => scripted.model),
  buildOllamaOptions: vi.fn(() => ({})),
}));

import { CostTracker } from "../cost-tracker.js";
import { runCommand } from "../run-command.js";
import { executeStories } from "../orchestrator/execution.js";
import { planStories } from "../orchestrator/planning.js";
import { runReviewLoop } from "../orchestrator/review.js";
import type { CliConfig } from "../config.js";
import type { OrchestrationOutput, SharedContext } from "../orchestrator/types.js";

const PLAN = "```json\n{\"stories\":[{\"id\":\"safe\",\"title\":\"Safe\",\"persona\":\"backend_developer\",\"description\":\"Inspect the change.\"}]}\n```";
const APPROVED = "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 10\nFEEDBACK: Approved";
const REVISION_NEEDED = "REVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 1\nFEEDBACK: Fix it\nBLOCKING_EVIDENCE: A required fix is missing\nACTIONABLE_FIX: Fix it\nAFFECTED_STORIES: [1]\nAFFECTED_REASONS: {\"1\":\"Fix it\"}";

function config(permissions?: CliConfig["permissions"]): CliConfig {
  return {
    providers: { test: { model: "scripted" } },
    default: "test",
    permissions,
    review: { enabled: true, autoRevise: true, maxRevisions: 1, approvalThreshold: 9 },
  };
}

function output(): OrchestrationOutput {
  return {
    log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(),
    confirm: vi.fn(async () => true), toolCall: vi.fn(),
  };
}

function install(responses: readonly ScriptedResponse[]): ScriptedModel {
  scripted = createScriptedModel(responses, { provider: "test", modelId: "scripted" });
  return scripted;
}

describe("runtime governance contracts", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "workermill-runtime-contract-"));
    execFileSync("git", ["init"], { cwd: workspace });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: workspace });
    fs.writeFileSync(path.join(workspace, "README.md"), "fixture\n");
    execFileSync("git", ["add", "README.md"], { cwd: workspace });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: workspace });
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("runs a registered headless read tool and provides its result to the next SDK prompt", async () => {
    fs.writeFileSync(path.join(workspace, "note.txt"), "governed result\n");
    const model = install([
      { toolCalls: [{ toolName: "read_file", input: { path: "note.txt" } }] },
      { text: "The governed result was read.", usage: { inputTokens: 8, outputTokens: 3 } },
    ]);

    const result = await runCommand({ prompt: "Read note.txt", singlePrompt: true }, config({ allow: ["read_file"] }), workspace);

    expect(result).toMatchObject({ status: "ok", exitCode: 0, text: "The governed result was read.", toolCalls: 1 });
    expect(result.usageLedger).toMatchObject({
      totals: { callCount: 1, inputTokens: 8, outputTokens: 3, reportedUsageCalls: 1 },
    });
    expect(result.usageComplete).toBe(true);
    expect(model.calls[1]?.options.prompt).toContainEqual(expect.objectContaining({
      role: "tool",
      content: [expect.objectContaining({ toolName: "read_file", output: expect.objectContaining({ value: expect.stringContaining("governed result") }) })],
    }));
    model.assertComplete();
  });

  it("records the selected model's child invocation once after the parent tool settles", async () => {
    const model = install([
      { toolCalls: [{ toolName: "sub_agent", input: { prompt: "Inspect README.md", maxTurns: 1 } }] },
      { text: "Child found the fixture.", usage: { inputTokens: 5, outputTokens: 2 } },
      { text: "Parent received the child report.", usage: { inputTokens: 9, outputTokens: 4 } },
    ]);

    const result = await runCommand({ prompt: "Ask a child", singlePrompt: true }, config({ allow: ["sub_agent"] }), workspace);

    expect(result).toMatchObject({ status: "ok", tokens: { input: 14, output: 6 } });
    expect(result.usageLedger).toMatchObject({ totals: { callCount: 2, inputTokens: 14, outputTokens: 6 } });
    expect(result.usageLedger?.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ persona: "child", provider: "test", model: "scripted", usage: { inputTokens: 5, outputTokens: 2 } }),
    ]));
    model.assertComplete();
  });

  it.each([
    ["denied", { deny: ["write_file"] }],
    ["permission_required", { ask: ["write_file"] }],
  ] as const)("returns %s without a write side effect in headless mode", async (reason, permissions) => {
    const sentinel = path.join(workspace, "must-not-exist.txt");
    const model = install([{ toolCalls: [{ toolName: "write_file", input: { path: sentinel, content: "mutated" } }] }]);

    const result = await runCommand({ prompt: "Write the sentinel", singlePrompt: true }, config(permissions), workspace);

    expect(result.status).not.toBe("ok");
    expect(result.reason).toBe(reason);
    expect(fs.existsSync(sentinel)).toBe(false);
    model.assertComplete();
  });

  it("enforces the worker policy through its real SDK tool stream", async () => {
    const sentinel = path.join(workspace, "worker-must-not-exist.txt");
    const model = install(Array.from({ length: 3 }, () => [
      { toolCalls: [{ toolName: "write_file", input: { path: sentinel, content: "mutated" } }] },
      { text: "Finished." },
    ]).flat());
    const attempts: Array<{ status: string; failureCode?: string }> = [];

    const result = await executeStories({
      sorted: [{ id: "worker", title: "Worker", persona: "backend_developer", description: "Try a prohibited write.", requiredFiles: [sentinel] }],
      completedStoryIds: [], config: config({ deny: ["write_file"] }), output: output(), trustAll: true, sandboxed: true,
      userTask: "governance", context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] }, sessionAllow: new Set(),
      workingDir: workspace, costTracker: new CostTracker(),
      featureBranch: null, mainBranch: "main", abortSignal: undefined, ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
      onStoryAttempt: event => { attempts.push(event); },
    });

    expect(result.completedStoryIds).toEqual([]);
    expect(result.failedStories.has("worker")).toBe(true);
    expect(attempts.filter(event => event.status === "failed")).toHaveLength(3);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(model.calls[1]?.options.prompt).toContainEqual(expect.objectContaining({ role: "tool" }));
    model.assertComplete();
  });

  it("keeps planner and reviewer tools read-only through their real adapters", async () => {
    const plannerSentinel = path.join(workspace, "planner-must-not-exist.txt");
    const reviewerSentinel = path.join(workspace, "reviewer-must-not-exist.txt");
    const model = install([
      { toolCalls: [{ toolName: "write_file", input: { path: plannerSentinel, content: "mutated" } }] },
      { text: PLAN },
      { toolCalls: [{ toolName: "write_file", input: { path: reviewerSentinel, content: "mutated" } }] },
      { text: APPROVED },
    ]);
    const runOutput = output();

    const plan = await planStories(config({ allow: ["write_file"] }), "Plan safely", workspace, true, runOutput);
    fs.writeFileSync(path.join(workspace, "candidate.txt"), "review this\n");
    const review = await runReviewLoop({
      config: config({ allow: ["write_file"] }), output: runOutput, sorted: plan.stories,
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] } as SharedContext,
      userTask: "Review safely", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: new CostTracker(),
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });

    expect(plan.stories).toHaveLength(1);
    expect(review.outcome).toMatchObject({ kind: "approved", approved: true });
    expect(fs.existsSync(plannerSentinel)).toBe(false);
    expect(fs.existsSync(reviewerSentinel)).toBe(false);
    model.assertComplete();
  });

  it("enforces denied writes during a real revision adapter attempt", async () => {
    const sentinel = path.join(workspace, "revision-must-not-exist.txt");
    const model = install([
      { text: REVISION_NEEDED },
      { toolCalls: [{ toolName: "write_file", input: { path: sentinel, content: "mutated" } }] },
      { text: "Revision attempted." },
      { text: REVISION_NEEDED },
    ]);
    fs.writeFileSync(path.join(workspace, "candidate.txt"), "review this\n");
    const review = await runReviewLoop({
      config: { ...config({ deny: ["write_file"] }), review: { ...config().review, maxRevisions: 2 } }, output: output(),
      sorted: [{ id: "revision", title: "Revision", persona: "backend_developer", description: "Repair safely." }],
      context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] } as SharedContext,
      userTask: "Review", featureBranch: null, mainBranch: "main", workingDir: workspace,
      costTracker: new CostTracker(),
      abortSignal: undefined, trustAll: true, sandboxed: true, sessionAllow: new Set(), ticketOps: null,
      gateResultsSection: "", waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });

    expect(review.outcome).not.toMatchObject({ kind: "approved" });
    expect(fs.existsSync(sentinel)).toBe(false);
    model.assertComplete();
  });
});
