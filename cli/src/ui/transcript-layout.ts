import type { Message } from "./types.js";

/**
 * Normalize assistant content before markdown rendering.
 * Keeps intentional internal spacing but strips trailing blank lines that
 * commonly appear in streamed/system output.
 */
export function normalizeAssistantContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\n+$/g, "");
}

/**
 * Vertical spacing contract:
 * - Always add one blank line between a user turn and the first assistant output.
 * - Compact assistant logs remain single-spaced with each other.
 * - Hidden assistant placeholders (empty content) do not affect spacing decisions.
 */
export function getAssistantMarginTop(messages: Message[], index: number): number {
  const current = messages[index];
  if (!current || current.role !== "assistant") return 0;

  // Find the previous visible message (App hides empty assistant placeholders).
  let previousVisible: Message | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate.role === "assistant" && !candidate.content.trim()) continue;
    previousVisible = candidate;
    break;
  }

  // Guarantee separation between user input and any assistant output.
  if (previousVisible?.role === "user") return 1;

  // Otherwise keep compact logs tight.
  if (current.compact) return 0;
  return 0;
}

/** Show a user-turn divider for every user message except the first one. */
export function shouldRenderUserDivider(index: number): boolean {
  return index > 0;
}
