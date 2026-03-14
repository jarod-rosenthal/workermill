import { describe, it, expect } from "vitest";
import { InlineVerifier } from "./inline-verifier.js";

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

  it("defaults to fail when no marker found", () => {
    const verifier = createVerifier();
    (verifier as any).allOutput = "Some output without markers";
    expect((verifier as any).parseDecision()).toBe("fail");
  });
});

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
});

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
});

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
    expect(prompt).toContain("Story 1: Auth");
    expect(prompt).toContain("POST /auth/login returns JWT");
  });

  it("handles empty criteria gracefully", () => {
    const verifier = createVerifier();
    const prompt = (verifier as any).buildVerificationPrompt([]);
    expect(prompt).toContain("Spec Verification");
  });
});

describe("verify", () => {
  it("returns pass when all stories have empty criteria", async () => {
    const verifier = createVerifier();
    const result = await verifier.verify([
      { storyIndex: 0, title: "test", criteria: [] },
    ]);
    expect(result.success).toBe(true);
    expect(result.decision).toBe("pass");
  });

  it("returns pass when no stories provided", async () => {
    const verifier = createVerifier();
    const result = await verifier.verify([]);
    expect(result.success).toBe(true);
    expect(result.decision).toBe("pass");
  });
});
