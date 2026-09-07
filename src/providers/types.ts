/**
 * Provider Types for Multi-Provider AI Support
 *
 * Defines common interfaces used across all AI providers for:
 * - Token usage tracking
 * - Model information
 * - Pricing calculations
 * - Provider configuration
 */

/**
 * Token usage from an AI model execution
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

/**
 * Whether an API-price estimate can be made for a recorded model call.
 * Local means the provider has no API token charge; it does not estimate
 * hardware, electricity, or hosted-local compute costs.
 */
export type ApiPricingState = "known" | "unknown" | "local";

/**
 * Information about a specific AI model
 */
export interface ModelInfo {
  id: string;
  displayName: string;
  tier: "budget" | "balanced" | "powerful";
  inputRate: number; // cost per 1K tokens
  outputRate: number; // cost per 1K tokens
  cacheWriteRate?: number; // cost per 1K tokens (if supported)
  cacheReadRate?: number; // cost per 1K tokens (if supported)
  contextWindow: number;
  supportsStreaming: boolean;
  supportsCaching: boolean;
}

/**
 * Interface for provider-specific pricing calculations
 */
export interface ProviderPricingEngine {
  /** Provider identifier (e.g., 'anthropic', 'openai') */
  provider: string;

  /** Get all available models for this provider */
  getModels(): ModelInfo[];

  /** Get info for a specific model */
  getModelInfo(modelId: string): ModelInfo | undefined;

  /** Calculate cost from token usage only */
  calculateTokenCost(tokens: TokenUsage, model: string): number;

  /** Calculate total cost including compute time */
  calculateTotalCost(
    tokens: TokenUsage,
    model: string,
    durationSeconds: number
  ): number;

  /** Check if a model ID is valid for this provider */
  validateModel(model: string): boolean;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  pricingEngine: ProviderPricingEngine;
  defaultModel: string;
  requiresApiKey: boolean;
  /** Environment variable name for the API key */
  apiKeyEnvVar?: string;
}

/**
 * Supported provider identifiers
 * ai-sdk: Vercel AI SDK multi-expert mode that routes to underlying providers
 */
export type ProviderId = "anthropic" | "openai" | "google" | "ollama" | "openrouter" | "groq" | "deepseek" | "mistral" | "xai" | "bedrock" | "azure" | "ai-sdk";

/**
 * Check if a string is a valid provider ID
 */
export function isValidProviderId(id: string): id is ProviderId {
  return ["anthropic", "openai", "google", "ollama", "openrouter", "groq", "deepseek", "mistral", "xai", "bedrock", "azure", "ai-sdk"].includes(id);
}
