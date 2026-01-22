/**
 * Planning Types V2
 *
 * Type definitions for the multi-phase PRD planning workflow.
 * These extend the existing ExecutionPlan types with theme-based
 * decomposition and quality scoring.
 */

import { PlannedStory, ExecutionPlan, ComplexityScore } from "./planning-agent.js";

// ============================================================================
// THEME CATEGORIES
// ============================================================================

/**
 * Theme categories define the execution phase for stories.
 * Stories are ordered by category to ensure proper sequencing.
 */
export type ThemeCategory =
  | "foundation"   // Docs, architecture, data models - ALWAYS FIRST
  | "core"         // Backend APIs, frontend components
  | "integration"  // API-UI wiring, external services
  | "testing"      // E2E tests, QA validation
  | "polish";      // Optimizations (optional)

/**
 * Category phase order for deterministic sorting
 */
export const THEME_CATEGORY_ORDER: Record<ThemeCategory, number> = {
  foundation: 1,
  core: 2,
  integration: 3,
  testing: 4,
  polish: 5,
};

// ============================================================================
// AVAILABLE PERSONAS
// ============================================================================

/**
 * All available worker personas
 */
export const AVAILABLE_PERSONAS = [
  "tech_writer",
  "database_administrator",
  "backend_developer",
  "api_developer",
  "frontend_developer",
  "mobile_developer_android",
  "mobile_developer_ios",
  "data_engineer",
  "ml_engineer",
  "security_engineer",
  "devops_engineer",
  "qa_engineer",
] as const;

export type WorkerPersona = (typeof AVAILABLE_PERSONAS)[number];

/**
 * Personas that should NOT be assigned to coding tasks
 * (coordination-only roles)
 */
export const COORDINATION_ONLY_PERSONAS = ["project_manager", "manager"] as const;

/**
 * Default personas for each theme category
 */
export const DEFAULT_PERSONAS_BY_CATEGORY: Record<ThemeCategory, WorkerPersona[]> = {
  foundation: ["tech_writer", "database_administrator"],
  core: ["backend_developer", "frontend_developer", "api_developer"],
  integration: ["backend_developer", "devops_engineer", "security_engineer"],
  testing: ["qa_engineer"],
  polish: ["backend_developer", "frontend_developer"],
};

// ============================================================================
// PLANNING THEME
// ============================================================================

/**
 * A theme represents a logical grouping of related stories.
 * Themes are extracted from the PRD and categorized by phase.
 */
export interface PlanningTheme {
  /** Unique theme identifier (e.g., "T1", "T2") */
  id: string;

  /** Human-readable theme name (e.g., "Authentication System") */
  name: string;

  /** Theme category determines execution phase */
  category: ThemeCategory;

  /** Brief description of what this theme covers */
  description: string;

  /** Recommended personas for stories in this theme */
  suggestedPersonas: WorkerPersona[];

  /** Expected number of stories (2-8) */
  estimatedStoryCount: number;

  /** Theme IDs this theme depends on (for ordering) */
  dependencies: string[];

  /** PRD requirements covered by this theme */
  coveredRequirements?: string[];

  // =========================================================================
  // V5: ACTION OWNERSHIP - Explicit action assignment to themes
  // =========================================================================

  /**
   * Indices of actions owned by this theme (from inventory.actions[]).
   * This is the anchor for deterministic story generation.
   * Every action must be assigned to exactly one theme.
   */
  ownedActionIndices?: number[];

  /**
   * Action IDs owned by this theme (e.g., ["ACT-01", "ACT-02"]).
   * Alternative to indices for LLM-friendly assignment.
   */
  ownedActionIds?: string[];
}

// ============================================================================
// QUALITY SCORING
// ============================================================================

/**
 * Quality score for an individual story
 */
export interface StoryQualityScore {
  /** Story index being scored */
  storyIndex: number;

  /** Completeness: Does the story cover its intended scope? (1-5) */
  completeness: number;

  /** Specificity: Are acceptance criteria concrete and testable? (1-5) */
  specificity: number;

  /** Independence: How many dependencies does it have? (1-5, fewer = better) */
  independence: number;

  /** Sizing: Is the story properly sized? (1-5) */
  sizing: number;

  /** Overall score (average of dimensions) */
  overall: number;

  /** Issues found during scoring */
  issues: string[];

  /** Suggestions for improvement */
  suggestions: string[];
}

/**
 * Quality score for the entire execution plan
 */
export interface PlanQualityScore {
  /** Does the plan cover all PRD requirements? (1-5) */
  completeness: number;

  /** Is the dependency order correct? (1-5) */
  ordering: number;

  /** Is work evenly distributed? (1-5) */
  balance: number;

  /** Individual story scores */
  storyScores: StoryQualityScore[];

  /** Overall plan score (average of dimensions) */
  overall: number;

  /** High-level suggestions for the plan */
  suggestions: string[];

  /** Critical issues that should block approval */
  blockers: string[];
}

/**
 * Minimum quality score required for plan approval
 */
export const MIN_PLAN_QUALITY_SCORE = 3.5;

/**
 * Minimum story score before flagging for review
 */
export const MIN_STORY_QUALITY_SCORE = 2.5;

// ============================================================================
// PLANNED STORY V2
// ============================================================================

/**
 * Extended story with V2 fields for theme tracking and quality scoring
 */
export interface PlannedStoryV2 extends PlannedStory {
  /** Links to parent theme */
  themeId: string;

  /** Inherited from theme category */
  phase: ThemeCategory;

  /** Global execution order (deterministic, assigned during assembly) */
  canonicalOrder: number;

  /** Quality score (computed during validation) */
  qualityScore?: StoryQualityScore;

  /**
   * Mutex groups for concurrency control.
   * Stories in the same mutex group cannot execute in parallel.
   * This prevents merge conflicts without creating fake dependencies.
   * Example: ["subsystem:database", "subsystem:api"]
   */
  mutexGroups?: string[];

  /**
   * Artifact type this story was generated from (if using V3 planning).
   * Used for tracking story lineage.
   */
  artifactType?: string;

  /**
   * Source inventory items this story was derived from.
   * Enables traceability from PRD to stories.
   */
  sourceItems?: string[];

  // =========================================================================
  // V4 CANONICAL ID FIELDS (Phase 1 - Planning Agent V4 Improvements)
  // =========================================================================

  /**
   * Entity IDs this story creates or modifies (from inventory).
   * Uses canonical IDs like "ENT-01", "ENT-02" instead of fuzzy text.
   * Enables deterministic dependency resolution.
   */
  providesEntities?: string[];

  /**
   * Entity IDs this story requires to exist (from inventory).
   * Uses canonical IDs for exact matching against providesEntities.
   */
  requiresEntities?: string[];

  /**
   * Action type for entity modifications.
   * - "create": Story creates new entities (only owner theme can do this)
   * - "update": Story modifies existing entities (contributor themes)
   */
  entityAction?: "create" | "update";

  // =========================================================================
  // V5 ACTION OWNERSHIP FIELDS
  // =========================================================================

  /**
   * Action IDs (ACT-XX) this story implements.
   * Every action from the theme's ownedActionIds must appear in exactly
   * one story's coveredActionIds. This is the anchor for deterministic
   * story generation.
   */
  coveredActionIds?: string[];

  /**
   * Indices into inventory.actions[] that this story covers.
   * Resolved from coveredActionIds during validation.
   */
  coveredActionIndices?: number[];
}

// ============================================================================
// EXECUTION PLAN V2
// ============================================================================

/**
 * Dual score from inventory-based scoring (V3)
 */
export interface DualScoreResult {
  /** Scope score (0-100): How much work is there? */
  scope: number;
  /** Risk score (0-100): How uncertain/risky is the work? */
  risk: number;
  /** Whether the PRD was decomposed into multiple stories */
  shouldDecompose: boolean;
  /** Target number of stories */
  targetStories: number;
  /** Breakdown of scope calculation */
  scopeBreakdown?: Record<string, number>;
  /** Breakdown of risk calculation */
  riskBreakdown?: Record<string, number>;
}

/**
 * Extended execution plan with V2 features
 */
export interface ExecutionPlanV2 extends ExecutionPlan {
  /** Version identifier */
  version: 2;

  /** Themes extracted from PRD */
  themes: PlanningTheme[];

  /** Stories with V2 fields (overrides parent stories) */
  stories: PlannedStoryV2[];

  /** Overall plan quality score */
  qualityScore: PlanQualityScore;

  /** Planning metadata */
  planningMetadata?: {
    /** Total LLM calls made during planning */
    llmCalls: number;

    /** Time spent planning (ms) */
    planningDurationMs: number;

    /** Model used for theme extraction */
    themeExtractionModel: string;

    /** Model used for story decomposition */
    storyDecompositionModel: string;

    /** Dual score from V3 inventory-based scoring (if used) */
    dualScore?: DualScoreResult;

    /** Model used for inventory extraction (V3) */
    inventoryExtractionModel?: string;

    /** Inventory item counts (V3) */
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

    /** Dependency auditor metrics (V3, feature-flagged) */
    dependencyAudit?: {
      enabled: boolean;
      shadow: boolean;
      addsOnly: boolean;
      applied: boolean;
      confidence: "low" | "medium" | "high";
      numAddedEdges: number;
      numRemovedEdgesSuggested: number;
      guardrailsClamped: boolean;
      postValidatePassed: boolean;
      durationMs: number;
      /** Hash of input story order for debugging (detects if stories changed) */
      inputStoryOrderHash: string;
      /** Story indices that were patched by the auditor */
      auditorPatchedKeys: number[];
      /** Story indices returned by LLM that didn't exist in input (should be empty) */
      unknownKeysIgnored: number[];
      /** Count of invalid dependency references that were sanitized out */
      invalidDepsRemoved: number;
    } | null;
  };

  /**
   * Mutex groups defined across all stories.
   * Maps group name to story indices that belong to it.
   */
  mutexGroups?: Record<string, number[]>;
}

// ============================================================================
// THEME EXTRACTION TYPES
// ============================================================================

/**
 * Input for theme extraction
 */
export interface ThemeExtractionInput {
  jiraKey: string;
  summary: string;
  description: string;
  labels: string[];
  repo: string;
  codebaseContext?: {
    fileTree: string;
    readme: string | null;
    techStack: Record<string, unknown> | null;
  };
}

/**
 * Result of theme extraction phase
 */
export interface ThemeExtractionResult {
  themes: PlanningTheme[];
  prdRequirements: string[];
  reasoning: string;
}

// ============================================================================
// STORY DECOMPOSITION TYPES
// ============================================================================

/**
 * Input for story decomposition (per theme)
 */
export interface StoryDecompositionInput {
  theme: PlanningTheme;
  prdContext: {
    jiraKey: string;
    summary: string;
    description: string;
    labels: string[];
  };
  codebaseContext?: {
    fileTree: string;
    readme: string | null;
    techStack: Record<string, unknown> | null;
  };
  /** Previously created themes/stories for context */
  priorContext?: {
    themes: PlanningTheme[];
    stories: PlannedStoryV2[];
  };
  /** PRD inventory for V4 canonical entity IDs (optional for backwards compatibility) */
  inventory?: {
    entities: Array<{ name: string; id?: string }>;
  };
  /**
   * V5: Actions owned by this theme that need to be clustered into stories.
   * When provided, story decomposition becomes action clustering.
   */
  themeActions?: Array<{
    id: string;
    description: string;
    type: string;
    subsystem?: string;
  }>;
}

/**
 * Result of story decomposition for a single theme
 */
export interface StoryDecompositionResult {
  themeId: string;
  stories: Omit<PlannedStoryV2, "canonicalOrder">[];
  reasoning: string;
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

/**
 * Validation rule result
 */
export interface ValidationResult {
  passed: boolean;
  ruleName: string;
  message: string;
  autoFixed?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Complete validation report
 */
export interface ValidationReport {
  valid: boolean;
  results: ValidationResult[];
  autoFixesApplied: number;
  criticalIssues: string[];
}

// ============================================================================
// CONSISTENCY TESTING
// ============================================================================

/**
 * Result of a single planning run for consistency testing
 */
export interface ConsistencyRunResult {
  runNumber: number;
  themes: PlanningTheme[];
  stories: PlannedStoryV2[];
  qualityScore: PlanQualityScore;
}

/**
 * Divergence found between consistency runs
 */
export interface ConsistencyDivergence {
  runNumber: number;
  level: "theme" | "story" | "quality";
  field: string;
  expected: unknown;
  actual: unknown;
  description: string;
}

/**
 * Complete consistency test report
 */
export interface ConsistencyReport {
  taskId: string;
  jiraKey: string;
  totalRuns: number;
  consistentRuns: number;
  divergences: ConsistencyDivergence[];
  rootCauses: string[];
  recommendations: string[];
  report: string; // Human-readable summary
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a plan is V2 format
 */
export function isExecutionPlanV2(plan: ExecutionPlan | ExecutionPlanV2): plan is ExecutionPlanV2 {
  return "version" in plan && plan.version === 2;
}

/**
 * Check if a persona is valid for coding tasks
 */
export function isValidCodingPersona(persona: string): persona is WorkerPersona {
  return (
    AVAILABLE_PERSONAS.includes(persona as WorkerPersona) &&
    !COORDINATION_ONLY_PERSONAS.includes(persona as (typeof COORDINATION_ONLY_PERSONAS)[number])
  );
}

/**
 * Get theme category order for sorting
 */
export function getThemeCategoryOrder(category: ThemeCategory): number {
  return THEME_CATEGORY_ORDER[category];
}

/**
 * Sort themes by category order
 */
export function sortThemesByCategory(themes: PlanningTheme[]): PlanningTheme[] {
  return [...themes].sort(
    (a, b) => getThemeCategoryOrder(a.category) - getThemeCategoryOrder(b.category)
  );
}

/**
 * Sort stories by canonical order
 */
export function sortStoriesByCanonicalOrder(stories: PlannedStoryV2[]): PlannedStoryV2[] {
  return [...stories].sort((a, b) => a.canonicalOrder - b.canonicalOrder);
}
