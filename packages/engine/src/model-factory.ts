import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
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
        options: {
          num_ctx: contextLength,
        },
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

    if (loaded.context_length && loaded.context_length !== requiredCtx) {
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
  host?: string,
  contextLength?: number
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelName);
    case "openai": {
      if (host) {
        // OpenAI-compatible provider with custom baseURL (Groq, DeepSeek, Mistral, etc.)
        const customOpenAI = createOpenAI({ baseURL: host });
        return customOpenAI.chat(modelName);
      }
      // Codex models (gpt-5-codex, gpt-5.1-codex, etc.) are Responses API only —
      // they don't support /v1/chat/completions. Route them to .responses().
      // All other models use .chat() to avoid Responses API state issues.
      if (modelName.includes("codex")) {
        return openai.responses(modelName);
      }
      return openai.chat(modelName);
    }
    case "google":
    case "gemini": {
      // Google 3.x models require -preview suffix in the API
      const googleAliases: Record<string, string> = {
        "gemini-3.1-pro": "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
        "gemini-3-flash": "gemini-3-flash-preview",
        "gemini-3-pro": "gemini-3-pro-preview",
      };
      const resolvedName = googleAliases[modelName] || modelName;
      return google(resolvedName);
    }
    case "ollama": {
      const ollamaHost = host || "http://localhost:11434";
      // keepAlive: "-1" prevents model unload during long tool calls (CLAUDE.md rule).
      // Type cast needed — property works at runtime but missing from package types.
      const ollamaProvider = createOllama({ baseURL: `${ollamaHost}/api`, keepAlive: "-1" } as any);
      return ollamaProvider(modelName);
    }
    default: {
      // OpenAI-compatible providers (xAI, Groq, DeepSeek, Mistral, etc.)
      const compatibleHosts: Record<string, string> = {
        xai: "https://api.x.ai/v1",
        groq: "https://api.groq.com/openai/v1",
        deepseek: "https://api.deepseek.com/v1",
        mistral: "https://api.mistral.ai/v1",
      };
      const compatHost = host || compatibleHosts[provider];
      if (compatHost) {
        const compat = createOpenAI({ baseURL: compatHost });
        return compat.chat(modelName);
      }
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
