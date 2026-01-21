/**
 * Dual Scoring Service (Scope + Risk)
 *
 * Calculates deterministic scores from PRD inventory.
 * This replaces the LLM-based 4-dimension scoring with a
 * 2-dimensional system that separates "how much work" (Scope)
 * from "how risky/uncertain" (Risk).
 */

import { PRDInventory } from "./planning-inventory.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// SCORE TYPES
// ============================================================================

/**
 * Dual score result from inventory analysis
 */
export interface DualScore {
  /** Scope score (0-100): How much work is there? */
  scope: number;
  /** Risk score (0-100): How uncertain/risky is the work? */
  risk: number;
  /** Whether the PRD should be decomposed into multiple stories */
  shouldDecompose: boolean;
  /** Target number of stories */
  targetStories: number;
  /** Breakdown of scope calculation */
  scopeBreakdown: Record<string, number>;
  /** Breakdown of risk calculation */
  riskBreakdown: Record<string, number>;
  /** Human-readable summary */
  summary: string;
}

// ============================================================================
// SCOPE SCORING
// ============================================================================

/**
 * Weights for each inventory category when calculating scope.
 * Higher weight = more scope impact per item.
 *
 * These weights are initial estimates and should be tuned
 * based on actual execution data.
 *
 * NOTE: Subsystems are NOT included in scope - they're only in risk.
 * Scope measures "how much work," risk measures "coordination overhead."
 * Including subsystems in both would double-count coordination concerns.
 */
const SCOPE_WEIGHTS: Record<string, number> = {
  journeys: 8,        // Each journey is significant work
  uiSurfaces: 5,      // UI components require design + implementation
  apiEndpoints: 3,    // Endpoints are usually well-defined
  entities: 5,        // Data models need design + migration
  integrations: 8,    // External integrations are complex
  migrations: 10,     // Migrations are risky and need careful handling
  nonFunctionals: 4,  // NFRs require cross-cutting implementation
  // subsystems intentionally omitted - only counted in risk scoring
};

/**
 * Calculate scope score from inventory counts.
 * Returns a value 0-100 (capped).
 */
export function calculateScopeScore(inventory: PRDInventory): {
  score: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Count each category and apply weights
  // NOTE: subsystems excluded - only counted in risk scoring
  const counts: Record<string, number> = {
    journeys: inventory.journeys.length,
    uiSurfaces: inventory.uiSurfaces.length,
    apiEndpoints: inventory.apiEndpoints.length,
    entities: inventory.entities.length,
    integrations: inventory.integrations.length,
    migrations: inventory.migrations.length,
    nonFunctionals: inventory.nonFunctionals.length,
  };

  for (const [category, count] of Object.entries(counts)) {
    const weight = SCOPE_WEIGHTS[category] || 1;
    const contribution = count * weight;
    breakdown[category] = contribution;
    total += contribution;
  }

  // Cap at 100
  const score = Math.min(total, 100);

  return { score, breakdown };
}

// ============================================================================
// RISK SCORING
// ============================================================================

/**
 * Calculate risk score from inventory signals.
 * Returns a value 0-100 (capped).
 */
export function calculateRiskScore(inventory: PRDInventory): {
  score: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Blocking unknowns are very risky
  const blockingUnknowns = inventory.unknowns.filter(u => u.blocking).length;
  const nonBlockingUnknowns = inventory.unknowns.filter(u => !u.blocking).length;
  breakdown.blockingUnknowns = blockingUnknowns * 15;
  breakdown.nonBlockingUnknowns = nonBlockingUnknowns * 5;
  total += breakdown.blockingUnknowns + breakdown.nonBlockingUnknowns;

  // High-risk migrations
  const highRiskMigrations = inventory.migrations.filter(m => m.riskLevel === "high").length;
  const mediumRiskMigrations = inventory.migrations.filter(m => m.riskLevel === "medium").length;
  breakdown.highRiskMigrations = highRiskMigrations * 12;
  breakdown.mediumRiskMigrations = mediumRiskMigrations * 6;
  total += breakdown.highRiskMigrations + breakdown.mediumRiskMigrations;

  // External integrations are inherently risky
  breakdown.integrations = inventory.integrations.length * 8;
  total += breakdown.integrations;

  // Security requirements add risk
  const securityReqs = inventory.nonFunctionals.filter(nf => nf.category === "security").length;
  breakdown.securityRequirements = securityReqs * 10;
  total += breakdown.securityRequirements;

  // Performance requirements add risk
  const perfReqs = inventory.nonFunctionals.filter(nf => nf.category === "performance").length;
  breakdown.performanceRequirements = perfReqs * 7;
  total += breakdown.performanceRequirements;

  // Penalty for touching many subsystems (coordination risk)
  const subsystemPenalty = Math.max(0, inventory.subsystems.length - 2) * 4;
  breakdown.subsystemCountPenalty = subsystemPenalty;
  total += subsystemPenalty;

  // Compliance requirements add risk
  const complianceReqs = inventory.nonFunctionals.filter(nf => nf.category === "compliance").length;
  breakdown.complianceRequirements = complianceReqs * 8;
  total += breakdown.complianceRequirements;

  // Complexity flags for "small but hard" patterns
  // Each flag adds risk even if scope seems small
  const complexityFlagCount = inventory.complexityFlags?.length || 0;
  breakdown.complexityFlags = complexityFlagCount * 8;
  total += breakdown.complexityFlags;

  // Cap at 100
  const score = Math.min(total, 100);

  return { score, breakdown };
}

// ============================================================================
// DECOMPOSITION DECISION
// ============================================================================

/**
 * Determine if a PRD should be decomposed into multiple stories.
 */
export function shouldDecompose(
  scopeScore: number,
  riskScore: number,
  inventory: PRDInventory
): boolean {
  // Single story only if:
  // 1. Small scope (≤15)
  // 2. Low risk (≤12)
  // 3. No migrations (migrations always need separate stories)
  // 4. No integrations (integrations need separate handling)

  if (scopeScore <= 15 &&
      riskScore <= 12 &&
      inventory.migrations.length === 0 &&
      inventory.integrations.length === 0) {
    return false;
  }

  return true;
}

/**
 * Calculate target number of stories based on scope and risk.
 *
 * The formula:
 * - base_stories = ceil(scope / k) where k is target scope per story
 * - risk_multiplier = 1 + min(risk, 40) / 80  (caps at 1.5x)
 * - target = round(base_stories * risk_multiplier)
 *
 * Clamped to 1-40 stories.
 */
export function calculateTargetStories(
  scopeScore: number,
  riskScore: number
): number {
  // Target scope points per story (tune based on actual execution data)
  const k = 12;

  const baseStories = Math.ceil(scopeScore / k);

  // Risk multiplier: caps at 1.5x for very risky PRDs
  const riskMultiplier = 1 + Math.min(riskScore, 40) / 80;

  const target = Math.round(baseStories * riskMultiplier);

  // Clamp to 1-40 stories
  return Math.max(1, Math.min(target, 40));
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

/**
 * Calculate the dual score for a PRD inventory.
 */
export function calculateDualScore(inventory: PRDInventory): DualScore {
  const { score: scopeScore, breakdown: scopeBreakdown } = calculateScopeScore(inventory);
  const { score: riskScore, breakdown: riskBreakdown } = calculateRiskScore(inventory);

  const decompose = shouldDecompose(scopeScore, riskScore, inventory);
  const targetStories = decompose ? calculateTargetStories(scopeScore, riskScore) : 1;

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Scope: ${scopeScore}/100`);
  summaryParts.push(`Risk: ${riskScore}/100`);
  summaryParts.push(decompose
    ? `Decompose: Yes (target ${targetStories} stories)`
    : `Decompose: No (single story)`
  );

  if (riskBreakdown.blockingUnknowns > 0) {
    summaryParts.push(`⚠️ ${inventory.unknowns.filter(u => u.blocking).length} blocking unknown(s)`);
  }

  const summary = summaryParts.join(" | ");

  logger.info("Dual score calculated", {
    scope: scopeScore,
    risk: riskScore,
    shouldDecompose: decompose,
    targetStories,
    scopeBreakdown,
    riskBreakdown,
  });

  return {
    scope: scopeScore,
    risk: riskScore,
    shouldDecompose: decompose,
    targetStories,
    scopeBreakdown,
    riskBreakdown,
    summary,
  };
}

// ============================================================================
// COMPLEXITY MAPPING (for backward compatibility)
// ============================================================================

/**
 * Map dual score to the old 4-12 complexity score for backward compatibility.
 * This allows gradual migration without breaking existing code.
 */
export function mapToLegacyComplexityScore(dualScore: DualScore): {
  totalScore: number;
  dimensions: {
    features: number;
    layers: number;
    files: number;
    clarity: number;
  };
  recommendation: "single" | "multi";
  maxStories: number;
  targetStories: { min: number; target: number; max: number };
  reasoning: string;
} {
  // Map scope to features (1-3)
  // 0-30 = 1, 31-60 = 2, 61+ = 3
  const features = dualScore.scope <= 30 ? 1 : dualScore.scope <= 60 ? 2 : 3;

  // Estimate layers from subsystems
  // 1 subsystem = 1, 2-3 subsystems = 2, 4+ = 3
  const subsystemCount = Object.keys(dualScore.scopeBreakdown).length > 0
    ? Math.ceil(dualScore.scopeBreakdown.subsystems / 6) // Each subsystem contributes 6 to scope
    : 1;
  const layers = subsystemCount <= 1 ? 1 : subsystemCount <= 3 ? 2 : 3;

  // Estimate files from scope
  // 0-25 = 1, 26-50 = 2, 51+ = 3
  const files = dualScore.scope <= 25 ? 1 : dualScore.scope <= 50 ? 2 : 3;

  // Map risk to clarity (inverse: high risk = low clarity)
  // 0-20 = 1 (clear), 21-50 = 2 (some ambiguity), 51+ = 3 (needs investigation)
  const clarity = dualScore.risk <= 20 ? 1 : dualScore.risk <= 50 ? 2 : 3;

  const totalScore = features + layers + files + clarity;

  // Calculate target story range
  const targetMin = Math.max(1, Math.floor(dualScore.targetStories * 0.7));
  const targetMax = Math.ceil(dualScore.targetStories * 1.3);

  return {
    totalScore,
    dimensions: { features, layers, files, clarity },
    recommendation: dualScore.shouldDecompose ? "multi" : "single",
    maxStories: dualScore.shouldDecompose ? Math.ceil(targetMax * 1.5) : 1,
    targetStories: {
      min: targetMin,
      target: dualScore.targetStories,
      max: targetMax,
    },
    reasoning: `Dual score: Scope=${dualScore.scope}, Risk=${dualScore.risk}. ${dualScore.summary}`,
  };
}

// ============================================================================
// SCORE THRESHOLDS
// ============================================================================

/**
 * Threshold constants for score-based decisions.
 * These can be tuned based on execution data.
 */
export const SCORE_THRESHOLDS = {
  /** Scope below which we consider PRD "small" */
  SMALL_SCOPE: 15,
  /** Risk below which we consider PRD "low risk" */
  LOW_RISK: 12,
  /** Risk above which we add extra stories for safety */
  HIGH_RISK: 50,
  /** Target scope points per story */
  SCOPE_PER_STORY: 12,
  /** Maximum risk multiplier for story count */
  MAX_RISK_MULTIPLIER: 1.5,
};

/**
 * Get human-readable risk level
 */
export function getRiskLevel(riskScore: number): "low" | "medium" | "high" | "critical" {
  if (riskScore <= 15) return "low";
  if (riskScore <= 40) return "medium";
  if (riskScore <= 70) return "high";
  return "critical";
}

/**
 * Get human-readable scope level
 */
export function getScopeLevel(scopeScore: number): "trivial" | "small" | "medium" | "large" | "massive" {
  if (scopeScore <= 10) return "trivial";
  if (scopeScore <= 25) return "small";
  if (scopeScore <= 50) return "medium";
  if (scopeScore <= 75) return "large";
  return "massive";
}
