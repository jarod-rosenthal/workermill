import { describe, it, expect } from "vitest";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
} from "../decisions.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeClassifyReq(
  errorText: string,
  retryCount = 0,
  maxAutoRetries = 3,
) {
  return {
    errorText,
    retryCount,
    maxAutoRetries,
    storyContext: {
      title: "Add user auth",
      persona: "backend_developer",
      targetFiles: ["src/auth.ts"],
    },
  };
}

// ─── classifyError ──────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies TypeScript errors as fixable", () => {
    const res = classifyError(
      makeClassifyReq("error TS2345: Argument of type 'string' is not assignable"),
    );
    expect(res.category).toBe("typescript");
    expect(res.fixable).toBe(true);
    expect(res.action).toBe("auto_retry");
    expect(res.fixStrategy).toContain("TypeScript");
  });

  it("classifies lint errors as fixable", () => {
    const res = classifyError(
      makeClassifyReq("eslint error in src/index.ts"),
    );
    expect(res.category).toBe("lint");
    expect(res.fixable).toBe(true);
    expect(res.action).toBe("auto_retry");
  });

  it("classifies test failures as fixable", () => {
    const res = classifyError(
      makeClassifyReq("FAIL src/auth.test.ts\nTests: 1 failed, 2 passed"),
    );
    expect(res.category).toBe("test");
    expect(res.fixable).toBe(true);
    expect(res.action).toBe("auto_retry");
  });

  it("classifies build errors as fixable", () => {
    const res = classifyError(
      makeClassifyReq("Build failed with 2 errors\nModule not found: 'lodash'"),
    );
    expect(res.category).toBe("build");
    expect(res.fixable).toBe(true);
  });

  it("classifies network errors as not fixable", () => {
    const res = classifyError(
      makeClassifyReq("ECONNREFUSED 127.0.0.1:5432"),
    );
    expect(res.category).toBe("network");
    expect(res.fixable).toBe(false);
    expect(res.action).toBe("escalate");
  });

  it("classifies resource errors as not fixable", () => {
    const res = classifyError(
      makeClassifyReq("FATAL ERROR: JavaScript heap out of memory"),
    );
    expect(res.category).toBe("resource");
    expect(res.fixable).toBe(false);
  });

  it("classifies unknown errors as not fixable", () => {
    const res = classifyError(
      makeClassifyReq("Something completely unexpected happened"),
    );
    expect(res.category).toBe("unknown");
    expect(res.fixable).toBe(false);
    expect(res.fixStrategy).toBeNull();
  });

  it("classifies auth errors as not fixable", () => {
    const res = classifyError(
      makeClassifyReq("401 Unauthorized"),
    );
    expect(res.category).toBe("auth");
    expect(res.fixable).toBe(false);
    expect(res.action).toBe("escalate");
  });

  it("classifies transient auth errors as fixable", () => {
    const res = classifyError(
      makeClassifyReq("OAuth token revoked, please re-authenticate"),
    );
    expect(res.category).toBe("auth_transient");
    expect(res.fixable).toBe(true);
    expect(res.action).toBe("auto_retry");
  });

  it("escalates fixable errors when retries exhausted", () => {
    const res = classifyError(
      makeClassifyReq("error TS2345: bad type", 3, 3),
    );
    expect(res.category).toBe("typescript");
    expect(res.fixable).toBe(true);
    expect(res.action).toBe("escalate");
  });

  it("allows auto_retry when retryCount < maxAutoRetries", () => {
    const res = classifyError(
      makeClassifyReq("error TS2345: bad type", 2, 3),
    );
    expect(res.action).toBe("auto_retry");
  });

  it("extracts affected files from error text", () => {
    const res = classifyError(
      makeClassifyReq(
        "error TS2345 in src/auth.ts:10:5\nCannot find module './utils.js'",
      ),
    );
    expect(res.affectedFiles).toContain("src/auth.ts");
    expect(res.affectedFiles.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts affected files from quoted paths", () => {
    const res = classifyError(
      makeClassifyReq(
        "Cannot find module './services/user.ts'\nerror TS1234: something",
      ),
    );
    expect(res.affectedFiles).toContain("services/user.ts");
  });

  it("generates a summary string", () => {
    const res = classifyError(
      makeClassifyReq("error TS2345: Argument of type 'string' is not assignable"),
    );
    expect(res.summary).toBeTruthy();
    expect(res.summary.length).toBeGreaterThan(10);
  });
});

// ─── evaluateQuality ────────────────────────────────────────────────────────

describe("evaluateQuality", () => {
  it("passes with good metrics above thresholds", () => {
    const res = evaluateQuality({
      metrics: { qualityScore: 90, testCoveragePercent: 80 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { minQualityScore: 85, minTestCoveragePercent: 70 },
    });
    expect(res.pass).toBe(true);
    expect(res.blockers).toHaveLength(0);
    expect(res.reasons.length).toBeGreaterThan(0);
  });

  it("fails when type errors are present and blocking is enabled", () => {
    const res = evaluateQuality({
      metrics: { typeErrors: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnTypeErrors: true },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers).toContain(
      "TypeScript errors detected and blocking is enabled",
    );
  });

  it("fails when quality score is below threshold", () => {
    const res = evaluateQuality({
      metrics: { qualityScore: 60 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { minQualityScore: 85 },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers[0]).toContain("below threshold");
  });

  it("passes when quality gate is disabled", () => {
    const res = evaluateQuality({
      metrics: { typeErrors: true, qualityScore: 10 },
      bypassRequested: false,
      qualityGateEnabled: false,
      thresholds: { blockOnTypeErrors: true, minQualityScore: 85 },
    });
    expect(res.pass).toBe(true);
    expect(res.reasons).toContain("Quality gate disabled");
  });

  it("passes when bypass is requested", () => {
    const res = evaluateQuality({
      metrics: { qualityScore: 10 },
      bypassRequested: true,
      qualityGateEnabled: true,
      thresholds: { minQualityScore: 85 },
    });
    expect(res.pass).toBe(true);
    expect(res.reasons).toContain("Quality gate bypass authorized");
  });

  it("fails on test failures when blocking is enabled", () => {
    const res = evaluateQuality({
      metrics: { testFailures: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnTestFailures: true },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers[0]).toContain("Test failures");
  });

  it("fails on lint errors when blocking is enabled", () => {
    const res = evaluateQuality({
      metrics: { lintErrors: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnLintErrors: true },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers[0]).toContain("Lint errors");
  });

  it("fails on e2e failures when blocking is enabled", () => {
    const res = evaluateQuality({
      metrics: { e2eFailures: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnE2EFailures: true },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers[0]).toContain("E2E test failures");
  });

  it("accumulates multiple blockers", () => {
    const res = evaluateQuality({
      metrics: { typeErrors: true, testFailures: true, qualityScore: 10 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: {
        blockOnTypeErrors: true,
        blockOnTestFailures: true,
        minQualityScore: 85,
      },
    });
    expect(res.pass).toBe(false);
    expect(res.blockers.length).toBe(3);
  });

  it("passes with no thresholds configured", () => {
    const res = evaluateQuality({
      metrics: { qualityScore: 50 },
      bypassRequested: false,
      qualityGateEnabled: true,
    });
    expect(res.pass).toBe(true);
  });
});

// ─── parseReviewOutcome ─────────────────────────────────────────────────────

describe("parseReviewOutcome", () => {
  const base = {
    revisionCount: 0,
    maxRevisions: 4,
    perStoryRevisionCount: 0,
    maxPerStoryRevisions: 4,
  };

  it("parses structured approved marker", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput:
        "The code looks good.\n::review_decision::approved\n::code_quality_score::9",
    });
    expect(res.decision).toBe("approved");
    expect(res.score).toBe(9);
    expect(res.shouldRevise).toBe(false);
    expect(res.reason).toContain("Structured marker");
  });

  it("parses text marker REVIEW_DECISION: approved", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput:
        "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 8\nFEEDBACK: Well done!",
    });
    expect(res.decision).toBe("approved");
    expect(res.score).toBe(8);
    expect(res.feedback).toBe("Well done!");
    expect(res.reason).toContain("Text marker");
  });

  it("parses revision_needed decision", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "::review_decision::revision_needed\n::feedback::Fix the types",
    });
    expect(res.decision).toBe("revision_needed");
    expect(res.shouldRevise).toBe(true);
    expect(res.revisionExhausted).toBe(false);
    expect(res.feedback).toBe("Fix the types");
  });

  it("parses rejected decision", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "REVIEW_DECISION: rejected\nCODE_QUALITY_SCORE: 2",
    });
    expect(res.decision).toBe("rejected");
    expect(res.score).toBe(2);
    expect(res.shouldRevise).toBe(false);
  });

  it("falls back to natural language approval", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "This looks great, LGTM! Ship it.",
    });
    expect(res.decision).toBe("approved");
    expect(res.reason).toContain("Natural language");
  });

  it("falls back to natural language rejection", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "I am rejecting this code. Do not merge.",
    });
    expect(res.decision).toBe("rejected");
  });

  it("defaults to revision_needed for ambiguous output", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "There are some issues to address in the code.",
    });
    expect(res.decision).toBe("revision_needed");
    expect(res.shouldRevise).toBe(true);
  });

  it("clamps score to 1-10 range", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput:
        "::review_decision::approved\n::code_quality_score::99",
    });
    expect(res.score).toBe(10);
  });

  it("defaults score to 5 when not provided", () => {
    const res = parseReviewOutcome({
      ...base,
      reviewerOutput: "::review_decision::approved",
    });
    expect(res.score).toBe(5);
  });

  it("marks revisionExhausted when global revision count is at max", () => {
    const res = parseReviewOutcome({
      reviewerOutput: "::review_decision::revision_needed",
      revisionCount: 4,
      maxRevisions: 4,
      perStoryRevisionCount: 0,
      maxPerStoryRevisions: 4,
    });
    expect(res.revisionExhausted).toBe(true);
    expect(res.shouldRevise).toBe(false);
    expect(res.reason).toContain("revision limit reached");
  });

  it("marks revisionExhausted when per-story revision count is at max", () => {
    const res = parseReviewOutcome({
      reviewerOutput: "::review_decision::revision_needed",
      revisionCount: 0,
      maxRevisions: 4,
      perStoryRevisionCount: 4,
      maxPerStoryRevisions: 4,
    });
    expect(res.revisionExhausted).toBe(true);
    expect(res.shouldRevise).toBe(false);
  });
});

// ─── routeQuestion ──────────────────────────────────────────────────────────

describe("routeQuestion", () => {
  it("tier 1: routes to explicit target persona if idle", () => {
    const res = routeQuestion({
      question: "How should I structure the auth middleware?",
      targetPersona: "backend_developer",
      idleExperts: ["backend_developer", "frontend_developer"],
      allExperts: ["backend_developer", "frontend_developer"],
    });
    expect(res.targetExpert).toBe("backend_developer");
    expect(res.routingTier).toBe(1);
    expect(res.reason).toContain("Explicit target");
  });

  it("tier 1: skips explicit target if not idle, falls to tier 2/3", () => {
    const res = routeQuestion({
      question: "How do I handle security headers?",
      targetPersona: "backend_developer",
      idleExperts: ["security_engineer"],
      allExperts: ["backend_developer", "security_engineer"],
    });
    // Should match security keyword -> tier 2
    expect(res.targetExpert).toBe("security_engineer");
    expect(res.routingTier).toBe(2);
  });

  it("tier 2: routes based on keyword matching", () => {
    const res = routeQuestion({
      question: "How do I set up the Docker deployment pipeline?",
      idleExperts: ["devops_engineer", "backend_developer"],
      allExperts: ["devops_engineer", "backend_developer"],
    });
    expect(res.targetExpert).toBe("devops_engineer");
    expect(res.routingTier).toBe(2);
    expect(res.reason).toContain("devops_engineer");
  });

  it("tier 2: routes database questions to backend_developer", () => {
    const res = routeQuestion({
      question: "How should I write this postgres migration?",
      idleExperts: ["backend_developer", "qa_engineer"],
      allExperts: ["backend_developer", "qa_engineer"],
    });
    expect(res.targetExpert).toBe("backend_developer");
    expect(res.routingTier).toBe(2);
  });

  it("tier 3: falls back to first idle eligible expert", () => {
    const res = routeQuestion({
      question: "Can someone help me understand this legacy code?",
      idleExperts: ["backend_developer", "frontend_developer"],
      allExperts: ["backend_developer", "frontend_developer"],
    });
    expect(res.targetExpert).toBe("backend_developer");
    expect(res.routingTier).toBe(3);
    expect(res.reason).toContain("Fallback");
  });

  it("tier 3: excludes ineligible personas from round-robin", () => {
    const res = routeQuestion({
      question: "Can someone help me with this?",
      idleExperts: ["support_agent", "project_manager", "backend_developer"],
      allExperts: ["support_agent", "project_manager", "backend_developer"],
    });
    expect(res.targetExpert).toBe("backend_developer");
    expect(res.routingTier).toBe(3);
  });

  it("returns null when no idle experts are available", () => {
    const res = routeQuestion({
      question: "Anyone free?",
      idleExperts: [],
      allExperts: ["backend_developer"],
    });
    expect(res.targetExpert).toBeNull();
    expect(res.routingTier).toBe(3);
    expect(res.reason).toContain("No idle experts");
  });

  it("returns null when only ineligible personas are idle", () => {
    const res = routeQuestion({
      question: "Need help here",
      idleExperts: ["support_agent", "tech_writer"],
      allExperts: ["support_agent", "tech_writer", "backend_developer"],
    });
    expect(res.targetExpert).toBeNull();
    expect(res.routingTier).toBe(3);
  });
});

// ─── routeProvider ──────────────────────────────────────────────────────────

describe("routeProvider", () => {
  it("uses explicit per-persona routing when provided", () => {
    const res = routeProvider({
      persona: "backend_developer",
      providerRouting: JSON.stringify({
        backend_developer: { provider: "openai", model: "gpt-5.4" },
      }),
      availableProviders: ["anthropic", "openai"],
    });
    expect(res.provider).toBe("openai");
    expect(res.model).toBe("gpt-5.4");
    expect(res.inferenceSource).toBe("routing");
  });

  it("falls through when routing JSON is invalid", () => {
    const res = routeProvider({
      persona: "backend_developer",
      providerRouting: "not json",
      availableProviders: ["anthropic"],
    });
    // Should fall to default since no modelName provided
    expect(res.provider).toBe("anthropic");
    expect(res.inferenceSource).toBe("default");
  });

  it("infers anthropic from claude model name", () => {
    const res = routeProvider({
      persona: "backend_developer",
      modelName: "claude-sonnet-4-6",
      availableProviders: ["anthropic", "openai"],
    });
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe("claude-sonnet-4-6");
    expect(res.inferenceSource).toBe("model_name");
  });

  it("infers openai from gpt model name", () => {
    const res = routeProvider({
      persona: "backend_developer",
      modelName: "gpt-5.4",
      availableProviders: ["openai"],
    });
    expect(res.provider).toBe("openai");
    expect(res.inferenceSource).toBe("model_name");
  });

  it("infers google from gemini model name", () => {
    const res = routeProvider({
      persona: "backend_developer",
      modelName: "gemini-3.1-pro",
      availableProviders: ["google"],
    });
    expect(res.provider).toBe("google");
  });

  it("infers ollama from qwen model name", () => {
    const res = routeProvider({
      persona: "backend_developer",
      modelName: "qwen3-coder:30b",
      availableProviders: ["ollama"],
    });
    expect(res.provider).toBe("ollama");
  });

  it("infers ollama from deepseek model name", () => {
    const res = routeProvider({
      persona: "backend_developer",
      modelName: "deepseek-r1:14b",
      availableProviders: ["ollama"],
    });
    expect(res.provider).toBe("ollama");
  });

  it("defaults to anthropic with claude-sonnet-4-6 when no model specified", () => {
    const res = routeProvider({
      persona: "backend_developer",
      availableProviders: ["anthropic"],
    });
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe("claude-sonnet-4-6");
    expect(res.inferenceSource).toBe("default");
  });

  it("ignores routing entry that lacks provider or model", () => {
    const res = routeProvider({
      persona: "backend_developer",
      providerRouting: JSON.stringify({
        backend_developer: { provider: "openai" },
      }),
      availableProviders: ["anthropic"],
    });
    // Missing model -> falls through to default
    expect(res.inferenceSource).toBe("default");
  });
});
