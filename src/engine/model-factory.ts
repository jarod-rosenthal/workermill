import { execSync } from "child_process";
import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { xai, createXai } from "@ai-sdk/xai";
import { openrouter, createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOllama } from "ollama-ai-provider-v2";
import type { AIProvider } from "./types.js";

/** Resolve localhost host for a local provider, using WSL gateway if in WSL. */
function resolveLocalProviderHost(port: number): string {
  if (process.platform === "linux" && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)) {
    try {
      const gateway = execSync("ip route show default 2>/dev/null | awk '{print $3}'", { encoding: "utf-8" }).trim();
      if (gateway) return `http://${gateway}:${port}`;
    } catch { /* fall through */ }
  }
  return `http://localhost:${port}`;
}

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

/**
 * Ensure an LM Studio model is loaded with the correct context length.
 * Uses LM Studio's /api/v1/ endpoints to unload and reload if needed.
 * Returns the actual loaded context length for transparency.
 */
export async function ensureLmStudioContext(
  host: string,
  modelName: string,
  requiredCtx: number,
): Promise<{ loadedCtx: number; maxCtx: number } | null> {
  // Strip /v1 suffix to get base URL for LM Studio's management API
  const baseHost = host.replace(/\/v1\/?$/, "");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await globalThis.fetch(`${baseHost}/api/v0/models`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as {
      data?: { id: string; state: string; loaded_context_length?: number; max_context_length?: number }[];
    };
    const model = data.data?.find((m) => m.id === modelName);
    if (!model) return null;

    const maxCtx = model.max_context_length || requiredCtx;
    const targetCtx = Math.min(requiredCtx, maxCtx);

    if (model.state === "loaded" && model.loaded_context_length === targetCtx) {
      return { loadedCtx: model.loaded_context_length, maxCtx };
    }

    // Unload if currently loaded with wrong context
    if (model.state === "loaded") {
      await globalThis.fetch(`${baseHost}/api/v1/models/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance_id: modelName }),
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Load with correct context
    const loadRes = await globalThis.fetch(`${baseHost}/api/v1/models/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelName, context_length: targetCtx }),
    });

    if (loadRes.ok) {
      return { loadedCtx: targetCtx, maxCtx };
    }
    return null;
  } catch {
    // Non-fatal
    return null;
  }
}

export function createModel(
  provider: AIProvider,
  modelName: string,
  host?: string,
  contextLength?: number,
  apiKey?: string,
): LanguageModel {
  switch (provider) {
    case "anthropic":
      return anthropic(modelName);
    case "openai": {
      if (host) {
        // OpenAI-compatible provider with custom baseURL (Groq, DeepSeek, Mistral, etc.)
        const customOpenAI = createOpenAI({ baseURL: host, ...(apiKey ? { apiKey } : {}) });
        return customOpenAI.chat(modelName);
      }
      // Some OpenAI models are Responses API only — they don't support
      // /v1/chat/completions. Codex models and pro-tier reasoning models
      // (gpt-5.4-pro, etc.) must use .responses(). All others use .chat().
      if (modelName.includes("codex") || /\d.*-pro$/.test(modelName)) {
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
    case "xai": {
      const xaiProvider = host || apiKey
        ? createXai({ ...(host ? { baseURL: host } : {}), ...(apiKey ? { apiKey } : {}) })
        : xai;
      return xaiProvider(modelName as Parameters<typeof xai>[0]);
    }
    case "ollama": {
      const ollamaHost = host || resolveLocalProviderHost(11434);
      // keepAlive: "-1" prevents model unload during long tool calls (CLAUDE.md rule).
      // Type cast needed — property works at runtime but missing from package types.
      const ollamaProvider = createOllama({ baseURL: `${ollamaHost}/api`, compatibility: "strict", keepAlive: "-1" } as any);
      return ollamaProvider(modelName);
    }
    case "lmstudio": {
      const lmStudioHost = host || `${resolveLocalProviderHost(1234)}/v1`;
      // LM Studio exposes an OpenAI-compatible API but doesn't require an API key.
      // Pass a dummy key to satisfy the SDK's validation.
      const lmStudio = createOpenAI({ baseURL: lmStudioHost, apiKey: "lm-studio" });
      return lmStudio.chat(modelName);
    }
    case "openrouter": {
      const openRouterProvider = host || apiKey
        ? createOpenRouter({ ...(host ? { baseURL: host } : {}), ...(apiKey ? { apiKey } : {}) })
        : openrouter;
      return openRouterProvider(modelName);
    }
    default: {
      // OpenAI-compatible providers (Groq, DeepSeek, Mistral, etc.)
      const compatibleHosts: Record<string, string> = {
        groq: "https://api.groq.com/openai/v1",
        deepseek: "https://api.deepseek.com/v1",
        mistral: "https://api.mistral.ai/v1",
      };
      const compatHost = host || compatibleHosts[provider];
      if (compatHost) {
        // Map provider to its env var for API key lookup
        const envKeys: Record<string, string> = {
          groq: "GROQ_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
          mistral: "MISTRAL_API_KEY",
        };
        const resolvedKey = apiKey || (envKeys[provider] ? process.env[envKeys[provider]] : undefined);
        const compat = createOpenAI({ baseURL: compatHost, ...(resolvedKey ? { apiKey: resolvedKey } : {}) });
        return compat.chat(modelName);
      }
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
