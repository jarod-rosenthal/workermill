/**
 * Spec Validation Gate
 *
 * Pre-decomposition validation that checks specs for dependency incompatibilities,
 * content quality issues, and offers LLM-powered repair.
 *
 * Uses LLMBackend for provider-agnostic LLM calls (Anthropic, OpenAI, Google, Ollama, etc.).
 */

import { createPatch } from "diff";
import type { LLMBackend } from "./llm-backend.js";
import { logger } from "../utils/logger.js";

// ============================================================================
// TYPES
// ============================================================================

export type WarningCategory =
  | "incompatible_versions"
  | "missing_dependency"
  | "version_incoherence"
  | "ecosystem_mismatch"
  | "port_conflict"
  | "deprecated_package"
  | "quality_gate_mismatch"
  | "repetitive_content"
  | "excessive_length"
  | "ambiguous_dependency";

export interface DependencyWarning {
  severity: "error" | "warning";
  category: WarningCategory;
  message: string;
  suggestion: string;
  affectedPackages: string[];
}

export interface DecompositionSession {
  originalPrd: string;
  fixedPrd?: string;
  warnings?: DependencyWarning[];
  status: "reviewing" | "repairing" | "decomposing" | "done";
  orgId: string;
  provider: string;
  model: string;
  ollamaBaseUrl?: string;
  createdAt: number;
  boardNameOverride?: string;
  specId?: string;
  syncToTracker?: boolean;
  githubRepo?: string;
  userId?: string;
  source?: string;
}

// ============================================================================
// SESSION MAP
// ============================================================================

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const sessions = new Map<string, DecompositionSession>();

/** Cleanup expired sessions every 60s */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60_000);
// Allow Node to exit without waiting for the cleanup timer
cleanupTimer.unref();

export function createSession(id: string, session: DecompositionSession): void {
  sessions.set(id, session);
}

export function getSession(id: string): DecompositionSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    return undefined;
  }
  return session;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse LLM output into DependencyWarning[].
 * Handles markdown fences, malformed JSON, and invalid objects gracefully.
 */
export function parseDependencyWarnings(raw: string): DependencyWarning[] {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warn("[spec-validator] Failed to parse LLM output as JSON", {
      snippet: text.slice(0, 200),
    });
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const validCategories = new Set<string>([
    "incompatible_versions", "missing_dependency", "version_incoherence",
    "ecosystem_mismatch", "port_conflict", "deprecated_package",
    "quality_gate_mismatch", "repetitive_content", "excessive_length",
    "ambiguous_dependency",
  ]);

  return parsed.filter((item): item is DependencyWarning => {
    if (typeof item !== "object" || item === null) return false;
    const obj = item as Record<string, unknown>;
    return (
      (obj.severity === "error" || obj.severity === "warning") &&
      typeof obj.category === "string" &&
      validCategories.has(obj.category) &&
      typeof obj.message === "string" &&
      typeof obj.suggestion === "string" &&
      Array.isArray(obj.affectedPackages)
    );
  });
}

// ============================================================================
// VALIDATION PROMPT
// ============================================================================

const VALIDATION_SYSTEM_PROMPT = `You are a dependency compatibility expert. Analyze the provided project specification for dependency and content quality issues.

Check for:
1. **Cross-package conflicts** — packages known to be incompatible at specified versions (e.g., React 19 + React Router v5)
2. **Missing transitive dependencies** — framework specified but required peer deps missing (e.g., Next.js without React)
3. **Version incoherence** — runtime version doesn't support specified packages (e.g., Node 16 with packages requiring Node 18+)
4. **Ecosystem mismatches** — conflicting toolchains (e.g., both Yarn and pnpm lockfiles, mixing CJS/ESM incorrectly)
5. **Port/service conflicts** — docker-compose services on same port, or missing service dependencies
6. **Deprecated packages** — packages with known deprecated status or better modern replacements
7. **Quality gate feasibility** — gate commands referencing tools not mentioned in the dependency list
8. **Repetitive content** — same requirement stated multiple ways, redundant sections
9. **Excessive length** — spec is bloated and will waste tokens; look for sections that repeat the same information
10. **Ambiguous dependency** — mentions a technology without specifying which version or variant

Rules:
- Output ONLY a JSON array. No markdown fences, no explanation, no commentary.
- Return an empty array [] if no issues are found.
- Be CONSERVATIVE — only flag issues you are confident about. Do not flag speculative or minor concerns.
- Each warning object must have exactly these fields:
  - severity: "error" (will break the build) or "warning" (likely to cause problems)
  - category: one of "incompatible_versions", "missing_dependency", "version_incoherence", "ecosystem_mismatch", "port_conflict", "deprecated_package", "quality_gate_mismatch", "repetitive_content", "excessive_length", "ambiguous_dependency"
  - message: human-readable explanation (1-2 sentences)
  - suggestion: what to change to fix it (1 sentence)
  - affectedPackages: array of package names/versions involved (empty array [] for content quality issues)`;

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

/**
 * Validate a spec for dependency and content quality issues.
 * Uses LLMBackend.generate() — works with any provider.
 *
 * Fail-open: if the LLM call fails, returns empty array (no warnings).
 *
 * NOTE: systemPrompt is NOT passed through by AiSdkBackend or ClaudeCliBackend
 * (pre-existing gap in llm-backend.ts). System instructions are embedded in the
 * user prompt instead.
 */
export async function validatePrdDependencies(
  prdContent: string,
  backend: LLMBackend,
  model: string,
): Promise<DependencyWarning[]> {
  const wordCount = prdContent.split(/\s+/).length;
  const charCount = prdContent.length;

  const prompt = `${VALIDATION_SYSTEM_PROMPT}

---

Analyze this project specification for dependency compatibility and content quality issues.

Spec statistics: ${wordCount} words, ${charCount} characters.

---

${prdContent}`;

  const startTime = Date.now();
  try {
    const result = await backend.generate({
      prompt,
      model,
      maxOutputTokens: 4096,
      temperature: 0,
    });

    const warnings = parseDependencyWarnings(result.text);
    const duration = Date.now() - startTime;

    logger.info("[spec-validator] Validation complete", {
      model,
      duration,
      warningCount: warnings.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    });

    return warnings;
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("[spec-validator] Validation LLM call failed (proceeding without validation)", {
      error: err instanceof Error ? err.message : String(err),
      model,
      duration,
    });
    return [];
  }
}

// ============================================================================
// REPAIR PROMPT
// ============================================================================

const REPAIR_SYSTEM_PROMPT = `You are a technical editor fixing a project specification. You will receive the original spec and a list of issues to fix.

Rules:
- ONLY change what is needed to resolve the listed issues
- Preserve ALL requirements, structure, headings, and formatting
- Do NOT add new features, requirements, or sections
- Do NOT remove existing requirements or acceptance criteria
- Do NOT change non-dependency content unless flagged as repetitive/excessive
- If flagged for repetitive content, consolidate redundant statements but preserve all unique information
- If flagged for excessive length, trim verbose prose into concise bullets without losing actionable details
- Output the COMPLETE fixed spec text — not a patch, not a summary, the full document`;

// ============================================================================
// REPAIR FUNCTION
// ============================================================================

/**
 * Repair a spec to fix flagged dependency and content quality issues.
 * Uses LLMBackend.stream() for real-time progress. Produces a unified diff.
 *
 * NOTE: systemPrompt is NOT passed through by AiSdkBackend or ClaudeCliBackend.
 * System instructions are embedded in the user prompt instead.
 *
 * @param onTextDelta - Optional callback for streaming text chunks (used for SSE)
 */
export async function repairPrdDependencies(
  prdContent: string,
  warnings: DependencyWarning[],
  backend: LLMBackend,
  model: string,
  onTextDelta?: (text: string) => void,
): Promise<{ fixedPrd: string; diff: string }> {
  const warningsList = warnings
    .map((w, i) => `${i + 1}. [${w.severity}] ${w.category}: ${w.message}\n   Suggestion: ${w.suggestion}`)
    .join("\n");

  const prompt = `${REPAIR_SYSTEM_PROMPT}

---

Fix the following issues in this project specification:

## Issues to Fix

${warningsList}

## Original Specification

${prdContent}`;

  const startTime = Date.now();
  let fixedPrd = "";

  const stream = backend.stream({
    prompt,
    model,
    maxOutputTokens: 32000,
    temperature: 0,
  });

  for await (const event of stream) {
    if (event.type === "text_delta" && event.text) {
      fixedPrd += event.text;
      onTextDelta?.(event.text);
    } else if (event.type === "result" && event.text && !fixedPrd) {
      // Non-streaming backends may only emit a result event
      fixedPrd = event.text;
    }
  }

  const duration = Date.now() - startTime;
  logger.info("[spec-validator] Repair complete", {
    model,
    duration,
    originalLength: prdContent.length,
    fixedLength: fixedPrd.length,
  });

  // Generate unified diff
  const diff = createPatch(
    "spec.md",
    prdContent,
    fixedPrd,
    "original",
    "fixed",
  );

  return { fixedPrd, diff };
}
