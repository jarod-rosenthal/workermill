import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  setCheckpointDir,
  checkpoint,
  undoLast,
  undoFile,
  listCheckpoints,
  clearCheckpoints,
  getChangedFiles,
} from "../checkpoints.js";

describe("checkpoints", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-checkpoint-test-"));
    setCheckpointDir(tempDir);
  });

  afterEach(() => {
    clearCheckpoints();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("checkpoint()", () => {
    it("tracks an existing file", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "original content");

      const created = checkpoint(filePath, "edit_file");
      expect(created).toBe(true);
    });

    it("tracks a new file with null beforeContent", () => {
      const filePath = path.join(tempDir, "does-not-exist.ts");
      const created = checkpoint(filePath, "write_file");
      expect(created).toBe(true);
    });

    it("does not track the same file twice", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "original content");

      checkpoint(filePath, "edit_file");
      const second = checkpoint(filePath, "edit_file");
      expect(second).toBe(false);
    });
  });

  describe("undoLast()", () => {
    it("restores the last tracked file", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "original");

      checkpoint(filePath, "edit_file");
      fs.writeFileSync(filePath, "modified");

      const restored = undoLast();
      expect(restored).toHaveLength(1);
      expect(restored[0]).toBe("test.ts");

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toBe("original");
    });

    it("restores last N files", () => {
      const file1 = path.join(tempDir, "a.ts");
      const file2 = path.join(tempDir, "b.ts");
      fs.writeFileSync(file1, "original-a");
      fs.writeFileSync(file2, "original-b");

      checkpoint(file1, "edit_file");
      fs.writeFileSync(file1, "modified-a");
      checkpoint(file2, "edit_file");
      fs.writeFileSync(file2, "modified-b");

      const restored = undoLast(2);
      expect(restored).toHaveLength(2);

      expect(fs.readFileSync(file1, "utf-8")).toBe("original-a");
      expect(fs.readFileSync(file2, "utf-8")).toBe("original-b");
    });

    it("returns empty array when no checkpoints", () => {
      const restored = undoLast();
      expect(restored).toEqual([]);
    });

    it("deletes newly created files", () => {
      const filePath = path.join(tempDir, "new.ts");
      checkpoint(filePath, "write_file");
      fs.writeFileSync(filePath, "new content");

      const restored = undoLast();
      expect(restored).toHaveLength(1);
      expect(restored[0]).toBe("new.ts");

      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("undoFile()", () => {
    it("restores a specific file by path", () => {
      const file1 = path.join(tempDir, "keep.ts");
      const file2 = path.join(tempDir, "restore.ts");
      fs.writeFileSync(file1, "keep-original");
      fs.writeFileSync(file2, "restore-original");

      checkpoint(file1, "edit_file");
      fs.writeFileSync(file1, "keep-modified");
      checkpoint(file2, "edit_file");
      fs.writeFileSync(file2, "restore-modified");

      const result = undoFile(file2);
      expect(result).toBe(true);

      // file2 restored, file1 untouched
      expect(fs.readFileSync(file2, "utf-8")).toBe("restore-original");
      expect(fs.readFileSync(file1, "utf-8")).toBe("keep-modified");
    });

    it("returns false for unknown file", () => {
      const result = undoFile("/nonexistent/file.ts");
      expect(result).toBe(false);
    });
  });

  describe("listCheckpoints()", () => {
    it("returns empty array when no checkpoints", () => {
      expect(listCheckpoints()).toEqual([]);
    });

    it("lists tracked changes most recent first", () => {
      const file1 = path.join(tempDir, "first.ts");
      const file2 = path.join(tempDir, "second.ts");
      fs.writeFileSync(file1, "a");
      fs.writeFileSync(file2, "b");

      checkpoint(file1, "edit_file");
      checkpoint(file2, "edit_file");

      const list = listCheckpoints();
      expect(list).toHaveLength(2);
      expect(list[0].file).toBe("second.ts");
      expect(list[1].file).toBe("first.ts");
    });
  });

  describe("clearCheckpoints()", () => {
    it("removes all tracked changes", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "content");
      checkpoint(filePath, "edit_file");

      clearCheckpoints();

      expect(listCheckpoints()).toEqual([]);
    });

    it("is safe to call when no checkpoints exist", () => {
      expect(() => clearCheckpoints()).not.toThrow();
      expect(listCheckpoints()).toEqual([]);
    });
  });

  describe("setCheckpointDir()", () => {
    it("changes working directory for relative paths", () => {
      const altDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-cp-alt-"));
      try {
        setCheckpointDir(altDir);

        const filePath = path.join(altDir, "file.ts");
        fs.writeFileSync(filePath, "content");
        checkpoint(filePath, "edit_file");

        expect(listCheckpoints()).toHaveLength(1);
      } finally {
        clearCheckpoints();
        fs.rmSync(altDir, { recursive: true, force: true });
        setCheckpointDir(tempDir);
      }
    });
  });

  describe("multiple files", () => {
    it("tracks only first change per file", () => {
      const filePath = path.join(tempDir, "multi.ts");
      fs.writeFileSync(filePath, "v1");
      checkpoint(filePath, "edit_file");

      fs.writeFileSync(filePath, "v2");
      checkpoint(filePath, "edit_file"); // should not add second

      expect(listCheckpoints()).toHaveLength(1);
    });

    it("undoLast(2) restores both files", () => {
      const file1 = path.join(tempDir, "multi-a.ts");
      const file2 = path.join(tempDir, "multi-b.ts");
      fs.writeFileSync(file1, "a-original");
      fs.writeFileSync(file2, "b-original");

      checkpoint(file1, "edit_file");
      fs.writeFileSync(file1, "a-modified");
      checkpoint(file2, "edit_file");
      fs.writeFileSync(file2, "b-modified");

      const restored = undoLast(2);
      expect(restored).toHaveLength(2);
      expect(fs.readFileSync(file1, "utf-8")).toBe("a-original");
      expect(fs.readFileSync(file2, "utf-8")).toBe("b-original");
    });
  });

  describe("undoFile() edge cases", () => {
    it("returns false for file not tracked", () => {
      const filePath = path.join(tempDir, "edge.ts");
      fs.writeFileSync(filePath, "original");

      const result = undoFile(filePath);
      expect(result).toBe(false);
    });

    it("removes tracked change after successful undo", () => {
      const filePath = path.join(tempDir, "tracked.ts");
      fs.writeFileSync(filePath, "original");
      checkpoint(filePath, "edit_file");

      expect(listCheckpoints()).toHaveLength(1);
      undoFile(filePath);
      expect(listCheckpoints()).toHaveLength(0);
    });
  });

  describe("undoLast() edge cases", () => {
    it("stops when count exceeds available tracked changes", () => {
      const filePath = path.join(tempDir, "only.ts");
      fs.writeFileSync(filePath, "content");
      checkpoint(filePath, "edit_file");

      const restored = undoLast(5);
      expect(restored).toHaveLength(1);
    });
  });

  describe("getChangedFiles()", () => {
    it("returns all tracked changes", () => {
      const file1 = path.join(tempDir, "a.ts");
      const file2 = path.join(tempDir, "b.ts");
      fs.writeFileSync(file1, "content a");
      // file2 is new
      checkpoint(file1, "edit_file");
      checkpoint(file2, "write_file");

      const changes = getChangedFiles();
      expect(changes).toHaveLength(2);
      expect(changes[0].path).toBe(file1);
      expect(changes[0].tool).toBe("edit_file");
      expect(changes[0].beforeContent).toBe("content a");
      expect(changes[1].path).toBe(file2);
      expect(changes[1].tool).toBe("write_file");
      expect(changes[1].beforeContent).toBe(null);
    });
  });
});
