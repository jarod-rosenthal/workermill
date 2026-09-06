import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../logger.js", () => ({
  debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn(),
}));
vi.mock("../memory.js", () => ({ loadMemories: vi.fn(() => []) }));
vi.mock("../hooks.js", () => ({ runLifecycleHooks: vi.fn() }));
vi.mock("../mcp-client.js", () => ({
  autoDetectMCPServersForRun: vi.fn(async (value: unknown) => value),
  createMCPRunResources: vi.fn(() => ({
    register: vi.fn(), ensureStarted: vi.fn(async () => {}),
    getToolDefinitions: vi.fn(() => ({})), close: vi.fn(async () => {}),
  })),
}));
vi.mock("../orchestrator/planning.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../orchestrator/planning.js")>(),
  planStories: vi.fn(async () => ({
    stories: [{ id: "startup", title: "Startup fixture", persona: "backend_developer", description: "Exercise startup." }],
    provider: "fixture", model: "fixture", inputTokens: 0, outputTokens: 0,
  })),
}));
vi.mock("../orchestrator/execution.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../orchestrator/execution.js")>(),
  executeStories: vi.fn(async ({ completedStoryIds }: { completedStoryIds: string[] }) => {
    completedStoryIds.push("startup");
    return { failedStories: new Set<string>(), skippedStories: new Set<string>(), earlyExit: false };
  }),
}));
vi.mock("../orchestrator/candidate.js", () => ({
  prepareCandidate: vi.fn(async () => ({ prepared: true })),
}));
vi.mock("../orchestrator/gates.js", () => ({
  runQualityGates: vi.fn(async () => ({ earlyExit: false, gateResults: [], gateResultsSection: "" })),
}));
vi.mock("../orchestrator/review.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../orchestrator/review.js")>(),
  runReviewLoop: vi.fn(async () => ({
    aborted: false, finalReviewText: "", outcome: { kind: "disabled", approved: false },
  })),
}));
vi.mock("../orchestrator/completion.js", () => ({
  runCompletion: vi.fn(async (args: {
    sorted: unknown[]; completedStoryIds: string[]; featureBranch: string | null; userTask: string; mainBranch: string;
  }) => ({
    stories: args.sorted, completedStoryIds: args.completedStoryIds,
    featureBranch: args.featureBranch, userTask: args.userTask, mainBranch: args.mainBranch,
  })),
  shouldTransitionTicketOnPrOpen: vi.fn(),
}));

import type { CliConfig } from "../config.js";
import { runOrchestration, type OrchestrationOutput } from "../orchestrator.js";
import { createTempWorkerMillHome, type TempHome } from "./helpers/temp-workermill-home.js";

function git(directory: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function repository(): string {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wm-startup-runtime-")));
  git(directory, ["init"]);
  git(directory, ["config", "user.email", "startup@example.test"]);
  git(directory, ["config", "user.name", "Startup Test"]);
  fs.writeFileSync(path.join(directory, "README.md"), "startup fixture\n");
  git(directory, ["add", "README.md"]);
  git(directory, ["commit", "-m", "initial"]);
  git(directory, ["remote", "add", "origin", "https://github.com/example/remote-project.git"]);
  return directory;
}

function output(confirmations: boolean[] = []): OrchestrationOutput & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs, errors,
    log: vi.fn((persona: string, message: string) => logs.push(`[${persona}] ${message}`)),
    coordinatorLog: vi.fn((message: string) => logs.push(`[coordinator] ${message}`)),
    error: vi.fn((message: string) => errors.push(message)),
    status: vi.fn(), statusDone: vi.fn(),
    confirm: vi.fn(async () => confirmations.shift() ?? true),
    toolCall: vi.fn(), updateBranch: vi.fn(), updateCost: vi.fn(), updateUsageSummary: vi.fn(),
  };
}

function config(): CliConfig {
  return {
    providers: { ollama: { model: "fixture", host: "http://127.0.0.1:1", contextLength: 4096 } },
    default: "ollama",
    review: { enabled: false },
    sandbox: false,
  };
}

describe("orchestration startup runtime", () => {
  let directory: string;
  let previousDirectory: string;
  let tempHome: TempHome;

  beforeEach(() => {
    directory = repository();
    previousDirectory = process.cwd();
    tempHome = createTempWorkerMillHome();
    process.chdir(directory);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(previousDirectory);
    tempHome.cleanup();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("uses the configured remote repository name as the normal startup branch prefix", async () => {
    const runOutput = output();

    const result = await runOrchestration(config(), "Preserve remote prefix", true, false, runOutput);

    expect(result.featureBranch).toBe("remote-project/preserve-remote-prefix");
    expect(git(directory, ["branch", "--show-current"])).toBe(result.featureBranch);
    expect(runOutput.errors).toEqual([]);
  });

  it("keeps an existing branch and its commits after explicit continue confirmation", async () => {
    const branch = "remote-project/preserve-existing-commits";
    git(directory, ["switch", "-c", branch]);
    fs.writeFileSync(path.join(directory, "existing.txt"), "keep this commit\n");
    git(directory, ["add", "existing.txt"]);
    git(directory, ["commit", "-m", "existing work"]);
    const existingHead = git(directory, ["rev-parse", "HEAD"]);
    git(directory, ["switch", "-"]);

    const runOutput = output([false, true]);
    const result = await runOrchestration(config(), "Preserve existing commits", true, false, runOutput);

    expect(result.featureBranch).toBe(branch);
    expect(git(directory, ["branch", "--show-current"])).toBe(branch);
    expect(fs.readFileSync(path.join(directory, "existing.txt"), "utf8")).toBe("keep this commit\n");
    expect(git(directory, ["merge-base", "--is-ancestor", existingHead, "HEAD"])).toBe("");
    expect(runOutput.confirm).toHaveBeenCalledWith(`Reset \`${branch}\` and start fresh?`);
    expect(runOutput.confirm).toHaveBeenCalledWith(`Continue on existing \`${branch}\`?`);
    expect(runOutput.errors).toEqual([]);
  });
});
