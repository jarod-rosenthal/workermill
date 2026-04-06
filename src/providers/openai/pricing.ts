/**
 * OpenAI Pricing Engine
 *
 * Implements ProviderPricingEngine for OpenAI models.
 * Pricing data verified April 2026 from:
 *   - https://developers.openai.com/api/docs/pricing
 *   - https://openrouter.ai/openai/
 *   - https://pricepertoken.com/pricing-page/provider/openai
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from "../../config/pricing.js";

/**
 * OpenAI model definitions with pricing.
 * Only models with ≥256K context windows are included.
 * Prices are per 1K tokens.
 */
const OPENAI_MODELS: Record<string, ModelInfo> = {
  // ---------------------------------------------------------------------------
  // GPT-5.4 family — primary current OpenAI models for WM CLI
  // ---------------------------------------------------------------------------
  "gpt-5.4": {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    tier: "powerful",
    inputRate: 0.0025, // $2.50 per 1M
    outputRate: 0.015, // $15 per 1M
    cacheReadRate: 0.00025, // $0.25 per 1M
    contextWindow: 1050000,
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

  // ---------------------------------------------------------------------------
  // GPT-5.3 family — verified from pricepertoken.com
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // GPT-5.2 family — verified from pricepertoken.com
  // ---------------------------------------------------------------------------
  "gpt-5.2-codex": {
    id: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    tier: "powerful",
    inputRate: 0.00175, // $1.75 per 1M
    outputRate: 0.014, // $14 per 1M
    cacheReadRate: 0.000175, // $0.175 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.2": {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    tier: "powerful",
    inputRate: 0.000875, // $0.875 per 1M (batch pricing from pricepertoken)
    outputRate: 0.007, // $7 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro",
    displayName: "GPT-5.2 Pro",
    tier: "powerful",
    inputRate: 0.0105, // $10.50 per 1M
    outputRate: 0.084, // $84 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: false,
  },

  // ---------------------------------------------------------------------------
  // GPT-5.1 family — verified from pricepertoken.com
  // ---------------------------------------------------------------------------
  "gpt-5.1-codex": {
    id: "gpt-5.1-codex",
    displayName: "GPT-5.1 Codex",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    cacheReadRate: 0.000125, // $0.125 per 1M
    contextWindow: 400000,
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
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.1-codex-mini": {
    id: "gpt-5.1-codex-mini",
    displayName: "GPT-5.1 Codex Mini",
    tier: "budget",
    inputRate: 0.00025, // $0.25 per 1M
    outputRate: 0.002, // $2 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5.1": {
    id: "gpt-5.1",
    displayName: "GPT-5.1",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },

  // ---------------------------------------------------------------------------
  // GPT-5 base family — verified from pricepertoken.com
  // ---------------------------------------------------------------------------
  "gpt-5": {
    id: "gpt-5",
    displayName: "GPT-5",
    tier: "powerful",
    inputRate: 0.000625, // $0.625 per 1M (batch pricing)
    outputRate: 0.005, // $5 per 1M
    cacheReadRate: 0.0000625, // estimated
    contextWindow: 400000,
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
    contextWindow: 400000,
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
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5-codex": {
    id: "gpt-5-codex",
    displayName: "GPT-5 Codex",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.01, // $10 per 1M
    cacheReadRate: 0.000125, // $0.125 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "gpt-5-pro": {
    id: "gpt-5-pro",
    displayName: "GPT-5 Pro",
    tier: "powerful",
    inputRate: 0.015, // $15 per 1M
    outputRate: 0.12, // $120 per 1M
    contextWindow: 400000,
    supportsStreaming: false,
    supportsCaching: false,
  },

  // ---------------------------------------------------------------------------
  // o-series reasoning models (≥200K context)
  // ---------------------------------------------------------------------------
  "o4-mini": {
    id: "o4-mini",
    displayName: "o4 Mini",
    tier: "balanced",
    inputRate: 0.00055, // $0.55 per 1M
    outputRate: 0.0022, // $2.20 per 1M
    cacheReadRate: 0.000275, // $0.275 per 1M
    contextWindow: 256000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "o3": {
    id: "o3",
    displayName: "o3",
    tier: "powerful",
    inputRate: 0.002, // $2 per 1M
    outputRate: 0.008, // $8 per 1M
    cacheReadRate: 0.0005, // $0.50 per 1M
    contextWindow: 256000,
    supportsStreaming: false,
    supportsCaching: true,
  },
  "o3-mini": {
    id: "o3-mini",
    displayName: "o3 Mini",
    tier: "balanced",
    inputRate: 0.00055, // $0.55 per 1M
    outputRate: 0.0022, // $2.20 per 1M
    contextWindow: 256000,
    supportsStreaming: false,
    supportsCaching: false,
  },
  "o3-pro": {
    id: "o3-pro",
    displayName: "o3 Pro",
    tier: "powerful",
    inputRate: 0.02, // $20 per 1M
    outputRate: 0.08, // $80 per 1M
    contextWindow: 256000,
    supportsStreaming: false,
    supportsCaching: false,
  },
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

    // Try prefix matching for dated variants (e.g. o4-mini-2025-04-16 → o4-mini)
    for (const [key, info] of Object.entries(OPENAI_MODELS)) {
      if (modelId.startsWith(key)) {
        return info;
      }
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
