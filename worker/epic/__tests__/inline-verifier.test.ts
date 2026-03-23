import { describe, it, expect, vi } from "vitest";

// Mock heavy dependencies before importing the module under test
vi.mock("../agent-sdk.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ success: true, messages: [] }),
}));

vi.mock("../../lib/api-client.js", () => ({
  createLogsApi: vi.fn().mockReturnValue({ post: vi.fn() }),
}));

vi.mock("../gate-utils.js", () => ({
  loadRepoContext: vi.fn().mockReturnValue(""),
}));

vi.mock("../ai-client-types.js", () => ({
  createAIClient: vi.fn().mockReturnValue({ execute: vi.fn() }),
}));

import { InlineVerifier } from "../inline-verifier.js";

function createVerifier(): InlineVerifier {
  const minimalConfig = {
    apiBaseUrl: "http://localhost",
    orgApiKey: "test",
    parentTaskId: "test",
    targetRepo: "test/repo",
    model: "test",
  };
  return new InlineVerifier(minimalConfig as any, "/tmp/repo");
}

// ─── parseDecision ──────────────────────────────────────────────

describe("parseDecision", () => {
  it("parses pass decision", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: pass\nVERIFICATION_SUMMARY: All good";
    expect((verifier as any).parseDecision()).toBe("pass");
  });

  it("parses partial_pass decision", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: partial_pass";
    expect((verifier as any).parseDecision()).toBe("partial_pass");
  });

  it("parses fail decision", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: fail";
    expect((verifier as any).parseDecision()).toBe("fail");
  });

  it("defaults to fail when no marker found", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "Some output without markers";
    expect((verifier as any).parseDecision()).toBe("fail");
  });

  it("defaults to fail on empty output", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "";
    expect((verifier as any).parseDecision()).toBe("fail");
  });

  it("is case-insensitive", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: PASS";
    expect((verifier as any).parseDecision()).toBe("pass");
  });
});

// ─── parseFailedCriteria ────────────────────────────────────────

describe("parseFailedCriteria", () => {
  it("parses failed criteria markers", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = [
      "FAILED_CRITERION: 2 | POST /auth/login returns token | endpoint returns access_token instead of token",
      "FAILED_CRITERION: 3 | Rate limiting blocks after 5 attempts | no rate limiting implemented",
    ].join("\n");

    const results = (verifier as any).parseFailedCriteria();
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      storyIndex: 2,
      criterion: "POST /auth/login returns token",
      reason: "endpoint returns access_token instead of token",
    });
    expect(results[1]).toEqual({
      storyIndex: 3,
      criterion: "Rate limiting blocks after 5 attempts",
      reason: "no rate limiting implemented",
    });
  });

  it("returns empty array when no failed criteria", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: pass";
    expect((verifier as any).parseFailedCriteria()).toEqual([]);
  });

  it("returns empty array on empty output", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "";
    expect((verifier as any).parseFailedCriteria()).toEqual([]);
  });

  it("handles single failed criterion", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "FAILED_CRITERION: 1 | Health check | Missing /health endpoint";
    const results = (verifier as any).parseFailedCriteria();
    expect(results).toHaveLength(1);
    expect(results[0].storyIndex).toBe(1);
    expect(results[0].criterion).toBe("Health check");
    expect(results[0].reason).toBe("Missing /health endpoint");
  });
});

// ─── parseSummary ───────────────────────────────────────────────

describe("parseSummary", () => {
  it("parses verification summary", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_SUMMARY: 8 of 10 criteria passed";
    expect((verifier as any).parseSummary()).toBe("8 of 10 criteria passed");
  });

  it("returns default when no summary found", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "";
    expect((verifier as any).parseSummary()).toBe("No summary provided");
  });

  it("returns default when output has no summary marker", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_DECISION: pass\nSome other text";
    expect((verifier as any).parseSummary()).toBe("No summary provided");
  });

  it("trims whitespace from summary", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "VERIFICATION_SUMMARY:   All criteria met   ";
    expect((verifier as any).parseSummary()).toBe("All criteria met");
  });
});

// ─── buildVerificationPrompt ────────────────────────────────────

describe("buildVerificationPrompt", () => {
  it("includes all story criteria in prompt", () => {
    const verifier = createVerifier();
    const prompt = (verifier as any).buildVerificationPrompt([
      {
        storyIndex: 0,
        title: "Foundation",
        criteria: ["Health endpoint returns 200", "CI workflow runs lint"],
      },
      {
        storyIndex: 1,
        title: "Auth",
        criteria: ["POST /auth/login returns JWT"],
      },
    ]);

    expect(prompt).toContain("Story 0: Foundation");
    expect(prompt).toContain("Health endpoint returns 200");
    expect(prompt).toContain("CI workflow runs lint");
    expect(prompt).toContain("Story 1: Auth");
    expect(prompt).toContain("POST /auth/login returns JWT");
  });

  it("handles empty criteria array", () => {
    const verifier = createVerifier();
    const prompt = (verifier as any).buildVerificationPrompt([]);
    expect(prompt).toContain("Spec Verification");
  });

  it("includes target repo in prompt", () => {
    const verifier = createVerifier();
    const prompt = (verifier as any).buildVerificationPrompt([
      { storyIndex: 0, title: "Test", criteria: ["criterion 1"] },
    ]);
    expect(prompt).toContain("test/repo");
  });

  it("numbers criteria sequentially", () => {
    const verifier = createVerifier();
    const prompt = (verifier as any).buildVerificationPrompt([
      {
        storyIndex: 0,
        title: "Test",
        criteria: ["First criterion", "Second criterion", "Third criterion"],
      },
    ]);
    expect(prompt).toContain("1. First criterion");
    expect(prompt).toContain("2. Second criterion");
    expect(prompt).toContain("3. Third criterion");
  });
});

// ─── verify ─────────────────────────────────────────────────────

describe("verify", () => {
  it("returns pass when all stories have empty criteria", async () => {
    const verifier = createVerifier();
    const result = await verifier.verify([
      { storyIndex: 0, title: "test", criteria: [] },
    ]);
    expect(result.success).toBe(true);
    expect(result.decision).toBe("pass");
    expect(result.summary).toBe("No acceptance criteria to verify");
  });

  it("returns pass when no stories provided", async () => {
    const verifier = createVerifier();
    const result = await verifier.verify([]);
    expect(result.success).toBe(true);
    expect(result.decision).toBe("pass");
    expect(result.summary).toBe("No acceptance criteria to verify");
  });

  it("returns pass when multiple stories all have empty criteria", async () => {
    const verifier = createVerifier();
    const result = await verifier.verify([
      { storyIndex: 0, title: "test1", criteria: [] },
      { storyIndex: 1, title: "test2", criteria: [] },
    ]);
    expect(result.success).toBe(true);
    expect(result.decision).toBe("pass");
  });
});
