import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { ProceduralMemory } from "../models/ProceduralMemory.js";
import {
  generateEmbedding,
  findSimilarProceduralMemories,
} from "./embedding.js";
import { codebaseRetriever, CodeSnippet, FormattedCodeContext } from "./codebase-retriever.js";
import { codebaseIndexer } from "./codebase-indexer.js";
import { logger } from "../utils/logger.js";

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
  retrievedAt: Date;
}

/**
 * Enhanced context including both skills and code snippets
 */
export interface EnhancedContextResult {
  skills: InjectedSkill[];
  codeSnippets: CodeSnippet[];
  formattedContext: string;
  skillCount: number;
  codeSnippetCount: number;
  retrievedAt: Date;
}

/**
 * Skill Injector Service - REQ-16
 *
 * Retrieves relevant skills and formats them for injection into worker context.
 * Workers call this to get skills that may help with their current task.
 */
export class SkillInjector {
  private taskRepo = AppDataSource.getRepository(WorkerTask);
  private proceduralRepo = AppDataSource.getRepository(ProceduralMemory);

  /**
   * Get skills to inject for a specific task by ID
   */
  async getSkillsForTask(
    orgId: string,
    taskId: string,
    options: { limit?: number; minRelevance?: number } = {}
  ): Promise<SkillInjectionResult> {
    const { limit = 5, minRelevance = 0.5 } = options;

    // Get the task
    const task = await this.taskRepo.findOne({
      where: { id: taskId, orgId },
    });

    if (!task) {
      throw new Error("Task not found");
    }

    // Build search text from task
    const searchText = this.buildSearchText(task);

    // Get relevant skills
    const skills = await this.findRelevantSkills(orgId, searchText, {
      limit,
      minRelevance,
      repository: task.githubRepo || undefined,
    });

    // Update retrieval counts
    await this.updateRetrievalCounts(skills.map((s) => s.id));

    // Format skills for injection
    const injectedSkills = this.formatSkillsForInjection(skills);
    const formattedContext = this.formatContextForWorker(injectedSkills);

    logger.info("Skills injected for task", {
      orgId,
      taskId,
      skillsInjected: injectedSkills.length,
    });

    return {
      taskId,
      taskTitle: task.summary || task.jiraIssueKey || "Untitled",
      skillsInjected: injectedSkills.length,
      skills: injectedSkills,
      formattedContext,
      retrievedAt: new Date(),
    };
  }

  /**
   * Get skills based on task description (for planning phase)
   */
  async getSkillsForDescription(
    orgId: string,
    description: string,
    options: {
      limit?: number;
      minRelevance?: number;
      repository?: string;
      taskType?: string;
    } = {}
  ): Promise<SkillInjectionResult> {
    const { limit = 5, minRelevance = 0.5, repository, taskType } = options;

    // Get relevant skills
    const skills = await this.findRelevantSkills(orgId, description, {
      limit,
      minRelevance,
      repository,
      taskType,
    });

    // Update retrieval counts
    await this.updateRetrievalCounts(skills.map((s) => s.id));

    // Format skills for injection
    const injectedSkills = this.formatSkillsForInjection(skills);
    const formattedContext = this.formatContextForWorker(injectedSkills);

    logger.info("Skills injected for description", {
      orgId,
      skillsInjected: injectedSkills.length,
    });

    return {
      skillsInjected: injectedSkills.length,
      skills: injectedSkills,
      formattedContext,
      retrievedAt: new Date(),
    };
  }

  /**
   * Get skills specifically for a persona/task type combination
   */
  async getSkillsForPersona(
    orgId: string,
    persona: string,
    options: {
      taskType?: string;
      repository?: string;
      limit?: number;
    } = {}
  ): Promise<SkillInjectionResult> {
    const { taskType, repository, limit = 5 } = options;

    // Query skills that match persona/task type
    const qb = this.proceduralRepo
      .createQueryBuilder("s")
      .where("s.orgId = :orgId", { orgId })
      .andWhere("(s.successRate IS NULL OR s.successRate >= :minRate)", { minRate: 0.5 })
      .orderBy("s.successRate", "DESC", "NULLS LAST")
      .addOrderBy("s.successCount", "DESC")
      .limit(limit * 2); // Get more to filter

    // Filter by repository if specified
    if (repository) {
      qb.andWhere("(s.repository = :repository OR s.repository IS NULL)", { repository });
    }

    const allSkills = await qb.getMany();

    // Filter by persona/taskType matching in applicability
    const matchingSkills = allSkills.filter((skill) => {
      if (!skill.applicableTo) return true;

      // Check task types
      if (taskType && skill.applicableTo.taskTypes) {
        if (!skill.applicableTo.taskTypes.includes(taskType)) {
          return false;
        }
      }

      // Keywords matching for persona
      if (skill.applicableTo.keywords) {
        const personaWords = persona.toLowerCase().split("_");
        const hasMatch = personaWords.some((word) =>
          skill.applicableTo!.keywords!.some((kw: string) =>
            kw.toLowerCase().includes(word)
          )
        );
        if (hasMatch) return true;
      }

      return true;
    }).slice(0, limit);

    // Update retrieval counts
    await this.updateRetrievalCounts(matchingSkills.map((s) => s.id));

    // Format skills for injection
    const injectedSkills = this.formatSkillsForInjection(matchingSkills, 0.7); // Default relevance
    const formattedContext = this.formatContextForWorker(injectedSkills);

    return {
      skillsInjected: injectedSkills.length,
      skills: injectedSkills,
      formattedContext,
      retrievedAt: new Date(),
    };
  }

  /**
   * Record skill usage outcome (success/failure)
   */
  async recordSkillUsage(
    orgId: string,
    skillId: string,
    outcome: "success" | "failure",
    taskId?: string
  ): Promise<void> {
    const skill = await this.proceduralRepo.findOne({
      where: { id: skillId, orgId },
    });

    if (!skill) {
      logger.warn("Skill not found for usage recording", { skillId, orgId });
      return;
    }

    if (outcome === "success") {
      skill.successCount += 1;
    } else {
      skill.failureCount += 1;
    }

    skill.lastUsedAt = new Date();

    await this.proceduralRepo.save(skill);

    logger.info("Recorded skill usage", {
      skillId,
      outcome,
      taskId,
      newSuccessCount: skill.successCount,
      newFailureCount: skill.failureCount,
    });
  }

  /**
   * Get enhanced context combining skills and code snippets
   */
  async getEnhancedContext(
    orgId: string,
    taskDescription: string,
    options: {
      repository?: string;
      includeCodeSnippets?: boolean;
      skillLimit?: number;
      codeLimit?: number;
      minSkillRelevance?: number;
      minCodeSimilarity?: number;
    } = {}
  ): Promise<EnhancedContextResult> {
    const {
      repository,
      includeCodeSnippets = true,
      skillLimit = 5,
      codeLimit = 10,
      minSkillRelevance = 0.5,
      minCodeSimilarity = 0.4,
    } = options;

    // Get skills
    const skillsResult = await this.getSkillsForDescription(orgId, taskDescription, {
      limit: skillLimit,
      minRelevance: minSkillRelevance,
      repository,
    });

    // Get code snippets if enabled and repository is specified
    let codeContext: FormattedCodeContext = {
      snippets: [],
      formattedText: "",
      totalSnippets: 0,
    };

    if (includeCodeSnippets && repository) {
      try {
        // Check if repository is indexed
        const indexStatus = await codebaseIndexer.getIndexStatus(orgId, repository);

        if (indexStatus && indexStatus.status === "ready") {
          codeContext = await codebaseRetriever.getCodeContextMultiQuery(
            orgId,
            repository,
            taskDescription,
            {
              limit: codeLimit,
              minSimilarity: minCodeSimilarity,
            }
          );
        } else {
          logger.debug("Codebase not indexed for enhanced context", {
            orgId,
            repository,
            indexStatus: indexStatus?.status,
          });
        }
      } catch (error) {
        logger.warn("Error getting code context", {
          orgId,
          repository,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Combine formatted context
    const contextParts: string[] = [];

    if (skillsResult.formattedContext) {
      contextParts.push(skillsResult.formattedContext);
    }

    if (codeContext.formattedText) {
      contextParts.push(codeContext.formattedText);
    }

    logger.info("Retrieved enhanced context", {
      orgId,
      repository,
      skillCount: skillsResult.skills.length,
      codeSnippetCount: codeContext.totalSnippets,
    });

    return {
      skills: skillsResult.skills,
      codeSnippets: codeContext.snippets,
      formattedContext: contextParts.join("\n\n"),
      skillCount: skillsResult.skills.length,
      codeSnippetCount: codeContext.totalSnippets,
      retrievedAt: new Date(),
    };
  }

  // Private helper methods

  private buildSearchText(task: WorkerTask): string {
    const parts: string[] = [];

    if (task.summary) parts.push(task.summary);
    if (task.description) parts.push(task.description);
    if (task.workerPersona) parts.push(task.workerPersona);
    if (task.jiraIssueKey) parts.push(task.jiraIssueKey);

    return parts.join(" ");
  }

  private async findRelevantSkills(
    orgId: string,
    searchText: string,
    options: {
      limit: number;
      minRelevance: number;
      repository?: string;
      taskType?: string;
    }
  ): Promise<Array<ProceduralMemory & { relevance: number }>> {
    const { limit, minRelevance, repository, taskType } = options;

    try {
      // Generate embedding for search
      const { embedding } = await generateEmbedding(orgId, searchText);

      // Find similar procedural memories
      const similar = await findSimilarProceduralMemories(orgId, embedding, {
        limit: limit * 2,
        minSimilarity: minRelevance,
        repository,
      });

      // Enhance with full skill data and filter
      const enhancedSkills: Array<ProceduralMemory & { relevance: number }> = [];

      for (const result of similar) {
        const skill = await this.proceduralRepo.findOne({
          where: { id: result.id, orgId },
        });

        if (!skill) continue;

        // Check task type if specified
        if (taskType && skill.applicableTo?.taskTypes) {
          if (!skill.applicableTo.taskTypes.includes(taskType)) {
            continue;
          }
        }

        enhancedSkills.push({
          ...skill,
          relevance: result.similarity,
        });

        if (enhancedSkills.length >= limit) break;
      }

      return enhancedSkills;
    } catch (error) {
      logger.warn("Error finding relevant skills via embedding", { error, orgId });

      // Fallback to keyword-based matching
      return this.fallbackKeywordMatch(orgId, searchText, options);
    }
  }

  private async fallbackKeywordMatch(
    orgId: string,
    searchText: string,
    options: { limit: number; repository?: string }
  ): Promise<Array<ProceduralMemory & { relevance: number }>> {
    const { limit, repository } = options;
    const lowerSearch = searchText.toLowerCase();
    const words = lowerSearch.split(/\s+/).filter((w) => w.length > 3);

    const qb = this.proceduralRepo
      .createQueryBuilder("s")
      .where("s.orgId = :orgId", { orgId })
      .andWhere("(s.successRate IS NULL OR s.successRate >= :minRate)", { minRate: 0.5 })
      .orderBy("s.successRate", "DESC", "NULLS LAST")
      .limit(limit * 3);

    if (repository) {
      qb.andWhere("(s.repository = :repository OR s.repository IS NULL)", { repository });
    }

    const skills = await qb.getMany();

    // Score by keyword matches
    const scored = skills.map((skill) => {
      const skillText = `${skill.name} ${skill.description}`.toLowerCase();
      let matches = 0;

      for (const word of words) {
        if (skillText.includes(word)) {
          matches++;
        }
      }

      const relevance = words.length > 0 ? matches / words.length : 0;
      return { ...skill, relevance };
    });

    return scored
      .filter((s) => s.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  private async updateRetrievalCounts(skillIds: string[]): Promise<void> {
    if (skillIds.length === 0) return;

    await this.proceduralRepo
      .createQueryBuilder()
      .update()
      .set({
        retrievalCount: () => "retrieval_count + 1",
        lastRetrievedAt: new Date(),
      })
      .whereInIds(skillIds)
      .execute();
  }

  private formatSkillsForInjection(
    skills: Array<ProceduralMemory & { relevance?: number }>,
    defaultRelevance: number = 0.7
  ): InjectedSkill[] {
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      steps: skill.steps,
      prerequisites: skill.prerequisites || undefined,
      relevanceScore: skill.relevance ?? defaultRelevance,
      successRate: skill.successRate,
      usageCount: skill.successCount + skill.failureCount,
    }));
  }

  /**
   * Format skills as a context block for worker consumption
   */
  private formatContextForWorker(skills: InjectedSkill[]): string {
    if (skills.length === 0) {
      return "";
    }

    const lines: string[] = [
      "***REMOVED*** Relevant Skills from Past Experiences",
      "",
      "The following skills have been identified as potentially helpful for this task.",
      "Consider using these approaches when applicable:",
      "",
    ];

    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      lines.push(`***REMOVED******REMOVED*** ${i + 1}. ${skill.name}`);
      lines.push("");
      lines.push(skill.description);
      lines.push("");

      if (skill.successRate !== null) {
        lines.push(`*Success rate: ${Math.round(skill.successRate * 100)}%*`);
        lines.push("");
      }

      lines.push("***REMOVED******REMOVED******REMOVED*** Steps:");
      lines.push("");

      for (const step of skill.steps) {
        lines.push(`${step.step}. **${step.action}**`);
        if (step.details) {
          lines.push(`   ${step.details}`);
        }
        if (step.example) {
          lines.push(`   Example: ${step.example}`);
        }
      }

      lines.push("");
      lines.push("---");
      lines.push("");
    }

    return lines.join("\n");
  }
}

// Export singleton instance
export const skillInjector = new SkillInjector();
