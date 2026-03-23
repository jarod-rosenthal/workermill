import { vi } from "vitest";

export function mockCoordination() {
  return {
    getReadyStories: vi.fn().mockResolvedValue([]),
    getCurrentRevisionCompletions: vi.fn().mockResolvedValue([]),
    getContextsByTypes: vi.fn().mockResolvedValue([]),
    getUnansweredQuestions: vi.fn().mockResolvedValue([]),
    claimStory: vi.fn().mockResolvedValue({ success: true, alreadyClaimed: false }),
    postContext: vi.fn().mockResolvedValue(undefined),
    postCompletion: vi.fn().mockResolvedValue(undefined),
    archiveStoryClaims: vi.fn().mockResolvedValue(undefined),
    getDependencyBranchNames: vi.fn().mockResolvedValue(new Map()),
    getBlockerContexts: vi.fn().mockResolvedValue([]),
    getDashboardCommands: vi.fn().mockResolvedValue([]),
    connectSse: vi.fn(),
    disconnectSse: vi.fn(),
    isSseConnected: vi.fn().mockReturnValue(false),
    startIteration: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    emit: vi.fn(),
  };
}

export function mockDecisionClient() {
  return {
    classifyError: vi.fn().mockResolvedValue({
      category: "unknown",
      fixable: false,
      action: "escalate",
    }),
    evaluateQuality: vi.fn().mockResolvedValue({
      pass: true,
      reasons: [],
      blockers: [],
    }),
    routeQuestion: vi.fn().mockResolvedValue({
      targetExpert: null,
      routingTier: 3,
      reason: "No matching expert",
    }),
    parseReviewOutcome: vi.fn().mockResolvedValue({
      decision: "approved",
      feedback: "",
      score: 90,
    }),
    getPersonaIcon: vi.fn().mockReturnValue("🔧"),
  };
}

export function mockExecutor() {
  return {
    executeStory: vi.fn().mockResolvedValue({
      storyId: "story-0",
      storyIndex: 0,
      success: true,
      filesModified: ["src/index.ts"],
      filesCreated: [],
      decisions: [],
    }),
    runQuickAnswer: vi.fn().mockResolvedValue("The answer is 42"),
  };
}

export function mockGitOps() {
  return {
    createStoryBranch: vi.fn().mockResolvedValue({
      branchName: "story/test-0",
      worktreePath: "/tmp/worktree-0",
    }),
    pushBranchFromWorktree: vi.fn().mockResolvedValue(undefined),
    forceRemoveWorktree: vi.fn().mockResolvedValue(undefined),
    getMainBranch: vi.fn().mockReturnValue("main"),
    commitUncommittedWork: vi.fn().mockResolvedValue(null),
    mergeDependencyBranches: vi.fn().mockResolvedValue({ merged: [], conflicted: [] }),
  };
}

export function mockBlockerManager() {
  return {
    checkForBlockers: vi.fn().mockResolvedValue(null),
    shouldAutoRetry: vi.fn().mockResolvedValue(false),
    getRetryCount: vi.fn().mockReturnValue(0),
    incrementRetryCount: vi.fn(),
    resetRetryCount: vi.fn(),
    escalateBlocker: vi.fn().mockResolvedValue({}),
    getDependentStories: vi.fn().mockReturnValue([]),
    waitForBlockerResponse: vi.fn().mockResolvedValue(null),
  };
}
