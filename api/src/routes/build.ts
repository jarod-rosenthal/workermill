/**
 * Build API Endpoints
 *
 * The "front door" for the Build page on workermill.com.
 *
 * Endpoints:
 *   GET  /api/build/templates  - Public: stack templates and starter projects
 *   POST /api/build/preview    - Public: free plan preview (~$0.03 Haiku, IP-rate-limited)
 *   POST /api/build/execute    - Auth required: creates task for remote agent
 */

import { Router, type Request, type Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { getStackTemplate } from "../config/stack-templates.js";
import { STACK_TEMPLATES } from "../config/stack-templates.js";
import { STARTER_PROJECTS } from "../config/starter-projects.js";
import { previewPlan } from "../services/build-planner.js";
import { logger } from "../utils/logger.js";

const router = Router();
const taskRepo = AppDataSource.getRepository(WorkerTask);

// ─── Rate limiting for preview (5/day per IP — public endpoint) ─────────────

const previewCounts = new Map<string, { count: number; resetAt: number }>();
const PREVIEW_DAILY_LIMIT = 5;

function checkPreviewLimit(ip: string): boolean {
  const now = Date.now();
  const entry = previewCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    previewCounts.set(ip, {
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
// Free plan preview powered by Haiku (~$0.03). Public — no auth required.
router.post(
  "/preview",
  asyncHandler(async (req: Request, res: Response) => {
    const { description, title, stackTemplate: stackTemplateId } = req.body;

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

    // Rate limit: 5 previews/day per IP
    const clientIp = req.ip || req.socket.remoteAddress || "unknown";
    if (!checkPreviewLimit(clientIp)) {
      res.status(429).json({
        error: "Preview limit reached (5/day). Sign up for unlimited previews.",
      });
      return;
    }

    const stackTemplate = stackTemplateId
      ? getStackTemplate(stackTemplateId)
      : undefined;

    try {
      const result = await previewPlan(description, title, stackTemplate);

      logger.info("Build preview generated", {
        ip: clientIp,
        storyCount: result.preview.storyCount,
        complexity: result.complexity.score,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Build preview failed", { ip: clientIp, error: msg });
      res.status(500).json({ error: "Failed to generate preview" });
    }
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
