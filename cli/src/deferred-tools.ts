/**
 * Deferred tool loading — keeps context lean by loading full schemas on demand.
 *
 * Core tools (bash, read_file, write_file, edit_file, glob, grep, ls, patch,
 * git, sub_agent, lsp, verify, todo, web_search, fetch, and all browser_*
 * tools) are always fully loaded. MCP tools are deferred: only a one-liner
 * description appears in the system prompt. The model can call `tool_search`
 * to promote deferred tools into the active tool set.
 */

// ---------------------------------------------------------------------------
// Core tools — always fully loaded
// ---------------------------------------------------------------------------

/** Tool names that are always sent with full schemas. */
export const EAGER_TOOLS = new Set([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "ls",
  "patch",
  "git",
  "sub_agent",
  "lsp",
  "verify",
  "todo",
  "web_search",
  "fetch",
  // Browser tools are load-bearing for Ollama serialization — always eager
  "browser_open",
  "browser_navigate",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_evaluate",
  "browser_console",
  "browser_close",
  // Deferred tool loading meta-tool
  "tool_search",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeferredToolEntry {
  name: string;
  description: string;
  serverName?: string;
}

// ---------------------------------------------------------------------------
// Partition
// ---------------------------------------------------------------------------

/**
 * Split a tool map into eager (full schema sent to model) and deferred
 * (one-liner in system prompt, loaded on demand via tool_search).
 *
 * Non-MCP tools are always eager. MCP tools (prefixed `mcp__`) are deferred
 * unless they appear in EAGER_TOOLS.
 */
export function partitionTools<T extends { description?: string }>(
  tools: Record<string, T>,
): { eager: Record<string, T>; deferred: DeferredToolEntry[] } {
  const eager: Record<string, T> = {};
  const deferred: DeferredToolEntry[] = [];

  for (const [name, tool] of Object.entries(tools)) {
    if (EAGER_TOOLS.has(name) || !name.startsWith("mcp__")) {
      eager[name] = tool;
    } else {
      const desc =
        (tool as any).description ||
        (tool as any).inputSchema?.description ||
        "MCP tool";
      const serverMatch = name.match(/^mcp__([^_]+(?:_[^_]+)*)__/);
      deferred.push({
        name,
        description: typeof desc === "string" ? desc.slice(0, 200) : "MCP tool",
        serverName: serverMatch?.[1],
      });
    }
  }

  return { eager, deferred };
}

// ---------------------------------------------------------------------------
// System prompt fragment
// ---------------------------------------------------------------------------

/**
 * Build a system prompt section listing deferred tools so the model knows
 * they exist and can request full schemas via tool_search.
 */
export function formatDeferredToolsForPrompt(
  deferred: DeferredToolEntry[],
): string {
  if (deferred.length === 0) return "";

  let prompt =
    "\n\n## Additional Tools (use tool_search to load)\n\n";
  prompt +=
    "The following tools are available but their full schemas are not loaded yet. ";
  prompt +=
    "To use one, call the `tool_search` tool with the tool name to load its full schema, then call it.\n\n";

  for (const t of deferred) {
    prompt += `- **${t.name}**${t.serverName ? ` (${t.serverName})` : ""}: ${t.description}\n`;
  }

  return prompt;
}
