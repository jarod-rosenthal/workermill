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
  "anthropic/claude-sonnet-4": {
    id: "anthropic/claude-sonnet-4",
    displayName: "Claude Sonnet 4 (via OR)",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    displayName: "GPT-4o (via OR)",
    tier: "balanced",
    inputRate: 0.0025,
    outputRate: 0.01,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "google/gemini-2.5-flash": {
    id: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash (via OR)",
    tier: "balanced",
    inputRate: 0.00015,
    outputRate: 0.0006,
    contextWindow: 1000000,
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
    displayName: "Mistral Large (via OR)",
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
 */
export const GROQ_MODELS: Record<string, ModelInfo> = {
  "llama-3.3-70b-versatile": {
    id: "llama-3.3-70b-versatile",
    displayName: "Llama 3.3 70B",
    tier: "powerful",
    inputRate: 0.00059,
    outputRate: 0.00079,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "llama-3.1-8b-instant": {
    id: "llama-3.1-8b-instant",
    displayName: "Llama 3.1 8B Instant",
    tier: "budget",
    inputRate: 0.00005,
    outputRate: 0.00008,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mixtral-8x7b-32768": {
    id: "mixtral-8x7b-32768",
    displayName: "Mixtral 8x7B",
    tier: "balanced",
    inputRate: 0.00024,
    outputRate: 0.00024,
    contextWindow: 32768,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "gemma2-9b-it": {
    id: "gemma2-9b-it",
    displayName: "Gemma 2 9B",
    tier: "budget",
    inputRate: 0.0002,
    outputRate: 0.0002,
    contextWindow: 8192,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * DeepSeek Models
 * DeepSeek offers powerful reasoning models at very low prices
 */
export const DEEPSEEK_MODELS: Record<string, ModelInfo> = {
  "deepseek-chat": {
    id: "deepseek-chat",
    displayName: "DeepSeek Chat",
    tier: "balanced",
    inputRate: 0.00014,
    outputRate: 0.00028,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: true,
  },
  "deepseek-reasoner": {
    id: "deepseek-reasoner",
    displayName: "DeepSeek Reasoner",
    tier: "powerful",
    inputRate: 0.00055,
    outputRate: 0.00219,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: true,
  },
};

/**
 * Mistral AI Models
 * European AI leader with strong code and multilingual capabilities
 */
export const MISTRAL_MODELS: Record<string, ModelInfo> = {
  "mistral-large-latest": {
    id: "mistral-large-latest",
    displayName: "Mistral Large",
    tier: "powerful",
    inputRate: 0.002,
    outputRate: 0.006,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mistral-medium-latest": {
    id: "mistral-medium-latest",
    displayName: "Mistral Medium",
    tier: "balanced",
    inputRate: 0.00275,
    outputRate: 0.0081,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mistral-small-latest": {
    id: "mistral-small-latest",
    displayName: "Mistral Small",
    tier: "budget",
    inputRate: 0.0002,
    outputRate: 0.0006,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "codestral-latest": {
    id: "codestral-latest",
    displayName: "Codestral (Code)",
    tier: "balanced",
    inputRate: 0.0003,
    outputRate: 0.0009,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "pixtral-large-latest": {
    id: "pixtral-large-latest",
    displayName: "Pixtral Large (Vision)",
    tier: "powerful",
    inputRate: 0.002,
    outputRate: 0.006,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * xAI Models (Grok)
 * Strong reasoning with real-time knowledge
 */
export const XAI_MODELS: Record<string, ModelInfo> = {
  "grok-3": {
    id: "grok-3",
    displayName: "Grok 3",
    tier: "powerful",
    inputRate: 0.003,
    outputRate: 0.015,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "grok-3-fast": {
    id: "grok-3-fast",
    displayName: "Grok 3 Fast",
    tier: "balanced",
    inputRate: 0.005,
    outputRate: 0.025,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "grok-2": {
    id: "grok-2",
    displayName: "Grok 2",
    tier: "balanced",
    inputRate: 0.002,
    outputRate: 0.01,
    contextWindow: 131072,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * AWS Bedrock Models
 * Enterprise-grade AI through AWS with cross-region inference
 * Pricing may vary by region - these are US East baseline rates
 */
export const BEDROCK_MODELS: Record<string, ModelInfo> = {
  "anthropic.claude-3-5-sonnet-20241022-v2:0": {
    id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    displayName: "Claude 3.5 Sonnet v2 (Bedrock)",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.015,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "anthropic.claude-3-5-haiku-20241022-v1:0": {
    id: "anthropic.claude-3-5-haiku-20241022-v1:0",
    displayName: "Claude 3.5 Haiku (Bedrock)",
    tier: "budget",
    inputRate: 0.0008,
    outputRate: 0.004,
    contextWindow: 200000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    id: "anthropic.claude-3-opus-20240229-v1:0",
    displayName: "Claude 3 Opus (Bedrock)",
    tier: "powerful",
    inputRate: 0.015,
    outputRate: 0.075,
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
  "meta.llama3-70b-instruct-v1:0": {
    id: "meta.llama3-70b-instruct-v1:0",
    displayName: "Llama 3 70B (Bedrock)",
    tier: "powerful",
    inputRate: 0.00265,
    outputRate: 0.0035,
    contextWindow: 8192,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mistral.mistral-large-2407-v1:0": {
    id: "mistral.mistral-large-2407-v1:0",
    displayName: "Mistral Large (Bedrock)",
    tier: "powerful",
    inputRate: 0.004,
    outputRate: 0.012,
    contextWindow: 128000,
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
  "gpt-4o": {
    id: "gpt-4o",
    displayName: "GPT-4o (Foundry)",
    tier: "balanced",
    inputRate: 0.0025,
    outputRate: 0.01,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini (Foundry)",
    tier: "budget",
    inputRate: 0.00015,
    outputRate: 0.0006,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "gpt-4-turbo": {
    id: "gpt-4-turbo",
    displayName: "GPT-4 Turbo (Foundry)",
    tier: "powerful",
    inputRate: 0.01,
    outputRate: 0.03,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "o1-preview": {
    id: "o1-preview",
    displayName: "o1-preview (Foundry)",
    tier: "powerful",
    inputRate: 0.015,
    outputRate: 0.06,
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: false,
  },
  "o1-mini": {
    id: "o1-mini",
    displayName: "o1-mini (Foundry)",
    tier: "balanced",
    inputRate: 0.003,
    outputRate: 0.012,
    contextWindow: 128000,
    supportsStreaming: false,
    supportsCaching: false,
  },
};
