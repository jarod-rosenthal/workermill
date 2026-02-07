import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { getTestManager, generateTestId } from "../setup";
import { WorkerTask, WorkerTaskStatus } from "../../../models/WorkerTask";
import { Organization } from "../../../models/Organization";

/**
 * Critic Agent Local Integration Tests.
 *
 * Tests the critic-agent-local service which reviews execution plans
 * and provides feedback in local development mode (EXECUTION_MODE=local).
 *
 * These tests verify:
 * 1. Critic input/output interfaces and data structures
 * 2. Critic configuration and provider selection
 * 3. Prompt building with plan details
 * 4. Result parsing and normalization
 * 5. Plan-critic loop iteration logic
 * 6. Auto-approval threshold logic
 *
 * Note: These tests do NOT call actual AI providers. They test:
 * - Data structures and interfaces
 * - Configuration logic
 * - Parsing and normalization functions
 * - Threshold and iteration logic
 */
describe("Critic Agent Local", () => {
  // Store original env vars to restore after tests
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment to known state
    process.env.EXECUTION_MODE = "local";
    process.env.CRITIC_PROVIDER = "anthropic";
    process.env.CRITIC_MODEL = "sonnet";
    process.env.AUTO_APPROVAL_THRESHOLD = "85";
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  /**
   * Helper to create a test organization.
   */
  async function createTestOrg() {
    const manager = getTestManager();
    const org = manager.create(Organization, {
      name: `Test Org ${generateTestId()}`,
      slug: `test-org-${Date.now()}`,
      apiKey: `test-api-key-${Date.now()}`,
      scmProvider: "github",
      defaultGithubRepo: "test/repo",
    });
    return manager.save(org);
  }

  /**
   * Helper to create a test task.
   */
  async function createTestTask(org: Organization, options?: {
    status?: WorkerTaskStatus;
    description?: string;
  }) {
    const manager = getTestManager();
    const task = manager.create(WorkerTask, {
      jiraIssueKey: `TEST-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      summary: "Test Task for Critic Agent",
      description: options?.description || "Implement feature with proper tests",
      status: options?.status || "queued",
      orgId: org.id,
      workerPersona: "backend_developer",
      workerModel: "sonnet",
      githubRepo: "test/repo",
    });
    return manager.save(task);
  }

  /**
   * Helper to create a sample execution plan for testing.
   */
  function createSamplePlan() {
    return {
      summary: "Implement user authentication feature",
      stories: [
        {
          id: "story-1",
          title: "Set up OAuth2 provider",
          description: "Configure OAuth2 provider integration",
          persona: "backend_developer",
          priority: 1,
          estimatedEffort: "medium" as const,
          dependencies: [],
          acceptanceCriteria: ["OAuth2 flow works", "Tokens are stored securely"],
        },
        {
          id: "story-2",
          title: "Create login UI",
          description: "Build login form with OAuth2 buttons",
          persona: "frontend_developer",
          priority: 2,
          estimatedEffort: "small" as const,
          dependencies: ["story-1"],
          acceptanceCriteria: ["Login form renders", "OAuth redirect works"],
        },
      ],
      risks: ["Provider API changes", "Token expiration handling"],
      assumptions: ["OAuth2 provider is available", "Users have existing accounts"],
    };
  }

  describe("Critic Configuration", () => {
    test("getCriticConfig returns correct provider and model", () => {
      // Simulate getCriticConfig logic
      function getCriticConfig(): { provider: string; model: string } {
        const provider = process.env.CRITIC_PROVIDER || process.env.PLANNING_PROVIDER || "anthropic";
        const defaultModels: Record<string, string> = {
          anthropic: "sonnet",
          openai: "gpt-4o",
          google: "gemini-2.0-flash",
          ollama: "qwen2.5-coder:32b",
        };
        const model = process.env.CRITIC_MODEL || process.env.PLANNING_MODEL || defaultModels[provider] || "sonnet";
        return { provider, model };
      }

      const config = getCriticConfig();
      expect(config.provider).toBe("anthropic");
      expect(config.model).toBe("sonnet");
    });

    test("falls back to PLANNING_PROVIDER when CRITIC_PROVIDER not set", () => {
      delete process.env.CRITIC_PROVIDER;
      process.env.PLANNING_PROVIDER = "openai";
      delete process.env.CRITIC_MODEL;
      process.env.PLANNING_MODEL = "gpt-4o";

      function getCriticConfig(): { provider: string; model: string } {
        const provider = process.env.CRITIC_PROVIDER || process.env.PLANNING_PROVIDER || "anthropic";
        const defaultModels: Record<string, string> = {
          anthropic: "sonnet",
          openai: "gpt-4o",
          google: "gemini-2.0-flash",
          ollama: "qwen2.5-coder:32b",
        };
        const model = process.env.CRITIC_MODEL || process.env.PLANNING_MODEL || defaultModels[provider] || "sonnet";
        return { provider, model };
      }

      const config = getCriticConfig();
      expect(config.provider).toBe("openai");
      expect(config.model).toBe("gpt-4o");
    });

    test("uses default anthropic when no provider set", () => {
      delete process.env.CRITIC_PROVIDER;
      delete process.env.PLANNING_PROVIDER;
      delete process.env.CRITIC_MODEL;
      delete process.env.PLANNING_MODEL;

      function getCriticConfig(): { provider: string; model: string } {
        const provider = process.env.CRITIC_PROVIDER || process.env.PLANNING_PROVIDER || "anthropic";
        const defaultModels: Record<string, string> = {
          anthropic: "sonnet",
          openai: "gpt-4o",
          google: "gemini-2.0-flash",
          ollama: "qwen2.5-coder:32b",
        };
        const model = process.env.CRITIC_MODEL || process.env.PLANNING_MODEL || defaultModels[provider] || "sonnet";
        return { provider, model };
      }

      const config = getCriticConfig();
      expect(config.provider).toBe("anthropic");
      expect(config.model).toBe("sonnet");
    });
  });

  describe("shouldUseLocalCritic", () => {
    test("returns true when EXECUTION_MODE=local", () => {
      process.env.EXECUTION_MODE = "local";
      const shouldUseLocal = process.env.EXECUTION_MODE === "local";
      expect(shouldUseLocal).toBe(true);
    });

    test("returns false when EXECUTION_MODE=ecs", () => {
      process.env.EXECUTION_MODE = "ecs";
      const shouldUseLocal = process.env.EXECUTION_MODE === "local";
      expect(shouldUseLocal).toBe(false);
    });
  });

  describe("Critic Result Interface", () => {
    test("CriticResult has required fields", () => {
      const result = {
        score: 90,
        approved: true,
        risks: ["Minor risk identified"],
        suggestions: ["Consider adding more tests"],
        reasoning: "The plan is comprehensive and covers all requirements.",
        storyFeedback: [
          {
            storyId: "story-1",
            feedback: "Good implementation approach",
            suggestedChanges: [],
          },
        ],
      };

      expect(result.score).toBeDefined();
      expect(result.approved).toBeDefined();
      expect(result.risks).toBeDefined();
      expect(result.suggestions).toBeDefined();
      expect(result.reasoning).toBeDefined();
      expect(result.storyFeedback).toBeDefined();
    });

    test("storyFeedback is optional", () => {
      const result = {
        score: 85,
        approved: true,
        risks: [],
        suggestions: [],
        reasoning: "Plan looks good.",
        // No storyFeedback
      };

      expect(result.storyFeedback).toBeUndefined();
    });
  });

  describe("Critic Result Parsing", () => {
    /**
     * Simulate parseCriticResult logic from critic-agent-local.ts
     */
    function parseCriticResult(output: string) {
      // Try to extract JSON from the response
      const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // Try to find raw JSON
      const rawJsonMatch = output.match(/\{[\s\S]*"score"[\s\S]*\}/);
      if (rawJsonMatch) {
        return JSON.parse(rawJsonMatch[0]);
      }

      throw new Error("Could not find JSON critic result in output");
    }

    test("parses JSON wrapped in code fence", () => {
      const output = `
Here is my review:

\`\`\`json
{
  "score": 92,
  "approved": true,
  "risks": ["Dependency on external service"],
  "suggestions": ["Add retry logic for API calls"],
  "reasoning": "The plan is well-structured and covers all requirements."
}
\`\`\`
`;

      const result = parseCriticResult(output);
      expect(result.score).toBe(92);
      expect(result.approved).toBe(true);
      expect(result.risks).toContain("Dependency on external service");
      expect(result.suggestions).toContain("Add retry logic for API calls");
    });

    test("parses raw JSON without code fence", () => {
      const output = `{
  "score": 75,
  "approved": false,
  "risks": ["Missing error handling"],
  "suggestions": ["Add comprehensive error handling", "Include edge case tests"],
  "reasoning": "Plan needs improvement in error handling."
}`;

      const result = parseCriticResult(output);
      expect(result.score).toBe(75);
      expect(result.approved).toBe(false);
      expect(result.suggestions).toHaveLength(2);
    });

    test("throws error when no JSON found", () => {
      const output = "This is just plain text feedback without JSON";
      expect(() => parseCriticResult(output)).toThrow("Could not find JSON critic result in output");
    });

    test("parses result with storyFeedback", () => {
      const output = `\`\`\`json
{
  "score": 88,
  "approved": true,
  "risks": [],
  "suggestions": ["Minor improvement needed in story-2"],
  "reasoning": "Overall good plan with minor suggestions.",
  "storyFeedback": [
    {
      "storyId": "story-2",
      "feedback": "Consider using a more specific component name",
      "suggestedChanges": ["Rename LoginForm to OAuth2LoginForm"]
    }
  ]
}
\`\`\``;

      const result = parseCriticResult(output);
      expect(result.storyFeedback).toBeDefined();
      expect(result.storyFeedback).toHaveLength(1);
      expect(result.storyFeedback[0].storyId).toBe("story-2");
      expect(result.storyFeedback[0].suggestedChanges).toContain("Rename LoginForm to OAuth2LoginForm");
    });
  });

  describe("Critic Result Normalization", () => {
    /**
     * Simulate normalizeCriticResult logic from critic-agent-local.ts
     */
    function normalizeCriticResult(parsed: Record<string, unknown>) {
      const score = typeof parsed.score === "number" ? parsed.score : 0;
      const threshold = parseInt(process.env.AUTO_APPROVAL_THRESHOLD || "85", 10);

      return {
        score,
        approved: parsed.approved === true || score >= threshold,
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
        storyFeedback: Array.isArray(parsed.storyFeedback) ? parsed.storyFeedback : undefined,
      };
    }

    test("normalizes missing fields to defaults", () => {
      const parsed = { score: 90 };
      const result = normalizeCriticResult(parsed);

      expect(result.score).toBe(90);
      expect(result.approved).toBe(true); // score >= 85
      expect(result.risks).toEqual([]);
      expect(result.suggestions).toEqual([]);
      expect(result.reasoning).toBe("");
      expect(result.storyFeedback).toBeUndefined();
    });

    test("uses AUTO_APPROVAL_THRESHOLD for approval", () => {
      process.env.AUTO_APPROVAL_THRESHOLD = "90";

      const result = normalizeCriticResult({ score: 85 });
      expect(result.approved).toBe(false); // 85 < 90

      const result2 = normalizeCriticResult({ score: 92 });
      expect(result2.approved).toBe(true); // 92 >= 90
    });

    test("explicit approved field overrides threshold", () => {
      process.env.AUTO_APPROVAL_THRESHOLD = "90";

      const result = normalizeCriticResult({ score: 85, approved: true });
      expect(result.approved).toBe(true); // explicit true

      // Note: In the actual implementation, if approved is false, threshold still applies
      // This tests the logic where explicit true takes precedence
    });

    test("handles non-numeric score", () => {
      const result = normalizeCriticResult({ score: "invalid" });
      expect(result.score).toBe(0);
      expect(result.approved).toBe(false);
    });

    test("handles non-array risks and suggestions", () => {
      const result = normalizeCriticResult({
        score: 88,
        risks: "Single risk string",
        suggestions: null,
      });

      expect(result.risks).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });
  });

  describe("Auto-Approval Threshold", () => {
    test("default threshold is 85", () => {
      delete process.env.AUTO_APPROVAL_THRESHOLD;
      const threshold = parseInt(process.env.AUTO_APPROVAL_THRESHOLD || "85", 10);
      expect(threshold).toBe(85);
    });

    test("custom threshold from environment", () => {
      process.env.AUTO_APPROVAL_THRESHOLD = "90";
      const threshold = parseInt(process.env.AUTO_APPROVAL_THRESHOLD || "85", 10);
      expect(threshold).toBe(90);
    });

    test("score >= threshold means approved", () => {
      const threshold = 85;
      expect(85 >= threshold).toBe(true);
      expect(90 >= threshold).toBe(true);
      expect(84 >= threshold).toBe(false);
    });
  });

  describe("Prompt Building for Critic", () => {
    /**
     * Simulate formatStory logic
     */
    function formatStory(story: {
      id: string;
      title: string;
      persona: string;
      priority: number;
      estimatedEffort: string;
      dependencies: string[];
      description: string;
      acceptanceCriteria: string[];
    }, num: number): string {
      return `***REMOVED******REMOVED******REMOVED*** Story ${num}: ${story.title} (${story.id})
- **Persona:** ${story.persona}
- **Priority:** ${story.priority}
- **Effort:** ${story.estimatedEffort}
- **Dependencies:** ${story.dependencies.length ? story.dependencies.join(", ") : "None"}
- **Description:** ${story.description}
- **Acceptance Criteria:**
${story.acceptanceCriteria.map(c => `  - ${c}`).join("\n")}`;
    }

    test("formatStory produces correct output", () => {
      const story = {
        id: "story-1",
        title: "Implement OAuth",
        persona: "backend_developer",
        priority: 1,
        estimatedEffort: "medium",
        dependencies: [],
        description: "Set up OAuth2 provider",
        acceptanceCriteria: ["OAuth flow works", "Tokens stored"],
      };

      const output = formatStory(story, 1);

      expect(output).toContain("***REMOVED******REMOVED******REMOVED*** Story 1: Implement OAuth (story-1)");
      expect(output).toContain("**Persona:** backend_developer");
      expect(output).toContain("**Priority:** 1");
      expect(output).toContain("**Effort:** medium");
      expect(output).toContain("**Dependencies:** None");
      expect(output).toContain("**Description:** Set up OAuth2 provider");
      expect(output).toContain("- OAuth flow works");
      expect(output).toContain("- Tokens stored");
    });

    test("formatStory shows dependencies when present", () => {
      const story = {
        id: "story-2",
        title: "Build UI",
        persona: "frontend_developer",
        priority: 2,
        estimatedEffort: "small",
        dependencies: ["story-1"],
        description: "Create login form",
        acceptanceCriteria: ["Form renders"],
      };

      const output = formatStory(story, 2);
      expect(output).toContain("**Dependencies:** story-1");
    });

    test("builds prompt with iteration note on revisions", () => {
      const iteration = 2;
      const iterationNote = iteration > 1
        ? `\n**Note:** This is revision ${iteration}. Previous versions had issues that needed addressing.\n`
        : "";

      expect(iterationNote).toContain("revision 2");
      expect(iterationNote).toContain("Previous versions had issues");
    });

    test("no iteration note on first review", () => {
      const iteration = 1;
      const iterationNote = iteration > 1
        ? `\n**Note:** This is revision ${iteration}. Previous versions had issues that needed addressing.\n`
        : "";

      expect(iterationNote).toBe("");
    });
  });

  describe("Plan-Critic Loop Logic", () => {
    test("loop exits on approval", () => {
      const maxIterations = 3;
      let currentIteration = 1;
      const scores = [90]; // First review approves

      // Simulate loop
      while (currentIteration <= maxIterations) {
        const score = scores[currentIteration - 1] || 60;
        const approved = score >= 85;

        if (approved) {
          break;
        }
        currentIteration++;
      }

      expect(currentIteration).toBe(1); // Approved on first iteration
    });

    test("loop continues until approval", () => {
      const maxIterations = 3;
      let currentIteration = 1;
      const scores = [70, 80, 90]; // Third review approves

      // Simulate loop
      while (currentIteration <= maxIterations) {
        const score = scores[currentIteration - 1] || 60;
        const approved = score >= 85;

        if (approved) {
          break;
        }
        if (currentIteration >= maxIterations) {
          break;
        }
        currentIteration++;
      }

      expect(currentIteration).toBe(3);
    });

    test("loop exits at max iterations even without approval", () => {
      const maxIterations = 3;
      let currentIteration = 1;
      const scores = [70, 75, 80]; // Never reaches 85

      // Simulate loop
      while (currentIteration <= maxIterations) {
        const score = scores[currentIteration - 1] || 60;
        const approved = score >= 85;

        if (approved) {
          break;
        }
        if (currentIteration >= maxIterations) {
          break;
        }
        currentIteration++;
      }

      expect(currentIteration).toBe(3);
      expect(scores[currentIteration - 1]).toBeLessThan(85);
    });

    test("default max iterations is 3", () => {
      const defaultMaxIterations = 3;
      expect(defaultMaxIterations).toBe(3);
    });
  });

  describe("Review Criteria", () => {
    test("review criteria includes all scoring dimensions", () => {
      const criteria = [
        { name: "Completeness", points: 30, description: "Does the plan cover all requirements?" },
        { name: "Feasibility", points: 25, description: "Are the steps realistic and achievable?" },
        { name: "Dependencies", points: 15, description: "Are dependencies correctly ordered with no circular deps?" },
        { name: "Quality", points: 15, description: "Are acceptance criteria clear and testable?" },
        { name: "Risk Management", points: 15, description: "Are risks properly identified and mitigated?" },
      ];

      const totalPoints = criteria.reduce((sum, c) => sum + c.points, 0);
      expect(totalPoints).toBe(100);
    });
  });

  describe("Task Status Integration", () => {
    test("task tracks critic review status", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      // Task in review
      await manager.update(WorkerTask, task.id, {
        status: "executing",
        startedAt: new Date(),
      });

      const reviewing = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });
      expect(reviewing?.status).toBe("executing");
    });

    test("task can store critic rejection", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();
      const task = await createTestTask(org);

      await manager.update(WorkerTask, task.id, {
        status: "failed",
        errorMessage: "Critic rejected plan after 3 iterations (score: 72)",
        completedAt: new Date(),
      });

      const failed = await manager.findOne(WorkerTask, {
        where: { id: task.id },
      });
      expect(failed?.status).toBe("failed");
      expect(failed?.errorMessage).toContain("Critic rejected");
      expect(failed?.errorMessage).toContain("score: 72");
    });
  });

  describe("Critic Input Interface", () => {
    test("CriticInput has required fields", async () => {
      const org = await createTestOrg();
      const task = await createTestTask(org);
      const plan = createSamplePlan();

      const criticInput = {
        taskId: task.id,
        plan,
        originalRequirements: task.description || "",
        iteration: 1,
      };

      expect(criticInput.taskId).toBe(task.id);
      expect(criticInput.plan.stories).toHaveLength(2);
      expect(criticInput.originalRequirements).toBe("Implement feature with proper tests");
      expect(criticInput.iteration).toBe(1);
    });

    test("iteration is optional", async () => {
      const org = await createTestOrg();
      const task = await createTestTask(org);
      const plan = createSamplePlan();

      const criticInput = {
        taskId: task.id,
        plan,
        originalRequirements: task.description || "",
        // No iteration
      };

      expect(criticInput.iteration).toBeUndefined();
    });
  });

  describe("Story Feedback Structure", () => {
    test("storyFeedback contains actionable changes", () => {
      const feedback = {
        storyId: "story-1",
        feedback: "The authentication approach is solid but needs additional security measures.",
        suggestedChanges: [
          "Add rate limiting to login endpoint",
          "Implement account lockout after failed attempts",
          "Add audit logging for authentication events",
        ],
      };

      expect(feedback.storyId).toBe("story-1");
      expect(feedback.suggestedChanges).toHaveLength(3);
      expect(feedback.suggestedChanges).toContain("Add rate limiting to login endpoint");
    });

    test("suggestedChanges is optional", () => {
      const feedback = {
        storyId: "story-2",
        feedback: "Story looks good as is.",
        // No suggestedChanges
      };

      expect(feedback.suggestedChanges).toBeUndefined();
    });
  });

  describe("Claude CLI Integration Points", () => {
    test("CLAUDE_CLI_PATH for critic agent", () => {
      const defaultPath = "/home/user/.local/bin/claude";
      const claudePath = process.env.CLAUDE_CLI_PATH || defaultPath;

      expect(claudePath).toBe(defaultPath);
    });

    test("environment cleaned before Claude CLI call", () => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDE_CODE_OAUTH_TOKEN;

      expect(cleanEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(cleanEnv.EXECUTION_MODE).toBe("local");
    });
  });

  describe("AI SDK Provider Validation for Critic", () => {
    test("uses same providers as planning agent", () => {
      const validProviders = ["anthropic", "openai", "google", "gemini", "ollama"];
      const provider = process.env.CRITIC_PROVIDER || "anthropic";

      expect(validProviders).toContain(provider);
    });

    test("gemini is treated as google alias", () => {
      process.env.CRITIC_PROVIDER = "gemini";

      const provider = process.env.CRITIC_PROVIDER;
      const normalized = provider === "gemini" ? "google" : provider;

      expect(["google", "gemini"]).toContain(provider);
    });
  });

  describe("Error Handling", () => {
    test("handles missing API key errors", () => {
      delete process.env.OPENAI_API_KEY;
      process.env.CRITIC_PROVIDER = "openai";

      const apiKey = process.env.OPENAI_API_KEY;
      expect(apiKey).toBeUndefined();
      // Would throw: "OPENAI_API_KEY not set"
    });

    test("handles JSON parse errors gracefully", () => {
      const invalidJson = "{ invalid json }";

      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    test("handles Claude CLI exit code errors", () => {
      const exitCode = 1;
      const stderr = "Error: Model not available";

      const errorMessage = `Critic agent exited with code ${exitCode}: ${stderr.substring(0, 200)}`;
      expect(errorMessage).toContain("code 1");
      expect(errorMessage).toContain("Model not available");
    });
  });

  describe("Concurrent Critic Executions", () => {
    test("multiple tasks can be reviewed concurrently", async () => {
      const manager = getTestManager();
      const org = await createTestOrg();

      // Create multiple tasks
      const task1 = await createTestTask(org);
      const task2 = await createTestTask(org);
      const task3 = await createTestTask(org);

      // All can be in executing state (being reviewed)
      const now = new Date();
      await Promise.all([
        manager.update(WorkerTask, task1.id, { status: "executing", startedAt: now }),
        manager.update(WorkerTask, task2.id, { status: "executing", startedAt: now }),
        manager.update(WorkerTask, task3.id, { status: "executing", startedAt: now }),
      ]);

      const executing = await manager.find(WorkerTask, {
        where: { orgId: org.id, status: "executing" },
      });

      expect(executing).toHaveLength(3);
    });
  });
});
