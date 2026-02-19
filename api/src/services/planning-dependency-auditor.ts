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
const AUDITOR_MODEL = "claude-sonnet-4-6";

/** Maximum dependencies per story (prevents "depends on everything" graphs) */
const MAX_DEPS_PER_STORY = 5;

/** If deps exceed this proportion of prior stories, clamp and mark low confidence */
const SERIAL_KILLER_THRESHOLD = 0.6;

// ============================================================================
// V4: ID-BASED DEPENDENCY MATCHING
// ============================================================================

/**
 * Convert entity name to semantic ID format.
 * E.g., "User Profile" -> "ENT-UserProfile", "api_key" -> "ENT-ApiKey"
 *
 * V4 Fix: Sanitizes special characters (C#, C++, I/O) to produce valid IDs.
 */
export function toSemanticEntityId(name: string): string {
  // Convert to PascalCase: "user profile" -> "UserProfile", "api_key" -> "ApiKey"
  const pascalCase = name
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  // V4: Remove non-alphanumeric chars (handles C#, C++, I/O, etc.)
  const sanitized = pascalCase.replace(/[^a-zA-Z0-9]/g, "");
  return `ENT-${sanitized}`;
}

/**
 * Result from building the entity provider map.
 * Includes the map plus any conflicts detected.
 */
export interface EntityProviderMapResult {
  providerMap: Map<string, number>;
  duplicateProviders: Array<{ entityId: string; stories: number[]; resolvedTo: number }>;
}

/**
 * Build a map of entity IDs to the story index that provides them.
 * Used for deterministic dependency resolution based on canonical IDs.
 *
 * V4 Fixes:
 * - Detects and warns on duplicate providers (surfaces upstream issues)
 * - Action-aware conflict resolution: prefers entityAction === 'create' over 'update'
 *   (the creator is the true owner, updates are downstream consumers)
 */
export function buildEntityProviderMap(stories: PlannedStoryV2[]): EntityProviderMapResult {
  const providerMap = new Map<string, number>();
  const duplicateProviders: Array<{ entityId: string; stories: number[]; resolvedTo: number }> = [];
  const entityToStories = new Map<string, number[]>();

  // Build index lookup for action-aware resolution
  const storyByIndex = new Map<number, PlannedStoryV2>();
  stories.forEach((story) => storyByIndex.set(story.index, story));

  // First pass: collect all providers for each entity
  stories.forEach((story) => {
    if (story.providesEntities) {
      story.providesEntities.forEach((entityId) => {
        const existing = entityToStories.get(entityId) || [];
        existing.push(story.index);
        entityToStories.set(entityId, existing);
      });
    }
  });

  // Second pass: build map with action-aware resolution
  entityToStories.forEach((storyIndices, entityId) => {
    let chosenProvider: number;

    if (storyIndices.length > 1) {
      // V4: Action-aware conflict resolution
      // Prefer stories with entityAction === 'create' (true owner)
      const creators = storyIndices.filter((idx) => {
        const story = storyByIndex.get(idx);
        return story?.entityAction === "create";
      });

      if (creators.length === 1) {
        // Clear winner: one creator
        chosenProvider = creators[0];
      } else if (creators.length > 1) {
        // Multiple creators - use lowest index for determinism, but log warning
        chosenProvider = Math.min(...creators);
        logger.warn("entity_provider.multiple_creators", {
          entityId,
          creators,
          chosenProvider,
          message: `Entity ${entityId} has multiple creators: ${creators.join(", ")}. Using lowest index (Story ${chosenProvider}).`,
        });
      } else {
        // No creators, all are updates - use lowest index
        chosenProvider = Math.min(...storyIndices);
      }

      logger.warn("entity_provider.duplicate_detected", {
        entityId,
        conflictingStories: storyIndices,
        chosenProvider,
        resolution: creators.length > 0 ? "prefer_creator" : "lowest_index",
        message: `Entity ${entityId} is provided by multiple stories: ${storyIndices.join(", ")}. Resolved to Story ${chosenProvider}.`,
      });
      duplicateProviders.push({ entityId, stories: storyIndices, resolvedTo: chosenProvider });
    } else {
      // Single provider
      chosenProvider = storyIndices[0];
    }

    providerMap.set(entityId, chosenProvider);
  });

  return { providerMap, duplicateProviders };
}

/**
 * Result from finding missing dependencies.
 * Includes both the missing deps and any orphans detected.
 */
export interface MissingDependenciesResult {
  /** Map of storyIndex -> additional dependencies to add */
  missingDeps: Map<number, Set<number>>;
  /** Orphan entities: required but never provided by any story */
  orphans: Array<{ storyIndex: number; entityId: string }>;
  /** Duplicate provider warnings from the provider map (includes resolution) */
  duplicateProviders: Array<{ entityId: string; stories: number[]; resolvedTo: number }>;
}

/**
 * Find missing dependencies by matching story.requiresEntities against
 * what stories provide via providesEntities.
 *
 * V4 Fixes:
 * - Removed providerIndex < story.index check - dependencies are recorded
 *   regardless of current order, then topological sort reorders stories.
 * - Added orphan detection - logs errors when a required entity has no provider.
 *
 * Returns missing deps, orphans, and duplicate provider warnings.
 */
export function findMissingDependenciesById(
  stories: PlannedStoryV2[],
): MissingDependenciesResult {
  const { providerMap, duplicateProviders } = buildEntityProviderMap(stories);
  const missingDeps = new Map<number, Set<number>>();
  const orphans: Array<{ storyIndex: number; entityId: string }> = [];

  stories.forEach((story) => {
    if (!story.requiresEntities || story.requiresEntities.length === 0) {
      return;
    }

    const existingDeps = new Set(story.dependencies);
    const toAdd = new Set<number>();

    story.requiresEntities.forEach((reqId) => {
      const providerIndex = providerMap.get(reqId);

      if (providerIndex === undefined) {
        // ORPHAN: Required entity is never provided by any story
        logger.error("entity_dependency.orphan_detected", {
          storyIndex: story.index,
          storyTitle: story.title,
          missingEntityId: reqId,
          message: `Story ${story.index} requires entity "${reqId}" but no story provides it.`,
        });
        orphans.push({ storyIndex: story.index, entityId: reqId });
      } else if (
        providerIndex !== story.index && // Can't depend on self
        !existingDeps.has(providerIndex) // Not already a dependency
      ) {
        // V4 Fix: Record dependency regardless of order
        // (removed providerIndex < story.index check)
        // Topological sort will reorder stories correctly afterwards
        toAdd.add(providerIndex);
      }
    });

    if (toAdd.size > 0) {
      missingDeps.set(story.index, toAdd);
    }
  });

  // Log summary if orphans found
  if (orphans.length > 0) {
    logger.error("entity_dependency.orphans_summary", {
      totalOrphans: orphans.length,
      orphanDetails: orphans,
      message: `${orphans.length} orphan dependencies detected. These required entities have no provider.`,
    });
  }

  return { missingDeps, orphans, duplicateProviders };
}

/**
 * Hallucination Guard: Sanitize entity references against inventory.
 * Removes any entity IDs that don't exist in the inventory.
 *
 * V4 Update: Uses semantic IDs (ENT-UserProfile) as the canonical format.
 * Also accepts legacy index-based IDs (ENT-0) for backwards compatibility
 * during migration, but logs a deprecation warning.
 *
 * This is a post-processor that runs after LLM story generation to catch
 * cases where the LLM invents entity IDs that aren't in the canonical list.
 */
export function sanitizeEntityReferences(
  stories: PlannedStoryV2[],
  inventory: PRDInventory,
): { stories: PlannedStoryV2[]; droppedCount: number; validIds: Set<string> } {
  // Build set of valid entity IDs from inventory
  // V4: Prefer semantic IDs (ENT-UserProfile), but accept legacy index IDs
  const validIds = new Set<string>();
  const legacyToSemanticMap = new Map<string, string>();

  inventory.entities.forEach((entity, idx) => {
    // Primary: Semantic ID based on name (preferred)
    const semanticId = toSemanticEntityId(entity.name);
    validIds.add(semanticId);

    // Legacy: Index-based ID (for backwards compatibility)
    const legacyId = `ENT-${idx}`;
    validIds.add(legacyId);
    legacyToSemanticMap.set(legacyId, semanticId);

    // Also accept explicit ID if entity has one
    const explicitId = (entity as { id?: string }).id;
    if (explicitId) {
      validIds.add(explicitId);
    }
  });

  let droppedCount = 0;
  let legacyIdCount = 0;

  const sanitizedStories = stories.map((story) => {
    const sanitizedProvides = (story.providesEntities || []).filter((id) => {
      if (validIds.has(id)) {
        // Warn if using legacy index-based ID
        if (legacyToSemanticMap.has(id)) {
          legacyIdCount++;
          logger.warn("hallucination_guard.legacy_id_used", {
            storyIndex: story.index,
            legacyId: id,
            recommendedId: legacyToSemanticMap.get(id),
            message: `Story uses legacy ID "${id}". Consider using semantic ID "${legacyToSemanticMap.get(id)}" instead.`,
          });
        }
        return true;
      }
      logger.warn("hallucination_guard.dropped_invalid_entity", {
        storyIndex: story.index,
        field: "providesEntities",
        invalidId: id,
      });
      droppedCount++;
      return false;
    });

    const sanitizedRequires = (story.requiresEntities || []).filter((id) => {
      if (validIds.has(id)) {
        // Warn if using legacy index-based ID
        if (legacyToSemanticMap.has(id)) {
          legacyIdCount++;
          logger.warn("hallucination_guard.legacy_id_used", {
            storyIndex: story.index,
            legacyId: id,
            recommendedId: legacyToSemanticMap.get(id),
            message: `Story uses legacy ID "${id}". Consider using semantic ID "${legacyToSemanticMap.get(id)}" instead.`,
          });
        }
        return true;
      }
      logger.warn("hallucination_guard.dropped_invalid_entity", {
        storyIndex: story.index,
        field: "requiresEntities",
        invalidId: id,
      });
      droppedCount++;
      return false;
    });

    return {
      ...story,
      providesEntities: sanitizedProvides.length > 0 ? sanitizedProvides : undefined,
      requiresEntities: sanitizedRequires.length > 0 ? sanitizedRequires : undefined,
    };
  });

  if (droppedCount > 0 || legacyIdCount > 0) {
    logger.info("hallucination_guard.summary", {
      totalDropped: droppedCount,
      legacyIdsUsed: legacyIdCount,
      storiesAffected: sanitizedStories.filter((s) =>
        s.providesEntities?.length !== stories.find((orig) => orig.index === s.index)?.providesEntities?.length ||
        s.requiresEntities?.length !== stories.find((orig) => orig.index === s.index)?.requiresEntities?.length,
      ).length,
    });
  }

  return { stories: sanitizedStories, droppedCount, validIds };
}

// ============================================================================
// V4: TOPOLOGICAL SORT (Kahn's Algorithm)
// ============================================================================

/**
 * Error thrown when a circular dependency is detected.
 * Contains the cycle path for debugging.
 */
export class CycleError extends Error {
  constructor(public cyclePath: number[]) {
    super(`Circular dependency detected: ${cyclePath.join(" -> ")}`);
    this.name = "CycleError";
  }
}

/**
 * Result from topological sort operation.
 */
export interface TopologicalSortResult {
  /** Stories reordered so dependencies come before dependents */
  sortedStories: PlannedStoryV2[];
  /** Whether any reordering was needed */
  reordered: boolean;
  /** Number of stories that moved position */
  movedCount: number;
  /** Original positions for debugging */
  originalOrder: number[];
  /** New positions after sort */
  newOrder: number[];
}

/**
 * Topologically sort stories using Kahn's algorithm.
 * Ensures all dependencies are executed before their dependents.
 *
 * V4: Called after ID-based dependency patching to fix ordering.
 * Throws CycleError if circular dependencies are detected.
 *
 * @param stories - Stories with potentially out-of-order dependencies
 * @returns Sorted stories with updated indices and positions
 */
export function topologicalSortStories(stories: PlannedStoryV2[]): TopologicalSortResult {
  if (stories.length === 0) {
    return {
      sortedStories: [],
      reordered: false,
      movedCount: 0,
      originalOrder: [],
      newOrder: [],
    };
  }

  // Build adjacency list and in-degree count
  // story.index -> list of stories that depend on it
  const dependents = new Map<number, number[]>();
  const inDegree = new Map<number, number>();
  const storyByIndex = new Map<number, PlannedStoryV2>();

  // Initialize
  stories.forEach((story) => {
    storyByIndex.set(story.index, story);
    dependents.set(story.index, []);
    inDegree.set(story.index, 0);
  });

  // Build graph edges: for each dep -> story, add edge
  stories.forEach((story) => {
    story.dependencies.forEach((depIndex) => {
      // Only count valid dependencies (that exist in our story set)
      if (storyByIndex.has(depIndex)) {
        dependents.get(depIndex)!.push(story.index);
        inDegree.set(story.index, (inDegree.get(story.index) || 0) + 1);
      }
    });
  });

  // Kahn's algorithm: process nodes with in-degree 0
  // Use a queue sorted by original index for determinism
  const queue: number[] = [];
  inDegree.forEach((degree, storyIndex) => {
    if (degree === 0) {
      queue.push(storyIndex);
    }
  });
  // Sort for deterministic output when multiple nodes have in-degree 0
  queue.sort((a, b) => a - b);

  const sortedIndices: number[] = [];

  while (queue.length > 0) {
    // Take the smallest index for determinism
    const current = queue.shift()!;
    sortedIndices.push(current);

    // Reduce in-degree of dependents
    const deps = dependents.get(current) || [];
    for (const depIndex of deps) {
      const newDegree = (inDegree.get(depIndex) || 0) - 1;
      inDegree.set(depIndex, newDegree);
      if (newDegree === 0) {
        // Insert in sorted position for determinism
        const insertPos = queue.findIndex((idx) => idx > depIndex);
        if (insertPos === -1) {
          queue.push(depIndex);
        } else {
          queue.splice(insertPos, 0, depIndex);
        }
      }
    }
  }

  // Check for cycle: if we didn't process all stories
  if (sortedIndices.length !== stories.length) {
    // Find the cycle for error reporting
    const remaining = stories
      .map((s) => s.index)
      .filter((idx) => !sortedIndices.includes(idx));

    logger.error("topological_sort.cycle_detected", {
      processedCount: sortedIndices.length,
      totalCount: stories.length,
      remainingStories: remaining,
    });

    throw new CycleError(remaining);
  }

  // Build original order array
  const originalOrder = stories.map((s) => s.index);

  // Check if any reordering happened
  let movedCount = 0;
  for (let i = 0; i < sortedIndices.length; i++) {
    if (sortedIndices[i] !== originalOrder[i]) {
      movedCount++;
    }
  }

  // If no reordering needed, return original
  if (movedCount === 0) {
    return {
      sortedStories: stories,
      reordered: false,
      movedCount: 0,
      originalOrder,
      newOrder: sortedIndices,
    };
  }

  // Build sorted stories with updated indices
  const sortedStories = sortedIndices.map((oldIndex, newPosition) => {
    const story = storyByIndex.get(oldIndex)!;
    return {
      ...story,
      index: newPosition,
      canonicalOrder: newPosition,
      // Update dependencies to new indices
      dependencies: story.dependencies
        .map((depOldIndex) => sortedIndices.indexOf(depOldIndex))
        .filter((newIdx) => newIdx !== -1 && newIdx < newPosition)
        .sort((a, b) => a - b),
    };
  });

  logger.info("topological_sort.reordered", {
    movedCount,
    originalOrder,
    newOrder: sortedIndices,
  });

  return {
    sortedStories,
    reordered: true,
    movedCount,
    originalOrder,
    newOrder: sortedIndices,
  };
}

// ============================================================================
// V4: APPLY ID-BASED DEPENDENCIES
// ============================================================================

/**
 * Result from applying ID-based dependencies.
 * Includes the patched stories plus diagnostic information.
 */
export interface ApplyIdBasedDependenciesResult {
  stories: PlannedStoryV2[];
  /** Number of stories that had dependencies added */
  storiesPatched: number;
  /** Total dependency edges added */
  edgesAdded: number;
  /** Orphan entities detected (required but never provided) */
  orphans: Array<{ storyIndex: number; entityId: string }>;
  /** Entities provided by multiple stories */
  duplicateProviders: Array<{ entityId: string; stories: number[]; resolvedTo: number }>;
  /** Whether the plan has blocking issues (orphans or cycles) */
  hasBlockingIssues: boolean;
  /** Whether topological sort reordered stories */
  reordered: boolean;
  /** Number of stories moved by topological sort */
  movedCount: number;
}

/**
 * Apply ID-based dependency patches to stories.
 * This merges the deterministic ID-based dependencies with existing dependencies,
 * then topologically sorts to ensure correct execution order.
 *
 * V4 Updates:
 * - Returns detailed result including orphan detection and duplicate provider warnings
 * - Calls topologicalSortStories after patching to fix ordering
 * - Callers can check hasBlockingIssues to determine if the plan should be rejected
 */
export function applyIdBasedDependencies(stories: PlannedStoryV2[]): ApplyIdBasedDependenciesResult {
  const { missingDeps, orphans, duplicateProviders } = findMissingDependenciesById(stories);

  const storiesPatched = missingDeps.size;
  const edgesAdded = Array.from(missingDeps.values()).reduce((sum, set) => sum + set.size, 0);

  if (storiesPatched > 0) {
    logger.info("id_based_deps.applying", {
      storiesPatched,
      totalEdgesAdded: edgesAdded,
      orphansDetected: orphans.length,
      duplicateProvidersDetected: duplicateProviders.length,
    });
  }

  // Step 1: Patch dependencies
  const patchedStories = stories.map((story) => {
    const toAdd = missingDeps.get(story.index);
    if (!toAdd || toAdd.size === 0) {
      return story;
    }

    // Merge and sort
    const merged = new Set([...story.dependencies, ...toAdd]);
    return {
      ...story,
      dependencies: Array.from(merged).sort((a, b) => a - b),
    };
  });

  // Step 2: Topological sort to fix ordering
  // V4: This ensures dependencies are executed before dependents even if
  // the LLM placed a dependent story before its dependency
  let finalStories = patchedStories;
  let reordered = false;
  let movedCount = 0;
  let hasCycle = false;

  try {
    const sortResult = topologicalSortStories(patchedStories);
    finalStories = sortResult.sortedStories;
    reordered = sortResult.reordered;
    movedCount = sortResult.movedCount;

    if (reordered) {
      logger.info("id_based_deps.topological_sort_applied", {
        movedCount,
        originalOrder: sortResult.originalOrder,
        newOrder: sortResult.newOrder,
      });
    }
  } catch (error) {
    if (error instanceof CycleError) {
      logger.error("id_based_deps.cycle_detected", {
        cyclePath: error.cyclePath,
        message: error.message,
      });
      hasCycle = true;
      // Return patched stories without sort - let caller handle the cycle
    } else {
      throw error;
    }
  }

  return {
    stories: finalStories,
    storiesPatched,
    edgesAdded,
    orphans,
    duplicateProviders,
    hasBlockingIssues: orphans.length > 0 || hasCycle,
    reordered,
    movedCount,
  };
}

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
    scope: s.scope,
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
