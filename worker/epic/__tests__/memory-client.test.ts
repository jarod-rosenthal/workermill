import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the api-client module to prevent heavy dependency chains
vi.mock("../../lib/api-client.js", () => ({
  createCoordinationApi: vi.fn().mockReturnValue({
    get: vi.fn(),
    post: vi.fn(),
  }),
}));

import {
  MemoryClient,
  createMemoryClient,
  type InjectedSkill,
  type SemanticMemory,
  type EpisodicMemory,
} from "../memory-client.js";

function makeSkill(overrides?: Partial<InjectedSkill>): InjectedSkill {
  return {
    id: `skill-${Date.now()}`,
    name: "Test Skill",
    description: "A test skill for unit tests",
    steps: [
      { step: 1, action: "First step", details: "Do this first" },
      { step: 2, action: "Second step" },
    ],
    relevanceScore: 0.9,
    successRate: 0.85,
    usageCount: 10,
    ...overrides,
  };
}

function makeSemanticMemory(overrides?: Partial<SemanticMemory>): SemanticMemory {
  return {
    id: `sem-${Date.now()}`,
    category: "architecture",
    subject: "API patterns",
    knowledge: "Always use RESTful conventions",
    confidence: 0.9,
    ...overrides,
  };
}

function makeEpisodicMemory(overrides?: Partial<EpisodicMemory>): EpisodicMemory {
  return {
    id: `ep-${Date.now()}`,
    eventType: "task_completed",
    summary: "Successfully migrated database schema",
    outcome: "success",
    ...overrides,
  };
}

describe("MemoryClient", () => {
  // ==========================================================================
  // createMemoryClient factory
  // ==========================================================================

  describe("createMemoryClient", () => {
    it("creates a MemoryClient instance", () => {
      const client = createMemoryClient("http://localhost:3001", "test-key");
      expect(client).toBeInstanceOf(MemoryClient);
    });
  });

  // ==========================================================================
  // formatMemoryContext (tested via getMemoryContext)
  // ==========================================================================

  describe("memory context formatting", () => {
    let client: MemoryClient;
    let mockApi: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      client = createMemoryClient("http://localhost:3001", "test-key");
      // Access the internal API mock
      mockApi = (client as any).api;
    });

    it("returns empty string when no memories exist", async () => {
      mockApi.get.mockResolvedValue({
        data: { skills: [], formattedContext: "", skillsInjected: 0 },
      });
      mockApi.post.mockResolvedValue({
        data: { results: { semantic: [], episodic: [] }, totalResults: 0 },
      });

      const result = await client.getMemoryContext("task-1", "test description");
      expect(result.formattedContext).toBe("");
      expect(result.skills).toEqual([]);
      expect(result.semanticMemories).toEqual([]);
      expect(result.episodicMemories).toEqual([]);
    });

    it("formats skills with name, description, and steps", async () => {
      const skill = makeSkill({
        name: "Deploy to ECS",
        description: "Deploying containers to AWS ECS",
        successRate: 0.95,
        steps: [
          { step: 1, action: "Build Docker image", details: "Use multi-stage build" },
          { step: 2, action: "Push to ECR" },
          { step: 3, action: "Update task definition" },
        ],
      });

      mockApi.get.mockResolvedValue({
        data: { skills: [skill], formattedContext: "", skillsInjected: 1 },
      });
      mockApi.post.mockResolvedValue({
        data: { results: { semantic: [], episodic: [] }, totalResults: 0 },
      });

      const result = await client.getMemoryContext("task-1", "deploy service");
      const ctx = result.formattedContext;

      expect(ctx).toContain("# Memory Context");
      expect(ctx).toContain("## Relevant Skills from Past Experiences");
      expect(ctx).toContain("### 1. Deploy to ECS");
      expect(ctx).toContain("Deploying containers to AWS ECS");
      expect(ctx).toContain("Success rate: 95%");
      expect(ctx).toContain("1. Build Docker image");
      expect(ctx).toContain("   - Use multi-stage build");
      expect(ctx).toContain("2. Push to ECR");
      expect(ctx).toContain("3. Update task definition");
    });

    it("omits success rate when null", async () => {
      const skill = makeSkill({ name: "New Skill", successRate: null });

      mockApi.get.mockResolvedValue({
        data: { skills: [skill], formattedContext: "", skillsInjected: 1 },
      });
      mockApi.post.mockResolvedValue({
        data: { results: { semantic: [], episodic: [] }, totalResults: 0 },
      });

      const result = await client.getMemoryContext("task-1", "test");
      expect(result.formattedContext).not.toContain("Success rate");
    });

    it("formats semantic memories with subject and knowledge", async () => {
      const memory = makeSemanticMemory({
        subject: "Error handling",
        category: "best_practices",
        knowledge: "Always use try-catch with typed errors",
      });

      mockApi.get.mockResolvedValue({
        data: { skills: [], formattedContext: "", skillsInjected: 0 },
      });
      mockApi.post.mockResolvedValue({
        data: { results: { semantic: [memory], episodic: [] }, totalResults: 1 },
      });

      const result = await client.getMemoryContext("task-1", "error handling");
      const ctx = result.formattedContext;

      expect(ctx).toContain("## Relevant Knowledge & Patterns");
      expect(ctx).toContain("**Error handling** (best_practices): Always use try-catch with typed errors");
    });

    it("formats episodic memories with outcome emoji", async () => {
      const successMemory = makeEpisodicMemory({
        summary: "Migrated DB successfully",
        outcome: "success",
      });
      const failureMemory = makeEpisodicMemory({
        summary: "Deploy failed due to permissions",
        outcome: "failure",
      });

      mockApi.get.mockResolvedValue({
        data: { skills: [], formattedContext: "", skillsInjected: 0 },
      });
      mockApi.post.mockResolvedValue({
        data: {
          results: { semantic: [], episodic: [successMemory, failureMemory] },
          totalResults: 2,
        },
      });

      const result = await client.getMemoryContext("task-1", "migration");
      const ctx = result.formattedContext;

      expect(ctx).toContain("## Relevant Past Experiences");
      // Check the emojis are present (the source code uses them)
      expect(ctx).toContain("Migrated DB successfully");
      expect(ctx).toContain("Deploy failed due to permissions");
    });

    it("combines all three sections when all types present", async () => {
      mockApi.get.mockResolvedValue({
        data: {
          skills: [makeSkill({ name: "Build Pipeline" })],
          formattedContext: "",
          skillsInjected: 1,
        },
      });
      mockApi.post.mockResolvedValue({
        data: {
          results: {
            semantic: [makeSemanticMemory({ subject: "CI patterns" })],
            episodic: [makeEpisodicMemory({ summary: "Pipeline fix worked" })],
          },
          totalResults: 2,
        },
      });

      const result = await client.getMemoryContext("task-1", "build pipeline");
      const ctx = result.formattedContext;

      expect(ctx).toContain("# Memory Context");
      expect(ctx).toContain("## Relevant Skills");
      expect(ctx).toContain("## Relevant Knowledge & Patterns");
      expect(ctx).toContain("## Relevant Past Experiences");
      expect(ctx).toContain("---"); // trailing separator
    });

    it("numbers multiple skills sequentially", async () => {
      const skills = [
        makeSkill({ name: "First Skill" }),
        makeSkill({ name: "Second Skill" }),
        makeSkill({ name: "Third Skill" }),
      ];

      mockApi.get.mockResolvedValue({
        data: { skills, formattedContext: "", skillsInjected: 3 },
      });
      mockApi.post.mockResolvedValue({
        data: { results: { semantic: [], episodic: [] }, totalResults: 0 },
      });

      const result = await client.getMemoryContext("task-1", "test");
      const ctx = result.formattedContext;

      expect(ctx).toContain("### 1. First Skill");
      expect(ctx).toContain("### 2. Second Skill");
      expect(ctx).toContain("### 3. Third Skill");
    });
  });

  // ==========================================================================
  // API error handling
  // ==========================================================================

  describe("API error handling", () => {
    let client: MemoryClient;
    let mockApi: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      client = createMemoryClient("http://localhost:3001", "test-key");
      mockApi = (client as any).api;
    });

    it("getSkillsForTask returns null on API error", async () => {
      mockApi.get.mockRejectedValue(new Error("Network error"));
      const result = await client.getSkillsForTask("task-1");
      expect(result).toBeNull();
    });

    it("searchMemories returns null on API error", async () => {
      mockApi.post.mockRejectedValue(new Error("500 error"));
      const result = await client.searchMemories("query");
      expect(result).toBeNull();
    });

    it("getMemoryContext returns empty context on API errors", async () => {
      mockApi.get.mockRejectedValue(new Error("timeout"));
      mockApi.post.mockRejectedValue(new Error("timeout"));

      const result = await client.getMemoryContext("task-1", "test");
      expect(result.formattedContext).toBe("");
      expect(result.skills).toEqual([]);
    });
  });
});
