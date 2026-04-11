import { htmlToReadableText } from "./html.js";

export const name = "fetch";

export const description =
  "Fetch content from a URL and return it as text or markdown. " +
  "Useful for reading documentation, API references, error pages, and other web content.";

export const parameters = {
  type: "object" as const,
  properties: {
    url: {
      type: "string" as const,
      description: "The URL to fetch",
    },
    format: {
      type: "string" as const,
      enum: ["text", "markdown", "html"],
      description: "Output format: text (stripped), markdown (converted), or html (raw). Default: markdown",
    },
    timeout: {
      type: "number" as const,
      description: "Timeout in milliseconds (default: 30000, max: 120000)",
    },
  },
  required: ["url"] as const,
};

interface FetchParams {
  url: string;
  format?: "text" | "markdown" | "html";
  timeout?: number;
}

interface FetchResult {
  success: boolean;
  content: string;
  url: string;
  statusCode?: number;
  contentType?: string;
  error?: string;
}

const MAX_CONTENT_SIZE = 512 * 1024;

export async function execute({
  url,
  format = "markdown",
  timeout = 30000,
}: FetchParams): Promise<FetchResult> {
  try {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, content: "", url, error: `Invalid URL: ${url}` };
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { success: false, content: "", url, error: `Unsupported protocol: ${parsedUrl.protocol}. Only http and https are allowed.` };
    }

    const clampedTimeout = Math.min(timeout, 120000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), clampedTimeout);

    try {
      const response = await globalThis.fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "WorkerMill/1.0",
          Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { success: false, content: "", url, statusCode: response.status, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const contentType = response.headers.get("content-type") || "";
      let body = await response.text();

      if (body.length > MAX_CONTENT_SIZE) {
        body = body.slice(0, MAX_CONTENT_SIZE) + "\n\n... [content truncated at 512KB]";
      }

      let content: string;
      if (contentType.includes("text/html") || contentType.includes("xhtml")) {
        if (format === "text") {
          content = htmlToReadableText(body, "text");
        } else if (format === "markdown") {
          content = htmlToReadableText(body, "markdown");
        } else {
          content = body;
        }
      } else {
        content = body;
      }

      return { success: true, content, url, statusCode: response.status, contentType };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        return { success: false, content: "", url, error: `Request timed out after ${clampedTimeout}ms` };
      }
      throw err;
    }
  } catch (err) {
    return { success: false, content: "", url, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
