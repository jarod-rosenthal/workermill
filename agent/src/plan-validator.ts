/**
 * Plan Validator for Remote Agent
 *
 * Validates execution plans locally before posting to the cloud API.
 * Implements the same guardrails as the server-side planning pipeline:
 *   1. File cap: max 5 targetFiles per story (prevents scope explosion)
 *   2. Critic validation: LLM scores the plan, rejects below threshold
 *
 * This ensures remote agent plans get the same quality gates as cloud plans,
 * even though the planning prompt runs locally via Claude CLI.
 */

import { spawn } from "child_process";
import chalk from "chalk";
import { generateText, type AIProvider } from "./providers.js";

// ============================================================================
// TYPES (mirrors server-side planning-agent-local.ts)
// ============================================================================

export interface PlannedStory {
  id: string;
  title: string;
  description: string;
  persona: string;
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];
  acceptanceCriteria: string[];
  targetFiles?: string[];
  scope?: string;
}

export interface ExecutionPlan {
  summary: string;
  stories: PlannedStory[];
  risks: string[];
  assumptions: string[];
}

export interface CriticResult {
  approved: boolean;
  score: number;
  risks: string[];
  suggestions?: string[];
  storyFeedback?: Array<{
    storyId: string;
    feedback: string;
    suggestedChanges?: string[];
  }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_TARGET_FILES = 5;
const AUTO_APPROVAL_THRESHOLD = 85;

// ============================================================================
// PLAN PARSING
// ============================================================================

/**
 * Parse execution plan JSON from raw Claude CLI output.
 * Mirrors server-side parseExecutionPlan() in planning-agent-local.ts.
 */
export function parseExecutionPlan(output: string): ExecutionPlan {
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  const rawJsonMatch = output.match(/\{[\s\S]*"stories"[\s\S]*\}/);
  if (rawJsonMatch) {
    return JSON.parse(rawJsonMatch[0]);
  }

  throw new Error("Could not find JSON execution plan in output");
}

// ============================================================================
// FILE CAP
// ============================================================================

/**
 * Apply file cap to all stories. Truncates targetFiles > MAX_TARGET_FILES.
 * Returns details about truncated stories for logging.
 */
export function applyFileCap(
  plan: ExecutionPlan,
): { truncatedCount: number; details: string[] } {
  let truncatedCount = 0;
  const details: string[] = [];

  for (const story of plan.stories) {
    if (!story.targetFiles || !Array.isArray(story.targetFiles)) {
      story.targetFiles = [];
    } else if (story.targetFiles.length > MAX_TARGET_FILES) {
      const dropped = story.targetFiles.slice(MAX_TARGET_FILES);
      details.push(
        `${story.id}: ${story.targetFiles.length} files → ${MAX_TARGET_FILES} (dropped: ${dropped.join(", ")})`,
      );
      story.targetFiles = story.targetFiles.slice(0, MAX_TARGET_FILES);
      truncatedCount++;
    }
  }

  return { truncatedCount, details };
}

// ============================================================================
// PLAN SERIALIZATION
// ============================================================================

/**
 * Re-serialize plan as a JSON code block for posting to the API.
 * The server-side parseExecutionPlan() expects ```json ... ``` blocks.
 */
export function serializePlan(plan: ExecutionPlan): string {
  return "```json\n" + JSON.stringify(plan, null, 2) + "\n```";
}

// ============================================================================
// CRITIC
// ============================================================================

/**
 * Critic prompt — identical to server-side critic-agent.ts CRITIC_PROMPT.
 */
const CRITIC_PROMPT = `You are a Senior Architect reviewing an execution plan. Your job is to ensure the plan is appropriately sized for the task.

Review this execution plan against the PRD:

***REMOVED******REMOVED*** PRD (Product Requirements Document)
{{PRD}}

***REMOVED******REMOVED*** PROPOSED EXECUTION PLAN
{{PLAN}}

***REMOVED******REMOVED*** Review Guidelines

**IMPORTANT: Match plan size to task complexity**

- Simple tasks (typos, config changes, single-file fixes) = 1 step is CORRECT
- Medium tasks (2-4 files, small features) = 2-3 steps is appropriate
- Complex tasks (new systems, security) = 3-5 steps is appropriate

**Do NOT penalize:**
- Single-step plans for genuinely simple tasks
- Using one persona when only one skill is needed

**DO check for:**
1. **Missing Requirements** - Does the plan cover what the PRD asks for?
2. **Vague Instructions** - Will the worker know what to do?
3. **Security Issues** - Only for tasks involving auth, user data, or external input
4. **Unrealistic Scope** - Any step targeting >3 files MUST score below 85 (auto-rejection threshold). Each step should modify at most 3 files. If a step needs more, split it into multiple steps first.
5. **Missing Operational Steps** - If the PRD requires deployment, provisioning, migrations, or running commands, does the plan include operational steps? Writing code is not the same as deploying it.
6. **Overlapping File Scope** - If two or more steps share the same targetFiles, this causes parallel merge conflicts. Steps MUST NOT overlap on targetFiles. Deduct 10 points per shared file across steps.

***REMOVED******REMOVED*** Scoring Guide

- **90-100**: Plan matches task complexity, requirements covered
- **75-89**: Minor gaps but fundamentally sound
- **50-74**: Significant issues or wrong-sized for the task
- **0-49**: Fundamentally flawed

***REMOVED******REMOVED*** Output Format

Respond with ONLY a JSON object (no markdown, no explanation):
{"approved": boolean, "score": number, "risks": ["risk1", "risk2"], "suggestions": ["suggestion1", "suggestion2"], "storyFeedback": [{"storyId": "step-0", "feedback": "specific feedback", "suggestedChanges": ["change1"]}]}

Rules:
- approved = true if score >= 85 AND plan is right-sized for task
- risks = specific issues (empty array if none)
- suggestions = actionable improvements (empty array if none)
- storyFeedback = per-step feedback (optional, only for steps that need changes)`;

/**
 * Build the critic prompt with PRD and plan substituted.
 */
export function buildCriticPrompt(
  prd: string,
  plan: ExecutionPlan,
): string {
  const planJson = JSON.stringify(plan, null, 2);
  return CRITIC_PROMPT.replace("{{PRD}}", prd).replace("{{PLAN}}", planJson);
}

/**
 * Parse critic JSON response from raw Claude CLI output.
 */
export function parseCriticResponse(text: string): CriticResult {
  let jsonText = text.trim();

  // Handle markdown code blocks
  if (jsonText.includes("```")) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonText = match[1].trim();
  }

  // Find JSON object if preceded by reasoning text
  const jsonStart = jsonText.indexOf("{");
  if (jsonStart > 0) {
    jsonText = jsonText.substring(jsonStart);
  }

  const result = JSON.parse(jsonText) as {
    approved: boolean;
    score: number;
    risks: string[];
    suggestions?: string[];
    storyFeedback?: Array<{
      storyId: string;
      feedback: string;
      suggestedChanges?: string[];
    }>;
  };

  return {
    approved: result.approved,
    score: Math.max(0, Math.min(100, Math.round(result.score))),
    risks: result.risks || [],
    suggestions: result.suggestions,
    storyFeedback: Array.isArray(result.storyFeedback)
      ? result.storyFeedback
      : undefined,
  };
}

/**
 * Run the critic via Claude CLI (lightweight — no tools, just reasoning).
 * Returns the raw text output.
 */
export function runCriticCli(
  claudePath: string,
  model: string,
  prompt: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      claudePath,
      [
        "--print",
        "--model",
        model,
        "--permission-mode",
        "bypassPermissions",
      ],
      {
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("Critic CLI timed out after 3 minutes"));
    }, 180_000);

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(
          new Error(
            `Critic CLI failed (exit ${code}): ${stderr.substring(0, 300)}`,
          ),
        );
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Format critic feedback for appending to the planner prompt on re-run.
 */
export function formatCriticFeedback(critic: CriticResult): string {
  const lines: string[] = [
    "",
    "***REMOVED******REMOVED*** CRITIC FEEDBACK — Your previous plan was REJECTED",
    "",
    `Score: ${critic.score}/100 (need >= ${AUTO_APPROVAL_THRESHOLD} to pass)`,
    "",
  ];

  if (critic.risks.length > 0) {
    lines.push("***REMOVED******REMOVED******REMOVED*** Risks Identified:");
    for (const risk of critic.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (critic.suggestions && critic.suggestions.length > 0) {
    lines.push("***REMOVED******REMOVED******REMOVED*** Required Changes:");
    for (const suggestion of critic.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  if (critic.storyFeedback && critic.storyFeedback.length > 0) {
    lines.push("***REMOVED******REMOVED******REMOVED*** Per-Story Feedback:");
    for (const fb of critic.storyFeedback) {
      lines.push(`- **${fb.storyId}**: ${fb.feedback}`);
      if (fb.suggestedChanges) {
        for (const change of fb.suggestedChanges) {
          lines.push(`  - ${change}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(
    "**You MUST address ALL feedback above.** Each story must target at most 5 files.",
    "Stories MUST NOT overlap on targetFiles. Generate a revised plan.",
  );

  return lines.join("\n");
}

/** Timestamp prefix for console logs */
function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

/**
 * Run critic validation on a parsed plan.
 * Routes to Claude CLI (Anthropic) or HTTP API (other providers).
 * Returns the critic result, or null if critic fails (non-blocking).
 */
export async function runCriticValidation(
  claudePath: string,
  model: string,
  prd: string,
  plan: ExecutionPlan,
  env: Record<string, string | undefined>,
  taskLabel: string,
  provider?: AIProvider,
  providerApiKey?: string,
): Promise<CriticResult | null> {
  const criticPrompt = buildCriticPrompt(prd, plan);
  const effectiveProvider = provider || "anthropic";

  console.log(
    `${ts()} ${taskLabel} ${chalk.dim(`Running critic validation (${effectiveProvider})...`)}`,
  );

  try {
    let rawCriticOutput: string;

    if (effectiveProvider === "anthropic") {
      rawCriticOutput = await runCriticCli(claudePath, model, criticPrompt, env);
    } else {
      if (!providerApiKey) {
        throw new Error(`No API key for critic provider "${effectiveProvider}"`);
      }
      rawCriticOutput = await generateText(
        effectiveProvider,
        model,
        criticPrompt,
        providerApiKey,
        { maxTokens: 4096, temperature: 0.3, timeoutMs: 180_000 },
      );
    }

    const result = parseCriticResponse(rawCriticOutput);
    const statusIcon =
      result.score >= AUTO_APPROVAL_THRESHOLD
        ? chalk.green("✓")
        : chalk.red("✗");
    console.log(
      `${ts()} ${taskLabel} ${statusIcon} Critic score: ${result.score}/100 (threshold: ${AUTO_APPROVAL_THRESHOLD})`,
    );
    return result;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `${ts()} ${taskLabel} ${chalk.yellow("⚠")} Critic failed: ${errMsg.substring(0, 100)}`,
    );
    return null;
  }
}

export { AUTO_APPROVAL_THRESHOLD };
