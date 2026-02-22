/**
 * Cost Tracker Service
 *
 * Tracks and records costs for AI Worker tasks.
 * Uses idempotency to prevent double-counting.
 */

import type { DataSource } from "typeorm";
import { WorkerTask, Organization } from "../models/index.js";
import { logger } from "../utils/logger.js";

interface CostUpdateResult {
  taskCost: number;
  newCumulativeCost: number;
  warningFlags: string[];
}

export class CostTracker {
  constructor(private dataSource: DataSource) {}

  /**
   * Record cost for a task and update organization cumulative cost.
   * Uses idempotency check (usageReportedAt) to prevent double-counting.
   */
  async recordTaskCost(taskId: string): Promise<CostUpdateResult> {
    const taskRepo = this.dataSource.getRepository(WorkerTask);
    const orgRepo = this.dataSource.getRepository(Organization);

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const warningFlags: string[] = [];

    // Calculate cost using task's calculateCost method
    const taskCost = task.calculateCost();

    // Warning: suspicious cost data (5+ min runtime but 0 tokens)
    if (
      task.ecsTaskSeconds > 300 &&
      task.inputTokens === 0 &&
      task.outputTokens === 0
    ) {
      warningFlags.push("ZERO_TOKENS_AFTER_5MIN");
      logger.warn("Suspicious cost data: 0 tokens after 5+ min runtime", {
        taskId,
        ecsTaskSeconds: task.ecsTaskSeconds,
      });
    }

    // Idempotency: skip org update if already reported with non-zero usage.
    // If usageReportedAt is set but cost/tokens were zero (premature call before
    // token finalization), allow re-reporting so real costs aren't lost.
    if (task.usageReportedAt) {
      const previousCostWasZero =
        (Number(task.estimatedCostUsd) || 0) === 0 &&
        (task.inputTokens || 0) === 0 &&
        (task.outputTokens || 0) === 0;

      if (!previousCostWasZero) {
        logger.info("Cost already reported for task, skipping org update", {
          taskId,
          usageReportedAt: task.usageReportedAt,
          existingCost: task.estimatedCostUsd,
        });
        const org = await orgRepo.findOne({ where: { id: task.orgId } });
        return {
          taskCost: Number(task.estimatedCostUsd) || taskCost,
          newCumulativeCost: Number(org?.cumulativeCostUsd || 0),
          warningFlags,
        };
      }

      // Previous report recorded $0 with 0 tokens — allow re-reporting
      logger.info(
        "Previous cost report was $0 with 0 tokens, allowing re-report",
        {
          taskId,
          usageReportedAt: task.usageReportedAt,
          newCost: taskCost,
          inputTokens: task.inputTokens,
          outputTokens: task.outputTokens,
        },
      );
    }

    // If current cost is $0 and tokens are 0, don't mark as reported yet —
    // wait for token finalization so the real cost can be recorded later.
    if (
      taskCost === 0 &&
      (task.inputTokens || 0) === 0 &&
      (task.outputTokens || 0) === 0
    ) {
      logger.info(
        "Skipping usageReportedAt — $0 cost with 0 tokens, waiting for finalization",
        { taskId },
      );
      const org = await orgRepo.findOne({ where: { id: task.orgId } });
      return {
        taskCost: 0,
        newCumulativeCost: Number(org?.cumulativeCostUsd || 0),
        warningFlags: [...warningFlags, "ZERO_COST_DEFERRED"],
      };
    }

    // TRANSACTION: Update task cost and org cumulative cost atomically.
    // This prevents the scenario where task is marked as reported but org cost
    // isn't updated (if process crashes between the two operations).
    const result = await this.dataSource.transaction(async (transactionalEntityManager) => {
      const txTaskRepo = transactionalEntityManager.getRepository(WorkerTask);
      const txOrgRepo = transactionalEntityManager.getRepository(Organization);

      // Update task with cost and mark as reported
      task.estimatedCostUsd = taskCost;
      task.usageReportedAt = new Date();
      await txTaskRepo.save(task);

      // Use billingOrgId for cost attribution (platform tasks bill to platform org)
      const billingOrgId = task.getBillingOrgId();
      const org = await txOrgRepo.findOne({ where: { id: billingOrgId } });
      if (org) {
        const previousCost = Number(org.cumulativeCostUsd || 0);
        org.cumulativeCostUsd = previousCost + taskCost;
        await txOrgRepo.save(org);

        logger.info("Org cumulative cost updated", {
          taskId,
          billingOrgId,
          isPlatformTask: task.isPlatformTask,
          taskCost: taskCost.toFixed(4),
          previousCost: previousCost.toFixed(4),
          newCumulativeCost: org.cumulativeCostUsd.toFixed(4),
        });

        return {
          taskCost,
          newCumulativeCost: org.cumulativeCostUsd,
        };
      }

      return {
        taskCost,
        newCumulativeCost: 0,
      };
    });

    return {
      taskCost: result.taskCost,
      newCumulativeCost: result.newCumulativeCost,
      warningFlags,
    };
  }

  /**
   * Recalculate cost for a task without updating organization cumulative.
   * Useful for correcting cost after token data is updated.
   */
  async recalculateTaskCost(taskId: string): Promise<number> {
    const taskRepo = this.dataSource.getRepository(WorkerTask);

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const newCost = task.calculateCost();
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ estimatedCostUsd: newCost } as Record<string, unknown>)
      .where("id = :id", { id: taskId })
      .execute();

    logger.info("Task cost recalculated", {
      taskId,
      newCost: newCost.toFixed(4),
    });

    return newCost;
  }

  /**
   * Update token counts for a task.
   * Called when worker reports usage via API.
   */
  async updateTaskUsage(
    taskId: string,
    usage: {
      inputTokens?: number;
      outputTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      ecsTaskSeconds?: number;
    }
  ): Promise<WorkerTask> {
    const taskRepo = this.dataSource.getRepository(WorkerTask);

    // Atomic increment — prevents lost updates from concurrent worker reports
    // Uses raw SQL because TypeORM query builder doesn't support COALESCE increments
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (usage.inputTokens !== undefined) {
      setClauses.push(`"inputTokens" = COALESCE("inputTokens", 0) + $${paramIdx++}`);
      values.push(usage.inputTokens);
    }
    if (usage.outputTokens !== undefined) {
      setClauses.push(`"outputTokens" = COALESCE("outputTokens", 0) + $${paramIdx++}`);
      values.push(usage.outputTokens);
    }
    if (usage.cacheCreationTokens !== undefined) {
      setClauses.push(`"cacheCreationTokens" = COALESCE("cacheCreationTokens", 0) + $${paramIdx++}`);
      values.push(usage.cacheCreationTokens);
    }
    if (usage.cacheReadTokens !== undefined) {
      setClauses.push(`"cacheReadTokens" = COALESCE("cacheReadTokens", 0) + $${paramIdx++}`);
      values.push(usage.cacheReadTokens);
    }
    if (usage.ecsTaskSeconds !== undefined) {
      setClauses.push(`"ecsTaskSeconds" = $${paramIdx++}`);
      values.push(usage.ecsTaskSeconds);
    }

    if (setClauses.length > 0) {
      values.push(taskId);
      await this.dataSource.query(
        `UPDATE "worker_tasks" SET ${setClauses.join(", ")} WHERE "id" = $${paramIdx}`,
        values,
      );
    }

    // Re-fetch with accurate totals and recalculate cost
    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const newCost = task.calculateCost();
    await taskRepo
      .createQueryBuilder()
      .update(WorkerTask)
      .set({ estimatedCostUsd: newCost } as Record<string, unknown>)
      .where("id = :id", { id: taskId })
      .execute();
    task.estimatedCostUsd = newCost;

    logger.debug("Task usage updated", {
      taskId,
      inputTokens: task.inputTokens,
      outputTokens: task.outputTokens,
      estimatedCost: task.estimatedCostUsd,
    });

    return task;
  }

  /**
   * Reset organization cost counter
   */
  async resetOrgCost(orgId: string): Promise<void> {
    const orgRepo = this.dataSource.getRepository(Organization);

    const org = await orgRepo.findOne({ where: { id: orgId } });
    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    const previousCost = org.cumulativeCostUsd;
    org.cumulativeCostUsd = 0;
    org.costResetAt = new Date();
    await orgRepo.save(org);

    logger.info("Organization cost reset", {
      orgId,
      previousCost,
    });
  }

  /**
   * Get today's cost for an organization
   */
  async getTodayCost(orgId: string): Promise<number> {
    const taskRepo = this.dataSource.getRepository(WorkerTask);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const result = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "sum")
      .where("task.org_id = :orgId", { orgId })
      .andWhere("task.created_at >= :todayStart", { todayStart })
      .getRawOne<{ sum: string }>();

    return Number(result?.sum || 0);
  }
}

// Singleton instance
let costTrackerInstance: CostTracker | null = null;

export function getCostTracker(dataSource?: DataSource): CostTracker {
  if (!costTrackerInstance && dataSource) {
    costTrackerInstance = new CostTracker(dataSource);
  }
  if (!costTrackerInstance) {
    throw new Error(
      "CostTracker not initialized - provide dataSource on first call"
    );
  }
  return costTrackerInstance;
}
