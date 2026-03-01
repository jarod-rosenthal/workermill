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

// ============================================================================
// TYPES
// ============================================================================

export interface DecomposedCard {
  title: string;
  description: string;
  persona: string;
  priority: "urgent" | "high" | "medium" | "low";
  dependencyIndices: number[];
  labels: string[];
  estimatedSteps: number;
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

Each card represents ONE cohesive epic — a vertical slice or architectural layer that a single AI worker can execute independently (given its dependencies are met).

***REMOVED******REMOVED*** Sizing Rules (CRITICAL)

- Target 7-12 deliverables per card. This is the sweet spot for AI worker execution.
- Cards with >15 deliverables MUST be split into smaller cards.
- Cards with <4 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Project Setup & Dev Environment" — repo scaffolding, tooling, environment config.
- Card 2 is ALWAYS "CI/CD Pipeline & Quality Gates" — the FULL CI pipeline (lint, typecheck, test, build) must be created and verified green BEFORE any feature work begins. This card must include a trivial passing test so CI actually runs. Assigned to devops_engineer. ALL subsequent feature cards MUST depend on this card (directly or transitively).
- The LAST card is ALWAYS "Production Deploy & Validation" — deployment pipeline, smoke tests, monitoring, go-live checklist.

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
- Card 0 (Project Setup) has no dependencies (empty array)
- The last card (Production Deploy) typically depends on all or most preceding cards

***REMOVED******REMOVED*** CI/CD Is a First-Class Citizen

The CI/CD card (Card 2) is NOT a nice-to-have. It is the quality gate that proves code works. Every AI can generate code — the CI pipeline proves it compiles, passes lint, passes tests, and builds.

Card 2 deliverables MUST include:
1. CI workflow file (e.g., .github/workflows/ci.yml) with ALL quality steps (lint, typecheck, test, build)
2. A trivial passing test file so the test step succeeds on first run
3. Verification that the pipeline actually runs and passes (acceptance criterion, not just "file exists")
4. CI workflow triggers MUST include BOTH \`push: [main]\` AND \`pull_request: [main]\` events. Without \`pull_request\` triggers, CI won't run on PRs and code merges without verification.

CI workflow steps MUST run the EXACT SAME commands as the quality gates — no additions, no differences. This is critical: if the quality gate runs "go vet ./..." and "go test ./... -v -count=1 -race", the CI workflow MUST run those same commands, NOT golangci-lint or any other tool. The quality gates are the single source of truth for what "passing" means. Any divergence between the quality gates and CI creates a gap where code passes one but fails the other.

For Go CI: use "go vet ./...", "go test ./... -v -count=1 -race", "go build -o /dev/null ./cmd/server" (NOT golangci-lint, staticcheck, or other third-party linters). For Node.js CI: use "npm run lint", "npm run test", "npm run build". For TypeScript projects (tsconfig.json present): add "npx tsc --noEmit" to quality gates. For SvelteKit projects (svelte.config.js present): use "npx svelte-check" instead of bare tsc. For Python CI: use "python -m pytest", "python -m mypy .". Do NOT add third-party tools to CI that aren't already in the repo.

ALL feature cards (Card 3+) MUST have Card 2 in their transitive dependency chain.

***REMOVED******REMOVED*** Priority Assignment

- urgent: Blocking all other work (Card 0 — setup, Card 1 — CI/CD pipeline)
- high: Core business logic, critical path items
- medium: Important but not blocking — features, integrations
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

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
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
  } catch (error) {
    logger.error("Anthropic SDK error during PRD decomposition", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `PRD decomposition failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.content || response.content.length === 0) {
    throw new Error("Anthropic API returned empty content");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic API returned no text content");
  }

  const rawText = textBlock.text;

  logger.info("Received PRD decomposition response", {
    model: response.model,
    stopReason: response.stop_reason,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    responseLength: rawText.length,
  });

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

    cards.push({
      title: raw.title.trim(),
      description: raw.description.trim(),
      persona,
      priority,
      dependencyIndices,
      labels,
      estimatedSteps,
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
