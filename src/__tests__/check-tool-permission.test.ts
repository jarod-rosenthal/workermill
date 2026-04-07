/**
 * Exhaustive tests for checkToolPermission — every path, every tool type, every mode.
 * This function gates ALL tool execution in /ship mode. Every path must be tested.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../safety.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    isDangerous: vi.fn(() => null),
    checkPermissionRules: vi.fn(() => "none"),
  };
});

vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    loadConfig: vi.fn(() => ({ providers: {}, default: "ollama", permissions: { allow: [] } })),
    saveConfig: vi.fn(),
    loadLocalSettings: vi.fn(() => ({ allow: [] })),
    saveLocalSettings: vi.fn(),
  };
});

import { checkToolPermission } from "../orchestrator.js";
import { isDangerous, checkPermissionRules } from "../safety.js";
import { loadConfig, saveConfig, loadLocalSettings, saveLocalSettings } from "../config.js";
import type { OrchestrationOutput } from "../orchestrator.js";

function createMockOutput(): OrchestrationOutput {
  return {
    log: vi.fn(),
    coordinatorLog: vi.fn(),
    error: vi.fn(),
    status: vi.fn(),
    statusDone: vi.fn(),
    confirm: vi.fn(),
    toolCall: vi.fn(),
  };
}

describe("checkToolPermission — exhaustive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isDangerous).mockReturnValue(null);
    vi.mocked(checkPermissionRules).mockReturnValue("none");
    vi.mocked(loadConfig).mockReturnValue({ providers: {}, default: "ollama", permissions: { allow: [] } });
  });

  // -----------------------------------------------------------------------
  // 1. Dangerous command detection (bash only)
  // -----------------------------------------------------------------------

  describe("dangerous commands", () => {
    it("dangerous bash ALWAYS prompts even in trustAll mode", async () => {
      vi.mocked(isDangerous).mockReturnValue("rm -rf /");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);

      const allowed = await checkToolPermission(
        "bash", { command: "rm -rf /" }, true, new Set(), output,
      );

      // Dangerous commands must always prompt — trust mode skips normal prompts, not safety gates
      expect(output.confirm).toHaveBeenCalled();
      expect(allowed).toBe(true);
    });

    it("allows dangerous command when user confirms", async () => {
      vi.mocked(isDangerous).mockReturnValue("force push");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true });

      const allowed = await checkToolPermission(
        "bash", { command: "git push --force" }, true, new Set(), output,
      );
      expect(allowed).toBe(true);
    });

    it("handles simple boolean confirm for dangerous command", async () => {
      vi.mocked(isDangerous).mockReturnValue("sudo");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);

      const allowed = await checkToolPermission(
        "bash", { command: "sudo rm foo" }, false, new Set(), output,
      );
      expect(allowed).toBe(true);
    });

    it("does not check dangerous for non-bash tools", async () => {
      const output = createMockOutput();
      const allowed = await checkToolPermission(
        "write_file", { path: "/etc/passwd" }, true, new Set(), output,
      );
      expect(isDangerous).not.toHaveBeenCalled();
      expect(allowed).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Granular permission rules (deny > ask > allow)
  // -----------------------------------------------------------------------

  describe("granular permission rules", () => {
    it("denies when rule returns deny", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("deny");
      const output = createMockOutput();

      const allowed = await checkToolPermission(
        "bash", { command: "rm foo" }, false, new Set(), output, { deny: ["bash(rm *)"] },
      );
      expect(allowed).toBe(false);
      expect(output.confirm).not.toHaveBeenCalled();
    });

    it("allows when rule returns allow — no prompt", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("allow");
      const output = createMockOutput();

      const allowed = await checkToolPermission(
        "bash", { command: "npm test" }, false, new Set(), output, { allow: ["bash(npm *)"] },
      );
      expect(allowed).toBe(true);
      expect(output.confirm).not.toHaveBeenCalled();
    });

    it("deny rule overrides trustAll", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("deny");
      const output = createMockOutput();

      // Use a non-sensitive path so isDangerousFile doesn't intercept before the rule check
      const allowed = await checkToolPermission(
        "write_file", { path: "src/app.ts" }, true, new Set(), output, { deny: ["write_file"] },
      );
      expect(allowed).toBe(false);
    });

    it("ask rule forces prompt even with trustAll", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("ask");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);

      const allowed = await checkToolPermission(
        "bash", { command: "npm publish" }, true, new Set(["*"]), output,
      );
      expect(output.confirm).toHaveBeenCalled();
      expect(allowed).toBe(true);
    });

    it("falls through to normal logic when rule returns none", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("none");
      const output = createMockOutput();

      const allowed = await checkToolPermission(
        "bash", { command: "echo hi" }, true, new Set(), output,
      );
      expect(allowed).toBe(true);
      expect(output.confirm).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 3. trustAll mode
  // -----------------------------------------------------------------------

  describe("trustAll mode", () => {
    const ALL_WRITE_TOOLS = ["bash", "write_file", "edit_file", "patch", "git", "fetch", "web_search", "todo", "verify", "lsp"];

    for (const toolName of ALL_WRITE_TOOLS) {
      it(`auto-allows ${toolName} without prompting`, async () => {
        const output = createMockOutput();
        const allowed = await checkToolPermission(
          toolName, {}, true, new Set(), output,
        );
        expect(allowed).toBe(true);
        expect(output.confirm).not.toHaveBeenCalled();
      });
    }
  });

  // -----------------------------------------------------------------------
  // 4. READ_TOOLS auto-allow (even without trustAll)
  // -----------------------------------------------------------------------

  describe("read tools auto-allow", () => {
    const READ_TOOL_NAMES = ["read_file", "view_image", "glob", "grep", "ls", "sub_agent", "lsp"];

    for (const toolName of READ_TOOL_NAMES) {
      it(`auto-allows ${toolName} without prompting (trustAll=false)`, async () => {
        const output = createMockOutput();
        const allowed = await checkToolPermission(
          toolName, {}, false, new Set(), output,
        );
        expect(allowed).toBe(true);
        expect(output.confirm).not.toHaveBeenCalled();
      });
    }
  });

  // -----------------------------------------------------------------------
  // 5. sessionAllow
  // -----------------------------------------------------------------------

  describe("sessionAllow", () => {
    it("auto-allows a tool that is in sessionAllow", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set(["bash"]);

      const allowed = await checkToolPermission(
        "bash", { command: "echo hi" }, false, sessionAllow, output,
      );
      expect(allowed).toBe(true);
      expect(output.confirm).not.toHaveBeenCalled();
    });

    it("auto-allows any tool when '*' wildcard is in sessionAllow", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set(["*"]);

      for (const tool of ["bash", "write_file", "edit_file", "verify", "todo", "web_search", "fetch", "git", "patch", "some_mcp_tool"]) {
        const allowed = await checkToolPermission(
          tool, {}, false, sessionAllow, output,
        );
        expect(allowed).toBe(true);
      }
      expect(output.confirm).not.toHaveBeenCalled();
    });

    it("does not auto-allow a tool NOT in sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(false);
      const sessionAllow = new Set(["bash"]);

      const allowed = await checkToolPermission(
        "write_file", { path: "foo.ts" }, false, sessionAllow, output,
      );
      expect(allowed).toBe(false);
      expect(output.confirm).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 6. User prompt responses — "Yes, don't ask again"
  // -----------------------------------------------------------------------

  describe("user prompt responses", () => {
    it("mode=always for bash saves permanent prefix rule to config", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "npm test" }, false, sessionAllow, output);

      expect(saveLocalSettings).toHaveBeenCalled();
      const saved = vi.mocked(saveLocalSettings).mock.calls[0][0] as { allow?: string[] };
      expect(saved.allow).toContain("bash(npm test:*)");
    });

    it("mode=always for bash with compound command saves prefix rule for full command", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "git status && npm test" }, false, sessionAllow, output);

      const saved = vi.mocked(saveLocalSettings).mock.calls[0][0] as { allow?: string[] };
      // Compound commands split into separate rules
      expect(saved.allow).toContain("bash(git status:*)");
    });

    it("mode=always for non-bash saves a durable tool allow rule", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("write_file", { path: "foo.ts" }, false, sessionAllow, output);

      expect(sessionAllow.has("write_file")).toBe(true);
      expect(saveLocalSettings).toHaveBeenCalled();
      const saved = vi.mocked(saveLocalSettings).mock.calls.at(-1)?.[0] as { allow?: string[] };
      expect(saved.allow).toContain("write_file");
    });

    it("mode=always — second call to same bash pattern is auto-allowed via saved rule", async () => {
      // Simulate: first call saves rule, second call matches it
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "npm test" }, false, sessionAllow, output);

      // Now the rule is saved — simulate checkPermissionRules matching it
      vi.mocked(checkPermissionRules).mockReturnValue("allow");
      const allowed = await checkToolPermission("bash", { command: "npm test" }, false, sessionAllow, output);

      expect(allowed).toBe(true);
      expect(output.confirm).toHaveBeenCalledTimes(1);
    });

    it("simple boolean true allows once — does NOT add to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(sessionAllow.has("bash")).toBe(false);
    });

    it("simple boolean false denies — does NOT add to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(false);
      const sessionAllow = new Set<string>();

      const allowed = await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(allowed).toBe(false);
      expect(sessionAllow.has("bash")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Priority order: dangerous > deny > ask > allow > trustAll > read > session > prompt
  // -----------------------------------------------------------------------

  describe("priority order", () => {
    it("dangerous check prompts when not in bypass mode", async () => {
      vi.mocked(isDangerous).mockReturnValue("rm -rf");
      vi.mocked(checkPermissionRules).mockReturnValue("allow");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: false });

      const allowed = await checkToolPermission(
        "bash", { command: "rm -rf /" }, false, new Set(), output,
      );
      expect(output.error).toHaveBeenCalledWith(expect.stringContaining("DANGEROUS"));
      expect(allowed).toBe(false);
    });

    it("deny rule blocks even with trustAll and sessionAllow *", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("deny");
      const output = createMockOutput();

      // Use a non-sensitive path so isDangerousFile doesn't intercept
      const allowed = await checkToolPermission(
        "write_file", { path: "src/app.ts" }, true, new Set(["*"]), output,
      );
      expect(allowed).toBe(false);
      expect(output.confirm).not.toHaveBeenCalled();
    });

    it("ask rule forces prompt even with sessionAllow *", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("ask");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);

      const allowed = await checkToolPermission(
        "bash", { command: "npm publish" }, true, new Set(["*"]), output,
      );
      expect(output.confirm).toHaveBeenCalled();
    });
  });
});
