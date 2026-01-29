import { AppDataSource } from "../db/connection.js";
import { PrFeedback, PrFeedbackType, PrFeedbackResolution } from "../models/index.js";
import { SemanticMemory } from "../models/SemanticMemory.js";
import { logger } from "../utils/logger.js";

/**
 * Aggregated feedback statistics for a persona
 */
export interface PersonaFeedbackStats {
  persona: string;
  totalFeedback: number;
  acceptedSuggestions: number;
  rejectedSuggestions: number;
  partiallyAcceptedSuggestions: number;
  pendingSuggestions: number;
  acceptanceRate: number; // accepted / (accepted + rejected + partially)
  feedbackByType: Record<PrFeedbackType, number>;
  topReviewers: Array<{ username: string; count: number }>;
  commonPatterns: string[];
}

/**
 * Aggregated feedback statistics for a repository
 */
export interface RepositoryFeedbackStats {
  repository: string;
  totalFeedback: number;
  byPersona: Record<string, PersonaFeedbackStats>;
  acceptanceRate: number;
  feedbackTrend: Array<{ date: string; count: number; acceptanceRate: number }>;
  mostCommentedFiles: Array<{ path: string; count: number }>;
}

/**
 * Common feedback pattern identified from aggregation
 */
export interface FeedbackPattern {
  patternType: "recurring_issue" | "best_practice" | "common_mistake" | "style_preference";
  description: string;
  occurrences: number;
  exampleComments: string[];
  affectedPersonas: string[];
  affectedRepositories: string[];
  suggestedImprovement?: string;
}

/**
 * Feedback Aggregation Pipeline - REQ-7
 *
 * Aggregates PR feedback from multiple sources to identify patterns,
 * compute statistics, and feed insights into the learning system.
 */
export class FeedbackAggregator {
  private feedbackRepo = AppDataSource.getRepository(PrFeedback);
  private memoryRepo = AppDataSource.getRepository(SemanticMemory);

  /**
   * Get aggregated feedback statistics for a persona
   */
  async getPersonaStats(orgId: string, persona: string, days: number = 30): Promise<PersonaFeedbackStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all feedback for this persona
    const feedback = await this.feedbackRepo
      .createQueryBuilder("f")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona = :persona", { persona })
      .andWhere("f.created_at >= :since", { since })
      .getMany();

    // Count by resolution status
    const accepted = feedback.filter((f) => f.resolutionStatus === "accepted").length;
    const rejected = feedback.filter((f) => f.resolutionStatus === "rejected").length;
    const partial = feedback.filter((f) => f.resolutionStatus === "partially_accepted").length;
    const pending = feedback.filter((f) => f.resolutionStatus === "pending").length;

    // Count by feedback type
    const feedbackByType = feedback.reduce(
      (acc, f) => {
        acc[f.feedbackType] = (acc[f.feedbackType] || 0) + 1;
        return acc;
      },
      {} as Record<PrFeedbackType, number>
    );

    // Count by reviewer
    const reviewerCounts = feedback.reduce(
      (acc, f) => {
        acc[f.reviewerUsername] = (acc[f.reviewerUsername] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const topReviewers = Object.entries(reviewerCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([username, count]) => ({ username, count }));

    // Calculate acceptance rate (excluding pending)
    const resolved = accepted + rejected + partial;
    const acceptanceRate = resolved > 0 ? (accepted + partial * 0.5) / resolved : 0;

    // Extract common patterns from feedback content
    const commonPatterns = this.extractCommonPatterns(feedback.map((f) => f.content));

    return {
      persona,
      totalFeedback: feedback.length,
      acceptedSuggestions: accepted,
      rejectedSuggestions: rejected,
      partiallyAcceptedSuggestions: partial,
      pendingSuggestions: pending,
      acceptanceRate,
      feedbackByType,
      topReviewers,
      commonPatterns,
    };
  }

  /**
   * Get aggregated feedback statistics for a repository
   */
  async getRepositoryStats(orgId: string, repository: string, days: number = 30): Promise<RepositoryFeedbackStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all feedback for this repository
    const feedback = await this.feedbackRepo
      .createQueryBuilder("f")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.repository = :repository", { repository })
      .andWhere("f.created_at >= :since", { since })
      .getMany();

    // Get unique personas
    const personas = [...new Set(feedback.filter((f) => f.persona).map((f) => f.persona as string))];

    // Get stats per persona
    const byPersona: Record<string, PersonaFeedbackStats> = {};
    for (const persona of personas) {
      const personaFeedback = feedback.filter((f) => f.persona === persona);
      byPersona[persona] = this.computePersonaStatsFromFeedback(persona, personaFeedback);
    }

    // Calculate overall acceptance rate
    const resolved = feedback.filter(
      (f) => f.resolutionStatus === "accepted" || f.resolutionStatus === "rejected" || f.resolutionStatus === "partially_accepted"
    );
    const accepted = resolved.filter((f) => f.resolutionStatus === "accepted" || f.resolutionStatus === "partially_accepted");
    const acceptanceRate = resolved.length > 0 ? accepted.length / resolved.length : 0;

    // Calculate feedback trend by day
    const feedbackTrend = this.calculateFeedbackTrend(feedback, days);

    // Find most commented files
    const fileCounts = feedback.reduce(
      (acc, f) => {
        if (f.filePath) {
          acc[f.filePath] = (acc[f.filePath] || 0) + 1;
        }
        return acc;
      },
      {} as Record<string, number>
    );

    const mostCommentedFiles = Object.entries(fileCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    return {
      repository,
      totalFeedback: feedback.length,
      byPersona,
      acceptanceRate,
      feedbackTrend,
      mostCommentedFiles,
    };
  }

  /**
   * Identify feedback patterns across the organization
   */
  async identifyPatterns(orgId: string, days: number = 90): Promise<FeedbackPattern[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get all feedback with resolved status (we learn from resolved feedback)
    const feedback = await this.feedbackRepo
      .createQueryBuilder("f")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.created_at >= :since", { since })
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .getMany();

    const patterns: FeedbackPattern[] = [];

    // Pattern 1: Recurring issues (same feedback across multiple tasks)
    const contentGroups = this.groupByContent(feedback);
    for (const [content, items] of Object.entries(contentGroups)) {
      if (items.length >= 3) {
        // At least 3 occurrences
        const mostlyRejected = items.filter((f) => f.resolutionStatus === "rejected").length > items.length / 2;
        patterns.push({
          patternType: mostlyRejected ? "common_mistake" : "recurring_issue",
          description: this.summarizeContent(content),
          occurrences: items.length,
          exampleComments: items.slice(0, 3).map((f) => f.content),
          affectedPersonas: [...new Set(items.filter((f) => f.persona).map((f) => f.persona as string))],
          affectedRepositories: [...new Set(items.map((f) => f.repository))],
          suggestedImprovement: mostlyRejected ? `Review this pattern - it's frequently rejected: ${this.summarizeContent(content)}` : undefined,
        });
      }
    }

    // Pattern 2: Best practices (frequently accepted suggestions)
    const acceptedSuggestions = feedback.filter((f) => f.feedbackType === "suggestion" && f.resolutionStatus === "accepted");

    const acceptedGroups = this.groupByContent(acceptedSuggestions);
    for (const [content, items] of Object.entries(acceptedGroups)) {
      if (items.length >= 2) {
        patterns.push({
          patternType: "best_practice",
          description: this.summarizeContent(content),
          occurrences: items.length,
          exampleComments: items.slice(0, 3).map((f) => f.content),
          affectedPersonas: [...new Set(items.filter((f) => f.persona).map((f) => f.persona as string))],
          affectedRepositories: [...new Set(items.map((f) => f.repository))],
        });
      }
    }

    // Sort by occurrences
    return patterns.sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Store identified patterns as semantic memories for future retrieval
   */
  async storePatternAsMemory(orgId: string, pattern: FeedbackPattern): Promise<SemanticMemory> {
    const memory = this.memoryRepo.create({
      orgId,
      scope: "organization" as const,
      category: pattern.patternType === "best_practice" ? "pattern" : "rule",
      subject: `PR Feedback Pattern: ${pattern.patternType}`,
      knowledge: `${pattern.description}\n\nOccurrences: ${pattern.occurrences}\nExamples:\n${pattern.exampleComments.slice(0, 3).join("\n---\n")}`,
      confidence: Math.min(0.9, 0.5 + pattern.occurrences * 0.05), // Higher confidence with more occurrences
      source: "feedback" as const,
      evidenceCount: pattern.occurrences,
      retrievalCount: 0,
      lastRetrievedAt: null,
    });

    return this.memoryRepo.save(memory);
  }

  /**
   * Run full aggregation pipeline for an organization
   */
  async runPipeline(
    orgId: string,
    options: { days?: number; storePatterns?: boolean } = {}
  ): Promise<{
    patterns: FeedbackPattern[];
    memoriesStored: number;
    stats: {
      totalFeedback: number;
      acceptanceRate: number;
      topPersonas: Array<{ persona: string; acceptanceRate: number }>;
    };
  }> {
    const { days = 90, storePatterns = true } = options;

    logger.info("Running feedback aggregation pipeline", { orgId, days, storePatterns });

    // Identify patterns
    const patterns = await this.identifyPatterns(orgId, days);

    // Store patterns as memories
    let memoriesStored = 0;
    if (storePatterns) {
      for (const pattern of patterns) {
        if (pattern.occurrences >= 3) {
          // Only store significant patterns
          await this.storePatternAsMemory(orgId, pattern);
          memoriesStored++;
        }
      }
    }

    // Get overall stats
    const since = new Date();
    since.setDate(since.getDate() - days);

    const totalFeedback = await this.feedbackRepo.count({
      where: { orgId },
    });

    const resolved = await this.feedbackRepo
      .createQueryBuilder("f")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .getCount();

    const accepted = await this.feedbackRepo
      .createQueryBuilder("f")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.resolution_status IN (:...statuses)", { statuses: ["accepted", "partially_accepted"] })
      .getCount();

    const acceptanceRate = resolved > 0 ? accepted / resolved : 0;

    // Get top personas by acceptance rate
    const personaStats = await this.feedbackRepo
      .createQueryBuilder("f")
      .select("f.persona", "persona")
      .addSelect("COUNT(*)", "total")
      .addSelect("SUM(CASE WHEN f.resolution_status IN ('accepted', 'partially_accepted') THEN 1 ELSE 0 END)", "accepted")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona IS NOT NULL")
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .groupBy("f.persona")
      .orderBy("total", "DESC")
      .limit(10)
      .getRawMany();

    const topPersonas = personaStats.map((p) => ({
      persona: p.persona,
      acceptanceRate: parseInt(p.total) > 0 ? parseInt(p.accepted) / parseInt(p.total) : 0,
    }));

    logger.info("Feedback aggregation pipeline complete", {
      orgId,
      patternsFound: patterns.length,
      memoriesStored,
      totalFeedback,
      acceptanceRate,
    });

    return {
      patterns,
      memoriesStored,
      stats: {
        totalFeedback,
        acceptanceRate,
        topPersonas,
      },
    };
  }

  // Helper methods

  private computePersonaStatsFromFeedback(persona: string, feedback: PrFeedback[]): PersonaFeedbackStats {
    const accepted = feedback.filter((f) => f.resolutionStatus === "accepted").length;
    const rejected = feedback.filter((f) => f.resolutionStatus === "rejected").length;
    const partial = feedback.filter((f) => f.resolutionStatus === "partially_accepted").length;
    const pending = feedback.filter((f) => f.resolutionStatus === "pending").length;

    const feedbackByType = feedback.reduce(
      (acc, f) => {
        acc[f.feedbackType] = (acc[f.feedbackType] || 0) + 1;
        return acc;
      },
      {} as Record<PrFeedbackType, number>
    );

    const reviewerCounts = feedback.reduce(
      (acc, f) => {
        acc[f.reviewerUsername] = (acc[f.reviewerUsername] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const topReviewers = Object.entries(reviewerCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([username, count]) => ({ username, count }));

    const resolved = accepted + rejected + partial;
    const acceptanceRate = resolved > 0 ? (accepted + partial * 0.5) / resolved : 0;

    return {
      persona,
      totalFeedback: feedback.length,
      acceptedSuggestions: accepted,
      rejectedSuggestions: rejected,
      partiallyAcceptedSuggestions: partial,
      pendingSuggestions: pending,
      acceptanceRate,
      feedbackByType,
      topReviewers,
      commonPatterns: this.extractCommonPatterns(feedback.map((f) => f.content)),
    };
  }

  private calculateFeedbackTrend(feedback: PrFeedback[], days: number): Array<{ date: string; count: number; acceptanceRate: number }> {
    // Group by date
    const byDate: Record<string, PrFeedback[]> = {};
    for (const f of feedback) {
      const date = f.createdAt.toISOString().split("T")[0];
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(f);
    }

    return Object.entries(byDate)
      .map(([date, items]) => {
        const resolved = items.filter(
          (f) => f.resolutionStatus === "accepted" || f.resolutionStatus === "rejected" || f.resolutionStatus === "partially_accepted"
        );
        const accepted = resolved.filter((f) => f.resolutionStatus === "accepted" || f.resolutionStatus === "partially_accepted");
        return {
          date,
          count: items.length,
          acceptanceRate: resolved.length > 0 ? accepted.length / resolved.length : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private extractCommonPatterns(contents: string[]): string[] {
    // Simple pattern extraction - look for common keywords/phrases
    const patterns: Record<string, number> = {};
    const keywords = [
      "error handling",
      "type safety",
      "null check",
      "validation",
      "naming",
      "documentation",
      "test",
      "performance",
      "security",
      "refactor",
      "simplify",
      "unused",
      "import",
      "export",
      "async",
      "await",
      "try/catch",
    ];

    for (const content of contents) {
      const lower = content.toLowerCase();
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          patterns[keyword] = (patterns[keyword] || 0) + 1;
        }
      }
    }

    return Object.entries(patterns)
      .filter(([, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([keyword]) => keyword);
  }

  private groupByContent(feedback: PrFeedback[]): Record<string, PrFeedback[]> {
    // Group by normalized content (first 100 chars, lowercase)
    const groups: Record<string, PrFeedback[]> = {};
    for (const f of feedback) {
      const key = f.content.toLowerCase().substring(0, 100).trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }

  private summarizeContent(content: string): string {
    // Return first 200 chars as summary
    return content.length > 200 ? content.substring(0, 197) + "..." : content;
  }
}

// Export singleton instance
export const feedbackAggregator = new FeedbackAggregator();
