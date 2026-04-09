import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { executeMemoryCommand, getMemoriesDir, ensureMemoriesDir } from "../engine/tools/memory.js";

// Use a temp directory so tests don't touch real project data
let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-memory-test-"));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  // Initialize a git repo so project-data can derive a project ID
  fs.mkdirSync(".git");
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("memory tool", () => {
  describe("ensureMemoriesDir", () => {
    it("creates the memories directory if it does not exist", () => {
      ensureMemoriesDir();
      expect(fs.existsSync(getMemoriesDir())).toBe(true);
    });

    it("is idempotent", () => {
      ensureMemoriesDir();
      ensureMemoriesDir();
      expect(fs.existsSync(getMemoriesDir())).toBe(true);
    });
  });

  describe("view", () => {
    it("lists an empty directory", async () => {
      const result = await executeMemoryCommand({ command: "view" });
      expect(result).toContain("/memories");
    });

    it("lists files after creating one", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/notes.md", file_text: "hello" });
      const result = await executeMemoryCommand({ command: "view" });
      expect(result).toContain("notes.md");
    });

    it("reads file contents with line numbers", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/test.md", file_text: "line one\nline two\nline three" });
      const result = await executeMemoryCommand({ command: "view", path: "/memories/test.md" });
      expect(result).toContain("line one");
      expect(result).toContain("line two");
      expect(result).toContain("line three");
      // Line numbers should be present
      expect(result).toMatch(/\d+\tline one/);
    });

    it("supports view_range for partial reads", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/long.md", file_text: "a\nb\nc\nd\ne" });
      const result = await executeMemoryCommand({ command: "view", path: "/memories/long.md", view_range: [2, 4] });
      expect(result).toContain("b");
      expect(result).toContain("c");
      expect(result).toContain("d");
      expect(result).not.toContain("\ta\n");
      expect(result).not.toContain("\te");
    });

    it("returns error for non-existent path", async () => {
      const result = await executeMemoryCommand({ command: "view", path: "/memories/nope.md" });
      expect(result).toContain("does not exist");
    });
  });

  describe("create", () => {
    it("creates a new file", async () => {
      const result = await executeMemoryCommand({ command: "create", path: "/memories/new.md", file_text: "content here" });
      expect(result).toContain("File created successfully");
      const dir = getMemoriesDir();
      const content = fs.readFileSync(path.join(dir, "new.md"), "utf-8");
      expect(content).toContain("content here");
      // Should have provenance header
      expect(content).toContain("source: agent");
    });

    it("creates nested directories", async () => {
      const result = await executeMemoryCommand({ command: "create", path: "/memories/sub/deep/file.md", file_text: "nested" });
      expect(result).toContain("File created successfully");
      const dir = getMemoriesDir();
      expect(fs.readFileSync(path.join(dir, "sub", "deep", "file.md"), "utf-8")).toContain("nested");
    });

    it("returns error if file already exists", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/dup.md", file_text: "first" });
      const result = await executeMemoryCommand({ command: "create", path: "/memories/dup.md", file_text: "second" });
      expect(result).toContain("already exists");
    });
  });

  describe("str_replace", () => {
    it("replaces text in a file", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/edit.md", file_text: "color: blue\nsize: large" });
      const result = await executeMemoryCommand({ command: "str_replace", path: "/memories/edit.md", old_str: "color: blue", new_str: "color: green" });
      expect(result).toContain("has been edited");
      const dir = getMemoriesDir();
      expect(fs.readFileSync(path.join(dir, "edit.md"), "utf-8")).toContain("color: green");
    });

    it("returns error when old_str not found", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/edit2.md", file_text: "hello world" });
      const result = await executeMemoryCommand({ command: "str_replace", path: "/memories/edit2.md", old_str: "nonexistent", new_str: "replacement" });
      expect(result).toContain("did not appear verbatim");
    });

    it("returns error on multiple matches", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/multi.md", file_text: "foo bar\nfoo baz" });
      const result = await executeMemoryCommand({ command: "str_replace", path: "/memories/multi.md", old_str: "foo", new_str: "qux" });
      expect(result).toContain("Multiple occurrences");
    });

    it("returns error for non-existent file", async () => {
      const result = await executeMemoryCommand({ command: "str_replace", path: "/memories/missing.md", old_str: "a", new_str: "b" });
      expect(result).toContain("does not exist");
    });
  });

  describe("insert", () => {
    it("inserts text at a specific line", async () => {
      // Create with frontmatter already included to get predictable content
      await executeMemoryCommand({ command: "create", path: "/memories/ins.md", file_text: "---\ntest: true\n---\n\nline 1\nline 3" });
      // Insert after the frontmatter + content lines
      const dir = getMemoriesDir();
      const before = fs.readFileSync(path.join(dir, "ins.md"), "utf-8");
      const lineCount = before.split("\n").length;
      // Insert "line 2" before "line 3" (second to last content line)
      const result = await executeMemoryCommand({ command: "insert", path: "/memories/ins.md", insert_line: lineCount - 1, insert_text: "line 2" });
      expect(result).toContain("has been edited");
      const content = fs.readFileSync(path.join(dir, "ins.md"), "utf-8");
      expect(content).toContain("line 1\nline 2\nline 3");
    });

    it("returns error for invalid line number", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/ins2.md", file_text: "one line" });
      const result = await executeMemoryCommand({ command: "insert", path: "/memories/ins2.md", insert_line: 99, insert_text: "bad" });
      expect(result).toContain("Invalid");
    });

    it("returns error for non-existent file", async () => {
      const result = await executeMemoryCommand({ command: "insert", path: "/memories/nope.md", insert_line: 0, insert_text: "text" });
      expect(result).toContain("does not exist");
    });
  });

  describe("delete", () => {
    it("deletes a file", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/del.md", file_text: "to delete" });
      const result = await executeMemoryCommand({ command: "delete", path: "/memories/del.md" });
      expect(result).toContain("Successfully deleted");
      const dir = getMemoriesDir();
      expect(fs.existsSync(path.join(dir, "del.md"))).toBe(false);
    });

    it("deletes a directory recursively", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/dir/a.md", file_text: "a" });
      await executeMemoryCommand({ command: "create", path: "/memories/dir/b.md", file_text: "b" });
      const result = await executeMemoryCommand({ command: "delete", path: "/memories/dir" });
      expect(result).toContain("Successfully deleted");
      const dir = getMemoriesDir();
      expect(fs.existsSync(path.join(dir, "dir"))).toBe(false);
    });

    it("returns error for non-existent path", async () => {
      const result = await executeMemoryCommand({ command: "delete", path: "/memories/nope.md" });
      expect(result).toContain("does not exist");
    });
  });

  describe("rename", () => {
    it("renames a file", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/old.md", file_text: "content" });
      const result = await executeMemoryCommand({ command: "rename", old_path: "/memories/old.md", new_path: "/memories/new.md" });
      expect(result).toContain("Successfully renamed");
      const dir = getMemoriesDir();
      expect(fs.existsSync(path.join(dir, "old.md"))).toBe(false);
      expect(fs.readFileSync(path.join(dir, "new.md"), "utf-8")).toContain("content");
    });

    it("returns error when source does not exist", async () => {
      const result = await executeMemoryCommand({ command: "rename", old_path: "/memories/nope.md", new_path: "/memories/dest.md" });
      expect(result).toContain("does not exist");
    });

    it("returns error when destination already exists", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/a.md", file_text: "a" });
      await executeMemoryCommand({ command: "create", path: "/memories/b.md", file_text: "b" });
      const result = await executeMemoryCommand({ command: "rename", old_path: "/memories/a.md", new_path: "/memories/b.md" });
      expect(result).toContain("already exists");
    });
  });

  describe("path traversal protection", () => {
    it("rejects paths that escape the memories directory", async () => {
      const result = await executeMemoryCommand({ command: "view", path: "/memories/../../etc/passwd" });
      expect(result).toContain("outside the memories directory");
    });

    it("rejects create with traversal path", async () => {
      const result = await executeMemoryCommand({ command: "create", path: "/memories/../../../tmp/evil.md", file_text: "bad" });
      expect(result).toContain("outside the memories directory");
    });

    it("rejects delete with traversal path", async () => {
      const result = await executeMemoryCommand({ command: "delete", path: "/memories/../../.ssh/authorized_keys" });
      expect(result).toContain("outside the memories directory");
    });

    it("rejects rename with traversal in old_path", async () => {
      const result = await executeMemoryCommand({ command: "rename", old_path: "/memories/../../etc/shadow", new_path: "/memories/stolen.md" });
      expect(result).toContain("outside the memories directory");
    });

    it("rejects rename with traversal in new_path", async () => {
      await executeMemoryCommand({ command: "create", path: "/memories/legit.md", file_text: "ok" });
      const result = await executeMemoryCommand({ command: "rename", old_path: "/memories/legit.md", new_path: "/memories/../../tmp/exfil.md" });
      expect(result).toContain("outside the memories directory");
    });
  });

  describe("unknown command", () => {
    it("returns error for unknown commands", async () => {
      const result = await executeMemoryCommand({ command: "badcmd" });
      expect(result).toContain("Unknown memory command");
    });
  });
});
