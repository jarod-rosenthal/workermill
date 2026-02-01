/**
 * Referral Program Routes
 *
 * API endpoints for the referral program:
 * - Get referral code and stats
 * - List referrals
 * - Validate referral codes
 * - Apply referral codes during signup
 */

import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { body, query, validateRequest } from "../middleware/validation.js";
import { logger } from "../utils/logger.js";
import {
  getOrCreateReferralCode,
  getReferralStats,
  getUserReferrals,
  validateReferralCode,
  applyReferralCode,
  getReferralDiscount,
} from "../services/referral.js";
import {
  REFERRAL_CREDIT_CENTS,
  REFERRAL_DISCOUNT_PERCENT,
  REFERRAL_DISCOUNT_MONTHS,
  MAX_REFERRALS_PER_YEAR,
} from "../models/Referral.js";
import { BadRequestError } from "../utils/errors.js";

const router = Router();

/**
 * @swagger
 * /api/referrals/info:
 *   get:
 *     summary: Get referral program information
 *     description: Returns referral program details (rewards, limits, etc.)
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Referral program information
 */
router.get("/info", (_req: Request, res: Response) => {
  res.json({
    program: {
      referrerReward: {
        amountCents: REFERRAL_CREDIT_CENTS,
        amountFormatted: `$${(REFERRAL_CREDIT_CENTS / 100).toFixed(0)}`,
        description: "Account credit per successful referral",
      },
      referredReward: {
        discountPercent: REFERRAL_DISCOUNT_PERCENT,
        discountMonths: REFERRAL_DISCOUNT_MONTHS,
        description: `${REFERRAL_DISCOUNT_PERCENT}% off first ${REFERRAL_DISCOUNT_MONTHS} months`,
      },
      limits: {
        maxReferralsPerYear: MAX_REFERRALS_PER_YEAR,
        creditExpiryMonths: 12,
      },
      conditions: [
        "Credit unlocks after referred user completes first paid month",
        "Maximum 10 referrals per year",
        "Credits expire after 12 months",
        "Cannot refer users from the same organization",
      ],
    },
  });
});

/**
 * @swagger
 * /api/referrals/code:
 *   get:
 *     summary: Get user's referral code
 *     description: Returns the authenticated user's referral code (creates one if needed)
 *     tags: [Referrals]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User's referral code
 */
router.get(
  "/code",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const code = await getOrCreateReferralCode(userId);

    res.json({
      referralCode: code,
      referralLink: `https://workermill.com/signup?ref=${code}`,
    });
  })
);

/**
 * @swagger
 * /api/referrals/stats:
 *   get:
 *     summary: Get user's referral statistics
 *     description: Returns referral counts, credits earned, and remaining referrals
 *     tags: [Referrals]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Referral statistics
 */
router.get(
  "/stats",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const stats = await getReferralStats(userId);

    res.json({
      ...stats,
      referralLink: `https://workermill.com/signup?ref=${stats.referralCode}`,
      totalCreditsEarnedFormatted: `$${(stats.totalCreditsEarned / 100).toFixed(2)}`,
    });
  })
);

/**
 * @swagger
 * /api/referrals:
 *   get:
 *     summary: List user's referrals
 *     description: Returns all referrals made by the authenticated user
 *     tags: [Referrals]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of referrals
 */
router.get(
  "/",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const referrals = await getUserReferrals(userId);

    res.json({
      referrals: referrals.map((r) => ({
        id: r.id,
        status: r.status,
        referredEmail: r.referredEmail ? maskEmail(r.referredEmail) : null,
        creditAmountCents: r.creditAmountCents,
        creditAmountFormatted: `$${(r.creditAmountCents / 100).toFixed(0)}`,
        signedUpAt: r.signedUpAt,
        qualifiedAt: r.qualifiedAt,
        creditedAt: r.creditedAt,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
    });
  })
);

/**
 * @swagger
 * /api/referrals/validate:
 *   post:
 *     summary: Validate a referral code
 *     description: Check if a referral code is valid (used during signup)
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *               - email
 *             properties:
 *               code:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Validation result
 */
router.post(
  "/validate",
  [
    body("code").isString().isLength({ min: 1, max: 50 }).trim(),
    body("email").isEmail().normalizeEmail(),
    validateRequest,
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const { code, email } = req.body;
    const ip = req.ip || req.headers["x-forwarded-for"]?.toString();

    const result = await validateReferralCode(code, email, ip);

    if (!result.valid) {
      res.json({
        valid: false,
        error: result.error,
      });
      return;
    }

    res.json({
      valid: true,
      rewards: {
        discountPercent: REFERRAL_DISCOUNT_PERCENT,
        discountMonths: REFERRAL_DISCOUNT_MONTHS,
        description: `You'll get ${REFERRAL_DISCOUNT_PERCENT}% off your first ${REFERRAL_DISCOUNT_MONTHS} months!`,
      },
    });
  })
);

/**
 * @swagger
 * /api/referrals/apply:
 *   post:
 *     summary: Apply a referral code to a new user
 *     description: Called after user signup to link referral (internal use)
 *     tags: [Referrals]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - code
 *             properties:
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Referral applied successfully
 */
router.post(
  "/apply",
  authenticateUser,
  [body("code").isString().isLength({ min: 1, max: 50 }).trim(), validateRequest],
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.body;
    const user = req.user!;
    const ip = req.ip || req.headers["x-forwarded-for"]?.toString();

    const org = req.organization;
    if (!org) {
      throw new BadRequestError("User must belong to an organization");
    }

    const result = await applyReferralCode(code, user.id, org.id, user.email, ip);

    if (!result.success) {
      throw new BadRequestError(result.error || "Failed to apply referral code");
    }

    res.json({
      success: true,
      message: `Referral applied! You'll get ${result.discountPercent}% off your first ${result.discountMonths} months.`,
      discount: {
        percent: result.discountPercent,
        months: result.discountMonths,
      },
    });
  })
);

/**
 * @swagger
 * /api/referrals/discount:
 *   get:
 *     summary: Get referral discount for current org
 *     description: Check if the organization has a referral discount active
 *     tags: [Referrals]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Discount information
 */
router.get(
  "/discount",
  authenticateUser,
  asyncHandler(async (req: Request, res: Response) => {
    const org = req.organization;

    if (!org) {
      res.json({ hasDiscount: false, discountPercent: 0, monthsRemaining: 0 });
      return;
    }

    const discount = await getReferralDiscount(org.id);
    res.json(discount);
  })
);

/**
 * Mask email for privacy (show first 2 chars + domain)
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const masked = local.length > 2 ? local.substring(0, 2) + "***" : "***";
  return `${masked}@${domain}`;
}

export default router;
