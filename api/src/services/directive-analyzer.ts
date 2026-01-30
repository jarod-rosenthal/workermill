/**
 * DirectiveAnalyzer Service
 *
 * Analyzes directive effectiveness and provides insights for improvement.
 * Identifies underperforming directives, suggests deprecations, and finds gaps.
 */

import { AppDataSource } from "../db/connection.js";
import {
  WorkerTask,
  PersonaDirective,
  Persona,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

/**
 * Health status for a directive
 */
export interface DirectiveHealth {
  directiveId: string;
  personaSlug: string;
  type: string;
  filename: string | null;
  version: number;
  isActive: boolean;
  healthScore: number; // 0-100
  healthStatus: "healthy" | "warning" | "critical" | "unknown";
  usageCount: number;
  successRate: number | null;
  avgQualityScore: number | null;
  issues: string[];
  recommendations: string[];
}

/**
 * Deprecation candidate with reason
 */
export interface DeprecationCandidate {
  directiveId: string;
  personaSlug: string;
  type: string;
  filename: string | null;
  version: number;
  reason: string;
  score: number; // 0-100, higher = more likely should be deprecated
  usageCount: number;
  successRate: number | null;
  lastUsedAt: Date | null;
  betterAlternative?: {
    directiveId: string;
    version: number;
    successRate: number | null;
  };
}

/**
 * Failure pattern analysis
 */
export interface FailureAnalysis {
  directiveId: string;
  totalFailures: number;
  failurePatterns: FailurePattern[];
  commonErrorTypes: { type: string; count: number }[];
  affectedPersonas: string[];
  timeTrend: "improving" | "stable" | "degrading" | "unknown";
}

/**
 * Single failure pattern
 */
export interface FailurePattern {
  pattern: string;
  count: number;
  percentage: number;
  examples: string[];
}

/**
 * Identified gap in directive coverage
 */
export interface DirectiveGap {
  personaSlug: string;
  gapType: "missing_readme" | "low_quality" | "no_common" | "high_failure_rate";
  description: string;
  severity: "low" | "medium" | "high";
  recommendation: string;
  affectedTaskCount?: number;
}

// ============================================================================
// Health Analysis
// ============================================================================

/**
 * Find underperforming directives based on success rate threshold.
 */
export async function findUnderperformingDirectives(
  orgId: string,
  threshold: number = 0.7
): Promise<DirectiveHealth[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const directives = await directiveRepo
    .createQueryBuilder("d")
    .innerJoinAndSelect("d.persona", "p")
    .where("(d.org_id = :orgId OR d.org_id IS NULL)", { orgId })
    .andWhere("d.is_active = true")
    .andWhere("d.usage_count >= :minUsage", { minUsage: 5 }) // Need enough samples
    .getMany();

  const results: DirectiveHealth[] = [];

  for (const d of directives) {
    const successRate = d.getSuccessRate();
    const health = analyzeDirectiveHealth(d, successRate);

    // Include if success rate is below threshold or has issues
    if (successRate !== null && successRate < threshold) {
      results.push(health);
    } else if (health.healthStatus === "warning" || health.healthStatus === "critical") {
      results.push(health);
    }
  }

  // Sort by health score ascending (worst first)
  return results.sort((a, b) => a.healthScore - b.healthScore);
}

/**
 * Get health report for all directives in an organization.
 */
export async function getDirectiveHealthReport(
  orgId: string
): Promise<DirectiveHealth[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const directives = await directiveRepo
    .createQueryBuilder("d")
    .innerJoinAndSelect("d.persona", "p")
    .where("(d.org_id = :orgId OR d.org_id IS NULL)", { orgId })
    .andWhere("d.is_active = true")
    .andWhere("d.deprecated_at IS NULL")
    .orderBy("d.usage_count", "DESC")
    .getMany();

  return directives.map((d) => {
    const successRate = d.getSuccessRate();
    return analyzeDirectiveHealth(d, successRate);
  });
}

/**
 * Analyze health of a single directive.
 */
function analyzeDirectiveHealth(
  directive: PersonaDirective,
  successRate: number | null
): DirectiveHealth {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let healthScore = 100;

  // Check success rate
  if (successRate !== null) {
    if (successRate < 0.5) {
      issues.push(`Very low success rate: ${(successRate * 100).toFixed(1)}%`);
      recommendations.push("Consider rewriting this directive or deprecating it");
      healthScore -= 40;
    } else if (successRate < 0.7) {
      issues.push(`Below average success rate: ${(successRate * 100).toFixed(1)}%`);
      recommendations.push("Review recent failures and update directive content");
      healthScore -= 20;
    }
  }

  // Check quality score
  if (directive.avgQualityScore !== null) {
    if (directive.avgQualityScore < 50) {
      issues.push(`Low average quality score: ${directive.avgQualityScore.toFixed(1)}`);
      recommendations.push("Add more specific quality requirements to directive");
      healthScore -= 15;
    }
  }

  // Check usage freshness
  if (directive.lastUsedAt) {
    const daysSinceLastUse = (Date.now() - directive.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastUse > 30) {
      issues.push(`Not used in ${Math.floor(daysSinceLastUse)} days`);
      if (daysSinceLastUse > 90) {
        recommendations.push("Consider deprecating unused directive");
        healthScore -= 10;
      }
    }
  }

  // Check sample size
  if (directive.usageCount < 5) {
    issues.push("Insufficient usage data for reliable metrics");
    healthScore = Math.max(healthScore, 50); // Cap score due to uncertainty
  }

  // Determine health status
  let healthStatus: DirectiveHealth["healthStatus"] = "unknown";
  if (directive.usageCount >= 5) {
    if (healthScore >= 80) {
      healthStatus = "healthy";
    } else if (healthScore >= 60) {
      healthStatus = "warning";
    } else {
      healthStatus = "critical";
    }
  }

  return {
    directiveId: directive.id,
    personaSlug: directive.persona?.slug || "unknown",
    type: directive.type,
    filename: directive.filename,
    version: directive.version,
    isActive: directive.isActive,
    healthScore: Math.max(0, healthScore),
    healthStatus,
    usageCount: directive.usageCount,
    successRate,
    avgQualityScore: directive.avgQualityScore,
    issues,
    recommendations,
  };
}

// ============================================================================
// Failure Analysis
// ============================================================================

/**
 * Analyze failure patterns for a specific directive.
 */
export async function analyzeFailurePatterns(
  directiveId: string
): Promise<FailureAnalysis | null> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const directive = await directiveRepo.findOne({ where: { id: directiveId } });
  if (!directive) {
    return null;
  }

  // Find failed tasks that used this directive
  const failedTasks = await taskRepo
    .createQueryBuilder("t")
    .where("t.status = :status", { status: "failed" })
    .andWhere("t.directives_used @> :directiveFilter", {
      directiveFilter: JSON.stringify([{ directiveId }]),
    })
    .orderBy("t.created_at", "DESC")
    .limit(100)
    .getMany();

  if (failedTasks.length === 0) {
    return {
      directiveId,
      totalFailures: 0,
      failurePatterns: [],
      commonErrorTypes: [],
      affectedPersonas: [],
      timeTrend: "unknown",
    };
  }

  // Analyze error messages
  const errorCounts = new Map<string, { count: number; examples: string[] }>();
  const personaSet = new Set<string>();

  for (const task of failedTasks) {
    personaSet.add(task.workerPersona);

    if (task.errorMessage) {
      // Normalize error message for grouping
      const normalizedError = normalizeErrorMessage(task.errorMessage);
      const existing = errorCounts.get(normalizedError);
      if (existing) {
        existing.count++;
        if (existing.examples.length < 3) {
          existing.examples.push(task.errorMessage.slice(0, 200));
        }
      } else {
        errorCounts.set(normalizedError, {
          count: 1,
          examples: [task.errorMessage.slice(0, 200)],
        });
      }
    }
  }

  // Convert to failure patterns
  const failurePatterns: FailurePattern[] = Array.from(errorCounts.entries())
    .map(([pattern, data]) => ({
      pattern,
      count: data.count,
      percentage: (data.count / failedTasks.length) * 100,
      examples: data.examples,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Determine time trend (compare first half vs second half of failures)
  let timeTrend: FailureAnalysis["timeTrend"] = "unknown";
  if (failedTasks.length >= 10) {
    const midpoint = Math.floor(failedTasks.length / 2);
    const recentFailures = failedTasks.slice(0, midpoint).length;
    const olderFailures = failedTasks.slice(midpoint).length;

    // If recent failures are significantly more/less than older
    const ratio = recentFailures / olderFailures;
    if (ratio > 1.3) {
      timeTrend = "degrading";
    } else if (ratio < 0.7) {
      timeTrend = "improving";
    } else {
      timeTrend = "stable";
    }
  }

  return {
    directiveId,
    totalFailures: failedTasks.length,
    failurePatterns,
    commonErrorTypes: failurePatterns.slice(0, 5).map((p) => ({
      type: p.pattern,
      count: p.count,
    })),
    affectedPersonas: Array.from(personaSet),
    timeTrend,
  };
}

/**
 * Normalize error message for grouping similar errors.
 */
function normalizeErrorMessage(message: string): string {
  return message
    .replace(/\d+/g, "N") // Replace numbers
    .replace(/0x[a-fA-F0-9]+/g, "ADDR") // Replace hex addresses
    .replace(/\/[^\s:]+/g, "PATH") // Replace paths
    .replace(/\b[a-f0-9-]{36}\b/gi, "UUID") // Replace UUIDs
    .slice(0, 100);
}

// ============================================================================
// Deprecation Analysis
// ============================================================================

/**
 * Get directives that are candidates for deprecation.
 */
export async function getDeprecationCandidates(
  orgId: string
): Promise<DeprecationCandidate[]> {
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);

  const directives = await directiveRepo
    .createQueryBuilder("d")
    .innerJoinAndSelect("d.persona", "p")
    .where("(d.org_id = :orgId OR d.org_id IS NULL)", { orgId })
    .andWhere("d.is_active = true")
    .andWhere("d.deprecated_at IS NULL")
    .getMany();

  const candidates: DeprecationCandidate[] = [];

  for (const d of directives) {
    const candidate = analyzeForDeprecation(d, directives);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // Sort by deprecation score descending
  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Analyze a directive for potential deprecation.
 */
function analyzeForDeprecation(
  directive: PersonaDirective,
  allDirectives: PersonaDirective[]
): DeprecationCandidate | null {
  const successRate = directive.getSuccessRate();
  let score = 0;
  let reason = "";

  // Check for very low success rate
  if (successRate !== null && successRate < 0.4 && directive.usageCount >= 10) {
    score += 40;
    reason = `Very low success rate (${(successRate * 100).toFixed(1)}%)`;
  }

  // Check for staleness
  if (directive.lastUsedAt) {
    const daysSinceLastUse = (Date.now() - directive.lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastUse > 90) {
      score += 30;
      reason = reason || `Not used in ${Math.floor(daysSinceLastUse)} days`;
    }
  } else if (directive.usageCount === 0) {
    score += 20;
    reason = reason || "Never used";
  }

  // Check if there's a better version
  const betterVersion = findBetterVersion(directive, allDirectives);
  if (betterVersion) {
    score += 25;
    reason = reason || `Superseded by version ${betterVersion.version}`;
  }

  // Only return if score is significant
  if (score < 30) {
    return null;
  }

  return {
    directiveId: directive.id,
    personaSlug: directive.persona?.slug || "unknown",
    type: directive.type,
    filename: directive.filename,
    version: directive.version,
    reason,
    score: Math.min(100, score),
    usageCount: directive.usageCount,
    successRate,
    lastUsedAt: directive.lastUsedAt,
    betterAlternative: betterVersion,
  };
}

/**
 * Find a better performing version of the same directive.
 */
function findBetterVersion(
  directive: PersonaDirective,
  allDirectives: PersonaDirective[]
): { directiveId: string; version: number; successRate: number | null } | undefined {
  const currentSuccessRate = directive.getSuccessRate() ?? 0;

  // Find other versions of the same directive
  const sameDirectives = allDirectives.filter(
    (d) =>
      d.id !== directive.id &&
      d.personaId === directive.personaId &&
      d.type === directive.type &&
      d.filename === directive.filename
  );

  // Find one with better success rate (and enough samples)
  let best: PersonaDirective | null = null;
  let bestRate = currentSuccessRate;

  for (const d of sameDirectives) {
    const rate = d.getSuccessRate();
    if (rate !== null && d.usageCount >= 5 && rate > bestRate + 0.1) {
      best = d;
      bestRate = rate;
    }
  }

  if (best) {
    return {
      directiveId: best.id,
      version: best.version,
      successRate: best.getSuccessRate(),
    };
  }

  return undefined;
}

// ============================================================================
// Gap Analysis
// ============================================================================

/**
 * Identify gaps in directive coverage for an organization.
 */
export async function identifyDirectiveGaps(
  orgId: string
): Promise<DirectiveGap[]> {
  const personaRepo = AppDataSource.getRepository(Persona);
  const directiveRepo = AppDataSource.getRepository(PersonaDirective);
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const gaps: DirectiveGap[] = [];

  // Get all enabled personas
  const personas = await personaRepo.find({
    where: [{ orgId }, { orgId: null as unknown as undefined }], // System + org personas
  });

  for (const persona of personas) {
    if (!persona.enabled || persona.slug === "__common__") continue;

    // Check for missing readme directive
    const readme = await directiveRepo.findOne({
      where: {
        personaId: persona.id,
        type: "readme",
        isActive: true,
      },
    });

    if (!readme) {
      gaps.push({
        personaSlug: persona.slug,
        gapType: "missing_readme",
        description: `Persona "${persona.name}" has no active README directive`,
        severity: "high",
        recommendation: "Create a README directive to define persona behavior",
      });
      continue;
    }

    // Check for low quality readme
    if (readme.usageCount >= 10 && readme.avgQualityScore !== null && readme.avgQualityScore < 60) {
      gaps.push({
        personaSlug: persona.slug,
        gapType: "low_quality",
        description: `Persona "${persona.name}" has low average quality score (${readme.avgQualityScore.toFixed(1)})`,
        severity: "medium",
        recommendation: "Update directive to include more specific quality requirements",
      });
    }

    // Check for high failure rate
    const successRate = readme.getSuccessRate();
    if (successRate !== null && successRate < 0.6 && readme.usageCount >= 10) {
      // Count affected tasks
      const failedCount = await taskRepo.count({
        where: {
          orgId,
          workerPersona: persona.slug,
          status: "failed",
        },
      });

      gaps.push({
        personaSlug: persona.slug,
        gapType: "high_failure_rate",
        description: `Persona "${persona.name}" has ${(successRate * 100).toFixed(1)}% success rate`,
        severity: "high",
        recommendation: "Analyze failure patterns and update directive content",
        affectedTaskCount: failedCount,
      });
    }
  }

  // Sort by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  return gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}
