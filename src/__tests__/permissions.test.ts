import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// Mock safety module for consistent behavior
vi.mock("../safety.js", async () => {
  const actual = await vi.importActual("../safety.js");
  return actual;
});

import { PermissionManager } from "../permissions.js";
import {
  saveProjectSettings,
  saveLocalSettings,
  loadProjectSettings,
  loadLocalSettings,
} from "../config.js";

describe("PermissionManager", () => {
  describe("read tools auto-allowed", () => {
    it("allows read_file without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("read_file", { path: "/test" });
      expect(allowed).toBe(true);
    });

    it("allows view_image without prompting", async () => {
      const pm = new PermissionManager(false);
      const allowed = await pm.checkPermission("view_image", { path: "/tmp/screenshot.png" });
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

    it("does NOT auto-allow tools not in configTrust list", async () => {
      const pm = new PermissionManager(false, ["write_file"]);
      // bash is not in configTrust, not a read tool, and not trust-all — falls through to promptUser
      // We need to mock readline to answer
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("n")),
      };
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("bash", { command: "echo hello" });
      expect(allowed).toBe(false);
    });
  });

  describe("interactive promptUser", () => {
    let pm: PermissionManager;
    let mockRl: { resume: any; pause: any; question: any };

    function createMockRl(answer: string) {
      return {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb(answer)),
      };
    }

    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("returns true when user answers 'y'", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("y");
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(allowed).toBe(true);
    });

    it("returns true when user answers 'yes'", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("yes");
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("edit_file", { path: "/test.ts" });
      expect(allowed).toBe(true);
    });

    it("returns false when user answers 'n'", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("n");
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(allowed).toBe(false);
    });

    it("returns false for any non-y/n/a/t answer", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("maybe");
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(allowed).toBe(false);
    });

    it("'a' (always) adds tool to session allowlist", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("a");
      pm.setReadline(mockRl as any);

      // First call: prompts and user says "a"
      const first = await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });
      expect(first).toBe(true);

      // Second call: should be auto-allowed via sessionAllow — no prompt
      mockRl.question.mockClear();
      const second = await pm.checkPermission("write_file", { path: "/other.ts", content: "y" });
      expect(second).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });

    it("'always' adds tool to session allowlist", async () => {
      pm = new PermissionManager(false);
      mockRl = createMockRl("always");
      pm.setReadline(mockRl as any);

      const first = await pm.checkPermission("patch", { patch_text: "diff" });
      expect(first).toBe(true);

      mockRl.question.mockClear();
      const second = await pm.checkPermission("patch", { patch_text: "diff2" });
      expect(second).toBe(true);
      expect(mockRl.question).not.toHaveBeenCalled();
    });

    // "trust all" option removed from prompt — trust is now a mode (shift+tab), not a prompt choice.
  });

  describe("dangerous bash commands", () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("prompts for dangerous commands even before normal permission check", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("no")),
      };
      pm.setReadline(mockRl as any);

      const allowed = await pm.checkPermission("bash", { command: "git reset --hard" });
      expect(allowed).toBe(false);
    });

    it("allows dangerous commands with 'yes' confirmation", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        // First call is dangerous confirmation, second would be normal prompt
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("yes")),
      };
      pm.setReadline(mockRl as any);

      // The dangerous prompt asks for "yes" (not just "y"), then falls through to normal prompt
      // which also gets "yes" — but "yes" maps to "y" || "yes" in promptUser, so returns true
      const allowed = await pm.checkPermission("bash", { command: "sudo rm -rf /tmp/test" });
      expect(allowed).toBe(true);
    });
  });

  describe("cancelPrompt", () => {
    it("cancelPrompt rejects the pending question", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        // Never call the callback — simulates user not answering
        question: vi.fn(),
      };
      pm.setReadline(mockRl as any);

      vi.spyOn(console, "log").mockImplementation(() => {});

      const permissionPromise = pm.checkPermission("write_file", { path: "/test.ts", content: "x" });

      // Cancel while waiting
      pm.cancelPrompt();

      await expect(permissionPromise).rejects.toThrow("cancelled");
    });

    it("cancelPrompt is a no-op when no prompt is active", () => {
      const pm = new PermissionManager(false);
      // Should not throw
      pm.cancelPrompt();
    });
  });

  describe("questionActive flag", () => {
    it("sets questionActive during prompt and clears after", async () => {
      const pm = new PermissionManager(false);
      let capturedActive = false;
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
          capturedActive = pm.questionActive;
          cb("y");
        }),
      };
      pm.setReadline(mockRl as any);

      vi.spyOn(console, "log").mockImplementation(() => {});

      await pm.checkPermission("write_file", { path: "/test.ts", content: "x" });

      expect(capturedActive).toBe(true);
      expect(pm.questionActive).toBe(false);
    });
  });

  describe("formatToolCall display", () => {
    beforeEach(() => {
      vi.spyOn(console, "log").mockImplementation(() => {});
    });

    it("displays command for bash tool", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("y")),
      };
      pm.setReadline(mockRl as any);

      await pm.checkPermission("bash", { command: "echo hello" });
      // Verify console.log was called with the command somewhere in the output
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("echo hello");
    });

    it("displays path for write_file tool", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("n")),
      };
      pm.setReadline(mockRl as any);

      await pm.checkPermission("write_file", { path: "/some/file.ts", content: "data" });
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("/some/file.ts");
    });

    it("displays URL for fetch tool", async () => {
      const pm = new PermissionManager(false);
      const mockRl = {
        resume: vi.fn(),
        pause: vi.fn(),
        question: vi.fn((_prompt: string, cb: (answer: string) => void) => cb("n")),
      };
      pm.setReadline(mockRl as any);

      await pm.checkPermission("fetch", { url: "https://example.com" });
      const logCalls = (console.log as any).mock.calls.flat().join(" ");
      expect(logCalls).toContain("https://example.com");
    });
  });
});

// ─── Three-layer settings (project + local) ───────────────────────────────────

describe("three-layer permission settings", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-perm-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("saveProjectSettings / loadProjectSettings", () => {
    it("creates .workermill/settings.json in cwd", () => {
      saveProjectSettings({ allow: ["bash(npm run *)"] }, tmpDir);
      const settingsPath = path.join(tmpDir, ".workermill", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(parsed.allow).toContain("bash(npm run *)");
    });

    it("does not touch the global config file", () => {
      const globalPath = path.join(os.homedir(), ".workermill", "cli.json");
      const before = fs.existsSync(globalPath)
        ? fs.readFileSync(globalPath, "utf-8")
        : null;
      saveProjectSettings({ allow: ["edit_file"] }, tmpDir);
      const after = fs.existsSync(globalPath)
        ? fs.readFileSync(globalPath, "utf-8")
        : null;
      expect(before).toBe(after);
    });

    it("roundtrips allow, deny, and ask rules", () => {
      const rules = { allow: ["read_file"], deny: ["bash(rm *)"], ask: ["bash"] };
      saveProjectSettings(rules, tmpDir);
      const loaded = loadProjectSettings();
      expect(loaded?.allow).toEqual(["read_file"]);
      expect(loaded?.deny).toEqual(["bash(rm *)"]);
      expect(loaded?.ask).toEqual(["bash"]);
    });

    it("returns null when no settings file exists", () => {
      expect(loadProjectSettings()).toBeNull();
    });
  });

  describe("saveLocalSettings / loadLocalSettings", () => {
    it("creates .workermill/settings.local.json in cwd", () => {
      saveLocalSettings({ allow: ["edit_file"] }, tmpDir);
      const localPath = path.join(tmpDir, ".workermill", "settings.local.json");
      expect(fs.existsSync(localPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(localPath, "utf-8"));
      expect(parsed.allow).toContain("edit_file");
    });

    it("does not write to settings.json (project file)", () => {
      saveLocalSettings({ allow: ["edit_file"] }, tmpDir);
      const projectPath = path.join(tmpDir, ".workermill", "settings.json");
      expect(fs.existsSync(projectPath)).toBe(false);
    });

    it("returns null when no local settings file exists", () => {
      expect(loadLocalSettings()).toBeNull();
    });

    it("roundtrips rules correctly", () => {
      saveLocalSettings({ allow: ["bash(make *)"], deny: ["bash(rm -rf *)"] }, tmpDir);
      const loaded = loadLocalSettings();
      expect(loaded?.allow).toContain("bash(make *)");
      expect(loaded?.deny).toContain("bash(rm -rf *)");
    });
  });

  describe("project isolation", () => {
    it("rules from one project directory are not visible from another", () => {
      // Save in tmpDir (project A)
      saveProjectSettings({ allow: ["bash(make build)"] }, tmpDir);

      // Switch to a different directory (project B)
      const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "wm-perm-b-"));
      try {
        process.chdir(projectB);
        expect(loadProjectSettings()).toBeNull();
      } finally {
        process.chdir(tmpDir);
        fs.rmSync(projectB, { recursive: true, force: true });
      }
    });

    it("local settings from one project are not visible from another", () => {
      saveLocalSettings({ allow: ["edit_file"] }, tmpDir);

      const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "wm-perm-b-"));
      try {
        process.chdir(projectB);
        expect(loadLocalSettings()).toBeNull();
      } finally {
        process.chdir(tmpDir);
        fs.rmSync(projectB, { recursive: true, force: true });
      }
    });
  });

  describe("layer precedence (local overrides project)", () => {
    it("local allow takes effect alongside project allow", () => {
      saveProjectSettings({ allow: ["bash(npm run *)"] }, tmpDir);
      saveLocalSettings({ allow: ["edit_file"] }, tmpDir);

      const project = loadProjectSettings();
      const local = loadLocalSettings();

      // Both layers are independently readable — merging is done in resolveConfig
      expect(project?.allow).toContain("bash(npm run *)");
      expect(local?.allow).toContain("edit_file");
    });

    it("deny rule in project settings is preserved independently of local allow", () => {
      saveProjectSettings({ deny: ["bash(rm *)"] }, tmpDir);
      saveLocalSettings({ allow: ["bash(rm *)"] }, tmpDir);

      // PermissionManager deny-wins logic is tested separately;
      // here we just confirm both layers load with their intended values
      expect(loadProjectSettings()?.deny).toContain("bash(rm *)");
      expect(loadLocalSettings()?.allow).toContain("bash(rm *)");
    });
  });

  describe("settings.json is separate from settings.local.json", () => {
    it("saving project settings does not overwrite local settings", () => {
      saveLocalSettings({ allow: ["edit_file"] }, tmpDir);
      saveProjectSettings({ allow: ["bash(npm run *)"] }, tmpDir);

      // Both files exist independently
      expect(fs.existsSync(path.join(tmpDir, ".workermill", "settings.json"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, ".workermill", "settings.local.json"))).toBe(true);

      // Each contains only its own rules
      expect(loadProjectSettings()?.allow).toEqual(["bash(npm run *)"]);
      expect(loadLocalSettings()?.allow).toEqual(["edit_file"]);
    });
  });
});
