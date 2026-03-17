/**
 * AIClient Stub Types
 *
 * Minimal type definitions for the unified AIClient interface.
 * This avoids circular dependencies between epic and ai-clients.
 * The actual implementation is in worker/ai-clients/.
 */

import type { StreamMessage, ExpertPersona } from "./types.js";

// Re-export StreamMessage for convenience
export type { StreamMessage };

// Token usage tracking
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

// AIClient options
export interface AIClientOptions {
  prompt: string;
  systemPrompt: string;
  persona: ExpertPersona;
  model?: string;  // Optional - defaults to provider's default model
  workingDir?: string;
  storyId?: string;
  parentTaskId?: string;
  env?: Record<string, string>;
  tools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
  onMessage?: (msg: StreamMessage) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
}

// Output markers extracted from agent output
export interface OutputMarkers {
  result?: string;
  prUrl?: string;
  prNumber?: string;
  branch?: string;
  reviewDecision?: "approved" | "revision_needed" | "rejected";
  codeQualityScore?: number;
  feedback?: string;
}

// AIClient result
export interface AIClientResult {
  success: boolean;
  messages: StreamMessage[];
  error?: string;
  tokenUsage: TokenUsage;
  modelUsed: string;
  structuredOutput?: Record<string, unknown>;
  markers?: OutputMarkers;
}

// AIClient capabilities
export interface AIClientCapabilities {
  supportsCaching: boolean;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportedTools: string[];
}

// AI Provider types
export type AIProvider = "anthropic" | "openai" | "google" | "gemini" | "ollama";

// The AIClient interface
export interface AIClient {
  readonly provider: AIProvider;
  readonly capabilities: AIClientCapabilities;
  execute(options: AIClientOptions): Promise<AIClientResult>;
}

// Configuration for creating an AIClient
export interface AIClientConfig {
  provider: AIProvider;
  apiKeys: {
    anthropic?: string;
    openai?: string;
    google?: string;
    ollamaHost?: string;
  };
  apiConfig: {
    baseUrl: string;
    orgApiKey: string;
  };
  useAgentSdk?: boolean;
  githubToken?: string;
  oauthToken?: string;
}

/**
 * Factory function — dynamically loads the real AIClient factory at runtime.
 *
 * Why dynamic: This file is bundled into TWO different contexts:
 * 1. Worker Docker image (esbuild bundles from epic/dist/, resolves via crossComponentPlugin)
 * 2. Agent binary (esbuild bundles from source, no ai-clients/ available)
 *
 * The agent binary never calls createAIClient (useUnifiedClient is only set in workers),
 * so a runtime-only import is safe — it only fails if actually called without ai-clients present.
 */
let _cachedFactory: ((config: AIClientConfig) => AIClient) | null = null;

export function createAIClient(config: AIClientConfig): AIClient {
  if (!_cachedFactory) {
    try {
      // Runtime-only dynamic import — the path is computed so esbuild cannot
      // statically resolve it (prevents agent binary build from failing when
      // ai-clients/ is not present).
      // In Docker workers: /app/ai-clients/dist/index.js exists.
      // In agent binary: this path doesn't exist, but createAIClient is never called.
      const modulePath = [".", ".", "ai-clients", "dist", "index.js"].join("/");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(modulePath);
      _cachedFactory = mod.createAIClient;
    } catch {
      throw new Error(
        "createAIClient: ai-clients module not found. " +
        "This is expected in the agent binary (which doesn't use useUnifiedClient). " +
        "In Docker workers, ensure ai-clients/ is compiled in the Dockerfile."
      );
    }
  }
  return _cachedFactory!(config);
}
