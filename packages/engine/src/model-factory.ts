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

/**
 * Ensure an Ollama model is loaded with the correct context length.
 * If the model is already loaded with a smaller context, unload it first
 * so the next request reloads at the correct size.
 */
export async function ensureOllamaContext(
  host: string,
  modelName: string,
  requiredCtx: number,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await globalThis.fetch(`${host}/api/ps`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return;

    const data = (await res.json()) as { models?: { name: string; context_length?: number }[] };
    const loaded = data.models?.find((m) => m.name === modelName);
    if (!loaded) return; // Not loaded — will load fresh with correct ctx

    if (loaded.context_length && loaded.context_length < requiredCtx) {
      // Unload so it reloads with the correct num_ctx on next request
      await globalThis.fetch(`${host}/api/generate`, {
        method: "POST",
        body: JSON.stringify({ model: modelName, keep_alive: 0 }),
      });
      // Brief wait for unload to complete
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch {
    // Non-fatal — worst case the model runs with smaller context
  }
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
