/**
 * Local Critic Agent Adapter
 *
 * Supports multiple providers for plan review:
 * - Anthropic: Uses Claude CLI with OAuth (no API key needed)
 * - OpenAI, Google, Ollama: Uses AI SDK with API keys from env
 *
 * Configure via environment variables:
 * - CRITIC_PROVIDER: Falls back to PLANNING_PROVIDER, then "anthropic"
 * - CRITIC_MODEL: Falls back to PLANNING_MODEL, then provider default
 */

import { spawn } from "child_process";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
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
 * Get critic configuration from environment.
 * Falls back to planning agent settings if not specified.
 */
function getCriticConfig(): { provider: string; model: string } {
  const provider = process.env.CRITIC_PROVIDER || process.env.PLANNING_PROVIDER || "anthropic";

  const defaultModels: Record<string, string> = {
    anthropic: "sonnet",
    openai: "gpt-4o",
    google: "gemini-2.0-flash",
    ollama: "qwen2.5-coder:32b",
  };

  const model = process.env.CRITIC_MODEL || process.env.PLANNING_MODEL || defaultModels[provider] || "sonnet";

  return { provider, model };
}

/**
 * Run the critic agent locally.
 * Routes to Claude CLI for Anthropic, AI SDK for other providers.
 */
export async function runLocalCriticAgent(
  input: CriticInput
): Promise<CriticResult> {
  const { provider, model } = getCriticConfig();
  const prompt = buildCriticPrompt(input);

  logger.info("Running local critic agent", {
    taskId: input.taskId,
    storyCount: input.plan.stories.length,
    iteration: input.iteration || 1,
    provider,
    model,
  });

  if (provider === "anthropic") {
    return runCriticWithClaudeCli(input, prompt, model);
  } else {
    return runCriticWithAiSdk(input, prompt, provider, model);
  }
}

/**
 * Run critic with Claude CLI (Anthropic only).
 */
async function runCriticWithClaudeCli(
  input: CriticInput,
  prompt: string,
  model: string
): Promise<CriticResult> {
  const claudePath = process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";

  return new Promise((resolve, reject) => {
    // Pass environment to Claude CLI - keep OAuth token for local mode authentication
    const cleanEnv = { ...process.env };

    const claude = spawn(
      claudePath,
      [
        "--print",
        "--output-format", "text",
        "--model", model,
        prompt,
      ],
      {
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
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

    claude.on("close", (code) => {
      if (code !== 0) {
        logger.error("Critic agent (Claude CLI) failed", {
          taskId: input.taskId,
          code,
          stderr: stderr.substring(0, 500),
        });
        reject(new Error(`Critic agent exited with code ${code}: ${stderr.substring(0, 200)}`));
        return;
      }

      try {
        const result = parseCriticResult(stdout);
        logger.info("Critic agent (Claude CLI) completed", {
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
 * Run critic with AI SDK (OpenAI, Google, Ollama).
 */
async function runCriticWithAiSdk(
  input: CriticInput,
  prompt: string,
  provider: string,
  modelName: string
): Promise<CriticResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let model: any;
  switch (provider) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");
      const client = createOpenAI({ apiKey });
      model = client(modelName);
      break;
    }
    case "google":
    case "gemini": {
      const apiKey = process.env.GOOGLE_API_KEY;
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set");
      const client = createGoogleGenerativeAI({ apiKey });
      model = client(modelName);
      break;
    }
    case "ollama": {
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const ollama = createOllama({ baseURL: baseUrl });
      model = ollama(modelName);
      break;
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: anthropic, openai, google, ollama`);
  }

  try {
    const response = await generateText({
      model,
      prompt,
      maxOutputTokens: 4096,
    });

    const result = parseCriticResult(response.text);
    logger.info("Critic agent (AI SDK) completed", {
      taskId: input.taskId,
      provider,
      score: result.score,
      approved: result.approved,
      tokensUsed: response.usage?.totalTokens,
    });
    return result;
  } catch (e) {
    logger.error("Critic agent (AI SDK) failed", {
      taskId: input.taskId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
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
  return process.env.EXECUTION_MODE === "local";
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
