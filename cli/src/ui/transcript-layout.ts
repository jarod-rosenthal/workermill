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
 * - Compact messages (function/system logs) are always single-spaced.
 * - Normal assistant replies get top spacing only when they follow a user turn.
 */
export function getAssistantMarginTop(messages: Message[], index: number): number {
  const current = messages[index];
  if (!current || current.role !== "assistant") return 0;
  if (current.compact) return 0;
  const previous = index > 0 ? messages[index - 1] : null;
  return previous?.role === "user" ? 1 : 0;
}

/** Show a user-turn divider for every user message except the first one. */
export function shouldRenderUserDivider(index: number): boolean {
  return index > 0;
}
