import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockCoordination, mockDecisionClient } from "./helpers/mocks.js";
import {
  makeResilience,
  makeStory,
  makeContextMessage,
} from "./helpers/factories.js";
import { BlockerManager } from "../blocker-manager.js";
import type { CoordinationClient } from "../coordination-client.js";
import type { DecisionClient } from "../decision-client.js";

function createBlockerManager(overrides?: {
  coordination?: ReturnType<typeof mockCoordination>;
  resilience?: Partial<Parameters<typeof makeResilience>[0]>;
  decisionClient?: ReturnType<typeof mockDecisionClient>;
}) {
  const coordination = overrides?.coordination ?? mockCoordination();
  const resilience = makeResilience(overrides?.resilience);
  const decisionClient = overrides?.decisionClient ?? mockDecisionClient();

  const manager = new BlockerManager(
    coordination as unknown as CoordinationClient,
    "task-1",
    resilience,
    decisionClient as unknown as DecisionClient,
  );

  return { manager, coordination, decisionClient, resilience };
}

describe("BlockerManager", () => {
  // ==========================================================================
  // checkForBlockers
  // ==========================================================================

  describe("checkForBlockers", () => {
    it("returns null when no blocker contexts exist", async () => {
      const { manager, coordination } = createBlockerManager();
      coordination.getBlockerContexts.mockResolvedValue([]);

      const result = await manager.checkForBlockers();
      expect(result).toBeNull();
    });

    it("returns null when all blockers have been resolved via answer", async () => {
      const { manager, coordination } = createBlockerManager();
      coordination.getBlockerContexts.mockResolvedValue([
        makeContextMessage({
          id: "blocker-1",
          messageType: "blocker",
          metadata: { isEscalated: true },
        }),
        makeContextMessage({
          id: "answer-1",
          messageType: "answer",
          metadata: { blockerId: "blocker-1", blockerAction: "retry" },
        }),
      ]);

      const result = await manager.checkForBlockers();
      expect(result).toBeNull();
    });

    it("returns null when blocker resolved via blocker_resolved type", async () => {
      const { manager, coordination } = createBlockerManager();
      coordination.getBlockerContexts.mockResolvedValue([
        makeContextMessage({
          id: "blocker-1",
          messageType: "blocker",
          metadata: { isEscalated: true },
        }),
        makeContextMessage({
          id: "resolution-1",
          messageType: "blocker_resolved",
          metadata: { blockerId: "blocker-1", action: "skip" },
        }),
      ]);

      const result = await manager.checkForBlockers();
      expect(result).toBeNull();
    });

    it("returns the first unresolved blocker", async () => {
      const { manager, coordination } = createBlockerManager();
      coordination.getBlockerContexts.mockResolvedValue([
        makeContextMessage({
          id: "blocker-1",
          messageType: "blocker",
          metadata: {
            isEscalated: true,
            storyIndex: 2,
            storyTitle: "Add auth",
            persona: "backend_developer",
            errorCategory: "typescript",
            summary: "TS compilation failed",
          },
        }),
      ]);

      const result = await manager.checkForBlockers();
      expect(result).not.toBeNull();
      expect(result!.id).toBe("blocker-1");
      expect(result!.storyIndex).toBe(2);
      expect(result!.storyTitle).toBe("Add auth");
      expect(result!.summary).toBe("TS compilation failed");
    });

    it("ignores non-escalated blockers", async () => {
      const { manager, coordination } = createBlockerManager();
      coordination.getBlockerContexts.mockResolvedValue([
        makeContextMessage({
          id: "blocker-1",
          messageType: "blocker",
          metadata: { isEscalated: false },
        }),
      ]);

      const result = await manager.checkForBlockers();
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // Retry count tracking
  // ==========================================================================

  describe("retry count tracking", () => {
    it("getRetryCount returns 0 for unknown story", () => {
      const { manager } = createBlockerManager();
      expect(manager.getRetryCount(5)).toBe(0);
    });

    it("incrementRetryCount increases count by 1", () => {
      const { manager } = createBlockerManager();
      manager.incrementRetryCount(3);
      expect(manager.getRetryCount(3)).toBe(1);
      manager.incrementRetryCount(3);
      expect(manager.getRetryCount(3)).toBe(2);
    });

    it("resetRetryCount clears the count", () => {
      const { manager } = createBlockerManager();
      manager.incrementRetryCount(1);
      manager.incrementRetryCount(1);
      expect(manager.getRetryCount(1)).toBe(2);

      manager.resetRetryCount(1);
      expect(manager.getRetryCount(1)).toBe(0);
    });

    it("tracks counts independently per story", () => {
      const { manager } = createBlockerManager();
      manager.incrementRetryCount(0);
      manager.incrementRetryCount(0);
      manager.incrementRetryCount(1);

      expect(manager.getRetryCount(0)).toBe(2);
      expect(manager.getRetryCount(1)).toBe(1);
      expect(manager.getRetryCount(2)).toBe(0);
    });
  });

  // ==========================================================================
  // getDependentStories
  // ==========================================================================

  describe("getDependentStories", () => {
    it("returns empty array when no dependents", () => {
      const { manager } = createBlockerManager();
      const stories = [
        makeStory({ storyIndex: 0, dependencies: [] }),
        makeStory({ storyIndex: 1, dependencies: [] }),
      ];

      const result = manager.getDependentStories(0, stories);
      expect(result).toEqual([]);
    });

    it("identifies direct dependents of a failed story", () => {
      const { manager } = createBlockerManager();
      const stories = [
        makeStory({ storyIndex: 0, dependencies: [] }),
        makeStory({ storyIndex: 1, dependencies: [0] }),
        makeStory({ storyIndex: 2, dependencies: [0] }),
        makeStory({ storyIndex: 3, dependencies: [] }),
      ];

      const result = manager.getDependentStories(0, stories);
      expect(result).toContain(1);
      expect(result).toContain(2);
      expect(result).not.toContain(3);
    });

    it("finds transitive dependents recursively", () => {
      const { manager } = createBlockerManager();
      const stories = [
        makeStory({ storyIndex: 0, dependencies: [] }),
        makeStory({ storyIndex: 1, dependencies: [0] }),
        makeStory({ storyIndex: 2, dependencies: [1] }),
        makeStory({ storyIndex: 3, dependencies: [2] }),
      ];

      const result = manager.getDependentStories(0, stories);
      expect(result).toContain(1);
      expect(result).toContain(2);
      expect(result).toContain(3);
    });

    it("deduplicates transitive dependents", () => {
      const { manager } = createBlockerManager();
      // Diamond dependency: 0 -> 1, 0 -> 2, 1 -> 3, 2 -> 3
      const stories = [
        makeStory({ storyIndex: 0, dependencies: [] }),
        makeStory({ storyIndex: 1, dependencies: [0] }),
        makeStory({ storyIndex: 2, dependencies: [0] }),
        makeStory({ storyIndex: 3, dependencies: [1, 2] }),
      ];

      const result = manager.getDependentStories(0, stories);
      // 3 should appear only once even though it's reachable through both 1 and 2
      const count3 = result.filter((i) => i === 3).length;
      expect(count3).toBe(1);
      expect(result).toHaveLength(3); // 1, 2, 3
    });
  });

  // ==========================================================================
  // shouldAutoRetry
  // ==========================================================================

  describe("shouldAutoRetry", () => {
    it("returns true for fixable errors under retry limit", async () => {
      const { manager, decisionClient } = createBlockerManager();
      decisionClient.classifyError.mockResolvedValue({
        category: "typescript",
        fixable: true,
        action: "auto_retry",
      });

      const result = await manager.shouldAutoRetry(0, "TS2322: Type error");
      expect(result).toBe(true);
    });

    it("returns false when retries exhausted", async () => {
      const { manager, decisionClient } = createBlockerManager({
        resilience: { blockerMaxAutoRetries: 2 },
      });
      decisionClient.classifyError.mockResolvedValue({
        category: "typescript",
        fixable: true,
        action: "auto_retry",
      });

      // Exhaust retries
      manager.incrementRetryCount(0);
      manager.incrementRetryCount(0);

      const result = await manager.shouldAutoRetry(0, "TS2322: Type error");
      expect(result).toBe(false);
      // classifyError should NOT be called since retries are exhausted
      expect(decisionClient.classifyError).not.toHaveBeenCalled();
    });

    it("returns false when auto-retry is disabled", async () => {
      const { manager, decisionClient } = createBlockerManager({
        resilience: { blockerAutoRetryEnabled: false },
      });

      const result = await manager.shouldAutoRetry(0, "some error");
      expect(result).toBe(false);
      expect(decisionClient.classifyError).not.toHaveBeenCalled();
    });

    it("returns false when error is not fixable", async () => {
      const { manager, decisionClient } = createBlockerManager();
      decisionClient.classifyError.mockResolvedValue({
        category: "unknown",
        fixable: false,
        action: "escalate",
      });

      const result = await manager.shouldAutoRetry(0, "Fatal: something broke");
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // escalateBlocker
  // ==========================================================================

  describe("escalateBlocker", () => {
    it("posts blocker to coordination feed with correct metadata", async () => {
      const { manager, coordination, decisionClient } = createBlockerManager();
      decisionClient.classifyError.mockResolvedValue({
        category: "typescript",
        fixable: true,
        action: "auto_retry",
        affectedFiles: ["src/index.ts"],
        summary: "TypeScript compilation failed in index.ts",
        fixStrategy: "fix type error",
      });
      coordination.postContext.mockResolvedValue(
        makeContextMessage({
          id: "blocker-new",
          messageType: "blocker",
          createdAt: "2026-03-22T00:00:00Z",
        }),
      );

      const stories = [
        makeStory({ storyIndex: 0, dependencies: [] }),
        makeStory({ storyIndex: 1, dependencies: [0] }),
      ];

      const result = await manager.escalateBlocker(
        0,
        "Add auth endpoint",
        "backend_developer",
        "TS2322: Type 'string' is not assignable",
        stories,
      );

      // Verify classifyError was called
      expect(decisionClient.classifyError).toHaveBeenCalledWith({
        errorOutput: "TS2322: Type 'string' is not assignable",
      });

      // Verify postContext was called with blocker type
      expect(coordination.postContext).toHaveBeenCalledWith(
        "blocker",
        expect.any(String),
        "backend_developer",
        undefined,
        expect.objectContaining({
          storyIndex: 0,
          storyTitle: "Add auth endpoint",
          errorCategory: "typescript",
          isEscalated: true,
          isFixable: true,
          dependentStories: [1],
        }),
        "backend_developer-story-0",
      );

      // Verify return value
      expect(result.id).toBe("blocker-new");
      expect(result.storyIndex).toBe(0);
      expect(result.errorCategory).toBe("typescript");
      expect(result.dependentStories).toEqual([1]);
    });

    it("uses decision API summary in the escalation", async () => {
      const { manager, coordination, decisionClient } = createBlockerManager();
      decisionClient.classifyError.mockResolvedValue({
        category: "test_failure",
        fixable: false,
        action: "escalate",
        affectedFiles: [],
        summary: "Unit tests failing in auth module",
        fixStrategy: null,
      });
      coordination.postContext.mockResolvedValue(
        makeContextMessage({ id: "b-1", messageType: "blocker" }),
      );

      await manager.escalateBlocker(
        2,
        "Fix tests",
        "backend_developer",
        "FAIL src/auth.test.ts",
        [],
      );

      // The summary from classifyError should be used
      expect(coordination.postContext).toHaveBeenCalledWith(
        "blocker",
        "Unit tests failing in auth module",
        expect.any(String),
        undefined,
        expect.objectContaining({
          summary: "Unit tests failing in auth module",
        }),
        expect.any(String),
      );
    });
  });

  // ==========================================================================
  // parseBlockerCommand
  // ==========================================================================

  describe("parseBlockerCommand", () => {
    it("parses retry action from metadata", () => {
      const { manager } = createBlockerManager();
      const result = manager.parseBlockerCommand("some content", {
        blockerAction: "retry",
        guidance: "Try with different approach",
        respondedBy: "user@test.com",
        respondedAt: "2026-03-22T00:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result!.action).toBe("retry");
      expect(result!.guidance).toBe("Try with different approach");
      expect(result!.respondedBy).toBe("user@test.com");
    });

    it("parses retry from content when no metadata action", () => {
      const { manager } = createBlockerManager();
      const result = manager.parseBlockerCommand("Please retry this task", {});

      expect(result).not.toBeNull();
      expect(result!.action).toBe("retry");
    });

    it("parses skip from content", () => {
      const { manager } = createBlockerManager();
      const result = manager.parseBlockerCommand("Skip this story", {});
      expect(result!.action).toBe("skip");
    });

    it("parses abort from content", () => {
      const { manager } = createBlockerManager();
      const result = manager.parseBlockerCommand("abort the task", {});
      expect(result!.action).toBe("abort");
    });

    it("returns null when content has no recognizable action", () => {
      const { manager } = createBlockerManager();
      const result = manager.parseBlockerCommand("hello world", {});
      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // hasExhaustedRetries
  // ==========================================================================

  describe("hasExhaustedRetries", () => {
    it("returns true when auto-retry is disabled", () => {
      const { manager } = createBlockerManager({
        resilience: { blockerAutoRetryEnabled: false },
      });
      // Even with 0 retries, if auto-retry is disabled, should be exhausted
      expect(manager["hasExhaustedRetries"](0)).toBe(true);
    });

    it("returns false when under the limit", () => {
      const { manager } = createBlockerManager({
        resilience: { blockerMaxAutoRetries: 3 },
      });
      manager.incrementRetryCount(0);
      expect(manager["hasExhaustedRetries"](0)).toBe(false);
    });

    it("returns true when at the limit", () => {
      const { manager } = createBlockerManager({
        resilience: { blockerMaxAutoRetries: 2 },
      });
      manager.incrementRetryCount(0);
      manager.incrementRetryCount(0);
      expect(manager["hasExhaustedRetries"](0)).toBe(true);
    });
  });
});
