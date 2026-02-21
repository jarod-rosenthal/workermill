import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";

// =============================================================================
// AWS Secrets Manager
// =============================================================================

export const secretsClient = new SecretsManagerClient({ region: config.aws.region });

/**
 * Get organization-specific secret from AWS Secrets Manager.
 * SECURITY: Only returns org-specific secrets - NO platform fallback for multi-tenancy isolation.
 * Each organization must configure their own credentials.
 */
export async function getOrgSecret(
  orgId: string,
  secretName: string,
  secretPrefix: string
): Promise<string | null> {
  // Only return org-specific secrets - no platform fallback for multi-tenancy security
  try {
    const orgSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/orgs/${orgId}/${secretName}`,
      })
    );
    if (orgSecret.SecretString) return orgSecret.SecretString;
  } catch {
    // Not found at org level - return null (no fallback to shared secrets)
  }

  return null;
}

/**
 * Helper to get platform-wide secret (for truly shared resources only)
 * Use sparingly - only for platform infrastructure, not tenant data
 */
export async function getPlatformSecret(
  secretName: string,
  secretPrefix: string
): Promise<string | null> {
  try {
    const platformSecret = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: `${secretPrefix}/${secretName}`,
      })
    );
    return platformSecret.SecretString || null;
  } catch {
    return null;
  }
}

/**
 * Helper to save secret to org-specific path
 */
export async function saveOrgSecret(
  orgId: string,
  secretName: string,
  secretValue: string,
  secretPrefix: string,
  description: string
): Promise<void> {
  const secretPath = `${secretPrefix}/orgs/${orgId}/${secretName}`;

  try {
    await secretsClient.send(
      new PutSecretValueCommand({
        SecretId: secretPath,
        SecretString: secretValue,
      })
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      await secretsClient.send(
        new CreateSecretCommand({
          Name: secretPath,
          SecretString: secretValue,
          Description: description,
        })
      );
    } else {
      throw error;
    }
  }
}

// =============================================================================
// Dynamic Model Discovery - Types & Constants
// =============================================================================

export interface DiscoveredModel {
  id: string;
  displayName: string;
  provider: string;
  tier?: string;
  contextWindow?: number;
  source: "curated" | "discovered";
}

// Cache for discovered models (60 second TTL)
export const modelCache = new Map<string, { models: DiscoveredModel[]; timestamp: number }>();
export const MODEL_CACHE_TTL_MS = 60000;

// Curated model lists for providers without dynamic discovery
export const CURATED_MODELS: Record<string, DiscoveredModel[]> = {
  anthropic: [
    { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "anthropic", tier: "premium", contextWindow: 200000, source: "curated" },
    { id: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", provider: "anthropic", tier: "premium", contextWindow: 200000, source: "curated" },
    { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-sonnet-4-5-20250929", displayName: "Claude Sonnet 4.5 (Legacy)", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "anthropic", tier: "economy", contextWindow: 200000, source: "curated" },
    // Legacy models for backwards compatibility
    { id: "claude-3-5-haiku-20241022", displayName: "Claude 3.5 Haiku (Legacy)", provider: "anthropic", tier: "economy", contextWindow: 200000, source: "curated" },
    { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet (Legacy)", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-3-opus-20240229", displayName: "Claude 3 Opus (Legacy)", provider: "anthropic", tier: "premium", contextWindow: 200000, source: "curated" },
    // Deprecated model IDs (mapped to current equivalents for backwards compatibility)
    { id: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4 (Deprecated)", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-sonnet-4-5-20250514", displayName: "Claude Sonnet 4.5 (Deprecated)", provider: "anthropic", tier: "standard", contextWindow: 200000, source: "curated" },
    { id: "claude-haiku-4-5-20250514", displayName: "Claude Haiku 4.5 (Deprecated)", provider: "anthropic", tier: "economy", contextWindow: 200000, source: "curated" },
  ],
  openai: [
    { id: "gpt-5.1-codex", displayName: "GPT-5.1 Codex", provider: "openai", tier: "premium", contextWindow: 128000, source: "curated" },
    { id: "gpt-4o", displayName: "GPT-4o", provider: "openai", tier: "standard", contextWindow: 128000, source: "curated" },
    { id: "gpt-4o-mini", displayName: "GPT-4o Mini", provider: "openai", tier: "economy", contextWindow: 128000, source: "curated" },
    { id: "o1", displayName: "O1", provider: "openai", tier: "premium", contextWindow: 128000, source: "curated" },
    { id: "o1-mini", displayName: "O1 Mini", provider: "openai", tier: "standard", contextWindow: 128000, source: "curated" },
  ],
  google: [
    { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", provider: "google", tier: "premium", contextWindow: 1000000, source: "curated" },
    { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", provider: "google", tier: "standard", contextWindow: 1000000, source: "curated" },
    { id: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", provider: "google", tier: "economy", contextWindow: 1000000, source: "curated" },
    { id: "gemini-3-pro-preview", displayName: "Gemini 3 Pro Preview (Unstable)", provider: "google", tier: "experimental", contextWindow: 1000000, source: "curated" },
    { id: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro (Legacy)", provider: "google", tier: "standard", contextWindow: 1000000, source: "curated" },
    { id: "gemini-1.5-flash", displayName: "Gemini 1.5 Flash (Legacy)", provider: "google", tier: "economy", contextWindow: 1000000, source: "curated" },
  ],
};

// =============================================================================
// Dynamic Model Discovery - Functions
// =============================================================================

/**
 * Fetch available models from Ollama server
 */
export async function discoverOllamaModels(ollamaHost: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(`${ollamaHost}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.warn("Ollama models endpoint returned error", { status: response.status });
      return [];
    }

    const data = await response.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };

    if (!data.models || !Array.isArray(data.models)) {
      return [];
    }

    return data.models.map((model) => ({
      id: model.name,
      displayName: formatOllamaModelName(model.name, model.details?.parameter_size),
      provider: "ollama",
      source: "discovered" as const,
    }));
  } catch (error) {
    logger.warn("Failed to discover Ollama models", {
      error: error instanceof Error ? error.message : String(error),
      host: ollamaHost
    });
    return [];
  }
}

/**
 * Format Ollama model name for display
 * e.g., "qwen2.5-coder:32b" -> "Qwen 2.5 Coder (32B)"
 */
export function formatOllamaModelName(modelId: string, paramSize?: string): string {
  const [baseName, tag] = modelId.split(":");

  // Capitalize and clean up the base name
  const formatted = baseName
    .replace(/-/g, " ")
    .replace(/(\d+)\.(\d+)/g, "$1.$2") // Keep version numbers
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Add parameter size if available
  const size = paramSize || (tag ? tag.toUpperCase() : "");
  return size ? `${formatted} (${size})` : formatted;
}

/**
 * Get all available models for an organization
 */
export async function getAvailableModels(org: { id: string; ollamaBaseUrl?: string | null }): Promise<{
  models: DiscoveredModel[];
  ollamaStatus: "connected" | "disconnected" | "not_configured";
}> {
  const cacheKey = `models-${org.id}`;
  const cached = modelCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < MODEL_CACHE_TTL_MS) {
    // Determine ollama status from cached models
    const hasOllamaModels = cached.models.some(m => m.provider === "ollama" && m.source === "discovered");
    return {
      models: cached.models,
      ollamaStatus: hasOllamaModels ? "connected" : (org.ollamaBaseUrl ? "disconnected" : "not_configured"),
    };
  }

  // Start with curated models
  const models: DiscoveredModel[] = [
    ...CURATED_MODELS.anthropic,
    ...CURATED_MODELS.openai,
    ...CURATED_MODELS.google,
  ];

  // Discover Ollama models if configured
  let ollamaStatus: "connected" | "disconnected" | "not_configured" = "not_configured";
  const ollamaHost = org.ollamaBaseUrl || process.env.OLLAMA_HOST;

  if (ollamaHost) {
    const ollamaModels = await discoverOllamaModels(ollamaHost);
    if (ollamaModels.length > 0) {
      models.push(...ollamaModels);
      ollamaStatus = "connected";
    } else {
      ollamaStatus = "disconnected";
    }
  }

  // Cache the results
  modelCache.set(cacheKey, { models, timestamp: Date.now() });

  return { models, ollamaStatus };
}

/**
 * Check if a model ID is valid (either in available models or Ollama format)
 */
export function isValidModelId(modelId: string, availableModels: DiscoveredModel[]): boolean {
  // Check if in available models list
  if (availableModels.some(m => m.id === modelId)) {
    return true;
  }

  // Accept any Ollama format model (name:tag) as fallback
  // This ensures models work even if Ollama server is temporarily unreachable
  if (modelId.includes(":")) {
    return true;
  }

  return false;
}

/**
 * Infer the provider from a model ID
 * Returns the provider name or null if unknown
 */
export function inferProviderFromModelId(modelId: string): string | null {
  if (modelId.startsWith("claude-") || modelId.includes("claude")) {
    return "anthropic";
  }
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.includes("codex")) {
    return "openai";
  }
  if (modelId.startsWith("gemini-")) {
    return "google";
  }
  if (modelId.includes(":")) {
    return "ollama";
  }
  return null;
}

// =============================================================================
// Provider API Key Test Functions
// =============================================================================

/**
 * Test Anthropic API key by listing models
 */
export async function testAnthropicApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (response.ok) {
      return { success: true, message: "Anthropic API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `Anthropic API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to Anthropic API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test OpenAI API key by listing models
 */
export async function testOpenAIApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { success: true, message: "OpenAI API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `OpenAI API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to OpenAI API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test Google API key by listing models
 */
export async function testGoogleApiKey(
  apiKey: string
): Promise<{ success: boolean; message: string; details?: unknown }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      {
        method: "GET",
      }
    );

    if (response.ok) {
      return { success: true, message: "Google API key is valid" };
    }

    const errorData = (await response.json()) as { error?: { message?: string } };
    return {
      success: false,
      message: `Google API error: ${errorData.error?.message || response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to connect to Google API: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
