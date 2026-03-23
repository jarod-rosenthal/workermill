import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider-v2";
import type { AIProvider } from "./types.js";

/**
 * Build providerOptions for passing num_ctx to Ollama.
 * Must be spread into every streamText/generateText call.
 */
export function buildOllamaOptions(
  provider: AIProvider,
  contextLength?: number
): Record<string, unknown> {
  if (provider !== "ollama" || !contextLength) return {};
  return {
    providerOptions: {
      ollama: {
        num_ctx: contextLength,
      },
    },
  };
}

export function createModel(
  provider: AIProvider,
  modelName: string,
  ollamaHost?: string,
  ollamaContextLength?: number
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelName);
    case "openai":
      return openai(modelName);
    case "google":
    case "gemini":
      return google(modelName);
    case "ollama": {
      const host = ollamaHost || "http://localhost:11434";
      const ollamaProvider = createOllama({ baseURL: `${host}/api` });
      return ollamaProvider(modelName);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
