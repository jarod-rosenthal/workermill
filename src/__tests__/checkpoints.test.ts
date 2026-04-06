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
    it("creates a backup of an existing file", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "original content");

      const created = checkpoint(filePath);
      expect(created).toBe(true);

      const cpDir = path.join(tempDir, ".workermill", "checkpoints");
      expect(fs.existsSync(cpDir)).toBe(true);
      const files = fs.readdirSync(cpDir);
      expect(files.length).toBe(1);
    });

    it("returns false for non-existent files (new file)", () => {
      const filePath = path.join(tempDir, "does-not-exist.ts");
      const created = checkpoint(filePath);
      expect(created).toBe(false);
    });

    it("preserves original file content in backup", () => {
      const filePath = path.join(tempDir, "data.json");
      fs.writeFileSync(filePath, '{"key": "value"}');

      checkpoint(filePath);

      // Now overwrite the file
      fs.writeFileSync(filePath, '{"key": "changed"}');

      // Backup should have original content
      const cpDir = path.join(tempDir, ".workermill", "checkpoints");
      const backupFile = fs.readdirSync(cpDir)[0];
      const backupContent = fs.readFileSync(path.join(cpDir, backupFile), "utf-8");
      expect(backupContent).toBe('{"key": "value"}');
    });
  });

  describe("undoLast()", () => {
    it("restores the last checkpointed file", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "original");

      checkpoint(filePath);
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

      checkpoint(file1);
      fs.writeFileSync(file1, "modified-a");
      checkpoint(file2);
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
  });

  describe("undoFile()", () => {
    it("restores a specific file by path", () => {
      const file1 = path.join(tempDir, "keep.ts");
      const file2 = path.join(tempDir, "restore.ts");
      fs.writeFileSync(file1, "keep-original");
      fs.writeFileSync(file2, "restore-original");

      checkpoint(file1);
      fs.writeFileSync(file1, "keep-modified");
      checkpoint(file2);
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

    it("lists checkpoints most recent first", () => {
      const file1 = path.join(tempDir, "first.ts");
      const file2 = path.join(tempDir, "second.ts");
      fs.writeFileSync(file1, "a");
      fs.writeFileSync(file2, "b");

      checkpoint(file1);
      checkpoint(file2);

      const list = listCheckpoints();
      expect(list).toHaveLength(2);
      expect(list[0].file).toBe("second.ts");
      expect(list[1].file).toBe("first.ts");
    });
  });

  describe("clearCheckpoints()", () => {
    it("removes all checkpoints and the directory", () => {
      const filePath = path.join(tempDir, "test.ts");
      fs.writeFileSync(filePath, "content");
      checkpoint(filePath);

      clearCheckpoints();

      expect(listCheckpoints()).toEqual([]);
      expect(fs.existsSync(path.join(tempDir, ".workermill", "checkpoints"))).toBe(false);
    });

    it("is safe to call when no checkpoints exist", () => {
      // Should not throw even when checkpoint dir doesn't exist
      expect(() => clearCheckpoints()).not.toThrow();
      expect(listCheckpoints()).toEqual([]);
    });
  });

  describe("setCheckpointDir()", () => {
    it("changes where checkpoints are stored", () => {
      const altDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-cp-alt-"));
      try {
        setCheckpointDir(altDir);

        const filePath = path.join(altDir, "file.ts");
        fs.writeFileSync(filePath, "content");
        checkpoint(filePath);

        const cpDir = path.join(altDir, ".workermill", "checkpoints");
        expect(fs.existsSync(cpDir)).toBe(true);
        expect(fs.readdirSync(cpDir).length).toBe(1);
      } finally {
        clearCheckpoints();
        fs.rmSync(altDir, { recursive: true, force: true });
        setCheckpointDir(tempDir);
      }
    });
  });

  describe("multiple checkpoints on the same file", () => {
    it("creates separate checkpoints for each edit", () => {
      const filePath = path.join(tempDir, "multi.ts");
      fs.writeFileSync(filePath, "v1");
      checkpoint(filePath);

      fs.writeFileSync(filePath, "v2");
      checkpoint(filePath);

      fs.writeFileSync(filePath, "v3");

      // Two checkpoints should exist
      expect(listCheckpoints()).toHaveLength(2);
    });

    it("undoLast(2) restores both checkpoints in reverse order", () => {
      const file1 = path.join(tempDir, "multi-a.ts");
      const file2 = path.join(tempDir, "multi-b.ts");
      fs.writeFileSync(file1, "a-original");
      fs.writeFileSync(file2, "b-original");

      checkpoint(file1);
      fs.writeFileSync(file1, "a-modified");
      checkpoint(file2);
      fs.writeFileSync(file2, "b-modified");

      const restored = undoLast(2);
      expect(restored).toHaveLength(2);
      expect(fs.readFileSync(file1, "utf-8")).toBe("a-original");
      expect(fs.readFileSync(file2, "utf-8")).toBe("b-original");
    });

    it("undoLast restores the most recent checkpoint of a multiply-checkpointed file", () => {
      const filePath = path.join(tempDir, "multi.ts");
      fs.writeFileSync(filePath, "v1");
      checkpoint(filePath);

      fs.writeFileSync(filePath, "v2");
      checkpoint(filePath);

      fs.writeFileSync(filePath, "v3");

      // First undo restores v2 (most recent checkpoint)
      undoLast();
      expect(fs.readFileSync(filePath, "utf-8")).toBe("v2");
    });
  });

  describe("undoFile() edge cases", () => {
    it("returns false when backup file has been manually deleted", () => {
      const filePath = path.join(tempDir, "edge.ts");
      fs.writeFileSync(filePath, "original");
      checkpoint(filePath);

      // Delete the backup manually
      const cpDir = path.join(tempDir, ".workermill", "checkpoints");
      const backups = fs.readdirSync(cpDir);
      for (const b of backups) {
        fs.unlinkSync(path.join(cpDir, b));
      }

      // Also delete the original so copyFileSync fails
      fs.unlinkSync(filePath);

      const result = undoFile(filePath);
      expect(result).toBe(false);
    });

    it("removes checkpoint from list after successful undo", () => {
      const filePath = path.join(tempDir, "tracked.ts");
      fs.writeFileSync(filePath, "original");
      checkpoint(filePath);

      expect(listCheckpoints()).toHaveLength(1);
      undoFile(filePath);
      expect(listCheckpoints()).toHaveLength(0);
    });
  });

  describe("undoLast() edge cases", () => {
    it("stops when count exceeds available checkpoints", () => {
      const filePath = path.join(tempDir, "only.ts");
      fs.writeFileSync(filePath, "content");
      checkpoint(filePath);

      const restored = undoLast(5);
      expect(restored).toHaveLength(1);
    });
  });
});
