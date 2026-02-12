/**
 * Planning Agent Complexity Scoring
 *
 * Complexity scoring system (v1 + v3), model selection, and formatting.
 */

import { generateText } from "ai";
import { Organization } from "../../models/Organization.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { getProviderCredentials } from "../../config/index.js";
import { extractInventory, getInventorySummary } from "../planning-inventory.js";
import { calculateDualScore, mapToLegacyComplexityScore, getScopeLevel, getRiskLevel, detectTrivialTicket } from "../planning-scoring.js";
import type { PRDInventory } from "../planning-inventory.js";
import type { DualScore } from "../planning-scoring.js";
import type { ComplexityScore } from "./types.js";
import { DEFAULT_PLANNING_CONFIG } from "./types.js";
import { getPlanningConfig } from "./config.js";
import { createModel } from "./config.js";
import { parseJsonResponse } from "./helpers.js";
import type { WorkerTask } from "../../models/WorkerTask.js";

// ============================================================================
// COMPLEXITY SCORING SYSTEM (LLM-Based with tool_use)
// ============================================================================
// Uses Claude with tool_use for structured, consistent scoring.
// No caching - true variance is visible. If scores vary, the prompt needs work.

const COMPLEXITY_SCORING_PROMPT = `You are a technical complexity scorer for AI worker tasks.

## YOUR TASK
Analyze the PRD/ticket below and score its complexity. Output your response as valid JSON.

## SCORING RUBRIC (MANDATORY)

Each dimension MUST be scored 1, 2, or 3. No decimals. No ranges. Exactly one integer.

### Features (how many DISTINCT features that require separate implementation?)
- **1** = Single feature or 1-2 very related items (e.g., "add a gallery page" is ONE feature even if it has multiple images)
- **2** = 2-3 truly separate features (e.g., gallery + search + favorites)
- **3** = 4+ distinct, unrelated features requiring different implementations

**IMPORTANT:** Multiple pages/items of the SAME type count as ONE feature. A gallery with 5 image pages = 1 feature. 10 similar API endpoints = 1 feature.

### Layers (what architecture layers are touched?)
- **1** = Single layer only (frontend-only HTML/CSS/JS, OR backend-only API, OR infra-only)
- **2** = Two layers that must integrate (e.g., backend API + database, frontend + existing API)
- **3** = Full stack NEW development (new frontend + new backend + new database schema)

### Files (estimated files to create or modify?)
- **1** = 1-2 files (trivial scope)
- **2** = 3-5 files (moderate scope)
- **3** = 6+ files across multiple directories (large scope)

### Clarity (how clear are the requirements?)
- **1** = Crystal clear: specific implementation details, patterns to follow
- **2** = Mostly clear: general direction known, some details to figure out
- **3** = Vague: significant investigation needed, undefined requirements

## SCORING EXAMPLES

**Simple (Score 4-6):**
- "Add image gallery page" → Features=1, Layers=1, Files=1, Clarity=1 = 4
- "Create 5 static HTML pages with CSS" → Features=1, Layers=1, Files=2, Clarity=1 = 5
- "Add search to existing list" → Features=1, Layers=1, Files=2, Clarity=2 = 6

**Moderate (Score 7-8):**
- "Add user dashboard with charts" → Features=2, Layers=2, Files=2, Clarity=2 = 8
- "Build REST API with 3 endpoints" → Features=1, Layers=2, Files=3, Clarity=2 = 8

**Complex (Score 9-12):**
- "Full auth system with OAuth, sessions, 2FA" → Features=3, Layers=3, Files=3, Clarity=2 = 11
- "E-commerce checkout with payments" → Features=3, Layers=3, Files=3, Clarity=3 = 12

## IMPORTANT
- Score based ONLY on what's in the ticket, not what you think should be added
- When unsure, pick the LOWER score (avoid over-engineering)
- A PRD label does NOT automatically mean high complexity - read the actual content
- Be consistent: same ticket content should always get same scores

## PRD/TICKET TO SCORE

**Summary:** {{SUMMARY}}

**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}

## OUTPUT FORMAT
Output ONLY valid JSON with this exact structure:
\`\`\`json
{
  "features": <1|2|3>,
  "layers": <1|2|3>,
  "files": <1|2|3>,
  "clarity": <1|2|3>,
  "reasoning": "<1-2 sentence explanation>"
}
\`\`\`
`;

/**
 * Calculate target story count based on complexity score
 *
 * Maps the 4-12 complexity score to appropriate story count ranges:
 * - Score 4-5 (Simple): 4-6 stories (single feature, one layer)
 * - Score 6-7 (Moderate): 6-10 stories (frontend gallery, moderate scope)
 * - Score 8-9 (Complex): 10-16 stories (full-stack feature)
 * - Score 10-12 (Very Complex): 15-25 stories (auth with OAuth, 2FA, sessions)
 */
export function calculateTargetStoryCount(totalScore: number): { min: number; target: number; max: number } {
  if (totalScore <= 5) return { min: 4, target: 5, max: 6 };
  if (totalScore <= 7) return { min: 6, target: 8, max: 10 };
  if (totalScore <= 9) return { min: 10, target: 13, max: 16 };
  return { min: 15, target: 20, max: 25 };
}

/**
 * Calculate complexity score using the org's configured AI provider.
 *
 * Uses generateText for consistent, explainable scoring across providers.
 * No caching - if scores vary, we need to improve the prompt.
 */
export async function calculateComplexity(
  summary: string,
  description: string,
  labels: string[],
  orgId: string
): Promise<ComplexityScore> {
  const allLabels = labels.map(l => l.toLowerCase());

  // Check for label overrides FIRST (these bypass LLM scoring)
  if (allLabels.includes("force-single")) {
    return {
      dimensions: { features: 1, layers: 1, files: 1, clarity: 1 },
      totalScore: 4,
      recommendation: "single",
      maxStories: 1,
      targetStories: { min: 1, target: 1, max: 1 },
      reasoning: "Label override: force-single applied",
      overrideApplied: "force-single",
    };
  }

  if (allLabels.includes("force-multi")) {
    const targetStories = calculateTargetStoryCount(11); // High complexity for force-multi
    return {
      dimensions: { features: 3, layers: 3, files: 3, clarity: 2 },
      totalScore: 11,
      recommendation: "multi",
      maxStories: 0, // 0 = unlimited, LLM determines based on PRD content
      targetStories,
      reasoning: "Label override: force-multi applied (unlimited stories)",
      overrideApplied: "force-multi",
    };
  }

  // Build the prompt
  const prompt = COMPLEXITY_SCORING_PROMPT
    .replace("{{SUMMARY}}", summary || "No summary provided")
    .replace("{{DESCRIPTION}}", description || "No description provided")
    .replace("{{LABELS}}", labels.length > 0 ? labels.join(", ") : "None");

  // Get planning config from org settings
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });
  const planningConfig = org ? getPlanningConfig(org) : DEFAULT_PLANNING_CONFIG;

  // Get org-specific API credentials (skip for ollama which doesn't need keys)
  const apiKey = planningConfig.provider === "ollama"
    ? ""
    : await getProviderCredentials(orgId, planningConfig.provider as "anthropic" | "openai" | "google");

  const model = createModel(planningConfig.provider, planningConfig.model, apiKey, planningConfig.ollamaBaseUrl);

  try {
    const response = await generateText({
      model,
      prompt,
      maxOutputTokens: 500,
      temperature: 0, // Deterministic output for repeatable plans
    });

    // Parse JSON from response
    const input = parseJsonResponse<{
      features: number;
      layers: number;
      files: number;
      clarity: number;
      reasoning: string;
    }>(response.text);

    // Validate and clamp each dimension to 1-3
    const dimensions = {
      features: Math.max(1, Math.min(3, Math.round(input.features))),
      layers: Math.max(1, Math.min(3, Math.round(input.layers))),
      files: Math.max(1, Math.min(3, Math.round(input.files))),
      clarity: Math.max(1, Math.min(3, Math.round(input.clarity))),
    };

    const totalScore = dimensions.features + dimensions.layers + dimensions.files + dimensions.clarity;

    // Calculate target story count based on complexity score
    const targetStories = calculateTargetStoryCount(totalScore);

    // Check for PRD labels (these always get multi-story treatment)
    const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
    const hasPrdLabel = allLabels.some(l => prdLabels.includes(l));
    const hasNoLimit = allLabels.includes("nolimit");

    // Determine recommendation based on total score and labels
    let recommendation: "single" | "multi";
    let maxStories: number;
    let reasoning: string;

    if (hasPrdLabel || totalScore >= 7) {
      // PRD or complex ticket: always multi
      recommendation = "multi";
      // Hard limit with buffer (1.5x max target), or unlimited with nolimit label
      maxStories = hasNoLimit ? 0 : Math.ceil(targetStories.max * 1.5);
      reasoning = hasPrdLabel
        ? `PRD/Epic ticket (${totalScore}/12): Target ${targetStories.min}-${targetStories.max} stories.`
        : `Complexity (${totalScore}/12): Target ${targetStories.min}-${targetStories.max} stories.`;
    } else {
      // 4-6: Single story, straightforward task
      recommendation = "single";
      maxStories = 1;
      reasoning = `Low complexity (${totalScore}/12): Single-story execution.`;
    }

    return {
      dimensions,
      totalScore,
      recommendation,
      maxStories,
      targetStories,
      reasoning: `${input.reasoning} ${reasoning}`,
      tokenUsage: {
        inputTokens: response.usage?.inputTokens || 0,
        outputTokens: response.usage?.outputTokens || 0,
      },
    };
  } catch (error) {
    // Fallback to safe single-story on any error
    logger.error("Complexity scoring failed, falling back to single", { error, summary });
    return {
      dimensions: { features: 2, layers: 1, files: 2, clarity: 2 },
      totalScore: 7,
      recommendation: "single",
      maxStories: 1,
      targetStories: { min: 1, target: 1, max: 1 },
      reasoning: `Scoring failed (fallback to single): ${error}`,
    };
  }
}

/**
 * Cost-optimized model selection
 *
 * Strategy: Default to Haiku. Only escalate if user explicitly opts in via label.
 * Opus is disabled by default and requires org permission.
 */
export function selectModelForTask(
  labels: string[],
  org: { allowSonnet: boolean; allowOpus: boolean }
): { model: string; tier: "haiku" | "sonnet" | "opus"; reason: string } {
  const normalizedLabels = labels.map(l => l.toLowerCase());

  // Check for explicit Opus request
  if (normalizedLabels.includes("opus")) {
    if (org.allowOpus) {
      return {
        model: "claude-opus-4-6",
        tier: "opus",
        reason: "User requested Opus via label (org permits)",
      };
    } else {
      // Org doesn't allow Opus, fall back to Sonnet if allowed
      if (org.allowSonnet) {
        return {
          model: "claude-sonnet-4-20250514",
          tier: "sonnet",
          reason: "User requested Opus but org disallows; falling back to Sonnet",
        };
      }
      // Fall through to Haiku
    }
  }

  // Check for explicit Sonnet request
  if (normalizedLabels.includes("sonnet")) {
    if (org.allowSonnet) {
      return {
        model: "claude-sonnet-4-20250514",
        tier: "sonnet",
        reason: "User requested Sonnet via label",
      };
    } else {
      return {
        model: "claude-haiku-4-5-20251001",
        tier: "haiku",
        reason: "User requested Sonnet but org disallows; using Haiku",
      };
    }
  }

  // Default: Always Haiku (cost-optimized)
  return {
    model: "claude-haiku-4-5-20251001",
    tier: "haiku",
    reason: "Default model (cost-optimized)",
  };
}

/**
 * Build complexity breakdown string for prompt
 */
export function formatComplexityBreakdown(score: ComplexityScore): string {
  const storyCountText = score.maxStories === 0
    ? "unlimited"
    : `max ${score.maxStories} stories`;

  const targetText = score.recommendation === "multi"
    ? `Target: ${score.targetStories.min}-${score.targetStories.max} stories (aim for ~${score.targetStories.target})`
    : "Single story execution";

  const lines = [
    `**Total Score:** ${score.totalScore}/12`,
    `**Recommendation:** ${score.recommendation.toUpperCase()} strategy (${storyCountText})`,
    `**${targetText}**`,
    "",
    "**Dimension Scores (1-3 each):**",
    `- Features: ${score.dimensions.features} (${score.dimensions.features === 1 ? "single" : score.dimensions.features === 2 ? "2-3 related" : "4+ distinct"})`,
    `- Layers: ${score.dimensions.layers} (${score.dimensions.layers === 1 ? "single layer" : score.dimensions.layers === 2 ? "two layers" : "full stack"})`,
    `- Files: ${score.dimensions.files} (${score.dimensions.files === 1 ? "1-2 files" : score.dimensions.files === 2 ? "3-5 files" : "6+ files"})`,
    `- Clarity: ${score.dimensions.clarity} (${score.dimensions.clarity === 1 ? "crystal clear" : score.dimensions.clarity === 2 ? "some ambiguity" : "needs investigation"})`,
  ];

  if (score.overrideApplied) {
    lines.push("");
    lines.push(`**Override:** ${score.overrideApplied} label applied`);
  }

  return lines.join("\n");
}

/**
 * Build complexity constraint string for prompt
 */
export function formatComplexityConstraint(score: ComplexityScore): string {
  if (score.recommendation === "single") {
    return `
⚠️ **CONSTRAINT: SINGLE-STORY EXECUTION REQUIRED**

Complexity Score: ${score.totalScore}/12 (threshold for multi-story: 7+)

You MUST use strategy "single" with ONE primaryPersona.
Do NOT create multiple stories for this task.
${score.reasoning}
`.trim();
  }

  // Multi-story execution with explicit target guidance
  return `
⚠️ **CONSTRAINT: MULTI-STORY EXECUTION**

Complexity Score: ${score.totalScore}/12
**TARGET: ${score.targetStories.min}-${score.targetStories.max} stories (aim for ~${score.targetStories.target})**

Your story count should match the PRD complexity:
- Score 4-5: ~5 stories (simple, single-layer)
- Score 6-7: ~8 stories (moderate, like a frontend feature)
- Score 8-9: ~13 stories (complex, full-stack)
- Score 10-12: ~20 stories (very complex, multiple integrations)

${score.reasoning}

**STORY SIZING RULES:**
- Each story MUST be ≤3 story points (Haiku-optimized)
- Each story should target ≤5 files

**DO NOT over-decompose.** Each story should be meaningful work, not trivial tasks.
A gallery feature with 5 pages should NOT become 20+ stories.
`.trim();
}

// ============================================================================
// V3 COMPLEXITY (INVENTORY-BASED DUAL SCORING)
// ============================================================================

/**
 * Calculate complexity using V3 inventory-based dual scoring.
 *
 * This extracts a structured inventory from the PRD and calculates
 * deterministic Scope and Risk scores, replacing the LLM-based 4-dimension
 * scoring for more reliable results.
 */
export async function calculateComplexityV3(
  summary: string,
  description: string,
  labels: string[],
  codebaseContext?: {
    fileTree?: string;
    readme?: string | null;
    techStack?: Record<string, unknown> | null;
  },
  options?: {
    storyCalibrationMultiplier?: number;
  }
): Promise<{
  inventory: PRDInventory;
  dualScore: DualScore;
  legacyScore: ComplexityScore;
}> {
  const allLabels = labels.map(l => l.toLowerCase());

  // Check for label overrides that bypass scoring
  if (allLabels.includes("force-single")) {
    const emptyInventory: PRDInventory = {
      journeys: [],
      uiSurfaces: [],
      apiEndpoints: [],
      entities: [],
      integrations: [],
      migrations: [],
      nonFunctionals: [],
      unknowns: [],
      subsystems: [],
      complexityFlags: [],
      actions: [], // V5: Empty actions for force-single override
    };
    const dualScore: DualScore = {
      scope: 10,
      risk: 5,
      scopeRaw: 10,
      riskRaw: 5,
      shouldDecompose: false,
      targetStories: 1,
      mandatoryStories: {
        spikeStories: 0,
        migrationStories: 0,
        integrationStories: 0,
        nfrStories: 0,
        total: 0,
      },
      scopeBreakdown: {},
      riskBreakdown: {},
      summary: "Label override: force-single applied",
    };
    return {
      inventory: emptyInventory,
      dualScore,
      legacyScore: mapToLegacyComplexityScore(dualScore),
    };
  }

  // Extract inventory from PRD using Sonnet
  logger.info("V3: Extracting inventory from PRD", { summary: summary.slice(0, 100) });
  const inventory = await extractInventory(summary, description, codebaseContext);

  // Calculate dual score from inventory (use org's calibration multiplier if provided)
  const dualScore = calculateDualScore(inventory, options?.storyCalibrationMultiplier);

  // Map to legacy score for backward compatibility
  const legacyScore = mapToLegacyComplexityScore(dualScore);

  // Override with force-multi if labeled
  if (allLabels.includes("force-multi")) {
    legacyScore.recommendation = "multi";
    legacyScore.maxStories = 0; // Unlimited
    legacyScore.reasoning = `Force-multi override. ${legacyScore.reasoning}`;
  }

  logger.info("V3 complexity calculation complete", {
    scope: dualScore.scope,
    risk: dualScore.risk,
    shouldDecompose: dualScore.shouldDecompose,
    targetStories: dualScore.targetStories,
    inventorySummary: getInventorySummary(inventory),
  });

  return { inventory, dualScore, legacyScore };
}

/**
 * Build the V3 complexity constraint string for prompts.
 * Uses dual scoring instead of the 4-dimension rubric.
 */
export function formatComplexityConstraintV3(dualScore: DualScore, inventory: PRDInventory): string {
  const scopeLevel = getScopeLevel(dualScore.scope);
  const riskLevel = getRiskLevel(dualScore.risk);

  if (!dualScore.shouldDecompose) {
    return `
⚠️ **CONSTRAINT: SINGLE-STORY EXECUTION REQUIRED**

Dual Score: Scope=${dualScore.scope}/100 (${scopeLevel}), Risk=${dualScore.risk}/100 (${riskLevel})

This PRD is small and low-risk. You MUST use strategy "single" with ONE primaryPersona.
Do NOT create multiple stories for this task.

${dualScore.summary}
`.trim();
  }

  // Multi-story execution
  const blockingUnknowns = inventory.unknowns.filter(u => u.blocking);

  let warningSection = "";
  if (blockingUnknowns.length > 0) {
    warningSection = `
⚠️ **BLOCKING UNKNOWNS DETECTED**
The following must be resolved (add spike stories):
${blockingUnknowns.map(u => `- ${u.question}`).join("\n")}
`;
  }

  return `
⚠️ **CONSTRAINT: MULTI-STORY EXECUTION**

Dual Score: Scope=${dualScore.scope}/100 (${scopeLevel}), Risk=${dualScore.risk}/100 (${riskLevel})
**TARGET: ${dualScore.targetStories} stories**

Inventory extracted from PRD:
- ${inventory.journeys.length} user journey(s)
- ${inventory.uiSurfaces.length} UI surface(s)
- ${inventory.apiEndpoints.length} API endpoint(s)
- ${inventory.entities.length} data entit(ies)
- ${inventory.integrations.length} integration(s)
- ${inventory.migrations.length} migration(s)
- Subsystems: ${inventory.subsystems.join(", ") || "none detected"}
${warningSection}
${dualScore.summary}

**STORY SIZING RULES:**
- Each story MUST be ≤3 story points (Haiku-optimized)
- Each story should target ≤5 files
- Create spike stories for blocking unknowns FIRST

**DO NOT over-decompose.** Each story should be meaningful work, not trivial tasks.
`.trim();
}

/**
 * Determine whether to use V3 planning based on task labels.
 * V3 planning uses inventory-based dual scoring and is appropriate for:
 * - PRD/Epic tickets (need comprehensive story decomposition)
 * - Tickets explicitly requesting V3 features
 */
export function shouldUseV3Planning(task: WorkerTask): boolean {
  const labels = (task.jiraFields?.labels as string[] | undefined) || [];
  const normalizedLabels = labels.map((l) => l.toLowerCase());

  // V3 planning is now the default for PRD/Epic tickets
  // These need inventory extraction and dual scoring for proper decomposition
  const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
  const hasPrdLabel = normalizedLabels.some((l) => prdLabels.includes(l));

  // Also allow explicit V3 opt-in
  const hasV3Label = normalizedLabels.includes("v3-planning") || normalizedLabels.includes("inventory-scoring");

  return hasPrdLabel || hasV3Label;
}
