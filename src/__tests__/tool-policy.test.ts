import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPathScope } from "../engine/path-policy.js";
import { decideToolPermission, extractToolTargets, type PermissionState } from "../engine/tool-policy.js";

const state = (overrides: Partial<PermissionState> = {}): PermissionState => ({
  mode: "default",
  trustAll: false,
  sessionAllow: new Set(),
  rules: {},
  readOnlyRole: false,
  ...overrides,
});

describe("decideToolPermission", () => {
  it("gives deny precedence over ask, allow, and trust", () => {
    expect(decideToolPermission("write_file", { path: "a.ts" }, state({
      trustAll: true,
      rules: { allow: ["write_file"], ask: ["write_file"], deny: ["write_file"] },
    }))).toEqual({ kind: "deny", reason: "blocked by an explicit deny rule" });
  });

  it("denies writes in plan and read-only roles", () => {
    expect(decideToolPermission("write_file", { path: "a.ts" }, state({ mode: "plan" })).kind).toBe("deny");
    expect(decideToolPermission("bash", { command: "echo ok" }, state({ readOnlyRole: true })).kind).toBe("deny");
    expect(decideToolPermission("read_file", { path: "a.ts" }, state({ mode: "plan" })).kind).toBe("allow");
  });

  it("keeps dangerous commands at ask under trust and allow", () => {
    expect(decideToolPermission("bash", { command: "git reset --hard HEAD" }, state({ trustAll: true, rules: { allow: ["bash"] } })).kind).toBe("ask");
  });

  it("does not treat unknown MCP tools as read-only", () => {
    expect(decideToolPermission("mcp_filesystem_read", {}, state()).kind).toBe("ask");
    expect(decideToolPermission("sub_agent", { isolated: false }, state({ trustAll: false })).kind).toBe("ask");
    expect(decideToolPermission("sub_agent", { isolated: true }, state({ mode: "plan" })).kind).toBe("deny");
  });

  it("requires all multi-target files to match an allow rule", () => {
    const input = { paths: ["src/a.ts", "src/b.ts"] };
    expect(decideToolPermission("write_file", input, state({ rules: { allow: ["write_file(src/a.ts)"] } })).kind).toBe("ask");
    expect(decideToolPermission("write_file", input, state({ rules: { deny: ["write_file(src/b.ts)"] }, trustAll: true })).kind).toBe("deny");
  });

  it("normalizes verify and extracts patch/download targets", () => {
    expect(decideToolPermission("verify", { command: "npm test" }, state({ rules: { allow: ["bash(npm test)"] } })).kind).toBe("allow");
    expect(decideToolPermission("verify", { command: "npm test" }, state({ rules: { deny: ["verify"] } })).kind).toBe("deny");
    expect(extractToolTargets("download_file", { destination: "secrets/.env" })).toEqual(["secrets/.env"]);
    expect(extractToolTargets("patch", { patch_text: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y" })).toEqual(["a.ts"]);
  });

  it("asks for sensitive writes even with trust", () => {
    expect(decideToolPermission("write_file", { path: ".env" }, state({ trustAll: true })).kind).toBe("ask");
  });

  it("applies deny rules to equivalent relative and absolute path spellings", () => {
    const workspace = process.cwd();
    const denied = state({ workspace, rules: { deny: ["write_file(.env)"] }, trustAll: true });
    expect(decideToolPermission("write_file", { path: ".env" }, denied).kind).toBe("deny");
    expect(decideToolPermission("write_file", { path: "./.env" }, denied).kind).toBe("deny");
    expect(decideToolPermission("write_file", { path: "sub/../.env" }, denied).kind).toBe("deny");
    expect(decideToolPermission("write_file", { path: `${workspace}/.env` }, denied).kind).toBe("deny");
  });

  it("applies a relative deny rule through a symlink alias", () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wm-policy-")));
    try {
      fs.writeFileSync(path.join(workspace, ".env"), "secret");
      fs.symlinkSync(".env", path.join(workspace, "alias"));
      expect(decideToolPermission("write_file", { path: "alias" }, state({ workspace, trustAll: true, rules: { deny: ["write_file(.env)"] } })).kind).toBe("deny");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("has no dependency on a live path scope", () => {
    expect(createPathScope(process.cwd()).workspace).toBeTruthy();
  });
});
