import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { streamText, createToolDefinitions } = vi.hoisted(() => ({ streamText: vi.fn(), createToolDefinitions: vi.fn() }));
vi.mock("ai", () => ({ streamText, stepCountIs: vi.fn(() => () => false) }));
vi.mock("../engine/model-factory.js", () => ({ createModel: vi.fn(() => ({})), buildOllamaOptions: vi.fn(() => ({})) }));
vi.mock("../engine/tools/index.js", () => ({ createToolDefinitions }));
vi.mock("../personas.js", () => ({ loadPersona: vi.fn(() => ({ name: "worker", systemPrompt: "worker", tools: ["write_file"] })) }));
vi.mock("../config.js", async (original) => ({ ...(await original<typeof import("../config.js")>()), getProviderForPersona: vi.fn(() => ({ provider: "test", model: "test" })) }));
vi.mock("../hooks.js", () => ({ runHooks: vi.fn(), runPreHooksWithBlocking: vi.fn(() => ({ blocked: false })), runLifecycleHooks: vi.fn() }));
vi.mock("../logger.js", () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { executeStories } from "../orchestrator/execution.js";
import { CostTracker } from "../cost-tracker.js";
import type { OrchestrationOutput } from "../orchestrator/types.js";

const dirs: string[] = [];
function repository(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-worker-git-"));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
  execFileSync("git", ["add", "base.txt"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return dir;
}
const output: OrchestrationOutput = { log: vi.fn(), coordinatorLog: vi.fn(), error: vi.fn(), status: vi.fn(), statusDone: vi.fn(), confirm: vi.fn(async () => true), toolCall: vi.fn() };

afterEach(() => { vi.clearAllMocks(); while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe("worker Git lifecycle", () => {
  it("retains tracked and untracked user work across a failed retry", async () => {
    const workspace = repository();
    fs.writeFileSync(path.join(workspace, "user-untracked.txt"), "keep\n");
    fs.writeFileSync(path.join(workspace, "base.txt"), "user edit\n");
    let call = 0;
    createToolDefinitions.mockReturnValue({ write_file: { execute: ({ path: file, content }: { path: string; content: string }) => fs.writeFileSync(path.join(workspace, file), content) } });
    streamText.mockImplementation((options: { tools: Record<string, { execute(input: Record<string, unknown>): Promise<unknown> }> }) => {
      call++;
      return {
        textStream: (async function* () {
          if (call === 1) {
            await options.tools.write_file.execute({ path: "partial.txt", content: "partial\n" });
            throw new Error("ECONNRESET transient provider failure");
          }
          yield "completed";
        })(),
        text: Promise.resolve("completed"), totalUsage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
      };
    });
    const result = await executeStories({
      sorted: [{ id: "git", title: "git", persona: "worker", description: "write" }], completedStoryIds: [],
      config: { providers: { test: { model: "test" } }, default: "test", permissions: { allow: ["write_file(*)"] } } as never,
      output, trustAll: true, sandboxed: true, userTask: "task", context: { filesCreated: [], filesModified: [], decisions: [], learnings: [] },
      sessionAllow: new Set(), workingDir: workspace, costTracker: new CostTracker(),
      featureBranch: null, mainBranch: "main", abortSignal: new AbortController().signal, ticketOps: null,
      waitWhilePaused: async () => false, pauseForBalanceIssue: async () => false, logRetryHint: vi.fn(),
    });
    expect(call).toBe(2);
    expect(result.completedStoryIds).toEqual(["git"]);
    expect(fs.readFileSync(path.join(workspace, "base.txt"), "utf8")).toBe("user edit\n");
    expect(fs.readFileSync(path.join(workspace, "user-untracked.txt"), "utf8")).toBe("keep\n");
    expect(fs.readFileSync(path.join(workspace, "partial.txt"), "utf8")).toBe("partial\n");
  });
});
