import { describe, test, expect } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { Organization } from "../../../models/Organization";
import {
  classifyError,
  evaluateQuality,
  parseReviewOutcome,
  routeQuestion,
  routeProvider,
  getWorkerConfig,
} from "../../../services/worker-decision-engine.js";

/**
 * Worker Decision Engine Integration Tests.
 *
 * Tests the worker-decision-engine service functions that power the
 * /api/worker-decisions/ endpoints. Most functions are pure (no DB),
 * but we test them here with org settings from a real database to
 * verify the full flow: org settings -> decision function -> result.
 */
describe("Worker Decision Engine", () => {
  /**
   * Helper to create a test organization.
   */
  async function createTestOrg(overrides?: Partial<Organization>) {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      settings: {},
      apiKey: `test-api-key-${Date.now()}`,
      ...overrides,
    });
    return manager.save(org);
  }

  // ─── classifyError ──────────────────────────────────────────────────────────

  describe("classifyError", () => {
    test("TypeScript error is classified as fixable with auto_retry", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 5 });

      const result = classifyError({
        errorText: "src/index.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
        retryCount: 0,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Add user validation",
          persona: "backend_developer",
          targetFiles: ["src/index.ts"],
        },
      });

      expect(result.category).toBe("typescript");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("auto_retry");
      expect(result.fixStrategy).toContain("TypeScript");
      expect(result.affectedFiles).toContain("src/index.ts");
      expect(result.summary).toBeTruthy();
    });

    test("network error is classified as fixable with auto_retry when retries remain", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 3 });

      const result = classifyError({
        errorText: "Error: connect ECONNREFUSED 127.0.0.1:5432",
        retryCount: 1,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Fix database connection",
          persona: "backend_developer",
          targetFiles: ["src/db.ts"],
        },
      });

      expect(result.category).toBe("network");
      expect(result.fixable).toBe(false);
      expect(result.action).toBe("escalate");
      expect(result.summary).toContain("Network connectivity error");
    });

    test("auth error with retryCount >= maxAutoRetries escalates", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 3 });

      const result = classifyError({
        errorText: "Error: 401 Unauthorized - Invalid API key provided",
        retryCount: 3,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Integrate payment API",
          persona: "backend_developer",
          targetFiles: ["src/payments.ts"],
        },
      });

      expect(result.category).toBe("auth");
      expect(result.fixable).toBe(false);
      expect(result.action).toBe("escalate");
      expect(result.summary).toContain("Authentication");
    });

    test("unknown error returns category unknown and escalates", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 3 });

      const result = classifyError({
        errorText: "Something completely unexpected happened in the flux capacitor",
        retryCount: 0,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Mysterious feature",
          persona: "backend_developer",
          targetFiles: [],
        },
      });

      expect(result.category).toBe("unknown");
      expect(result.fixable).toBe(false);
      expect(result.action).toBe("escalate");
    });

    test("lint error is fixable and retries when under limit", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 3 });

      const result = classifyError({
        errorText: "eslint error: 'username' is defined but never used",
        retryCount: 1,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Cleanup unused variables",
          persona: "frontend_developer",
          targetFiles: ["src/components/Login.tsx"],
        },
      });

      expect(result.category).toBe("lint");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("auto_retry");
    });

    test("test failure is fixable and retries when under limit", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 5 });

      const result = classifyError({
        errorText: "FAIL src/utils.test.ts\n  Tests: 2 failed, 3 passed\n  Expected 'hello' to equal 'world'",
        retryCount: 2,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Fix utility tests",
          persona: "qa_engineer",
          targetFiles: ["src/utils.test.ts"],
        },
      });

      expect(result.category).toBe("test");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("auto_retry");
      expect(result.affectedFiles).toContain("src/utils.test.ts");
    });

    test("fixable error escalates when retry limit reached", async () => {
      const org = await createTestOrg({ blockerMaxAutoRetries: 2 });

      const result = classifyError({
        errorText: "error TS2339: Property 'foo' does not exist on type 'Bar'.",
        retryCount: 2,
        maxAutoRetries: org.blockerMaxAutoRetries,
        storyContext: {
          title: "Fix type errors",
          persona: "backend_developer",
          targetFiles: ["src/bar.ts"],
        },
      });

      expect(result.category).toBe("typescript");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("escalate");
    });
  });

  // ─── evaluateQuality ────────────────────────────────────────────────────────

  describe("evaluateQuality", () => {
    test("quality passes when all metrics meet thresholds", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        blockOnTypeErrors: true,
        blockOnTestFailures: true,
        blockOnLintErrors: true,
        blockOnE2EFailures: true,
        minQualityScore: 80,
        minTestCoveragePercent: 70,
      });

      const result = evaluateQuality({
        metrics: {
          qualityScore: 90,
          testCoveragePercent: 85,
          typeErrors: false,
          testFailures: false,
          lintErrors: false,
          e2eFailures: false,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          minQualityScore: org.minQualityScore,
          minTestCoveragePercent: org.minTestCoveragePercent,
          blockOnTypeErrors: org.blockOnTypeErrors,
          blockOnTestFailures: org.blockOnTestFailures,
          blockOnLintErrors: org.blockOnLintErrors,
          blockOnE2EFailures: org.blockOnE2EFailures,
        },
      });

      expect(result.pass).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    test("quality fails when type errors present and blockOnTypeErrors=true", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        blockOnTypeErrors: true,
      });

      const result = evaluateQuality({
        metrics: {
          typeErrors: true,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          blockOnTypeErrors: org.blockOnTypeErrors,
        },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers).toContain("TypeScript errors detected and blocking is enabled");
    });

    test("quality fails when tests fail and blockOnTestFailures=true", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        blockOnTestFailures: true,
      });

      const result = evaluateQuality({
        metrics: {
          testFailures: true,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          blockOnTestFailures: org.blockOnTestFailures,
        },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers).toContain("Test failures detected and blocking is enabled");
    });

    test("quality fails when lint errors present and blockOnLintErrors=true", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        blockOnLintErrors: true,
      });

      const result = evaluateQuality({
        metrics: {
          lintErrors: true,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          blockOnLintErrors: org.blockOnLintErrors,
        },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers).toContain("Lint errors detected and blocking is enabled");
    });

    test("quality fails when score below minimum threshold", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        minQualityScore: 80,
      });

      const result = evaluateQuality({
        metrics: {
          qualityScore: 65,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          minQualityScore: org.minQualityScore,
        },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers.length).toBeGreaterThan(0);
      expect(result.blockers[0]).toContain("65");
      expect(result.blockers[0]).toContain("80");
    });

    test("bypass requested passes quality gate", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        blockOnTypeErrors: true,
        blockOnTestFailures: true,
      });

      const result = evaluateQuality({
        metrics: {
          typeErrors: true,
          testFailures: true,
        },
        bypassRequested: true,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          blockOnTypeErrors: org.blockOnTypeErrors,
          blockOnTestFailures: org.blockOnTestFailures,
        },
      });

      expect(result.pass).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.reasons).toContain("Quality gate bypass authorized");
    });

    test("quality gate disabled passes automatically", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: false,
      });

      const result = evaluateQuality({
        metrics: {
          typeErrors: true,
          testFailures: true,
          lintErrors: true,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          blockOnTypeErrors: true,
          blockOnTestFailures: true,
          blockOnLintErrors: true,
        },
      });

      expect(result.pass).toBe(true);
      expect(result.reasons).toContain("Quality gate disabled");
    });

    test("quality fails when test coverage below threshold", async () => {
      const org = await createTestOrg({
        qualityGateEnabled: true,
        minTestCoveragePercent: 80,
      });

      const result = evaluateQuality({
        metrics: {
          testCoveragePercent: 55,
        },
        bypassRequested: false,
        qualityGateEnabled: org.qualityGateEnabled,
        thresholds: {
          minTestCoveragePercent: org.minTestCoveragePercent,
        },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers[0]).toContain("55");
      expect(result.blockers[0]).toContain("80");
    });
  });

  // ─── parseReviewOutcome ─────────────────────────────────────────────────────

  describe("parseReviewOutcome", () => {
    test("LGTM review is parsed as approved", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 0 });

      const result = parseReviewOutcome({
        reviewerOutput: "Code looks great! LGTM. Ship it!",
        revisionCount: 0,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("approved");
      expect(result.shouldRevise).toBe(false);
      expect(result.revisionExhausted).toBe(true); // maxPerStoryRevisions=0 means 0>=0 is true
      expect(result.score).toBe(5); // default score when no score marker
    });

    test("needs changes review is parsed as revision_needed", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 3 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: revision_needed\nFEEDBACK: The error handling is missing in the payment module.\nCODE_QUALITY_SCORE: 6",
        revisionCount: 1,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("revision_needed");
      expect(result.shouldRevise).toBe(true);
      expect(result.revisionExhausted).toBe(false);
      expect(result.score).toBe(6);
      expect(result.feedback).toContain("error handling");
      expect(result.reason).toContain("Text marker");
    });

    test("score is extracted from CODE_QUALITY_SCORE marker", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 8\nFEEDBACK: Well structured code.",
        revisionCount: 0,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("approved");
      expect(result.score).toBe(8);
      expect(result.feedback).toContain("Well structured");
    });

    test("structured markers take priority over natural language", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "This code needs changes, but I'll approve it.\n::review_decision::approved\n::code_quality_score::9",
        revisionCount: 0,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("approved");
      expect(result.score).toBe(9);
      expect(result.reason).toContain("Structured marker");
    });

    test("revision count at max causes escalation (revisionExhausted=true)", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 3, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: revision_needed\nFEEDBACK: Still has issues after multiple attempts.\nCODE_QUALITY_SCORE: 4",
        revisionCount: 3,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 1,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("revision_needed");
      expect(result.revisionExhausted).toBe(true);
      expect(result.shouldRevise).toBe(false);
      expect(result.reason).toContain("revision limit reached");
    });

    test("per-story revision count at max causes escalation", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 10, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: revision_needed\nFEEDBACK: This story keeps failing.\nCODE_QUALITY_SCORE: 3",
        revisionCount: 1,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 2,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("revision_needed");
      expect(result.revisionExhausted).toBe(true);
      expect(result.shouldRevise).toBe(false);
    });

    test("rejected review is parsed correctly", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: rejected\nFEEDBACK: Fundamentally wrong approach. Do not merge.\nCODE_QUALITY_SCORE: 1",
        revisionCount: 0,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.decision).toBe("rejected");
      expect(result.score).toBe(1);
      expect(result.shouldRevise).toBe(false);
      expect(result.feedback).toContain("Fundamentally wrong");
    });

    test("score is clamped to 1-10 range", async () => {
      const org = await createTestOrg({ maxReviewRevisions: 4, maxPerStoryRevisions: 2 });

      const result = parseReviewOutcome({
        reviewerOutput:
          "REVIEW_DECISION: approved\nCODE_QUALITY_SCORE: 15",
        revisionCount: 0,
        maxRevisions: org.maxReviewRevisions,
        perStoryRevisionCount: 0,
        maxPerStoryRevisions: org.maxPerStoryRevisions,
      });

      expect(result.score).toBe(10);
    });
  });

  // ─── getWorkerConfig ────────────────────────────────────────────────────────

  describe("getWorkerConfig", () => {
    test("returns expected structure with correct defaults", async () => {
      const config = await getWorkerConfig();

      // Verify defaults match production values
      expect(config.defaults.blockerMaxAutoRetries).toBe(3);
      expect(config.defaults.maxReviewRevisions).toBe(4);
      expect(config.defaults.maxPerStoryRevisions).toBe(0);
    });

    test("has personaIcons map with expected personas", async () => {
      const config = await getWorkerConfig();

      expect(config.personaIcons).toBeDefined();
      expect(typeof config.personaIcons).toBe("object");
      expect(config.personaIcons.architect).toBeDefined();
      expect(config.personaIcons.frontend_developer).toBeDefined();
      expect(config.personaIcons.backend_developer).toBeDefined();
      expect(config.personaIcons.devops_engineer).toBeDefined();
      expect(config.personaIcons.tech_lead).toBeDefined();
      expect(config.personaIcons.qa_engineer).toBeDefined();
    });

    test("has providerIcons map", async () => {
      const config = await getWorkerConfig();

      expect(config.providerIcons).toBeDefined();
      expect(config.providerIcons.anthropic).toBeDefined();
      expect(config.providerIcons.openai).toBeDefined();
      expect(config.providerIcons.google).toBeDefined();
      expect(config.providerIcons.ollama).toBeDefined();
    });

    test("has reviewSchema with valid structure", async () => {
      const config = await getWorkerConfig();

      expect(config.reviewSchema).toBeDefined();
      expect(config.reviewSchema.decision).toEqual(["approved", "revision_needed", "rejected"]);
      expect(config.reviewSchema.scoreRange).toEqual([1, 10]);
    });

    test("has agentsMd content", async () => {
      const config = await getWorkerConfig();

      expect(typeof config.agentsMd).toBe("string");
      expect(config.agentsMd.length).toBeGreaterThan(0);
    });

    test("has promptTemplates", async () => {
      const config = await getWorkerConfig();

      expect(config.promptTemplates).toBeDefined();
      expect(config.promptTemplates!.coordinationInstructions).toBeDefined();
      expect(config.promptTemplates!.learningInstructions).toBeDefined();
      expect(config.promptTemplates!.techLeadReviewPrompt).toBeDefined();
      expect(config.promptTemplates!.devopsPhase1Prompt).toBeDefined();
      expect(config.promptTemplates!.improverPrompt).toBeDefined();
    });
  });

  // ─── routeQuestion (bonus — pure function, no DB needed) ───────────────────

  describe("routeQuestion", () => {
    test("routes to explicit target persona when idle", () => {
      const result = routeQuestion({
        question: "How should we handle the database schema?",
        targetPersona: "backend_developer",
        idleExperts: ["backend_developer", "frontend_developer"],
        allExperts: ["backend_developer", "frontend_developer", "qa_engineer"],
      });

      expect(result.targetExpert).toBe("backend_developer");
      expect(result.routingTier).toBe(1);
    });

    test("routes by keyword when no explicit target", () => {
      const result = routeQuestion({
        question: "How should we set up the Docker deployment pipeline?",
        idleExperts: ["devops_engineer", "backend_developer"],
        allExperts: ["devops_engineer", "backend_developer"],
      });

      expect(result.targetExpert).toBe("devops_engineer");
      expect(result.routingTier).toBe(2);
    });

    test("falls back to first idle expert on tier 3", () => {
      const result = routeQuestion({
        question: "What color should the logo be?",
        idleExperts: ["backend_developer", "frontend_developer"],
        allExperts: ["backend_developer", "frontend_developer"],
      });

      expect(result.targetExpert).toBe("backend_developer");
      expect(result.routingTier).toBe(3);
    });

    test("returns null when no idle experts available", () => {
      const result = routeQuestion({
        question: "Anyone free to help?",
        idleExperts: [],
        allExperts: ["backend_developer"],
      });

      expect(result.targetExpert).toBeNull();
      expect(result.routingTier).toBe(3);
    });
  });

  // ─── routeProvider (bonus — pure function, no DB needed) ───────────────────

  describe("routeProvider", () => {
    test("uses explicit routing when provided", () => {
      const result = routeProvider({
        persona: "qa_engineer",
        providerRouting: JSON.stringify({
          qa_engineer: { provider: "ollama", model: "qwen2.5-coder:32b" },
        }),
        availableProviders: ["anthropic", "ollama"],
      });

      expect(result.provider).toBe("ollama");
      expect(result.model).toBe("qwen2.5-coder:32b");
      expect(result.inferenceSource).toBe("routing");
    });

    test("infers provider from model name", () => {
      const result = routeProvider({
        persona: "backend_developer",
        modelName: "gpt-4o",
        availableProviders: ["anthropic", "openai"],
      });

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
      expect(result.inferenceSource).toBe("model_name");
    });

    test("defaults to anthropic when no routing or model", () => {
      const result = routeProvider({
        persona: "backend_developer",
        availableProviders: ["anthropic"],
      });

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-haiku-4-5");
      expect(result.inferenceSource).toBe("default");
    });
  });
});
