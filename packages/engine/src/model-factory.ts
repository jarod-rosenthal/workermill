import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AIProvider } from "./types.js";

export function createModel(
  provider: AIProvider,
  modelName: string,
  ollamaHost?: string
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
      const ollamaProvider = createOpenAICompatible({
        name: "ollama",
        baseURL: `${host}/v1`,
        apiKey: "ollama",
      });
      return ollamaProvider.chatModel(modelName);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
