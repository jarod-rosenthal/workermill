/**
 * Projects API Routes
 *
 * Internal task management system for Kanban-style project boards.
 * Provides CRUD operations for projects, board columns, and tasks.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../db/connection.js";
import { validationResult } from "express-validator";
import {
  Project,
  BoardColumn,
  InternalTask,
  DEFAULT_COLUMNS,
  WorkerTask,
  WorkerContext,
  type WorkerPersona,
} from "../models/index.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { localEpicSpawner } from "../services/local-epic-spawner.js";
import { body, param, query, validateRequest } from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a project key from the project name
 * Takes first 4-6 uppercase alphanumeric characters
 */
function generateProjectKey(name: string): string {
  // Remove non-alphanumeric characters and convert to uppercase
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  // Take first 4-6 characters (prefer 4, but use more if too short)
  const length = Math.min(Math.max(cleaned.length, 2), 6);
  return cleaned.slice(0, length) || "PROJ";
}

/**
 * Ensure project key is unique within the organization
 */
async function ensureUniqueProjectKey(
  orgId: string,
  baseKey: string,
  excludeProjectId?: string
): Promise<string> {
  const projectRepo = AppDataSource.getRepository(Project);

  let key = baseKey;
  let suffix = 1;

  while (true) {
    const qb = projectRepo
      .createQueryBuilder("project")
      .where("project.orgId = :orgId", { orgId })
      .andWhere("project.key = :key", { key });

    if (excludeProjectId) {
      qb.andWhere("project.id != :excludeProjectId", { excludeProjectId });
    }

    const existing = await qb.getOne();

    if (!existing) {
      return key;
    }

    // Append suffix and try again
    key = `${baseKey.slice(0, 4)}${suffix}`;
    suffix++;

    // Safety limit
    if (suffix > 100) {
      throw new Error("Unable to generate unique project key");
    }
  }
}

// =============================================================================
// Project CRUD Routes
// =============================================================================

/**
 * GET /api/projects
 * List all projects for the organization
 */
router.get(
  "/",
  query("includeArchived").optional().isBoolean().toBoolean(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const includeArchived = String(req.query.includeArchived) === "true";

      const projectRepo = AppDataSource.getRepository(Project);

      const queryBuilder = projectRepo
        .createQueryBuilder("project")
        .where("project.orgId = :orgId", { orgId: org.id })
        .orderBy("project.createdAt", "DESC");

      if (!includeArchived) {
        queryBuilder.andWhere("project.isArchived = :isArchived", { isArchived: false });
      }

      const projects = await queryBuilder.getMany();

      res.json({
        projects: projects.map((project) => ({
          id: project.id,
          key: project.key,
          name: project.name,
          description: project.description,
          githubRepo: project.githubRepo,
          defaultPersona: project.defaultPersona,
          defaultModel: project.defaultModel,
          defaultProvider: project.defaultProvider,
          taskSequence: project.taskSequence,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        })),
      });
    } catch (error) {
      logger.error("Error listing projects", { error });
      res.status(500).json({ error: "Failed to list projects" });
    }
  }
);

/**
 * POST /api/projects
 * Create a new project with default columns
 */
router.post(
  "/",
  body("name").isString().notEmpty().isLength({ max: 200 }).withMessage("name is required (max 200 chars)"),
  body("description").optional().isString().isLength({ max: 2000 }),
  body("githubRepo").optional().isString().isLength({ max: 255 }),
  body("defaultPersona").optional().isString(),
  body("defaultModel").optional().isString(),
  body("defaultProvider").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user!;
      const { name, description, githubRepo, defaultPersona, defaultModel, defaultProvider } = req.body;

      // Generate unique project key
      const baseKey = generateProjectKey(name);
      const key = await ensureUniqueProjectKey(org.id, baseKey);

      // Use transaction to create project and columns atomically
      const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
        const projectRepo = transactionalEntityManager.getRepository(Project);
        const columnRepo = transactionalEntityManager.getRepository(BoardColumn);

        // Create project
        const project = projectRepo.create({
          orgId: org.id,
          key,
          name,
          description: description || null,
          githubRepo: githubRepo || org.getDefaultRepo() || null,
          defaultPersona: defaultPersona || org.defaultWorkerPersona || "backend_developer",
          defaultModel: defaultModel || org.defaultWorkerModel || "",
          defaultProvider: defaultProvider || "anthropic",
          createdBy: user.id,
          taskSequence: 0,
          isArchived: false,
        });

        await projectRepo.save(project);

        // Seed default columns
        const columns: BoardColumn[] = [];
        for (const colDef of DEFAULT_COLUMNS) {
          const column = columnRepo.create({
            projectId: project.id,
            name: colDef.name,
            columnType: colDef.columnType,
            position: colDef.position,
            color: colDef.color,
            isDefault: colDef.isDefault,
            wipLimit: null,
          });
          columns.push(column);
        }

        await columnRepo.save(columns);

        return { project, columns };
      });

      logger.info("Project created", {
        projectId: result.project.id,
        key: result.project.key,
        orgId: org.id,
        userId: user.id,
      });

      res.status(201).json({
        success: true,
        project: {
          id: result.project.id,
          key: result.project.key,
          name: result.project.name,
          description: result.project.description,
          githubRepo: result.project.githubRepo,
          defaultPersona: result.project.defaultPersona,
          defaultModel: result.project.defaultModel,
          defaultProvider: result.project.defaultProvider,
          taskSequence: result.project.taskSequence,
          isArchived: result.project.isArchived,
          createdAt: result.project.createdAt,
          columns: result.columns.map((col) => ({
            id: col.id,
            name: col.name,
            columnType: col.columnType,
            position: col.position,
            color: col.color,
            isDefault: col.isDefault,
          })),
        },
      });
    } catch (error) {
      logger.error("Error creating project", { error });
      res.status(500).json({ error: "Failed to create project" });
    }
  }
);

/**
 * GET /api/projects/:id
 * Get a single project by ID
 */
router.get(
  "/:id",
  param("id").isUUID().withMessage("Invalid project ID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.id as string;

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
        relations: ["columns"],
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      res.json({
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
          description: project.description,
          githubRepo: project.githubRepo,
          defaultPersona: project.defaultPersona,
          defaultModel: project.defaultModel,
          defaultProvider: project.defaultProvider,
          taskSequence: project.taskSequence,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          columns: project.columns
            .sort((a, b) => a.position - b.position)
            .map((col) => ({
              id: col.id,
              name: col.name,
              columnType: col.columnType,
              position: col.position,
              color: col.color,
              isDefault: col.isDefault,
              wipLimit: col.wipLimit,
            })),
        },
      });
    } catch (error) {
      logger.error("Error getting project", { error });
      res.status(500).json({ error: "Failed to get project" });
    }
  }
);

/**
 * PUT /api/projects/:id
 * Update a project
 */
router.put(
  "/:id",
  param("id").isUUID().withMessage("Invalid project ID"),
  body("name").optional().isString().isLength({ max: 200 }),
  body("description").optional().isString().isLength({ max: 2000 }),
  body("githubRepo").optional().isString().isLength({ max: 255 }),
  body("defaultPersona").optional().isString(),
  body("defaultModel").optional().isString(),
  body("defaultProvider").optional().isString(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.id as string;
      const { name, description, githubRepo, defaultPersona, defaultModel, defaultProvider } = req.body;

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Update fields if provided
      if (name !== undefined) project.name = name;
      if (description !== undefined) project.description = description || null;
      if (githubRepo !== undefined) project.githubRepo = githubRepo || null;
      if (defaultPersona !== undefined) project.defaultPersona = defaultPersona;
      if (defaultModel !== undefined) project.defaultModel = defaultModel;
      if (defaultProvider !== undefined) project.defaultProvider = defaultProvider;

      await projectRepo.save(project);

      logger.info("Project updated", { projectId: project.id, orgId: org.id });

      res.json({
        success: true,
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
          description: project.description,
          githubRepo: project.githubRepo,
          defaultPersona: project.defaultPersona,
          defaultModel: project.defaultModel,
          defaultProvider: project.defaultProvider,
          taskSequence: project.taskSequence,
          isArchived: project.isArchived,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error updating project", { error });
      res.status(500).json({ error: "Failed to update project" });
    }
  }
);

/**
 * DELETE /api/projects/:id
 * Archive a project (soft delete)
 */
router.delete(
  "/:id",
  requireAdmin,
  param("id").isUUID().withMessage("Invalid project ID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.id as string;

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      project.isArchived = true;
      await projectRepo.save(project);

      logger.info("Project archived", { projectId: project.id, orgId: org.id });

      res.json({ success: true, message: "Project archived" });
    } catch (error) {
      logger.error("Error archiving project", { error });
      res.status(500).json({ error: "Failed to archive project" });
    }
  }
);

// =============================================================================
// Board Routes
// =============================================================================

/**
 * GET /api/projects/:projectId/board
 * Get full board with columns and tasks
 */
router.get(
  "/:projectId/board",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;

      const projectRepo = AppDataSource.getRepository(Project);
      const columnRepo = AppDataSource.getRepository(BoardColumn);
      const taskRepo = AppDataSource.getRepository(InternalTask);

      // Verify project exists and belongs to org
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get columns ordered by position
      const columns = await columnRepo.find({
        where: { projectId },
        order: { position: "ASC" },
      });

      // Get all tasks for this project
      const tasks = await taskRepo.find({
        where: { projectId },
        order: { columnPosition: "ASC" },
      });

      // Group tasks by column
      const tasksByColumn = new Map<string, InternalTask[]>();
      for (const column of columns) {
        tasksByColumn.set(column.id, []);
      }
      for (const task of tasks) {
        const columnTasks = tasksByColumn.get(task.columnId);
        if (columnTasks) {
          columnTasks.push(task);
        }
      }

      res.json({
        project: {
          id: project.id,
          key: project.key,
          name: project.name,
          description: project.description,
          githubRepo: project.githubRepo,
          defaultPersona: project.defaultPersona,
          defaultModel: project.defaultModel,
          defaultProvider: project.defaultProvider,
        },
        columns: columns.map((col) => ({
          id: col.id,
          name: col.name,
          columnType: col.columnType,
          position: col.position,
          color: col.color,
          isDefault: col.isDefault,
          wipLimit: col.wipLimit,
          tasks: (tasksByColumn.get(col.id) || []).map((task) => ({
            id: task.id,
            taskKey: task.taskKey,
            title: task.title,
            description: task.description,
            persona: task.persona,
            model: task.model,
            provider: task.provider,
            labels: task.labels,
            columnPosition: task.columnPosition,
            workerTaskId: task.workerTaskId,
            assignedAt: task.assignedAt,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
          })),
        })),
      });
    } catch (error) {
      logger.error("Error getting board", { error });
      res.status(500).json({ error: "Failed to get board" });
    }
  }
);

/**
 * PUT /api/projects/:projectId/columns
 * Reorder columns
 */
router.put(
  "/:projectId/columns",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  body("columnIds").isArray().withMessage("columnIds must be an array"),
  body("columnIds.*").isUUID().withMessage("Each columnId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const { columnIds } = req.body as { columnIds: string[] };

      const projectRepo = AppDataSource.getRepository(Project);
      const columnRepo = AppDataSource.getRepository(BoardColumn);

      // Verify project exists and belongs to org
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Verify all column IDs belong to this project
      const columns = await columnRepo.find({
        where: { projectId },
      });

      const existingIds = new Set(columns.map((c) => c.id));
      for (const id of columnIds) {
        if (!existingIds.has(id)) {
          res.status(400).json({ error: `Column ${id} does not belong to this project` });
          return;
        }
      }

      // Update positions
      await AppDataSource.transaction(async (transactionalEntityManager) => {
        const colRepo = transactionalEntityManager.getRepository(BoardColumn);

        for (let i = 0; i < columnIds.length; i++) {
          await colRepo.update({ id: columnIds[i] }, { position: i });
        }
      });

      logger.info("Columns reordered", { projectId, orgId: org.id });

      res.json({ success: true, message: "Columns reordered" });
    } catch (error) {
      logger.error("Error reordering columns", { error });
      res.status(500).json({ error: "Failed to reorder columns" });
    }
  }
);

/**
 * POST /api/projects/:projectId/columns
 * Add a custom column
 */
router.post(
  "/:projectId/columns",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  body("name").isString().notEmpty().isLength({ max: 100 }).withMessage("name is required (max 100 chars)"),
  body("columnType").isIn(["backlog", "ready", "in_progress", "review", "done"]).withMessage("Invalid column type"),
  body("color").optional().isString().isLength({ max: 20 }),
  body("wipLimit").optional().isInt({ min: 1 }),
  body("position").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const { name, columnType, color, wipLimit, position } = req.body;

      const projectRepo = AppDataSource.getRepository(Project);
      const columnRepo = AppDataSource.getRepository(BoardColumn);

      // Verify project exists and belongs to org
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId: org.id },
      });

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Get current max position if not specified
      let finalPosition = position;
      if (finalPosition === undefined) {
        const maxPosResult = await columnRepo
          .createQueryBuilder("column")
          .where("column.projectId = :projectId", { projectId })
          .select("MAX(column.position)", "maxPos")
          .getRawOne();
        finalPosition = (maxPosResult?.maxPos ?? -1) + 1;
      }

      const column = columnRepo.create({
        projectId,
        name,
        columnType,
        position: finalPosition,
        color: color || null,
        wipLimit: wipLimit || null,
        isDefault: false,
      });

      await columnRepo.save(column);

      logger.info("Column added", { projectId, columnId: column.id, orgId: org.id });

      res.status(201).json({
        success: true,
        column: {
          id: column.id,
          name: column.name,
          columnType: column.columnType,
          position: column.position,
          color: column.color,
          wipLimit: column.wipLimit,
          isDefault: column.isDefault,
        },
      });
    } catch (error) {
      logger.error("Error adding column", { error });
      res.status(500).json({ error: "Failed to add column" });
    }
  }
);

// =============================================================================
// Task CRUD Routes
// =============================================================================

/**
 * POST /api/projects/:projectId/tasks
 * Create a new task
 */
router.post(
  "/:projectId/tasks",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  body("title").isString().notEmpty().isLength({ max: 500 }).withMessage("title is required (max 500 chars)"),
  body("description").optional().isString(),
  body("userStoryRole").optional().isString().isLength({ max: 200 }),
  body("userStoryWant").optional().isString().isLength({ max: 500 }),
  body("userStoryBenefit").optional().isString().isLength({ max: 500 }),
  body("acceptanceCriteria").optional().isArray(),
  body("definitionOfDone").optional().isArray(),
  body("technicalNotes").optional().isString(),
  body("persona").optional().isString(),
  body("model").optional().isString(),
  body("provider").optional().isString(),
  body("githubRepo").optional().isString(),
  body("labels").optional().isArray(),
  body("dueDate").optional().isISO8601(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const user = req.user!;
      const projectId = req.params.projectId as string;
      const {
        title,
        description,
        userStoryRole,
        userStoryWant,
        userStoryBenefit,
        acceptanceCriteria,
        definitionOfDone,
        technicalNotes,
        persona,
        model,
        provider,
        githubRepo,
        labels,
        dueDate,
      } = req.body;

      // Use transaction for atomic sequence increment and task creation
      const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
        const projectRepo = transactionalEntityManager.getRepository(Project);
        const columnRepo = transactionalEntityManager.getRepository(BoardColumn);
        const taskRepo = transactionalEntityManager.getRepository(InternalTask);

        // Lock and fetch project for update (atomic sequence increment)
        const project = await projectRepo
          .createQueryBuilder("project")
          .setLock("pessimistic_write")
          .where("project.id = :id", { id: projectId })
          .andWhere("project.orgId = :orgId", { orgId: org.id })
          .getOne();

        if (!project) {
          throw new Error("Project not found");
        }

        // Increment task sequence
        project.taskSequence += 1;
        await projectRepo.save(project);

        // Generate task key
        const taskKey = `${project.key}-${project.taskSequence}`;

        // System-controlled column assignment based on task completeness
        // Required fields for "ready" status: title, persona, at least one acceptance criterion
        const hasRequiredFields = !!(
          title &&
          persona &&
          acceptanceCriteria &&
          acceptanceCriteria.length > 0
        );

        // Determine status and column type
        const taskStatus = hasRequiredFields ? "ready" : "draft";
        const targetColumnType = hasRequiredFields ? "ready" : "backlog";

        // Find the appropriate column
        let targetColumn = await columnRepo.findOne({
          where: { projectId, columnType: targetColumnType },
        });

        if (!targetColumn) {
          // Fallback to first column
          targetColumn = await columnRepo.findOne({
            where: { projectId },
            order: { position: "ASC" },
          });
        }

        if (!targetColumn) {
          throw new Error("No columns found for project");
        }

        // Get max position in column for new task
        const maxPosResult = await taskRepo
          .createQueryBuilder("task")
          .where("task.columnId = :columnId", { columnId: targetColumn.id })
          .select("MAX(task.columnPosition)", "maxPos")
          .getRawOne();
        const columnPosition = (maxPosResult?.maxPos ?? -1) + 1;

        // Create task with system-controlled status
        const task = taskRepo.create({
          projectId,
          orgId: org.id,
          columnId: targetColumn.id,
          status: taskStatus,
          taskKey,
          sequenceNumber: project.taskSequence,
          title,
          description: description || null,
          userStoryRole: userStoryRole || null,
          userStoryWant: userStoryWant || null,
          userStoryBenefit: userStoryBenefit || null,
          acceptanceCriteria: acceptanceCriteria || [],
          definitionOfDone: definitionOfDone || [],
          technicalNotes: technicalNotes || null,
          persona: persona || null,
          model: model || null,
          provider: provider || null,
          githubRepo: githubRepo || null,
          labels: labels || null,
          columnPosition,
          createdBy: user.id,
          dueDate: dueDate ? new Date(dueDate) : null,
        });

        await taskRepo.save(task);

        return { task, column: targetColumn };
      });

      logger.info("Task created", {
        taskId: result.task.id,
        taskKey: result.task.taskKey,
        projectId,
        orgId: org.id,
      });

      res.status(201).json({
        success: true,
        task: {
          id: result.task.id,
          taskKey: result.task.taskKey,
          title: result.task.title,
          description: result.task.description,
          status: result.task.status,
          storyIndex: result.task.storyIndex,
          userStoryRole: result.task.userStoryRole,
          userStoryWant: result.task.userStoryWant,
          userStoryBenefit: result.task.userStoryBenefit,
          acceptanceCriteria: result.task.acceptanceCriteria,
          definitionOfDone: result.task.definitionOfDone,
          technicalNotes: result.task.technicalNotes,
          persona: result.task.persona,
          model: result.task.model,
          provider: result.task.provider,
          githubRepo: result.task.githubRepo,
          labels: result.task.labels,
          columnId: result.task.columnId,
          columnPosition: result.task.columnPosition,
          dueDate: result.task.dueDate,
          createdAt: result.task.createdAt,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      if (errorMessage === "Project not found") {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (errorMessage === "No columns found for project") {
        res.status(400).json({ error: "Project has no columns configured" });
        return;
      }

      logger.error("Error creating task", { error });
      res.status(500).json({ error: "Failed to create task" });
    }
  }
);

/**
 * GET /api/projects/:projectId/tasks/:taskKey
 * Get a task by key
 */
router.get(
  "/:projectId/tasks/:taskKey",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  param("taskKey").isString().notEmpty().withMessage("Task key is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const taskKey = req.params.taskKey as string;

      const taskRepo = AppDataSource.getRepository(InternalTask);

      const task = await taskRepo.findOne({
        where: { projectId, taskKey, orgId: org.id },
        relations: ["column", "workerTask"],
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      res.json({
        task: {
          id: task.id,
          taskKey: task.taskKey,
          title: task.title,
          description: task.description,
          userStoryRole: task.userStoryRole,
          userStoryWant: task.userStoryWant,
          userStoryBenefit: task.userStoryBenefit,
          acceptanceCriteria: task.acceptanceCriteria,
          definitionOfDone: task.definitionOfDone,
          technicalNotes: task.technicalNotes,
          persona: task.persona,
          model: task.model,
          provider: task.provider,
          githubRepo: task.githubRepo,
          labels: task.labels,
          columnId: task.columnId,
          column: task.column
            ? {
                id: task.column.id,
                name: task.column.name,
                columnType: task.column.columnType,
              }
            : null,
          columnPosition: task.columnPosition,
          workerTaskId: task.workerTaskId,
          workerTask: task.workerTask
            ? {
                id: (task.workerTask as WorkerTask).id,
                status: (task.workerTask as WorkerTask).status,
                githubPrUrl: (task.workerTask as WorkerTask).githubPrUrl,
              }
            : null,
          assignedAt: task.assignedAt,
          dueDate: task.dueDate,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error getting task", { error });
      res.status(500).json({ error: "Failed to get task" });
    }
  }
);

/**
 * PUT /api/projects/:projectId/tasks/:taskKey
 * Update a task
 */
router.put(
  "/:projectId/tasks/:taskKey",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  param("taskKey").isString().notEmpty().withMessage("Task key is required"),
  body("title").optional().isString().isLength({ max: 500 }),
  body("description").optional().isString(),
  body("userStoryRole").optional().isString().isLength({ max: 200 }),
  body("userStoryWant").optional().isString().isLength({ max: 500 }),
  body("userStoryBenefit").optional().isString().isLength({ max: 500 }),
  body("acceptanceCriteria").optional().isArray(),
  body("definitionOfDone").optional().isArray(),
  body("technicalNotes").optional().isString(),
  body("persona").optional().isString(),
  body("model").optional().isString(),
  body("provider").optional().isString(),
  body("githubRepo").optional().isString(),
  body("labels").optional().isArray(),
  body("dueDate").optional(),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const taskKey = req.params.taskKey as string;
      const {
        title,
        description,
        userStoryRole,
        userStoryWant,
        userStoryBenefit,
        acceptanceCriteria,
        definitionOfDone,
        technicalNotes,
        persona,
        model,
        provider,
        githubRepo,
        labels,
        dueDate,
      } = req.body;

      const taskRepo = AppDataSource.getRepository(InternalTask);

      const task = await taskRepo.findOne({
        where: { projectId, taskKey, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Update fields if provided
      if (title !== undefined) task.title = title;
      if (description !== undefined) task.description = description || null;
      if (userStoryRole !== undefined) task.userStoryRole = userStoryRole || null;
      if (userStoryWant !== undefined) task.userStoryWant = userStoryWant || null;
      if (userStoryBenefit !== undefined) task.userStoryBenefit = userStoryBenefit || null;
      if (acceptanceCriteria !== undefined) task.acceptanceCriteria = acceptanceCriteria;
      if (definitionOfDone !== undefined) task.definitionOfDone = definitionOfDone;
      if (technicalNotes !== undefined) task.technicalNotes = technicalNotes || null;
      if (persona !== undefined) task.persona = persona || null;
      if (model !== undefined) task.model = model || null;
      if (provider !== undefined) task.provider = provider || null;
      if (githubRepo !== undefined) task.githubRepo = githubRepo || null;
      if (labels !== undefined) task.labels = labels || null;
      if (dueDate !== undefined) task.dueDate = dueDate ? new Date(dueDate) : null;

      // System-controlled status transitions (only for draft/ready tasks)
      // Tasks that are queued/executing/review/completed/failed should not be auto-moved
      if (task.status === "draft" || task.status === "ready") {
        const hasRequiredFields = !!(
          task.title &&
          task.persona &&
          task.acceptanceCriteria &&
          task.acceptanceCriteria.length > 0
        );

        const newStatus = hasRequiredFields ? "ready" : "draft";
        const targetColumnType = hasRequiredFields ? "ready" : "backlog";

        // Only update column if status changed
        if (task.status !== newStatus) {
          const columnRepo = AppDataSource.getRepository(BoardColumn);
          const targetColumn = await columnRepo.findOne({
            where: { projectId, columnType: targetColumnType },
          });

          if (targetColumn && targetColumn.id !== task.columnId) {
            // Get max position in new column
            const maxPosResult = await taskRepo
              .createQueryBuilder("task")
              .where("task.columnId = :columnId", { columnId: targetColumn.id })
              .select("MAX(task.columnPosition)", "maxPos")
              .getRawOne();

            task.status = newStatus;
            task.columnId = targetColumn.id;
            task.columnPosition = (maxPosResult?.maxPos ?? -1) + 1;

            logger.info("Task auto-moved", {
              taskKey,
              fromStatus: task.status,
              toStatus: newStatus,
              columnType: targetColumnType,
            });
          }
        }
      }

      await taskRepo.save(task);

      logger.info("Task updated", { taskId: task.id, taskKey, orgId: org.id });

      res.json({
        success: true,
        task: {
          id: task.id,
          taskKey: task.taskKey,
          title: task.title,
          description: task.description,
          status: task.status,
          storyIndex: task.storyIndex,
          userStoryRole: task.userStoryRole,
          userStoryWant: task.userStoryWant,
          userStoryBenefit: task.userStoryBenefit,
          acceptanceCriteria: task.acceptanceCriteria,
          definitionOfDone: task.definitionOfDone,
          technicalNotes: task.technicalNotes,
          persona: task.persona,
          model: task.model,
          provider: task.provider,
          githubRepo: task.githubRepo,
          labels: task.labels,
          columnId: task.columnId,
          columnPosition: task.columnPosition,
          dueDate: task.dueDate,
          updatedAt: task.updatedAt,
        },
      });
    } catch (error) {
      logger.error("Error updating task", { error });
      res.status(500).json({ error: "Failed to update task" });
    }
  }
);

/**
 * DELETE /api/projects/:projectId/tasks/:taskKey
 * Delete a task
 */
router.delete(
  "/:projectId/tasks/:taskKey",
  requireAdmin,
  param("projectId").isUUID().withMessage("Invalid project ID"),
  param("taskKey").isString().notEmpty().withMessage("Task key is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const taskKey = req.params.taskKey as string;

      const taskRepo = AppDataSource.getRepository(InternalTask);

      const task = await taskRepo.findOne({
        where: { projectId, taskKey, orgId: org.id },
      });

      if (!task) {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      // Don't allow deletion if task is assigned to an active worker
      if (task.workerTaskId) {
        const workerTaskRepo = AppDataSource.getRepository(WorkerTask);
        const workerTask = await workerTaskRepo.findOne({
          where: { id: task.workerTaskId },
        });

        if (workerTask && workerTask.isActive()) {
          res.status(400).json({
            error: "Cannot delete task while worker is active",
            workerTaskStatus: workerTask.status,
          });
          return;
        }
      }

      await taskRepo.remove(task);

      logger.info("Task deleted", { taskKey, projectId, orgId: org.id });

      res.json({ success: true, message: "Task deleted" });
    } catch (error) {
      logger.error("Error deleting task", { error });
      res.status(500).json({ error: "Failed to delete task" });
    }
  }
);

/**
 * POST /api/projects/:projectId/tasks/:taskKey/move
 * Move task to a different column
 */
router.post(
  "/:projectId/tasks/:taskKey/move",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  param("taskKey").isString().notEmpty().withMessage("Task key is required"),
  body("columnId").isUUID().withMessage("columnId must be a valid UUID"),
  body("position").optional().isInt({ min: 0 }),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const taskKey = req.params.taskKey as string;
      const { columnId, position } = req.body;

      await AppDataSource.transaction(async (transactionalEntityManager) => {
        const taskRepo = transactionalEntityManager.getRepository(InternalTask);
        const columnRepo = transactionalEntityManager.getRepository(BoardColumn);

        // Verify task exists
        const task = await taskRepo.findOne({
          where: { projectId, taskKey, orgId: org.id },
        });

        if (!task) {
          throw new Error("Task not found");
        }

        // Verify target column exists and belongs to same project
        const targetColumn = await columnRepo.findOne({
          where: { id: columnId, projectId },
        });

        if (!targetColumn) {
          throw new Error("Target column not found");
        }

        // Calculate new position
        let newPosition = position;
        if (newPosition === undefined) {
          const maxPosResult = await taskRepo
            .createQueryBuilder("task")
            .where("task.columnId = :columnId", { columnId })
            .select("MAX(task.columnPosition)", "maxPos")
            .getRawOne();
          newPosition = (maxPosResult?.maxPos ?? -1) + 1;
        }

        // Update task
        task.columnId = columnId;
        task.columnPosition = newPosition;

        await taskRepo.save(task);
      });

      logger.info("Task moved", { taskKey, columnId, projectId, orgId: org.id });

      res.json({ success: true, message: "Task moved" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      if (errorMessage === "Task not found") {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (errorMessage === "Target column not found") {
        res.status(404).json({ error: "Target column not found" });
        return;
      }

      logger.error("Error moving task", { error });
      res.status(500).json({ error: "Failed to move task" });
    }
  }
);

/**
 * POST /api/projects/:projectId/tasks/:taskKey/assign
 * Assign task to a worker
 */
router.post(
  "/:projectId/tasks/:taskKey/assign",
  param("projectId").isUUID().withMessage("Invalid project ID"),
  param("taskKey").isString().notEmpty().withMessage("Task key is required"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const projectId = req.params.projectId as string;
      const taskKey = req.params.taskKey as string;

      const result = await AppDataSource.transaction(async (transactionalEntityManager) => {
        const projectRepo = transactionalEntityManager.getRepository(Project);
        const taskRepo = transactionalEntityManager.getRepository(InternalTask);
        const columnRepo = transactionalEntityManager.getRepository(BoardColumn);
        const workerTaskRepo = transactionalEntityManager.getRepository(WorkerTask);

        // Fetch project for defaults
        const project = await projectRepo.findOne({
          where: { id: projectId, orgId: org.id },
        });

        if (!project) {
          throw new Error("Project not found");
        }

        // Fetch task
        const task = await taskRepo.findOne({
          where: { projectId, taskKey, orgId: org.id },
        });

        if (!task) {
          throw new Error("Task not found");
        }

        // Check if already assigned
        if (task.workerTaskId) {
          throw new Error("Task is already assigned to a worker");
        }

        // Determine worker configuration (task -> project -> org defaults)
        const workerPersona = (task.persona || project.defaultPersona || org.defaultWorkerPersona || "backend_developer") as WorkerPersona;
        const workerModel = task.model || project.defaultModel || org.defaultWorkerModel || "";
        const workerProvider = task.provider || project.defaultProvider || "anthropic";
        const githubRepo = task.githubRepo || project.githubRepo || org.getDefaultRepo();

        if (!githubRepo) {
          throw new Error("No GitHub repository configured");
        }

        // Create WorkerTask
        const workerTask = workerTaskRepo.create({
          orgId: org.id,
          jiraIssueKey: null,
          jiraIssueId: null,
          internalTaskId: task.id,
          summary: task.title,
          description: task.formatForWorker(),
          workerPersona,
          workerModel,
          workerProvider,
          githubRepo,
          status: "queued",
          priority: 3,
          maxRetries: org.defaultMaxRetries || 3,
        });

        await workerTaskRepo.save(workerTask);

        // Update task with worker reference
        task.workerTaskId = workerTask.id;
        task.assignedAt = new Date();

        // Find "In Progress" column and move task there
        const inProgressColumn = await columnRepo.findOne({
          where: { projectId, columnType: "in_progress" },
        });

        if (inProgressColumn) {
          // Get max position in the in_progress column
          const maxPosResult = await taskRepo
            .createQueryBuilder("task")
            .where("task.columnId = :columnId", { columnId: inProgressColumn.id })
            .select("MAX(task.columnPosition)", "maxPos")
            .getRawOne();
          const newPosition = (maxPosResult?.maxPos ?? -1) + 1;

          task.columnId = inProgressColumn.id;
          task.columnPosition = newPosition;
        }

        await taskRepo.save(task);

        return { task, workerTask };
      });

      logger.info("Task assigned to worker", {
        taskKey,
        workerTaskId: result.workerTask.id,
        projectId,
        orgId: org.id,
      });

      res.json({
        success: true,
        message: "Task assigned to worker",
        workerTask: {
          id: result.workerTask.id,
          status: result.workerTask.status,
          workerPersona: result.workerTask.workerPersona,
          workerModel: result.workerTask.workerModel,
          workerProvider: result.workerTask.workerProvider,
          githubRepo: result.workerTask.githubRepo,
        },
        task: {
          id: result.task.id,
          taskKey: result.task.taskKey,
          columnId: result.task.columnId,
          workerTaskId: result.task.workerTaskId,
          assignedAt: result.task.assignedAt,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      if (errorMessage === "Project not found") {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      if (errorMessage === "Task not found") {
        res.status(404).json({ error: "Task not found" });
        return;
      }

      if (errorMessage === "Task is already assigned to a worker") {
        res.status(400).json({ error: "Task is already assigned to a worker" });
        return;
      }

      if (errorMessage === "No GitHub repository configured") {
        res.status(400).json({
          error: "No GitHub repository configured",
          hint: "Set githubRepo on the task, project, or organization",
        });
        return;
      }

      logger.error("Error assigning task to worker", { error });
      res.status(500).json({ error: "Failed to assign task to worker" });
    }
  }
);

// =============================================================================
// Epic Execution Endpoints
// =============================================================================

/**
 * POST /api/projects/:id/run
 *
 * Run all stories in an Epic using multi-expert mode.
 * Creates a parent WorkerTask and posts all Ready tasks as story_ready messages.
 *
 * Prerequisites:
 * - Epic must have at least one task in "ready" status
 * - Epic must have a GitHub repository configured
 * - Epic must not be currently running
 */
router.post(
  "/:id/run",
  [param("id").isUUID().withMessage("Project ID must be a valid UUID")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
      const projectId = req.params.id as string;
      const orgId = req.organization!.id;

      // Get project with tasks
      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId },
        relations: ["tasks", "columns"],
      });

      if (!project) {
        res.status(404).json({ error: "Epic not found" });
        return;
      }

      // Check if already running
      if (project.executionStatus === "running") {
        res.status(400).json({
          error: "Epic is already running",
          hint: "Cancel the current run before starting a new one",
        });
        return;
      }

      // Get GitHub repo from project or org default
      const githubRepo = project.githubRepo || req.organization?.defaultGithubRepo;
      if (!githubRepo) {
        res.status(400).json({
          error: "No GitHub repository configured",
          hint: "Set githubRepo on the epic or organization settings",
        });
        return;
      }

      // Get Ready tasks (tasks with status="ready" and persona assigned)
      const readyTasks = project.tasks.filter(
        (t) => t.status === "ready" && t.persona
      );

      if (readyTasks.length === 0) {
        res.status(400).json({
          error: "No ready tasks to execute",
          hint: "Add tasks with status 'ready' and a persona assigned",
        });
        return;
      }

      // Validate all ready tasks have required fields
      const invalidTasks = readyTasks.filter((t) => !t.hasRequiredFields());
      if (invalidTasks.length > 0) {
        res.status(400).json({
          error: "Some tasks are missing required fields",
          tasks: invalidTasks.map((t) => ({
            taskKey: t.taskKey,
            missing: [
              !t.title && "title",
              !t.persona && "persona",
              (!t.acceptanceCriteria || t.acceptanceCriteria.length === 0) &&
                "acceptanceCriteria",
            ].filter(Boolean),
          })),
        });
        return;
      }

      // Assign story indices to ready tasks
      const taskRepo = AppDataSource.getRepository(InternalTask);
      for (let i = 0; i < readyTasks.length; i++) {
        readyTasks[i].storyIndex = i;
        await taskRepo.save(readyTasks[i]);
      }

      // Create parent WorkerTask for Epic execution
      const workerTaskRepo = AppDataSource.getRepository(WorkerTask);
      const parentTask = workerTaskRepo.create({
        orgId,
        summary: `Epic: ${project.name}`,
        description: `Running ${readyTasks.length} stories in parallel`,
        workerPersona: "project_manager", // Coordinator persona
        workerModel: project.defaultModel || "",
        workerProvider: project.defaultProvider || "anthropic",
        githubRepo,
        status: "queued",
        executionMode: "multi-expert", // Epic mode
        jiraFields: {
          epicId: project.id,
          epicKey: project.key,
          epicName: project.name,
          storyCount: readyTasks.length,
        },
      });

      const savedParentTask = await workerTaskRepo.save(parentTask);

      // Update project with execution status
      project.workerTaskId = savedParentTask.id;
      project.executionStatus = "running";
      await projectRepo.save(project);

      // Post story_ready messages for each task
      const contextRepo = AppDataSource.getRepository(WorkerContext);
      const storyReadyMessages: WorkerContext[] = [];

      for (const task of readyTasks) {
        const storyReadyData = {
          parentTaskId: savedParentTask.id,
          taskId: savedParentTask.id, // Use parent task ID for now
          orgId,
          persona: "coordinator",
          messageType: "story_ready" as const,
          content: `Story ${task.storyIndex}: ${task.title}`,
          metadata: {
            storyIndex: task.storyIndex,
            internalTaskId: task.id,
            taskKey: task.taskKey,
            title: task.title,
            description: task.formatForWorker(),
            persona: task.persona,
            targetFiles: task.labels?.filter((l) => l.startsWith("file:")).map((l) => l.replace("file:", "")) || [],
            dependencies: [], // Could add dependency tracking later
          },
        };

        const storyReadyContext = contextRepo.create(storyReadyData);
        const saved = await contextRepo.save(storyReadyContext);
        storyReadyMessages.push(saved);

        // Update internal task status to queued
        task.status = "queued";
        task.workerTaskId = savedParentTask.id;
        task.assignedAt = new Date();
        await taskRepo.save(task);
      }

      logger.info("Epic execution started", {
        projectId,
        projectKey: project.key,
        parentTaskId: savedParentTask.id,
        storyCount: readyTasks.length,
        stories: readyTasks.map((t) => ({ taskKey: t.taskKey, persona: t.persona })),
        orgId,
      });

      res.status(201).json({
        success: true,
        epic: {
          id: project.id,
          key: project.key,
          name: project.name,
          executionStatus: project.executionStatus,
        },
        parentTask: {
          id: savedParentTask.id,
          status: savedParentTask.status,
          executionMode: savedParentTask.executionMode,
        },
        stories: storyReadyMessages.map((m) => ({
          contextId: m.id,
          storyIndex: m.metadata?.storyIndex,
          taskKey: m.metadata?.taskKey,
          title: m.metadata?.title,
          persona: m.metadata?.persona,
        })),
      });
    } catch (error) {
      logger.error("Error starting epic execution", { error });
      res.status(500).json({ error: "Failed to start epic execution" });
    }
  }
);

/**
 * POST /api/projects/:id/cancel
 *
 * Cancel a running Epic execution.
 * Updates the parent WorkerTask to cancelled and resets epic status.
 */
router.post(
  "/:id/cancel",
  [param("id").isUUID().withMessage("Project ID must be a valid UUID")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
      const projectId = req.params.id as string;
      const orgId = req.organization!.id;

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId },
      });

      if (!project) {
        res.status(404).json({ error: "Epic not found" });
        return;
      }

      if (project.executionStatus !== "running") {
        res.status(400).json({ error: "Epic is not currently running" });
        return;
      }

      // Cancel the parent WorkerTask if it exists
      if (project.workerTaskId) {
        const workerTaskRepo = AppDataSource.getRepository(WorkerTask);
        const parentTask = await workerTaskRepo.findOne({
          where: { id: project.workerTaskId, orgId },
        });

        if (parentTask && !parentTask.isTerminal()) {
          parentTask.status = "cancelled";
          parentTask.completedAt = new Date();
          await workerTaskRepo.save(parentTask);

          // LOCAL MODE: Stop the Docker container
          if (localEpicSpawner.isLocalMode()) {
            try {
              await localEpicSpawner.stopTask(parentTask.id);
              logger.info("Stopped local worker container", { taskId: parentTask.id });
            } catch (stopError) {
              logger.warn("Failed to stop local container (may have already exited)", {
                taskId: parentTask.id,
                error: stopError,
              });
            }
          }
        }
      }

      // Reset project execution status
      project.executionStatus = "idle";
      project.workerTaskId = null;
      await projectRepo.save(project);

      // Reset queued/executing internal tasks back to ready
      const taskRepo = AppDataSource.getRepository(InternalTask);
      await taskRepo
        .createQueryBuilder()
        .update(InternalTask)
        .set({ status: "ready", workerTaskId: null })
        .where("project_id = :projectId", { projectId })
        .andWhere("status IN (:...statuses)", { statuses: ["queued", "executing"] })
        .execute();

      logger.info("Epic execution cancelled", {
        projectId,
        projectKey: project.key,
        orgId,
      });

      res.json({
        success: true,
        epic: {
          id: project.id,
          key: project.key,
          executionStatus: project.executionStatus,
        },
      });
    } catch (error) {
      logger.error("Error cancelling epic execution", { error });
      res.status(500).json({ error: "Failed to cancel epic execution" });
    }
  }
);

/**
 * GET /api/projects/:id/status
 *
 * Get the execution status of an Epic.
 * Returns the parent task status and progress of individual stories.
 */
router.get(
  "/:id/status",
  [param("id").isUUID().withMessage("Project ID must be a valid UUID")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    try {
      const projectId = req.params.id as string;
      const orgId = req.organization!.id;

      const projectRepo = AppDataSource.getRepository(Project);
      const project = await projectRepo.findOne({
        where: { id: projectId, orgId },
        relations: ["tasks"],
      });

      if (!project) {
        res.status(404).json({ error: "Epic not found" });
        return;
      }

      // Get parent task status if running
      let parentTaskStatus = null;
      if (project.workerTaskId) {
        const workerTaskRepo = AppDataSource.getRepository(WorkerTask);
        const parentTask = await workerTaskRepo.findOne({
          where: { id: project.workerTaskId, orgId },
        });

        if (parentTask) {
          parentTaskStatus = {
            id: parentTask.id,
            status: parentTask.status,
            executionMode: parentTask.executionMode,
            startedAt: parentTask.startedAt,
            completedAt: parentTask.completedAt,
            estimatedCostUsd: parentTask.estimatedCostUsd,
          };
        }
      }

      // Count tasks by status
      const statusCounts = {
        draft: 0,
        ready: 0,
        queued: 0,
        executing: 0,
        review: 0,
        completed: 0,
        failed: 0,
      };

      for (const task of project.tasks) {
        if (task.status in statusCounts) {
          statusCounts[task.status as keyof typeof statusCounts]++;
        }
      }

      res.json({
        epic: {
          id: project.id,
          key: project.key,
          name: project.name,
          executionStatus: project.executionStatus,
          githubBranch: project.githubBranch,
          githubPrUrl: project.githubPrUrl,
        },
        parentTask: parentTaskStatus,
        stories: {
          total: project.tasks.length,
          ...statusCounts,
        },
        tasks: project.tasks.map((t) => ({
          id: t.id,
          taskKey: t.taskKey,
          title: t.title,
          status: t.status,
          persona: t.persona,
          storyIndex: t.storyIndex,
          workerTaskId: t.workerTaskId,
        })),
      });
    } catch (error) {
      logger.error("Error getting epic status", { error });
      res.status(500).json({ error: "Failed to get epic status" });
    }
  }
);

export default router;
