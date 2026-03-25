// scripts/model-monitor/fetch-anthropic.ts

import type { RemoteModel } from "./fetch-openai.js";

/**
 * Fetch model list from Anthropic API.
 * GET https://api.anthropic.com/v1/models
 * Handles pagination via has_more/last_id.
 */
export async function fetchAnthropicModels(apiKey: string): Promise<RemoteModel[]> {
  const models: RemoteModel[] = [];
  let hasMore = true;
  let afterId: string | undefined;

  while (hasMore) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);

    const res = await fetch(url.toString(), {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!res.ok) {
      throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as {
      data: Array<{ id: string; created_at: string; display_name: string }>;
      has_more: boolean;
      last_id: string;
    };

    for (const m of data.data) {
      models.push({
        id: m.id,
        provider: "anthropic",
        created: new Date(m.created_at).getTime() / 1000,
      });
    }

    hasMore = data.has_more;
    afterId = data.last_id;
  }

  return models;
}
