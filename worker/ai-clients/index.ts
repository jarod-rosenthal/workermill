/**
 * AIClient Factory
 *
 * Unified interface for AI execution across multiple providers.
 */

// Re-export types
export * from "./types.js";

// Import client implementations
import { AnthropicAgentClient } from "./anthropic-agent.js";
import { AISdkClient } from "./ai-sdk-client.js";
import type { AIClient, AIClientConfig, AIProvider } from "./types.js";

// Export client classes
export { AnthropicAgentClient, AISdkClient };

/**
 * Create an AIClient for the specified provider.
 *
 * @param config - Client configuration including provider and API keys
 * @returns An AIClient instance for the specified provider
 * @throws Error if provider is not supported or API key is missing
 */
export function createAIClient(config: AIClientConfig): AIClient {
  const { provider, apiKeys, useAgentSdk, oauthToken } = config;

  // Validate API key exists for provider (OAuth token is alternative for Anthropic)
  validateApiKey(provider, apiKeys, oauthToken);

  // For Anthropic, use Agent SDK (Claude CLI) by default
  if (provider === "anthropic" && useAgentSdk !== false) {
    return new AnthropicAgentClient(config);
  }

  // For all other providers (or Anthropic with useAgentSdk=false), use AI SDK
  return new AISdkClient(config);
}

/**
 * Validate that the required API key exists for the provider.
 * For Anthropic, either API key or OAuth token (from env) is acceptable.
 */
function validateApiKey(
  provider: AIProvider,
  apiKeys: AIClientConfig["apiKeys"],
  oauthToken?: string
): void {
  switch (provider) {
    case "anthropic":
      // Allow either API key or OAuth token for Anthropic
      if (!apiKeys.anthropic && !oauthToken && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        throw new Error("ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required for Anthropic provider");
      }
      break;
    case "openai":
      if (!apiKeys.openai) {
        throw new Error("OPENAI_API_KEY is required for OpenAI provider");
      }
      break;
    case "google":
    case "gemini":
      if (!apiKeys.google) {
        throw new Error("GOOGLE_API_KEY is required for Google/Gemini provider");
      }
      break;
    case "ollama":
      // Ollama doesn't require an API key, but ollamaHost is optional
      break;
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Check if Claude CLI is available (for AnthropicAgentClient).
 * Returns true if claude command is found in PATH.
 */
export function isClaudeCliAvailable(): boolean {
  try {
    const { spawnSync } = require("child_process");
    const result = spawnSync("claude", ["--version"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}
