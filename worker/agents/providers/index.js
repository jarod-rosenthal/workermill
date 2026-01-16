/**
 * =============================================================================
 * LLM Provider Registry for WorkerMill
 * =============================================================================
 *
 * Unified interface for all LLM provider adapters.
 * Automatically selects provider based on model name or environment config.
 */

const openai = require("./openai");
const ollama = require("./ollama");
const gemini = require("./gemini");
const groq = require("./groq");
const mistral = require("./mistral");
const azure = require("./azure");

/**
 * All available providers
 */
const providers = {
  openai,
  ollama,
  gemini,
  groq,
  mistral,
  azure,
};

/**
 * Model prefix to provider mapping
 */
const modelPrefixes = {
  // OpenAI models
  "gpt-4": "openai",
  "gpt-3.5": "openai",
  "o1": "openai",
  "o3": "openai",

  // Gemini models
  "gemini": "gemini",

  // Groq models (common ones)
  "llama": "groq", // llama3, llama-3.1, etc.
  "mixtral": "groq",
  "gemma": "groq",

  // Mistral models
  "mistral": "mistral",
  "codestral": "mistral",
  "pixtral": "mistral",

  // Ollama models (common local models)
  "qwen": "ollama",
  "deepseek": "ollama",
  "phi": "ollama",
  "codellama": "ollama",
  "starcoder": "ollama",
  "wizardcoder": "ollama",
};

/**
 * Get provider by name
 */
function getProvider(name) {
  const provider = providers[name.toLowerCase()];
  if (!provider) {
    throw new Error(
      `Unknown provider: ${name}. Available: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

/**
 * Detect provider from model name
 */
function detectProvider(model) {
  const modelLower = model.toLowerCase();

  // Check explicit prefixes
  for (const [prefix, providerName] of Object.entries(modelPrefixes)) {
    if (modelLower.startsWith(prefix)) {
      return providers[providerName];
    }
  }

  // Check environment variables to determine default
  if (process.env.AZURE_API_KEY && process.env.AZURE_API_BASE) {
    return providers.azure;
  }
  if (process.env.OPENAI_API_KEY) {
    return providers.openai;
  }
  if (process.env.GEMINI_API_KEY) {
    return providers.gemini;
  }
  if (process.env.GROQ_API_KEY) {
    return providers.groq;
  }
  if (process.env.MISTRAL_API_KEY) {
    return providers.mistral;
  }
  if (process.env.OLLAMA_HOST) {
    return providers.ollama;
  }

  // Default to ollama for local models
  return providers.ollama;
}

/**
 * Get provider from model name or explicit provider name
 */
function resolveProvider(modelOrProvider, explicitProvider = null) {
  if (explicitProvider) {
    return getProvider(explicitProvider);
  }
  return detectProvider(modelOrProvider);
}

/**
 * Unified chat interface
 * Automatically selects the right provider based on model name
 */
async function chat(model, messages, tools, options = {}) {
  const provider = resolveProvider(model, options.provider);
  return provider.chat(model, messages, tools);
}

/**
 * Unified streaming chat interface
 */
async function streamChat(model, messages, tools, onChunk, options = {}) {
  const provider = resolveProvider(model, options.provider);
  return provider.streamChat(model, messages, tools, onChunk);
}

/**
 * List all available providers
 */
function listProviders() {
  return Object.keys(providers);
}

/**
 * Check which providers are configured (have required env vars)
 */
function getConfiguredProviders() {
  const configured = [];

  if (process.env.OPENAI_API_KEY) {
    configured.push("openai");
  }
  if (process.env.OLLAMA_HOST || true) {
    // Ollama always available locally
    configured.push("ollama");
  }
  if (process.env.GEMINI_API_KEY) {
    configured.push("gemini");
  }
  if (process.env.GROQ_API_KEY) {
    configured.push("groq");
  }
  if (process.env.MISTRAL_API_KEY) {
    configured.push("mistral");
  }
  if (process.env.AZURE_API_KEY && process.env.AZURE_API_BASE) {
    configured.push("azure");
  }

  return configured;
}

module.exports = {
  // Individual providers
  providers,
  openai,
  ollama,
  gemini,
  groq,
  mistral,
  azure,

  // Provider resolution
  getProvider,
  detectProvider,
  resolveProvider,

  // Unified interfaces
  chat,
  streamChat,

  // Utilities
  listProviders,
  getConfiguredProviders,
};
