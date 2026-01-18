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
}

export interface ExecutionPlan {
  strategy: "single" | "multi";
  reasoning: string;
  primaryPersona?: string;
  stories?: PlannedStory[];
  qualityGates: string[];
}

// ============================================================================
// COMPLEXITY SCORING SYSTEM
// ============================================================================
// Deterministic scoring to ensure consistent planning decisions.
// The score determines whether a task should be single or multi-story.

export interface ComplexityScore {
  // Raw counts from ticket analysis
  factors: {
    acceptanceCriteria: number;
    apiEndpoints: number;
    uiViews: number;
    fileTypes: number;
    integrations: number;
  };
  // Detected complexity multipliers
  multipliers: {
    responsive: boolean;
    upload: boolean;
    auth: boolean;
    database: boolean;
    realtime: boolean;
  };
  // Calculated values
  baseScore: number;
  multiplier: number;
  finalScore: number;
  // Recommendation
  recommendation: "single" | "multi";
  maxStories: number;
  reasoning: string;
}

/**
 * Calculate complexity score from ticket content
 *
 * This is DETERMINISTIC - same input always produces same output.
 * The score drives the planning constraint, ensuring consistency.
 */
export function calculateComplexity(
  summary: string,
  description: string,
  labels: string[]
): ComplexityScore {
  const text = `${summary} ${description}`.toLowerCase();
  const allLabels = labels.map(l => l.toLowerCase());

  // -------------------------------------------------------------------------
  // COUNT RAW FACTORS
  // -------------------------------------------------------------------------

  // Count acceptance criteria / requirements
  // Look for numbered lists, bullet points with action verbs, "must", "should"
  const acPatterns = [
    /(?:^|\n)\s*[-•*]\s*(?:must|should|shall|will|can)\b/gi,
    /(?:^|\n)\s*\d+\.\s+\w/gm,
    /\baccept(?:ance)?\s*criteria\b/gi,
    /\brequirement[s]?\b/gi,
    /\bgoal[s]?\b.*?:/gi,
  ];
  let acceptanceCriteria = 0;
  for (const pattern of acPatterns) {
    const matches = text.match(pattern);
    acceptanceCriteria += matches ? matches.length : 0;
  }
  // Cap at reasonable max, dedupe-ish by dividing
  acceptanceCriteria = Math.min(Math.ceil(acceptanceCriteria / 2), 10);

  // Count API endpoints mentioned
  const apiPatterns = [
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+/gi,
    /\/api\/\S+/gi,
    /\bendpoint[s]?\b/gi,
    /\bAPI\s+(?:call|request|endpoint)/gi,
  ];
  let apiEndpoints = 0;
  for (const pattern of apiPatterns) {
    const matches = text.match(pattern);
    apiEndpoints += matches ? matches.length : 0;
  }
  apiEndpoints = Math.min(apiEndpoints, 10);

  // Count distinct UI views/pages/components
  const uiPatterns = [
    /\b(?:page|view|screen|modal|dialog|form|component)\b/gi,
    /\bgallery\b/gi,
    /\bdashboard\b/gi,
    /\blightbox\b/gi,
    /\bnavigation\b/gi,
  ];
  let uiViews = 0;
  for (const pattern of uiPatterns) {
    const matches = text.match(pattern);
    uiViews += matches ? matches.length : 0;
  }
  // Dedupe similar mentions
  uiViews = Math.min(Math.ceil(uiViews / 2), 8);

  // Count file types / tech stack diversity
  const fileTypePatterns = [
    /\.(?:ts|tsx|js|jsx)\b/gi,
    /\.(?:html|css|scss)\b/gi,
    /\.(?:py|go|rs|java)\b/gi,
    /\.(?:json|yaml|yml|toml)\b/gi,
    /\b(?:HTML|CSS|JavaScript|TypeScript)\b/gi,
  ];
  const fileTypeSet = new Set<string>();
  for (const pattern of fileTypePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => fileTypeSet.add(m.toLowerCase().replace(".", "")));
    }
  }
  const fileTypes = Math.min(fileTypeSet.size, 5);

  // Count external integrations
  const integrationPatterns = [
    /\b(?:AWS|S3|Lambda|DynamoDB|RDS)\b/gi,
    /\b(?:Stripe|PayPal|Twilio)\b/gi,
    /\b(?:OAuth|JWT|SSO)\b/gi,
    /\b(?:webhook|API\s+integration)\b/gi,
    /\b(?:third[\s-]?party)\b/gi,
  ];
  let integrations = 0;
  for (const pattern of integrationPatterns) {
    const matches = text.match(pattern);
    integrations += matches ? matches.length : 0;
  }
  integrations = Math.min(integrations, 5);

  // -------------------------------------------------------------------------
  // DETECT COMPLEXITY MULTIPLIERS
  // -------------------------------------------------------------------------

  const multipliers = {
    responsive: /\b(?:responsive|mobile|tablet|breakpoint)\b/i.test(text),
    upload: /\b(?:upload|file\s+select|drag[\s-]?drop|attachment)\b/i.test(text),
    auth: /\b(?:auth|login|logout|session|permission|role|JWT|OAuth)\b/i.test(text),
    database: /\b(?:database|schema|migration|table|postgres|mysql|mongo)\b/i.test(text),
    realtime: /\b(?:realtime|real[\s-]?time|websocket|SSE|streaming|live)\b/i.test(text),
  };

  // -------------------------------------------------------------------------
  // CALCULATE SCORES
  // -------------------------------------------------------------------------

  // Base score from factors
  const baseScore =
    acceptanceCriteria * 1.0 +
    apiEndpoints * 1.5 +
    uiViews * 2.0 +
    fileTypes * 0.5 +
    integrations * 2.0;

  // Multiplier from complexity flags
  let multiplierValue = 1.0;
  if (multipliers.responsive) multiplierValue *= 1.1;
  if (multipliers.upload) multiplierValue *= 1.2;
  if (multipliers.auth) multiplierValue *= 1.3;
  if (multipliers.database) multiplierValue *= 1.3;
  if (multipliers.realtime) multiplierValue *= 1.2;

  const finalScore = Math.round(baseScore * multiplierValue * 10) / 10;

  // -------------------------------------------------------------------------
  // DETERMINE RECOMMENDATION
  // -------------------------------------------------------------------------

  let recommendation: "single" | "multi";
  let maxStories: number;
  let reasoning: string;

  // Workers can handle ~8 points per task, so thresholds are based on that
  if (finalScore < 8) {
    recommendation = "single";
    maxStories = 1;
    reasoning = `Low complexity (${finalScore} pts): Single-story execution recommended.`;
  } else if (finalScore < 16) {
    recommendation = "single";
    maxStories = 2;
    reasoning = `Moderate complexity (${finalScore} pts): Single-story preferred, max 2 stories if needed.`;
  } else if (finalScore < 24) {
    recommendation = "multi";
    maxStories = 3;
    reasoning = `Medium-high complexity (${finalScore} pts): Multi-story execution, 2-3 stories.`;
  } else if (finalScore < 40) {
    recommendation = "multi";
    maxStories = 5;
    reasoning = `High complexity (${finalScore} pts): Multi-story orchestration, 3-5 stories.`;
  } else {
    recommendation = "multi";
    maxStories = 7;
    reasoning = `Very high complexity (${finalScore} pts): Full orchestration, 5-7 stories max.`;
  }

  return {
    factors: {
      acceptanceCriteria,
      apiEndpoints,
      uiViews,
      fileTypes,
      integrations,
    },
    multipliers,
    baseScore: Math.round(baseScore * 10) / 10,
    multiplier: Math.round(multiplierValue * 100) / 100,
    finalScore,
    recommendation,
    maxStories,
    reasoning,
  };
}

const PLANNING_PROMPT = `You are a technical planning agent for WorkerMill. Analyze this PRD and create an execution plan.

***REMOVED******REMOVED*** CRITICAL: COMPLEXITY CONSTRAINT

{{COMPLEXITY_CONSTRAINT}}

**YOU MUST FOLLOW THIS CONSTRAINT.** The complexity score is calculated deterministically from the ticket content. Your plan MUST align with the recommendation.

***REMOVED******REMOVED*** Available Personas

| Persona | Expertise | Use When |
|---------|-----------|----------|
| backend_developer | APIs, databases, server logic, auth | Creating/modifying backend services |
| frontend_developer | UI, components, styling, client JS | Building user interfaces |
| devops_engineer | Infrastructure, CI/CD, deployment | Infrastructure changes |
| qa_engineer | Testing, E2E, test automation | Dedicated testing phase needed |
| security_engineer | Auth, encryption, vulnerability fixes | Security-critical features |
| tech_writer | Documentation, READMEs, API docs | Documentation deliverables |

***REMOVED******REMOVED*** Planning Rules Based on Complexity

**For SINGLE-story tasks (complexity < 16):**
- Use ONE persona that best fits the majority of the work
- Do NOT split into multiple stories
- If work touches multiple areas, pick the primary one

**For MULTI-story tasks (complexity >= 16):**
- Split into {{MAX_STORIES}} stories MAXIMUM
- Each story should be ~8 points of complexity (workers can handle substantial tasks)
- Order by dependencies (backend before frontend, etc.)
- Prefer fewer stories over more when in doubt

***REMOVED******REMOVED*** Dependency Rules

1. **Backend before Frontend** - UI can't integrate with APIs that don't exist
2. **Implementation before Testing** - QA tests completed features
3. **Security review before implementation** - For security-critical features
4. **Infrastructure before services** - Can't deploy what doesn't have a target

***REMOVED******REMOVED*** Story Sizing

Each story should be:
- **Up to ~8 points of complexity** (workers can handle substantial tasks)
- **Independently verifiable** (has own acceptance criteria)
- **Produces a working increment** (not half-done code)

***REMOVED******REMOVED*** PRD to Analyze

**Jira Key:** {{JIRA_KEY}}
**Summary:** {{SUMMARY}}
**Description:**
{{DESCRIPTION}}

**Labels:** {{LABELS}}
**Repository:** {{REPO}}

***REMOVED******REMOVED*** Complexity Analysis (Pre-Calculated)

{{COMPLEXITY_BREAKDOWN}}

***REMOVED******REMOVED*** Output Format

Respond with ONLY valid JSON (no markdown, no explanation outside the JSON):

{
  "strategy": "single" | "multi",
  "reasoning": "Brief explanation of decision (1-2 sentences)",
  "primaryPersona": "persona_name",
  "stories": [
    {
      "index": 0,
      "title": "Story title",
      "persona": "persona_name",
      "scope": "What this story covers",
      "acceptanceCriteria": ["criterion 1", "criterion 2"],
      "dependencies": [],
      "estimatedComplexity": "small" | "medium" | "large"
    }
  ],
  "qualityGates": ["gate1", "gate2"]
}

For single-persona strategy, include "primaryPersona" and omit "stories".
For multi-persona strategy, include "stories" array (max {{MAX_STORIES}} stories).
Always include "qualityGates" array.`;

/**
 * Build complexity breakdown string for prompt
 */
function formatComplexityBreakdown(score: ComplexityScore): string {
  const lines = [
    `**Final Score:** ${score.finalScore} points`,
    `**Recommendation:** ${score.recommendation.toUpperCase()} strategy (max ${score.maxStories} stories)`,
    "",
    "**Detected Factors:**",
    `- Acceptance Criteria/Goals: ${score.factors.acceptanceCriteria} (×1.0)`,
    `- API Endpoints: ${score.factors.apiEndpoints} (×1.5)`,
    `- UI Views/Components: ${score.factors.uiViews} (×2.0)`,
    `- File Types: ${score.factors.fileTypes} (×0.5)`,
    `- Integrations: ${score.factors.integrations} (×2.0)`,
    "",
    "**Complexity Multipliers:**",
  ];

  if (score.multipliers.responsive) lines.push("- ✓ Responsive/Mobile (×1.1)");
  if (score.multipliers.upload) lines.push("- ✓ File Upload (×1.2)");
  if (score.multipliers.auth) lines.push("- ✓ Authentication (×1.3)");
  if (score.multipliers.database) lines.push("- ✓ Database Changes (×1.3)");
  if (score.multipliers.realtime) lines.push("- ✓ Realtime/WebSocket (×1.2)");

  const activeMultipliers = Object.values(score.multipliers).filter(Boolean).length;
  if (activeMultipliers === 0) {
    lines.push("- (none detected)");
  }

  lines.push("");
  lines.push(`**Combined Multiplier:** ${score.multiplier}x`);
  lines.push(`**Base Score:** ${score.baseScore} → **Final:** ${score.finalScore}`);

  return lines.join("\n");
}

/**
 * Build complexity constraint string for prompt
 */
function formatComplexityConstraint(score: ComplexityScore): string {
  if (score.recommendation === "single") {
    return `
⚠️ **CONSTRAINT: SINGLE-STORY EXECUTION REQUIRED**

Complexity Score: ${score.finalScore} (threshold for multi-story: 16)
Maximum Stories Allowed: ${score.maxStories}

You MUST use strategy "single" with ONE primaryPersona.
Do NOT create multiple stories for this task.
${score.reasoning}
`.trim();
  } else {
    return `
⚠️ **CONSTRAINT: MULTI-STORY EXECUTION (LIMITED)**

Complexity Score: ${score.finalScore}
Maximum Stories Allowed: ${score.maxStories}

You MUST create between 2 and ${score.maxStories} stories.
Prefer FEWER stories when possible - combine related work.
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

  // Transition Jira ticket to "In Progress" when planning starts
  if (task.jiraIssueKey) {
    const transitioned = await transitionJiraIssue(task.jiraIssueKey, "In Progress");
    if (transitioned) {
      await addPlanningLog(task.id, `📌 Jira ticket transitioned to In Progress`);
    }
  }

  // -------------------------------------------------------------------------
  // STEP 1: Calculate complexity score (deterministic)
  // -------------------------------------------------------------------------
  const complexity = calculateComplexity(
    task.summary || "",
    task.description || "",
    (task.jiraFields?.labels as string[] | undefined) || []
  );

  await addPlanningLog(task.id, `📊 Complexity Analysis:`);
  await addPlanningLog(task.id, `   Score: ${complexity.finalScore} points`);
  await addPlanningLog(task.id, `   Recommendation: ${complexity.recommendation.toUpperCase()} (max ${complexity.maxStories} stories)`);
  await addPlanningLog(task.id, `   Factors: AC=${complexity.factors.acceptanceCriteria}, API=${complexity.factors.apiEndpoints}, UI=${complexity.factors.uiViews}`);

  logger.info("Complexity score calculated", {
    taskId: task.id,
    jiraKey: task.jiraIssueKey,
    complexity,
  });

  // -------------------------------------------------------------------------
  // STEP 2: Build the prompt with complexity constraints
  // -------------------------------------------------------------------------
  const prompt = PLANNING_PROMPT
    .replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
    .replace("{{SUMMARY}}", task.summary || "No summary")
    .replace("{{DESCRIPTION}}", task.description || "No description")
    .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
    .replace("{{REPO}}", task.githubRepo || "Not specified")
    .replace("{{COMPLEXITY_CONSTRAINT}}", formatComplexityConstraint(complexity))
    .replace("{{COMPLEXITY_BREAKDOWN}}", formatComplexityBreakdown(complexity))
    .replace(/\{\{MAX_STORIES\}\}/g, String(complexity.maxStories));

  // -------------------------------------------------------------------------
  // STEP 3: Call the AI
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
  // STEP 4: Parse and validate the plan
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
    await addPlanningLog(task.id, `📚 Stories planned: ${plan.stories.length}/${complexity.maxStories} max`);
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
    complexityScore: complexity.finalScore,
    complexityRecommendation: complexity.recommendation,
    durationMs,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  // Store the plan in the task (include complexity score)
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = {
    ...plan,
    _complexity: complexity, // Store for audit/debugging
  } as unknown as Record<string, unknown>;
  task.planStatus = "pending_approval";
  task.status = "pending_plan_approval";
  await taskRepo.save(task);

  // Post the plan to Jira
  await postPlanToJira(task, plan, complexity);

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
  const lines: string[] = [
    "[Project Manager - Execution Plan]",
    "",
    `Complexity Score: ${complexity.finalScore} points`,
    "",
    `Strategy: ${plan.strategy.toUpperCase()} persona execution`,
    "",
    plan.reasoning,
    "",
  ];

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
 */
async function validatePlanMatchesComplexity(
  plan: ExecutionPlan,
  complexity: ComplexityScore,
  taskId: string
): Promise<void> {
  // Check if AI followed the recommendation
  if (complexity.recommendation === "single" && plan.strategy === "multi") {
    // AI created multi-story for a simple task
    // If stories count is within limit, accept it with warning
    if (plan.stories && plan.stories.length <= complexity.maxStories) {
      logger.warn("Plan exceeded single recommendation but within max stories", {
        taskId,
        recommendation: complexity.recommendation,
        planStrategy: plan.strategy,
        storyCount: plan.stories.length,
        maxStories: complexity.maxStories,
      });
      await addPlanningLog(taskId, `⚠️ Note: AI chose multi-story (${plan.stories.length}) for low-complexity task`);
    } else if (plan.stories && plan.stories.length > complexity.maxStories) {
      // Too many stories - log warning but don't fail
      logger.warn("Plan exceeded max stories constraint", {
        taskId,
        storyCount: plan.stories.length,
        maxStories: complexity.maxStories,
      });
      await addPlanningLog(taskId, `⚠️ Warning: Plan has ${plan.stories.length} stories (max recommended: ${complexity.maxStories})`);
    }
  }

  if (complexity.recommendation === "multi" && plan.strategy === "single") {
    // AI chose single for a complex task - that's fine, it might be right
    logger.info("Plan chose single strategy for multi recommendation - accepted", {
      taskId,
      complexityScore: complexity.finalScore,
    });
  }

  // Check story count for multi-story plans
  if (plan.strategy === "multi" && plan.stories) {
    if (plan.stories.length > complexity.maxStories) {
      logger.warn("Plan exceeded max stories constraint", {
        taskId,
        storyCount: plan.stories.length,
        maxStories: complexity.maxStories,
        complexityScore: complexity.finalScore,
      });
      await addPlanningLog(taskId, `⚠️ Warning: ${plan.stories.length} stories exceeds recommended max of ${complexity.maxStories}`);
    }
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

  // Build prompt with feedback
  const prompt =
    PLANNING_PROMPT.replace("{{JIRA_KEY}}", task.jiraIssueKey || "Unknown")
      .replace("{{SUMMARY}}", task.summary || "No summary")
      .replace("{{DESCRIPTION}}", task.description || "No description")
      .replace("{{LABELS}}", JSON.stringify(task.jiraFields?.labels || []))
      .replace("{{REPO}}", task.githubRepo || "Not specified") +
    `

***REMOVED******REMOVED*** Previous Plan Feedback

The previous plan was rejected. Here is the user's feedback:

${feedback}

Please create a revised plan that addresses this feedback.`;

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

  // Store the revised plan
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  task.planJson = plan as unknown as Record<string, unknown>;
  task.planStatus = "pending_approval";
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
