import { AppDataSource } from "../db/connection.js";
import {
  SemanticMemory,
  EpisodicMemory,
  ProceduralMemory,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

/**
 * Task type category for knowledge sharing
 */
export type TaskTypeCategory =
  | "feature"
  | "bugfix"
  | "refactor"
  | "test"
  | "documentation"
  | "security"
  | "performance"
  | "infrastructure";

/**
 * Task type relationship for knowledge transfer
 */
export interface TaskTypeRelation {
  sourceType: TaskTypeCategory;
  targetType: TaskTypeCategory;
  relevance: number; // 0-1, how relevant source knowledge is to target
  sharedDomains: string[]; // Domains where knowledge transfers well
}

/**
 * Shared learning insight
 */
export interface SharedLearning {
  id: string;
  sourceType: TaskTypeCategory;
  targetTypes: TaskTypeCategory[];
  subject: string;
  knowledge: string;
  confidence: number;
  applicableTo: string;
  source: "semantic" | "episodic" | "procedural";
}

/**
 * Knowledge transfer result
 */
export interface KnowledgeTransferResult {
  sourceMemoryId: string;
  targetTaskTypes: TaskTypeCategory[];
  transferredInsights: number;
  newMemoriesCreated: number;
  updatedMemories: number;
}

// Task type relationships - defines how knowledge transfers between types
const TASK_TYPE_RELATIONS: TaskTypeRelation[] = [
  // Feature development shares with refactoring
  { sourceType: "feature", targetType: "refactor", relevance: 0.7, sharedDomains: ["code patterns", "architecture", "api design"] },
  { sourceType: "refactor", targetType: "feature", relevance: 0.7, sharedDomains: ["code patterns", "architecture", "api design"] },

  // Bug fixing shares with feature development (error handling, edge cases)
  { sourceType: "bugfix", targetType: "feature", relevance: 0.6, sharedDomains: ["error handling", "validation", "edge cases"] },
  { sourceType: "feature", targetType: "bugfix", relevance: 0.6, sharedDomains: ["error handling", "validation", "edge cases"] },

  // Testing shares with all development
  { sourceType: "test", targetType: "feature", relevance: 0.8, sharedDomains: ["testing patterns", "test coverage", "assertions"] },
  { sourceType: "test", targetType: "bugfix", relevance: 0.8, sharedDomains: ["testing patterns", "regression tests", "assertions"] },
  { sourceType: "test", targetType: "refactor", relevance: 0.7, sharedDomains: ["testing patterns", "test coverage"] },

  // Security shares broadly
  { sourceType: "security", targetType: "feature", relevance: 0.9, sharedDomains: ["security", "validation", "authentication"] },
  { sourceType: "security", targetType: "bugfix", relevance: 0.8, sharedDomains: ["security", "validation"] },
  { sourceType: "security", targetType: "infrastructure", relevance: 0.8, sharedDomains: ["security", "authentication", "access control"] },

  // Performance shares with feature and refactor
  { sourceType: "performance", targetType: "feature", relevance: 0.6, sharedDomains: ["performance", "optimization", "caching"] },
  { sourceType: "performance", targetType: "refactor", relevance: 0.8, sharedDomains: ["performance", "optimization", "caching"] },

  // Infrastructure shares with security and performance
  { sourceType: "infrastructure", targetType: "security", relevance: 0.6, sharedDomains: ["infrastructure", "networking", "access control"] },
  { sourceType: "infrastructure", targetType: "performance", relevance: 0.6, sharedDomains: ["infrastructure", "scaling", "caching"] },

  // Documentation shares with all
  { sourceType: "documentation", targetType: "feature", relevance: 0.5, sharedDomains: ["documentation", "api docs", "comments"] },
  { sourceType: "documentation", targetType: "refactor", relevance: 0.5, sharedDomains: ["documentation", "code comments"] },
];

/**
 * Knowledge Sharing Service - REQ-10
 *
 * Enables sharing of learnings between related task types.
 * When knowledge is gained from one type of task, it can be
 * propagated to similar task types where it's applicable.
 */
export class KnowledgeSharingService {
  private semanticRepo = AppDataSource.getRepository(SemanticMemory);
  private episodicRepo = AppDataSource.getRepository(EpisodicMemory);
  private proceduralRepo = AppDataSource.getRepository(ProceduralMemory);

  /**
   * Get related task types for knowledge sharing
   */
  getRelatedTaskTypes(taskType: TaskTypeCategory): Array<{ type: TaskTypeCategory; relevance: number }> {
    const relations = TASK_TYPE_RELATIONS.filter(
      (r) => r.sourceType === taskType || r.targetType === taskType
    );

    const relatedTypes: Map<TaskTypeCategory, number> = new Map();

    for (const relation of relations) {
      const relatedType = relation.sourceType === taskType ? relation.targetType : relation.sourceType;
      const existing = relatedTypes.get(relatedType) || 0;
      // Take the higher relevance if multiple relations exist
      relatedTypes.set(relatedType, Math.max(existing, relation.relevance));
    }

    return Array.from(relatedTypes.entries())
      .map(([type, relevance]) => ({ type, relevance }))
      .sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Get shared domains between two task types
   */
  getSharedDomains(sourceType: TaskTypeCategory, targetType: TaskTypeCategory): string[] {
    const relation = TASK_TYPE_RELATIONS.find(
      (r) =>
        (r.sourceType === sourceType && r.targetType === targetType) ||
        (r.sourceType === targetType && r.targetType === sourceType)
    );

    return relation?.sharedDomains || [];
  }

  /**
   * Find shareable learnings from a source task type
   */
  async findShareableLearnings(
    orgId: string,
    sourceType: TaskTypeCategory,
    options: { repository?: string; minConfidence?: number; limit?: number } = {}
  ): Promise<SharedLearning[]> {
    const { repository, minConfidence = 0.6, limit = 20 } = options;

    const learnings: SharedLearning[] = [];

    // Find related task types
    const relatedTypes = this.getRelatedTaskTypes(sourceType);
    const targetTypes = relatedTypes.map((r) => r.type);

    // Get semantic memories that could be shared
    const semanticQb = this.semanticRepo
      .createQueryBuilder("m")
      .where("m.orgId = :orgId", { orgId })
      .andWhere("m.confidence >= :minConfidence", { minConfidence })
      .orderBy("m.confidence", "DESC")
      .addOrderBy("m.retrievalCount", "DESC")
      .limit(limit);

    if (repository) {
      semanticQb.andWhere("(m.repository = :repository OR m.repository IS NULL)", { repository });
    }

    const semanticMemories = await semanticQb.getMany();

    for (const memory of semanticMemories) {
      // Check if this memory is relevant to shared domains
      const applicableDomains = this.findApplicableDomains(memory, sourceType, targetTypes);

      if (applicableDomains.length > 0) {
        learnings.push({
          id: memory.id,
          sourceType,
          targetTypes,
          subject: memory.subject,
          knowledge: memory.knowledge,
          confidence: memory.confidence,
          applicableTo: `Applicable to ${applicableDomains.join(", ")}`,
          source: "semantic",
        });
      }
    }

    // Get episodic memories with successful outcomes
    const episodicQb = this.episodicRepo
      .createQueryBuilder("m")
      .where("m.orgId = :orgId", { orgId })
      .andWhere("m.outcome IN (:...outcomes)", { outcomes: ["success", "partial"] })
      .orderBy("m.createdAt", "DESC")
      .limit(limit);

    if (repository) {
      episodicQb.andWhere("m.repository = :repository", { repository });
    }

    const episodicMemories = await episodicQb.getMany();

    for (const memory of episodicMemories) {
      const applicableDomains = this.findApplicableDomainsFromSummary(memory.summary, sourceType, targetTypes);

      if (applicableDomains.length > 0) {
        learnings.push({
          id: memory.id,
          sourceType,
          targetTypes,
          subject: `${memory.eventType}: ${memory.summary.substring(0, 50)}`,
          knowledge: memory.summary,
          confidence: memory.outcome === "success" ? 0.8 : 0.6,
          applicableTo: `Experience from ${memory.eventType}`,
          source: "episodic",
        });
      }
    }

    // Get procedural memories (skills) with high success rates
    const proceduralQb = this.proceduralRepo
      .createQueryBuilder("m")
      .where("m.orgId = :orgId", { orgId })
      .andWhere("m.successRate >= :minSuccess", { minSuccess: 0.7 })
      .orderBy("m.successRate", "DESC")
      .addOrderBy("m.successCount", "DESC")
      .limit(limit);

    const proceduralMemories = await proceduralQb.getMany();

    for (const memory of proceduralMemories) {
      // Check if skill applicableTo matches target types
      const isApplicable = this.isSkillApplicable(memory, targetTypes);

      if (isApplicable) {
        learnings.push({
          id: memory.id,
          sourceType,
          targetTypes,
          subject: memory.name,
          knowledge: `${memory.description}\n\nSteps:\n${memory.steps.map((s) => `${s.step}. ${s.action}`).join("\n")}`,
          confidence: memory.successRate || 0.7,
          applicableTo: `Skill applicable to ${memory.applicableTo?.taskTypes?.join(", ") || "multiple"} task types`,
          source: "procedural",
        });
      }
    }

    // Sort by confidence
    return learnings.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Transfer knowledge from one task type to related types
   */
  async transferKnowledge(
    orgId: string,
    memoryId: string,
    memoryType: "semantic" | "episodic" | "procedural",
    targetTypes: TaskTypeCategory[]
  ): Promise<KnowledgeTransferResult> {
    logger.info("Transferring knowledge", { orgId, memoryId, memoryType, targetTypes });

    let transferredInsights = 0;
    let newMemoriesCreated = 0;
    let updatedMemories = 0;

    if (memoryType === "semantic") {
      const memory = await this.semanticRepo.findOne({
        where: { id: memoryId, orgId },
      });

      if (!memory) {
        throw new Error("Memory not found");
      }

      // For each target type, create a derived memory if one doesn't exist
      for (const targetType of targetTypes) {
        const derivedSubject = `${memory.subject} (from ${memoryType})`;

        // Check if similar memory exists
        const existing = await this.semanticRepo.findOne({
          where: { orgId, subject: derivedSubject },
        });

        if (existing) {
          // Update evidence count
          existing.evidenceCount += 1;
          existing.confidence = Math.min(0.95, existing.confidence + 0.05);
          await this.semanticRepo.save(existing);
          updatedMemories++;
        } else {
          // Create new derived memory
          const derived = this.semanticRepo.create({
            orgId,
            repository: memory.repository,
            scope: memory.scope,
            category: memory.category,
            subject: derivedSubject,
            knowledge: `${memory.knowledge}\n\n[Transferred from ${memoryType} memory, applicable to ${targetType} tasks]`,
            confidence: memory.confidence * 0.8, // Slightly lower confidence for transferred knowledge
            source: "inferred" as const,
            evidenceCount: 1,
            retrievalCount: 0,
          });
          await this.semanticRepo.save(derived);
          newMemoriesCreated++;
        }
        transferredInsights++;
      }
    }

    // Similar logic for episodic and procedural memories could be added here
    // For now, we primarily transfer semantic knowledge as it's most generalizable

    return {
      sourceMemoryId: memoryId,
      targetTaskTypes: targetTypes,
      transferredInsights,
      newMemoriesCreated,
      updatedMemories,
    };
  }

  /**
   * Automatically share learnings between related task types
   */
  async autoShareLearnings(
    orgId: string,
    options: { repository?: string; maxTransfers?: number } = {}
  ): Promise<{
    processed: number;
    transferred: number;
    newMemories: number;
    updatedMemories: number;
  }> {
    const { repository, maxTransfers = 50 } = options;

    logger.info("Auto-sharing learnings", { orgId, repository, maxTransfers });

    let processed = 0;
    let transferred = 0;
    let newMemories = 0;
    let updatedMemories = 0;

    // Get high-confidence semantic memories that haven't been shared recently
    const memories = await this.semanticRepo
      .createQueryBuilder("m")
      .where("m.orgId = :orgId", { orgId })
      .andWhere("m.confidence >= :minConfidence", { minConfidence: 0.7 })
      .andWhere("m.evidenceCount >= :minEvidence", { minEvidence: 2 })
      .orderBy("m.confidence", "DESC")
      .limit(maxTransfers)
      .getMany();

    for (const memory of memories) {
      processed++;

      // Determine source type from memory category/subject
      const sourceType = this.inferTaskType(memory);
      if (!sourceType) continue;

      // Get related types
      const relatedTypes = this.getRelatedTaskTypes(sourceType);
      const highRelevanceTypes = relatedTypes
        .filter((r) => r.relevance >= 0.6)
        .map((r) => r.type);

      if (highRelevanceTypes.length === 0) continue;

      // Transfer knowledge
      try {
        const result = await this.transferKnowledge(
          orgId,
          memory.id,
          "semantic",
          highRelevanceTypes
        );
        transferred += result.transferredInsights;
        newMemories += result.newMemoriesCreated;
        updatedMemories += result.updatedMemories;
      } catch (error) {
        logger.warn("Failed to transfer knowledge", { memoryId: memory.id, error });
      }
    }

    logger.info("Auto-share learnings complete", {
      orgId,
      processed,
      transferred,
      newMemories,
      updatedMemories,
    });

    return { processed, transferred, newMemories, updatedMemories };
  }

  // Private helper methods

  private findApplicableDomains(
    memory: SemanticMemory,
    sourceType: TaskTypeCategory,
    targetTypes: TaskTypeCategory[]
  ): string[] {
    const applicableDomains: string[] = [];

    for (const targetType of targetTypes) {
      const sharedDomains = this.getSharedDomains(sourceType, targetType);

      for (const domain of sharedDomains) {
        const lowerSubject = memory.subject.toLowerCase();
        const lowerKnowledge = memory.knowledge.toLowerCase();

        if (lowerSubject.includes(domain) || lowerKnowledge.includes(domain)) {
          if (!applicableDomains.includes(domain)) {
            applicableDomains.push(domain);
          }
        }
      }
    }

    return applicableDomains;
  }

  private findApplicableDomainsFromSummary(
    summary: string,
    sourceType: TaskTypeCategory,
    targetTypes: TaskTypeCategory[]
  ): string[] {
    const applicableDomains: string[] = [];
    const lowerSummary = summary.toLowerCase();

    for (const targetType of targetTypes) {
      const sharedDomains = this.getSharedDomains(sourceType, targetType);

      for (const domain of sharedDomains) {
        if (lowerSummary.includes(domain)) {
          if (!applicableDomains.includes(domain)) {
            applicableDomains.push(domain);
          }
        }
      }
    }

    return applicableDomains;
  }

  private isSkillApplicable(
    memory: ProceduralMemory,
    targetTypes: TaskTypeCategory[]
  ): boolean {
    if (!memory.applicableTo?.taskTypes) {
      // No specific task types = generally applicable
      return true;
    }

    // Check if any of the skill's task types overlap with targets
    return memory.applicableTo.taskTypes.some((t) =>
      targetTypes.includes(t as TaskTypeCategory)
    );
  }

  private inferTaskType(memory: SemanticMemory): TaskTypeCategory | null {
    const text = `${memory.subject} ${memory.knowledge}`.toLowerCase();

    const typeKeywords: Record<TaskTypeCategory, string[]> = {
      feature: ["feature", "implement", "add", "create", "new functionality"],
      bugfix: ["bug", "fix", "error", "issue", "crash", "failure"],
      refactor: ["refactor", "cleanup", "improve", "restructure", "reorganize"],
      test: ["test", "testing", "coverage", "assertion", "mock"],
      documentation: ["document", "readme", "comment", "jsdoc", "api doc"],
      security: ["security", "auth", "permission", "vulnerability", "xss", "sql injection"],
      performance: ["performance", "optimize", "speed", "cache", "memory", "cpu"],
      infrastructure: ["infrastructure", "deploy", "ci/cd", "docker", "kubernetes", "terraform"],
    };

    let bestMatch: TaskTypeCategory | null = null;
    let bestScore = 0;

    for (const [type, keywords] of Object.entries(typeKeywords)) {
      const score = keywords.filter((k) => text.includes(k)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = type as TaskTypeCategory;
      }
    }

    return bestMatch;
  }
}

// Export singleton instance
export const knowledgeSharingService = new KnowledgeSharingService();
