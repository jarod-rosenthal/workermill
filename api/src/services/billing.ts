/**
 * WorkerMill Billing Service
 *
 * Handles Stripe integration for subscriptions, checkout, and billing management.
 */

import Stripe from "stripe";
import { AppDataSource } from "../db/connection.js";
import {
  Organization,
  type OrganizationPlan,
  PLAN_QUOTAS,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

// Initialize Stripe client (only if secret key is configured)
const stripeSecretKey = config.stripe?.secretKey;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2025-02-24.acacia",
    })
  : null;

/**
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return stripe !== null;
}

// Price IDs for each plan (configured in Stripe Dashboard)
// These should be set in environment variables
const PRICE_IDS: Record<OrganizationPlan, string | null> = {
  free: null, // Free plan has no Stripe price
  starter: config.stripe?.prices?.starter || "",
  pro: config.stripe?.prices?.pro || "",
  enterprise: config.stripe?.prices?.enterprise || null, // Enterprise is custom pricing
};

/**
 * Create or retrieve a Stripe customer for an organization
 */
export async function getOrCreateStripeCustomer(
  org: Organization,
  email: string
): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  // If org already has a Stripe customer, return it
  if (org.stripeCustomerId) {
    return org.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email,
    name: org.name,
    metadata: {
      orgId: org.id,
      orgName: org.name,
    },
  });

  // Save customer ID to org
  const orgRepo = AppDataSource.getRepository(Organization);
  org.stripeCustomerId = customer.id;
  await orgRepo.save(org);

  logger.info("Created Stripe customer", {
    orgId: org.id,
    customerId: customer.id,
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout session for subscription
 */
export async function createCheckoutSession(
  org: Organization,
  email: string,
  plan: OrganizationPlan,
  successUrl: string,
  cancelUrl: string
): Promise<{ sessionId: string; url: string }> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  const priceId = PRICE_IDS[plan];

  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${plan}`);
  }

  // Get or create Stripe customer
  const customerId = await getOrCreateStripeCustomer(org, email);

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: "subscription",
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      orgId: org.id,
      plan,
    },
    subscription_data: {
      metadata: {
        orgId: org.id,
        plan,
      },
    },
  });

  logger.info("Created checkout session", {
    orgId: org.id,
    sessionId: session.id,
    plan,
  });

  return {
    sessionId: session.id,
    url: session.url || "",
  };
}

/**
 * Create a Stripe billing portal session
 */
export async function createBillingPortalSession(
  org: Organization,
  returnUrl: string
): Promise<{ url: string }> {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }

  if (!org.stripeCustomerId) {
    throw new Error("Organization has no Stripe customer");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  });

  logger.info("Created billing portal session", {
    orgId: org.id,
    customerId: org.stripeCustomerId,
  });

  return { url: session.url };
}

/**
 * Handle Stripe webhook: subscription created
 */
export async function handleSubscriptionCreated(
  subscription: Stripe.Subscription
): Promise<void> {
  const orgId = subscription.metadata?.orgId;
  const plan = subscription.metadata?.plan as OrganizationPlan;

  if (!orgId) {
    logger.warn("Subscription created without orgId in metadata", {
      subscriptionId: subscription.id,
    });
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    logger.error("Organization not found for subscription", {
      orgId,
      subscriptionId: subscription.id,
    });
    return;
  }

  // Update organization with subscription details
  org.stripeSubscriptionId = subscription.id;
  org.stripeSubscriptionStatus = subscription.status;
  org.plan = plan || "starter";
  org.taskQuota = PLAN_QUOTAS[org.plan];
  org.billingCycleStart = new Date(subscription.current_period_start * 1000);
  org.taskUsageThisMonth = 0; // Reset usage on new subscription

  await orgRepo.save(org);

  logger.info("Subscription created for organization", {
    orgId: org.id,
    subscriptionId: subscription.id,
    plan: org.plan,
    taskQuota: org.taskQuota,
  });
}

/**
 * Handle Stripe webhook: subscription updated
 */
export async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<void> {
  const orgId = subscription.metadata?.orgId;

  if (!orgId) {
    // Try to find org by subscription ID
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!org) {
      logger.warn("Could not find organization for subscription update", {
        subscriptionId: subscription.id,
      });
      return;
    }

    await updateOrgFromSubscription(org, subscription);
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    logger.error("Organization not found for subscription update", {
      orgId,
      subscriptionId: subscription.id,
    });
    return;
  }

  await updateOrgFromSubscription(org, subscription);
}

/**
 * Update organization from Stripe subscription
 */
async function updateOrgFromSubscription(
  org: Organization,
  subscription: Stripe.Subscription
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);

  const previousStatus = org.stripeSubscriptionStatus;
  org.stripeSubscriptionStatus = subscription.status;

  // Check if billing cycle reset (new period)
  const newPeriodStart = new Date(subscription.current_period_start * 1000);
  if (
    !org.billingCycleStart ||
    newPeriodStart > org.billingCycleStart
  ) {
    org.billingCycleStart = newPeriodStart;
    org.taskUsageThisMonth = 0; // Reset usage on new billing period
    logger.info("Billing cycle reset for organization", {
      orgId: org.id,
      newPeriodStart: newPeriodStart.toISOString(),
    });
  }

  // Handle subscription becoming active
  if (
    previousStatus !== "active" &&
    subscription.status === "active"
  ) {
    logger.info("Subscription became active", {
      orgId: org.id,
      subscriptionId: subscription.id,
    });
  }

  // Handle subscription becoming inactive
  if (
    previousStatus === "active" &&
    subscription.status !== "active"
  ) {
    logger.warn("Subscription is no longer active", {
      orgId: org.id,
      subscriptionId: subscription.id,
      newStatus: subscription.status,
    });
  }

  await orgRepo.save(org);

  logger.info("Subscription updated for organization", {
    orgId: org.id,
    subscriptionId: subscription.id,
    status: subscription.status,
  });
}

/**
 * Handle Stripe webhook: subscription deleted/cancelled
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({
    where: { stripeSubscriptionId: subscription.id },
  });

  if (!org) {
    logger.warn("Organization not found for subscription deletion", {
      subscriptionId: subscription.id,
    });
    return;
  }

  // Downgrade to free plan
  org.stripeSubscriptionId = null;
  org.stripeSubscriptionStatus = null;
  org.plan = "free";
  org.taskQuota = PLAN_QUOTAS.free;

  await orgRepo.save(org);

  logger.info("Subscription deleted, organization downgraded to free", {
    orgId: org.id,
    subscriptionId: subscription.id,
  });
}

/**
 * Handle Stripe webhook: invoice paid
 * This is triggered when a subscription payment succeeds
 */
export async function handleInvoicePaid(
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId = invoice.customer as string;

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({
    where: { stripeCustomerId: customerId },
  });

  if (!org) {
    logger.warn("Organization not found for invoice", {
      customerId,
      invoiceId: invoice.id,
    });
    return;
  }

  logger.info("Invoice paid for organization", {
    orgId: org.id,
    invoiceId: invoice.id,
    amountPaid: invoice.amount_paid / 100,
    currency: invoice.currency,
  });
}

/**
 * Handle Stripe webhook: invoice payment failed
 */
export async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId = invoice.customer as string;

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({
    where: { stripeCustomerId: customerId },
  });

  if (!org) {
    logger.warn("Organization not found for failed invoice", {
      customerId,
      invoiceId: invoice.id,
    });
    return;
  }

  logger.error("Invoice payment failed for organization", {
    orgId: org.id,
    invoiceId: invoice.id,
    amountDue: invoice.amount_due / 100,
    currency: invoice.currency,
  });

  // TODO: Send notification to org admins about failed payment
}

/**
 * Handle Stripe webhook: checkout session completed
 *
 * This is triggered when a customer completes checkout. We need to:
 * 1. Update organization with Stripe customer ID and subscription ID
 * 2. Set the plan based on the price ID from the session
 * 3. Reset task usage for the new billing period
 */
export async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const orgId = session.metadata?.orgId;
  const plan = session.metadata?.plan as OrganizationPlan | undefined;

  if (!orgId) {
    logger.warn("Checkout session completed without orgId in metadata", {
      sessionId: session.id,
    });
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    logger.error("Organization not found for checkout session", {
      orgId,
      sessionId: session.id,
    });
    return;
  }

  // Update organization with Stripe details
  org.stripeCustomerId = session.customer as string;
  org.stripeSubscriptionId = session.subscription as string;

  // Set plan from metadata or default to starter
  if (plan && ["starter", "pro", "enterprise"].includes(plan)) {
    org.plan = plan;
  } else {
    // Fallback: try to determine plan from session
    org.plan = "starter";
  }

  // Set task quota based on plan
  org.taskQuota = PLAN_QUOTAS[org.plan];

  // Reset usage for new subscription
  org.taskUsageThisMonth = 0;
  org.billingCycleStart = new Date();

  // Mark subscription as active (will be confirmed by subscription.created event)
  org.stripeSubscriptionStatus = "active";

  await orgRepo.save(org);

  logger.info("Checkout session completed for organization", {
    orgId: org.id,
    sessionId: session.id,
    customerId: org.stripeCustomerId,
    subscriptionId: org.stripeSubscriptionId,
    plan: org.plan,
    taskQuota: org.taskQuota,
  });
}

/**
 * Check if organization can create a new task (quota check)
 */
export async function canCreateTask(org: Organization): Promise<{
  allowed: boolean;
  reason?: string;
  usage?: { used: number; quota: number };
}> {
  // Check subscription status for paid plans
  if (org.plan !== "free" && org.stripeSubscriptionStatus !== "active") {
    return {
      allowed: false,
      reason: "Subscription is not active. Please update your payment method.",
      usage: { used: org.taskUsageThisMonth, quota: org.taskQuota },
    };
  }

  // Unlimited plans (-1 quota)
  if (org.taskQuota === -1) {
    return {
      allowed: true,
      usage: { used: org.taskUsageThisMonth, quota: -1 },
    };
  }

  // Check quota
  if (org.taskUsageThisMonth >= org.taskQuota) {
    return {
      allowed: false,
      reason: `Monthly task quota exceeded (${org.taskUsageThisMonth}/${org.taskQuota}). Upgrade your plan for more tasks.`,
      usage: { used: org.taskUsageThisMonth, quota: org.taskQuota },
    };
  }

  return {
    allowed: true,
    usage: { used: org.taskUsageThisMonth, quota: org.taskQuota },
  };
}

/**
 * Increment task usage for an organization
 */
export async function incrementTaskUsage(orgId: string): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);

  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      taskUsageThisMonth: () => "task_usage_this_month + 1",
    })
    .where("id = :id", { id: orgId })
    .execute();

  logger.debug("Incremented task usage", { orgId });
}

/**
 * Get billing info for an organization
 */
export async function getBillingInfo(org: Organization): Promise<{
  plan: OrganizationPlan;
  status: string | null;
  usage: { used: number; quota: number; unlimited: boolean };
  billingCycleStart: Date | null;
  hasPaymentMethod: boolean;
}> {
  let hasPaymentMethod = false;

  if (stripe && org.stripeCustomerId) {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: org.stripeCustomerId,
        type: "card",
      });
      hasPaymentMethod = paymentMethods.data.length > 0;
    } catch {
      // Ignore errors, assume no payment method
    }
  }

  return {
    plan: org.plan,
    status: org.stripeSubscriptionStatus,
    usage: {
      used: org.taskUsageThisMonth,
      quota: org.taskQuota,
      unlimited: org.taskQuota === -1,
    },
    billingCycleStart: org.billingCycleStart,
    hasPaymentMethod,
  };
}

/**
 * Reset monthly usage for all organizations (run monthly via cron)
 */
export async function resetMonthlyUsage(): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);

  const result = await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ taskUsageThisMonth: 0 })
    .execute();

  logger.info("Reset monthly task usage for all organizations", {
    affectedOrgs: result.affected,
  });
}

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

/**
 * Create a Stripe customer (alias for getOrCreateStripeCustomer for route compatibility)
 */
export async function createStripeCustomer(
  org: Organization,
  email: string
): Promise<string> {
  return getOrCreateStripeCustomer(org, email);
}

/**
 * Get subscription details from Stripe
 */
export async function getSubscriptionDetails(org: Organization): Promise<{
  id: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  plan: {
    nickname: string | null;
    amount: number | null;
    interval: string | null;
  };
} | null> {
  if (!org.stripeSubscriptionId || !stripe) {
    return null;
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);

    // Get first subscription item
    const item = subscription.items.data[0];
    const price = item?.price;

    return {
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      plan: {
        nickname: price?.nickname || null,
        amount: price?.unit_amount || null,
        interval: price?.recurring?.interval || null,
      },
    };
  } catch (error) {
    logger.error("Failed to get subscription details", {
      orgId: org.id,
      subscriptionId: org.stripeSubscriptionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cancel subscription at end of billing period
 */
export async function cancelSubscription(org: Organization): Promise<void> {
  if (!org.stripeSubscriptionId || !stripe) {
    throw new Error("No active subscription to cancel or Stripe not configured");
  }

  await stripe.subscriptions.update(org.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  // Update local status
  const orgRepo = AppDataSource.getRepository(Organization);
  org.stripeSubscriptionStatus = "canceling";
  await orgRepo.save(org);

  logger.info("Subscription marked for cancellation", {
    orgId: org.id,
    subscriptionId: org.stripeSubscriptionId,
  });
}

/**
 * Reactivate a subscription marked for cancellation
 */
export async function reactivateSubscription(org: Organization): Promise<void> {
  if (!org.stripeSubscriptionId || !stripe) {
    throw new Error("No subscription to reactivate or Stripe not configured");
  }

  await stripe.subscriptions.update(org.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });

  // Update local status
  const orgRepo = AppDataSource.getRepository(Organization);
  org.stripeSubscriptionStatus = "active";
  await orgRepo.save(org);

  logger.info("Subscription reactivated", {
    orgId: org.id,
    subscriptionId: org.stripeSubscriptionId,
  });
}

/**
 * Get usage statistics for an organization
 */
export async function getUsageStats(orgId: string): Promise<{
  plan: OrganizationPlan;
  taskUsage: number;
  taskQuota: number;
  usagePercent: number;
  billingCycleStart: Date | null;
  daysUntilReset: number;
}> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    throw new Error("Organization not found");
  }

  // Calculate days until billing cycle reset
  let daysUntilReset = 30;
  if (org.billingCycleStart) {
    const cycleEnd = new Date(org.billingCycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    const now = new Date();
    daysUntilReset = Math.max(0, Math.ceil((cycleEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  // Calculate usage percent
  let usagePercent = 0;
  if (org.taskQuota > 0) {
    usagePercent = Math.min(100, Math.round((org.taskUsageThisMonth / org.taskQuota) * 100));
  }

  return {
    plan: org.plan,
    taskUsage: org.taskUsageThisMonth,
    taskQuota: org.taskQuota,
    usagePercent,
    billingCycleStart: org.billingCycleStart,
    daysUntilReset,
  };
}
