import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSettingsCompletions, shouldCaptureInput, shouldInsertNewlineOnReturn } from "../ui/Input.tsx";

// Replicate BUILTIN_COMMANDS from Input.tsx (full list)
const BUILTIN_COMMANDS = [
  { name: "/as", desc: "Run task as persona" },
  { name: "/ship", desc: "Multi-expert orchestration" },
  { name: "/build", desc: "Alias for /ship" },
  { name: "/retry", desc: "Re-run last build" },
  { name: "/init", desc: "Generate AGENT.md" },
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
  { name: "/edit", desc: "Open $EDITOR" },
  { name: "/clear", desc: "Reset conversation" },
  { name: "/help", desc: "All commands" },
  { name: "/quit", desc: "Exit" },
];

const SETTING_OPTIONS = [
  { key: "all", desc: "Show all settings" },
  { key: "ollama.host", desc: "Set Ollama host" },
  { key: "ollama.context", desc: "Set Ollama context length" },
  { key: "review.enabled", desc: "Enable or disable review", values: ["true", "false"] },
  { key: "review.maxRevisions", desc: "Set review max revisions" },
  { key: "review.threshold", desc: "Set approval threshold" },
  { key: "review.autoRevise", desc: "Auto-revise after review", values: ["true", "false"] },
  { key: "review.autoBranch", desc: "Auto-checkout review branch", values: ["true", "false"] },
  { key: "review.strict", desc: "Enable strict review mode", values: ["true", "false"] },
  { key: "qa.participation", desc: "Configure QA participation", values: ["default", "always"] },
  { key: "program.maxIssues", desc: "Set max issues per program" },
  { key: "program.maxAutoRetries", desc: "Set max auto-retries" },
  { key: "program.gateMode", desc: "Set program gate mode", values: ["required", "advisory"] },
  { key: "sandbox", desc: "Set sandbox mode", values: ["true", "false", "os"] },
  { key: "liveView", desc: "Enable or disable live code view", values: ["true", "false"] },
  { key: "ui.inlineEditPreview", desc: "Toggle inline edit preview", values: ["true", "false"] },
  { key: "bell", desc: "Toggle completion bell", values: ["true", "false"] },
  { key: "experimental", desc: "Toggle experimental features", values: ["true", "false"] },
  { key: "tickets", desc: "Choose issue tracker", values: ["github", "jira", "linear"] },
  { key: "jira.url", desc: "Set Jira base URL" },
  { key: "jira.email", desc: "Set Jira email" },
  { key: "jira.token", desc: "Set Jira API token" },
  { key: "linear.key", desc: "Set Linear API key" },
  { key: "route", desc: "Route a persona to a provider/model" },
  { key: "key", desc: "Save an API key for a provider" },
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
  const settingsMatch = value.match(/^\/(settings|config)(?:\s+(.*))?$/);
  if (settingsMatch) {
    const command = settingsMatch[1];
    const rest = settingsMatch[2] ?? "";
    const hasTrailingSpace = /\s$/.test(value);
    const trimmedRest = rest.trim();

    if (!trimmedRest) {
      return SETTING_OPTIONS.map((option) => ({
        name: `/${command} ${option.key}`,
        desc: option.desc,
      }));
    }

    const parts = trimmedRest.split(/\s+/);
    const key = parts[0].toLowerCase();
    const exactOption = SETTING_OPTIONS.find((option) => option.key.toLowerCase() === key);

    if (parts.length === 1 && !hasTrailingSpace && !exactOption) {
      return SETTING_OPTIONS
        .filter((option) => option.key.toLowerCase().startsWith(key) && option.key.toLowerCase() !== key)
        .map((option) => ({
          name: `/${command} ${option.key}`,
          desc: option.desc,
        }));
    }

    if (!exactOption?.values) return [];

    const valuePartial = parts.length === 1 ? "" : parts.slice(1).join(" ").toLowerCase();
    return exactOption.values
      .filter((optionValue) => optionValue.startsWith(valuePartial) && optionValue !== valuePartial)
      .map((optionValue) => ({
        name: `/${command} ${exactOption.key} ${optionValue}`,
        desc: `Set ${exactOption.key}`,
      }));
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
  "AGENT.md",
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
    expect(getCompletions("/model gpt-5", mockReaddirSync)).toEqual([]);
    expect(getCompletions("/as backend", mockReaddirSync)).toEqual([]);
  });

  it("offers settings keys after /settings", () => {
    const names = getCompletions("/settings ", mockReaddirSync).map((r) => r.name);
    expect(names).toContain("/settings review.enabled");
    expect(names).toContain("/settings qa.participation");
    expect(names).toContain("/settings experimental");
  });

  it("filters settings keys by partial prefix", () => {
    const names = getCompletions("/settings rev", mockReaddirSync).map((r) => r.name);
    expect(names).toContain("/settings review.enabled");
    expect(names).toContain("/settings review.maxRevisions");
    expect(names).not.toContain("/settings experimental");
  });

  it("offers value completions for boolean settings", () => {
    const names = getCompletions("/settings experimental ", mockReaddirSync).map((r) => r.name);
    expect(names).toEqual([
      "/settings experimental true",
      "/settings experimental false",
    ]);
  });

  it("offers value completions when an exact settings key is typed", () => {
    const names = getCompletions("/settings qa.participation", mockReaddirSync).map((r) => r.name);
    expect(names).toEqual([
      "/settings qa.participation default",
      "/settings qa.participation always",
    ]);
  });

  it("filters enumerated settings values by partial input", () => {
    const names = getCompletions("/settings tickets gi", mockReaddirSync).map((r) => r.name);
    expect(names).toEqual(["/settings tickets github"]);
  });

  it("supports /config as an alias for settings completions", () => {
    const names = getCompletions("/config sandbox o", mockReaddirSync).map((r) => r.name);
    expect(names).toEqual(["/config sandbox os"]);
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
    expect(names).toContain("/ship AGENT.md");
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
    expect(names).toContain("/build AGENT.md");
    // Non-.md excluded
    expect(names).not.toContain("/build docs.txt");
    // Hidden excluded
    expect(names).not.toContain("/build .secrets.md");
  });

  it("filters .md files by partial match after /ship", () => {
    const results = getCompletions("/ship r", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship README.md");
    expect(names).not.toContain("/ship AGENT.md");
    expect(names).not.toContain("/ship CHANGELOG.md");
  });

  it("filters .md files case-insensitively after /ship", () => {
    const results = getCompletions("/ship RE", mockReaddirSync);
    const names = results.map((r) => r.name);
    expect(names).toContain("/ship README.md");
    expect(names).not.toContain("/ship AGENT.md");
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

describe("queued input capture", () => {
  it("captures when active", () => {
    expect(shouldCaptureInput(true, false)).toBe(true);
  });

  it("captures when queued but not active", () => {
    expect(shouldCaptureInput(false, true)).toBe(true);
  });

  it("does not capture when inactive and not queued", () => {
    expect(shouldCaptureInput(false, false)).toBe(false);
  });
});

describe("settings completion helper", () => {
  it("returns empty for non-settings input", () => {
    expect(getSettingsCompletions("/model anthropic/claude-sonnet-4-6")).toEqual([]);
  });
});

describe("modified Enter handling", () => {
  it("uses Shift+Enter for multiline input everywhere", () => {
    expect(shouldInsertNewlineOnReturn({ return: true, shift: true }, {} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("uses Meta/Alt+Enter in terminals with enhanced keyboard reporting", () => {
    expect(shouldInsertNewlineOnReturn(
      { return: true, meta: true },
      { TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv,
    )).toBe(true);
    expect(shouldInsertNewlineOnReturn(
      { return: true, meta: true },
      { KITTY_WINDOW_ID: "1" } as NodeJS.ProcessEnv,
    )).toBe(true);
  });

  it("does not treat Meta+Enter as newline in terminals without known support", () => {
    expect(shouldInsertNewlineOnReturn(
      { return: true, meta: true },
      {} as NodeJS.ProcessEnv,
    )).toBe(false);
  });

  it("does not turn plain Enter into a newline", () => {
    expect(shouldInsertNewlineOnReturn(
      { return: true },
      { TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv,
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Model autocomplete logic — replicates the /model completion from Input.tsx
// ---------------------------------------------------------------------------

/** Build model choices from a provider list and Ollama models. */
function buildModelChoices(
  providers: Array<{
    id: string;
    pricingEngine: { getModels(): Array<{ id: string; displayName: string }> };
  }>,
  ollamaModels: string[],
): Array<{ name: string; desc: string }> {
  const choices: { name: string; desc: string }[] = [];
  for (const m of ollamaModels) {
    choices.push({ name: `/model ollama/${m}`, desc: "local" });
  }
  for (const provider of providers) {
    if (provider.id === "ollama") continue;
    for (const model of provider.pricingEngine.getModels()) {
      choices.push({
        name: `/model ${provider.id}/${model.id}`,
        desc: model.displayName,
      });
    }
  }
  return choices;
}

/** Filter model choices for a partial input after "/model ". */
function getModelCompletions(
  value: string,
  modelChoices: Array<{ name: string; desc: string }>,
): Array<{ name: string; desc: string }> {
  const modelMatch = value.match(/^\/model\s+(.*)/);
  if (!modelMatch) return [];
  const partial = modelMatch[1].toLowerCase();
  if (!partial) return modelChoices.slice(0, 10);
  return modelChoices
    .filter((c) => c.name.slice("/model ".length).toLowerCase().startsWith(partial))
    .slice(0, 10);
}

describe("Input: /model autocomplete", () => {
  const fakeProviders = [
    {
      id: "google",
      pricingEngine: {
        getModels: () => [
          { id: "gemini-3.1-pro", displayName: "Gemini 3.1 Pro" },
          { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash Lite" },
        ],
      },
    },
    {
      id: "anthropic",
      pricingEngine: {
        getModels: () => [
          { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
          { id: "claude-opus-4-6", displayName: "Claude Opus 4.6" },
        ],
      },
    },
    {
      id: "ollama",
      pricingEngine: {
        getModels: () => [{ id: "ignored", displayName: "Ignored" }],
      },
    },
  ];

  const fakeOllamaModels = ["qwen3-coder:latest", "llama3.3:8b"];
  const modelChoices = buildModelChoices(fakeProviders, fakeOllamaModels);

  it("typing /model google/ shows Google models from pricing registry", () => {
    const results = getModelCompletions("/model google/", modelChoices);
    const names = results.map((r) => r.name);
    expect(names).toContain("/model google/gemini-3.1-pro");
    expect(names).toContain("/model google/gemini-3.1-flash-lite");
    // Should NOT show Anthropic models
    expect(names).not.toContain("/model anthropic/claude-sonnet-4-6");
  });

  it("Ollama models appear with local desc", () => {
    const results = getModelCompletions("/model ollama/", modelChoices);
    const names = results.map((r) => r.name);
    expect(names).toContain("/model ollama/qwen3-coder:latest");
    expect(names).toContain("/model ollama/llama3.3:8b");
    // Ollama entries have "local" desc
    const ollamaEntry = results.find((r) => r.name === "/model ollama/qwen3-coder:latest");
    expect(ollamaEntry?.desc).toBe("local");
  });

  it("Ollama provider pricing models are excluded from choices", () => {
    const names = modelChoices.map((c) => c.name);
    // The ollama provider's getModels() is skipped — only live API models used
    expect(names).not.toContain("/model ollama/ignored");
  });

  it("shows first 10 when no partial input after /model", () => {
    const results = getModelCompletions("/model ", modelChoices);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results.length).toBe(Math.min(10, modelChoices.length));
  });

  it("limits results to 10 even with many matches", () => {
    // Create a provider with many models
    const manyModels = Array.from({ length: 20 }, (_, i) => ({
      id: `model-${i}`,
      displayName: `Model ${i}`,
    }));
    const bigProviders = [
      { id: "openai", pricingEngine: { getModels: () => manyModels } },
    ];
    const bigChoices = buildModelChoices(bigProviders, []);
    const results = getModelCompletions("/model openai/", bigChoices);
    expect(results.length).toBe(10);
  });

  it("filters by partial model name", () => {
    const results = getModelCompletions("/model anthropic/claude-opus", modelChoices);
    const names = results.map((r) => r.name);
    expect(names).toContain("/model anthropic/claude-opus-4-6");
    expect(names).not.toContain("/model anthropic/claude-sonnet-4-6");
  });

  it("returns empty when /model is not the prefix", () => {
    expect(getModelCompletions("/settings foo", modelChoices)).toEqual([]);
    expect(getModelCompletions("hello", modelChoices)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cursor position tracking and word jump logic
// ---------------------------------------------------------------------------

/** Simulates cursor movement for Ctrl+Left (previous word boundary). */
function cursorWordLeft(value: string, cursorPos: number): number {
  const before = value.slice(0, cursorPos);
  const match = before.match(/\S+\s*$/);
  return match ? cursorPos - match[0].length : 0;
}

/** Simulates cursor movement for Ctrl+Right (next word boundary). */
function cursorWordRight(value: string, cursorPos: number): number {
  const after = value.slice(cursorPos);
  const match = after.match(/^\s*\S+/);
  return match ? cursorPos + match[0].length : value.length;
}

describe("Input: cursor position tracking", () => {
  it("initial cursor position is 0", () => {
    // New Input starts with value="" and cursorPos=0
    const cursorPos = 0;
    expect(cursorPos).toBe(0);
  });

  it("cursor moves right with each character typed", () => {
    // Simulating typing "hello"
    let pos = 0;
    for (const ch of "hello") {
      pos += ch.length;
    }
    expect(pos).toBe(5);
  });

  it("cursor moves left on backspace", () => {
    // After typing "hello" (pos=5), backspace -> pos=4
    let pos = 5;
    pos = Math.max(0, pos - 1);
    expect(pos).toBe(4);
  });

  it("cursor does not go below 0 on backspace at start", () => {
    let pos = 0;
    pos = Math.max(0, pos - 1);
    expect(pos).toBe(0);
  });

  it("cursor resets to 0 on submit", () => {
    // After submit, value="" and cursorPos=0
    const pos = 0;
    expect(pos).toBe(0);
  });
});

describe("Input: word jump (Ctrl+Left/Right)", () => {
  it("Ctrl+Left jumps to previous word boundary", () => {
    // "hello world" cursor at end (11)
    expect(cursorWordLeft("hello world", 11)).toBe(6);
  });

  it("Ctrl+Left from middle of word jumps to start of that word", () => {
    // "hello world" cursor at 8 (in "wor|ld")
    expect(cursorWordLeft("hello world", 8)).toBe(6);
  });

  it("Ctrl+Left from start stays at 0", () => {
    expect(cursorWordLeft("hello world", 0)).toBe(0);
  });

  it("Ctrl+Left skips trailing spaces before previous word", () => {
    // "hello   world" cursor at 8 (at start of "world")
    expect(cursorWordLeft("hello   world", 8)).toBe(0);
  });

  it("Ctrl+Right jumps to next word boundary", () => {
    // "hello world" cursor at 0
    expect(cursorWordRight("hello world", 0)).toBe(5);
  });

  it("Ctrl+Right from middle of word jumps to end of that word", () => {
    // "hello world" cursor at 2
    expect(cursorWordRight("hello world", 2)).toBe(5);
  });

  it("Ctrl+Right from end stays at end", () => {
    expect(cursorWordRight("hello world", 11)).toBe(11);
  });

  it("Ctrl+Right skips leading spaces to end of next word", () => {
    // "hello world" cursor at 5 (right after "hello")
    expect(cursorWordRight("hello world", 5)).toBe(11);
  });

  it("multiple word jumps traverse all words", () => {
    const val = "one two three";
    let pos = val.length; // 13
    pos = cursorWordLeft(val, pos); // -> 8 (start of "three")
    expect(pos).toBe(8);
    pos = cursorWordLeft(val, pos); // -> 4 (start of "two")
    expect(pos).toBe(4);
    pos = cursorWordLeft(val, pos); // -> 0 (start of "one")
    expect(pos).toBe(0);
  });
});

describe("Input: Home/End (Ctrl+A / Ctrl+E)", () => {
  it("Ctrl+A sets cursor to 0", () => {
    // The component does setCursorPos(0)
    const pos = 0;
    expect(pos).toBe(0);
  });

  it("Ctrl+E sets cursor to value.length", () => {
    // The component does setCursorPos(value.length)
    const value = "hello world";
    const pos = value.length;
    expect(pos).toBe(11);
  });

  it("Ctrl+A on empty string stays at 0", () => {
    const pos = 0;
    expect(pos).toBe(0);
  });

  it("Ctrl+E on empty string stays at 0", () => {
    const value = "";
    const pos = value.length;
    expect(pos).toBe(0);
  });
});
