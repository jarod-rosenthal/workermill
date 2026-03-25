// scripts/model-monitor/pricing-estimator.ts

/**
 * ModelInfo interface — matches api/src/providers/types.ts but defined locally
 * to avoid cross-project import issues with tsx.
 */
export interface ModelInfo {
  id: string;
  displayName: string;
  tier: "budget" | "balanced" | "powerful";
  inputRate: number;
  outputRate: number;
  cacheWriteRate?: number;
  cacheReadRate?: number;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsCaching: boolean;
}

interface PricingEstimate {
  inputRate: number;
  outputRate: number;
  cacheReadRate?: number;
  cacheWriteRate?: number;
  tier: "budget" | "balanced" | "powerful";
  contextWindow: number;
  supportsStreaming: boolean;
  supportsCaching: boolean;
  estimationBasis: string;
}

const OPENAI_FAMILIES: Array<{ pattern: RegExp; estimate: PricingEstimate }> = [
  {
    pattern: /gpt-.*-nano/,
    estimate: {
      inputRate: 0.00005, outputRate: 0.0004, cacheReadRate: 0.000005,
      tier: "budget", contextWindow: 128000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "GPT nano family (based on gpt-5.4-nano pricing)",
    },
  },
  {
    pattern: /gpt-.*-mini/,
    estimate: {
      inputRate: 0.00015, outputRate: 0.0006, cacheReadRate: 0.000015,
      tier: "budget", contextWindow: 128000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "GPT mini family (based on gpt-5.4-mini pricing)",
    },
  },
  {
    pattern: /gpt-.*-pro/,
    estimate: {
      inputRate: 0.005, outputRate: 0.02, cacheReadRate: 0.0005,
      tier: "powerful", contextWindow: 128000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "GPT pro family (based on gpt-5.4-pro pricing)",
    },
  },
  {
    pattern: /gpt-.*codex/,
    estimate: {
      inputRate: 0.00175, outputRate: 0.014, cacheReadRate: 0.000175,
      tier: "powerful", contextWindow: 128000, supportsStreaming: false, supportsCaching: true,
      estimationBasis: "GPT codex family (based on gpt-5.3-codex pricing)",
    },
  },
  {
    pattern: /^gpt-/,
    estimate: {
      inputRate: 0.00075, outputRate: 0.0045, cacheReadRate: 0.000075,
      tier: "powerful", contextWindow: 128000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "GPT flagship family (based on gpt-5.4 pricing)",
    },
  },
  {
    pattern: /^o\d/,
    estimate: {
      inputRate: 0.015, outputRate: 0.06, cacheReadRate: 0.0075,
      tier: "powerful", contextWindow: 200000, supportsStreaming: false, supportsCaching: true,
      estimationBasis: "OpenAI reasoning family (based on o1 pricing)",
    },
  },
];

const GOOGLE_FAMILIES: Array<{ pattern: RegExp; estimate: PricingEstimate }> = [
  {
    pattern: /flash-lite|flash.*lite/,
    estimate: {
      inputRate: 0.00025, outputRate: 0.0015, cacheReadRate: 0.0000625,
      tier: "budget", contextWindow: 1000000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Gemini Flash Lite family (based on gemini-3.1-flash-lite pricing)",
    },
  },
  {
    pattern: /flash/,
    estimate: {
      inputRate: 0.0001, outputRate: 0.0004, cacheReadRate: 0.000025,
      tier: "balanced", contextWindow: 1000000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Gemini Flash family (based on gemini-3-flash pricing)",
    },
  },
  {
    pattern: /pro/,
    estimate: {
      inputRate: 0.00125, outputRate: 0.01, cacheReadRate: 0.0003125,
      tier: "powerful", contextWindow: 1000000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Gemini Pro family (based on gemini-3.1-pro pricing)",
    },
  },
];

const ANTHROPIC_FAMILIES: Array<{ pattern: RegExp; estimate: PricingEstimate }> = [
  {
    pattern: /haiku/,
    estimate: {
      inputRate: 0.001, outputRate: 0.005, cacheWriteRate: 0.00125, cacheReadRate: 0.0001,
      tier: "budget", contextWindow: 200000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Claude Haiku family (based on claude-haiku-4-5 pricing)",
    },
  },
  {
    pattern: /sonnet/,
    estimate: {
      inputRate: 0.003, outputRate: 0.015, cacheWriteRate: 0.00375, cacheReadRate: 0.0003,
      tier: "balanced", contextWindow: 200000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Claude Sonnet family (based on claude-sonnet-4-6 pricing)",
    },
  },
  {
    pattern: /opus/,
    estimate: {
      inputRate: 0.005, outputRate: 0.025, cacheWriteRate: 0.00625, cacheReadRate: 0.0005,
      tier: "powerful", contextWindow: 200000, supportsStreaming: true, supportsCaching: true,
      estimationBasis: "Claude Opus family (based on claude-opus-4-6 pricing)",
    },
  },
];

const PROVIDER_FAMILIES: Record<string, Array<{ pattern: RegExp; estimate: PricingEstimate }>> = {
  openai: OPENAI_FAMILIES,
  google: GOOGLE_FAMILIES,
  anthropic: ANTHROPIC_FAMILIES,
};

export function estimatePricing(modelId: string, provider: string): PricingEstimate | null {
  const families = PROVIDER_FAMILIES[provider];
  if (!families) return null;

  for (const family of families) {
    if (family.pattern.test(modelId)) {
      return { ...family.estimate };
    }
  }

  return null;
}

export function buildModelInfo(modelId: string, provider: string): ModelInfo | null {
  const estimate = estimatePricing(modelId, provider);
  if (!estimate) return null;

  // Generate display name from model ID
  const displayName = modelId
    .replace(/^(gpt-|gemini-|claude-)/, (m) => m.charAt(0).toUpperCase() + m.slice(1))
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    id: modelId,
    displayName,
    tier: estimate.tier,
    inputRate: estimate.inputRate,
    outputRate: estimate.outputRate,
    cacheWriteRate: estimate.cacheWriteRate,
    cacheReadRate: estimate.cacheReadRate,
    contextWindow: estimate.contextWindow,
    supportsStreaming: estimate.supportsStreaming,
    supportsCaching: estimate.supportsCaching,
  };
}
