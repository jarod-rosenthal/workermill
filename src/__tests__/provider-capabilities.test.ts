import { describe, expect, it } from "vitest";
import {
  getApiKeyEnvVar,
  getBaseProviderName,
  getProviderCapabilities,
  isLocalProvider,
  providerHasReliableToolCalling,
  providerNeedsContextOverride,
  providerSupportsStreaming,
  providerSupportsVision,
} from "../provider-capabilities.js";

describe("provider capabilities", () => {
  it("normalizes routed provider aliases to their base provider", () => {
    expect(getBaseProviderName("openai_tech_lead")).toBe("openai");
    expect(getBaseProviderName("anthropic_planner")).toBe("anthropic");
    expect(getApiKeyEnvVar("xai_reviewer")).toBe("XAI_API_KEY");
  });

  it("marks local providers as local and context-managed", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("lmstudio")).toBe(true);
    expect(providerNeedsContextOverride("ollama")).toBe(true);
    expect(providerNeedsContextOverride("lmstudio")).toBe(true);
  });

  it("exposes provider api key env vars from one source of truth", () => {
    expect(getApiKeyEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
    expect(getApiKeyEnvVar("openai")).toBe("OPENAI_API_KEY");
    expect(getApiKeyEnvVar("google")).toBe("GOOGLE_GENERATIVE_AI_API_KEY");
    expect(getApiKeyEnvVar("groq")).toBe("GROQ_API_KEY");
    expect(getApiKeyEnvVar("deepseek")).toBe("DEEPSEEK_API_KEY");
    expect(getApiKeyEnvVar("mistral")).toBe("MISTRAL_API_KEY");
    expect(getApiKeyEnvVar("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(getApiKeyEnvVar("ollama")).toBeNull();
  });

  it("returns provider-specific reasoning options", () => {
    expect(getProviderCapabilities("openai").reasoningOptions("gpt-5.4")).toEqual({
      providerOptions: { openai: { reasoningSummary: "detailed" } },
    });

    expect(getProviderCapabilities("google").reasoningOptions("gemini-2.5-pro")).toEqual({
      providerOptions: { google: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } } },
    });

    expect(getProviderCapabilities("google").reasoningOptions("gemini-3-pro")).toEqual({
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } },
    });
  });

  it("exposes streaming, vision, and tool-calling capabilities", () => {
    expect(providerSupportsVision("anthropic")).toBe(true);
    expect(providerSupportsVision("groq")).toBe(false);
    expect(providerSupportsStreaming("openai")).toBe(true);
    expect(providerHasReliableToolCalling("openai")).toBe(true);
    expect(providerHasReliableToolCalling("ollama")).toBe(false);
  });

  it("falls back to sensible defaults for unknown providers", () => {
    expect(getApiKeyEnvVar("custom-openai-compatible")).toBeNull();
    expect(isLocalProvider("custom-openai-compatible")).toBe(false);
    expect(providerNeedsContextOverride("custom-openai-compatible")).toBe(false);
    expect(providerSupportsStreaming("custom-openai-compatible")).toBe(true);
    expect(providerHasReliableToolCalling("custom-openai-compatible")).toBe(true);
  });
});
