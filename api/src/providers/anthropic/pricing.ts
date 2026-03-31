/**
 * Anthropic (Claude) Pricing Engine
 *
 * Implements ProviderPricingEngine for Claude models.
 * Pricing data from Anthropic as of January 2026.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from "../../config/pricing.js";

/**
 * Claude model definitions with pricing
 */
const ANTHROPIC_MODELS: Record<string, ModelInfo> = {
  // Haiku 4.5 (budget tier) - $1.00/$5.00 per MTok
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    tier: "budget",
    inputRate: 0.001,
    outputRate: 0.005,
    cacheWriteRate: 0.00125, // 1.25x input
    cacheReadRate: 0.0001, // 0.1x input
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Legacy Haiku 3.5 alias (resolves to 4.5 pricing)
  "claude-3-5-haiku-20241022": {
    id: "claude-3-5-haiku-20241022",
    displayName: "Claude 3.5 Haiku",
    tier: "budget",
    inputRate: 0.001,
    outputRate: 0.005,
    cacheWriteRate: 0.00125,
    cacheReadRate: 0.0001,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: true,
  },

  // Sonnet 4.6 (current balanced tier) — 1M context
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    cacheWriteRate: 0.00375, // 1.25x input
    cacheReadRate: 0.0003, // 0.1x input
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Sonnet 4.5 (legacy)
  "claude-sonnet-4-5-20250929": {
    id: "claude-sonnet-4-5-20250929",
    displayName: "Claude Sonnet 4.5",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    cacheWriteRate: 0.00375, // 1.25x input
    cacheReadRate: 0.0003, // 0.1x input
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Sonnet 4 (legacy)
  "claude-sonnet-4-20250514": {
    id: "claude-sonnet-4-20250514",
    displayName: "Claude Sonnet 4",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    cacheWriteRate: 0.00375,
    cacheReadRate: 0.0003,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: true,
  },

  // Opus 4.6 (powerful tier) — 1M context
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    tier: "powerful",
    inputRate: 0.005,
    outputRate: 0.025,
    cacheWriteRate: 0.00625, // 1.25x input
    cacheReadRate: 0.0005, // 0.1x input
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Opus 4.5 (legacy powerful tier)
  "claude-opus-4-5-20251101": {
    id: "claude-opus-4-5-20251101",
    displayName: "Claude Opus 4.5",
    tier: "powerful",
    inputRate: 0.005,
    outputRate: 0.025,
    cacheWriteRate: 0.00625, // 1.25x input
    cacheReadRate: 0.0005, // 0.1x input
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};

/**
 * Alias mappings for short model names
 */
const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
};

/**
 * Default model pricing for unknown models (use Sonnet rates)
 */
const DEFAULT_MODEL_INFO: ModelInfo = {
  id: "default",
  displayName: "Unknown Claude Model",
  tier: "balanced",
  inputRate: 0.003,
  outputRate: 0.015,
  cacheWriteRate: 0.00375,
  cacheReadRate: 0.0003,
  contextWindow: 200000,
  supportsStreaming: true,
  supportsCaching: true,
};

/**
 * Anthropic pricing engine implementation
 */
export class AnthropicPricingEngine implements ProviderPricingEngine {
  provider = "anthropic";

  getModels(): ModelInfo[] {
    return Object.values(ANTHROPIC_MODELS);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    // Check direct model ID first
    if (ANTHROPIC_MODELS[modelId]) {
      return ANTHROPIC_MODELS[modelId];
    }

    // Check aliases
    const aliasedId = MODEL_ALIASES[modelId.toLowerCase()];
    if (aliasedId && ANTHROPIC_MODELS[aliasedId]) {
      return ANTHROPIC_MODELS[aliasedId];
    }

    // Try to match by model family for unknown versions
    const modelLower = modelId.toLowerCase();
    if (modelLower.includes("haiku")) {
      return ANTHROPIC_MODELS["claude-haiku-4-5-20251001"];
    }
    if (modelLower.includes("opus")) {
      return ANTHROPIC_MODELS["claude-opus-4-6"];
    }
    if (modelLower.includes("sonnet")) {
      return ANTHROPIC_MODELS["claude-sonnet-4-6"];
    }

    return undefined;
  }

  validateModel(model: string): boolean {
    return this.getModelInfo(model) !== undefined;
  }

  calculateTokenCost(tokens: TokenUsage, model: string): number {
    const modelInfo = this.getModelInfo(model) || DEFAULT_MODEL_INFO;

    const inputCost = (tokens.inputTokens / 1000) * modelInfo.inputRate;
    const outputCost = (tokens.outputTokens / 1000) * modelInfo.outputRate;

    // Calculate cache costs if applicable
    let cacheCost = 0;
    if (modelInfo.cacheWriteRate && tokens.cacheCreationTokens) {
      cacheCost += (tokens.cacheCreationTokens / 1000) * modelInfo.cacheWriteRate;
    }
    if (modelInfo.cacheReadRate && tokens.cacheReadTokens) {
      cacheCost += (tokens.cacheReadTokens / 1000) * modelInfo.cacheReadRate;
    }

    return inputCost + outputCost + cacheCost;
  }

  calculateTotalCost(
    tokens: TokenUsage,
    model: string,
    durationSeconds: number
  ): number {
    const tokenCost = this.calculateTokenCost(tokens, model);
    const computeCost =
      (durationSeconds / 3600) * ECS_FARGATE_SPOT_RATE_PER_HOUR;
    return tokenCost + computeCost;
  }
}
