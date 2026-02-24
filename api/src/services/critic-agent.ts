/**
 * Planning Agent Service
 *
 * Generates and validates execution plans using configurable AI providers.
 * Uses Vercel AI SDK for unified multi-provider support (Anthropic, OpenAI, Google, Ollama).
 *
 * The provider and model are configured via organization settings:
 * - planningAgentProvider: "anthropic" | "openai" | "google" | "ollama"
 * - planningAgentModel: e.g., "claude-sonnet-4-5-20250929", "gpt-4o", "gemini-2.0-flash", "qwen2.5-coder:32b"
 * - ollamaBaseUrl: Required for Ollama (e.g., "https://ollama.example.com")
 *
 * Design principles:
 * - Plans must score > 85 or be explicitly approved to pass
 * - Max 3 iterations of Planner-Critic refinement before escalation
 */

import { logger } from "../utils/logger.js";
import { createLLMBackend, type LLMBackend, type LLMStreamEvent } from "./llm-backend.js";
import type { PlanningProgressEvent, PlanningPhase } from "./planning-progress-events.js";
import type {
  CriticResult,
  ExecutionPlanV2,
  PlannedStepV2,
  TechStackV2,
  PlanningMetadataV2,
} from "./pipeline-v2-types.js";

// Re-export CriticResult for consumers
export type { CriticResult };

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Configuration for the Planning Agent.
 * Sourced from organization settings (planningAgentProvider, planningAgentModel).
 */
export interface PlanningAgentConfig {
  provider: "anthropic" | "openai" | "google" | "ollama";
  model: string;
  orgId: string; // Required to fetch org-specific API keys
  ollamaBaseUrl?: string; // Required when provider is "ollama"
}

/** Default configuration (used when org settings not available) */
const DEFAULT_CONFIG: PlanningAgentConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  orgId: "", // Will use env vars if orgId not provided
};

/** Minimum score required for auto-approval */
const AUTO_APPROVAL_THRESHOLD = 85;

/** Maximum Planner-Critic iterations before throwing */
const MAX_ITERATIONS = 3;

// ============================================================================
// PLANNING AGENT VISIBILITY
// ============================================================================

/**
 * Provider icons for log visibility (consistent with worker/epic/executor.ts)
 */
const PROVIDER_ICONS: Record<string, string> = {
  anthropic: "🤖",
  openai: "🔷",
  google: "🔵",
  gemini: "🔵",
  ollama: "🏠",
};

/**
 * Get formatted log prefix for planning agent output.
 * Format: [💡 planning_agent 🔷] for planning + provider visibility
 */
function getPlanningAgentPrefix(provider: string): string {
  const providerIcon = PROVIDER_ICONS[provider] || "🤖";
  return `[💡 planning_agent ${providerIcon}]`;
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/**
 * Error thrown when plan validation fails after max iterations
 */
export class PlanValidationError extends Error {
  public readonly iterations: number;
  public readonly lastScore: number;
  public readonly lastRisks: string[];
  public readonly lastSuggestions: string[];

  constructor(
    message: string,
    iterations: number,
    lastScore: number,
    lastRisks: string[],
    lastSuggestions: string[] = []
  ) {
    super(message);
    this.name = "PlanValidationError";
    this.iterations = iterations;
    this.lastScore = lastScore;
    this.lastRisks = lastRisks;
    this.lastSuggestions = lastSuggestions;
  }
}

// ============================================================================
// LLM BACKEND HELPER
// ============================================================================

/**
 * Create an LLM backend for the given agent config.
 * Auto-detects ClaudeCliBackend (local mode) vs AiSdkBackend (cloud).
 */
function getBackend(agentConfig: PlanningAgentConfig): LLMBackend {
  return createLLMBackend({
    provider: agentConfig.provider,
    orgId: agentConfig.orgId,
    ollamaBaseUrl: agentConfig.ollamaBaseUrl,
  });
}

// ============================================================================
// PROMPTS
// ============================================================================

/**
 * Plan generation prompt
 */
const PLAN_GENERATION_PROMPT = `You are a technical planning agent for the V2 Pipeline.

Analyze this PRD and create an execution plan with the MINIMUM number of steps needed.

## PRD (Product Requirements Document)
{{PRD}}

## CRITICAL: Right-Size the Plan

Match plan complexity to task complexity:

**SIMPLE TASKS** (bug fixes, typos, config changes, single-file edits):
- Use 1 step with a single persona
- Don't over-engineer simple work

**MEDIUM TASKS** (new features touching 2-4 files, refactoring):
- Use 2-3 steps as needed
- May use different personas if truly different skills needed

**COMPLEX TASKS** (new systems, multi-component features, security changes):
- Use 3-5 steps with appropriate personas
- Each step is executed by a specialized worker

## Available Personas (use the right one for each step)

| Persona | Specialization |
|---------|---------------|
| architect | System decomposition, task planning, architecture design |
| backend_developer | REST APIs, database, server-side logic, GraphQL, OpenAPI, query optimization |
| frontend_developer | React, TypeScript, Tailwind, UI components, accessibility |
| mobile_developer | iOS (Swift, SwiftUI), Android (Kotlin, Jetpack Compose), React Native |
| devops_engineer | Terraform, Docker, CI/CD, AWS, infrastructure |
| security_engineer | OWASP, vulnerability assessment, security auditing |
| qa_engineer | Test automation, Playwright, Jest, quality assurance |
| data_ml_engineer | ETL/ELT, data pipelines, ML model training, MLOps |
| tech_writer | Documentation, API docs, technical guides |
| tech_lead | Code review, architecture review, quality gate |
| project_manager | Task breakdown, planning, coordination |

## Planning Rules

1. **Atomic Steps**: Each step should be completable in a single focused session
2. **Max 3 Files**: Each step should modify at most 3 files (operational steps may modify 0 files)
3. **Clear Verification**: Each step must have a concrete way to verify completion
4. **Sequential Flow**: Steps execute sequentially, commit on success
5. **Multi-Persona**: Assign the MOST APPROPRIATE persona to each step

## Verification Types

- **logic**: Strict TDD - Write failing test, implement, test passes
- **ui**: Structural - Build passes, component mounts, snapshot test
- **docs**: Linting - Markdown lint, link validation
- **config**: Validation - Config parses, no syntax errors
- **operational**: Execution - Run commands (deploy, migrate, provision), verify output/state

## Operational/Deployment Tasks

When a PRD requires running commands (terraform apply, deploy scripts, database migrations, etc.):
- Create steps with \`verificationType: "operational"\`
- The step description MUST include the exact commands to run
- verificationInstructions MUST specify how to confirm success (e.g., "terraform apply exits 0, resources created in AWS")
- targetFiles can be empty for pure command-execution steps
- Use the devops_engineer persona for infrastructure/deployment steps
- Separate "write code" from "deploy/run" — these should be different steps

## Output Format

First, share your analysis and reasoning (2-4 sentences per thought). Think through:
1. What is the core task? What problem are we solving?
2. What components/files will be affected?
3. How should we break this down? What personas are needed?
4. What's the right level of complexity for this task?

After your reasoning, output a JSON block with the execution plan.

Example format:
---
Analyzing the requirements...

This task involves [what the task is about]. The main work will be in [areas/files].

I'll need to [approach]. Since [reasoning], I'll use [X] step(s) with [persona(s)].

\`\`\`json
{
  "architecturalSummary": "...",
  ...
}
\`\`\`
---

Now, analyze and create the plan:

JSON Schema for the plan:
{
  "architecturalSummary": "string - high-level summary (2-3 sentences)",
  "techStack": {
    "language": "typescript|python|javascript|go",
    "framework": "react|fastapi|express|nextjs|none",
    "styling": "tailwind|css-modules|vanilla-css",
    "database": "postgresql|mongodb|sqlite|none",
    "testing": "vitest|jest|pytest",
    "buildTool": "vite|webpack|esbuild",
    "rationale": "string - why these choices"
  },
  "steps": [
    {
      "index": 0,
      "title": "string",
      "description": "string",
      "persona": "architect|backend_developer|frontend_developer|mobile_developer|devops_engineer|security_engineer|qa_engineer|data_ml_engineer|tech_writer|tech_lead|project_manager",
      "verificationType": "logic|ui|docs|config|operational",
      "verificationInstructions": "string",
      "targetFiles": ["file1.ts", "file2.ts"],
      "referenceFiles": ["ref1.ts"],
      "estimatedComplexity": 1
    },
    {
      "index": 1,
      "title": "Deploy infrastructure",
      "description": "Run terraform apply in infrastructure/ to provision the VPC and ECS cluster",
      "persona": "devops_engineer",
      "verificationType": "operational",
      "verificationInstructions": "terraform apply exits 0, verify resources exist with aws cli",
      "targetFiles": [],
      "referenceFiles": ["infrastructure/main.tf"],
      "estimatedComplexity": 2
    }
  ]
}`;

/**
 * Plan refinement prompt - used when Critic rejects a plan
 */
const REFINEMENT_PROMPT = `You are a technical planning agent refining an execution plan based on Critic feedback.

## Original PRD
{{PRD}}

## Previous Plan (Rejected)
{{PREVIOUS_PLAN}}

## Critic Feedback
Score: {{SCORE}}/100

Risks identified:
{{RISKS}}

Suggestions:
{{SUGGESTIONS}}

## Your Task

Create an improved execution plan that addresses ALL the Critic's feedback.

Focus on:
1. Adding any missing steps the Critic identified
2. Making vague requirements more specific
3. Adding security measures for identified vulnerabilities
4. Fixing dependency relationships
5. Breaking down oversized steps (>3 files)
6. Adding verification strategies for complex logic
7. Adding operational/deployment steps when the PRD requires running commands, not just writing files

First, explain your refinements (2-4 sentences). What feedback are you addressing? What changes are you making?

Then output the refined JSON plan in a code block.

Example format:
---
Addressing the Critic's feedback...

The main issues were [issues]. I'm improving the plan by [changes].

\`\`\`json
{
  "architecturalSummary": "...",
  ...
}
\`\`\`
---`;

/**
 * Critic prompt for plan validation
 */
const CRITIC_PROMPT = `You are a Senior Architect reviewing an execution plan. Your job is to ensure the plan is appropriately sized for the task.

Review this execution plan against the PRD:

## PRD (Product Requirements Document)
{{PRD}}

## PROPOSED EXECUTION PLAN
{{PLAN}}

## Review Guidelines

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
4. **Unrealistic Scope** - Any step targeting >5 files MUST score below 85 (auto-rejection threshold). Each step should modify at most 5 files. If a step needs more, split it into multiple steps first.
5. **Missing Operational Steps** - If the PRD requires deployment, provisioning, migrations, or running commands, does the plan include operational steps? Writing code is not the same as deploying it.
6. **Overlapping File Scope** - If two or more steps share the same targetFiles, this causes parallel merge conflicts. Steps MUST NOT overlap on targetFiles. Deduct 10 points per shared file across steps.
7. **Serialization Bottleneck** - If more than half the stories depend on a single story that targets >5 files, the plan has a bottleneck. Deduct 15 points — split the foundation or allow more parallel work.

## Scoring Guide

- **90-100**: Plan matches task complexity, requirements covered
- **75-89**: Minor gaps but fundamentally sound
- **50-74**: Significant issues or wrong-sized for the task
- **0-49**: Fundamentally flawed

## Output Format

Respond with ONLY a JSON object (no markdown, no explanation):
{"approved": boolean, "score": number, "risks": ["risk1", "risk2"], "suggestions": ["suggestion1", "suggestion2"], "storyFeedback": [{"storyId": "step-0", "feedback": "specific feedback", "suggestedChanges": ["change1"]}]}

Rules:
- approved = true if score >= 85 AND plan is right-sized for task
- risks = specific issues (empty array if none)
- suggestions = actionable improvements (empty array if none)
- storyFeedback = per-step feedback (optional, only for steps that need changes)`;

// ============================================================================
// PLAN GENERATION
// ============================================================================

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
 * Parse plan JSON response and normalize structure.
 * Handles responses with reasoning text before the JSON block.
 * Uses bracket-matching instead of lazy regex to handle backticks in reasoning text.
 */
function parsePlanResponse(text: string): ExecutionPlanV2 {
  let jsonText: string | null = null;

  // Strategy 1: Find ```json fence and extract balanced JSON after it
  const jsonFenceStart = text.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = text.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      jsonText = extractBalancedJson(text, braceStart);
    }
  }

  // Strategy 2: Find raw JSON object from first {
  if (!jsonText) {
    const braceStart = text.indexOf("{");
    if (braceStart !== -1) {
      jsonText = extractBalancedJson(text, braceStart);
    }
  }

  if (!jsonText) {
    throw new Error("No JSON found in plan response");
  }

  const input = JSON.parse(jsonText) as {
    architecturalSummary: string;
    techStack: TechStackV2;
    steps: PlannedStepV2[];
  };

  // Ensure steps have correct indices
  const steps = input.steps.map((step, idx) => ({
    ...step,
    index: idx,
    referenceFiles: step.referenceFiles || [],
    estimatedComplexity: step.estimatedComplexity || (2 as 1 | 2 | 3),
  }));

  return {
    version: 3,
    architecturalSummary: input.architecturalSummary,
    techStack: {
      ...input.techStack,
      templateId: input.techStack.templateId || null,
    },
    steps,
  };
}

/**
 * Parse critic JSON response.
 * Uses bracket-matching instead of lazy regex to handle backticks in reasoning text.
 */
function parseCriticResponse(text: string): CriticResult & { model: string } {
  let jsonText: string | null = null;

  // Strategy 1: Find ```json fence and extract balanced JSON
  const jsonFenceStart = text.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = text.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      jsonText = extractBalancedJson(text, braceStart);
    }
  }

  // Strategy 2: Find raw JSON from first {
  if (!jsonText) {
    const braceStart = text.indexOf("{");
    if (braceStart !== -1) {
      jsonText = extractBalancedJson(text, braceStart);
    }
  }

  if (!jsonText) {
    throw new Error("No JSON found in critic response");
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
    storyFeedback: Array.isArray(result.storyFeedback) ? result.storyFeedback : undefined,
    model: "", // Will be set by caller
  };
}

/**
 * Progress callback for streaming plan generation thoughts
 */
export type PlanThoughtCallback = (thought: string) => void;

/**
 * Callback for real-time stream progress (phase changes, elapsed time, chars generated).
 * Used to feed planningProgressEmitter for SSE updates to the dashboard.
 */
export type PlanStreamProgressCallback = (event: PlanningProgressEvent) => void;

/**
 * Generate initial V2 execution plan using the configured provider
 * Streams reasoning/thoughts before outputting JSON plan.
 *
 * @param prd - The PRD text
 * @param agentConfig - Provider/model configuration from org settings
 * @param previousPlan - Previous plan for refinement (optional)
 * @param criticFeedback - Critic feedback for refinement (optional)
 * @param onThought - Optional callback for streaming reasoning thoughts
 * @param onStreamProgress - Optional callback for real-time phase/progress updates (feeds SSE)
 */
export async function generatePlan(
  prd: string,
  agentConfig: PlanningAgentConfig = DEFAULT_CONFIG,
  previousPlan?: ExecutionPlanV2,
  criticFeedback?: CriticResult,
  onThought?: PlanThoughtCallback,
  onStreamProgress?: PlanStreamProgressCallback,
): Promise<ExecutionPlanV2> {
  let prompt: string;

  if (previousPlan && criticFeedback) {
    // Refinement mode
    prompt = REFINEMENT_PROMPT
      .replace("{{PRD}}", prd)
      .replace("{{PREVIOUS_PLAN}}", JSON.stringify(previousPlan, null, 2))
      .replace("{{SCORE}}", String(criticFeedback.score))
      .replace("{{RISKS}}", (criticFeedback.risks || []).map((r) => `- ${r}`).join("\n") || "None identified")
      .replace("{{SUGGESTIONS}}", (criticFeedback.suggestions || []).map((s) => `- ${s}`).join("\n") || "None provided");
  } else {
    // Initial generation
    prompt = PLAN_GENERATION_PROMPT.replace("{{PRD}}", prd);
  }

  const backend = getBackend(agentConfig);

  logger.info("Generating plan via LLM backend", {
    provider: agentConfig.provider,
    model: agentConfig.model,
    isRefinement: !!previousPlan,
    hasThoughtCallback: !!onThought,
  });
  // Terminal visibility: log the LLM call start
  const providerIcon = PROVIDER_ICONS[agentConfig.provider] || "🤖";
  logger.info(`[💡 planning_agent ${providerIcon}] Generating plan`, { provider: agentConfig.provider, model: agentConfig.model, refinement: !!previousPlan });

  // Use streaming if thought callback is provided
  if (onThought) {
    const stream = backend.stream({
      prompt,
      model: agentConfig.model,
      temperature: 0,
    });

    let fullText = "";
    let currentLine = "";
    let inJsonBlock = false;

    // Stream the response and emit thoughts from text_delta events
    for await (const event of stream) {
      if (event.type === "text_delta" && event.text) {
        fullText += event.text;
        currentLine += event.text;

        // Check if we've entered the JSON block
        if (currentLine.includes("```json") || currentLine.includes("```\n{")) {
          inJsonBlock = true;
        }

        // Emit complete lines as thoughts (but not the JSON block)
        while (currentLine.includes("\n")) {
          const newlineIndex = currentLine.indexOf("\n");
          const line = currentLine.substring(0, newlineIndex).trim();
          currentLine = currentLine.substring(newlineIndex + 1);

          // Only emit non-empty lines that aren't part of JSON
          if (line && !inJsonBlock && !line.startsWith("{") && !line.startsWith('"') && !line.startsWith("}")) {
            // Skip markdown delimiters and empty content
            if (line !== "---" && line !== "```" && line !== "```json") {
              onThought(line);
            }
          }
        }
      } else if (event.type === "result" && event.text) {
        // Final result event — use as fallback if text_delta events were missing
        if (!fullText.trim()) {
          fullText = event.text;
        }
      } else if ((event.type === "phase_change" || event.type === "progress") && onStreamProgress) {
        // Forward phase/progress events to the SSE planning progress emitter
        onStreamProgress({
          phase: (event.phase || "generating_plan") as PlanningPhase,
          elapsedSeconds: 0, // Backend doesn't track this; orchestrator can override
          detail: event.detail || "",
          charsGenerated: event.charsGenerated || 0,
          toolCallCount: event.toolCallCount || 0,
        });
      }
    }

    // Emit any remaining content
    if (currentLine.trim() && !inJsonBlock) {
      onThought(currentLine.trim());
    }

    return parsePlanResponse(fullText);
  }

  // Non-streaming fallback
  const result = await backend.generate({
    prompt,
    model: agentConfig.model,
    temperature: 0,
  });

  return parsePlanResponse(result.text);
}

/**
 * Validate an execution plan against a PRD using the configured provider
 *
 * @param prd - The Product Requirements Document text
 * @param plan - The execution plan to validate
 * @param agentConfig - Provider/model configuration from org settings
 */
export async function validatePlanWithCritic(
  prd: string,
  plan: ExecutionPlanV2,
  agentConfig: PlanningAgentConfig = DEFAULT_CONFIG
): Promise<CriticResult> {
  const prompt = CRITIC_PROMPT
    .replace("{{PRD}}", prd)
    .replace("{{PLAN}}", JSON.stringify(plan, null, 2));

  const backend = getBackend(agentConfig);

  logger.info("Validating plan via LLM backend", {
    provider: agentConfig.provider,
    model: agentConfig.model,
    stepCount: plan.steps.length,
  });
  // Terminal visibility: log critic validation start
  {
    const providerIcon = PROVIDER_ICONS[agentConfig.provider] || "🤖";
    logger.info(`[💡 critic ${providerIcon}] Validating plan`, { steps: plan.steps.length, provider: agentConfig.provider, model: agentConfig.model });
  }

  const result = await backend.generate({
    prompt,
    model: agentConfig.model,
    maxOutputTokens: 2048,
    temperature: 0,
  });

  const criticResult = parseCriticResponse(result.text);
  criticResult.model = agentConfig.model;

  logger.info("Critic validation complete", {
    approved: criticResult.approved,
    score: criticResult.score,
    riskCount: criticResult.risks.length,
  });
  // Terminal visibility: log critic result
  {
    const providerIcon = PROVIDER_ICONS[agentConfig.provider] || "🤖";
    logger.info(`[💡 critic ${providerIcon}] Score: ${criticResult.score}/100 — ${criticResult.approved ? "approved" : "rejected"}`, { risks: criticResult.risks.length });
  }

  return criticResult;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export type PlanProgressCallback = (message: string, details?: {
  iteration?: number;
  maxIterations?: number;
  score?: number;
  stepCount?: number;
  phase?: "generating" | "validating" | "refining" | "approved" | "rejected" | "fallback";
}) => void;

/**
 * Generate and validate an execution plan with Planner-Critic iteration
 *
 * This is the main entry point for V2 pipeline plan generation.
 *
 * @param prd - The Product Requirements Document text
 * @param agentConfig - Provider/model configuration from org settings
 * @param maxAttempts - Maximum Planner-Critic iterations (default: 3)
 * @param onProgress - Optional callback for reporting iteration progress
 * @param skipCritic - Skip critic validation (for testing)
 * @param onStreamProgress - Optional callback for real-time phase/progress updates (feeds SSE)
 */
export async function generateValidatedPlan(
  prd: string,
  agentConfig: PlanningAgentConfig = DEFAULT_CONFIG,
  maxAttempts: number = MAX_ITERATIONS,
  onProgress?: PlanProgressCallback,
  skipCritic: boolean = false,
  onStreamProgress?: PlanStreamProgressCallback,
): Promise<ExecutionPlanV2> {
  const startTime = Date.now();
  let currentPlan: ExecutionPlanV2 | undefined;
  let lastCriticResult: CriticResult | undefined;
  let llmCalls = 0;

  // Get the planning agent prefix for consistent log formatting
  const prefix = getPlanningAgentPrefix(agentConfig.provider);

  // If skipCritic is true, generate plan once without validation
  if (skipCritic) {
    logger.info("Generating plan without Critic validation", {
      provider: agentConfig.provider,
      model: agentConfig.model,
    });
    onProgress?.(`${prefix} Generating plan (Critic validation disabled)...`, {
      iteration: 1,
      maxIterations: 1,
      phase: "generating",
    });

    // Create thought callback to stream planning agent's reasoning
    const thoughtCallback: PlanThoughtCallback | undefined = onProgress
      ? (thought: string) => {
          onProgress(`${prefix} ${thought}`, { phase: "generating" });
        }
      : undefined;

    llmCalls++;
    currentPlan = await generatePlan(prd, agentConfig, undefined, undefined, thoughtCallback, onStreamProgress);

    logger.info("Plan generated without Critic validation", {
      stepCount: currentPlan.steps.length,
      techStack: currentPlan.techStack.framework,
    });

    onProgress?.(
      `${prefix} Plan generated with ${currentPlan.steps.length} steps (Critic validation skipped).`,
      {
        iteration: 1,
        maxIterations: 1,
        stepCount: currentPlan.steps.length,
        score: 100,
        phase: "approved",
      }
    );

    const planningDurationMs = Date.now() - startTime;
    const metadata: PlanningMetadataV2 = {
      llmCalls,
      planningDurationMs,
      plannerModel: agentConfig.model,
      criticModel: "skipped",
      iterationCount: 1,
      approvalMethod: "auto",
      generatedAt: new Date().toISOString(),
    };

    return {
      ...currentPlan,
      criticScore: 100,
      criticRisks: ["Critic validation was disabled for this task."],
      metadata,
    };
  }

  for (let iteration = 1; iteration <= maxAttempts; iteration++) {
    logger.info(`Planner-Critic iteration ${iteration}/${maxAttempts}`, {
      provider: agentConfig.provider,
      model: agentConfig.model,
    });

    const phase = iteration === 1 ? "generating" : "refining";
    onProgress?.(
      iteration === 1
        ? `${prefix} Generating initial plan (iteration ${iteration}/${maxAttempts})...`
        : `${prefix} Refining plan based on feedback (iteration ${iteration}/${maxAttempts})...`,
      { iteration, maxIterations: maxAttempts, phase }
    );

    // Create thought callback to stream planning agent's reasoning
    const thoughtCallback: PlanThoughtCallback | undefined = onProgress
      ? (thought: string) => {
          onProgress(`${prefix} ${thought}`, { iteration, maxIterations: maxAttempts, phase });
        }
      : undefined;

    // Generate or refine plan
    llmCalls++;
    currentPlan = await generatePlan(prd, agentConfig, currentPlan, lastCriticResult, thoughtCallback, onStreamProgress);

    logger.info("Plan generated", {
      iteration,
      stepCount: currentPlan.steps.length,
      techStack: currentPlan.techStack.framework,
    });

    onProgress?.(
      `${prefix} Plan generated with ${currentPlan.steps.length} steps. Validating...`,
      { iteration, maxIterations: maxAttempts, stepCount: currentPlan.steps.length, phase: "validating" }
    );

    // Validate with Critic
    llmCalls++;
    lastCriticResult = await validatePlanWithCritic(prd, currentPlan, agentConfig);

    // Check if approved
    if (lastCriticResult.approved || lastCriticResult.score >= AUTO_APPROVAL_THRESHOLD) {
      logger.info("Plan approved by Critic", {
        iteration,
        score: lastCriticResult.score,
        approved: lastCriticResult.approved,
      });

      onProgress?.(
        `${prefix} Plan approved (score: ${lastCriticResult.score}/100) after ${iteration} iteration${iteration > 1 ? "s" : ""}.`,
        { iteration, maxIterations: maxAttempts, score: lastCriticResult.score, stepCount: currentPlan.steps.length, phase: "approved" }
      );

      const planningDurationMs = Date.now() - startTime;
      const metadata: PlanningMetadataV2 = {
        llmCalls,
        planningDurationMs,
        plannerModel: agentConfig.model,
        criticModel: lastCriticResult.model,
        iterationCount: iteration,
        approvalMethod: "auto",
        generatedAt: new Date().toISOString(),
      };

      return {
        ...currentPlan,
        criticScore: lastCriticResult.score,
        criticRisks: lastCriticResult.risks,
        metadata,
      };
    }

    logger.info("Plan rejected by Critic, will refine", {
      iteration,
      score: lastCriticResult.score,
      risks: lastCriticResult.risks.slice(0, 3),
    });

    const topRisks = lastCriticResult.risks.slice(0, 2).join("; ");
    onProgress?.(
      `${prefix} Plan rejected (score: ${lastCriticResult.score}/100). Feedback: ${topRisks || "Needs improvement"}`,
      { iteration, maxIterations: maxAttempts, score: lastCriticResult.score, phase: "rejected" }
    );
  }

  // Max iterations reached without approval — try best-plan fallback before hard-failing.
  // If the last plan scored >= 50, return it with a warning instead of throwing.
  // This matches the remote agent's graceful degradation behavior and avoids
  // tasks getting stuck in pending_plan_approval for "almost good enough" plans.
  const BEST_PLAN_FALLBACK_THRESHOLD = 50;
  const lastScore = lastCriticResult?.score || 0;

  if (currentPlan && lastScore >= BEST_PLAN_FALLBACK_THRESHOLD) {
    logger.warn("Plan below threshold but above fallback minimum — returning with warning", {
      lastScore,
      threshold: AUTO_APPROVAL_THRESHOLD,
      fallbackThreshold: BEST_PLAN_FALLBACK_THRESHOLD,
      iterations: maxAttempts,
    });

    onProgress?.(
      `${prefix} Plan below threshold (${lastScore}/100) but above fallback minimum (${BEST_PLAN_FALLBACK_THRESHOLD}). Proceeding with warnings.`,
      { iteration: maxAttempts, maxIterations: maxAttempts, score: lastScore, phase: "fallback" }
    );

    const planningDurationMs = Date.now() - startTime;
    const metadata: PlanningMetadataV2 = {
      llmCalls,
      planningDurationMs,
      plannerModel: agentConfig.model,
      criticModel: lastCriticResult?.model || agentConfig.model,
      iterationCount: maxAttempts,
      approvalMethod: "fallback",
      generatedAt: new Date().toISOString(),
    };

    return {
      ...currentPlan,
      criticScore: lastScore,
      criticRisks: [
        `Best-plan fallback: critic rejected after ${maxAttempts} iterations (score ${lastScore}, threshold ${AUTO_APPROVAL_THRESHOLD})`,
        ...(lastCriticResult?.risks || []),
      ],
      metadata,
    };
  }

  // Plan scored below fallback threshold or no plan generated — hard fail
  onProgress?.(
    `${prefix} Plan validation failed after ${maxAttempts} iterations. Last score: ${lastScore}/100`,
    { iteration: maxAttempts, maxIterations: maxAttempts, score: lastScore, phase: "rejected" }
  );

  throw new PlanValidationError(
    `Plan validation failed after ${maxAttempts} iterations. Last score: ${lastScore}/100`,
    maxAttempts,
    lastScore,
    lastCriticResult?.risks || [],
    lastCriticResult?.suggestions || []
  );
}
