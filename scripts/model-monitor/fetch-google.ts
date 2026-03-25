// scripts/model-monitor/fetch-google.ts

import type { RemoteModel } from "./fetch-openai.js";

/**
 * Fetch model list from Google Generative AI API.
 * Uses header auth to keep API key out of URLs/logs.
 */
export async function fetchGoogleModels(apiKey: string): Promise<RemoteModel[]> {
  // Use header auth to keep API key out of URLs/logs
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1/models",
    { headers: { "x-goog-api-key": apiKey } },
  );

  if (!res.ok) {
    throw new Error(`Google API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    models: Array<{
      name: string;
      displayName: string;
      supportedGenerationMethods: string[];
    }>;
  };

  // Include-list: only Gemini models that support content generation.
  // Excludes embedding models, legacy PaLM, vision-only, and versioned suffixes (-001, -latest).
  const excludePatterns = [
    /-\d{3}$/,           // versioned suffixes (gemini-1.0-pro-001)
    /-latest$/,          // -latest aliases
    /vision/,            // vision-only models
    /embedding/,         // embedding models
    /^aqa$/,             // AQA model
  ];

  return data.models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .filter((m) => m.name.includes("gemini"))  // only Gemini models
    .map((m) => m.name.replace("models/", ""))
    .filter((id) => !excludePatterns.some((p) => p.test(id)))
    .map((id) => ({ id, provider: "google" }));
}
