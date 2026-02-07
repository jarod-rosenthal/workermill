/**
 * Build API Endpoints
 *
 * The "front door" for the Build page on workermill.com.
 *
 * Endpoints:
 *   GET  /api/build/templates        - Public: stack templates + starter projects (with cached plans)
 *   POST /api/build/execute          - Auth required: creates task for remote agent
 */

import { Router, type Request, type Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { STACK_TEMPLATES } from "../config/stack-templates.js";
import { getStarterProjectsWithPlans } from "../config/starter-projects.js";
import { logger } from "../utils/logger.js";

const router = Router();
const taskRepo = AppDataSource.getRepository(WorkerTask);

// ─── GET /templates ─────────────────────────────────────────────────────────
// Public endpoint: returns stack templates and starter projects with cached plans.
// Cached plans enable client-side terminal replay — no server compute per visitor.
router.get(
  "/templates",
  asyncHandler(async (_req: Request, res: Response) => {
    const starterProjects = getStarterProjectsWithPlans();

    res.json({
      stackTemplates: STACK_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        language: t.techStack.language,
      })),
      starterProjects: starterProjects.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        stackTemplate: p.stackTemplate,
        complexity: p.complexity,
        estimatedStories: p.estimatedStories,
        tags: p.tags,
        cachedPlan: p.cachedPlan ?? null,
      })),
    });
  }),
);

// ─── POST /execute ──────────────────────────────────────────────────────────
// Creates a task for the remote agent to pick up via polling.
router.post(
  "/execute",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      description,
      title,
      stackTemplate: stackTemplateId,
      targetRepo,
    } = req.body;
    const org = req.organization!;

    if (!description || !title) {
      res.status(400).json({ error: "description and title are required" });
      return;
    }

    if (!targetRepo) {
      res.status(400).json({ error: "targetRepo is required" });
      return;
    }

    // Create task with status "planning" — remote agent polls for these
    const task = taskRepo.create({
      orgId: org.id,
      summary: title,
      description,
      status: "planning",
      workerPersona: "project_manager",
      workerModel: "claude-opus-4-6",
      scmProvider: org.scmProvider || "github",
      githubRepo: targetRepo,
      executionMode: "parallel",
      pipelineVersion: "v2",
      retryCount: 0,
      maxRetries: 3,
      jiraFields: {
        buildPage: true,
        stackTemplate: stackTemplateId ?? null,
      },
    });

    await taskRepo.save(task);

    logger.info("Build task created for remote agent", {
      taskId: task.id,
      orgId: org.id,
    });

    const dashboardUrl = `/dashboard?task=${task.id}`;

    res.status(201).json({
      taskId: task.id,
      status: task.status,
      executionMode: "remote",
      dashboardUrl,
    });
  }),
);

export default router;
