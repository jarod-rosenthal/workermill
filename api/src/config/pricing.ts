/**
 * Pricing Configuration for AI Worker Cost Tracking
 *
 * Defines per-token rates for Claude models and ECS compute costs.
 * Used by cost-tracker service to calculate task costs.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ModelPricing {
  input: number; // per 1K tokens
  output: number; // per 1K tokens
  cacheWrite: number; // per 1K tokens
  cacheRead: number; // per 1K tokens
}

// Per-token rates (per 1K tokens) - Anthropic pricing as of 2024
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Haiku 3.5
  "claude-3-5-haiku-20241022": {
    input: 0.0008,
    output: 0.004,
    cacheWrite: 0.001, // 1.25x input
    cacheRead: 0.00008, // 0.1x input
  },
  haiku: {
    input: 0.0008,
    output: 0.004,
    cacheWrite: 0.001,
    cacheRead: 0.00008,
  },
  // Sonnet 4
  "claude-sonnet-4-20250514": {
    input: 0.003,
    output: 0.015,
    cacheWrite: 0.00375,
    cacheRead: 0.0003,
  },
  sonnet: {
    input: 0.003,
    output: 0.015,
    cacheWrite: 0.00375,
    cacheRead: 0.0003,
  },
  // Opus 4.5
  "claude-opus-4-5-20251101": {
    input: 0.005,
    output: 0.025,
    cacheWrite: 0.00625,
    cacheRead: 0.0005,
  },
  opus: {
    input: 0.005,
    output: 0.025,
    cacheWrite: 0.00625,
    cacheRead: 0.0005,
  },
};

// Default pricing for unknown models (use Sonnet rates)
const DEFAULT_PRICING: ModelPricing = {
  input: 0.003,
  output: 0.015,
  cacheWrite: 0.00375,
  cacheRead: 0.0003,
};

// ECS Fargate Spot pricing for 2 vCPU, 4GB memory (us-east-1)
export const ECS_FARGATE_SPOT_RATE_PER_HOUR = 0.015;

/**
 * Get pricing for a specific model
 */
export function getModelPricing(model: string): ModelPricing {
  // Try exact match first
  if (MODEL_PRICING[model]) {
    return MODEL_PRICING[model];
  }

  // Try to match by model family
  const modelLower = model.toLowerCase();
  if (modelLower.includes("haiku")) {
    return MODEL_PRICING["haiku"];
  }
  if (modelLower.includes("opus")) {
    return MODEL_PRICING["opus"];
  }
  if (modelLower.includes("sonnet")) {
    return MODEL_PRICING["sonnet"];
  }

  return DEFAULT_PRICING;
}

/**
 * Calculate Claude API cost from token usage
 */
export function calculateClaudeCost(
  tokens: TokenUsage,
  model: string
): number {
  const rates = getModelPricing(model);
  const inputCost = (tokens.inputTokens / 1000) * rates.input;
  const outputCost = (tokens.outputTokens / 1000) * rates.output;
  const cacheWriteCost = (tokens.cacheCreationTokens / 1000) * rates.cacheWrite;
  const cacheReadCost = (tokens.cacheReadTokens / 1000) * rates.cacheRead;
  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Calculate ECS Fargate Spot compute cost
 */
export function calculateEcsCost(durationSeconds: number): number {
  return (durationSeconds / 3600) * ECS_FARGATE_SPOT_RATE_PER_HOUR;
}

/**
 * Calculate total cost (Claude API + ECS compute)
 */
export function calculateTotalCost(
  tokens: TokenUsage,
  model: string,
  durationSeconds: number
): number {
  return calculateClaudeCost(tokens, model) + calculateEcsCost(durationSeconds);
}

/**
 * Format cost as USD string
 */
export function formatCostUsd(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
