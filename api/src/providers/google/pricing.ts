/**
 * Google (Gemini) Pricing Engine
 *
 * Implements ProviderPricingEngine for Google Gemini models.
 * Pricing data from Google AI as of January 2025.
 *
 * Note: Gemini has different pricing tiers based on context length.
 * These rates are for standard context (up to 128K).
 * Longer contexts may have different pricing.
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from "../../config/pricing.js";

/**
 * Google Gemini model definitions with pricing
 * Prices are per 1K tokens
 */
const GOOGLE_MODELS: Record<string, ModelInfo> = {
  // Gemini 2.5 Pro (latest powerful model - June 2025)
  "gemini-2.5-pro": {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M (estimate based on 1.5 Pro)
    outputRate: 0.005, // $5 per 1M
    cacheReadRate: 0.0003125,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 2.5 Flash (latest balanced model - June 2025)
  "gemini-2.5-flash": {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    tier: "balanced",
    inputRate: 0.000075, // $0.075 per 1M (estimate based on 2.0 Flash)
    outputRate: 0.0003, // $0.30 per 1M
    cacheReadRate: 0.00001875,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 2.0 Flash (fast model)
  "gemini-2.0-flash": {
    id: "gemini-2.0-flash",
    displayName: "Gemini 2.0 Flash",
    tier: "balanced",
    inputRate: 0.000075, // $0.075 per 1M = $0.000075 per 1K
    outputRate: 0.0003, // $0.30 per 1M = $0.0003 per 1K
    cacheReadRate: 0.00001875, // 25% of input rate for cached
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 2.0 Flash Thinking (experimental reasoning)
  "gemini-2.0-flash-thinking-exp": {
    id: "gemini-2.0-flash-thinking-exp",
    displayName: "Gemini 2.0 Flash Thinking",
    tier: "balanced",
    // Experimental model - using flash pricing as baseline
    inputRate: 0.000075,
    outputRate: 0.0003,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 1.5 Flash (previous generation fast)
  "gemini-1.5-flash": {
    id: "gemini-1.5-flash",
    displayName: "Gemini 1.5 Flash",
    tier: "budget",
    inputRate: 0.000075, // $0.075 per 1M
    outputRate: 0.0003, // $0.30 per 1M
    cacheReadRate: 0.00001875,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 1.5 Pro (powerful model)
  "gemini-1.5-pro": {
    id: "gemini-1.5-pro",
    displayName: "Gemini 1.5 Pro",
    tier: "powerful",
    inputRate: 0.00125, // $1.25 per 1M
    outputRate: 0.005, // $5 per 1M
    cacheReadRate: 0.0003125, // 25% of input rate for cached
    contextWindow: 2000000, // 2M context window!
    supportsStreaming: true,
    supportsCaching: true,
  },
  // Gemini 1.0 Pro (legacy)
  "gemini-1.0-pro": {
    id: "gemini-1.0-pro",
    displayName: "Gemini 1.0 Pro",
    tier: "budget",
    inputRate: 0.0005, // $0.50 per 1M
    outputRate: 0.0015, // $1.50 per 1M
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * Alias mappings for convenience
 */
const MODEL_ALIASES: Record<string, string> = {
  "gemini-flash": "gemini-2.5-flash",
  "gemini-pro": "gemini-2.5-pro",
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
};

/**
 * Google pricing engine implementation
 */
export class GooglePricingEngine implements ProviderPricingEngine {
  provider = "google";

  getModels(): ModelInfo[] {
    return Object.values(GOOGLE_MODELS);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    // Check direct model ID first
    if (GOOGLE_MODELS[modelId]) {
      return GOOGLE_MODELS[modelId];
    }

    // Check aliases
    const aliasedId = MODEL_ALIASES[modelId.toLowerCase()];
    if (aliasedId && GOOGLE_MODELS[aliasedId]) {
      return GOOGLE_MODELS[aliasedId];
    }

    // Try pattern matching for versioned model names
    const modelLower = modelId.toLowerCase();
    if (modelLower.includes("flash") && modelLower.includes("2.5")) {
      return GOOGLE_MODELS["gemini-2.5-flash"];
    }
    if (modelLower.includes("flash") && modelLower.includes("2.0")) {
      return GOOGLE_MODELS["gemini-2.0-flash"];
    }
    if (modelLower.includes("flash")) {
      return GOOGLE_MODELS["gemini-2.5-flash"]; // Default to latest flash
    }
    if (modelLower.includes("pro") && modelLower.includes("2.5")) {
      return GOOGLE_MODELS["gemini-2.5-pro"];
    }
    if (modelLower.includes("pro") && modelLower.includes("1.5")) {
      return GOOGLE_MODELS["gemini-1.5-pro"];
    }
    if (modelLower.includes("pro")) {
      return GOOGLE_MODELS["gemini-2.5-pro"]; // Default to latest pro
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

    // Handle cached token pricing
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
