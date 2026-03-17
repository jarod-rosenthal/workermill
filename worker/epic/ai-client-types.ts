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
 * This static re-export is resolved at bundle time by esbuild. In the Docker
 * worker image (worker/bundle.mjs), esbuild's crossComponentPlugin resolves
 * ../ai-clients/dist/index.js to /app/ai-clients/dist/index.js and inlines it.
 *
 * For the agent binary build (agent/build.mjs), the ai-clients path is marked
 * as external so esbuild skips it — the agent never calls createAIClient.
 */
export { createAIClient } from "../ai-clients/dist/index.js";
