/**
 * WorkerMill Cloud Compute Billing Service
 *
 * Handles cloud compute balance: $3/hr billed per-minute.
 * Supports auto-recharge, payment methods, transaction history,
 * and welcome credits for Max plan upgrades.
 */

import Stripe from "stripe";
import { AppDataSource } from "../db/connection.js";
import {
  Organization,
  CreditTransaction,
  PaymentMethod,
  type CreditTransactionType,
  PLAN_FEATURES,
} from "../models/index.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";

// Initialize Stripe client
const stripeSecretKey = config.stripe?.secretKey;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2025-02-24.acacia",
    })
  : null;

// =============================================================================
// Types
// =============================================================================

export interface CreditBalance {
  balanceCents: number;
  computeRateCentsPerHour: number;
  estimatedHoursRemaining: number;
}

export interface DeductComputeUsageResult {
  totalDeducted: number;
  durationMinutes: number;
  balanceAfter: number;
  autoRechargeTriggered: boolean;
  lowBalance: boolean;
}

export interface CanExecuteCloudTaskResult {
  allowed: boolean;
  reason?: string;
  balanceCents: number;
}

export interface AutoRechargeResult {
  success: boolean;
  amountCharged?: number;
  error?: string;
}

// =============================================================================
// Balance Management
// =============================================================================

/**
 * Get current credit balance for an organization
 */
export async function getBalance(orgId: string): Promise<CreditBalance> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const balanceCents = org.creditBalanceCents || 0;
  const rateCentsPerHour = config.billing.computeRateCentsPerHour;

  return {
    balanceCents,
    computeRateCentsPerHour: rateCentsPerHour,
    estimatedHoursRemaining:
      rateCentsPerHour > 0
        ? Math.floor((balanceCents / rateCentsPerHour) * 100) / 100
        : 0,
  };
}

/**
 * Deduct compute usage when a cloud task completes.
 * Cost = ceil(durationMinutes) * ($3/hr / 60) = ceil(minutes) * 5 cents
 */
export async function deductComputeUsage(
  orgId: string,
  taskId: string,
  durationMinutes: number,
): Promise<DeductComputeUsageResult> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  // Round up to nearest minute, compute cost
  const roundedMinutes = Math.ceil(durationMinutes);
  const centsPerMinute = config.billing.computeRateCentsPerHour / 60;
  const totalDeduction = Math.ceil(roundedMinutes * centsPerMinute);

  // Deduct from credit balance atomically (allow negative — don't kill mid-task workers)
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      creditBalanceCents: () =>
        `"credit_balance_cents" - :deduction`,
    })
    .setParameter("deduction", totalDeduction)
    .where("id = :id", { id: org.id })
    .execute();

  // Refresh org to get updated balance
  Object.assign(org, await orgRepo.findOneBy({ id: org.id }));

  const balanceAfter = org.creditBalanceCents;

  // Create transaction record
  const transaction = txRepo.create({
    orgId,
    type: "usage" as CreditTransactionType,
    amountCents: -totalDeduction,
    balanceAfterCents: balanceAfter,
    description: `Cloud compute — ${roundedMinutes} min @ $${(config.billing.computeRateCentsPerHour / 100).toFixed(2)}/hr`,
    taskId,
    metadata: {
      durationMinutes: roundedMinutes,
      computeRateCentsPerHour: config.billing.computeRateCentsPerHour,
    },
  });
  await txRepo.save(transaction);

  logger.info("Compute usage deducted", {
    orgId,
    taskId,
    durationMinutes: roundedMinutes,
    totalDeduction,
    balanceAfter,
  });

  // Check if auto-recharge should trigger
  let autoRechargeTriggered = false;
  if (
    org.autoRechargeEnabled &&
    balanceAfter <= org.autoRechargeThresholdCents
  ) {
    logger.info("Auto-recharge threshold reached", {
      orgId,
      balance: balanceAfter,
      threshold: org.autoRechargeThresholdCents,
    });

    // Trigger auto-recharge asynchronously (don't block)
    processAutoRecharge(orgId).catch((error) => {
      logger.error("Auto-recharge failed", { orgId, error });
    });
    autoRechargeTriggered = true;
  }

  const lowBalance = balanceAfter < config.billing.minBalanceToLaunchCents;

  // Send email notification when balance hits $0 and auto-recharge is NOT enabled
  // Only send once per 7-day window (tracked via lastBalanceEmailSentAt)
  if (balanceAfter <= 0 && !org.autoRechargeEnabled) {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const lastSent = org.lastBalanceEmailSentAt?.getTime() ?? 0;
    if (Date.now() - lastSent > SEVEN_DAYS_MS) {
      sendZeroBalanceEmail(orgId).catch((error) => {
        logger.error("Failed to send zero balance email", {
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  return {
    totalDeducted: totalDeduction,
    durationMinutes: roundedMinutes,
    balanceAfter,
    autoRechargeTriggered,
    lowBalance,
  };
}

/**
 * Add credits to organization balance
 */
export async function addCredits(
  orgId: string,
  amountCents: number,
  type: CreditTransactionType,
  metadata?: {
    description?: string;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
  },
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  // Update balance atomically
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      creditBalanceCents: () => `"credit_balance_cents" + :amount`,
    })
    .setParameter("amount", amountCents)
    .where("id = :id", { id: org.id })
    .execute();

  // Unpause billing if it was paused
  if (org.billingPaused) {
    await orgRepo.update(
      { id: org.id },
      { billingPaused: false, billingPausedReason: null as unknown as string },
    );
    logger.info("Billing unpaused after credit addition", { orgId });
  }

  // Clear balance email flag when topped up above threshold
  if (org.lastBalanceEmailSentAt) {
    const refreshed = await orgRepo.findOneBy({ id: org.id });
    if (refreshed && refreshed.creditBalanceCents >= config.billing.minBalanceToLaunchCents) {
      await orgRepo.update({ id: org.id }, { lastBalanceEmailSentAt: null as unknown as Date });
    }
  }

  // Refresh org to get updated balance
  Object.assign(org, await orgRepo.findOneBy({ id: org.id }));

  const balanceAfter = org.creditBalanceCents;

  // Create transaction record
  const transaction = txRepo.create({
    orgId,
    type,
    amountCents,
    balanceAfterCents: balanceAfter,
    description: metadata?.description || `${type} credits added`,
    stripePaymentIntentId: metadata?.stripePaymentIntentId,
    stripeChargeId: metadata?.stripeChargeId,
  });
  await txRepo.save(transaction);

  logger.info("Credits added", {
    orgId,
    amountCents,
    type,
    balanceAfter,
  });
}

// =============================================================================
// Payment Processing
// =============================================================================

/**
 * Process auto-recharge when balance drops below threshold
 */
export async function processAutoRecharge(
  orgId: string,
): Promise<AutoRechargeResult> {
  if (!stripe) {
    return { success: false, error: "Stripe is not configured" };
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const pmRepo = AppDataSource.getRepository(PaymentMethod);

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    return { success: false, error: "Organization not found" };
  }

  if (!org.autoRechargeEnabled) {
    return { success: false, error: "Auto-recharge is not enabled" };
  }

  // Get default payment method
  const defaultPm = await pmRepo.findOne({
    where: { orgId, isDefault: true },
  });

  if (!defaultPm) {
    // Pause billing - no payment method
    await orgRepo.update(
      { id: org.id },
      {
        billingPaused: true,
        billingPausedReason: "No default payment method for auto-recharge",
      },
    );

    logger.warn("Auto-recharge failed: no payment method", { orgId });
    return { success: false, error: "No default payment method" };
  }

  if (!org.stripeCustomerId) {
    return { success: false, error: "No Stripe customer ID" };
  }

  const amountCents = org.autoRechargeAmountCents;

  try {
    // Create and confirm PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: org.stripeCustomerId,
      payment_method: defaultPm.stripePaymentMethodId,
      confirm: true,
      off_session: true,
      metadata: {
        orgId,
        type: "auto_recharge",
      },
    });

    if (paymentIntent.status === "succeeded") {
      // Add credits
      await addCredits(orgId, amountCents, "auto_recharge", {
        description: "Auto-recharge",
        stripePaymentIntentId: paymentIntent.id,
      });

      logger.info("Auto-recharge succeeded", {
        orgId,
        amountCents,
        paymentIntentId: paymentIntent.id,
      });

      return { success: true, amountCharged: amountCents };
    } else {
      throw new Error(`Payment status: ${paymentIntent.status}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Payment failed";

    // Pause billing
    await orgRepo.update(
      { id: org.id },
      {
        billingPaused: true,
        billingPausedReason: `Auto-recharge failed: ${errorMessage}`,
      },
    );

    logger.error("Auto-recharge failed", { orgId, error: errorMessage });

    return { success: false, error: errorMessage };
  }
}

/**
 * Retry a failed payment (used when user clicks "Retry Payment")
 */
export async function retryPayment(orgId: string): Promise<AutoRechargeResult> {
  // Just call processAutoRecharge which handles everything
  return processAutoRecharge(orgId);
}

/**
 * Create SetupIntent for adding a new payment method
 */
export async function createSetupIntent(
  orgId: string,
): Promise<{ clientSecret: string }> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  // Get or create Stripe customer
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { orgId: org.id, orgName: org.name },
    });
    customerId = customer.id;
    await orgRepo.update({ id: org.id }, { stripeCustomerId: customerId });
    org.stripeCustomerId = customerId;
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    metadata: { orgId },
  });

  if (!setupIntent.client_secret) {
    throw new Error("Failed to create SetupIntent");
  }

  return { clientSecret: setupIntent.client_secret };
}

/**
 * Save payment method after SetupIntent completes
 */
export async function savePaymentMethod(
  orgId: string,
  stripePaymentMethodId: string,
): Promise<PaymentMethod> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const pmRepo = AppDataSource.getRepository(PaymentMethod);

  // Check if already exists
  const existing = await pmRepo.findOne({
    where: { orgId, stripePaymentMethodId },
  });
  if (existing) {
    return existing;
  }

  // Get payment method details from Stripe
  const stripePm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);

  // Check if this should be the default (first payment method)
  const existingCount = await pmRepo.count({ where: { orgId } });
  const isDefault = existingCount === 0;

  // Create payment method record
  const paymentMethod = pmRepo.create({
    orgId,
    stripePaymentMethodId,
    type: "card",
    lastFour: stripePm.card?.last4 || null,
    brand: stripePm.card?.brand || null,
    expMonth: stripePm.card?.exp_month || null,
    expYear: stripePm.card?.exp_year || null,
    isDefault,
  });

  await pmRepo.save(paymentMethod);

  logger.info("Payment method saved", {
    orgId,
    paymentMethodId: paymentMethod.id,
    brand: paymentMethod.brand,
    lastFour: paymentMethod.lastFour,
    isDefault,
  });

  return paymentMethod;
}

/**
 * List all payment methods for an organization
 */
export async function listPaymentMethods(
  orgId: string,
): Promise<PaymentMethod[]> {
  const pmRepo = AppDataSource.getRepository(PaymentMethod);
  return pmRepo.find({
    where: { orgId },
    order: { isDefault: "DESC", createdAt: "DESC" },
  });
}

/**
 * Delete a payment method
 */
export async function deletePaymentMethod(
  orgId: string,
  paymentMethodId: string,
): Promise<void> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const pmRepo = AppDataSource.getRepository(PaymentMethod);

  const pm = await pmRepo.findOne({
    where: { id: paymentMethodId, orgId },
  });

  if (!pm) {
    throw new Error("Payment method not found");
  }

  // Detach from Stripe
  try {
    await stripe.paymentMethods.detach(pm.stripePaymentMethodId);
  } catch (err) {
    console.error("[credit-billing] Stripe payment method detach failed:", err instanceof Error ? err.message : err);
  }

  // Delete from database
  await pmRepo.remove(pm);

  logger.info("Payment method deleted", {
    orgId,
    paymentMethodId,
  });
}

/**
 * Set a payment method as default for auto-recharge
 */
export async function setDefaultPaymentMethod(
  orgId: string,
  paymentMethodId: string,
): Promise<void> {
  const pmRepo = AppDataSource.getRepository(PaymentMethod);

  // Unset all defaults for this org
  await pmRepo.update({ orgId }, { isDefault: false });

  // Set new default
  const result = await pmRepo.update(
    { id: paymentMethodId, orgId },
    { isDefault: true },
  );

  if (result.affected === 0) {
    throw new Error("Payment method not found");
  }

  logger.info("Default payment method updated", {
    orgId,
    paymentMethodId,
  });
}

// =============================================================================
// Pre-Task Checks
// =============================================================================

/**
 * Check if organization can execute a cloud task.
 * Pro = local only, Max/Enterprise = cloud allowed with balance check.
 */
export async function canExecuteCloudTask(
  orgId: string,
): Promise<CanExecuteCloudTaskResult> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    return {
      allowed: false,
      reason: "Organization not found",
      balanceCents: 0,
    };
  }

  // Check if plan supports cloud execution
  const planFeatures =
    PLAN_FEATURES[org.plan as keyof typeof PLAN_FEATURES];
  if (!planFeatures?.cloudExecution) {
    return {
      allowed: false,
      reason:
        "Cloud execution is not available on your plan. Upgrade to Max to use cloud workers.",
      balanceCents: org.creditBalanceCents,
    };
  }

  // Check if billing is paused
  if (org.billingPaused) {
    return {
      allowed: false,
      reason: `Billing paused: ${org.billingPausedReason || "Payment required"}`,
      balanceCents: org.creditBalanceCents,
    };
  }

  // Check minimum balance ($5.00 required)
  const minBalance = config.billing.minBalanceToLaunchCents;
  if (org.creditBalanceCents < minBalance) {
    return {
      allowed: false,
      reason: `Insufficient cloud balance. You need at least $${(minBalance / 100).toFixed(2)} to start a cloud task. Current balance: $${(org.creditBalanceCents / 100).toFixed(2)}. Add funds at /billing.`,
      balanceCents: org.creditBalanceCents,
    };
  }

  return {
    allowed: true,
    balanceCents: org.creditBalanceCents,
  };
}

// =============================================================================
// Transaction History
// =============================================================================

/**
 * Get paginated transaction history for an organization
 */
export async function getTransactionHistory(
  orgId: string,
  options: {
    limit?: number;
    offset?: number;
    type?: CreditTransactionType;
    startDate?: Date;
    endDate?: Date;
  } = {},
): Promise<{ transactions: CreditTransaction[]; total: number }> {
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const queryBuilder = txRepo
    .createQueryBuilder("tx")
    .where("tx.org_id = :orgId", { orgId })
    .orderBy("tx.created_at", "DESC");

  if (options.type) {
    queryBuilder.andWhere("tx.type = :type", { type: options.type });
  }

  if (options.startDate) {
    queryBuilder.andWhere("tx.created_at >= :startDate", {
      startDate: options.startDate,
    });
  }

  if (options.endDate) {
    queryBuilder.andWhere("tx.created_at <= :endDate", {
      endDate: options.endDate,
    });
  }

  const total = await queryBuilder.getCount();

  if (options.limit) {
    queryBuilder.take(options.limit);
  }
  if (options.offset) {
    queryBuilder.skip(options.offset);
  }

  const transactions = await queryBuilder.getMany();

  return { transactions, total };
}

/**
 * Get this month's compute usage summary
 */
export async function getMonthlyUsage(orgId: string): Promise<{
  computeCostCents: number;
  totalMinutes: number;
  taskCount: number;
}> {
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const result = await txRepo
    .createQueryBuilder("tx")
    .select("SUM(ABS(tx.amount_cents))", "computeCostCents")
    .addSelect("COUNT(tx.id)", "taskCount")
    .where("tx.org_id = :orgId", { orgId })
    .andWhere("tx.type = :type", { type: "usage" })
    .andWhere("tx.created_at >= :startOfMonth", { startOfMonth })
    .getRawOne();

  // Sum up duration minutes from metadata
  const txsWithMetadata = await txRepo
    .createQueryBuilder("tx")
    .select("tx.metadata")
    .where("tx.org_id = :orgId", { orgId })
    .andWhere("tx.type = :type", { type: "usage" })
    .andWhere("tx.created_at >= :startOfMonth", { startOfMonth })
    .getMany();

  let totalMinutes = 0;
  for (const tx of txsWithMetadata) {
    const meta = tx.metadata as Record<string, unknown> | null;
    if (meta?.durationMinutes) {
      totalMinutes += meta.durationMinutes as number;
    }
  }

  return {
    computeCostCents: parseInt(result?.computeCostCents || "0", 10),
    totalMinutes,
    taskCount: parseInt(result?.taskCount || "0", 10),
  };
}

// =============================================================================
// Auto-Recharge Settings
// =============================================================================

/**
 * Get auto-recharge settings for an organization
 */
export async function getAutoRechargeSettings(orgId: string): Promise<{
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  return {
    enabled: org.autoRechargeEnabled,
    thresholdCents: org.autoRechargeThresholdCents,
    amountCents: org.autoRechargeAmountCents,
  };
}

/**
 * Update auto-recharge settings
 */
export async function updateAutoRechargeSettings(
  orgId: string,
  settings: {
    enabled?: boolean;
    thresholdCents?: number;
    amountCents?: number;
  },
): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });

  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  const updateData: {
    autoRechargeEnabled?: boolean;
    autoRechargeThresholdCents?: number;
    autoRechargeAmountCents?: number;
  } = {};
  if (settings.enabled !== undefined) {
    updateData.autoRechargeEnabled = settings.enabled;
  }
  if (settings.thresholdCents !== undefined) {
    updateData.autoRechargeThresholdCents = settings.thresholdCents;
  }
  if (settings.amountCents !== undefined) {
    updateData.autoRechargeAmountCents = settings.amountCents;
  }

  await orgRepo.update({ id: org.id }, updateData);

  logger.info("Auto-recharge settings updated", {
    orgId,
    ...updateData,
  });
}

// =============================================================================
// Manual Top-Up (Deposit)
// =============================================================================

/**
 * Process manual top-up (add funds)
 */
export async function processDeposit(
  orgId: string,
  paymentMethodId: string,
  amountCents: number,
): Promise<{
  paymentIntentId: string;
  requiresAction?: boolean;
  clientSecret?: string;
}> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    throw new Error(`Organization not found: ${orgId}`);
  }

  // Validate minimum top-up
  if (amountCents < config.billing.minTopUpCents) {
    throw new Error(
      `Minimum top-up is $${(config.billing.minTopUpCents / 100).toFixed(2)}`,
    );
  }

  if (!org.stripeCustomerId) {
    throw new Error("No Stripe customer — subscribe to a plan first");
  }

  // Create PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: org.stripeCustomerId,
    payment_method: paymentMethodId,
    confirm: true,
    off_session: true,
    metadata: {
      orgId,
      type: "manual_deposit",
    },
  });

  if (paymentIntent.status === "requires_action") {
    return {
      paymentIntentId: paymentIntent.id,
      requiresAction: true,
      clientSecret: paymentIntent.client_secret ?? undefined,
    };
  }

  if (paymentIntent.status === "succeeded") {
    // Add credits
    await addCredits(orgId, amountCents, "deposit", {
      description: "Manual top-up",
      stripePaymentIntentId: paymentIntent.id,
    });

    logger.info("Manual top-up processed", {
      orgId,
      amountCents,
      paymentIntentId: paymentIntent.id,
    });

    return { paymentIntentId: paymentIntent.id };
  } else {
    throw new Error(`Payment failed with status: ${paymentIntent.status}`);
  }
}

// =============================================================================
// Low Balance Email Notification
// =============================================================================

/**
 * Send a zero-balance email to org admins when balance hits $0
 * and auto-recharge is not enabled.
 * Updates lastBalanceEmailSentAt to prevent repeat sends within 7 days.
 */
async function sendZeroBalanceEmail(orgId: string): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);
  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) return;

  // Import UserOrganization dynamically to avoid circular deps
  const { UserOrganization } = await import("../models/UserOrganization.js");
  const { In } = await import("typeorm");
  const { sendLowBalanceEmail } = await import("./email/billing-emails.js");

  const userOrgRepo = AppDataSource.getRepository(UserOrganization);
  const adminMemberships = await userOrgRepo.find({
    where: {
      orgId,
      role: In(["admin", "owner"]),
    },
    relations: ["user"],
  });

  for (const membership of adminMemberships) {
    const user = membership.user;
    if (!user?.email) continue;

    await sendLowBalanceEmail(user, org, org.creditBalanceCents, 0).catch(
      (emailError) => {
        logger.error("Failed to send zero balance email to admin", {
          orgId,
          userId: user.id,
          error: emailError instanceof Error ? emailError.message : String(emailError),
        });
      },
    );
  }

  // Mark email as sent to prevent repeats
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({ lastBalanceEmailSentAt: new Date() })
    .where("id = :id", { id: orgId })
    .execute();

  logger.info("Zero balance email sent to org admins", {
    orgId,
    adminCount: adminMemberships.length,
  });
}

// =============================================================================
// Webhook Handlers
// =============================================================================

/**
 * Handle payment_intent.succeeded webhook
 * Adds credits for manual deposits or auto-recharge
 */
export async function handlePaymentIntentSucceeded(paymentIntent: {
  id: string;
  amount: number;
  metadata?: { orgId?: string; type?: string };
  charges?: { data: Array<{ id: string }> };
}): Promise<void> {
  const orgId = paymentIntent.metadata?.orgId;
  const type = paymentIntent.metadata?.type;

  if (!orgId) {
    logger.warn("Payment intent succeeded without orgId", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // For auto-recharge, the credits are already added in processAutoRecharge
  if (type === "auto_recharge") {
    logger.debug("Skipping payment_intent.succeeded for auto_recharge", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // For manual deposits via webhook (not API-initiated)
  const chargeId = paymentIntent.charges?.data?.[0]?.id;

  // Check if we already processed this payment intent
  const txRepo = AppDataSource.getRepository(CreditTransaction);
  const existingTx = await txRepo.findOne({
    where: { stripePaymentIntentId: paymentIntent.id },
  });

  if (existingTx) {
    logger.debug("Payment intent already processed", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Add credits
  await addCredits(orgId, paymentIntent.amount, "deposit", {
    description: `Deposit via ${type || "webhook"}`,
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId: chargeId,
  });

  logger.info("Payment intent succeeded - credits added", {
    orgId,
    amount: paymentIntent.amount,
    paymentIntentId: paymentIntent.id,
  });
}

/**
 * Handle payment_intent.payment_failed webhook
 * Pauses billing if this was an auto-recharge attempt
 */
export async function handlePaymentIntentFailed(paymentIntent: {
  id: string;
  metadata?: { orgId?: string; type?: string };
  last_payment_error?: { message?: string };
}): Promise<void> {
  const orgId = paymentIntent.metadata?.orgId;
  const type = paymentIntent.metadata?.type;

  if (!orgId) {
    logger.warn("Payment intent failed without orgId", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Only pause billing for auto-recharge failures
  if (type === "auto_recharge") {
    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({ where: { id: orgId } });

    if (org && !org.billingPaused) {
      await orgRepo.update(
        { id: org.id },
        {
          billingPaused: true,
          billingPausedReason: `Auto-recharge failed: ${paymentIntent.last_payment_error?.message || "Payment declined"}`,
        },
      );

      logger.warn("Billing paused due to auto-recharge failure", {
        orgId,
        paymentIntentId: paymentIntent.id,
        error: paymentIntent.last_payment_error?.message,
      });
    }
  }
}

/**
 * Handle setup_intent.succeeded webhook
 * Saves the payment method to the database
 */
export async function handleSetupIntentSucceeded(setupIntent: {
  id: string;
  metadata?: { orgId?: string };
  payment_method?: string;
}): Promise<void> {
  const orgId = setupIntent.metadata?.orgId;
  const paymentMethodId = setupIntent.payment_method;

  if (!orgId || !paymentMethodId) {
    logger.warn("Setup intent succeeded without required data", {
      setupIntentId: setupIntent.id,
      orgId,
      paymentMethodId,
    });
    return;
  }

  try {
    await savePaymentMethod(orgId, paymentMethodId);
    logger.info("Payment method saved via webhook", {
      orgId,
      setupIntentId: setupIntent.id,
    });
  } catch (error) {
    logger.error("Failed to save payment method from webhook", {
      orgId,
      setupIntentId: setupIntent.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle payment_method.detached webhook
 * Removes the payment method from our database
 */
export async function handlePaymentMethodDetached(paymentMethod: {
  id: string;
}): Promise<void> {
  const pmRepo = AppDataSource.getRepository(PaymentMethod);

  const pm = await pmRepo.findOne({
    where: { stripePaymentMethodId: paymentMethod.id },
  });

  if (pm) {
    await pmRepo.remove(pm);
    logger.info("Payment method removed via webhook", {
      stripePaymentMethodId: paymentMethod.id,
      orgId: pm.orgId,
    });
  }
}

/**
 * Handle charge.refunded webhook
 * Creates a refund transaction and deducts credits
 */
export async function handleChargeRefunded(charge: {
  id: string;
  amount_refunded: number;
  payment_intent?: string;
  metadata?: { orgId?: string };
}): Promise<void> {
  // Try to find the org from charge metadata or via payment intent
  let orgId = charge.metadata?.orgId;

  if (!orgId && charge.payment_intent) {
    // Look up the original transaction by payment intent
    const txRepo = AppDataSource.getRepository(CreditTransaction);
    const originalTx = await txRepo.findOne({
      where: { stripePaymentIntentId: charge.payment_intent },
    });
    if (originalTx) {
      orgId = originalTx.orgId;
    }
  }

  if (!orgId) {
    logger.warn("Charge refunded but could not determine orgId", {
      chargeId: charge.id,
    });
    return;
  }

  const orgRepo = AppDataSource.getRepository(Organization);
  const txRepo = AppDataSource.getRepository(CreditTransaction);

  const org = await orgRepo.findOne({ where: { id: orgId } });
  if (!org) {
    logger.error("Organization not found for refund", { orgId });
    return;
  }

  // Deduct the refunded amount atomically
  const refundCents = charge.amount_refunded;
  await orgRepo
    .createQueryBuilder()
    .update(Organization)
    .set({
      creditBalanceCents: () =>
        `GREATEST(0, "credit_balance_cents" - :refund)`,
    })
    .setParameter("refund", refundCents)
    .where("id = :id", { id: org.id })
    .execute();

  // Refresh org to get updated balance
  Object.assign(org, await orgRepo.findOneBy({ id: org.id }));

  const balanceAfter = org.creditBalanceCents;

  // Create refund transaction
  const transaction = txRepo.create({
    orgId,
    type: "refund" as CreditTransactionType,
    amountCents: -refundCents,
    balanceAfterCents: balanceAfter,
    description: "Refund processed",
    stripeChargeId: charge.id,
  });
  await txRepo.save(transaction);

  logger.info("Refund processed", {
    orgId,
    refundCents,
    balanceAfter,
    chargeId: charge.id,
  });
}
