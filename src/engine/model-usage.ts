import type { TokenUsage } from "../providers/types.js";

/** Normalizes the usage shapes emitted by the AI SDK's provider transports. */
export function usageFromSdk(usage: unknown): Partial<TokenUsage> | undefined {
  const record = usage as {
    promptTokens?: number; inputTokens?: number; completionTokens?: number; outputTokens?: number;
    inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number };
  } | undefined;
  if (!record) return undefined;
  const inputTokens = record.inputTokens ?? record.promptTokens;
  const outputTokens = record.outputTokens ?? record.completionTokens;
  const cacheReadTokens = record.inputTokenDetails?.cacheReadTokens;
  const cacheCreationTokens = record.inputTokenDetails?.cacheWriteTokens;
  if (inputTokens === undefined && outputTokens === undefined && cacheReadTokens === undefined && cacheCreationTokens === undefined) return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheCreationTokens === undefined ? {} : { cacheCreationTokens }),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
  };
}

/** Adds step observations without converting absent SDK fields into reported zeroes. */
export function addUsage(
  previous: Partial<TokenUsage> | undefined,
  next: Partial<TokenUsage> | undefined,
): Partial<TokenUsage> | undefined {
  if (!previous) return next && { ...next };
  if (!next) return { ...previous };
  const sum = (field: keyof TokenUsage): number | undefined =>
    previous[field] === undefined && next[field] === undefined ? undefined : (previous[field] ?? 0) + (next[field] ?? 0);
  return {
    ...(sum("inputTokens") === undefined ? {} : { inputTokens: sum("inputTokens") }),
    ...(sum("outputTokens") === undefined ? {} : { outputTokens: sum("outputTokens") }),
    ...(sum("cacheCreationTokens") === undefined ? {} : { cacheCreationTokens: sum("cacheCreationTokens") }),
    ...(sum("cacheReadTokens") === undefined ? {} : { cacheReadTokens: sum("cacheReadTokens") }),
  };
}
