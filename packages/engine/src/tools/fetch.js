export const name = "fetch";
export const description = "Fetch content from a URL and return it as text or markdown. " +
    "Useful for reading documentation, API references, error pages, and other web content.";
export const parameters = {
    type: "object",
    properties: {
        url: {
            type: "string",
            description: "The URL to fetch",
        },
        format: {
            type: "string",
            enum: ["text", "markdown", "html"],
            description: "Output format: text (stripped), markdown (converted), or html (raw). Default: markdown",
        },
        timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000, max: 120000)",
        },
    },
    required: ["url"],
};
function htmlToText(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function htmlToMarkdown(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n")
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n")
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n")
        .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n")
        .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1\n\n")
        .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1\n\n")
        .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
        .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "```\n$1\n```\n\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<hr\s*\/?>/gi, "\n---\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
const MAX_CONTENT_SIZE = 512 * 1024;
export async function execute({ url, format = "markdown", timeout = 30000, }) {
    try {
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        }
        catch {
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
            let content;
            if (contentType.includes("text/html") || contentType.includes("xhtml")) {
                if (format === "text") {
                    content = htmlToText(body);
                }
                else if (format === "markdown") {
                    content = htmlToMarkdown(body);
                }
                else {
                    content = body;
                }
            }
            else {
                content = body;
            }
            return { success: true, content, url, statusCode: response.status, contentType };
        }
        catch (err) {
            clearTimeout(timeoutId);
            if (err instanceof Error && err.name === "AbortError") {
                return { success: false, content: "", url, error: `Request timed out after ${clampedTimeout}ms` };
            }
            throw err;
        }
    }
    catch (err) {
        return { success: false, content: "", url, error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}
