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

// Planning model - fast and cheap for quick analysis
const PLANNING_MODEL = "claude-haiku-4-5-20251001";

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
  reasoning: string;
  // Label override info
  overrideApplied?: "force-single" | "force-multi";
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

const COMPLEXITY_SCORING_PROMPT = `You are a technical complexity scorer for AI worker tasks.

## YOUR TASK
Analyze the PRD/ticket below and score its complexity using the score_complexity tool.

## SCORING RUBRIC (MANDATORY)

Each dimension MUST be scored 1, 2, or 3. No decimals. No ranges. Exactly one integer.

### Features (how many distinct features?)
- **1** = Single feature, bug fix, or small enhancement
- **2** = 2-3 related features that form a cohesive unit
- **3** = 4+ distinct features or a complex feature set

### Layers (what architecture layers are touched?)
- **1** = Single layer only (backend API, OR frontend UI, OR infrastructure)
- **2** = Two layers (e.g., backend API + database, frontend + API integration)
- **3** = Full stack (frontend + backend + database/infra/external services)

### Files (estimated files to create or modify?)
- **1** = 1-2 files (trivial scope)
- **2** = 3-5 files (moderate scope)
- **3** = 6+ files (large scope)

### Clarity (how clear are the requirements?)
- **1** = Crystal clear: specific files mentioned, patterns to follow, exact acceptance criteria
- **2** = Mostly clear: may need some exploration to find right files/patterns
- **3** = Vague: significant investigation needed, undefined requirements

## IMPORTANT
- Score based ONLY on what's in the ticket, not what you think should be added
- PRD/Epic labels suggest multi-feature scope (likely features=3)
- If unsure between two scores, pick the HIGHER one (conservative)
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
      reasoning: "Label override: force-single applied",
      overrideApplied: "force-single",
    };
  }

  if (allLabels.includes("force-multi")) {
    return {
      dimensions: { features: 3, layers: 3, files: 3, clarity: 2 },
      totalScore: 11,
      recommendation: "multi",
      maxStories: 0, // 0 = unlimited, LLM determines based on PRD content
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

    // Determine recommendation based on total score (4-12 range)
    // PRD/Epic labels push toward multi-story regardless of score
    const prdLabels = ["prd", "epic", "multi-story", "orchestration"];
    const hasPrdLabel = allLabels.some(l => prdLabels.includes(l));

    let recommendation: "single" | "multi";
    let maxStories: number;
    let reasoning: string;

    if (hasPrdLabel) {
      // PRD/Epic always gets multi-story treatment - LLM determines story count based on content
      recommendation = "multi";
      maxStories = 0; // 0 = unlimited, LLM analyzes PRD and creates as many stories as needed
      reasoning = `PRD/Epic detected (${totalScore} pts): Multi-story execution, LLM will determine story count from PRD content.`;
    } else if (totalScore <= 6) {
      // 4-6: Single story, straightforward task
      recommendation = "single";
      maxStories = 1;
      reasoning = `Low complexity (${totalScore}/12): Single-story execution.`;
    } else if (totalScore <= 9) {
      // 7-9: Could be single or multi depending on decomposition benefit
      recommendation = "multi";
      maxStories = 0; // 0 = unlimited, LLM determines based on content
      reasoning = `Moderate complexity (${totalScore}/12): Multi-story recommended, LLM determines count.`;
    } else {
      // 10-12: Definitely needs decomposition
      recommendation = "multi";
      maxStories = 0; // 0 = unlimited, LLM determines based on content
      reasoning = `High complexity (${totalScore}/12): Multi-story required, LLM determines count.`;
    }

    return {
      dimensions,
      totalScore,
      recommendation,
      maxStories,
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

## Dependency Rules (SIMPLIFIED - PARALLEL EXECUTION)

**✅ ALL STORIES RUN IN PARALLEL on separate git branches. Each story has its own isolated workspace.**

### Parallel Execution Model
- Each story runs on its own branch: feature/EPIC-123/story-0, story-1, etc.
- Workers do NOT interfere with each other
- Dependencies only control MERGE ORDER after all stories complete
- The orchestrator merges PRs in dependency order

### Default: No Dependencies
**For most PRDs, use dependencies: [] for ALL stories.**

Stories only need dependencies if:
1. Story B's CODE literally imports/uses something Story A creates (e.g., a new function or type)
2. The merge of Story B would fail without Story A's code already merged

### Merge Order Dependencies (use sparingly)
If Story B's PR can't merge cleanly without Story A's changes merged first:
- Story 0: Create User model - dependencies = []
- Story 1: Add User API (imports User model) - dependencies = [0]

### DO NOT use dependencies for:
- ❌ Same persona (irrelevant - parallel branches)
- ❌ Same file (handled by separate branches + merge order)
- ❌ "Logical" ordering (gallery before lightbox) - unless code dependency exists
- ❌ Sequential chaining (0→1→2→3) - this defeats parallel execution

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
✅ GOOD: Split into parallel stories (all run simultaneously):
  - Story 0: Add User model and migration (2 pts) - dependencies: []
  - Story 1: Add login endpoint (2 pts) - dependencies: []
  - Story 2: Add logout endpoint (1 pt) - dependencies: []
  - Story 3: Add JWT middleware (2 pts) - dependencies: []

❌ BAD: Sequential chaining that blocks parallel execution:
  - Story 0: dependencies: []
  - Story 1: dependencies: [0]  ← WRONG: forces sequential
  - Story 2: dependencies: [1]  ← WRONG: forces sequential
✅ GOOD: All stories with dependencies: [] (parallel execution):
  - Story 0: Build page structure and layout - dependencies: []
  - Story 1: Add interactive features - dependencies: []
  - Story 2: Add form handling and API calls - dependencies: []

## PRD to Analyze

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}
**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}
**Repository:** {{REPO}}

## Complexity Analysis (Pre-Calculated)

{{COMPLEXITY_BREAKDOWN}}

## Output Format

Respond with ONLY valid JSON (no markdown, no explanation outside the JSON):

{
  "strategy": "single" | "multi",
  "reasoning": "Brief explanation of decision (1-2 sentences)",
  "primaryPersona": "persona_name",
  "stories": [
    {
      "index": 0,
      "title": "First story - foundation (runs first)",
      "persona": "frontend_developer",
      "scope": "Build the base structure",
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "dependencies": [],
      "estimatedComplexity": "medium",
      "storyPoints": 2,
      "targetFiles": ["src/index.html", "src/styles.css"],
      "referenceFiles": []
    },
    {
      "index": 1,
      "title": "Second story - add features (parallel)",
      "persona": "frontend_developer",
      "scope": "Add interactive features to base structure",
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "dependencies": [],
      "estimatedComplexity": "medium",
      "storyPoints": 2,
      "targetFiles": ["src/index.html", "src/app.js"],
      "referenceFiles": []
    },
    {
      "index": 2,
      "title": "Third story - final integration (parallel)",
      "persona": "frontend_developer",
      "scope": "Complete remaining features",
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "dependencies": [],
      "estimatedComplexity": "medium",
      "storyPoints": 2,
      "targetFiles": ["src/app.js"],
      "referenceFiles": []
    }
  ],
  "qualityGates": ["gate1", "gate2"]
}

For single-persona strategy, include "primaryPersona" and omit "stories".
For multi-persona strategy, include "stories" array with as many stories as the PRD requires.
Each story MUST include storyPoints (1-3), targetFiles, and optionally referenceFiles.
**⚠️ IMPORTANT: targetFiles determines execution order. Stories targeting the SAME FILE will run SEQUENTIALLY (blocked until prior story completes). Stories targeting DIFFERENT files run in parallel. List ALL files each story will create or modify in targetFiles - this is critical for correct execution ordering.**
Always include "qualityGates" array.`;

/**
 * Build complexity breakdown string for prompt
 */
function formatComplexityBreakdown(score: ComplexityScore): string {
  const storyCountText = score.maxStories === 0
    ? "unlimited - determined by PRD content"
    : `max ${score.maxStories} stories`;

  const lines = [
    `**Total Score:** ${score.totalScore}/12`,
    `**Recommendation:** ${score.recommendation.toUpperCase()} strategy (${storyCountText})`,
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
  } else {
    return `
⚠️ **CONSTRAINT: MULTI-STORY EXECUTION (COST-OPTIMIZED)**

Complexity Score: ${score.totalScore}/12
**Max Points Per Story: 3** (Haiku-optimized decomposition)

Analyze the PRD and create as many stories as needed to fully implement all features.
Each story MUST be ≤3 story points.
Each story should target ≤3 files.
${score.reasoning}
`.trim();
  }
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
  await addPlanningLog(task.id, `   Score: ${complexity.totalScore}/12`);
  const storyCountDesc = complexity.maxStories === 0 ? "unlimited" : `max ${complexity.maxStories}`;
  await addPlanningLog(task.id, `   Recommendation: ${complexity.recommendation.toUpperCase()} (${storyCountDesc} stories)`);
  await addPlanningLog(task.id, `   Dimensions: F=${complexity.dimensions.features} L=${complexity.dimensions.layers} Fi=${complexity.dimensions.files} C=${complexity.dimensions.clarity}`);

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
  // STEP 4: Call the AI
  // -------------------------------------------------------------------------
  await addPlanningLog(task.id, `🤖 Calling ${PLANNING_MODEL} for PRD analysis...`);
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: PLANNING_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  // Extract text content
  const textContent = response.content.find((c: { type: string }) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    await addPlanningLog(task.id, `❌ Planning agent returned no text content`);
    throw new Error("Planning agent returned no text content");
  }

  // -------------------------------------------------------------------------
  // STEP 5: Parse and validate the plan
  // -------------------------------------------------------------------------
  const plan = parseExecutionPlan(textContent.text);

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

  // Log story count for multi-story plans (informational only - no max limit enforcement)
  if (plan.strategy === "multi" && plan.stories) {
    logger.info("Multi-story plan created", {
      taskId,
      storyCount: plan.stories.length,
      complexityScore: complexity.totalScore,
    });
  }
}

/**
 * Parse the execution plan from AI response
 */
function parseExecutionPlan(text: string): ExecutionPlan {
  // Try to extract JSON from the response
  // The AI might wrap it in markdown code blocks
  let jsonText = text.trim();

  // Remove markdown code blocks if present
  if (jsonText.startsWith("```json")) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith("```")) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith("```")) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  try {
    const parsed = JSON.parse(jsonText);
    return parsed as ExecutionPlan;
  } catch (error) {
    logger.error("Failed to parse planning agent response", {
      error,
      rawText: text.slice(0, 500),
    });
    throw new Error(`Planning agent returned invalid JSON: ${error}`);
  }
}

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
      const validDeps: number[] = [];
      for (const dep of story.dependencies) {
        if (typeof dep === "number" && dep >= 0 && dep < plan.stories.length && dep < story.index) {
          validDeps.push(dep);
        } else {
          logger.warn("Filtered invalid dependency from plan", {
            storyIndex: story.index,
            invalidDep: dep,
          });
        }
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

Please create a revised plan that addresses this feedback while still respecting the complexity constraints above.`;

  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: PLANNING_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const textContent = response.content.find((c: { type: string }) => c.type === "text");
  if (!textContent || textContent.type !== "text") {
    throw new Error("Planning agent returned no text content");
  }

  const plan = parseExecutionPlan(textContent.text);
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
