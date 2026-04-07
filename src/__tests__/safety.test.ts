import { describe, it, expect } from "vitest";
import { isDangerous, DANGEROUS_PATTERNS, READ_TOOLS, AUTO_EDIT_TOOLS, checkPermissionRules } from "../safety.js";

describe("safety", () => {
  describe("DANGEROUS_PATTERNS", () => {
    it("has 11 patterns", () => {
      expect(DANGEROUS_PATTERNS).toHaveLength(11);
    });
  });

  describe("isDangerous()", () => {
    it("detects rm -rf /", () => {
      expect(isDangerous("rm -rf /")).toBe("rm -rf with root path");
    });

    it("detects rm -rf / with extra flags", () => {
      expect(isDangerous("rm -rf / --no-preserve-root")).toBe("rm -rf with root path");
    });

    it("detects rm -rf ~/", () => {
      expect(isDangerous("rm -rf ~/")).toBe("rm -rf in home directory");
    });

    it("detects rm -fr ~/Documents", () => {
      expect(isDangerous("rm -fr ~/Documents")).toBe("rm -rf in home directory");
    });

    it("detects git reset --hard", () => {
      expect(isDangerous("git reset --hard HEAD~1")).toBe("hard reset");
    });

    it("detects git push --force", () => {
      expect(isDangerous("git push origin main --force")).toBe("force push");
    });

    it("detects git clean -f", () => {
      expect(isDangerous("git clean -fd")).toBe("git clean");
    });

    it("detects drop table", () => {
      expect(isDangerous("DROP TABLE users")).toBe("drop table");
    });

    it("detects truncate", () => {
      expect(isDangerous("TRUNCATE users")).toBe("truncate");
    });

    it("detects DELETE without WHERE", () => {
      expect(isDangerous("DELETE FROM users;")).toBe("DELETE without WHERE");
    });

    it("detects chmod 777", () => {
      expect(isDangerous("chmod 777 /var/www")).toBe("chmod 777");
    });

    it("detects write to disk device", () => {
      expect(isDangerous("dd if=image.iso >/dev/sda")).toBe("write to disk device");
    });

    it("detects sudo", () => {
      expect(isDangerous("sudo rm -rf /tmp")).toBe("sudo");
    });

    it("returns null for safe commands", () => {
      expect(isDangerous("ls -la")).toBeNull();
      expect(isDangerous("git status")).toBeNull();
      expect(isDangerous("npm install")).toBeNull();
      expect(isDangerous("cat package.json")).toBeNull();
      expect(isDangerous("echo hello")).toBeNull();
    });

    it("returns null for rm -rf on relative paths", () => {
      expect(isDangerous("rm -rf node_modules/")).toBeNull();
      expect(isDangerous("rm -rf dist/")).toBeNull();
    });
  });

  describe("READ_TOOLS", () => {
    it("contains expected tools", () => {
      expect(READ_TOOLS.has("read_file")).toBe(true);
      expect(READ_TOOLS.has("view_image")).toBe(true);
      expect(READ_TOOLS.has("glob")).toBe(true);
      expect(READ_TOOLS.has("grep")).toBe(true);
      expect(READ_TOOLS.has("ls")).toBe(true);
      expect(READ_TOOLS.has("sub_agent")).toBe(true);
    });

    it("does not contain write tools", () => {
      expect(READ_TOOLS.has("bash")).toBe(false);
      expect(READ_TOOLS.has("write_file")).toBe(false);
      expect(READ_TOOLS.has("edit_file")).toBe(false);
    });
  });

  describe("AUTO_EDIT_TOOLS", () => {
    it("contains expected tools", () => {
      expect(AUTO_EDIT_TOOLS.has("read_file")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("view_image")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("write_file")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("edit_file")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("patch")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("glob")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("grep")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("ls")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("fetch")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("web_search")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("todo")).toBe(true);
      expect(AUTO_EDIT_TOOLS.has("sub_agent")).toBe(true);
    });

    it("does not contain bash", () => {
      expect(AUTO_EDIT_TOOLS.has("bash")).toBe(false);
    });
  });

  describe("READ_TOOLS includes lsp", () => {
    it("has lsp in read tools", () => {
      expect(READ_TOOLS.has("lsp")).toBe(true);
    });
  });

  describe("checkPermissionRules()", () => {
    it("returns 'none' when no rules provided", () => {
      expect(checkPermissionRules("bash", { command: "npm test" })).toBe("none");
      expect(checkPermissionRules("bash", { command: "npm test" }, undefined)).toBe("none");
      expect(checkPermissionRules("bash", { command: "npm test" }, {})).toBe("none");
    });

    it("matches simple tool name allow rules", () => {
      const rules = { allow: ["bash"] };
      expect(checkPermissionRules("bash", { command: "anything" }, rules)).toBe("allow");
      expect(checkPermissionRules("write_file", { path: "foo.ts" }, rules)).toBe("none");
    });

    it("matches simple tool name deny rules", () => {
      const rules = { deny: ["bash"] };
      expect(checkPermissionRules("bash", { command: "anything" }, rules)).toBe("deny");
      expect(checkPermissionRules("write_file", { path: "foo.ts" }, rules)).toBe("none");
    });

    it("deny wins over allow", () => {
      const rules = { allow: ["bash"], deny: ["bash"] };
      expect(checkPermissionRules("bash", { command: "npm test" }, rules)).toBe("deny");
    });

    it("matches bash command glob patterns", () => {
      const rules = { allow: ["bash(npm run *)"] };
      expect(checkPermissionRules("bash", { command: "npm run test" }, rules)).toBe("allow");
      expect(checkPermissionRules("bash", { command: "npm run build" }, rules)).toBe("allow");
      expect(checkPermissionRules("bash", { command: "rm -rf /" }, rules)).toBe("none");
    });

    it("matches write_file path glob patterns", () => {
      const rules = { deny: ["write_file(*.env)"] };
      expect(checkPermissionRules("write_file", { path: ".env" }, rules)).toBe("deny");
      expect(checkPermissionRules("write_file", { path: "src/index.ts" }, rules)).toBe("none");
    });

    it("matches file_path input key", () => {
      const rules = { deny: ["edit_file(*.env)"] };
      expect(checkPermissionRules("edit_file", { file_path: ".env" }, rules)).toBe("deny");
    });

    it("is case-insensitive for glob matching", () => {
      const rules = { allow: ["bash(npm *)"] };
      expect(checkPermissionRules("bash", { command: "NPM install" }, rules)).toBe("allow");
    });

    it("supports multiple rules — first match wins", () => {
      const rules = {
        allow: ["bash(npm run *)", "bash(git status)"],
      };
      expect(checkPermissionRules("bash", { command: "npm run test" }, rules)).toBe("allow");
      expect(checkPermissionRules("bash", { command: "git status" }, rules)).toBe("allow");
      expect(checkPermissionRules("bash", { command: "git push" }, rules)).toBe("none");
    });

    it("handles empty command/path gracefully", () => {
      const rules = { allow: ["bash(npm *)"] };
      expect(checkPermissionRules("bash", {}, rules)).toBe("none");
    });
  });
});
