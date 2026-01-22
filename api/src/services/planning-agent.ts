/**
 * Planning Agent Service
 *
 * Analyzes PRD tickets and creates execution plans.
 * Uses a fast model (Haiku) to determine whether a ticket needs
 * single-persona or multi-persona execution.
 *
 * This is NOT the worker that does the coding - it's a quick triage step
 * that runs before human approval.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Organization } from "../models/Organization.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { WorkerTaskLog } from "../models/WorkerTaskLog.js";
import { AppDataSource } from "../db/connection.js";
import { logger } from "../utils/logger.js";
import { postJiraComment, transitionJiraIssue, convertToEpic } from "../utils/jira.js";
import { fetchCodebaseContext } from "../utils/github.js";
import { enforceFileDependencies } from "./orchestrator.js";

// V3 Planning imports (inventory-based scoring)
import { extractInventory, getInventorySummary, PRDInventory } from "./planning-inventory.js";
import { calculateDualScore, mapToLegacyComplexityScore, DualScore, getRiskLevel, getScopeLevel } from "./planning-scoring.js";
import { buildArtifactGraph, ArtifactGraph } from "./planning-artifacts.js";

// Dependency auditor imports
import {
  auditDependencies,
  applyAuditToStories,
  formatAuditChangesForLog,
  isAuditorEnabled,
  isAuditorShadowMode,
  DependencyAuditResult,
} from "./planning-dependency-auditor.js";

/**
 * Helper to add a log entry visible in the dashboard
 */
async function addPlanningLog(taskId: string, message: string): Promise<void> {
  try {
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const log = logRepo.create({
      taskId,
      type: "system" as const,  // Planning logs use system type
      message,
      severity: "info" as const,
    });
    await logRepo.save(log);
  } catch (error) {
    logger.error("Failed to save planning log", { error, taskId });
  }
}

// Planning model - Sonnet 4.5 for high-quality planning
const PLANNING_MODEL = "claude-sonnet-4-5-20250929";

// Types matching the design doc
export interface PlanningInput {
  jiraKey: string;
  summary: string;
  description: string;
  labels: string[];
  repo: string;
  org: Organization;
}

export interface PlannedStory {
  index: number;
  title: string;
  persona: string;
  scope: string;
  acceptanceCriteria: string[];
  dependencies: number[];
  estimatedComplexity: "small" | "medium" | "large";
  // Cost-first fields (Haiku-optimized decomposition)
  storyPoints: number;           // 1-3 scale (max 3 for Haiku accuracy)
  targetFiles: string[];         // Files to modify (max 3 for Haiku)
  referenceFiles?: string[];     // Files to read for context/patterns
}

export interface ExecutionPlan {
  strategy: "single" | "multi";
  reasoning: string;
  primaryPersona?: string;
  stories?: PlannedStory[];
  qualityGates: string[];
}

// ============================================================================
// COMPLEXITY SCORING SYSTEM (LLM-Based with tool_use)
// ============================================================================
// Uses Claude with tool_use for structured, consistent scoring.
// No caching - true variance is visible. If scores vary, the prompt needs work.

export interface ComplexityScore {
  // 4-dimension rubric (each 1-3)
  dimensions: {
    features: number;    // 1=single, 2=2-3 related, 3=4+ features
    layers: number;      // 1=single layer, 2=two layers, 3=full stack
    files: number;       // 1=1-2 files, 2=3-5 files, 3=6+ files
    clarity: number;     // 1=crystal clear, 2=some ambiguity, 3=needs investigation
  };
  // Calculated values
  totalScore: number;    // 4-12 (sum of dimensions)
  // Recommendation
  recommendation: "single" | "multi";
  maxStories: number;
  // Target story count based on complexity
  targetStories: { min: number; target: number; max: number };
  reasoning: string;
  // Label override info
  overrideApplied?: "force-single" | "force-multi";
}

/**
 * Calculate target story count based on complexity score
 *
 * Maps the 4-12 complexity score to appropriate story count ranges:
 * - Score 4-5 (Simple): 4-6 stories (single feature, one layer)
 * - Score 6-7 (Moderate): 6-10 stories (frontend gallery, moderate scope)
 * - Score 8-9 (Complex): 10-16 stories (full-stack feature)
 * - Score 10-12 (Very Complex): 15-25 stories (auth with OAuth, 2FA, sessions)
 */
function calculateTargetStoryCount(totalScore: number): { min: number; target: number; max: number } {
  if (totalScore <= 5) return { min: 4, target: 5, max: 6 };
  if (totalScore <= 7) return { min: 6, target: 8, max: 10 };
  if (totalScore <= 9) return { min: 10, target: 13, max: 16 };
  return { min: 15, target: 20, max: 25 };
}

// Tool definition for structured complexity scoring
const COMPLEXITY_SCORING_TOOL: Anthropic.Tool = {
  name: "score_complexity",
  description: "Score the complexity of a PRD/ticket using a fixed 4-dimension rubric. Each dimension MUST be scored 1, 2, or 3. No other values are allowed.",
  input_schema: {
    type: "object" as const,
    properties: {
      features: {
        type: "number",
        description: "Feature count dimension. 1 = single feature or fix. 2 = 2-3 related features. 3 = 4+ distinct features.",
        enum: [1, 2, 3],
      },
      layers: {
        type: "number",
        description: "Architecture layers dimension. 1 = single layer (only backend OR only frontend OR only infra). 2 = two layers (e.g., backend + frontend). 3 = full stack (backend + frontend + database/infra).",
        enum: [1, 2, 3],
      },
      files: {
        type: "number",
        description: "Estimated file count dimension. 1 = 1-2 files. 2 = 3-5 files. 3 = 6+ files.",
        enum: [1, 2, 3],
      },
      clarity: {
        type: "number",
        description: "Requirements clarity dimension. 1 = crystal clear with specific files/patterns. 2 = some ambiguity, may need exploration. 3 = vague, needs significant investigation.",
        enum: [1, 2, 3],
      },
      reasoning: {
        type: "string",
        description: "Brief explanation (1-2 sentences) of why these scores were assigned.",
      },
    },
    required: ["features", "layers", "files", "clarity", "reasoning"],
  },
};

// Tool definition for structured execution plan output
// Using tool_use guarantees valid JSON and prevents parsing errors on large PRDs
const EXECUTION_PLAN_TOOL: Anthropic.Tool = {
  name: "submit_execution_plan",
  description: "Submit the execution plan for the PRD. You MUST call this tool with your complete plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      strategy: {
        type: "string",
        enum: ["single", "multi"],
        description: "Execution strategy: 'single' for one-persona tasks, 'multi' for tasks requiring multiple stories.",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation (1-2 sentences) of why this strategy was chosen.",
      },
      primaryPersona: {
        type: "string",
        description: "For single-strategy: the persona to execute the task. For multi-strategy: the primary/lead persona.",
        enum: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer", "security_engineer", "tech_writer"],
      },
      stories: {
        type: "array",
        description: "REQUIRED for multi-strategy. You MUST include this array with at least 1 story when strategy is 'multi'. Omitting this will cause the plan to be rejected.",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            index: {
              type: "number",
              description: "Story index (0-based). Used for dependency references.",
            },
            title: {
              type: "string",
              description: "Brief, descriptive title for the story.",
            },
            persona: {
              type: "string",
              enum: ["backend_developer", "frontend_developer", "devops_engineer", "qa_engineer", "security_engineer", "tech_writer"],
              description: "The persona best suited to implement this story.",
            },
            scope: {
              type: "string",
              description: "Clear description of what this story accomplishes.",
            },
            acceptanceCriteria: {
              type: "array",
              items: { type: "string" },
              description: "Specific, testable criteria that must be met for the story to be complete.",
            },
            dependencies: {
              type: "array",
              items: { type: "number" },
              description: "Array of story indices that must be merged before this story. Use [] for no dependencies (parallel execution).",
            },
            estimatedComplexity: {
              type: "string",
              enum: ["small", "medium", "large"],
              description: "Rough estimate of story complexity.",
            },
            storyPoints: {
              type: "number",
              enum: [1, 2, 3],
              description: "Story points (1-3). Each story MUST be ≤3 points for Haiku accuracy.",
            },
            targetFiles: {
              type: "array",
              items: { type: "string" },
              description: "Files this story will create or modify. MUST be real paths from the repository. Max 3 files per story.",
            },
            referenceFiles: {
              type: "array",
              items: { type: "string" },
              description: "Optional: Files to read for context/patterns but not modify.",
            },
          },
          required: ["index", "title", "persona", "scope", "acceptanceCriteria", "dependencies", "estimatedComplexity", "storyPoints", "targetFiles"],
        },
      },
      qualityGates: {
        type: "array",
        items: { type: "string" },
        description: "Quality checks that must pass before the plan is complete (e.g., 'All tests pass', 'No TypeScript errors').",
      },
    },
    required: ["strategy", "reasoning", "primaryPersona", "qualityGates"],
  },
};

const COMPLEXITY_SCORING_PROMPT = `You are a technical complexity scorer for AI worker tasks.

## YOUR TASK
Analyze the PRD/ticket below and score its complexity using the score_complexity tool.

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

Now call the score_complexity tool with your scores.`;

/**
 * Calculate complexity score using LLM with tool_use
 *
 * Uses Claude with structured output for consistent, explainable scoring.
 * No caching - if scores vary, we need to improve the prompt.
 */
export async function calculateComplexity(
  summary: string,
  description: string,
  labels: string[]
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

  // Call Claude with tool_use for structured output
  const anthropic = new Anthropic();

  try {
    const response = await anthropic.messages.create({
      model: PLANNING_MODEL,
      max_tokens: 500,
      temperature: 0, // Deterministic output for repeatable plans
      tools: [COMPLEXITY_SCORING_TOOL],
      tool_choice: { type: "tool", name: "score_complexity" },
      messages: [{ role: "user", content: prompt }],
    });

    // Extract tool use result
    const toolUse = response.content.find(c => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("LLM did not return tool_use response");
    }

    const input = toolUse.input as {
      features: number;
      layers: number;
      files: number;
      clarity: number;
      reasoning: string;
    };

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
        model: "claude-opus-4-20250514",
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
 * Estimate cost of an execution plan
 *
 * Based on story points and model selection. This is a rough estimate
 * for dashboard visibility and cost control purposes.
 */
export interface CostEstimate {
  totalPoints: number;
  costPerPoint: number;
  estimatedCost: number;
  model: string;
}

export function estimatePlanCost(
  stories: Array<{ storyPoints?: number } | undefined> | undefined,
  model: string
): CostEstimate {
  // Pricing per story point (in USD) - based on token estimates
  // Haiku: ~$0.80 per 1M input tokens, estimated 3K-5K tokens per point
  // Sonnet: ~$3 per 1M input tokens
  // Opus: ~$15 per 1M input tokens
  const costPerPoint: Record<string, number> = {
    "claude-haiku-4-5-20251001": 0.05,
    "claude-sonnet-4-20250514": 0.20,
    "claude-opus-4-20250514": 1.00,
  };

  const storyArray = Array.isArray(stories)
    ? stories.filter((s): s is { storyPoints?: number } => s !== undefined)
    : [];

  const totalPoints = storyArray.reduce((sum, s) => sum + (s.storyPoints || 2), 0);
  const perPoint = costPerPoint[model] || 0.05;

  return {
    totalPoints,
    costPerPoint: perPoint,
    estimatedCost: parseFloat((totalPoints * perPoint).toFixed(2)),
    model,
  };
}

const PLANNING_PROMPT = `You are a technical planning agent for WorkerMill. Analyze this PRD and create an execution plan.

## CRITICAL: COMPLEXITY CONSTRAINT

{{COMPLEXITY_CONSTRAINT}}

**YOU MUST FOLLOW THIS CONSTRAINT.** Your plan MUST align with the recommendation.

## Repository Structure and Context

This is the ACTUAL codebase you are working with. Use ONLY files that exist here.

### File Tree (2 levels)
\`\`\`
{{FILE_TREE}}
\`\`\`

### Tech Stack Detection
{{TECH_STACK}}

### Project Overview (README)
\`\`\`
{{README_SUMMARY}}
\`\`\`

**CRITICAL: targetFiles MUST be real paths from the File Tree above. Do NOT invent files.**

## Available Personas

| Persona | Expertise | Use When |
|---------|-----------|----------|
| backend_developer | APIs, databases, server logic, auth | Creating/modifying backend services |
| frontend_developer | UI, components, styling, client JS | Building user interfaces |
| devops_engineer | Infrastructure, CI/CD, deployment | Infrastructure changes |
| qa_engineer | Testing, E2E, test automation | Dedicated testing phase needed |
| security_engineer | Auth, encryption, vulnerability fixes | Security-critical features |
| tech_writer | Documentation, READMEs, API docs | Documentation deliverables |

## Planning Rules Based on Complexity

**For SINGLE-story tasks (score ≤6):**
- Use ONE persona that best fits the majority of the work
- Do NOT split into multiple stories
- If work touches multiple areas, pick the primary one

**For MULTI-story tasks (score 7+):**
- Analyze the PRD and create as many stories as needed to fully implement it
- **CRITICAL: Each story MUST be ≤3 story points** (Haiku-optimized)
- Each story should modify ≤3 files
- Order by dependencies (backend before frontend, etc.)

## Dependency Rules - CREATE NATURAL FLOW

**CRITICAL: The dependency graph must flow naturally. Tasks should chain together logically.**

### How Dependencies Work
- Each story runs on its own branch
- Dependencies control MERGE ORDER - Story B waits for Story A to merge first
- The orchestrator merges PRs in dependency order

### CREATE NATURAL DEPENDENCY CHAINS

**The dependency graph should look like a connected flow, not isolated islands.**

Good patterns:
- **Foundation → Features**: Story 0 (models) → Story 1-3 (features using models)
- **Backend → Frontend**: Story 1 (API) → Story 2 (UI that calls API)
- **Feature → Integration**: Story 2 (gallery) → Story 3 (lightbox for gallery)

Example of GOOD dependency flow:
- Story 0: Create data models - dependencies = [] (starting point)
- Story 1: Add API endpoints - dependencies = [0] (needs models)
- Story 2: Build list page - dependencies = [1] (needs API)
- Story 3: Add detail modal - dependencies = [2] (builds on list page)

### AVOID ORPHAN STORIES

**Every story (except the very first) should have at least one dependency.**

If a story has dependencies: [], ask yourself:
- Does it really have no connection to other work?
- Should it depend on a foundation/model story?
- Is it actually part of another story?

### PARALLEL WHERE APPROPRIATE

Multiple stories CAN depend on the same story (fan-out pattern):
- Story 0: Models - dependencies = []
- Story 1: Gallery feature - dependencies = [0]
- Story 2: Search feature - dependencies = [0]
- Story 3: User settings - dependencies = [0]

This creates parallel execution while maintaining natural flow.

## Acceptance Criteria Guidelines (CRITICAL)

Each acceptance criterion MUST be:
- **SPECIFIC**: Include exact endpoints, field names, status codes, parameter values
- **TESTABLE**: Can be verified with a concrete test (unit test, curl request, browser test)
- **MEASURABLE**: Include quantities where applicable (e.g., "rate limited to 5 attempts per minute")

### Guidelines by Type

**API Endpoints:**
- BAD: "Login endpoint works"
- GOOD: "POST /api/auth/login accepts { email: string, password: string } and returns 200 with { token: string, expiresIn: number, refreshToken: string }"
- BAD: "Handle errors"
- GOOD: "Return 401 with { error: 'Invalid credentials', code: 'AUTH_FAILED' } when password is incorrect"
- BAD: "Rate limiting works"
- GOOD: "Return 429 after 5 failed login attempts per IP within 5 minutes; reset counter after successful login or after 1 hour"

**Frontend Components:**
- BAD: "Form looks good"
- GOOD: "Form renders with: email input (type=email), password input (type=password, character limit 128), 'Log In' button, 'Forgot Password?' link, validation error messages below each field"
- BAD: "Handles submit"
- GOOD: "On form submit: disable button, show loading spinner, POST to /api/auth/login, on success redirect to /dashboard, on error display message in red below form"
- BAD: "Works on mobile"
- GOOD: "Form is responsive: ≤480px viewport shows single-column layout, inputs are minimum 44px height (touch target), no horizontal scroll"

**Database/Data:**
- BAD: "Save user data"
- GOOD: "Create users table with: id (PK, UUID), email (unique, not null), passwordHash (bcrypt, not null), createdAt (timestamp), updatedAt (timestamp)"
- BAD: "Password is secure"
- GOOD: "Hash passwords with bcrypt (rounds=12), store only hash in database, never log password"

**Testing:**
- BAD: "Tests pass"
- GOOD: "Unit tests cover: valid email+password returns token, invalid email returns 401, missing fields returns 400, SQL injection attempt returns 400, rate limiting blocks after N attempts"
- BAD: "Integration test"
- GOOD: "E2E test: create user in DB → POST /api/auth/login with credentials → verify JWT token is valid and claims include userId"

### Examples of BAD vs GOOD Criteria

**Story: Add user authentication**

❌ BAD acceptance criteria:
- "Login endpoint works"
- "Password is encrypted"
- "Tokens are created"
- "Tests pass"

✅ GOOD acceptance criteria:
- "POST /api/auth/login accepts application/json with { email, password }, validates both fields present"
- "Return 200 with { token, expiresIn: 3600, tokenType: 'Bearer' } for valid credentials"
- "Return 401 with { error: 'Invalid credentials' } for wrong password, don't leak if email exists"
- "Return 400 with { error: 'Email required' } if email missing, { error: 'Password required' } if password missing"
- "Hash passwords with bcrypt (rounds=12), never store plaintext"
- "JWT tokens expire after 1 hour (expiresIn: 3600); after expiry, POST /api/auth/refresh returns new token"
- "Unit tests: valid login, invalid password, missing email, missing password"
- "E2E test: create user → POST /api/auth/login → verify token decodes to correct userId"

## Story Sizing (CRITICAL - COST OPTIMIZATION)

**CONSTRAINT: Maximum 3 story points per story.**

All stories will execute on Haiku (cheapest model). To ensure high accuracy:
- Each story MUST be ≤3 points
- Each story should modify ≤3 files
- Each story should have clear, unambiguous acceptance criteria (see Acceptance Criteria Guidelines above)

### Point Scale (Haiku-Optimized)

| Points | Scope | Files | Example |
|--------|-------|-------|---------|
| 1 | Single file, trivial change | 1 | Fix typo, add field |
| 2 | Single file, clear logic | 1-2 | Add validation, simple endpoint |
| 3 | Multi-file, clear pattern | 2-3 | Feature with model + route |

### Decomposition Examples

❌ BAD: "Add user authentication" (8+ points, single story)
✅ GOOD: Split with natural flow:
  - Story 0: Add User model and migration (2 pts) - dependencies: []
  - Story 1: Add login endpoint (2 pts) - dependencies: [0]
  - Story 2: Add logout endpoint (1 pt) - dependencies: [0]
  - Story 3: Add JWT middleware (2 pts) - dependencies: [1]

❌ BAD: Orphan stories with no connections:
  - Story 0: dependencies: []
  - Story 1: dependencies: []  ← WRONG: orphan, no flow
  - Story 2: dependencies: []  ← WRONG: orphan, no flow
✅ GOOD: Natural dependency flow (fan-out pattern):
  - Story 0: Build data models - dependencies: []
  - Story 1: Add API endpoints - dependencies: [0]
  - Story 2: Build list page UI - dependencies: [0]
  - Story 3: Add detail modal - dependencies: [1, 2]

## PRD to Analyze

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}
**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}
**Repository:** {{REPO}}

## Complexity Analysis (Pre-Calculated)

{{COMPLEXITY_BREAKDOWN}}

## Output Instructions

**You MUST call the submit_execution_plan tool with your complete execution plan.**

**CRITICAL REQUIREMENTS:**
- For PRD/Epic tickets: You MUST use strategy "multi" with a "stories" array
- The "stories" array is REQUIRED for multi-strategy - never omit it
- Each story MUST include: index, title, persona, scope, acceptanceCriteria, dependencies, storyPoints (1-3), targetFiles

Guidelines:
- For single-persona strategy: set "strategy" to "single", include "primaryPersona", omit "stories"
- For multi-persona strategy: set "strategy" to "multi", MUST include "stories" array with at least 1 story
- **⚠️ targetFiles determines execution order.** Stories targeting the SAME FILE run sequentially. Stories targeting DIFFERENT files run in parallel.
- Always include "qualityGates" array with verification criteria

Now analyze the PRD and call the submit_execution_plan tool with your plan.`;

/**
 * Build complexity breakdown string for prompt
 */
function formatComplexityBreakdown(score: ComplexityScore): string {
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
function formatComplexityConstraint(score: ComplexityScore): string {
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
- Each story should target ≤3 files

**DO NOT over-decompose.** Each story should be meaningful work, not trivial tasks.
A gallery feature with 5 pages should NOT become 20+ stories.
`.trim();
}

/**
 * Run the Planning Agent on a task
 *
 * Analyzes the PRD and creates an execution plan, then stores it
 * in the task's planJson field and sets status to pending_plan_approval.
 */
export async function runPlanningAgent(task: WorkerTask): Promise<ExecutionPlan> {
  const startTime = Date.now();

  logger.info("Planning agent starting analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
  });

  // Log start - visible in dashboard
  await addPlanningLog(task.id, `🔍 Planning Agent analyzing PRD: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📋 Summary: ${task.summary || "No summary"}`);

  // Check for dry-run mode
  const labels = (task.jiraFields as Record<string, unknown>)?.labels;
  const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

  // Transition Jira ticket to "In Progress" when planning starts
  if (task.jiraIssueKey && !isDryRun) {
    const transitioned = await transitionJiraIssue(task.jiraIssueKey, "In Progress");
    if (transitioned) {
      await addPlanningLog(task.id, `📌 Jira ticket transitioned to In Progress`);
    }
  } else if (task.jiraIssueKey && isDryRun) {
    await addPlanningLog(task.id, `[DRY RUN] Would transition Jira ticket to In Progress`);
  }

  // -------------------------------------------------------------------------
  // STEP 1: Calculate complexity score (LLM-based with tool_use)
  // -------------------------------------------------------------------------
  const complexity = await calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || []
  );

  await addPlanningLog(task.id, `📊 Complexity Analysis:`);
  if (complexity.totalScore === 0) {
    // PRD ticket - scoring was skipped
    await addPlanningLog(task.id, `   Type: PRD/Epic (scoring skipped)`);
    await addPlanningLog(task.id, `   Strategy: MULTI (unlimited stories)`);
  } else {
    await addPlanningLog(task.id, `   Score: ${complexity.totalScore}/12`);
    const storyCountDesc = complexity.maxStories === 0 ? "unlimited" : `max ${complexity.maxStories}`;
    await addPlanningLog(task.id, `   Recommendation: ${complexity.recommendation.toUpperCase()} (${storyCountDesc} stories)`);
    await addPlanningLog(task.id, `   Dimensions: F=${complexity.dimensions.features} L=${complexity.dimensions.layers} Fi=${complexity.dimensions.files} C=${complexity.dimensions.clarity}`);
  }

  logger.info("Complexity score calculated", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    complexity,
  });

  // -------------------------------------------------------------------------
  // STEP 2: Fetch codebase context (file tree, README, tech stack)
  // -------------------------------------------------------------------------
  let codebaseContext = {
    fileTree: "Unable to fetch (no repository context)",
    readme: null as string | null,
    techStack: null as Record<string, unknown> | null,
  };

  if (task.githubRepo) {
    await addPlanningLog(task.id, `📚 Fetching codebase context from ${task.githubRepo}...`);
    try {
      codebaseContext = await fetchCodebaseContext(task.githubRepo);
      await addPlanningLog(task.id, `✅ Retrieved repository structure and metadata`);
    } catch (error) {
      logger.warn("Failed to fetch codebase context", {
        taskId: task.id,
        repo: task.githubRepo,
        error,
      });
      await addPlanningLog(task.id, `⚠️ Could not fetch codebase context (planning will proceed with basic info)`);
    }
  } else {
    await addPlanningLog(task.id, `⚠️ No repository specified - planning without codebase context`);
  }

  // Format tech stack info for prompt
  let techStackStr = "No tech stack detected";
  if (codebaseContext.techStack) {
    if (codebaseContext.techStack.type === "Node.js/JavaScript") {
      const deps = codebaseContext.techStack.dependencies as Record<string, unknown> | undefined;
      const devDeps = codebaseContext.techStack.devDependencies as Record<string, unknown> | undefined;
      const depKeys = deps ? Object.keys(deps).slice(0, 10).join(", ") : "";
      techStackStr = `Node.js/JavaScript project\nKey dependencies: ${depKeys}${devDeps ? " (+ dev deps)" : ""}`;
    } else if (codebaseContext.techStack.type === "Python") {
      techStackStr = `Python project (${codebaseContext.techStack.configFile as string})\nPreview: ${(codebaseContext.techStack.preview as string || "").slice(0, 200)}`;
    } else {
      techStackStr = JSON.stringify(codebaseContext.techStack, null, 2).slice(0, 500);
    }
  }

  const readmeSummary = codebaseContext.readme
    ? codebaseContext.readme.slice(0, 1500)
    : "No README found";

  // -------------------------------------------------------------------------
  // STEP 3: Build the prompt with complexity constraints and codebase context
  // -------------------------------------------------------------------------
  const prompt = PLANNING_PROMPT
    .replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
    .replace("{{SUMMARY}}", task.summary || "No summary")
    .replace("{{DESCRIPTION}}", task.description || "No description")
    .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
    .replace("{{REPO}}", task.githubRepo || "Not specified")
    .replace("{{COMPLEXITY_CONSTRAINT}}", formatComplexityConstraint(complexity))
    .replace("{{COMPLEXITY_BREAKDOWN}}", formatComplexityBreakdown(complexity))
    .replace("{{FILE_TREE}}", codebaseContext.fileTree)
    .replace("{{TECH_STACK}}", techStackStr)
    .replace("{{README_SUMMARY}}", readmeSummary)
    .replace(/\{\{MAX_STORIES\}\}/g, String(complexity.maxStories));

  // -------------------------------------------------------------------------
  // STEP 4: Call the AI with tool_use for guaranteed valid JSON
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🤖 Calling ${PLANNING_MODEL} for PRD analysis (with tool_use)...`);
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: PLANNING_MODEL,
    max_tokens: 16384, // No artificial limit - let model output full plan
    temperature: 0, // Deterministic output for repeatable plans
    tools: [EXECUTION_PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_execution_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool_use response - guaranteed valid JSON
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    await addPlanningLog(task.id, `❌ Planning agent did not return tool_use response`);
    throw new Error("Planning agent did not return tool_use response");
  }

  // -------------------------------------------------------------------------
  // STEP 5: Extract and validate the plan from tool_use input
  // -------------------------------------------------------------------------
  const plan = toolUse.input as ExecutionPlan;

  // Basic validation
  validatePlan(plan);

  // Validate against complexity constraints
  validatePlanMatchesComplexity(plan, complexity, task.id);

  // Log the plan details
  await addPlanningLog(task.id, `✅ Plan created: ${plan.strategy.toUpperCase()} strategy`);
  await addPlanningLog(task.id, `📝 Reasoning: ${plan.reasoning}`);

  if (plan.strategy === "single") {
    await addPlanningLog(task.id, `👤 Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    const maxDesc = complexity.maxStories === 0 ? "unlimited" : `${complexity.maxStories} max`;
    await addPlanningLog(task.id, `📚 Stories planned: ${plan.stories.length} (${maxDesc})`);
    for (const story of plan.stories) {
      await addPlanningLog(task.id, `  ${story.index + 1}. [${story.persona}] ${story.title}`);
    }
  }

  await addPlanningLog(task.id, `🚦 Quality Gates: ${plan.qualityGates.join(", ")}`);
  await addPlanningLog(task.id, `⏳ Awaiting plan approval...`);

  const durationMs = Date.now() - startTime;

  logger.info("Planning agent completed analysis", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    strategy: plan.strategy,
    primaryPersona: plan.primaryPersona,
    storyCount: plan.stories?.length || 0,
    complexityScore: complexity.totalScore,
    complexityDimensions: complexity.dimensions,
    complexityRecommendation: complexity.recommendation,
    durationMs,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  // Calculate cost estimate based on the plan
  let costEstimate = null;
  if (plan.strategy === "single") {
    // Single story with implied 2 points
    costEstimate = estimatePlanCost([{ storyPoints: 2 }], task.workerModel || "claude-haiku-4-5-20251001");
  } else if (plan.stories && plan.stories.length > 0) {
    costEstimate = estimatePlanCost(plan.stories, task.workerModel || "claude-haiku-4-5-20251001");
  }

  // Log cost estimate
  if (costEstimate) {
    await addPlanningLog(
      task.id,
      `💰 Cost Estimate: ${costEstimate.totalPoints} points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost} (${costEstimate.model})`
    );
  }

  // Enforce file-based dependencies BEFORE storing the plan
  // This ensures the UI shows accurate execution order for user approval
  const validatedPlan = enforceFileDependencies(plan);

  // Log if dependencies were added
  const originalDepCount = plan.stories?.reduce((sum: number, s: any) => sum + (s.dependencies?.length || 0), 0) || 0;
  const validatedDepCount = validatedPlan.stories?.reduce((sum: number, s: any) => sum + (s.dependencies?.length || 0), 0) || 0;
  if (validatedDepCount > originalDepCount) {
    await addPlanningLog(
      task.id,
      `📋 Added ${validatedDepCount - originalDepCount} file-based dependencies to prevent conflicts`
    );
  }

  // Store the validated plan in the task (include complexity score and cost estimate)
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...validatedPlan,
    _complexity: complexity, // Store for audit/debugging
    _costEstimate: costEstimate, // Store cost projection
  } as unknown as Record<string, unknown>;
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval";
  await taskRepo.save(task);

  // Post the validated plan to Jira (skip in dry-run mode)
  if (!isDryRun) {
    await postPlanToJira(task, validatedPlan, complexity);
  } else {
    await addPlanningLog(task.id, `[DRY RUN] Would post plan to Jira comment`);
    logger.info("[DRY RUN] Skipped posting plan to Jira", { taskId: task.id });
  }

  return plan;
}

/**
 * Format and post the execution plan to Jira
 */
async function postPlanToJira(
  task: WorkerTask,
  plan: ExecutionPlan,
  complexity: ComplexityScore
): Promise<void> {
  // Calculate cost estimate for Jira comment
  let costEstimate = null;
  if (plan.strategy === "single") {
    costEstimate = estimatePlanCost([{ storyPoints: 2 }], task.workerModel || "claude-haiku-4-5-20251001");
  } else if (plan.stories && plan.stories.length > 0) {
    costEstimate = estimatePlanCost(plan.stories, task.workerModel || "claude-haiku-4-5-20251001");
  }

  const lines: string[] = [
    "[Project Manager - Execution Plan]",
    "",
    `Complexity Score: ${complexity.totalScore}/12 (F:${complexity.dimensions.features} L:${complexity.dimensions.layers} Fi:${complexity.dimensions.files} C:${complexity.dimensions.clarity})`,
    "",
    `Strategy: ${plan.strategy.toUpperCase()} persona execution`,
    "",
    plan.reasoning,
    "",
  ];

  // Add cost estimate to Jira comment if available
  if (costEstimate) {
    lines.push(
      `💰 Estimated Cost: ${costEstimate.totalPoints} story points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`
    );
    lines.push("");
  }

  if (plan.strategy === "single") {
    lines.push(`Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    lines.push("Planned Stories:");
    for (const story of plan.stories) {
      const deps = story.dependencies.length > 0
        ? ` (depends on: ${story.dependencies.map(d => `Story ${d + 1}`).join(", ")})`
        : "";
      lines.push(`${story.index + 1}. [${story.persona}] ${story.title}${deps}`);
      lines.push(`   Scope: ${story.scope}`);
      lines.push(`   Complexity: ${story.estimatedComplexity}`);
    }
  }

  lines.push("");
  lines.push("Quality Gates:");
  for (const gate of plan.qualityGates) {
    lines.push(`- ${gate}`);
  }

  lines.push("");
  lines.push("⏳ Awaiting plan approval in WorkerMill dashboard...");

  const comment = lines.join("\n");

  if (task.jiraIssueKey) {
    try {
      const success = await postJiraComment(task.jiraIssueKey, comment);
      if (success) {
        await addPlanningLog(task.id, "📝 Posted execution plan to Jira");
      } else {
        await addPlanningLog(task.id, "⚠️ Could not post plan to Jira (non-critical)");
      }
    } catch (error) {
      logger.warn("Failed to post plan to Jira", { error, jiraKey: task.jiraIssueKey });
      await addPlanningLog(task.id, "⚠️ Could not post plan to Jira (non-critical)");
    }
  }
}

/**
 * Validate that the plan matches the complexity constraints
 *
 * If the AI ignored the constraints, we adjust the plan or warn.
 * Note: When maxStories is 0, it means unlimited (LLM determines count dynamically).
 */
async function validatePlanMatchesComplexity(
  plan: ExecutionPlan,
  complexity: ComplexityScore,
  taskId: string
): Promise<void> {
  // Check if AI followed the recommendation
  if (complexity.recommendation === "single" && plan.strategy === "multi") {
    // AI created multi-story for a simple task - just log info
    if (plan.stories) {
      logger.info("Plan chose multi-story for single recommendation", {
        taskId,
        recommendation: complexity.recommendation,
        planStrategy: plan.strategy,
        storyCount: plan.stories.length,
      });
      await addPlanningLog(taskId, `ℹ️ Note: AI chose multi-story (${plan.stories.length}) for low-complexity task`);
    }
  }

  if (complexity.recommendation === "multi" && plan.strategy === "single") {
    // AI chose single for a complex task - that's fine, it might be right
    logger.info("Plan chose single strategy for multi recommendation - accepted", {
      taskId,
      complexityScore: complexity.totalScore,
    });
  }

  // Enforce soft limit on story count (maxStories > 0 means limit is active)
  if (plan.strategy === "multi" && plan.stories && complexity.maxStories > 0) {
    if (plan.stories.length > complexity.maxStories) {
      const originalCount = plan.stories.length;
      // Truncate to the limit
      plan.stories = plan.stories.slice(0, complexity.maxStories);
      // Re-index stories after truncation
      plan.stories.forEach((story, idx) => {
        story.index = idx;
        // Remove any dependencies that now point to non-existent stories
        story.dependencies = story.dependencies.filter(dep => dep < complexity.maxStories);
      });
      logger.warn("Plan exceeded story limit, truncated", {
        taskId,
        originalCount,
        maxStories: complexity.maxStories,
        truncatedTo: plan.stories.length,
      });
      await addPlanningLog(
        taskId,
        `⚠️ Plan had ${originalCount} stories, truncated to ${complexity.maxStories} (soft limit). Add 'nolimit' label for unlimited stories.`
      );
    }
  }

  // Log story count for multi-story plans
  if (plan.strategy === "multi" && plan.stories) {
    logger.info("Multi-story plan created", {
      taskId,
      storyCount: plan.stories.length,
      maxStories: complexity.maxStories,
      complexityScore: complexity.totalScore,
    });
  }
}

// Note: parseExecutionPlan was removed - we now use tool_use which guarantees valid JSON

/**
 * Validate the execution plan
 */
function validatePlan(plan: ExecutionPlan): void {
  // Check required fields
  if (!plan.strategy || !["single", "multi"].includes(plan.strategy)) {
    throw new Error('Plan must have strategy "single" or "multi"');
  }

  if (!plan.reasoning) {
    throw new Error("Plan must have reasoning");
  }

  if (!plan.qualityGates || !Array.isArray(plan.qualityGates)) {
    throw new Error("Plan must have qualityGates array");
  }

  // Validate based on strategy
  if (plan.strategy === "single") {
    if (!plan.primaryPersona) {
      throw new Error("Single-persona plan must have primaryPersona");
    }
    // Validate persona is known
    const validPersonas = [
      "backend_developer",
      "frontend_developer",
      "devops_engineer",
      "qa_engineer",
      "security_engineer",
      "tech_writer",
      "project_manager",
    ];
    if (!validPersonas.includes(plan.primaryPersona)) {
      logger.warn("Unknown persona in plan", { persona: plan.primaryPersona });
    }
  } else if (plan.strategy === "multi") {
    if (!plan.stories || !Array.isArray(plan.stories) || plan.stories.length === 0) {
      throw new Error("Multi-persona plan must have stories array");
    }

    // Track all filtered dependencies for prominent logging
    const filteredDependencies: Array<{ storyIndex: number; storyTitle: string; original: number[]; filtered: number[]; removed: number[] }> = [];

    // Validate each story
    for (const story of plan.stories) {
      if (typeof story.index !== "number") {
        throw new Error("Story must have numeric index");
      }
      if (!story.title) {
        throw new Error("Story must have title");
      }
      if (!story.persona) {
        throw new Error("Story must have persona");
      }
      if (!story.acceptanceCriteria || !Array.isArray(story.acceptanceCriteria)) {
        throw new Error("Story must have acceptanceCriteria array");
      }
      if (!Array.isArray(story.dependencies)) {
        // Initialize empty dependencies if missing
        story.dependencies = [];
      }

      // Filter and validate dependencies - be lenient with AI output
      // Remove any non-numeric or invalid dependencies instead of failing
      const originalDeps = [...story.dependencies];
      const validDeps: number[] = [];
      const removedDeps: number[] = [];
      for (const dep of story.dependencies) {
        if (typeof dep === "number" && dep >= 0 && dep < plan.stories.length && dep < story.index) {
          validDeps.push(dep);
        } else {
          removedDeps.push(dep);
        }
      }

      // Track if any dependencies were filtered
      if (removedDeps.length > 0) {
        filteredDependencies.push({
          storyIndex: story.index,
          storyTitle: story.title,
          original: originalDeps,
          filtered: validDeps,
          removed: removedDeps,
        });
      }
      story.dependencies = validDeps;

      // COST-FIRST: Validate and enforce storyPoints (max 3 for Haiku)
      if (typeof story.storyPoints !== "number" || story.storyPoints < 1) {
        // Default to 2 if missing
        story.storyPoints = 2;
        logger.warn("Story missing storyPoints, defaulted to 2", {
          storyIndex: story.index,
          title: story.title,
        });
      } else if (story.storyPoints > 3) {
        // Cap at 3 and warn
        logger.warn("Story exceeds max 3 points, capping", {
          storyIndex: story.index,
          originalPoints: story.storyPoints,
          title: story.title,
        });
        story.storyPoints = 3;
      }

      // COST-FIRST: Validate targetFiles
      if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
        story.targetFiles = [];
        logger.warn("Story missing targetFiles, initialized to empty", {
          storyIndex: story.index,
          title: story.title,
        });
      } else if (story.targetFiles.length > 3) {
        // Warn if too many files for Haiku accuracy
        logger.warn("Story targets >3 files, may reduce Haiku accuracy", {
          storyIndex: story.index,
          fileCount: story.targetFiles.length,
          title: story.title,
        });
      }

      // Initialize referenceFiles if missing
      if (!story.referenceFiles) {
        story.referenceFiles = [];
      }
    }

    // Prominent logging for any filtered dependencies
    if (filteredDependencies.length > 0) {
      logger.warn("⚠️ DEPENDENCIES FILTERED FROM PLAN - User should review", {
        totalStoriesAffected: filteredDependencies.length,
        details: filteredDependencies.map(d => ({
          story: `Story ${d.storyIndex}: ${d.storyTitle}`,
          originalDeps: d.original,
          validDeps: d.filtered,
          removedDeps: d.removed,
          reason: d.removed.map(dep => {
            if (typeof dep !== "number") return `${dep} is not a number`;
            if (dep < 0) return `${dep} is negative`;
            if (dep >= plan.stories!.length) return `${dep} >= story count (${plan.stories!.length})`;
            if (dep >= (filteredDependencies.find(f => f.storyIndex === d.storyIndex)?.storyIndex || 0)) return `${dep} >= this story's index (circular/forward ref)`;
            return `${dep} is invalid`;
          }),
        })),
      });
    }
  }
}

/**
 * Re-run planning with user feedback
 *
 * When a user requests changes to the plan, we re-run the planning agent
 * with the original PRD plus the user's feedback.
 */
export async function replanWithFeedback(
  task: WorkerTask,
  feedback: string
): Promise<ExecutionPlan> {
  logger.info("Re-running planning agent with feedback", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    feedbackLength: feedback.length,
  });

  // Log start - visible in dashboard
  await addPlanningLog(task.id, `🔄 Re-planning with user feedback: ${task.jiraIssueKey}`);
  await addPlanningLog(task.id, `📝 Feedback: ${feedback.slice(0, 200)}${feedback.length > 200 ? "..." : ""}`);

  // Recalculate complexity for the revised plan
  const complexity = await calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || []
  );

  // Fetch codebase context again (may have changed)
  let codebaseContext = {
    fileTree: "Unable to fetch (no repository context)",
    readme: null as string | null,
    techStack: null as Record<string, unknown> | null,
  };

  if (task.githubRepo) {
    try {
      codebaseContext = await fetchCodebaseContext(task.githubRepo);
      await addPlanningLog(task.id, `✅ Retrieved updated repository structure`);
    } catch (error) {
      logger.warn("Failed to fetch codebase context during replan", {
        taskId: task.id,
        repo: task.githubRepo,
        error,
      });
      await addPlanningLog(task.id, `⚠️ Could not fetch updated codebase context`);
    }
  }

  // Format tech stack info for prompt
  let techStackStr = "No tech stack detected";
  if (codebaseContext.techStack) {
    if (codebaseContext.techStack.type === "Node.js/JavaScript") {
      const deps = codebaseContext.techStack.dependencies as Record<string, unknown> | undefined;
      const depKeys = deps ? Object.keys(deps).slice(0, 10).join(", ") : "";
      techStackStr = `Node.js/JavaScript project\nKey dependencies: ${depKeys}`;
    } else if (codebaseContext.techStack.type === "Python") {
      techStackStr = `Python project (${codebaseContext.techStack.configFile as string})`;
    }
  }

  const readmeSummary = codebaseContext.readme
    ? codebaseContext.readme.slice(0, 1500)
    : "No README found";

  // Build prompt with feedback AND complexity constraints
  const prompt =
    PLANNING_PROMPT.replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
      .replace("{{SUMMARY}}", task.summary || "No summary")
      .replace("{{DESCRIPTION}}", task.description || "No description")
      .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
      .replace("{{REPO}}", task.githubRepo || "Not specified")
      .replace("{{COMPLEXITY_CONSTRAINT}}", formatComplexityConstraint(complexity))
      .replace("{{COMPLEXITY_BREAKDOWN}}", formatComplexityBreakdown(complexity))
      .replace("{{FILE_TREE}}", codebaseContext.fileTree)
      .replace("{{TECH_STACK}}", techStackStr)
      .replace("{{README_SUMMARY}}", readmeSummary)
      .replace(/\{\{MAX_STORIES\}\}/g, String(complexity.maxStories)) +
    `

## Previous Plan Feedback

The previous plan was rejected. Here is the user's feedback:

${feedback}

Please create a revised plan that addresses this feedback while still respecting the complexity constraints above.
Call the submit_execution_plan tool with your revised plan.`;

  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: PLANNING_MODEL,
    max_tokens: 16384, // No artificial limit - let model output full plan
    temperature: 0, // Deterministic output for repeatable plans
    tools: [EXECUTION_PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_execution_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool_use response - guaranteed valid JSON
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Planning agent did not return tool_use response");
  }

  const plan = toolUse.input as ExecutionPlan;
  validatePlan(plan);

  // Log the revised plan details
  await addPlanningLog(task.id, `✅ Revised plan created: ${plan.strategy.toUpperCase()} strategy`);
  if (plan.strategy === "single") {
    await addPlanningLog(task.id, `👤 Primary Persona: ${plan.primaryPersona}`);
  } else if (plan.stories && plan.stories.length > 0) {
    await addPlanningLog(task.id, `📚 Stories planned: ${plan.stories.length}`);
    for (const story of plan.stories) {
      await addPlanningLog(task.id, `  ${story.index + 1}. [${story.persona}] ${story.title}`);
    }
  }
  await addPlanningLog(task.id, `⏳ Awaiting revised plan approval...`);

  // Store the revised plan with updated complexity
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...plan,
    _complexity: complexity, // Store for audit/debugging
  } as unknown as Record<string, unknown>;
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval"; // Return to approval UI
  task.planFeedback = feedback; // Keep the feedback for audit trail
  await taskRepo.save(task);

  logger.info("Revised plan created", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    strategy: plan.strategy,
  });

  return plan;
}

/**
 * Get the execution plan from a task
 */
export function getExecutionPlan(task: WorkerTask): ExecutionPlan | null {
  if (!task.planJson) {
    return null;
  }
  return task.planJson as unknown as ExecutionPlan;
}

/**
 * Check if task needs planning
 */
export function needsPlanning(task: WorkerTask): boolean {
  return task.status === "planning" && !task.planJson;
}

/**
 * Check if task is waiting for plan approval
 */
export function needsPlanApproval(task: WorkerTask): boolean {
  return task.status === "pending_plan_approval" && task.planStatus === "pending_approval";
}

// ============================================================================
// V2 MULTI-PHASE PLANNING
// ============================================================================

import {
  ExecutionPlanV2,
  PlanningTheme,
  PlannedStoryV2,
  PlanQualityScore,
  isExecutionPlanV2,
  ConsistencyReport,
  ConsistencyRunResult,
  ConsistencyDivergence,
} from "./planning-types.js";

import {
  extractThemes,
  decomposeTheme,
  assembleFinalPlan,
  createDefaultFoundationTheme,
  createDefaultFoundationStory,
  THEME_EXTRACTION_MODEL,
  STORY_DECOMPOSITION_MODEL,
} from "./planning-themes.js";

import {
  validatePlan as validatePlanV2,
  scorePlan,
  planMeetsQualityThreshold,
  generateQualityReport,
} from "./planning-validation.js";

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
    const transitioned = await transitionJiraIssue(task.jiraIssueKey, "In Progress");
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
      codebaseContext = await fetchCodebaseContext(task.githubRepo);
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
    (task.jiraFields?.labels as string[] | undefined) || []
  );
  llmCalls++;

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
  const costEstimate = estimatePlanCost(
    finalStories,
    task.workerModel || "claude-haiku-4-5-20251001"
  );

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
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval";
  await taskRepo.save(task);

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
    task.workerModel || "claude-haiku-4-5-20251001"
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
      const success = await postJiraComment(task.jiraIssueKey, comment);
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
        codebaseContext = await fetchCodebaseContext(task.githubRepo);
      } catch {
        // Ignore
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

// ============================================================================
// V3 PLANNING (INVENTORY-BASED DUAL SCORING)
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
function formatComplexityConstraintV3(dualScore: DualScore, inventory: PRDInventory): string {
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
- Each story should target ≤3 files
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
    const transitioned = await transitionJiraIssue(task.jiraIssueKey, "In Progress");
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
      codebaseContext = await fetchCodebaseContext(task.githubRepo);
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

  // Get org settings for calibration (use default 0.4 if not available)
  const calibrationMultiplier = (task.organization as { storyCalibrationMultiplier?: number })?.storyCalibrationMultiplier ?? 0.4;
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
  await addPlanningLog(task.id, `📊 Dual Score: Scope=${dualScore.scope}/100 (${getScopeLevel(dualScore.scope)}), Risk=${dualScore.risk}/100 (${getRiskLevel(dualScore.risk)})`);
  await addPlanningLog(task.id, `🎯 Target: ${dualScore.targetStories} stories, Decompose: ${dualScore.shouldDecompose ? "Yes" : "No"}`);

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
      const posted = await postJiraComment(task.jiraIssueKey, clarificationComment);
      if (posted) {
        await addPlanningLog(task.id, `📝 Posted clarification request to Jira`);
      } else {
        await addPlanningLog(task.id, `⚠️ Failed to post clarification request to Jira`);
      }
    }

    // Update task status to escalated (needs clarification)
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    task.status = "escalated";
    task.planStatus = null; // Clear plan status since planning is blocked
    await taskRepo.save(task);
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
        inventoryExtractionModel: (task.organization as { planningAgentModel?: string })?.planningAgentModel || "claude-sonnet-4-5-20250514",
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
    }, legacyScore);  // Pass legacy score for compatibility
    llmCalls++;

    themes = themeResult.themes;
    prdRequirements = themeResult.prdRequirements;

    await addPlanningLog(task.id, `✅ Extracted ${themes.length} themes:`);
    for (const theme of themes) {
      await addPlanningLog(task.id, `   ${theme.id}: ${theme.name} (${theme.category})`);
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
      llmCalls++;

      storiesByTheme.set(theme.id, result.stories);

      // Update processed context
      processedThemes.push(theme);
      for (const story of result.stories) {
        processedStories.push({ ...story, canonicalOrder: processedStories.length });
      }

      await addPlanningLog(task.id, `   ✅ ${theme.id}: ${result.stories.length} stories`);
    } catch (error) {
      logger.error("Story decomposition failed for theme", { taskId: task.id, themeId: theme.id, error });
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

  const allStories = assembleFinalPlan(themes, storiesByTheme);

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
      inventoryExtractionModel: "claude-sonnet-4-20250514",
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
  const costEstimate = estimatePlanCost(finalStories, task.workerModel || "claude-haiku-4-5-20251001");

  await addPlanningLog(task.id, `💰 Cost Estimate: ${costEstimate.totalPoints} points × $${costEstimate.costPerPoint}/pt = $${costEstimate.estimatedCost}`);

  // Log summary
  await addPlanningLog(task.id, `✅ Plan V3 created: ${finalStories.length} stories across ${themes.length} themes`);
  await addPlanningLog(task.id, `📊 LLM calls: ${llmCalls}, Duration: ${(durationMs / 1000).toFixed(1)}s`);
  await addPlanningLog(task.id, `🔒 Mutex groups: ${Object.keys(mutexGroupsMap).length}`);

  for (const story of finalStories) {
    const deps = story.dependencies.length > 0 ? ` (deps: ${story.dependencies.join(",")})` : "";
    const mutex = story.mutexGroups && story.mutexGroups.length > 0 ? ` [mutex: ${story.mutexGroups.length}]` : "";
    await addPlanningLog(task.id, `   ${story.canonicalOrder}. [${story.persona}] ${story.title}${deps}${mutex}`);
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
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval";
  await taskRepo.save(task);

  // Post to Jira
  if (!isDryRun) {
    await postPlanV2ToJira(task, executionPlanV2, qualityScore);
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
 * Get the best planning version based on task labels
 */
export function getPlanningVersion(task: WorkerTask): "v1" | "v2" | "v3" {
  if (shouldUseV3Planning(task)) return "v3";
  if (shouldUseV2Planning(task)) return "v2";
  return "v1";
}
