/**
 * Tests for buildSystemPrompt() in system-prompt.ts.
 *
 * Mocks: fs (for instruction file detection), mcp-client (for MCP tools),
 * memory module (for learnings), and instructions module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../memory.js", () => ({
  loadMemories: vi.fn(() => []),
  formatMemoriesForPrompt: vi.fn(() => ""),
  migrateOldLearnings: vi.fn(),
  extractMemoryMarkers: vi.fn(() => []),
  addMemory: vi.fn(),
}));

vi.mock("../instructions.js", () => ({
  formatProjectInstructions: vi.fn(() => ""),
}));

vi.mock("../mcp-client.js", () => ({
  getMCPTools: vi.fn(() => []),
  getMCPToolDefinitions: vi.fn(() => ({})),
  stopAllMCPServers: vi.fn(),
  autoDetectMCPServers: vi.fn(() => ({})),
  registerMCPServers: vi.fn(),
  hasMCPRegistered: vi.fn(() => false),
}));

import { buildSystemPrompt } from "../ui/system-prompt.js";
import { loadMemories, formatMemoriesForPrompt, migrateOldLearnings } from "../memory.js";
import { formatProjectInstructions } from "../instructions.js";
import { getMCPTools } from "../mcp-client.js";

const mockLoadMemories = vi.mocked(loadMemories);
const mockFormatMemoriesForPrompt = vi.mocked(formatMemoriesForPrompt);
const mockMigrateOldLearnings = vi.mocked(migrateOldLearnings);
const mockFormatProjectInstructions = vi.mocked(formatProjectInstructions);
const mockGetMCPTools = vi.mocked(getMCPTools);

describe("buildSystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadMemories.mockReturnValue([]);
    mockFormatMemoriesForPrompt.mockReturnValue("");
    mockMigrateOldLearnings.mockReturnValue(undefined);
    mockFormatProjectInstructions.mockReturnValue("");
    mockGetMCPTools.mockReturnValue([]);
  });

  it("returns a non-empty string", () => {
    const prompt = buildSystemPrompt("/home/user/project");
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes working directory in the prompt", () => {
    const prompt = buildSystemPrompt("/home/user/myproject");
    expect(prompt).toContain("Working directory: /home/user/myproject");
  });

  it("reflects a different working directory", () => {
    const prompt = buildSystemPrompt("/var/app/backend");
    expect(prompt).toContain("Working directory: /var/app/backend");
  });

  it("calls migrateOldLearnings on every invocation", () => {
    buildSystemPrompt("/some/dir");
    expect(mockMigrateOldLearnings).toHaveBeenCalledOnce();
  });

  it("includes project instructions when formatProjectInstructions returns content", () => {
    mockFormatProjectInstructions.mockReturnValue("\n\n## Project Instructions\n\nUse pnpm.");
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("## Project Instructions");
    expect(prompt).toContain("Use pnpm.");
  });

  it("passes workingDir to formatProjectInstructions", () => {
    buildSystemPrompt("/specific/dir");
    expect(mockFormatProjectInstructions).toHaveBeenCalledWith("/specific/dir");
  });

  it("does not include project instructions section when none found", () => {
    mockFormatProjectInstructions.mockReturnValue("");
    const prompt = buildSystemPrompt("/project");
    expect(prompt).not.toContain("## Project Instructions");
  });

  it("includes memory content when formatMemoriesForPrompt returns content", () => {
    mockFormatMemoriesForPrompt.mockReturnValue("\n\n## Memories\n\n- Use TypeScript strict mode.");
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("## Memories");
    expect(prompt).toContain("Use TypeScript strict mode.");
  });

  it("calls loadMemories and passes result to formatMemoriesForPrompt", () => {
    const fakeMemories = [{ id: "1", type: "learning" as const, content: "Test note", createdAt: "2026-01-01" }];
    mockLoadMemories.mockReturnValue(fakeMemories);
    buildSystemPrompt("/project");
    expect(mockLoadMemories).toHaveBeenCalledOnce();
    expect(mockFormatMemoriesForPrompt).toHaveBeenCalledWith(fakeMemories);
  });

  it("falls back gracefully when no instruction files exist", () => {
    mockFormatProjectInstructions.mockReturnValue("");
    mockFormatMemoriesForPrompt.mockReturnValue("");
    mockGetMCPTools.mockReturnValue([]);

    const prompt = buildSystemPrompt("/tmp/empty-project");
    // Should still have the base prompt with working directory
    expect(prompt).toContain("Working directory: /tmp/empty-project");
    expect(prompt).toContain("senior coding assistant");
    expect(prompt).not.toContain("## Project Instructions");
    expect(prompt).not.toContain("## MCP Tools");
  });

  describe("MCP tool awareness", () => {
    it("includes MCP tool instructions when MCP servers are active", () => {
      mockGetMCPTools.mockReturnValue([
        { serverName: "filesystem", tool: { name: "read_file", description: "Read a file", inputSchema: {} } },
      ] as ReturnType<typeof getMCPTools>);
      const prompt = buildSystemPrompt("/project");
      expect(prompt).toContain("## MCP Tools");
      expect(prompt).toContain("filesystem");
      expect(prompt).toContain("1 MCP server(s)");
      expect(prompt).toContain("mcp__<server>__");
    });

    it("lists all unique server names in the MCP section", () => {
      mockGetMCPTools.mockReturnValue([
        { serverName: "filesystem", tool: { name: "read_file", description: "Read", inputSchema: {} } },
        { serverName: "filesystem", tool: { name: "write_file", description: "Write", inputSchema: {} } },
        { serverName: "git", tool: { name: "status", description: "Git status", inputSchema: {} } },
      ] as ReturnType<typeof getMCPTools>);
      const prompt = buildSystemPrompt("/project");
      expect(prompt).toContain("2 MCP server(s)");
      expect(prompt).toContain("filesystem");
      expect(prompt).toContain("git");
    });

    it("omits MCP section when no MCP tools are registered", () => {
      mockGetMCPTools.mockReturnValue([]);
      const prompt = buildSystemPrompt("/project");
      expect(prompt).not.toContain("## MCP Tools");
    });

    it("deduplicates server names from multiple tools on same server", () => {
      mockGetMCPTools.mockReturnValue([
        { serverName: "github", tool: { name: "tool1", inputSchema: {} } },
        { serverName: "github", tool: { name: "tool2", inputSchema: {} } },
        { serverName: "github", tool: { name: "tool3", inputSchema: {} } },
      ] as ReturnType<typeof getMCPTools>);
      const prompt = buildSystemPrompt("/project");
      expect(prompt).toContain("1 MCP server(s)");
    });

    it("includes confidence instruction for MCP tools", () => {
      mockGetMCPTools.mockReturnValue([
        { serverName: "slack", tool: { name: "send", inputSchema: {} } },
      ] as ReturnType<typeof getMCPTools>);
      const prompt = buildSystemPrompt("/project");
      expect(prompt).toContain("Use them confidently");
      expect(prompt).toContain("trust those results");
    });
  });

  it("contains WorkerMill mention in about section", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("WorkerMill");
    expect(prompt).toContain("workermill.com");
  });

  it("contains ::learning:: marker instructions", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("::learning::");
  });

  it("contains ::remember:: marker instructions", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("::remember::");
  });

  it("contains conciseness guideline", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("Be concise");
  });

  it("contains rule against long-running processes", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("NEVER start long-running processes");
  });

  it("contains communication style instructions", () => {
    const prompt = buildSystemPrompt("/project");
    expect(prompt).toContain("Direct. No filler");
  });
});
