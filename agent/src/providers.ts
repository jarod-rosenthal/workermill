/**
 * Lightweight HTTP wrappers for text generation across AI providers.
 *
 * Used for planning and critic stages when the org's provider is not Anthropic.
 * No heavy SDK dependencies — uses the existing axios dependency for HTTP calls.
 * Streaming is not needed (planning/critic are text-only, result matters).
 */

import axios from "axios";

export type AIProvider = "anthropic" | "openai" | "google" | "ollama";

export interface GenerateTextOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_TOKENS = 16384;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes (matches Claude CLI timeout)

/**
 * Generate text from any supported AI provider via direct HTTP API calls.
 * Returns the raw text response.
 */
export async function generateText(
  provider: AIProvider,
  model: string,
  prompt: string,
  apiKey: string,
  options?: GenerateTextOptions,
): Promise<string> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options?.temperature ?? 0.7;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  switch (provider) {
    case "anthropic":
      return generateAnthropic(model, prompt, apiKey, maxTokens, temperature, timeoutMs);
    case "openai":
      return generateOpenAI(model, prompt, apiKey, maxTokens, temperature, timeoutMs);
    case "google":
      return generateGoogle(model, prompt, apiKey, maxTokens, temperature, timeoutMs);
    case "ollama":
      return generateOllama(model, prompt, apiKey, maxTokens, temperature, timeoutMs);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

/**
 * Anthropic Messages API (for orgs with API key, not CLI).
 */
async function generateAnthropic(
  model: string,
  prompt: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<string> {
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      timeout: timeoutMs,
    },
  );

  const content = response.data?.content;
  if (Array.isArray(content)) {
    return content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");
  }
  throw new Error("Unexpected Anthropic API response format");
}

/**
 * OpenAI Chat Completions API.
 */
async function generateOpenAI(
  model: string,
  prompt: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<string> {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: timeoutMs,
    },
  );

  const message = response.data?.choices?.[0]?.message;
  if (message?.content) return message.content;
  throw new Error("Unexpected OpenAI API response format");
}

/**
 * Google Generative AI (Gemini) API.
 */
async function generateGoogle(
  model: string,
  prompt: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<string> {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: timeoutMs,
    },
  );

  const candidate = response.data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (text) return text;
  throw new Error("Unexpected Google AI API response format");
}

/**
 * Ollama Generate API (self-hosted).
 * `apiKey` is used as the Ollama base URL (e.g. "http://localhost:11434").
 */
async function generateOllama(
  model: string,
  prompt: string,
  ollamaHost: string,
  _maxTokens: number,
  temperature: number,
  timeoutMs: number,
): Promise<string> {
  const baseUrl = ollamaHost || "http://localhost:11434";

  const response = await axios.post(
    `${baseUrl}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: { temperature },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: timeoutMs,
    },
  );

  const text = response.data?.response;
  if (text) return text;
  throw new Error("Unexpected Ollama API response format");
}
