/**
 * Planning Dependency Auditor
 *
 * Performs semantic validation of story dependencies using LLM analysis.
 * Catches implicit dependencies missed by structural validation and identifies
 * unnecessary dependencies that reduce parallelism.
 *
 * Key design decisions:
 * - Uses tool_use for structured JSON output (consistent with planning-inventory.ts)
 * - Feature-flagged for safe rollout (org.enableDependencyAuditor or env)
 * - Phase 1: adds-only mode (removals logged but not applied)
 * - Guardrails enforce invariants after LLM output
 * - Revalidation + revert pattern for safety
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { logger } from "../utils/logger.js";
import { PlannedStoryV2, PlanningTheme, ThemeCategory } from "./planning-types.js";
import { PRDInventory } from "./planning-inventory.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Model to use for dependency auditing (fast + accurate for structured analysis) */
const AUDITOR_MODEL = "claude-sonnet-4-20250514";

/** Maximum dependencies per story (prevents "depends on everything" graphs) */
const MAX_DEPS_PER_STORY = 5;

/** If deps exceed this proportion of prior stories, clamp and mark low confidence */
const SERIAL_KILLER_THRESHOLD = 0.6;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Compute a short hash of the story order for debugging.
 * Allows detecting if input stories changed between audit and application.
 */
function computeStoryOrderHash(stories: PlannedStoryV2[]): string {
  const payload = stories.map((s) => ({ index: s.index, title: s.title.substring(0, 50) }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").substring(0, 12);
}

/**
 * Build a Set of valid story indices from the input stories.
 */
function buildValidStoryIndices(stories: PlannedStoryV2[]): Set<number> {
  return new Set(stories.map((s) => s.index));
}

// ============================================================================
// TYPES
// ============================================================================

export interface DependencyAuditResult {
  /**
   * Final dependency arrays keyed by story.index (NOT array position).
   * This is defensive against future reordering/filtering of story arrays.
   * After assembleFinalPlan, story.index === canonicalOrder, but we key by
   * story.index explicitly to survive any future invariant changes.
   */
  patchedDependenciesByStoryIndex: Record<number, number[]>;
  /** Detailed changes for logging/metrics */
  changes: DependencyChange[];
  /** Overall confidence in the audit result */
  confidence: "low" | "medium" | "high";
  /** Whether the audit was actually applied (false if guardrails blocked or validation failed) */
  applied: boolean;
  /** Reason if not applied */
  notAppliedReason?: string;
  /** Metrics for observability */
  metrics: AuditMetrics;
}

export interface DependencyChange {
  storyIndex: number;
  added: Array<{ dep: number; reason: string }>;
  removed: Array<{ dep: number; reason: string }>;
}

export interface AuditMetrics {
  enabled: boolean;
  shadow: boolean;
  addsOnly: boolean;
  numChangesTotal: number;
  numAddedEdges: number;
  numRemovedEdgesSuggested: number;
  confidence: "low" | "medium" | "high";
  postValidatePassed: boolean;
  guardrailsClamped: boolean;
  parseFailed: boolean;
  durationMs: number;
  /** Hash of input story order for debugging: hash([{index, title}...]) */
  inputStoryOrderHash: string;
  /** Story indices that were patched by the auditor */
  auditorPatchedKeys: number[];
  /** Story indices returned by LLM that didn't exist in input (should be empty) */
  unknownKeysIgnored: number[];
  /** Dependency references that pointed to non-existent stories (sanitized out) */
  invalidDepsRemoved: number;
}

export interface AuditOptions {
  themes: PlanningTheme[];
  inventory: PRDInventory;
  taskId: string;
  /** If true, only apply additions (Phase 1 default) */
  addsOnly?: boolean;
  /** Maximum dependencies per story */
  maxDepsPerStory?: number;
  /** If true, log but don't apply any changes (shadow mode) */
  shadow?: boolean;
}

/** Raw LLM output structure */
interface LLMAuditOutput {
  dependencies: Array<{
    storyIndex: number;
    deps: number[];
    reasoning?: string;
  }>;
  addedEdges: Array<{
    storyIndex: number;
    dep: number;
    reason: string;
  }>;
  removedEdges: Array<{
    storyIndex: number;
    dep: number;
    reason: string;
  }>;
  confidence: "low" | "medium" | "high";
}

// ============================================================================
// FEATURE FLAG
// ============================================================================

/**
 * Check if dependency auditor is enabled for an organization.
 * Supports both org setting and environment variable override.
 */
export function isAuditorEnabled(org?: { enableDependencyAuditor?: boolean }): boolean {
  // Environment variable override (for testing/rollout)
  if (process.env.PLANNING_DEP_AUDITOR_ENABLED === "true") return true;
  if (process.env.PLANNING_DEP_AUDITOR_ENABLED === "false") return false;

  // Org setting
  return org?.enableDependencyAuditor ?? false;
}

/**
 * Check if auditor should run in shadow mode (log only, don't apply)
 */
export function isAuditorShadowMode(): boolean {
  return process.env.PLANNING_DEP_AUDITOR_SHADOW === "true";
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

const DEPENDENCY_AUDIT_TOOL: Anthropic.Tool = {
  name: "audit_dependencies",
  description: "Audit and patch the dependency graph for a set of stories. Returns the complete patched dependency list for each story, plus explanations for changes.",
  input_schema: {
    type: "object" as const,
    properties: {
      dependencies: {
        type: "array",
        description: "Complete dependency list for each story (even unchanged ones)",
        items: {
          type: "object",
          properties: {
            storyIndex: { type: "number", description: "0-based story index" },
            deps: {
              type: "array",
              items: { type: "number" },
              description: "Array of 0-based dependency indices (must be < storyIndex)",
            },
            reasoning: { type: "string", description: "Brief explanation of dependency choices" },
          },
          required: ["storyIndex", "deps"],
        },
      },
      addedEdges: {
        type: "array",
        description: "Dependencies that were added (missing implicit deps)",
        items: {
          type: "object",
          properties: {
            storyIndex: { type: "number" },
            dep: { type: "number" },
            reason: {
              type: "string",
              description: "Why this dependency was added (e.g., 'schema-before-ORM', 'API-before-UI')",
            },
          },
          required: ["storyIndex", "dep", "reason"],
        },
      },
      removedEdges: {
        type: "array",
        description: "Dependencies that could be removed (unnecessary, can parallelize)",
        items: {
          type: "object",
          properties: {
            storyIndex: { type: "number" },
            dep: { type: "number" },
            reason: {
              type: "string",
              description: "Why this dependency is unnecessary (e.g., 'disjoint files', 'no data dependency')",
            },
          },
          required: ["storyIndex", "dep", "reason"],
        },
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Confidence in the audit: high = clear evidence, medium = some inference, low = speculative",
      },
    },
    required: ["dependencies", "addedEdges", "removedEdges", "confidence"],
  },
};

// ============================================================================
// PROMPT
// ============================================================================

function buildAuditPrompt(
  stories: PlannedStoryV2[],
  themes: PlanningTheme[],
  inventory: PRDInventory,
): string {
  // Build story summary for the model
  const storySummary = stories.map((s) => ({
    index: s.index,
    title: s.title,
    persona: s.persona,
    phase: s.phase,
    themeId: s.themeId,
    targetFiles: s.targetFiles,
    referenceFiles: s.referenceFiles || [],
    currentDeps: s.dependencies,
    scope: s.scope.substring(0, 200), // Truncate for token efficiency
  }));

  // Build theme summary
  const themeSummary = themes.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    dependencies: t.dependencies,
  }));

  // Build inventory summary (categories present)
  const inventorySummary = {
    hasEntities: inventory.entities.length > 0,
    hasMigrations: inventory.migrations.length > 0,
    hasIntegrations: inventory.integrations.length > 0,
    hasApiEndpoints: inventory.apiEndpoints.length > 0,
    hasUiSurfaces: inventory.uiSurfaces.length > 0,
    entityNames: inventory.entities.map((e) => e.name),
    integrationNames: inventory.integrations.map((i) => i.system),
  };

  return `You are auditing the dependency graph for a software development plan.

## Your Task

For each story, determine if:
1. **Missing implicit dependencies** - Does this story require work from an earlier story that isn't listed as a dependency?
2. **Unnecessary dependencies** - Can this story actually run in parallel with a listed dependency?

## Dependency Patterns to Check

**MUST add dependency when:**
- Schema/entity changes (migration) must complete before ORM/repository code uses them
- API endpoints must exist before frontend components call them
- Types/interfaces must be defined before consumers import them
- Auth/security foundations must exist before protected endpoints
- Database tables must exist before queries run against them
- Shared utilities must exist before multiple stories use them

**MAY remove dependency when:**
- Stories touch completely disjoint files AND have no data dependency
- Stories are in the same theme but work on independent features
- A dependency was added "just in case" but there's no actual coupling

## Phase Order (dependencies should respect this)
1. foundation - Architecture, types, documentation
2. core - Main business logic, models, services
3. integration - Connecting components, API wiring
4. testing - Tests, validation
5. polish - Refinements, edge cases

## Stories to Audit
${JSON.stringify(storySummary, null, 2)}

## Themes
${JSON.stringify(themeSummary, null, 2)}

## Inventory Summary
${JSON.stringify(inventorySummary, null, 2)}

## Rules
- Dependencies must be 0-based indices
- A story can only depend on earlier stories (dep < storyIndex)
- No self-dependencies
- Prefer adding missing deps over removing existing ones (safety)
- Set confidence = "high" if evidence is clear, "medium" if inferred, "low" if speculative

Return the COMPLETE patched dependency list for ALL stories (even unchanged ones), plus the specific edges added/removed.`;
}

// ============================================================================
// GUARDRAILS
// ============================================================================

interface GuardrailResult {
  /** Dependencies keyed by story.index (NOT array position) */
  patched: Record<number, number[]>;
  clamped: boolean;
  clampedStories: number[];
  /** Story indices returned by LLM that don't exist in input */
  unknownKeysIgnored: number[];
  /** Count of dependency references that pointed to non-existent stories */
  invalidDepsRemoved: number;
}

/**
 * Apply guardrails to LLM output to ensure invariants hold.
 * Returns clamped/corrected dependencies keyed by story.index.
 *
 * @param llmOutput - Raw LLM output
 * @param validStoryIndices - Set of valid story.index values from input
 * @param maxDepsPerStory - Maximum allowed dependencies per story
 */
function applyGuardrails(
  llmOutput: LLMAuditOutput,
  validStoryIndices: Set<number>,
  maxDepsPerStory: number,
): GuardrailResult {
  const patched: Record<number, number[]> = {};
  let clamped = false;
  const clampedStories: number[] = [];
  const unknownKeysIgnored: number[] = [];
  let invalidDepsRemoved = 0;

  for (const entry of llmOutput.dependencies) {
    const { storyIndex, deps } = entry;

    // Skip story indices that don't exist in input (defensive)
    if (!validStoryIndices.has(storyIndex)) {
      logger.warn("Auditor returned unknown story index, ignoring", {
        storyIndex,
        validIndices: Array.from(validStoryIndices).slice(0, 10),
      });
      unknownKeysIgnored.push(storyIndex);
      continue;
    }

    // Start with raw deps, filtering out invalid ones
    const rawDepsCount = deps.length;
    let safeDeps = deps
      // Must be integers
      .filter((d): d is number => typeof d === "number" && Number.isInteger(d))
      // Must exist in validStoryIndices (defensive against referencing non-existent stories)
      .filter((d) => validStoryIndices.has(d))
      // No forward deps (dep < storyIndex)
      .filter((d) => d >= 0 && d < storyIndex)
      // Unique
      .filter((d, i, arr) => arr.indexOf(d) === i)
      // Sorted
      .sort((a, b) => a - b);

    // Track how many deps were removed due to invalid references
    invalidDepsRemoved += rawDepsCount - safeDeps.length;

    // Check for "serial-killer" pattern (depends on too many prior stories)
    const maxAllowed = Math.max(1, Math.floor(storyIndex * SERIAL_KILLER_THRESHOLD));
    if (safeDeps.length > maxAllowed && safeDeps.length > maxDepsPerStory) {
      logger.warn("Auditor serial-killer pattern detected, clamping", {
        storyIndex,
        originalDeps: safeDeps.length,
        maxAllowed,
        maxDepsPerStory,
      });
      // Keep only the last N dependencies (most recent/relevant)
      safeDeps = safeDeps.slice(-maxDepsPerStory);
      clamped = true;
      clampedStories.push(storyIndex);
    }

    // Enforce max deps per story
    if (safeDeps.length > maxDepsPerStory) {
      safeDeps = safeDeps.slice(-maxDepsPerStory);
      clamped = true;
      if (!clampedStories.includes(storyIndex)) {
        clampedStories.push(storyIndex);
      }
    }

    patched[storyIndex] = safeDeps;
  }

  // Ensure all valid stories have an entry
  for (const idx of validStoryIndices) {
    if (!(idx in patched)) {
      patched[idx] = [];
    }
  }

  return { patched, clamped, clampedStories, unknownKeysIgnored, invalidDepsRemoved };
}

/**
 * Compute the changes between original and patched dependencies.
 * Uses story.index for keying (NOT array position).
 */
function computeChanges(
  original: PlannedStoryV2[],
  patched: Record<number, number[]>,
  llmOutput: LLMAuditOutput,
): DependencyChange[] {
  const changes: DependencyChange[] = [];

  for (const story of original) {
    const storyIdx = story.index;
    const origDeps = new Set(story.dependencies);
    const newDeps = new Set(patched[storyIdx] || []);

    const added: Array<{ dep: number; reason: string }> = [];
    const removed: Array<{ dep: number; reason: string }> = [];

    // Find added deps
    for (const dep of newDeps) {
      if (!origDeps.has(dep)) {
        const llmReason = llmOutput.addedEdges.find(
          (e) => e.storyIndex === storyIdx && e.dep === dep,
        )?.reason;
        added.push({ dep, reason: llmReason || "inferred" });
      }
    }

    // Find removed deps (from original that aren't in new)
    for (const dep of origDeps) {
      if (!newDeps.has(dep)) {
        const llmReason = llmOutput.removedEdges.find(
          (e) => e.storyIndex === storyIdx && e.dep === dep,
        )?.reason;
        removed.push({ dep, reason: llmReason || "inferred" });
      }
    }

    if (added.length > 0 || removed.length > 0) {
      changes.push({ storyIndex: storyIdx, added, removed });
    }
  }

  return changes;
}

/**
 * Apply adds-only filter: keep additions, revert removals to original.
 * Uses story.index for keying (NOT array position).
 */
function applyAddsOnlyFilter(
  original: PlannedStoryV2[],
  patched: Record<number, number[]>,
): Record<number, number[]> {
  const result: Record<number, number[]> = {};

  for (const story of original) {
    const storyIdx = story.index;
    const origDeps = new Set(story.dependencies);
    const patchedDeps = patched[storyIdx] || [];

    // Start with original deps
    const finalDeps = new Set(origDeps);

    // Add any new deps from patch
    for (const dep of patchedDeps) {
      finalDeps.add(dep);
    }

    result[storyIdx] = Array.from(finalDeps).sort((a, b) => a - b);
  }

  return result;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Audit story dependencies using LLM analysis.
 *
 * @param stories - Stories to audit (with current dependencies)
 * @param options - Audit configuration
 * @returns Audit result with patched dependencies keyed by story.index (NOT array position)
 */
export async function auditDependencies(
  stories: PlannedStoryV2[],
  options: AuditOptions,
): Promise<DependencyAuditResult> {
  const startTime = Date.now();
  const { themes, inventory, taskId, addsOnly = true, maxDepsPerStory = MAX_DEPS_PER_STORY, shadow = false } = options;

  // Build validation structures keyed by story.index (NOT array position)
  const validStoryIndices = buildValidStoryIndices(stories);
  const inputStoryOrderHash = computeStoryOrderHash(stories);

  // Initialize metrics with debugging fields
  const metrics: AuditMetrics = {
    enabled: true,
    shadow,
    addsOnly,
    numChangesTotal: 0,
    numAddedEdges: 0,
    numRemovedEdgesSuggested: 0,
    confidence: "medium",
    postValidatePassed: true,
    guardrailsClamped: false,
    parseFailed: false,
    durationMs: 0,
    inputStoryOrderHash,
    auditorPatchedKeys: [],
    unknownKeysIgnored: [],
    invalidDepsRemoved: 0,
  };

  // Build original deps map keyed by story.index (NOT array position)
  const originalDeps: Record<number, number[]> = {};
  for (const story of stories) {
    originalDeps[story.index] = [...story.dependencies];
  }

  try {
    // Call LLM
    const prompt = buildAuditPrompt(stories, themes, inventory);
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: AUDITOR_MODEL,
      max_tokens: 4096,
      temperature: 0,
      tools: [DEPENDENCY_AUDIT_TOOL],
      tool_choice: { type: "tool", name: "audit_dependencies" },
      messages: [{ role: "user", content: prompt }],
    });

    // Parse tool_use response
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Dependency audit did not return tool_use response");
    }

    const llmOutput = toolUse.input as LLMAuditOutput;

    // Apply guardrails with story.index validation
    const guardrailResult = applyGuardrails(llmOutput, validStoryIndices, maxDepsPerStory);
    metrics.guardrailsClamped = guardrailResult.clamped;
    metrics.unknownKeysIgnored = guardrailResult.unknownKeysIgnored;
    metrics.invalidDepsRemoved = guardrailResult.invalidDepsRemoved;

    // Downgrade confidence if we had to ignore unknown keys or invalid deps
    if (guardrailResult.unknownKeysIgnored.length > 0 || guardrailResult.invalidDepsRemoved > 0) {
      logger.warn("dep_audit.guardrails_sanitized", {
        taskId,
        unknownKeysIgnored: guardrailResult.unknownKeysIgnored,
        invalidDepsRemoved: guardrailResult.invalidDepsRemoved,
      });
    }

    // Compute changes (keyed by story.index)
    let changes = computeChanges(stories, guardrailResult.patched, llmOutput);

    // Apply adds-only filter if enabled
    let finalPatched = guardrailResult.patched;
    if (addsOnly) {
      finalPatched = applyAddsOnlyFilter(stories, guardrailResult.patched);
      // Recompute changes after filter
      changes = computeChanges(stories, finalPatched, llmOutput);
    }

    // Compute which story indices were actually patched
    const auditorPatchedKeys = changes.map((c) => c.storyIndex);
    metrics.auditorPatchedKeys = auditorPatchedKeys;

    // Update metrics
    const baseConfidence = guardrailResult.clamped ? "low" : llmOutput.confidence;
    // Downgrade confidence if we ignored unknown keys
    metrics.confidence = guardrailResult.unknownKeysIgnored.length > 0 ? "low" : baseConfidence;
    metrics.numChangesTotal = changes.length;
    metrics.numAddedEdges = changes.reduce((sum, c) => sum + c.added.length, 0);
    metrics.numRemovedEdgesSuggested = llmOutput.removedEdges.length;
    metrics.durationMs = Date.now() - startTime;

    // Log structured metrics
    logger.info("dep_audit.completed", {
      taskId,
      ...metrics,
      changesDetail: changes.map((c) => ({
        storyIndex: c.storyIndex,
        addedCount: c.added.length,
        removedCount: c.removed.length,
      })),
    });

    // Determine if we should apply
    const shouldApply = !shadow && changes.length > 0;

    return {
      patchedDependenciesByStoryIndex: finalPatched,
      changes,
      confidence: metrics.confidence,
      applied: shouldApply,
      notAppliedReason: shadow ? "shadow_mode" : changes.length === 0 ? "no_changes" : undefined,
      metrics,
    };
  } catch (error) {
    metrics.parseFailed = true;
    metrics.durationMs = Date.now() - startTime;

    logger.error("dep_audit.failed", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
      ...metrics,
    });

    // Return no-op result on failure (keyed by story.index)
    return {
      patchedDependenciesByStoryIndex: originalDeps,
      changes: [],
      confidence: "low",
      applied: false,
      notAppliedReason: "parse_failed",
      metrics,
    };
  }
}

/**
 * Apply audit result to stories array, returning new array with patched dependencies.
 * Looks up patches by story.index (NOT array position) for future-proofing.
 */
export function applyAuditToStories(
  stories: PlannedStoryV2[],
  auditResult: DependencyAuditResult,
): PlannedStoryV2[] {
  if (!auditResult.applied) {
    return stories;
  }

  return stories.map((story) => ({
    ...story,
    // Look up by story.index, NOT array position
    dependencies: auditResult.patchedDependenciesByStoryIndex[story.index] ?? story.dependencies,
  }));
}

/**
 * Log audit changes in a human-readable format for task logs.
 */
export function formatAuditChangesForLog(auditResult: DependencyAuditResult): string[] {
  const lines: string[] = [];

  if (auditResult.changes.length === 0) {
    lines.push("No dependency changes suggested");
    return lines;
  }

  lines.push(`Dependency audit: ${auditResult.changes.length} stories affected (confidence: ${auditResult.confidence})`);

  for (const change of auditResult.changes) {
    const parts: string[] = [];
    if (change.added.length > 0) {
      parts.push(`+deps: ${change.added.map((a) => `S${a.dep}(${a.reason})`).join(", ")}`);
    }
    if (change.removed.length > 0) {
      const prefix = auditResult.metrics.addsOnly ? "[logged] " : "";
      parts.push(`${prefix}-deps: ${change.removed.map((r) => `S${r.dep}(${r.reason})`).join(", ")}`);
    }
    if (parts.length > 0) {
      lines.push(`  S${change.storyIndex}: ${parts.join("; ")}`);
    }
  }

  if (auditResult.metrics.guardrailsClamped) {
    lines.push("  (some deps clamped by guardrails)");
  }

  return lines;
}
