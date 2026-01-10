/**
 * Control Center API Routes
 *
 * Dashboard endpoints for monitoring and managing AI Workers.
 * Provides real-time status, task management, and system controls.
 */

import { Router, Request, Response } from "express";
import { body, param, query, validationResult } from "express-validator";
import { authenticate, requireAdmin } from "../middleware/auth";
import type { DataSource, Repository } from "typeorm";
import type {
  AIWorkerTask,
  AIWorkerTaskStatus,
  AIWorkerPersona,
  AIWorkerInstance,
  AIWorkerTaskLog,
  Tenant,
} from "@workermill/core";
import { In, MoreThan } from "typeorm";

const router = Router();

// DataSource will be injected at runtime
let dataSource: DataSource | null = null;

export function setDataSource(ds: DataSource): void {
  dataSource = ds;
}

function getDataSource(): DataSource {
  if (!dataSource) {
    throw new Error("DataSource not configured. Call setDataSource first.");
  }
  return dataSource;
}

// Task status step mapping for UI progress indicators
function getTaskSteps(status: AIWorkerTaskStatus): {
  current: number;
  total: number;
  label: string;
} {
  const stepMap: Record<AIWorkerTaskStatus, { step: number; label: string }> = {
    queued: { step: 1, label: "Queued" },
    dispatching: { step: 2, label: "Dispatching" },
    claimed: { step: 3, label: "Claimed" },
    environment_setup: { step: 4, label: "Setting up" },
    executing: { step: 5, label: "Executing" },
    pr_created: { step: 6, label: "PR Created" },
    review_pending: { step: 7, label: "Review Pending" },
    manager_review: { step: 7, label: "Under Review" },
    revision_needed: { step: 5, label: "Revising" },
    review_approved: { step: 8, label: "Approved" },
    review_rejected: { step: 8, label: "Rejected" },
    deployment_pending: { step: 9, label: "Deploy Pending" },
    deploying: { step: 9, label: "Deploying" },
    deployed_validating: { step: 10, label: "Validating" },
    deployment_failed: { step: 9, label: "Deploy Failed" },
    validation_failed: { step: 10, label: "Validation Failed" },
    awaiting_destructive_approval: { step: 6, label: "Awaiting Approval" },
    completed: { step: 11, label: "Completed" },
    failed: { step: 0, label: "Failed" },
    cancelled: { step: 0, label: "Cancelled" },
    blocked: { step: 0, label: "Blocked" },
  };

  const info = stepMap[status] || { step: 0, label: status };
  return { current: info.step, total: 11, label: info.label };
}

/**
 * Build aggregated control center data
 */
async function buildControlCenterData(tenantId: string) {
  const ds = getDataSource();
  const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;
  const instanceRepo = ds.getRepository("AIWorkerInstance") as Repository<AIWorkerInstance>;
  const tenantRepo = ds.getRepository("Tenant") as Repository<Tenant>;

  const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  // Get today's midnight in local timezone
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Get worker instances
  const workers = await instanceRepo.find({
    where: { tenantId },
    order: { displayName: "ASC" },
  });

  // Get active tasks (in-progress statuses)
  const activeTasks = await taskRepo.find({
    where: [
      {
        tenantId,
        status: In([
          "queued",
          "dispatching",
          "claimed",
          "environment_setup",
          "executing",
          "revision_needed",
          "deployment_pending",
          "deploying",
          "deployed_validating",
          "awaiting_destructive_approval",
        ] as AIWorkerTaskStatus[]),
      },
      // Include recently completed tasks
      {
        tenantId,
        status: In(["completed", "failed", "cancelled"] as AIWorkerTaskStatus[]),
        completedAt: MoreThan(tenMinutesAgo),
      },
    ],
    order: { createdAt: "DESC" },
  });

  // Get recent completed tasks
  const recentCompleted = await taskRepo.find({
    where: {
      tenantId,
      status: In(["completed", "failed", "cancelled"] as AIWorkerTaskStatus[]),
      completedAt: MoreThan(todayStart),
    },
    order: { completedAt: "DESC" },
    take: 15,
  });

  // Calculate today's stats
  const todayTasks = await taskRepo.find({
    where: {
      tenantId,
      createdAt: MoreThan(todayStart),
    },
  });

  const todayCost = todayTasks.reduce(
    (sum, t) => sum + Number(t.estimatedCostUsd || 0),
    0
  );

  // Count queued tasks
  const queueDepth = await taskRepo.count({
    where: { tenantId, status: "queued" as AIWorkerTaskStatus },
  });

  // Calculate cumulative cost from all tasks
  const costResult = await taskRepo
    .createQueryBuilder("task")
    .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "sum")
    .where("task.tenant_id = :tenantId", { tenantId })
    .getRawOne<{ sum: string }>();
  const cumulativeCost = Number(costResult?.sum || 0);

  // Build stats
  const stats = {
    totalWorkers: workers.length,
    activeWorkers: workers.filter((w) => w.status === "working").length,
    queueDepth,
    todayCost: Math.round(todayCost * 100) / 100,
    todayCompleted: todayTasks.filter((t) =>
      ["completed", "review_approved"].includes(t.status)
    ).length,
    todayFailed: todayTasks.filter((t) => t.status === "failed").length,
    cumulativeCost: Math.round(cumulativeCost * 100) / 100,
  };

  // Format workers
  const workersData = workers
    .filter((w) => {
      if (w.status === "working") return true;
      if (w.lastTaskAt && w.lastTaskAt > tenMinutesAgo) return true;
      return false;
    })
    .map((w) => {
      const currentTask = activeTasks.find((t) => t.assignedWorkerId === w.id);
      return {
        id: w.id,
        displayName: w.displayName,
        persona: w.persona,
        status: w.status,
        tasksCompleted: w.tasksCompleted,
        tasksFailed: w.tasksFailed,
        totalCostUsd: Number(w.totalCostUsd),
        currentTask: currentTask
          ? {
              id: currentTask.id,
              externalKey: currentTask.externalKey,
              summary: currentTask.summary,
              status: currentTask.status,
            }
          : null,
      };
    });

  // Format active tasks
  const activeTasksData = activeTasks.map((t) => {
    const worker = workers.find((w) => w.id === t.assignedWorkerId);
    const steps = getTaskSteps(t.status);

    return {
      id: t.id,
      externalKey: t.externalKey,
      summary: t.summary,
      status: t.status,
      workerName: worker?.displayName || "Unassigned",
      workerPersona: t.workerPersona,
      workerModel: t.workerModel,
      estimatedCostUsd: Number(t.estimatedCostUsd),
      startedAt: t.startedAt,
      hasPr: !!t.gitPrUrl,
      gitPrUrl: t.gitPrUrl,
      steps,
    };
  });

  // Format recent completed
  const recentCompletedData = recentCompleted.map((t) => ({
    id: t.id,
    externalKey: t.externalKey,
    summary: t.summary,
    status: t.status,
    workerModel: t.workerModel,
    costUsd: Number(t.estimatedCostUsd),
    durationMinutes:
      t.completedAt && t.startedAt
        ? Math.round((t.completedAt.getTime() - t.startedAt.getTime()) / 60000)
        : null,
    completedAt: t.completedAt,
    gitPrUrl: t.gitPrUrl,
  }));

  return {
    stats,
    workers: workersData,
    activeTasks: activeTasksData,
    recentCompleted: recentCompletedData,
  };
}

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/control-center
 * Get aggregated dashboard data
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const data = await buildControlCenterData(tenantId);
    return res.json(data);
  } catch (error) {
    console.error("Error fetching control center data:", error);
    return res.status(500).json({ error: "Failed to fetch control center data" });
  }
});

/**
 * GET /api/v1/control-center/stream
 * SSE stream for real-time dashboard updates
 */
router.get("/stream", async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    if (!tenantId) {
      res.status(401).end();
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if ((res as any).flushHeaders) {
      (res as any).flushHeaders();
    }

    let isClosed = false;

    const sendUpdate = async () => {
      if (isClosed) return;
      try {
        const data = await buildControlCenterData(tenantId);
        res.write("event: control_center_update\n");
        res.write(
          `data: ${JSON.stringify({
            ...data,
            lastUpdated: new Date().toISOString(),
          })}\n\n`
        );
      } catch (err) {
        console.error("Failed to stream control center update", err);
      }
    };

    const sendPing = () => {
      if (isClosed) return;
      res.write("event: ping\n");
      res.write("data: {}\n\n");
    };

    const updateInterval = setInterval(sendUpdate, 5000);
    const pingInterval = setInterval(sendPing, 20000);

    req.on("close", () => {
      isClosed = true;
      clearInterval(updateInterval);
      clearInterval(pingInterval);
      res.end();
    });

    // Initial update
    res.write("event: connected\n");
    res.write("data: {}\n\n");
    await sendUpdate();
  } catch (error) {
    console.error("Failed to establish control center stream", error);
    res.status(500).json({ error: "Failed to start control center stream" });
  }
});

/**
 * GET /api/v1/control-center/tasks
 * List tasks with filtering and pagination
 */
router.get(
  "/tasks",
  [
    query("status").optional().isString(),
    query("search").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.tenantId!;
      const status = req.query.status as AIWorkerTaskStatus | undefined;
      const search = req.query.search as string | undefined;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      const ds = getDataSource();
      const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;

      const qb = taskRepo
        .createQueryBuilder("task")
        .where("task.tenant_id = :tenantId", { tenantId })
        .orderBy("task.createdAt", "DESC")
        .take(limit)
        .skip(offset);

      if (status) {
        qb.andWhere("task.status = :status", { status });
      }

      if (search) {
        qb.andWhere(
          "(task.external_key ILIKE :search OR task.summary ILIKE :search)",
          { search: `%${search}%` }
        );
      }

      const [tasks, total] = await qb.getManyAndCount();

      return res.json({
        tasks: tasks.map((t) => ({
          id: t.id,
          externalKey: t.externalKey,
          summary: t.summary,
          status: t.status,
          workerModel: t.workerModel,
          workerPersona: t.workerPersona,
          estimatedCostUsd: Number(t.estimatedCostUsd),
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          errorMessage: t.errorMessage,
          gitPrUrl: t.gitPrUrl,
          createdAt: t.createdAt,
        })),
        total,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      return res.status(500).json({ error: "Failed to fetch tasks" });
    }
  }
);

/**
 * GET /api/v1/control-center/tasks/:id
 * Get detailed task info
 */
router.get(
  "/tasks/:id",
  [param("id").isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.tenantId!;
      const { id } = req.params;

      const ds = getDataSource();
      const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;

      const task = await taskRepo.findOne({
        where: { id, tenantId },
      });

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      return res.json({
        id: task.id,
        tenantId: task.tenantId,
        externalKey: task.externalKey,
        externalId: task.externalId,
        summary: task.summary,
        description: task.description,
        workerPersona: task.workerPersona,
        workerModel: task.workerModel,
        status: task.status,
        priority: task.priority,
        gitRepo: task.gitRepo,
        gitBranch: task.gitBranch,
        gitPrNumber: task.gitPrNumber,
        gitPrUrl: task.gitPrUrl,
        containerTaskArn: task.containerTaskArn,
        containerTaskId: task.containerTaskId,
        aiInputTokens: task.aiInputTokens,
        aiOutputTokens: task.aiOutputTokens,
        containerSeconds: task.containerSeconds,
        estimatedCostUsd: Number(task.estimatedCostUsd),
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        errorMessage: task.errorMessage,
        retryCount: task.retryCount,
        maxRetries: task.maxRetries,
        lastHeartbeatAt: task.lastHeartbeatAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    } catch (error) {
      console.error("Error fetching task:", error);
      return res.status(500).json({ error: "Failed to fetch task" });
    }
  }
);

/**
 * GET /api/v1/control-center/tasks/:id/logs
 * Get task execution logs
 */
router.get(
  "/tasks/:id/logs",
  [
    param("id").isUUID(),
    query("since").optional().isISO8601(),
    query("limit").optional().isInt({ min: 1, max: 500 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.tenantId!;
      const { id } = req.params;
      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const limit = parseInt(req.query.limit as string) || 100;

      const ds = getDataSource();
      const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;
      const logRepo = ds.getRepository("AIWorkerTaskLog") as Repository<AIWorkerTaskLog>;

      // Verify task exists and belongs to tenant
      const task = await taskRepo.findOne({
        where: { id, tenantId },
      });

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      const where: any = { taskId: id };
      if (since) {
        where.createdAt = MoreThan(since);
      }

      const logs = await logRepo.find({
        where,
        order: { createdAt: "DESC" },
        take: limit,
      });

      return res.json({
        taskId: id,
        taskStatus: task.status,
        logs: logs.reverse().map((l) => ({
          id: l.id,
          timestamp: l.createdAt,
          type: l.type,
          message: l.message,
          severity: l.severity,
          command: l.command,
          exitCode: l.exitCode,
          filePath: l.filePath,
          durationMs: l.durationMs,
        })),
      });
    } catch (error) {
      console.error("Error fetching task logs:", error);
      return res.status(500).json({ error: "Failed to fetch task logs" });
    }
  }
);

/**
 * POST /api/v1/control-center/tasks/:id/cancel
 * Cancel a running task
 */
router.post(
  "/tasks/:id/cancel",
  [param("id").isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.tenantId!;
      const { id } = req.params;

      const ds = getDataSource();
      const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;

      const task = await taskRepo.findOne({
        where: { id, tenantId },
      });

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Check if task can be cancelled
      const activeStatuses: AIWorkerTaskStatus[] = [
        "queued",
        "dispatching",
        "claimed",
        "environment_setup",
        "executing",
      ];

      if (!activeStatuses.includes(task.status)) {
        return res.status(400).json({
          error: "Task cannot be cancelled",
          currentStatus: task.status,
        });
      }

      // Mark task as cancelled
      task.status = "cancelled" as AIWorkerTaskStatus;
      task.completedAt = new Date();
      await taskRepo.save(task);

      // Note: In production, you'd also send a message to the queue
      // to stop the container if it's running

      return res.json({
        message: "Task cancelled",
        taskId: task.id,
        status: task.status,
      });
    } catch (error) {
      console.error("Error cancelling task:", error);
      return res.status(500).json({ error: "Failed to cancel task" });
    }
  }
);

/**
 * POST /api/v1/control-center/tasks/:id/retry
 * Retry a failed task
 */
router.post(
  "/tasks/:id/retry",
  [param("id").isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const tenantId = req.tenantId!;
      const { id } = req.params;

      const ds = getDataSource();
      const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;

      const task = await taskRepo.findOne({
        where: { id, tenantId },
      });

      if (!task) {
        return res.status(404).json({ error: "Task not found" });
      }

      // Check if task can be retried
      if (task.status !== "failed" && task.status !== "cancelled") {
        return res.status(400).json({
          error: "Only failed or cancelled tasks can be retried",
          currentStatus: task.status,
        });
      }

      if (task.retryCount >= task.maxRetries) {
        return res.status(400).json({
          error: "Maximum retries exceeded",
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
        });
      }

      // Reset task for retry
      task.status = "queued" as AIWorkerTaskStatus;
      task.retryCount += 1;
      task.errorMessage = null;
      task.completedAt = null;
      await taskRepo.save(task);

      // Note: In production, you'd also send a message to the queue
      // to trigger the orchestrator

      return res.json({
        message: "Task queued for retry",
        taskId: task.id,
        retryCount: task.retryCount,
        status: task.status,
      });
    } catch (error) {
      console.error("Error retrying task:", error);
      return res.status(500).json({ error: "Failed to retry task" });
    }
  }
);

/**
 * GET /api/v1/control-center/persona-slots
 * Get persona slot status showing concurrency limits
 */
router.get("/persona-slots", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantId!;
    const ds = getDataSource();
    const taskRepo = ds.getRepository("AIWorkerTask") as Repository<AIWorkerTask>;

    const allPersonas: AIWorkerPersona[] = [
      "frontend_developer",
      "backend_developer",
      "devops_engineer",
      "security_engineer",
      "qa_engineer",
      "tech_writer",
      "project_manager",
    ];

    const activeStatuses: AIWorkerTaskStatus[] = [
      "claimed",
      "environment_setup",
      "executing",
    ];

    // Get active tasks
    const activeTasks = await taskRepo.find({
      where: {
        tenantId,
        status: In(activeStatuses),
      },
      select: ["id", "workerPersona", "status", "externalKey", "summary", "startedAt"],
    });

    // Get queued counts by persona
    const queuedTasks = await taskRepo
      .createQueryBuilder("t")
      .select("t.worker_persona", "persona")
      .addSelect("COUNT(*)", "count")
      .where("t.tenant_id = :tenantId", { tenantId })
      .andWhere("t.status = :status", { status: "queued" })
      .groupBy("t.worker_persona")
      .getRawMany();

    const queuedByPersona: Record<string, number> = {};
    for (const row of queuedTasks) {
      queuedByPersona[row.persona] = parseInt(row.count, 10);
    }

    // Build slot status
    const slots = allPersonas.map((persona) => {
      const activeTask = activeTasks.find((t) => t.workerPersona === persona);
      return {
        persona,
        occupied: activeTask
          ? {
              taskId: activeTask.id,
              externalKey: activeTask.externalKey,
              summary: activeTask.summary,
              status: activeTask.status,
              startedAt: activeTask.startedAt,
            }
          : null,
        queuedCount: queuedByPersona[persona] || 0,
      };
    });

    const occupiedCount = slots.filter((s) => s.occupied).length;
    const totalQueued = Object.values(queuedByPersona).reduce((a, b) => a + b, 0);

    return res.json({
      slots,
      summary: {
        totalSlots: allPersonas.length,
        occupiedSlots: occupiedCount,
        availableSlots: allPersonas.length - occupiedCount,
        totalQueued,
      },
    });
  } catch (error) {
    console.error("Error fetching persona slots:", error);
    return res.status(500).json({ error: "Failed to fetch persona slots" });
  }
});

export default router;
