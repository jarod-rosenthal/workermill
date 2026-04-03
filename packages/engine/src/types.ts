export type AIProvider = "anthropic" | "openai" | "google" | "gemini" | "ollama" | "lmstudio";

export type ExpertPersona =
  | "architect"
  | "frontend_developer"
  | "backend_developer"
  | "fullstack_developer"
  | "devops_engineer"
  | "qa_engineer"
  | "security_engineer"
  | "database_engineer"
  | "mobile_developer"
  | "data_engineer"
  | "ml_engineer";

export interface StreamMessage {
  type: "text" | "tool_use" | "tool_result" | "result";
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AIClientConfig {
  provider: AIProvider;
  apiKeys: {
    anthropic?: string;
    openai?: string;
    google?: string;
    ollamaHost?: string;
  };
}

export interface AIClientOptions {
  systemPrompt: string;
  prompt: string;
  persona: ExpertPersona;
  model: string;
  workingDir: string;
  maxTurns?: number;
  timeoutMs?: number;
  contextLength?: number;
  sessionId?: string;
  onMessage?: (msg: StreamMessage) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
}

export interface AIClientResult {
  success: boolean;
  text: string;
  error?: string;
  tokenUsage?: TokenUsage;
  markers?: Record<string, string>;
}
