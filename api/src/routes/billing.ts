/**
 * WorkerMill Billing Routes
 *
 * API endpoints for subscription management, usage tracking, and billing portal.
 */

import { Router, Request, Response, NextFunction } from "express";
import { Between } from "typeorm";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import {
  BadRequestError,
  InternalError,
  ServiceUnavailableError,
} from "../utils/errors.js";
import {
  getOrCreateStripeCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  getBillingInfo,
  canCreateTask,
} from "../services/billing.js";
import {
  type OrganizationPlan,
  PLAN_QUOTAS,
  PLAN_USER_LIMITS,
} from "../models/Organization.js";
import { body, query, validateRequest } from "../middleware/validation.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * @swagger
 * /api/billing/plans:
 *   get:
 *     summary: Get available pricing plans
 *     description: Returns all available subscription plans with pricing, quotas, and features
 *     tags: [Billing]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of available plans
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plans:
 *                   type: array
 *                   items:
 *                     $ref: '***REMOVED***/components/schemas/Plan'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/Error'
 */
router.get("/plans", async (_req: Request, res: Response) => {
  try {
    const plans = [
      {
        id: "free",
        name: "Free",
        price: 0,
        taskQuota: PLAN_QUOTAS.free,
        userLimit: PLAN_USER_LIMITS.free,
        features: ["10 tasks/month", "1 user", "BYOK only", "Community support"],
      },
      {
        id: "starter",
        name: "Starter",
        price: 99,
        taskQuota: PLAN_QUOTAS.starter,
        userLimit: PLAN_USER_LIMITS.starter,
        features: [
          "100 tasks/month",
          "5 users",
          "BYOK + bundled AI",
          "Email support",
          "Slack notifications",
        ],
      },
      {
        id: "pro",
        name: "Pro",
        price: 299,
        taskQuota: -1, // Unlimited
        userLimit: PLAN_USER_LIMITS.pro,
        features: [
          "Unlimited tasks",
          "20 users",
          "BYOK + $100 bundled credit",
          "Priority support",
          "Advanced analytics",
          "Custom integrations",
        ],
      },
      {
        id: "enterprise",
        name: "Enterprise",
        price: null, // Custom pricing
        taskQuota: -1, // Unlimited
        userLimit: -1, // Unlimited
        features: [
          "Unlimited tasks",
          "Unlimited users",
          "SSO/SAML",
          "Dedicated support",
          "SLA guarantee",
          "Private deployment",
          "Custom contracts",
        ],
      },
    ];

    res.json({ plans });
  } catch (error) {
    logger.error("Error getting plans", { error });
    res.status(500).json({ error: "Failed to get plans" });
  }
});

/**
 * @swagger
 * /api/billing/status:
 *   get:
 *     summary: Get current billing status
 *     description: Returns billing information, subscription status, usage quota, and payment details for the authenticated organization
 *     tags: [Billing]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current billing status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/BillingStatus'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '***REMOVED***/components/schemas/Error'
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    // Get billing info
    const billingInfo = await getBillingInfo(org);

    // Check if can create tasks
    const quotaCheck = await canCreateTask(org);

    res.json({
      plan: org.plan,
      usage: {
        tasks: billingInfo.usage.used,
        quota: billingInfo.usage.quota,
        percent: billingInfo.usage.unlimited
          ? 0
          : Math.round((billingInfo.usage.used / billingInfo.usage.quota) * 100),
        isUnlimited: billingInfo.usage.unlimited,
      },
      billing: {
        customerId: org.stripeCustomerId,
        subscriptionId: org.stripeSubscriptionId,
        subscriptionStatus: org.stripeSubscriptionStatus,
        billingCycleStart: org.billingCycleStart,
        hasPaymentMethod: billingInfo.hasPaymentMethod,
      },
      quotaStatus: {
        allowed: quotaCheck.allowed,
        reason: quotaCheck.reason,
      },
      stripeConfigured: !!config.stripe?.secretKey,
    });
  } catch (error) {
    logger.error("Error getting billing status", { error });
    res.status(500).json({ error: "Failed to get billing status" });
  }
});

/**
 * POST /api/billing/checkout
 * Create a Stripe checkout session for plan upgrade
 */
router.post(
  "/checkout",
  requireAdmin,
  body("plan")
    .isString()
    .isIn(["starter", "pro", "enterprise"])
    .withMessage("plan must be one of: starter, pro, enterprise"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;
    const user = req.user!;
    const { plan } = req.body as { plan: OrganizationPlan };

    // Create checkout session (also creates Stripe customer if needed)
    const successUrl = `${config.apiBaseUrl}/billing?success=true`;
    const cancelUrl = `${config.apiBaseUrl}/billing?canceled=true`;

    const session = await createCheckoutSession(
      org,
      user.email,
      plan,
      successUrl,
      cancelUrl
    );

    res.json({ url: session.url, sessionId: session.sessionId });
  })
);

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for subscription management
 */
router.post(
  "/portal",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;

    if (!org.stripeCustomerId) {
      throw new BadRequestError(
        "No billing account found. Please subscribe to a plan first."
      );
    }

    const returnUrl = `${config.apiBaseUrl}/billing`;
    const { url: portalUrl } = await createBillingPortalSession(org, returnUrl);

    res.json({ url: portalUrl });
  })
);

/**
 * GET /api/billing/usage
 * Get detailed usage statistics
 */
router.get("/usage", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const billingInfo = await getBillingInfo(org);

    // Calculate days until billing cycle reset
    let daysUntilReset = 0;
    if (org.billingCycleStart) {
      const cycleEnd = new Date(org.billingCycleStart);
      cycleEnd.setMonth(cycleEnd.getMonth() + 1);
      const msUntilReset = cycleEnd.getTime() - Date.now();
      daysUntilReset = Math.max(0, Math.ceil(msUntilReset / (1000 * 60 * 60 * 24)));
    }

    res.json({
      plan: billingInfo.plan,
      tasks: {
        used: billingInfo.usage.used,
        quota: billingInfo.usage.quota,
        remaining: billingInfo.usage.unlimited
          ? -1
          : Math.max(0, billingInfo.usage.quota - billingInfo.usage.used),
        percent: billingInfo.usage.unlimited
          ? 0
          : Math.round((billingInfo.usage.used / billingInfo.usage.quota) * 100),
        isUnlimited: billingInfo.usage.unlimited,
      },
      billingPeriod: {
        start: org.billingCycleStart,
        daysUntilReset,
      },
    });
  } catch (error) {
    logger.error("Error getting usage stats", { error });
    res.status(500).json({ error: "Failed to get usage statistics" });
  }
});

/**
 * GET /api/billing/cost-breakdown
 * Get detailed cost breakdown by model and persona
 */
router.get(
  "/cost-breakdown",
  query("startDate").optional().isISO8601().withMessage("startDate must be a valid ISO 8601 date"),
  query("endDate").optional().isISO8601().withMessage("endDate must be a valid ISO 8601 date"),
  validateRequest,
  async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    // Parse date range from query params, default to current month
    let startDate: Date;
    let endDate: Date;

    if (req.query.startDate) {
      startDate = new Date(req.query.startDate as string);
    } else {
      // Default to start of current month
      startDate = new Date();
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
    }

    if (req.query.endDate) {
      endDate = new Date(req.query.endDate as string);
    } else {
      // Default to now
      endDate = new Date();
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);

    // Query tasks in date range
    const tasks = await taskRepo.find({
      where: {
        orgId: org.id,
        createdAt: Between(startDate, endDate),
      },
      select: [
        "workerModel",
        "workerPersona",
        "estimatedCostUsd",
        "inputTokens",
        "outputTokens",
        "cacheCreationTokens",
        "cacheReadTokens",
      ],
    });

    // Calculate totals
    const totals = {
      cost: 0,
      tasks: tasks.length,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
    };

    for (const task of tasks) {
      // PostgreSQL decimal columns are returned as strings - must parse
      totals.cost += parseFloat(String(task.estimatedCostUsd)) || 0;
      totals.inputTokens += task.inputTokens || 0;
      totals.outputTokens += task.outputTokens || 0;
      totals.cacheTokens += (task.cacheCreationTokens || 0) + (task.cacheReadTokens || 0);
    }

    // Group by model
    const byModelMap = new Map<string, { cost: number; tasks: number }>();
    for (const task of tasks) {
      const model = task.workerModel || "unknown";
      const existing = byModelMap.get(model) || { cost: 0, tasks: 0 };
      existing.cost += parseFloat(String(task.estimatedCostUsd)) || 0;
      existing.tasks += 1;
      byModelMap.set(model, existing);
    }

    // Group by persona
    const byPersonaMap = new Map<string, { cost: number; tasks: number }>();
    for (const task of tasks) {
      const persona = task.workerPersona || "unknown";
      const existing = byPersonaMap.get(persona) || { cost: 0, tasks: 0 };
      existing.cost += parseFloat(String(task.estimatedCostUsd)) || 0;
      existing.tasks += 1;
      byPersonaMap.set(persona, existing);
    }

    // Convert maps to arrays
    const byModel = Array.from(byModelMap.entries()).map(([model, data]) => ({
      model,
      cost: Math.round(data.cost * 100) / 100,
      tasks: data.tasks,
    }));

    const byPersona = Array.from(byPersonaMap.entries()).map(([persona, data]) => ({
      persona,
      cost: Math.round(data.cost * 100) / 100,
      tasks: data.tasks,
    }));

    res.json({
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      totals: {
        cost: Math.round(totals.cost * 100) / 100,
        tasks: totals.tasks,
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheTokens: totals.cacheTokens,
      },
      byModel,
      byPersona,
    });
    } catch (error) {
      logger.error("Error getting cost breakdown", { error });
      res.status(500).json({ error: "Failed to get cost breakdown" });
    }
  }
);

export default router;
