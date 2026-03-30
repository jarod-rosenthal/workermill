import { describe, it, expect, vi, beforeEach } from "vitest";

// Replicate BUILTIN_COMMANDS from Input.tsx (full list)
const BUILTIN_COMMANDS = [
  { name: "/as", desc: "Run task as persona" },
  { name: "/ship", desc: "Multi-expert orchestration" },
  { name: "/build", desc: "Alias for /ship" },
  { name: "/retry", desc: "Re-run last build" },
  { name: "/init", desc: "Generate WORKERMILL.md" },
  { name: "/setup", desc: "Re-run provider setup wizard" },
  { name: "/settings", desc: "View/change settings" },
  { name: "/permissions", desc: "Tool permissions" },
  { name: "/undo", desc: "Revert changes" },
  { name: "/diff", desc: "Preview changes" },
  { name: "/model", desc: "Show/switch model" },
  { name: "/plan", desc: "Toggle read-only mode" },
  { name: "/trust", desc: "Auto-approve tools" },
  { name: "/hooks", desc: "View tool hooks" },
  { name: "/skills", desc: "Custom commands" },
  { name: "/memories", desc: "View project memories" },
  { name: "/remember", desc: "Save a memory" },
  { name: "/forget", desc: "Remove a memory" },
  { name: "/personas", desc: "List/create personas" },
  { name: "/mcp", desc: "MCP server status" },
  { name: "/chrome", desc: "Open/close browser" },
  { name: "/voice", desc: "Voice input" },
  { name: "/schedule", desc: "Scheduled tasks" },
  { name: "/update", desc: "Update to latest" },
  { name: "/release-notes", desc: "Changelog" },
  { name: "/cost", desc: "Token costs" },
  { name: "/status", desc: "Session info" },
  { name: "/log", desc: "CLI log entries" },
  { name: "/git", desc: "Git status" },
  { name: "/sessions", desc: "Manage sessions" },
  { name: "/editor", desc: "Open $EDITOR" },
  { name: "/clear", desc: "Reset conversation" },
  { name: "/help", desc: "All commands" },
  { name: "/quit", desc: "Exit" },
];

// Replicate the completion filter function from Input.tsx (the useMemo body)
function getCompletions(
  value: string,
  readdirSync: (path: string) => string[]
): Array<{ name: string; desc: string }> {
  const shipMatch = value.match(/^\/(ship|build)\s+(.*)/);
  if (shipMatch) {
    const cmd = shipMatch[1];
    const partial = shipMatch[2].toLowerCase();
    try {
      const files = readdirSync(process.cwd())
        .filter((f) => f.endsWith(".md") && !f.startsWith("."))
        .sort();
      return files
        .filter(
          (f) =>
            f.toLowerCase().startsWith(partial) && f.toLowerCase() !== partial
        )
        .map((f) => ({ name: `/${cmd} ${f}`, desc: "" }));
    } catch {
      return [];
    }
  }
  if (!value.startsWith("/") || value.includes(" ")) return [];
  const query = value.toLowerCase();
  return BUILTIN_COMMANDS.filter(
    (c) => c.name.startsWith(query) && c.name !== query
  );
}

// Fake cwd files used across .md tests
const FAKE_FILES = [
  "README.md",
  "WORKERMILL.md",
  "CHANGELOG.md",
  "docs.txt",       // non-.md, should be ignored
  ".secrets.md",    // hidden, should be ignored
  "ship-plan.md",
];

describe("Input completion logic", () => {
  let mockReaddirSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReaddirSync = vi.fn(() => FAKE_FILES);
  });

  it("returns no completions for plain text (non-slash) input", () => {
    expect(getCompletions("hello", mockReaddirSync)).toEqual([]);
    expect(getCompletions("", mockReaddirSync)).toEqual([]);
    expect(getCompletions("ship something", mockReaddirSync)).toEqual([]);
  });

  it("returns no completions for slash command that has a space but is not /ship or /build", () => {
    expect(getCompletions("/settings foo", mockReaddirSync)).toEqual([]);
    expect(getCompletions("/model gpt-5", mockReaddirSync)).toEqual([]);
    expect(getCompletions("/as backend", mockReaddirSync)).toEqual([]);
  });

  it("filters BUILTIN_COMMANDS by prefix for partial /s input", () => {
    const results = getCompletions("/s", mockReaddirSync);
    const names = results.map((r) => r.name);
    // /ship, /settings, /sessions, /status, /schedule, /skills are all /s* commands
    expect(names).toContain("/ship");
    expect(names).toContain("/settings");
    expect(names).toContain("/sessions");
    expect(names).toContain("/status");
    expect(names).toContain("/schedule");
    expect(names).toContain("/skills");
    // Commands that don't start with /s must not appear
    expect(names).not.toContain("/build");
    expect(names).not.toContain("/help");
    expect(names).not.toContain("/quit");
  });

  it("filters BUILTIN_COMMANDS for /sh prefix", () => {
    const results = getCompletions("/sh", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship");
    expect(names).not.toContain("/settings");
    expect(names).not.toContain("/sessions");
  });

  it("excludes exact match — typing /ship exactly returns no /ship completion", () => {
    const results = getCompletions("/ship", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("/ship");
  });

  it("excludes exact match — typing /help returns no /help completion", () => {
    const results = getCompletions("/help", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("/help");
  });

  it("returns all commands for bare / prefix", () => {
    const results = getCompletions("/", mockReaddirSync);
    expect(results.length).toBe(BUILTIN_COMMANDS.length);
  });

  it("completes /ship with .md files from cwd", () => {
    const results = getCompletions("/ship ", mockReaddirSync);
    expect(mockReaddirSync).toHaveBeenCalled();
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship README.md");
    expect(names).toContain("/ship WORKERMILL.md");
    expect(names).toContain("/ship CHANGELOG.md");
    expect(names).toContain("/ship ship-plan.md");
    // Non-.md files must be excluded
    expect(names).not.toContain("/ship docs.txt");
    // Hidden files must be excluded
    expect(names).not.toContain("/ship .secrets.md");
  });

  it("completes /build with .md files from cwd", () => {
    const results = getCompletions("/build ", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/build README.md");
    expect(names).toContain("/build WORKERMILL.md");
    // Non-.md excluded
    expect(names).not.toContain("/build docs.txt");
    // Hidden excluded
    expect(names).not.toContain("/build .secrets.md");
  });

  it("filters .md files by partial match after /ship", () => {
    const results = getCompletions("/ship r", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship README.md");
    expect(names).not.toContain("/ship WORKERMILL.md");
    expect(names).not.toContain("/ship CHANGELOG.md");
  });

  it("filters .md files case-insensitively after /ship", () => {
    const results = getCompletions("/ship RE", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship README.md");
    expect(names).not.toContain("/ship WORKERMILL.md");
  });

  it("excludes exact .md match after /ship", () => {
    // Typing the full filename exactly should produce no match
    const results = getCompletions("/ship readme.md", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("/ship README.md");
  });

  it("returns empty for no matching commands (/xyz)", () => {
    const results = getCompletions("/xyz", mockReaddirSync);
    expect(results).toEqual([]);
  });

  it("returns empty when readdirSync throws (e.g. permission error)", () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error("EACCES");
    });
    const results = getCompletions("/ship ", mockReaddirSync);
    expect(results).toEqual([]);
  });

  it("hidden .md files are excluded from completions", () => {
    const results = getCompletions("/ship ", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("/ship .secrets.md");
  });

  it("non-.md files are excluded from /build completions", () => {
    const results = getCompletions("/build ", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).not.toContain("/build docs.txt");
  });

  it("results for /ship are sorted alphabetically", () => {
    const results = getCompletions("/ship ", mockReaddirSync);
    const names = results.map((r) => r.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it("completion entries for /ship have empty desc", () => {
    const results = getCompletions("/ship ", mockReaddirSync);
    for (const r of results) {
      expect(r.desc).toBe("");
    }
  });

  it("builtin command completions carry their desc string", () => {
    const results = getCompletions("/hel", mockReaddirSync);
    const help = results.find((r) => r.name === "/help");
    expect(help).toBeDefined();
    expect(help?.desc).toBe("All commands");
  });
});
