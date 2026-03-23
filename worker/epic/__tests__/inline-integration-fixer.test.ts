import { describe, it, expect, vi } from "vitest";

// Mock heavy dependencies before importing the module under test
vi.mock("../agent-sdk.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock("../../lib/api-client.js", () => ({
  createLogsApi: vi.fn().mockReturnValue({ post: vi.fn() }),
}));

vi.mock("../gate-utils.js", () => ({
  runGateCommand: vi.fn(),
  loadRepoContext: vi.fn().mockReturnValue(""),
  isDockerDaemonReachable: vi.fn().mockReturnValue(false),
}));

vi.mock("../ai-client-types.js", () => ({
  createAIClient: vi.fn().mockReturnValue({ execute: vi.fn() }),
}));

import { InlineIntegrationFixer } from "../inline-integration-fixer.js";
import type { ContextMessage } from "../types.js";

function createFixer(): InlineIntegrationFixer {
  const minimalConfig = {
    apiBaseUrl: "http://localhost",
    orgApiKey: "test",
    parentTaskId: "test",
    targetRepo: "test/repo",
    model: "test",
  };
  return new InlineIntegrationFixer(minimalConfig as any, "/tmp/repo");
}

function makeCompletion(overrides: {
  storyIndex: number;
  persona: string;
  description?: string;
  filesModified?: string[];
  targetFiles?: string[];
}): ContextMessage {
  return {
    id: `c-${overrides.storyIndex}`,
    parentTaskId: "test",
    persona: overrides.persona,
    messageType: "completion",
    content: `Story ${overrides.storyIndex} complete`,
    metadata: {
      storyIndex: overrides.storyIndex,
      description: overrides.description || `Story ${overrides.storyIndex} description`,
      filesModified: overrides.filesModified || [],
      targetFiles: overrides.targetFiles || [],
    },
    createdAt: new Date().toISOString(),
  };
}

// ─── normalizePath ──────────────────────────────────────────────

describe("normalizePath", () => {
  const fixer = createFixer();

  it("strips leading ./", () => {
    expect(fixer.normalizePath("./src/foo.ts")).toBe("src/foo.ts");
  });

  it("strips absolute workspace prefix", () => {
    expect(fixer.normalizePath("/home/user/workspace/api/src/foo.ts")).toBe(
      "api/src/foo.ts"
    );
  });

  it("strips absolute repo prefix", () => {
    expect(fixer.normalizePath("/var/lib/repo/src/foo.ts")).toBe("src/foo.ts");
  });

  it("returns plain relative path unchanged", () => {
    expect(fixer.normalizePath("src/foo.ts")).toBe("src/foo.ts");
  });

  it("handles double ./ prefix", () => {
    expect(fixer.normalizePath("./src/foo.ts")).toBe("src/foo.ts");
  });
});

// ─── pathsMatch ─────────────────────────────────────────────────

describe("pathsMatch", () => {
  const fixer = createFixer();

  it("matches exact paths", () => {
    expect(fixer.pathsMatch("src/foo.ts", "src/foo.ts")).toBe(true);
  });

  it("matches with prefix mismatch via suffix", () => {
    expect(
      fixer.pathsMatch("src/routes/health.test.ts", "api/src/routes/health.test.ts")
    ).toBe(true);
  });

  it("matches with ./ prefix", () => {
    expect(fixer.pathsMatch("./src/foo.ts", "src/foo.ts")).toBe(true);
  });

  it("matches absolute workspace path", () => {
    expect(
      fixer.pathsMatch("/home/user/workspace/api/src/foo.ts", "api/src/foo.ts")
    ).toBe(true);
  });

  it("does not match different files", () => {
    expect(fixer.pathsMatch("src/foo.ts", "src/bar.ts")).toBe(false);
  });

  it("does not match partial filename overlap", () => {
    expect(fixer.pathsMatch("src/foo.ts", "src/foo.test.ts")).toBe(false);
  });
});

// ─── buildOwnershipContext ──────────────────────────────────────

describe("buildOwnershipContext", () => {
  const fixer = createFixer();

  it("returns empty string when no file paths in failure output", () => {
    const result = fixer.buildOwnershipContext(
      "Error: something went wrong with no file paths",
      [makeCompletion({ storyIndex: 1, persona: "backend_engineer", filesModified: ["src/foo.ts"] })]
    );
    expect(result).toBe("");
  });

  it("returns empty string when no completions match", () => {
    const result = fixer.buildOwnershipContext(
      "FAIL src/routes/health.test.ts\nError in src/routes/health.ts",
      [makeCompletion({ storyIndex: 1, persona: "backend_engineer", filesModified: ["src/models/user.ts"] })]
    );
    expect(result).toBe("");
  });

  it("returns ownership context for single story match", () => {
    const result = fixer.buildOwnershipContext(
      "FAIL src/routes/health.test.ts\nError in src/routes/health.ts",
      [
        makeCompletion({
          storyIndex: 1,
          persona: "backend_engineer",
          filesModified: ["src/routes/health.ts", "src/routes/health.test.ts"],
        }),
      ]
    );
    expect(result).toContain("Story 1");
    expect(result).toContain("backend_engineer");
    expect(result).toContain("src/routes/health.ts");
  });

  it("includes multiple stories when both have overlapping files", () => {
    const result = fixer.buildOwnershipContext(
      "Error in src/routes/health.ts\nError in src/models/user.ts",
      [
        makeCompletion({
          storyIndex: 1,
          persona: "backend_engineer",
          filesModified: ["src/routes/health.ts"],
        }),
        makeCompletion({
          storyIndex: 2,
          persona: "database_engineer",
          filesModified: ["src/models/user.ts"],
        }),
      ]
    );
    expect(result).toContain("Story 1");
    expect(result).toContain("Story 2");
    expect(result).toContain("backend_engineer");
    expect(result).toContain("database_engineer");
  });

  it("matches via suffix when failure output has subdirectory-relative paths", () => {
    const result = fixer.buildOwnershipContext(
      "FAIL src/routes/tasks.test.ts",
      [
        makeCompletion({
          storyIndex: 3,
          persona: "fullstack_engineer",
          filesModified: ["api/src/routes/tasks.test.ts"],
        }),
      ]
    );
    expect(result).toContain("Story 3");
  });

  it("matches via targetFiles when filesModified doesn't overlap", () => {
    const result = fixer.buildOwnershipContext(
      "Error in src/routes/auth.ts",
      [
        makeCompletion({
          storyIndex: 1,
          persona: "backend_engineer",
          filesModified: ["src/routes/auth.test.ts"],
          targetFiles: ["src/routes/auth.ts"],
        }),
      ]
    );
    expect(result).toContain("Story 1");
  });

  it("returns empty string when completions array is empty", () => {
    const result = fixer.buildOwnershipContext(
      "FAIL src/routes/health.test.ts",
      []
    );
    expect(result).toBe("");
  });

  it("includes Story Ownership header", () => {
    const result = fixer.buildOwnershipContext(
      "Error in src/routes/health.ts",
      [
        makeCompletion({
          storyIndex: 1,
          persona: "backend_engineer",
          filesModified: ["src/routes/health.ts"],
        }),
      ]
    );
    expect(result).toContain("Story Ownership");
  });
});
