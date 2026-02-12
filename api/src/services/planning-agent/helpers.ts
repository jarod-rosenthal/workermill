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
 * Parse JSON from LLM response text, handling markdown code blocks
 */
export function parseJsonResponse<T>(text: string): T {
  let jsonText = text.trim();
  // Handle markdown code blocks
  if (jsonText.startsWith("```")) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonText = match[1].trim();
  }
  return JSON.parse(jsonText) as T;
}

/**
 * Parse execution plan JSON from LLM text response.
 * Handles markdown code blocks and validates structure.
 */
export function parseExecutionPlanJson(text: string): ExecutionPlan {
  let jsonText = text.trim();

  // Extract JSON from markdown code blocks if present
  if (jsonText.startsWith("```")) {
    const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonText = match[1].trim();
  }

  // Also handle case where response has text before/after JSON
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) jsonText = jsonMatch[0];

  try {
    return JSON.parse(jsonText) as ExecutionPlan;
  } catch (error) {
    logger.error("Failed to parse execution plan JSON", {
      error: error instanceof Error ? error.message : String(error),
      textPreview: text.slice(0, 500),
    });
    throw new Error(`Failed to parse execution plan: ${error instanceof Error ? error.message : String(error)}`);
  }
}
