/**
 * Planning Agent Queries
 *
 * Pure query/check functions for task planning state.
 */

import { WorkerTask } from "../../models/WorkerTask.js";
import type { ExecutionPlan } from "./types.js";
import { shouldUseV3Planning } from "./complexity.js";
import { shouldUseV2Planning } from "./planner-v2.js";

/**
 * Get the execution plan from a task
 */
export function getExecutionPlan(task: WorkerTask): ExecutionPlan | null {
  if (!task.planJson) {
    return null;
  }
  return task.planJson as unknown as ExecutionPlan;
}

/**
 * Check if task needs planning
 */
export function needsPlanning(task: WorkerTask): boolean {
  return task.status === "planning" && !task.planJson;
}

/**
 * Check if task is waiting for plan approval
 */
export function needsPlanApproval(task: WorkerTask): boolean {
  return task.status === "pending_plan_approval" && task.planStatus === "pending_approval";
}

/**
 * Get the best planning version based on task labels
 */
export function getPlanningVersion(task: WorkerTask): "v1" | "v2" | "v3" {
  if (shouldUseV3Planning(task)) return "v3";
  if (shouldUseV2Planning(task)) return "v2";
  return "v1";
}
