/**
 * Management Dashboard Service
 *
 * Provides platform-level statistics, customer data, and ROI calculations
 * for the WorkerMill management tenant dashboard.
 */

import { AppDataSource } from "../db/connection.js";
import {
  Organization,
  WorkerTask,
  User,
  SupportTicket,
  CreditTransaction,
} from "../models/index.js";
import { logger } from "../utils/logger.js";

// =========================================================================
// Types
// =========================================================================

export interface PlatformStats {
  // Customer metrics
  totalCustomers: number;
  activeCustomers: number; // Had task in last 30 days
  customersByPlan: Record<string, number>;
  newCustomersThisMonth: number;

  // Task metrics
  totalTasks: number;
  tasksThisMonth: number;
  avgTasksPerCustomer: number;

  // Support metrics
  openTickets: number;
  avgResolutionTimeHours: number | null;
  supportTasksThisMonth: number;

  // Financial metrics
  platformCostsThisMonth: number; // Support agent costs
  customerRevenueThisMonth: number; // Subscriptions + credits
  netMarginThisMonth: number;
  lifetimeRevenue: number;
  lifetimePlatformCosts: number;
}

export interface CustomerSummary {
  id: string;
  name: string;
  slug: string | null;
  plan: string;
  createdAt: Date;
  cumulativeCostUsd: number;
  stripeSubscriptionStatus: string | null;
  userCount: number;
  taskCount: number;
  lastTaskAt: Date | null;
  primaryProvider: string;
  scmProvider: string;
  creditBalanceCents: number;
}

export interface ROIMetrics {
  thisMonth: {
    revenue: number;
    costs: number;
    roi: number;
    margin: number;
  };
  lastMonth: {
    revenue: number;
    costs: number;
    roi: number;
    margin: number;
  };
  lifetime: {
    revenue: number;
    costs: number;
    roi: number;
    margin: number;
  };
  trend: "up" | "down" | "stable";
}

export interface PlatformCosts {
  thisMonth: number;
  lastMonth: number;
  byCategory: {
    supportAgents: number;
    infrastructure: number;
  };
  topCostTasks: {
    taskId: string;
    summary: string;
    cost: number;
    createdAt: Date;
  }[];
}

export interface PlatformRevenue {
  thisMonth: number;
  lastMonth: number;
  byType: {
    subscriptions: number;
    credits: number;
    overages: number;
  };
  topCustomers: {
    orgId: string;
    orgName: string;
    revenue: number;
  }[];
}

// =========================================================================
// Implementation
// =========================================================================

/**
 * Get platform org for queries
 */
async function getPlatformOrgId(): Promise<string | null> {
  const platformOrg = await Organization.getPlatformOrg();
  return platformOrg?.id ?? null;
}

/**
 * Calculate comprehensive platform statistics
 */
export async function calculatePlatformStats(): Promise<PlatformStats> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const ticketRepo = AppDataSource.getRepository(SupportTicket);
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const platformOrgId = await getPlatformOrgId();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Customer counts (excluding platform org)
  const totalCustomers = await orgRepo.count({
    where: { isPlatformOrg: false },
  });

  // Customers with activity in last 30 days
  const activeCustomersResult = await taskRepo
    .createQueryBuilder("task")
    .select("COUNT(DISTINCT task.org_id)", "count")
    .innerJoin("organizations", "org", "org.id = task.org_id AND org.is_platform_org = false")
    .where("task.created_at >= :thirtyDaysAgo", { thirtyDaysAgo })
    .getRawOne();
  const activeCustomers = parseInt(activeCustomersResult?.count || "0", 10);

  // Customers by plan
  const planCounts = await orgRepo
    .createQueryBuilder("org")
    .select("org.plan", "plan")
    .addSelect("COUNT(*)", "count")
    .where("org.is_platform_org = false")
    .groupBy("org.plan")
    .getRawMany();
  const customersByPlan: Record<string, number> = {};
  for (const row of planCounts) {
    customersByPlan[row.plan] = parseInt(row.count, 10);
  }

  // New customers this month
  const newCustomersThisMonth = await orgRepo.count({
    where: { isPlatformOrg: false },
  });
  // Refine with date filter
  const newCustomersResult = await orgRepo
    .createQueryBuilder("org")
    .where("org.is_platform_org = false")
    .andWhere("org.created_at >= :monthStart", { monthStart })
    .getCount();

  // Task counts
  const totalTasks = await taskRepo.count();
  const tasksThisMonth = await taskRepo
    .createQueryBuilder("task")
    .where("task.created_at >= :monthStart", { monthStart })
    .getCount();
  const avgTasksPerCustomer = totalCustomers > 0 ? totalTasks / totalCustomers : 0;

  // Support metrics
  const openTickets = await ticketRepo.count({
    where: [{ status: "open" }, { status: "in_progress" }],
  });

  // Average resolution time (tickets resolved in last 30 days)
  const avgResolutionResult = await ticketRepo
    .createQueryBuilder("ticket")
    .select(
      "AVG(EXTRACT(EPOCH FROM (ticket.resolved_at - ticket.created_at)) / 3600)",
      "avgHours"
    )
    .where("ticket.resolved_at IS NOT NULL")
    .andWhere("ticket.resolved_at >= :thirtyDaysAgo", { thirtyDaysAgo })
    .getRawOne();
  const avgResolutionTimeHours = avgResolutionResult?.avgHours
    ? parseFloat(avgResolutionResult.avgHours)
    : null;

  // Support tasks this month (platform tasks)
  const supportTasksThisMonth = platformOrgId
    ? await taskRepo
        .createQueryBuilder("task")
        .where("task.billing_org_id = :platformOrgId", { platformOrgId })
        .andWhere("task.created_at >= :monthStart", { monthStart })
        .getCount()
    : 0;

  // Platform costs this month (tasks billed to platform org)
  let platformCostsThisMonth = 0;
  if (platformOrgId) {
    const costResult = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .andWhere("task.created_at >= :monthStart", { monthStart })
      .getRawOne();
    platformCostsThisMonth = parseFloat(costResult?.total || "0");
  }

  // Revenue this month (credit transactions: deposits + auto_recharge)
  const revenueResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .andWhere("tx.created_at >= :monthStart", { monthStart })
    .getRawOne();
  const customerRevenueThisMonth = parseFloat(revenueResult?.total || "0") / 100; // Convert cents to dollars

  // Lifetime revenue
  const lifetimeRevenueResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .getRawOne();
  const lifetimeRevenue = parseFloat(lifetimeRevenueResult?.total || "0") / 100;

  // Lifetime platform costs
  let lifetimePlatformCosts = 0;
  if (platformOrgId) {
    const lifetimeCostResult = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .getRawOne();
    lifetimePlatformCosts = parseFloat(lifetimeCostResult?.total || "0");
  }

  const netMarginThisMonth = customerRevenueThisMonth - platformCostsThisMonth;

  return {
    totalCustomers,
    activeCustomers,
    customersByPlan,
    newCustomersThisMonth: newCustomersResult,
    totalTasks,
    tasksThisMonth,
    avgTasksPerCustomer,
    openTickets,
    avgResolutionTimeHours,
    supportTasksThisMonth,
    platformCostsThisMonth,
    customerRevenueThisMonth,
    netMarginThisMonth,
    lifetimeRevenue,
    lifetimePlatformCosts,
  };
}

/**
 * Get all customers with summary details
 */
export async function getCustomerSummaries(): Promise<CustomerSummary[]> {
  const result = await AppDataSource.query(`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.plan,
      o.created_at as "createdAt",
      COALESCE(o.cumulative_cost_usd, 0) as "cumulativeCostUsd",
      o.stripe_subscription_status as "stripeSubscriptionStatus",
      o.primary_provider as "primaryProvider",
      o.scm_provider as "scmProvider",
      COALESCE(o.credit_balance_cents, 0) as "creditBalanceCents",
      (
        SELECT COUNT(*)
        FROM user_organizations uo
        WHERE uo.org_id = o.id
      ) as "userCount",
      (
        SELECT COUNT(*)
        FROM worker_tasks t
        WHERE t.org_id = o.id
      ) as "taskCount",
      (
        SELECT MAX(t.created_at)
        FROM worker_tasks t
        WHERE t.org_id = o.id
      ) as "lastTaskAt"
    FROM organizations o
    WHERE o.is_platform_org = false
    ORDER BY o.created_at DESC
  `);

  return result.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string | null,
    plan: row.plan as string,
    createdAt: new Date(row.createdAt as string),
    cumulativeCostUsd: parseFloat(row.cumulativeCostUsd as string || "0"),
    stripeSubscriptionStatus: row.stripeSubscriptionStatus as string | null,
    userCount: parseInt(row.userCount as string, 10),
    taskCount: parseInt(row.taskCount as string, 10),
    lastTaskAt: row.lastTaskAt ? new Date(row.lastTaskAt as string) : null,
    primaryProvider: row.primaryProvider as string || "anthropic",
    scmProvider: row.scmProvider as string || "github",
    creditBalanceCents: parseInt(row.creditBalanceCents as string, 10),
  }));
}

/**
 * Calculate ROI metrics
 */
export async function calculateROI(): Promise<ROIMetrics> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const platformOrgId = await getPlatformOrgId();
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  // Helper function to get costs for a date range
  const getCosts = async (start: Date, end: Date): Promise<number> => {
    if (!platformOrgId) return 0;
    const result = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .andWhere("task.created_at >= :start", { start })
      .andWhere("task.created_at <= :end", { end })
      .getRawOne();
    return parseFloat(result?.total || "0");
  };

  // Helper function to get revenue for a date range
  const getRevenue = async (start: Date, end: Date): Promise<number> => {
    const result = await txRepo
      .createQueryBuilder("tx")
      .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
      .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
      .andWhere("tx.created_at >= :start", { start })
      .andWhere("tx.created_at <= :end", { end })
      .getRawOne();
    return parseFloat(result?.total || "0") / 100; // Convert cents to dollars
  };

  // Calculate metrics for each period
  const thisMonthCosts = await getCosts(thisMonthStart, now);
  const thisMonthRevenue = await getRevenue(thisMonthStart, now);
  const lastMonthCosts = await getCosts(lastMonthStart, lastMonthEnd);
  const lastMonthRevenue = await getRevenue(lastMonthStart, lastMonthEnd);

  // Lifetime
  const lifetimeCostsResult = await taskRepo
    .createQueryBuilder("task")
    .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
    .where(platformOrgId ? "task.billing_org_id = :platformOrgId" : "1=0", { platformOrgId })
    .getRawOne();
  const lifetimeCosts = parseFloat(lifetimeCostsResult?.total || "0");

  const lifetimeRevenueResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .getRawOne();
  const lifetimeRevenue = parseFloat(lifetimeRevenueResult?.total || "0") / 100;

  // Calculate ROI and margin
  const calcROI = (revenue: number, costs: number): number => {
    if (costs === 0) return 0;
    return ((revenue - costs) / costs) * 100;
  };

  const calcMargin = (revenue: number, costs: number): number => {
    if (revenue === 0) return 0;
    return ((revenue - costs) / revenue) * 100;
  };

  // Determine trend
  const thisMonthROI = calcROI(thisMonthRevenue, thisMonthCosts);
  const lastMonthROI = calcROI(lastMonthRevenue, lastMonthCosts);
  let trend: "up" | "down" | "stable" = "stable";
  if (thisMonthROI > lastMonthROI + 5) trend = "up";
  else if (thisMonthROI < lastMonthROI - 5) trend = "down";

  return {
    thisMonth: {
      revenue: thisMonthRevenue,
      costs: thisMonthCosts,
      roi: calcROI(thisMonthRevenue, thisMonthCosts),
      margin: calcMargin(thisMonthRevenue, thisMonthCosts),
    },
    lastMonth: {
      revenue: lastMonthRevenue,
      costs: lastMonthCosts,
      roi: calcROI(lastMonthRevenue, lastMonthCosts),
      margin: calcMargin(lastMonthRevenue, lastMonthCosts),
    },
    lifetime: {
      revenue: lifetimeRevenue,
      costs: lifetimeCosts,
      roi: calcROI(lifetimeRevenue, lifetimeCosts),
      margin: calcMargin(lifetimeRevenue, lifetimeCosts),
    },
    trend,
  };
}

/**
 * Get platform cost breakdown
 */
export async function getPlatformCosts(): Promise<PlatformCosts> {
  const taskRepo = AppDataSource.getRepository(WorkerTask);
  const platformOrgId = await getPlatformOrgId();

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  // This month costs
  let thisMonth = 0;
  let lastMonth = 0;
  let supportAgents = 0;

  if (platformOrgId) {
    const thisMonthResult = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .andWhere("task.created_at >= :start", { start: thisMonthStart })
      .getRawOne();
    thisMonth = parseFloat(thisMonthResult?.total || "0");

    const lastMonthResult = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .andWhere("task.created_at >= :start", { start: lastMonthStart })
      .andWhere("task.created_at <= :end", { end: lastMonthEnd })
      .getRawOne();
    lastMonth = parseFloat(lastMonthResult?.total || "0");

    // Support agent costs specifically
    const supportResult = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.estimated_cost_usd), 0)", "total")
      .where("task.billing_org_id = :platformOrgId", { platformOrgId })
      .andWhere("task.worker_persona = :persona", { persona: "support_agent" })
      .andWhere("task.created_at >= :start", { start: thisMonthStart })
      .getRawOne();
    supportAgents = parseFloat(supportResult?.total || "0");
  }

  // Top cost tasks
  const topCostTasks = platformOrgId
    ? await taskRepo
        .createQueryBuilder("task")
        .select(["task.id", "task.summary", "task.estimatedCostUsd", "task.createdAt"])
        .where("task.billing_org_id = :platformOrgId", { platformOrgId })
        .orderBy("task.estimated_cost_usd", "DESC")
        .limit(10)
        .getMany()
    : [];

  return {
    thisMonth,
    lastMonth,
    byCategory: {
      supportAgents,
      infrastructure: thisMonth - supportAgents, // Rough estimate
    },
    topCostTasks: topCostTasks.map((t) => ({
      taskId: t.id,
      summary: t.summary,
      cost: Number(t.estimatedCostUsd),
      createdAt: t.createdAt,
    })),
  };
}

/**
 * Get platform revenue breakdown
 */
export async function getPlatformRevenue(): Promise<PlatformRevenue> {
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  // This month revenue
  const thisMonthResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .andWhere("tx.created_at >= :start", { start: thisMonthStart })
    .getRawOne();
  const thisMonth = parseFloat(thisMonthResult?.total || "0") / 100;

  // Last month revenue
  const lastMonthResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .andWhere("tx.created_at >= :start", { start: lastMonthStart })
    .andWhere("tx.created_at <= :end", { end: lastMonthEnd })
    .getRawOne();
  const lastMonth = parseFloat(lastMonthResult?.total || "0") / 100;

  // Revenue by type (this month)
  const depositsResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type = :type", { type: "deposit" })
    .andWhere("tx.created_at >= :start", { start: thisMonthStart })
    .getRawOne();
  const deposits = parseFloat(depositsResult?.total || "0") / 100;

  const autoRechargeResult = await txRepo
    .createQueryBuilder("tx")
    .select("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type = :type", { type: "auto_recharge" })
    .andWhere("tx.created_at >= :start", { start: thisMonthStart })
    .getRawOne();
  const autoRecharge = parseFloat(autoRechargeResult?.total || "0") / 100;

  // Top customers by revenue
  const topCustomersResult = await txRepo
    .createQueryBuilder("tx")
    .select("tx.org_id", "orgId")
    .addSelect("COALESCE(SUM(tx.amount_cents), 0)", "total")
    .where("tx.type IN (:...types)", { types: ["deposit", "auto_recharge"] })
    .andWhere("tx.created_at >= :start", { start: thisMonthStart })
    .groupBy("tx.org_id")
    .orderBy("total", "DESC")
    .limit(10)
    .getRawMany();

  // Get org names for top customers
  const orgRepo = AppDataSource.getRepository(Organization);
  const topCustomers = await Promise.all(
    topCustomersResult.map(async (row: { orgId: string; total: string }) => {
      const org = await orgRepo.findOne({ where: { id: row.orgId } });
      return {
        orgId: row.orgId,
        orgName: org?.name || "Unknown",
        revenue: parseFloat(row.total) / 100,
      };
    })
  );

  return {
    thisMonth,
    lastMonth,
    byType: {
      subscriptions: 0, // TODO: Integrate with Stripe subscription data
      credits: deposits + autoRecharge,
      overages: 0, // TODO: Track overages separately
    },
    topCustomers,
  };
}
