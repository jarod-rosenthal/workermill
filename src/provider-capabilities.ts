/**
 * Provider capability registry — centralizes provider/model feature differences
 * so the rest of the codebase queries capabilities instead of checking provider names.
 *
 * Usage:
 *   import { getProviderCapabilities } from "./provider-capabilities.js";
 *   const caps = getProviderCapabilities("ollama");
 *   if (caps.needsContextOverride) { ... }
 */

export interface ProviderCapabilities {
  /** Provider needs explicit context window override (num_ctx for Ollama, model reload for LM Studio). */
  needsContextOverride: boolean;
  /** Provider is local — skip MCP auto-detect, show context hints. */
  isLocal: boolean;
  /** Provider supports reasoning/thinking output. Returns providerOptions to spread into streamText. */
  reasoningOptions: (modelName: string) => Record<string, unknown>;
  /** Environment variable name for the provider's API key. */
  apiKeyEnvVar: string | null;
  /** Provider supports tool calling reliably (not just pseudo XML). */
  reliableToolCalling: boolean;
  /** Provider supports image/vision input. */
  supportsVision: boolean;
  /** Provider supports streaming. */
  supportsStreaming: boolean;
}

const PROVIDER_CAPS: Record<string, ProviderCapabilities> = {
  anthropic: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  openai: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({ providerOptions: { openai: { reasoningSummary: "detailed" } } }),
    apiKeyEnvVar: "OPENAI_API_KEY",
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  google: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: (modelName) => {
      if (modelName?.includes("gemini-3")) {
        return { providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } } };
      }
      return { providerOptions: { google: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } } } };
    },
    apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  xai: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "XAI_API_KEY",
    reliableToolCalling: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  groq: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "GROQ_API_KEY",
    reliableToolCalling: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  deepseek: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "DEEPSEEK_API_KEY",
    reliableToolCalling: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  mistral: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "MISTRAL_API_KEY",
    reliableToolCalling: true,
    supportsVision: false,
    supportsStreaming: true,
  },
  openrouter: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: "OPENROUTER_API_KEY",
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  bedrock: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: null,
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  azure: {
    needsContextOverride: false,
    isLocal: false,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: null,
    reliableToolCalling: true,
    supportsVision: true,
    supportsStreaming: true,
  },
  ollama: {
    needsContextOverride: true,
    isLocal: true,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: null,
    reliableToolCalling: false,
    supportsVision: false,
    supportsStreaming: true,
  },
  lmstudio: {
    needsContextOverride: true,
    isLocal: true,
    reasoningOptions: () => ({}),
    apiKeyEnvVar: null,
    reliableToolCalling: false,
    supportsVision: false,
    supportsStreaming: true,
  },
};

/** Default capabilities for unknown providers (OpenAI-compatible). */
const DEFAULT_CAPS: ProviderCapabilities = {
  needsContextOverride: false,
  isLocal: false,
  reasoningOptions: () => ({}),
  apiKeyEnvVar: null,
  reliableToolCalling: true,
  supportsVision: false,
  supportsStreaming: true,
};

/**
 * Get capabilities for a provider. Returns defaults for unknown providers.
 * Strip role suffixes (e.g. "anthropic_planner" → "anthropic").
 */
export function getProviderCapabilities(provider: string): ProviderCapabilities {
  // Strip role suffix for aliased providers (e.g. "openai_tech_lead" → "openai")
  const baseProvider = provider.replace(/_(?:planner|tech_lead|reviewer|worker)$/, "");
  return PROVIDER_CAPS[baseProvider] || DEFAULT_CAPS;
}

/** Check if a provider is local (Ollama, LM Studio). */
export function isLocalProvider(provider: string): boolean {
  return getProviderCapabilities(provider).isLocal;
}

/** Get the API key env var for a provider, or null if not applicable. */
export function getApiKeyEnvVar(provider: string): string | null {
  return getProviderCapabilities(provider).apiKeyEnvVar;
}
