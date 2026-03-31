/**
 * Exhaustive tests for checkToolPermission — every path, every tool type, every mode.
 * This function gates ALL tool execution in /ship mode. Every path must be tested.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../safety.js", () => ({
  isDangerous: vi.fn(() => null),
  READ_TOOLS: new Set(["read_file", "glob", "grep", "ls", "sub_agent", "lsp"]),
  checkPermissionRules: vi.fn(() => "none"),
}));

import { checkToolPermission } from "../orchestrator.js";
import { isDangerous, checkPermissionRules } from "../safety.js";
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
  });

  // -----------------------------------------------------------------------
  // 1. Dangerous command detection (bash only)
  // -----------------------------------------------------------------------

  describe("dangerous commands", () => {
    it("prompts for dangerous bash even when trustAll=true", async () => {
      vi.mocked(isDangerous).mockReturnValue("rm -rf /");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: false });

      const allowed = await checkToolPermission(
        "bash", { command: "rm -rf /" }, true, new Set(), output,
      );

      expect(output.error).toHaveBeenCalledWith(expect.stringContaining("DANGEROUS"));
      expect(allowed).toBe(false);
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
  // 2. Granular permission rules
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

      const allowed = await checkToolPermission(
        "write_file", { path: ".env" }, true, new Set(), output, { deny: ["write_file(*.env)"] },
      );
      expect(allowed).toBe(false);
    });

    it("falls through to normal logic when rule returns none", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("none");
      const output = createMockOutput();

      const allowed = await checkToolPermission(
        "bash", { command: "echo hi" }, true, new Set(), output,
      );
      // trustAll=true, so allowed
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
    const READ_TOOL_NAMES = ["read_file", "glob", "grep", "ls", "sub_agent", "lsp"];

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
  // 6. User prompt responses
  // -----------------------------------------------------------------------

  describe("user prompt responses", () => {
    it("mode=trust adds '*' wildcard to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true, mode: "trust" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(sessionAllow.has("*")).toBe(true);
    });

    it("after mode=trust, ALL subsequent tools are auto-allowed without prompting", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set<string>();

      // First call — user selects trust
      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "trust" });
      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      // Every subsequent tool — no prompt
      for (const tool of ["verify", "todo", "web_search", "write_file", "edit_file", "git", "patch", "fetch", "mcp__something__tool"]) {
        const allowed = await checkToolPermission(tool, {}, false, sessionAllow, output);
        expect(allowed).toBe(true);
      }
      // confirm called exactly once (the first bash call)
      expect(output.confirm).toHaveBeenCalledTimes(1);
    });

    it("mode=always adds only that specific tool to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(sessionAllow.has("bash")).toBe(true);
      expect(sessionAllow.has("*")).toBe(false);
      expect(sessionAllow.has("write_file")).toBe(false);
    });

    it("mode=always — second call to same tool is auto-allowed", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);
      const allowed = await checkToolPermission("bash", { command: "ls" }, false, sessionAllow, output);

      expect(allowed).toBe(true);
      expect(output.confirm).toHaveBeenCalledTimes(1);
    });

    it("mode=always — different tool still prompts", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm)
        .mockResolvedValueOnce({ allowed: true, mode: "always" })
        .mockResolvedValueOnce({ allowed: true, mode: "always" });
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);
      await checkToolPermission("write_file", { path: "foo.ts" }, false, sessionAllow, output);

      expect(output.confirm).toHaveBeenCalledTimes(2);
    });

    it("simple boolean true adds tool to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(true);
      const sessionAllow = new Set<string>();

      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(sessionAllow.has("bash")).toBe(true);
    });

    it("simple boolean false does NOT add tool to sessionAllow", async () => {
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue(false);
      const sessionAllow = new Set<string>();

      const allowed = await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      expect(allowed).toBe(false);
      expect(sessionAllow.has("bash")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 7. The exact bug that was reported: verify tool after trust-all
  // -----------------------------------------------------------------------

  describe("the verify-after-trust-all bug (regression)", () => {
    it("verify tool is auto-allowed after selecting trust-all on a different tool", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set<string>();

      // User selects trust on a bash prompt
      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "trust" });
      await checkToolPermission("bash", { command: "npm test" }, false, sessionAllow, output);

      // verify should now be auto-allowed — NO prompt
      const allowed = await checkToolPermission("verify", { command: "go build" }, false, sessionAllow, output);
      expect(allowed).toBe(true);
      expect(output.confirm).toHaveBeenCalledTimes(1); // only the first bash call
    });

    it("MCP tools are auto-allowed after selecting trust-all", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set<string>();

      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "trust" });
      await checkToolPermission("bash", { command: "echo" }, false, sessionAllow, output);

      const allowed = await checkToolPermission("mcp__docker__container_list", {}, false, sessionAllow, output);
      expect(allowed).toBe(true);
      expect(output.confirm).toHaveBeenCalledTimes(1);
    });

    it("todo tool is auto-allowed after selecting trust-all", async () => {
      const output = createMockOutput();
      const sessionAllow = new Set<string>();

      vi.mocked(output.confirm).mockResolvedValueOnce({ allowed: true, mode: "trust" });
      await checkToolPermission("write_file", { path: "foo" }, false, sessionAllow, output);

      const allowed = await checkToolPermission("todo", { text: "fix tests" }, false, sessionAllow, output);
      expect(allowed).toBe(true);
      expect(output.confirm).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Priority order: dangerous > deny rule > allow rule > trustAll > read > session > prompt
  // -----------------------------------------------------------------------

  describe("priority order", () => {
    it("dangerous check happens before permission rules", async () => {
      vi.mocked(isDangerous).mockReturnValue("rm -rf");
      vi.mocked(checkPermissionRules).mockReturnValue("allow");
      const output = createMockOutput();
      vi.mocked(output.confirm).mockResolvedValue({ allowed: false });

      const allowed = await checkToolPermission(
        "bash", { command: "rm -rf /" }, true, new Set(["*"]), output, { allow: ["bash(*)"] },
      );
      // Dangerous still prompts even though everything else says allow
      expect(output.error).toHaveBeenCalledWith(expect.stringContaining("DANGEROUS"));
      expect(allowed).toBe(false);
    });

    it("deny rule blocks even with trustAll and sessionAllow *", async () => {
      vi.mocked(checkPermissionRules).mockReturnValue("deny");
      const output = createMockOutput();

      const allowed = await checkToolPermission(
        "write_file", { path: ".env" }, true, new Set(["*"]), output,
      );
      expect(allowed).toBe(false);
      expect(output.confirm).not.toHaveBeenCalled();
    });
  });
});
