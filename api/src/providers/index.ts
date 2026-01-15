/**
 * Provider Registry
 *
 * Central registry for all AI providers. Provides access to:
 * - Provider configurations
 * - Pricing engines
 * - Model information
 *
 * Default provider is Anthropic for backward compatibility.
 */

import type {
  ProviderConfig,
  ProviderPricingEngine,
  ProviderId,
  ModelInfo,
} from "./types.js";
import { AnthropicPricingEngine } from "./anthropic/pricing.js";
import { OpenAIPricingEngine } from "./openai/pricing.js";
import { GooglePricingEngine } from "./google/pricing.js";
import { OllamaPricingEngine } from "./ollama/pricing.js";

// Re-export types for convenience
export * from "./types.js";

/**
 * Provider configurations
 */
const providers: Record<string, ProviderConfig> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic (Claude)",
    pricingEngine: new AnthropicPricingEngine(),
    defaultModel: "claude-sonnet-4-20250514",
    requiresApiKey: true,
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    pricingEngine: new OpenAIPricingEngine(),
    defaultModel: "gpt-4o",
    requiresApiKey: true,
    apiKeyEnvVar: "OPENAI_API_KEY",
  },
  google: {
    id: "google",
    name: "Google (Gemini)",
    pricingEngine: new GooglePricingEngine(),
    defaultModel: "gemini-2.0-flash",
    requiresApiKey: true,
    apiKeyEnvVar: "GOOGLE_API_KEY",
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    pricingEngine: new OllamaPricingEngine(),
    defaultModel: "llama3.1:8b",
    requiresApiKey: false,
  },
};

/**
 * Default provider ID
 */
export const DEFAULT_PROVIDER_ID: ProviderId = "anthropic";

/**
 * Get a provider configuration by ID
 * Falls back to Anthropic if provider not found
 */
export function getProvider(providerId: string): ProviderConfig {
  return providers[providerId] ?? providers.anthropic;
}

/**
 * Get a pricing engine by provider ID
 * Falls back to Anthropic pricing engine if provider not found
 */
export function getPricingEngine(providerId: string): ProviderPricingEngine {
  return getProvider(providerId).pricingEngine;
}

/**
 * List all available providers
 */
export function listProviders(): ProviderConfig[] {
  return Object.values(providers);
}

/**
 * Get all provider IDs
 */
export function getProviderIds(): string[] {
  return Object.keys(providers);
}

/**
 * Check if a provider exists
 */
export function hasProvider(providerId: string): boolean {
  return providerId in providers;
}

/**
 * Get the default model for a provider
 */
export function getDefaultModel(providerId: string): string {
  return getProvider(providerId).defaultModel;
}

/**
 * Get model info for a specific model across any provider
 * Searches all providers to find the model
 */
export function findModelInfo(modelId: string): ModelInfo | undefined {
  for (const provider of Object.values(providers)) {
    const modelInfo = provider.pricingEngine.getModelInfo(modelId);
    if (modelInfo) {
      return modelInfo;
    }
  }
  return undefined;
}

/**
 * Detect which provider a model belongs to
 * Returns undefined if model not found in any provider
 */
export function detectProviderForModel(modelId: string): string | undefined {
  for (const [providerId, provider] of Object.entries(providers)) {
    if (provider.pricingEngine.validateModel(modelId)) {
      // Special case: Ollama validates all models, so check other providers first
      if (providerId !== "ollama") {
        return providerId;
      }
    }
  }

  // Check if it looks like an Ollama model (contains colon for version)
  if (modelId.includes(":")) {
    return "ollama";
  }

  return undefined;
}

/**
 * Get summary statistics for display
 */
export function getProviderSummary(): Array<{
  id: string;
  name: string;
  modelCount: number;
  defaultModel: string;
  requiresApiKey: boolean;
}> {
  return Object.values(providers).map((provider) => ({
    id: provider.id,
    name: provider.name,
    modelCount: provider.pricingEngine.getModels().length,
    defaultModel: provider.defaultModel,
    requiresApiKey: provider.requiresApiKey,
  }));
}
