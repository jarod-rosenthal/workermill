/**
 * Generic Pricing Engine
 *
 * A configurable pricing engine that can be used for multiple providers
 * with their specific model configurations.
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";

/**
 * Generic pricing engine that can be configured for any provider
 */
export class GenericPricingEngine implements ProviderPricingEngine {
  provider: string;
  private models: Record<string, ModelInfo>;
  private defaultModel: ModelInfo;

  constructor(
    provider: string,
    models: Record<string, ModelInfo>,
    defaultModel?: ModelInfo
  ) {
    this.provider = provider;
    this.models = models;
    this.defaultModel = defaultModel || {
      id: "unknown",
      displayName: "Unknown Model",
      tier: "balanced",
      inputRate: 0.001, // $1/1M tokens default
      outputRate: 0.002,
      contextWindow: 128000,
      supportsStreaming: true,
      supportsCaching: false,
    };
  }

  getModels(): ModelInfo[] {
    return Object.values(this.models);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    return this.models[modelId];
  }

  validateModel(model: string): boolean {
    return model in this.models;
  }

  calculateTokenCost(tokens: TokenUsage, model: string): number {
    const modelInfo = this.getModelInfo(model) || this.defaultModel;
    const inputCost = (tokens.inputTokens / 1000) * modelInfo.inputRate;
    const outputCost = (tokens.outputTokens / 1000) * modelInfo.outputRate;
    return inputCost + outputCost;
  }

  calculateTotalCost(
    tokens: TokenUsage,
    model: string,
    _durationSeconds: number
  ): number {
    // For API-based providers, compute time is included in token pricing
    return this.calculateTokenCost(tokens, model);
  }
}

/**
 * OpenRouter Models
 * OpenRouter uses underlying provider pricing plus a small markup
 */
export const OPENROUTER_MODELS: Record<string, ModelInfo> = {
  "anthropic/claude-sonnet-4-6": {
    id: "anthropic/claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6 (via OR)",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "openai/gpt-5.4": {
    id: "openai/gpt-5.4",
    displayName: "GPT-5.4 (via OR)",
    tier: "powerful",
    inputRate: 0.0025,
    outputRate: 0.015,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "google/gemini-2.5-flash": {
    id: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash (via OR)",
    tier: "balanced",
    inputRate: 0.0003,
    outputRate: 0.0025,
    contextWindow: 1048576,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "deepseek/deepseek-r1": {
    id: "deepseek/deepseek-r1",
    displayName: "DeepSeek R1 (via OR)",
    tier: "powerful",
    inputRate: 0.00055,
    outputRate: 0.00219,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "meta-llama/llama-3.3-70b-instruct": {
    id: "meta-llama/llama-3.3-70b-instruct",
    displayName: "Llama 3.3 70B (via OR)",
    tier: "powerful",
    inputRate: 0.00059,
    outputRate: 0.00079,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mistralai/mistral-large": {
    id: "mistralai/mistral-large",
    displayName: "Mistral Large 3 (via OR)",
    tier: "powerful",
    inputRate: 0.002,
    outputRate: 0.006,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * Groq Models
 * Groq offers ultra-fast inference at competitive prices
 * Pricing verified April 2026 from groq.com/pricing
 */
export const GROQ_MODELS: Record<string, ModelInfo> = {
  "llama-3.3-70b-versatile": {
    id: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    tier: "powerful",
    inputRate: 0.00059, // $0.59 per 1M
    outputRate: 0.00079, // $0.79 per 1M
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "llama-3.1-8b-instant": {
    id: "llama-3.1-8b-instant",
    displayName: "Llama 3.1 8B Instant",
    tier: "budget",
    inputRate: 0.00005, // $0.05 per 1M
    outputRate: 0.00008, // $0.08 per 1M
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "qwen3-32b": {
    id: "qwen3-32b",
    displayName: "Qwen3 32B",
    tier: "balanced",
    inputRate: 0.00029, // $0.29 per 1M
    outputRate: 0.00059, // $0.59 per 1M
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * DeepSeek Models
 * Pricing verified April 2026 from api-docs.deepseek.com
 */
export const DEEPSEEK_MODELS: Record<string, ModelInfo> = {
  "deepseek-chat": {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat V3.2",
    tier: "balanced",
    inputRate: 0.00028, // $0.28 per 1M
    outputRate: 0.00042, // $0.42 per 1M
    cacheReadRate: 0.000028, // $0.028 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    displayName: "DeepSeek R1",
    tier: "powerful",
    inputRate: 0.00055, // $0.55 per 1M
    outputRate: 0.00219, // $2.19 per 1M
    cacheReadRate: 0.00014, // $0.14 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "deepseek-v4": {
    id: "deepseek-v4",
    displayName: "DeepSeek V4",
    tier: "powerful",
    inputRate: 0.0003, // $0.30 per 1M
    outputRate: 0.0005, // $0.50 per 1M
    cacheReadRate: 0.00003, // $0.03 per 1M
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};

/**
 * Mistral AI Models
 * Pricing verified April 2026 from mistral.ai
 */
export const MISTRAL_MODELS: Record<string, ModelInfo> = {
  "mistral-large-latest": {
    id: "mistral-large-latest",
    displayName: "Mistral Large 3",
    tier: "powerful",
    inputRate: 0.002, // $2.00 per 1M
    outputRate: 0.006, // $6.00 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mistral-small-latest": {
    id: "mistral-small-latest",
    displayName: "Mistral Small 3.1",
    tier: "budget",
    inputRate: 0.00003, // $0.03 per 1M
    outputRate: 0.00011, // $0.11 per 1M
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "codestral-latest": {
    id: "codestral-latest",
    displayName: "Codestral",
    tier: "balanced",
    inputRate: 0.0003, // $0.30 per 1M
    outputRate: 0.0009, // $0.90 per 1M
    contextWindow: 256000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "devstral-latest": {
    id: "devstral-latest",
    displayName: "Devstral 2",
    tier: "balanced",
    inputRate: 0.0005, // $0.50 per 1M
    outputRate: 0.0015, // $1.50 per 1M
    contextWindow: 262000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * xAI Models (Grok)
 * Pricing verified April 2026 from docs.x.ai
 */
export const XAI_MODELS: Record<string, ModelInfo> = {
  "grok-4.20": {
    id: "grok-4.20",
    displayName: "Grok 4.20",
    tier: "powerful",
    inputRate: 0.002, // $2.00 per 1M
    outputRate: 0.006, // $6.00 per 1M
    cacheReadRate: 0.0002, // $0.20 per 1M
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "grok-4.20-reasoning": {
    id: "grok-4.20-reasoning",
    displayName: "Grok 4.20 Reasoning",
    tier: "powerful",
    inputRate: 0.002, // $2.00 per 1M
    outputRate: 0.006, // $6.00 per 1M
    cacheReadRate: 0.0002, // $0.20 per 1M
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "grok-4.1-fast": {
    id: "grok-4.1-fast",
    displayName: "Grok 4.1 Fast",
    tier: "balanced",
    inputRate: 0.0002, // $0.20 per 1M
    outputRate: 0.0005, // $0.50 per 1M
    cacheReadRate: 0.00005, // $0.05 per 1M
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "grok-4.1-fast-reasoning": {
    id: "grok-4.1-fast-reasoning",
    displayName: "Grok 4.1 Fast Reasoning",
    tier: "balanced",
    inputRate: 0.0002, // $0.20 per 1M
    outputRate: 0.0005, // $0.50 per 1M
    cacheReadRate: 0.00005, // $0.05 per 1M
    contextWindow: 2000000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};

/**
 * AWS Bedrock Models
 * Enterprise-grade AI through AWS with cross-region inference
 * Pricing may vary by region - these are US East baseline rates
 */
export const BEDROCK_MODELS: Record<string, ModelInfo> = {
  "anthropic.claude-sonnet-4-6-20250514-v1:0": {
    id: "anthropic.claude-sonnet-4-6-20250514-v1:0",
    displayName: "Claude Sonnet 4.6 (Bedrock)",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    contextWindow: 1000000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "anthropic.claude-haiku-4-5-20251001-v1:0": {
    id: "anthropic.claude-haiku-4-5-20251001-v1:0",
    displayName: "Claude Haiku 4.5 (Bedrock)",
    tier: "budget",
    inputRate: 0.001,
    outputRate: 0.005,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "amazon.nova-pro-v1:0": {
    id: "amazon.nova-pro-v1:0",
    displayName: "Amazon Nova Pro",
    tier: "balanced",
    inputRate: 0.0008,
    outputRate: 0.0032,
    contextWindow: 300000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "amazon.nova-lite-v1:0": {
    id: "amazon.nova-lite-v1:0",
    displayName: "Amazon Nova Lite",
    tier: "budget",
    inputRate: 0.00006,
    outputRate: 0.00024,
    contextWindow: 300000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * Azure AI Foundry Models
 * Enterprise Azure deployments with regional pricing
 * Note: Actual model names depend on your Azure deployment names
 */
export const AZURE_MODELS: Record<string, ModelInfo> = {
  "gpt-5.4": {
    id: "gpt-5.4",
    displayName: "GPT-5.4 (Foundry)",
    tier: "powerful",
    inputRate: 0.0025,
    outputRate: 0.015,
    contextWindow: 1050000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    displayName: "GPT-5.4 Mini (Foundry)",
    tier: "budget",
    inputRate: 0.00075,
    outputRate: 0.0045,
    contextWindow: 400000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "o4-mini": {
    id: "o4-mini",
    displayName: "o4-mini (Foundry)",
    tier: "balanced",
    inputRate: 0.004,
    outputRate: 0.016,
    contextWindow: 256000,
    supportsStreaming: false,
    supportsCaching: true,
  },
};
