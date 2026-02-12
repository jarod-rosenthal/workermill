/**
 * Planning Agent — Barrel re-exports for backwards compatibility
 *
 * All consumers import from "./planning-agent.js" which resolves to this index.
 */

// Types
export type {
  PlanningAgentConfig,
  PlanningInput,
  TechStack,
  PlannedStory,
  ExecutionPlan,
  ComplexityScore,
  CostEstimate,
} from "./types.js";

// Re-export V2/V3 types directly from their source modules (not through types.ts
// to avoid circular imports with planning-types.ts)
export type {
  ExecutionPlanV2,
  PlannedStoryV2,
} from "../planning-types.js";

export type { PRDInventory } from "../planning-inventory.js";
export type { DualScore } from "../planning-scoring.js";

// Config
export { getPlanningConfig } from "./config.js";

// Complexity
export {
  calculateComplexity,
  selectModelForTask,
  calculateComplexityV3,
  shouldUseV3Planning,
  formatComplexityBreakdown,
  formatComplexityConstraint,
  formatComplexityConstraintV3,
  calculateTargetStoryCount,
} from "./complexity.js";

// Cost estimation
export { estimatePlanCost, addPerStoryCostEstimates } from "./cost-estimation.js";

// Helpers
export {
  fetchCodebaseContextForTask,
  addPlanningLog,
  parseJsonResponse,
  parseExecutionPlanJson,
} from "./helpers.js";

// Planner V1
export { runPlanningAgent, validatePlan } from "./planner-v1.js";

// Planner V2
export {
  runPlanningAgentV2,
  runConsistencyTest,
  shouldUseV2Planning,
  isPlanV2,
  getExecutionPlanV2,
} from "./planner-v2.js";

// Planner V3
export { runPlanningAgentV3 } from "./planner-v3.js";

// Replan
export { replanWithFeedback } from "./replan.js";

// Queries
export {
  getExecutionPlan,
  needsPlanning,
  needsPlanApproval,
  getPlanningVersion,
} from "./queries.js";
