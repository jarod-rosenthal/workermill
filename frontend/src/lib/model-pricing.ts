/**
 * Centralized model pricing data.
 *
 * Keep this file up-to-date when providers change rates.
 * Both the docs page (AdvancedFeatures) and any future cost UI
 * should import from here so pricing only needs updating in one place.
 *
 * NOTE: The API has its own copy in api/src/routes/analytics/costs.ts.
 * When updating prices here, update the API copy too.
 *
 * Prices are per 1M tokens. Last updated: March 2026.
 */

export interface ModelPricingEntry {
  /** Model ID used in API calls */
  id: string;
  /** Human-readable name */
  name: string;
  /** Capability tier */
  tier: "Powerful" | "Balanced" | "Fast";
  /** Input price per 1M tokens (USD), or null if free/self-hosted */
  inputPricePerMillion: number | null;
  /** Output price per 1M tokens (USD), or null if free/self-hosted */
  outputPricePerMillion: number | null;
  /** Context window size label */
  context: string;
}

export interface ProviderPricingConfig {
  name: string;
  icon: string;
  models: ModelPricingEntry[];
}

/**
 * All supported providers and their models with pricing.
 *
 * Ollama models are free (self-hosted) so prices are null.
 */
export const PROVIDER_MODELS: Record<string, ProviderPricingConfig> = {
  anthropic: {
    name: "Anthropic",
    icon: "🤖",
    models: [
      { id: "claude-opus-4-6", name: "Claude Opus 4.6", tier: "Powerful", inputPricePerMillion: 5.0, outputPricePerMillion: 25.0, context: "200K" },
      { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", tier: "Balanced", inputPricePerMillion: 3.0, outputPricePerMillion: 15.0, context: "200K" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", tier: "Fast", inputPricePerMillion: 0.8, outputPricePerMillion: 4.0, context: "200K" },
    ],
  },
  openai: {
    name: "OpenAI",
    icon: "🔷",
    models: [
      { id: "o3-mini", name: "o3 Mini", tier: "Powerful", inputPricePerMillion: 1.1, outputPricePerMillion: 4.4, context: "200K" },
      { id: "gpt-4o", name: "GPT-4o", tier: "Balanced", inputPricePerMillion: 2.5, outputPricePerMillion: 10.0, context: "128K" },
      { id: "o1", name: "o1 (Reasoning)", tier: "Powerful", inputPricePerMillion: 15.0, outputPricePerMillion: 60.0, context: "200K" },
      { id: "o1-mini", name: "o1 Mini", tier: "Balanced", inputPricePerMillion: 3.0, outputPricePerMillion: 12.0, context: "128K" },
    ],
  },
  google: {
    name: "Google",
    icon: "🔵",
    models: [
      { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", tier: "Powerful", inputPricePerMillion: 1.25, outputPricePerMillion: 5.0, context: "1M" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "Balanced", inputPricePerMillion: 0.075, outputPricePerMillion: 0.3, context: "1M" },
    ],
  },
  ollama: {
    name: "Ollama (Local)",
    icon: "🏠",
    models: [
      { id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B", tier: "Balanced", inputPricePerMillion: null, outputPricePerMillion: null, context: "128K" },
      { id: "deepseek-r1:70b", name: "DeepSeek R1 70B", tier: "Powerful", inputPricePerMillion: null, outputPricePerMillion: null, context: "128K" },
      { id: "llama3.1:70b", name: "Llama 3.1 70B", tier: "Balanced", inputPricePerMillion: null, outputPricePerMillion: null, context: "128K" },
    ],
  },
};

/** Format a price-per-million-tokens value for display. */
export function formatTokenPrice(pricePerMillion: number | null): string {
  if (pricePerMillion === null) return "Free";
  // Use fixed(2) for >= $1, fixed(3) for sub-dollar with 3 decimals, otherwise fixed(2)
  const formatted =
    pricePerMillion >= 1
      ? pricePerMillion.toFixed(2)
      : pricePerMillion < 0.1
        ? pricePerMillion.toString()
        : pricePerMillion.toFixed(2);
  return `$${formatted}/M`;
}
