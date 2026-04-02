import { generateText } from "ai";
import type { LanguageModel } from "ai";

// Context limits by model family (tokens)
const CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic (Claude 4.5/4.6)
  "claude-opus": 200000,
  "claude-sonnet": 200000,
  "claude-haiku": 200000,
  // OpenAI (GPT-5.x)
  "gpt-5.4": 400000,
  "gpt-5.3": 400000,
  "gpt-5.2": 200000,
  "gpt-5.4-mini": 200000,
  // Google (Gemini 3.x)
  "gemini-3.1": 1000000,
  "gemini-3.0": 1000000,
  "gemini-2.5": 1000000,
  // Ollama — uses configured contextLength, this is just fallback
  "default": 65536,
};

export function getContextLimit(model: string): number {
  for (const [prefix, limit] of Object.entries(CONTEXT_LIMITS)) {
    if (model.includes(prefix)) return limit;
  }
  return CONTEXT_LIMITS["default"];
}

export type CompactionLevel = "none" | "micro" | "soft" | "hard";

export interface CompactionThreshold {
  level: CompactionLevel;
  limit: number;
  usage: number;
}

/**
 * Estimate the actual context size from message content.
 * The AI SDK's totalUsage.inputTokens is summed across ALL steps in a multi-step
 * tool-calling turn, which inflates the number (e.g. 5 steps × 20K = 100K reported,
 * but actual context is only ~25K). This function provides a grounded estimate.
 */
export function estimateContextTokens(
  messages: Array<{ content: string }>,
  systemPromptChars?: number,
): number {
  let totalChars = systemPromptChars ?? 0;
  for (const m of messages) {
    totalChars += m.content.length;
  }
  // ~4 chars per token is the standard rough estimate
  return Math.round(totalChars / 4);
}

export function shouldCompact(
  totalTokens: number,
  model: string,
  configuredContextLength?: number,
): CompactionThreshold {
  const limit = configuredContextLength || getContextLimit(model);
  let level: CompactionLevel = "none";
  // Thresholds aligned with industry standard (Claude Code uses similar):
  // - 50%: micro-compaction (free, no API call — trim tool output aggressively)
  // - 70%: soft compaction (LLM summarization of older messages)
  // - 90%: hard compaction (aggressive summarization, keep only last 2 messages)
  if (totalTokens >= limit * 0.90) level = "hard";
  else if (totalTokens >= limit * 0.70) level = "soft";
  else if (totalTokens >= limit * 0.50) level = "micro";
  return { level, limit, usage: totalTokens };
}

type Message = { role: "user" | "assistant"; content: string };

// Patterns that identify tool output blocks (file contents, command output, etc.)
// Note: avoid [\s\S]+? with trailing literals — can cause catastrophic backtracking.
// Use [^`] or bounded quantifiers instead.
const TOOL_OUTPUT_PATTERNS = [
  // Code blocks with file paths (from read_file, grep, etc.)
  /```[\w]*\n\/\/[^\n]+\n(?:[^`]|`(?!``))*```/g,
  // Large JSON or XML blocks (>500 chars inside)
  /```(?:json|xml)\n(?:[^`]|`(?!``)){500,}?```/g,
  // Command output blocks (from bash tool)
  /```\n\$[^\n]+\n(?:[^`]|`(?!``))*```/g,
  // File listing output (10+ lines of tree-like output)
  /(?:^|\n)(?:\s*[-│├└].*\n){10,}/g,
  // Stack traces (5+ "at" frames)
  /(?:at\s+\S+\s+\([^)]+\)\n?){5,}/g,
  // Log output (5+ timestamped lines)
  /(?:\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}[^\n]*\n){5,}/g,
];

/**
 * Compress a single message's content by collapsing tool output blocks.
 * Returns the compressed content and chars saved.
 */
function compressToolOutput(content: string, aggressive: boolean): { content: string; saved: number } {
  let result = content;
  let saved = 0;
  const maxBlockSize = aggressive ? 200 : 500;

  for (const pattern of TOOL_OUTPUT_PATTERNS) {
    // Reset regex state for each use
    const regex = new RegExp(pattern.source, pattern.flags);
    result = result.replace(regex, (match) => {
      if (match.length <= maxBlockSize) return match;
      const firstLine = match.split("\n")[0];
      const lineCount = match.split("\n").length;
      const replacement = `${firstLine}\n[... ${lineCount} lines, ${match.length} chars truncated ...]`;
      saved += match.length - replacement.length;
      return replacement;
    });
  }

  // Catch any remaining large blocks: if content is still long, truncate long
  // contiguous non-blank sections (likely raw output not caught by patterns)
  if (aggressive && result.length > 1000) {
    const sections = result.split(/\n{2,}/);
    const compressed = sections.map(section => {
      if (section.length > 500) {
        const truncated = section.slice(0, 200) + `\n[... ${section.length} chars truncated ...]`;
        saved += section.length - truncated.length;
        return truncated;
      }
      return section;
    });
    result = compressed.join("\n\n");
  }

  return { content: result, saved };
}

/**
 * Trim verbose tool results from older messages to reclaim context without an API call.
 *
 * Strategy (matches industry standard):
 * - Recent messages (last 4) are untouched — the model needs full context for current work
 * - Middle messages (4-10 from end) get tool output compressed but prose preserved
 * - Old messages (>10 from end) get aggressively compressed — only key decisions/actions kept
 */
export function microCompact(
  messages: Message[],
  preserveRecent: number = 4,
): { messages: Message[]; charsSaved: number } {
  if (messages.length <= preserveRecent) {
    return { messages, charsSaved: 0 };
  }

  let charsSaved = 0;
  const middleCutoff = messages.length - preserveRecent;
  const oldCutoff = Math.max(0, messages.length - 10);

  const result = messages.map((m, i) => {
    // Recent messages — keep as-is
    if (i >= middleCutoff) return m;

    // Skip short messages — nothing to compress
    if (m.content.length <= 300) return m;

    // Old messages — aggressive compression
    if (i < oldCutoff) {
      const { content: compressed, saved } = compressToolOutput(m.content, true);
      if (saved > 0) {
        charsSaved += saved;
        return { role: m.role, content: compressed };
      }
      // If no tool patterns matched but still long, do a simple truncate
      if (m.content.length > 800) {
        const truncated = m.content.slice(0, 300) +
          `\n\n[... ${m.content.length} chars of earlier output truncated ...]`;
        charsSaved += m.content.length - truncated.length;
        return { role: m.role, content: truncated };
      }
      return m;
    }

    // Middle messages — moderate compression (tool output first, then size-based)
    const { content: compressed, saved } = compressToolOutput(m.content, false);
    if (saved > 0) {
      charsSaved += saved;
      return { role: m.role, content: compressed };
    }
    // Fallback: if still large after pattern matching, truncate preserving head
    if (m.content.length > 2000) {
      const truncated = m.content.slice(0, 500) +
        `\n\n[... ${m.content.length} chars of earlier output truncated ...]`;
      charsSaved += m.content.length - truncated.length;
      return { role: m.role, content: truncated };
    }
    return m;
  });

  return { messages: result, charsSaved };
}

/**
 * Extract memory markers from messages about to be compacted away.
 * Returns extracted markers so the caller can persist them before they're lost.
 */
export function extractMemoriesBeforeCompact(messages: Message[]): string[] {
  const markers: string[] = [];
  const pattern = /::(?:learning|remember)::(.+)/g;

  for (const m of messages) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(m.content)) !== null) {
      markers.push(match[1].trim());
    }
  }

  return markers;
}

// Circuit breaker state
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/** Reset compaction circuit breaker state (for testing). */
export function resetCompactionState(): void {
  consecutiveFailures = 0;
}

/**
 * Prepare a message for summarization — compress tool output but preserve
 * the user's intent and the assistant's decisions/actions.
 */
function prepareForSummarization(m: Message, maxChars: number): string {
  const prefix = m.role === "user" ? "USER" : "ASSISTANT";

  // Short messages go through as-is
  if (m.content.length <= maxChars) {
    return `${prefix}: ${m.content}`;
  }

  // For long messages, compress tool output but keep prose
  const { content: compressed } = compressToolOutput(m.content, true);
  if (compressed.length <= maxChars) {
    return `${prefix}: ${compressed}`;
  }

  // Still too long — keep the first part (usually the intent/decision) and
  // the last part (usually the conclusion/result)
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = Math.floor(maxChars * 0.3);
  return `${prefix}: ${compressed.slice(0, headSize)}\n[...middle truncated...]\n${compressed.slice(-tailSize)}`;
}

export async function compactMessages(
  model: LanguageModel,
  messages: Message[],
  mode: "soft" | "hard",
  focusInstructions?: string,
): Promise<Message[]> {
  if (messages.length === 0) return messages;

  // --- Micro-compaction pre-pass (free, no API call) ---
  const { messages: microCompacted, charsSaved } = microCompact(messages);
  if (charsSaved > 0) {
    // Re-estimate tokens after micro-compaction
    const totalChars = microCompacted.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = Math.round(totalChars / 4);
    // If micro-compaction alone brought us below a comfortable threshold,
    // skip the expensive LLM summarization
    if (estimatedTokens < 30000 && mode === "soft") {
      return microCompacted;
    }
  }
  const workingMessages = charsSaved > 0 ? microCompacted : messages;

  // Estimate total tokens (rough: 1 token ≈ 4 chars)
  const totalChars = workingMessages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  // If few messages but low token count, skip
  if (workingMessages.length <= 4 && estimatedTokens < 10000) return workingMessages;

  // Keep recent messages untouched — the model needs them for continuity.
  // Hard mode keeps fewer to reclaim more space.
  let toCompact: Message[];
  let toKeep: Message[];
  if (workingMessages.length <= 4) {
    toCompact = workingMessages;
    toKeep = [];
  } else {
    const keepCount = mode === "hard" ? 2 : 4;
    toCompact = workingMessages.slice(0, -keepCount);
    toKeep = workingMessages.slice(-keepCount);
  }

  if (toCompact.length === 0) return workingMessages;

  // --- Circuit breaker ---
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    console.warn(
      `[compaction] Circuit breaker open: ${consecutiveFailures} consecutive failures. Returning recent messages only.`,
    );
    return toKeep;
  }

  // Prepare messages for the summarizer — give it enough context to produce
  // a useful summary. Each message gets up to 2000 chars (after tool output
  // compression), not the old 500-char truncation that lost critical details.
  const maxPerMessage = mode === "hard" ? 1500 : 2000;
  const summaryText = toCompact
    .map(m => prepareForSummarization(m, maxPerMessage))
    .join("\n\n---\n\n");

  const systemPrompt = focusInstructions
    ? `Summarize this conversation history into a concise context block. Focus especially on: ${focusInstructions}.

Preserve:
- What the user asked for and key decisions made
- Which files were read, created, or modified (file paths matter)
- Any errors encountered and how they were resolved
- Current state of work (what's done, what's pending)

Do NOT preserve raw file contents, command output, or tool results — just note what was done and the outcome. Be concise but complete.`
    : `Summarize this conversation history into a concise context block.

Preserve:
- What the user asked for and key decisions made
- Which files were read, created, or modified (file paths matter)
- Any errors encountered and how they were resolved
- Current state of work (what's done, what's pending)

Do NOT preserve raw file contents, command output, or tool results — just note what was done and the outcome. Be concise but complete.`;

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: summaryText,
    });

    consecutiveFailures = 0;

    return [
      { role: "user" as const, content: "[Conversation context — summarized from earlier messages]" },
      { role: "assistant" as const, content: `[Summary of previous conversation]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    consecutiveFailures++;
    // If summarization fails, just keep recent messages
    return toKeep;
  }
}
