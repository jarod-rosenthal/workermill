/**
 * Web Search Tool
 *
 * Searches the web using DuckDuckGo HTML and returns results.
 * No API key required — uses DuckDuckGo's public search.
 */

import { htmlToReadableText } from "./html.js";

export const description =
  "Search the web for documentation, error messages, library usage, or any information. Returns search results with titles, URLs, and snippets. Use this when you need up-to-date information that might not be in your training data.";

export interface WebSearchResult {
  success: boolean;
  results?: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
  error?: string;
}

export async function execute(input: {
  query: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, maxResults = 8 } = input;

  try {
    const encoded = encodeURIComponent(query);
    const response = await globalThis.fetch(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      {
        headers: {
          "User-Agent": "WorkerMill/1.0 (AI Coding Agent)",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      return { success: false, error: `Search failed: HTTP ${response.status}` };
    }

    const html = await response.text();

    // Parse results from DuckDuckGo HTML response
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
      const rawUrl = match[1];
      const title = htmlToReadableText(match[2], "text");
      const snippet = htmlToReadableText(match[3], "text");

      // DuckDuckGo wraps URLs in a redirect — extract the actual URL
      let url = rawUrl;
      const uddgMatch = rawUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        url = decodeURIComponent(uddgMatch[1]);
      }

      if (title && url) {
        results.push({ title, url, snippet });
      }
    }

    if (results.length === 0) {
      return { success: true, results: [], error: "No results found" };
    }

    return { success: true, results };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
