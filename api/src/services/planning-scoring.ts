/**
 * Dual Scoring Service (Scope + Risk)
 *
 * Calculates deterministic scores from PRD inventory.
 * This replaces the LLM-based 4-dimension scoring with a
 * 2-dimensional system that separates "how much work" (Scope)
 * from "how risky/uncertain" (Risk).
 */

import { PRDInventory, ItemComplexity, ChangeType } from "./planning-inventory.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// STORY COUNT CAPS (to prevent over-extraction)
// ============================================================================

/** Default maximum stories per journey (used for normal-risk PRDs) */
export const DEFAULT_MAX_STORIES_PER_JOURNEY = 4;

/** Maximum stories per journey for high-risk PRDs */
export const HIGH_RISK_MAX_STORIES_PER_JOURNEY = 8;

/** Absolute maximum stories for any PRD (hard cap) */
export const ABSOLUTE_MAX_STORIES = 20;

/** Risk threshold above which we use the higher per-journey limit */
export const HIGH_RISK_ESCALATION_THRESHOLD = 50;

/**
 * CALIBRATION MULTIPLIER - The "temperature dial" for story count.
 *
 * If the system consistently over-estimates story counts, lower this value.
 * If it under-estimates, raise it.
 *
 * Examples:
 * - 1.0 = no adjustment (use raw calculated count)
 * - 0.5 = halve the story count (23 → 12)
 * - 0.4 = 40% of calculated (23 → 9)
 * - 0.3 = 30% of calculated (23 → 7)
 *
 * This is applied AFTER all other calculations as a final adjustment.
 */
export const STORY_CALIBRATION_MULTIPLIER = 0.4;

// ============================================================================
// SCORE TYPES
// ============================================================================

/**
 * Dual score result from inventory analysis
 */
export interface DualScore {
  /** Scope score (0-100): How much work is there? (normalized for display) */
  scope: number;
  /** Risk score (0-100): How uncertain/risky is the work? (normalized for display) */
  risk: number;
  /** Raw unbounded scope score used for calculations */
  scopeRaw: number;
  /** Raw unbounded risk score used for calculations */
  riskRaw: number;
  /** Whether the PRD should be decomposed into multiple stories */
  shouldDecompose: boolean;
  /** Target number of stories */
  targetStories: number;
  /** Mandatory story counts by bucket type */
  mandatoryStories: MandatoryStoryBuckets;
  /** Breakdown of scope calculation */
  scopeBreakdown: Record<string, number>;
  /** Breakdown of risk calculation */
  riskBreakdown: Record<string, number>;
  /** Human-readable summary */
  summary: string;
}

/**
 * Mandatory story allocations that must be created regardless of scope
 */
export interface MandatoryStoryBuckets {
  /** One spike story per blocking unknown (or grouped) */
  spikeStories: number;
  /** One story per migration, +1 for high-risk migrations */
  migrationStories: number;
  /** 2 stories for new integrations, 1 for existing */
  integrationStories: number;
  /** Stories for security/compliance/performance NFRs */
  nfrStories: number;
  /** Total mandatory stories */
  total: number;
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
 * Complexity multipliers for per-item weighting.
 * Applied to scope weights to capture "small but hard" items.
 */
export const COMPLEXITY_MULTIPLIERS: Record<ItemComplexity, number> = {
  simple: 1.0,   // Baseline effort
  medium: 1.4,   // 40% more effort
  hard: 1.9,     // 90% more effort
};

/**
 * Get complexity multiplier for an item, defaulting to medium if undefined.
 */
function getComplexityMultiplier(complexity: ItemComplexity | undefined): number {
  return COMPLEXITY_MULTIPLIERS[complexity ?? "medium"];
}

/**
 * Map migration riskLevel to equivalent complexity.
 * Used for consistent handling of migrations in complexity-weighted scoring.
 */
function mapRiskLevelToComplexity(riskLevel: "low" | "medium" | "high"): ItemComplexity {
  const mapping: Record<"low" | "medium" | "high", ItemComplexity> = {
    low: "simple",
    medium: "medium",
    high: "hard",
  };
  return mapping[riskLevel];
}

/**
 * Normalize raw score to 0-100 using saturating function.
 * Preserves ordering without hard caps. Large scores asymptote toward 100.
 *
 * Formula: 100 * (1 - e^(-raw/k))
 * - k=50 for scope (reaches ~86 at raw=100, ~98 at raw=200)
 * - k=40 for risk (reaches ~92 at raw=100, ~99 at raw=200)
 */
function normalizeScore(raw: number, k: number): number {
  return Math.round(100 * (1 - Math.exp(-raw / k)));
}

/**
 * Calculate scope score from inventory with per-item complexity weighting.
 * Returns both raw (unbounded) and normalized (0-100) scores.
 *
 * Instead of flat counts (journeys.length * weight), we now sum:
 *   item_weight * complexity_multiplier for each item
 *
 * This captures "small but hard" items that would be underestimated
 * by simple counting.
 */
export function calculateScopeScore(inventory: PRDInventory): {
  scoreRaw: number;
  scoreNormalized: number;
  breakdown: Record<string, number>;
} {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Calculate complexity-weighted scores for each category
  // NOTE: subsystems excluded - only counted in risk scoring

  // Journeys
  const journeyScore = inventory.journeys.reduce(
    (sum, j) => sum + SCOPE_WEIGHTS.journeys * getComplexityMultiplier(j.complexity),
    0
  );
  breakdown.journeys = Math.round(journeyScore * 10) / 10;
  total += journeyScore;

  // UI Surfaces
  const uiScore = inventory.uiSurfaces.reduce(
    (sum, ui) => sum + SCOPE_WEIGHTS.uiSurfaces * getComplexityMultiplier(ui.complexity),
    0
  );
  breakdown.uiSurfaces = Math.round(uiScore * 10) / 10;
  total += uiScore;

  // API Endpoints
  const apiScore = inventory.apiEndpoints.reduce(
    (sum, api) => sum + SCOPE_WEIGHTS.apiEndpoints * getComplexityMultiplier(api.complexity),
    0
  );
  breakdown.apiEndpoints = Math.round(apiScore * 10) / 10;
  total += apiScore;

  // Entities
  const entityScore = inventory.entities.reduce(
    (sum, e) => sum + SCOPE_WEIGHTS.entities * getComplexityMultiplier(e.complexity),
    0
  );
  breakdown.entities = Math.round(entityScore * 10) / 10;
  total += entityScore;

  // Integrations
  const integrationScore = inventory.integrations.reduce(
    (sum, i) => sum + SCOPE_WEIGHTS.integrations * getComplexityMultiplier(i.complexity),
    0
  );
  breakdown.integrations = Math.round(integrationScore * 10) / 10;
  total += integrationScore;

  // Migrations (use riskLevel mapped to complexity)
  const migrationScore = inventory.migrations.reduce(
    (sum, m) => sum + SCOPE_WEIGHTS.migrations * getComplexityMultiplier(mapRiskLevelToComplexity(m.riskLevel)),
    0
  );
  breakdown.migrations = Math.round(migrationScore * 10) / 10;
  total += migrationScore;

  // Non-Functionals
  const nfrScore = inventory.nonFunctionals.reduce(
    (sum, nf) => sum + SCOPE_WEIGHTS.nonFunctionals * getComplexityMultiplier(nf.complexity),
    0
  );
  breakdown.nonFunctionals = Math.round(nfrScore * 10) / 10;
  total += nfrScore;

  // Raw score is unbounded - used for story count calculation
  const scoreRaw = Math.round(total * 10) / 10;
  // Normalized score (0-100) for display only
  const scoreNormalized = normalizeScore(total, 50);

  return { scoreRaw, scoreNormalized, breakdown };
}

// ============================================================================
// RISK SCORING
// ============================================================================

/**
 * Calculate risk score from inventory signals.
 * Returns both raw (unbounded) and normalized (0-100) scores.
 */
export function calculateRiskScore(inventory: PRDInventory): {
  scoreRaw: number;
  scoreNormalized: number;
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

  // Raw score is unbounded - used for mandatory bucket calculation
  const scoreRaw = total;
  // Normalized score (0-100) for display only
  const scoreNormalized = normalizeScore(total, 40);

  return { scoreRaw, scoreNormalized, breakdown };
}

// ============================================================================
// MANDATORY STORY BUCKETS
// ============================================================================

/**
 * Helper to check if an item represents real work (new or modify).
 * For backward compatibility, undefined changeType is treated as "new" work.
 */
function isRealWork(changeType: ChangeType | undefined): boolean {
  // Treat undefined as "new" for backward compatibility with old inventory data
  if (changeType === undefined) return true;
  return changeType === "new" || changeType === "modify";
}

/**
 * Calculate mandatory story allocations based on inventory.
 * These stories must be created regardless of scope calculation.
 *
 * IMPORTANT: Only counts items with changeType "new" or "modify".
 * Items with changeType "existing" do NOT generate mandatory stories.
 *
 * Rules:
 * - Spikes: 1 per 2 blocking unknowns (capped at 3)
 * - Migrations: 1 per new/modify migration + 1 extra for high-risk
 * - Integrations: 2 for NEW integrations only (not existing)
 * - NFRs: Only actionable NFRs with changeType new/modify count
 */
export function calculateMandatoryStories(inventory: PRDInventory): MandatoryStoryBuckets {
  // Spike stories for blocking unknowns (capped at 3)
  const blockingUnknowns = inventory.unknowns.filter(u => u.blocking).length;
  const spikeStories = blockingUnknowns > 0 ? Math.min(3, Math.ceil(blockingUnknowns / 2)) : 0;

  // Migration stories - only count new/modify migrations
  const realMigrations = inventory.migrations.filter(m => isRealWork(m.changeType));
  const highRiskMigrations = realMigrations.filter(m => m.riskLevel === "high").length;
  const migrationStories = realMigrations.length + highRiskMigrations;

  // Integration stories - only NEW integrations get stories
  // Existing integrations (changeType: "existing") don't need setup work
  const newIntegrations = inventory.integrations.filter(i => i.changeType === "new").length;
  // 2 stories per new integration (contract/auth + production hardening)
  const integrationStories = newIntegrations * 2;

  // NFR stories - only actionable NFRs with real work
  const actionableNFRs = inventory.nonFunctionals.filter(
    nf => nf.actionable === true && isRealWork(nf.changeType)
  );
  const securityReqs = actionableNFRs.filter(nf => nf.category === "security").length;
  const complianceReqs = actionableNFRs.filter(nf => nf.category === "compliance").length;
  const perfReqs = actionableNFRs.filter(nf => nf.category === "performance").length;
  // 1 story per security/compliance req, 1 per 2 performance reqs
  const nfrStories = securityReqs + complianceReqs + Math.ceil(perfReqs / 2);

  const total = spikeStories + migrationStories + integrationStories + nfrStories;

  return {
    spikeStories,
    migrationStories,
    integrationStories,
    nfrStories,
    total,
  };
}

// ============================================================================
// TRIVIAL TICKET DETECTION
// ============================================================================

/**
 * Thresholds for trivial ticket detection.
 * Tickets meeting ALL criteria are forced to single-story execution.
 */
export const TRIVIAL_TICKET_THRESHOLDS = {
  /** Maximum journeys for trivial (usually 1 simple flow) */
  maxJourneys: 1,
  /** Maximum new/modified UI surfaces */
  maxUiSurfaces: 2,
  /** Maximum new/modified API endpoints */
  maxApiEndpoints: 2,
  /** Maximum new/modified entities */
  maxEntities: 1,
  /** Maximum total inventory items (journeys + ui + api + entities) */
  maxTotalItems: 4,
  /** Maximum raw scope score */
  maxScopeRaw: 20,
  /** Maximum raw risk score */
  maxRiskRaw: 10,
};

/**
 * Result of trivial ticket detection with reasoning
 */
export interface TrivialTicketResult {
  isTrivial: boolean;
  reason: string;
  details: {
    journeys: number;
    uiSurfaces: number;
    apiEndpoints: number;
    entities: number;
    totalItems: number;
    hasNewMigrations: boolean;
    hasNewIntegrations: boolean;
    hasBlockingUnknowns: boolean;
  };
}

/**
 * Detect if a ticket is trivial and should be forced to single-story execution.
 *
 * Trivial tickets are small, well-defined tasks like:
 * - Bug fixes
 * - Small UI tweaks
 * - Adding a single field/endpoint
 * - Simple config changes
 *
 * This is STRICTER than the normal single-story threshold.
 * Trivial tickets bypass the full scoring system.
 */
export function detectTrivialTicket(
  inventory: PRDInventory,
  scopeRaw?: number,
  riskRaw?: number
): TrivialTicketResult {
  // Count new/modified items only (existing items don't create work)
  const newJourneys = inventory.journeys.length; // Journeys don't have changeType
  const newUiSurfaces = inventory.uiSurfaces.filter(
    u => u.changeType === "new" || u.changeType === "modify" || u.changeType === undefined
  ).length;
  const newApiEndpoints = inventory.apiEndpoints.filter(
    e => e.changeType === "new" || e.changeType === "modify" || e.changeType === undefined
  ).length;
  const newEntities = inventory.entities.filter(
    e => e.changeType === "new" || e.changeType === "modify" || e.changeType === undefined
  ).length;

  const hasNewMigrations = inventory.migrations.some(
    m => m.changeType === "new" || m.changeType === "modify" || m.changeType === undefined
  );
  const hasNewIntegrations = inventory.integrations.some(
    i => i.changeType === "new"
  );
  const hasBlockingUnknowns = inventory.unknowns.some(u => u.blocking);

  const totalItems = newJourneys + newUiSurfaces + newApiEndpoints + newEntities;

  const details = {
    journeys: newJourneys,
    uiSurfaces: newUiSurfaces,
    apiEndpoints: newApiEndpoints,
    entities: newEntities,
    totalItems,
    hasNewMigrations,
    hasNewIntegrations,
    hasBlockingUnknowns,
  };

  // Disqualifying factors (any one of these = not trivial)
  if (hasNewMigrations) {
    return { isTrivial: false, reason: "Has migrations requiring separate handling", details };
  }
  if (hasNewIntegrations) {
    return { isTrivial: false, reason: "Has new integrations requiring setup", details };
  }
  if (hasBlockingUnknowns) {
    return { isTrivial: false, reason: "Has blocking unknowns requiring investigation", details };
  }

  // Check thresholds
  const t = TRIVIAL_TICKET_THRESHOLDS;

  if (newJourneys > t.maxJourneys) {
    return { isTrivial: false, reason: `Too many journeys (${newJourneys} > ${t.maxJourneys})`, details };
  }
  if (newUiSurfaces > t.maxUiSurfaces) {
    return { isTrivial: false, reason: `Too many UI surfaces (${newUiSurfaces} > ${t.maxUiSurfaces})`, details };
  }
  if (newApiEndpoints > t.maxApiEndpoints) {
    return { isTrivial: false, reason: `Too many API endpoints (${newApiEndpoints} > ${t.maxApiEndpoints})`, details };
  }
  if (newEntities > t.maxEntities) {
    return { isTrivial: false, reason: `Too many entities (${newEntities} > ${t.maxEntities})`, details };
  }
  if (totalItems > t.maxTotalItems) {
    return { isTrivial: false, reason: `Too many total items (${totalItems} > ${t.maxTotalItems})`, details };
  }

  // Check scope/risk if provided
  if (scopeRaw !== undefined && scopeRaw > t.maxScopeRaw) {
    return { isTrivial: false, reason: `Scope too high (${scopeRaw} > ${t.maxScopeRaw})`, details };
  }
  if (riskRaw !== undefined && riskRaw > t.maxRiskRaw) {
    return { isTrivial: false, reason: `Risk too high (${riskRaw} > ${t.maxRiskRaw})`, details };
  }

  // All checks passed - this is a trivial ticket
  logger.info("Trivial ticket detected - forcing single story", {
    journeys: newJourneys,
    uiSurfaces: newUiSurfaces,
    apiEndpoints: newApiEndpoints,
    entities: newEntities,
    totalItems,
  });

  return {
    isTrivial: true,
    reason: `Trivial ticket: ${totalItems} item(s), no migrations/integrations/unknowns`,
    details,
  };
}

// ============================================================================
// DECOMPOSITION DECISION
// ============================================================================

/**
 * Determine if a PRD should be decomposed into multiple stories.
 * Uses RAW scores (unbounded) for the decision.
 *
 * Checks trivial ticket detection FIRST for fast-path single-story.
 */
export function shouldDecompose(
  scopeRaw: number,
  riskRaw: number,
  inventory: PRDInventory
): boolean {
  // FAST PATH: Check for trivial ticket first
  const trivialCheck = detectTrivialTicket(inventory, scopeRaw, riskRaw);
  if (trivialCheck.isTrivial) {
    logger.info("shouldDecompose: false (trivial ticket)", {
      reason: trivialCheck.reason,
      scopeRaw,
      riskRaw,
    });
    return false;
  }

  // Standard single-story check (slightly more permissive than trivial)
  // Single story only if ALL of these are true:
  // 1. Small scope (≤15 raw points)
  // 2. Low risk (≤12 raw points)
  // 3. No migrations (migrations always need separate stories)
  // 4. No integrations (integrations need separate handling)
  // 5. No blocking unknowns (need spike stories)

  if (scopeRaw <= 15 &&
      riskRaw <= 12 &&
      inventory.migrations.length === 0 &&
      inventory.integrations.length === 0 &&
      inventory.unknowns.filter(u => u.blocking).length === 0) {
    logger.info("shouldDecompose: false (standard threshold)", { scopeRaw, riskRaw });
    return false;
  }

  return true;
}

/**
 * Calculate target number of stories based on scope and risk.
 * Uses RAW scores (unbounded) for accurate calculation.
 *
 * Formula:
 * - Per-journey cap: journeyCount × perJourneyMax
 * - delivery_stories = ceil(scopeRaw / capacity)
 * - mandatory_stories = spikes + migrations + integrations + NFRs
 * - total = delivery_stories + mandatory_stories (capped)
 *
 * CAPS:
 * - Per-journey limit: 4 stories (8 for high-risk)
 * - Absolute max: 20 stories
 */
export function calculateTargetStories(
  scopeRaw: number,
  riskRaw: number,
  mandatoryStories: MandatoryStoryBuckets,
  journeyCount: number = 1,
  calibrationMultiplier: number = STORY_CALIBRATION_MULTIPLIER
): number {
  // Capacity: raw scope points per delivery story (tune based on actual data)
  const capacity = 12;

  // Base delivery stories from scope
  const deliveryStories = Math.max(1, Math.ceil(scopeRaw / capacity));

  // Risk adjustment: increase delivery stories for high-risk work
  const riskMultiplier = 1 + Math.min(riskRaw / 80, 0.75); // Max 1.75x
  const adjustedDeliveryStories = Math.round(deliveryStories * riskMultiplier);

  // Total before caps
  const uncappedTotal = adjustedDeliveryStories + mandatoryStories.total;

  // Apply per-journey cap
  const perJourneyMax = riskRaw > HIGH_RISK_ESCALATION_THRESHOLD
    ? HIGH_RISK_MAX_STORIES_PER_JOURNEY
    : DEFAULT_MAX_STORIES_PER_JOURNEY;
  const journeyCap = Math.max(1, journeyCount) * perJourneyMax;

  // Apply absolute cap
  const total = Math.min(uncappedTotal, journeyCap, ABSOLUTE_MAX_STORIES);

  // Log if capping was applied
  if (total < uncappedTotal) {
    logger.info("Story count capped", {
      uncappedTotal,
      cappedTotal: total,
      journeyCap,
      absoluteCap: ABSOLUTE_MAX_STORIES,
      riskRaw,
    });
  }

  // Apply calibration multiplier (the "temperature dial")
  const calibratedTotal = Math.max(1, Math.round(total * calibrationMultiplier));

  // Log calibration adjustment
  if (calibratedTotal !== total) {
    logger.info("Story count calibrated", {
      preCalibratedTotal: total,
      calibratedTotal,
      multiplier: calibrationMultiplier,
    });
  }

  return calibratedTotal;
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

/**
 * Calculate the dual score for a PRD inventory.
 * Uses unbounded raw scores for calculations, normalized scores for display.
 */
export function calculateDualScore(
  inventory: PRDInventory,
  calibrationMultiplier: number = STORY_CALIBRATION_MULTIPLIER
): DualScore {
  const { scoreRaw: scopeRaw, scoreNormalized: scopeNorm, breakdown: scopeBreakdown } = calculateScopeScore(inventory);
  const { scoreRaw: riskRaw, scoreNormalized: riskNorm, breakdown: riskBreakdown } = calculateRiskScore(inventory);
  const mandatoryStories = calculateMandatoryStories(inventory);

  const decompose = shouldDecompose(scopeRaw, riskRaw, inventory);
  // Pass journey count for per-journey capping
  const journeyCount = inventory.journeys.length;
  const targetStories = decompose ? calculateTargetStories(scopeRaw, riskRaw, mandatoryStories, journeyCount, calibrationMultiplier) : 1;

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Scope: ${scopeNorm}/100 (raw: ${scopeRaw})`);
  summaryParts.push(`Risk: ${riskNorm}/100 (raw: ${riskRaw})`);
  summaryParts.push(decompose
    ? `Decompose: Yes (${targetStories} stories)`
    : `Decompose: No (single story)`
  );

  // Show mandatory bucket breakdown if any
  if (mandatoryStories.total > 0) {
    const bucketParts: string[] = [];
    if (mandatoryStories.spikeStories > 0) bucketParts.push(`${mandatoryStories.spikeStories} spike`);
    if (mandatoryStories.migrationStories > 0) bucketParts.push(`${mandatoryStories.migrationStories} migration`);
    if (mandatoryStories.integrationStories > 0) bucketParts.push(`${mandatoryStories.integrationStories} integration`);
    if (mandatoryStories.nfrStories > 0) bucketParts.push(`${mandatoryStories.nfrStories} NFR`);
    summaryParts.push(`Mandatory: ${bucketParts.join(", ")}`);
  }

  if (riskBreakdown.blockingUnknowns > 0) {
    summaryParts.push(`⚠️ ${inventory.unknowns.filter(u => u.blocking).length} blocking unknown(s)`);
  }

  const summary = summaryParts.join(" | ");

  // Helper to count items by complexity
  const countByComplexity = <T extends { complexity?: ItemComplexity }>(items: T[]): Record<string, number> => ({
    simple: items.filter(i => i.complexity === "simple").length,
    medium: items.filter(i => i.complexity === "medium" || i.complexity === undefined).length,
    hard: items.filter(i => i.complexity === "hard").length,
  });

  // Calibration logging - collect data for future tuning
  logger.info("planning_metrics", {
    event: "dual_score_calculated",
    scopeRaw,
    scopeNormalized: scopeNorm,
    riskRaw,
    riskNormalized: riskNorm,
    shouldDecompose: decompose,
    targetStories,
    mandatoryStories,
    inventoryCounts: {
      journeys: inventory.journeys.length,
      uiSurfaces: inventory.uiSurfaces.length,
      apiEndpoints: inventory.apiEndpoints.length,
      entities: inventory.entities.length,
      integrations: inventory.integrations.length,
      migrations: inventory.migrations.length,
      nonFunctionals: inventory.nonFunctionals.length,
      unknowns: inventory.unknowns.length,
      blockingUnknowns: inventory.unknowns.filter(u => u.blocking).length,
      subsystems: inventory.subsystems.length,
      complexityFlags: inventory.complexityFlags?.length || 0,
    },
    complexityDistribution: {
      journeys: countByComplexity(inventory.journeys),
      uiSurfaces: countByComplexity(inventory.uiSurfaces),
      apiEndpoints: countByComplexity(inventory.apiEndpoints),
      entities: countByComplexity(inventory.entities),
      integrations: countByComplexity(inventory.integrations),
      nonFunctionals: countByComplexity(inventory.nonFunctionals),
      migrations: {
        low: inventory.migrations.filter(m => m.riskLevel === "low").length,
        medium: inventory.migrations.filter(m => m.riskLevel === "medium").length,
        high: inventory.migrations.filter(m => m.riskLevel === "high").length,
      },
    },
    scopeBreakdown,
    riskBreakdown,
    timestamp: new Date().toISOString(),
  });

  return {
    scope: scopeNorm,
    risk: riskNorm,
    scopeRaw,
    riskRaw,
    shouldDecompose: decompose,
    targetStories,
    mandatoryStories,
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
 * Uses RAW scores to preserve scaling for large PRDs.
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
  // Use raw scores for mapping to preserve scaling
  const scopeRaw = dualScore.scopeRaw;
  const riskRaw = dualScore.riskRaw;

  // Map scope to features (1-3) using raw scores
  // 0-30 = 1, 31-80 = 2, 81+ = 3 (adjusted thresholds for raw scores)
  const features = scopeRaw <= 30 ? 1 : scopeRaw <= 80 ? 2 : 3;

  // Estimate layers from subsystems
  // 1 subsystem = 1, 2-3 subsystems = 2, 4+ = 3
  const subsystemCount = Object.keys(dualScore.scopeBreakdown).length > 0
    ? Math.ceil(dualScore.scopeBreakdown.subsystems / 6) // Each subsystem contributes 6 to scope
    : 1;
  const layers = subsystemCount <= 1 ? 1 : subsystemCount <= 3 ? 2 : 3;

  // Estimate files from scope using raw
  // 0-30 = 1, 31-70 = 2, 71+ = 3 (adjusted for raw scores)
  const files = scopeRaw <= 30 ? 1 : scopeRaw <= 70 ? 2 : 3;

  // Map risk to clarity (inverse: high risk = low clarity) using raw
  // 0-25 = 1 (clear), 26-60 = 2 (some ambiguity), 61+ = 3 (needs investigation)
  const clarity = riskRaw <= 25 ? 1 : riskRaw <= 60 ? 2 : 3;

  const totalScore = features + layers + files + clarity;

  // Calculate target story range (no caps)
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
    reasoning: `Dual score: Scope=${dualScore.scope}/100 (raw: ${scopeRaw}), Risk=${dualScore.risk}/100 (raw: ${riskRaw}). ${dualScore.summary}`,
  };
}

// ============================================================================
// SCORE THRESHOLDS
// ============================================================================

/**
 * Threshold constants for score-based decisions.
 * These use RAW (unbounded) scores, not normalized 0-100 scores.
 * Can be tuned based on execution data.
 */
export const SCORE_THRESHOLDS = {
  /** Raw scope below which we consider PRD "small" */
  SMALL_SCOPE_RAW: 15,
  /** Raw risk below which we consider PRD "low risk" */
  LOW_RISK_RAW: 12,
  /** Raw risk above which we add extra stories for safety */
  HIGH_RISK_RAW: 50,
  /** Target raw scope points per delivery story */
  SCOPE_PER_STORY: 12,
  /** Maximum risk multiplier for story count (1.75x) */
  MAX_RISK_MULTIPLIER: 1.75,
  /** Normalization constant for scope (saturating function) */
  SCOPE_NORM_K: 50,
  /** Normalization constant for risk (saturating function) */
  RISK_NORM_K: 40,
};

/**
 * Get human-readable risk level from raw score
 */
export function getRiskLevel(riskRaw: number): "low" | "medium" | "high" | "critical" {
  if (riskRaw <= 15) return "low";
  if (riskRaw <= 40) return "medium";
  if (riskRaw <= 70) return "high";
  return "critical";
}

/**
 * Get human-readable scope level from raw score
 */
export function getScopeLevel(scopeRaw: number): "trivial" | "small" | "medium" | "large" | "massive" {
  if (scopeRaw <= 15) return "trivial";
  if (scopeRaw <= 40) return "small";
  if (scopeRaw <= 80) return "medium";
  if (scopeRaw <= 150) return "large";
  return "massive";
}

// ============================================================================
// SIMPLE FEATURE DETECTION
// ============================================================================

/**
 * Simple feature template story types
 */
export interface SimpleFeatureStory {
  type: "foundation" | "backend" | "frontend" | "integration" | "testing";
  title: string;
  description: string;
}

/**
 * Detect if an inventory represents a "simple feature" that can use
 * a lightweight template instead of full decomposition.
 *
 * Criteria:
 * - 0 blocking unknowns
 * - 0 migrations
 * - 0 net-new integrations (only existing ones)
 * - ≤ 2 journeys
 */
export function isSimpleFeature(inventory: PRDInventory): boolean {
  const blockingUnknowns = inventory.unknowns.filter(u => u.blocking).length;
  const newMigrations = inventory.migrations.filter(m => m.changeType === "new" || m.changeType === "modify").length;
  const newIntegrations = inventory.integrations.filter(i => i.changeType === "new").length;
  const journeyCount = inventory.journeys.length;

  const isSimple = (
    blockingUnknowns === 0 &&
    newMigrations === 0 &&
    newIntegrations === 0 &&
    journeyCount <= 2
  );

  if (isSimple) {
    logger.info("Simple feature detected", {
      journeyCount,
      blockingUnknowns,
      newMigrations,
      newIntegrations,
    });
  }

  return isSimple;
}

/**
 * Get a lightweight story template for simple features.
 * Returns 4-8 stories instead of full decomposition.
 */
export function getSimpleFeatureTemplate(inventory: PRDInventory): SimpleFeatureStory[] {
  const stories: SimpleFeatureStory[] = [];

  // 1. Foundation story (always)
  stories.push({
    type: "foundation",
    title: "Setup and foundation",
    description: "Create project structure, types, and base configuration",
  });

  // 2. Backend stories (1-2 based on API count)
  const apiCount = inventory.apiEndpoints.filter(e => e.changeType === "new" || e.changeType === "modify").length;
  if (apiCount > 0) {
    stories.push({
      type: "backend",
      title: "Core backend implementation",
      description: `Implement ${apiCount} API endpoint(s) with validation and error handling`,
    });
    if (apiCount > 3) {
      stories.push({
        type: "backend",
        title: "Additional backend endpoints",
        description: "Implement remaining endpoints and business logic",
      });
    }
  }

  // 3. Frontend stories (1-2 based on UI surface count)
  const uiCount = inventory.uiSurfaces.filter(u => u.changeType === "new" || u.changeType === "modify").length;
  if (uiCount > 0) {
    stories.push({
      type: "frontend",
      title: "Core frontend components",
      description: `Build ${uiCount} UI component(s) with state management`,
    });
    if (uiCount > 3) {
      stories.push({
        type: "frontend",
        title: "Additional UI components",
        description: "Build remaining components and connect to backend",
      });
    }
  }

  // 4. Integration story (if using existing integrations)
  const existingIntegrations = inventory.integrations.filter(i => i.changeType === "existing").length;
  if (existingIntegrations > 0) {
    stories.push({
      type: "integration",
      title: "Integration wiring",
      description: `Connect to ${existingIntegrations} existing integration(s)`,
    });
  }

  // 5. Testing/polish stories (1-2 based on scope)
  stories.push({
    type: "testing",
    title: "Testing and validation",
    description: "Add tests, fix edge cases, validate acceptance criteria",
  });

  // Add polish story if we have multiple UI components
  if (uiCount > 2) {
    stories.push({
      type: "testing",
      title: "Polish and refinement",
      description: "UI polish, accessibility, responsive design",
    });
  }

  return stories;
}

/**
 * Get the recommended story count for a simple feature
 */
export function getSimpleFeatureStoryCount(inventory: PRDInventory): number {
  return getSimpleFeatureTemplate(inventory).length;
}

