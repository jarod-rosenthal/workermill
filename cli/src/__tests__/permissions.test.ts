import { describe, it, expect, vi } from "vitest";

// Mock safety module for consistent behavior
vi.mock("../safety.js", async () => {
  const actual = await vi.importActual("../safety.js");
  return actual;
});

import { PermissionManager } from "../permissions.js";

describe("PermissionManager", () => {
  describe("read tools auto-allowed", () => {
    it("allows read_file without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("read_file", { path: "/test" });
      expect(allowed).toBe(true);
    });

    it("allows glob without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("glob", { pattern: "*.ts" });
      expect(allowed).toBe(true);
    });

    it("allows grep without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("grep", { pattern: "test" });
      expect(allowed).toBe(true);
    });

    it("allows ls without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("ls", { path: "." });
      expect(allowed).toBe(true);
    });

    it("allows sub_agent without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("sub_agent", { prompt: "analyze" });
      expect(allowed).toBe(true);
    });
  });

  describe("trust-all mode", () => {
    it("allows write tools without prompting", async () => {
      const pm = new PermissionManager(true);
      const allowed = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(allowed).toBe(true);
    });

    it("allows bash without prompting", async () => {
      const pm = new PermissionManager(true);
      const allowed = await pm.checkPermission("bash", { command: "npm install" });
      expect(allowed).toBe(true);
    });

    it("allows edit_file without prompting", async () => {
      const pm = new PermissionManager(true);
      const allowed = await pm.checkPermission("edit_file", { path: "/test.ts" });
      expect(allowed).toBe(true);
    });

    it("allows dangerous commands in trust-all mode", async () => {
      const pm = new PermissionManager(true);
      const allowed = await pm.checkPermission("bash", { command: "git reset --hard" });
      expect(allowed).toBe(true);
    });
  });

  describe("config trust", () => {
    it("auto-allows tools in configTrust list", async () => {
      const pm = new PermissionManager(false, ["write_file", "edit_file"]);
      const allowed = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(allowed).toBe(true);
    });
  });
});
