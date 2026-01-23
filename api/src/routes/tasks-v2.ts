/**
 * V2 Worker API Endpoints - Vertical Slice Sequential Execution
 *
 * These endpoints support the V2 pipeline where workers execute atomic steps
 * sequentially, using git commit history as the state machine.
 *
 * Key features:
 * - Step-by-step execution with verification
 * - Context sidecar for accumulated constraints
 * - Smart rewind on failure with commit history
 * - Plan repair and recovery decisions
 *
 * Triggered by `prd-v2` Jira label for opt-in gradual rollout.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/index.js";
import { authenticateApiKey, authenticateRequest } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { body, param, validateRequest } from "../middleware/validation.js";
import {
  WorkerStepInput,
  StepCommit,
  calculateProgress,
  REWIND_THRESHOLDS,
} from "../services/pipeline-v2-types.js";

const router = Router();

/**
 * GET /api/tasks-v2/:taskId/next-step
 *
 * Get the next step to execute for a V2 pipeline task.
 * Workers call this to receive their step input including context sidecar.
 *
 * Auth: Org API key (x-api-key header)
 *
 * Response:
 * - step: The PlannedStepV2 to execute
 * - contextSidecar: Accumulated constraints from previous failures
 * - previousCommitHash: Commit to restore to (for rewind)
 * - repoState: 'fresh' | 'continue' | 'rewind'
 * - fullPlan: Complete execution plan for context
 * - currentStepIndex: Current position in pipeline
 * - totalSteps: Total number of steps
 */
router.get(
  "/:taskId/next-step",
  authenticateApiKey,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Verify this is a V2 pipeline task
      if (!task.isV2Pipeline()) {
        res.status(400).json({
          error: "Task is not using V2 pipeline",
          pipelineVersion: task.pipelineVersion || "v1",
        });
        return;
      }

      // Verify task has an execution plan
      if (!task.executionPlanV2) {
        res.status(400).json({
          error: "Task has no V2 execution plan",
          suggestion: "Generate plan first via /plan/generate-v2",
        });
        return;
      }

      const plan = task.executionPlanV2;
      const totalSteps = plan.steps.length;

      // Check if all steps are complete
      if (task.currentStepIndex >= totalSteps) {
        res.status(400).json({
          error: "All steps completed",
          currentStepIndex: task.currentStepIndex,
          totalSteps,
          message: "Pipeline execution complete",
        });
        return;
      }

      // Get the current step
      const currentStep = plan.steps[task.currentStepIndex];

      if (!currentStep) {
        res.status(500).json({
          error: "Current step not found in plan",
          currentStepIndex: task.currentStepIndex,
          availableSteps: plan.steps.length,
        });
        return;
      }

      // Determine repo state based on commit history and retry count
      let repoState: "fresh" | "continue" | "rewind" = "continue";
      let previousCommitHash: string | undefined;

      if (task.currentStepIndex === 0 && task.commitHistory.length === 0) {
        // First step, no commits yet
        repoState = "fresh";
      } else if (task.currentStepRetryCount > 0) {
        // Retrying a step - may need to rewind to previous commit
        const previousStepCommit = task.getCommitForStep(task.currentStepIndex - 1);
        if (previousStepCommit) {
          repoState = "rewind";
          previousCommitHash = previousStepCommit;
        }
      }

      // Build the step input
      const stepInput: WorkerStepInput = {
        step: currentStep,
        contextSidecar: task.contextSidecar || [],
        previousCommitHash,
        repoState,
        fullPlan: plan,
        currentStepIndex: task.currentStepIndex,
        totalSteps,
      };

      logger.info("V2 next-step requested", {
        taskId,
        stepIndex: task.currentStepIndex,
        stepTitle: currentStep.title,
        persona: currentStep.persona,
        repoState,
        contextSidecarLength: task.contextSidecar?.length || 0,
      });

      res.json(stepInput);
    } catch (error) {
      logger.error("Error getting next step", { error, taskId: req.params.taskId });
      res.status(500).json({ error: "Failed to get next step" });
    }
  }
);

/**
 * POST /api/tasks-v2/:taskId/step-complete
 *
 * Called by worker when a step completes successfully.
 * Records the commit and advances to the next step.
 *
 * Auth: Org API key (x-api-key header)
 *
 * Body:
 * - commitHash: Git commit hash for the completed step
 * - logs?: Execution logs
 * - suggestedConstraints?: New constraints learned during execution
 * - tokenUsage?: Token counts for cost tracking
 *
 * Response:
 * - success: true
 * - nextStep?: Next PlannedStepV2 if more steps remain
 * - complete: boolean indicating if pipeline is done
 */
router.post(
  "/:taskId/step-complete",
  authenticateApiKey,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("commitHash").isString().notEmpty().withMessage("commitHash is required"),
  body("logs").optional().isString(),
  body("suggestedConstraints").optional().isArray(),
  body("suggestedConstraints.*").optional().isString(),
  body("tokenUsage").optional().isObject(),
  body("tokenUsage.inputTokens").optional().isInt({ min: 0 }),
  body("tokenUsage.outputTokens").optional().isInt({ min: 0 }),
  body("tokenUsage.cacheReadTokens").optional().isInt({ min: 0 }),
  body("tokenUsage.cacheCreationTokens").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;
      const {
        commitHash,
        logs: _logs, // Reserved for future logging storage
        suggestedConstraints,
        tokenUsage,
      } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.isV2Pipeline() || !task.executionPlanV2) {
        res.status(400).json({ error: "Task is not a V2 pipeline task" });
        return;
      }

      const plan = task.executionPlanV2;
      const currentStep = plan.steps[task.currentStepIndex];

      if (!currentStep) {
        res.status(400).json({ error: "No current step to complete" });
        return;
      }

      // Record the commit in history
      const stepCommit: StepCommit = {
        stepIndex: task.currentStepIndex,
        commitHash,
        persona: currentStep.persona,
        committedAt: new Date().toISOString(),
        durationMs: undefined, // Could track if startedAt is available per step
      };

      // Ensure commitHistory is an array
      if (!Array.isArray(task.commitHistory)) {
        task.commitHistory = [];
      }
      task.commitHistory.push(stepCommit);

      // Add any suggested constraints to the context sidecar
      if (suggestedConstraints && Array.isArray(suggestedConstraints)) {
        for (const constraint of suggestedConstraints) {
          task.addConstraint(constraint);
        }
      }

      // Advance to the next step
      const previousStepIndex = task.currentStepIndex;
      task.currentStepIndex += 1;
      task.currentStepRetryCount = 0; // Reset retry count for new step

      // Update token usage if provided
      if (tokenUsage) {
        task.inputTokens = (task.inputTokens || 0) + (tokenUsage.inputTokens || 0);
        task.outputTokens = (task.outputTokens || 0) + (tokenUsage.outputTokens || 0);
        task.cacheReadTokens = (task.cacheReadTokens || 0) + (tokenUsage.cacheReadTokens || 0);
        task.cacheCreationTokens = (task.cacheCreationTokens || 0) + (tokenUsage.cacheCreationTokens || 0);
        task.estimatedCostUsd = task.calculateCost();
      }

      // Check if pipeline is complete
      const isComplete = task.currentStepIndex >= plan.steps.length;

      if (isComplete) {
        task.status = "completed";
        task.completedAt = new Date();
        logger.info("V2 pipeline completed", {
          taskId,
          totalSteps: plan.steps.length,
          totalCommits: task.commitHistory.length,
        });
      }

      await taskRepo.save(task);

      // Get next step if not complete
      const nextStep = !isComplete ? plan.steps[task.currentStepIndex] : undefined;

      logger.info("V2 step completed", {
        taskId,
        completedStepIndex: previousStepIndex,
        completedStepTitle: currentStep.title,
        commitHash,
        nextStepIndex: task.currentStepIndex,
        isComplete,
      });

      res.json({
        success: true,
        nextStep,
        complete: isComplete,
        currentStepIndex: task.currentStepIndex,
        totalSteps: plan.steps.length,
        progress: calculateProgress(task.currentStepIndex, plan.steps.length),
      });
    } catch (error) {
      logger.error("Error completing step", { error, taskId: req.params.taskId });
      res.status(500).json({ error: "Failed to complete step" });
    }
  }
);

/**
 * POST /api/tasks-v2/:taskId/step-failed
 *
 * Called by worker when a step fails execution.
 * Handles retry logic and recovery decisions.
 *
 * Auth: Org API key (x-api-key header)
 *
 * Body:
 * - errorMessage: Description of what failed
 * - logs?: Execution logs for debugging
 * - suggestedConstraints?: New constraints learned from the failure
 * - rewindSuggestion?: Step index to rewind to (0-based)
 *
 * Response:
 * - action: 'RETRY' | 'NEEDS_RECOVERY'
 * - retryCount: Current retry count for this step
 * - message?: Additional context
 */
router.post(
  "/:taskId/step-failed",
  authenticateApiKey,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("errorMessage").isString().notEmpty().withMessage("errorMessage is required"),
  body("logs").optional().isString(),
  body("suggestedConstraints").optional().isArray(),
  body("suggestedConstraints.*").optional().isString(),
  body("rewindSuggestion").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;
      const {
        errorMessage,
        logs: _logs, // Reserved for future logging storage
        suggestedConstraints,
        rewindSuggestion,
      } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.isV2Pipeline() || !task.executionPlanV2) {
        res.status(400).json({ error: "Task is not a V2 pipeline task" });
        return;
      }

      // Increment retry count
      task.currentStepRetryCount += 1;

      // Add suggested constraints to context sidecar
      if (suggestedConstraints && Array.isArray(suggestedConstraints)) {
        for (const constraint of suggestedConstraints) {
          task.addConstraint(constraint);
        }
      }

      // Also add error message as a constraint for future reference
      task.addConstraint(`Step ${task.currentStepIndex} failed: ${errorMessage}`);

      // Store the error message
      task.errorMessage = errorMessage;

      // Determine action based on retry count and thresholds
      let action: "RETRY" | "NEEDS_RECOVERY";
      let message: string;

      if (task.currentStepRetryCount >= REWIND_THRESHOLDS.maxRetriesPerStep) {
        // Max retries exceeded - needs human/planner intervention
        action = "NEEDS_RECOVERY";
        task.status = "escalated";
        message = `Step ${task.currentStepIndex} failed ${task.currentStepRetryCount} times. Needs recovery decision.`;

        if (rewindSuggestion !== undefined) {
          message += ` Worker suggested rewinding to step ${rewindSuggestion}.`;
        }

        logger.warn("V2 step exceeded max retries", {
          taskId,
          stepIndex: task.currentStepIndex,
          retryCount: task.currentStepRetryCount,
          rewindSuggestion,
        });
      } else {
        // Can still retry
        action = "RETRY";
        message = `Retry ${task.currentStepRetryCount}/${REWIND_THRESHOLDS.maxRetriesPerStep}. Context sidecar updated with failure info.`;

        logger.info("V2 step failed, will retry", {
          taskId,
          stepIndex: task.currentStepIndex,
          retryCount: task.currentStepRetryCount,
          constraintsAdded: suggestedConstraints?.length || 0,
        });
      }

      await taskRepo.save(task);

      res.json({
        action,
        retryCount: task.currentStepRetryCount,
        maxRetries: REWIND_THRESHOLDS.maxRetriesPerStep,
        message,
        contextSidecarLength: task.contextSidecar?.length || 0,
      });
    } catch (error) {
      logger.error("Error recording step failure", { error, taskId: req.params.taskId });
      res.status(500).json({ error: "Failed to record step failure" });
    }
  }
);

/**
 * GET /api/tasks-v2/:taskId/pipeline-status
 *
 * Get the current status of a V2 pipeline task.
 * Available to both authenticated users and API keys.
 *
 * Auth: Bearer token or API key
 *
 * Response:
 * - pipelineVersion: 'v1' | 'v2'
 * - currentStepIndex: Current step position
 * - totalSteps: Total number of steps
 * - progress: Percentage complete (0-100)
 * - status: Task status
 * - currentStep?: Current step details (if not complete)
 * - commitHistory: Array of completed step commits
 * - contextSidecar: Accumulated constraints
 * - plan?: Execution plan summary
 */
router.get(
  "/:taskId/pipeline-status",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Base response for non-V2 tasks
      if (!task.isV2Pipeline()) {
        res.json({
          pipelineVersion: task.pipelineVersion || "v1",
          status: task.status,
          message: "Task is not using V2 pipeline",
          isV2: false,
        });
        return;
      }

      const plan = task.executionPlanV2;
      const totalSteps = plan?.steps?.length || 0;
      const currentStep = plan?.steps?.[task.currentStepIndex];

      res.json({
        pipelineVersion: task.pipelineVersion,
        isV2: true,
        status: task.status,

        // Progress tracking
        currentStepIndex: task.currentStepIndex,
        totalSteps,
        progress: calculateProgress(task.currentStepIndex, totalSteps),

        // Current step info (if not complete)
        currentStep: currentStep ? {
          index: currentStep.index,
          title: currentStep.title,
          persona: currentStep.persona,
          verificationType: currentStep.verificationType,
          targetFiles: currentStep.targetFiles,
        } : null,

        // Retry info
        currentStepRetryCount: task.currentStepRetryCount,
        maxStepRetries: REWIND_THRESHOLDS.maxRetriesPerStep,

        // History and context
        commitHistory: task.commitHistory || [],
        contextSidecar: task.contextSidecar || [],

        // Plan summary
        plan: plan ? {
          architecturalSummary: plan.architecturalSummary,
          techStack: plan.techStack,
          stepCount: plan.steps.length,
          criticScore: plan.criticScore,
          criticRisks: plan.criticRisks,
        } : null,

        // Task metadata
        jiraIssueKey: task.jiraIssueKey,
        summary: task.summary,
        githubRepo: task.githubRepo,
        githubBranch: task.githubBranch,
        estimatedCostUsd: task.estimatedCostUsd,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      });
    } catch (error) {
      logger.error("Error getting pipeline status", { error, taskId: req.params.taskId });
      res.status(500).json({ error: "Failed to get pipeline status" });
    }
  }
);

/**
 * POST /api/tasks-v2/:taskId/rewind
 *
 * Manually trigger a rewind to a specific step.
 * Used for recovery when automatic retries fail.
 *
 * Auth: Bearer token (admin) or API key
 *
 * Body:
 * - targetStepIndex: Step index to rewind to (0-based)
 * - reason?: Reason for the rewind
 * - newConstraints?: Additional constraints to add
 */
router.post(
  "/:taskId/rewind",
  authenticateRequest,
  param("taskId").isUUID().withMessage("taskId must be a valid UUID"),
  body("targetStepIndex").isInt({ min: 0 }).withMessage("targetStepIndex must be a non-negative integer"),
  body("reason").optional().isString(),
  body("newConstraints").optional().isArray(),
  body("newConstraints.*").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const taskId = req.params.taskId as string;
      const org = req.organization!;
      const { targetStepIndex, reason, newConstraints } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id: taskId, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.isV2Pipeline() || !task.executionPlanV2) {
        res.status(400).json({ error: "Task is not a V2 pipeline task" });
        return;
      }

      // Validate target step index
      if (targetStepIndex >= task.currentStepIndex) {
        res.status(400).json({
          error: "Cannot rewind forward",
          currentStepIndex: task.currentStepIndex,
          requestedStepIndex: targetStepIndex,
        });
        return;
      }

      // Get the commit hash to rewind to
      const targetCommit = task.getCommitForStep(targetStepIndex);
      if (!targetCommit && targetStepIndex > 0) {
        res.status(400).json({
          error: "No commit found for target step",
          targetStepIndex,
          availableCommits: task.commitHistory?.map(c => c.stepIndex) || [],
        });
        return;
      }

      // Record the rewind in context sidecar
      const rewindMessage = reason
        ? `Manual rewind from step ${task.currentStepIndex} to step ${targetStepIndex}: ${reason}`
        : `Manual rewind from step ${task.currentStepIndex} to step ${targetStepIndex}`;
      task.addConstraint(rewindMessage);

      // Add any new constraints
      if (newConstraints && Array.isArray(newConstraints)) {
        for (const constraint of newConstraints) {
          task.addConstraint(constraint);
        }
      }

      // Trim commit history to remove commits after target
      task.commitHistory = task.commitHistory?.filter(c => c.stepIndex < targetStepIndex) || [];

      // Reset to target step
      const previousStepIndex = task.currentStepIndex;
      task.currentStepIndex = targetStepIndex;
      task.currentStepRetryCount = 0;
      task.status = "executing"; // Re-enable execution
      task.errorMessage = null;

      await taskRepo.save(task);

      logger.info("V2 pipeline rewound", {
        taskId,
        previousStepIndex,
        targetStepIndex,
        targetCommit,
        reason,
      });

      res.json({
        success: true,
        previousStepIndex,
        currentStepIndex: task.currentStepIndex,
        targetCommitHash: targetCommit,
        contextSidecarLength: task.contextSidecar?.length || 0,
        message: `Rewound from step ${previousStepIndex} to step ${targetStepIndex}`,
      });
    } catch (error) {
      logger.error("Error rewinding pipeline", { error, taskId: req.params.taskId });
      res.status(500).json({ error: "Failed to rewind pipeline" });
    }
  }
);

export default router;
