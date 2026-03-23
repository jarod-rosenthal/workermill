import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasMutexConflict,
  hasFileOverlap,
  registerRunningStory,
  unregisterRunningStory,
  handleStoryFailure,
} from "../coordinator-stories.js";
import { makeConfig, makeStory, makeResilience } from "./helpers/factories.js";
import { mockBlockerManager, mockCoordination } from "./helpers/mocks.js";

// Stub modules that have heavy dependencies
vi.mock("../coordinator-utils.js", () => ({
  postDashboardLog: vi.fn(),
  postLog: vi.fn(),
}));

vi.mock("../coordinator-commands.js", () => ({
  cleanupMessageFiles: vi.fn(),
}));

// ─── hasMutexConflict ────────────────────────────────────────────

describe("hasMutexConflict", () => {
  it("returns false with no mutex groups on the story", () => {
    const story = makeStory({ mutexGroups: [] });
    const running = new Map<number, string[]>();
    running.set(1, ["database"]);
    expect(hasMutexConflict(story, running)).toBe(false);
  });

  it("returns false with no mutex groups on story (undefined)", () => {
    const story = makeStory(); // no mutexGroups field
    const running = new Map<number, string[]>();
    running.set(1, ["database"]);
    expect(hasMutexConflict(story, running)).toBe(false);
  });

  it("returns false with no overlap between groups", () => {
    const story = makeStory({ storyIndex: 0, mutexGroups: ["auth"] });
    const running = new Map<number, string[]>();
    running.set(1, ["database"]);
    running.set(2, ["ui"]);
    expect(hasMutexConflict(story, running)).toBe(false);
  });

  it("returns true with overlap", () => {
    const story = makeStory({ storyIndex: 0, mutexGroups: ["database"] });
    const running = new Map<number, string[]>();
    running.set(1, ["database", "api"]);
    expect(hasMutexConflict(story, running)).toBe(true);
  });

  it("ignores own story index", () => {
    const story = makeStory({ storyIndex: 1, mutexGroups: ["database"] });
    const running = new Map<number, string[]>();
    running.set(1, ["database"]); // same index
    expect(hasMutexConflict(story, running)).toBe(false);
  });

  it("detects conflict across multiple running stories", () => {
    const story = makeStory({ storyIndex: 3, mutexGroups: ["config", "auth"] });
    const running = new Map<number, string[]>();
    running.set(0, ["database"]);
    running.set(1, ["ui"]);
    running.set(2, ["auth"]); // overlaps with story's "auth"
    expect(hasMutexConflict(story, running)).toBe(true);
  });

  it("returns false when running map is empty", () => {
    const story = makeStory({ storyIndex: 0, mutexGroups: ["database"] });
    const running = new Map<number, string[]>();
    expect(hasMutexConflict(story, running)).toBe(false);
  });
});

// ─── hasFileOverlap ──────────────────────────────────────────────

describe("hasFileOverlap", () => {
  const config = makeConfig();
  const resilience = makeResilience({ fileOverlapGatingEnabled: true });

  it("returns false with no target files on the story", () => {
    const story = makeStory({ targetFiles: [] });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts"]);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(false);
  });

  it("returns false with no target files (undefined)", () => {
    const story = makeStory(); // no targetFiles field
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts"]);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(false);
  });

  it("returns false with no overlap", () => {
    const story = makeStory({
      storyIndex: 0,
      targetFiles: ["src/auth.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts", "src/utils.ts"]);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(false);
  });

  it("returns true with overlap", () => {
    const story = makeStory({
      storyIndex: 0,
      targetFiles: ["src/index.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts", "src/utils.ts"]);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(true);
  });

  it("performs case-insensitive matching", () => {
    const story = makeStory({
      storyIndex: 0,
      targetFiles: ["SRC/Index.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts"]);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(true);
  });

  it("returns false when gating disabled", () => {
    const disabledResilience = makeResilience({ fileOverlapGatingEnabled: false });
    const story = makeStory({
      storyIndex: 0,
      targetFiles: ["src/index.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts"]);
    expect(hasFileOverlap(config, story, disabledResilience, running)).toBe(false);
  });

  it("ignores own story index", () => {
    const story = makeStory({
      storyIndex: 1,
      targetFiles: ["src/index.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, ["src/index.ts"]); // same index
    expect(hasFileOverlap(config, story, resilience, running)).toBe(false);
  });

  it("skips running stories with no files", () => {
    const story = makeStory({
      storyIndex: 0,
      targetFiles: ["src/index.ts"],
    });
    const running = new Map<number, string[]>();
    running.set(1, []);
    expect(hasFileOverlap(config, story, resilience, running)).toBe(false);
  });
});

// ─── registerRunningStory / unregisterRunningStory ───────────────

describe("registerRunningStory", () => {
  it("registers mutex groups and target files", () => {
    const mutexMap = new Map<number, string[]>();
    const filesMap = new Map<number, string[]>();
    registerRunningStory(0, ["database"], ["src/db.ts"], mutexMap, filesMap);
    expect(mutexMap.get(0)).toEqual(["database"]);
    expect(filesMap.get(0)).toEqual(["src/db.ts"]);
  });

  it("handles empty mutex groups", () => {
    const mutexMap = new Map<number, string[]>();
    const filesMap = new Map<number, string[]>();
    registerRunningStory(0, [], undefined, mutexMap, filesMap);
    expect(mutexMap.get(0)).toEqual([]);
    expect(filesMap.get(0)).toEqual([]);
  });

  it("handles undefined target files", () => {
    const mutexMap = new Map<number, string[]>();
    const filesMap = new Map<number, string[]>();
    registerRunningStory(0, ["auth"], undefined, mutexMap, filesMap);
    expect(filesMap.get(0)).toEqual([]);
  });
});

describe("unregisterRunningStory", () => {
  it("removes story from both maps", () => {
    const mutexMap = new Map<number, string[]>();
    const filesMap = new Map<number, string[]>();
    mutexMap.set(0, ["database"]);
    filesMap.set(0, ["src/db.ts"]);
    unregisterRunningStory(0, mutexMap, filesMap);
    expect(mutexMap.has(0)).toBe(false);
    expect(filesMap.has(0)).toBe(false);
  });

  it("handles unregistering non-existent story gracefully", () => {
    const mutexMap = new Map<number, string[]>();
    const filesMap = new Map<number, string[]>();
    // Should not throw
    unregisterRunningStory(99, mutexMap, filesMap);
    expect(mutexMap.size).toBe(0);
    expect(filesMap.size).toBe(0);
  });
});

// ─── handleStoryFailure ─────────────────────────────────────────

describe("handleStoryFailure", () => {
  let config: ReturnType<typeof makeConfig>;
  let resilience: ReturnType<typeof makeResilience>;
  let expertStates: Map<string, { persona: string; status: string; currentStoryId?: string; currentStoryIndex?: number }>;
  let failedStoryIndices: Set<number>;
  let blockedStoryIndices: Set<number>;

  beforeEach(() => {
    config = makeConfig();
    resilience = makeResilience();
    expertStates = new Map();
    failedStoryIndices = new Set();
    blockedStoryIndices = new Set();
  });

  it("marks expert as blocked and story as failed", async () => {
    const story = makeStory({ storyIndex: 0 });
    await handleStoryFailure(
      config,
      resilience,
      story,
      "backend_developer",
      "compilation error",
      expertStates as any,
      failedStoryIndices,
      blockedStoryIndices,
      null, // no blocker manager
      mockCoordination() as any,
    );

    expect(expertStates.get("backend_developer")?.status).toBe("blocked");
    expect(failedStoryIndices.has(0)).toBe(true);
  });

  it("auto-retries when blocker manager says so", async () => {
    const story = makeStory({ storyIndex: 0 });
    const blocker = mockBlockerManager();
    blocker.shouldAutoRetry.mockResolvedValue(true);
    blocker.getRetryCount.mockReturnValue(0);

    await handleStoryFailure(
      config,
      resilience,
      story,
      "backend_developer",
      "compilation error",
      expertStates as any,
      failedStoryIndices,
      blockedStoryIndices,
      blocker as any,
      mockCoordination() as any,
    );

    expect(blocker.incrementRetryCount).toHaveBeenCalledWith(0);
    // Expert is initially set to blocked
    expect(expertStates.get("backend_developer")?.status).toBe("blocked");
    // escalateBlocker should NOT have been called
    expect(blocker.escalateBlocker).not.toHaveBeenCalled();
  });

  it("escalates when auto-retry exhausted", async () => {
    const story = makeStory({ storyIndex: 0 });
    const blocker = mockBlockerManager();
    blocker.shouldAutoRetry.mockResolvedValue(false);
    const readyStories = [makeStory({ storyIndex: 1, dependencies: [0] })];
    const coordination = mockCoordination();
    coordination.getReadyStories.mockResolvedValue(readyStories);

    await handleStoryFailure(
      config,
      resilience,
      story,
      "backend_developer",
      "fatal error",
      expertStates as any,
      failedStoryIndices,
      blockedStoryIndices,
      blocker as any,
      coordination as any,
    );

    expect(blocker.escalateBlocker).toHaveBeenCalledWith(
      0,
      story.title,
      "backend_developer",
      "fatal error",
      readyStories,
    );
  });

  it("marks dependent stories as blocked", async () => {
    const story = makeStory({ storyIndex: 0 });
    const blocker = mockBlockerManager();
    blocker.shouldAutoRetry.mockResolvedValue(false);
    blocker.getDependentStories.mockReturnValue([1, 2]);

    const readyStories = [
      makeStory({ storyIndex: 1, dependencies: [0] }),
      makeStory({ storyIndex: 2, dependencies: [0] }),
    ];
    const coordination = mockCoordination();
    coordination.getReadyStories.mockResolvedValue(readyStories);

    await handleStoryFailure(
      config,
      resilience,
      story,
      "backend_developer",
      "fatal error",
      expertStates as any,
      failedStoryIndices,
      blockedStoryIndices,
      blocker as any,
      coordination as any,
    );

    expect(blockedStoryIndices.has(1)).toBe(true);
    expect(blockedStoryIndices.has(2)).toBe(true);
  });
});
