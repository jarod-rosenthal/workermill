import { AppDataSource } from "../db/connection.js";
import { PrFeedback } from "../models/index.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";

/**
 * Routing score for a persona/model combination
 */
export interface RoutingScore {
  persona: string;
  model: string | null;
  score: number; // 0-1, higher is better
  acceptanceRate: number;
  totalFeedback: number;
  recentTrend: "improving" | "declining" | "stable";
  strengths: string[];
  weaknesses: string[];
}

/**
 * Routing recommendation for a task
 */
export interface RoutingRecommendation {
  recommendedPersona: string;
  recommendedModel: string | null;
  confidence: number;
  reasoning: string;
  alternatives: Array<{
    persona: string;
    model: string | null;
    score: number;
    reason: string;
  }>;
  warnings: string[];
}

/**
 * Task characteristics for routing decisions
 */
export interface TaskCharacteristics {
  taskType?: string; // e.g., "feature", "bug", "refactor"
  technologies?: string[]; // e.g., ["typescript", "react"]
  complexity?: "low" | "medium" | "high";
  repository?: string;
  keywords?: string[];
}

/**
 * Feedback-Based Router - REQ-8
 *
 * Uses feedback patterns to train and improve routing decisions.
 * Learns which personas/models perform best for different task types.
 */
export class FeedbackRouter {
  private feedbackRepo = AppDataSource.getRepository(PrFeedback);
  private taskRepo = AppDataSource.getRepository(WorkerTask);

  /**
   * Get routing scores for all personas based on feedback history
   */
  async getPersonaScores(
    orgId: string,
    options: { repository?: string; days?: number } = {}
  ): Promise<RoutingScore[]> {
    const { repository, days = 90 } = options;
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get feedback grouped by persona
    const qb = this.feedbackRepo
      .createQueryBuilder("f")
      .select("f.persona", "persona")
      .addSelect("f.model", "model")
      .addSelect("COUNT(*)", "total")
      .addSelect(
        "SUM(CASE WHEN f.resolution_status = 'accepted' THEN 1 ELSE 0 END)",
        "accepted"
      )
      .addSelect(
        "SUM(CASE WHEN f.resolution_status = 'rejected' THEN 1 ELSE 0 END)",
        "rejected"
      )
      .addSelect(
        "SUM(CASE WHEN f.resolution_status = 'partially_accepted' THEN 1 ELSE 0 END)",
        "partial"
      )
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona IS NOT NULL")
      .andWhere("f.created_at >= :since", { since })
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .groupBy("f.persona")
      .addGroupBy("f.model");

    if (repository) {
      qb.andWhere("f.repository = :repository", { repository });
    }

    const stats = await qb.getRawMany();

    // Calculate scores
    const scores: RoutingScore[] = [];

    for (const stat of stats) {
      const total = parseInt(stat.total);
      const accepted = parseInt(stat.accepted);
      const rejected = parseInt(stat.rejected);
      const partial = parseInt(stat.partial);

      // Calculate acceptance rate (partial counts as 0.5)
      const acceptanceRate = total > 0 ? (accepted + partial * 0.5) / total : 0;

      // Get recent trend
      const trend = await this.calculateTrend(orgId, stat.persona, days);

      // Get strengths and weaknesses from feedback patterns
      const { strengths, weaknesses } = await this.analyzePersonaPatterns(
        orgId,
        stat.persona,
        days
      );

      // Calculate composite score (acceptance rate weighted by volume and trend)
      const volumeWeight = Math.min(1, total / 20); // Full weight at 20+ feedback items
      const trendBonus =
        trend === "improving" ? 0.1 : trend === "declining" ? -0.1 : 0;
      const score = Math.min(1, Math.max(0, acceptanceRate * volumeWeight + trendBonus));

      scores.push({
        persona: stat.persona,
        model: stat.model,
        score,
        acceptanceRate,
        totalFeedback: total,
        recentTrend: trend,
        strengths,
        weaknesses,
      });
    }

    // Sort by score descending
    return scores.sort((a, b) => b.score - a.score);
  }

  /**
   * Get routing recommendation for a specific task
   */
  async getRoutingRecommendation(
    orgId: string,
    task: TaskCharacteristics
  ): Promise<RoutingRecommendation> {
    const scores = await this.getPersonaScores(orgId, {
      repository: task.repository,
      days: 90,
    });

    if (scores.length === 0) {
      // No feedback data - return default recommendation
      return {
        recommendedPersona: this.getDefaultPersonaForTask(task),
        recommendedModel: null,
        confidence: 0.3,
        reasoning: "No feedback data available. Using default persona based on task type.",
        alternatives: [],
        warnings: ["No historical feedback data for routing decisions"],
      };
    }

    // Filter personas by task characteristics
    const suitablePersonas = this.filterSuitablePersonas(scores, task);

    if (suitablePersonas.length === 0) {
      // No suitable personas - use highest scoring
      const best = scores[0];
      return {
        recommendedPersona: best.persona,
        recommendedModel: best.model,
        confidence: best.score * 0.7, // Reduce confidence
        reasoning: `Using ${best.persona} based on overall performance (${(best.acceptanceRate * 100).toFixed(0)}% acceptance rate).`,
        alternatives: scores.slice(1, 4).map((s) => ({
          persona: s.persona,
          model: s.model,
          score: s.score,
          reason: `${(s.acceptanceRate * 100).toFixed(0)}% acceptance rate`,
        })),
        warnings: ["Task characteristics don't strongly match any persona's strengths"],
      };
    }

    const best = suitablePersonas[0];
    const warnings: string[] = [];

    if (best.recentTrend === "declining") {
      warnings.push(`${best.persona} performance has been declining recently`);
    }
    if (best.weaknesses.some((w) => this.matchesTask(w, task))) {
      warnings.push(`Task may involve areas where ${best.persona} has shown weaknesses`);
    }

    return {
      recommendedPersona: best.persona,
      recommendedModel: best.model,
      confidence: best.score,
      reasoning: this.generateReasoning(best, task),
      alternatives: suitablePersonas.slice(1, 4).map((s) => ({
        persona: s.persona,
        model: s.model,
        score: s.score,
        reason: this.generateAlternativeReason(s, task),
      })),
      warnings,
    };
  }

  /**
   * Record routing outcome for future learning
   */
  async recordRoutingOutcome(
    orgId: string,
    taskId: string,
    persona: string,
    outcome: "success" | "failure" | "partial"
  ): Promise<void> {
    // This integrates with the feedback system - outcomes are captured through
    // PR feedback resolution status. This method can be used for explicit
    // outcome recording when PR feedback isn't available.
    logger.info("Recording routing outcome", { orgId, taskId, persona, outcome });

    // Update task metadata with routing outcome
    await this.taskRepo.update(
      { id: taskId, orgId },
      {
        // Store in jsonb field if exists, or we could add a dedicated column
      }
    );
  }

  /**
   * Get historical routing decisions and their outcomes
   */
  async getRoutingHistory(
    orgId: string,
    options: { persona?: string; days?: number; limit?: number } = {}
  ): Promise<
    Array<{
      taskId: string;
      persona: string;
      model: string | null;
      outcome: string;
      acceptanceRate: number;
      feedbackCount: number;
      createdAt: Date;
    }>
  > {
    const { persona, days = 30, limit = 50 } = options;
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get tasks with their associated feedback
    const qb = this.feedbackRepo
      .createQueryBuilder("f")
      .select("f.task_id", "taskId")
      .addSelect("f.persona", "persona")
      .addSelect("f.model", "model")
      .addSelect("COUNT(*)", "feedbackCount")
      .addSelect(
        "SUM(CASE WHEN f.resolution_status IN ('accepted', 'partially_accepted') THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)",
        "acceptanceRate"
      )
      .addSelect("MIN(f.created_at)", "createdAt")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.task_id IS NOT NULL")
      .andWhere("f.persona IS NOT NULL")
      .andWhere("f.created_at >= :since", { since })
      .groupBy("f.task_id")
      .addGroupBy("f.persona")
      .addGroupBy("f.model")
      .orderBy("MIN(f.created_at)", "DESC")
      .limit(limit);

    if (persona) {
      qb.andWhere("f.persona = :persona", { persona });
    }

    const results = await qb.getRawMany();

    return results.map((r) => ({
      taskId: r.taskId,
      persona: r.persona,
      model: r.model,
      outcome: parseFloat(r.acceptanceRate) >= 0.7 ? "success" : parseFloat(r.acceptanceRate) >= 0.4 ? "partial" : "failure",
      acceptanceRate: parseFloat(r.acceptanceRate) || 0,
      feedbackCount: parseInt(r.feedbackCount),
      createdAt: r.createdAt,
    }));
  }

  // Private helper methods

  private async calculateTrend(
    orgId: string,
    persona: string,
    days: number
  ): Promise<"improving" | "declining" | "stable"> {
    // Compare first half vs second half of time period
    const midpoint = new Date();
    midpoint.setDate(midpoint.getDate() - days / 2);
    const start = new Date();
    start.setDate(start.getDate() - days);

    // Get early period acceptance rate
    const early = await this.feedbackRepo
      .createQueryBuilder("f")
      .select("COUNT(*)", "total")
      .addSelect(
        "SUM(CASE WHEN f.resolution_status IN ('accepted', 'partially_accepted') THEN 1 ELSE 0 END)",
        "accepted"
      )
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona = :persona", { persona })
      .andWhere("f.created_at >= :start", { start })
      .andWhere("f.created_at < :midpoint", { midpoint })
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .getRawOne();

    // Get recent period acceptance rate
    const recent = await this.feedbackRepo
      .createQueryBuilder("f")
      .select("COUNT(*)", "total")
      .addSelect(
        "SUM(CASE WHEN f.resolution_status IN ('accepted', 'partially_accepted') THEN 1 ELSE 0 END)",
        "accepted"
      )
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona = :persona", { persona })
      .andWhere("f.created_at >= :midpoint", { midpoint })
      .andWhere("f.resolution_status != :pending", { pending: "pending" })
      .getRawOne();

    const earlyRate =
      parseInt(early.total) > 0
        ? parseInt(early.accepted) / parseInt(early.total)
        : 0;
    const recentRate =
      parseInt(recent.total) > 0
        ? parseInt(recent.accepted) / parseInt(recent.total)
        : 0;

    const diff = recentRate - earlyRate;

    if (diff > 0.1) return "improving";
    if (diff < -0.1) return "declining";
    return "stable";
  }

  private async analyzePersonaPatterns(
    orgId: string,
    persona: string,
    days: number
  ): Promise<{ strengths: string[]; weaknesses: string[] }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get feedback content for accepted suggestions
    const accepted = await this.feedbackRepo
      .createQueryBuilder("f")
      .select("f.content")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona = :persona", { persona })
      .andWhere("f.created_at >= :since", { since })
      .andWhere("f.resolution_status = :status", { status: "accepted" })
      .limit(50)
      .getRawMany();

    // Get feedback content for rejected suggestions
    const rejected = await this.feedbackRepo
      .createQueryBuilder("f")
      .select("f.content")
      .where("f.org_id = :orgId", { orgId })
      .andWhere("f.persona = :persona", { persona })
      .andWhere("f.created_at >= :since", { since })
      .andWhere("f.resolution_status = :status", { status: "rejected" })
      .limit(50)
      .getRawMany();

    // Extract keywords from feedback
    const keywords = [
      "error handling",
      "type safety",
      "testing",
      "documentation",
      "performance",
      "security",
      "naming",
      "validation",
      "async",
      "null check",
      "refactor",
      "api design",
      "database",
      "frontend",
      "backend",
    ];

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const keyword of keywords) {
      const acceptedCount = accepted.filter((f) =>
        f.content?.toLowerCase().includes(keyword)
      ).length;
      const rejectedCount = rejected.filter((f) =>
        f.content?.toLowerCase().includes(keyword)
      ).length;

      if (acceptedCount > 2 && acceptedCount > rejectedCount * 2) {
        strengths.push(keyword);
      }
      if (rejectedCount > 2 && rejectedCount > acceptedCount * 2) {
        weaknesses.push(keyword);
      }
    }

    return { strengths, weaknesses };
  }

  private getDefaultPersonaForTask(task: TaskCharacteristics): string {
    // Default persona mapping based on task type
    if (task.taskType === "bug" || task.taskType === "fix") {
      return "backend_developer";
    }
    if (task.technologies?.includes("react") || task.technologies?.includes("frontend")) {
      return "frontend_developer";
    }
    if (task.technologies?.includes("terraform") || task.technologies?.includes("aws")) {
      return "devops_engineer";
    }
    if (task.taskType === "security" || task.keywords?.includes("security")) {
      return "security_engineer";
    }
    if (task.taskType === "test" || task.keywords?.includes("test")) {
      return "qa_engineer";
    }
    return "backend_developer";
  }

  private filterSuitablePersonas(
    scores: RoutingScore[],
    task: TaskCharacteristics
  ): RoutingScore[] {
    // Filter based on task characteristics matching persona strengths
    return scores.filter((s) => {
      // Check if persona's strengths match task needs
      if (task.keywords) {
        const matchesStrength = s.strengths.some((str) =>
          task.keywords!.some(
            (k) => str.includes(k.toLowerCase()) || k.toLowerCase().includes(str)
          )
        );
        if (matchesStrength) return true;
      }

      // Check if task doesn't hit persona's weaknesses
      if (task.keywords) {
        const hitsWeakness = s.weaknesses.some((w) =>
          task.keywords!.some(
            (k) => w.includes(k.toLowerCase()) || k.toLowerCase().includes(w)
          )
        );
        if (hitsWeakness && s.score < 0.6) return false;
      }

      // Include if score is reasonable
      return s.score >= 0.4;
    });
  }

  private matchesTask(pattern: string, task: TaskCharacteristics): boolean {
    const searchTerms = [
      task.taskType,
      ...(task.technologies || []),
      ...(task.keywords || []),
    ].filter(Boolean);

    return searchTerms.some(
      (term) =>
        pattern.includes(term!.toLowerCase()) ||
        term!.toLowerCase().includes(pattern)
    );
  }

  private generateReasoning(score: RoutingScore, task: TaskCharacteristics): string {
    const parts: string[] = [];

    parts.push(
      `${score.persona} has a ${(score.acceptanceRate * 100).toFixed(0)}% acceptance rate`
    );

    if (score.totalFeedback >= 20) {
      parts.push(`based on ${score.totalFeedback} feedback items`);
    }

    if (score.recentTrend === "improving") {
      parts.push("with improving recent performance");
    }

    if (score.strengths.length > 0 && task.keywords) {
      const matchingStrengths = score.strengths.filter((s) =>
        task.keywords!.some((k) => s.includes(k.toLowerCase()))
      );
      if (matchingStrengths.length > 0) {
        parts.push(`and strengths in ${matchingStrengths.join(", ")}`);
      }
    }

    return parts.join(" ") + ".";
  }

  private generateAlternativeReason(
    score: RoutingScore,
    task: TaskCharacteristics
  ): string {
    if (score.strengths.length > 0) {
      return `Strong in ${score.strengths.slice(0, 2).join(", ")} (${(score.acceptanceRate * 100).toFixed(0)}% acceptance)`;
    }
    return `${(score.acceptanceRate * 100).toFixed(0)}% acceptance rate`;
  }
}

// Export singleton instance
export const feedbackRouter = new FeedbackRouter();
