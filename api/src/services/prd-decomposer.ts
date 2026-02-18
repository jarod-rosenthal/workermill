/**
 * PRD Decomposer Service
 *
 * Takes a PRD (Product Requirements Document) text and calls the Anthropic Messages API
 * to decompose it into structured, sized card definitions for a Kanban board.
 *
 * Each card represents a cohesive epic (vertical slice / architectural layer) with
 * 7-12 deliverables, dependency tracking, and persona assignment.
 */

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

export interface DecomposedPrd {
  boardName: string;
  cards: DecomposedCard[];
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are a senior technical program manager who decomposes Product Requirements Documents (PRDs) into implementation cards for AI coding agents.

Each card represents ONE cohesive epic — a vertical slice or architectural layer that a single AI worker can execute independently (given its dependencies are met).

***REMOVED******REMOVED*** Sizing Rules (CRITICAL)

- Target 7-12 deliverables per card. This is the sweet spot for AI worker execution.
- Cards with >15 deliverables MUST be split into smaller cards.
- Cards with <4 deliverables MUST be merged with related work.
- Card 1 is ALWAYS "Project Setup & Dev Environment" — repo scaffolding, tooling, CI skeleton, environment config.
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

***REMOVED******REMOVED*** Priority Assignment

- urgent: Blocking all other work (typically Card 0 — setup)
- high: Core business logic, critical path items
- medium: Important but not blocking — features, integrations
- low: Nice-to-have, polish, documentation

***REMOVED******REMOVED*** Output Format

Respond with ONLY a JSON object (no markdown fences, no explanation):

{
  "boardName": "Short descriptive board name derived from the PRD title",
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

estimatedSteps is the number of deliverables in the card (used for progress tracking).
labels should include relevant technology or domain tags (e.g., "react", "api", "terraform", "auth").`;

// ============================================================================
// ANTHROPIC API TYPES
// ============================================================================

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
}

interface AnthropicContentBlock {
  type: "text";
  text: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicErrorResponse {
  error?: {
    type: string;
    message: string;
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/**
 * Decompose a PRD into structured implementation cards by calling the Anthropic Messages API.
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
  const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!resolvedApiKey) {
    throw new Error(
      "No Anthropic API key provided. Pass apiKey parameter or set ANTHROPIC_API_KEY environment variable.",
    );
  }

  const resolvedModel = model || DEFAULT_MODEL;

  logger.info("Decomposing PRD via Anthropic API", {
    model: resolvedModel,
    prdLength: prdContent.length,
  });

  // Build the request
  const requestBody: AnthropicRequest = {
    model: resolvedModel,
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Decompose this PRD into implementation cards:\n\n${prdContent}`,
      },
    ],
  };

  // Call Anthropic Messages API
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": resolvedApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    logger.error("Failed to connect to Anthropic API", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to connect to Anthropic API: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Handle API errors
  if (!response.ok) {
    let errorMessage = `Anthropic API returned ${response.status} ${response.statusText}`;
    try {
      const errorData = (await response.json()) as AnthropicErrorResponse;
      if (errorData.error?.message) {
        errorMessage = `Anthropic API error: ${errorData.error.message}`;
      }
    } catch {
      // Could not parse error body — use status-based message
    }
    logger.error("Anthropic API error during PRD decomposition", {
      status: response.status,
      errorMessage,
    });
    throw new Error(errorMessage);
  }

  // Parse the API response
  const apiResponse = (await response.json()) as AnthropicResponse;

  if (
    !apiResponse.content ||
    !Array.isArray(apiResponse.content) ||
    apiResponse.content.length === 0
  ) {
    throw new Error("Anthropic API returned empty content");
  }

  const rawText = apiResponse.content[0].text;

  logger.info("Received PRD decomposition response", {
    model: apiResponse.model,
    stopReason: apiResponse.stop_reason,
    inputTokens: apiResponse.usage?.input_tokens,
    outputTokens: apiResponse.usage?.output_tokens,
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
function validateDecomposedPrd(data: unknown): DecomposedPrd {
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

  return {
    boardName: (obj.boardName as string).trim(),
    cards,
  };
}
