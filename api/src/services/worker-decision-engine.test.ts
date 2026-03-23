/**
 * Worker Decision Engine Tests
 *
 * Tests for the centralized decision-making service that encapsulates
 * worker intelligence previously embedded in the worker container.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
  getWorkerConfig,
  type ClassifyErrorRequest,
  type EvaluateQualityRequest,
  type ParseReviewOutcomeRequest,
  type RouteQuestionRequest,
  type RouteProviderRequest,
} from "./worker-decision-engine.js";

// ─── classifyError ───────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies TypeScript errors as fixable", () => {
    const result = classifyError({
      errorText: "error TS2304: Cannot find name 'foo'",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Fix login", persona: "backend_developer", targetFiles: ["src/auth.ts"] },
    });

    expect(result.category).toBe("typescript");
    expect(result.fixable).toBe(true);
    expect(result.action).toBe("auto_retry");
    expect(result.summary).toContain("TypeScript");
  });

  it("classifies lint errors as fixable", () => {
    const result = classifyError({
      errorText: "eslint error: 'x' is defined but never used",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Add feature", persona: "frontend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("lint");
    expect(result.fixable).toBe(true);
    expect(result.action).toBe("auto_retry");
  });

  it("classifies test failures as fixable", () => {
    const result = classifyError({
      errorText: "FAIL src/auth.test.ts\nTests: 1 failed, 5 passed",
      retryCount: 1,
      maxAutoRetries: 3,
      storyContext: { title: "Update tests", persona: "qa_engineer", targetFiles: ["src/auth.test.ts"] },
    });

    expect(result.category).toBe("test");
    expect(result.fixable).toBe(true);
    expect(result.action).toBe("auto_retry");
  });

  it("classifies build errors as fixable", () => {
    const result = classifyError({
      errorText: "Build failed: Module not found './missing'",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Build fix", persona: "devops_engineer", targetFiles: [] },
    });

    expect(result.category).toBe("build");
    expect(result.fixable).toBe(true);
    expect(result.action).toBe("auto_retry");
  });

  it("escalates fixable errors when retries exhausted", () => {
    const result = classifyError({
      errorText: "error TS2304: Cannot find name 'foo'",
      retryCount: 3,
      maxAutoRetries: 3,
      storyContext: { title: "Fix login", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("typescript");
    expect(result.fixable).toBe(true);
    expect(result.action).toBe("escalate");
  });

  it("classifies auth errors as non-fixable and escalates", () => {
    const result = classifyError({
      errorText: "401 Unauthorized - Authentication failed",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Deploy", persona: "devops_engineer", targetFiles: [] },
    });

    expect(result.category).toBe("auth");
    expect(result.fixable).toBe(false);
    expect(result.action).toBe("escalate");
  });

  it("classifies network errors as non-fixable and escalates", () => {
    const result = classifyError({
      errorText: "ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:3000",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "API call", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("network");
    expect(result.fixable).toBe(false);
    expect(result.action).toBe("escalate");
  });

  it("classifies resource errors as non-fixable and escalates", () => {
    const result = classifyError({
      errorText: "FATAL ERROR: heap out of memory",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Big task", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("resource");
    expect(result.fixable).toBe(false);
    expect(result.action).toBe("escalate");
  });

  it("classifies unknown errors as non-fixable", () => {
    const result = classifyError({
      errorText: "something completely unexpected happened",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Unknown", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("unknown");
    expect(result.fixable).toBe(false);
    expect(result.action).toBe("escalate");
  });

  it("extracts affected files from error text", () => {
    const result = classifyError({
      errorText: "error TS2304: Cannot find name 'foo'\n  at src/services/auth.ts:42:5\n  at src/utils/helper.ts:10:3",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Fix types", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.affectedFiles).toContain("src/services/auth.ts");
    expect(result.affectedFiles).toContain("src/utils/helper.ts");
  });

  it("generates a non-empty summary", () => {
    const result = classifyError({
      errorText: "error TS2304: Cannot find name 'MyType'\nsrc/models/user.ts:15:10",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Add user model", persona: "backend_developer", targetFiles: ["src/models/user.ts"] },
    });

    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns fixStrategy for fixable categories", () => {
    const result = classifyError({
      errorText: "error TS2304: Cannot find name 'foo'",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Fix", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.fixStrategy).toBeTruthy();
  });

  it("returns null fixStrategy for non-fixable categories", () => {
    const result = classifyError({
      errorText: "401 Unauthorized",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "Fix", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.fixStrategy).toBeNull();
  });

  it("handles 502 status code errors as network", () => {
    const result = classifyError({
      errorText: "Request failed with status code 502",
      retryCount: 0,
      maxAutoRetries: 3,
      storyContext: { title: "API", persona: "backend_developer", targetFiles: [] },
    });

    expect(result.category).toBe("network");
  });
});

// ─── evaluateQuality ─────────────────────────────────────────────────────────

describe("evaluateQuality", () => {
  it("passes when quality gate is disabled", () => {
    const result = evaluateQuality({
      metrics: { qualityScore: 10, testCoveragePercent: 5 },
      bypassRequested: false,
      qualityGateEnabled: false,
    });

    expect(result.pass).toBe(true);
    expect(result.reasons).toContain("Quality gate disabled");
  });

  it("passes when bypass is requested", () => {
    const result = evaluateQuality({
      metrics: { qualityScore: 10, testCoveragePercent: 5 },
      bypassRequested: true,
      qualityGateEnabled: true,
    });

    expect(result.pass).toBe(true);
    expect(result.reasons).toContain("Quality gate bypass authorized");
  });

  it("passes when all thresholds are met", () => {
    const result = evaluateQuality({
      metrics: { qualityScore: 90, testCoveragePercent: 80, securityVulnsHigh: 0, typeErrors: false, testFailures: false },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { minQualityScore: 70, minTestCoveragePercent: 60, maxSecurityHighVulns: 2, blockOnTypeErrors: true, blockOnTestFailures: true },
    });

    expect(result.pass).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("fails when quality score is below threshold", () => {
    const result = evaluateQuality({
      metrics: { qualityScore: 50 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { minQualityScore: 70 },
    });

    expect(result.pass).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers[0]).toContain("50");
  });

  it("fails when test coverage is below threshold", () => {
    const result = evaluateQuality({
      metrics: { testCoveragePercent: 30 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { minTestCoveragePercent: 60 },
    });

    expect(result.pass).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it("fails when security vulns exceed threshold", () => {
    const result = evaluateQuality({
      metrics: { securityVulnsHigh: 5 },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { maxSecurityHighVulns: 2 },
    });

    expect(result.pass).toBe(false);
  });

  it("fails when type errors present and blocking enabled", () => {
    const result = evaluateQuality({
      metrics: { typeErrors: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnTypeErrors: true },
    });

    expect(result.pass).toBe(false);
  });

  it("fails when test failures present and blocking enabled", () => {
    const result = evaluateQuality({
      metrics: { testFailures: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnTestFailures: true },
    });

    expect(result.pass).toBe(false);
  });

  it("passes when no thresholds configured", () => {
    const result = evaluateQuality({
      metrics: { qualityScore: 10 },
      bypassRequested: false,
      qualityGateEnabled: true,
    });

    expect(result.pass).toBe(true);
  });

  it("passes when type errors present but blocking not enabled", () => {
    const result = evaluateQuality({
      metrics: { typeErrors: true },
      bypassRequested: false,
      qualityGateEnabled: true,
      thresholds: { blockOnTypeErrors: false },
    });

    expect(result.pass).toBe(true);
  });
});

// ─── parseReviewOutcome ──────────────────────────────────────────────────────

describe("parseReviewOutcome", () => {
  const baseReq: ParseReviewOutcomeRequest = {
    reviewerOutput: "",
    revisionCount: 0,
    maxRevisions: 3,
    perStoryRevisionCount: 0,
    maxPerStoryRevisions: 2,
  };

  it("parses structured ::review_decision:: marker", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "Code looks good.\n::review_decision::approved\n::code_quality_score::9",
    });

    expect(result.decision).toBe("approved");
    expect(result.score).toBe(9);
    expect(result.shouldRevise).toBe(false);
  });

  it("parses REVIEW_DECISION: text marker", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "REVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 5\nFEEDBACK: Needs more tests",
    });

    expect(result.decision).toBe("revision_needed");
    expect(result.score).toBe(5);
    expect(result.shouldRevise).toBe(true);
  });

  it("detects natural language approval", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "This looks great, LGTM! Ship it to production.",
    });

    expect(result.decision).toBe("approved");
    expect(result.shouldRevise).toBe(false);
  });

  it("detects natural language rejection", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "I cannot approve this code. Too many security issues.",
    });

    expect(result.decision).toBe("rejected");
    expect(result.shouldRevise).toBe(false);
  });

  it("defaults to revision_needed for ambiguous output", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "There are some things to consider here.",
    });

    expect(result.decision).toBe("revision_needed");
    expect(result.shouldRevise).toBe(true);
  });

  it("clamps score to 1-10 range", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "::review_decision::approved\n::code_quality_score::15",
    });

    expect(result.score).toBe(10);
  });

  it("clamps low scores to 1", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "::review_decision::approved\n::code_quality_score::0",
    });

    expect(result.score).toBe(1);
  });

  it("defaults score to 5 when not found", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "::review_decision::approved",
    });

    expect(result.score).toBe(5);
  });

  it("sets shouldRevise false when revisions exhausted", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "REVIEW_DECISION: revision_needed",
      revisionCount: 3,
      maxRevisions: 3,
    });

    expect(result.decision).toBe("revision_needed");
    expect(result.shouldRevise).toBe(false);
    expect(result.revisionExhausted).toBe(true);
  });

  it("sets shouldRevise false when per-story revisions exhausted", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "REVIEW_DECISION: revision_needed",
      perStoryRevisionCount: 2,
      maxPerStoryRevisions: 2,
    });

    expect(result.decision).toBe("revision_needed");
    expect(result.shouldRevise).toBe(false);
    expect(result.revisionExhausted).toBe(true);
  });

  it("parses ::feedback:: structured marker", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "::review_decision::revision_needed\n::feedback::Please add error handling\n::code_quality_score::4",
    });

    expect(result.feedback).toBe("Please add error handling");
  });

  it("parses FEEDBACK: text marker", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "FEEDBACK: Missing null checks\nREVIEW_DECISION: revision_needed\nCODE_QUALITY_SCORE: 3",
    });

    expect(result.feedback).toBe("Missing null checks");
  });

  it("provides reason for the outcome", () => {
    const result = parseReviewOutcome({
      ...baseReq,
      reviewerOutput: "::review_decision::approved",
    });

    expect(result.reason).toBeTruthy();
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ─── routeQuestion ───────────────────────────────────────────────────────────

describe("routeQuestion", () => {
  it("routes to explicit target persona (tier 1) when idle", () => {
    const result = routeQuestion({
      question: "Can you check the CSS?",
      targetPersona: "frontend_developer",
      idleExperts: ["frontend_developer", "backend_developer"],
      allExperts: ["frontend_developer", "backend_developer", "qa_engineer"],
    });

    expect(result.targetExpert).toBe("frontend_developer");
    expect(result.routingTier).toBe(1);
  });

  it("does NOT route to explicit target if not idle (falls through)", () => {
    const result = routeQuestion({
      question: "Can you check the CSS?",
      targetPersona: "frontend_developer",
      idleExperts: ["backend_developer"],
      allExperts: ["frontend_developer", "backend_developer"],
    });

    // frontend_developer not idle, so tier 1 fails; falls to tier 2 (keyword match)
    // "css" keyword -> frontend_developer, but not idle -> tier 3 picks backend_developer
    expect(result.routingTier).toBeGreaterThan(1);
  });

  it("routes by keyword matching (tier 2) - security", () => {
    const result = routeQuestion({
      question: "Is this vulnerable to SQL injection security issue?",
      idleExperts: ["security_engineer", "backend_developer"],
      allExperts: ["security_engineer", "backend_developer"],
    });

    expect(result.targetExpert).toBe("security_engineer");
    expect(result.routingTier).toBe(2);
  });

  it("routes by keyword matching (tier 2) - database", () => {
    const result = routeQuestion({
      question: "How should I handle this SQL migration?",
      idleExperts: ["backend_developer", "frontend_developer"],
      allExperts: ["backend_developer", "frontend_developer"],
    });

    expect(result.targetExpert).toBe("backend_developer");
    expect(result.routingTier).toBe(2);
  });

  it("routes by keyword matching (tier 2) - frontend", () => {
    const result = routeQuestion({
      question: "The React component has a CSS issue",
      idleExperts: ["frontend_developer", "backend_developer"],
      allExperts: ["frontend_developer", "backend_developer"],
    });

    expect(result.targetExpert).toBe("frontend_developer");
    expect(result.routingTier).toBe(2);
  });

  it("routes by keyword matching (tier 2) - devops", () => {
    const result = routeQuestion({
      question: "We need to fix the Docker deployment pipeline",
      idleExperts: ["devops_engineer", "backend_developer"],
      allExperts: ["devops_engineer", "backend_developer"],
    });

    expect(result.targetExpert).toBe("devops_engineer");
    expect(result.routingTier).toBe(2);
  });

  it("routes by keyword matching (tier 2) - testing", () => {
    const result = routeQuestion({
      question: "We need better test coverage for this module",
      idleExperts: ["qa_engineer", "backend_developer"],
      allExperts: ["qa_engineer", "backend_developer"],
    });

    expect(result.targetExpert).toBe("qa_engineer");
    expect(result.routingTier).toBe(2);
  });

  it("routes by keyword matching (tier 2) - api", () => {
    const result = routeQuestion({
      question: "The REST endpoint is returning 500 errors",
      idleExperts: ["backend_developer", "frontend_developer"],
      allExperts: ["backend_developer", "frontend_developer"],
    });

    expect(result.targetExpert).toBe("backend_developer");
    expect(result.routingTier).toBe(2);
  });

  it("falls back to first idle expert (tier 3)", () => {
    const result = routeQuestion({
      question: "Can someone take a look at this?",
      idleExperts: ["backend_developer", "qa_engineer"],
      allExperts: ["backend_developer", "qa_engineer"],
    });

    expect(result.targetExpert).toBe("backend_developer");
    expect(result.routingTier).toBe(3);
  });

  it("skips non-coding personas in tier 3 fallback", () => {
    const result = routeQuestion({
      question: "Can someone take a look at this build error?",
      idleExperts: [
        "support_agent",
        "project_manager",
        "tech_writer",
        "data_ml_engineer",
        "backend_developer",
      ],
      allExperts: [
        "support_agent",
        "project_manager",
        "tech_writer",
        "data_ml_engineer",
        "backend_developer",
      ],
    });

    expect(result.targetExpert).toBe("data_ml_engineer");
    expect(result.routingTier).toBe(3);
  });

  it("returns null when only non-coding personas are idle", () => {
    const result = routeQuestion({
      question: "Can someone help with this?",
      idleExperts: ["support_agent", "project_manager"],
      allExperts: ["support_agent", "project_manager", "backend_developer"],
    });

    expect(result.targetExpert).toBeNull();
    expect(result.routingTier).toBe(3);
  });

  it("returns null when no experts are idle", () => {
    const result = routeQuestion({
      question: "Can someone help?",
      idleExperts: [],
      allExperts: ["backend_developer", "qa_engineer"],
    });

    expect(result.targetExpert).toBeNull();
    expect(result.routingTier).toBe(3);
  });
});

// ─── routeProvider ───────────────────────────────────────────────────────────

describe("routeProvider", () => {
  it("routes via explicit providerRouting JSON (tier 1)", () => {
    const result = routeProvider({
      persona: "frontend_developer",
      providerRouting: JSON.stringify({
        frontend_developer: { provider: "openai", model: "gpt-4o" },
      }),
      availableProviders: ["anthropic", "openai"],
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.inferenceSource).toBe("routing");
  });

  it("infers provider from model name - claude", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "claude-sonnet-4",
      availableProviders: ["anthropic"],
    });

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("infers provider from model name - gpt", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "gpt-4o",
      availableProviders: ["openai"],
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("infers provider from model name - gemini", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "gemini-2.0-flash",
      availableProviders: ["google"],
    });

    expect(result.provider).toBe("google");
    expect(result.model).toBe("gemini-2.0-flash");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("infers provider from model name - ollama models", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "qwen2.5-coder:32b",
      availableProviders: ["ollama"],
    });

    expect(result.provider).toBe("ollama");
    expect(result.model).toBe("qwen2.5-coder:32b");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("defaults to anthropic with claude-haiku-4-5", () => {
    const result = routeProvider({
      persona: "backend_developer",
      availableProviders: ["anthropic"],
    });

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.inferenceSource).toBe("default");
  });

  it("handles invalid providerRouting JSON gracefully", () => {
    const result = routeProvider({
      persona: "backend_developer",
      providerRouting: "not valid json",
      availableProviders: ["anthropic"],
    });

    // Should fall through to default
    expect(result.provider).toBe("anthropic");
    expect(result.inferenceSource).toBe("default");
  });

  it("falls through when providerRouting has no entry for persona", () => {
    const result = routeProvider({
      persona: "qa_engineer",
      providerRouting: JSON.stringify({
        frontend_developer: { provider: "openai", model: "gpt-4o" },
      }),
      modelName: "claude-sonnet-4",
      availableProviders: ["anthropic", "openai"],
    });

    // No routing for qa_engineer, falls to model_name inference
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("infers o1 as openai", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "o1-mini",
      availableProviders: ["openai"],
    });

    expect(result.provider).toBe("openai");
    expect(result.inferenceSource).toBe("model_name");
  });

  it("infers deepseek as ollama", () => {
    const result = routeProvider({
      persona: "backend_developer",
      modelName: "deepseek-r1:70b",
      availableProviders: ["ollama"],
    });

    expect(result.provider).toBe("ollama");
    expect(result.inferenceSource).toBe("model_name");
  });
});

// ─── getWorkerConfig ─────────────────────────────────────────────────────────

describe("getWorkerConfig", () => {
  it("returns persona icons", async () => {
    const config = await getWorkerConfig();
    expect(config.personaIcons.frontend_developer).toBe("\uD83C\uDFA8");
    expect(config.personaIcons.backend_developer).toBe("\uD83D\uDCBB");
    expect(config.personaIcons.devops_engineer).toBe("\uD83D\uDD27");
    expect(config.personaIcons.security_engineer).toBe("🛡️");
    expect(config.personaIcons.qa_engineer).toBe("\uD83E\uDDEA");
  });

  it("returns provider icons", async () => {
    const config = await getWorkerConfig();
    expect(config.providerIcons.anthropic).toBe("\uD83E\uDD16");
    expect(config.providerIcons.openai).toBe("\uD83D\uDD37");
    expect(config.providerIcons.google).toBe("\uD83D\uDD35");
    expect(config.providerIcons.ollama).toBe("\uD83C\uDFE0");
  });

  it("returns review schema", async () => {
    const config = await getWorkerConfig();
    expect(config.reviewSchema.decision).toContain("approved");
    expect(config.reviewSchema.decision).toContain("revision_needed");
    expect(config.reviewSchema.decision).toContain("rejected");
    expect(config.reviewSchema.scoreRange).toEqual([1, 10]);
  });

  it("returns default config values", async () => {
    const config = await getWorkerConfig();
    expect(config.defaults.blockerMaxAutoRetries).toBe(3);
    expect(config.defaults.maxReviewRevisions).toBe(4);
    expect(config.defaults.maxPerStoryRevisions).toBe(0);
  });

  it("returns a claudeMdTemplate string", async () => {
    const config = await getWorkerConfig();
    expect(typeof config.claudeMdTemplate).toBe("string");
    expect(config.claudeMdTemplate.length).toBeGreaterThan(0);
  });

  it("returns agentsMd content", async () => {
    const config = await getWorkerConfig();
    expect(typeof config.agentsMd).toBe("string");
    expect(config.agentsMd.length).toBeGreaterThan(0);
  });
});
