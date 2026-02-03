/**
 * Local Planning Agent Adapter
 *
 * Uses Claude CLI with OAuth token instead of AI SDK for local development.
 * Provides the same interface as planning-agent.ts but for local execution.
 *
 * This is used when EXECUTION_MODE=local to avoid needing API keys.
 */

import { spawn } from "child_process";
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
 * Run the planning agent locally using Claude CLI.
 */
export async function runLocalPlanningAgent(
  input: PlanningInput
): Promise<ExecutionPlan> {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

  if (!oauthToken) {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN is required for local planning agent. " +
      "Run 'claude auth login' to authenticate."
    );
  }

  const prompt = buildPlanningPrompt(input);

  logger.info("Running local planning agent", {
    taskId: input.taskId,
    title: input.title,
    promptLength: prompt.length,
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
        logger.error("Planning agent failed", {
          taskId: input.taskId,
          code,
          stderr: stderr.substring(0, 500),
        });
        reject(new Error(`Planning agent exited with code ${code}: ${stderr.substring(0, 200)}`));
        return;
      }

      try {
        const plan = parseExecutionPlan(stdout);
        logger.info("Planning agent completed", {
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
 */
export function shouldUseLocalPlanning(): boolean {
  return process.env.EXECUTION_MODE === "local" && !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
}
