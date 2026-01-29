/**
 * Referral Service
 *
 * Handles referral program logic:
 * - Generating referral codes
 * - Tracking referral signups
 * - Validating referrals (anti-fraud)
 * - Awarding credits when referrals qualify
 */

import { AppDataSource } from "../db/connection.js";
import {
  Referral,
  ReferralStatus,
  REFERRAL_CREDIT_CENTS,
  REFERRAL_DISCOUNT_PERCENT,
  REFERRAL_DISCOUNT_MONTHS,
  MAX_REFERRALS_PER_YEAR,
  REFERRAL_EXPIRY_MONTHS,
} from "../models/Referral.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { CreditTransaction } from "../models/CreditTransaction.js";
import { logger } from "../utils/logger.js";
import { MoreThan, Between } from "typeorm";
import crypto from "crypto";

const referralRepo = () => AppDataSource.getRepository(Referral);
const userRepo = () => AppDataSource.getRepository(User);
const orgRepo = () => AppDataSource.getRepository(Organization);
const creditTxRepo = () => AppDataSource.getRepository(CreditTransaction);

/**
 * Generate a unique referral code for a user
 */
export function generateReferralCode(userId: string): string {
  // Use first 8 chars of a hash for a short, unique code
  const hash = crypto.createHash("sha256").update(userId + Date.now().toString()).digest("hex");
  return hash.substring(0, 8).toUpperCase();
}

/**
 * Get or create a referral code for a user
 */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await userRepo().findOne({ where: { id: userId } });
  if (!user) {
    throw new Error("User not found");
  }

  // Return existing code if present
  if (user.referralCode) {
    return user.referralCode;
  }

  // Generate new code
  let code = generateReferralCode(userId);
  let attempts = 0;
  const maxAttempts = 5;

  // Ensure uniqueness
  while (attempts < maxAttempts) {
    const existing = await userRepo().findOne({ where: { referralCode: code } });
    if (!existing) break;
    code = generateReferralCode(userId + attempts);
    attempts++;
  }

  // Save to user
  user.referralCode = code;
  await userRepo().save(user);

  logger.info("Generated referral code for user", { userId, code });
  return code;
}

/**
 * Get user's referral statistics
 */
export async function getReferralStats(userId: string): Promise<{
  referralCode: string;
  totalReferrals: number;
  pendingReferrals: number;
  qualifiedReferrals: number;
  creditedReferrals: number;
  totalCreditsEarned: number;
  referralsThisYear: number;
  referralsRemaining: number;
}> {
  const code = await getOrCreateReferralCode(userId);

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const referrals = await referralRepo().find({
    where: { referrerUserId: userId },
  });

  const thisYearReferrals = referrals.filter(
    (r) => r.createdAt >= oneYearAgo && r.status !== "expired" && r.status !== "revoked"
  );

  const stats = {
    referralCode: code,
    totalReferrals: referrals.length,
    pendingReferrals: referrals.filter((r) => r.status === "pending" || r.status === "signed_up").length,
    qualifiedReferrals: referrals.filter((r) => r.status === "qualified").length,
    creditedReferrals: referrals.filter((r) => r.status === "credited").length,
    totalCreditsEarned: referrals
      .filter((r) => r.status === "credited")
      .reduce((sum, r) => sum + r.creditAmountCents, 0),
    referralsThisYear: thisYearReferrals.length,
    referralsRemaining: Math.max(0, MAX_REFERRALS_PER_YEAR - thisYearReferrals.length),
  };

  return stats;
}

/**
 * Get list of referrals for a user
 */
export async function getUserReferrals(userId: string): Promise<Referral[]> {
  return referralRepo().find({
    where: { referrerUserId: userId },
    order: { createdAt: "DESC" },
    relations: ["referredUser", "referredOrg"],
  });
}

/**
 * Validate a referral code and check if it can be used
 */
export async function validateReferralCode(
  code: string,
  referredEmail: string,
  referredIp?: string
): Promise<{ valid: boolean; error?: string; referrerId?: string }> {
  // Find the referrer by code
  const referrer = await userRepo().findOne({
    where: { referralCode: code },
    relations: ["organization"],
  });

  if (!referrer) {
    return { valid: false, error: "Invalid referral code" };
  }

  // Check if referrer has reached yearly limit
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const thisYearReferrals = await referralRepo().count({
    where: {
      referrerUserId: referrer.id,
      createdAt: MoreThan(oneYearAgo),
      status: MoreThan("expired") as any, // Not expired or revoked - this is a hack, should use NOT IN
    },
  });

  // Better query for counting valid referrals this year
  const validReferralsThisYear = await referralRepo()
    .createQueryBuilder("r")
    .where("r.referrer_user_id = :userId", { userId: referrer.id })
    .andWhere("r.created_at > :oneYearAgo", { oneYearAgo })
    .andWhere("r.status NOT IN (:...excludedStatuses)", { excludedStatuses: ["expired", "revoked"] })
    .getCount();

  if (validReferralsThisYear >= MAX_REFERRALS_PER_YEAR) {
    return { valid: false, error: "Referrer has reached yearly referral limit" };
  }

  // Anti-fraud: Check for self-referral by email domain
  const referredDomain = referredEmail.split("@")[1]?.toLowerCase();
  const referrerDomain = referrer.email.split("@")[1]?.toLowerCase();

  if (referredDomain && referrerDomain && referredDomain === referrerDomain) {
    // Same email domain - could be self-referral, but allow common domains
    const commonDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "proton.me", "protonmail.com"];
    if (!commonDomains.includes(referredDomain)) {
      logger.warn("Potential self-referral detected (same email domain)", {
        referralCode: code,
        referredEmail,
        referrerEmail: referrer.email,
      });
      return { valid: false, error: "Cannot use referral code from same organization" };
    }
  }

  // Check if this email was already referred
  const existingReferral = await referralRepo().findOne({
    where: { referredEmail: referredEmail.toLowerCase() },
  });

  if (existingReferral) {
    return { valid: false, error: "This email has already been referred" };
  }

  return { valid: true, referrerId: referrer.id };
}

/**
 * Apply a referral code when a new user signs up
 */
export async function applyReferralCode(
  referralCode: string,
  referredUserId: string,
  referredOrgId: string,
  referredEmail: string,
  referredIp?: string
): Promise<{ success: boolean; error?: string; discountPercent?: number; discountMonths?: number }> {
  // Validate the code
  const validation = await validateReferralCode(referralCode, referredEmail, referredIp);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const referrer = await userRepo().findOne({
    where: { referralCode: referralCode },
    relations: ["organization"],
  });

  if (!referrer || !referrer.orgId) {
    return { success: false, error: "Invalid referral code" };
  }

  // Create the referral record
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + REFERRAL_EXPIRY_MONTHS);

  const referral = referralRepo().create({
    referrerUserId: referrer.id,
    referrerOrgId: referrer.orgId,
    referralCode: referralCode,
    referredEmail: referredEmail.toLowerCase(),
    referredUserId: referredUserId,
    referredOrgId: referredOrgId,
    referredEmailDomain: referredEmail.split("@")[1]?.toLowerCase(),
    referredIp: referredIp,
    status: "signed_up" as ReferralStatus,
    signedUpAt: new Date(),
    expiresAt: expiresAt,
    creditAmountCents: REFERRAL_CREDIT_CENTS,
    referredDiscountPercent: REFERRAL_DISCOUNT_PERCENT,
    referredDiscountMonths: REFERRAL_DISCOUNT_MONTHS,
  });

  await referralRepo().save(referral);

  // Update the referred user's record
  const referredUser = await userRepo().findOne({ where: { id: referredUserId } });
  if (referredUser) {
    referredUser.referredByCode = referralCode;
    await userRepo().save(referredUser);
  }

  logger.info("Referral code applied", {
    referralId: referral.id,
    referralCode,
    referrerId: referrer.id,
    referredUserId,
    referredOrgId,
  });

  return {
    success: true,
    discountPercent: REFERRAL_DISCOUNT_PERCENT,
    discountMonths: REFERRAL_DISCOUNT_MONTHS,
  };
}

/**
 * Mark a referral as qualified (referred user completed first paid month)
 * Called by billing webhook when first subscription payment succeeds
 */
export async function markReferralQualified(referredOrgId: string): Promise<void> {
  const referral = await referralRepo().findOne({
    where: {
      referredOrgId: referredOrgId,
      status: "signed_up" as ReferralStatus,
    },
  });

  if (!referral) {
    logger.debug("No pending referral found for org", { referredOrgId });
    return;
  }

  // Check if expired
  if (new Date() > referral.expiresAt) {
    referral.status = "expired";
    await referralRepo().save(referral);
    logger.info("Referral expired before qualification", { referralId: referral.id });
    return;
  }

  // Mark as qualified
  referral.status = "qualified";
  referral.qualifiedAt = new Date();
  await referralRepo().save(referral);

  logger.info("Referral qualified", {
    referralId: referral.id,
    referrerId: referral.referrerUserId,
    referredOrgId,
  });

  // Award credit to referrer
  await awardReferralCredit(referral.id);
}

/**
 * Award referral credit to the referrer
 */
export async function awardReferralCredit(referralId: string): Promise<void> {
  const referral = await referralRepo().findOne({
    where: { id: referralId },
  });

  if (!referral) {
    throw new Error("Referral not found");
  }

  if (referral.status !== "qualified") {
    logger.warn("Cannot award credit - referral not qualified", { referralId, status: referral.status });
    return;
  }

  // Get referrer's org
  const referrerOrg = await orgRepo().findOne({ where: { id: referral.referrerOrgId } });
  if (!referrerOrg) {
    logger.error("Referrer org not found", { referralId, orgId: referral.referrerOrgId });
    return;
  }

  // Add credit to referrer's org
  referrerOrg.creditBalanceCents += referral.creditAmountCents;
  await orgRepo().save(referrerOrg);

  // Create credit transaction record
  const transaction = creditTxRepo().create({
    orgId: referral.referrerOrgId,
    type: "referral_bonus",
    amountCents: referral.creditAmountCents,
    balanceAfterCents: referrerOrg.creditBalanceCents,
    description: `Referral bonus for referring a new customer`,
    metadata: {
      referralId: referral.id,
      referredOrgId: referral.referredOrgId,
    },
  });
  await creditTxRepo().save(transaction);

  // Update referral status
  referral.status = "credited";
  referral.creditedAt = new Date();
  await referralRepo().save(referral);

  logger.info("Referral credit awarded", {
    referralId,
    referrerOrgId: referral.referrerOrgId,
    creditAmountCents: referral.creditAmountCents,
    newBalance: referrerOrg.creditBalanceCents,
  });
}

/**
 * Get referral discount for an organization (if any)
 */
export async function getReferralDiscount(orgId: string): Promise<{
  hasDiscount: boolean;
  discountPercent: number;
  monthsRemaining: number;
}> {
  const referral = await referralRepo().findOne({
    where: { referredOrgId: orgId },
  });

  if (!referral) {
    return { hasDiscount: false, discountPercent: 0, monthsRemaining: 0 };
  }

  const monthsRemaining = Math.max(0, referral.referredDiscountMonths - referral.referredDiscountUsedMonths);

  return {
    hasDiscount: monthsRemaining > 0,
    discountPercent: monthsRemaining > 0 ? referral.referredDiscountPercent : 0,
    monthsRemaining,
  };
}

/**
 * Record that a discount month was used
 * Called by billing when processing subscription payment
 */
export async function recordDiscountUsed(orgId: string): Promise<void> {
  const referral = await referralRepo().findOne({
    where: { referredOrgId: orgId },
  });

  if (!referral) return;

  if (referral.referredDiscountUsedMonths < referral.referredDiscountMonths) {
    referral.referredDiscountUsedMonths += 1;
    await referralRepo().save(referral);

    logger.info("Referral discount month used", {
      referralId: referral.id,
      orgId,
      usedMonths: referral.referredDiscountUsedMonths,
      totalMonths: referral.referredDiscountMonths,
    });
  }
}

/**
 * Expire old pending referrals
 * Should be run periodically (e.g., daily cron job)
 */
export async function expireOldReferrals(): Promise<number> {
  const result = await referralRepo()
    .createQueryBuilder()
    .update(Referral)
    .set({ status: "expired" as ReferralStatus })
    .where("status IN (:...statuses)", { statuses: ["pending", "signed_up"] })
    .andWhere("expires_at < :now", { now: new Date() })
    .execute();

  if (result.affected && result.affected > 0) {
    logger.info("Expired old referrals", { count: result.affected });
  }

  return result.affected || 0;
}

/**
 * Revoke a referral (for fraud/abuse cases)
 */
export async function revokeReferral(referralId: string, reason: string): Promise<void> {
  const referral = await referralRepo().findOne({ where: { id: referralId } });
  if (!referral) {
    throw new Error("Referral not found");
  }

  // If credit was already awarded, we might want to deduct it
  if (referral.status === "credited") {
    const referrerOrg = await orgRepo().findOne({ where: { id: referral.referrerOrgId } });
    if (referrerOrg) {
      referrerOrg.creditBalanceCents = Math.max(0, referrerOrg.creditBalanceCents - referral.creditAmountCents);
      await orgRepo().save(referrerOrg);

      // Record the clawback transaction
      const transaction = creditTxRepo().create({
        orgId: referral.referrerOrgId,
        type: "adjustment",
        amountCents: -referral.creditAmountCents,
        balanceAfterCents: referrerOrg.creditBalanceCents,
        description: `Referral credit revoked: ${reason}`,
        metadata: {
          referralId: referral.id,
          reason,
        },
      });
      await creditTxRepo().save(transaction);
    }
  }

  referral.status = "revoked";
  await referralRepo().save(referral);

  logger.warn("Referral revoked", { referralId, reason });
}
