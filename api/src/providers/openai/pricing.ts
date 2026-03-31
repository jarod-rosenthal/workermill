/**
 * OpenAI Pricing Engine
 *
 * Implements ProviderPricingEngine for OpenAI models.
 * Pricing data from OpenAI as of January 2026.
 * Source: https://platform.openai.com/docs/pricing
 *
 * Note: OpenAI does not support prompt caching in the same way as Anthropic.
 * The o1 models support "cached tokens" but pricing is different.
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from "../../config/pricing.js";

/**
 * OpenAI model definitions with pricing
 * Prices are per 1K tokens
 */
const OPENAI_MODELS: Record<string, ModelInfo> = {
  // GPT-4o (flagship model)
  "gpt-4o": {
    id: "gpt-4o",
    displayName: "GPT-4o",
    tier: "powerful",
    inputRate: 0.0025, // $2.50 per 1M = $0.0025 per 1K
    outputRate: 0.01, // $10 per 1M = $0.01 per 1K
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // GPT-4o mini (efficient version)
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    tier: "budget",
    inputRate: 0.00015, // $0.15 per 1M
    outputRate: 0.0006, // $0.60 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // GPT-4 Turbo (legacy but still available)
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    displayName: "GPT-4 Turbo",
    tier: "balanced",
    inputRate: 0.01, // $10 per 1M
    outputRate: 0.03, // $30 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // o1 (reasoning model)
  o1: {
    id: "o1",
    displayName: "o1",
    tier: "powerful",
    inputRate: 0.015, // $15 per 1M
    outputRate: 0.06, // $60 per 1M
    // o1 has "cached" pricing but we track it separately
    cacheReadRate: 0.0075, // $7.50 per 1M (cached input)
    contextWindow: 200000,
    supportsStreaming: false, // o1 does not support streaming
    supportsCaching: true,
  },
  // o1-mini (smaller reasoning model)
  "o1-mini": {
    id: "o1-mini",
    displayName: "o1 Mini",
    tier: "budget",
    inputRate: 0.003, // $3 per 1M
    outputRate: 0.012, // $12 per 1M
    cacheReadRate: 0.0015, // $1.50 per 1M (cached input)
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  // o1-pro (enhanced reasoning)
  "o1-pro": {
    id: "o1-pro",
    displayName: "o1 Pro",
    tier: "powerful",
    inputRate: 0.15, // $150 per 1M
    outputRate: 0.6, // $600 per 1M
    contextWindow: 200000,
    supportsStreaming: false,
    supportsCaching: false,
  },
  // GPT-5 models (Responses API - 500K TPM)
  // Pricing from OpenAI: https://platform.openai.com/docs/pricing
  "gpt-5": {
    id: "gpt-5",
    displayName: "GPT-5",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    cacheReadRate: 0.000125, // $0.125 per 1M (cached input)
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5-mini": {
    id: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    tier: "budget",
    inputRate: 0.00025, // $0.25 per 1M
    outputRate: 0.002, // $2 per 1M
    cacheReadRate: 0.000025, // $0.025 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5-nano": {
    id: "gpt-5-nano",
    displayName: "GPT-5 Nano",
    tier: "budget",
    inputRate: 0.00005, // $0.05 per 1M
    outputRate: 0.0004, // $0.40 per 1M
    cacheReadRate: 0.000005, // $0.005 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.1-codex": {
    id: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    cacheReadRate: 0.000125, // $0.125 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.1-codex-max": {
    id: "gpt-5.1-codex-max",
    displayName: "GPT-5.1 Codex Max",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    cacheReadRate: 0.000125, // $0.125 per 1M
    contextWindow: 200000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.2-codex": {
    id: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    tier: "powerful",
    inputRate: 0.00175, // $1.75 per 1M
    outputRate: 0.014, // $14 per 1M
    cacheReadRate: 0.000175, // $0.175 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    displayName: "GPT-5.2 Pro",
    tier: "powerful",
    inputRate: 0.00175, // $1.75 per 1M (estimated, same tier as 5.2 codex)
    outputRate: 0.014, // $14 per 1M
    cacheReadRate: 0.000175, // $0.175 per 1M
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  // GPT-5.3 Codex — verified from openai.com/api/pricing (March 2026)
  "gpt-5.3-codex": {
    id: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    tier: "powerful",
    inputRate: 0.00175, // $1.75 per 1M
    outputRate: 0.014, // $14 per 1M
    cacheReadRate: 0.000175, // $0.175 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  // GPT-5.4 family — verified from openai.com/api/pricing (March 2026)
  "gpt-5.4": {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    tier: "powerful",
    inputRate: 0.0025, // $2.50 per 1M
    outputRate: 0.015, // $15 per 1M
    cacheReadRate: 0.00025, // $0.25 per 1M
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 Mini",
    tier: "budget",
    inputRate: 0.00075, // $0.75 per 1M
    outputRate: 0.0045, // $4.50 per 1M
    cacheReadRate: 0.000075, // $0.075 per 1M
    contextWindow: 400000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "gpt-5.4-pro": {
    id: "gpt-5.4-pro",
    displayName: "GPT-5.4 Pro",
    tier: "powerful",
    inputRate: 0.03, // $30 per 1M
    outputRate: 0.18, // $180 per 1M
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "gpt-5.4-nano": {
    id: "gpt-5.4-nano",
    displayName: "GPT-5.4 Nano",
    tier: "budget",
    inputRate: 0.0002, // $0.20 per 1M
    outputRate: 0.00125, // $1.25 per 1M
    cacheReadRate: 0.00002, // $0.02 per 1M
    contextWindow: 400000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};

/**
 * Alias mappings for convenience
 */
const MODEL_ALIASES: Record<string, string> = {
  "gpt4o": "gpt-4o",
  "gpt-4-o": "gpt-4o",
  "gpt4": "gpt-4-turbo",
};

/**
 * OpenAI pricing engine implementation
 */
export class OpenAIPricingEngine implements ProviderPricingEngine {
  provider = "openai";

  getModels(): ModelInfo[] {
    return Object.values(OPENAI_MODELS);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    // Check direct model ID first
    if (OPENAI_MODELS[modelId]) {
      return OPENAI_MODELS[modelId];
    }

    // Check aliases
    const aliasedId = MODEL_ALIASES[modelId.toLowerCase()];
    if (aliasedId && OPENAI_MODELS[aliasedId]) {
      return OPENAI_MODELS[aliasedId];
    }

    return undefined;
  }

  validateModel(model: string): boolean {
    return this.getModelInfo(model) !== undefined;
  }

  calculateTokenCost(tokens: TokenUsage, model: string): number {
    const modelInfo = this.getModelInfo(model);
    if (!modelInfo) {
      // Unknown model - return 0 rather than guess
      return 0;
    }

    const inputCost = (tokens.inputTokens / 1000) * modelInfo.inputRate;
    const outputCost = (tokens.outputTokens / 1000) * modelInfo.outputRate;

    // For o1 models, cacheReadTokens represents cached input tokens
    let cacheCost = 0;
    if (modelInfo.cacheReadRate && tokens.cacheReadTokens) {
      cacheCost = (tokens.cacheReadTokens / 1000) * modelInfo.cacheReadRate;
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
