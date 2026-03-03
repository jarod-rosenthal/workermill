/**
 * PRD Decomposer Service
 *
 * Takes a PRD (Product Requirements Document) text and calls the Anthropic Messages API
 * to decompose it into structured, sized card definitions for a Kanban board.
 *
 * Each card represents a cohesive epic (vertical slice / architectural layer) with
 * 7-12 deliverables, dependency tracking, and persona assignment.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger.js";
import {
  decompositionEmitter,
  type DecompositionEvent,
} from "./decomposition-events.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PreComputedStory {
  id: string; // "story-0", "story-1", ...
  title: string;
  description: string; // scope label (2-3 lines)
  persona: string; // from valid personas
  priority: number;
  estimatedEffort: "small" | "medium" | "large";
  dependencies: string[]; // inter-story within card: ["story-0"]
  targetFilePatterns: string[]; // glob patterns: ["api/handlers/*.go", "api/models/flag.go"]
}

export interface DecomposedCard {
  title: string;
  description: string;
  persona: string;
  priority: "urgent" | "high" | "medium" | "low";
  dependencyIndices: number[];
  labels: string[];
  estimatedSteps: number;
  stories?: PreComputedStory[];
}

export interface QualityGateConfig {
  name: string;
  trigger: string;
  commands: string[];
}

export interface DecomposedPrd {
  boardName: string;
  cards: DecomposedCard[];
  qualityGates?: QualityGateConfig[];
  ciWorkflowPath?: string;
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const SYSTEM_PROMPT = `You are a senior technical program manager who decomposes Product Requirements Documents (PRDs) into implementation cards for AI coding agents.

Each card represents ONE cohesive epic — a major functional slice that a single AI worker can execute independently (given its dependencies are met). Workers receive the FULL PRD as their specification, so cards define SCOPE (what to build), not specs (how to build it — the PRD has those).

***REMOVED******REMOVED*** Sizing Rules (CRITICAL)

- Target **3-4 total cards** for the entire project. Fewer cards = fewer handoffs = fewer integration bugs between workers.
- Target 15-30 deliverables per card. AI workers perform BETTER with larger, cohesive cards that cover a complete functional layer.
- Cards with >35 deliverables should be split. Cards with <8 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Foundation" — combines project scaffolding, CI/CD pipeline, AND all backend/server code (models, handlers, middleware, services, seed data, tests). CI deliverables are part of this card, NOT a separate card. Assigned to backend_developer.
- For full-stack projects: Card 1 = Foundation (backend + CI), Card 2 = Frontend (all UI), Last card = Deployment + Validation.
- For backend-only projects: Card 1 = Foundation (backend + CI), Card 2 = Deployment + Validation.
- The LAST card ALWAYS includes production deployment + validation — deployment pipeline, smoke tests, seed verification, go-live checklist.

***REMOVED******REMOVED*** Card Description Format (REQUIRED)

Each card description MUST include ALL of the following sections:

***REMOVED******REMOVED******REMOVED*** Epic Overview
A 2-3 sentence summary of what this card accomplishes and why it matters.

***REMOVED******REMOVED******REMOVED*** Scope Boundary
- What prior cards created that this card builds on (reference by card index)
- What this card must NOT touch (boundaries with other cards)

***REMOVED******REMOVED******REMOVED*** Prerequisites
- List card indices that must complete before this card can start

***REMOVED******REMOVED******REMOVED*** Deliverables
- Numbered list of concrete, testable outputs (files, endpoints, components, tests)
- Each deliverable should be independently verifiable

***REMOVED******REMOVED******REMOVED*** Technical Specification
- Key technical decisions, patterns, libraries, or APIs to use
- Any constraints or non-functional requirements

***REMOVED******REMOVED*** Persona Assignment

Assign exactly one persona per card from this list:
- backend_developer — API endpoints, database, server logic
- frontend_developer — UI components, pages, client-side logic
- devops_engineer — Infrastructure, CI/CD, deployment, monitoring
- security_engineer — Auth, encryption, vulnerability hardening
- qa_engineer — Test suites, E2E tests, coverage
- tech_writer — Documentation, guides, API docs
- project_manager — Coordination, planning, process

Choose the persona whose primary skillset best matches the card's dominant work.

***REMOVED******REMOVED*** Dependency Rules

- dependencyIndices are 0-based array positions referring to other cards
- No circular dependencies allowed — the dependency graph must be a DAG
- Card 0 (Foundation) has no dependencies (empty array)
- All subsequent cards depend on Card 0 (directly or transitively)
- The last card (Deployment) typically depends on all preceding cards

***REMOVED******REMOVED*** CI/CD Is a First-Class Citizen (Part of Card 1)

CI/CD is NOT a separate card. It is part of Card 1 (Foundation). The CI pipeline proves code compiles, passes lint, passes tests, and builds.

Card 1 CI deliverables MUST include:
1. CI workflow file (e.g., .github/workflows/ci.yml) with ALL quality steps (lint, typecheck, test, build)
2. A trivial passing test file so the test step succeeds on first run
3. CI workflow triggers MUST include BOTH \`push: [main]\` AND \`pull_request: [main]\` events. Without \`pull_request\` triggers, CI won't run on PRs and code merges without verification.

IMPORTANT: Do NOT create a separate "CI verification" story that pushes to main to test the pipeline. CI verification happens automatically when the PR is created — the \`pull_request\` trigger handles it. Workers must NEVER push directly to main. All code goes through story branches → consolidated PR → merge. A story that pushes to main bypasses the PR workflow and causes the task to complete without a PR.

CI workflow steps MUST run the EXACT SAME commands as the quality gates — no additions, no differences. This is critical: if the quality gate runs "go vet ./..." and "go test ./... -v -count=1 -race", the CI workflow MUST run those same commands, NOT golangci-lint or any other tool. The quality gates are the single source of truth for what "passing" means. Any divergence between the quality gates and CI creates a gap where code passes one but fails the other.

For Go CI: use "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server" (NOT golangci-lint, staticcheck, or other third-party linters). For Node.js CI: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python CI: use "python -m pytest", "python -m mypy .". Do NOT add third-party tools to CI that aren't already in the repo.

ALL subsequent cards MUST depend on Card 1 (directly or transitively).

***REMOVED******REMOVED*** Priority Assignment

- urgent: Card 1 — Foundation (setup + CI + backend)
- high: Feature cards (frontend, integration)
- medium: Deployment + validation (last card)
- low: Nice-to-have, polish, documentation

***REMOVED******REMOVED*** Output Format

Respond with ONLY a JSON object (no markdown fences, no explanation):

{
  "boardName": "Short descriptive board name derived from the PRD title",
  "qualityGates": [
    {
      "name": "backend",
      "trigger": "api/**",
      "commands": ["cd api && go vet ./...", "cd api && go test ./... -v -count=1 -race", "cd api && go build -o /dev/null ./cmd/server"]
    },
    {
      "name": "frontend",
      "trigger": "web/**",
      "commands": ["cd web && npm run lint", "cd web && npm run test", "cd web && npm run build"]
    },
    {
      "name": "typecheck",
      "trigger": "src/**/*.ts",
      "commands": ["npx tsc --noEmit"]
    }
  ],
  "ciWorkflowPath": ".github/workflows/ci.yml",
  "cards": [
    {
      "title": "Card title (concise, action-oriented)",
      "description": "Full description with all required sections",
      "persona": "one_of_the_valid_personas",
      "priority": "urgent|high|medium|low",
      "dependencyIndices": [0],
      "labels": ["relevant", "tags"],
      "estimatedSteps": 8
    }
  ]
}

qualityGates: Extract pre-commit quality gate commands from the PRD. Each gate has a name (e.g., "backend", "frontend"), a file trigger glob (e.g., "api/**"), and the exact shell commands to run. These commands run in a minimal container — ONLY use tools from the standard toolchain. For Go: use ONLY "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server", "gofmt -w ." (NOT "gofmt ./..." — gofmt doesn't support "..."). Do NOT use golangci-lint, staticcheck, or other third-party tools — they are not installed. For Node.js: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python: use "python -m pytest", "python -m mypy .". IMPORTANT: The CI workflow MUST use the exact same commands as the quality gates — no divergence allowed.
ciWorkflowPath: The path to the CI workflow file in the repo. GitHub repos use ".github/workflows/ci.yml", Bitbucket repos use "bitbucket-pipelines.yml". Used to detect when CI becomes available and to verify CI passes after push.
estimatedSteps is the number of deliverables in the card (used for progress tracking).
labels should include relevant technology or domain tags (e.g., "react", "api", "terraform", "auth").`;

// ============================================================================
// SYSTEM PROMPT — WITH STORIES (decomposer_planned mode)
// ============================================================================

/**
 * Extended system prompt that produces cards WITH pre-computed story breakdowns.
 * Used when org.planningMode === "decomposer_planned".
 *
 * The base card-level rules are identical to SYSTEM_PROMPT. The addition is:
 * each card includes a `stories[]` array with story-level breakdown including
 * `targetFilePatterns` (glob patterns the grounding pass resolves against the repo).
 */
export const SYSTEM_PROMPT_WITH_STORIES = `${SYSTEM_PROMPT}

***REMOVED******REMOVED*** Story Breakdown Per Card (REQUIRED in decomposer_planned mode)

In addition to the card-level structure above, each card MUST include a \`stories\` array. Stories are the parallel execution units within a card — each story is assigned to one AI expert and runs in its own worktree.

***REMOVED******REMOVED******REMOVED*** Story Rules

- Each story has a \`persona\` from the same persona list above. Different personas run in PARALLEL. Same-persona stories run SEQUENTIALLY.
- **Maximize parallelism via persona diversity.** Assign different personas to independent stories (e.g., \`backend_developer\` for API routes, \`frontend_developer\` for UI).
- **No overlapping targetFilePatterns within a card.** Two stories MUST NOT target the same files — they execute in parallel worktrees, so concurrent edits cause merge conflicts. If multiple stories need the same file, put ALL changes in ONE foundational story and make others depend on it.
- **No circular dependencies.** Story dependencies form a DAG within the card. Use story IDs (e.g., "story-0", "story-1") to reference dependencies.
- **targetFilePatterns are glob patterns**, not exact paths. You don't have repo access, so infer paths from the PRD context. Examples: \`api/handlers/*.go\`, \`web/src/routes/+page.svelte\`, \`api/models/flag.go\`, \`cmd/server/main.go\`. Use the most specific pattern you can infer from the PRD's technology stack and directory structure references.
- **Story descriptions are scope labels**, not specs. Each expert reads the FULL PRD. Descriptions say which area the expert owns (2-3 lines).
- Target 2-6 stories per card. Each story should be meaningful work, not trivial tasks.

***REMOVED******REMOVED******REMOVED*** Extended Output Format

The output format is the SAME as above, but each card object includes a \`stories\` array:

{
  "boardName": "Short descriptive board name",
  "qualityGates": [...],
  "ciWorkflowPath": ".github/workflows/ci.yml",
  "cards": [
    {
      "title": "Foundation — Backend + CI",
      "description": "Full description with all required sections...",
      "persona": "backend_developer",
      "priority": "urgent",
      "dependencyIndices": [],
      "labels": ["go", "fiber", "mongodb"],
      "estimatedSteps": 20,
      "stories": [
        {
          "id": "story-0",
          "title": "Project scaffolding and CI",
          "description": "Initialize Go module, Fiber app skeleton, Docker Compose, and CI workflow.\\nSets up the build system and quality gates for all subsequent stories.",
          "persona": "backend_developer",
          "priority": 1,
          "estimatedEffort": "medium",
          "dependencies": [],
          "targetFilePatterns": ["go.mod", "go.sum", "cmd/server/main.go", "Dockerfile", "docker-compose.yml", ".github/workflows/ci.yml"]
        },
        {
          "id": "story-1",
          "title": "Database models and seed data",
          "description": "MongoDB models, connection setup, and seed data.\\nDefines all collections referenced by the API handlers.",
          "persona": "backend_developer",
          "priority": 2,
          "estimatedEffort": "medium",
          "dependencies": ["story-0"],
          "targetFilePatterns": ["api/models/*.go", "api/database/*.go", "scripts/seed.go"]
        },
        {
          "id": "story-2",
          "title": "API handlers and middleware",
          "description": "REST API route handlers, auth middleware, and request validation.\\nImplements all endpoints defined in the PRD.",
          "persona": "backend_developer",
          "priority": 2,
          "estimatedEffort": "large",
          "dependencies": ["story-1"],
          "targetFilePatterns": ["api/handlers/*.go", "api/middleware/*.go", "api/routes.go"]
        }
      ]
    }
  ]
}

IMPORTANT: The \`stories\` array is REQUIRED for every card. Do NOT omit it.`;

// ============================================================================
// MAIN FUNCTION
// ============================================================================

const DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * Decompose a PRD into structured implementation cards using the Anthropic SDK.
 *
 * Auth priority: OAuth token (Claude Max) > explicit API key > ANTHROPIC_API_KEY env var.
 * The SDK handles OAuth via `authToken` parameter (raw API does NOT support OAuth).
 *
 * @param prdContent - The full text of the PRD document
 * @param model - Anthropic model ID (e.g., "claude-sonnet-4-20250514")
 * @param apiKey - Anthropic API key (falls back to ANTHROPIC_API_KEY env var)
 * @returns Structured decomposition with board name and cards
 */
export async function decomposePrd(
  prdContent: string,
  model: string,
  apiKey?: string,
): Promise<DecomposedPrd> {
  // Prefer OAuth token (Claude Max) over API key — API keys may have no credits
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!oauthToken && !resolvedApiKey) {
    throw new Error(
      "No Anthropic API key provided. Pass apiKey parameter or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN environment variable.",
    );
  }

  const resolvedModel = model || DEFAULT_MODEL;

  logger.info("Decomposing PRD via Anthropic SDK", {
    model: resolvedModel,
    prdLength: prdContent.length,
    authMethod: oauthToken ? "oauth" : "api_key",
  });

  // Build SDK client — OAuth uses authToken, API key uses apiKey
  const client = oauthToken
    ? new Anthropic({ authToken: oauthToken })
    : new Anthropic({ apiKey: resolvedApiKey });

  // Use streaming internally to avoid Anthropic SDK 10-minute timeout on
  // long-running non-streaming requests. We collect the text without emitting events.
  let rawText = "";
  try {
    const stream = client.messages.stream({
      model: resolvedModel,
      max_tokens: 128000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
        },
      ],
    });

    stream.on("text", (textDelta) => {
      rawText += textDelta;
    });

    const finalMessage = await stream.finalMessage();

    logger.info("Received PRD decomposition response", {
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason,
      inputTokens: finalMessage.usage?.input_tokens,
      outputTokens: finalMessage.usage?.output_tokens,
      responseLength: rawText.length,
    });
  } catch (error) {
    logger.error("Anthropic SDK error during PRD decomposition", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `PRD decomposition failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!rawText) {
    throw new Error("Anthropic API returned empty content");
  }

  // Strip markdown fences if present (```json ... ``` or ``` ... ```)
  const jsonText = stripMarkdownFences(rawText);

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    logger.error("Failed to parse PRD decomposition JSON", {
      error: error instanceof Error ? error.message : String(error),
      rawTextSnippet: rawText.slice(0, 500),
    });
    throw new Error(
      `Failed to parse PRD decomposition response as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Validate and return
  return validateDecomposedPrd(parsed);
}

/**
 * Decompose a PRD into cards WITH pre-computed story breakdowns.
 * Used when org.planningMode === "decomposer_planned".
 *
 * Same signature and auth logic as decomposePrd(), but uses
 * SYSTEM_PROMPT_WITH_STORIES so each card includes stories[].
 */
export async function decomposePrdWithStories(
  prdContent: string,
  model: string,
  apiKey?: string,
): Promise<DecomposedPrd> {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!oauthToken && !resolvedApiKey) {
    throw new Error(
      "No Anthropic API key provided. Pass apiKey parameter or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN environment variable.",
    );
  }

  const resolvedModel = model || DEFAULT_MODEL;

  logger.info("Decomposing PRD with stories via Anthropic SDK", {
    model: resolvedModel,
    prdLength: prdContent.length,
    authMethod: oauthToken ? "oauth" : "api_key",
  });

  const client = oauthToken
    ? new Anthropic({ authToken: oauthToken })
    : new Anthropic({ apiKey: resolvedApiKey });

  // Use streaming internally to avoid Anthropic SDK 10-minute timeout on
  // long-running non-streaming requests. We collect the text without emitting events.
  let rawText = "";
  try {
    const stream = client.messages.stream({
      model: resolvedModel,
      max_tokens: 128000,
      system: SYSTEM_PROMPT_WITH_STORIES,
      messages: [
        {
          role: "user",
          content: `Decompose this PRD into implementation cards with story breakdowns:\n\n${prdContent}`,
        },
      ],
    });

    stream.on("text", (textDelta) => {
      rawText += textDelta;
    });

    const finalMessage = await stream.finalMessage();

    logger.info("Received PRD decomposition with stories response", {
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason,
      inputTokens: finalMessage.usage?.input_tokens,
      outputTokens: finalMessage.usage?.output_tokens,
      responseLength: rawText.length,
    });
  } catch (error) {
    logger.error("Anthropic SDK error during PRD decomposition (with stories)", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `PRD decomposition failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!rawText) {
    throw new Error("Anthropic API returned empty content");
  }

  const jsonText = stripMarkdownFences(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    logger.error("Failed to parse PRD decomposition (with stories) JSON", {
      error: error instanceof Error ? error.message : String(error),
      rawTextSnippet: rawText.slice(0, 500),
    });
    throw new Error(
      `Failed to parse PRD decomposition response as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return validateDecomposedPrd(parsed);
}

// ============================================================================
// STREAMING VARIANT
// ============================================================================

/**
 * Decompose a PRD with real-time streaming via decomposition events.
 * Same auth logic and validation as decomposePrd(), but uses client.messages.stream()
 * and emits text deltas via the decomposition event emitter.
 *
 * @param prdContent - The full text of the PRD document
 * @param model - Anthropic model ID
 * @param apiKey - Anthropic API key (falls back to env var)
 * @param decompositionId - Unique ID for correlating SSE events
 */
export async function decomposePrdStreaming(
  prdContent: string,
  model: string,
  apiKey: string | undefined,
  decompositionId: string,
): Promise<DecomposedPrd> {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!oauthToken && !resolvedApiKey) {
    throw new Error(
      "No Anthropic API key provided. Pass apiKey parameter or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN environment variable.",
    );
  }

  const resolvedModel = model || DEFAULT_MODEL;

  logger.info("Decomposing PRD via Anthropic SDK (streaming)", {
    model: resolvedModel,
    prdLength: prdContent.length,
    authMethod: oauthToken ? "oauth" : "api_key",
    decompositionId,
  });

  const client = oauthToken
    ? new Anthropic({ authToken: oauthToken })
    : new Anthropic({ apiKey: resolvedApiKey });

  const emit = (event: DecompositionEvent) =>
    decompositionEmitter.emitEvent(decompositionId, event);

  emit({ phase: "calling_llm", detail: `Model: ${resolvedModel}` });

  let fullText = "";
  try {
    const stream = client.messages.stream({
      model: resolvedModel,
      max_tokens: 128000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
        },
      ],
    });

    stream.on("text", (textDelta) => {
      fullText += textDelta;
      emit({
        phase: "streaming",
        text: textDelta,
        charsGenerated: fullText.length,
      });
    });

    const finalMessage = await stream.finalMessage();

    logger.info("Received PRD decomposition response (streaming)", {
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason,
      inputTokens: finalMessage.usage?.input_tokens,
      outputTokens: finalMessage.usage?.output_tokens,
      responseLength: fullText.length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Anthropic SDK streaming error during PRD decomposition", {
      error: errMsg,
    });
    emit({ phase: "error", error: errMsg });
    throw new Error(`PRD decomposition failed: ${errMsg}`);
  }

  if (!fullText) {
    emit({ phase: "error", error: "Anthropic API returned empty content" });
    throw new Error("Anthropic API returned empty content");
  }

  emit({ phase: "parsing", detail: "Parsing JSON response" });

  const jsonText = stripMarkdownFences(fullText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse PRD decomposition JSON (streaming)", {
      error: errMsg,
      rawTextSnippet: fullText.slice(0, 500),
    });
    emit({ phase: "error", error: `Failed to parse JSON: ${errMsg}` });
    throw new Error(
      `Failed to parse PRD decomposition response as JSON: ${errMsg}`,
    );
  }

  return validateDecomposedPrd(parsed);
}

/**
 * Streaming variant of decomposePrdWithStories().
 * Uses SYSTEM_PROMPT_WITH_STORIES so each card includes stories[].
 */
export async function decomposePrdWithStoriesStreaming(
  prdContent: string,
  model: string,
  apiKey: string | undefined,
  decompositionId: string,
): Promise<DecomposedPrd> {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;

  if (!oauthToken && !resolvedApiKey) {
    throw new Error(
      "No Anthropic API key provided. Pass apiKey parameter or set ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN environment variable.",
    );
  }

  const resolvedModel = model || DEFAULT_MODEL;

  logger.info("Decomposing PRD with stories via Anthropic SDK (streaming)", {
    model: resolvedModel,
    prdLength: prdContent.length,
    authMethod: oauthToken ? "oauth" : "api_key",
    decompositionId,
  });

  const client = oauthToken
    ? new Anthropic({ authToken: oauthToken })
    : new Anthropic({ apiKey: resolvedApiKey });

  const emit = (event: DecompositionEvent) =>
    decompositionEmitter.emitEvent(decompositionId, event);

  emit({ phase: "calling_llm", detail: `Model: ${resolvedModel} (with stories)` });

  let fullText = "";
  try {
    const stream = client.messages.stream({
      model: resolvedModel,
      max_tokens: 128000,
      system: SYSTEM_PROMPT_WITH_STORIES,
      messages: [
        {
          role: "user",
          content: `Decompose this PRD into implementation cards with story breakdowns:\n\n${prdContent}`,
        },
      ],
    });

    stream.on("text", (textDelta) => {
      fullText += textDelta;
      emit({
        phase: "streaming",
        text: textDelta,
        charsGenerated: fullText.length,
      });
    });

    const finalMessage = await stream.finalMessage();

    logger.info("Received PRD decomposition with stories response (streaming)", {
      model: finalMessage.model,
      stopReason: finalMessage.stop_reason,
      inputTokens: finalMessage.usage?.input_tokens,
      outputTokens: finalMessage.usage?.output_tokens,
      responseLength: fullText.length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Anthropic SDK streaming error during PRD decomposition (with stories)", {
      error: errMsg,
    });
    emit({ phase: "error", error: errMsg });
    throw new Error(`PRD decomposition failed: ${errMsg}`);
  }

  if (!fullText) {
    emit({ phase: "error", error: "Anthropic API returned empty content" });
    throw new Error("Anthropic API returned empty content");
  }

  emit({ phase: "parsing", detail: "Parsing JSON response (with stories)" });

  const jsonText = stripMarkdownFences(fullText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to parse PRD decomposition (with stories) JSON (streaming)", {
      error: errMsg,
      rawTextSnippet: fullText.slice(0, 500),
    });
    emit({ phase: "error", error: `Failed to parse JSON: ${errMsg}` });
    throw new Error(
      `Failed to parse PRD decomposition response as JSON: ${errMsg}`,
    );
  }

  return validateDecomposedPrd(parsed);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Strip markdown code fences from a string.
 * Handles ```json ... ```, ``` ... ```, and bare JSON.
 */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  // Match ```json\n...\n``` or ```\n...\n```
  const fenceMatch = trimmed.match(
    /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/,
  );
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}

/**
 * Validate the parsed JSON conforms to the DecomposedPrd interface.
 * Throws descriptive errors on validation failure.
 */
export function validateDecomposedPrd(data: unknown): DecomposedPrd {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      "PRD decomposition result is not an object",
    );
  }

  const obj = data as Record<string, unknown>;

  // Validate boardName
  if (typeof obj.boardName !== "string" || obj.boardName.trim().length === 0) {
    throw new Error(
      'PRD decomposition result missing or empty "boardName" string',
    );
  }

  // Validate cards array
  if (!Array.isArray(obj.cards) || obj.cards.length === 0) {
    throw new Error(
      'PRD decomposition result missing or empty "cards" array',
    );
  }

  const validPersonas = new Set([
    "backend_developer",
    "frontend_developer",
    "devops_engineer",
    "security_engineer",
    "qa_engineer",
    "tech_writer",
    "project_manager",
  ]);

  const validPriorities = new Set(["urgent", "high", "medium", "low"]);

  const cards: DecomposedCard[] = [];

  for (let i = 0; i < obj.cards.length; i++) {
    const raw = obj.cards[i] as Record<string, unknown>;

    // Required: title (non-empty string)
    if (typeof raw.title !== "string" || raw.title.trim().length === 0) {
      throw new Error(
        `Card at index ${i} has missing or empty "title"`,
      );
    }

    // Required: description (non-empty string)
    if (
      typeof raw.description !== "string" ||
      raw.description.trim().length === 0
    ) {
      throw new Error(
        `Card at index ${i} has missing or empty "description"`,
      );
    }

    // Persona: validate against allowed list, default to backend_developer
    const persona =
      typeof raw.persona === "string" && validPersonas.has(raw.persona)
        ? raw.persona
        : "backend_developer";

    // Priority: validate against allowed list, default to medium
    const priority =
      typeof raw.priority === "string" && validPriorities.has(raw.priority)
        ? (raw.priority as DecomposedCard["priority"])
        : "medium";

    // dependencyIndices: validate each is in range [0, cards.length)
    const dependencyIndices: number[] = [];
    if (Array.isArray(raw.dependencyIndices)) {
      for (const dep of raw.dependencyIndices) {
        if (typeof dep === "number" && dep >= 0 && dep < obj.cards.length) {
          // Also prevent self-dependency
          if (dep !== i) {
            dependencyIndices.push(dep);
          }
        } else if (typeof dep === "number") {
          throw new Error(
            `Card at index ${i} has dependencyIndex ${dep} out of range [0, ${obj.cards.length})`,
          );
        }
      }
    }

    // labels: normalize to string array
    const labels: string[] = [];
    if (Array.isArray(raw.labels)) {
      for (const label of raw.labels) {
        if (typeof label === "string" && label.trim().length > 0) {
          labels.push(label.trim());
        }
      }
    }

    // estimatedSteps: default to 8 if missing or invalid
    const estimatedSteps =
      typeof raw.estimatedSteps === "number" &&
      raw.estimatedSteps > 0 &&
      Number.isInteger(raw.estimatedSteps)
        ? raw.estimatedSteps
        : 8;

    // stories: optional pre-computed story breakdown (decomposer_planned mode)
    let stories: PreComputedStory[] | undefined;
    if (Array.isArray(raw.stories) && raw.stories.length > 0) {
      stories = [];
      const storyIds = new Set<string>();
      const allPatterns = new Set<string>();

      for (let s = 0; s < raw.stories.length; s++) {
        const rs = raw.stories[s] as Record<string, unknown>;

        const storyId =
          typeof rs.id === "string" && rs.id.trim().length > 0
            ? rs.id.trim()
            : `story-${s}`;

        if (storyIds.has(storyId)) {
          logger.warn(`Card ${i}: duplicate story id "${storyId}", renaming to "story-${s}"`);
        }
        storyIds.add(storyId);

        const storyPersona =
          typeof rs.persona === "string" && validPersonas.has(rs.persona)
            ? rs.persona
            : persona; // fall back to card persona

        // Validate dependencies reference valid story IDs within this card
        const storyDeps: string[] = [];
        if (Array.isArray(rs.dependencies)) {
          for (const dep of rs.dependencies) {
            if (typeof dep === "string") {
              storyDeps.push(dep);
            }
          }
        }

        // Check for overlapping targetFilePatterns within this card
        const patterns: string[] = [];
        if (Array.isArray(rs.targetFilePatterns)) {
          for (const p of rs.targetFilePatterns) {
            if (typeof p === "string" && p.trim().length > 0) {
              const pat = p.trim();
              if (allPatterns.has(pat)) {
                logger.warn(
                  `Card ${i}, story "${storyId}": overlapping targetFilePattern "${pat}" (already used by another story in this card)`,
                );
              }
              allPatterns.add(pat);
              patterns.push(pat);
            }
          }
        }

        const validEfforts = new Set(["small", "medium", "large"]);
        const effort =
          typeof rs.estimatedEffort === "string" && validEfforts.has(rs.estimatedEffort)
            ? (rs.estimatedEffort as PreComputedStory["estimatedEffort"])
            : "medium";

        stories.push({
          id: storyId,
          title: typeof rs.title === "string" ? rs.title.trim() : `Story ${s}`,
          description: typeof rs.description === "string" ? rs.description.trim() : "",
          persona: storyPersona,
          priority: typeof rs.priority === "number" ? rs.priority : s + 1,
          estimatedEffort: effort,
          dependencies: storyDeps,
          targetFilePatterns: patterns,
        });
      }
    }

    cards.push({
      title: raw.title.trim(),
      description: raw.description.trim(),
      persona,
      priority,
      dependencyIndices,
      labels,
      estimatedSteps,
      stories,
    });
  }

  // Extract quality gate config (optional — LLM may or may not include them)
  let qualityGates: QualityGateConfig[] | undefined;
  if (Array.isArray(obj.qualityGates)) {
    qualityGates = [];
    for (const gate of obj.qualityGates) {
      const g = gate as Record<string, unknown>;
      if (
        typeof g.name === "string" &&
        typeof g.trigger === "string" &&
        Array.isArray(g.commands) &&
        g.commands.every((c: unknown) => typeof c === "string")
      ) {
        qualityGates.push({
          name: g.name,
          trigger: g.trigger,
          commands: g.commands as string[],
        });
      }
    }
    if (qualityGates.length === 0) qualityGates = undefined;
  }

  const ciWorkflowPath =
    typeof obj.ciWorkflowPath === "string" && obj.ciWorkflowPath.trim().length > 0
      ? obj.ciWorkflowPath.trim()
      : undefined;

  return {
    boardName: (obj.boardName as string).trim(),
    cards,
    qualityGates,
    ciWorkflowPath,
  };
}
