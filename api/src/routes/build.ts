/**
 * Build API Endpoints
 *
 * The "front door" for the Build page on workermill.com.
 *
 * Endpoints:
 *   POST /api/build/preview   - Free plan preview (~$0.03 Haiku)
 *   POST /api/build/execute   - Start execution (creates task, routes to mode)
 */

import { Router, type Request, type Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { Organization } from "../models/Organization.js";
import { getStackTemplate } from "../config/stack-templates.js";
import { STACK_TEMPLATES } from "../config/stack-templates.js";
import { STARTER_PROJECTS } from "../config/starter-projects.js";
import {
  previewPlan,
  assembleFullPlanningPrompt,
} from "../services/build-planner.js";
import { resolveExecutionMode } from "../services/execution-gate.js";
import { logger } from "../utils/logger.js";

const router = Router();
const taskRepo = AppDataSource.getRepository(WorkerTask);
const orgRepo = AppDataSource.getRepository(Organization);

// ─── Rate limiting for preview (5/day per org on free tier) ─────────────────

const previewCounts = new Map<string, { count: number; resetAt: number }>();
const PREVIEW_DAILY_LIMIT = 5;

function checkPreviewLimit(orgId: string): boolean {
  const now = Date.now();
  const entry = previewCounts.get(orgId);

  if (!entry || now > entry.resetAt) {
    // Reset: new day
    previewCounts.set(orgId, {
      count: 1,
      resetAt: now + 24 * 60 * 60 * 1000,
    });
    return true;
  }

  if (entry.count >= PREVIEW_DAILY_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// ─── GET /templates ─────────────────────────────────────────────────────────
// Public endpoint: returns available stack templates and starter projects.
router.get(
  "/templates",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      stackTemplates: STACK_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        language: t.techStack.language,
      })),
      starterProjects: STARTER_PROJECTS.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        stackTemplate: p.stackTemplate,
        complexity: p.complexity,
        estimatedStories: p.estimatedStories,
        tags: p.tags,
      })),
    });
  }),
);

// ─── POST /preview ──────────────────────────────────────────────────────────
// Free plan preview powered by Haiku (~$0.03). Works before CLI install.
router.post(
  "/preview",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const { description, title, stackTemplate: stackTemplateId } = req.body;
    const org = req.organization!;

    if (!description || !title) {
      res.status(400).json({ error: "description and title are required" });
      return;
    }

    if (typeof description !== "string" || description.length < 20) {
      res.status(400).json({
        error: "Description must be at least 20 characters",
      });
      return;
    }

    if (typeof title !== "string" || title.length < 3) {
      res.status(400).json({ error: "Title must be at least 3 characters" });
      return;
    }

    // Rate limit: 5 previews/day on free tier
    if (!checkPreviewLimit(org.id)) {
      res.status(429).json({
        error: "Preview limit reached (5/day). Upgrade for unlimited previews.",
      });
      return;
    }

    const stackTemplate = stackTemplateId
      ? getStackTemplate(stackTemplateId)
      : undefined;

    try {
      const result = await previewPlan(description, title, org, stackTemplate);

      logger.info("Build preview generated", {
        orgId: org.id,
        storyCount: result.preview.storyCount,
        complexity: result.complexity.score,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Build preview failed", { orgId: org.id, error: msg });
      res.status(500).json({ error: "Failed to generate preview" });
    }
  }),
);

// ─── POST /execute ──────────────────────────────────────────────────────────
// Creates a task and starts execution. Routes to local/byok/cloud.
router.post(
  "/execute",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      description,
      title,
      executionMode: requestedMode,
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

    // Resolve execution mode
    const modeResult = await resolveExecutionMode(org, requestedMode);

    if (modeResult.mode === "prompt") {
      res.status(400).json({
        error: "No execution mode available",
        reason: modeResult.reason,
        availableModes: ["local", "byok", "cloud"],
      });
      return;
    }

    // Determine execution mode for the task record
    const taskExecutionMode =
      modeResult.mode === "local" ? "parallel" : "parallel";

    // Assemble planning prompt for local mode (stored on task for worker to pull)
    let planningPrompt: { systemPrompt: string; userPrompt: string; model: string } | null = null;
    if (modeResult.mode === "local") {
      planningPrompt = await assembleFullPlanningPrompt(
        description,
        title,
        org,
        stackTemplateId,
      );
    }

    // Create task
    const task = taskRepo.create({
      orgId: org.id,
      summary: title,
      description,
      status: "planning",
      workerPersona: "project_manager",
      workerModel: planningPrompt?.model || org.defaultWorkerModel || "claude-sonnet-4-20250514",
      scmProvider: org.scmProvider || "github",
      githubRepo: targetRepo,
      executionMode: taskExecutionMode,
      pipelineVersion: "v2",
      retryCount: 0,
      maxRetries: 3,
      jiraFields: {
        buildPageMode: modeResult.mode,
        stackTemplate: stackTemplateId ?? null,
        planningPrompt: planningPrompt ?? null,
      },
    });

    await taskRepo.save(task);

    logger.info("Build execution started", {
      taskId: task.id,
      orgId: org.id,
      mode: modeResult.mode,
      reason: modeResult.reason,
    });

    const dashboardUrl = `/dashboard?task=${task.id}`;

    res.status(201).json({
      taskId: task.id,
      status: task.status,
      executionMode: modeResult.mode,
      dashboardUrl,
    });
  }),
);

export default router;
