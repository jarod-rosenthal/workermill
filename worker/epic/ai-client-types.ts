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
 * Re-export the real createAIClient factory from worker/ai-clients.
 *
 * Uses the same cross-component import pattern as ai-clients/anthropic-agent.ts
 * which imports from "../epic/dist/agent-sdk.js". Here we import in the reverse
 * direction: from epic/ into ai-clients/dist/.
 *
 * The ai-clients/ module must be compiled (tsc) and available at the sibling
 * path. In the Docker container: /app/ai-clients/dist/index.js.
 */
export { createAIClient } from "../ai-clients/dist/index.js";
