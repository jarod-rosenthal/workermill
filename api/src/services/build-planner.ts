/**
 * Build Planner Service
 *
 * Two planning modes for the Build page:
 * 1. previewPlan() — Lightweight Haiku preview (~$0.03, WorkerMill's API key)
 * 2. assembleFullPlanningPrompt() — Full prompt assembly for local worker execution
 * 3. validateAndBuildPlan() — Parse raw LLM output into validated ExecutionPlan
 *
 * The planning intelligence is split: assembleFullPlanningPrompt() decides what to ask,
 * validateAndBuildPlan() decides what to do with the answer. The expensive LLM call
 * between them runs on the user's machine.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Organization } from "../models/Organization.js";
import type { StackTemplate } from "../config/stack-templates.js";
import { getStackTemplate } from "../config/stack-templates.js";
import { logger } from "../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlanPreview {
  storyCount: number;
  personas: string[];
  techStack: string[];
  reasoning: string;
}

export interface ComplexityPreview {
  score: number;
  dimensions: {
    features: number;
    layers: number;
    files: number;
    clarity: number;
  };
}

export interface CostEstimate {
  local: number;
  byok: number;
  cloud: number;
}

export interface PreviewResult {
  preview: PlanPreview;
  complexity: ComplexityPreview;
  estimatedCost: CostEstimate;
  estimatedDuration: number;
}

export interface AssembledPrompt {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}

export interface ValidatedPlan {
  stories: Array<{
    index: number;
    title: string;
    persona: string;
    scope: string;
    acceptanceCriteria: string[];
    dependencies: number[];
    estimatedComplexity: "small" | "medium" | "large";
  }>;
  techStack: {
    language: string;
    framework: string;
    styling?: string;
    database?: string;
    testing?: string;
    rationale: string;
  };
  reasoning: string;
  qualityGates: string[];
}

// ─── Preview (Haiku, ~$0.03) ────────────────────────────────────────────────

const PREVIEW_PROMPT = `You are a technical planning assistant. Given a project description, provide a quick breakdown.

Respond with a JSON object (no markdown, no code fences):
{
  "storyCount": <number 4-25>,
  "personas": [<list of expert roles needed, e.g. "backend_developer", "frontend_developer">],
  "techStack": [<list of key technologies>],
  "reasoning": "<1-2 sentence summary of the approach>",
  "complexity": {
    "features": <1-3>,
    "layers": <1-3>,
    "files": <1-3>,
    "clarity": <1-3>
  }
}`;

/**
 * Lightweight preview using Haiku (WorkerMill's API key).
 * Returns approximate story count, personas, tech stack — NOT a full plan.
 * Cost: ~$0.03 per call.
 */
export async function previewPlan(
  description: string,
  title: string,
  _org: Organization,
  stackTemplate?: StackTemplate,
): Promise<PreviewResult> {
  const anthropic = new Anthropic();

  const stackContext = stackTemplate
    ? `\nTech stack constraint: ${stackTemplate.name} (${stackTemplate.description})`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${PREVIEW_PROMPT}\n\nProject: ${title}\n\nDescription:\n${description}${stackContext}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let parsed: {
    storyCount: number;
    personas: string[];
    techStack: string[];
    reasoning: string;
    complexity: { features: number; layers: number; files: number; clarity: number };
  };

  try {
    // Strip markdown code fences if present
    const jsonStr = text.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn("Failed to parse Haiku preview response, using defaults", { text });
    parsed = {
      storyCount: 6,
      personas: ["backend_developer", "frontend_developer"],
      techStack: ["typescript"],
      reasoning: "Unable to generate preview. Try refining your description.",
      complexity: { features: 2, layers: 2, files: 2, clarity: 2 },
    };
  }

  const totalScore =
    parsed.complexity.features +
    parsed.complexity.layers +
    parsed.complexity.files +
    parsed.complexity.clarity;

  // Cost estimates based on story count and complexity
  const baseCostPerStory = 0.80; // Average token cost per story (Sonnet)
  const byokCost = parsed.storyCount * baseCostPerStory;

  return {
    preview: {
      storyCount: parsed.storyCount,
      personas: parsed.personas,
      techStack: parsed.techStack,
      reasoning: parsed.reasoning,
    },
    complexity: {
      score: totalScore,
      dimensions: parsed.complexity,
    },
    estimatedCost: {
      local: 0,
      byok: Math.round(byokCost * 100) / 100,
      cloud: Math.round(byokCost * 1.5 * 100) / 100, // 1.5x markup for cloud
    },
    estimatedDuration: Math.max(10, parsed.storyCount * 5), // ~5 min per story
  };
}

// ─── Full Planning Prompt Assembly ──────────────────────────────────────────

const FULL_PLANNING_SYSTEM_PROMPT = `You are a technical planning agent. Analyze the project description and create a detailed execution plan with stories.

## Output Format

Respond with a JSON object (no markdown, no code fences):
{
  "reasoning": "<explanation of your approach>",
  "techStack": {
    "language": "<primary language>",
    "framework": "<primary framework>",
    "styling": "<styling approach>",
    "database": "<database if needed>",
    "testing": "<testing framework>",
    "rationale": "<why these choices>"
  },
  "stories": [
    {
      "index": 0,
      "title": "<story title>",
      "persona": "<backend_developer|frontend_developer|devops_engineer|qa_engineer|security_engineer>",
      "scope": "<detailed description of what this story implements>",
      "acceptanceCriteria": ["<criterion 1>", "<criterion 2>"],
      "dependencies": [<indices of stories this depends on>],
      "estimatedComplexity": "<small|medium|large>"
    }
  ],
  "qualityGates": ["<gate 1>", "<gate 2>"]
}

## Rules
- Stories execute sequentially in index order
- Dependencies must only reference earlier stories (lower indices)
- Each story should be completable by one expert in one session
- Include foundation/setup as story 0
- Include testing as a dedicated story
- Use real persona names from the list above`;

/**
 * Assemble full planning prompt for local worker execution.
 * Returns the assembled prompt — NOT a plan. The worker runs the LLM call.
 * Cost to WorkerMill: $0.
 */
export async function assembleFullPlanningPrompt(
  description: string,
  title: string,
  org: Organization,
  stackTemplateId?: string,
): Promise<AssembledPrompt> {
  const stackTemplate = stackTemplateId
    ? getStackTemplate(stackTemplateId)
    : undefined;

  let systemPrompt = FULL_PLANNING_SYSTEM_PROMPT;

  // Inject stack template constraints
  if (stackTemplate) {
    systemPrompt += `\n\n## Stack Constraints\nYou MUST use this technology stack:\n`;
    systemPrompt += `- Language: ${stackTemplate.techStack.language}\n`;
    systemPrompt += `- Framework: ${stackTemplate.techStack.framework}\n`;
    if (stackTemplate.techStack.styling) {
      systemPrompt += `- Styling: ${stackTemplate.techStack.styling}\n`;
    }
    if (stackTemplate.techStack.database) {
      systemPrompt += `- Database: ${stackTemplate.techStack.database}\n`;
    }
    systemPrompt += `- Testing: ${stackTemplate.techStack.testing}\n`;
    systemPrompt += `\nDefault personas: ${stackTemplate.defaultPersonas.join(", ")}`;
  }

  // Inject org-specific settings
  if (org.defaultWorkerModel) {
    systemPrompt += `\n\n## Model Context\nExecution model: ${org.defaultWorkerModel}`;
  }

  const userPrompt = `Project: ${title}\n\nDescription:\n${description}`;

  // Use Sonnet for full planning (runs on user's machine via CLI)
  const model = org.defaultWorkerModel || "claude-sonnet-4-20250514";

  return { systemPrompt, userPrompt, model };
}

// ─── Plan Validation ────────────────────────────────────────────────────────

/**
 * Validate raw LLM output from worker and build final plan.
 * Called after worker posts plan-result via POST /api/worker/plan-result.
 *
 * The raw output comes from Claude CLI (--print mode) which outputs text.
 * We need to extract the JSON plan from that text.
 */
export async function validateAndBuildPlan(
  rawOutput: string,
  _taskId: string,
): Promise<ValidatedPlan> {
  // Extract JSON from raw LLM output
  const plan = extractJsonFromText(rawOutput);

  if (!plan || !plan.stories || !Array.isArray(plan.stories)) {
    throw new Error("Invalid plan output: missing stories array");
  }

  // Validate and normalize stories
  const stories = plan.stories.map(
    (s: Record<string, unknown>, i: number) => ({
      index: typeof s.index === "number" ? s.index : i,
      title: String(s.title || `Story ${i}`),
      persona: String(s.persona || "backend_developer"),
      scope: String(s.scope || ""),
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
        ? s.acceptanceCriteria.map(String)
        : [],
      dependencies: Array.isArray(s.dependencies)
        ? s.dependencies.filter((d): d is number => typeof d === "number")
        : [],
      estimatedComplexity: (
        ["small", "medium", "large"].includes(String(s.estimatedComplexity))
          ? s.estimatedComplexity
          : "medium"
      ) as "small" | "medium" | "large",
    }),
  );

  // Fix forward dependencies (story can only depend on earlier stories)
  const fixedStories = stories.map(
    (story: (typeof stories)[number]) => ({
      ...story,
      dependencies: story.dependencies.filter(
        (dep: number) => dep < story.index,
      ),
    }),
  );

  const rawTechStack = plan.techStack as Record<string, unknown> | undefined;
  const techStack: ValidatedPlan["techStack"] = rawTechStack
    ? {
        language: String(rawTechStack.language || "typescript"),
        framework: String(rawTechStack.framework || "unknown"),
        styling: rawTechStack.styling ? String(rawTechStack.styling) : undefined,
        database: rawTechStack.database ? String(rawTechStack.database) : undefined,
        testing: rawTechStack.testing ? String(rawTechStack.testing) : undefined,
        rationale: String(rawTechStack.rationale || "Inferred from plan output"),
      }
    : {
        language: "typescript",
        framework: "unknown",
        rationale: "No tech stack specified in plan output",
      };

  const qualityGates = Array.isArray(plan.qualityGates)
    ? plan.qualityGates.map(String)
    : ["Type check passes", "Tests pass", "No lint errors"];

  logger.info("Plan validated successfully", {
    storyCount: fixedStories.length,
    personas: [...new Set(fixedStories.map((s: (typeof fixedStories)[number]) => s.persona))],
  });

  return {
    stories: fixedStories,
    techStack,
    reasoning: String(plan.reasoning || ""),
    qualityGates,
  };
}

/**
 * Extract a JSON object from raw LLM text output.
 * Handles markdown code fences, leading/trailing text, etc.
 */
function extractJsonFromText(text: string): Record<string, unknown> | null {
  // Try 1: Direct parse (output is pure JSON)
  try {
    return JSON.parse(text.trim());
  } catch {
    // Continue to next strategy
  }

  // Try 2: Extract from markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // Try 3: Find first { ... } block
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      // Continue
    }
  }

  return null;
}
