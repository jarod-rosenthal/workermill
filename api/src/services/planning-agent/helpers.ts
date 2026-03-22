/**
 * Planning Agent Helpers
 *
 * Shared utility functions used across the planning agent sub-modules.
 */

import { Organization } from "../../models/Organization.js";
import { WorkerTaskLog } from "../../models/WorkerTaskLog.js";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";
import { getScmProvider, type CodebaseContext } from "../../scm-providers/index.js";
import type { ExecutionPlan } from "./types.js";

/**
 * Helper to fetch codebase context using the org's SCM provider.
 * Falls back to GitHub if org lookup fails.
 */
export async function fetchCodebaseContextForTask(
  repo: string,
  orgId: string,
  branch?: string
): Promise<CodebaseContext> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  // Get SCM provider (defaults to GitHub if org not found)
  const scmProvider = org
    ? getScmProvider(org)
    : getScmProvider({ id: orgId }); // Fallback to default (GitHub)

  const repoId = scmProvider.parseRepoIdentifier(repo);
  return scmProvider.fetchCodebaseContext(repoId, branch);
}

/**
 * Helper to add a log entry visible in the dashboard
 */
export async function addPlanningLog(taskId: string, message: string): Promise<void> {
  try {
    const logRepo = AppDataSource.getRepository(WorkerTaskLog);
    const log = logRepo.create({
      taskId,
      type: "system" as const,  // Planning logs use system type
      message,
      severity: "info" as const,
    });
    await logRepo.save(log);
  } catch (error) {
    logger.error("Failed to save planning log", { error, taskId });
  }
}

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
 * Parse JSON from LLM response text, handling markdown code blocks.
 * Uses bracket-matching instead of lazy regex to handle backticks in reasoning text.
 */
export function parseJsonResponse<T>(text: string): T {
  // Strategy 1: Find ```json fence and extract balanced JSON
  const jsonFenceStart = text.indexOf("```json");
  if (jsonFenceStart !== -1) {
    const braceStart = text.indexOf("{", jsonFenceStart + 7);
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(text, braceStart);
      if (extracted) return JSON.parse(extracted) as T;
    }
  }

  // Strategy 2: Find raw JSON from first {
  const braceStart = text.indexOf("{");
  if (braceStart !== -1) {
    const extracted = extractBalancedJson(text, braceStart);
    if (extracted) return JSON.parse(extracted) as T;
  }

  throw new Error("No JSON found in response");
}

/**
 * Parse execution plan JSON from LLM text response.
 * Uses bracket-matching instead of lazy regex to handle backticks in reasoning text.
 */
export function parseExecutionPlanJson(text: string): ExecutionPlan {
  // Strip <think>...</think> reasoning blocks (qwen3-coder, DeepSeek R1, etc.)
  // These contain { } characters that confuse brace-matching.
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const cleanText = stripped.length > 0 ? stripped : text;

  try {
    // Strategy 1: Find ```json fence and extract balanced JSON
    const jsonFenceStart = cleanText.indexOf("```json");
    if (jsonFenceStart !== -1) {
      const braceStart = cleanText.indexOf("{", jsonFenceStart + 7);
      if (braceStart !== -1) {
        const extracted = extractBalancedJson(cleanText, braceStart);
        if (extracted) return JSON.parse(extracted) as ExecutionPlan;
      }
    }

    // Strategy 2: Find raw JSON from first {
    const braceStart = cleanText.indexOf("{");
    if (braceStart !== -1) {
      const extracted = extractBalancedJson(cleanText, braceStart);
      if (extracted) return JSON.parse(extracted) as ExecutionPlan;
    }

    throw new Error("No JSON found in plan response");
  } catch (error) {
    logger.error("Failed to parse execution plan JSON", {
      error: error instanceof Error ? error.message : String(error),
      textPreview: text.slice(0, 500),
    });
    throw new Error(`Failed to parse execution plan: ${error instanceof Error ? error.message : String(error)}`);
  }
}
