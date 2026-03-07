/**
 * Planning Agent V3
 *
 * Inventory-based planning with dual scoring, artifact graphs, and mutex groups.
 */

import { WorkerTask } from "../../models/WorkerTask.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { transitionJiraIssue } from "../../utils/jira.js";
import { postTicketComment } from "../../utils/ticket-comments.js";
import { enforceFileDependencies } from "../orchestrator-utils.js";
import { getInventorySummary, validatePlanCoverage } from "../planning-inventory.js";
import { getScopeLevel, getRiskLevel, detectTrivialTicket } from "../planning-scoring.js";
import { buildArtifactGraph } from "../planning-artifacts.js";
import type {
  ExecutionPlanV2,
  PlanningTheme,
  PlannedStoryV2,
} from "../planning-types.js";
import {
  extractThemes,
  decomposeTheme,
  assembleFinalPlan,
  createDefaultFoundationTheme,
  createDefaultFoundationStory,
  THEME_EXTRACTION_MODEL,
  STORY_DECOMPOSITION_MODEL,
} from "../planning-themes.js";
import {
  validatePlan as validatePlanV2,
  scorePlan,
} from "../planning-validation.js";
import {
  auditDependencies,
  applyAuditToStories,
  formatAuditChangesForLog,
  isAuditorEnabled,
  isAuditorShadowMode,
  // V4 canonical ID pattern functions
  sanitizeEntityReferences,
  applyIdBasedDependencies,
} from "../planning-dependency-auditor.js";
import type { DependencyAuditResult } from "../planning-dependency-auditor.js";
import type { ExecutionPlan, PlannedStory } from "./types.js";
import { calculateComplexityV3 } from "./complexity.js";
import { estimatePlanCost, addPerStoryCostEstimates } from "./cost-estimation.js";
import { fetchCodebaseContextForTask, addPlanningLog } from "./helpers.js";

/**
 * Run V3 planning agent with inventory-based dual scoring.
 *
 * This variant uses:
 * 1. Sonnet for inventory extraction (more accurate)
 * 2. Deterministic dual scoring (Scope + Risk)
 * 3. Artifact graph for dependency ordering
 * 4. LLM for story generation (keeping flexibility)
 * 5. Mutex groups for concurrency control
 */
export async function runPlanningAgentV3(task: WorkerTask): Promise<ExecutionPlanV2> {
  const startTime = Date.now();
  let llmCalls = 0;

  logger.info("Planning agent V3 starting analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
  });

  await addPlanningLog(task.id, `🔍 Planning Agent V3 (Inventory-Based) analyzing PRD: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📋 Summary: ${task.summary || "No summary"}`);

  // Check for dry-run mode
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

  // Transition Jira ticket to "In Progress"
  if (task.jiraIssueKey && !isDryRun) {
    const transitioned = await transitionJiraIssue(task.orgId, task.jiraIssueKey, "In Progress");
    if (transitioned) {
      await addPlanningLog(task.id, `📌 Jira ticket transitioned to In Progress`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 1: Fetch codebase context
  // -------------------------------------------------------------------------
  let codebaseContext = {
    fileTree: "Unable to fetch (no repository context)",
    readme: null as string | null,
    techStack: null as Record<string, unknown> | null,
  };

  if (task.githubRepo) {
    await addPlanningLog(task.id, `📚 Fetching codebase context from ${task.githubRepo}...`);
    try {
      codebaseContext = await fetchCodebaseContextForTask(task.githubRepo, task.orgId);
      await addPlanningLog(task.id, `✅ Retrieved repository structure and metadata`);
    } catch (error) {
      logger.warn("Failed to fetch codebase context", { taskId: task.id, repo: task.githubRepo, error });
      await addPlanningLog(task.id, `⚠️ Could not fetch codebase context`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 2: Extract inventory and calculate dual score (V3)
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `📦 Phase 0: Extracting structured inventory from PRD...`);

  // Get org settings for calibration
  const calibrationMultiplier = (task.organization as { storyCalibrationMultiplier?: number })?.storyCalibrationMultiplier;
  await addPlanningLog(task.id, `🎚️ Story calibration multiplier: ${calibrationMultiplier}`);

  const { inventory, dualScore, legacyScore } = await calculateComplexityV3(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || [],
    codebaseContext,
    { storyCalibrationMultiplier: calibrationMultiplier }
  );
  llmCalls++; // Inventory extraction uses one LLM call

  await addPlanningLog(task.id, `✅ Inventory extracted: ${getInventorySummary(inventory)}`);
  await addPlanningLog(task.id, `📊 Dual Score: Scope=${dualScore.scope}/100 (${getScopeLevel(dualScore.scopeRaw)}), Risk=${dualScore.risk}/100 (${getRiskLevel(dualScore.riskRaw)})`);
  await addPlanningLog(task.id, `🎯 Target: ${dualScore.targetStories} stories, Decompose: ${dualScore.shouldDecompose ? "Yes" : "No"}`);

  // Log trivial ticket detection result
  const trivialCheck = detectTrivialTicket(inventory, dualScore.scopeRaw, dualScore.riskRaw);
  if (trivialCheck.isTrivial) {
    await addPlanningLog(task.id, `⚡ Trivial ticket detected: ${trivialCheck.reason}`);
    await addPlanningLog(task.id, `   Items: ${trivialCheck.details.totalItems} (${trivialCheck.details.journeys}J/${trivialCheck.details.uiSurfaces}UI/${trivialCheck.details.apiEndpoints}API/${trivialCheck.details.entities}E)`);
  } else if (!dualScore.shouldDecompose) {
    await addPlanningLog(task.id, `📋 Single story (standard threshold): ${trivialCheck.reason}`);
  }

  // Check for blocking unknowns - if found, pause planning and request human input
  const blockingUnknowns = inventory.unknowns.filter(u => u.blocking);
  if (blockingUnknowns.length > 0) {
    await addPlanningLog(task.id, `⚠️ ${blockingUnknowns.length} blocking unknown(s) found - pausing planning for human input:`);
    for (const unknown of blockingUnknowns) {
      await addPlanningLog(task.id, `   - ${unknown.question}`);
    }

    // Build a clarification comment for Jira
    const clarificationComment = [
      `🛑 *Planning Paused - Clarification Needed*`,
      ``,
      `The planning agent identified ${blockingUnknowns.length} question(s) that need to be answered before planning can continue:`,
      ``,
      ...blockingUnknowns.map((u, i) => `${i + 1}. ${u.question}`),
      ``,
      `---`,
      `*Please reply to this comment with answers to unblock planning.*`,
      ``,
      `Once clarified, remove and re-add the \`workermill\` label to retry planning.`,
    ].join("\n");

    // Post clarification request to Jira
    if (task.jiraIssueKey) {
      const posted = await postTicketComment(task.orgId, task.jiraIssueKey, clarificationComment);
      if (posted) {
        await addPlanningLog(task.id, `📝 Posted clarification request to Jira`);
      } else {
        await addPlanningLog(task.id, `⚠️ Failed to post clarification request to Jira`);
      }
    }

    // Update task status to escalated (needs clarification) — atomic update
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({
        status: "escalated",
        planStatus: null,
      } as Record<string, unknown>)
      .where("id = :id", { id: task.id })
      .execute();
    await addPlanningLog(task.id, `⏸️ Task escalated - waiting for human input`);

    // Return a blocked plan that indicates planning cannot proceed
    const elapsedMs = Date.now() - startTime;
    return {
      version: 2,
      strategy: "multi",
      reasoning: `Planning blocked by ${blockingUnknowns.length} unanswered question(s). Please provide clarification in Jira.`,
      qualityGates: [],
      themes: [],
      stories: [],
      qualityScore: {
        completeness: 0,
        ordering: 0,
        balance: 0,
        storyScores: [],
        overall: 0,
        suggestions: [],
        blockers: blockingUnknowns.map(u => `Blocking unknown: ${u.question}`),
      },
      planningMetadata: {
        llmCalls,
        planningDurationMs: elapsedMs,
        themeExtractionModel: "N/A (blocked)",
        storyDecompositionModel: "N/A (blocked)",
        inventoryExtractionModel: (task.organization as { planningAgentModel?: string })?.planningAgentModel || "",
      },
    } as ExecutionPlanV2;
  }

  // -------------------------------------------------------------------------
  // STEP 3: Build artifact dependency graph
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🔧 Building artifact dependency graph...`);
  const artifactGraph = buildArtifactGraph(inventory);
  await addPlanningLog(task.id, `✅ Generated ${artifactGraph.nodes.length} artifacts in ${artifactGraph.mutexGroups.size} mutex groups`);

  // -------------------------------------------------------------------------
  // STEP 4: Use existing V2 planning with V3 scoring
  // -------------------------------------------------------------------------
  // We use the V2 theme extraction and story decomposition, but pass
  // the V3 dual score for better guidance

  // -------------------------------------------------------------------------
  // V5: Log action registry metrics
  // -------------------------------------------------------------------------
  const hasV5Actions = inventory.actions && inventory.actions.length > 0;
  if (hasV5Actions) {
    await addPlanningLog(task.id, `🎯 V5 Action Registry: ${inventory.actions.length} atomic actions extracted`);
    if (inventory.actionMetrics) {
      const byType = Object.entries(inventory.actionMetrics.byType)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${type}:${count}`)
        .join(", ");
      await addPlanningLog(task.id, `   Action types: ${byType}`);
      await addPlanningLog(task.id, `   Implicit actions expanded: ${inventory.actionMetrics.implicitCount}`);
    }
  }

  await addPlanningLog(task.id, `🎯 Phase 1: Extracting themes from PRD...`);

  let themes: PlanningTheme[] = [];
  let prdRequirements: string[] = [];

  try {
    // V5: Pass actions to enable action-anchored theme extraction
    const themeResult = await extractThemes(
      {
        jiraKey: task.jiraIssueKey || "Unknown",
        summary: task.summary || "",
        description: task.description || "",
        labels: (task.jiraFields?.labels as string[] | undefined) || [],
        repo: task.githubRepo || "",
        codebaseContext,
      },
      legacyScore,
      hasV5Actions ? inventory.actions : undefined
    );
    llmCalls++;

    themes = themeResult.themes;
    prdRequirements = themeResult.prdRequirements;

    await addPlanningLog(task.id, `✅ Extracted ${themes.length} themes:`);
    for (const theme of themes) {
      const actionCount = theme.ownedActionIds?.length || 0;
      const actionInfo = hasV5Actions ? ` [${actionCount} actions]` : "";
      await addPlanningLog(task.id, `   ${theme.id}: ${theme.name} (${theme.category})${actionInfo}`);
    }
  } catch (error) {
    logger.error("Theme extraction failed", { taskId: task.id, error });
    await addPlanningLog(task.id, `⚠️ Theme extraction failed, using default structure`);
    themes = [createDefaultFoundationTheme()];
  }

  // -------------------------------------------------------------------------
  // STEP 5: Decompose themes into stories
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `📝 Phase 2: Decomposing ${themes.length} themes into stories...`);

  const storiesByTheme = new Map<string, Omit<PlannedStoryV2, "canonicalOrder">[]>();
  const processedThemes: PlanningTheme[] = [];
  const processedStories: PlannedStoryV2[] = [];

  for (const theme of themes) {
    await addPlanningLog(task.id, `   Decomposing ${theme.id}: ${theme.name}...`);

    // V5: Extract theme-specific actions for action clustering
    let themeActions:
      | Array<{ id: string; description: string; type: string; subsystem?: string }>
      | undefined;

    if (hasV5Actions && theme.ownedActionIds && theme.ownedActionIds.length > 0) {
      themeActions = theme.ownedActionIds
        .map((actionId) => {
          const action = inventory.actions.find((a) => a.id === actionId);
          if (!action) return null;
          return {
            id: action.id,
            description: action.description,
            type: action.type,
            subsystem: action.subsystem,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
    }

    try {
      const result = await decomposeTheme({
        theme,
        prdContext: {
          jiraKey: task.jiraIssueKey || "Unknown",
          summary: task.summary || "",
          description: task.description || "",
          labels: (task.jiraFields?.labels as string[] | undefined) || [],
        },
        codebaseContext,
        priorContext: {
          themes: processedThemes,
          stories: processedStories,
        },
        // V4: Pass inventory for canonical entity IDs
        inventory: {
          entities: inventory.entities.map((e, idx) => ({
            name: e.name,
            id: `ENT-${idx}`,
          })),
        },
        // V5: Pass theme-specific actions for action clustering
        themeActions,
      });
      llmCalls++;

      storiesByTheme.set(theme.id, result.stories);

      // Update processed context
      processedThemes.push(theme);
      for (const story of result.stories) {
        processedStories.push({ ...story, canonicalOrder: processedStories.length });
      }

      const actionsCovered = result.stories.reduce(
        (sum, s) => sum + (s.coveredActionIds?.length || 0),
        0
      );
      const actionInfo =
        hasV5Actions && themeActions ? ` (${actionsCovered}/${themeActions.length} actions)` : "";
      await addPlanningLog(
        task.id,
        `   ✅ ${theme.id}: ${result.stories.length} stories${actionInfo}`
      );
    } catch (error) {
      logger.error("Story decomposition failed for theme", {
        taskId: task.id,
        themeId: theme.id,
        error,
      });
      await addPlanningLog(task.id, `   ⚠️ ${theme.id}: Decomposition failed, using default`);

      if (theme.category === "foundation") {
        storiesByTheme.set(theme.id, [{ ...createDefaultFoundationStory() }]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // STEP 6: Assemble final plan with mutex groups
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🔧 Phase 3: Assembling plan with mutex groups...`);

  let allStories = assembleFinalPlan(themes, storiesByTheme);

  // -------------------------------------------------------------------------
  // STEP 6.5: V4 Canonical ID processing (hallucination guard + ID-based deps)
  // -------------------------------------------------------------------------
  // First, sanitize entity references to remove any hallucinated entity IDs
  const { stories: sanitizedStories, droppedCount } = sanitizeEntityReferences(allStories, inventory);
  allStories = sanitizedStories;

  if (droppedCount > 0) {
    await addPlanningLog(task.id, `   🛡️ Hallucination guard: dropped ${droppedCount} invalid entity references`);
  }

  // Then, apply deterministic ID-based dependency patching
  const idBasedResult = applyIdBasedDependencies(allStories);

  if (idBasedResult.edgesAdded > 0) {
    await addPlanningLog(task.id, `   🔗 ID-based deps: added ${idBasedResult.edgesAdded} edges from entity provides/requires`);
  }

  // Log any warnings detected
  if (idBasedResult.duplicateProviders.length > 0) {
    await addPlanningLog(
      task.id,
      `   ⚠️ Duplicate providers: ${idBasedResult.duplicateProviders.map((d) => d.entityId).join(", ")}`,
    );
  }

  if (idBasedResult.orphans.length > 0) {
    await addPlanningLog(
      task.id,
      `   ❌ Orphan entities (required but never provided): ${idBasedResult.orphans.map((o) => o.entityId).join(", ")}`,
    );
  }

  allStories = idBasedResult.stories;

  // Assign mutex groups from artifact graph to stories
  const mutexGroupsMap: Record<string, number[]> = {};
  for (let i = 0; i < allStories.length; i++) {
    const story = allStories[i];

    // Find artifact nodes that match this story's subsystems/target files
    const matchingArtifacts = artifactGraph.nodes.filter(node =>
      story.targetFiles?.some(f => node.subsystems.some(s => f.toLowerCase().includes(s))) ||
      node.subsystems.some(s => story.persona?.includes(s.replace("_", "")))
    );

    // Collect mutex groups from matching artifacts
    const storyMutexGroups: string[] = [];
    for (const artifact of matchingArtifacts) {
      for (const group of artifact.mutexGroups) {
        if (!storyMutexGroups.includes(group)) {
          storyMutexGroups.push(group);
        }
      }
    }

    // Assign to story
    story.mutexGroups = storyMutexGroups;

    // Update mutex groups map
    for (const group of storyMutexGroups) {
      if (!mutexGroupsMap[group]) {
        mutexGroupsMap[group] = [];
      }
      mutexGroupsMap[group].push(i);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 7: Validate and score the plan
  // -------------------------------------------------------------------------
  const validationReport = validatePlanV2(themes, allStories, true);
  const qualityScore = scorePlan(themes, allStories, prdRequirements);

  if (validationReport.autoFixesApplied > 0) {
    await addPlanningLog(task.id, `🔧 Applied ${validationReport.autoFixesApplied} auto-fixes`);
  }

  await addPlanningLog(task.id, `📊 Quality Score: ${qualityScore.overall.toFixed(1)}/5`);

  // -------------------------------------------------------------------------
  // STEP 7.5: V5 Action Coverage Validation
  // -------------------------------------------------------------------------
  let coverageReport = null;
  if (hasV5Actions && inventory.actions.length > 0) {
    await addPlanningLog(task.id, `📋 V5: Validating action coverage...`);

    coverageReport = validatePlanCoverage(inventory.actions, allStories, dualScore.targetStories);

    await addPlanningLog(task.id, `   ${coverageReport.summary}`);

    if (coverageReport.health === "unhealthy") {
      await addPlanningLog(task.id, `   ⚠️ Coverage issues found:`);
      for (const issue of coverageReport.issues.slice(0, 5)) {
        await addPlanningLog(task.id, `      - ${issue}`);
      }
    }

    if (coverageReport.recommendations.length > 0) {
      await addPlanningLog(task.id, `   📝 Recommendations:`);
      for (const rec of coverageReport.recommendations.slice(0, 3)) {
        await addPlanningLog(task.id, `      - ${rec}`);
      }
    }

    // Log monolith stories (danger zone)
    const monoliths = coverageReport.storyChecks.filter((c) => c.status === "monolith");
    if (monoliths.length > 0) {
      await addPlanningLog(
        task.id,
        `   🔥 DANGER: ${monoliths.length} monolith stories need splitting!`
      );
    }
  }

  // -------------------------------------------------------------------------
  // STEP 8: Enforce file dependencies
  // -------------------------------------------------------------------------
  const planForFileDeps: ExecutionPlan = {
    strategy: "multi",
    reasoning: "V3 inventory-based planning",
    stories: allStories as PlannedStory[],
    qualityGates: ["All tests pass", "No TypeScript errors", "Code review approved"],
  };

  const validatedPlan = enforceFileDependencies(planForFileDeps);
  let finalStories = validatedPlan.stories as PlannedStoryV2[];

  // -------------------------------------------------------------------------
  // STEP 8.5: Semantic dependency auditor (feature-flagged)
  // -------------------------------------------------------------------------
  let dependencyAuditResult: DependencyAuditResult | null = null;
  const org = task.organization as { enableDependencyAuditor?: boolean } | undefined;
  const auditorEnabled = isAuditorEnabled(org);
  const shadowMode = isAuditorShadowMode();

  if (auditorEnabled) {
    await addPlanningLog(task.id, `🔍 Step 8.5: Running semantic dependency auditor${shadowMode ? " (shadow mode)" : ""}...`);

    try {
      dependencyAuditResult = await auditDependencies(finalStories, {
        themes,
        inventory,
        taskId: task.id,
        addsOnly: true, // Phase 1: only add missing deps, don't remove
        shadow: shadowMode,
      });

      // Log audit results
      const auditLogLines = formatAuditChangesForLog(dependencyAuditResult);
      for (const line of auditLogLines) {
        await addPlanningLog(task.id, `   ${line}`);
      }

      // Apply patches if auditor was applied (not shadow, had changes)
      if (dependencyAuditResult.applied) {
        const patchedStories = applyAuditToStories(finalStories, dependencyAuditResult);

        // Validate patched plan hasn't broken anything
        const patchedPlan = { ...validatedPlan, stories: patchedStories as PlannedStory[] };
        const revalidatedPlan = enforceFileDependencies(patchedPlan);
        const revalidatedStories = revalidatedPlan.stories as PlannedStoryV2[];

        // Check if revalidation changed anything (would indicate a problem)
        const revalidationMadChanges = revalidatedStories.some((s, i) =>
          JSON.stringify(s.dependencies) !== JSON.stringify(patchedStories[i].dependencies)
        );

        if (revalidationMadChanges) {
          logger.warn("dep_audit.revalidation_changed_deps", {
            taskId: task.id,
            message: "Revalidation after audit changed dependencies - reverting to pre-audit",
          });
          await addPlanningLog(task.id, `   ⚠️ Audit reverted: post-validation detected inconsistency`);
          dependencyAuditResult.applied = false;
          dependencyAuditResult.notAppliedReason = "revalidation_failed";
          dependencyAuditResult.metrics.postValidatePassed = false;
        } else {
          // Audit passed validation - use the patched stories
          finalStories = patchedStories;
          await addPlanningLog(task.id, `   ✅ Dependency audit applied: +${dependencyAuditResult.metrics.numAddedEdges} edges`);
        }
      } else if (shadowMode) {
        await addPlanningLog(task.id, `   📊 Shadow mode: ${dependencyAuditResult.metrics.numAddedEdges} additions logged (not applied)`);
      }
    } catch (error) {
      // Fail-open: audit failure doesn't block planning
      logger.error("dep_audit.exception", {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await addPlanningLog(task.id, `   ⚠️ Dependency auditor failed (continuing without): ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 9: Build final ExecutionPlanV2
  // -------------------------------------------------------------------------
  const durationMs = Date.now() - startTime;

  const executionPlanV2: ExecutionPlanV2 = {
    version: 2,
    strategy: "multi",
    reasoning: `V3 inventory-based planning: Scope=${dualScore.scope}, Risk=${dualScore.risk}, ${finalStories.length} stories`,
    primaryPersona: finalStories[0]?.persona || "backend_developer",
    themes,
    stories: finalStories,
    qualityGates: ["All tests pass", "No TypeScript errors", "Code review approved"],
    qualityScore,
    mutexGroups: mutexGroupsMap,
    planningMetadata: {
      llmCalls,
      planningDurationMs: durationMs,
      themeExtractionModel: THEME_EXTRACTION_MODEL,
      storyDecompositionModel: STORY_DECOMPOSITION_MODEL,
      inventoryExtractionModel: "claude-sonnet-4-6",
      dualScore: {
        scope: dualScore.scope,
        risk: dualScore.risk,
        shouldDecompose: dualScore.shouldDecompose,
        targetStories: dualScore.targetStories,
        scopeBreakdown: dualScore.scopeBreakdown,
        riskBreakdown: dualScore.riskBreakdown,
      },
      inventoryCounts: {
        journeys: inventory.journeys.length,
        uiSurfaces: inventory.uiSurfaces.length,
        apiEndpoints: inventory.apiEndpoints.length,
        entities: inventory.entities.length,
        integrations: inventory.integrations.length,
        migrations: inventory.migrations.length,
        nonFunctionals: inventory.nonFunctionals.length,
        unknowns: inventory.unknowns.length,
        subsystems: inventory.subsystems.length,
      },
      // Dependency auditor metrics (null if not enabled/run)
      dependencyAudit: dependencyAuditResult ? {
        enabled: dependencyAuditResult.metrics.enabled,
        shadow: dependencyAuditResult.metrics.shadow,
        addsOnly: dependencyAuditResult.metrics.addsOnly,
        applied: dependencyAuditResult.applied,
        confidence: dependencyAuditResult.confidence,
        numAddedEdges: dependencyAuditResult.metrics.numAddedEdges,
        numRemovedEdgesSuggested: dependencyAuditResult.metrics.numRemovedEdgesSuggested,
        guardrailsClamped: dependencyAuditResult.metrics.guardrailsClamped,
        postValidatePassed: dependencyAuditResult.metrics.postValidatePassed,
        durationMs: dependencyAuditResult.metrics.durationMs,
        // Debugging fields for verifying auditor behavior
        inputStoryOrderHash: dependencyAuditResult.metrics.inputStoryOrderHash,
        auditorPatchedKeys: dependencyAuditResult.metrics.auditorPatchedKeys,
        unknownKeysIgnored: dependencyAuditResult.metrics.unknownKeysIgnored,
        invalidDepsRemoved: dependencyAuditResult.metrics.invalidDepsRemoved,
      } : null,
    },
  };

  // Calculate cost estimate
  const workerModelV3 = task.workerModel || "";
  const costEstimate = estimatePlanCost(finalStories, workerModelV3);
  // Add per-story cost estimates
  addPerStoryCostEstimates(finalStories as PlannedStory[], workerModelV3);

  await addPlanningLog(task.id, `💰 Cost Estimate: ${costEstimate.totalPoints} points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`);

  // Log summary
  await addPlanningLog(task.id, `✅ Plan V3 created: ${finalStories.length} stories across ${themes.length} themes`);
  await addPlanningLog(task.id, `📊 LLM calls: ${llmCalls}, Duration: ${(durationMs / 1000).toFixed(1)}s`);
  await addPlanningLog(task.id, `🔒 Mutex groups: ${Object.keys(mutexGroupsMap).length}`);

  // Build a map of story warnings from coverage report
  const storyWarnings = new Map<number, { status: string; actionCount: number; message: string }>();
  if (coverageReport) {
    for (const check of coverageReport.storyChecks) {
      if (check.status !== "healthy") {
        storyWarnings.set(check.storyIndex, {
          status: check.status,
          actionCount: check.coveredActionCount,
          message: check.message,
        });
      }
    }
  }

  for (const story of finalStories) {
    const deps = story.dependencies.length > 0 ? ` (deps: ${story.dependencies.join(",")})` : "";
    const mutex = story.mutexGroups && story.mutexGroups.length > 0 ? ` [mutex: ${story.mutexGroups.length}]` : "";

    // Add warning context if story has coverage issues
    const warning = storyWarnings.get(story.canonicalOrder);
    let warningText = "";
    if (warning) {
      const icon = warning.status === "monolith" ? "🔥" : "⚠️";
      warningText = ` ${icon} ${warning.actionCount} actions - ${warning.message}`;
    }

    await addPlanningLog(task.id, `   ${story.canonicalOrder}. [${story.persona}] ${story.title}${deps}${mutex}${warningText}`);
  }

  await addPlanningLog(task.id, `⏳ Awaiting plan approval...`);

  // -------------------------------------------------------------------------
  // STEP 10: Store the plan
  // -------------------------------------------------------------------------
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...executionPlanV2,
    _complexity: legacyScore,
    _dualScore: dualScore,
    _inventory: {
      journeys: inventory.journeys.length,
      uiSurfaces: inventory.uiSurfaces.length,
      apiEndpoints: inventory.apiEndpoints.length,
      entities: inventory.entities.length,
      integrations: inventory.integrations.length,
      migrations: inventory.migrations.length,
      unknowns: inventory.unknowns.length,
    },
    _costEstimate: costEstimate,
  } as unknown as Record<string, unknown>;
  // Atomic update for plan approval status
  await taskRepo
    .createQueryBuilder()
    .update(WorkerTask)
    .set({
      planJson: task.planJson,
      planStatus: "pending_approval",
      status: "pending_plan_approval",
    } as Record<string, unknown>)
    .where("id = :id", { id: task.id })
    .execute();

  // Post to Jira (reuse V2 Jira posting since format is compatible)
  if (!isDryRun) {
    // Import and use the postPlanV2ToJira from planner-v2 would create a circular dep,
    // so we inline the Jira posting here
    await postPlanV3ToJira(task, executionPlanV2, qualityScore);
  } else {
    await addPlanningLog(task.id, `[DRY RUN] Would post plan to Jira`);
  }

  logger.info("Planning agent V3 completed", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    themeCount: themes.length,
    storyCount: finalStories.length,
    scope: dualScore.scope,
    risk: dualScore.risk,
    llmCalls,
    durationMs,
    qualityScore: qualityScore.overall,
  });

  return executionPlanV2;
}

/**
 * Post V3 plan to Jira as a comment (same format as V2)
 */
async function postPlanV3ToJira(
  task: WorkerTask,
  plan: ExecutionPlanV2,
  qualityScore: { overall: number; completeness: number; ordering: number; balance: number; blockers: string[]; suggestions: string[] }
): Promise<void> {
  const costEstimate = estimatePlanCost(
    plan.stories,
    task.workerModel || ""
  );

  const lines: string[] = [
    "[Project Manager - Execution Plan V2]",
    "",
    `Quality Score: ${qualityScore.overall.toFixed(1)}/5`,
    `  Completeness: ${qualityScore.completeness}/5 | Ordering: ${qualityScore.ordering}/5 | Balance: ${qualityScore.balance}/5`,
    "",
  ];

  if (costEstimate) {
    lines.push(
      `💰 Estimated Cost: ${costEstimate.totalPoints} story points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`,
      ""
    );
  }

  // List themes
  lines.push(`📁 Themes (${plan.themes.length}):`);
  for (const theme of plan.themes) {
    lines.push(`  ${theme.id}: ${theme.name} (${theme.category})`);
  }
  lines.push("");

  // List stories
  lines.push(`📝 Stories (${plan.stories.length}):`);
  for (const story of plan.stories) {
    const deps =
      story.dependencies.length > 0
        ? ` → depends on: ${story.dependencies.map((d) => `S${d}`).join(", ")}`
        : "";
    lines.push(`  S${story.canonicalOrder}: [${story.persona}] ${story.title}${deps}`);
  }
  lines.push("");

  // Quality warnings
  if (qualityScore.blockers.length > 0) {
    lines.push("⚠️ Quality Blockers:");
    for (const blocker of qualityScore.blockers) {
      lines.push(`  - ${blocker}`);
    }
    lines.push("");
  }

  if (qualityScore.suggestions.length > 0) {
    lines.push("💡 Suggestions:");
    for (const suggestion of qualityScore.suggestions.slice(0, 3)) {
      lines.push(`  - ${suggestion}`);
    }
    lines.push("");
  }

  lines.push("⏳ Awaiting plan approval in WorkerMill dashboard...");

  const comment = lines.join("\n");

  if (task.jiraIssueKey) {
    try {
      const success = await postTicketComment(task.orgId, task.jiraIssueKey, comment);
      if (success) {
        await addPlanningLog(task.id, "📝 Posted V3 execution plan to Jira");
      }
    } catch (error) {
      logger.warn("Failed to post V3 plan to Jira", { error, jiraKey: task.jiraIssueKey });
    }
  }
}
