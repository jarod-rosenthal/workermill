import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSlashCommand } from "../ui/slash-commands.js";

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock("../models-command.js", () => ({
  findModelInfo: vi.fn(() => ({ contextWindow: 256000 })),
  getProviderEnvVar: vi.fn((provider: string) => {
    const envVars: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
      xai: "XAI_API_KEY",
      groq: "GROQ_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      mistral: "MISTRAL_API_KEY",
    };
    return envVars[provider] || null;
  }),
}));

import * as configModule from "../config.js";

describe("/model command persistence", () => {
  let mockConfig: any;

  beforeEach(() => {
    mockConfig = {
      providers: {
        anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant-..." },
      },
      default: "anthropic",
    };
    configModule.loadConfig.mockReturnValue(mockConfig);
    configModule.saveConfig.mockImplementation((config) => {
      mockConfig = config;
    });
  });

  describe("same-provider switch", () => {
    it("persists the new model within the same provider", () => {
      // Given config.default is "anthropic"
      expect(mockConfig.default).toBe("anthropic");
      expect(mockConfig.providers.anthropic.model).toBe("claude-sonnet-4-6");

      // When the user runs /model anthropic/claude-haiku-4-5-20251001
      handleSlashCommand("/model anthropic/claude-haiku-4-5-20251001", {
        addSystemMessage: vi.fn(),
        submit: vi.fn(),
      } as any);

      expect(configModule.loadConfig).toHaveBeenCalled();
      expect(configModule.saveConfig).toHaveBeenCalled();

      // Then config.default is still "anthropic"
      expect(configModule.saveConfig).toHaveBeenCalledWith({
        ...mockConfig,
        providers: {
          anthropic: { model: "claude-haiku-4-5-20251001", apiKey: "sk-ant-..." },
        },
        default: "anthropic",
      });
    });
  });

  describe("cross-provider switch", () => {
    it("switches to a different provider and persists", () => {
      // Given config.default is "anthropic"
      mockConfig.providers.openai = { model: "gpt-5.4", apiKey: "sk-..." };
      expect(mockConfig.default).toBe("anthropic");

      // When the user runs /model openai/gpt-5.4
      handleSlashCommand("/model openai/gpt-5.4", {
        addSystemMessage: vi.fn(),
        submit: vi.fn(),
      } as any);

      // Then the active model is gpt-5.4 and config.default is "openai"
      expect(configModule.saveConfig).toHaveBeenCalledWith({
        ...mockConfig,
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant-..." },
          openai: { model: "gpt-5.4", apiKey: "sk-..." },
        },
        default: "openai",
      });
    });

    it("switches to Ollama and persists", () => {
      // Given config has providers.ollama.host configured
      mockConfig.providers.ollama = { model: "qwen3-coder:30b", host: "http://localhost:11434" };

      // When the user runs /model ollama/llama3.3-70b
      handleSlashCommand("/model ollama/llama3.3-70b", {
        addSystemMessage: vi.fn(),
        submit: vi.fn(),
      } as any);

      // Then config.default is "ollama"
      expect(configModule.saveConfig).toHaveBeenCalledWith({
        ...mockConfig,
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant-..." },
          ollama: { model: "llama3.3-70b", host: "http://localhost:11434" },
        },
        default: "ollama",
      });
    });
  });

  describe("role switch does not change default worker model", () => {
    it("planner switch does not alter default", () => {
      // Given config.default is "anthropic" with claude-sonnet-4-6
      expect(mockConfig.default).toBe("anthropic");
      mockConfig.providers.openai = { model: "gpt-5.4", apiKey: "sk-..." };

      // When the user runs /model planner openai/gpt-5.4
      handleSlashCommand("/model planner openai/gpt-5.4", {
        addSystemMessage: vi.fn(),
        submit: vi.fn(),
      } as any);

      // Then the worker model is still claude-sonnet-4-6 and config.default is still "anthropic"
      expect(configModule.saveConfig).toHaveBeenCalledWith({
        ...mockConfig,
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant-..." },
          openai: { model: "gpt-5.4", apiKey: "sk-..." },
          openai_planner: { model: "gpt-5.4", apiKey: "sk-..." },
        },
        routing: { planner: "openai_planner" },
        default: "anthropic",
      });
    });
  });

  describe("subsequent worker switch after role switch", () => {
    it("persists correctly", () => {
      // Given the user previously ran /model planner openai/gpt-5.4
      mockConfig.providers.openai = { model: "gpt-5.4", apiKey: "sk-..." };
      mockConfig.providers.openai_planner = { model: "gpt-5.4", apiKey: "sk-..." };
      mockConfig.routing = { planner: "openai_planner" };

      // When the user runs /model openai/gpt-5.4-mini (worker switch)
      handleSlashCommand("/model openai/gpt-5.4-mini", {
        addSystemMessage: vi.fn(),
        submit: vi.fn(),
      } as any);

      // Then the worker model is gpt-5.4-mini and config.default is "openai"
      expect(configModule.saveConfig).toHaveBeenCalledWith({
        ...mockConfig,
        providers: {
          anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-ant-..." },
          openai: { model: "gpt-5.4-mini", apiKey: "sk-..." },
          openai_planner: { model: "gpt-5.4", apiKey: "sk-..." },
        },
        routing: { planner: "openai_planner" },
        default: "openai",
      });
    });
  });

  describe("no-args /model shows persisted model", () => {
    it("displays the current persisted worker model", () => {
      const mockAddSystemMessage = vi.fn();
      const mockCtx = {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        addSystemMessage: mockAddSystemMessage,
        submit: vi.fn(),
      } as any;

      // When the user runs /model with no arguments
      handleSlashCommand("/model", mockCtx);

      // Then it shows the current model from context (which is persisted)
      expect(mockAddSystemMessage).toHaveBeenCalledWith(
        expect.stringContaining("**Current model:** anthropic/claude-sonnet-4-6")
      );
    });
  });
});