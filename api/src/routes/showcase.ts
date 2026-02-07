import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { ShowcaseProject } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = Router();

/**
 * GET /api/showcase/projects
 * List all showcase projects (public, no auth required)
 */
router.get("/projects", async (_req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(ShowcaseProject);
    const projects = await repo.find({
      order: { displayOrder: "ASC" },
    });

    res.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        stack: p.stack,
        storyCount: p.storyCount,
        cost: p.cost,
        duration: p.duration,
        repoUrl: p.repoUrl,
        liveUrl: p.liveUrl,
        taskLogUrl: p.taskLogUrl,
        category: p.category,
        isFeatured: p.isFeatured,
        displayOrder: p.displayOrder,
        buildMetadata: p.buildMetadata,
      })),
    });
  } catch (error) {
    logger.error("Error fetching showcase projects", { error });
    res.status(500).json({ error: "Failed to fetch showcase projects" });
  }
});

/**
 * GET /api/showcase/projects/:id
 * Full detail for a single showcase project (public, no auth required)
 */
router.get("/projects/:id", async (req: Request, res: Response) => {
  try {
    const repo = AppDataSource.getRepository(ShowcaseProject);
    const id = req.params.id as string;
    const project = await repo.findOneBy({ id });

    if (!project) {
      res.status(404).json({ error: "Showcase project not found" });
      return;
    }

    res.json({
      id: project.id,
      name: project.name,
      tagline: project.tagline,
      description: project.description,
      stack: project.stack,
      storyCount: project.storyCount,
      cost: project.cost,
      duration: project.duration,
      repoUrl: project.repoUrl,
      liveUrl: project.liveUrl,
      taskLogUrl: project.taskLogUrl,
      category: project.category,
      isFeatured: project.isFeatured,
      displayOrder: project.displayOrder,
      buildMetadata: project.buildMetadata,
      stories: project.stories,
    });
  } catch (error) {
    logger.error("Error fetching showcase project", {
      error,
      projectId: req.params.id,
    });
    res.status(500).json({ error: "Failed to fetch showcase project" });
  }
});

export default router;
