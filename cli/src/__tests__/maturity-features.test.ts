import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ---------------------------------------------------------------------------
// 1. Custom Skills (loadCustomCommands)
// ---------------------------------------------------------------------------

describe("Custom Skills (loadCustomCommands)", () => {
  let tempHome: string;
  let tempProject: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "wm-home-"));
    tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "wm-proj-"));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempProject, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeSkill(base: string, dirName: string, filename: string, content: string) {
    const dir = path.join(base, ".workermill", dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content, "utf-8");
  }

  async function loadCommands() {
    vi.spyOn(process, "cwd").mockReturnValue(tempProject);
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    // Re-import to pick up mocked cwd/homedir
    const mod = await import("../custom-commands.js");
    return mod.loadCustomCommands();
  }

  it("parses all frontmatter fields correctly", async () => {
    writeSkill(tempProject, "skills", "deploy.md", [
      "---",
      "name: deploy-prod",
      "description: Deploy to production",
      "allowedTools: [bash, read_file, glob]",
      "model: claude-opus-4-6",
      "whenToUse: When user asks to deploy",
      "args: environment name",
      "---",
      "Run the deploy script for the given environment.",
    ].join("\n"));

    const cmds = await loadCommands();
    const cmd = cmds.find(c => c.name === "deploy-prod");
    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe("Deploy to production");
    expect(cmd!.allowedTools).toEqual(["bash", "read_file", "glob"]);
    expect(cmd!.model).toBe("claude-opus-4-6");
    expect(cmd!.whenToUse).toBe("When user asks to deploy");
    expect(cmd!.args).toBe("environment name");
    expect(cmd!.source).toBe("project-skills");
    expect(cmd!.prompt).toBe("Run the deploy script for the given environment.");
  });

  it("falls back to filename as name when no frontmatter", async () => {
    writeSkill(tempProject, "skills", "quick-fix.md", "Just fix the bug quickly.");

    const cmds = await loadCommands();
    const cmd = cmds.find(c => c.name === "quick-fix");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("quick-fix");
    expect(cmd!.description).toBe("quick-fix");
    expect(cmd!.prompt).toBe("Just fix the bug quickly.");
    expect(cmd!.source).toBe("project-skills");
  });

  it("parses allowedTools as string array", async () => {
    writeSkill(tempHome, "skills", "lint.md", [
      "---",
      "name: lint",
      "description: Lint the project",
      "allowedTools: [bash, read_file, glob]",
      "---",
      "Run linting.",
    ].join("\n"));

    const cmds = await loadCommands();
    const cmd = cmds.find(c => c.name === "lint");
    expect(cmd).toBeDefined();
    expect(cmd!.allowedTools).toEqual(["bash", "read_file", "glob"]);
  });

  it("project skills override user skills with same name", async () => {
    writeSkill(tempProject, "skills", "test.md", [
      "---",
      "name: test",
      "description: project test",
      "---",
      "Project test prompt.",
    ].join("\n"));
    writeSkill(tempHome, "skills", "test.md", [
      "---",
      "name: test",
      "description: user test",
      "---",
      "User test prompt.",
    ].join("\n"));

    const cmds = await loadCommands();
    const matches = cmds.filter(c => c.name === "test");
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe("project-skills");
    expect(matches[0].description).toBe("project test");
  });

  it("skills dir takes precedence over commands dir", async () => {
    writeSkill(tempProject, "skills", "build.md", [
      "---",
      "name: build",
      "description: from skills dir",
      "---",
      "Skills prompt.",
    ].join("\n"));
    writeSkill(tempProject, "commands", "build.md", [
      "---",
      "name: build",
      "description: from commands dir",
      "---",
      "Commands prompt.",
    ].join("\n"));

    const cmds = await loadCommands();
    const matches = cmds.filter(c => c.name === "build");
    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe("project-skills");
    expect(matches[0].description).toBe("from skills dir");
  });
});

// ---------------------------------------------------------------------------
// 2. Dangerous File Protection (isDangerousFile)
// ---------------------------------------------------------------------------

describe("Dangerous File Protection (isDangerousFile)", () => {
  // Import synchronously since no mocking needed
  let isDangerousFile: typeof import("../safety.js")["isDangerousFile"];

  beforeEach(async () => {
    const mod = await import("../safety.js");
    isDangerousFile = mod.isDangerousFile;
  });

  it("matches .env", () => {
    expect(isDangerousFile(".env")).toBeTruthy();
  });

  it("matches .env.local", () => {
    expect(isDangerousFile(".env.local")).toBeTruthy();
  });

  it("matches .bashrc", () => {
    expect(isDangerousFile(".bashrc")).toBeTruthy();
  });

  it("matches .ssh/id_rsa", () => {
    expect(isDangerousFile(".ssh/id_rsa")).toBeTruthy();
  });

  it("matches .git/config", () => {
    expect(isDangerousFile(".git/config")).toBeTruthy();
  });

  it("does not flag .github/workflows/deploy.yml (agents need CI)", () => {
    expect(isDangerousFile(".github/workflows/deploy.yml")).toBeNull();
  });

  it("matches package-lock.json", () => {
    expect(isDangerousFile("package-lock.json")).toBeTruthy();
  });

  it("does not flag Dockerfile (agents need Docker)", () => {
    expect(isDangerousFile("Dockerfile")).toBeNull();
  });

  it("returns null for src/app.ts (safe)", () => {
    expect(isDangerousFile("src/app.ts")).toBeNull();
  });

  it("returns null for README.md (safe)", () => {
    expect(isDangerousFile("README.md")).toBeNull();
  });

  it("returns null for src/components/Button.tsx (safe)", () => {
    expect(isDangerousFile("src/components/Button.tsx")).toBeNull();
  });

  it("normalizes Windows backslashes", () => {
    expect(isDangerousFile(".ssh\\id_rsa")).toBeTruthy();
    expect(isDangerousFile(".github\\workflows\\deploy.yml")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Tool Metadata (getReadOnlyTools, getAcceptEditsTools, getToolMeta)
// ---------------------------------------------------------------------------

describe("Tool Metadata", () => {
  let getReadOnlyTools: typeof import("../../../packages/engine/src/tools/tool-metadata.js")["getReadOnlyTools"];
  let getAcceptEditsTools: typeof import("../../../packages/engine/src/tools/tool-metadata.js")["getAcceptEditsTools"];
  let getToolMeta: typeof import("../../../packages/engine/src/tools/tool-metadata.js")["getToolMeta"];

  beforeEach(async () => {
    const mod = await import("../../../packages/engine/src/tools/tool-metadata.js");
    getReadOnlyTools = mod.getReadOnlyTools;
    getAcceptEditsTools = mod.getAcceptEditsTools;
    getToolMeta = mod.getToolMeta;
  });

  it("getReadOnlyTools returns exactly {read_file, glob, grep, ls, lsp, sub_agent}", () => {
    const ro = getReadOnlyTools();
    expect(ro).toEqual(new Set(["read_file", "glob", "grep", "ls", "lsp", "sub_agent"]));
  });

  it("getAcceptEditsTools returns read-only tools plus write tools", () => {
    const ae = getAcceptEditsTools();
    // Must contain all read-only tools
    for (const t of ["read_file", "glob", "grep", "ls", "lsp", "sub_agent"]) {
      expect(ae.has(t)).toBe(true);
    }
    // Must contain write/edit tools
    for (const t of ["write_file", "edit_file", "patch", "todo", "fetch", "git", "web_search"]) {
      expect(ae.has(t)).toBe(true);
    }
    // Must not contain bash
    expect(ae.has("bash")).toBe(false);
  });

  it("getToolMeta('bash') returns non-read-only, non-destructive, not acceptEdits, not concurrencySafe", () => {
    const meta = getToolMeta("bash");
    expect(meta).toEqual({
      isReadOnly: false,
      isDestructive: false,
      acceptEditsApproved: false,
      concurrencySafe: false,
    });
  });

  it("getToolMeta('read_file') returns read-only and concurrency-safe", () => {
    const meta = getToolMeta("read_file");
    expect(meta).toEqual({
      isReadOnly: true,
      isDestructive: false,
      acceptEditsApproved: true,
      concurrencySafe: true,
    });
  });

  it("getToolMeta('unknown_mcp_tool') returns safe defaults (all false)", () => {
    const meta = getToolMeta("unknown_mcp_tool");
    expect(meta).toEqual({
      isReadOnly: false,
      isDestructive: false,
      acceptEditsApproved: false,
      concurrencySafe: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Deferred Tools (partitionTools, formatDeferredToolsForPrompt)
// ---------------------------------------------------------------------------

describe("Deferred Tools", () => {
  let partitionTools: typeof import("../deferred-tools.js")["partitionTools"];
  let formatDeferredToolsForPrompt: typeof import("../deferred-tools.js")["formatDeferredToolsForPrompt"];

  beforeEach(async () => {
    const mod = await import("../deferred-tools.js");
    partitionTools = mod.partitionTools;
    formatDeferredToolsForPrompt = mod.formatDeferredToolsForPrompt;
  });

  it("engine tools (non-mcp prefixed) all go to eager", () => {
    const tools = {
      bash: { description: "Run bash" },
      read_file: { description: "Read a file" },
      write_file: { description: "Write a file" },
      glob: { description: "Find files" },
    };
    const { eager, deferred } = partitionTools(tools);
    expect(Object.keys(eager)).toEqual(["bash", "read_file", "write_file", "glob"]);
    expect(deferred).toHaveLength(0);
  });

  it("mcp__server__tool_name goes to deferred", () => {
    const tools = {
      bash: { description: "Run bash" },
      mcp__myserver__do_thing: { description: "Does a thing" },
    };
    const { eager, deferred } = partitionTools(tools);
    expect(eager).toHaveProperty("bash");
    expect(eager).not.toHaveProperty("mcp__myserver__do_thing");
    expect(deferred).toHaveLength(1);
    expect(deferred[0].name).toBe("mcp__myserver__do_thing");
    expect(deferred[0].description).toBe("Does a thing");
    expect(deferred[0].serverName).toBe("myserver");
  });

  it("formatDeferredToolsForPrompt([]) returns empty string", () => {
    expect(formatDeferredToolsForPrompt([])).toBe("");
  });

  it("formatDeferredToolsForPrompt with entries returns markdown with tool names and descriptions", () => {
    const deferred = [
      { name: "mcp__db__query", description: "Run a DB query", serverName: "db" },
      { name: "mcp__slack__post", description: "Post to Slack" },
    ];
    const result = formatDeferredToolsForPrompt(deferred);
    expect(result).toContain("mcp__db__query");
    expect(result).toContain("Run a DB query");
    expect(result).toContain("(db)");
    expect(result).toContain("mcp__slack__post");
    expect(result).toContain("Post to Slack");
    expect(result).toContain("tool_search");
  });

  it("browser tools (not mcp-prefixed) stay eager", () => {
    const tools = {
      browser_open: { description: "Open browser" },
      browser_navigate: { description: "Navigate" },
      browser_click: { description: "Click" },
      mcp__ext__something: { description: "External tool" },
    };
    const { eager, deferred } = partitionTools(tools);
    expect(eager).toHaveProperty("browser_open");
    expect(eager).toHaveProperty("browser_navigate");
    expect(eager).toHaveProperty("browser_click");
    expect(deferred).toHaveLength(1);
    expect(deferred[0].name).toBe("mcp__ext__something");
  });
});

// ---------------------------------------------------------------------------
// 5. Tool Concurrency (withConcurrencyControl)
// ---------------------------------------------------------------------------

describe("Tool Concurrency (withConcurrencyControl)", () => {
  let withConcurrencyControl: typeof import("../tool-concurrency.js")["withConcurrencyControl"];

  beforeEach(async () => {
    // Fresh import each time to reset module-level mutex
    vi.resetModules();
    const mod = await import("../tool-concurrency.js");
    withConcurrencyControl = mod.withConcurrencyControl;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("concurrent-safe tool (read_file) runs without mutex — two calls run in parallel", async () => {
    const timestamps: number[] = [];
    const execute = vi.fn(async () => {
      timestamps.push(Date.now());
      await new Promise(r => setTimeout(r, 50));
      timestamps.push(Date.now());
      return "done";
    });

    const wrapped = withConcurrencyControl("read_file", execute);

    const [r1, r2] = await Promise.all([wrapped("a"), wrapped("b")]);
    expect(r1).toBe("done");
    expect(r2).toBe("done");
    expect(execute).toHaveBeenCalledTimes(2);

    // Both should have started before either finished — start times close together
    // timestamps: [start1, start2, end1, end2] (interleaved) or [s1, s2, e1, e2]
    // The key check: second call started before first finished
    // With 50ms delay, both starts should be within ~10ms of each other
    const start1 = timestamps[0];
    const start2 = timestamps[1];
    expect(Math.abs(start2 - start1)).toBeLessThan(30);
  });

  it("non-safe tool (write_file) serializes — second call waits for first", async () => {
    const order: string[] = [];
    const execute = vi.fn(async (label: string) => {
      order.push(`start-${label}`);
      await new Promise(r => setTimeout(r, 50));
      order.push(`end-${label}`);
      return label;
    });

    const wrapped = withConcurrencyControl("write_file", execute);

    const [r1, r2] = await Promise.all([wrapped("first"), wrapped("second")]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(execute).toHaveBeenCalledTimes(2);

    // Must be sequential: start-first, end-first, start-second, end-second
    expect(order).toEqual(["start-first", "end-first", "start-second", "end-second"]);
  });
});

// ---------------------------------------------------------------------------
// 6. Hook Blocking (runPreHooksWithBlocking)
// ---------------------------------------------------------------------------

describe("Hook Blocking (runPreHooksWithBlocking)", () => {
  let runPreHooksWithBlocking: typeof import("../hooks.js")["runPreHooksWithBlocking"];

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no hooks returns { blocked: false }", async () => {
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;
    expect(runPreHooksWithBlocking("bash", undefined, "/tmp")).toEqual({ blocked: false });
  });

  it("no pre hooks returns { blocked: false }", async () => {
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;
    expect(runPreHooksWithBlocking("bash", { post: [{ command: "echo done" }] }, "/tmp")).toEqual({ blocked: false });
  });

  it("hook succeeds (exit 0) returns { blocked: false }", async () => {
    vi.doMock("child_process", () => ({
      execSync: vi.fn(() => "ok"),
      spawn: vi.fn(),
    }));
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;

    const result = runPreHooksWithBlocking(
      "bash",
      { pre: [{ command: "echo ok" }] },
      "/tmp",
    );
    expect(result).toEqual({ blocked: false });
  });

  it("hook fails (exit non-zero) returns { blocked: true, reason }", async () => {
    const error = new Error("Command failed") as Error & { stdout: string };
    error.stdout = "Not allowed to run bash here";
    vi.doMock("child_process", () => ({
      execSync: vi.fn(() => { throw error; }),
      spawn: vi.fn(),
    }));
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;

    const result = runPreHooksWithBlocking(
      "bash",
      { pre: [{ command: "exit 1" }] },
      "/tmp",
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.reason).toBe("Not allowed to run bash here");
    }
  });

  it("HTTP hooks cannot block (fire-and-forget)", async () => {
    const mockFetch = vi.fn(() => Promise.resolve());
    vi.stubGlobal("fetch", mockFetch);
    vi.doMock("child_process", () => ({
      execSync: vi.fn(() => { throw new Error("should not be called"); }),
      spawn: vi.fn(),
    }));
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;

    const result = runPreHooksWithBlocking(
      "bash",
      { pre: [{ type: "http", url: "https://example.com/hook" }] },
      "/tmp",
    );
    // HTTP hooks are fire-and-forget, so they never block
    expect(result).toEqual({ blocked: false });
    vi.unstubAllGlobals();
  });

  it("tool filter: hook with tools: ['bash'] does not run for read_file", async () => {
    const execSyncMock = vi.fn(() => { throw new Error("would block"); });
    vi.doMock("child_process", () => ({
      execSync: execSyncMock,
      spawn: vi.fn(),
    }));
    const mod = await import("../hooks.js");
    runPreHooksWithBlocking = mod.runPreHooksWithBlocking;

    const result = runPreHooksWithBlocking(
      "read_file",
      { pre: [{ command: "exit 1", tools: ["bash"] }] },
      "/tmp",
    );
    expect(result).toEqual({ blocked: false });
    // execSync should not have been called since tool doesn't match
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. Notifications (notifyIfEnabled)
// ---------------------------------------------------------------------------

describe("Notifications (notifyIfEnabled)", () => {
  let notifyIfEnabled: typeof import("../notify.js")["notifyIfEnabled"];

  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifyIfEnabled(false, ...) does nothing", async () => {
    const execSyncMock = vi.fn();
    vi.doMock("child_process", () => ({
      execSync: execSyncMock,
      spawn: vi.fn(),
    }));
    const mod = await import("../notify.js");
    notifyIfEnabled = mod.notifyIfEnabled;

    notifyIfEnabled(false, "Test", "Hello");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("notifyIfEnabled(true, ...) calls notify (execSync is invoked)", async () => {
    const execSyncMock = vi.fn();
    vi.doMock("child_process", () => ({
      execSync: execSyncMock,
      spawn: vi.fn(),
    }));
    const mod = await import("../notify.js");
    notifyIfEnabled = mod.notifyIfEnabled;

    notifyIfEnabled(true, "Done", "Task completed");
    // Should have attempted to call execSync for the notification
    expect(execSyncMock).toHaveBeenCalled();
  });

  it("notifyIfEnabled(undefined, ...) does nothing", async () => {
    const execSyncMock = vi.fn();
    vi.doMock("child_process", () => ({
      execSync: execSyncMock,
      spawn: vi.fn(),
    }));
    const mod = await import("../notify.js");
    notifyIfEnabled = mod.notifyIfEnabled;

    notifyIfEnabled(undefined, "Test", "Hello");
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});
