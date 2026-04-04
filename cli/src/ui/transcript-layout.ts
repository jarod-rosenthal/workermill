import type { Message } from "./types.js";

/**
 * Normalize assistant content before markdown rendering.
 * Keeps intentional internal spacing but strips trailing blank lines that
 * commonly appear in streamed/system output.
 */
export function normalizeAssistantContent(content: string): string {
  return content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
}

/**
 * Normalize user content for transcript display.
 * Keeps authored structure, but fixes a common terminal artifact where wrapped
 * prose is persisted with an accidental blank/indented continuation line.
 */
export function normalizeUserContent(content: string): string {
  const unix = content.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n");

  // Hard guard: if we detect suspicious prose wrapping artifacts
  // (mid-word splits, punctuation orphaning, lowercase paragraph break),
  // reflow to a single line so user input is never shown as "chopped up".
  const hasMidWordSplit = /[A-Za-z]\n[A-Za-z]/.test(unix);
  const hasOrphanPunctuation = /\n\s*[,.;:!?]/.test(unix);
  const hasLowercaseParagraphBreak = /\n\s*\n\s*[a-z]/.test(unix);
  const hasIndentedLowerContinuation = /[a-z0-9]\n[ \t]+[a-z]/.test(unix);
  const hasLowercaseHardWrap = /[^\n.!?:]\n\s*[a-z]/.test(unix);
  const lines = unix.split("\n");
  const hasStructuredMultiline = lines.some((line) =>
    /^\s*([-*]|\d+\.)\s+/.test(line) || line.includes("```")
  );

  const hasSuspiciousWrap =
    hasMidWordSplit ||
    hasOrphanPunctuation ||
    hasLowercaseParagraphBreak ||
    hasIndentedLowerContinuation ||
    hasLowercaseHardWrap;
  if (hasSuspiciousWrap && !hasStructuredMultiline) {
    const healedWords = unix
      .replace(/([A-Za-z])\n([A-Za-z])/g, "$1$2")
      .replace(/\n\s*([,.;:!?])/g, "$1");
    return healedWords
      .replace(/\s*\n\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return unix
    // "low\n\nhanging" -> "low\nhanging" (lowercase prose continuation)
    .replace(/([a-z0-9])\n\s*\n\s*([a-z])/g, "$1\n$2")
    // "low\n  hanging" -> "low\nhanging" (indented continuation artifact)
    .replace(/([a-z0-9])\n[ \t]+([a-z])/g, "$1\n$2");
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
