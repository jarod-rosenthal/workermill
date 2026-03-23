/**
 * AIClient Interface Types
 *
 * Unified interface for AI execution across Agent SDK (Claude CLI) and AI SDK (Vercel).
 */

// AI Provider types
export type AIProvider = "anthropic" | "openai" | "google" | "gemini" | "ollama";

// Expert persona types (from worker/epic/types.ts)
export type ExpertPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "security_engineer"
  | "qa_engineer"
  | "devops_engineer"
  | "tech_writer"
  | "data_ml_engineer"
  | "mobile_developer"
  | "tech_lead"
  | "manager";

// Token usage tracking
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number; // Anthropic-specific
  cacheReadTokens?: number; // Anthropic-specific
}

// Stream message (compatible with existing StreamMessage)
export interface StreamMessage {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "result" | "error";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
}

// AIClient options
export interface AIClientOptions {
  /** The prompt to execute */
  prompt: string;
  /** System prompt/instructions for the agent */
  systemPrompt: string;
  /** Persona determines default behavior */
  persona: ExpertPersona;
  /** Model to use (provider-specific format) */
  model: string;
  /** Working directory for file operations */
  workingDir: string;
  /** Story/task ID for coordination */
  storyId: string;
  /** Parent task ID for token reporting */
  parentTaskId: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Available tools (filtered by implementation) */
  tools?: string[];
  /** Max turns/steps for the agent (optional) */
  maxTurns?: number;
  /** Execution timeout in ms (default: 30 minutes) */
  timeoutMs?: number;
  /** Callback for streaming messages */
  onMessage?: (msg: StreamMessage) => void;
  /** Callback for partial token usage (every ~30 seconds) */
  onTokenUsage?: (usage: TokenUsage) => void;
}

// Output markers extracted from agent output
export interface OutputMarkers {
  result?: string; // completed, deployed, review_requested, etc.
  prUrl?: string; // https://github.com/...
  prNumber?: string; // 123
  branch?: string; // ai/OCS-123
  reviewDecision?: "approved" | "revision_needed" | "rejected";
  codeQualityScore?: number; // 1-10
  feedback?: string;
  learnings?: string[];
}

// AIClient result
export interface AIClientResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** All messages produced during execution */
  messages: StreamMessage[];
  /** Error message if success is false */
  error?: string;
  /** Final token usage */
  tokenUsage: TokenUsage;
  /** Model that was actually used */
  modelUsed: string;
  /** Structured output (for review personas) */
  structuredOutput?: Record<string, unknown>;
  /** Output markers extracted from agent output */
  markers?: OutputMarkers;
  /** Whether the execution failed due to rate limiting (429 / quota exceeded) */
  rateLimited?: boolean;
}

// AIClient capabilities (per provider)
export interface AIClientCapabilities {
  /** Whether provider supports prompt caching */
  supportsCaching: boolean;
  /** Maximum context window in tokens */
  maxContextTokens: number;
  /** Whether provider supports streaming responses */
  supportsStreaming: boolean;
  /** Whether provider supports structured output (JSON mode) */
  supportsStructuredOutput: boolean;
  /** Tool names supported by this client */
  supportedTools: string[];
}

// The AIClient interface
export interface AIClient {
  /** The provider this client uses */
  readonly provider: AIProvider;
  /** Client capabilities */
  readonly capabilities: AIClientCapabilities;
  /** Execute a prompt and return the result */
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
  /** If true and provider is "anthropic", use Claude CLI (Agent SDK) */
  useAgentSdk?: boolean;
  /** GitHub token for PR operations */
  githubToken?: string;
  /**
   * OAuth token for local development (Claude Max subscription).
   * When set, takes precedence over apiKeys.anthropic for Claude CLI auth.
   */
  oauthToken?: string;
}
