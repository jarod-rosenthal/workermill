import type { CliConfig } from "./config.js";
import { getProviderForPersona } from "./config.js";

/** A model binding as selected by configuration or by a runtime caller. */
export interface ReviewModelBinding {
  /** Configured provider key, or the provider kind after resolution. */
  provider: string;
  model: string;
  /** Optional provider endpoint override. Credentials are never part of identity. */
  host?: string;
}

export interface ReviewBindingInput {
  provider: string;
  model?: string;
  host?: string;
}

export interface ResolvedReviewBinding {
  /** The configured provider key before alias resolution. */
  configuredProvider: string;
  /** Provider kind used by the model factory (for example, `openai`). */
  provider: string;
  model: string;
  /** Normalized endpoint, with credentials and query strings removed. */
  endpoint?: string;
  /** Endpoint/model identifiers only; this is not proof of independent training. */
  identity?: string;
}

export type ReviewIdentityStatus = "shared" | "different" | "unverified";

export interface ReviewIdentityComparison {
  status: ReviewIdentityStatus;
  worker: ResolvedReviewBinding;
  reviewer: ResolvedReviewBinding;
  /** Endpoint/model identifiers do not prove independent model training. */
  independentTrainingProven: false;
  reason: string;
}

export interface ReviewIdentityPreflight {
  status: ReviewIdentityStatus;
  comparisons: ReviewIdentityComparison[];
  /** False when required independence is not established. */
  allowed: boolean;
  warning?: string;
}

export interface ReviewIdentityPreflightInput {
  config?: CliConfig;
  /** Every worker binding must be known-different from the reviewer when required. */
  workers: Array<ReviewBindingInput | ReviewModelBinding>;
  reviewer: ReviewBindingInput | ReviewModelBinding;
  requireDifferentModel?: boolean;
}

const DEFAULT_ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com",
  gemini: "https://generativelanguage.googleapis.com",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
};

const NATIVE_PROVIDERS = new Set(["ollama", "anthropic", "openai", "google", "gemini", "lmstudio"]);
const OPENAI_COMPATIBLE_PROVIDERS = new Set(["xai", "groq", "deepseek", "mistral"]);

function effectiveModel(provider: string, model: string): string {
  if (provider === "google" || provider === "gemini") {
    const aliases: Record<string, string> = {
      "gemini-3.1-pro": "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
      "gemini-3-flash": "gemini-3-flash-preview",
      "gemini-3-pro": "gemini-3-pro-preview",
    };
    return aliases[model] || model;
  }
  return model;
}

function normalizeEndpoint(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // URL.username/password and URL.search are deliberately discarded. They must
    // not appear in identity reports, and neither changes the model factory route.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
      url.port = "";
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

function endpointForProvider(provider: string, host?: string): string | undefined {
  if (provider === "ollama") {
    // createOllama appends /api to the configured base URL.
    return host === undefined ? undefined : normalizeEndpoint(`${host.replace(/\/+$/, "")}/api`);
  }
  if (provider === "lmstudio") {
    return host === undefined ? undefined : normalizeEndpoint(host);
  }
  // The installed factory ignores host overrides for these SDK-native providers.
  if (provider === "anthropic" && process.env.ANTHROPIC_BASE_URL) {
    return normalizeEndpoint(process.env.ANTHROPIC_BASE_URL);
  }
  if (provider === "anthropic" || provider === "google" || provider === "gemini") {
    return normalizeEndpoint(DEFAULT_ENDPOINTS[provider]);
  }
  if (provider === "openai" && host === undefined && process.env.OPENAI_BASE_URL) {
    return normalizeEndpoint(process.env.OPENAI_BASE_URL);
  }
  // For providers whose factory honors a custom base URL, an invalid explicit
  // host is unknown; it must not silently fall back to a default endpoint.
  return host !== undefined ? normalizeEndpoint(host) : normalizeEndpoint(DEFAULT_ENDPOINTS[provider]);
}

function resolveProviderKind(configuredProvider: string, host: string | undefined, config?: CliConfig): string | undefined {
  if (NATIVE_PROVIDERS.has(configuredProvider) || OPENAI_COMPATIBLE_PROVIDERS.has(configuredProvider) || configuredProvider === "openrouter") {
    return configuredProvider;
  }

  if (!config) return host ? "openai" : undefined;

  // Keep this in step with getProviderForPersona/model-factory alias behavior,
  // without constructing a model or making a provider request.
  const syntheticConfig: CliConfig = { ...config, default: configuredProvider, routing: undefined };
  try {
    const resolved = getProviderForPersona(syntheticConfig);
    return resolved.provider;
  } catch {
    return host ? "openai" : undefined;
  }
}

/** Resolve a configured provider alias into the binding used by the model factory. */
export function resolveReviewBinding(config: CliConfig, input: ReviewBindingInput | ReviewModelBinding | string): ResolvedReviewBinding {
  const configuredProvider = typeof input === "string" ? input : input.provider;
  const inputModel = typeof input === "string" ? undefined : input.model;
  const inputHost = typeof input === "string" ? undefined : input.host;
  const configured = config.providers[configuredProvider];
  const modelConfig: CliConfig = { ...config, default: configuredProvider, routing: undefined };

  let model = inputModel;
  let host = inputHost;
  let provider = resolveProviderKind(configuredProvider, host, config);
  if (configured) {
    try {
      const resolved = getProviderForPersona(modelConfig);
      provider = resolved.provider;
      model = model ?? resolved.model;
      host = host ?? resolved.host;
    } catch {
      model = model ?? configured.model;
      host = host ?? configured.host;
    }
  }

  provider = provider || configuredProvider;
  const endpoint = endpointForProvider(provider, host);
  const resolved: ResolvedReviewBinding = {
    configuredProvider,
    provider,
    model: effectiveModel(provider, model || ""),
    ...(endpoint ? { endpoint } : {}),
  };
  if (resolved.model && endpoint) {
    resolved.identity = `${endpoint}|${resolved.model}`;
  }
  return resolved;
}

function asResolved(input: ReviewBindingInput | ReviewModelBinding | ResolvedReviewBinding): ResolvedReviewBinding {
  if ("configuredProvider" in input) return input;
  const endpoint = endpointForProvider(input.provider, input.host);
  const resolved: ResolvedReviewBinding = {
    configuredProvider: input.provider,
    provider: input.provider,
    model: effectiveModel(input.provider, input.model || ""),
    ...(endpoint ? { endpoint } : {}),
  };
  if (input.model && endpoint) resolved.identity = `${endpoint}|${effectiveModel(input.provider, input.model)}`;
  return resolved;
}

/** Compare two already-selected bindings without creating a provider/model. */
export function compareReviewBindings(worker: ReviewBindingInput | ReviewModelBinding | ResolvedReviewBinding, reviewer: ReviewBindingInput | ReviewModelBinding | ResolvedReviewBinding): ReviewIdentityComparison {
  const workerResolved = asResolved(worker);
  const reviewerResolved = asResolved(reviewer);
  let status: ReviewIdentityStatus;
  let reason: string;
  if (!workerResolved.identity || !reviewerResolved.identity) {
    status = "unverified";
    reason = "One or both bindings do not have a verifiable endpoint/model identity.";
  } else if (workerResolved.identity === reviewerResolved.identity) {
    status = "shared";
    reason = "Worker and reviewer resolve to the same endpoint and model.";
  } else {
    status = "different";
    reason = "Worker and reviewer resolve to different endpoint/model identifiers; this does not prove independent model training.";
  }
  return {
    status,
    worker: workerResolved,
    reviewer: reviewerResolved,
    independentTrainingProven: false,
    reason,
  };
}

function aggregateStatus(comparisons: ReviewIdentityComparison[]): ReviewIdentityStatus {
  if (comparisons.some((comparison) => comparison.status === "shared")) return "shared";
  if (comparisons.some((comparison) => comparison.status === "unverified")) return "unverified";
  if (comparisons.length === 0) return "unverified";
  return "different";
}

/**
 * Preflight reviewer identity for R15. This only compares selected identifiers;
 * it does not route, switch, instantiate, or contact any model provider.
 */
export function preflightReviewIdentity(input: ReviewIdentityPreflightInput): ReviewIdentityPreflight {
  const workers = input.workers;
  const reviewer = input.reviewer;
  const resolve = (binding: ReviewBindingInput | ReviewModelBinding): ResolvedReviewBinding =>
    input.config ? resolveReviewBinding(input.config, binding) : asResolved(binding);
  const reviewerResolved = resolve(reviewer);
  const comparisons = workers.map((worker) => compareReviewBindings(resolve(worker), reviewerResolved));
  const status = aggregateStatus(comparisons);
  const required = input.requireDifferentModel === true;
  const allowed = !required || status === "different";
  return {
    status,
    comparisons,
    allowed,
    ...(status === "shared"
      ? { warning: "Worker and reviewer use a shared endpoint/model binding; review independence is not established." }
      : status === "unverified"
        ? { warning: "Reviewer identity is unverified; endpoint/model identifiers were not sufficient to establish independence." }
        : {}),
  };
}
