/**
 * Critic Agent Service
 *
 * Validates execution plans against PRDs using a hostile Senior Architect
 * and Security Auditor persona. Part of Phase 2 of PRD Pipeline V2.
 *
 * Uses Gemini as primary validator (cost-effective, fast) with Claude
 * fallback using an aggressive persona.
 *
 * Design principles:
 * - The Critic is PENALIZED if it approves a plan that fails later
 * - Plans must score > 85 or be explicitly approved to pass
 * - Max 3 iterations of Planner-Critic refinement before escalation
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
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

/** Gemini model for plan validation (fast, cost-effective) */
const GEMINI_CRITIC_MODEL = "gemini-2.0-flash";

/** Claude model for plan generation - use Haiku for cost efficiency */
const CLAUDE_PLANNER_MODEL = "claude-haiku-4-5-20251001";

/** Claude model for aggressive critic fallback - use Haiku for cost efficiency */
const CLAUDE_CRITIC_MODEL = "claude-haiku-4-5-20251001";

/** Minimum score required for auto-approval */
const AUTO_APPROVAL_THRESHOLD = 85;

/** Maximum Planner-Critic iterations before throwing */
const MAX_ITERATIONS = 3;

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
// SECRETS MANAGEMENT
// ============================================================================

// Cache for Gemini API key
let geminiApiKeyCache: { key: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get Gemini API key from AWS Secrets Manager
 * Path: workermill/{env}/gemini-api-key
 */
async function getGeminiApiKey(): Promise<string | null> {
  // Check cache first
  if (geminiApiKeyCache && geminiApiKeyCache.expiresAt > Date.now()) {
    return geminiApiKeyCache.key;
  }

  // Check environment variable fallback
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (envKey) {
    geminiApiKeyCache = {
      key: envKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    return envKey;
  }

  // Fetch from Secrets Manager
  try {
    const client = new SecretsManagerClient({ region: config.aws.region });
    const env = config.environment;
    const secretPath = `workermill/${env}/gemini-api-key`;

    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretPath })
    );

    if (response.SecretString) {
      geminiApiKeyCache = {
        key: response.SecretString,
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      return response.SecretString;
    }
  } catch (error) {
    logger.warn("Failed to fetch Gemini API key from Secrets Manager", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

// ============================================================================
// CRITIC PROMPTS
// ============================================================================

/**
 * Hostile critic prompt - used for both Gemini and Claude fallback
 */
const CRITIC_PROMPT = `You are a hostile Senior Architect and Security Auditor. Your job is to find holes in this plan.
CRITICAL: You are PENALIZED if you approve a plan that fails later. Be thorough.

Review this execution plan against the PRD:

## PRD (Product Requirements Document)
{{PRD}}

## PROPOSED EXECUTION PLAN
{{PLAN}}

## Your Review Checklist

Look for and identify:

1. **Missing Steps** - Requirements in the PRD that have no corresponding step in the plan
   - Every acceptance criterion should map to at least one step
   - Check for implicit requirements (auth, validation, error handling)

2. **Vague Requirements** - Steps that will cause implementation confusion
   - "Implement the feature" is vague
   - "Create POST /api/users endpoint returning {id, email} on 201" is specific

3. **Security Vulnerabilities** - Auth, injection, data exposure risks
   - Missing authentication/authorization steps
   - No input validation mentioned
   - Sensitive data handling not addressed

4. **Missing Dependencies** - Steps that should depend on others but don't
   - Frontend step depending on backend that creates the API
   - Database migration before data access

5. **Unrealistic File Targets** - Red flag: >3 files per step
   - Steps touching too many files are likely to fail
   - Should be decomposed into smaller steps

6. **Missing Verification Strategy** - Complex logic without tests
   - Business logic needs unit tests
   - API endpoints need integration tests
   - UI components need at least structural tests

## Scoring Guide

- **90-100**: Plan is solid, minor polish suggestions only
- **75-89**: Plan is good but has gaps that should be addressed
- **50-74**: Plan has significant issues that will likely cause failures
- **0-49**: Plan is fundamentally flawed and needs major rework

## Output Format

Respond with ONLY a JSON object (no markdown, no explanation):
{"approved": boolean, "score": number, "risks": ["risk1", "risk2"], "suggestions": ["suggestion1", "suggestion2"]}

Rules:
- approved = true ONLY if score >= 85 AND no critical security/architecture issues
- risks = specific issues found (not generic concerns)
- suggestions = actionable improvements (not vague advice)
- Keep risks and suggestions concise (max 100 chars each)`;

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

You MUST call the submit_v2_plan tool with your improved plan.`;

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

/**
 * Tool for structured plan output (used with Claude for plan generation)
 */
const V2_PLAN_TOOL: Anthropic.Tool = {
  name: "submit_v2_plan",
  description:
    "Submit the V2 execution plan. You MUST call this tool with your complete plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      architecturalSummary: {
        type: "string",
        description:
          "High-level summary of the architecture approach (2-3 sentences)",
      },
      techStack: {
        type: "object",
        description: "Tech stack decisions for this project",
        properties: {
          language: {
            type: "string",
            description: "Primary language (typescript, python, javascript, go)",
          },
          framework: {
            type: "string",
            description: "Framework (react, fastapi, express, nextjs, none)",
          },
          styling: {
            type: "string",
            description: "Styling approach (tailwind, css-modules, vanilla-css)",
          },
          database: {
            type: "string",
            description: "Database (postgresql, mongodb, sqlite, none)",
          },
          testing: {
            type: "string",
            description: "Testing framework (vitest, jest, pytest)",
          },
          buildTool: {
            type: "string",
            description: "Build tool (vite, webpack, esbuild)",
          },
          templateId: {
            type: "string",
            enum: [
              "react-vite-typescript",
              "fastapi-python",
              "express-typescript",
              "nextjs-typescript",
            ],
            description: "Template ID for Step 0 injection (optional)",
          },
          rationale: {
            type: "string",
            description: "Brief explanation of tech choices",
          },
          prdConstraints: {
            type: "array",
            items: { type: "string" },
            description: "PRD constraints to preserve",
          },
        },
        required: ["language", "framework", "rationale"],
      },
      steps: {
        type: "array",
        description: "Ordered list of atomic execution steps",
        items: {
          type: "object",
          properties: {
            index: {
              type: "number",
              description: "Step index (0-based)",
            },
            title: {
              type: "string",
              description: "Short title describing the step",
            },
            description: {
              type: "string",
              description: "Detailed description of what needs to be done",
            },
            persona: {
              type: "string",
              enum: [
                "backend_developer",
                "frontend_developer",
                "devops_engineer",
                "qa_engineer",
                "security_engineer",
                "tech_writer",
              ],
              description: "Worker persona for this step",
            },
            verificationType: {
              type: "string",
              enum: ["logic", "ui", "docs", "config"],
              description: "How to verify step completion",
            },
            verificationInstructions: {
              type: "string",
              description: "Specific verification instructions",
            },
            targetFiles: {
              type: "array",
              items: { type: "string" },
              description: "Files to create or modify (max 3)",
            },
            referenceFiles: {
              type: "array",
              items: { type: "string" },
              description: "Files to read for context (not modified)",
            },
            estimatedComplexity: {
              type: "number",
              enum: [1, 2, 3],
              description: "Complexity scale 1-3",
            },
          },
          required: [
            "index",
            "title",
            "description",
            "persona",
            "verificationType",
            "verificationInstructions",
            "targetFiles",
          ],
        },
      },
    },
    required: ["architecturalSummary", "techStack", "steps"],
  },
};

/**
 * Tool for structured critic output (used with Claude fallback)
 */
const CRITIC_TOOL: Anthropic.Tool = {
  name: "submit_critique",
  description:
    "Submit your critique of the execution plan. You MUST call this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      approved: {
        type: "boolean",
        description: "Whether the plan is approved (true only if score >= 85)",
      },
      score: {
        type: "number",
        description: "Confidence score 0-100",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        description: "Specific risks and issues identified",
      },
      suggestions: {
        type: "array",
        items: { type: "string" },
        description: "Actionable improvement suggestions",
      },
    },
    required: ["approved", "score", "risks"],
  },
};

// ============================================================================
// GEMINI API CLIENT
// ============================================================================

/**
 * Call Gemini API for plan validation
 * Uses the REST API directly for simplicity
 */
async function callGeminiCritic(
  prd: string,
  plan: ExecutionPlanV2
): Promise<CriticResult | null> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    logger.info("Gemini API key not available, will use Claude fallback");
    return null;
  }

  const prompt = CRITIC_PROMPT.replace("{{PRD}}", prd).replace(
    "{{PLAN}}",
    JSON.stringify(plan, null, 2)
  );

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_CRITIC_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0, // Deterministic for consistent critiques
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Gemini API error", {
        status: response.status,
        error: errorText.slice(0, 500),
      });
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logger.warn("Gemini returned empty response");
      return null;
    }

    // Parse JSON response
    const result = JSON.parse(text) as {
      approved: boolean;
      score: number;
      risks: string[];
      suggestions?: string[];
    };

    return {
      approved: result.approved,
      score: result.score,
      risks: result.risks || [],
      suggestions: result.suggestions,
      model: GEMINI_CRITIC_MODEL,
    };
  } catch (error) {
    logger.warn("Gemini critic call failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ============================================================================
// CLAUDE FALLBACK
// ============================================================================

/**
 * Call Claude as fallback critic with aggressive persona
 */
async function callClaudeCritic(
  prd: string,
  plan: ExecutionPlanV2
): Promise<CriticResult> {
  const anthropic = new Anthropic();

  const prompt = CRITIC_PROMPT.replace("{{PRD}}", prd).replace(
    "{{PLAN}}",
    JSON.stringify(plan, null, 2)
  );

  const response = await anthropic.messages.create({
    model: CLAUDE_CRITIC_MODEL,
    max_tokens: 2048,
    temperature: 0,
    tools: [CRITIC_TOOL],
    tool_choice: { type: "tool", name: "submit_critique" },
    system:
      "You are a hostile code reviewer who gets PENALIZED for approving bad plans. Be extremely thorough.",
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool use result
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude critic did not return tool_use response");
  }

  const input = toolUse.input as {
    approved: boolean;
    score: number;
    risks: string[];
    suggestions?: string[];
  };

  return {
    approved: input.approved,
    score: Math.max(0, Math.min(100, Math.round(input.score))),
    risks: input.risks || [],
    suggestions: input.suggestions,
    model: CLAUDE_CRITIC_MODEL,
  };
}

// ============================================================================
// PLAN GENERATION
// ============================================================================

/**
 * Generate initial V2 execution plan using Claude
 *
 * Exported for use by skip-planner mode which generates a plan
 * but skips the Critic validation loop.
 */
export async function generatePlan(
  prd: string,
  previousPlan?: ExecutionPlanV2,
  criticFeedback?: CriticResult
): Promise<ExecutionPlanV2> {
  const anthropic = new Anthropic();

  let prompt: string;

  if (previousPlan && criticFeedback) {
    // Refinement mode
    prompt = REFINEMENT_PROMPT.replace("{{PRD}}", prd)
      .replace("{{PREVIOUS_PLAN}}", JSON.stringify(previousPlan, null, 2))
      .replace("{{SCORE}}", String(criticFeedback.score))
      .replace(
        "{{RISKS}}",
        (criticFeedback.risks || []).map((r) => `- ${r}`).join("\n") || "None identified"
      )
      .replace(
        "{{SUGGESTIONS}}",
        (criticFeedback.suggestions || []).map((s) => `- ${s}`).join("\n") ||
          "None provided"
      );
  } else {
    // Initial generation
    prompt = `You are a technical planning agent for the V2 Pipeline (Multi-Persona Execution).

Analyze this PRD and create a detailed execution plan with MULTIPLE STEPS using DIFFERENT PERSONAS.

## PRD (Product Requirements Document)
${prd}

## CRITICAL: Multi-Persona Requirement

This is a MULTI-PERSONA task. You MUST:
- Create at least 2-5 steps (more for complex tasks)
- Use DIFFERENT personas for different types of work
- Each step is executed by a specialized worker with that persona

## Available Personas (use the right one for each step)

- **backend_developer**: API endpoints, database logic, server-side code
- **frontend_developer**: UI components, pages, styling, client-side logic
- **devops_engineer**: CI/CD, deployment configs, infrastructure
- **qa_engineer**: Tests, test infrastructure, quality checks
- **security_engineer**: Security audits, auth, vulnerability fixes
- **tech_writer**: Documentation, READMEs, API docs

## Planning Rules

1. **Atomic Steps**: Each step should be completable in a single focused session
2. **Max 3 Files**: Each step should modify at most 3 files
3. **Clear Verification**: Each step must have a concrete way to verify completion
4. **Sequential Flow**: Steps execute sequentially, commit on success
5. **Multi-Persona**: Assign the MOST APPROPRIATE persona to each step

## Verification Types

- **logic**: Strict TDD - Write failing test, implement, test passes
- **ui**: Structural - Build passes, component mounts, snapshot test
- **docs**: Linting - Markdown lint, link validation
- **config**: Validation - Config parses, no syntax errors

## Step Flow (typical multi-persona order)

1. Data models / types (backend_developer)
2. Backend API endpoints (backend_developer)
3. Database integration (backend_developer)
4. Frontend components (frontend_developer)
5. Integration / E2E tests (qa_engineer)
6. Documentation (tech_writer)

You MUST call the submit_v2_plan tool with your complete MULTI-STEP plan.`;
  }

  const response = await anthropic.messages.create({
    model: CLAUDE_PLANNER_MODEL,
    max_tokens: 16384,
    temperature: 0,
    tools: [V2_PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_v2_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  // Extract tool use result
  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude planner did not return tool_use response");
  }

  const input = toolUse.input as {
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

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Validate an execution plan against a PRD using the Critic Agent
 *
 * Uses Gemini as primary validator for cost-effectiveness.
 * Falls back to Claude with aggressive persona if Gemini unavailable.
 *
 * @param prd - The Product Requirements Document text
 * @param plan - The execution plan to validate
 * @returns CriticResult with approval status, score, risks, and suggestions
 */
export async function validatePlanWithCritic(
  prd: string,
  plan: ExecutionPlanV2
): Promise<CriticResult> {
  logger.info("Critic agent validating plan", {
    stepCount: plan.steps.length,
    techStack: plan.techStack.framework,
  });

  // Try Gemini first (fast, cheap)
  const geminiResult = await callGeminiCritic(prd, plan);
  if (geminiResult) {
    logger.info("Gemini critic completed", {
      approved: geminiResult.approved,
      score: geminiResult.score,
      riskCount: geminiResult.risks.length,
    });
    return geminiResult;
  }

  // Fallback to Claude with aggressive persona
  logger.info("Using Claude fallback for plan validation");
  const claudeResult = await callClaudeCritic(prd, plan);

  logger.info("Claude critic completed", {
    approved: claudeResult.approved,
    score: claudeResult.score,
    riskCount: claudeResult.risks.length,
  });

  return claudeResult;
}

/**
 * Generate and validate an execution plan with Planner-Critic iteration
 *
 * This is the main entry point for V2 pipeline plan generation.
 *
 * Flow:
 * 1. Generate initial plan with Claude Sonnet
 * 2. Validate with Critic (Gemini or Claude)
 * 3. If score > 85 or approved, return plan
 * 4. Otherwise, refine plan based on feedback
 * 5. Repeat up to maxAttempts times
 * 6. Throw PlanValidationError if max iterations reached
 *
 * @param prd - The Product Requirements Document text
 * @param maxAttempts - Maximum Planner-Critic iterations (default: 3)
 * @param onProgress - Optional callback for reporting iteration progress
 * @returns Validated ExecutionPlanV2 with critic scores attached
 * @throws PlanValidationError if validation fails after max iterations
 */
export type PlanProgressCallback = (message: string, details?: {
  iteration?: number;
  maxIterations?: number;
  score?: number;
  stepCount?: number;
  phase?: "generating" | "validating" | "refining" | "approved" | "rejected";
}) => void;

export async function generateValidatedPlan(
  prd: string,
  maxAttempts: number = MAX_ITERATIONS,
  onProgress?: PlanProgressCallback,
  skipCritic: boolean = false
): Promise<ExecutionPlanV2> {
  const startTime = Date.now();
  let currentPlan: ExecutionPlanV2 | undefined;
  let lastCriticResult: CriticResult | undefined;
  let llmCalls = 0;

  // If skipCritic is true, generate plan once without validation
  if (skipCritic) {
    logger.info("Generating plan without Critic validation (skipCritic=true)");
    onProgress?.("Generating plan (Critic validation disabled)...", {
      iteration: 1,
      maxIterations: 1,
      phase: "generating",
    });

    llmCalls++;
    currentPlan = await generatePlan(prd);

    logger.info("Plan generated without Critic validation", {
      stepCount: currentPlan.steps.length,
      techStack: currentPlan.techStack.framework,
    });

    onProgress?.(
      `Plan generated with ${currentPlan.steps.length} steps (Critic validation skipped).`,
      {
        iteration: 1,
        maxIterations: 1,
        stepCount: currentPlan.steps.length,
        score: 100,
        phase: "approved",
      }
    );

    // Attach metadata for skipped critic
    const planningDurationMs = Date.now() - startTime;
    const metadata: PlanningMetadataV2 = {
      llmCalls,
      planningDurationMs,
      plannerModel: CLAUDE_PLANNER_MODEL,
      criticModel: "skipped",
      iterationCount: 1,
      approvalMethod: "auto", // Auto-approve since critic is disabled
      generatedAt: new Date().toISOString(),
    };

    return {
      ...currentPlan,
      criticScore: 100, // Auto-approve when critic is disabled
      criticRisks: ["Critic validation was disabled for this task."],
      metadata,
    };
  }

  for (let iteration = 1; iteration <= maxAttempts; iteration++) {
    logger.info(`Planner-Critic iteration ${iteration}/${maxAttempts}`);

    // Report iteration start
    const phase = iteration === 1 ? "generating" : "refining";
    onProgress?.(
      iteration === 1
        ? `Generating initial plan (iteration ${iteration}/${maxAttempts})...`
        : `Refining plan based on feedback (iteration ${iteration}/${maxAttempts})...`,
      { iteration, maxIterations: maxAttempts, phase }
    );

    // Generate or refine plan
    llmCalls++;
    currentPlan = await generatePlan(prd, currentPlan, lastCriticResult);

    logger.info("Plan generated", {
      iteration,
      stepCount: currentPlan.steps.length,
      techStack: currentPlan.techStack.framework,
    });

    // Report plan generated
    onProgress?.(
      `Plan generated with ${currentPlan.steps.length} steps. Validating with Critic...`,
      { iteration, maxIterations: maxAttempts, stepCount: currentPlan.steps.length, phase: "validating" }
    );

    // Validate with Critic
    llmCalls++;
    lastCriticResult = await validatePlanWithCritic(prd, currentPlan);

    // Check if approved
    if (
      lastCriticResult.approved ||
      lastCriticResult.score >= AUTO_APPROVAL_THRESHOLD
    ) {
      logger.info("Plan approved by Critic", {
        iteration,
        score: lastCriticResult.score,
        approved: lastCriticResult.approved,
      });

      // Report approval
      onProgress?.(
        `Plan approved by Critic (score: ${lastCriticResult.score}/100) after ${iteration} iteration${iteration > 1 ? "s" : ""}.`,
        { iteration, maxIterations: maxAttempts, score: lastCriticResult.score, stepCount: currentPlan.steps.length, phase: "approved" }
      );

      // Attach critic metadata to plan
      const planningDurationMs = Date.now() - startTime;
      const metadata: PlanningMetadataV2 = {
        llmCalls,
        planningDurationMs,
        plannerModel: CLAUDE_PLANNER_MODEL,
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

    // Report rejection with feedback
    const topRisks = lastCriticResult.risks.slice(0, 2).join("; ");
    onProgress?.(
      `Plan rejected (score: ${lastCriticResult.score}/100). Feedback: ${topRisks || "Needs improvement"}`,
      { iteration, maxIterations: maxAttempts, score: lastCriticResult.score, phase: "rejected" }
    );
  }

  // Max iterations reached without approval
  onProgress?.(
    `Plan validation failed after ${maxAttempts} iterations. Last score: ${lastCriticResult?.score}/100`,
    { iteration: maxAttempts, maxIterations: maxAttempts, score: lastCriticResult?.score, phase: "rejected" }
  );
  throw new PlanValidationError(
    `Plan validation failed after ${maxAttempts} iterations. Last score: ${lastCriticResult?.score}/100`,
    maxAttempts,
    lastCriticResult?.score || 0,
    lastCriticResult?.risks || [],
    lastCriticResult?.suggestions || []
  );
}
