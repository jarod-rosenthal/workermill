import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { runOrchestration } from "../../orchestrator.js";
import type { CliConfig } from "../../config.js";
import { loadConfig, saveConfig } from "../../config.js";
import type { OrchestrationOutput } from "../../orchestrator.js";
import { handleSlashCommand } from "../../ui/slash-commands.js";
import type { SlashCommandContext } from "../../ui/slash-commands.js";
import { EngineAIClient } from "../../../../packages/engine/src/ai-client.js";
import type { StreamMessage, TokenUsage } from "../../../../packages/engine/src/types.js";
import { detectOllamaHost } from "../helpers/ollama-host.js";

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const TEST_REPO = "https://github.com/jarod-rosenthal/e2e-cli-tests";
const MODEL = "qwen3-coder:30b";

let OLLAMA_HOST = "";
let ollamaAvailable = false;
let originalCwd: string;

// Track temp dirs for cleanup
const tempDirs: string[] = [];

// Track remote branches/PRs for cleanup
const cleanupBranches: Array<{ dir: string; branch: string }> = [];
const cleanupPRs: Array<{ dir: string; prNumber: string }> = [];

// Backup config path
const CONFIG_DIR = path.join(os.homedir(), ".workermill");
const CONFIG_FILE = path.join(CONFIG_DIR, "cli.json");
let originalConfig: string | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneTestRepo(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-lifecycle-"));
  tempDirs.push(tempDir);
  execSync(`git clone ${TEST_REPO} .`, {
    cwd: tempDir,
    stdio: "pipe",
    timeout: 60_000,
  });
  execSync('git config user.email "e2e-test@workermill.dev"', { cwd: tempDir });
  execSync('git config user.name "E2E Test"', { cwd: tempDir });
  return tempDir;
}

function buildOllamaConfig(): CliConfig {
  return {
    providers: {
      ollama: {
        model: MODEL,
        host: OLLAMA_HOST,
        contextLength: 65536,
      },
    },
    default: "ollama",
  };
}

function buildMockContext(
  overrides: Partial<SlashCommandContext> & { workingDir: string },
): SlashCommandContext & {
  systemMessages: string[];
  userMessages: string[];
  submittedInputs: Array<{ input: string; displayText?: string }>;
} {
  const systemMessages: string[] = [];
  const userMessages: string[] = [];
  const submittedInputs: Array<{ input: string; displayText?: string }> = [];

  const ctx: SlashCommandContext & {
    systemMessages: string[];
    userMessages: string[];
    submittedInputs: Array<{ input: string; displayText?: string }>;
  } = {
    addSystemMessage: (content: string) => systemMessages.push(content),
    addUserMessage: (content: string) => userMessages.push(content),
    submit: (input: string, displayText?: string) =>
      submittedInputs.push({ input, displayText }),
    provider: "ollama",
    model: MODEL,
    workingDir: overrides.workingDir,
    session: {
      id: "test-session-" + Date.now(),
      messages: [],
      totalTokens: 0,
      startedAt: new Date().toISOString(),
    },
    cost: 0,
    tokens: 0,
    permissionMode: "bypassPermissions",
    trustAll: true,
    planMode: false,
    setPlanMode: () => {},
    setTrustAll: () => {},
    allowTool: () => {},
    denyTool: () => {},
    orchestratorRunning: false,
    startOrchestrator: () => {},
    startReview: () => {},
    retryOrchestrator: () => false,
    isTrustAll: () => true,
    lastBuildTask: null,
    setLastBuildTask: () => {},
    sandboxed: true,
    switchModel: undefined,
    updateRoleModels: undefined,
    forceCompact: undefined,
    // Expose captured calls for assertions
    systemMessages,
    userMessages,
    submittedInputs,
    // Apply overrides
    ...overrides,
  };

  return ctx;
}

function buildOrchestrationOutput(): {
  output: OrchestrationOutput;
  logs: string[];
} {
  const logs: string[] = [];
  const output: OrchestrationOutput = {
    log: (persona, message) => logs.push(`[${persona}] ${message}`),
    coordinatorLog: (message) => logs.push(`[coordinator] ${message}`),
    error: (message) => logs.push(`[error] ${message}`),
    status: () => {},
    statusDone: () => {},
    confirm: async () => true,
    toolCall: (persona, toolName) => logs.push(`[${persona}] Tool: ${toolName}`),
  };
  return { output, logs };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  originalCwd = process.cwd();

  // Backup existing config
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      originalConfig = fs.readFileSync(CONFIG_FILE, "utf-8");
    }
  } catch { /* no config */ }

  // Detect Ollama
  const host = await detectOllamaHost();
  if (!host) return;
  OLLAMA_HOST = host;
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = data.models ?? [];
    ollamaAvailable = models.some((m) => m.name.startsWith("qwen3-coder"));
  } catch {
    // Ollama not running
  }
});

afterEach(() => {
  process.chdir(originalCwd);
});

afterAll(async () => {
  // Restore original cwd
  process.chdir(originalCwd);

  // Clean up PRs first (must happen before branch deletion)
  for (const { dir, prNumber } of cleanupPRs) {
    try {
      execSync(`gh pr close ${prNumber} --delete-branch`, {
        cwd: dir,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // PR may already be closed
    }
  }

  // Clean up remote branches
  for (const { dir, branch } of cleanupBranches) {
    try {
      execSync(`git push origin --delete ${branch}`, {
        cwd: dir,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Branch may already be deleted
    }
  }

  // Clean up temp directories
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  // Restore original config
  if (originalConfig !== null) {
    fs.writeFileSync(CONFIG_FILE, originalConfig, "utf-8");
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI E2E — full lifecycle", () => {
  // =========================================================================
  // 1. Slash Command Tests
  // =========================================================================
  describe("slash commands (real config)", () => {
    it("/init — creates or validates AGENT.md in cloned repo", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      // Remove AGENT.md so /init triggers generation
      const agentPath = path.join(tempDir, "AGENT.md");
      if (fs.existsSync(agentPath)) fs.unlinkSync(agentPath);
      expect(fs.existsSync(agentPath)).toBe(false);

      const handled = handleSlashCommand("/init", ctx);
      expect(handled).toBe(true);

      // /init submits a prompt to the agent for codebase exploration
      expect(ctx.submittedInputs.length).toBe(1);
      expect(ctx.submittedInputs[0].input).toContain("Explore this codebase");
      expect(ctx.submittedInputs[0].input).toContain("AGENT.md");

      // Also verify the system message about analyzing codebase
      expect(ctx.systemMessages.some((m) => m.includes("Analyzing codebase"))).toBe(true);
    });

    it("/init — validates existing AGENT.md", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      // Create an AGENT.md so /init triggers validation path
      fs.writeFileSync(
        path.join(tempDir, "AGENT.md"),
        "# Test Project\n\nA simple Express app.\n",
      );

      const ctx = buildMockContext({ workingDir: tempDir });
      const handled = handleSlashCommand("/init", ctx);
      expect(handled).toBe(true);

      // Validation path — submits a different prompt
      expect(ctx.submittedInputs.length).toBe(1);
      // The submission should be the validation prompt, not the generation prompt
      expect(ctx.submittedInputs[0].input).toContain("Read the existing AGENT.md");
      expect(ctx.systemMessages.some((m) => m.includes("Validating AGENT.md"))).toBe(true);
    });

    it("/settings key ollama test-key — saves API key to config", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      // Save a config so /settings can load it
      const config = buildOllamaConfig();
      saveConfig(config);

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      const handled = handleSlashCommand("/settings key ollama test-key-12345", ctx);
      expect(handled).toBe(true);

      // Verify config was saved with the key
      const updated = loadConfig();
      expect(updated).not.toBeNull();
      expect(updated!.providers.ollama.apiKey).toBe("test-key-12345");

      // Verify confirmation message
      expect(ctx.systemMessages.some((m) => m.includes("Updated") && m.includes("key"))).toBe(true);
    });

    it("/settings route backend_developer ollama — saves routing", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      const handled = handleSlashCommand("/settings route backend_developer ollama", ctx);
      expect(handled).toBe(true);

      const updated = loadConfig();
      expect(updated).not.toBeNull();
      expect(updated!.routing?.backend_developer).toBe("ollama");

      expect(ctx.systemMessages.some((m) => m.includes("Updated") && m.includes("route"))).toBe(true);
    });

    it("/model ollama/qwen3-coder:30b 128k — switches model with context override", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      let switchedProvider = "";
      let switchedModel = "";

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        switchModel: (provider: string, model: string) => {
          switchedProvider = provider;
          switchedModel = model;
        },
      });

      const handled = handleSlashCommand("/model ollama/qwen3-coder:30b 128k", ctx);
      expect(handled).toBe(true);

      // Verify switchModel was called
      expect(switchedProvider).toBe("ollama");
      expect(switchedModel).toBe("qwen3-coder:30b");

      // Verify config was updated with context override
      const updated = loadConfig();
      expect(updated!.providers.ollama.contextLength).toBe(131072); // 128 * 1024

      // Verify system message about switch
      expect(ctx.systemMessages.some((m) => m.includes("Model switched") && m.includes("128k context"))).toBe(true);
    });

    it("/compact — calls forceCompact when tokens > 0", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      let compactCalled = false;
      let compactFocus: string | undefined;

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        tokens: 50000,
        forceCompact: async (focus?: string) => {
          compactCalled = true;
          compactFocus = focus;
          return { before: 100, after: 20 };
        },
      });
      ctx.session.messages = new Array(10).fill({ role: "user", content: "test" });

      const handled = handleSlashCommand("/compact", ctx);
      expect(handled).toBe(true);

      // forceCompact is async — wait for it
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(compactCalled).toBe(true);
      expect(compactFocus).toBeUndefined();

      // System message about compacting
      expect(ctx.systemMessages.some((m) => m.includes("Compacting"))).toBe(true);
    });

    it("/compact focus — passes focus instructions", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      let compactFocus: string | undefined;

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        tokens: 50000,
        forceCompact: async (focus?: string) => {
          compactFocus = focus;
          return { before: 100, after: 20 };
        },
      });
      ctx.session.messages = new Array(10).fill({ role: "user", content: "test" });

      handleSlashCommand("/compact the API changes", ctx);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(compactFocus).toBe("the API changes");
    });

    it("/diff — shows changes when a file is modified", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();

      // Make a change
      const indexPath = path.join(tempDir, "src", "index.js");
      const original = fs.readFileSync(indexPath, "utf-8");
      fs.writeFileSync(indexPath, original + "\n// e2e test change\n");

      const ctx = buildMockContext({ workingDir: tempDir });
      const handled = handleSlashCommand("/diff", ctx);
      expect(handled).toBe(true);

      // Should contain the diff with our change
      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("e2e test change");
    });

    it("/git — shows branch and status info", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      const handled = handleSlashCommand("/git", ctx);
      expect(handled).toBe(true);

      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Git branch");
      // Should be on main after clone
      expect(allMessages).toContain("main");
    });

    it("/as backend_developer — shows usage when no task given", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      const handled = handleSlashCommand("/as backend_developer", ctx);
      expect(handled).toBe(true);

      // No space after persona = no task = usage message
      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Usage");
      expect(allMessages).toContain("/as <persona> <task>");
      // Should NOT have submitted anything
      expect(ctx.submittedInputs.length).toBe(0);
    });

    it("/as backend_developer review the code — submits with persona", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      const handled = handleSlashCommand("/as backend_developer review the code", ctx);
      expect(handled).toBe(true);

      // Should have submitted with persona prefix
      expect(ctx.submittedInputs.length).toBe(1);
      expect(ctx.submittedInputs[0].input).toContain("Acting as");
      expect(ctx.submittedInputs[0].input).toContain("Backend Developer");
      expect(ctx.submittedInputs[0].input).toContain("review the code");
    });

    it("/review without args — shows usage", () => {
      const ctx = buildMockContext({ workingDir: process.cwd() });

      const handled = handleSlashCommand("/review", ctx);
      expect(handled).toBe(true);

      // Should show usage, not submit
      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Usage");
      expect(allMessages).toContain("/review");
    });

    it("/review with task — starts review", () => {
      const ctx = buildMockContext({ workingDir: process.cwd() });

      const handled = handleSlashCommand("/review branch", ctx);
      expect(handled).toBe(true);

      // Should call startReview, not submit
      expect(ctx.userMessages.length).toBe(1);
      expect(ctx.userMessages[0]).toContain("/review branch");
    });
  });

  // =========================================================================
  // 2. Single Agent Chat with Real Ollama
  // =========================================================================
  describe("single agent chat (real Ollama)", () => {
    it("should answer a question about the test repo", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      const messages: StreamMessage[] = [];
      let tokenUsage: TokenUsage | undefined;

      const result = await client.execute({
        systemPrompt:
          "You are a helpful developer assistant. Answer questions about the codebase. " +
          "Use the available tools to read files and understand the project.",
        prompt:
          "What does this project do? Read the main files to understand it. Give a brief answer.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 15,
        contextLength: 65536,
        onMessage: (msg) => messages.push(msg),
        onTokenUsage: (usage) => {
          tokenUsage = usage;
        },
      });

      expect(result.success).toBe(true);
      expect(result.text.length).toBeGreaterThan(0);

      // The response should mention Express, API, or items (the test repo is a simple Express app)
      const lowerText = result.text.toLowerCase();
      const mentionsProject =
        lowerText.includes("express") ||
        lowerText.includes("api") ||
        lowerText.includes("item") ||
        lowerText.includes("server") ||
        lowerText.includes("endpoint");
      expect(mentionsProject).toBe(true);

      // Should have used at least one tool to read files
      const toolUses = messages.filter((m) => m.type === "tool_use");
      expect(toolUses.length).toBeGreaterThan(0);

      // Token usage should be reported
      expect(tokenUsage).toBeDefined();
      expect(tokenUsage!.totalTokens).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. /ship Full Lifecycle with PR
  // =========================================================================
  describe("/ship lifecycle with PR", () => {
    it("should plan, execute, create branch, commit, and push a PR", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      process.chdir(tempDir);

      // Record initial state
      const initialBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      const initialHash = execSync("git rev-parse HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();

      const config = buildOllamaConfig();
      // Disable review to speed up the test
      config.review = { enabled: false };

      const { output, logs } = buildOrchestrationOutput();

      const result = await runOrchestration(
        config,
        "Add a DELETE /api/items/:id endpoint that removes an item by ID and returns 204 No Content. Add basic validation that ID is a number.",
        true, // trustAll
        true, // sandboxed
        output,
      );

      // Verify: orchestration completed with stories
      expect(result.stories.length).toBeGreaterThan(0);

      // Verify: feature branch was created
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();

      const hasFeatureBranch =
        currentBranch !== initialBranch || result.featureBranch !== null;
      expect(hasFeatureBranch).toBe(true);

      const branchForPR = result.featureBranch || currentBranch;

      // Verify: commits were made
      const currentHash = execSync("git rev-parse HEAD", {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(currentHash).not.toBe(initialHash);

      // Verify: some logs were produced (agent was working)
      expect(logs.length).toBeGreaterThan(0);

      // Verify: files were modified or created
      const diffStat = execSync(`git diff --stat ${initialBranch}..HEAD`, {
        cwd: tempDir,
        encoding: "utf-8",
      }).trim();
      expect(diffStat.length).toBeGreaterThan(0);

      // Push the branch and create a PR
      try {
        // Make sure we're on the feature branch
        if (currentBranch === initialBranch && result.featureBranch) {
          execSync(`git checkout ${result.featureBranch}`, {
            cwd: tempDir,
            stdio: "pipe",
          });
        }

        execSync(`git push origin HEAD:${branchForPR} --force`, {
          cwd: tempDir,
          stdio: "pipe",
          timeout: 60_000,
        });

        // Register for cleanup
        cleanupBranches.push({ dir: tempDir, branch: branchForPR });

        // Create PR
        const prOutput = execSync(
          `gh pr create --title "E2E test: DELETE endpoint" --body "Automated E2E test — will be closed automatically." --head ${branchForPR} --base main`,
          {
            cwd: tempDir,
            encoding: "utf-8",
            timeout: 30_000,
          },
        ).trim();

        // prOutput is the PR URL — extract PR number
        const prMatch = prOutput.match(/\/pull\/(\d+)/);
        expect(prMatch).not.toBeNull();
        const prNumber = prMatch![1];

        // Register for cleanup
        cleanupPRs.push({ dir: tempDir, prNumber });

        // Verify PR exists
        const prInfo = execSync(`gh pr view ${prNumber} --json state,title`, {
          cwd: tempDir,
          encoding: "utf-8",
          timeout: 15_000,
        });
        const prData = JSON.parse(prInfo);
        expect(prData.state).toBe("OPEN");
        expect(prData.title).toContain("DELETE");
      } catch (err) {
        // If PR creation fails (e.g. gh not authenticated), still verify the local work
        console.log(
          "PR creation skipped (gh auth may not be available):",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  });

  // =========================================================================
  // 4. /model Switch + Chat
  // =========================================================================
  describe("model switching", () => {
    it("should switch model via /model command", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      let switchedProvider = "";
      let switchedModel = "";

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        switchModel: (provider: string, model: string) => {
          switchedProvider = provider;
          switchedModel = model;
        },
      });

      // Switch to the same model (guaranteed to exist) — just verifies the plumbing
      handleSlashCommand(`/model ollama/${MODEL}`, ctx);

      expect(switchedProvider).toBe("ollama");
      expect(switchedModel).toBe(MODEL);
      expect(ctx.systemMessages.some((m) => m.includes("Model switched"))).toBe(true);
    });

    it("should handle model switch to a different ollama model if available", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      // Check if llama3.3:70b is available
      let altModelAvailable = false;
      const altModel = "llama3.3:70b";
      try {
        const res = await fetch(`${OLLAMA_HOST}/api/tags`);
        if (res.ok) {
          const data = (await res.json()) as { models?: Array<{ name: string }> };
          altModelAvailable = (data.models ?? []).some((m) =>
            m.name.startsWith("llama3.3"),
          );
        }
      } catch { /* ignore */ }

      if (!altModelAvailable) {
        console.log(`Skipping: ${altModel} not available on Ollama`);
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      let switchedModel = "";

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        switchModel: (_provider: string, model: string) => {
          switchedModel = model;
        },
      });

      handleSlashCommand(`/model ollama/${altModel}`, ctx);
      expect(switchedModel).toBe(altModel);
    });

    it("/model without args — shows current model info", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      handleSlashCommand("/model", ctx);

      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Current model");
      expect(allMessages).toContain(MODEL);
    });
  });

  // =========================================================================
  // 5. Error Recovery
  // =========================================================================
  describe("error recovery", () => {
    it("handles unknown slash command gracefully", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      // Unknown command — handleSlashCommand returns true for any /command
      // but should not crash
      const handled = handleSlashCommand("/nonexistent_command_xyz", ctx);
      // The function may return true (handled but unknown) or false (not recognized)
      // Either way, no crash
      expect(typeof handled).toBe("boolean");
    });

    it("/settings with bad provider for routing — shows error", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      handleSlashCommand("/settings route backend_developer nonexistent_provider", ctx);

      // Should show error about provider not found
      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("not found");
    });

    it("/diff in non-git directory — handles gracefully", () => {
      // Create a temp dir that is NOT a git repo
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-e2e-nongit-"));
      tempDirs.push(nonGitDir);

      const ctx = buildMockContext({ workingDir: nonGitDir });
      const handled = handleSlashCommand("/diff", ctx);
      expect(handled).toBe(true);

      // Should show a message about not being a git repo
      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("git");
    });

    it("/model with bad provider and no key — shows credential error", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const config = buildOllamaConfig();
      saveConfig(config);

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      // Clear any env keys for anthropic
      const origKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);

      // Restore
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;

      // Should show "no API key" message (unless env key was set)
      const allMessages = ctx.systemMessages.join("\n");
      // Either it switches successfully (key was in config) or shows an error
      expect(
        allMessages.includes("Model switched") || allMessages.includes("no API key") || allMessages.includes("Cannot switch"),
      ).toBe(true);
    });

    it("/compact with empty conversation — shows nothing-to-compact message", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({
        workingDir: tempDir,
        tokens: 0,
        forceCompact: async () => ({ before: 0, after: 0 }),
      });

      handleSlashCommand("/compact", ctx);

      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Nothing to compact");
    });

    it("/ship with no arguments — shows usage", () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();
      const ctx = buildMockContext({ workingDir: tempDir });

      handleSlashCommand("/ship", ctx);

      const allMessages = ctx.systemMessages.join("\n");
      expect(allMessages).toContain("Usage");
      expect(allMessages).toContain("/build <task>");
      expect(allMessages).toContain("`/ship` is also accepted as an alias");
    });

    it("EngineAIClient handles timeout gracefully", async () => {
      if (!ollamaAvailable) {
        console.log("Skipping: Ollama not available");
        return;
      }

      const tempDir = cloneTestRepo();

      const client = new EngineAIClient({
        provider: "ollama",
        apiKeys: { ollamaHost: OLLAMA_HOST },
      });

      // Use an extremely short timeout to force a timeout error
      const result = await client.execute({
        systemPrompt: "You are a helpful assistant.",
        prompt: "Write a 10000 word essay about the history of computing.",
        persona: "backend_developer",
        model: MODEL,
        workingDir: tempDir,
        maxTurns: 1,
        timeoutMs: 1, // 1ms — guaranteed to timeout
        contextLength: 65536,
      });

      // Should return a failure, not throw
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
