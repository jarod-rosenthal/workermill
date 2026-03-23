import { describe, it, expect, vi } from "vitest";

// Mock heavy dependencies before importing the module under test
vi.mock("../agent-sdk.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock("../../lib/api-client.js", () => ({
  createLogsApi: vi.fn().mockReturnValue({ post: vi.fn() }),
}));

vi.mock("../ai-client-types.js", () => ({
  createAIClient: vi.fn().mockReturnValue({ execute: vi.fn() }),
}));

import { InlineReviewer } from "../inline-reviewer.js";

function createReviewer(): InlineReviewer {
  const minimalConfig = {
    apiBaseUrl: "http://localhost",
    orgApiKey: "test",
    parentTaskId: "test",
    targetRepo: "test/repo",
    model: "test",
    maxReviewRevisions: 4,
    jiraIssueKey: "TEST-1",
  };
  return new InlineReviewer(minimalConfig as any, "/tmp/repo");
}

// ─── parseDecisionFromText ──────────────────────────────────────

describe("parseDecisionFromText", () => {
  it("parses approved decision from REVIEW_DECISION marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 9";
    expect((reviewer as any).parseDecisionFromText()).toBe("approved");
  });

  it("parses revision_needed decision", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 4";
    expect((reviewer as any).parseDecisionFromText()).toBe("revision_needed");
  });

  it("parses rejected decision", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: rejected";
    expect((reviewer as any).parseDecisionFromText()).toBe("rejected");
  });

  it("detects approved from gh pr review --approve command", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = 'gh pr review 42 -R test/repo --approve --body "LGTM"';
    expect((reviewer as any).parseDecisionFromText()).toBe("approved");
  });

  it("detects revision_needed from gh pr review --request-changes command", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = 'gh pr review 42 -R test/repo --request-changes --body "Fix issues"';
    expect((reviewer as any).parseDecisionFromText()).toBe("revision_needed");
  });

  it("returns null when no decision marker found", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "Some review output without markers";
    expect((reviewer as any).parseDecisionFromText()).toBeNull();
  });

  it("returns null on empty output", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "";
    expect((reviewer as any).parseDecisionFromText()).toBeNull();
  });

  it("is case-insensitive for decision marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: APPROVED";
    expect((reviewer as any).parseDecisionFromText()).toBe("approved");
  });

  it("prefers REVIEW_DECISION marker over gh command", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput =
      'REVIEW_DECISION: revision_needed\ngh pr review 42 --approve --body "test"';
    // REVIEW_DECISION marker is checked first
    expect((reviewer as any).parseDecisionFromText()).toBe("revision_needed");
  });
});

// ─── parseCodeQualityScore ──────────────────────────────────────

describe("parseCodeQualityScore", () => {
  it("extracts quality score from marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "CODE_QUALITY_SCORE: 8";
    expect((reviewer as any).parseCodeQualityScore()).toBe(8);
  });

  it("clamps score to max of 10", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "CODE_QUALITY_SCORE: 15";
    expect((reviewer as any).parseCodeQualityScore()).toBe(10);
  });

  it("clamps score to min of 1", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "CODE_QUALITY_SCORE: 0";
    expect((reviewer as any).parseCodeQualityScore()).toBe(1);
  });

  it("returns default 5 when no score marker found", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: approved";
    expect((reviewer as any).parseCodeQualityScore()).toBe(5);
  });

  it("returns default 5 on empty output", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "";
    expect((reviewer as any).parseCodeQualityScore()).toBe(5);
  });
});

// ─── parseFeedback ──────────────────────────────────────────────

describe("parseFeedback", () => {
  it("extracts feedback from FEEDBACK marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput =
      "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 8\nFEEDBACK: Code is well-structured and follows patterns";
    expect((reviewer as any).parseFeedback()).toBe(
      "Code is well-structured and follows patterns"
    );
  });

  it("extracts multi-line feedback up to next marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput =
      "FEEDBACK: First line of feedback\nSecond line of feedback\nREVIEW_DECISION: approved";
    const feedback = (reviewer as any).parseFeedback();
    expect(feedback).toContain("First line of feedback");
    expect(feedback).toContain("Second line of feedback");
  });

  it("extracts feedback from gh pr review --body", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = 'gh pr review 42 --approve --body "Good implementation"';
    expect((reviewer as any).parseFeedback()).toBe("Good implementation");
  });

  it("returns default when no feedback found", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: approved";
    expect((reviewer as any).parseFeedback()).toBe("No feedback provided");
  });

  it("returns default on empty output", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "";
    expect((reviewer as any).parseFeedback()).toBe("No feedback provided");
  });
});

// ─── parseAffectedStories ───────────────────────────────────────

describe("parseAffectedStories", () => {
  it("parses affected story indices from marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "AFFECTED_STORIES: [2, 3]\nAFFECTED_REASONS: {\"2\": \"Missing CI workflow\", \"3\": \"Husky hooks broken\"}";
    const result = (reviewer as any).parseAffectedStories();
    expect(result).not.toBeNull();
    expect(result.stories).toEqual([2, 3]);
    expect(result.reasons[2]).toBe("Missing CI workflow");
    expect(result.reasons[3]).toBe("Husky hooks broken");
  });

  it("returns null when no AFFECTED_STORIES marker", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "REVIEW_DECISION: approved";
    expect((reviewer as any).parseAffectedStories()).toBeNull();
  });

  it("parses stories without reasons", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "AFFECTED_STORIES: [1, 4]";
    const result = (reviewer as any).parseAffectedStories();
    expect(result).not.toBeNull();
    expect(result.stories).toEqual([1, 4]);
    expect(Object.keys(result.reasons)).toHaveLength(0);
  });

  it("handles single story index", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "AFFECTED_STORIES: [5]";
    const result = (reviewer as any).parseAffectedStories();
    expect(result).not.toBeNull();
    expect(result.stories).toEqual([5]);
  });

  it("returns null when stories array is empty after parsing", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "AFFECTED_STORIES: [abc, def]";
    // parseInt of non-numeric strings produces NaN which is filtered out
    expect((reviewer as any).parseAffectedStories()).toBeNull();
  });

  it("ignores invalid JSON in AFFECTED_REASONS but still returns stories", () => {
    const reviewer = createReviewer();
    (reviewer as any).allOutput = "AFFECTED_STORIES: [1, 2]\nAFFECTED_REASONS: {invalid json}";
    const result = (reviewer as any).parseAffectedStories();
    expect(result).not.toBeNull();
    expect(result.stories).toEqual([1, 2]);
    expect(Object.keys(result.reasons)).toHaveLength(0);
  });
});
