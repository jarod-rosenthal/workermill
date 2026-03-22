/**
 * AI SDK Model Factory
 *
 * Extracted from worker/agents/ai-sdk-executor.js.
 * Provides provider-specific model instantiation, cost tracking metadata,
 * and reasoning options for the Vercel AI SDK.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { AIProvider } from "./types.js";

/**
 * Create an AI SDK model instance for the given provider.
 * Ported from ai-sdk-executor.js createModel() — exact same logic.
 */
export function createModel(provider: AIProvider, modelName: string): LanguageModel {
  switch (provider) {
    case "anthropic": {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required");
      }
      return anthropic(modelName);
    }

    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY environment variable is required");
      }
      return openai(modelName);
    }

    case "google":
    case "gemini": {
      // AI SDK expects GOOGLE_GENERATIVE_AI_API_KEY but we also accept GOOGLE_API_KEY
      const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!googleKey) {
        throw new Error("GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY environment variable is required");
      }
      // Set the expected env var if only GOOGLE_API_KEY was provided
      if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
      }
      return google(modelName);
    }

    case "ollama": {
      const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
      const provider = createOpenAICompatible({ name: "ollama", baseURL: `${ollamaHost}/v1`, apiKey: "ollama" });
      return provider.chatModel(modelName);
    }

    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, gemini, ollama`);
  }
}

/**
 * Build provider-specific metadata for cost tracking and reconciliation.
 * Ported from ai-sdk-executor.js buildCostTrackingMetadata() — exact same logic.
 *
 * Format: "workermill:{orgId}:{taskId}"
 */
export function buildCostTrackingMetadata(
  provider: AIProvider,
  orgId?: string,
  taskId?: string
): Record<string, unknown> {
  const trackingId = `workermill:${orgId || ""}:${taskId || ""}`;

  // Skip if no org/task context
  if (!orgId && !taskId) {
    return {};
  }

  switch (provider) {
    case "anthropic":
      return {
        providerOptions: {
          anthropic: {
            metadata: {
              user_id: trackingId,
            },
          },
        },
      };

    case "openai":
      return {
        providerOptions: {
          openai: {
            user: trackingId,
          },
        },
      };

    case "google":
    case "gemini":
      return {
        providerOptions: {
          google: {
            metadata: {
              user_id: trackingId,
            },
          },
        },
      };

    case "ollama":
      return {};

    default:
      return {};
  }
}

/**
 * Build provider-specific options to enable reasoning/thinking output.
 * Ported from ai-sdk-executor.js buildReasoningOptions() — exact same logic.
 */
export function buildReasoningOptions(
  provider: AIProvider,
  modelName: string
): Record<string, unknown> {
  switch (provider) {
    case "openai":
      return {
        providerOptions: {
          openai: {
            reasoningSummary: "detailed",
          },
        },
      };

    case "google":
    case "gemini":
      if (modelName && modelName.includes("gemini-3")) {
        return {
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingLevel: "high",
                includeThoughts: true,
              },
            },
          },
        };
      } else {
        return {
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingBudget: 8192,
                includeThoughts: true,
              },
            },
          },
        };
      }

    case "anthropic":
      return {};

    case "ollama":
      return {};

    default:
      return {};
  }
}
