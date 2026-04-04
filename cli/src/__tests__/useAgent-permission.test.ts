/**
 * Tests for the permission resolution logic mirrored from useAgent.ts `checkPermission`.
 *
 * The actual `checkPermission` function is a React hook callback that interacts with
 * React state and refs, so we test the decision logic as a pure function here by
 * replicating the same decision tree using the same safety exports.
 */

import { describe, it, expect } from "vitest";
import { isDangerous, READ_TOOLS, AUTO_EDIT_TOOLS } from "../safety.js";

/** The possible outcomes of the permission decision tree. */
type PermissionResult =
  | "allowed"      // Automatically allowed
  | "denied"       // Blocked unconditionally (tool in deniedTools set)
  | "dangerous-prompt" // Requires explicit confirmation because command is dangerous
  | "prompt";      // Requires interactive permission prompt

/**
 * Pure replication of the `checkPermission` decision tree from useAgent.ts.
 *
 * Mirrors the logic in checkPermission (lines 279-334 of useAgent.ts):
 *   1. denied tools → "denied"
 *   2. dangerous bash command → "dangerous-prompt"
 *   3. trustAll → "allowed"
 *   4. auto-edit mode + AUTO_EDIT_TOOLS → "allowed"
 *   5. READ_TOOLS → "allowed"
 *   6. session-allowed → "allowed"
 *   7. otherwise → "prompt"
 */
function resolvePermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  opts: {
    deniedTools?: Set<string>;
    trustAll?: boolean;
    permMode?: "bypassPermissions" | "acceptEdits" | "default";
    sessionAllow?: Set<string>;
  } = {},
): PermissionResult {
  const {
    deniedTools = new Set<string>(),
    trustAll = false,
    permMode = "default",
    sessionAllow = new Set<string>(),
  } = opts;

  // Step 1: denied tools are always blocked.
  if (deniedTools.has(toolName)) {
    return "denied";
  }

  // Step 2: detect dangerous bash — only applies to the "bash" tool.
  const dangerLabel =
    toolName === "bash" ? isDangerous(String(toolInput.command ?? "")) : null;
  if (dangerLabel) {
    return "dangerous-prompt";
  }

  // Step 3: trust-all bypasses all prompts for non-dangerous tools.
  if (trustAll) {
    return "allowed";
  }

  // Step 4: auto-edit mode auto-approves tools in AUTO_EDIT_TOOLS (excludes bash).
  if (permMode === "acceptEdits" && AUTO_EDIT_TOOLS.has(toolName)) {
    return "allowed";
  }

  // Step 5: read-only tools never require permission.
  if (READ_TOOLS.has(toolName)) {
    return "allowed";
  }

  // Step 6: session-level "always allow".
  if (sessionAllow.has(toolName)) {
    return "allowed";
  }

  // Step 7: interactive prompt required.
  return "prompt";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolvePermission() — useAgent checkPermission decision tree", () => {
  // -------------------------------------------------------------------------
  // 1. Denied tools
  // -------------------------------------------------------------------------
  describe("denied tools", () => {
    it("blocks a denied tool regardless of trust-all mode", () => {
      expect(
        resolvePermission("bash", { command: "ls" }, {
          deniedTools: new Set(["bash"]),
          trustAll: true,
        }),
      ).toBe("denied");
    });

    it("blocks a denied write tool regardless of auto-edit mode", () => {
      expect(
        resolvePermission("write_file", { path: "foo.ts", content: "x" }, {
          deniedTools: new Set(["write_file"]),
          permMode: "acceptEdits",
        }),
      ).toBe("denied");
    });

    it("blocks a denied read tool that would otherwise be auto-allowed", () => {
      expect(
        resolvePermission("read_file", { path: "foo.ts" }, {
          deniedTools: new Set(["read_file"]),
        }),
      ).toBe("denied");
    });

    it("does not block a tool that is NOT in the denied set", () => {
      expect(
        resolvePermission("bash", { command: "ls" }, {
          deniedTools: new Set(["write_file"]),
          trustAll: true,
        }),
      ).toBe("allowed");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Dangerous bash commands — always prompt even in trust-all
  // -------------------------------------------------------------------------
  describe("dangerous bash commands", () => {
    it("prompts for rm -rf / even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "rm -rf /" }, { trustAll: true }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for git push --force even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "git push origin main --force" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for git reset --hard even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "git reset --hard HEAD~1" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for git clean -fd even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "git clean -fd" }, { trustAll: true }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for rm -rf ~/ even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "rm -rf ~/Documents" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for sudo commands even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "sudo apt-get install curl" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("prompts for DROP TABLE even when trust-all is on", () => {
      expect(
        resolvePermission("bash", { command: "psql -c 'DROP TABLE users'" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("does NOT apply dangerous check to non-bash tools", () => {
      // A git tool with a destructive-looking input is NOT treated as dangerous
      // because detectDanger only triggers for toolName === "bash".
      expect(
        resolvePermission("git", { command: "git reset --hard" }, {
          trustAll: true,
        }),
      ).toBe("allowed");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Trust-all mode
  // -------------------------------------------------------------------------
  describe("trust-all mode", () => {
    it("allows non-dangerous bash commands", () => {
      expect(
        resolvePermission("bash", { command: "ls -la" }, { trustAll: true }),
      ).toBe("allowed");
    });

    it("allows write_file", () => {
      expect(
        resolvePermission("write_file", { path: "x.ts", content: "" }, {
          trustAll: true,
        }),
      ).toBe("allowed");
    });

    it("allows edit_file", () => {
      expect(
        resolvePermission("edit_file", {}, { trustAll: true }),
      ).toBe("allowed");
    });

    it("allows fetch", () => {
      expect(
        resolvePermission("fetch", { url: "https://example.com" }, {
          trustAll: true,
        }),
      ).toBe("allowed");
    });

    it("allows unknown/custom tools", () => {
      expect(
        resolvePermission("custom_tool", {}, { trustAll: true }),
      ).toBe("allowed");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Auto-edit mode
  // -------------------------------------------------------------------------
  describe("auto-edit mode", () => {
    it("allows write_file in auto-edit mode", () => {
      expect(
        resolvePermission("write_file", {}, { permMode: "acceptEdits" }),
      ).toBe("allowed");
    });

    it("allows edit_file in auto-edit mode", () => {
      expect(
        resolvePermission("edit_file", {}, { permMode: "acceptEdits" }),
      ).toBe("allowed");
    });

    it("allows patch in auto-edit mode", () => {
      expect(
        resolvePermission("patch", {}, { permMode: "acceptEdits" }),
      ).toBe("allowed");
    });

    it("prompts for git in auto-edit mode", () => {
      expect(
        resolvePermission("git", {}, { permMode: "acceptEdits" }),
      ).toBe("prompt");
    });

    it("allows fetch in auto-edit mode", () => {
      expect(
        resolvePermission("fetch", {}, { permMode: "acceptEdits" }),
      ).toBe("allowed");
    });

    it("prompts for bash in auto-edit mode (bash is NOT in AUTO_EDIT_TOOLS)", () => {
      expect(
        resolvePermission("bash", { command: "npm test" }, {
          permMode: "acceptEdits",
        }),
      ).toBe("prompt");
    });

    it("prompts for unknown tool in auto-edit mode", () => {
      expect(
        resolvePermission("custom_tool", {}, { permMode: "acceptEdits" }),
      ).toBe("prompt");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Read-only tools — always allowed
  // -------------------------------------------------------------------------
  describe("read-only tools", () => {
    const readTools = ["read_file", "glob", "grep", "ls", "sub_agent"];

    for (const tool of readTools) {
      it(`allows ${tool} without any special mode`, () => {
        expect(resolvePermission(tool, {})).toBe("allowed");
      });
    }

    it("allows read tools even in ask mode with no session permissions", () => {
      expect(
        resolvePermission("read_file", { path: "foo.ts" }, { permMode: "default" }),
      ).toBe("allowed");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Session-allowed tools
  // -------------------------------------------------------------------------
  describe("session-allowed tools", () => {
    it("allows a tool that was session-approved", () => {
      expect(
        resolvePermission("bash", { command: "npm test" }, {
          sessionAllow: new Set(["bash"]),
        }),
      ).toBe("allowed");
    });

    it("allows write_file when session-approved", () => {
      expect(
        resolvePermission("write_file", {}, {
          sessionAllow: new Set(["write_file"]),
        }),
      ).toBe("allowed");
    });

    it("does not allow a tool that is NOT in the session set", () => {
      expect(
        resolvePermission("edit_file", {}, {
          sessionAllow: new Set(["write_file"]),
        }),
      ).toBe("prompt");
    });
  });

  // -------------------------------------------------------------------------
  // 7. Ask mode (default) — write tools require prompt
  // -------------------------------------------------------------------------
  describe("ask mode (default)", () => {
    it("prompts for bash in ask mode", () => {
      expect(
        resolvePermission("bash", { command: "npm run build" }),
      ).toBe("prompt");
    });

    it("prompts for write_file in ask mode", () => {
      expect(resolvePermission("write_file", {})).toBe("prompt");
    });

    it("prompts for edit_file in ask mode", () => {
      expect(resolvePermission("edit_file", {})).toBe("prompt");
    });

    it("prompts for fetch in ask mode", () => {
      expect(resolvePermission("fetch", {})).toBe("prompt");
    });

    it("prompts for git in ask mode", () => {
      expect(resolvePermission("git", {})).toBe("prompt");
    });

    it("prompts for unknown tools in ask mode", () => {
      expect(resolvePermission("custom_tool", {})).toBe("prompt");
    });
  });

  // -------------------------------------------------------------------------
  // 8. Interaction / precedence tests
  // -------------------------------------------------------------------------
  describe("precedence / compound conditions", () => {
    it("denied overrides trust-all (denied wins)", () => {
      expect(
        resolvePermission("bash", { command: "ls" }, {
          deniedTools: new Set(["bash"]),
          trustAll: true,
        }),
      ).toBe("denied");
    });

    it("dangerous overrides trust-all (dangerous-prompt wins)", () => {
      expect(
        resolvePermission("bash", { command: "rm -rf /" }, {
          trustAll: true,
        }),
      ).toBe("dangerous-prompt");
    });

    it("denied overrides auto-edit (denied wins)", () => {
      expect(
        resolvePermission("write_file", {}, {
          deniedTools: new Set(["write_file"]),
          permMode: "acceptEdits",
        }),
      ).toBe("denied");
    });

    it("denied overrides session-allow (denied wins)", () => {
      expect(
        resolvePermission("bash", { command: "ls" }, {
          deniedTools: new Set(["bash"]),
          sessionAllow: new Set(["bash"]),
        }),
      ).toBe("denied");
    });

    it("dangerous overrides session-allow (dangerous-prompt wins)", () => {
      expect(
        resolvePermission("bash", { command: "git reset --hard" }, {
          sessionAllow: new Set(["bash"]),
        }),
      ).toBe("dangerous-prompt");
    });

    it("trust-all is irrelevant when the tool is read-only (still allowed)", () => {
      // Both paths lead to "allowed" — but confirmed via trust-all being checked first.
      expect(
        resolvePermission("read_file", {}, { trustAll: false }),
      ).toBe("allowed");
    });

    it("auto-edit does not help bash — it still prompts", () => {
      expect(
        resolvePermission("bash", { command: "npm install" }, {
          permMode: "acceptEdits",
          sessionAllow: new Set(), // no session grant
        }),
      ).toBe("prompt");
    });

    it("session-allow takes priority over ask-mode prompt for bash", () => {
      expect(
        resolvePermission("bash", { command: "npm test" }, {
          permMode: "default",
          sessionAllow: new Set(["bash"]),
        }),
      ).toBe("allowed");
    });
  });
});
