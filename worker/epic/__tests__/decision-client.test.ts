import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock axios at the module level — factory must not reference outer variables
vi.mock("axios", () => {
  const post = vi.fn();
  const get = vi.fn();
  return {
    default: { post, get },
    post,
    get,
  };
});

import axios from "axios";
import {
  DecisionClient,
  createDecisionClient,
  type ClassifyErrorResponse,
  type EvaluateQualityResponse,
  type RouteQuestionResponse,
  type ParseReviewOutcomeResponse,
} from "../decision-client.js";

// Get references to the mocked functions
const mockPost = vi.mocked(axios.post);
const mockGet = vi.mocked(axios.get);

function createClient(overrides?: { apiBaseUrl?: string; orgApiKey?: string }) {
  return new DecisionClient({
    apiBaseUrl: overrides?.apiBaseUrl ?? "http://localhost:3001",
    orgApiKey: overrides?.orgApiKey ?? "test-org-key",
    logger: () => {}, // suppress log output in tests
  });
}

describe("DecisionClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Factory
  // ==========================================================================

  describe("createDecisionClient", () => {
    it("creates a DecisionClient instance", () => {
      const client = createDecisionClient({
        apiBaseUrl: "http://localhost:3001",
        orgApiKey: "key",
      });
      expect(client).toBeInstanceOf(DecisionClient);
    });
  });

  // ==========================================================================
  // classifyError
  // ==========================================================================

  describe("classifyError", () => {
    it("sends error output and returns classification", async () => {
      const response: ClassifyErrorResponse = {
        category: "typescript",
        fixable: true,
        action: "auto_retry",
        affectedFiles: ["src/index.ts"],
        summary: "TypeScript compilation error",
        fixStrategy: "Fix the type mismatch",
      };
      mockPost.mockResolvedValueOnce({ data: response, status: 200 });

      const client = createClient();
      const result = await client.classifyError({
        errorOutput: "TS2322: Type 'string' is not assignable to type 'number'",
        persona: "backend_developer",
      });

      expect(result.category).toBe("typescript");
      expect(result.fixable).toBe(true);
      expect(result.action).toBe("auto_retry");
      expect(result.affectedFiles).toEqual(["src/index.ts"]);

      // Verify request was sent to correct endpoint
      expect(mockPost).toHaveBeenCalledWith(
        "http://localhost:3001/api/worker-decisions/classify-error",
        {
          errorOutput: "TS2322: Type 'string' is not assignable to type 'number'",
          persona: "backend_developer",
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-key": "test-org-key",
          }),
        }),
      );
    });

    it("returns safe fallback on API failure", async () => {
      mockPost.mockRejectedValue(new Error("Network error"));

      const client = createClient();
      const result = await client.classifyError({
        errorOutput: "Some unknown error",
      });

      // Should return fallback with escalate action
      expect(result.category).toBe("unknown");
      expect(result.fixable).toBe(false);
      expect(result.action).toBe("escalate");
    });

    it("detects transient network errors in fallback mode", async () => {
      mockPost.mockRejectedValue(new Error("Network error"));

      const client = createClient();
      const result = await client.classifyError({
        errorOutput: "ECONNREFUSED: connection refused to database",
      });

      // Local fallback should detect transient error
      expect(result.category).toBe("network");
    });
  });

  // ==========================================================================
  // evaluateQuality
  // ==========================================================================

  describe("evaluateQuality", () => {
    it("sends quality metrics and returns evaluation", async () => {
      const response: EvaluateQualityResponse = {
        pass: true,
        reasons: ["All tests pass", "No type errors"],
        blockers: [],
      };
      mockPost.mockResolvedValueOnce({ data: response, status: 200 });

      const client = createClient();
      const result = await client.evaluateQuality({
        metrics: { qualityScore: 90, typeErrors: false, testFailures: false },
        storyDescription: "Add user auth",
        persona: "backend_developer",
      });

      expect(result.pass).toBe(true);
      expect(result.reasons).toHaveLength(2);
      expect(result.blockers).toEqual([]);
    });

    it("returns failing result with blocker on API failure", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      const result = await client.evaluateQuality({
        metrics: { qualityScore: 80 },
      });

      expect(result.pass).toBe(false);
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toContain("Decision API unavailable");
    });
  });

  // ==========================================================================
  // routeQuestion
  // ==========================================================================

  describe("routeQuestion", () => {
    it("sends question and returns routing result", async () => {
      const response: RouteQuestionResponse = {
        targetExpert: "database_specialist",
        routingTier: 1,
        reason: "Question about SQL queries",
      };
      mockPost.mockResolvedValueOnce({ data: response, status: 200 });

      const client = createClient();
      const result = await client.routeQuestion({
        question: "How should we index the users table?",
        idleExperts: ["database_specialist", "backend_developer"],
        allExperts: ["database_specialist", "backend_developer", "frontend_developer"],
      });

      expect(result.targetExpert).toBe("database_specialist");
      expect(result.routingTier).toBe(1);
    });

    it("falls back to first idle expert on API failure", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      const result = await client.routeQuestion({
        question: "How to handle auth?",
        idleExperts: ["frontend_developer", "backend_developer"],
      });

      expect(result.targetExpert).toBe("frontend_developer");
      expect(result.routingTier).toBe(3);
      expect(result.reason).toContain("round-robin fallback");
    });

    it("returns null targetExpert when no idle experts on fallback", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      const result = await client.routeQuestion({
        question: "A question",
        idleExperts: [],
      });

      expect(result.targetExpert).toBeNull();
    });
  });

  // ==========================================================================
  // parseReviewOutcome
  // ==========================================================================

  describe("parseReviewOutcome", () => {
    it("sends review output and returns decision/feedback/score", async () => {
      const response: ParseReviewOutcomeResponse = {
        decision: "approved",
        score: 92,
        feedback: "Clean implementation with good test coverage",
        shouldRevise: false,
        revisionExhausted: false,
        reason: "Meets all acceptance criteria",
      };
      mockPost.mockResolvedValueOnce({ data: response, status: 200 });

      const client = createClient();
      const result = await client.parseReviewOutcome({
        reviewOutput: "LGTM! Great work on the auth module.",
        reviewerPersona: "tech_lead",
        storyIndex: 2,
        revisionNumber: 0,
      });

      expect(result.decision).toBe("approved");
      expect(result.score).toBe(92);
      expect(result.feedback).toContain("Clean implementation");
      expect(result.shouldRevise).toBe(false);
    });

    it("returns revision_needed with exhausted flag on API failure", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      const result = await client.parseReviewOutcome({
        reviewOutput: "Some review output",
      });

      expect(result.decision).toBe("revision_needed");
      expect(result.revisionExhausted).toBe(true);
      expect(result.shouldRevise).toBe(false);
      expect(result.score).toBeNull();
      expect(result.feedback).toContain("Decision API unavailable");
    });
  });

  // ==========================================================================
  // routeProvider
  // ==========================================================================

  describe("routeProvider", () => {
    it("returns provider routing from API", async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          inferenceSource: "routing",
        },
        status: 200,
      });

      const client = createClient();
      const result = await client.routeProvider({
        persona: "backend_developer",
        taskComplexity: "high",
      });

      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-6");
    });

    it("infers provider from model name on API failure", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      const result = await client.routeProvider({
        modelName: "gpt-4o",
      });

      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o");
      expect(result.inferenceSource).toBe("fallback");
    });

    it("throws when API fails and no model name provided", async () => {
      mockPost.mockRejectedValue(new Error("timeout"));

      const client = createClient();
      await expect(client.routeProvider({})).rejects.toThrow(
        "Decision API unavailable and no modelName provided",
      );
    });
  });

  // ==========================================================================
  // API URL construction
  // ==========================================================================

  describe("URL construction", () => {
    it("strips trailing slashes from base URL", async () => {
      mockPost.mockResolvedValueOnce({
        data: { category: "unknown", fixable: false, action: "escalate", affectedFiles: [], summary: "", fixStrategy: null },
        status: 200,
      });

      const client = createClient({ apiBaseUrl: "http://localhost:3001/" });
      await client.classifyError({ errorOutput: "test" });

      expect(mockPost).toHaveBeenCalledWith(
        "http://localhost:3001/api/worker-decisions/classify-error",
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  // ==========================================================================
  // Request payload verification
  // ==========================================================================

  describe("request payloads", () => {
    it("classifyError includes all optional fields", async () => {
      mockPost.mockResolvedValueOnce({
        data: { category: "test", fixable: false, action: "escalate", affectedFiles: [], summary: "", fixStrategy: null },
        status: 200,
      });

      const client = createClient();
      await client.classifyError({
        errorOutput: "test error",
        storyContext: "Adding auth",
        persona: "backend_developer",
        affectedFiles: ["src/auth.ts"],
        retryCount: 2,
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining("classify-error"),
        {
          errorOutput: "test error",
          storyContext: "Adding auth",
          persona: "backend_developer",
          affectedFiles: ["src/auth.ts"],
          retryCount: 2,
        },
        expect.any(Object),
      );
    });

    it("evaluateQuality sends structured metrics", async () => {
      mockPost.mockResolvedValueOnce({
        data: { pass: true, reasons: [], blockers: [] },
        status: 200,
      });

      const client = createClient();
      await client.evaluateQuality({
        metrics: {
          qualityScore: 88,
          typeErrors: false,
          testFailures: true,
          testCoveragePercent: 72,
          securityVulnsHigh: 0,
        },
        qualityGateEnabled: true,
        targetFiles: ["src/main.ts"],
      });

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining("evaluate-quality"),
        expect.objectContaining({
          metrics: expect.objectContaining({
            qualityScore: 88,
            testFailures: true,
            testCoveragePercent: 72,
          }),
          qualityGateEnabled: true,
          targetFiles: ["src/main.ts"],
        }),
        expect.any(Object),
      );
    });
  });
});
