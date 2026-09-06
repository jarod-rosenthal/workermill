import { streamText, generateObject, generateText, stepCountIs, type ToolSet } from "ai";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { createModel, buildOllamaOptions } from "../engine/model-factory.js";
import { createToolDefinitions } from "../engine/tools/index.js";
import { createPathScope } from "../engine/path-policy.js";
import { executeToolCall, type ToolExecutionContext } from "../engine/tool-executor.js";
import type { AIProvider } from "../engine/types.js";
import { loadPersona } from "../personas.js";
import { formatProjectInstructions } from "../instructions.js";
import { formatPromptProjectContext } from "../project-context.js";
import { getProviderForPersona } from "../config.js";
import type { CliConfig } from "../config.js";
import { getApiKeyEnvVar } from "../provider-capabilities.js";
import * as logger from "../logger.js";
import { getPrdDecompositionPhaseLabel } from "../prd-decomposition-phases.js";
import { resolveSandboxMode } from "../sandbox-mode.js";

import type { Story, OrchestrationOutput } from "./types.js";
import {
  truncateForPrompt,
  formatContext,
  getModelContext,
  isBalanceOrQuotaError,
  isRateLimitError,
  rateLimitSleep,
  resolveTaskInput,
} from "./utils.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = any;

/* -------------------------------------------------------------------------- */
/*  runSpecCheck                                                              */
/* -------------------------------------------------------------------------- */

export async function runSpecCheck(
  config: CliConfig,
  userTask: string,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(config);

  if (apiKey) {
    const envVar = getApiKeyEnvVar(provider);
    if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
  }

  const model = createModel(provider as AIProvider, modelName, host, contextLength, apiKey);

  let gaps: Array<{ question: string; suggestion: string }> = [];

  try {
    output.status(getPrdDecompositionPhaseLabel("validating_spec"));
    const result = await generateObject({
      model,
      abortSignal,
      schema: z.object({
        gaps: z.array(z.object({
          question: z.string().describe("The specific question to ask the user"),
          suggestion: z.string().describe("The most reasonable default answer"),
        })).max(3),
      }),
      prompt: `You are reviewing a coding task spec before it goes to an AI planning agent. Identify CRITICAL ambiguities — things where the expert will have to guess, and guessing wrong means a revision cycle.

Task spec:
${userTask}

Flag ONLY gaps that are:
- High severity: the wrong assumption causes real rework
- Observable: the gap affects the output the user will see or test
- Not obvious: a reasonable developer could go either way

Do NOT flag:
- Implementation details (framework choice, naming, code style)
- Things any reasonable developer would handle correctly (error handling, logging)
- Minor preferences that don't affect acceptance criteria

Return up to 3 gaps, or an empty array if the spec is clear enough. When in doubt, return fewer gaps — interrupting the user for minor gaps wastes more time than proceeding.`,
    });
    gaps = result.object.gaps;
    output.statusDone();
  } catch {
    output.statusDone();
    return userTask; // spec check failure is non-fatal
  }

  if (gaps.length === 0) return userTask;

  // Prompt for each gap — use askText if available, otherwise apply suggestions silently
  const clarifications: string[] = [];
  for (const gap of gaps) {
    if (abortSignal?.aborted) break;
    if (output.askText) {
      const answer = await output.askText(gap.question, gap.suggestion);
      clarifications.push(`${gap.question} → ${answer}`);
    } else {
      // Unattended: log what we assumed and proceed
      output.coordinatorLog(`Spec gap (using suggestion): ${gap.question} → ${gap.suggestion}`);
      clarifications.push(`${gap.question} → ${gap.suggestion}`);
    }
  }

  if (clarifications.length === 0) return userTask;
  return `${userTask}\n\n## Spec Clarifications\n${clarifications.map(c => `- ${c}`).join("\n")}`;
}

/* -------------------------------------------------------------------------- */
/*  runPlanCritic                                                             */
/* -------------------------------------------------------------------------- */

/** Default plan score required for the critic to approve. */
export const DEFAULT_CRITIC_THRESHOLD = 8;

/** Maximum critic → refine cycles before the critic gives up and reports its verdict. */
export const MAX_CRITIC_ITERATIONS = 3;

export interface PlanCritique {
  score: number;
  summary: string;
  issues: Array<{ dimension: string; problem: string; fix: string }>;
}

export interface PlanCriticResult {
  /** The plan to execute — refined if the critic improved it, original otherwise. */
  stories: Story[];
  /** Whether the final plan met the threshold. */
  approved: boolean;
  /** Score of the final plan. */
  score: number;
  /** Critique of the final plan — issues left unresolved when `approved` is false. */
  critique: PlanCritique | null;
  /** How many scoring rounds ran. */
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  /** Cancellation is terminal; callers must not treat the retained plan as approved. */
  cancelled?: boolean;
}

/** Render a plan as compact JSON for the critic to read. */
function formatPlanForCritic(stories: Story[]): string {
  return JSON.stringify(
    stories.map((s) => ({
      id: s.id,
      title: s.title,
      persona: s.persona,
      description: s.description,
      dependsOn: s.dependsOn,
      targetFiles: s.targetFiles,
      referenceFiles: s.referenceFiles,
      primaryPattern: s.primaryPattern,
      integrationPoints: s.integrationPoints,
      assumptions: s.assumptions,
      nonGoals: s.nonGoals,
      validationSignal: s.validationSignal,
      requiredFiles: s.requiredFiles,
      requiredTests: s.requiredTests,
      requiredCommands: s.requiredCommands,
      implementationNotes: s.implementationNotes,
    })),
    null,
    2,
  );
}

/**
 * Score a plan before execution and refine it until it passes.
 *
 * Runs after the planner and before workers start. The critic scores the plan
 * 1-10 across five dimensions; a score below the threshold sends the plan back
 * for a refinement pass, up to MAX_CRITIC_ITERATIONS rounds.
 *
 * Non-fatal by design: any model or parse failure returns the original plan
 * unchanged rather than blocking the build.
 */
export async function runPlanCritic(
  config: CliConfig,
  userTask: string,
  stories: Story[],
  workingDir: string,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<PlanCriticResult> {
  const threshold = config.review?.criticThreshold ?? DEFAULT_CRITIC_THRESHOLD;

  const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(config, "critic");
  if (apiKey) {
    const envVar = getApiKeyEnvVar(provider);
    if (envVar && !process.env[envVar]) {
      const key = apiKey.startsWith("{env:") ? process.env[apiKey.slice(5, -1)] : apiKey;
      if (key) process.env[envVar] = key;
    }
  }
  const base: Omit<PlanCriticResult, "stories" | "approved" | "score" | "critique" | "iterations"> = {
    inputTokens: 0,
    outputTokens: 0,
    provider,
    model: modelName,
  };

  const cancelled = (iterations: number): PlanCriticResult => ({
    ...base,
    stories,
    approved: false,
    score: 0,
    critique: null,
    iterations,
    cancelled: true,
  });

  // Avoid starting a model call when the orchestration was already cancelled.
  if (abortSignal?.aborted) return cancelled(0);

  const model = createModel(provider as AIProvider, modelName, host, contextLength, apiKey);

  const projectInstructions = formatProjectInstructions(workingDir);
  const taskForPrompt = truncateForPrompt(userTask, 8_000, "task spec");

  output.log("critic", `Scoring the plan with \x1b[36m${provider}/${modelName}\x1b[0m (threshold ${threshold}/10)`);

  let currentStories = stories;
  let lastCritique: PlanCritique | null = null;
  let lastScore = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let iteration = 1; iteration <= MAX_CRITIC_ITERATIONS; iteration++) {
    if (abortSignal?.aborted) return cancelled(iteration - 1);

    // ── Score the current plan ──
    let critique: PlanCritique;
    try {
      output.status(getPrdDecompositionPhaseLabel("scoring_plan"));
      const scored = await generateObject({
        model,
        abortSignal,
        schema: z.object({
          score: z.number().min(1).max(10).describe("Overall plan quality, 1-10"),
          summary: z.string().describe("One sentence on the plan's biggest weakness, or its strength if it passes"),
          issues: z.array(z.object({
            dimension: z.enum(["completeness", "feasibility", "dependencies", "scope", "risk"]),
            problem: z.string().describe("What is concretely wrong or missing"),
            fix: z.string().describe("The specific change that would resolve it"),
          })).max(6),
        }),
        prompt: `You are reviewing an implementation plan before it goes to AI worker agents. The workers execute these stories sequentially with no further human input, so a flaw in the plan becomes wasted work.
${projectInstructions}
## Original task
${taskForPrompt}

## Proposed plan
\`\`\`json
${truncateForPrompt(formatPlanForCritic(currentStories), 24_000, "plan")}
\`\`\`

Score the plan 1-10 across these five dimensions:

- **completeness** — does executing every story actually satisfy the task? Are there deliverables the task requires that no story produces?
- **feasibility** — can a worker execute each story from its description alone? Are the named files, patterns, and integration points concrete?
- **dependencies** — is the ordering correct? Does a story depend on something a later story creates? Are \`dependsOn\` links accurate?
- **scope** — is any story too large to complete in one pass, or so trivial it should be merged? Is there work here the task never asked for?
- **risk** — are the risky parts identified? Do the \`requiredTests\`/\`requiredCommands\` actually prove the story landed?

Scoring guide: 9-10 a worker could execute this as-is. 7-8 minor gaps that a competent worker would fill in. 4-6 real gaps that will cause rework. 1-3 the plan does not address the task.

Report only issues that would change what a worker builds. Do NOT report style preferences, wording, or story naming. If the plan is sound, return an empty issues array and a score of 9 or 10.`,
      });
      critique = scored.object;
      inputTokens += scored.usage?.inputTokens || 0;
      outputTokens += scored.usage?.outputTokens || 0;
      output.statusDone();
    } catch (err) {
      if (abortSignal?.aborted) return cancelled(iteration - 1);
      // Critic failure is non-fatal — proceed with the plan we have.
      output.statusDone();
      logger.error("Plan critic scoring failed", { error: err instanceof Error ? err.message : String(err) });
      output.log("critic", "Could not score the plan — continuing with the planner's version.");
      return {
        ...base,
        stories: currentStories,
        approved: true,
        score: lastScore,
        critique: lastCritique,
        iterations: iteration - 1,
        inputTokens,
        outputTokens,
      };
    }

    lastCritique = critique;
    lastScore = critique.score;

    if (critique.score >= threshold) {
      output.log("critic", `Plan approved — ${critique.score}/10. ${critique.summary}`);
      return {
        ...base,
        stories: currentStories,
        approved: true,
        score: critique.score,
        critique,
        iterations: iteration,
        inputTokens,
        outputTokens,
      };
    }

    output.log("critic", `Plan scored ${critique.score}/10 (needs ${threshold}) — ${critique.summary}`);
    for (const issue of critique.issues) {
      output.log("critic", `  [${issue.dimension}] ${issue.problem}`);
    }

    if (iteration === MAX_CRITIC_ITERATIONS) break;

    // ── Refine the plan against the critique ──
    output.log("critic", `Refining the plan (round ${iteration} of ${MAX_CRITIC_ITERATIONS - 1})...`);
    try {
      output.status(getPrdDecompositionPhaseLabel("refining_plan"));
      const refined = await generateText({
        model,
        abortSignal,
        prompt: `Revise this implementation plan to resolve the reviewer's issues. Keep everything the reviewer did not object to — this is a targeted revision, not a rewrite.
${projectInstructions}
## Original task
${taskForPrompt}

## Current plan
\`\`\`json
${truncateForPrompt(formatPlanForCritic(currentStories), 24_000, "plan")}
\`\`\`

## Issues to resolve
${critique.issues.map((iss, n) => `${n + 1}. [${iss.dimension}] ${iss.problem}\n   Suggested fix: ${iss.fix}`).join("\n")}

Return the complete revised plan as a single JSON code block in exactly this shape — every story, not just the changed ones:

\`\`\`json
{ "stories": [{ "id": "kebab-id", "title": "Brief title", "persona": "persona_name", "description": "Scope and what to do", "dependsOn": ["other-story-id"], "targetFiles": ["path/to/file"], "referenceFiles": ["path/to/pattern"], "primaryPattern": "path/to/pattern", "integrationPoints": ["exact seam"], "nonGoals": ["scope boundary"], "validationSignal": "observable proof of correctness", "requiredFiles": ["path/to/file"], "requiredTests": ["src/__tests__/feature.test.ts"], "requiredCommands": ["npm run typecheck"], "implementationNotes": "Specific patterns, files, integration points" }] }
\`\`\`

Available personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead.
Output ONLY the JSON block, no other text.`,
        maxOutputTokens: 8192,
        ...buildOllamaOptions(provider as AIProvider, contextLength),
      });
      inputTokens += refined.usage?.inputTokens || 0;
      outputTokens += refined.usage?.outputTokens || 0;
      output.statusDone();

      const revised = parseStoriesFromText(refined.text, output);
      if (revised.length === 0) {
        logger.error("Plan critic refinement produced no parseable stories");
        output.log("critic", "Refinement produced no usable plan — keeping the previous version.");
        break;
      }
      currentStories = normalizeStoryDependencies(revised);
    } catch (err) {
      if (abortSignal?.aborted) return cancelled(iteration);
      output.statusDone();
      logger.error("Plan critic refinement failed", { error: err instanceof Error ? err.message : String(err) });
      output.log("critic", "Could not refine the plan — keeping the previous version.");
      break;
    }
  }

  return {
    ...base,
    stories: currentStories,
    approved: false,
    score: lastScore,
    critique: lastCritique,
    iterations: MAX_CRITIC_ITERATIONS,
    inputTokens,
    outputTokens,
  };
}

/* -------------------------------------------------------------------------- */
/*  classifyComplexity                                                        */
/* -------------------------------------------------------------------------- */

export async function classifyComplexity(
  config: CliConfig,
  userInput: string,
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
): Promise<{ isMulti: boolean; reason: string }> {
  logger.info("Classifying complexity", { input: userInput.slice(0, 200) });
  // Resolve file references before classification so "spec.md" becomes the full spec content
  const resolvedInput = resolveTaskInput(userInput, process.cwd());
  const { provider, model: modelName, apiKey, host, contextLength } = getProviderForPersona(config);

  if (apiKey) {
    const envVar = getApiKeyEnvVar(provider);
    if (envVar && !process.env[envVar]) process.env[envVar] = apiKey;
  }

  const model = createModel(provider as AIProvider, modelName, host, contextLength, apiKey);

  try {
    const result = await generateObject({
      model,
      abortSignal,
      schema: z.object({
        complexity: z.enum(["single", "multi"]),
        reason: z.string(),
      }),
      prompt: `Analyze this coding task. If it involves multiple distinct concerns that would benefit from different specialist personas (e.g., database + backend + frontend + devops), classify as "multi". If it's a focused task that one developer could handle, classify as "single". Just classify — do not break down into stories.

Task:
${resolvedInput}`,
    });

    return {
      isMulti: result.object.complexity === "multi",
      reason: result.object.reason,
    };
  } catch (err) {
    // Fallback to text-based classification
    try {
      const textResult = await generateText({
        model,
        abortSignal,
        prompt: `Is this task "single" (one developer) or "multi" (needs multiple specialists)? Respond with just "single" or "multi" and a brief reason.

Task: ${resolvedInput}`,
      });

      const isMulti = /\bmulti\b/i.test(textResult.text);
      return { isMulti, reason: textResult.text.slice(0, 200) };
    } catch (err2) {
      logger.debug("Classification double fallback failed", { error: err2 instanceof Error ? err2.message : String(err2) });
    }

    return { isMulti: false, reason: `Classification failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/* -------------------------------------------------------------------------- */
/*  topologicalSort                                                           */
/* -------------------------------------------------------------------------- */

export function topologicalSort(stories: Story[]): Story[] {
  const idMap = new Map(stories.map(s => [s.id, s]));
  const visited = new Set<string>();
  const result: Story[] = [];
  const visiting = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const cycleStory = idMap.get(id);
      logger.warn("Circular story dependency detected — breaking cycle", { storyId: id, storyTitle: cycleStory?.title || "unknown" });
      return;
    }
    visiting.add(id);
    const story = idMap.get(id);
    if (story?.dependsOn) {
      for (const dep of story.dependsOn) {
        if (idMap.has(dep)) visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    if (story) result.push(story);
  }

  for (const story of stories) {
    visit(story.id);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*  planStories                                                               */
/* -------------------------------------------------------------------------- */

export async function planStories(
  config: CliConfig,
  userTask: string,
  workingDir: string,
  sandboxed: boolean | "os",
  output: OrchestrationOutput,
  abortSignal?: AbortSignal,
  _rateLimitRetries = 0,
): Promise<{ stories: Story[]; provider: string; model: string; inputTokens: number; outputTokens: number; rejected?: boolean; rejectionReason?: string }> {
  const { provider: pProvider, model: pModel, apiKey: pApiKey, host: pHost, contextLength: pCtx } = getProviderForPersona(config, "planner");
  const cancelled = () => ({
    stories: [],
    provider: pProvider,
    model: pModel,
    inputTokens: 0,
    outputTokens: 0,
    rejected: true,
    rejectionReason: "Cancelled",
  });

  // Cancellation and an explicitly unavailable OS sandbox are terminal before
  // either the model or tool factory gets a chance to start work.
  if (abortSignal?.aborted) return cancelled();
  if (sandboxed === "os") resolveSandboxMode("os");

  const planner = loadPersona("planner");
  if (pProvider && pApiKey) {
      const envVar = getApiKeyEnvVar(pProvider);
      if (envVar && !process.env[envVar]) {
        const key = pApiKey.startsWith("{env:") ? process.env[pApiKey.slice(5, -1)] : pApiKey;
        if (key) process.env[envVar] = key;
      }
  }

  const signal = abortSignal ?? new AbortController().signal;
  const scope = createPathScope(workingDir, config.sandboxCapabilities?.extraPathGrants ?? []);
  const executionContext: ToolExecutionContext = {
    runId: randomUUID(),
    workspace: scope.workspace,
    scope,
    effectiveSandbox: sandboxed === "os" ? "os" : sandboxed ? "path" : "none",
    signal,
    allowedNetworkDomains: config.sandboxCapabilities?.allowedNetworkDomains,
    allowLocalBinding: config.sandboxCapabilities?.allowLocalBinding,
    allowDockerSocket: config.sandboxCapabilities?.allowDockerSocket,
    getPermissionState: () => ({
      mode: "default",
      trustAll: false,
      sessionAllow: new Set<string>(),
      rules: config.permissions ?? {},
      // Planner personas are read-only regardless of their on-disk tool list.
      readOnlyRole: true,
      workspace: scope.workspace,
    }),
  };
  const plannerModel = createModel(pProvider as AIProvider, pModel, pHost, pCtx, pApiKey);
  const plannerTools = createToolDefinitions(workingDir, plannerModel, sandboxed, {
    runId: executionContext.runId,
    signal,
    scope,
    sandboxCapabilities: config.sandboxCapabilities,
    executionContext,
  });

  const readOnlyTools: Record<string, AnyToolDef> = {};
  if (planner) {
    for (const toolName of planner.tools) {
      const toolDef = plannerTools[toolName as keyof typeof plannerTools] as AnyToolDef;
      if (toolDef) {
        readOnlyTools[toolName] = {
          ...toolDef,
          execute: async (input: Record<string, unknown>) => {
            return executeToolCall(toolName, input, async () => {
              output.toolCall("planner", toolName, input);
              return toolDef.execute(input);
            }, executionContext);
          },
        };
      }
    }
  }

  // MCP tools are intentionally excluded from the planner — the planner
  // only needs read-only codebase tools to understand the project.
  // MCP schemas from external servers (e.g. Docker Desktop) can have
  // malformed input_schema that Anthropic's API rejects.

  // Detect file references in the task and read them upfront so the planner has full context
  const fileRefPattern = /(?:^|\s)([\w./-]+\.(?:md|txt|yaml|yml|json|toml|ts|js|py|go|rs|spec|requirements|prd|plan))\b/gi;
  const referencedFiles = [...new Set([...userTask.matchAll(fileRefPattern)].map(m => m[1]))];
  let inlinedFileContext = "";
  output.status(getPrdDecompositionPhaseLabel("resolving_content"));
  if (referencedFiles.length > 0) {
    for (const ref of referencedFiles) {
      const fullPath = path.resolve(workingDir, ref);
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        inlinedFileContext += `\n### File: ${ref}\n\`\`\`\n${content}\n\`\`\`\n`;
        output.log("planner", `Read referenced file: ${ref}`);
      } catch {
        // File doesn't exist or unreadable — planner can still try to read it via tools
      }
    }
  }

  const plannerProjectInstructions = formatProjectInstructions(workingDir);
  const plannerProjectContext = formatPromptProjectContext(workingDir);
  const plannerPrompt = `You are a senior architect planning an implementation. Your job is to analyze the codebase and produce a plan that sets each worker up for success.
${plannerProjectInstructions}
${plannerProjectContext}
## Task
${userTask}
${inlinedFileContext ? `\n## Referenced Files\n${inlinedFileContext}` : ""}
## Working directory
${workingDir}

## Phase 0: Assess the Spec Before Reading Anything

Read the task above carefully BEFORE using any tools. Assess how much codebase exploration you actually need:

**If the task already specifies:**
- Target files to create or modify
- Exact function signatures, import paths, or code patterns
- Implementation constraints and gotchas
- Reference files to follow

→ **Targeted mode:** Read only the specific files named in the task to verify they exist and match expectations. Do NOT do a broad exploration. A well-specified task needs confirmation, not discovery. 3–5 file reads maximum.

**If the task is vague, missing file paths, or requires understanding unfamiliar patterns:**

→ **Full analysis mode:** Proceed with the deep codebase analysis below.

## Phase 1: Codebase Analysis (full mode only)

Use your tools to understand the existing codebase:
${referencedFiles.length > 0 ? "The referenced files above have been inlined for you. Read any additional files you need." : ""}

1. **Read the project structure** — ls, glob to understand the layout
2. **Read key files** — package.json/pyproject.toml/go.mod for dependencies and scripts. Config files for conventions.
3. **Read existing implementations** — Find 2-3 files that are most similar to what needs to be built. Read them fully. These become reference patterns.
4. **Identify conventions** — How are models defined? How are routes structured? What's the naming convention? What ORM/framework patterns are used? What test framework?
5. **Identify risks** — Are there transactions that webhook/event dispatch must respect? Are there shared types that need updating? Are there existing tests that will break?

## Phase 2: Evaluate Feasibility

Before producing a plan, evaluate whether this task should proceed:

- **Is the spec clear enough?** If the task is too vague to produce specific file-level guidance, REJECT with a reason explaining what's missing.
- **Does it conflict with the existing codebase?** If the task asks to build something that already exists, or contradicts the project's architecture, REJECT and explain why.
- **Is the reported gap already fixed?** If the task comes from a ticket/issue, verify whether the behavior already exists in current code before planning changes. If already fixed, explicitly call that out and prefer validation-focused follow-up (tests/docs) over duplicate code changes.
- **Is it achievable?** If the task requires external services/credentials that aren't configured, or depends on things outside the repo, note these as blockers.

To REJECT a task, return:
\`\`\`json
{ "rejected": true, "reason": "The spec doesn't specify which database to use and the project has no existing database setup. Please clarify: PostgreSQL, MySQL, or SQLite?" }
\`\`\`

Only reject when proceeding would waste time. If the task is clear enough to produce specific implementation guidance, proceed.

## Phase 3: Produce the Plan

Design a plan with the MINIMUM number of stories:
- ONE persona = ONE story (only split if there's a genuine dependency gate)
- Aim for 5 stories or fewer — combine same-persona work
- Stories run SEQUENTIALLY in the same directory — later stories see earlier output
- Overlapping files between stories are fine

## Output Format

Return a JSON code block. The \`implementationNotes\` field is THE KEY VALUE YOU ADD — it carries your architectural analysis directly to the worker so they don't have to rediscover what you already learned.

\`\`\`json
{
  "stories": [
    {
      "id": "short-kebab-case-id",
      "title": "Brief title",
      "persona": "persona_name",
      "description": "Create the webhook model and API endpoints. Add a Webhook SQLAlchemy model (UUID PK, org_id FK, url, secret, event_types JSONB, active boolean, created_at). Add CRUD endpoints in a new webhooks router: POST /webhooks (create), GET /webhooks (list by org), DELETE /webhooks/:id. Wire async delivery via FastAPI BackgroundTasks on relevant events. Include DB migration for the new table.",
      "targetFiles": ["src/models/webhook.py", "src/routers/webhooks.py"],
      "referenceFiles": ["src/models/product.py", "src/routers/products.py"],
      "primaryPattern": "src/models/product.py",
      "integrationPoints": ["router: src/routers/webhooks.py", "dependency: get_current_admin", "background task dispatch hook"],
      "assumptions": ["Webhook delivery state is not already persisted elsewhere."],
      "nonGoals": ["Do not redesign the existing audit logging model.", "Do not add new auth flows."],
      "implementationNotes": "Follow the pattern in product.py for the model — use SQLAlchemy declarative with UUID primary key, org_id foreign key, and created_at timestamp. The router should mirror products.py structure: admin-only endpoints using get_current_admin dependency. Use FastAPI BackgroundTasks for async webhook delivery — do NOT dispatch inside the database transaction. The existing audit logger in middleware.py can be extended for delivery tracking.",
      "validationSignal": "A webhook can be created through the existing admin route pattern and delivery is dispatched asynchronously without breaking the surrounding transaction flow.",
      "requiredFiles": ["src/models/webhook.py", "src/routers/webhooks.py"],
      "requiredTests": ["tests/test_webhooks.py"],
      "requiredCommands": ["python3 -m pytest tests/test_webhooks.py::test_create_webhook -x -q"],
      "dependsOn": ["id-of-dependency"]
    }
  ]
}
\`\`\`

**implementationNotes must include:**
- Which existing files to use as patterns and WHY
- Specific framework/ORM patterns to follow (with details from what you read)
- Integration points with existing code (exact function names, imports, patterns)
- Risks or gotchas you discovered while reading the code
- Do NOT be generic ("follow best practices") — be specific ("use the Depends(get_db) pattern from dependencies.py")

**Each story must also include:**
- \`primaryPattern\`: the single best existing file to follow
- \`integrationPoints\`: exact seams where the work attaches
- \`nonGoals\`: explicit boundaries that must remain out of scope
- \`validationSignal\`: the observable condition that proves the story is complete
- \`requiredFiles\`: files that MUST exist by the end of the story
- \`requiredTests\`: normal regression tests that MUST exist by the end of the story
- \`requiredCommands\`: targeted commands that MUST pass before review
- \`assumptions\`: only when needed, and only for things not confirmed from the repo

**\`description\` must be a detailed, complete scope definition** — NOT a one-liner. Include what to create, what each component does, data models, endpoints, and key behaviors. The worker uses this as their primary task brief. Never trail off with "..." or leave details out.

**Workers receive the full spec separately.** Do not rewrite the spec in descriptions or notes. Focus on HOW to implement within THIS codebase, not WHAT to implement.

Available personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead${config.review?.verifyEnabled !== false ? `

## Verification Commands

Verification gates are enabled for this run. For each story, include a \`verificationCommands\` array — shell commands that confirm the story's acceptance criteria from the outside after the code is written. These run automatically before the tech lead reviewer sees the code.

**What belongs here:** Black-box assertions an observer can run from the project root. The command must exit non-zero if the acceptance criteria aren't met.

**What does NOT belong here:** Full test suite runs (\`npm test\`, \`pytest\`), commands that start servers, or commands that require external services.

Examples by stack:

Node/TypeScript CLI:
\`"verificationCommands": ["node dist/index.js models | grep -E 'http://localhost'", "node dist/index.js models --json | node -e \\"const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!Array.isArray(d)) process.exit(1)\\""] \`

Python/FastAPI:
\`"verificationCommands": ["python3 -m pytest tests/test_webhooks.py::test_create_webhook -x -q"] \`

Go:
\`"verificationCommands": ["go build ./cmd/... && echo OK", "go test ./internal/webhooks/... -run TestWebhookOutput -count=1"] \`

Ruby:
\`"verificationCommands": ["bundle exec rspec spec/commands/models_spec.rb --format progress"] \`

Rules:
- 1–3 commands per story maximum
- Scoped to THIS story's deliverable only
- Runnable from the project root with no setup
- Omit \`verificationCommands\` entirely for infrastructure-only stories (migrations, config changes) with no observable output

**Definition-of-done rules:**
- Prefer 0-2 \`requiredFiles\` entries: only the artifacts that prove the story landed
- Prefer 1 \`requiredTests\` entry for the narrowest normal regression test
- For new CLI commands under \`src/*-command.ts\`, always include a normal regression test under \`src/__tests__/\`, not only e2e coverage
- \`requiredCommands\` should be focused verification for THIS story only, not the whole project` : ""}`;


  logger.info("Planner started", { provider: pProvider, model: pModel });
  output.log("planner", `Planning with \x1b[36m${pProvider}/${pModel}\x1b[0m (${formatContext(getModelContext(pModel, pCtx))} context)`);
  output.status(getPrdDecompositionPhaseLabel("calling_llm"));

  const planStart = Date.now();

  // Stream planner output line-by-line as it arrives
  let planText = "";
  let planUsage: { inputTokens?: number; outputTokens?: number } | undefined;
  try {
    // Use onStepFinish — same pattern as worker/ai-clients/ai-sdk-client.ts
    const planStream = streamText({
      model: plannerModel,
      abortSignal,
      system: planner?.systemPrompt || "You are an implementation planner.",
      prompt: plannerPrompt,
      tools: readOnlyTools as ToolSet,
      stopWhen: stepCountIs(100),
      timeout: { chunkMs: 120_000 },
      ...buildOllamaOptions(pProvider as AIProvider, pCtx),
      onStepFinish() {
        // Text already streamed line-by-line below — just update status between steps
        output.status(getPrdDecompositionPhaseLabel("streaming"));
      },
    });

    let lineBuffer = "";
    for await (const chunk of planStream.textStream) {
      if (abortSignal?.aborted) break;
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || ""; // keep incomplete last line in buffer
      for (const line of lines) {
        if (line.trim()) {
          output.log("planner", line);
        }
      }
    }
    if (lineBuffer.trim()) {
      output.log("planner", lineBuffer);
    }
    if (abortSignal?.aborted) {
      output.statusDone();
      output.coordinatorLog("Build cancelled by user.");
      return cancelled();
    }
    planText = await planStream.text;
    planUsage = await planStream.totalUsage;
    if (abortSignal?.aborted) {
      output.statusDone();
      output.coordinatorLog("Build cancelled by user.");
      return cancelled();
    }
    // Track tok/s for planner model
    const planElapsed = (Date.now() - planStart) / 1000;
    const planOutTokens = planUsage?.outputTokens || 0;
    if (planOutTokens > 0 && planElapsed > 0) {
      const planTokPerSec = Math.round(planOutTokens / planElapsed);
      output.updateTokPerSec?.(`${pProvider}/${pModel}`, planTokPerSec);
      logger.info("Model performance", { provider: pProvider, model: pModel, tokPerSec: planTokPerSec });
    }
  } catch (planErr) {
    output.statusDone();
    if (abortSignal?.aborted) {
      logger.info("Planner cancelled by user");
      output.coordinatorLog("Build cancelled by user.");
      return { stories: [], provider: pProvider, model: pModel, inputTokens: 0, outputTokens: 0, rejected: true, rejectionReason: "Cancelled" };
    }
    if (isBalanceOrQuotaError(planErr) && output.requestPause) {
      output.coordinatorLog("Planner paused: provider quota/balance appears exhausted.");
      output.log(
        "system",
        "Paused: your provider credits/quota appear low. Top up your balance or switch providers with `/model <provider>/<model>`, then run `/pause` to resume.",
      );
      await output.requestPause();
      if (abortSignal?.aborted) {
        output.coordinatorLog("Build cancelled by user.");
        return { stories: [], provider: pProvider, model: pModel, inputTokens: 0, outputTokens: 0, rejected: true, rejectionReason: "Cancelled" };
      }
      output.coordinatorLog("Resuming planner after provider/account update...");
      return planStories(config, userTask, workingDir, sandboxed, output, abortSignal);
    }
    // Rate limit retry — back off and retry the entire planner call (max 3 retries)
    const rl = isRateLimitError(planErr);
    if (rl && _rateLimitRetries < 3) {
      const waitSec = Math.ceil(rl.retryAfterMs / 1000);
      output.coordinatorLog(`Planner rate limited — retrying in ${waitSec}s (${_rateLimitRetries + 1}/3)`);
      logger.info("Planner rate limit retry", { attempt: _rateLimitRetries + 1, waitSec });
      await rateLimitSleep(rl.retryAfterMs);
      return planStories(config, userTask, workingDir, sandboxed, output, abortSignal, _rateLimitRetries + 1);
    }
    const msg = planErr instanceof Error ? planErr.message : String(planErr);
    logger.error("Planner failed", { error: msg });
    output.error(`Planner failed: ${msg}`);
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: 0,
      outputTokens: 0,
      rejected: true,
      rejectionReason: msg,
    };
  }
  output.status(getPrdDecompositionPhaseLabel("parsing"));

  // Check for planner rejection before parsing stories
  const rejectionMatch = planText.match(/"rejected"\s*:\s*true[\s\S]*?"reason"\s*:\s*"([^"]+)"/);
  if (rejectionMatch) {
    const reason = rejectionMatch[1];
    logger.info("Planner rejected task", { reason });
    output.coordinatorLog(`Planner rejected: ${reason}`);
    output.error(`Task rejected by planner: ${reason}`);
    output.statusDone();
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: planUsage?.inputTokens || 0,
      outputTokens: planUsage?.outputTokens || 0,
      rejected: true,
      rejectionReason: reason,
    };
  }

  let stories = parseStoriesFromText(planText, output);

  logger.info("Planner completed", { storiesFound: stories.length, planTextLength: planText.length });

  if (stories.length > 0) {
    const validationIssues = validatePlannerStories(stories);
    if (validationIssues.length > 0) {
      const reason = `Planner produced an incomplete handoff: ${validationIssues.slice(0, 6).join("; ")}`;
      logger.error("Planner story validation failed", { issues: validationIssues });
      output.error(reason);
      output.statusDone();
      return {
        stories: [],
        provider: pProvider,
        model: pModel,
        inputTokens: planUsage?.inputTokens || 0,
        outputTokens: planUsage?.outputTokens || 0,
        rejected: true,
        rejectionReason: reason,
      };
    }
  }

  // If the planner produced text but no parseable JSON stories, do a single
  // cheap follow-up to extract the plan as JSON. This mirrors the platform's
  // critic refinement loop (critic-agent-local.ts) but without scoring overhead.
  if (stories.length === 0 && planText.length > 200) {
    output.log("planner", "Plan text produced but JSON was missing — extracting stories...");
    logger.info("Planner JSON extraction retry", { planTextLength: planText.length });

    try {
      if (abortSignal?.aborted) {
        output.statusDone();
        output.coordinatorLog("Build cancelled by user.");
        return cancelled();
      }
      const extractionInput = truncateForPrompt(planText, 12_000, "planner analysis");
      const extractionResult = await generateText({
        model: plannerModel,
        prompt: `You previously analyzed a codebase and produced the following plan:\n\n${extractionInput}\n\n` +
          `Convert your analysis into the required JSON format. Output ONLY a \`\`\`json code block:\n\n` +
          "```json\n" +
          `{ "stories": [{ "id": "kebab-id", "title": "Brief title", "persona": "persona_name", "description": "Scope and what to do", "targetFiles": ["path/to/file"], "referenceFiles": ["path/to/pattern"], "primaryPattern": "path/to/pattern", "integrationPoints": ["exact seam"], "nonGoals": ["scope boundary"], "validationSignal": "observable proof of correctness", "requiredFiles": ["path/to/file"], "requiredTests": ["src/__tests__/feature.test.ts"], "requiredCommands": ["npm run typecheck"], "implementationNotes": "Specific patterns, files, integration points" }] }\n` +
          "```\n\n" +
          "Valid personas: backend_developer, frontend_developer, devops_engineer, qa_engineer, security_engineer, data_ml_engineer, mobile_developer, tech_writer, tech_lead.\n" +
          "Output ONLY the JSON block, no other text.",
        maxOutputTokens: 4096,
        abortSignal,
      });

      if (abortSignal?.aborted) {
        output.statusDone();
        output.coordinatorLog("Build cancelled by user.");
        return cancelled();
      }

      const retryStories = parseStoriesFromText(extractionResult.text, output);
      if (retryStories.length > 0) {
        output.log("planner", `Extracted ${retryStories.length} stories from plan text.`);
        const retryUsage = extractionResult.usage;
        output.statusDone();
        return {
          stories: retryStories,
          provider: pProvider,
          model: pModel,
          inputTokens: (planUsage?.inputTokens || 0) + (retryUsage?.inputTokens || 0),
          outputTokens: (planUsage?.outputTokens || 0) + (retryUsage?.outputTokens || 0),
        };
      }
    } catch (extractErr) {
      if (abortSignal?.aborted) {
        output.statusDone();
        output.coordinatorLog("Build cancelled by user.");
        return cancelled();
      }
      logger.error("JSON extraction retry failed", { error: extractErr instanceof Error ? extractErr.message : String(extractErr) });
    }

    logger.error("Planner produced no stories", { planTextPreview: planText.slice(0, 500) });
    output.error("Planner failed to produce a parseable plan.");
    output.statusDone();
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: planUsage?.inputTokens || 0,
      outputTokens: planUsage?.outputTokens || 0,
      rejected: true,
      rejectionReason: "Planner produced no output",
    };
  }

  if (stories.length === 0) {
    logger.error("Planner produced no output", { planTextLength: planText.length });
    output.error("Planner failed to produce a plan. This could be a rate limit, API error, or the task was too vague.");
    output.statusDone();
    return {
      stories: [],
      provider: pProvider,
      model: pModel,
      inputTokens: planUsage?.inputTokens || 0,
      outputTokens: planUsage?.outputTokens || 0,
      rejected: true,
      rejectionReason: "Planner produced no output",
    };
  }

  output.statusDone();
  return {
    stories,
    provider: pProvider,
    model: pModel,
    inputTokens: planUsage?.inputTokens || 0,
    outputTokens: planUsage?.outputTokens || 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  parseStoriesFromText                                                      */
/* -------------------------------------------------------------------------- */

/** Parse stories JSON from planner output text */
export function parseStoriesFromText(text: string, output: OrchestrationOutput): Story[] {
  // Strategy 1: JSON code block (```json ... ```)
  // Use greedy match and try multiple code blocks if first fails
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  for (const match of codeBlocks) {
    const stories = tryParseStories(match[1].trim());
    if (stories) return stories;
  }

  // Strategy 2: Find JSON object with "stories" key using bracket matching
  const storiesIdx = text.indexOf('"stories"');
  if (storiesIdx !== -1) {
    // Walk back to find the opening {
    let braceStart = text.lastIndexOf("{", storiesIdx);
    if (braceStart !== -1) {
      const json = extractBalancedJSON(text, braceStart);
      if (json) {
        const stories = tryParseStories(json);
        if (stories) return stories;
      }
    }
  }

  // Strategy 3: Find any JSON array containing objects with "persona"
  const arrayStart = text.indexOf("[");
  if (arrayStart !== -1 && text.indexOf('"persona"') !== -1) {
    const json = extractBalancedJSON(text, arrayStart);
    if (json) {
      const stories = tryParseStories(json);
      if (stories) return stories;
    }
  }

  // Strategy 4: Try parsing the entire text as JSON
  const stories = tryParseStories(text.trim());
  if (stories) return stories;

  // Log what we couldn't parse for debugging
  const preview = text.slice(0, 500);
  output.log("system", `(planner output preview: ${preview}${text.length > 500 ? "..." : ""})`);

  return [];
}

/* -------------------------------------------------------------------------- */
/*  normalizeStory                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeStory(raw: Record<string, unknown>, index: number): Story {
  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map(String).filter(Boolean) : undefined;

  const referenceFiles = toStringArray(raw.referenceFiles) ?? toStringArray(raw.reference_files);
  const targetFiles = toStringArray(raw.targetFiles) ?? toStringArray(raw.target_files);
  const integrationPoints = toStringArray(raw.integrationPoints) ?? toStringArray(raw.integration_points);
  const assumptions = toStringArray(raw.assumptions);
  const nonGoals = toStringArray(raw.nonGoals) ?? toStringArray(raw.non_goals);
  const implementationNotes = raw.implementationNotes ? String(raw.implementationNotes) : undefined;
  const description = String(raw.description || raw.details || raw.task || raw.title || "");

  return {
    id: String(raw.id || raw.index || raw.step || raw.number || index + 1),
    title: String(raw.title || raw.name || raw.summary || ""),
    persona: String(raw.persona || raw.role || raw.agent || "backend_developer"),
    description,
    dependsOn: toStringArray(raw.dependsOn) ?? toStringArray(raw.depends_on) ?? toStringArray(raw.dependencies),
    targetFiles,
    referenceFiles,
    primaryPattern: raw.primaryPattern
      ? String(raw.primaryPattern)
      : raw.primary_pattern
        ? String(raw.primary_pattern)
        : referenceFiles?.[0],
    integrationPoints,
    assumptions,
    nonGoals,
    implementationNotes,
    validationSignal: raw.validationSignal
      ? String(raw.validationSignal)
      : raw.validation_signal
        ? String(raw.validation_signal)
        : (description ? `Complete the story scope described as: ${description}` : undefined),
    requiredFiles: toStringArray(raw.requiredFiles) ?? toStringArray(raw.required_files),
    requiredTests: toStringArray(raw.requiredTests) ?? toStringArray(raw.required_tests),
    requiredCommands: toStringArray(raw.requiredCommands) ?? toStringArray(raw.required_commands),
    verificationCommands: toStringArray(raw.verificationCommands) ?? toStringArray(raw.verification_commands),
  };
}

/* -------------------------------------------------------------------------- */
/*  Small utility helpers                                                     */
/* -------------------------------------------------------------------------- */

export function uniqueStrings(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];
}

export function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isExcludedTestPath(filePath: string): boolean {
  const normalized = toPosixPath(filePath);
  return normalized.includes("/e2e/") || normalized.endsWith(".e2e.test.ts");
}

export function deriveAutoRequiredTests(story: Story): string[] {
  const targetFiles = story.targetFiles ?? [];
  const required: string[] = [];
  for (const file of targetFiles) {
    const normalized = toPosixPath(file);
    const match = normalized.match(/(^|\/)([^/]+-command)\.ts$/);
    if (!match) continue;
    required.push(`src/__tests__/${match[2]}.test.ts`);
  }
  return uniqueStrings(required);
}

/* -------------------------------------------------------------------------- */
/*  normalizeStoryDependencies                                                */
/* -------------------------------------------------------------------------- */

export function normalizeStoryDependencies(stories: Story[]): Story[] {
  const validIds = new Set(stories.map((story) => story.id));
  return stories.map((story) => ({
    ...story,
    dependsOn: story.dependsOn?.filter((dep) => validIds.has(dep)),
  }));
}

/* -------------------------------------------------------------------------- */
/*  buildAutoQaStory                                                          */
/* -------------------------------------------------------------------------- */

export function buildAutoQaStory(stories: Story[]): Story {
  const implementationStories = stories.filter((story) => story.persona !== "qa_engineer");
  const dependsOn = implementationStories.map((story) => story.id);
  const cliCommandTargets = implementationStories
    .flatMap((story) => story.targetFiles ?? [])
    .filter((file) => /(^|\/)[^/]+-command\.ts$/.test(file))
    .map((file) => path.basename(file).replace(/\.ts$/, ".test.ts"))
    .map((file) => `src/__tests__/${file}`);

  return {
    id: "qa-validation",
    title: "Cross-story QA validation",
    persona: "qa_engineer",
    description: "Validate the completed implementation end-to-end, add or tighten missing regression coverage, and confirm the user-facing workflow still works.",
    dependsOn,
    targetFiles: cliCommandTargets,
    requiredTests: cliCommandTargets,
    implementationNotes: "Review the completed stories, verify the main user workflow, and add the narrowest missing regression coverage needed to prove the implementation is done.",
    validationSignal: "The build has dedicated QA validation coverage and any missing regression gaps have been closed.",
  };
}

/* -------------------------------------------------------------------------- */
/*  applyQaParticipation                                                      */
/* -------------------------------------------------------------------------- */

export function applyQaParticipation(stories: Story[], participation: "default" | "always"): Story[] {
  if (participation === "always" && !stories.some((story) => story.persona === "qa_engineer")) {
    return normalizeStoryDependencies([...stories, buildAutoQaStory(stories)]);
  }

  return normalizeStoryDependencies(stories);
}

/* -------------------------------------------------------------------------- */
/*  validatePlannerStories                                                    */
/* -------------------------------------------------------------------------- */

export function validatePlannerStories(stories: Story[]): string[] {
  const issues: string[] = [];

  stories.forEach((story, index) => {
    const label = `Story ${index + 1} (${story.title || story.id || "untitled"})`;
    if (!story.title.trim()) issues.push(`${label}: missing title`);
    if (!story.description.trim()) issues.push(`${label}: missing description`);
  });

  return issues;
}

/* -------------------------------------------------------------------------- */
/*  tryParseStories                                                           */
/* -------------------------------------------------------------------------- */

export function tryParseStories(text: string): Story[] | null {
  try {
    const parsed = JSON.parse(text);
    let rawStories: Record<string, unknown>[] | null = null;

    if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].persona || parsed[0].role || parsed[0].agent)) {
      rawStories = parsed;
    } else if (parsed && Array.isArray(parsed.stories) && parsed.stories.length > 0) {
      rawStories = parsed.stories;
    } else if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      rawStories = parsed.steps;
    } else if (parsed && Array.isArray(parsed.plan) && parsed.plan.length > 0) {
      rawStories = parsed.plan;
    }

    if (rawStories) {
      return rawStories.map((s, i) => normalizeStory(s, i));
    }
  } catch {
    // Not valid JSON — caller will try other parsing strategies
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  extractBalancedJSON                                                       */
/* -------------------------------------------------------------------------- */

/** Extract a balanced JSON structure starting at the given index */
export function extractBalancedJSON(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;

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
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null; // Unbalanced
}
