/**
 * Management Dashboard Routes
 *
 * Platform-level management routes for WorkerMill administrators.
 * All routes require platform admin access.
 */

import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/platform-auth.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask, SupportTicket, Organization } from "../models/index.js";
import {
  calculatePlatformStats,
  getCustomerSummaries,
  calculateROI,
  getPlatformCosts,
  getPlatformRevenue,
} from "../services/management-dashboard.js";
import { logger } from "../utils/logger.js";

const router = Router();

// Apply authentication and platform admin check to all routes
router.use(authenticateUser);
router.use(requirePlatformAdmin);

/**
 * GET /api/management/stats
 * Get platform-level statistics
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await calculatePlatformStats();
    res.json(stats);
  } catch (error) {
    logger.error("Failed to get platform stats", { error });
    res.status(500).json({ error: "Failed to retrieve platform statistics" });
  }
});

/**
 * GET /api/management/customers
 * Get all customers with summary details
 */
router.get("/customers", async (_req: Request, res: Response) => {
  try {
    const customers = await getCustomerSummaries();
    res.json({ customers });
  } catch (error) {
    logger.error("Failed to get customer summaries", { error });
    res.status(500).json({ error: "Failed to retrieve customer list" });
  }
});

/**
 * GET /api/management/customers/:id
 * Get detailed information about a specific customer
 */
router.get("/customers/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id } });

    if (!org) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    if (org.isPlatformOrg) {
      res.status(400).json({ error: "Cannot view platform organization as customer" });
      return;
    }

    // Get additional stats for this customer
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    const taskCount = await taskRepo.count({ where: { orgId: id } });
    const completedTasks = await taskRepo.count({
      where: { orgId: id, status: "completed" },
    });
    const failedTasks = await taskRepo.count({
      where: { orgId: id, status: "failed" },
    });

    const recentTasks = await taskRepo.find({
      where: { orgId: id },
      order: { createdAt: "DESC" },
      take: 10,
      select: ["id", "jiraIssueKey", "summary", "status", "createdAt", "completedAt", "estimatedCostUsd"],
    });

    res.json({
      customer: org,
      stats: {
        taskCount,
        completedTasks,
        failedTasks,
        successRate: taskCount > 0 ? (completedTasks / taskCount) * 100 : 0,
      },
      recentTasks,
    });
  } catch (error) {
    logger.error("Failed to get customer details", { error, customerId: req.params.id });
    res.status(500).json({ error: "Failed to retrieve customer details" });
  }
});

/**
 * GET /api/management/roi
 * Get ROI metrics
 */
router.get("/roi", async (_req: Request, res: Response) => {
  try {
    const roi = await calculateROI();
    res.json(roi);
  } catch (error) {
    logger.error("Failed to calculate ROI", { error });
    res.status(500).json({ error: "Failed to calculate ROI metrics" });
  }
});

/**
 * GET /api/management/costs
 * Get platform cost breakdown
 */
router.get("/costs", async (_req: Request, res: Response) => {
  try {
    const costs = await getPlatformCosts();
    res.json(costs);
  } catch (error) {
    logger.error("Failed to get platform costs", { error });
    res.status(500).json({ error: "Failed to retrieve cost breakdown" });
  }
});

/**
 * GET /api/management/revenue
 * Get revenue breakdown
 */
router.get("/revenue", async (_req: Request, res: Response) => {
  try {
    const revenue = await getPlatformRevenue();
    res.json(revenue);
  } catch (error) {
    logger.error("Failed to get platform revenue", { error });
    res.status(500).json({ error: "Failed to retrieve revenue breakdown" });
  }
});

/**
 * GET /api/management/support-queue
 * Get all open support tickets across all customers
 */
router.get("/support-queue", async (_req: Request, res: Response) => {
  try {
    const ticketRepo = AppDataSource.getRepository(SupportTicket);
    const orgRepo = AppDataSource.getRepository(Organization);

    const tickets = await ticketRepo.find({
      where: [{ status: "open" }, { status: "in_progress" }],
      order: { createdAt: "DESC" },
      take: 50,
    });

    // Enrich with org names
    const enrichedTickets = await Promise.all(
      tickets.map(async (ticket) => {
        const org = await orgRepo.findOne({ where: { id: ticket.orgId } });
        return {
          ...ticket,
          orgName: org?.name || "Unknown",
          orgSlug: org?.slug || null,
        };
      })
    );

    res.json({ tickets: enrichedTickets });
  } catch (error) {
    logger.error("Failed to get support queue", { error });
    res.status(500).json({ error: "Failed to retrieve support queue" });
  }
});

/**
 * GET /api/management/platform-tasks
 * Get platform-initiated tasks (support agents, etc.)
 */
router.get("/platform-tasks", async (req: Request, res: Response) => {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      res.json({ tasks: [] });
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const orgRepo = AppDataSource.getRepository(Organization);

    const limit = parseInt(req.query.limit as string) || 50;

    const tasks = await taskRepo.find({
      where: { billingOrgId: platformOrg.id },
      order: { createdAt: "DESC" },
      take: limit,
    });

    // Enrich with customer org names
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        const customerOrg = await orgRepo.findOne({ where: { id: task.orgId } });
        return {
          id: task.id,
          jiraIssueKey: task.jiraIssueKey,
          summary: task.summary,
          status: task.status,
          workerPersona: task.workerPersona,
          estimatedCostUsd: task.estimatedCostUsd,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          customerOrgId: task.orgId,
          customerOrgName: customerOrg?.name || "Unknown",
          customerOrgSlug: customerOrg?.slug || null,
        };
      })
    );

    res.json({ tasks: enrichedTasks });
  } catch (error) {
    logger.error("Failed to get platform tasks", { error });
    res.status(500).json({ error: "Failed to retrieve platform tasks" });
  }
});

/**
 * GET /api/management/health
 * Get platform health status
 */
router.get("/health", async (_req: Request, res: Response) => {
  try {
    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Check for stuck tasks (running for more than 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stuckTasks = await taskRepo
      .createQueryBuilder("task")
      .where("task.status IN (:...statuses)", {
        statuses: ["executing", "environment_setup", "dispatching"],
      })
      .andWhere("task.started_at < :twoHoursAgo", { twoHoursAgo })
      .getCount();

    // Active tasks
    const activeTasks = await taskRepo.count({
      where: [
        { status: "executing" },
        { status: "environment_setup" },
        { status: "dispatching" },
        { status: "claimed" },
      ],
    });

    // Queue depth
    const queuedTasks = await taskRepo.count({ where: { status: "queued" } });

    // Recent failures (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentFailures = await taskRepo
      .createQueryBuilder("task")
      .where("task.status = :status", { status: "failed" })
      .andWhere("task.completed_at >= :oneHourAgo", { oneHourAgo })
      .getCount();

    const health = {
      status: stuckTasks > 0 || recentFailures > 10 ? "degraded" : "healthy",
      metrics: {
        activeTasks,
        queuedTasks,
        stuckTasks,
        recentFailures,
      },
      timestamp: new Date(),
    };

    res.json(health);
  } catch (error) {
    logger.error("Failed to get platform health", { error });
    res.status(500).json({
      status: "unknown",
      error: "Failed to check platform health",
    });
  }
});

export default router;
