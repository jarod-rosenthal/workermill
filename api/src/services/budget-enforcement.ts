/**
 * Budget Enforcement Service
 *
 * Checks if an organization's spending is within budget limits.
 * Used by the orchestrator to pause task execution when budgets are exceeded.
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { Organization } from "../models/Organization.js";
import { MoreThanOrEqual } from "typeorm";
import { logger } from "../utils/logger.js";

export interface BudgetStatus {
  withinBudget: boolean;
  violations: BudgetViolation[];
  spending: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  limits: {
    daily: number | null;
    weekly: number | null;
    monthly: number | null;
  };
}

export interface BudgetViolation {
  period: "daily" | "weekly" | "monthly";
  limit: number;
  spent: number;
  exceededBy: number;
}

/**
 * Get the start of today (midnight)
 */
function getStartOfDay(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Get the start of the current week (Monday at midnight)
 */
function getStartOfWeek(): Date {
  const now = new Date();
  const dayOfWeek = now.getDay();
  // Adjust so Monday is the first day (Sunday = 0, so shift to make Monday = 0)
  const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToSubtract);
  return startOfWeek;
}

/**
 * Get the start of the current month
 */
function getStartOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Calculate spending for an organization over a given time period
 */
async function calculateSpending(orgId: string, since: Date): Promise<number> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);

  const result = await taskRepo
    .createQueryBuilder("task")
    .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
    .where("task.org_id = :orgId", { orgId })
    .andWhere("task.status IN (:...statuses)", {
      statuses: ["completed", "deployed", "failed"],
    })
    .andWhere("task.updated_at >= :since", { since })
    .getRawOne();

  return parseFloat(result?.total || "0");
}

/**
 * Check if an organization is within its budget limits
 */
export async function checkBudget(org: Organization): Promise<BudgetStatus> {
  const violations: BudgetViolation[] = [];

  // Calculate spending for each period
  const dailySpending = await calculateSpending(org.id, getStartOfDay());
  const weeklySpending = await calculateSpending(org.id, getStartOfWeek());
  const monthlySpending = await calculateSpending(org.id, getStartOfMonth());

  const spending = {
    daily: dailySpending,
    weekly: weeklySpending,
    monthly: monthlySpending,
  };

  const limits = {
    daily: org.dailyBudgetLimitUsd,
    weekly: org.weeklyBudgetLimitUsd,
    monthly: org.monthlyBudgetLimitUsd,
  };

  // Check daily limit
  if (org.dailyBudgetLimitUsd !== null && dailySpending >= org.dailyBudgetLimitUsd) {
    violations.push({
      period: "daily",
      limit: org.dailyBudgetLimitUsd,
      spent: dailySpending,
      exceededBy: dailySpending - org.dailyBudgetLimitUsd,
    });
  }

  // Check weekly limit
  if (org.weeklyBudgetLimitUsd !== null && weeklySpending >= org.weeklyBudgetLimitUsd) {
    violations.push({
      period: "weekly",
      limit: org.weeklyBudgetLimitUsd,
      spent: weeklySpending,
      exceededBy: weeklySpending - org.weeklyBudgetLimitUsd,
    });
  }

  // Check monthly limit
  if (org.monthlyBudgetLimitUsd !== null && monthlySpending >= org.monthlyBudgetLimitUsd) {
    violations.push({
      period: "monthly",
      limit: org.monthlyBudgetLimitUsd,
      spent: monthlySpending,
      exceededBy: monthlySpending - org.monthlyBudgetLimitUsd,
    });
  }

  const status: BudgetStatus = {
    withinBudget: violations.length === 0,
    violations,
    spending,
    limits,
  };

  if (violations.length > 0) {
    logger.warn("Organization budget exceeded", {
      orgId: org.id,
      orgName: org.name,
      violations: violations.map((v) => ({
        period: v.period,
        limit: v.limit,
        spent: v.spent.toFixed(2),
      })),
    });
  }

  return status;
}

/**
 * Check if budget override is active
 */
export function isBudgetOverrideActive(org: Organization): boolean {
  if (!org.budgetOverrideUntil) {
    return false;
  }
  return new Date() < new Date(org.budgetOverrideUntil);
}

/**
 * Check if an organization can start a new task based on budget
 * Returns a simple boolean for quick checks
 */
export async function canStartTaskWithinBudget(org: Organization): Promise<boolean> {
  // Check if budget override is active
  if (isBudgetOverrideActive(org)) {
    logger.info("Budget override active - bypassing budget check", {
      orgId: org.id,
      budgetOverrideUntil: org.budgetOverrideUntil,
      budgetOverrideReason: org.budgetOverrideReason,
    });
    return true;
  }

  // If no budget limits are set, allow
  if (
    org.dailyBudgetLimitUsd === null &&
    org.weeklyBudgetLimitUsd === null &&
    org.monthlyBudgetLimitUsd === null
  ) {
    return true;
  }

  const status = await checkBudget(org);
  return status.withinBudget;
}

/**
 * Get budget status with spending projections
 * Used for dashboard display
 */
export async function getBudgetStatusWithProjections(org: Organization): Promise<{
  status: BudgetStatus;
  projections: {
    dailyRemaining: number | null;
    weeklyRemaining: number | null;
    monthlyRemaining: number | null;
    dailyPctUsed: number | null;
    weeklyPctUsed: number | null;
    monthlyPctUsed: number | null;
  };
}> {
  const status = await checkBudget(org);

  const projections = {
    dailyRemaining: org.dailyBudgetLimitUsd !== null ? Math.max(0, org.dailyBudgetLimitUsd - status.spending.daily) : null,
    weeklyRemaining: org.weeklyBudgetLimitUsd !== null ? Math.max(0, org.weeklyBudgetLimitUsd - status.spending.weekly) : null,
    monthlyRemaining: org.monthlyBudgetLimitUsd !== null ? Math.max(0, org.monthlyBudgetLimitUsd - status.spending.monthly) : null,
    dailyPctUsed: org.dailyBudgetLimitUsd !== null && org.dailyBudgetLimitUsd > 0 ? (status.spending.daily / org.dailyBudgetLimitUsd) * 100 : null,
    weeklyPctUsed: org.weeklyBudgetLimitUsd !== null && org.weeklyBudgetLimitUsd > 0 ? (status.spending.weekly / org.weeklyBudgetLimitUsd) * 100 : null,
    monthlyPctUsed: org.monthlyBudgetLimitUsd !== null && org.monthlyBudgetLimitUsd > 0 ? (status.spending.monthly / org.monthlyBudgetLimitUsd) * 100 : null,
  };

  return { status, projections };
}
