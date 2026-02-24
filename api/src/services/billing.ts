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
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { markReferralQualified, recordDiscountUsed, getReferralDiscount } from "./referral.js";
import { UserOrganization } from "../models/UserOrganization.js";
import { sendPaymentFailedEmail } from "./email/billing-emails.js";
import { In } from "typeorm";

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
  pro: config.stripe?.prices?.pro || null,
  max: config.stripe?.prices?.max || "",
  enterprise: config.stripe?.prices?.enterprise || null,
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

  // Save customer ID to org — atomic update
  const orgRepo = AppDataSource.getRepository(Organization);
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ stripeCustomerId: customer.id })
    .where("id = :id", { id: org.id })
    .execute();
  org.stripeCustomerId = customer.id;

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

  // Map legacy plan names to new tiers
  const legacyPlanMap: Record<string, OrganizationPlan> = {
    starter: "max",
    team: "max",
    business: "max",
    free: "pro",
  };
  const newPlan: OrganizationPlan = plan
    ? (legacyPlanMap[plan] || plan) as OrganizationPlan
    : "max";

  // Update organization with subscription details — atomic update
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
      plan: newPlan,
      billingCycleStart: new Date(subscription.current_period_start * 1000),
      taskUsageThisMonth: 0,
    } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();
  org.plan = newPlan;

  logger.info("Subscription created for organization", {
    orgId: org.id,
    subscriptionId: subscription.id,
    plan: org.plan,
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

  // Atomic update for subscription state
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      stripeSubscriptionStatus: subscription.status,
      billingCycleStart: org.billingCycleStart,
      taskUsageThisMonth: org.taskUsageThisMonth,
    } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();

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

  // Downgrade to pro plan — atomic update
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      plan: "pro",
    } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();

  logger.info("Subscription deleted, organization downgraded to pro", {
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

  // Check if this is a subscription invoice (not one-time payment)
  if (invoice.subscription) {
    // Check if this is the first paid invoice for this subscription
    // billing_reason "subscription_create" indicates the first invoice
    const isFirstInvoice = invoice.billing_reason === "subscription_create";

    if (isFirstInvoice) {
      // Mark referral as qualified (referrer earns credit)
      try {
        await markReferralQualified(org.id);
      } catch (error) {
        logger.error("Error marking referral qualified", {
          orgId: org.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Record referral discount usage (if applicable)
    try {
      const discount = await getReferralDiscount(org.id);
      if (discount.hasDiscount) {
        await recordDiscountUsed(org.id);
        logger.info("Referral discount applied to invoice", {
          orgId: org.id,
          invoiceId: invoice.id,
          discountPercent: discount.discountPercent,
          monthsRemaining: discount.monthsRemaining - 1,
        });
      }
    } catch (error) {
      logger.error("Error recording referral discount usage", {
        orgId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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

  // Send notification to org admins about the failed payment
  const failureReason =
    (invoice as { last_payment_error?: { message?: string } }).last_payment_error?.message ||
    "Payment was declined by your card issuer";

  try {
    const userOrgRepo = AppDataSource.getRepository(UserOrganization);
    const adminMemberships = await userOrgRepo.find({
      where: {
        orgId: org.id,
        role: In(["admin", "owner"]),
      },
      relations: ["user"],
    });

    for (const membership of adminMemberships) {
      const user = membership.user;
      if (!user?.email) continue;

      await sendPaymentFailedEmail(user, org, failureReason).catch(
        (emailError) => {
          logger.error("Failed to send payment failed email", {
            orgId: org.id,
            userId: user.id,
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          });
        },
      );
    }

    logger.info("Payment failure notifications sent to org admins", {
      orgId: org.id,
      invoiceId: invoice.id,
      adminCount: adminMemberships.length,
    });
  } catch (error) {
    logger.error("Failed to send payment failure notifications", {
      orgId: org.id,
      invoiceId: invoice.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  // Map legacy plan names to new tiers and set plan
  const legacyPlanMap: Record<string, OrganizationPlan> = {
    starter: "max",
    team: "max",
    business: "max",
    free: "pro",
  };
  if (plan) {
    org.plan = (legacyPlanMap[plan] || plan) as OrganizationPlan;
  } else {
    org.plan = "max";
  }

  // Reset usage for new subscription
  org.taskUsageThisMonth = 0;
  org.billingCycleStart = new Date();

  // Mark subscription as active (will be confirmed by subscription.created event)
  org.stripeSubscriptionStatus = "active";

  // Atomic update for checkout completion
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      stripeCustomerId: org.stripeCustomerId,
      stripeSubscriptionId: org.stripeSubscriptionId,
      plan: org.plan,
      taskUsageThisMonth: 0,
      billingCycleStart: new Date(),
      stripeSubscriptionStatus: "active",
    } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();

  logger.info("Checkout session completed for organization", {
    orgId: org.id,
    sessionId: session.id,
    customerId: org.stripeCustomerId,
    subscriptionId: org.stripeSubscriptionId,
    plan: org.plan,
  });
}

/**
 * Check if organization can create a new task
 *
 * All plans allow unlimited tasks. This checks:
 * 1. Billing is not paused
 * 2. For paid plans (pro/enterprise), subscription must be active
 * Free plans are always allowed.
 */
export async function canCreateTask(org: Organization): Promise<{
  allowed: boolean;
  reason?: string;
  usage?: { used: number; quota: number };
}> {
  // Platform org is always allowed (runs internal support tasks, etc.)
  if (org.isPlatformOrg) {
    return {
      allowed: true,
      usage: { used: org.taskUsageThisMonth, quota: -1 },
    };
  }

  // Check if billing is paused
  if (org.billingPaused) {
    return {
      allowed: false,
      reason: org.billingPausedReason || "Billing is paused. Please contact support.",
      usage: { used: org.taskUsageThisMonth, quota: -1 },
    };
  }

  // Pro plan: allow during active trial OR with active Stripe subscription
  if (org.plan === "pro") {
    // Active Stripe subscription — always allow
    if (
      org.stripeSubscriptionStatus === "active" ||
      org.stripeSubscriptionStatus === "trialing"
    ) {
      // Fall through to quota check below
    } else if (org.trialExpiresAt && new Date() < org.trialExpiresAt) {
      // Active trial — allow (fall through to quota check)
    } else if (org.trialExpiresAt) {
      // Trial expired, no subscription
      return {
        allowed: false,
        reason:
          "Your Pro trial has expired. Subscribe to continue using WorkerMill.",
        usage: { used: org.taskUsageThisMonth, quota: -1 },
      };
    }
    // trialExpiresAt is null and no subscription — block (no valid entitlement)
    return {
      allowed: false,
      reason: "No active subscription or trial. Subscribe to start using WorkerMill.",
      usage: { used: org.taskUsageThisMonth, quota: -1 },
    };
  }

  // Check subscription status for paid plans (Max and Enterprise require active subscription)
  if (org.stripeSubscriptionStatus !== "active") {
    return {
      allowed: false,
      reason: "Subscription is not active. Please update your payment method.",
      usage: { used: org.taskUsageThisMonth, quota: -1 },
    };
  }

  // Enforce task quota if set (quota of -1 or 0 means unlimited)
  if (org.taskQuota > 0 && org.taskUsageThisMonth >= org.taskQuota) {
    return {
      allowed: false,
      reason: `Monthly task limit reached (${org.taskUsageThisMonth}/${org.taskQuota}). Upgrade your plan for more tasks.`,
      usage: { used: org.taskUsageThisMonth, quota: org.taskQuota },
    };
  }

  return {
    allowed: true,
    usage: { used: org.taskUsageThisMonth, quota: org.taskQuota > 0 ? org.taskQuota : -1 },
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
    } catch (error) {
      logger.warn("Failed to check Stripe payment methods", {
        customerId: org.stripeCustomerId,
        error: error instanceof Error ? error.message : String(error),
      });
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

  // Update local status — atomic update
  const orgRepo = AppDataSource.getRepository(Organization);
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ stripeSubscriptionStatus: "canceling" } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();

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

  // Update local status — atomic update
  const orgRepo = AppDataSource.getRepository(Organization);
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ stripeSubscriptionStatus: "active" } as Record<string, unknown>)
    .where("id = :id", { id: org.id })
    .execute();

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
