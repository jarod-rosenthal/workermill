import type { CliConfig } from "../../config.js";

export function createTestConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    providers: {
      ollama: { model: "test-model", host: "http://localhost:11434", contextLength: 4096 },
    },
    default: "ollama",
    ...overrides,
  };
}

export function createMultiProviderConfig(): CliConfig {
  return {
    providers: {
      ollama: { model: "qwen3-coder:30b", host: "http://localhost:11434", contextLength: 65536 },
      anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-test-123" },
      google: { model: "gemini-3.1-pro", apiKey: "goog-test-123" },
    },
    default: "ollama",
    routing: {
      planner: "google",
      tech_lead: "anthropic",
    },
  };
}
