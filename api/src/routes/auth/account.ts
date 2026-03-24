import { Router, Request, Response } from "express";
import { body, validationResult } from "express-validator";
import { authenticateUser, authenticateUserAllowNoOrg } from "../../middleware/auth.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, Organization, OrgInvite, UserOrganization } from "../../models/index.js";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { TOS_VERSION } from "../../constants/tos.js";
import { logTosAccepted } from "../../services/audit.js";

const router = Router();

/**
 * GET /api/auth/me
 * Get current authenticated user info
 * Returns needsSetup: true if user doesn't have an organization yet
 * Returns isPlatformAdmin: true if user has access to platform management
 */
router.get("/me", authenticateUserAllowNoOrg, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const org = req.organization;

    // User needs to complete onboarding if they don't have an org
    const needsSetup = !org;

    // Check if user is a platform admin (supportAdmin + member of platform org)
    let isPlatformAdmin = false;
    if (user.supportAdmin) {
      const { isPlatformAdmin: checkPlatformAdmin } = await import("../../middleware/platform-auth.js");
      isPlatformAdmin = await checkPlatformAdmin(user.id);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: req.orgRole, // Role in current organization
        status: user.status,
        supportAdmin: user.supportAdmin || false,
        isPlatformAdmin,
        tosAcceptedAt: user.tosAcceptedAt,
        tosVersion: user.tosVersion,
        onboardingDismissed: user.preferences?.onboardingDismissed || false,
      },
      currentTosVersion: TOS_VERSION,
      organization: org ? {
        id: org.id,
        name: org.name,
        plan: org.plan,
        trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null,
        stripeSubscriptionStatus: org.stripeSubscriptionStatus,
      } : null,
      needsSetup,
    });
  } catch (error) {
    logger.error("Error getting user info", { error });
    res.status(500).json({ error: "Failed to get user info" });
  }
});

/**
 * POST /api/auth/dismiss-onboarding
 * Dismiss the getting started checklist permanently for this user.
 */
router.post("/dismiss-onboarding", authenticateUser, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const userRepo = AppDataSource.getRepository(User);
    const prefs = user.preferences || {};
    prefs.onboardingDismissed = true;
    await userRepo.update(user.id, { preferences: prefs });
    res.json({ ok: true });
  } catch (error) {
    logger.error("Error dismissing onboarding", { error });
    res.status(500).json({ error: "Failed to dismiss onboarding" });
  }
});

/**
 * POST /api/auth/accept-tos
 * Accept the current Terms of Service version.
 * Used when TOS version changes and existing users need to re-accept.
 */
router.post("/accept-tos", authenticateUserAllowNoOrg, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const userRepo = AppDataSource.getRepository(User);
    const now = new Date();

    // Atomic update — avoids clobbering concurrent changes
    await userRepo.update(
      { id: user.id },
      { tosAcceptedAt: now, tosVersion: TOS_VERSION },
    );

    // Audit log (fire-and-forget — org may not exist for mid-onboarding users)
    const orgId = req.organization?.id || user.orgId;
    if (orgId) {
      logTosAccepted(
        { organizationId: orgId, userId: user.id, ipAddress: req.ip || null },
        TOS_VERSION,
        "accept-tos-endpoint",
      ).catch(() => {});
    }

    res.json({ success: true, tosVersion: TOS_VERSION, acceptedAt: now });
  } catch (error) {
    logger.error("Error accepting TOS", { error });
    res.status(500).json({ error: "Failed to accept Terms of Service" });
  }
});

/**
 * GET /api/auth/pending-invite
 * Check if the authenticated user has a pending organization invite
 * Used by frontend to redirect users with pending invites to acceptance page
 */
router.get("/pending-invite", authenticateUserAllowNoOrg, async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.email) {
      return res.json({ pendingInvite: false });
    }

    const inviteRepo = AppDataSource.getRepository(OrgInvite);
    const invite = await inviteRepo.findOne({
      where: { email: user.email.toLowerCase(), accepted: false },
      relations: ["organization"],
    });

    if (invite && !invite.isExpired()) {
      return res.json({
        pendingInvite: true,
        inviteToken: invite.token,
        organizationName: invite.organization?.name,
        role: invite.role,
      });
    }

    return res.json({ pendingInvite: false });
  } catch (error) {
    logger.error("Error checking pending invite", { error });
    res.status(500).json({ error: "Failed to check pending invite" });
  }
});

/**
 * POST /api/auth/complete-setup
 * Complete user onboarding by either creating a new org or joining via invite
 */
router.post(
  "/complete-setup",
  authenticateUserAllowNoOrg,
  [
    body("action")
      .isIn(["create", "join"])
      .withMessage("Action must be 'create' or 'join'"),
    body("organizationName")
      .if(body("action").equals("create"))
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Organization name is required when creating (max 255 characters)"),
    body("inviteToken")
      .if(body("action").equals("join"))
      .trim()
      .isLength({ min: 1 })
      .withMessage("Invite token is required when joining"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const user = req.user!;

      // Check if user already has an org
      if (req.organization) {
        return res.status(400).json({
          error: "User already belongs to an organization",
        });
      }

      const { action, organizationName, inviteToken } = req.body;
      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      if (action === "create") {
        // Check if user has a pending invite - they should accept it instead of creating a new org
        const pendingInvite = await inviteRepo.findOne({
          where: { email: user.email.toLowerCase(), accepted: false },
          relations: ["organization"],
        });
        if (pendingInvite && !pendingInvite.isExpired()) {
          logger.warn("User tried to create org but has pending invite", {
            userId: user.id,
            email: user.email,
            inviteOrgId: pendingInvite.orgId,
            inviteOrgName: pendingInvite.organization?.name,
          });
          return res.status(400).json({
            error: "You have a pending invitation to join an organization. Please accept it instead of creating a new one.",
            inviteToken: pendingInvite.token,
            inviteOrgName: pendingInvite.organization?.name,
          });
        }

        // Generate slug from organization name
        const baseSlug = organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");

        // Check for slug uniqueness and add suffix if needed
        let slug = baseSlug;
        let slugSuffix = 0;
        while (await orgRepo.findOne({ where: { slug } })) {
          slugSuffix++;
          slug = `${baseSlug}-${slugSuffix}`;
        }

        // Create new organization
        const setupRawKey = `org_${randomUUID().replace(/-/g, "")}`;
        const org = orgRepo.create({
          name: organizationName,
          slug,
          plan: "pro",
          taskQuota: 0, // Unlimited tasks (feature-gated, not quota-based)
          trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),

          apiKeyHash: await bcrypt.hash(setupRawKey, 10),
          apiKeyPrefix: setupRawKey.substring(0, 12),
        });
        await orgRepo.save(org);

        // No need to update user.orgId/role - UserOrganization is source of truth
        await userRepo.save(user);

        // Create UserOrganization record for multi-org support
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const membership = userOrgRepo.create({
          userId: user.id,
          orgId: org.id,
          role: "admin",
          isDefault: true,
        });
        await userOrgRepo.save(membership);

        logger.info("User completed setup - created org", {
          userId: user.id,
          orgId: org.id,
          orgName: org.name,
        });

        return res.json({
          message: "Organization created successfully",
          organization: {
            id: org.id,
            name: org.name,
            plan: org.plan,
            trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null,
            stripeSubscriptionStatus: org.stripeSubscriptionStatus,
          },
        });
      } else {
        // Join via invite token
        const inviteRepo = AppDataSource.getRepository(OrgInvite);
        const invite = await inviteRepo.findOne({
          where: { token: inviteToken },
          relations: ["organization"],
        });

        if (!invite) {
          return res.status(400).json({ error: "Invalid invite token" });
        }

        if (!invite.isValid()) {
          return res.status(400).json({
            error: invite.accepted
              ? "This invite has already been used"
              : "This invite has expired",
          });
        }

        // Check if invite is for this user's email
        if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
          return res.status(400).json({
            error: "This invite was sent to a different email address",
          });
        }

        // Mark invite as accepted
        invite.accepted = true;
        await inviteRepo.save(invite);

        // No need to update user.orgId/role - UserOrganization is source of truth
        await userRepo.save(user);

        // Create UserOrganization record for multi-org support
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const existingMembership = await userOrgRepo.findOne({
          where: { userId: user.id, orgId: invite.orgId },
        });
        if (!existingMembership) {
          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: invite.orgId,
            role: invite.role as "admin" | "member" | "viewer",
            isDefault: true,
            invitedBy: invite.invitedBy,
          });
          await userOrgRepo.save(membership);
        }

        logger.info("User completed setup - joined org via invite", {
          userId: user.id,
          orgId: invite.orgId,
          orgName: invite.organization.name,
          role: invite.role,
        });

        return res.json({
          message: "Successfully joined organization",
          organization: {
            id: invite.organization.id,
            name: invite.organization.name,
            plan: invite.organization.plan,
            trialExpiresAt: invite.organization.trialExpiresAt ? invite.organization.trialExpiresAt.toISOString() : null,
            stripeSubscriptionStatus: invite.organization.stripeSubscriptionStatus,
          },
        });
      }
    } catch (error) {
      logger.error("Error completing setup", { error });
      res.status(500).json({ error: "Failed to complete setup" });
    }
  }
);

export default router;
