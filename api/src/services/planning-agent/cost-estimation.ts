/**
 * Planning Agent Cost Estimation
 *
 * Cost estimation functions for execution plans.
 */

import type { PlannedStory, CostEstimate } from "./types.js";

/**
 * Estimate cost of an execution plan
 *
 * Based on story points and model selection. This is a rough estimate
 * for dashboard visibility and cost control purposes.
 */
export function estimatePlanCost(
  stories: Array<{ storyPoints?: number } | undefined> | undefined,
  model: string
): CostEstimate {
  // Pricing per story point (in USD) - based on token estimates
  // Haiku: ~$0.80 per 1M input tokens, estimated 3K-5K tokens per point
  // Sonnet: ~$3 per 1M input tokens
  // Opus: ~$15 per 1M input tokens
  const costPerPoint: Record<string, number> = {
    "claude-haiku-4-5-20251001": 0.05,
    "claude-sonnet-4-20250514": 0.20,
    "claude-opus-4-6": 1.00,
  };

  const storyArray = Array.isArray(stories)
    ? stories.filter((s): s is { storyPoints?: number } => s !== undefined)
    : [];

  const totalPoints = storyArray.reduce((sum, s) => sum + (s.storyPoints || 2), 0);
  const perPoint = costPerPoint[model] || 0.05;

  return {
    totalPoints,
    costPerPoint: perPoint,
    estimatedCost: parseFloat((totalPoints * perPoint).toFixed(2)),
    model,
  };
}

/**
 * Add per-story cost estimates to each story in the plan
 * Mutates the stories array to add estimatedCost field
 */
export function addPerStoryCostEstimates(
  stories: PlannedStory[] | undefined,
  model: string
): void {
  if (!stories || !Array.isArray(stories)) return;

  // Pricing per story point (in USD)
  const costPerPoint: Record<string, number> = {
    "claude-haiku-4-5-20251001": 0.05,
    "claude-sonnet-4-20250514": 0.20,
    "claude-opus-4-6": 1.00,
  };

  const perPoint = costPerPoint[model] || 0.05;

  for (const story of stories) {
    const points = story.storyPoints || 2;
    story.estimatedCost = parseFloat((points * perPoint).toFixed(2));
  }
}
