import { describe, expect, it } from "vitest";

import { assessStoryFileOwnership } from "../orchestrator/execution.js";
import type { Story } from "../orchestrator/types.js";

function buildStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "Scoped change",
    persona: "backend_developer",
    description: "Make a scoped code change.",
    targetFiles: ["src/api.ts"],
    requiredFiles: ["src/api.ts"],
    requiredTests: ["src/__tests__/api.test.ts"],
    ...overrides,
  };
}

describe("assessStoryFileOwnership", () => {
  it("returns none when all touched files are in scope", () => {
    const result = assessStoryFileOwnership(
      ["src/api.ts", "src/__tests__/api.test.ts"],
      buildStory(),
      "/tmp/project",
    );

    expect(result).toEqual({
      outOfScope: [],
      ratio: 0,
      severity: "none",
    });
  });

  it("warns on a small number of adjacent out-of-scope edits", () => {
    const result = assessStoryFileOwnership(
      ["src/api.ts", "src/__tests__/api.test.ts", "src/types.ts"],
      buildStory(),
      "/tmp/project",
    );

    expect(result.severity).toBe("warn");
    expect(result.outOfScope).toEqual(["src/types.ts"]);
  });

  it("blocks when most touched files are outside the declared scope", () => {
    const result = assessStoryFileOwnership(
      ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/api.ts"],
      buildStory(),
      "/tmp/project",
    );

    expect(result.severity).toBe("block");
    expect(result.outOfScope).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]);
    expect(result.ratio).toBe(0.8);
  });
});
