import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  writeMessageToActiveWorktrees,
  writeAnswerToWorktree,
  cleanupMessageFiles,
} from "../coordinator-commands.js";

// Stub modules that have heavy dependencies
vi.mock("../coordinator-utils.js", () => ({
  postDashboardLog: vi.fn(),
  postLog: vi.fn(),
  sleep: vi.fn(),
}));

// ─── writeMessageToActiveWorktrees ──────────────────────────────

describe("writeMessageToActiveWorktrees", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wm-test-"));
  });

  it("writes message file to active worktrees with working experts", () => {
    const expertStates = new Map<string, any>();
    expertStates.set("backend_developer", {
      persona: "backend_developer",
      status: "working",
      currentStoryIndex: 0,
    });

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);

    writeMessageToActiveWorktrees(expertStates, activeWorktrees, "Please fix the bug");

    const filePath = join(tempDir, ".workermill-message.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Please fix the bug");
    expect(content).toContain("# Message from User");
  });

  it("skips experts that are not working", () => {
    const expertStates = new Map<string, any>();
    expertStates.set("backend_developer", {
      persona: "backend_developer",
      status: "idle",
    });

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);

    writeMessageToActiveWorktrees(expertStates, activeWorktrees, "Test message");

    const filePath = join(tempDir, ".workermill-message.md");
    expect(existsSync(filePath)).toBe(false);
  });

  it("skips experts with undefined currentStoryIndex", () => {
    const expertStates = new Map<string, any>();
    expertStates.set("backend_developer", {
      persona: "backend_developer",
      status: "working",
      // no currentStoryIndex
    });

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);

    writeMessageToActiveWorktrees(expertStates, activeWorktrees, "Test message");

    const filePath = join(tempDir, ".workermill-message.md");
    expect(existsSync(filePath)).toBe(false);
  });

  it("writes to multiple active worktrees", () => {
    const tempDir2 = mkdtempSync(join(tmpdir(), "wm-test-"));
    const expertStates = new Map<string, any>();
    expertStates.set("backend_developer", {
      persona: "backend_developer",
      status: "working",
      currentStoryIndex: 0,
    });
    expertStates.set("frontend_developer", {
      persona: "frontend_developer",
      status: "working",
      currentStoryIndex: 1,
    });

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);
    activeWorktrees.set(1, tempDir2);

    writeMessageToActiveWorktrees(expertStates, activeWorktrees, "Team message");

    expect(existsSync(join(tempDir, ".workermill-message.md"))).toBe(true);
    expect(existsSync(join(tempDir2, ".workermill-message.md"))).toBe(true);
  });
});

// ─── writeAnswerToWorktree ──────────────────────────────────────

describe("writeAnswerToWorktree", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wm-test-"));
  });

  it("writes answer file with question ID and responder info", () => {
    const question = {
      id: "q-123",
      content: "How should we handle auth?",
      fromPersona: "frontend_developer",
      metadata: { questionId: "Q-001", fromStory: 0 },
    };

    writeAnswerToWorktree(tempDir, question, "Use JWT tokens", "security_engineer");

    const filePath = join(tempDir, ".workermill-answer.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Q-001");
    expect(content).toContain("How should we handle auth?");
    expect(content).toContain("security_engineer");
    expect(content).toContain("Use JWT tokens");
    expect(content).toContain("# Answer to Your Question");
  });

  it("falls back to question.id when metadata.questionId is absent", () => {
    const question = {
      id: "q-456",
      content: "What framework?",
      fromPersona: "frontend_developer",
    };

    writeAnswerToWorktree(tempDir, question, "Use React", "architect");

    const content = readFileSync(join(tempDir, ".workermill-answer.md"), "utf-8");
    expect(content).toContain("q-456");
  });
});

// ─── cleanupMessageFiles ────────────────────────────────────────

describe("cleanupMessageFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wm-test-"));
  });

  it("removes .workermill-* files", () => {
    // Create the files that should be cleaned up
    writeFileSync(join(tempDir, ".workermill-message.md"), "msg");
    writeFileSync(join(tempDir, ".workermill-response.md"), "resp");
    writeFileSync(join(tempDir, ".workermill-answer.md"), "ans");

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);

    cleanupMessageFiles(activeWorktrees, 0);

    expect(existsSync(join(tempDir, ".workermill-message.md"))).toBe(false);
    expect(existsSync(join(tempDir, ".workermill-response.md"))).toBe(false);
    expect(existsSync(join(tempDir, ".workermill-answer.md"))).toBe(false);
  });

  it("keeps real code files", () => {
    writeFileSync(join(tempDir, "index.ts"), "code");
    writeFileSync(join(tempDir, ".workermill-message.md"), "msg");

    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);

    cleanupMessageFiles(activeWorktrees, 0);

    expect(existsSync(join(tempDir, "index.ts"))).toBe(true);
    expect(existsSync(join(tempDir, ".workermill-message.md"))).toBe(false);
  });

  it("handles missing worktree path gracefully", () => {
    const activeWorktrees = new Map<number, string>();
    // storyIndex 5 has no worktree
    expect(() => cleanupMessageFiles(activeWorktrees, 5)).not.toThrow();
  });

  it("handles already-deleted files gracefully", () => {
    const activeWorktrees = new Map<number, string>();
    activeWorktrees.set(0, tempDir);
    // No files exist — should not throw
    expect(() => cleanupMessageFiles(activeWorktrees, 0)).not.toThrow();
  });
});
