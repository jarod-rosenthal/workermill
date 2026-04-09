import type { ToolSet } from "ai";
import fs from "fs";
import path from "path";
import { findModelInfo } from "../provider-registry.js";

/** Check if an error indicates a rate limit (HTTP 429) and extract the wait duration. */
export function isRateLimitError(err: unknown): { retryAfterMs: number } | null {
  if (!err || typeof err !== "object") return null;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  // Exclude billing/quota errors — those are handled by isBalanceOrQuotaError, not retryable
  if (/insufficient[_\s-]?quota|insufficient[_\s-]?credit|credit balance|billing|payment required|402|exceeded your current quota|quota.*exhausted|balance.*low|usage limit reached/i.test(lower)) {
    return null;
  }

  // Quick exit — not a rate limit
  const RATE_LIMIT_SIGNALS = ["429", "rate limit", "too many requests"];
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

  // 3. Fallback — wait 30 seconds
  return { retryAfterMs: 30_000 };
}

export function isBalanceOrQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /insufficient[_\s-]?quota|insufficient[_\s-]?credit|credit balance|billing|payment required|402|exceeded your current quota|quota.*exhausted|balance.*low|usage limit reached|tokens?.*(expired|exhausted)/i.test(
    message,
  );
}

export const MAX_RATE_LIMIT_RETRIES = 3;

/** Get context window for a model — from pricing registry or configured override.
 *  If unknown, defaults to 256K — no cloud model ships below that anymore. */
export function getModelContext(model: string, configuredCtx?: number): number {
  if (configuredCtx) return configuredCtx;
  const info = findModelInfo(model);
  return info?.contextWindow || 256_000;
}

/** Format context limit for display: 200000 → "200K", 65536 → "64K" */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1000)}K`;
  // Use /1024 for power-of-2 values (Ollama: 65536, 131072), /1000 for round values (200000)
  if (tokens >= 1000) {
    const k1024 = tokens / 1024;
    if (Number.isInteger(k1024)) return `${k1024}K`;
    return `${Math.round(tokens / 1000)}K`;
  }
  return `${tokens}`;
}

export function getReviewWallTimeoutMs(): number {
  const raw = Number(process.env.WM_REVIEW_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8 * 60 * 1000;
}

export function createTimedAbortSignal(
  baseSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
): {
  signal: AbortSignal;
  didTimeout: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(baseSignal?.reason);
  if (baseSignal) {
    if (baseSignal.aborted) {
      controller.abort(baseSignal.reason);
    } else {
      baseSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      if (baseSignal) baseSignal.removeEventListener("abort", onAbort);
    },
  };
}

export async function collectReviewStreamResult(
  reviewStream: {
    textStream: AsyncIterable<unknown>;
    text: PromiseLike<string>;
    totalUsage: PromiseLike<{ inputTokens?: number; outputTokens?: number } | undefined>;
  },
  timeoutMs: number,
  timedAbort: { didTimeout: () => boolean },
  label: string,
): Promise<{
  finalText: string;
  usage: { inputTokens?: number; outputTokens?: number } | undefined;
}> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });
  const consumePromise = (async () => {
    for await (const _chunk of reviewStream.textStream) { /* consumed */ }
    const [finalText, usage] = await Promise.all([
      reviewStream.text,
      reviewStream.totalUsage,
    ]);
    return { finalText: (finalText || "").trim(), usage };
  })();
  try {
    return await Promise.race([consumePromise, timeoutPromise]);
  } catch (err) {
    if (timedAbort.didTimeout()) {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** Bound large payloads before reinserting them into prompts. */
export function truncateForPrompt(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const clipped = text.slice(0, maxChars);
  return `${clipped}\n\n...[${label} truncated to ${maxChars} chars]`;
}

/** Stable signature used to detect repeated identical failures in retry loops. */
export function normalizeErrorSignature(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .replace(/[0-9a-f]{8,}/gi, "<id>")
    .replace(/\bline \d+\b/gi, "line <n>")
    .trim()
    .toLowerCase()
    .slice(0, 240);
}

/** Sleep helper for rate limit backoff */
export function rateLimitSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function clipLogText(text: string, maxChars = 1200): string {
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars)} ...[truncated ${text.length - maxChars} chars]` : text;
}

export function estimateToolSchemaTokens(tools: ToolSet): number {
  try {
    const payload = Object.entries(tools).map(([name, def]) => ({
      name,
      description: typeof def?.description === "string" ? def.description : "",
      inputSchema:
        (def as Record<string, unknown>)?.inputSchema ??
        (def as Record<string, unknown>)?.parameters ??
        null,
    }));
    return Math.round(JSON.stringify(payload).length / 4);
  } catch {
    return 0;
  }
}

export function parsePromptLengthError(err: unknown): { limitTokens: number; actualTokens: number } | null {
  const candidates = [
    err instanceof Error ? err.message : String(err || ""),
    typeof (err as { responseBody?: unknown })?.responseBody === "string"
      ? String((err as { responseBody?: unknown }).responseBody)
      : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const match = candidate.match(/maximum prompt length is (\d+)\D+request contains (\d+) tokens/i);
    if (match) {
      return {
        limitTokens: Number(match[1]),
        actualTokens: Number(match[2]),
      };
    }
  }

  return null;
}

export function extractExecErrorDetail(err: unknown): { summary: string; stdout: string; stderr: string } {
  const anyErr = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const message = typeof anyErr?.message === "string" ? anyErr.message : String(err);
  const stdout =
    typeof anyErr?.stdout === "string"
      ? anyErr.stdout
      : Buffer.isBuffer(anyErr?.stdout)
        ? anyErr.stdout.toString("utf-8")
        : "";
  const stderr =
    typeof anyErr?.stderr === "string"
      ? anyErr.stderr
      : Buffer.isBuffer(anyErr?.stderr)
        ? anyErr.stderr.toString("utf-8")
        : "";
  const firstUsefulLine =
    [...stderr.split("\n"), ...stdout.split("\n"), ...message.split("\n")]
      .map((line) => line.trim())
      .find(Boolean) || message;

  return { summary: firstUsefulLine, stdout, stderr };
}

/**
 * If the task string looks like a file path (e.g. "spec.md", "docs/prd.yaml"),
 * read the file and return its contents as the task. Otherwise return as-is.
 * This lets users do `/build spec.md` and have the planner see the full spec.
 */
export function resolveTaskInput(task: string, workingDir: string): string {
  const trimmed = task.trim();
  // Check if the entire task is a single file reference (no spaces, has extension)
  if (!trimmed.includes(" ") && /\.\w{1,10}$/.test(trimmed)) {
    const fullPath = path.resolve(workingDir, trimmed);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      return `Implement the following specification from ${trimmed}:\n\n${content}`;
    } catch {
      // Not a readable file — pass through as-is
    }
  }
  return task;
}

export function normalizeDeclaredFilePathLine(line: string): string {
  let cleaned = line.trim();
  if (!cleaned) return "";

  // Strip common markdown wrappers/prefixes from worker summaries.
  cleaned = cleaned.replace(/^[-*]\s+/, "");
  cleaned = cleaned.replace(/^`+|`+$/g, "");
  cleaned = cleaned.replace(/^\*+|\*+$/g, "");

  // Support markdown links: [label](path/to/file.ts)
  const mdLink = cleaned.match(/\]\(([^)]+)\)/);
  if (mdLink?.[1]) cleaned = mdLink[1].trim();

  // If prose follows the path on the same line, take the first token.
  cleaned = cleaned.split(/\s+/)[0] || "";

  // Remove trailing punctuation/formatting artifacts.
  cleaned = cleaned.replace(/[),.;:]+$/g, "").replace(/^\(+|\)+$/g, "");
  cleaned = cleaned.replace(/^`+|`+$/g, "").replace(/^\*+|\*+$/g, "");

  return cleaned;
}

export function looksLikeFilePath(value: string): boolean {
  if (!value) return false;
  if (value.includes("::")) return false;
  if (value.startsWith("```")) return false;
  // Typical repo-relative or absolute path patterns.
  return /[\\/]/.test(value) || /\.[a-z0-9]{1,12}$/i.test(value);
}

export function extractDeclaredFileMarkers(text: string, marker: "file_created" | "file_modified"): string[] {
  const regex = new RegExp(`::${marker}::([\\s\\S]*?)(?=::\\w+::|$)`, "g");
  const paths: string[] = [];
  for (const match of text.matchAll(regex)) {
    const payload = match[1] ?? "";
    const lines = payload
      .split(/\r?\n/)
      .map((line) => normalizeDeclaredFilePathLine(line))
      .filter(Boolean);
    const pathLine = lines.find(looksLikeFilePath);
    if (pathLine) paths.push(pathLine);
  }
  return paths;
}

/**
 * Check if an error is transient/retryable — from worker/epic/coordinator-utils.ts lines 45-66.
 */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const msg = error instanceof Error ? error.message : String(error);
  if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|network error|ECONNREFUSED/i.test(msg)) {
    return true;
  }
  return false;
}

/**
 * Classify an error to determine if it's auto-fixable and provide fix context.
 * Pattern from worker/epic/types.ts ErrorCategory + worker-decision-engine.ts.
 */
export function classifyError(errMsg: string): { category: string; fixable: boolean; fixHint: string } {
  if (/type\s?error|cannot find name|is not assignable|has no exported member|property .+ does not exist/i.test(errMsg)) {
    return { category: "typescript", fixable: true, fixHint: "Fix the TypeScript type errors shown above. Run `npx tsc --noEmit` to verify." };
  }
  if (/eslint|lint|prettier|formatting/i.test(errMsg)) {
    return { category: "lint", fixable: true, fixHint: "Fix the linting/formatting errors shown above. Run `npm run lint` to verify." };
  }
  if (/test.*fail|assertion.*error|expect\(.*\)\.to|FAIL\s+src\//i.test(errMsg)) {
    return { category: "test", fixable: true, fixHint: "Fix the failing tests shown above. Run the test command to verify." };
  }
  if (/build.*fail|compilation.*error|syntax\s?error|unexpected token|cannot find module/i.test(errMsg)) {
    return { category: "build", fixable: true, fixHint: "Fix the build/compilation errors shown above." };
  }
  if (/status code (502|503|504)|socket hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(errMsg)) {
    return { category: "transient", fixable: false, fixHint: "" };
  }
  if (isBalanceOrQuotaError(errMsg)) {
    return { category: "billing", fixable: false, fixHint: "" };
  }
  if (/auth|unauthorized|forbidden|401|403|api.?key/i.test(errMsg)) {
    return { category: "auth", fixable: false, fixHint: "" };
  }
  if (/rate.?limit|too many requests|429/i.test(errMsg)) {
    return { category: "rate_limit", fixable: false, fixHint: "" };
  }
  return { category: "unknown", fixable: false, fixHint: "" };
}

export function parseMarkerValue(text: string, marker: string): string | undefined {
  const match = text.match(new RegExp(`${marker}:\\s*([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`, "i"));
  return match ? match[1].trim() : undefined;
}

export function isAbortSignalLike(value: unknown): value is AbortSignal {
  if (!value || typeof value !== "object") return false;
  const signal = value as { aborted?: unknown; addEventListener?: unknown; removeEventListener?: unknown };
  return typeof signal.aborted === "boolean"
    && typeof signal.addEventListener === "function"
    && typeof signal.removeEventListener === "function";
}

export function isAbortControllerLike(value: unknown): value is AbortController {
  if (!value || typeof value !== "object") return false;
  const controller = value as { abort?: unknown; signal?: unknown };
  return typeof controller.abort === "function" && isAbortSignalLike(controller.signal);
}

/** Build provider-specific reasoning/thinking options for streamText. */
export function buildReasoningOptions(provider: string, modelName: string): Record<string, unknown> {
  switch (provider) {
    case "openai":
      return { providerOptions: { openai: { reasoningSummary: "detailed" } } };
    case "google":
    case "gemini":
      if (modelName && modelName.includes("gemini-3")) {
        return { providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } } };
      }
      return { providerOptions: { google: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } } } };
    default:
      return {};
  }
}

/** Emit incremental reasoning text deltas line-by-line. */
export function emitReasoningDelta(
  emit: (line: string) => void,
  reasoningText: string | undefined,
  lastLengthRef: { value: number },
): void {
  if (!reasoningText || reasoningText.length <= lastLengthRef.value) return;
  const delta = reasoningText.slice(lastLengthRef.value).trim();
  lastLengthRef.value = reasoningText.length;
  if (!delta) return;
  const lines = delta.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    emit(line);
  }
}

/** Format a tool call for display — short and to the point. */
export function extractToolFilePath(toolName: string, toolInput: Record<string, unknown>): string {
  const direct = typeof toolInput.file_path === "string"
    ? toolInput.file_path
    : typeof toolInput.path === "string"
      ? toolInput.path
      : "";
  if (direct) return direct;

  // patch tool can target files without explicit file_path/path
  if (toolName === "patch" && typeof toolInput.patch_text === "string") {
    const patchText = toolInput.patch_text;
    const patchHeader = patchText.match(/^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/m);
    if (patchHeader?.[1]) return patchHeader[1].trim();
    const diffHeader = patchText.match(/^\+\+\+\s+(?:[ab]\/)?(.+)$/m);
    if (diffHeader?.[1] && diffHeader[1] !== "/dev/null") return diffHeader[1].trim();
  }

  return "";
}
