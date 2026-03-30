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
}));

// Mock dynamic imports used by /quit, /chrome, /voice, /schedule
vi.mock("../browser.js", () => ({
  browserOpen: vi.fn().mockResolvedValue("Browser opened"),
  browserClose: vi.fn().mockResolvedValue("Browser closed"),
  isBrowserOpen: vi.fn(() => false),
}));

// ---- Imports ----

import { handleSlashCommand, type SlashCommandContext } from "../ui/slash-commands.js";
import { execSync } from "child_process";
import fs from "fs";
import { listSessions, saveSession } from "../session.js";
import { loadConfig, saveConfig } from "../config.js";
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
    permissionMode: "ask",
    trustAll: false,
    planMode: false,
    setPlanMode: vi.fn(),
    setTrustAll: vi.fn(),
    allowTool: vi.fn(),
    denyTool: vi.fn(),
    orchestratorRunning: false,
    startOrchestrator: vi.fn(),
    lastBuildTask: null,
    setLastBuildTask: vi.fn(),
    sandboxed: false,
    exit: vi.fn(),
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
      const ctx = createContext();
      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);
      expect(saveConfig).toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("anthropic/claude-sonnet-4-6")
      );
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
      vi.mocked(loadConfig).mockReturnValueOnce(null);
      const ctx = createContext();
      handleSlashCommand("/model anthropic/claude-sonnet-4-6", ctx);
      // Should still show message, just not save
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Model switched")
      );
      expect(saveConfig).not.toHaveBeenCalled();
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
      expect(msg).toContain("ask");
    });

    it("shows TRUST ALL when permission mode is trust all", () => {
      const ctx = createContext({ permissionMode: "trust all" });
      handleSlashCommand("/status", ctx);
      const msg = vi.mocked(ctx.addSystemMessage).mock.calls[0][0];
      expect(msg).toContain("TRUST ALL");
    });
  });

  // ---- /plan ----

  describe("/plan", () => {
    it("toggles plan mode ON when currently off", () => {
      const ctx = createContext({ planMode: false });
      handleSlashCommand("/plan", ctx);
      expect(ctx.setPlanMode).toHaveBeenCalledWith(true);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Plan mode ON")
      );
    });

    it("toggles plan mode OFF when currently on", () => {
      const ctx = createContext({ planMode: true });
      handleSlashCommand("/plan", ctx);
      expect(ctx.setPlanMode).toHaveBeenCalledWith(false);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Plan mode OFF")
      );
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

    it("starts orchestrator with arg", () => {
      const ctx = createContext();
      handleSlashCommand("/ship build a login page", ctx);
      expect(ctx.setLastBuildTask).toHaveBeenCalledWith("build a login page");
      expect(ctx.addUserMessage).toHaveBeenCalledWith("/ship build a login page");
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("build a login page", false, false);
    });

    it("starts orchestrator in trust mode when permissionMode is trust all", () => {
      const ctx = createContext({ permissionMode: "trust all" });
      handleSlashCommand("/ship add auth", ctx);
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("add auth", true, false);
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
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("add tests", false, false);
    });
  });

  // ---- /retry ----

  describe("/retry", () => {
    it("shows error with no previous task", () => {
      const ctx = createContext({ lastBuildTask: null });
      handleSlashCommand("/retry", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No previous task")
      );
    });

    it("restarts with last task", () => {
      const ctx = createContext({ lastBuildTask: "build login page" });
      handleSlashCommand("/retry", ctx);
      expect(ctx.addUserMessage).toHaveBeenCalledWith(
        expect.stringContaining("/retry")
      );
      expect(ctx.startOrchestrator).toHaveBeenCalledWith("build login page", false, false);
    });

    it("blocks when orchestrator is running", () => {
      const ctx = createContext({ orchestratorRunning: true, lastBuildTask: "task" });
      handleSlashCommand("/retry", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("already running")
      );
      expect(ctx.startOrchestrator).not.toHaveBeenCalled();
    });
  });

  // ---- /undo ----

  describe("/undo", () => {
    it("reports nothing to undo when clean and no commits", () => {
      // git status --porcelain returns empty (clean)
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status --porcelain
        .mockImplementationOnce(() => { throw new Error("no commits"); }); // git log fails
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Nothing to undo")
      );
    });

    it("stashes uncommitted changes", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("M src/index.ts\nM src/app.ts") // git status
        .mockReturnValueOnce(""); // git stash
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("stashed 2 changed files")
      );
    });

    it("resets last commit when tree is clean", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("") // git status (clean)
        .mockReturnValueOnce("Add feature X") // git log
        .mockReturnValueOnce(""); // git reset
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining('Undone')
      );
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Add feature X")
      );
    });

    it("handles git errors gracefully", () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("not a git repo"); });
      const ctx = createContext();
      handleSlashCommand("/undo", ctx);
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
        expect.stringContaining("ask")
      );
    });

    it("shows trust all mode", () => {
      const ctx = createContext({ trustAll: true });
      handleSlashCommand("/permissions", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("trust all")
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
    it("shows token info when tokens recorded", () => {
      const ctx = createContext({ tokens: 50000 });
      handleSlashCommand("/compact", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("50,000")
      );
    });

    it("shows no tokens message when none recorded", () => {
      const ctx = createContext({ tokens: 0 });
      handleSlashCommand("/compact", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("No token usage")
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
        expect.stringContaining("WORKERMILL.md")
      );
    });

    it("reviews existing WORKERMILL.md when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const ctx = createContext();
      handleSlashCommand("/init", ctx);
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Reviewing WORKERMILL.md")
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
        expect.stringContaining("review the auth middleware")
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
    it("clears config when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const ctx = createContext();
      handleSlashCommand("/setup", ctx);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(ctx.addSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("Config cleared")
      );
    });

    it("reports no config when not found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
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
      expect(ctx.submit).toHaveBeenCalledWith("run deploy script");
    });

    it("dispatches custom command with arg", () => {
      vi.mocked(loadCustomCommands).mockReturnValueOnce([
        { name: "deploy", description: "Deploy", prompt: "run deploy script" },
      ]);
      const ctx = createContext();
      handleSlashCommand("/deploy staging", ctx);
      expect(ctx.submit).toHaveBeenCalledWith(
        expect.stringContaining("Additional context: staging")
      );
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
