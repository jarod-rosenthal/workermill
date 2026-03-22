/**
 * Local Critic Agent Adapter
 *
 * Used by local WorkerMill (EXECUTION_MODE=local) for plan validation via Claude CLI.
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
 * Format critic feedback as a refinement prompt for the planner.
 * Used when the critic APPROVED the plan but has suggestions worth incorporating.
 */
export function formatLocalRefinementFeedback(critic: CriticResult, maxTargetFiles = 20, plan?: { summary: string; stories: unknown[]; risks: string[]; assumptions: string[] }): string {
  const lines: string[] = [
    "",
  ];

  if (plan) {
    lines.push(
      "## YOUR APPROVED PLAN",
      "",
      "Below is the plan you generated that was approved by the reviewer. Refine it based on the suggestions that follow.",
      "",
      "```json",
      JSON.stringify(plan, null, 2),
      "```",
      "",
    );
  }

  lines.push(
    "## REVIEWER NOTES — Your plan was APPROVED, but the reviewer has suggestions",
    "",
    `Score: ${critic.score}/100 (approved)`,
    "",
    "The reviewer approved your plan but identified opportunities for improvement.",
    "Review each suggestion and incorporate the ones that genuinely improve the plan.",
    "You may reject suggestions that would reduce quality or don't apply.",
    "",
  );

  if (critic.risks.length > 0) {
    lines.push("### Risks Identified:");
    for (const risk of critic.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push("");
  }

  if (critic.suggestions && critic.suggestions.length > 0) {
    lines.push("### Suggested Improvements:");
    for (const suggestion of critic.suggestions) {
      lines.push(`- ${suggestion}`);
    }
    lines.push("");
  }

  if (critic.storyFeedback && critic.storyFeedback.length > 0) {
    lines.push("### Per-Story Notes:");
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
    `List all files each story will create or modify — most stories need 3-10, foundation/scaffolding stories may need 15-25+. Stories MUST NOT overlap on targetFiles.`,
    "",
    "**CRITICAL — OUTPUT FORMAT:** Output the refined plan as a ```json code block with the COMPLETE JSON object (`summary`, `stories`, `risks`, `assumptions`). Do NOT describe changes — output the full JSON.",
    "",
    "**DO NOT re-explore the repository.** Go directly to outputting the refined ```json plan.",
  );

  return lines.join("\n");
}

/**
 * Input for the critic agent.
 */
export interface CriticInput {
  taskId: string;
  plan: ExecutionPlan;
  originalRequirements: string;
  iteration?: number;
  maxTargetFiles?: number;
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

  const model = process.env.CRITIC_MODEL || process.env.PLANNING_MODEL || defaultModels[provider] || "";

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
    // Pass environment to Claude CLI - keep OAuth token for local mode authentication.
    // Strip CLAUDECODE/CLAUDE_CODE_ENTRYPOINT — prevents nested-session guard when
    // the API was started from within a Claude Code terminal.
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const claude = spawn(
      claudePath,
      [
        "--print",
        "--output-format", "text",
        "--model", model,
        "--strict-mcp-config",
      ],
      {
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Write prompt via stdin (matches agent/src/plan-validator.ts pattern)
    claude.stdin.write(prompt);
    claude.stdin.end();

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vercel AI SDK providers return mixed LanguageModelV1/V2/V3
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
      const client = createOpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "ollama" });
      model = client(modelName);
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
  const { plan, originalRequirements, iteration, maxTargetFiles = 20 } = input;

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
4. **Unfocused Scope** - Each story should own a single concern (e.g., "database layer", "auth system", "UI components"). Deduct points only if a story mixes unrelated concerns. Do NOT penalize stories for listing many files — foundation/scaffolding stories legitimately touch 15-25+ files.
5. **Quality (15 points):** Are acceptance criteria clear and testable?
6. **Overlapping File Scope** - If two or more stories share the same targetFiles, this causes parallel merge conflicts. Stories MUST NOT overlap on targetFiles. Deduct 10 points per shared file across stories.
7. **Serialization Bottleneck** - If more than half the stories depend on a single story, the plan has a bottleneck. Deduct 15 points — split the foundation or allow more parallel work.
8. **Risk Management (15 points):** Are risks properly identified and mitigated?

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
${(story.acceptanceCriteria || []).map(c => `  - ${c}`).join("\n") || "  - (see original ticket)"}`;
}

/**
 * Extract a balanced JSON object from a string starting at the given position.
 * Properly handles nested braces, strings with escaped characters, and code
 * blocks embedded in JSON string values (which contain triple backticks).
 */
function extractBalancedJson(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      if (inString) escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }

  return null; // Unbalanced
}

/**
 * Parse critic result from Claude output.
 * Uses bracket-matching instead of lazy regex to handle backticks in reasoning text.
 */
function parseCriticResult(output: string): CriticResult {
  // Strategy 1: Find ```json fence and extract balanced JSON
  const jsonFenceStart = output.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = output.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(output, braceStart);
      if (extracted) {
        return normalizeCriticResult(JSON.parse(extracted));
      }
    }
  }

  // Strategy 2: Find raw JSON from first {
  const braceStart = output.indexOf("{");
  if (braceStart !== -1) {
    const extracted = extractBalancedJson(output, braceStart);
    if (extracted) {
      return normalizeCriticResult(JSON.parse(extracted));
    }
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
