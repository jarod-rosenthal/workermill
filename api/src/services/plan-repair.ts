/**
 * Plan Repair & Rewind Service
 *
 * Phase 5 of PRD Pipeline V2: Handles step failure recovery
 *
 * When a step fails, this service:
 * 1. Attempts simple retries (up to 3)
 * 2. Asks the Planner to decide recovery strategy if retries exhausted
 * 3. Supports three recovery modes:
 *    - FIX_FORWARD: Modify the step and retry
 *    - REWIND: Go back to a previous step
 *    - ESCALATE: Human intervention needed
 */

import Anthropic from "@anthropic-ai/sdk";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { logger } from "../utils/logger.js";
import {
  type PlannedStepV2,
  type RecoveryDecision,
  type RecoveryInput,
  type WorkerStepResult,
  REWIND_THRESHOLDS,
  wouldExceedRewindThreshold,
} from "./pipeline-v2-types.js";

// Model to use for recovery decisions
const RECOVERY_MODEL = "claude-sonnet-4-6";

// Repository access helper
const getTaskRepo = () => AppDataSource.getRepository(WorkerTask);

// ============================================================================
// TOOL DEFINITION FOR STRUCTURED RECOVERY OUTPUT
// ============================================================================

/**
 * Tool definition for structured recovery decision output.
 * Using tool_use guarantees valid JSON and prevents parsing errors.
 */
const RECOVERY_DECISION_TOOL: Anthropic.Tool = {
  name: "submit_recovery_decision",
  description:
    "Submit the recovery decision for a failed step. You MUST call this tool with your complete decision.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["FIX_FORWARD", "REWIND", "ESCALATE"],
        description:
          "Recovery action: FIX_FORWARD to modify step and retry, REWIND to go back, ESCALATE for human help.",
      },
      newStep: {
        type: "object",
        description: "Modified step for FIX_FORWARD action only. Must include all PlannedStepV2 fields.",
        properties: {
          index: { type: "number", description: "Step index (keep same as original)" },
          title: { type: "string", description: "Step title (may be modified)" },
          description: {
            type: "string",
            description: "Modified step description with workaround instructions",
          },
          persona: {
            type: "string",
            enum: [
              "frontend_developer",
              "backend_developer",
              "devops_engineer",
              "security_engineer",
              "qa_engineer",
              "tech_writer",
              "project_manager",
            ],
            description: "Persona for this step",
          },
          verificationType: {
            type: "string",
            enum: ["logic", "ui", "docs", "config"],
            description: "How to verify step completion",
          },
          verificationInstructions: { type: "string", description: "Specific verification instructions" },
          targetFiles: {
            type: "array",
            items: { type: "string" },
            description: "Files to create/modify (max 3)",
          },
          referenceFiles: {
            type: "array",
            items: { type: "string" },
            description: "Files to read for context",
          },
          estimatedComplexity: {
            type: "number",
            enum: [1, 2, 3],
            description: "Estimated complexity (1-3)",
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
      targetStepIndex: {
        type: "number",
        description: "For REWIND action: the step index to rewind to.",
      },
      newConstraint: {
        type: "string",
        description: "Lesson learned from this failure. Will be added to context sidecar for future steps.",
      },
      reason: {
        type: "string",
        description: "Explanation of why this recovery strategy was chosen.",
      },
    },
    required: ["action", "reason"],
  },
};

// ============================================================================
// MAIN RECOVERY FUNCTIONS
// ============================================================================

/**
 * Handle a step failure and decide recovery strategy.
 *
 * Called when a worker reports a step failure. Decides whether to:
 * - RETRY_STEP: Simple retry (if retryCount < 3)
 * - RETRY_WITH_MODIFIED_STEP: Retry with modified instructions
 * - REWIND: Go back to a previous step
 * - ESCALATE: Human intervention needed
 *
 * @param task - The worker task
 * @param step - The step that failed
 * @param result - The failure result from the worker
 * @returns Recovery decision
 */
export async function handleStepFailure(
  task: WorkerTask,
  step: PlannedStepV2,
  result: WorkerStepResult,
): Promise<RecoveryDecision> {
  const taskId = task.id;
  const retryCount = task.currentStepRetryCount;

  logger.info("Handling step failure", {
    taskId,
    stepIndex: step.index,
    stepTitle: step.title,
    retryCount,
    status: result.status,
  });

  // Simple retry if under threshold
  if (retryCount < REWIND_THRESHOLDS.maxRetriesPerStep) {
    logger.info("Step failure: will retry", {
      taskId,
      stepIndex: step.index,
      retryCount,
      maxRetries: REWIND_THRESHOLDS.maxRetriesPerStep,
    });

    return {
      action: "RETRY_STEP",
      reason: `Retry attempt ${retryCount + 1} of ${REWIND_THRESHOLDS.maxRetriesPerStep}`,
    };
  }

  // Retries exhausted - ask Planner for recovery decision
  logger.info("Step failure: retries exhausted, consulting planner", {
    taskId,
    stepIndex: step.index,
    retryCount,
  });

  const recoveryInput: RecoveryInput = {
    errorLogs: formatErrorForPlanner(result),
    currentStep: step,
    commitHistory: task.commitHistory || [],
    contextSidecar: task.contextSidecar || [],
    currentStepRetryCount: retryCount,
  };

  const plannerDecision = await plannerDecideRecovery(recoveryInput);

  // Handle REWIND threshold check
  if (plannerDecision.action === "REWIND") {
    const targetStepIndex = plannerDecision.targetStepIndex ?? 0;
    const totalSteps = task.executionPlanV2?.steps?.length ?? 0;

    if (wouldExceedRewindThreshold(task.currentStepIndex, targetStepIndex, totalSteps)) {
      logger.warn("Rewind would exceed threshold, escalating", {
        taskId,
        currentStep: task.currentStepIndex,
        targetStep: targetStepIndex,
        totalSteps,
      });

      return {
        action: "ESCALATE",
        reason: `Planner suggested rewind from step ${task.currentStepIndex} to step ${targetStepIndex}, but this exceeds rewind thresholds (max ${REWIND_THRESHOLDS.maxStepsToRewind} steps or ${REWIND_THRESHOLDS.maxPercentageToRewind * 100}% of progress). Human intervention required.`,
        newConstraint: plannerDecision.newConstraint,
      };
    }

    // Find commit hash for target step
    const targetCommit = task.commitHistory?.find((c) => c.stepIndex === targetStepIndex);

    return {
      action: "REWIND",
      targetStepIndex,
      targetCommitHash: targetCommit?.commitHash,
      newConstraint: plannerDecision.newConstraint,
      reason: plannerDecision.reason,
    };
  }

  // Handle RETRY_WITH_MODIFIED_STEP (mapped from FIX_FORWARD by planner)
  if (plannerDecision.action === "RETRY_WITH_MODIFIED_STEP" && plannerDecision.modifiedStep) {
    return plannerDecision;
  }

  // Default: ESCALATE
  return {
    action: "ESCALATE",
    reason: plannerDecision.reason || "Recovery strategy could not be determined",
    newConstraint: plannerDecision.newConstraint,
  };
}

/**
 * Ask the Planner (Claude) to decide the recovery strategy.
 *
 * Analyzes the error context and decides between:
 * - FIX_FORWARD: Modify the step instructions
 * - REWIND: Go back to a previous step
 * - ESCALATE: Human intervention needed
 *
 * @param input - Recovery input with error context
 * @returns Recovery decision from the Planner
 */
export async function plannerDecideRecovery(input: RecoveryInput): Promise<RecoveryDecision> {
  const { errorLogs, currentStep, commitHistory, contextSidecar, currentStepRetryCount } = input;

  // Format commit history for the prompt
  const commitHistoryStr =
    commitHistory.length > 0
      ? commitHistory
          .map((c) => `  Step ${c.stepIndex}: ${c.commitHash.slice(0, 7)} (${c.persona}, ${c.committedAt})`)
          .join("\n")
      : "  (no commits yet)";

  // Format context sidecar for the prompt
  const constraintsStr =
    contextSidecar.length > 0 ? contextSidecar.map((c) => `  - ${c}`).join("\n") : "  (none learned yet)";

  const prompt = `You are a recovery specialist for an AI coding pipeline. A step has failed repeatedly (${currentStepRetryCount} retries).

ERROR LOGS:
${errorLogs}

FAILED STEP:
  Index: ${currentStep.index}
  Title: ${currentStep.title}
  Description: ${currentStep.description}
  Persona: ${currentStep.persona}
  Verification: ${currentStep.verificationType}
  Target Files: ${currentStep.targetFiles.join(", ")}

COMMIT HISTORY:
${commitHistoryStr}

LEARNED CONSTRAINTS:
${constraintsStr}

Decide the recovery strategy:

1. FIX_FORWARD: Modify the step instructions to work around the issue
   - Use when the error is a minor issue that can be fixed by changing approach
   - Provide a modified step with clearer instructions or alternative approach
   - Example: Import error -> change import path or use different module

2. REWIND: Go back to a previous step and try a different approach
   - Use when the current step's foundation is broken
   - Target the step that introduced the problematic pattern
   - Maximum rewind: 2 steps back or 20% of progress

3. ESCALATE: This needs human intervention
   - Use when the error requires decisions outside the AI's scope
   - Use when the error is related to external systems (credentials, permissions)
   - Use when multiple approaches have failed

IMPORTANT:
- Always add a newConstraint to capture the lesson learned
- For FIX_FORWARD, provide a complete modified step with all required fields
- For REWIND, specify which step index to rewind to

Call the submit_recovery_decision tool with your decision.`;

  const anthropic = new Anthropic();

  try {
    const response = await anthropic.messages.create({
      model: RECOVERY_MODEL,
      max_tokens: 4096,
      tools: [RECOVERY_DECISION_TOOL],
      tool_choice: { type: "tool", name: "submit_recovery_decision" },
      messages: [{ role: "user", content: prompt }],
    });

    // Extract tool_use response
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Planner did not return tool_use response for recovery decision");
    }

    const decision = toolUse.input as {
      action: "FIX_FORWARD" | "REWIND" | "ESCALATE";
      newStep?: PlannedStepV2;
      targetStepIndex?: number;
      newConstraint?: string;
      reason: string;
    };

    logger.info("Planner recovery decision", {
      action: decision.action,
      reason: decision.reason,
      hasNewStep: !!decision.newStep,
      targetStepIndex: decision.targetStepIndex,
      newConstraint: decision.newConstraint,
    });

    // Map to RecoveryDecision format
    if (decision.action === "FIX_FORWARD") {
      return {
        action: "RETRY_WITH_MODIFIED_STEP",
        modifiedStep: decision.newStep,
        newConstraint: decision.newConstraint,
        reason: decision.reason,
      };
    }

    if (decision.action === "REWIND") {
      return {
        action: "REWIND",
        targetStepIndex: decision.targetStepIndex,
        newConstraint: decision.newConstraint,
        reason: decision.reason,
      };
    }

    // ESCALATE
    return {
      action: "ESCALATE",
      newConstraint: decision.newConstraint,
      reason: decision.reason,
    };
  } catch (error) {
    logger.error("Error getting planner recovery decision", {
      error: error instanceof Error ? error.message : String(error),
    });

    // On error, escalate to human
    return {
      action: "ESCALATE",
      reason: `Failed to get recovery decision from planner: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// CONTEXT SIDECAR MANAGEMENT
// ============================================================================

/**
 * Add a learned constraint to the task's context sidecar.
 *
 * Constraints persist across rewinds and help avoid repeating mistakes.
 *
 * @param taskId - The task ID
 * @param constraint - The constraint to add
 */
export async function addConstraint(taskId: string, constraint: string): Promise<void> {
  const taskRepo = getTaskRepo();

  const task = await taskRepo.findOne({ where: { id: taskId } });
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Use the model's addConstraint method (handles deduplication)
  task.addConstraint(constraint);

  await taskRepo.save(task);

  logger.info("Added constraint to context sidecar", {
    taskId,
    constraint,
    totalConstraints: task.contextSidecar.length,
  });
}

// ============================================================================
// REWIND OPERATIONS
// ============================================================================

/**
 * Apply a rewind to return to a previous step.
 *
 * Updates task state in the database. The actual git reset
 * happens in the worker when it processes the rewind instruction.
 *
 * @param task - The worker task
 * @param targetStepIndex - The step index to rewind to
 */
export async function applyRewind(task: WorkerTask, targetStepIndex: number): Promise<void> {
  const taskRepo = getTaskRepo();

  const previousIndex = task.currentStepIndex;

  // Update task state
  task.currentStepIndex = targetStepIndex;
  task.currentStepRetryCount = 0; // Reset retry count for the rewound step

  // Note: contextSidecar is NOT cleared - constraints persist across rewinds
  // Note: commitHistory is NOT cleared - we keep record of all commits

  await taskRepo.save(task);

  logger.info("Applied rewind", {
    taskId: task.id,
    previousStepIndex: previousIndex,
    newStepIndex: targetStepIndex,
    constraintsPreserved: task.contextSidecar.length,
  });
}

/**
 * Get the commit hash to reset to for a rewind operation.
 *
 * @param task - The worker task
 * @param targetStepIndex - The step index to rewind to
 * @returns The commit hash to reset to, or undefined if not found
 */
export function getRewindCommitHash(task: WorkerTask, targetStepIndex: number): string | undefined {
  // If rewinding to step 0, there's no previous commit to reset to
  if (targetStepIndex === 0) {
    return undefined; // Will need to start fresh or use initial commit
  }

  // Find the commit for the step before the target
  // (we want to reset to the state AFTER step targetStepIndex-1 completed)
  const commit = task.commitHistory?.find((c) => c.stepIndex === targetStepIndex - 1);
  return commit?.commitHash;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format error information for the Planner prompt.
 *
 * @param result - The worker step result containing error info
 * @returns Formatted error string for the prompt
 */
export function formatErrorForPlanner(result: WorkerStepResult): string {
  const parts: string[] = [];

  if (result.errorMessage) {
    parts.push(`Error Message: ${result.errorMessage}`);
  }

  if (result.logs) {
    // Extract last 100 lines of logs (most relevant for error diagnosis)
    const logLines = result.logs.split("\n");
    const lastLines = logLines.slice(-100).join("\n");
    parts.push(`Last 100 lines of logs:\n${lastLines}`);
  }

  if (result.suggestedConstraints && result.suggestedConstraints.length > 0) {
    parts.push(`Worker suggested constraints:\n${result.suggestedConstraints.map((c) => `  - ${c}`).join("\n")}`);
  }

  if (result.rewindSuggestion !== undefined) {
    parts.push(`Worker suggested rewind to step: ${result.rewindSuggestion}`);
  }

  return parts.join("\n\n") || "No error details available";
}

/**
 * Check if the task can attempt another recovery cycle.
 *
 * @param task - The worker task
 * @returns True if more recovery attempts are allowed
 */
export function canAttemptRecovery(task: WorkerTask): boolean {
  // Check if we've already escalated
  if (task.status === "escalated") {
    return false;
  }

  // Check total retries across all steps (prevent infinite recovery loops)
  const totalRetries = task.retryCount;
  const maxTotalRetries = task.maxRetries * 2; // Allow 2x the normal retry limit for recovery

  return totalRetries < maxTotalRetries;
}

/**
 * Record a recovery attempt in task metadata.
 *
 * @param task - The worker task
 * @param decision - The recovery decision taken
 */
export async function recordRecoveryAttempt(task: WorkerTask, decision: RecoveryDecision): Promise<void> {
  const taskRepo = getTaskRepo();

  // Increment retry count to track total recovery attempts
  task.retryCount += 1;

  // Add constraint if provided
  if (decision.newConstraint) {
    task.addConstraint(decision.newConstraint);
  }

  await taskRepo.save(task);

  logger.info("Recorded recovery attempt", {
    taskId: task.id,
    action: decision.action,
    totalRetries: task.retryCount,
    constraints: task.contextSidecar.length,
  });
}
