/**
 * Planning Agent V2
 *
 * Multi-phase planning with theme extraction and per-theme story decomposition.
 */

import { Organization } from "../../models/Organization.js";
import { WorkerTask } from "../../models/WorkerTask.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { transitionJiraIssue } from "../../utils/jira.js";
import { postTicketComment } from "../../utils/ticket-comments.js";
import { enforceFileDependencies } from "../orchestrator-utils.js";
import {
  isExecutionPlanV2,
} from "../planning-types.js";
import type {
  ExecutionPlanV2,
  PlanningTheme,
  PlannedStoryV2,
  PlanQualityScore,
  ConsistencyReport,
  ConsistencyRunResult,
  ConsistencyDivergence,
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
import type { ExecutionPlan, PlannedStory } from "./types.js";
import { calculateComplexity } from "./complexity.js";
import { estimatePlanCost, addPerStoryCostEstimates } from "./cost-estimation.js";
import { fetchCodebaseContextForTask, addPlanningLog } from "./helpers.js";

/**
 * Run V2 multi-phase planning agent
 *
 * Uses structured theme extraction and per-theme story decomposition
 * for better quality on complex PRDs.
 */
export async function runPlanningAgentV2(task: WorkerTask): Promise<ExecutionPlanV2> {
  const startTime = Date.now();
  let llmCalls = 0;

  logger.info("Planning agent V2 starting analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
  });

  await addPlanningLog(task.id, `🔍 Planning Agent V2 analyzing PRD: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📋 Summary: ${task.summary || "No summary"}`);

  // Check for dry-run mode
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

  // Transition Jira ticket to "In Progress" when planning starts
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
      logger.warn("Failed to fetch codebase context", {
        taskId: task.id,
        repo: task.githubRepo,
        error,
      });
      await addPlanningLog(task.id, `⚠️ Could not fetch codebase context`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 1.5: Calculate complexity for story count guidance
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `📊 Calculating complexity score...`);

  const complexity = await calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || [],
    task.orgId
  );
  llmCalls++;

  // Accumulate complexity scoring tokens for cost tracking
  if (complexity.tokenUsage) {
    task.planningInputTokens = (task.planningInputTokens || 0) + complexity.tokenUsage.inputTokens;
    task.planningOutputTokens = (task.planningOutputTokens || 0) + complexity.tokenUsage.outputTokens;
  }

  await addPlanningLog(
    task.id,
    `   Score: ${complexity.totalScore}/12 → Target: ${complexity.targetStories.min}-${complexity.targetStories.max} stories`
  );

  // -------------------------------------------------------------------------
  // STEP 2: Extract themes from PRD (with complexity guidance)
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🎯 Phase 1: Extracting themes from PRD...`);

  let themes: PlanningTheme[] = [];
  let prdRequirements: string[] = [];

  try {
    const themeResult = await extractThemes({
      jiraKey: task.jiraIssueKey || "Unknown",
      summary: task.summary || "",
      description: task.description || "",
      labels: (task.jiraFields?.labels as string[] | undefined) || [],
      repo: task.githubRepo || "",
      codebaseContext,
    }, complexity);  // Pass complexity score for story count guidance

    themes = themeResult.themes;
    prdRequirements = themeResult.prdRequirements;
    llmCalls++;

    await addPlanningLog(task.id, `✅ Extracted ${themes.length} themes:`);
    for (const theme of themes) {
      await addPlanningLog(task.id, `   ${theme.id}: ${theme.name} (${theme.category})`);
    }
  } catch (error) {
    logger.error("Theme extraction failed", { taskId: task.id, error });
    await addPlanningLog(task.id, `⚠️ Theme extraction failed, using default structure`);

    // Create default foundation theme
    themes = [createDefaultFoundationTheme()];
  }

  // -------------------------------------------------------------------------
  // STEP 3: Decompose each theme into stories
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `📝 Phase 2: Decomposing ${themes.length} themes into stories...`);

  const storiesByTheme = new Map<string, Omit<PlannedStoryV2, "canonicalOrder">[]>();
  const processedThemes: PlanningTheme[] = [];
  const processedStories: PlannedStoryV2[] = [];

  for (const theme of themes) {
    await addPlanningLog(task.id, `   Decomposing ${theme.id}: ${theme.name}...`);

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
      });

      storiesByTheme.set(theme.id, result.stories);
      llmCalls++;

      // Update processed context for next iteration
      processedThemes.push(theme);
      for (const story of result.stories) {
        processedStories.push({ ...story, canonicalOrder: processedStories.length });
      }

      await addPlanningLog(task.id, `   ✅ ${theme.id}: ${result.stories.length} stories`);
    } catch (error) {
      logger.error("Story decomposition failed for theme", {
        taskId: task.id,
        themeId: theme.id,
        error,
      });
      await addPlanningLog(task.id, `   ⚠️ ${theme.id}: Decomposition failed, using default`);

      // Use default foundation story for foundation theme
      if (theme.category === "foundation") {
        const defaultStory = createDefaultFoundationStory();
        storiesByTheme.set(theme.id, [{ ...defaultStory }]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // STEP 4: Assemble final plan with canonical ordering
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🔧 Phase 3: Validating and assembling plan...`);

  const allStories = assembleFinalPlan(themes, storiesByTheme);

  // -------------------------------------------------------------------------
  // STEP 5: Validate and score the plan
  // -------------------------------------------------------------------------
  const validationReport = validatePlanV2(themes, allStories, true);
  const qualityScore = scorePlan(themes, allStories, prdRequirements);

  if (validationReport.autoFixesApplied > 0) {
    await addPlanningLog(
      task.id,
      `🔧 Applied ${validationReport.autoFixesApplied} auto-fixes`
    );
  }

  if (validationReport.criticalIssues.length > 0) {
    await addPlanningLog(task.id, `⚠️ Critical issues found:`);
    for (const issue of validationReport.criticalIssues) {
      await addPlanningLog(task.id, `   - ${issue}`);
    }
  }

  await addPlanningLog(
    task.id,
    `📊 Quality Score: ${qualityScore.overall.toFixed(1)}/5 (threshold: 3.5)`
  );
  await addPlanningLog(
    task.id,
    `   Completeness: ${qualityScore.completeness}/5, Ordering: ${qualityScore.ordering}/5, Balance: ${qualityScore.balance}/5`
  );

  // -------------------------------------------------------------------------
  // STEP 6: Enforce file-based dependencies
  // -------------------------------------------------------------------------
  const planForFileDeps: ExecutionPlan = {
    strategy: "multi",
    reasoning: "V2 multi-phase planning",
    stories: allStories as PlannedStory[],
    qualityGates: ["All tests pass", "No TypeScript errors", "Code review approved"],
  };

  const validatedPlan = enforceFileDependencies(planForFileDeps);
  const finalStories = validatedPlan.stories as PlannedStoryV2[];

  // Log file dependency additions
  const originalDepCount = allStories.reduce((sum, s) => sum + (s.dependencies?.length || 0), 0);
  const finalDepCount = finalStories.reduce((sum, s) => sum + (s.dependencies?.length || 0), 0);
  if (finalDepCount > originalDepCount) {
    await addPlanningLog(
      task.id,
      `📋 Added ${finalDepCount - originalDepCount} file-based dependencies`
    );
  }

  // -------------------------------------------------------------------------
  // STEP 7: Build final ExecutionPlanV2
  // -------------------------------------------------------------------------
  const durationMs = Date.now() - startTime;

  const executionPlanV2: ExecutionPlanV2 = {
    version: 2,
    strategy: "multi",
    reasoning: `V2 multi-phase planning: ${themes.length} themes, ${finalStories.length} stories`,
    primaryPersona: finalStories[0]?.persona || "backend_developer",
    themes,
    stories: finalStories,
    qualityGates: ["All tests pass", "No TypeScript errors", "Code review approved"],
    qualityScore,
    planningMetadata: {
      llmCalls,
      planningDurationMs: durationMs,
      themeExtractionModel: THEME_EXTRACTION_MODEL,
      storyDecompositionModel: STORY_DECOMPOSITION_MODEL,
    },
  };

  // Calculate cost estimate
  const workerModelV2 = task.workerModel || "";
  const costEstimate = estimatePlanCost(finalStories, workerModelV2);
  // Add per-story cost estimates
  addPerStoryCostEstimates(finalStories as PlannedStory[], workerModelV2);

  await addPlanningLog(
    task.id,
    `💰 Cost Estimate: ${costEstimate.totalPoints} points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`
  );

  // Log summary
  await addPlanningLog(task.id, `✅ Plan V2 created: ${finalStories.length} stories across ${themes.length} themes`);
  await addPlanningLog(task.id, `📊 LLM calls: ${llmCalls}, Duration: ${(durationMs / 1000).toFixed(1)}s`);

  for (const story of finalStories) {
    const deps = story.dependencies.length > 0 ? ` (deps: ${story.dependencies.join(",")})` : "";
    await addPlanningLog(
      task.id,
      `   ${story.canonicalOrder}. [${story.persona}] ${story.title}${deps}`
    );
  }

  await addPlanningLog(task.id, `⏳ Awaiting plan approval...`);

  // -------------------------------------------------------------------------
  // STEP 8: Store the plan
  // -------------------------------------------------------------------------
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...executionPlanV2,
    _complexity: complexity,  // Store for audit/debugging
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

  // Post to Jira (skip in dry-run mode)
  if (!isDryRun) {
    await postPlanV2ToJira(task, executionPlanV2, qualityScore);
  } else {
    await addPlanningLog(task.id, `[DRY RUN] Would post plan to Jira`);
  }

  logger.info("Planning agent V2 completed", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    themeCount: themes.length,
    storyCount: finalStories.length,
    llmCalls,
    durationMs,
    qualityScore: qualityScore.overall,
  });

  return executionPlanV2;
}

/**
 * Post V2 plan to Jira as a comment
 */
async function postPlanV2ToJira(
  task: WorkerTask,
  plan: ExecutionPlanV2,
  qualityScore: PlanQualityScore
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
        await addPlanningLog(task.id, "📝 Posted V2 execution plan to Jira");
      }
    } catch (error) {
      logger.warn("Failed to post V2 plan to Jira", { error, jiraKey: task.jiraIssueKey });
    }
  }
}

/**
 * Run consistency test on V2 planning
 *
 * Runs the same PRD through planning multiple times to check for variance.
 */
export async function runConsistencyTest(
  task: WorkerTask,
  runs: number = 5
): Promise<ConsistencyReport> {
  logger.info("Starting consistency test", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    runs,
  });

  await addPlanningLog(task.id, `🧪 Running consistency test (${runs} runs)...`);

  const results: ConsistencyRunResult[] = [];

  // Run planning multiple times
  for (let i = 0; i < runs; i++) {
    await addPlanningLog(task.id, `   Run ${i + 1}/${runs}...`);

    // Fetch codebase context (same for all runs)
    let codebaseContext = {
      fileTree: "Unable to fetch",
      readme: null as string | null,
      techStack: null as Record<string, unknown> | null,
    };

    if (task.githubRepo && i === 0) {
      // Only fetch once
      try {
        codebaseContext = await fetchCodebaseContextForTask(task.githubRepo, task.orgId);
      } catch (err) {
        console.error("[planner-v2] codebase context fetch failed:", err instanceof Error ? err.message : err);
      }
    }

    try {
      // Extract themes
      const themeResult = await extractThemes({
        jiraKey: task.jiraIssueKey || "Unknown",
        summary: task.summary || "",
        description: task.description || "",
        labels: (task.jiraFields?.labels as string[] | undefined) || [],
        repo: task.githubRepo || "",
        codebaseContext,
      });

      // Decompose themes
      const storiesByTheme = new Map<string, Omit<PlannedStoryV2, "canonicalOrder">[]>();
      for (const theme of themeResult.themes) {
        const result = await decomposeTheme({
          theme,
          prdContext: {
            jiraKey: task.jiraIssueKey || "Unknown",
            summary: task.summary || "",
            description: task.description || "",
            labels: (task.jiraFields?.labels as string[] | undefined) || [],
          },
          codebaseContext,
        });
        storiesByTheme.set(theme.id, result.stories);
      }

      // Assemble plan
      const stories = assembleFinalPlan(themeResult.themes, storiesByTheme);
      const qualityScore = scorePlan(themeResult.themes, stories);

      results.push({
        runNumber: i + 1,
        themes: themeResult.themes,
        stories,
        qualityScore,
      });
    } catch (error) {
      logger.error("Consistency test run failed", { run: i + 1, error });
      // Continue with other runs
    }
  }

  // Compare results
  const divergences: ConsistencyDivergence[] = [];
  const baseline = results[0];

  if (!baseline) {
    return {
      taskId: task.id,
      jiraKey: task.jiraIssueKey || "Unknown",
      totalRuns: runs,
      consistentRuns: 0,
      divergences: [],
      rootCauses: ["All runs failed"],
      recommendations: ["Check PRD content and retry"],
      report: "Consistency test failed - no successful runs",
    };
  }

  for (let i = 1; i < results.length; i++) {
    const result = results[i];

    // Compare theme count
    if (result.themes.length !== baseline.themes.length) {
      divergences.push({
        runNumber: i + 1,
        level: "theme",
        field: "count",
        expected: baseline.themes.length,
        actual: result.themes.length,
        description: `Theme count differs: ${baseline.themes.length} vs ${result.themes.length}`,
      });
    }

    // Compare theme names
    for (let j = 0; j < Math.min(baseline.themes.length, result.themes.length); j++) {
      if (baseline.themes[j].name !== result.themes[j].name) {
        divergences.push({
          runNumber: i + 1,
          level: "theme",
          field: `T${j}.name`,
          expected: baseline.themes[j].name,
          actual: result.themes[j].name,
          description: `Theme ${j} name differs`,
        });
      }
      if (baseline.themes[j].category !== result.themes[j].category) {
        divergences.push({
          runNumber: i + 1,
          level: "theme",
          field: `T${j}.category`,
          expected: baseline.themes[j].category,
          actual: result.themes[j].category,
          description: `Theme ${j} category differs`,
        });
      }
    }

    // Compare story count
    if (result.stories.length !== baseline.stories.length) {
      divergences.push({
        runNumber: i + 1,
        level: "story",
        field: "count",
        expected: baseline.stories.length,
        actual: result.stories.length,
        description: `Story count differs: ${baseline.stories.length} vs ${result.stories.length}`,
      });
    }

    // Compare story personas and order
    for (let j = 0; j < Math.min(baseline.stories.length, result.stories.length); j++) {
      if (baseline.stories[j].persona !== result.stories[j].persona) {
        divergences.push({
          runNumber: i + 1,
          level: "story",
          field: `S${j}.persona`,
          expected: baseline.stories[j].persona,
          actual: result.stories[j].persona,
          description: `Story ${j} persona differs`,
        });
      }
    }
  }

  // Determine consistency
  const consistentRuns =
    results.length -
    new Set(divergences.map((d) => d.runNumber)).size;

  // Analyze root causes
  const rootCauses: string[] = [];
  const recommendations: string[] = [];

  const themeDivergences = divergences.filter((d) => d.level === "theme");
  const storyDivergences = divergences.filter((d) => d.level === "story");

  if (themeDivergences.length > 0) {
    rootCauses.push("Theme extraction variance");
    recommendations.push("Add more specific section headers to PRD");
  }

  if (storyDivergences.some((d) => d.field.includes("persona"))) {
    rootCauses.push("Persona selection ambiguity");
    recommendations.push("Specify preferred personas in PRD");
  }

  if (storyDivergences.some((d) => d.field === "count")) {
    rootCauses.push("Story count variance");
    recommendations.push("Add clearer scope boundaries to PRD");
  }

  // Build report
  const reportLines: string[] = [
    `Consistency Report for PRD: ${task.jiraIssueKey}`,
    "═".repeat(50),
    `Runs: ${runs} | Consistent: ${consistentRuns}/${runs}`,
    "",
  ];

  if (divergences.length === 0) {
    reportLines.push("✅ All runs produced identical plans!");
  } else {
    reportLines.push("DIVERGENCES FOUND:");
    for (const div of divergences.slice(0, 10)) {
      reportLines.push(`  Run ${div.runNumber}: ${div.description}`);
    }
    if (divergences.length > 10) {
      reportLines.push(`  ... and ${divergences.length - 10} more`);
    }
    reportLines.push("");
    if (rootCauses.length > 0) {
      reportLines.push("ROOT CAUSES:");
      for (const cause of rootCauses) {
        reportLines.push(`  - ${cause}`);
      }
    }
    if (recommendations.length > 0) {
      reportLines.push("RECOMMENDATIONS:");
      for (const rec of recommendations) {
        reportLines.push(`  - ${rec}`);
      }
    }
  }

  const report = reportLines.join("\n");

  await addPlanningLog(
    task.id,
    `🧪 Consistency test complete: ${consistentRuns}/${runs} consistent`
  );

  logger.info("Consistency test completed", {
    taskId: task.id,
    totalRuns: runs,
    consistentRuns,
    divergenceCount: divergences.length,
  });

  return {
    taskId: task.id,
    jiraKey: task.jiraIssueKey || "Unknown",
    totalRuns: runs,
    consistentRuns,
    divergences,
    rootCauses,
    recommendations,
    report,
  };
}

/**
 * Determine whether to use V2 planning based on task labels.
 * V2 is now only used when explicitly requested (V3 is default for PRD/Epic).
 */
export function shouldUseV2Planning(task: WorkerTask): boolean {
  const labels = (task.jiraFields?.labels as string[] | undefined) || [];
  const normalizedLabels = labels.map((l) => l.toLowerCase());

  // V2 planning only for explicit opt-in (V3 now handles PRD/Epic by default)
  return normalizedLabels.includes("v2-planning");
}

/**
 * Check if a plan is V2 format
 */
export function isPlanV2(task: WorkerTask): boolean {
  if (!task.planJson) return false;
  return isExecutionPlanV2(task.planJson as unknown as ExecutionPlan | ExecutionPlanV2);
}

/**
 * Get V2 execution plan from a task
 */
export function getExecutionPlanV2(task: WorkerTask): ExecutionPlanV2 | null {
  if (!task.planJson) return null;
  const plan = task.planJson as unknown as ExecutionPlan | ExecutionPlanV2;
  if (isExecutionPlanV2(plan)) {
    return plan;
  }
  return null;
}
