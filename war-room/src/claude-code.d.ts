/**
 * Type declarations for @anthropic-ai/claude-code
 *
 * Type declarations for the Claude Agent SDK.
 * Supports tool execution (Read, Write, Edit, Bash, Glob, Grep).
 */

declare module "@anthropic-ai/claude-code" {
  export interface QueryOptions {
    prompt: string;
    systemPrompt?: string;
    allowedTools?: string[];
    cwd?: string;
    model?: string;
    abortController?: AbortController;
  }

  export interface ContentBlock {
    type: "text" | "tool_use" | "tool_result";
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
  }

  export interface Message {
    role: "user" | "assistant";
    content: ContentBlock[];
  }

  export interface QueryResult {
    messages?: Message[];
    output?: string;
    error?: string;
  }

  /**
   * Execute an agent query with tool execution support.
   * The agent can use Read, Write, Edit, Bash, Glob, Grep tools.
   */
  export function query(options: QueryOptions): Promise<QueryResult>;
}
