/**
 * Frontend types for V2 Planning System
 * Mirrors backend planning-types.ts for UI display
 */

import type { WorkerPersona } from "./mission-control";

// ============================================================================
// INVENTORY ITEM TYPES (V3)
// ============================================================================

/**
 * Item complexity level for "small but hard" detection.
 * Used to weight individual items beyond flat counts.
 */
export type ItemComplexity = "simple" | "medium" | "hard";

/**
 * Change type for delta inventory extraction.
 * Indicates whether an item represents new work vs existing infrastructure.
 */
export type ChangeType = "new" | "modify" | "existing" | "unknown";

/**
 * Confidence level for extraction.
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * Delta fields for change tracking.
 */
export interface DeltaFields {
  changeType?: ChangeType;
  evidence?: string;
  confidence?: ConfidenceLevel;
}

/**
 * Complexity multipliers for display and calculations
 */
export const COMPLEXITY_MULTIPLIERS: Record<ItemComplexity, number> = {
  simple: 1.0,
  medium: 1.4,
  hard: 1.9,
};

/**
 * Colors for complexity display
 */
export const COMPLEXITY_COLORS: Record<ItemComplexity, string> = {
  simple: "var(--mc-status-live)",     // Green - easy
  medium: "var(--mc-status-warning)",  // Yellow - moderate
  hard: "var(--mc-status-danger)",     // Red - difficult
};

/**
 * Labels for complexity display
 */
export const COMPLEXITY_LABELS: Record<ItemComplexity, string> = {
  simple: "Simple",
  medium: "Medium",
  hard: "Hard",
};

/**
 * A user journey extracted from the PRD
 */
export interface PRDJourney extends DeltaFields {
  actor: string;
  goal: string;
  preconditions: string[];
  happyPathSteps: string[];
  edgeCases: string[];
  complexity?: ItemComplexity;
}

/**
 * A UI surface (page, modal, component) that needs to be built
 */
export interface PRDUISurface extends DeltaFields {
  name: string;
  type: "page" | "modal" | "component" | "widget";
  states: string[];
  interactions: string[];
  complexity?: ItemComplexity;
}

/**
 * An API endpoint that needs to be implemented
 */
export interface PRDAPIEndpoint extends DeltaFields {
  route: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  requestShape: string;
  responseShape: string;
  errorCodes: string[];
  complexity?: ItemComplexity;
}

/**
 * A data entity (model/table) that needs to be created or modified
 */
export interface PRDEntity extends DeltaFields {
  name: string;
  fields: string[];
  constraints: string[];
  relationships: string[];
  complexity?: ItemComplexity;
}

/**
 * An external integration that needs to be implemented
 */
export interface PRDIntegration extends DeltaFields {
  system: string;
  authMethod: string;
  failureModes: string[];
  fallbackStrategy: string;
  complexity?: ItemComplexity;
}

/**
 * A migration that needs to be run
 */
export interface PRDMigration extends DeltaFields {
  type: "schema" | "data" | "config";
  description: string;
  rollbackPlan: string;
  riskLevel: "low" | "medium" | "high";
}

/**
 * A non-functional requirement
 */
export interface PRDNonFunctional extends DeltaFields {
  category: "performance" | "security" | "compliance" | "observability" | "accessibility";
  requirement: string;
  acceptanceCriteria: string;
  complexity?: ItemComplexity;
  /** Whether this NFR is actionable (has measurable criteria) */
  actionable?: boolean;
}

/**
 * An unknown or unclear aspect of the PRD
 */
export interface PRDUnknown extends DeltaFields {
  question: string;
  impactArea: string;
  blocking: boolean;
}

/**
 * Complete inventory extracted from a PRD
 */
export interface PRDInventory {
  journeys: PRDJourney[];
  uiSurfaces: PRDUISurface[];
  apiEndpoints: PRDAPIEndpoint[];
  entities: PRDEntity[];
  integrations: PRDIntegration[];
  migrations: PRDMigration[];
  nonFunctionals: PRDNonFunctional[];
  unknowns: PRDUnknown[];
  subsystems: string[];
  complexityFlags?: string[];
}

// ============================================================================
// THEME TYPES
// ============================================================================

export type ThemeCategory =
  | "foundation"
  | "core"
  | "integration"
  | "testing"
  | "polish";

export const THEME_CATEGORY_ORDER: Record<ThemeCategory, number> = {
  foundation: 1,
  core: 2,
  integration: 3,
  testing: 4,
  polish: 5,
};

export const THEME_CATEGORY_LABELS: Record<ThemeCategory, string> = {
  foundation: "Foundation",
  core: "Core Development",
  integration: "Integration",
  testing: "Testing & QA",
  polish: "Polish & Optimization",
};

export const THEME_CATEGORY_COLORS: Record<ThemeCategory, string> = {
  foundation: "var(--mc-status-info)", // Blue
  core: "var(--mc-status-active)", // Green
  integration: "var(--mc-status-warning)", // Yellow
  testing: "var(--mc-status-live)", // Purple/teal
  polish: "var(--mc-text-muted)", // Gray
};

export interface PlanningTheme {
  id: string;
  name: string;
  category: ThemeCategory;
  description: string;
  suggestedPersonas: string[];
  estimatedStoryCount: number;
  dependencies: string[];
  coveredRequirements?: string[];
}

// ============================================================================
// QUALITY SCORING
// ============================================================================

export interface StoryQualityScore {
  storyIndex: number;
  completeness: number;
  specificity: number;
  independence: number;
  sizing: number;
  overall: number;
  issues: string[];
  suggestions: string[];
}

export interface PlanQualityScore {
  completeness: number;
  ordering: number;
  balance: number;
  storyScores: StoryQualityScore[];
  overall: number;
  suggestions: string[];
  blockers: string[];
}

export const MIN_PLAN_QUALITY_SCORE = 3.5;
export const MIN_STORY_QUALITY_SCORE = 2.5;

// ============================================================================
// V2 STORY AND PLAN
// ============================================================================

export interface PlannedStoryV2 {
  index: number;
  title: string;
  persona: WorkerPersona;
  scope: string;
  acceptanceCriteria: string[];
  targetFiles: string[];
  dependencies: number[];
  estimatedComplexity: "low" | "medium" | "high";
  estimatedPoints?: number;

  // V2 fields
  themeId: string;
  phase: ThemeCategory;
  canonicalOrder: number;
  qualityScore?: StoryQualityScore;
  status?: string;

  // V3 fields (optional - only present when using V3 planning)
  /** Mutex groups for concurrency control */
  mutexGroups?: string[];
  /** Artifact type this story was generated from */
  artifactType?: string;
  /** Source inventory items */
  sourceItems?: string[];
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

/**
 * Dual score from V3 inventory-based scoring
 */
export interface DualScoreResult {
  /** Scope score (0-100): How much work is there? (normalized for display) */
  scope: number;
  /** Risk score (0-100): How uncertain/risky is the work? (normalized for display) */
  risk: number;
  /** Raw unbounded scope score used for calculations */
  scopeRaw: number;
  /** Raw unbounded risk score used for calculations */
  riskRaw: number;
  /** Whether the PRD was decomposed into multiple stories */
  shouldDecompose: boolean;
  /** Target number of stories */
  targetStories: number;
  /** Mandatory story counts by bucket type */
  mandatoryStories: MandatoryStoryBuckets;
  /** Breakdown of scope calculation */
  scopeBreakdown?: Record<string, number>;
  /** Breakdown of risk calculation */
  riskBreakdown?: Record<string, number>;
}

export interface ExecutionPlanV2 {
  version: 2;
  totalEstimatedPoints: number;
  totalEstimatedHours: number;
  recommendedParallelism: number;
  criticalPath: number[];
  themes: PlanningTheme[];
  stories: PlannedStoryV2[];
  qualityScore: PlanQualityScore;
  planningMetadata?: {
    llmCalls: number;
    planningDurationMs: number;
    themeExtractionModel: string;
    storyDecompositionModel: string;
    // V3 fields
    dualScore?: DualScoreResult;
    inventoryExtractionModel?: string;
    inventoryCounts?: {
      journeys: number;
      uiSurfaces: number;
      apiEndpoints: number;
      entities: number;
      integrations: number;
      migrations: number;
      nonFunctionals: number;
      unknowns: number;
      subsystems: number;
    };
  };
  /** Mutex groups for V3 concurrency control */
  mutexGroups?: Record<string, number[]>;
}

// ============================================================================
// CONSISTENCY TESTING
// ============================================================================

export interface ConsistencyDivergence {
  runNumber: number;
  level: "theme" | "story" | "quality";
  field: string;
  expected: unknown;
  actual: unknown;
  description: string;
}

export interface ConsistencyReport {
  taskId: string;
  jiraKey: string;
  totalRuns: number;
  consistentRuns: number;
  divergences: ConsistencyDivergence[];
  rootCauses: string[];
  recommendations: string[];
  report: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a plan is V2 format
 */
export function isExecutionPlanV2(
  plan: unknown
): plan is ExecutionPlanV2 {
  return (
    plan !== null &&
    typeof plan === "object" &&
    "version" in plan &&
    (plan as ExecutionPlanV2).version === 2
  );
}

/**
 * Get quality score color based on value
 */
export function getQualityScoreColor(score: number): string {
  if (score >= 4.0) return "var(--mc-status-live)"; // Green/teal
  if (score >= 3.5) return "var(--mc-status-active)"; // Light green
  if (score >= 3.0) return "var(--mc-status-warning)"; // Yellow
  if (score >= 2.5) return "var(--mc-status-danger)"; // Orange/red
  return "var(--mc-status-danger)"; // Red
}

/**
 * Get quality score label
 */
export function getQualityScoreLabel(score: number): string {
  if (score >= 4.5) return "Excellent";
  if (score >= 4.0) return "Good";
  if (score >= 3.5) return "Acceptable";
  if (score >= 3.0) return "Needs Work";
  if (score >= 2.5) return "Poor";
  return "Critical";
}

/**
 * Group stories by theme
 */
export function groupStoriesByTheme(
  stories: PlannedStoryV2[],
  themes: PlanningTheme[]
): Map<string, PlannedStoryV2[]> {
  const grouped = new Map<string, PlannedStoryV2[]>();

  // Initialize with empty arrays for each theme
  themes.forEach((theme) => {
    grouped.set(theme.id, []);
  });

  // Group stories
  stories.forEach((story) => {
    const themeStories = grouped.get(story.themeId) || [];
    themeStories.push(story);
    grouped.set(story.themeId, themeStories);
  });

  return grouped;
}

// ============================================================================
// V3 DUAL SCORE HELPERS
// ============================================================================

/**
 * Get human-readable scope level from raw score
 * Note: Uses RAW scores (unbounded), not normalized 0-100 scores
 */
export function getScopeLevel(scopeRaw: number): string {
  if (scopeRaw <= 15) return "Trivial";
  if (scopeRaw <= 40) return "Small";
  if (scopeRaw <= 80) return "Medium";
  if (scopeRaw <= 150) return "Large";
  return "Massive";
}

/**
 * Get scope level color from raw score
 */
export function getScopeLevelColor(scopeRaw: number): string {
  if (scopeRaw <= 15) return "var(--mc-text-muted)";
  if (scopeRaw <= 40) return "var(--mc-status-info)";
  if (scopeRaw <= 80) return "var(--mc-status-active)";
  if (scopeRaw <= 150) return "var(--mc-status-warning)";
  return "var(--mc-status-danger)";
}

/**
 * Get human-readable risk level from raw score
 * Note: Uses RAW scores (unbounded), not normalized 0-100 scores
 */
export function getRiskLevel(riskRaw: number): string {
  if (riskRaw <= 15) return "Low";
  if (riskRaw <= 40) return "Medium";
  if (riskRaw <= 70) return "High";
  return "Critical";
}

/**
 * Get risk level color from raw score
 */
export function getRiskLevelColor(riskRaw: number): string {
  if (riskRaw <= 15) return "var(--mc-status-live)";
  if (riskRaw <= 40) return "var(--mc-status-active)";
  if (riskRaw <= 70) return "var(--mc-status-warning)";
  return "var(--mc-status-danger)";
}

/**
 * Format mandatory story buckets for display
 */
export function formatMandatoryStories(buckets: MandatoryStoryBuckets): string | null {
  if (buckets.total === 0) return null;

  const parts: string[] = [];
  if (buckets.spikeStories > 0) parts.push(`${buckets.spikeStories} spike`);
  if (buckets.migrationStories > 0) parts.push(`${buckets.migrationStories} migration`);
  if (buckets.integrationStories > 0) parts.push(`${buckets.integrationStories} integration`);
  if (buckets.nfrStories > 0) parts.push(`${buckets.nfrStories} NFR`);

  return parts.join(", ");
}

/**
 * Check if plan was created with V3 planning
 */
export function isV3Plan(plan: ExecutionPlanV2): boolean {
  return !!(plan.planningMetadata?.dualScore || plan.mutexGroups);
}

/**
 * Format inventory counts for display
 */
export function formatInventoryCounts(
  counts: ExecutionPlanV2["planningMetadata"]
): string | null {
  if (!counts?.inventoryCounts) return null;

  const c = counts.inventoryCounts;
  const parts: string[] = [];

  if (c.journeys > 0) parts.push(`${c.journeys} journey${c.journeys !== 1 ? "s" : ""}`);
  if (c.uiSurfaces > 0) parts.push(`${c.uiSurfaces} UI`);
  if (c.apiEndpoints > 0) parts.push(`${c.apiEndpoints} API`);
  if (c.entities > 0) parts.push(`${c.entities} entit${c.entities !== 1 ? "ies" : "y"}`);
  if (c.integrations > 0) parts.push(`${c.integrations} integration${c.integrations !== 1 ? "s" : ""}`);
  if (c.migrations > 0) parts.push(`${c.migrations} migration${c.migrations !== 1 ? "s" : ""}`);
  if (c.unknowns > 0) parts.push(`${c.unknowns} unknown${c.unknowns !== 1 ? "s" : ""}`);

  return parts.join(", ");
}

/**
 * Get complexity color for an item, defaulting to medium if undefined
 */
export function getComplexityColor(complexity: ItemComplexity | undefined): string {
  return COMPLEXITY_COLORS[complexity ?? "medium"];
}

/**
 * Get complexity label for an item, defaulting to medium if undefined
 */
export function getComplexityLabel(complexity: ItemComplexity | undefined): string {
  return COMPLEXITY_LABELS[complexity ?? "medium"];
}

/**
 * Get complexity multiplier for calculations
 */
export function getComplexityMultiplier(complexity: ItemComplexity | undefined): number {
  return COMPLEXITY_MULTIPLIERS[complexity ?? "medium"];
}
