/**
 * Local Planning Agent Adapter
 *
 * Supports multiple providers for local development:
 * - Anthropic: Uses Claude CLI with OAuth (no API key needed)
 * - OpenAI, Google, Ollama: Uses AI SDK with API keys from env
 *
 * Configure via environment variables:
 * - PLANNING_PROVIDER: "anthropic" (default), "openai", "google", "ollama"
 * - PLANNING_MODEL: Model name (default: "sonnet" for Claude CLI, provider-specific otherwise)
 *
 * For non-Anthropic providers, set the appropriate API key:
 * - OPENAI_API_KEY, GOOGLE_API_KEY, OLLAMA_BASE_URL
 */

import { spawn } from "child_process";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOllama } from "ollama-ai-provider";
import { logger } from "../utils/logger.js";

/**
 * Story interface for planning output.
 */
export interface PlannedStory {
  id: string;
  title: string;
  description: string;
  persona: string;
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[];
  acceptanceCriteria: string[];
}

/**
 * Execution plan output from planning agent.
 */
export interface ExecutionPlan {
  summary: string;
  stories: PlannedStory[];
  risks: string[];
  assumptions: string[];
}

/**
 * Input for the planning agent.
 */
export interface PlanningInput {
  taskId: string;
  title: string;
  description: string;
  jiraIssueKey?: string;
  labels?: string[];
  attachments?: Array<{ filename: string; content: string }>;
}

/**
 * Get planning configuration from environment.
 */
function getPlanningConfig(): { provider: string; model: string } {
  const provider = process.env.PLANNING_PROVIDER || "anthropic";

  // Default models per provider
  const defaultModels: Record<string, string> = {
    anthropic: "sonnet",
    openai: "gpt-4o",
    google: "gemini-2.0-flash",
    ollama: "qwen2.5-coder:32b",
  };

  const model = process.env.PLANNING_MODEL || defaultModels[provider] || "sonnet";

  return { provider, model };
}

/**
 * Run the planning agent locally.
 * Routes to Claude CLI for Anthropic, AI SDK for other providers.
 */
export async function runLocalPlanningAgent(
  input: PlanningInput
): Promise<ExecutionPlan> {
  const { provider, model } = getPlanningConfig();
  const prompt = buildPlanningPrompt(input);

  logger.info("Running local planning agent", {
    taskId: input.taskId,
    title: input.title,
    provider,
    model,
    promptLength: prompt.length,
  });

  if (provider === "anthropic") {
    return runWithClaudeCli(input, prompt, model);
  } else {
    return runWithAiSdk(input, prompt, provider, model);
  }
}

/**
 * Run planning with Claude CLI (Anthropic only).
 * Uses OAuth authentication from Claude CLI.
 */
async function runWithClaudeCli(
  input: PlanningInput,
  prompt: string,
  model: string
): Promise<ExecutionPlan> {
  const claudePath = process.env.CLAUDE_CLI_PATH || "/home/user/.local/bin/claude";

  logger.info("Using Claude CLI for planning", {
    taskId: input.taskId,
    model,
    claudePath,
  });

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
        logger.error("Planning agent (Claude CLI) failed", {
          taskId: input.taskId,
          code,
          stderr: stderr.substring(0, 500),
          stdout: stdout.substring(0, 500),
        });
        reject(new Error(`Planning agent exited with code ${code}: ${stderr || stdout}`.substring(0, 300)));
        return;
      }

      try {
        const plan = parseExecutionPlan(stdout);
        logger.info("Planning agent (Claude CLI) completed", {
          taskId: input.taskId,
          storyCount: plan.stories.length,
        });
        resolve(plan);
      } catch (e) {
        logger.error("Failed to parse planning output", {
          taskId: input.taskId,
          error: e instanceof Error ? e.message : String(e),
          outputPreview: stdout.substring(0, 500),
        });
        reject(e);
      }
    });

    claude.on("error", (err) => {
      logger.error("Planning agent process error", {
        taskId: input.taskId,
        error: err.message,
      });
      reject(err);
    });
  });
}

/**
 * Run planning with AI SDK (OpenAI, Google, Ollama).
 */
async function runWithAiSdk(
  input: PlanningInput,
  prompt: string,
  provider: string,
  modelName: string
): Promise<ExecutionPlan> {
  logger.info("Using AI SDK for planning", {
    taskId: input.taskId,
    provider,
    model: modelName,
  });

  // Create model based on provider
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
      maxOutputTokens: 8192,
    });

    const plan = parseExecutionPlan(response.text);
    logger.info("Planning agent (AI SDK) completed", {
      taskId: input.taskId,
      provider,
      storyCount: plan.stories.length,
      tokensUsed: response.usage?.totalTokens,
    });
    return plan;
  } catch (e) {
    logger.error("Planning agent (AI SDK) failed", {
      taskId: input.taskId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/**
 * Build the planning prompt from input.
 */
function buildPlanningPrompt(input: PlanningInput): string {
  let prompt = `You are a technical planning agent. Your job is to analyze a task and break it down into executable stories.

## Task Details

**Title:** ${input.title}

**Description:**
${input.description}

${input.jiraIssueKey ? `**Jira Issue:** ${input.jiraIssueKey}` : ""}
${input.labels?.length ? `**Labels:** ${input.labels.join(", ")}` : ""}

`;

  if (input.attachments?.length) {
    prompt += "## Attachments\n\n";
    for (const att of input.attachments) {
      prompt += `### ${att.filename}\n\`\`\`\n${att.content}\n\`\`\`\n\n`;
    }
  }

  prompt += `## Instructions

Analyze this task and create an execution plan with stories.

For each story:
1. Assign a unique ID (e.g., "story-1", "story-2")
2. Write a clear title
3. Write a detailed description of what needs to be done
4. Assign a persona: frontend_developer, backend_developer, devops_engineer, qa_engineer, security_engineer, or tech_writer
5. Set priority (1 = highest)
6. Estimate effort: small (< 1 hour), medium (1-4 hours), large (4+ hours)
7. List dependencies (IDs of stories that must complete first)
8. Write acceptance criteria

## Response Format

Respond with a JSON object in this exact format:

\`\`\`json
{
  "summary": "Brief summary of the overall plan",
  "stories": [
    {
      "id": "story-1",
      "title": "Story title",
      "description": "Detailed description",
      "persona": "backend_developer",
      "priority": 1,
      "estimatedEffort": "medium",
      "dependencies": [],
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"]
    }
  ],
  "risks": ["Risk 1", "Risk 2"],
  "assumptions": ["Assumption 1"]
}
\`\`\`

Important:
- Order stories by priority and dependencies
- Ensure no circular dependencies
- Be specific in acceptance criteria
- Identify real risks, not generic ones
`;

  return prompt;
}

/**
 * Parse execution plan from Claude output.
 */
function parseExecutionPlan(output: string): ExecutionPlan {
  // Try to extract JSON from the response
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }

  // Try to find raw JSON
  const rawJsonMatch = output.match(/\{[\s\S]*"stories"[\s\S]*\}/);
  if (rawJsonMatch) {
    return JSON.parse(rawJsonMatch[0]);
  }

  throw new Error("Could not find JSON execution plan in output");
}

/**
 * Check if we should use local planning agent.
 * In local mode, we use Claude CLI which handles its own authentication.
 */
export function shouldUseLocalPlanning(): boolean {
  return process.env.EXECUTION_MODE === "local";
}
