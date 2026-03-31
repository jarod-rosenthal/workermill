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
  mode: "soft" | "hard",
  focusInstructions?: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (messages.length === 0) return messages;

  // Estimate total tokens (rough: 1 token ≈ 4 chars)
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  // If few messages but high token count, summarize ALL of them
  if (messages.length <= 4 && estimatedTokens < 10000) return messages;

  // For short conversations with high token count, summarize everything
  let toCompact: typeof messages;
  let toKeep: typeof messages;
  if (messages.length <= 4) {
    // All messages are heavy — summarize everything
    toCompact = messages;
    toKeep = [];
  } else {
    // Keep the last 2 exchanges (4 messages) always
    const keepCount = mode === "hard" ? 2 : 4;
    toCompact = messages.slice(0, -keepCount);
    toKeep = messages.slice(-keepCount);
  }

  if (toCompact.length === 0) return messages;

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

    return [
      { role: "user" as const, content: "[Summarize the conversation so far]" },
      { role: "assistant" as const, content: `[Conversation summary]\n${result.text}` },
      ...toKeep,
    ];
  } catch {
    // If summarization fails, just keep recent messages
    return toKeep;
  }
}
