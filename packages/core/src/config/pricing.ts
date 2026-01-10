/**
 * AI Worker Pricing Configuration
 *
 * Single source of truth for all Claude API and compute cost calculations.
 *
 * Pricing as of January 2025 (from https://www.anthropic.com/pricing):
 * - Claude 3.5 Haiku: $0.80/M input, $4/M output
 * - Claude Haiku 4.5: $1/M input, $5/M output
 * - Claude Sonnet 4: $3/M input, $15/M output
 * - Claude Opus 4.5: $5/M input, $25/M output
 * - Cache write: 1.25x input rate
 * - Cache read: 0.1x input rate
 */

export const MODEL_PRICING = {
  // Claude 3.5 Haiku ($0.80/M input, $4/M output)
  "claude-3-5-haiku-20241022": {
    input: 0.0008,
    output: 0.004,
    cacheWrite: 0.001,
    cacheRead: 0.00008,
  },
  // Claude Haiku 4.5 ($1/M input, $5/M output)
  "claude-haiku-4-5-20251001": {
    input: 0.001,
    output: 0.005,
    cacheWrite: 0.00125,
    cacheRead: 0.0001,
  },
  // Claude Sonnet 4 ($3/M input, $15/M output)
  "claude-sonnet-4-20250514": {
    input: 0.003,
    output: 0.015,
    cacheWrite: 0.00375,
    cacheRead: 0.0003,
  },
  // Claude Opus 4.5 ($5/M input, $25/M output)
  "claude-opus-4-5-20251101": {
    input: 0.005,
    output: 0.025,
    cacheWrite: 0.00625,
    cacheRead: 0.0005,
  },
  // Short aliases
  haiku: {
    input: 0.001,
    output: 0.005,
    cacheWrite: 0.00125,
    cacheRead: 0.0001,
  },
  sonnet: {
    input: 0.003,
    output: 0.015,
    cacheWrite: 0.00375,
    cacheRead: 0.0003,
  },
  opus: {
    input: 0.005,
    output: 0.025,
    cacheWrite: 0.00625,
    cacheRead: 0.0005,
  },
} as const;

// Default compute pricing (configurable per deployment)
export const DEFAULT_COMPUTE_RATE_PER_HOUR = 0.015;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ModelPricingRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export function getModelPricing(model: string): ModelPricingRates {
  if (model in MODEL_PRICING) {
    return MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  }

  const modelLower = model.toLowerCase();
  if (modelLower.includes("haiku")) {
    return MODEL_PRICING.haiku;
  }
  if (modelLower.includes("opus")) {
    return MODEL_PRICING.opus;
  }

  return MODEL_PRICING.sonnet;
}

export function calculateAiCost(tokens: TokenUsage, model: string): number {
  const rates = getModelPricing(model);

  const inputCost = (tokens.inputTokens / 1000) * rates.input;
  const outputCost = (tokens.outputTokens / 1000) * rates.output;
  const cacheWriteCost = (tokens.cacheCreationTokens / 1000) * rates.cacheWrite;
  const cacheReadCost = (tokens.cacheReadTokens / 1000) * rates.cacheRead;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

export function calculateComputeCost(
  durationSeconds: number,
  ratePerHour: number = DEFAULT_COMPUTE_RATE_PER_HOUR
): number {
  return (durationSeconds / 3600) * ratePerHour;
}

export function calculateTotalCost(
  tokens: TokenUsage,
  model: string,
  durationSeconds: number,
  computeRatePerHour: number = DEFAULT_COMPUTE_RATE_PER_HOUR
): number {
  return calculateAiCost(tokens, model) + calculateComputeCost(durationSeconds, computeRatePerHour);
}

export function formatCostUsd(cost: number): string {
  return `$${cost.toFixed(4)}`;
}
