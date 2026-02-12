/**
 * Planning Agent Types
 *
 * All type definitions and interfaces for the planning agent system.
 *
 * NOTE: V2/V3 types (PlannedStoryV2, ExecutionPlanV2, PRDInventory, DualScore)
 * are NOT re-exported from here to avoid circular imports with planning-types.ts.
 * They are re-exported directly from index.ts instead.
 */

import type { Organization } from "../../models/Organization.js";

/**
 * Planning agent configuration from org settings.
 */
export interface PlanningAgentConfig {
  provider: "anthropic" | "openai" | "google" | "ollama";
  model: string;
  ollamaBaseUrl?: string;
}

/**
 * Default configuration (used when org settings not available)
 */
export const DEFAULT_PLANNING_CONFIG: PlanningAgentConfig = {
  provider: "anthropic",
  model: "",
};

// Types matching the design doc
export interface PlanningInput {
  jiraKey: string;
  summary: string;
  description: string;
  labels: string[];
  repo: string;
  org: Organization;
}

export interface PlannedStory {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  estimatedComplexity: "small" | "medium" | "large";
  // Cost-first fields (Haiku-optimized decomposition)
  storyPoints: number;           // 1-3 scale (max 3 for Haiku accuracy)
  targetFiles: string[];         // Files to modify (max 5 per story)
  referenceFiles?: string[];     // Files to read for context/patterns
  // Per-story cost estimate (calculated post-parse)
  estimatedCost?: number;        // USD estimate for this story
}

/**
 * Tech stack decisions made by the planning agent.
 * These become mandatory constraints posted to the coordination feed
 * BEFORE workers spawn, ensuring all workers follow the same tech choices.
 */
export interface TechStack {
  /** Primary programming language (e.g., "typescript", "python", "javascript") */
  language: string;
  /** Framework choice (e.g., "react", "express", "none" for vanilla) */
  framework: string;
  /** Styling approach (e.g., "tailwind", "css-modules", "vanilla-css") */
  styling?: string;
  /** Database if applicable (e.g., "postgresql", "mongodb", "none") */
  database?: string;
  /** Testing framework (e.g., "jest", "pytest", "vitest") */
  testing?: string;
  /** Build tool (e.g., "vite", "webpack", "esbuild") */
  buildTool?: string;
  /** Brief explanation of why these choices were made */
  rationale: string;
  /** Any explicit constraints from the PRD (preserved verbatim) */
  prdConstraints?: string[];
}

export interface ExecutionPlan {
  strategy: "single" | "multi";
  reasoning: string;
  primaryPersona?: string;
  stories?: PlannedStory[];
  qualityGates: string[];
  /** Tech stack decisions - becomes mandatory constraints for all workers */
  techStack?: TechStack;
}

export interface ComplexityScore {
  // 4-dimension rubric (each 1-3)
  dimensions: {
    features: number;    // 1=single, 2=2-3 related, 3=4+ features
    layers: number;      // 1=single layer, 2=two layers, 3=full stack
    files: number;       // 1=1-2 files, 2=3-5 files, 3=6+ files
    clarity: number;     // 1=crystal clear, 2=some ambiguity, 3=needs investigation
  };
  // Calculated values
  totalScore: number;    // 4-12 (sum of dimensions)
  // Recommendation
  recommendation: "single" | "multi";
  maxStories: number;
  // Target story count based on complexity
  targetStories: { min: number; target: number; max: number };
  reasoning: string;
  // Label override info
  overrideApplied?: "force-single" | "force-multi";
  // Token usage for cost tracking (only present when LLM was called)
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface CostEstimate {
  totalPoints: number;
  costPerPoint: number;
  estimatedCost: number;
  model: string;
}
