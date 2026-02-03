/**
 * Local Critic Agent Adapter
 *
 * Reviews execution plans using Claude CLI with OAuth token.
 * Provides the same interface as critic-agent.ts but for local execution.
 *
 * The critic agent validates plans before execution and can request revisions.
 */

import { spawn } from "child_process";
import { logger } from "../utils/logger.js";
import type { ExecutionPlan, PlannedStory } from "./planning-agent-local.js";

/**
 * Critic review result.
 */
export interface CriticResult {
  /** Score from 0-100 */
  score: number;
  /** Whether the plan is approved (score >= threshold) */
  approved: boolean;
  /** Identified risks in the plan */
  risks: string[];
  /** Suggestions for improvement */
  suggestions: string[];
  /** Detailed reasoning for the score */
  reasoning: string;
  /** Specific story feedback (optional) */
  storyFeedback?: Array<{
    storyId: string;
    feedback: string;
    suggestedChanges?: string[];
  }>;
}

/**
 * Input for the critic agent.
 */
export interface CriticInput {
  taskId: string;
  plan: ExecutionPlan;
  originalRequirements: string;
  iteration?: number;
}

/**
 * Run the critic agent locally using Claude CLI.
 */
export async function runLocalCriticAgent(
  input: CriticInput
): Promise<CriticResult> {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!oauthToken) {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required for local critic agent. " +
      "Run 'claude auth login' to authenticate."
    );
  }

  const prompt = buildCriticPrompt(input);

  logger.info("Running local critic agent", {
    taskId: input.taskId,
    storyCount: input.plan.stories.length,
    iteration: input.iteration || 1,
  });

  return new Promise((resolve, reject) => {
    const claude = spawn(
      "claude",
      [
        "--print",
        "--output-format", "text",
        "--model", "sonnet",
      ],
      {
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    claude.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    claude.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Write prompt to stdin
    claude.stdin.write(prompt);
    claude.stdin.end();

    claude.on("close", (code) => {
      if (code !== 0) {
        logger.error("Critic agent failed", {
          taskId: input.taskId,
          code,
          stderr: stderr.substring(0, 500),
        });
        reject(new Error(`Critic agent exited with code ${code}: ${stderr.substring(0, 200)}`));
        return;
      }

      try {
        const result = parseCriticResult(stdout);
        logger.info("Critic agent completed", {
          taskId: input.taskId,
          score: result.score,
          approved: result.approved,
        });
        resolve(result);
      } catch (e) {
        logger.error("Failed to parse critic output", {
          taskId: input.taskId,
          error: e instanceof Error ? e.message : String(e),
          outputPreview: stdout.substring(0, 500),
        });
        reject(e);
      }
    });

    claude.on("error", (err) => {
      logger.error("Critic agent process error", {
        taskId: input.taskId,
        error: err.message,
      });
      reject(err);
    });
  });
}

/**
 * Build the critic prompt from input.
 */
function buildCriticPrompt(input: CriticInput): string {
  const { plan, originalRequirements, iteration } = input;

  return `You are a senior technical reviewer (Tech Lead / Critic Agent).

Your job is to review an execution plan and determine if it adequately addresses the requirements.

## Original Requirements

${originalRequirements}

## Execution Plan to Review

**Summary:** ${plan.summary}

**Stories:**
${plan.stories.map((s, i) => formatStory(s, i + 1)).join("\n\n")}

**Identified Risks:**
${plan.risks.map(r => `- ${r}`).join("\n")}

**Assumptions:**
${plan.assumptions.map(a => `- ${a}`).join("\n")}

${iteration && iteration > 1 ? `\n**Note:** This is revision ${iteration}. Previous versions had issues that needed addressing.\n` : ""}

## Review Criteria

Score the plan from 0-100 based on:

1. **Completeness (30 points):** Does the plan cover all requirements?
2. **Feasibility (25 points):** Are the steps realistic and achievable?
3. **Dependencies (15 points):** Are dependencies correctly ordered with no circular deps?
4. **Quality (15 points):** Are acceptance criteria clear and testable?
5. **Risk Management (15 points):** Are risks properly identified and mitigated?

## Response Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "score": 85,
  "approved": true,
  "risks": [
    "Specific risk identified in the plan"
  ],
  "suggestions": [
    "Specific improvement suggestion"
  ],
  "reasoning": "Detailed explanation of the score and why the plan was approved/rejected",
  "storyFeedback": [
    {
      "storyId": "story-1",
      "feedback": "Specific feedback for this story",
      "suggestedChanges": ["Change 1", "Change 2"]
    }
  ]
}
\`\`\`

Important:
- Set "approved" to true if score >= 85
- Be specific in feedback, not generic
- If rejecting, explain exactly what needs to change
- storyFeedback is optional, only include for stories that need changes
`;
}

/**
 * Format a story for display in the prompt.
 */
function formatStory(story: PlannedStory, num: number): string {
  return `### Story ${num}: ${story.title} (${story.id})
- **Persona:** ${story.persona}
- **Priority:** ${story.priority}
- **Effort:** ${story.estimatedEffort}
- **Dependencies:** ${story.dependencies.length ? story.dependencies.join(", ") : "None"}
- **Description:** ${story.description}
- **Acceptance Criteria:**
${story.acceptanceCriteria.map(c => `  - ${c}`).join("\n")}`;
}

/**
 * Parse critic result from Claude output.
 */
function parseCriticResult(output: string): CriticResult {
  // Try to extract JSON from the response
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[1]);
    return normalizeCriticResult(parsed);
  }

  // Try to find raw JSON
  const rawJsonMatch = output.match(/\{[\s\S]*"score"[\s\S]*\}/);
  if (rawJsonMatch) {
    const parsed = JSON.parse(rawJsonMatch[0]);
    return normalizeCriticResult(parsed);
  }

  throw new Error("Could not find JSON critic result in output");
}

/**
 * Normalize critic result to ensure all fields are present.
 */
function normalizeCriticResult(parsed: Record<string, unknown>): CriticResult {
  const score = typeof parsed.score === "number" ? parsed.score : 0;
  const threshold = parseInt(process.env.AUTO_APPROVAL_THRESHOLD || "85", 10);

  return {
    score,
    approved: parsed.approved === true || score >= threshold,
    risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    storyFeedback: Array.isArray(parsed.storyFeedback) ? parsed.storyFeedback : undefined,
  };
}

/**
 * Check if we should use local critic agent.
 */
export function shouldUseLocalCritic(): boolean {
  return process.env.EXECUTION_MODE === "local" && !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}

/**
 * Run the plan-critic loop with revisions.
 * Returns the final approved plan or throws if max iterations exceeded.
 */
export async function runPlanCriticLoop(
  taskId: string,
  initialPlan: ExecutionPlan,
  requirements: string,
  revisePlanFn: (plan: ExecutionPlan, feedback: CriticResult) => Promise<ExecutionPlan>,
  maxIterations: number = 3
): Promise<{ plan: ExecutionPlan; criticResult: CriticResult }> {
  let currentPlan = initialPlan;
  let iteration = 1;

  while (iteration <= maxIterations) {
    logger.info("Running critic review iteration", {
      taskId,
      iteration,
      maxIterations,
    });

    const criticResult = await runLocalCriticAgent({
      taskId,
      plan: currentPlan,
      originalRequirements: requirements,
      iteration,
    });

    if (criticResult.approved) {
      logger.info("Plan approved by critic", {
        taskId,
        iteration,
        score: criticResult.score,
      });
      return { plan: currentPlan, criticResult };
    }

    if (iteration >= maxIterations) {
      logger.warn("Max critic iterations reached, proceeding with current plan", {
        taskId,
        iteration,
        score: criticResult.score,
      });
      return { plan: currentPlan, criticResult };
    }

    // Request revision
    logger.info("Critic requested revision", {
      taskId,
      iteration,
      score: criticResult.score,
      suggestions: criticResult.suggestions.length,
    });

    currentPlan = await revisePlanFn(currentPlan, criticResult);
    iteration++;
  }

  // Should never reach here
  throw new Error("Plan-critic loop exited unexpectedly");
}
