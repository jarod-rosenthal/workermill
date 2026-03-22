/**
 * Planning Agent Configuration
 *
 * Provider/model configuration and model creation for the planning agent.
 */

import { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import { Organization } from "../../models/Organization.js";
import { PlanningAgentConfig, DEFAULT_PLANNING_CONFIG } from "./types.js";

/**
 * Get planning agent configuration from organization settings.
 * Falls back to defaults if not configured.
 */
export function getPlanningConfig(org: Organization): PlanningAgentConfig {
  // Use org's planning agent settings if configured
  const provider = (org.planningAgentProvider as PlanningAgentConfig["provider"]) || DEFAULT_PLANNING_CONFIG.provider;
  const model = org.planningAgentModel || DEFAULT_PLANNING_CONFIG.model;
  const ollamaBaseUrl = org.ollamaBaseUrl || undefined;

  return { provider, model, ollamaBaseUrl };
}

/**
 * Create a language model instance for the given provider/model.
 * Uses org-specific API keys for multi-tenant isolation.
 */
export function createModel(
  provider: string,
  modelName: string,
  apiKey: string,
  ollamaBaseUrl?: string
): LanguageModel {
  switch (provider) {
    case "anthropic": {
      const client = createAnthropic({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "openai": {
      const client = createOpenAI({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "google":
    case "gemini": {
      const client = createGoogleGenerativeAI({ apiKey });
      return client(modelName) as unknown as LanguageModel;
    }
    case "ollama": {
      const baseUrl = ollamaBaseUrl || process.env.OLLAMA_HOST || "http://localhost:11434";
      const client = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "ollama" });
      return client(modelName) as unknown as LanguageModel;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, ollama`);
  }
}
