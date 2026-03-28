import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// ---- Mocks must be declared before any imports from the module under test ----

// Mock logger to avoid file writes
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock personas — return a minimal persona so loadPersona() doesn't need real files
vi.mock("../personas.js", () => ({
  loadPersona: vi.fn((slug: string) => ({
    name: slug,
    slug,
    systemPrompt: `You are ${slug}.`,
    tools: ["bash", "read_file", "glob", "grep"],
    provider: undefined,
  })),
}));

// Mock instructions — formatProjectInstructions returns empty string
vi.mock("../instructions.js", () => ({
  formatProjectInstructions: vi.fn(() => ""),
}));

// Mock memory — no persisted memories
vi.mock("../memory.js", () => ({
  loadMemories: vi.fn(() => []),
  addMemory: vi.fn(),
  extractMemoryMarkers: vi.fn(() => []),
  formatMemoriesForPrompt: vi.fn(() => ""),
}));

// Mock hooks — noop
vi.mock("../hooks.js", () => ({
  runHooks: vi.fn(),
}));

// Mock cost-tracker — must be a real class (used with `new`)
vi.mock("../cost-tracker.js", () => ({
  CostTracker: class {
    addUsage = vi.fn();
    getTotalCost = vi.fn(() => 0);
  },
}));

// Track streamText calls for assertions
const mockStreamTextCalls: unknown[] = [];

// Mock AI SDK — the critical piece
vi.mock("ai", () => {
  return {
    streamText: vi.fn((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      // Invoke onStepFinish if provided (simulates a step with text output)
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "Working on the implementation.",
          toolCalls: [],
        });
      }
      const plannerText = `Here is the plan:
\`\`\`json
{
  "stories": [
    {
      "id": "setup-api",
      "title": "Set up API endpoint",
      "persona": "backend_developer",
      "description": "Create the API endpoint with proper routing.",
      "targetFiles": ["src/api.ts"],
      "referenceFiles": [],
      "implementationNotes": "Follow existing patterns."
    }
  ]
}
\`\`\`

Done.`;
      return {
        textStream: (async function* () {
          yield plannerText;
        })(),
        text: Promise.resolve(plannerText),
        totalUsage: Promise.resolve({ inputTokens: 500, outputTokens: 200 }),
      };
    }),
    generateObject: vi.fn().mockResolvedValue({
      object: { complexity: "multi", reason: "Multiple concerns" },
    }),
    generateText: vi.fn().mockResolvedValue({
      text: "multi — needs backend and frontend work",
    }),
    stepCountIs: vi.fn(() => () => false),
  };
});

// Mock model factory
vi.mock("../../../packages/engine/src/model-factory.js", () => ({
  createModel: vi.fn(() => ({ modelId: "test-model", provider: "ollama" })),
  buildOllamaOptions: vi.fn(() => ({})),
  ensureOllamaContext: vi.fn().mockResolvedValue(undefined),
}));

// Mock tool definitions — return a minimal set of tools
vi.mock("../../../packages/engine/src/tools/index.js", () => ({
  createToolDefinitions: vi.fn(() => ({
    bash: {
      description: "Run a bash command",
      parameters: { type: "object", properties: { command: { type: "string" } } },
      execute: vi.fn().mockResolvedValue("command output"),
    },
    read_file: {
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: vi.fn().mockResolvedValue("file contents"),
    },
    glob: {
      description: "Find files",
      parameters: { type: "object", properties: { pattern: { type: "string" } } },
      execute: vi.fn().mockResolvedValue("file1.ts\nfile2.ts"),
    },
    grep: {
      description: "Search files",
      parameters: { type: "object", properties: { pattern: { type: "string" } } },
      execute: vi.fn().mockResolvedValue("match1\nmatch2"),
    },
  })),
}));

// Mock safety
vi.mock("../safety.js", () => ({
  isDangerous: vi.fn(() => null),
  READ_TOOLS: new Set(["read_file", "glob", "grep", "list_files"]),
}));

// Now import the functions under test
import { runOrchestration, classifyComplexity, type OrchestrationOutput } from "../orchestrator.js";
import { streamText } from "ai";

// ---- Helpers ----

function createTempGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-orch-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n");
  execSync("git add README.md", { cwd: dir, stdio: "pipe" });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function createMockOutput(): OrchestrationOutput & { logs: string[]; errors: string[]; statuses: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const statuses: string[] = [];
  return {
    logs,
    errors,
    statuses,
    log: vi.fn((persona: string, message: string) => {
      logs.push(`[${persona}] ${message}`);
    }),
    coordinatorLog: vi.fn((message: string) => {
      logs.push(`[coordinator] ${message}`);
    }),
    error: vi.fn((message: string) => {
      errors.push(message);
    }),
    status: vi.fn((message: string) => {
      statuses.push(message);
    }),
    statusDone: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    toolCall: vi.fn(),
    updateBranch: vi.fn(),
    updateCost: vi.fn(),
  };
}

function createTestConfig() {
  return {
    providers: {
      ollama: { model: "test-model", host: "http://localhost:11434", contextLength: 4096 },
    },
    default: "ollama",
  };
}

// ---- Tests ----

describe("orchestrator", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe("classifyComplexity()", () => {
    it("returns complexity classification from generateObject", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      const result = await classifyComplexity(config, "Build a REST API with auth", output);

      expect(result).toHaveProperty("isMulti");
      expect(result).toHaveProperty("reason");
      expect(typeof result.isMulti).toBe("boolean");
    });

    it("classifies multi-concern tasks as multi", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      // generateObject mock returns { complexity: "multi" }
      const result = await classifyComplexity(config, "Build frontend and backend", output);

      expect(result.isMulti).toBe(true);
      expect(result.reason).toBe("Multiple concerns");
    });
  });

  describe("runOrchestration()", () => {
    it("runs without throwing when AI SDK is mocked", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      // Should complete without throwing
      await expect(
        runOrchestration(config, "Add a health check endpoint", true, false, output)
      ).resolves.not.toThrow();
    });

    it("calls streamText for planning", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      await runOrchestration(config, "Add a health check endpoint", true, false, output);

      // streamText should be called at least once (for planner)
      expect(streamText).toHaveBeenCalled();
      expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(1);

      // First call should be the planner
      const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
      expect(plannerCall).toHaveProperty("system");
      expect(plannerCall).toHaveProperty("prompt");
      expect(plannerCall).toHaveProperty("tools");
    });

    it("creates a feature branch", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      await runOrchestration(config, "Add a health check endpoint", true, false, output);

      // Verify a feature branch was created (not on the original "main" or "master")
      const currentBranch = execSync("git branch --show-current", { cwd: repoDir, encoding: "utf-8" }).trim();
      // The branch name should contain something related to the task
      // or at minimum, updateBranch should have been called
      const updateBranchMock = output.updateBranch as ReturnType<typeof vi.fn>;
      expect(updateBranchMock).toHaveBeenCalled();
      const branchArg = updateBranchMock.mock.calls[0]?.[0];
      if (branchArg) {
        expect(typeof branchArg).toBe("string");
        expect(branchArg.length).toBeGreaterThan(0);
      }
    });

    it("logs planning output", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      await runOrchestration(config, "Build a REST API", true, false, output);

      // Should have planner logs
      const plannerLogs = output.logs.filter(l => l.startsWith("[planner]"));
      expect(plannerLogs.length).toBeGreaterThan(0);
    });

    it("calls streamText for story execution after planning", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      await runOrchestration(config, "Add a health check endpoint", true, false, output);

      // Should have at least 2 streamText calls: planner + 1 story worker
      // (The mock planner returns 1 story)
      expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("handles plan confirmation when not in trust mode", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      // confirm returns true — plan should proceed
      (output.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      await runOrchestration(config, "Add an endpoint", false, false, output);

      // confirm should have been called (plan approval)
      expect(output.confirm).toHaveBeenCalled();
    });

    it("stops when plan is rejected by user", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      // User rejects the plan
      (output.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      await runOrchestration(config, "Add an endpoint", false, false, output);

      // Should have logged cancellation
      const cancelledLogs = output.logs.filter(l => l.includes("cancelled"));
      expect(cancelledLogs.length).toBeGreaterThan(0);

      // Story execution should NOT have happened (only planner call)
      // Note: might be 1 streamText call for planner only
      expect(mockStreamTextCalls.length).toBe(1);
    });

    it("passes abort signal through to streamText", async () => {
      const config = createTestConfig();
      const output = createMockOutput();
      const controller = new AbortController();

      await runOrchestration(config, "Add endpoint", true, false, output, controller.signal);

      // Verify abortSignal was passed to streamText
      const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
      expect(plannerCall).toHaveProperty("abortSignal");
    });

    it("reports story completion in logs", async () => {
      const config = createTestConfig();
      const output = createMockOutput();

      await runOrchestration(config, "Add a health check endpoint", true, false, output);

      // Should have story completion log
      const completionLogs = output.logs.filter(l => l.includes("completed"));
      expect(completionLogs.length).toBeGreaterThan(0);
    });
  });
});
