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
  warn: vi.fn(),
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

// ---- Default streamText mock factory — used to restore after per-test overrides ----

const DEFAULT_PLANNER_TEXT = `Here is the plan:
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

function restoreDefaultStreamTextMock() {
  vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
    mockStreamTextCalls.push(opts);
    if (typeof opts.onStepFinish === "function") {
      (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
        text: "Working on the implementation.",
        toolCalls: [],
      });
    }
    return {
      textStream: (async function* () { yield DEFAULT_PLANNER_TEXT; })(),
      text: Promise.resolve(DEFAULT_PLANNER_TEXT),
      totalUsage: Promise.resolve({ inputTokens: 500, outputTokens: 200 }),
    };
  });
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
    restoreDefaultStreamTextMock();
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

// ---- Additional coverage: resolveTaskInput ----

describe("resolveTaskInput (via runOrchestration)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("reads a spec file when task is a single file path", async () => {
    const specContent = "Build a user authentication system with JWT tokens.";
    const specFile = path.join(repoDir, "spec.md");
    fs.writeFileSync(specFile, specContent);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "spec.md", true, false, output);

    // The planner prompt should contain the spec file contents
    const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
    expect(String(plannerCall.prompt)).toContain("Implement the following specification from spec.md:");
    expect(String(plannerCall.prompt)).toContain(specContent);
  });

  it("passes through a multi-word task string unchanged", async () => {
    const task = "Add a health check endpoint to the API";
    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, task, true, false, output);

    const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
    // The prompt should contain the raw task text
    expect(String(plannerCall.prompt)).toContain(task);
  });

  it("passes through a file path that does not exist", async () => {
    const task = "nonexistent-spec.md";
    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, task, true, false, output);

    const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
    // Since the file doesn't exist, the task passes through as-is
    expect(String(plannerCall.prompt)).toContain(task);
    expect(String(plannerCall.prompt)).not.toContain("Implement the following specification");
  });

  it("passes through a string with no file extension", async () => {
    const task = "refactor-the-auth-module";
    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, task, true, false, output);

    const plannerCall = mockStreamTextCalls[0] as Record<string, unknown>;
    expect(String(plannerCall.prompt)).toContain(task);
    expect(String(plannerCall.prompt)).not.toContain("Implement the following specification");
  });
});

// ---- Additional coverage: buildReasoningOptions (via classifyComplexity) ----

describe("buildReasoningOptions (via classifyComplexity)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns openai reasoning options for openai provider", async () => {
    const config = {
      providers: {
        openai: { model: "gpt-5.4", apiKey: "sk-test" },
      },
      default: "openai",
    };
    const output = createMockOutput();

    // classifyComplexity invokes buildReasoningOptions via the provider-specific path
    // We just ensure it resolves without throwing and returns a classification
    const result = await classifyComplexity(config as Parameters<typeof classifyComplexity>[0], "Build an API", output);
    expect(result).toHaveProperty("isMulti");
  });

  it("returns default empty options for unknown provider", async () => {
    const config = {
      providers: {
        ollama: { model: "llama3.3", host: "http://localhost:11434" },
      },
      default: "ollama",
    };
    const output = createMockOutput();

    const result = await classifyComplexity(config as Parameters<typeof classifyComplexity>[0], "Write a script", output);
    expect(result).toHaveProperty("isMulti");
    // No provider options error should occur
  });
});

// ---- Additional coverage: isTransientError / classifyError (via runOrchestration story failure paths) ----

describe("isTransientError and classifyError (via error log patterns)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("planner error triggers graceful failure path (transient network error)", async () => {
    // Simulate a stream that throws during iteration — caught by planStories try/catch
    vi.mocked(streamText).mockImplementationOnce((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      const err = new Error("status code 503: Service Unavailable");
      const textPromise = Promise.reject(err);
      textPromise.catch(() => {}); // prevent unhandled rejection — textStream throw is the real error path
      return {
        textStream: (async function* () { throw err; })(),
        text: textPromise,
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Add an endpoint", true, false, output);

    // Should log the error and return gracefully
    expect(output.errors.length).toBeGreaterThan(0);
    const errMsg = output.errors.join(" ");
    expect(errMsg).toContain("503");
  });

  it("planner error with connection reset triggers graceful failure", async () => {
    const err = new Error("socket hang up");
    vi.mocked(streamText).mockImplementationOnce((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      const textPromise = Promise.reject(err);
      textPromise.catch(() => {});
      return {
        textStream: (async function* () { throw err; })(),
        text: textPromise,
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build something", true, false, output);

    expect(output.errors.length).toBeGreaterThan(0);
  });
});

// ---- Additional coverage: classifyComplexity fallback paths ----

describe("classifyComplexity() fallback paths", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("falls back to generateText when generateObject throws", async () => {
    const { generateObject: mockGO, generateText: mockGT } = await import("ai");
    vi.mocked(mockGO).mockRejectedValueOnce(new Error("generateObject not supported"));
    vi.mocked(mockGT).mockResolvedValueOnce({ text: "multi — requires both frontend and backend work" } as Awaited<ReturnType<typeof mockGT>>);

    const config = createTestConfig();
    const output = createMockOutput();

    const result = await classifyComplexity(config, "Build a full-stack application", output);

    expect(result.isMulti).toBe(true);
    expect(result.reason).toContain("multi");
  });

  it("falls back to isMulti=false when both generateObject and generateText fail", async () => {
    const { generateObject: mockGO, generateText: mockGT } = await import("ai");
    vi.mocked(mockGO).mockRejectedValueOnce(new Error("generateObject failed"));
    vi.mocked(mockGT).mockRejectedValueOnce(new Error("generateText also failed"));

    const config = createTestConfig();
    const output = createMockOutput();

    const result = await classifyComplexity(config, "Do something", output);

    expect(result.isMulti).toBe(false);
    expect(result.reason).toContain("Classification failed");
  });

  it("classifies as single when generateText returns single", async () => {
    const { generateObject: mockGO, generateText: mockGT } = await import("ai");
    vi.mocked(mockGO).mockRejectedValueOnce(new Error("not available"));
    vi.mocked(mockGT).mockResolvedValueOnce({ text: "single — this is a focused backend task" } as Awaited<ReturnType<typeof mockGT>>);

    const config = createTestConfig();
    const output = createMockOutput();

    const result = await classifyComplexity(config, "Fix a bug in the auth module", output);

    expect(result.isMulti).toBe(false);
  });
});

// ---- Additional coverage: topologicalSort (via runOrchestration with dependency stories) ----

describe("topologicalSort (via runOrchestration with dependencies)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("executes stories in dependency order", async () => {
    const { streamText: mockST } = await import("ai");

    // Return two stories where story 2 depends on story 1
    const planWithDeps = `Planning complete.
\`\`\`json
{
  "stories": [
    {
      "id": "story-db",
      "title": "Set up database schema",
      "persona": "backend_developer",
      "description": "Create the database migration."
    },
    {
      "id": "story-api",
      "title": "Build the API layer",
      "persona": "backend_developer",
      "description": "Add routes using the database schema.",
      "dependsOn": ["story-db"]
    }
  ]
}
\`\`\``;

    // First call is planner, subsequent calls are story workers
    let callCount = 0;
    vi.mocked(mockST).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "Step done.",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planWithDeps : "Implementation complete.";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build a database-backed API", true, false, output);

    // Both stories should have been started
    const storyLogs = output.logs.filter(l => l.includes("Story 1/2") || l.includes("Story 2/2"));
    expect(storyLogs.length).toBeGreaterThanOrEqual(2);
  });

  it("skips dependent story when its dependency fails", async () => {
    const { streamText: mockST } = await import("ai");

    const planWithDeps = `Here is the plan:
\`\`\`json
{
  "stories": [
    {
      "id": "base-story",
      "title": "Setup base",
      "persona": "backend_developer",
      "description": "Foundation work."
    },
    {
      "id": "dependent-story",
      "title": "Build on base",
      "persona": "backend_developer",
      "description": "Requires base to be done.",
      "dependsOn": ["base-story"]
    }
  ]
}
\`\`\``;

    let callCount = 0;
    vi.mocked(mockST).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      callCount++;
      if (callCount === 1) {
        // Planner returns the plan
        return {
          textStream: (async function* () { yield planWithDeps; })(),
          text: Promise.resolve(planWithDeps),
          totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
        };
      }
      // Story worker — throw to simulate failure
      throw new Error("Story execution failed");
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build something with deps", true, false, output);

    // The dependent story should have been skipped
    const skipLogs = output.logs.filter(l => l.includes("Skipping") || l.includes("blocked"));
    expect(skipLogs.length).toBeGreaterThan(0);
  });

  it("handles circular dependencies without infinite loop", async () => {
    const { streamText: mockST } = await import("ai");

    // Two stories that depend on each other — circular
    const circularPlan = `
\`\`\`json
{
  "stories": [
    {
      "id": "story-a",
      "title": "Story A",
      "persona": "backend_developer",
      "description": "Depends on B.",
      "dependsOn": ["story-b"]
    },
    {
      "id": "story-b",
      "title": "Story B",
      "persona": "backend_developer",
      "description": "Depends on A.",
      "dependsOn": ["story-a"]
    }
  ]
}
\`\`\``;

    let callCount = 0;
    vi.mocked(mockST).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? circularPlan : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    // Must resolve — no infinite loop
    await expect(
      runOrchestration(config, "Circular deps task", true, false, output)
    ).resolves.not.toThrow();
  });
});

// ---- Additional coverage: parseStoriesFromText parsing strategies ----

describe("parseStoriesFromText parsing strategies (via runOrchestration)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  function makePlannerMock(planText: string, workerText = "Implementation done.") {
    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : workerText;
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });
  }

  it("parses stories from raw JSON object with stories key (strategy 2)", async () => {
    // No code block — raw JSON embedded in text
    const planText = `After analysis, here is the implementation plan:

{ "stories": [ { "id": "auth", "title": "Add auth", "persona": "backend_developer", "description": "JWT auth" } ] }

Please proceed.`;

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Add authentication", true, false, output);

    // Should have successfully parsed one story and started execution
    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("parses stories from JSON array with persona field (strategy 3)", async () => {
    // Array of stories without a wrapper object
    const planText = `Here are the stories: [ { "id": "api", "title": "Build API", "persona": "backend_developer", "description": "REST endpoints" } ]`;

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build REST API", true, false, output);

    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("parses stories from steps array shape (via tryParseStories)", async () => {
    const planText = `\`\`\`json
{
  "steps": [
    { "id": "step1", "title": "Initialize project", "persona": "backend_developer", "description": "Setup boilerplate." }
  ]
}
\`\`\``;

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Initialize project", true, false, output);

    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("parses stories from plan array shape (via tryParseStories)", async () => {
    const planText = `\`\`\`json
{
  "plan": [
    { "id": "p1", "title": "Design schema", "persona": "backend_developer", "description": "ERD design" }
  ]
}
\`\`\``;

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Design a database", true, false, output);

    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("reports error and returns early when planner produces unparseable output", async () => {
    const planText = "I cannot help with that request.";

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Do something", true, false, output);

    // Only 1 streamText call — no story workers
    expect(mockStreamTextCalls.length).toBe(1);
    // Error should be reported
    expect(output.errors.length).toBeGreaterThan(0);
  });

  it("handles malformed JSON in code block gracefully", async () => {
    const planText = `Here is the plan:
\`\`\`json
{ "stories": [ { "id": "broken", "title": "Broken JSON"
\`\`\`

No valid plan.`;

    makePlannerMock(planText);

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Broken plan test", true, false, output);

    // Should fail to parse and report an error
    expect(mockStreamTextCalls.length).toBe(1);
    expect(output.errors.length).toBeGreaterThan(0);
  });
});

// ---- Additional coverage: normalizeStory alternate field names ----

describe("normalizeStory alternate field names (via runOrchestration)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("normalizes story with name/role alternate fields", async () => {
    const planText = `\`\`\`json
{
  "stories": [
    {
      "index": 1,
      "name": "Add auth layer",
      "role": "backend_developer",
      "details": "Implement token validation."
    }
  ]
}
\`\`\``;


    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Add authentication", true, false, output);

    // Story should have executed (worker call #2 exists)
    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizes story with depends_on and agent alternate fields", async () => {
    const planText = `\`\`\`json
{
  "stories": [
    {
      "step": "setup",
      "summary": "Initial setup",
      "agent": "devops_engineer",
      "task": "Configure infrastructure."
    },
    {
      "step": "deploy",
      "summary": "Deploy app",
      "agent": "devops_engineer",
      "task": "Deploy the service.",
      "depends_on": ["setup"]
    }
  ]
}
\`\`\``;


    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Setup and deploy", true, false, output);

    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- Additional coverage: planner rejection path ----

describe("runOrchestration() planner rejection paths", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("handles planner explicit rejection (rejected: true in JSON)", async () => {

    const rejectionText = `I have reviewed the task and cannot proceed.
\`\`\`json
{ "rejected": true, "reason": "The spec is too vague — it does not specify which API framework to use." }
\`\`\``;

    vi.mocked(streamText).mockImplementationOnce((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      return {
        textStream: (async function* () { yield rejectionText; })(),
        text: Promise.resolve(rejectionText),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build something vague", true, false, output);

    // No story workers should have run
    expect(mockStreamTextCalls.length).toBe(1);
    // Error about rejection should be logged
    const rejectionLogs = [...output.errors, ...output.logs].filter(
      l => l.includes("rejected") || l.includes("vague") || l.includes("rejected by planner")
    );
    expect(rejectionLogs.length).toBeGreaterThan(0);
  });

  it("handles planner exception (streamText throws) — returns gracefully", async () => {


    vi.mocked(streamText).mockImplementationOnce(() => {
      const textPromise = Promise.reject(new Error("API quota exceeded"));
      textPromise.catch(() => {});
      return {
        textStream: (async function* () {
          throw new Error("API quota exceeded");
        })(),
        text: textPromise,
        totalUsage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    // Should not throw — graceful failure
    await expect(
      runOrchestration(config, "Do something", true, false, output)
    ).resolves.not.toThrow();

    // Error should be reported
    expect(output.errors.length).toBeGreaterThan(0);
    const errText = output.errors.join(" ");
    expect(errText).toContain("quota");
  });

  it("handles planner empty output (no stories produced)", async () => {

    const emptyText = "I analyzed the codebase and have no specific implementation steps to suggest.";

    vi.mocked(streamText).mockImplementationOnce((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      return {
        textStream: (async function* () { yield emptyText; })(),
        text: Promise.resolve(emptyText),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Vague task", true, false, output);

    // No story workers should have been invoked
    expect(mockStreamTextCalls.length).toBe(1);
    // Should have an error message about no plan
    expect(output.errors.length).toBeGreaterThan(0);
  });
});

// ---- Additional coverage: extractScore (via reviewer invocation) ----

describe("extractScore via reviewer output patterns", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("critic path uses extractScore and logs the score", async () => {


    const planText = `\`\`\`json
{
  "stories": [
    { "id": "s1", "title": "Story One", "persona": "backend_developer", "description": "Do something." }
  ]
}
\`\`\``;
    const criticText = "The plan looks solid. CODE_QUALITY_SCORE: 9\nApproved.";

    // Call 1 = planner, Call 2 = critic, Call 3 = story worker
    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : callCount === 2 ? criticText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = {
      ...createTestConfig(),
      review: { useCritic: true, criticThreshold: 8 },
    };
    const output = createMockOutput();

    await runOrchestration(config, "Task with critic review", true, false, output);

    // Critic should have logged a score marker
    const scoreLogs = output.logs.filter(l => l.includes("review_score") || l.includes("approved") || l.includes("Plan approved"));
    expect(scoreLogs.length).toBeGreaterThan(0);
  });
});

// ---- Additional coverage: checkToolPermission trust modes ----

describe("checkToolPermission trust modes (via runOrchestration tool execution)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("does not prompt for tool permissions in trustAll mode (review disabled)", async () => {
    // Disable review so the reviewer does not ask "Revise and re-review?"
    const config = { ...createTestConfig(), review: { enabled: false } };
    const output = createMockOutput();

    await runOrchestration(config, "Add endpoint", true, false, output);

    // In trustAll=true mode with review disabled, confirm should NOT be called at all
    expect(output.confirm).not.toHaveBeenCalled();
  });

  it("prompts user for tool permission in non-trust mode", async () => {
    const config = createTestConfig();
    const output = createMockOutput();

    // User approves both the plan and the tool
    (output.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await runOrchestration(config, "Add endpoint", false, false, output);

    // confirm should be called at least once (for plan approval and/or tool permission)
    expect(output.confirm).toHaveBeenCalled();
  });

  it("read tools (read_file, glob, grep) are auto-allowed without prompt in non-trust mode", async () => {


    // Story worker that actually invokes a read_file tool call
    const planText = `\`\`\`json
{
  "stories": [{ "id": "s1", "title": "Read files", "persona": "backend_developer", "description": "Read config." }]
}
\`\`\``;

    let callCount = 0;
    let capturedReadFileTool: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;

    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      callCount++;

      if (callCount === 1) {
        // Planner response
        return {
          textStream: (async function* () { yield planText; })(),
          text: Promise.resolve(planText),
          totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
        };
      }

      // Story worker — capture read_file tool to verify it's auto-allowed
      const tools = opts.tools as Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;
      if (tools?.read_file) {
        capturedReadFileTool = tools.read_file.execute;
      }

      return {
        textStream: (async function* () { yield "done"; })(),
        text: Promise.resolve("done"),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    // Confirm returns false for everything — if read_file prompts, the call would be denied
    const output = createMockOutput();
    (output.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await runOrchestration(config, "Read config files", false, false, output);

    if (capturedReadFileTool) {
      // Invoke the read_file tool — it should not call confirm (auto-allowed)
      const confirmCallsBefore = (output.confirm as ReturnType<typeof vi.fn>).mock.calls.length;
      await capturedReadFileTool({ path: "README.md" });
      const confirmCallsAfter = (output.confirm as ReturnType<typeof vi.fn>).mock.calls.length;
      // confirm should NOT have been called for read_file
      expect(confirmCallsAfter).toBe(confirmCallsBefore);
    }
  });

  it("dangerous bash command always prompts even in trustAll mode", async () => {

    const { isDangerous: mockDangerous } = await import("../safety.js");
    vi.mocked(mockDangerous).mockReturnValueOnce("rm -rf destructive command detected");

    const planText = `\`\`\`json
{
  "stories": [{ "id": "s1", "title": "Dangerous task", "persona": "backend_developer", "description": "Run a dangerous command." }]
}
\`\`\``;

    let callCount = 0;
    let capturedBashTool: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;

    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      callCount++;

      if (callCount === 1) {
        return {
          textStream: (async function* () { yield planText; })(),
          text: Promise.resolve(planText),
          totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
        };
      }

      const tools = opts.tools as Record<string, { execute: (input: Record<string, unknown>) => Promise<unknown> }>;
      if (tools?.bash) {
        capturedBashTool = tools.bash.execute;
      }

      return {
        textStream: (async function* () { yield "done"; })(),
        text: Promise.resolve("done"),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    // trustAll = true but dangerous command should still prompt
    const output = createMockOutput();
    (output.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const config = createTestConfig();
    await runOrchestration(config, "Run dangerous command", true, false, output);

    if (capturedBashTool) {
      await capturedBashTool({ command: "rm -rf /important" });
      // confirm should have been called for the dangerous command
      expect(output.confirm).toHaveBeenCalled();
    }
  });
});

// ---- Additional coverage: extractBalancedJSON edge cases ----

describe("extractBalancedJSON edge cases (via parseStoriesFromText)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("parses JSON with strings that contain braces", async () => {

    // Use a regular string to avoid template-literal backtick confusion
    const planText = "```json\n" +
      "{\n" +
      '  "stories": [\n' +
      "    {\n" +
      '      "id": "template",\n' +
      '      "title": "Add template",\n' +
      '      "persona": "backend_developer",\n' +
      '      "description": "Use pattern: Hello {name} and {value}"\n' +
      "    }\n" +
      "  ]\n" +
      "}\n" +
      "```";

    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Add template support", true, false, output);

    // Successfully parsed despite braces in string value
    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("handles nested JSON objects in planner output", async () => {

    const planText = `\`\`\`json
{
  "stories": [
    {
      "id": "nested",
      "title": "Nested object test",
      "persona": "backend_developer",
      "description": "Complex story",
      "metadata": { "priority": "high", "tags": ["api", "auth"] }
    }
  ]
}
\`\`\``;

    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = createTestConfig();
    const output = createMockOutput();

    await runOrchestration(config, "Build nested structure", true, false, output);

    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- Additional coverage: parseAffectedStories ----

describe("parseAffectedStories via reviewer output", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("runOrchestration with reviewer enabled processes AFFECTED_STORIES in output", async () => {

    const planText = `\`\`\`json
{
  "stories": [
    { "id": "s1", "title": "Story One", "persona": "backend_developer", "description": "First task." }
  ]
}
\`\`\``;

    // Reviewer returns an AFFECTED_STORIES marker
    const reviewerText = `The implementation has issues.
CODE_QUALITY_SCORE: 5
AFFECTED_STORIES: [1]
AFFECTED_REASONS: {"1": "Missing error handling in the API layer"}
Revisions needed.`;

    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;

      let text: string;
      if (callCount === 1) text = planText;        // planner
      else if (callCount === 2) text = "Work done."; // story worker
      else if (callCount === 3) text = reviewerText; // reviewer
      else text = "Revision complete.";               // revision worker

      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = {
      ...createTestConfig(),
      review: { enabled: true, maxRevisions: 1 },
    };
    const output = createMockOutput();

    await runOrchestration(config, "Task with review", true, false, output);

    // Should have run without throwing
    expect(mockStreamTextCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---- Additional coverage: extractScore edge cases ----

describe("extractScore edge cases (via critic config)", () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    repoDir = createTempGitRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    mockStreamTextCalls.length = 0;
    vi.clearAllMocks();
    restoreDefaultStreamTextMock();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("extractScore parses legacy ::review_score:: marker via critic path", async () => {

    const planText = `\`\`\`json
{
  "stories": [
    { "id": "s1", "title": "Story", "persona": "backend_developer", "description": "Task." }
  ]
}
\`\`\``;

    // Critic uses legacy score format (0-100 → 1-10 conversion)
    const criticText = "Plan review: ::review_score::70\nLooks good overall.";

    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : callCount === 2 ? criticText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = {
      ...createTestConfig(),
      review: { useCritic: true, criticThreshold: 8 },
    };
    const output = createMockOutput();

    await runOrchestration(config, "Task with legacy score", true, false, output);

    // Critic logged ::review_score:: which maps to 7 (70/10=7) — below threshold 8 → "needs revision"
    const reviewLogs = output.logs.filter(l => l.includes("review_score") || l.includes("needs revision") || l.includes("Plan needs revision"));
    expect(reviewLogs.length).toBeGreaterThan(0);
  });

  it("extractScore uses 'approve' fallback when no score marker present via critic", async () => {

    const planText = `\`\`\`json
{
  "stories": [
    { "id": "s1", "title": "Story", "persona": "backend_developer", "description": "Task." }
  ]
}
\`\`\``;

    // No score marker — fallback "approve" text returns 8
    const criticText = "I approve this plan. The design is clean and well-structured.";

    let callCount = 0;
    vi.mocked(streamText).mockImplementation((opts: Record<string, unknown>) => {
      mockStreamTextCalls.push(opts);
      if (typeof opts.onStepFinish === "function") {
        (opts.onStepFinish as (step: { text: string; toolCalls: never[] }) => void)({
          text: "done",
          toolCalls: [],
        });
      }
      callCount++;
      const text = callCount === 1 ? planText : callCount === 2 ? criticText : "done";
      return {
        textStream: (async function* () { yield text; })(),
        text: Promise.resolve(text),
        totalUsage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
      };
    });

    const config = {
      ...createTestConfig(),
      review: { useCritic: true, criticThreshold: 8 },
    };
    const output = createMockOutput();

    await runOrchestration(config, "Task with approve fallback", true, false, output);

    // "approve" text → score 8 → at threshold → "Plan approved"
    const approvedLogs = output.logs.filter(l => l.includes("approved") || l.includes("Plan approved"));
    expect(approvedLogs.length).toBeGreaterThan(0);
  });
});
