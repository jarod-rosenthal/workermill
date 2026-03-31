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

export function shouldCompact(
  totalTokens: number,
  model: string,
  configuredContextLength?: number,
): CompactionThreshold {
  const limit = configuredContextLength || getContextLimit(model);
  let level: CompactionLevel = "none";
  if (totalTokens >= limit * 0.95) level = "hard";
  else if (totalTokens >= limit * 0.80) level = "soft";
  else if (totalTokens >= limit * 0.60) level = "micro";
  return { level, limit, usage: totalTokens };
}

type Message = { role: "user" | "assistant"; content: string };

/**
 * Trim verbose tool results from older messages to reclaim context without an API call.
 * Keeps the last `preserveRecent` messages untouched.
 * For older messages, truncates any content longer than `maxChars` to a summary line.
 */
export function microCompact(
  messages: Message[],
  preserveRecent: number = 6,
  maxChars: number = 2000,
): { messages: Message[]; charsSaved: number } {
  if (messages.length <= preserveRecent) {
    return { messages, charsSaved: 0 };
  }

  let charsSaved = 0;
  const cutoff = messages.length - preserveRecent;
  const result = messages.map((m, i) => {
    if (i >= cutoff) return m;
    if (m.content.length <= maxChars) return m;

    const originalLength = m.content.length;
    const trimmed = m.content.slice(0, 200) +
      `\n\n[... truncated ${originalLength} chars of tool output ...]`;
    charsSaved += originalLength - trimmed.length;
    return { role: m.role, content: trimmed };
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
    // If micro-compaction alone brought us below the soft threshold (80% of a
    // reasonable context window), we can skip the expensive LLM summarization.
    // Use 40000 tokens as a conservative "comfortable" threshold.
    if (estimatedTokens < 40000 && mode === "soft") {
      return microCompacted;
    }
  }
  const workingMessages = charsSaved > 0 ? microCompacted : messages;

  // Estimate total tokens (rough: 1 token ≈ 4 chars)
  const totalChars = workingMessages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  // If few messages but low token count, skip
  if (workingMessages.length <= 4 && estimatedTokens < 10000) return workingMessages;

  // For short conversations with high token count, summarize everything
  let toCompact: Message[];
  let toKeep: Message[];
  if (workingMessages.length <= 4) {
    // All messages are heavy — summarize everything
    toCompact = workingMessages;
    toKeep = [];
  } else {
    // Keep the last 2 exchanges (4 messages) always
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

  // Summarize the older messages
  const summaryText = toCompact
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  const systemPrompt = focusInstructions
    ? `Summarize this conversation history concisely. Focus especially on: ${focusInstructions}. Also preserve: what was discussed, what decisions were made, what files were modified, and what the current state of work is.`
    : "Summarize this conversation history concisely. Focus on: what was discussed, what decisions were made, what files were modified, and what the current state of work is. Be brief but preserve all important context.";

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: summaryText,
    });

    consecutiveFailures = 0;

    return [
      { role: "user" as const, content: "[Summarize the conversation so far]" },
      { role: "assistant" as const, content: `[Conversation summary]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    consecutiveFailures++;
    // If summarization fails, just keep recent messages
    return toKeep;
  }
}
