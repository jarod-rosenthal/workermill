import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks (must be declared before imports) ----

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ""),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    appendFileSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  appendFileSync: vi.fn(),
}));

vi.mock("../session.js", () => ({
  saveSession: vi.fn(),
  listSessions: vi.fn(() => []),
}));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    providers: { ollama: { model: "qwen3-coder:30b" } },
    default: "ollama",
  })),
  saveConfig: vi.fn(),
  resolveConfig: vi.fn(),
  loadProjectSettings: vi.fn(() => null),
  loadLocalSettings: vi.fn(() => null),
  saveProjectSettings: vi.fn(),
  saveLocalSettings: vi.fn(),
}));

vi.mock("../custom-commands.js", () => ({
  loadCustomCommands: vi.fn(() => []),
}));

vi.mock("../personas.js", () => ({
  listAvailablePersonas: vi.fn(() => ["backend_engineer", "frontend_engineer"]),
  loadPersona: vi.fn((slug: string) => ({
    name: slug.replace(/_/g, " "),
    slug,
    description: `A ${slug}`,
    systemPrompt: `You are ${slug}.`,
    tools: ["bash", "read_file"],
  })),
}));

vi.mock("../mcp-client.js", () => ({
  stopAllMCPServers: vi.fn(),
  hasMCPServers: vi.fn(() => false),
  hasMCPRegistered: vi.fn(() => false),
  getMCPTools: vi.fn(() => []),
  getMCPServerInfo: vi.fn(() => []),
}));

vi.mock("../memory.js", () => ({
  loadMemories: vi.fn(() => []),
  addMemory: vi.fn((_type: string, content: string) => ({ id: "mem-1", type: "preference", content })),
  removeMemory: vi.fn(() => false),
}));

vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  getLogPath: vi.fn(() => "/mock/path/cli.log"),
}));

// Mock dynamic imports used by /quit, /chrome, /voice, /schedule
vi.mock("../browser.js", () => ({
  browserOpen: vi.fn().mockResolvedValue("Browser opened"),
  browserClose: vi.fn().mockResolvedValue("Browser closed"),
  isBrowserOpen: vi.fn(() => false),
}));

vi.mock("../../../packages/engine/src/tools/lsp.js", () => ({
  shutdown: vi.fn(),
}));

vi.mock("../../../api/src/providers/index.js", () => ({
  getPricingEngine: vi.fn(() => ({ getModelPricing: vi.fn(() => null) })),
  hasProvider: vi.fn(() => false),
  listProviders: vi.fn(() => []),
  findModelInfo: vi.fn(() => null),
}));

vi.mock("../../../packages/engine/src/tools/sub-agent.js", () => ({
  cleanupStaleWorktrees: vi.fn(),
}));

vi.mock("../checkpoints.js", () => ({
  undoLast: vi.fn(() => []),
  undoFile: vi.fn(() => false),
  listCheckpoints: vi.fn(() => []),
  clearCheckpoints: vi.fn(),
}));

// ---- Imports ----

import { handleSlashCommand, type SlashCommandContext } from "../ui/slash-commands.ts";
import { execSync } from "child_process";
import fs from "fs";
import { listSessions, saveSession } from "../session.js";
import { loadConfig, saveConfig } from "../config.js";
import { undoLast, undoFile, listCheckpoints } from "../checkpoints.js";
import { loadCustomCommands } from "../custom-commands.js";
import { listAvailablePersonas, loadPersona } from "../personas.js";
import { stopAllMCPServers, hasMCPServers, hasMCPRegistered, getMCPTools } from "../mcp-client.js";
import { loadMemories, addMemory, removeMemory } from "../memory.js";

// ---- Helper ----

function createContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    addSystemMessage: vi.fn(),
    addUserMessage: vi.fn(),
    submit: vi.fn(),
    provider: "ollama",
    model: "qwen3-coder:30b",
    workingDir: "/tmp/test-project",
    session: {
      id: "abcd1234-5678-9abc-def0-123456789abc",
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      totalTokens: 5000,
      startedAt: "2026-03-30T10:00:00Z",
    },
    cost: 0.05,
    tokens: 1200,
    permissionMode: "default",
    trustAll: false,
    isTrustAll: () => false,
    planMode: false,
    setPlanMode: vi.fn(),
    setTrustAll: vi.fn(),
    allowTool: vi.fn(),
    denyTool: vi.fn(),
    orchestratorRunning: false,
    orchestratorPaused: false,
    pauseOrchestrator: vi.fn(),
    resumeOrchestrator: vi.fn(),
    cancelCurrentOperation: vi.fn(),
    isBusy: false,
    startOrchestrator: vi.fn(),
    startProgram: vi.fn(),
    retryOrchestrator: vi.fn().mockReturnValue(false),
    startReview: vi.fn(),
    lastBuildTask: null,
    setLastBuildTask: vi.fn(),
    sandboxed: false,
    exit: vi.fn(),
    updateRoleModels: vi.fn(),
    ...overrides,
  };
}

// ---- Tests ----

describe("handleSlashCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Non-slash input ----

  it("returns false for non-slash input", () => {
    const ctx = createContext();
    expect(handleSlashCommand("hello world", ctx)).toBe(false);
    expect(ctx.addSystemMessage).not.toHaveBeenCalled();
  });

  it("returns false for empty string", () => {
    const ctx = createContext();
    expect(handleSlashCommand("", ctx)).toBe(false);
  });

  it("returns false for input with only spaces", () => {
    const ctx = createContext();
    expect(handleSlashCommand("   ", ctx)).toBe(false);
  });

  // ---- /help ----

  describe("/help", () => {
    it("shows help text", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/help", ctx)).toBe(true);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("**WorkerMill**")
      );
    });

    it("/h is an alias", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/h", ctx)).toBe(true);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("**WorkerMill**")
      );
    });

    it("/? is an alias", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/?", ctx)).toBe(true);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("**WorkerMill**")
      );
    });

    it("appends custom commands if present", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([
        { name: "deploy", description: "Deploy to prod", prompt: "deploy it" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/help", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledTimes(2);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Custom Commands")
      );
    });
  });

  // ---- /model ----

  describe("/model", () => {
    it("shows current model with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/model", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("ollama/qwen3-coder:30b")
      );
    });

    it("switches model with provider/model arg", () => {
      process.env.ANTHROPIC_API_KEY = "sk-test-key";
      const ctx = createContext();
      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);
      expect(saveConfig).toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4-6")
      );
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("keeps current provider when only model name given", () => {
      const ctx = createContext();
      handleSlashCommand("/model llama3.1", ctx);
      expect(saveConfig).toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("ollama/llama3.1")
      );
    });

    it("handles null config gracefully", () => {
      process.env.ANTHROPIC_API_KEY = "sk-test-key";
      vi.mocked(loadConfig).mockReturnValueOnce(null);
      const ctx = createContext();
      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);
      // Should still show message, just not save
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Model switched")
      );
      expect(saveConfig).not.toHaveBeenCalled();
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("rejects switch to cloud provider without API key", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const ctx = createContext();
      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);
      expect(saveConfig).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("no API key found")
      );
    });
  });

  // ---- /cost ----

  describe("/cost", () => {
    it("shows cost values", () => {
      const ctx = createContext({ cost: 1.23, tokens: 45000 });
      handleSlashCommand("/cost", ctx);
      const msg = vi.mocked(ctx.addSystemMessage).mock.calls[0][0];
      expect(msg).toContain("$1.23");
      expect(msg).toContain("45,000");
      expect(msg).toContain("5,000"); // session totalTokens
      expect(msg).toContain("2"); // messages count
    });
  });

  // ---- /status ----

  describe("/status", () => {
    it("shows session info", () => {
      const ctx = createContext();
      handleSlashCommand("/status", ctx);
      const msg = vi.mocked(ctx.addSystemMessage).mock.calls[0][0];
      expect(msg).toContain("abcd1234");
      expect(msg).toContain("ollama/qwen3-coder:30b");
      expect(msg).toContain("/tmp/test-project");
      expect(msg).toContain("default");
    });

    it("shows bypassPermissions when permission mode is bypassPermissions", () => {
      const ctx = createContext({ permissionMode: "bypassPermissions" });
      handleSlashCommand("/status", ctx);
      const msg = vi.mocked(ctx.addSystemMessage).mock.calls[0][0];
      expect(msg).toContain("bypassPermissions");
    });
  });

  // ---- /trust ----

  describe("/trust", () => {
    it("enables trust mode", () => {
      const ctx = createContext();
      handleSlashCommand("/trust", ctx);
      expect(ctx.setTrustAll).toHaveBeenCalledWith(true);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Trust mode ON")
      );
    });
  });

  // ---- /ship and /build ----

  describe("/ship", () => {
    it("shows usage with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/ship", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
      expect(ctx.startOrchestrator).not.toHaveBeenCalled();
    });

    it("starts orchestrator with arg and isTrustAll getter", () => {
      const ctx = createContext();
      handleSlashCommand("/ship build a login page", ctx);
      expect(ctx.setLastBuildTask).toHaveBeenCalledWith("build a login page");
      expect(ctx.addUserMessage).toHaveBeenCalledWith("/ship build a login page");
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("build a login page", expect.any(Function), false);
      // The getter should return false in default mode
      const getter = vi.mocked(ctx.startOrchestrator).mock.calls[0][1] as () => boolean;
      expect(getter()).toBe(false);
    });

    it("isTrustAll getter returns true in bypassPermissions mode", () => {
      const ctx = createContext({ permissionMode: "bypassPermissions", isTrustAll: () => true });
      handleSlashCommand("/ship add auth", ctx);
      const getter = vi.mocked(ctx.startOrchestrator).mock.calls[0][1] as () => boolean;
      expect(getter()).toBe(true);
    });

    it("blocks when orchestrator is running", () => {
      const ctx = createContext({ orchestratorRunning: true });
      handleSlashCommand("/ship add auth", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("already running")
      );
      expect(ctx.startOrchestrator).not.toHaveBeenCalled();
    });

    it("/build is an alias for /ship", () => {
      const ctx = createContext();
      handleSlashCommand("/build add tests", ctx);
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("add tests", expect.any(Function), false);
    });
  });

  // ---- /program ----

  describe("/program", () => {
    it("shows usage with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/program", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
      expect(ctx.startProgram).not.toHaveBeenCalled();
    });

    it("starts program flow for a GitHub issue", () => {
      const ctx = createContext();
      handleSlashCommand("/program #120", ctx);
      expect(ctx.addUserMessage).toHaveBeenCalledWith("/program #120");
      expect(ctx.startProgram).toHaveBeenCalledWith("#120", expect.any(Function), false);
    });

    it("requires GitHub-style refs", () => {
      const ctx = createContext();
      handleSlashCommand("/program PROJ-123", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("GitHub parent issues only")
      );
      expect(ctx.startProgram).not.toHaveBeenCalled();
    });

    it("blocks when orchestrator is running", () => {
      const ctx = createContext({ orchestratorRunning: true });
      handleSlashCommand("/program #120", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("already running")
      );
      expect(ctx.startProgram).not.toHaveBeenCalled();
    });
  });

  // ---- /pause ----

  describe("/pause", () => {
    it("pauses a running orchestration", () => {
      const ctx = createContext({ orchestratorRunning: true, orchestratorPaused: false });
      handleSlashCommand("/pause", ctx);
      expect(ctx.pauseOrchestrator).toHaveBeenCalledTimes(1);
      expect(ctx.resumeOrchestrator).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Paused orchestration")
      );
    });

    it("resumes when already paused", () => {
      const ctx = createContext({ orchestratorRunning: true, orchestratorPaused: true });
      handleSlashCommand("/pause", ctx);
      expect(ctx.resumeOrchestrator).toHaveBeenCalledTimes(1);
      expect(ctx.pauseOrchestrator).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Resumed orchestration")
      );
    });

    it("reports when no orchestration is running", () => {
      const ctx = createContext({ orchestratorRunning: false });
      handleSlashCommand("/pause", ctx);
      expect(ctx.pauseOrchestrator).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No `/ship` orchestration is running")
      );
    });
  });

  // ---- /cancel ----

  describe("/cancel", () => {
    it("cancels when an operation is active", () => {
      const ctx = createContext({ isBusy: true });
      handleSlashCommand("/cancel", ctx);
      expect(ctx.cancelCurrentOperation).toHaveBeenCalledTimes(1);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Cancelling current operation")
      );
    });

    it("reports when nothing is running", () => {
      const ctx = createContext({ isBusy: false });
      handleSlashCommand("/cancel", ctx);
      expect(ctx.cancelCurrentOperation).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Nothing is currently running")
      );
    });
  });

  // ---- /retry ----

  describe("/retry", () => {
    it("shows error when nothing to retry", () => {
      const ctx = createContext();
      handleSlashCommand("/retry", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Nothing to retry")
      );
    });

    it("calls retryOrchestrator and succeeds", () => {
      const ctx = createContext({ retryOrchestrator: vi.fn().mockReturnValue(true) });
      handleSlashCommand("/retry", ctx);
      expect(ctx.addUserMessage).toHaveBeenCalledWith("/retry");
      expect(ctx.retryOrchestrator).toHaveBeenCalledWith(expect.any(Function), false);
      // Should NOT show error message when retry returns true
      expect(ctx.addSystemMessage).not.toHaveBeenCalled();
    });

    it("blocks when orchestrator is running", () => {
      const ctx = createContext({ orchestratorRunning: true });
      handleSlashCommand("/retry", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("already running")
      );
      expect(ctx.retryOrchestrator).not.toHaveBeenCalled();
    });
  });

  // ---- /undo ----

  describe("/undo", () => {
    it("defaults to file checkpoint undo — reports no checkpoints", () => {
      vi.mocked(undoLast).mockReturnValueOnce([]);
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No file checkpoints")
      );
    });

    it("restores files from checkpoint", () => {
      vi.mocked(undoLast).mockReturnValueOnce(["src/index.ts"]);
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Restored")
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("src/index.ts")
      );
    });

    it("lists checkpoints with /undo list", () => {
      vi.mocked(listCheckpoints).mockReturnValueOnce([
        { file: "src/index.ts", time: "12:00:00" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/undo list", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("src/index.ts")
      );
    });

    it("git undo: reports nothing to undo when clean and no commits", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status --porcelain
        .mockImplementationOnce(() => { throw new Error("no commits"); }); // git log fails
      const ctx = createContext();
      handleSlashCommand("/undo git", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Nothing to undo")
      );
    });

    it("git undo: stashes uncommitted changes", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("M src/index.ts\nM src/app.ts") // git status
        .mockReturnValueOnce(""); // git stash
      const ctx = createContext();
      handleSlashCommand("/undo git", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("stashed 2 changed files")
      );
    });

    it("git undo: resets last commit when tree is clean", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status (clean)
        .mockReturnValueOnce("Add feature X") // git log
        .mockReturnValueOnce(""); // git reset
      const ctx = createContext();
      handleSlashCommand("/undo git", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining('Undone')
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Add feature X")
      );
    });

    it("git undo: handles git errors gracefully", () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("not a git repo"); });
      const ctx = createContext();
      handleSlashCommand("/undo git", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Undo failed")
      );
    });
  });

  // ---- /diff ----

  describe("/diff", () => {
    it("shows diff on feature branch", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("feature/login") // git rev-parse --abbrev-ref HEAD
        .mockReturnValueOnce("") // git rev-parse --verify main (succeeds)
        .mockReturnValueOnce(" 2 files changed") // git diff --stat main..HEAD
        .mockReturnValueOnce("") // git ls-files --others
        .mockReturnValueOnce("+added line\n-removed line"); // git diff main..HEAD
      const ctx = createContext();
      handleSlashCommand("/diff", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("feature/login")
      );
    });

    it("reports clean tree when no changes", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("main") // on main branch
        .mockReturnValueOnce("") // diff stat empty
        .mockReturnValueOnce("") // untracked empty
        .mockReturnValueOnce(""); // diff empty
      const ctx = createContext();
      handleSlashCommand("/diff", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("clean")
      );
    });

    it("handles not-a-git-repo error", () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("not a git repo"); });
      const ctx = createContext();
      handleSlashCommand("/diff", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Not a git repository")
      );
    });
  });

  // ---- /clear ----

  describe("/clear", () => {
    it("resets session", () => {
      const session = {
        id: "test-id",
        messages: [{ role: "user", content: "hi" }],
        totalTokens: 1000,
        startedAt: "2026-03-30T10:00:00Z",
      };
      const ctx = createContext({ session });
      handleSlashCommand("/clear", ctx);
      expect(session.messages).toEqual([]);
      expect(session.totalTokens).toBe(0);
      expect(saveSession).toHaveBeenCalledWith(session);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Conversation cleared")
      );
    });
  });

  // ---- /git ----

  describe("/git", () => {
    it("shows branch and status", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("main") // git branch --show-current
        .mockReturnValueOnce("M index.ts"); // git status --short
      const ctx = createContext();
      handleSlashCommand("/git", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("main")
      );
    });
  });

  // ---- /sessions ----

  describe("/sessions", () => {
    it("reports no sessions", () => {
      vi.mocked(listSessions).mockReturnValueOnce([]);
      const ctx = createContext();
      handleSlashCommand("/sessions", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No saved sessions")
      );
    });

    it("lists sessions", () => {
      vi.mocked(listSessions).mockReturnValueOnce([
        {
          id: "sess-12345678",
          name: "My Session",
          preview: "preview text",
          messageCount: 10,
          totalTokens: 5000,
          startedAt: "2026-03-30T10:00:00Z",
        } as any,
      ]);
      const ctx = createContext();
      handleSlashCommand("/sessions", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("My Session")
      );
    });
  });

  // ---- /settings ----

  describe("/settings", () => {
    it("shows settings table with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/settings", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Ollama host")
      );
    });

    it("handles missing config", () => {
      vi.mocked(loadConfig).mockReturnValueOnce(null);
      const ctx = createContext();
      handleSlashCommand("/settings", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No config found")
      );
    });

    it("updates a known setting", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.enabled true", ctx);
      expect(saveConfig).toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Updated")
      );
    });

    it("rejects unknown setting", () => {
      const ctx = createContext();
      handleSlashCommand("/settings nonexistent.key value", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Unknown setting")
      );
    });

    it("shows usage when value is missing", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.enabled", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("/config is an alias for /settings", () => {
      const ctx = createContext();
      handleSlashCommand("/config", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Ollama host")
      );
    });
  });

  // ---- /permissions ----

  describe("/permissions", () => {
    it("shows current mode with no arg", () => {
      const ctx = createContext({ trustAll: false });
      handleSlashCommand("/permissions", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("default")
      );
    });

    it("shows bypassPermissions mode", () => {
      const ctx = createContext({ trustAll: true, permissionMode: "bypassPermissions" });
      handleSlashCommand("/permissions", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("bypassPermissions")
      );
    });

    it("trust action enables trust mode", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions trust", ctx);
      expect(ctx.setTrustAll).toHaveBeenCalledWith(true);
    });

    it("ask action disables trust mode", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions ask", ctx);
      expect(ctx.setTrustAll).toHaveBeenCalledWith(false);
    });

    it("allow action allows a specific tool", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions allow bash", ctx);
      expect(ctx.allowTool).toHaveBeenCalledWith("bash");
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Allowed")
      );
    });

    it("deny action denies a specific tool", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions deny write_file", ctx);
      expect(ctx.denyTool).toHaveBeenCalledWith("write_file");
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Denied")
      );
    });

    it("allow without tool name shows usage", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions allow", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("deny without tool name shows usage", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions deny", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("reset action resets to ask mode", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions reset", ctx);
      expect(ctx.setTrustAll).toHaveBeenCalledWith(false);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("reset")
      );
    });

    it("unknown action shows error", () => {
      const ctx = createContext();
      handleSlashCommand("/permissions foobar", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Unknown action")
      );
    });
  });

  // ---- /quit, /exit, /q ----

  describe("/quit", () => {
    it("calls exit", () => {
      const ctx = createContext();
      handleSlashCommand("/quit", ctx);
      expect(ctx.exit).toHaveBeenCalled();
      expect(stopAllMCPServers).toHaveBeenCalled();
    });

    it("/exit is an alias", () => {
      const ctx = createContext();
      handleSlashCommand("/exit", ctx);
      expect(ctx.exit).toHaveBeenCalled();
    });

    it("/q is an alias", () => {
      const ctx = createContext();
      handleSlashCommand("/q", ctx);
      expect(ctx.exit).toHaveBeenCalled();
    });

    it("works when exit is undefined", () => {
      const ctx = createContext({ exit: undefined });
      // Should not throw
      expect(() => handleSlashCommand("/quit", ctx)).not.toThrow();
    });
  });

  // ---- /hooks ----

  describe("/hooks", () => {
    it("shows no hooks message when none configured", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: {},
        default: "ollama",
      } as any);
      const ctx = createContext();
      handleSlashCommand("/hooks", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No hooks configured")
      );
    });

    it("shows hooks when configured", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: {},
        default: "ollama",
        hooks: {
          pre: [{ command: "echo before", tools: ["write_file"] }],
          post: [{ command: "npx eslint --fix", tools: ["write_file", "edit_file"] }],
        },
      } as any);
      const ctx = createContext();
      handleSlashCommand("/hooks", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Pre-tool hooks")
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Post-tool hooks")
      );
    });
  });

  // ---- /skills ----

  describe("/skills", () => {
    it("shows no custom commands message", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([]);
      const ctx = createContext();
      handleSlashCommand("/skills", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No custom commands found")
      );
    });

    it("lists custom commands", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([
        { name: "deploy", description: "Deploy to prod", prompt: "deploy it" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/skills", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("deploy")
      );
    });
  });

  // ---- /compact ----

  describe("/compact", () => {
    it("compacts when messages exist", () => {
      const session = {
        id: "test", startedAt: "2026-03-30T10:00:00Z", totalTokens: 5000,
        messages: [
          { role: "user", content: "a" }, { role: "assistant", content: "b" },
          { role: "user", content: "c" }, { role: "assistant", content: "d" },
          { role: "user", content: "e" }, { role: "assistant", content: "f" },
        ],
      };
      const forceCompact = vi.fn().mockResolvedValue({ before: 6, after: 3 });
      const ctx = createContext({ session } as any);
      (ctx as any).forceCompact = forceCompact;
      handleSlashCommand("/compact", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Compacting")
      );
      expect(forceCompact).toHaveBeenCalledWith(undefined);
    });

    it("passes focus instructions when provided", () => {
      const session = {
        id: "test", startedAt: "2026-03-30T10:00:00Z", totalTokens: 5000,
        messages: [
          { role: "user", content: "a" }, { role: "assistant", content: "b" },
          { role: "user", content: "c" }, { role: "assistant", content: "d" },
          { role: "user", content: "e" }, { role: "assistant", content: "f" },
        ],
      };
      const forceCompact = vi.fn().mockResolvedValue({ before: 6, after: 3 });
      const ctx = createContext({ session } as any);
      (ctx as any).forceCompact = forceCompact;
      handleSlashCommand("/compact focus on API changes", ctx);
      expect(forceCompact).toHaveBeenCalledWith("focus on API changes");
    });

    it("shows nothing-to-compact for empty conversations", () => {
      const ctx = createContext({ tokens: 0 });
      (ctx as any).forceCompact = vi.fn();
      handleSlashCommand("/compact", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("empty")
      );
    });
  });

  // ---- /init ----

  describe("/init", () => {
    it("generates WORKERMILL.md from scratch when not exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const ctx = createContext();
      handleSlashCommand("/init", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Analyzing codebase")
      );
      expect(ctx.submit).toHaveBeenCalledWith(
        expect.stringContaining("WORKERMILL.md"),
        expect.any(String),
      );
    });

    it("validates existing WORKERMILL.md when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const ctx = createContext();
      handleSlashCommand("/init", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Validating WORKERMILL.md")
      );
    });

    it("forces regeneration with --force", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const ctx = createContext();
      handleSlashCommand("/init --force", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Analyzing codebase")
      );
    });
  });

  // ---- /remember, /forget, /memories ----

  describe("/remember", () => {
    it("shows usage with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/remember", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("saves a memory", () => {
      const ctx = createContext();
      handleSlashCommand("/remember always use Prisma", ctx);
      expect(addMemory).toHaveBeenCalledWith("preference", "always use Prisma");
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Remembered")
      );
    });
  });

  describe("/forget", () => {
    it("shows usage with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/forget", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("removes a memory", () => {
      vi.mocked(removeMemory).mockReturnValueOnce(true);
      const ctx = createContext();
      handleSlashCommand("/forget prisma", ctx);
      expect(removeMemory).toHaveBeenCalledWith("prisma");
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Forgot")
      );
    });

    it("reports when memory not found", () => {
      vi.mocked(removeMemory).mockReturnValueOnce(false);
      const ctx = createContext();
      handleSlashCommand("/forget nonexistent", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No memory found")
      );
    });
  });

  describe("/memories", () => {
    it("reports no memories", () => {
      vi.mocked(loadMemories).mockReturnValueOnce([]);
      const ctx = createContext();
      handleSlashCommand("/memories", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No memories saved")
      );
    });

    it("lists memories", () => {
      vi.mocked(loadMemories).mockReturnValueOnce([
        { id: "mem-1", type: "preference", content: "Use Prisma", createdAt: "2026-03-30" } as any,
      ]);
      const ctx = createContext();
      handleSlashCommand("/memories", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Use Prisma")
      );
    });

    it("/memory is an alias", () => {
      vi.mocked(loadMemories).mockReturnValueOnce([]);
      const ctx = createContext();
      handleSlashCommand("/memory", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No memories saved")
      );
    });
  });

  // ---- /personas ----

  describe("/personas", () => {
    it("lists personas", () => {
      const ctx = createContext();
      handleSlashCommand("/personas", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Personas")
      );
    });

    it("shows a specific persona", () => {
      const ctx = createContext();
      handleSlashCommand("/personas show backend_engineer", ctx);
      expect(loadPersona).toHaveBeenCalledWith("backend_engineer");
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("System Prompt")
      );
    });

    it("reports unknown persona", () => {
      vi.mocked(loadPersona).mockReturnValueOnce(null as any);
      const ctx = createContext();
      handleSlashCommand("/personas show nonexistent", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });

    it("shows usage for invalid subcommand", () => {
      const ctx = createContext();
      handleSlashCommand("/personas invalid_sub", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });
  });

  // ---- /as ----

  describe("/as", () => {
    it("shows usage with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/as", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage")
      );
    });

    it("submits task with persona context", () => {
      const ctx = createContext();
      handleSlashCommand("/as backend_engineer review the auth middleware", ctx);
      expect(ctx.submit).toHaveBeenCalledWith(
        expect.stringContaining("review the auth middleware"),
        expect.any(String),
      );
    });

    it("reports unknown persona", () => {
      vi.mocked(loadPersona).mockReturnValueOnce(null as any);
      const ctx = createContext();
      handleSlashCommand("/as nonexistent_persona do something", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("not found")
      );
    });
  });

  // ---- /mcp ----

  describe("/mcp", () => {
    it("shows no MCP servers message", () => {
      const ctx = createContext();
      handleSlashCommand("/mcp", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No MCP servers configured")
      );
    });

    it("shows registered but not started message", () => {
      vi.mocked(hasMCPRegistered).mockReturnValueOnce(true);
      const ctx = createContext();
      handleSlashCommand("/mcp", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("MCP servers detected")
      );
    });

    it("shows active MCP tools", () => {
      vi.mocked(hasMCPServers).mockReturnValueOnce(true);
      vi.mocked(getMCPTools).mockReturnValueOnce([
        { serverName: "test-server", tool: { name: "tool1" } },
        { serverName: "test-server", tool: { name: "tool2" } },
      ] as any);
      const ctx = createContext();
      handleSlashCommand("/mcp", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("test-server")
      );
    });
  });

  // ---- /update ----

  describe("/update", () => {
    it("runs npm install and shows version", () => {
      vi.mocked(execSync).mockReturnValueOnce("added 1 package workermill@1.2.3");
      const ctx = createContext();
      handleSlashCommand("/update", ctx);
      // First call is "Updating...", second is the result
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Updated to v1.2.3")
      );
    });

    it("handles permission error", () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("EACCES permission denied"); });
      const ctx = createContext();
      handleSlashCommand("/update", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Permission denied")
      );
    });
  });

  // ---- /setup ----

  describe("/setup", () => {
    it("shows current config when config exists", () => {
      const ctx = createContext();
      handleSlashCommand("/setup", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Current config")
      );
    });

    it("reports no config when not found", () => {
      vi.mocked(loadConfig).mockReturnValueOnce(null);
      const ctx = createContext();
      handleSlashCommand("/setup", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No config found")
      );
    });
  });

  // ---- Unknown command / custom commands ----

  describe("unknown command", () => {
    it("reports unknown command", () => {
      const ctx = createContext();
      handleSlashCommand("/nonexistent", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Unknown command")
      );
    });

    it("dispatches custom command", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([
        { name: "deploy", description: "Deploy", prompt: "run deploy script" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/deploy", ctx);
      expect(ctx.addUserMessage).toHaveBeenCalledWith("/deploy");
      expect(ctx.submit).toHaveBeenCalledWith("run deploy script", "/deploy");
    });

    it("dispatches custom command with arg", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([
        { name: "deploy", description: "Deploy", prompt: "run deploy script" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/deploy staging", ctx);
      expect(ctx.submit).toHaveBeenCalledWith(
        expect.stringContaining("Additional context: staging"),
        "/deploy staging",
      );
    });
  });

  // ---- /review ----

  describe("/review", () => {
    it("shows usage help with no arg", () => {
      const ctx = createContext();
      handleSlashCommand("/review", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage"),
      );
      expect(ctx.startReview).not.toHaveBeenCalled();
    });

    it("starts review with a target", () => {
      const ctx = createContext();
      handleSlashCommand("/review branch", ctx);
      expect(ctx.startReview).toHaveBeenCalled();
    });

    it("blocks review when orchestrator is running", () => {
      const ctx = createContext({ orchestratorRunning: true });
      handleSlashCommand("/review branch", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("already running"),
      );
      expect(ctx.startReview).not.toHaveBeenCalled();
    });
  });

  // ---- /editor ----

  describe("/editor", () => {
    it("submits editor content when non-empty", () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce("Build a REST API for users");
      vi.mocked(execSync).mockReturnValue("" as any);
      const ctx = createContext();
      handleSlashCommand("/editor", ctx);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(ctx.addUserMessage).toHaveBeenCalledWith("Build a REST API for users");
      expect(ctx.submit).toHaveBeenCalledWith("Build a REST API for users");
    });

    it("shows message when editor closed with empty content", () => {
      vi.mocked(fs.readFileSync).mockReturnValueOnce("  \n  ");
      vi.mocked(execSync).mockReturnValue("" as any);
      const ctx = createContext();
      handleSlashCommand("/editor", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("no content"),
      );
      expect(ctx.submit).not.toHaveBeenCalled();
    });

    it("shows error when editor fails to open", () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("editor not found"); });
      const ctx = createContext();
      handleSlashCommand("/editor", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to open editor"),
      );
    });
  });

  // ---- /log ----

  describe("/log", () => {
    it("shows log entries when file exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValueOnce(
        "2026-03-30 10:00:00 INFO Starting\n2026-03-30 10:00:01 DEBUG Connected\n",
      );
      const ctx = createContext();
      handleSlashCommand("/log", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Last 20 log entries"),
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Starting"),
      );
    });

    it("shows message when no log file exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const ctx = createContext();
      handleSlashCommand("/log", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No log file found"),
      );
    });

    it("shows error on read failure", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error("EACCES"); });
      const ctx = createContext();
      handleSlashCommand("/log", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read log"),
      );
    });
  });

  // ---- /settings subcommands ----

  describe("/settings subcommands", () => {
    it("updates ollama.host", () => {
      const ctx = createContext();
      handleSlashCommand("/settings ollama.host http://192.168.1.10:11434", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            ollama: expect.objectContaining({ host: "http://192.168.1.10:11434" }),
          }),
        }),
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(expect.stringContaining("Updated"));
    });

    it("updates ollama.context", () => {
      const ctx = createContext();
      handleSlashCommand("/settings ollama.context 131072", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            ollama: expect.objectContaining({ contextLength: 131072 }),
          }),
        }),
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(expect.stringContaining("Updated"));
    });

    it("updates review.enabled true", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.enabled true", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ enabled: true }),
        }),
      );
    });

    it("updates review.enabled false", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.enabled false", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ enabled: false }),
        }),
      );
    });

    it("updates review.maxRevisions", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.maxRevisions 5", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ maxRevisions: 5 }),
        }),
      );
    });

    it("updates review.threshold", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.threshold 7", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ approvalThreshold: 7 }),
        }),
      );
    });

    it("updates review.autoRevise true", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.autoRevise true", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ autoRevise: true }),
        }),
      );
    });

    it("updates review.critic true", () => {
      const ctx = createContext();
      handleSlashCommand("/settings review.critic true", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          review: expect.objectContaining({ useCritic: true }),
        }),
      );
    });

    it("updates program.epicPrompt", () => {
      const ctx = createContext();
      handleSlashCommand("/settings program.epicPrompt always", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          program: expect.objectContaining({ epicPrompt: "always" }),
        }),
      );
    });

    it("rejects invalid program.epicPrompt", () => {
      const ctx = createContext();
      handleSlashCommand("/settings program.epicPrompt maybe", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Invalid value for `program.epicPrompt`")
      );
      expect(saveConfig).not.toHaveBeenCalled();
    });

    it("updates sandbox true/false", () => {
      const ctx = createContext();
      handleSlashCommand("/settings sandbox true", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: true }),
      );

      vi.clearAllMocks();
      handleSlashCommand("/settings sandbox false", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ sandbox: false }),
      );
    });

    it("sets API key for known provider", () => {
      const ctx = createContext();
      handleSlashCommand("/settings key anthropic sk-ant-test123", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            anthropic: expect.objectContaining({ apiKey: "sk-ant-test123" }),
          }),
        }),
      );
      expect(process.env.ANTHROPIC_API_KEY).toBe("sk-ant-test123");
      // Clean up
      delete process.env.ANTHROPIC_API_KEY;
    });

    it("sets API key for unknown provider (creates entry)", () => {
      const ctx = createContext();
      handleSlashCommand("/settings key xai xai-test-key", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            xai: expect.objectContaining({ apiKey: "xai-test-key" }),
          }),
        }),
      );
      delete process.env.XAI_API_KEY;
    });

    it("shows usage for key without enough args", () => {
      const ctx = createContext();
      handleSlashCommand("/settings key anthropic", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage"),
      );
    });

    it("routes persona to provider", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: { ollama: { model: "qwen3-coder:30b" }, anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test" } },
        default: "ollama",
      } as any);
      const ctx = createContext();
      handleSlashCommand("/settings route backend_developer anthropic", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          routing: expect.objectContaining({ backend_developer: "anthropic" }),
        }),
      );
    });

    it("rejects route to nonexistent provider", () => {
      const ctx = createContext();
      handleSlashCommand("/settings route backend_developer nonexistent", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("not found"),
      );
    });

    it("shows usage for route without enough args", () => {
      const ctx = createContext();
      handleSlashCommand("/settings route backend_developer", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Usage"),
      );
    });
  });

  // ---- /model with context size ----

  describe("/model with context size", () => {
    it("parses context size in k suffix", () => {
      const ctx = createContext();
      handleSlashCommand("/model ollama/qwen3-coder:30b 256k", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            ollama: expect.objectContaining({
              model: "qwen3-coder:30b",
              contextLength: 262144, // 256 * 1024
            }),
          }),
        }),
      );
    });

    it("parses context size in m suffix", () => {
      const ctx = createContext();
      handleSlashCommand("/model ollama/qwen3-coder:30b 1m", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          providers: expect.objectContaining({
            ollama: expect.objectContaining({
              contextLength: 1048576, // 1 * 1024 * 1024
            }),
          }),
        }),
      );
    });

    it("displays context label in switch message when switchModel is set", () => {
      const switchModel = vi.fn();
      const ctx = createContext({ switchModel } as any);
      handleSlashCommand("/model ollama/qwen3-coder:30b 256k", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("256k context"),
      );
    });
  });

  // ---- /model with chaining ----

  describe("/model with chaining", () => {
    it("dispatches trailing slash command after model switch", () => {
      process.env.OPENAI_API_KEY = "sk-test-key";
      const ctx = createContext();
      handleSlashCommand("/model openai/gpt-5.4 /as backend_developer fix auth", ctx);
      // Should have called saveConfig for model switch
      expect(saveConfig).toHaveBeenCalled();
      // The trailing /as command should be dispatched
      expect(ctx.submit).toHaveBeenCalledWith(
        expect.stringContaining("fix auth"),
        expect.any(String),
      );
      delete process.env.OPENAI_API_KEY;
    });

    it("submits trailing text as prompt when not a slash command", () => {
      process.env.OPENAI_API_KEY = "sk-test-key";
      const switchModel = vi.fn();
      const ctx = createContext({ switchModel } as any);
      handleSlashCommand("/model openai/gpt-5.4 explain this code", ctx);
      expect(saveConfig).toHaveBeenCalled();
      expect(ctx.submit).toHaveBeenCalledWith("explain this code");
      delete process.env.OPENAI_API_KEY;
    });
  });

  // ---- /model API key rejection for unknown provider ----

  describe("/model API key rejection", () => {
    it("rejects switch to provider that needs key but has none", () => {
      delete process.env.OPENAI_API_KEY;
      const ctx = createContext();
      handleSlashCommand("/model openai/gpt-5.4", ctx);
      expect(saveConfig).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("no API key found"),
      );
    });

    it("allows switch to ollama without API key", () => {
      const ctx = createContext();
      handleSlashCommand("/model ollama/llama3.1", ctx);
      // Ollama doesn't need a key, so should succeed
      expect(saveConfig).toHaveBeenCalled();
    });
  });

  // ---- /model planner|reviewer role switching ----

  describe("/model planner|reviewer", () => {
    it("switches planner model and updates routing", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: { ollama: { model: "qwen3-coder:30b" }, google: { model: "gemini-3.1-flash-lite-preview", apiKey: "key" } },
        default: "ollama",
      } as any);
      const ctx = createContext();
      handleSlashCommand("/model planner google/gemini-3.1-pro", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          routing: expect.objectContaining({ planner: "google_planner" }),
          providers: expect.objectContaining({
            google_planner: expect.objectContaining({ model: "gemini-3.1-pro" }),
          }),
        }),
      );
      expect(ctx.updateRoleModels).toHaveBeenCalled();
    });

    it("switches reviewer model and updates routing", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: { ollama: { model: "qwen3-coder:30b" }, openai: { model: "gpt-5.4", apiKey: "sk-test" } },
        default: "ollama",
      } as any);
      const ctx = createContext();
      handleSlashCommand("/model reviewer openai/gpt-5.3-codex", ctx);
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          routing: expect.objectContaining({ tech_lead: "openai_tech_lead" }),
          providers: expect.objectContaining({
            openai_tech_lead: expect.objectContaining({ model: "gpt-5.3-codex" }),
          }),
        }),
      );
      expect(ctx.updateRoleModels).toHaveBeenCalled();
    });

    it("rejects role switch to provider without API key", () => {
      delete process.env.OPENAI_API_KEY;
      const ctx = createContext();
      handleSlashCommand("/model reviewer openai/gpt-5.3-codex", ctx);
      expect(saveConfig).not.toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("no API key found"),
      );
    });

    it("does not call switchModel for role switches (only worker)", () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        providers: { ollama: { model: "qwen3-coder:30b" }, google: { model: "gemini-flash", apiKey: "key" } },
        default: "ollama",
      } as any);
      const switchModel = vi.fn();
      const ctx = createContext({ switchModel } as any);
      handleSlashCommand("/model planner google/gemini-3.1-pro", ctx);
      expect(switchModel).not.toHaveBeenCalled();
    });
  });

  // ---- /compact with focus preservation ----

  describe("/compact focus instructions", () => {
    it("preserves focus instructions passed as arg", () => {
      const session = {
        id: "test", startedAt: "2026-03-30T10:00:00Z", totalTokens: 5000,
        messages: [
          { role: "user", content: "a" }, { role: "assistant", content: "b" },
          { role: "user", content: "c" }, { role: "assistant", content: "d" },
        ],
      };
      const forceCompact = vi.fn().mockResolvedValue({ before: 4, after: 2 });
      const ctx = createContext({ session, tokens: 50000 } as any);
      (ctx as any).forceCompact = forceCompact;
      handleSlashCommand("/compact the API changes and database schema", ctx);
      expect(forceCompact).toHaveBeenCalledWith("the API changes and database schema");
    });

    it("includes focus text in compacting message", () => {
      const session = {
        id: "test", startedAt: "2026-03-30T10:00:00Z", totalTokens: 5000,
        messages: [
          { role: "user", content: "a" }, { role: "assistant", content: "b" },
          { role: "user", content: "c" }, { role: "assistant", content: "d" },
        ],
      };
      const forceCompact = vi.fn().mockResolvedValue({ before: 4, after: 2 });
      const ctx = createContext({ session, tokens: 50000 } as any);
      (ctx as any).forceCompact = forceCompact;
      handleSlashCommand("/compact the auth module", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("preserving: the auth module"),
      );
    });

    it("passes undefined when no focus arg given", () => {
      const session = {
        id: "test", startedAt: "2026-03-30T10:00:00Z", totalTokens: 5000,
        messages: [
          { role: "user", content: "a" }, { role: "assistant", content: "b" },
          { role: "user", content: "c" }, { role: "assistant", content: "d" },
        ],
      };
      const forceCompact = vi.fn().mockResolvedValue({ before: 4, after: 2 });
      const ctx = createContext({ session, tokens: 50000 } as any);
      (ctx as any).forceCompact = forceCompact;
      handleSlashCommand("/compact", ctx);
      expect(forceCompact).toHaveBeenCalledWith(undefined);
    });
  });

  // ---- /chrome and /voice are async, just verify they return true ----

  describe("/chrome", () => {
    it("returns true (async dispatch)", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/chrome", ctx)).toBe(true);
    });
  });

  describe("/voice", () => {
    it("returns true (async dispatch)", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/voice", ctx)).toBe(true);
    });
  });

  describe("/schedule", () => {
    it("returns true (async dispatch)", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/schedule", ctx)).toBe(true);
    });
  });

  // ---- Edge cases ----

  describe("edge cases", () => {
    it("handles commands with leading spaces", () => {
      const ctx = createContext();
      expect(handleSlashCommand("  /help", ctx)).toBe(true);
    });

    it("is case-insensitive", () => {
      const ctx = createContext();
      handleSlashCommand("/HELP", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("**WorkerMill**")
      );
    });

    it("handles /release-notes alias /changelog", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/changelog", ctx)).toBe(true);
    });

    it("handles /release-notes alias /releasenotes", () => {
      const ctx = createContext();
      expect(handleSlashCommand("/releasenotes", ctx)).toBe(true);
    });
  });
});
