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

export function shouldCompact(totalTokens: number, model: string, configuredContextLength?: number): "none" | "soft" | "hard" {
  const limit = configuredContextLength || getContextLimit(model);
  if (totalTokens >= limit * 0.95) return "hard";
  if (totalTokens >= limit * 0.80) return "soft";
  return "none";
}

export async function compactMessages(
  model: LanguageModel,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  mode: "soft" | "hard"
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (messages.length <= 4) return messages; // Nothing to compact

  // Keep the last 2 exchanges (4 messages) always
  const keepCount = mode === "hard" ? 2 : 4;
  const toCompact = messages.slice(0, -keepCount);
  const toKeep = messages.slice(-keepCount);

  if (toCompact.length === 0) return messages;

  // Summarize the older messages
  const summaryText = toCompact
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join("\n\n");

  try {
    const result = await generateText({
      model,
      system: "Summarize this conversation history concisely. Focus on: what was discussed, what decisions were made, what files were modified, and what the current state of work is. Be brief but preserve all important context.",
      prompt: summaryText,
    });

    return [
      { role: "assistant" as const, content: `[Conversation summary]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    // If summarization fails, just keep recent messages
    return toKeep;
  }
}
