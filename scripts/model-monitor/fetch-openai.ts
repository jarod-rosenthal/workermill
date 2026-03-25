// scripts/model-monitor/fetch-openai.ts

export interface RemoteModel {
  id: string;
  provider: string;
  created?: number;
}

/**
 * Fetch model list from OpenAI API.
 * GET https://api.openai.com/v1/models
 * Returns only chat/completion models — uses include-list to avoid noise.
 */
export async function fetchOpenAIModels(apiKey: string): Promise<RemoteModel[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { data: Array<{ id: string; created: number; owned_by: string }> };

  // Include-list approach: only models from known chat/reasoning families.
  // This avoids noise from dated snapshots (gpt-5.4-2026-03-15),
  // fine-tuned models (ft:gpt-*), embeddings, audio, etc.
  const includePatterns = [
    /^gpt-\d/,   // GPT family (gpt-5, gpt-5.4-mini, etc.)
    /^o\d/,      // Reasoning family (o1, o3-mini, etc.)
  ];

  // Exclude dated snapshots, fine-tunes, and aliases
  const excludePatterns = [
    /\d{4}-\d{2}-\d{2}/,     // dated snapshots (gpt-5.4-2026-03-15)
    /^ft:/,                    // fine-tuned models
    /^chatgpt-/,               // chatgpt aliases
    /realtime/,                // realtime audio models
  ];

  return data.data
    .filter((m) => includePatterns.some((p) => p.test(m.id)))
    .filter((m) => !excludePatterns.some((p) => p.test(m.id)))
    .map((m) => ({
      id: m.id,
      provider: "openai",
      created: m.created,
    }));
}
