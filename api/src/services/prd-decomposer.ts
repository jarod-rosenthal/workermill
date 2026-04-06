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
import {
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_WITH_STORIES,
} from "./prd-prompts.js";

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

// Shared, platform-source prompts used by API and CLI.
export { SYSTEM_PROMPT, SYSTEM_PROMPT_WITH_STORIES };

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
 * Always used for PRD builds.
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
    "architect",
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

    // stories: pre-computed story breakdown from decomposition
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
          commands: (g.commands as string[]).map((c) =>
            c.replace(/^(?:source|\.) +['"]?\$HOME\/\.local\/bin\/env['"]? *&& */i, "")
          ),
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

// ============================================================================
// PRD CONDENSATION
// ============================================================================

const CONDENSE_SYSTEM_PROMPT = `You are a technical editor. Your job is to condense a Product Requirements Document (PRD) to be as short as possible WITHOUT losing any actionable specifications.

Rules:
- KEEP ALL: constraints, code examples, API signatures, database schemas, acceptance criteria, quality gates, test setup, config files, data tables, type definitions, exact commands, file paths, dependency graphs, security requirements
- REMOVE: redundant explanations that repeat the same point, verbose prose that can be bullet points, "why" explanations that don't prevent mistakes, filler words, unnecessary transitions
- COMPRESS: combine related paragraphs into concise bullets, collapse wordy descriptions into single sentences
- DO NOT add any new content, commentary, or opinions
- DO NOT change the meaning of any requirement
- DO NOT remove code blocks, JSON examples, or technical specifications
- Output the condensed PRD in markdown format, preserving all headings and structure

Target: reduce length by 25-40% while preserving 100% of actionable content.`;

/**
 * Condense a PRD to reduce token usage when it's sent to workers.
 * Uses a fast model (Haiku) to keep cost and latency low.
 * Returns the condensed text, or the original if condensation fails.
 */
export async function condensePrd(
  prdContent: string,
  apiKey?: string,
  oauthToken?: string,
): Promise<string> {
  // Only condense if the PRD is long enough to benefit
  if (prdContent.length < 10_000) {
    return prdContent;
  }

  const clientOptions: Record<string, unknown> = {};
  if (oauthToken) {
    clientOptions.authToken = oauthToken;
  } else {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return prdContent;
    clientOptions.apiKey = key;
  }

  try {
    const client = new Anthropic(clientOptions as ConstructorParameters<typeof Anthropic>[0]);
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system: CONDENSE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Condense this PRD:\n\n${prdContent}`,
        },
      ],
    });

    const condensed = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    if (!condensed || condensed.length < prdContent.length * 0.3) {
      // Condensation removed too much — keep original
      logger.warn("[PRD] Condensation removed >70% of content, keeping original");
      return prdContent;
    }

    const reduction = Math.round((1 - condensed.length / prdContent.length) * 100);
    logger.info(`[PRD] Condensed PRD: ${prdContent.length} -> ${condensed.length} chars (${reduction}% reduction)`);
    return condensed;
  } catch (err) {
    logger.warn(`[PRD] Condensation failed, keeping original: ${err instanceof Error ? err.message : err}`);
    return prdContent;
  }
}
