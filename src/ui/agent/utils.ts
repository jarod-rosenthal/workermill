/**
 * Non-React utility functions and constants extracted from useAgent.ts.
 */

import path from "path";
import * as logger from "../../logger.js";
import type { ToolCallInfo } from "../types.js";
import { splitCompoundCommand, toolInputToRule } from "../../safety.js";

/** Persist command-family approval without widening it to every shell command. */
export function durablePermissionRules(toolName: string, input: Record<string, unknown>): string[] {
  if (["bash", "verify", "bash_background"].includes(toolName)) {
    if (typeof input.command !== "string") return [];
    return splitCompoundCommand(input.command).flatMap((command) => {
      const rule = toolInputToRule("bash", { command });
      return rule ? [toolName + rule.slice("bash".length)] : [];
    });
  }
  const rule = toolInputToRule(toolName, input);
  return rule ? [rule] : [];
}

// ---------------------------------------------------------------------------
// Debug / trace
// ---------------------------------------------------------------------------

export const TRACE_DISPATCH = process.env.WM_TRACE_DISPATCH === "1";
export const ENABLE_STEP_STREAMING_TEXT = process.env.WM_ENABLE_STEP_STREAMING_TEXT === "1";

export function traceDispatch(message: string, data?: Record<string, unknown>): void {
  if (!TRACE_DISPATCH) return;
  logger.info(`[dispatch] ${message}`, data);
}

// ---------------------------------------------------------------------------
// Loop detection
// ---------------------------------------------------------------------------

/** Tool call loop detection -- matches orchestrator pattern */
export const LOOP_WINDOW = 6;
export const LOOP_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Rate limit / streaming constants
// ---------------------------------------------------------------------------

export const MAX_RATE_LIMIT_RETRIES = 3;
export const LONG_RESPONSE_RECEIPT_MIN_CHARS = 600;
export const TOOL_COUNT_FLUSH_MS = 750;

/** Check if an error indicates a rate limit (HTTP 429) and extract the wait duration. */
export function isRateLimitError(err: unknown): { retryAfterMs: number } | null {
  if (!err || typeof err !== "object") return null;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Quick exit -- not a rate limit
  const RATE_LIMIT_SIGNALS = ["429", "rate limit", "too many requests", "quota exceeded"];
  if (!RATE_LIMIT_SIGNALS.some(signal => lower.includes(signal))) return null;

  // 1. Parse "retry after N" from the error message body
  const inlineSeconds = lower.match(/retry[\s\-_.]?after[:\s]+(\d+)/)?.[1];
  if (inlineSeconds) return { retryAfterMs: Number(inlineSeconds) * 1000 };

  // 2. Read the Retry-After HTTP header if the error exposes it
  const headers = (err as Record<string, unknown>).headers ?? (err as Record<string, unknown>).responseHeaders;
  if (headers && typeof headers === "object") {
    const raw = (headers as Record<string, string>)["retry-after"];
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) return { retryAfterMs: parsed * 1000 };
  }

  // 3. Fallback -- wait 30 seconds
  return { retryAfterMs: 30_000 };
}

// ---------------------------------------------------------------------------
// Pseudo tool call parsing
// ---------------------------------------------------------------------------

export type ParsedPseudoToolCall = {
  name: string;
  input: Record<string, unknown>;
};

export function parsePseudoToolCalls(text: string): ParsedPseudoToolCall[] {
  if (!text.includes("<function=")) return [];

  const calls: ParsedPseudoToolCall[] = [];
  const fnRe = /<function=([a-zA-Z0-9_:-]+)>\s*([\s\S]*?)\s*<\/function>/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRe.exec(text)) !== null) {
    const name = fnMatch[1]?.trim();
    const body = fnMatch[2] || "";
    if (!name) continue;

    const input: Record<string, unknown> = {};
    const paramRe = /<parameter=([a-zA-Z0-9_:-]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      const key = paramMatch[1]?.trim();
      const rawValue = (paramMatch[2] || "").trim();
      if (!key) continue;
      if (!rawValue) {
        input[key] = "";
        continue;
      }
      if ((rawValue.startsWith("{") && rawValue.endsWith("}")) || (rawValue.startsWith("[") && rawValue.endsWith("]"))) {
        try {
          input[key] = JSON.parse(rawValue);
          continue;
        } catch {
          // fall through to string
        }
      }
      input[key] = rawValue;
    }

    if (Object.keys(input).length > 0) calls.push({ name, input });
  }

  return calls;
}

export function stripPseudoToolCallMarkup(text: string): string {
  return text
    .replace(/<function=[a-zA-Z0-9_:-]+>[\s\S]*?<\/function>\s*(?:<\/tool_call>)?/g, "")
    .replace(/<\/tool_call>/g, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Permission modes
// ---------------------------------------------------------------------------

/** Modes in the shift+tab cycle. */
export const PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
/** All valid permission modes including CLI-only modes not in the cycle. */
export type PermissionMode = typeof PERMISSION_MODES[number] | "dontAsk";

// ---------------------------------------------------------------------------
// API key helpers
// ---------------------------------------------------------------------------

import { getApiKeyEnvVar } from "../../provider-capabilities.js";

export function resolveApiKey(apiKey?: string): string | undefined {
  if (!apiKey) return undefined;
  return apiKey.startsWith("{env:")
    ? process.env[apiKey.slice(5, -1)] || undefined
    : apiKey;
}

export function setProviderApiKeyEnv(provider: string, apiKey?: string): string | undefined {
  const resolvedKey = resolveApiKey(apiKey);
  if (!resolvedKey) return undefined;

  const envVar = getApiKeyEnvVar(provider) || "OPENAI_API_KEY";
  if (envVar) {
    process.env[envVar] = resolvedKey;
  }
  return resolvedKey;
}

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

/**
 * Records partial token usage to the cost tracker when a run is aborted mid-stream.
 * Called in the AbortError catch path so tokens consumed before ESC are not lost.
 * No-op when both counts are zero (i.e. abort happened before any tokens were billed).
 */
export function trackAbortCost(
  partialInputTokens: number,
  partialOutputTokens: number,
  persona: string,
  provider: string,
  model: string,
  costTracker: { addUsage: (p: string, pr: string, m: string, i: number, o: number) => void; getTotalCost: () => number },
  setCost: (cost: number) => void,
): void {
  if (partialInputTokens > 0 || partialOutputTokens > 0) {
    costTracker.addUsage(persona, provider, model, partialInputTokens, partialOutputTokens);
    setCost(costTracker.getTotalCost());
  }
}

// ---------------------------------------------------------------------------
// Live view helpers
// ---------------------------------------------------------------------------

export function normalizeLiveViewPath(filePath: string, workingDir: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed || trimmed === "/dev/null") return null;
  const withoutPrefix = trimmed.replace(/^[ab]\//, "");
  if (!withoutPrefix) return null;
  const unixPath = withoutPrefix.replaceAll("\\", "/");
  if (!path.isAbsolute(unixPath)) return unixPath;
  const rel = path.relative(workingDir, unixPath).replaceAll("\\", "/");
  if (!rel || rel.startsWith("../") || rel === "..") return null;
  return rel;
}

export function parsePatchTargets(patchText: string, workingDir: string): Array<{ filePath: string; tool: "created" | "edited" }> {
  const rows = patchText.replace(/\r\n/g, "\n").split("\n");
  const targets: Array<{ filePath: string; tool: "created" | "edited" }> = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].startsWith("--- ")) continue;
    const oldRaw = rows[i].replace(/^---\s+/, "").trim().replace(/^[ab]\//, "");
    const plus = rows[i + 1];
    if (!plus || !plus.startsWith("+++ ")) continue;
    const newRaw = plus.replace(/^\+\+\+\s+/, "").trim().replace(/^[ab]\//, "");

    const isCreated = oldRaw === "/dev/null" && newRaw !== "/dev/null";
    const candidate = isCreated ? newRaw : (newRaw === "/dev/null" ? oldRaw : newRaw);
    const normalized = normalizeLiveViewPath(candidate, workingDir);
    if (!normalized) continue;
    targets.push({ filePath: normalized, tool: isCreated ? "created" : "edited" });
  }
  return targets;
}

/**
 * Derive per-file live-view events from a tool call payload.
 * This is especially important for `patch`, which often edits multiple files
 * while not providing `path` in the tool input.
 */
export function getLiveViewChangeTargets(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
  workingDir: string,
): Array<{ filePath: string; tool: "created" | "edited" }> {
  const byPath = new Map<string, "created" | "edited">();
  const add = (rawPath: unknown, tool: "created" | "edited") => {
    if (typeof rawPath !== "string") return;
    const normalized = normalizeLiveViewPath(rawPath, workingDir);
    if (!normalized) return;
    const existing = byPath.get(normalized);
    byPath.set(normalized, existing === "created" ? "created" : tool);
  };

  if (toolName === "write_file") {
    add(input.path ?? input.file_path, "created");
  } else if (toolName === "edit_file") {
    add(input.path ?? input.file_path, "edited");
  } else if (toolName === "multi_edit_file") {
    add(input.file_path, "edited");
  } else if (toolName === "patch") {
    const obj = result && typeof result === "object" ? (result as Record<string, unknown>) : null;
    const addArray = (arr: unknown, tool: "created" | "edited") => {
      if (!Array.isArray(arr)) return;
      for (const p of arr) add(p, tool);
    };
    addArray(obj?.filesCreated, "created");
    addArray(obj?.filesModified, "edited");
    addArray(obj?.filesDeleted, "edited");

    const patchText = typeof input.patch_text === "string" ? input.patch_text : "";
    for (const target of parsePatchTargets(patchText, workingDir)) {
      add(target.filePath, target.tool);
    }

    // Safety fallback for atypical patch wrappers.
    add(input.path ?? input.file_path, "edited");
  }

  return [...byPath.entries()].map(([filePath, tool]) => ({ filePath, tool }));
}

// ---------------------------------------------------------------------------
// Image hallucination guard
// ---------------------------------------------------------------------------

/**
 * Safety guard against image hallucinations:
 * block visual claims when no image input/tool evidence exists for the turn.
 */
export function shouldBlockUnverifiedImageAnswer(
  userInput: string,
  assistantOutput: string,
  opts: { turnHadInlineImages: boolean; toolCalls: ToolCallInfo[] },
): boolean {
  if (!assistantOutput.trim()) return false;

  const userLooksImageRelated =
    /\b(image|screenshot|picture|photo|png|jpe?g|gif|webp|bmp)\b/i.test(userInput) ||
    /\/mnt\/[^\s]+\.(png|jpe?g|gif|webp|bmp)\b/i.test(userInput) ||
    /[A-Za-z]:\\[^\n]+\.(png|jpe?g|gif|webp|bmp)\b/i.test(userInput);

  if (!userLooksImageRelated) return false;

  const hasImageEvidence =
    opts.turnHadInlineImages ||
    opts.toolCalls.some((c) => c.name === "view_image" || c.name === "browser_screenshot");

  if (hasImageEvidence) return false;

  const explicitlyCannotSee =
    /\b(i can(?:not|'t)\s+(?:see|view|inspect)|no vision|without vision|text[- ]based|can't access image)\b/i.test(
      assistantOutput,
    );
  if (explicitlyCannotSee) return false;

  const makesVisualClaims =
    /\b(i can see|the image|the screenshot|looks like|appears to|visible|shown in|depicts)\b/i.test(
      assistantOutput,
    );

  return makesVisualClaims;
}
