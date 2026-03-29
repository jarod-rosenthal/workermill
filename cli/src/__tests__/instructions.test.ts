import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// No mocks needed — instructions.ts only reads from a provided workingDir
// and does not touch ~/.workermill or logger.

describe("instructions", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "wm-instructions-"));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  // Helper: write a file relative to workDir, creating parent dirs as needed
  function writeFile(relPath: string, content: string): void {
    const fullPath = path.join(workDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  // Use static imports because instructions.ts has no module-level side effects
  // that depend on the environment — it is safe to import once at the top level.
  // We inline the import inside each test via a helper to keep the pattern clean.
  async function importInstructions() {
    const mod = await import("../instructions.js");
    return mod;
  }

  describe("loadProjectInstructions()", () => {
    it("returns null when no instruction files exist", async () => {
      const { loadProjectInstructions } = await importInstructions();
      expect(loadProjectInstructions(workDir)).toBeNull();
    });

    it("finds WORKERMILL.md first (highest priority)", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "workermill instructions");
      writeFile("CLAUDE.md", "claude instructions");
      writeFile(".cursorrules", "cursor instructions");

      expect(loadProjectInstructions(workDir)).toBe("workermill instructions");
    });

    it("finds .workermill/instructions.md over CLAUDE.md", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile(".workermill/instructions.md", "workermill dir instructions");
      writeFile("CLAUDE.md", "claude instructions");

      expect(loadProjectInstructions(workDir)).toBe("workermill dir instructions");
    });

    it("falls back to CLAUDE.md when WORKERMILL.md does not exist", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("CLAUDE.md", "claude instructions");
      writeFile(".cursorrules", "cursor instructions");

      expect(loadProjectInstructions(workDir)).toBe("claude instructions");
    });

    it("falls back to .cursorrules when WORKERMILL.md and CLAUDE.md are absent", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile(".cursorrules", "cursor rules content");
      writeFile(".github/copilot-instructions.md", "copilot instructions");

      expect(loadProjectInstructions(workDir)).toBe("cursor rules content");
    });

    it("falls back to .github/copilot-instructions.md (lowest priority)", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile(".github/copilot-instructions.md", "copilot instructions");

      expect(loadProjectInstructions(workDir)).toBe("copilot instructions");
    });

    it("returns null for a file that exists but is empty", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "");

      expect(loadProjectInstructions(workDir)).toBeNull();
    });

    it("returns null for a file that contains only whitespace", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("CLAUDE.md", "   \n\t\n  ");

      expect(loadProjectInstructions(workDir)).toBeNull();
    });

    it("skips empty WORKERMILL.md and falls through to CLAUDE.md", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "   "); // whitespace-only — treated as empty
      writeFile("CLAUDE.md", "actual claude instructions");

      expect(loadProjectInstructions(workDir)).toBe("actual claude instructions");
    });

    it("trims leading and trailing whitespace from file content", async () => {
      const { loadProjectInstructions } = await importInstructions();

      writeFile("CLAUDE.md", "\n\n  some instructions  \n\n");

      expect(loadProjectInstructions(workDir)).toBe("some instructions");
    });

    it("returns multiline content correctly", async () => {
      const { loadProjectInstructions } = await importInstructions();

      const content = "Line one\nLine two\nLine three";
      writeFile("WORKERMILL.md", content);

      expect(loadProjectInstructions(workDir)).toBe(content);
    });
  });

  describe("formatProjectInstructions()", () => {
    it("returns empty string when no instruction files exist", async () => {
      const { formatProjectInstructions } = await importInstructions();
      expect(formatProjectInstructions(workDir)).toBe("");
    });

    it("wraps content in '## Project Instructions' header", async () => {
      const { formatProjectInstructions } = await importInstructions();

      writeFile("CLAUDE.md", "follow these rules");

      const result = formatProjectInstructions(workDir);
      expect(result).toContain("## Project Instructions");
      expect(result).toContain("follow these rules");
    });

    it("includes content after the header", async () => {
      const { formatProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "use TypeScript strictly");

      const result = formatProjectInstructions(workDir);
      expect(result).toMatch(/## Project Instructions[\s\S]*use TypeScript strictly/);
    });

    it("ends with a horizontal rule separator", async () => {
      const { formatProjectInstructions } = await importInstructions();

      writeFile("CLAUDE.md", "some content");

      const result = formatProjectInstructions(workDir);
      expect(result.trimEnd()).toMatch(/---$/);
    });

    it("returns empty string for whitespace-only instruction file", async () => {
      const { formatProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "   ");

      expect(formatProjectInstructions(workDir)).toBe("");
    });

    it("formats correctly for the highest-priority found file", async () => {
      const { formatProjectInstructions } = await importInstructions();

      writeFile("WORKERMILL.md", "workermill rules");
      writeFile("CLAUDE.md", "claude rules");

      const result = formatProjectInstructions(workDir);
      expect(result).toContain("workermill rules");
      expect(result).not.toContain("claude rules");
    });
  });
});
