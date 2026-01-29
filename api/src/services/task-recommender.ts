import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { EpisodicMemory, SemanticMemory, ProceduralMemory } from "../models/index.js";
import {
  generateEmbedding,
  findSimilarEpisodicMemories,
  findSimilarSemanticMemories,
  findSimilarProceduralMemories,
} from "./embedding.js";
import { logger } from "../utils/logger.js";

/**
 * Similar task with relevance information
 */
export interface SimilarTask {
  taskId: string;
  title: string;
  description: string | null;
  repository: string | null;
  status: string;
  outcome: "success" | "failure" | "partial" | "unknown";
  similarity: number;
  completedAt: Date | null;
  persona: string | null;
  model: string | null;
  insights: string[];
  prUrl: string | null;
}

/**
 * Planning context with relevant memories and past tasks
 */
export interface PlanningContext {
  similarTasks: SimilarTask[];
  relevantKnowledge: Array<{
    subject: string;
    knowledge: string;
    confidence: number;
    category: string;
  }>;
  relevantExperiences: Array<{
    eventType: string;
    summary: string;
    outcome: string;
    repository: string;
  }>;
  applicableSkills: Array<{
    name: string;
    description: string;
    successRate: number | null;
    steps: string[];
  }>;
  recommendations: string[];
  warnings: string[];
}

/**
 * Task description for finding similar tasks
 */
export interface TaskDescription {
  title: string;
  description?: string;
  repository?: string;
  technologies?: string[];
  taskType?: string;
}

/**
 * Task Recommender Service - REQ-11
 *
 * Provides similar task recommendations during the planning phase.
 * Helps the planning agent leverage past experiences and knowledge.
 */
export class TaskRecommender {
  private taskRepo = AppDataSource.getRepository(WorkerTask);
  private episodicRepo = AppDataSource.getRepository(EpisodicMemory);
  private semanticRepo = AppDataSource.getRepository(SemanticMemory);
  private proceduralRepo = AppDataSource.getRepository(ProceduralMemory);

  /**
   * Find similar past tasks based on description
   */
  async findSimilarTasks(
    orgId: string,
    task: TaskDescription,
    options: { limit?: number; minSimilarity?: number } = {}
  ): Promise<SimilarTask[]> {
    const { limit = 10, minSimilarity = 0.5 } = options;

    // Build search text from task description
    const searchText = this.buildSearchText(task);

    try {
      // Generate embedding for the task description
      const embeddingResult = await generateEmbedding(orgId, searchText);

      if (!embeddingResult.embedding) {
        // Fallback to text-based search if embedding fails
        return this.textBasedSearch(orgId, task, limit);
      }

      // Find similar episodic memories (past task experiences)
      const episodicResults = await findSimilarEpisodicMemories(
        orgId,
        embeddingResult.embedding,
        {
          repository: task.repository,
          limit: limit * 2,
          minSimilarity,
        }
      );

      // Map episodic memories back to their tasks
      const taskIds = episodicResults
        .filter((m) => m.taskId)
        .map((m) => m.taskId as string);

      if (taskIds.length === 0) {
        return this.textBasedSearch(orgId, task, limit);
      }

      // Get the full task details
      const tasks = await this.taskRepo
        .createQueryBuilder("t")
        .where("t.id IN (:...taskIds)", { taskIds })
        .andWhere("t.org_id = :orgId", { orgId })
        .getMany();

      // Combine with similarity scores
      const similarTasks: SimilarTask[] = [];

      for (const memory of episodicResults) {
        if (!memory.taskId) continue;

        const matchedTask = tasks.find((t) => t.id === memory.taskId);
        if (!matchedTask) continue;

        // Determine outcome from memory and task
        let outcome: SimilarTask["outcome"] = "unknown";
        const typedMemory = memory as unknown as EpisodicMemory;
        const memoryOutcome = typedMemory.outcome;
        if (memoryOutcome === "success" || matchedTask.status === "completed") {
          outcome = "success";
        } else if (memoryOutcome === "failure" || matchedTask.status === "failed") {
          outcome = "failure";
        } else if (memoryOutcome === "partial") {
          outcome = "partial";
        }

        // Extract insights from the memory
        const insights = this.extractInsights(typedMemory);

        similarTasks.push({
          taskId: matchedTask.id,
          title: matchedTask.summary || matchedTask.jiraIssueKey || "Untitled Task",
          description: matchedTask.description,
          repository: matchedTask.githubRepo,
          status: matchedTask.status,
          outcome,
          similarity: (memory as { similarity?: number }).similarity || 0,
          completedAt: matchedTask.completedAt,
          persona: matchedTask.workerPersona,
          model: matchedTask.workerModel,
          insights,
          prUrl: matchedTask.githubPrUrl,
        });
      }

      // Sort by similarity and return top results
      return similarTasks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      logger.warn("Error finding similar tasks with embeddings, falling back to text search", {
        error,
        orgId,
      });
      return this.textBasedSearch(orgId, task, limit);
    }
  }

  /**
   * Get full planning context with memories and recommendations
   */
  async getPlanningContext(
    orgId: string,
    task: TaskDescription,
    options: { limit?: number } = {}
  ): Promise<PlanningContext> {
    const { limit = 5 } = options;

    logger.info("Getting planning context", { orgId, task: task.title });

    // Find similar tasks
    const similarTasks = await this.findSimilarTasks(orgId, task, { limit });

    // Get relevant knowledge from semantic memory
    const relevantKnowledge = await this.findRelevantKnowledge(orgId, task, limit);

    // Get relevant experiences from episodic memory
    const relevantExperiences = await this.findRelevantExperiences(orgId, task, limit);

    // Get applicable skills from procedural memory
    const applicableSkills = await this.findApplicableSkills(orgId, task, limit);

    // Generate recommendations based on all context
    const recommendations = this.generateRecommendations(
      similarTasks,
      relevantKnowledge,
      relevantExperiences,
      applicableSkills
    );

    // Generate warnings based on past failures
    const warnings = this.generateWarnings(similarTasks, relevantExperiences);

    return {
      similarTasks,
      relevantKnowledge,
      relevantExperiences,
      applicableSkills,
      recommendations,
      warnings,
    };
  }

  /**
   * Get brief recommendations for a task (lighter weight than full context)
   */
  async getQuickRecommendations(
    orgId: string,
    task: TaskDescription
  ): Promise<{
    topSimilarTask: SimilarTask | null;
    keyInsights: string[];
    suggestedApproach: string | null;
  }> {
    // Get just the top similar task
    const similarTasks = await this.findSimilarTasks(orgId, task, {
      limit: 3,
      minSimilarity: 0.6,
    });

    const topSimilarTask = similarTasks.length > 0 ? similarTasks[0] : null;

    // Gather key insights
    const keyInsights: string[] = [];

    if (topSimilarTask) {
      keyInsights.push(...topSimilarTask.insights.slice(0, 3));

      if (topSimilarTask.outcome === "success" && topSimilarTask.persona) {
        keyInsights.push(
          `Similar task completed successfully by ${topSimilarTask.persona}`
        );
      } else if (topSimilarTask.outcome === "failure") {
        keyInsights.push(
          "Warning: A similar task previously failed - review approach"
        );
      }
    }

    // Get one applicable skill as suggested approach
    const skills = await this.findApplicableSkills(orgId, task, 1);
    const suggestedApproach = skills.length > 0
      ? `Consider using "${skills[0].name}": ${skills[0].description}`
      : null;

    return {
      topSimilarTask,
      keyInsights,
      suggestedApproach,
    };
  }

  // Private helper methods

  private buildSearchText(task: TaskDescription): string {
    const parts = [task.title];

    if (task.description) {
      parts.push(task.description);
    }
    if (task.repository) {
      parts.push(task.repository);
    }
    if (task.technologies && task.technologies.length > 0) {
      parts.push(task.technologies.join(" "));
    }
    if (task.taskType) {
      parts.push(task.taskType);
    }

    return parts.join(" ");
  }

  private async textBasedSearch(
    orgId: string,
    task: TaskDescription,
    limit: number
  ): Promise<SimilarTask[]> {
    // Simple text-based fallback using LIKE queries
    const qb = this.taskRepo
      .createQueryBuilder("t")
      .where("t.org_id = :orgId", { orgId })
      .andWhere("t.status IN (:...statuses)", {
        statuses: ["completed", "failed"],
      });

    // Build search conditions
    const searchTerms = task.title.split(" ").filter((t) => t.length > 3);

    if (searchTerms.length > 0) {
      const conditions = searchTerms.map(
        (_, i) => `(t.summary ILIKE :term${i} OR t.description ILIKE :term${i})`
      );
      qb.andWhere(`(${conditions.join(" OR ")})`);

      searchTerms.forEach((term, i) => {
        qb.setParameter(`term${i}`, `%${term}%`);
      });
    }

    if (task.repository) {
      qb.andWhere("t.github_repo = :repository", { repository: task.repository });
    }

    const tasks = await qb
      .orderBy("t.completed_at", "DESC", "NULLS LAST")
      .limit(limit)
      .getMany();

    return tasks.map((t) => ({
      taskId: t.id,
      title: t.summary || t.jiraIssueKey || "Untitled Task",
      description: t.description,
      repository: t.githubRepo,
      status: t.status,
      outcome: t.status === "completed" ? "success" : t.status === "failed" ? "failure" : "unknown",
      similarity: 0.5, // Default similarity for text-based results
      completedAt: t.completedAt,
      persona: t.workerPersona,
      model: t.workerModel,
      insights: [],
      prUrl: t.githubPrUrl,
    }));
  }

  private extractInsights(memory: EpisodicMemory): string[] {
    const insights: string[] = [];

    // Extract from summary
    if (memory.summary) {
      // Look for key patterns
      if (memory.summary.toLowerCase().includes("approach")) {
        insights.push(memory.summary.substring(0, 150));
      }
    }

    // Extract from details
    if (memory.details) {
      if (memory.details.approach) {
        insights.push(`Approach: ${memory.details.approach}`);
      }
      if (memory.details.keyDecisions && Array.isArray(memory.details.keyDecisions)) {
        insights.push(...memory.details.keyDecisions.slice(0, 2));
      }
      if (memory.details.lessonsLearned) {
        insights.push(`Lesson: ${memory.details.lessonsLearned}`);
      }
    }

    // Add outcome-based insight
    if (memory.outcome === "success") {
      insights.push("This approach led to a successful outcome");
    } else if (memory.outcome === "failure" && memory.outcomeDetails) {
      insights.push(`Previous failure: ${memory.outcomeDetails}`);
    }

    return insights.slice(0, 5); // Limit insights
  }

  private async findRelevantKnowledge(
    orgId: string,
    task: TaskDescription,
    limit: number
  ): Promise<PlanningContext["relevantKnowledge"]> {
    try {
      const searchText = this.buildSearchText(task);
      const embeddingResult = await generateEmbedding(orgId, searchText);

      if (!embeddingResult.embedding) {
        return [];
      }

      const results = await findSimilarSemanticMemories(
        orgId,
        embeddingResult.embedding,
        {
          repository: task.repository,
          limit,
          minSimilarity: 0.5,
        }
      );

      return results.map((m) => {
        const sm = m as unknown as SemanticMemory;
        return {
          subject: sm.subject,
          knowledge: sm.knowledge,
          confidence: sm.confidence,
          category: sm.category,
        };
      });
    } catch (error) {
      logger.warn("Error finding relevant knowledge", { error, orgId });
      return [];
    }
  }

  private async findRelevantExperiences(
    orgId: string,
    task: TaskDescription,
    limit: number
  ): Promise<PlanningContext["relevantExperiences"]> {
    try {
      const searchText = this.buildSearchText(task);
      const embeddingResult = await generateEmbedding(orgId, searchText);

      if (!embeddingResult.embedding) {
        return [];
      }

      const results = await findSimilarEpisodicMemories(
        orgId,
        embeddingResult.embedding,
        {
          repository: task.repository,
          limit,
          minSimilarity: 0.5,
        }
      );

      return results.map((m) => {
        const em = m as unknown as EpisodicMemory;
        return {
          eventType: em.eventType,
          summary: em.summary,
          outcome: em.outcome,
          repository: em.repository,
        };
      });
    } catch (error) {
      logger.warn("Error finding relevant experiences", { error, orgId });
      return [];
    }
  }

  private async findApplicableSkills(
    orgId: string,
    task: TaskDescription,
    limit: number
  ): Promise<PlanningContext["applicableSkills"]> {
    try {
      const searchText = this.buildSearchText(task);
      const embeddingResult = await generateEmbedding(orgId, searchText);

      if (!embeddingResult.embedding) {
        // Fallback to keyword-based search
        return this.keywordBasedSkillSearch(orgId, task, limit);
      }

      const results = await findSimilarProceduralMemories(
        orgId,
        embeddingResult.embedding,
        { limit, minSimilarity: 0.4 }
      );

      return results.map((m) => {
        const pm = m as unknown as ProceduralMemory;
        return {
          name: pm.name,
          description: pm.description,
          successRate: pm.successRate,
          steps: pm.steps.map((s) => `${s.step}. ${s.action}`),
        };
      });
    } catch (error) {
      logger.warn("Error finding applicable skills", { error, orgId });
      return this.keywordBasedSkillSearch(orgId, task, limit);
    }
  }

  private async keywordBasedSkillSearch(
    orgId: string,
    task: TaskDescription,
    limit: number
  ): Promise<PlanningContext["applicableSkills"]> {
    const keywords = [
      ...task.title.toLowerCase().split(" "),
      ...(task.technologies || []),
      task.taskType,
    ].filter(Boolean);

    const skills = await this.proceduralRepo
      .createQueryBuilder("m")
      .where("m.orgId = :orgId", { orgId })
      .orderBy("m.successRate", "DESC", "NULLS LAST")
      .limit(limit * 2)
      .getMany();

    // Filter skills that match keywords
    const matchingSkills = skills.filter((s) => {
      const skillText = `${s.name} ${s.description}`.toLowerCase();
      return keywords.some((k) => k && skillText.includes(k.toLowerCase()));
    });

    return matchingSkills.slice(0, limit).map((m) => ({
      name: m.name,
      description: m.description,
      successRate: m.successRate,
      steps: m.steps.map((s) => `${s.step}. ${s.action}`),
    }));
  }

  private generateRecommendations(
    similarTasks: SimilarTask[],
    knowledge: PlanningContext["relevantKnowledge"],
    experiences: PlanningContext["relevantExperiences"],
    skills: PlanningContext["applicableSkills"]
  ): string[] {
    const recommendations: string[] = [];

    // Recommendations from successful similar tasks
    const successfulTasks = similarTasks.filter((t) => t.outcome === "success");
    if (successfulTasks.length > 0) {
      const bestTask = successfulTasks[0];
      recommendations.push(
        `Consider the approach from task "${bestTask.title}" which completed successfully`
      );
      if (bestTask.persona) {
        recommendations.push(
          `${bestTask.persona} successfully handled a similar task`
        );
      }
    }

    // Recommendations from knowledge
    const highConfidenceKnowledge = knowledge.filter((k) => k.confidence >= 0.7);
    if (highConfidenceKnowledge.length > 0) {
      recommendations.push(
        `Apply known pattern: "${highConfidenceKnowledge[0].subject}"`
      );
    }

    // Recommendations from skills
    if (skills.length > 0 && skills[0].successRate && skills[0].successRate > 0.7) {
      recommendations.push(
        `Use skill "${skills[0].name}" (${(skills[0].successRate * 100).toFixed(0)}% success rate)`
      );
    }

    // Recommendations from experiences
    const successfulExperiences = experiences.filter(
      (e) => e.outcome === "success"
    );
    if (successfulExperiences.length > 0) {
      recommendations.push(
        `Learn from: ${successfulExperiences[0].summary.substring(0, 100)}`
      );
    }

    return recommendations.slice(0, 5);
  }

  private generateWarnings(
    similarTasks: SimilarTask[],
    experiences: PlanningContext["relevantExperiences"]
  ): string[] {
    const warnings: string[] = [];

    // Warnings from failed similar tasks
    const failedTasks = similarTasks.filter((t) => t.outcome === "failure");
    if (failedTasks.length > 0) {
      warnings.push(
        `Similar task "${failedTasks[0].title}" previously failed - review approach`
      );
      failedTasks[0].insights
        .filter((i) => i.toLowerCase().includes("fail") || i.toLowerCase().includes("error"))
        .forEach((i) => warnings.push(i));
    }

    // Warnings from failed experiences
    const failedExperiences = experiences.filter((e) => e.outcome === "failure");
    if (failedExperiences.length > 0) {
      warnings.push(
        `Past failure in ${failedExperiences[0].repository}: ${failedExperiences[0].summary.substring(0, 80)}`
      );
    }

    // Warning if no successful references
    if (
      similarTasks.filter((t) => t.outcome === "success").length === 0 &&
      experiences.filter((e) => e.outcome === "success").length === 0
    ) {
      warnings.push(
        "No successful past tasks found for reference - proceed with caution"
      );
    }

    return warnings.slice(0, 3);
  }
}

// Export singleton instance
export const taskRecommender = new TaskRecommender();
