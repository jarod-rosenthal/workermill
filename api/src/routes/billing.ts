/**
 * WorkerMill Billing Routes
 *
 * API endpoints for subscription management, usage tracking, and billing portal.
 */

import { Router, Request, Response, NextFunction } from "express";
import { Between, MoreThanOrEqual } from "typeorm";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import { User } from "../models/User.js";
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
import * as creditBilling from "../services/credit-billing.js";
import {
  type OrganizationPlan,
  PLAN_QUOTAS,
  PLAN_USER_LIMITS,
  PLAN_HOURS,
  PLAN_PRICES,
  PLAN_OVERAGE_RATES,
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
/**
 * @swagger
 * /api/billing/subscription:
 *   get:
 *     summary: Get subscription and hours usage details
 *     description: Returns current plan details, hours usage, billing period info, and team member count
 *     tags: [Billing]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription and usage information
 *       500:
 *         description: Server error
 */
router.get(
  "/subscription",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const plan = org.plan as OrganizationPlan;

    // Get plan details
    const includedHours = PLAN_HOURS[plan] ?? 3;
    const price = PLAN_PRICES[plan] ?? 49;
    const userLimit = PLAN_USER_LIMITS[plan] ?? 3;
    const overageRate = PLAN_OVERAGE_RATES[plan] ?? 12;

    // Calculate billing period (defaults to current month if no billingCycleStart)
    let periodStart: Date;
    let periodEnd: Date;

    if (org.billingCycleStart) {
      periodStart = new Date(org.billingCycleStart);
      periodEnd = new Date(org.billingCycleStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      // Default to first of current month
      periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      periodEnd = new Date(periodStart);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Calculate days remaining in period
    const now = new Date();
    const msRemaining = periodEnd.getTime() - now.getTime();
    const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));

    // Query sum of ecsTaskSeconds for completed tasks in current billing period
    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const result = await taskRepo
      .createQueryBuilder("task")
      .select("COALESCE(SUM(task.ecsTaskSeconds), 0)", "totalSeconds")
      .where("task.orgId = :orgId", { orgId: org.id })
      .andWhere("task.createdAt >= :periodStart", { periodStart })
      .andWhere("task.createdAt < :periodEnd", { periodEnd })
      .andWhere("task.status IN (:...statuses)", {
        statuses: ["completed", "deployed", "pr_created", "review_requested", "pr_approved", "review_approved"],
      })
      .getRawOne();

    const totalSeconds = parseInt(result?.totalSeconds || "0", 10);
    const hoursUsed = totalSeconds / 3600;

    // Calculate usage metrics
    const isUnlimited = includedHours === -1;
    const hoursIncluded = isUnlimited ? -1 : includedHours;
    const hoursRemaining = isUnlimited ? -1 : Math.max(0, includedHours - hoursUsed);
    const overageHours = isUnlimited ? 0 : Math.max(0, hoursUsed - includedHours);
    const overageCost = overageHours * overageRate;
    const percentUsed = isUnlimited ? 0 : includedHours > 0 ? Math.min(100, (hoursUsed / includedHours) * 100) : 0;

    // Calculate estimated invoice
    const nextInvoiceEstimate = price + overageCost;

    // Get team member count
    const userRepo = AppDataSource.getRepository(User);
    const memberCount = await userRepo.count({
      where: { orgId: org.id, status: "active" },
    });

    res.json({
      plan: {
        id: plan,
        name: plan.charAt(0).toUpperCase() + plan.slice(1),
        price,
        includedHours: hoursIncluded,
        userLimit,
        overageRate,
      },
      usage: {
        hoursUsed: Math.round(hoursUsed * 100) / 100,
        hoursIncluded,
        hoursRemaining: isUnlimited ? -1 : Math.round(hoursRemaining * 100) / 100,
        overageHours: Math.round(overageHours * 100) / 100,
        overageCost: Math.round(overageCost * 100) / 100,
        percentUsed: Math.round(percentUsed * 10) / 10,
        isUnlimited,
      },
      billing: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        daysRemaining,
        nextInvoiceEstimate: Math.round(nextInvoiceEstimate * 100) / 100,
      },
      team: {
        memberCount,
        memberLimit: userLimit,
      },
    });
  })
);

router.get(
  "/plans",
  asyncHandler(async (_req: Request, res: Response) => {
    const plans = [
      {
        id: "starter",
        name: "Starter",
        price: 29,
        includedHours: 5,
        userLimit: 5,
        features: [
          "5 compute hours/month included",
          "Up to 5 users",
          "All integrations",
          "All execution modes",
          "Email support",
          "14-day log retention",
        ],
        overageRate: 8, // $8/hr
      },
      {
        id: "team",
        name: "Team",
        price: 79,
        includedHours: 20,
        userLimit: 20,
        features: [
          "20 compute hours/month included",
          "Up to 20 users",
          "Warm Container Pool",
          "30-day audit logs",
          "Priority support (< 4hr)",
          "Advanced analytics",
        ],
        overageRate: 6, // $6/hr
        highlighted: true,
      },
      {
        id: "business",
        name: "Business",
        price: 199,
        includedHours: 60,
        userLimit: -1, // Unlimited
        features: [
          "60 compute hours/month included",
          "Unlimited users",
          "Self-hosted SCM support",
          "SSO / SAML",
          "90-day audit logs",
          "Compliance Center",
          "Dedicated support",
        ],
        overageRate: 4, // $4/hr
      },
      {
        id: "enterprise",
        name: "Enterprise",
        price: null, // Custom pricing
        includedHours: -1, // Unlimited
        userLimit: -1, // Unlimited
        features: [
          "Custom compute allocation",
          "Unlimited users",
          "Dedicated Worker Pool",
          "Priority Task Queue",
          "1 year+ audit retention",
          "Data Residency Controls",
          "99.9% SLA",
          "Dedicated CSM",
        ],
        overageRate: null, // Custom
      },
    ];

    res.json({ plans });
  })
);

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
router.get(
  "/status",
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

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
router.get(
  "/usage",
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

/**
 * GET /api/billing/cost-breakdown
 * Get detailed cost breakdown by model and persona
 */
router.get(
  "/cost-breakdown",
  query("startDate").optional().isISO8601().withMessage("startDate must be a valid ISO 8601 date"),
  query("endDate").optional().isISO8601().withMessage("endDate must be a valid ISO 8601 date"),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
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
  })
);

// =============================================================================
// Credit Billing Endpoints
// =============================================================================

/**
 * GET /api/billing/balance
 * Get current credit balance
 */
router.get(
  "/balance",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const balance = await creditBilling.getBalance(org.id);
    const monthlyUsage = await creditBilling.getMonthlyUsage(org.id);

    res.json({
      balance,
      thisMonth: monthlyUsage,
      status: {
        paused: org.billingPaused,
        pausedReason: org.billingPausedReason,
        depositCompleted: org.signupDepositCompleted,
      },
    });
  })
);

/**
 * POST /api/billing/deposit
 * Process a deposit (initial or additional)
 */
router.post(
  "/deposit",
  requireAdmin,
  body("paymentMethodId").isString().notEmpty(),
  body("amountCents").isInt({ min: 1000 }).withMessage("Minimum deposit is $10"),
  body("isSignup").optional().isBoolean(),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;
    const { paymentMethodId, amountCents, isSignup } = req.body;

    let result;
    if (isSignup || !org.signupDepositCompleted) {
      result = await creditBilling.processSignupDeposit(
        org.id,
        paymentMethodId,
        amountCents
      );
    } else {
      result = await creditBilling.processDeposit(
        org.id,
        paymentMethodId,
        amountCents
      );
    }

    res.json({
      success: true,
      paymentIntentId: result.paymentIntentId,
    });
  })
);

/**
 * POST /api/billing/setup-intent
 * Create SetupIntent for adding a new payment method
 */
router.post(
  "/setup-intent",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;
    const { clientSecret } = await creditBilling.createSetupIntent(org.id);

    res.json({ clientSecret });
  })
);

/**
 * GET /api/billing/payment-methods
 * List saved payment methods
 */
router.get(
  "/payment-methods",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const paymentMethods = await creditBilling.listPaymentMethods(org.id);

    res.json({
      paymentMethods: paymentMethods.map((pm) => ({
        id: pm.id,
        type: pm.type,
        brand: pm.brand,
        lastFour: pm.lastFour,
        expMonth: pm.expMonth,
        expYear: pm.expYear,
        isDefault: pm.isDefault,
        createdAt: pm.createdAt,
      })),
    });
  })
);

/**
 * POST /api/billing/payment-methods
 * Save a payment method from SetupIntent
 */
router.post(
  "/payment-methods",
  requireAdmin,
  body("paymentMethodId").isString().notEmpty(),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;
    const { paymentMethodId } = req.body;

    const pm = await creditBilling.savePaymentMethod(org.id, paymentMethodId);

    res.json({
      success: true,
      paymentMethod: {
        id: pm.id,
        type: pm.type,
        brand: pm.brand,
        lastFour: pm.lastFour,
        expMonth: pm.expMonth,
        expYear: pm.expYear,
        isDefault: pm.isDefault,
      },
    });
  })
);

/**
 * DELETE /api/billing/payment-methods/:id
 * Remove a payment method
 */
router.delete(
  "/payment-methods/:id",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const id = req.params.id as string;

    await creditBilling.deletePaymentMethod(org.id, id);

    res.json({ success: true });
  })
);

/**
 * PUT /api/billing/payment-methods/:id/default
 * Set a payment method as default for auto-recharge
 */
router.put(
  "/payment-methods/:id/default",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const id = req.params.id as string;

    await creditBilling.setDefaultPaymentMethod(org.id, id);

    res.json({ success: true });
  })
);

/**
 * GET /api/billing/auto-recharge
 * Get auto-recharge settings
 */
router.get(
  "/auto-recharge",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const settings = await creditBilling.getAutoRechargeSettings(org.id);

    res.json(settings);
  })
);

/**
 * PUT /api/billing/auto-recharge
 * Update auto-recharge settings
 */
router.put(
  "/auto-recharge",
  requireAdmin,
  body("enabled").optional().isBoolean(),
  body("thresholdCents").optional().isInt({ min: 100 }),
  body("amountCents").optional().isInt({ min: 1000 }),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const { enabled, thresholdCents, amountCents } = req.body;

    await creditBilling.updateAutoRechargeSettings(org.id, {
      enabled,
      thresholdCents,
      amountCents,
    });

    const settings = await creditBilling.getAutoRechargeSettings(org.id);
    res.json(settings);
  })
);

/**
 * GET /api/billing/transactions
 * Get paginated transaction history
 */
router.get(
  "/transactions",
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("offset").optional().isInt({ min: 0 }),
  query("type").optional().isIn(["deposit", "usage", "refund", "bonus", "auto_recharge"]),
  validateRequest,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const type = req.query.type as string | undefined;

    const { transactions, total } = await creditBilling.getTransactionHistory(
      org.id,
      {
        limit,
        offset,
        type: type as any,
      }
    );

    res.json({
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amountCents: tx.amountCents,
        balanceAfterCents: tx.balanceAfterCents,
        description: tx.description,
        taskId: tx.taskId,
        aiCostCents: tx.aiCostCents,
        feeCents: tx.feeCents,
        createdAt: tx.createdAt,
      })),
      total,
      limit,
      offset,
    });
  })
);

/**
 * POST /api/billing/retry-payment
 * Retry a failed auto-recharge payment
 */
router.post(
  "/retry-payment",
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe?.secretKey) {
      throw new ServiceUnavailableError("Stripe is not configured");
    }

    const org = req.organization!;
    const result = await creditBilling.retryPayment(org.id);

    if (result.success) {
      res.json({
        success: true,
        amountCharged: result.amountCharged,
      });
    } else {
      throw new BadRequestError(result.error || "Payment retry failed");
    }
  })
);

/**
 * GET /api/billing/credit-status
 * Get full credit billing status (designed for new billing page)
 */
router.get(
  "/credit-status",
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization!;

    const [balance, autoRechargeSettings, paymentMethods, monthlyUsage] =
      await Promise.all([
        creditBilling.getBalance(org.id),
        creditBilling.getAutoRechargeSettings(org.id),
        creditBilling.listPaymentMethods(org.id),
        creditBilling.getMonthlyUsage(org.id),
      ]);

    res.json({
      balance,
      autoRecharge: autoRechargeSettings,
      paymentMethods: paymentMethods.map((pm) => ({
        id: pm.id,
        brand: pm.brand,
        lastFour: pm.lastFour,
        expMonth: pm.expMonth,
        expYear: pm.expYear,
        isDefault: pm.isDefault,
      })),
      status: {
        paused: org.billingPaused ?? false,
        pausedReason: org.billingPausedReason ?? null,
        depositCompleted: org.signupDepositCompleted ?? false,
      },
      thisMonth: monthlyUsage,
      stripeConfigured: !!config.stripe?.secretKey,
      feePercent: config.creditBilling.feePercent,
    });
  })
);

export default router;
