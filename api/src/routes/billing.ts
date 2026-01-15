/**
 * WorkerMill Billing Routes
 *
 * API endpoints for subscription management, usage tracking, and billing portal.
 */

import { Router, Request, Response } from "express";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
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

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/billing/plans
 * Get available pricing plans
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
 * GET /api/billing/status
 * Get current billing status for the organization
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
router.post("/checkout", requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!config.stripe?.secretKey) {
      res.status(400).json({ error: "Stripe is not configured" });
      return;
    }

    const org = req.organization!;
    const user = req.user!;
    const { plan } = req.body as { plan: OrganizationPlan };

    if (!plan || !["starter", "pro", "enterprise"].includes(plan)) {
      res.status(400).json({
        error: "Invalid plan. Must be one of: starter, pro, enterprise",
      });
      return;
    }

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
  } catch (error) {
    logger.error("Error creating checkout session", { error });
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/billing/portal
 * Create a Stripe billing portal session for subscription management
 */
router.post("/portal", requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!config.stripe?.secretKey) {
      res.status(400).json({ error: "Stripe is not configured" });
      return;
    }

    const org = req.organization!;

    if (!org.stripeCustomerId) {
      res.status(400).json({
        error: "No billing account found. Please subscribe to a plan first.",
      });
      return;
    }

    const returnUrl = `${config.apiBaseUrl}/billing`;
    const { url: portalUrl } = await createBillingPortalSession(org, returnUrl);

    res.json({ url: portalUrl });
  } catch (error) {
    logger.error("Error creating billing portal session", { error });
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

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

export default router;
