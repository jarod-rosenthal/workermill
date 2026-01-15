/**
 * Ollama (Local) Pricing Engine
 *
 * Implements ProviderPricingEngine for local Ollama models.
 *
 * Ollama runs locally with no per-token costs. The only cost is
 * the ECS Fargate compute time (or local compute if running on-premises).
 *
 * This pricing engine tracks compute costs only.
 */

import type {
  ProviderPricingEngine,
  TokenUsage,
  ModelInfo,
} from "../types.js";
import { ECS_FARGATE_SPOT_RATE_PER_HOUR } from "../../config/pricing.js";

/**
 * Common Ollama models
 *
 * Ollama models have no API costs - all pricing is $0.00 per token.
 * We define models here for tracking purposes and context window info.
 */
const OLLAMA_MODELS: Record<string, ModelInfo> = {
  // Llama 3.1 variants
  "llama3.1:8b": {
    id: "llama3.1:8b",
    displayName: "Llama 3.1 8B",
    tier: "budget",
    inputRate: 0, // Free - local model
    outputRate: 0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "llama3.1:70b": {
    id: "llama3.1:70b",
    displayName: "Llama 3.1 70B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "llama3.1:405b": {
    id: "llama3.1:405b",
    displayName: "Llama 3.1 405B",
    tier: "powerful",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // Llama 3.2 variants
  "llama3.2:1b": {
    id: "llama3.2:1b",
    displayName: "Llama 3.2 1B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "llama3.2:3b": {
    id: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 128000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // Code Llama variants
  "codellama:7b": {
    id: "codellama:7b",
    displayName: "Code Llama 7B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "codellama:13b": {
    id: "codellama:13b",
    displayName: "Code Llama 13B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "codellama:34b": {
    id: "codellama:34b",
    displayName: "Code Llama 34B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // Mistral variants
  "mistral:7b": {
    id: "mistral:7b",
    displayName: "Mistral 7B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "mixtral:8x7b": {
    id: "mixtral:8x7b",
    displayName: "Mixtral 8x7B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // DeepSeek Coder
  "deepseek-coder:6.7b": {
    id: "deepseek-coder:6.7b",
    displayName: "DeepSeek Coder 6.7B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "deepseek-coder:33b": {
    id: "deepseek-coder:33b",
    displayName: "DeepSeek Coder 33B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 16000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  // Qwen variants
  "qwen2.5-coder:7b": {
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    tier: "budget",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
  "qwen2.5-coder:32b": {
    id: "qwen2.5-coder:32b",
    displayName: "Qwen 2.5 Coder 32B",
    tier: "balanced",
    inputRate: 0,
    outputRate: 0,
    contextWindow: 32000,
    supportsStreaming: true,
    supportsCaching: false,
  },
};

/**
 * Alias mappings for convenience
 */
const MODEL_ALIASES: Record<string, string> = {
  llama: "llama3.1:8b",
  codellama: "codellama:13b",
  mistral: "mistral:7b",
  mixtral: "mixtral:8x7b",
  deepseek: "deepseek-coder:6.7b",
  qwen: "qwen2.5-coder:7b",
};

/**
 * Default model info for unknown Ollama models
 * Since all Ollama models are free, we just need basic info
 */
const DEFAULT_OLLAMA_MODEL: ModelInfo = {
  id: "unknown",
  displayName: "Unknown Ollama Model",
  tier: "budget",
  inputRate: 0,
  outputRate: 0,
  contextWindow: 8000, // Conservative default
  supportsStreaming: true,
  supportsCaching: false,
};

/**
 * Ollama pricing engine implementation
 */
export class OllamaPricingEngine implements ProviderPricingEngine {
  provider = "ollama";

  getModels(): ModelInfo[] {
    return Object.values(OLLAMA_MODELS);
  }

  getModelInfo(modelId: string): ModelInfo | undefined {
    // Check direct model ID first
    if (OLLAMA_MODELS[modelId]) {
      return OLLAMA_MODELS[modelId];
    }

    // Check aliases
    const aliasedId = MODEL_ALIASES[modelId.toLowerCase()];
    if (aliasedId && OLLAMA_MODELS[aliasedId]) {
      return OLLAMA_MODELS[aliasedId];
    }

    // For unknown models, return the default (Ollama can run any pulled model)
    // This is different from other providers - Ollama is flexible
    return undefined;
  }

  validateModel(_model: string): boolean {
    // Ollama can run any model that's been pulled locally
    // We can't validate remotely, so we accept all models
    return true;
  }

  calculateTokenCost(_tokens: TokenUsage, _model: string): number {
    // Ollama models are free - no token costs
    return 0;
  }

  calculateTotalCost(
    _tokens: TokenUsage,
    _model: string,
    durationSeconds: number
  ): number {
    // Only compute cost for Ollama (assuming it runs in ECS)
    // If running locally outside ECS, this would be 0
    const computeCost =
      (durationSeconds / 3600) * ECS_FARGATE_SPOT_RATE_PER_HOUR;
    return computeCost;
  }
}
