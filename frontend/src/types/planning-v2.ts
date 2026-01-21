/**
 * Frontend types for V2 Planning System
 * Mirrors backend planning-types.ts for UI display
 */

import type { WorkerPersona } from "./mission-control";

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
  };
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
