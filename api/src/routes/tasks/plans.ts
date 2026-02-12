import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { WorkerTask } from "../../models/index.js";
import { authenticateRequest } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { body, param, validateRequest } from "../../middleware/validation.js";
import { postTicketComment } from "../../utils/ticket-comments.js";

const router = Router();

// All routes require authentication
router.use(authenticateRequest);

// =============================================================================
// Plan Review Endpoints (PRD Orchestration)
// =============================================================================

/**
 * GET /api/tasks/:id/plan
 * Get the execution plan for a task (if it's a PRD task with a plan)
 */
router.get(
  "/:id/plan",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(404).json({ error: "Task has no execution plan" });
        return;
      }

      res.json({
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        plan: task.planJson,
        planStatus: task.planStatus,
        planFeedback: task.planFeedback,
        planApprovedAt: task.planApprovedAt,
        planApprovedBy: task.planApprovedBy,
        planningNotes: task.planningNotes,
        // Include child tasks if this is a parent
        childTaskIds: task.childTaskIds,
        isParentTask: task.isParentTask(),
      });
    } catch (error) {
      logger.error("Error getting task plan", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get task plan" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/approve
 * Approve the execution plan for a task with optional execution mode selection
 * This transitions the task from pending_plan_approval to queued (or creates child tasks)
 *
 * Body parameters:
 * - executionMode: 'autonomous' | 'supervised' (optional, default: 'autonomous')
 *   - autonomous: Workers run without intervention
 *   - supervised: Workers pause at checkpoints for human input
 */
router.post(
  "/:id/plan/approve",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("executionMode")
    .optional()
    .isIn(["autonomous", "supervised"])
    .withMessage("executionMode must be 'autonomous' or 'supervised'"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user!.id;
      const id = req.params.id as string;
      const executionMode = (req.body.executionMode as "autonomous" | "supervised") || "autonomous";

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(400).json({ error: "Task has no execution plan to approve" });
        return;
      }

      if (task.planStatus !== "pending_approval") {
        res.status(400).json({
          error: "Plan is not pending approval",
          currentStatus: task.planStatus,
        });
        return;
      }

      // Approve the plan
      task.planStatus = "approved";
      task.planApprovedAt = new Date();
      task.planApprovedBy = userId;

      // Check if this is a multi-story plan that needs a feature branch
      const currentPlan = task.planJson as { strategy?: string; stories?: unknown[] } | null;
      const isMultiStory = currentPlan?.strategy === "multi" && currentPlan?.stories && currentPlan.stories.length > 1;
      let featureBranch: string | null = null;

      // Check for dry-run mode - skip Git/Jira operations
      const labels = (task.jiraFields as Record<string, unknown>)?.labels;
      const isDryRun = Array.isArray(labels) && labels.includes("dry-run");

      if (isMultiStory) {
        // Create feature branch for multi-story workflow
        // All story PRs will target this branch, then final PR goes to main
        featureBranch = `feature/${task.jiraIssueKey}`;

        if (!isDryRun) {
          // Import and call GitHub utility to create the branch
          const { createBranch } = await import("../../utils/github.js");
          const branchCreated = await createBranch(task.githubRepo, featureBranch, "main");

          if (branchCreated) {
            logger.info("Created feature branch for multi-story workflow", {
              taskId: id,
              jiraIssueKey: task.jiraIssueKey,
              featureBranch,
            });
          } else {
            logger.warn("Failed to create feature branch, stories will target main", {
              taskId: id,
              jiraIssueKey: task.jiraIssueKey,
              featureBranch,
            });
            featureBranch = null;
          }
        } else {
          logger.info("[DRY RUN] Would create feature branch for multi-story workflow", {
            taskId: id,
            jiraIssueKey: task.jiraIssueKey,
            featureBranch,
          });
          // In dry-run, we still set the featureBranch name for simulation purposes
        }
      }

      // Store execution mode and feature branch in planJson for orchestrator to read
      task.planJson = {
        ...task.planJson,
        executionMode,
        featureBranch, // Feature branch for multi-story workflow
        approvalMetadata: {
          approvedAt: new Date().toISOString(),
          approvedBy: userId,
          mode: executionMode,
        },
      };

      // Store feature branch on the task itself for easy access
      if (featureBranch) {
        task.githubBranch = featureBranch;
      }

      // Transition task to queued for execution
      task.status = "queued";

      await taskRepo.save(task);

      logger.info("Plan approved", {
        taskId: id,
        jiraIssueKey: task.jiraIssueKey,
        approvedBy: userId,
        executionMode,
        orgId,
      });

      // Post execution starting comment to Jira (non-blocking)
      // Re-read plan from saved task to get featureBranch
      const savedPlan = task.planJson as {
        strategy?: string;
        stories?: Array<{ title: string; persona: string }>;
        primaryPersona?: string;
        featureBranch?: string;
      } | null;
      const storyCount = savedPlan?.stories?.length || 1;
      const branchInfo = featureBranch ? `\nFeature branch: ${featureBranch}` : "";
      const executionComment = [
        "[Project Manager - Execution Starting]",
        "",
        `✅ Plan approved in ${executionMode.toUpperCase()} mode`,
        branchInfo,
        "",
        `Dispatching ${storyCount} ${storyCount === 1 ? "story" : "stories"} for execution...`,
        "",
        savedPlan?.stories
          ? savedPlan.stories.map((s, i) => `${i + 1}. [${s.persona}] ${s.title}`).join("\n")
          : `Primary persona: ${savedPlan?.strategy === "single" ? savedPlan.primaryPersona || "backend_developer" : "TBD"}`,
        "",
        "Workers are now executing. Updates will be posted on completion.",
      ].join("\n");

      if (task.jiraIssueKey && !isDryRun) {
        postTicketComment(task.orgId, task.jiraIssueKey, executionComment).catch((err) => {
          logger.warn("Failed to post execution starting comment to Jira", { err, jiraKey: task.jiraIssueKey });
        });
      } else if (task.jiraIssueKey && isDryRun) {
        logger.info("[DRY RUN] Would post execution starting comment to Jira", {
          taskId: task.id,
          jiraKey: task.jiraIssueKey,
        });
      }

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        planStatus: task.planStatus,
        status: task.status,
        executionMode,
        message: `Plan approved in ${executionMode} mode, task queued for execution`,
      });
    } catch (error) {
      logger.error("Error approving plan", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to approve plan" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/request-changes
 * Request changes to the execution plan
 * The planning agent will re-run with the feedback
 */
router.post(
  "/:id/plan/request-changes",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("feedback").isString().notEmpty().withMessage("feedback is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const userId = req.user!.id;
      const id = req.params.id as string;
      const { feedback } = req.body;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (!task.planJson) {
        res.status(400).json({ error: "Task has no execution plan" });
        return;
      }

      if (task.planStatus !== "pending_approval") {
        res.status(400).json({
          error: "Plan is not pending approval",
          currentStatus: task.planStatus,
        });
        return;
      }

      // Store feedback and transition to re-planning
      task.planStatus = "changes_requested";
      task.planFeedback = feedback;

      // Reset to planning status so orchestrator re-runs planning agent
      task.status = "planning";

      await taskRepo.save(task);

      logger.info("Plan changes requested", {
        taskId: id,
        jiraIssueKey: task.jiraIssueKey,
        requestedBy: userId,
        feedback: feedback.substring(0, 100), // Log first 100 chars
        orgId,
      });

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        planStatus: task.planStatus,
        status: task.status,
        message: "Changes requested, task will be re-planned with feedback",
      });
    } catch (error) {
      logger.error("Error requesting plan changes", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to request plan changes" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/generate-v2
 * Trigger V2 multi-phase planning for a task
 * This uses the new theme-based decomposition system
 */
router.post(
  "/:id/plan/generate-v2",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      // Load organization relation to access org settings (e.g., storyCalibrationMultiplier)
      const task = await taskRepo.findOne({
        where: { id, orgId },
        relations: ["organization"],
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Only allow regenerating for tasks in planning phase or pending approval
      if (!["planning", "pending_plan_approval", "queued"].includes(task.status)) {
        res.status(400).json({
          error: "Task is not in a planning state",
          currentStatus: task.status,
        });
        return;
      }

      // Import and run V2 planning
      const { runPlanningAgentV2 } = await import("../../services/planning-agent/index.js");

      logger.info("Triggering V2 planning", { taskId: id, jiraKey: task.jiraIssueKey });

      // Run planning (async)
      const plan = await runPlanningAgentV2(task);

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        planVersion: 2,
        themeCount: plan.themes.length,
        storyCount: plan.stories.length,
        qualityScore: plan.qualityScore.overall,
        status: task.status,
        message: "V2 plan generated successfully",
      });
    } catch (error) {
      logger.error("Error generating V2 plan", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to generate V2 plan" });
    }
  }
);

/**
 * POST /api/tasks/:id/plan/consistency-test
 * Run consistency test on planning for this task
 * Runs the same PRD through planning multiple times and compares results
 */
router.post(
  "/:id/plan/consistency-test",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  body("runs").optional().isInt({ min: 2, max: 10 }).withMessage("runs must be between 2 and 10"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;
      const runs = (req.body.runs as number) || 5;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const task = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Import and run consistency test
      const { runConsistencyTest } = await import("../../services/planning-agent/index.js");

      logger.info("Running consistency test", { taskId: id, runs });

      const report = await runConsistencyTest(task, runs);

      res.json({
        success: true,
        taskId: task.id,
        jiraIssueKey: task.jiraIssueKey,
        totalRuns: report.totalRuns,
        consistentRuns: report.consistentRuns,
        isConsistent: report.consistentRuns === report.totalRuns,
        divergenceCount: report.divergences.length,
        rootCauses: report.rootCauses,
        recommendations: report.recommendations,
        report: report.report,
      });
    } catch (error) {
      logger.error("Error running consistency test", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to run consistency test" });
    }
  }
);

/**
 * GET /api/tasks/:id/children
 * Get child tasks for a parent PRD task
 */
router.get(
  "/:id/children",
  param("id").isUUID().withMessage("id must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const orgId = req.organization!.id;
      const id = req.params.id as string;

      const taskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = await taskRepo.findOne({
        where: { id, orgId },
      });

      if (!parentTask) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Check if task is a parent task (has prd label or planJson)
      const isPrdTask = parentTask.isParentTask() || parentTask.planJson;

      if (!isPrdTask) {
        res.json({
          parentTaskId: id,
          isParentTask: false,
          children: [],
        });
        return;
      }

      // Check if we're in planning phase (before approval) or transition phase (approved but children not yet created)
      const isPlanningPhase = ["planning", "pending_plan_approval"].includes(parentTask.status);
      const isTransitionPhase = ["queued", "dispatching"].includes(parentTask.status);

      // Get plan data
      const planJson = parentTask.planJson as {
        strategy?: string;
        stories?: Array<{
          id: string;
          title: string;
          persona: string;
          description?: string;
          dependencies?: string[];
        }>;
      } | null;

      // First, check if actual child tasks exist in the database
      const existingChildren = await taskRepo
        .createQueryBuilder("task")
        .where("task.parent_task_id = :parentId", { parentId: id })
        .orderBy("task.story_index", "ASC")
        .getMany();

      // If child tasks exist, return them (this is the main case after orchestrator creates children)
      if (existingChildren.length > 0) {
        res.json({
          parentTaskId: id,
          jiraIssueKey: parentTask.jiraIssueKey,
          summary: parentTask.summary,
          status: parentTask.status,
          isParentTask: true,
          isPlanningPhase: false,
          childCount: existingChildren.length,
          children: existingChildren.map((child) => ({
            id: child.id,
            storyIndex: child.storyIndex,
            storyTitle: child.storyTitle,
            persona: child.workerPersona,
            model: child.workerModel,
            status: child.status,
            dependencies: child.storyDependencies,
            githubPrUrl: child.githubPrUrl,
            startedAt: child.startedAt,
            completedAt: child.completedAt,
            estimatedCostUsd: child.estimatedCostUsd,
          })),
        });
        return;
      }

      // If no child tasks exist yet but we have planned stories, show them
      // This covers: planning phase, pending approval, and the gap between approval and child task creation
      if ((isPlanningPhase || isTransitionPhase) && planJson?.stories?.length) {
        // Determine the status to show for planned stories
        let plannedStatus = "planned";
        if (parentTask.status === "queued") {
          plannedStatus = "queued"; // Approved and waiting to be dispatched
        } else if (parentTask.status === "dispatching") {
          plannedStatus = "queued"; // Being dispatched, children will be created soon
        }

        res.json({
          parentTaskId: id,
          jiraIssueKey: parentTask.jiraIssueKey,
          summary: parentTask.summary,
          status: parentTask.status,
          isParentTask: true,
          isPlanningPhase: isPlanningPhase,
          childCount: planJson.stories.length,
          children: planJson.stories.map((story, index) => ({
            id: story.id || `planned-${index}`,
            storyIndex: index + 1,
            storyTitle: story.title,
            persona: story.persona,
            model: parentTask.workerModel,
            status: plannedStatus, // Use appropriate status based on parent state
            dependencies: story.dependencies || [],
            description: story.description,
            githubPrUrl: null,
            startedAt: null,
            completedAt: null,
            estimatedCostUsd: 0,
          })),
        });
        return;
      }

      // Fallback: no children and no plan - return empty
      res.json({
        parentTaskId: id,
        jiraIssueKey: parentTask.jiraIssueKey,
        summary: parentTask.summary,
        status: parentTask.status,
        isParentTask: true,
        isPlanningPhase: false,
        childCount: 0,
        children: [],
      });
    } catch (error) {
      logger.error("Error getting child tasks", { error, taskId: req.params.id });
      res.status(500).json({ error: "Failed to get child tasks" });
    }
  }
);

export default router;
