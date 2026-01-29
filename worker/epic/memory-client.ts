/**
 * Memory Client for Epic Coordinator
 *
 * Retrieves relevant memories and skills from the WorkerMill API
 * to inject into expert context during task execution.
 * Part of REQ-19: Memory Retrieval in Epic Coordinator.
 */

import axios, { type AxiosInstance } from "axios";

/**
 * Skill formatted for injection into worker context
 */
export interface InjectedSkill {
  name: string;
  description: string;
  steps: Array<{
    step: number;
    action: string;
    details?: string;
    example?: string;
  }>;
  prerequisites?: {
    filesMustExist?: string[];
    dependencies?: string[];
    technologies?: string[];
  };
  relevanceScore: number;
  successRate: number | null;
  usageCount: number;
}

/**
 * Result of skill injection
 */
export interface SkillInjectionResult {
  taskId?: string;
  taskTitle?: string;
  skillsInjected: number;
  skills: InjectedSkill[];
  formattedContext: string;
  retrievedAt: string;
}

/**
 * Semantic memory entry
 */
export interface SemanticMemory {
  id: string;
  category: string;
  subject: string;
  knowledge: string;
  confidence: number;
  similarity?: number;
}

/**
 * Episodic memory entry
 */
export interface EpisodicMemory {
  id: string;
  eventType: string;
  summary: string;
  outcome: string;
  similarity?: number;
}

/**
 * Search results from memory API
 */
export interface MemorySearchResult {
  query: string;
  repository?: string;
  results: {
    semantic: SemanticMemory[];
    episodic: EpisodicMemory[];
    procedural: InjectedSkill[];
  };
  totalResults: number;
}

/**
 * Combined memory context for task execution
 */
export interface MemoryContext {
  skills: InjectedSkill[];
  semanticMemories: SemanticMemory[];
  episodicMemories: EpisodicMemory[];
  formattedContext: string;
  retrievedAt: Date;
}

/**
 * Memory Client for retrieving context from WorkerMill API
 */
export class MemoryClient {
  private api: AxiosInstance;
  private orgApiKey: string;

  constructor(apiBaseUrl: string, orgApiKey: string) {
    this.orgApiKey = orgApiKey;
    this.api = axios.create({
      baseURL: apiBaseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": orgApiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * Get skills to inject for a specific task
   */
  async getSkillsForTask(
    taskId: string,
    options: { limit?: number; minRelevance?: number } = {}
  ): Promise<SkillInjectionResult | null> {
    const { limit = 5, minRelevance = 0.5 } = options;

    try {
      const response = await this.api.get<SkillInjectionResult>(
        `/api/memory/skills/inject/${taskId}`,
        {
          params: { limit, minRelevance },
        }
      );
      return response.data;
    } catch (error) {
      console.log("[Memory] Failed to get skills for task:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Get skills based on task description
   */
  async getSkillsForDescription(
    description: string,
    options: {
      repository?: string;
      taskType?: string;
      limit?: number;
      minRelevance?: number;
    } = {}
  ): Promise<SkillInjectionResult | null> {
    try {
      const response = await this.api.post<SkillInjectionResult>(
        "/api/memory/skills/inject",
        {
          description,
          repository: options.repository,
          taskType: options.taskType,
          limit: options.limit || 5,
          minRelevance: options.minRelevance || 0.5,
        }
      );
      return response.data;
    } catch (error) {
      console.log("[Memory] Failed to get skills for description:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Get skills for a specific persona
   */
  async getSkillsForPersona(
    persona: string,
    options: {
      taskType?: string;
      repository?: string;
      limit?: number;
    } = {}
  ): Promise<SkillInjectionResult | null> {
    try {
      const response = await this.api.get<SkillInjectionResult>(
        `/api/memory/skills/inject/persona/${persona}`,
        {
          params: {
            taskType: options.taskType,
            repository: options.repository,
            limit: options.limit || 5,
          },
        }
      );
      return response.data;
    } catch (error) {
      console.log("[Memory] Failed to get skills for persona:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Search memories by query
   */
  async searchMemories(
    query: string,
    options: {
      repository?: string;
      memoryTypes?: ("semantic" | "episodic" | "procedural")[];
      limit?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<MemorySearchResult | null> {
    try {
      const response = await this.api.post<MemorySearchResult>(
        "/api/memory/search",
        {
          query,
          repository: options.repository,
          memoryTypes: options.memoryTypes || ["semantic", "episodic", "procedural"],
          limit: options.limit || 10,
          minSimilarity: options.minSimilarity || 0.5,
        }
      );
      return response.data;
    } catch (error) {
      console.log("[Memory] Failed to search memories:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * Record skill usage outcome
   */
  async recordSkillUsage(
    skillId: string,
    outcome: "success" | "failure",
    taskId?: string
  ): Promise<void> {
    try {
      await this.api.post("/api/memory/skills/usage", {
        skillId,
        outcome,
        taskId,
      });
      console.log(`[Memory] Recorded skill ${skillId} usage: ${outcome}`);
    } catch (error) {
      console.log("[Memory] Failed to record skill usage:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * Get full memory context for a task
   * Combines skills, semantic memories, and episodic memories
   */
  async getMemoryContext(
    taskId: string,
    taskDescription: string,
    options: {
      repository?: string;
      persona?: string;
      limit?: number;
    } = {}
  ): Promise<MemoryContext> {
    const { repository, persona, limit = 5 } = options;

    // Parallel fetch of different memory types
    const [skillsResult, searchResult] = await Promise.all([
      // Get skills for the task
      this.getSkillsForTask(taskId, { limit }),
      // Search for relevant memories based on description
      this.searchMemories(taskDescription, {
        repository,
        limit,
        memoryTypes: ["semantic", "episodic"],
      }),
    ]);

    // Build formatted context
    const skills = skillsResult?.skills || [];
    const semanticMemories = (searchResult?.results?.semantic || []) as SemanticMemory[];
    const episodicMemories = (searchResult?.results?.episodic || []) as EpisodicMemory[];

    const formattedContext = this.formatMemoryContext(skills, semanticMemories, episodicMemories);

    return {
      skills,
      semanticMemories,
      episodicMemories,
      formattedContext,
      retrievedAt: new Date(),
    };
  }

  /**
   * Format memory context as markdown for injection into prompts
   */
  private formatMemoryContext(
    skills: InjectedSkill[],
    semanticMemories: SemanticMemory[],
    episodicMemories: EpisodicMemory[]
  ): string {
    if (skills.length === 0 && semanticMemories.length === 0 && episodicMemories.length === 0) {
      return "";
    }

    const sections: string[] = [];

    // Skills section
    if (skills.length > 0) {
      const skillLines: string[] = [
        "***REMOVED******REMOVED*** Relevant Skills from Past Experiences",
        "",
        "The following procedures have been identified as potentially helpful:",
        "",
      ];

      for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        skillLines.push(`***REMOVED******REMOVED******REMOVED*** ${i + 1}. ${skill.name}`);
        skillLines.push("");
        skillLines.push(skill.description);
        skillLines.push("");

        if (skill.successRate !== null) {
          skillLines.push(`*Success rate: ${Math.round(skill.successRate * 100)}%*`);
          skillLines.push("");
        }

        skillLines.push("**Steps:**");
        for (const step of skill.steps) {
          skillLines.push(`${step.step}. ${step.action}`);
          if (step.details) {
            skillLines.push(`   - ${step.details}`);
          }
        }
        skillLines.push("");
      }

      sections.push(skillLines.join("\n"));
    }

    // Semantic memories section (knowledge/patterns)
    if (semanticMemories.length > 0) {
      const semanticLines: string[] = [
        "***REMOVED******REMOVED*** Relevant Knowledge & Patterns",
        "",
      ];

      for (const memory of semanticMemories) {
        semanticLines.push(`- **${memory.subject}** (${memory.category}): ${memory.knowledge}`);
      }
      semanticLines.push("");

      sections.push(semanticLines.join("\n"));
    }

    // Episodic memories section (past experiences)
    if (episodicMemories.length > 0) {
      const episodicLines: string[] = [
        "***REMOVED******REMOVED*** Relevant Past Experiences",
        "",
      ];

      for (const memory of episodicMemories) {
        const outcomeEmoji = memory.outcome === "success" ? "✅" : memory.outcome === "failure" ? "❌" : "⚠️";
        episodicLines.push(`- ${outcomeEmoji} ${memory.summary}`);
      }
      episodicLines.push("");

      sections.push(episodicLines.join("\n"));
    }

    if (sections.length === 0) {
      return "";
    }

    return [
      "***REMOVED*** Memory Context",
      "",
      "The following information from past tasks may be helpful:",
      "",
      ...sections,
      "---",
      "",
    ].join("\n");
  }
}

/**
 * Create a memory client instance
 */
export function createMemoryClient(apiBaseUrl: string, orgApiKey: string): MemoryClient {
  return new MemoryClient(apiBaseUrl, orgApiKey);
}
