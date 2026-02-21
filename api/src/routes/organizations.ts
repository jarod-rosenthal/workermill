import { Router, Request, Response } from "express";
import { body, param, validationResult } from "express-validator";
import { randomBytes } from "crypto";
import { AppDataSource } from "../db/connection.js";
import { Organization, User, OrgInvite, UserOrganization, type InviteRole, PLAN_USER_LIMITS, type OrganizationPlan } from "../models/index.js";
import { authenticateUser, authenticateCognitoOnly, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { sendInviteEmail, sendOrgAddedEmail, sendWelcomeEmail } from "../services/email/index.js";
import { TOS_VERSION } from "../constants/tos.js";
import { logTosAccepted } from "../services/audit.js";

const router = Router();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/organizations/current
 * Get current organization details
 */
router.get("/current", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    res.json({
      id: org.id,
      name: org.name,
      plan: org.plan,
      defaultRepo: org.getDefaultRepo(),
      scmProvider: org.scmProvider,
      createdAt: org.createdAt,
    });
  } catch (error) {
    logger.error("Error getting organization", { error });
    res.status(500).json({ error: "Failed to get organization" });
  }
});

/**
 * PATCH /api/organizations/current
 * Update current organization (admin only)
 */
router.patch(
  "/current",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { name, defaultRepo } = req.body;

      const orgRepo = AppDataSource.getRepository(Organization);

      if (name) org.name = name;
      if (defaultRepo !== undefined) org.setDefaultRepo(org.scmProvider, defaultRepo);

      await orgRepo.save(org);

      logger.info("Organization updated", { orgId: org.id });
      res.json(org);
    } catch (error) {
      logger.error("Error updating organization", { error });
      res.status(500).json({ error: "Failed to update organization" });
    }
  }
);

/**
 * GET /api/organizations/current/members
 * List all members of the current organization
 */
router.get("/current/members", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const userOrgRepo = AppDataSource.getRepository(UserOrganization);

    // Query from UserOrganization (single source of truth)
    const memberships = await userOrgRepo
      .createQueryBuilder("uo")
      .innerJoinAndSelect("uo.user", "user")
      .where("uo.orgId = :orgId", { orgId: org.id })
      .andWhere("user.status = :status", { status: "active" })
      .orderBy("uo.joinedAt", "DESC")
      .getMany();

    res.json({
      members: memberships.map((membership) => ({
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.fullName,
        role: membership.role, // Role from UserOrganization
        createdAt: membership.joinedAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing organization members", { error });
    res.status(500).json({ error: "Failed to list organization members" });
  }
});

/**
 * PATCH /api/organizations/current/members/:id
 * Update a member's role (admin only)
 * Cannot change your own role or demote the last admin
 */
router.patch(
  "/current/members/:id",
  requireAdmin,
  [
    param("id").isUUID().withMessage("Invalid member ID"),
    body("role")
      .isIn(["admin", "member", "viewer"])
      .withMessage("Role must be admin, member, or viewer"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const org = req.organization!;
      const currentUser = req.user!;
      const memberId = req.params.id as string;
      const { role } = req.body;

      const userOrgRepo = AppDataSource.getRepository(UserOrganization);

      // Find the membership via UserOrganization (supports multi-org users)
      const membership = await userOrgRepo.findOne({
        where: { userId: memberId, orgId: org.id },
        relations: ["user"],
      });

      if (!membership || !membership.user) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const member = membership.user;

      // Prevent changing your own role
      if (member.id === currentUser.id) {
        res.status(400).json({ error: "You cannot change your own role" });
        return;
      }

      // If demoting an admin, ensure there's at least one other admin
      if (membership.role === "admin" && role !== "admin") {
        const adminCount = await userOrgRepo.count({
          where: { orgId: org.id, role: "admin" },
        });

        if (adminCount <= 1) {
          res.status(400).json({
            error: "Cannot demote the last admin. Promote another member first.",
          });
          return;
        }
      }

      const previousRole = membership.role;
      membership.role = role as "admin" | "member" | "viewer";
      await userOrgRepo.save(membership);

      logger.info("Member role updated", {
        orgId: org.id,
        memberId: member.id,
        previousRole,
        newRole: role,
        updatedBy: currentUser.id,
      });

      res.json({
        success: true,
        message: `Role updated to ${role}`,
        member: {
          id: member.id,
          email: member.email,
          name: member.fullName,
          role: membership.role,
        },
      });
    } catch (error) {
      logger.error("Error updating member role", { error });
      res.status(500).json({ error: "Failed to update member role" });
    }
  }
);

/**
 * DELETE /api/organizations/current/members/:id
 * Remove a member from the organization (admin only)
 * Cannot remove yourself or the last admin
 */
router.delete(
  "/current/members/:id",
  requireAdmin,
  [param("id").isUUID().withMessage("Invalid member ID")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const org = req.organization!;
      const currentUser = req.user!;
      const memberId = req.params.id as string;

      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const userRepo = AppDataSource.getRepository(User);

      // Find the membership via UserOrganization (supports multi-org users)
      const membership = await userOrgRepo.findOne({
        where: { userId: memberId, orgId: org.id },
        relations: ["user"],
      });

      if (!membership || !membership.user) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const member = membership.user;

      // Prevent removing yourself
      if (member.id === currentUser.id) {
        res.status(400).json({ error: "You cannot remove yourself from the organization" });
        return;
      }

      // If removing an admin, ensure there's at least one other admin
      if (membership.role === "admin") {
        const adminCount = await userOrgRepo.count({
          where: { orgId: org.id, role: "admin" },
        });

        if (adminCount <= 1) {
          res.status(400).json({
            error: "Cannot remove the last admin. Promote another member first.",
          });
          return;
        }
      }

      // Remove the UserOrganization record for this org
      await userOrgRepo.remove(membership);

      // Check if user belongs to other organizations
      const otherMemberships = await userOrgRepo.find({
        where: { userId: member.id },
        order: { isDefault: "DESC", createdAt: "ASC" },
      });

      const removedEmail = member.email;

      if (otherMemberships.length > 0) {
        // User has other orgs - set their orgId to the default one (or first available)
        const newDefaultMembership = otherMemberships.find(m => m.isDefault) || otherMemberships[0];

        // Ensure exactly one membership is marked as default
        if (!otherMemberships.some(m => m.isDefault)) {
          newDefaultMembership.isDefault = true;
          await userOrgRepo.save(newDefaultMembership);
        }

        member.orgId = newDefaultMembership.orgId;
        // Keep the role from the new default org's membership
        member.role = newDefaultMembership.role as "admin" | "member" | "viewer";
      } else {
        // No other orgs - set orgId to null
        member.orgId = null;
        member.role = "member"; // Reset to default role
      }

      await userRepo.save(member);

      logger.info("Member removed from organization", {
        orgId: org.id,
        memberId: member.id,
        email: removedEmail,
        removedBy: currentUser.id,
        newOrgId: member.orgId,
        hasOtherOrgs: otherMemberships.length > 0,
      });

      res.json({
        success: true,
        message: "Member removed from organization",
      });
    } catch (error) {
      logger.error("Error removing member", { error });
      res.status(500).json({ error: "Failed to remove member" });
    }
  }
);

/**
 * POST /api/organizations/current/rotate-api-key
 * Rotate organization API key (admin only)
 */
router.post(
  "/current/rotate-api-key",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const orgRepo = AppDataSource.getRepository(Organization);

      const rawKey = `org_${randomUUID().replace(/-/g, "")}`;
      org.apiKeyHash = await bcrypt.hash(rawKey, 10);
      org.apiKeyPrefix = rawKey.substring(0, 12);
      // Do NOT store raw key — only the hash and prefix
      await orgRepo.update({ id: org.id }, { apiKeyHash: org.apiKeyHash, apiKeyPrefix: org.apiKeyPrefix });

      logger.info("Organization API key rotated", { orgId: org.id });
      res.json({
        apiKey: rawKey,
        message: "API key rotated successfully. Update your integrations.",
      });
    } catch (error) {
      logger.error("Error rotating API key", { error });
      res.status(500).json({ error: "Failed to rotate API key" });
    }
  }
);

// =============================================================================
// Organization Invite Routes
// =============================================================================

/**
 * POST /api/organizations/current/invites
 * Create a new organization invite (admin only)
 *
 * If the user already exists in WorkerMill, they are added directly to the org.
 * If the user doesn't exist, an invite is created and emailed.
 */
router.post(
  "/current/invites",
  requireAdmin,
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("role")
      .isIn(["admin", "member", "viewer"])
      .withMessage("Role must be admin, member, or viewer"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const org = req.organization!;
      const currentUser = req.user!;
      const { email, role } = req.body as { email: string; role: InviteRole };

      // Enforce seat limits based on plan
      const seatLimit =
        PLAN_USER_LIMITS[org.plan as OrganizationPlan] ?? PLAN_USER_LIMITS.free;
      if (seatLimit !== -1) {
        const userOrgCount = AppDataSource.getRepository(UserOrganization);
        const currentSeats = await userOrgCount.count({
          where: { orgId: org.id },
        });
        if (currentSeats >= seatLimit) {
          res.status(403).json({
            error: `Your ${org.plan} plan allows ${seatLimit} seat(s). Upgrade to add more members.`,
          });
          return;
        }
      }

      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userRepo = AppDataSource.getRepository(User);
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);

      // Check if user already exists in WorkerMill (any org)
      const existingUser = await userRepo.findOne({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        // User exists in WorkerMill - check if already in this org via user_organizations
        const existingMembership = await userOrgRepo.findOne({
          where: { userId: existingUser.id, orgId: org.id },
        });

        if (existingMembership) {
          res.status(400).json({ error: "User is already a member of this organization" });
          return;
        }

        // User exists but not in this org - add them directly
        // Check if this will be their first org (make it default)
        const existingMembershipCount = await userOrgRepo.count({ where: { userId: existingUser.id } });
        const membership = userOrgRepo.create({
          userId: existingUser.id,
          orgId: org.id,
          role: role as "admin" | "member" | "viewer",
          isDefault: existingMembershipCount === 0,
          invitedBy: currentUser.id,
        });

        await userOrgRepo.save(membership);

        logger.info("Existing user added to organization", {
          orgId: org.id,
          userId: existingUser.id,
          email: existingUser.email,
          role,
          addedBy: currentUser.id,
          isDefault: existingMembershipCount === 0,
        });

        // Send notification email
        let emailSent = false;
        try {
          emailSent = await sendOrgAddedEmail(existingUser, org, role, currentUser);
        } catch (emailError) {
          logger.error("Failed to send org added email", {
            error: emailError instanceof Error ? emailError.message : String(emailError),
            userId: existingUser.id,
            email: existingUser.email,
          });
        }

        res.status(201).json({
          id: membership.id,
          email: existingUser.email,
          role,
          addedDirectly: true,
          userId: existingUser.id,
          createdAt: membership.createdAt,
          emailSent,
          message: "User added to organization directly (they already have a WorkerMill account)",
        });
        return;
      }

      // User doesn't exist in WorkerMill - create invite as before

      // Check if there's already a pending invite for this email
      const existingInvite = await inviteRepo.findOne({
        where: { email: email.toLowerCase(), orgId: org.id, accepted: false },
      });
      if (existingInvite && !existingInvite.isExpired()) {
        res.status(400).json({ error: "An active invite already exists for this email" });
        return;
      }

      // If there's an expired invite, delete it
      if (existingInvite) {
        await inviteRepo.remove(existingInvite);
      }

      // Generate secure token
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

      const invite = inviteRepo.create({
        orgId: org.id,
        email: email.toLowerCase(),
        role,
        token,
        expiresAt,
        invitedBy: currentUser.id,
        accepted: false,
      });

      await inviteRepo.save(invite);

      logger.info("Organization invite created", {
        orgId: org.id,
        inviteId: invite.id,
        email: invite.email,
        role: invite.role,
        invitedBy: currentUser.id,
      });

      // Send invite email (non-blocking - don't fail invite creation if email fails)
      let emailSent = false;
      try {
        emailSent = await sendInviteEmail(invite, org);
      } catch (emailError) {
        logger.error("Failed to send invite email", {
          error: emailError instanceof Error ? emailError.message : String(emailError),
          inviteId: invite.id,
          email: invite.email,
        });
      }

      res.status(201).json({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        addedDirectly: false,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        emailSent,
      });
    } catch (error) {
      logger.error("Error creating invite", { error });
      res.status(500).json({ error: "Failed to create invite" });
    }
  }
);

/**
 * GET /api/organizations/current/invites
 * List all pending invites for current organization
 */
router.get("/current/invites", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const inviteRepo = AppDataSource.getRepository(OrgInvite);

    // Get all non-expired, non-accepted invites
    const invites = await inviteRepo
      .createQueryBuilder("invite")
      .where("invite.orgId = :orgId", { orgId: org.id })
      .andWhere("invite.accepted = false")
      .andWhere("invite.expiresAt > :now", { now: new Date() })
      .orderBy("invite.createdAt", "DESC")
      .getMany();

    res.json({
      invites: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Error listing invites", { error });
    res.status(500).json({ error: "Failed to list invites" });
  }
});

/**
 * DELETE /api/organizations/current/invites/:id
 * Revoke an organization invite (admin only)
 */
router.delete(
  "/current/invites/:id",
  requireAdmin,
  [param("id").isUUID().withMessage("Invalid invite ID")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const org = req.organization!;
      const inviteId = req.params.id as string;
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      const invite = await inviteRepo.findOne({
        where: { id: inviteId, orgId: org.id },
      });

      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      await inviteRepo.remove(invite);

      logger.info("Organization invite revoked", {
        orgId: org.id,
        inviteId,
        email: invite.email,
      });

      res.json({ success: true, message: "Invite revoked successfully" });
    } catch (error) {
      logger.error("Error revoking invite", { error });
      res.status(500).json({ error: "Failed to revoke invite" });
    }
  }
);

/**
 * POST /api/organizations/current/invites/:id/resend
 * Resend an organization invite email (admin only)
 */
router.post(
  "/current/invites/:id/resend",
  requireAdmin,
  [param("id").isUUID().withMessage("Invalid invite ID")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const org = req.organization!;
      const inviteId = req.params.id as string;
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      const invite = await inviteRepo.findOne({
        where: { id: inviteId, orgId: org.id },
      });

      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      // Check if invite is expired
      if (invite.expiresAt < new Date()) {
        res.status(400).json({ error: "Invite has expired. Please create a new invite." });
        return;
      }

      // Send invite email
      const emailSent = await sendInviteEmail(invite, org);

      if (!emailSent) {
        res.status(500).json({ error: "Failed to send invite email" });
        return;
      }

      logger.info("Invite email resent successfully", {
        orgId: org.id,
        inviteId,
        email: invite.email,
      });

      res.json({ success: true, message: "Invite email sent successfully", email: invite.email });
    } catch (error) {
      logger.error("Error resending invite", { error });
      res.status(500).json({ error: "Failed to resend invite" });
    }
  }
);

// =============================================================================
// Public Invite Routes (no auth required for viewing, auth required for accepting)
// =============================================================================

// These routes are mounted at /api/invites in the main app
// We'll export a separate router for these

export const inviteRouter = Router();

/**
 * GET /api/invites/:token
 * Get invite details by token (PUBLIC - no auth required)
 */
inviteRouter.get(
  "/:token",
  [param("token").isString().isLength({ min: 64, max: 64 }).withMessage("Invalid invite token")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const token = req.params.token as string;
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      const invite = await inviteRepo.findOne({
        where: { token },
        relations: ["organization"],
      });

      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      if (invite.accepted) {
        res.status(400).json({ error: "Invite has already been accepted" });
        return;
      }

      if (invite.isExpired()) {
        res.status(400).json({ error: "Invite has expired" });
        return;
      }

      // Get inviter info
      let inviterName: string | null = null;
      if (invite.invitedBy) {
        const userRepo = AppDataSource.getRepository(User);
        const inviter = await userRepo.findOne({ where: { id: invite.invitedBy } });
        // Use full name if available, otherwise email
        inviterName = inviter?.fullName || inviter?.email || null;
      }

      res.json({
        id: invite.id,
        organizationName: invite.organization.name,
        inviterName,
        role: invite.role,
        email: invite.email,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      logger.error("Error getting invite details", { error });
      res.status(500).json({ error: "Failed to get invite details" });
    }
  }
);

/**
 * POST /api/invites/:token/accept
 * Accept an organization invite (requires Cognito authentication, but user may not exist in DB yet)
 */
inviteRouter.post(
  "/:token/accept",
  authenticateCognitoOnly,
  [
    param("token").isString().isLength({ min: 64, max: 64 }).withMessage("Invalid invite token"),
    body("tosAccepted").optional().isBoolean().withMessage("tosAccepted must be a boolean"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const token = req.params.token as string;
      const cognitoUser = req.cognitoUser!;
      const { tosAccepted } = req.body;

      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userRepo = AppDataSource.getRepository(User);

      const invite = await inviteRepo.findOne({
        where: { token },
        relations: ["organization"],
      });

      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      if (invite.accepted) {
        res.status(400).json({ error: "Invite has already been accepted" });
        return;
      }

      if (invite.isExpired()) {
        res.status(400).json({ error: "Invite has expired" });
        return;
      }

      // Note: We don't compare cognitoUser.email with invite.email because:
      // 1. Cognito access tokens don't include the email claim
      // 2. The invite link itself acts as proof of email ownership (sent to that email)
      // 3. Using the invite's email ensures user is created with the invited email

      // Check if user already belongs to an organization
      const existingUser = await userRepo.findOne({
        where: { cognitoId: cognitoUser.sub },
      });

      if (existingUser) {
        // User already has an account - check their org membership via UserOrganization
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const existingMembership = await userOrgRepo.findOne({
          where: { userId: existingUser.id, orgId: invite.orgId },
        });

        if (existingMembership) {
          // User is already in this org - treat as success and clean up invite
          await inviteRepo.remove(invite);

          logger.info("Invite accepted - user already member", {
            orgId: invite.orgId,
            userId: existingUser.id,
            email: existingUser.email,
          });

          res.json({
            success: true,
            message: "You are already a member of this organization",
            organization: {
              id: invite.organization.id,
              name: invite.organization.name,
            },
            role: existingMembership.role,
          });
          return;
        }

        // Check if user has any org memberships
        const existingMembershipCount = await userOrgRepo.count({ where: { userId: existingUser.id } });

        if (existingMembershipCount === 0) {
          // Update ToS acceptance if provided
          if (tosAccepted && !existingUser.tosAcceptedAt) {
            existingUser.tosAcceptedAt = new Date();
            existingUser.tosVersion = TOS_VERSION;
            await userRepo.save(existingUser);
            logTosAccepted(
              { organizationId: invite.orgId, userId: existingUser.id, ipAddress: req.ip || null },
              TOS_VERSION,
              "invite-acceptance",
            ).catch(() => {});
          }

          // Create UserOrganization record (single source of truth)
          // We already checked above that user is not in this org
          const membership = userOrgRepo.create({
            userId: existingUser.id,
            orgId: invite.orgId,
            role: invite.role as "admin" | "member" | "viewer",
            isDefault: true,
            invitedBy: invite.invitedBy,
          });
          await userOrgRepo.save(membership);

          await inviteRepo.remove(invite);

          logger.info("Invite accepted - assigned org to existing user", {
            orgId: invite.orgId,
            userId: existingUser.id,
            email: existingUser.email,
            role: invite.role,
          });

          res.json({
            success: true,
            message: "Invite accepted successfully",
            organization: {
              id: invite.organization.id,
              name: invite.organization.name,
            },
            role: invite.role,
          });
          return;
        }

        // User belongs to a different organization - add them to this org as well (multi-org support)
        // We already checked above that user is not in the invited org

        // Clear existing default org so the newly joined org becomes default
        await userOrgRepo.update(
          { userId: existingUser.id, isDefault: true },
          { isDefault: false }
        );

        const membership = userOrgRepo.create({
          userId: existingUser.id,
          orgId: invite.orgId,
          role: invite.role as "admin" | "member" | "viewer",
          isDefault: true, // New org becomes default - user expects to land here after accepting invite
          invitedBy: invite.invitedBy,
        });
        await userOrgRepo.save(membership);

        await inviteRepo.remove(invite);

        // Send notification email to user joining additional org
        if (invite.invitedBy) {
          const inviter = await userRepo.findOne({ where: { id: invite.invitedBy } });
          if (inviter) {
            sendOrgAddedEmail(existingUser, invite.organization, invite.role, inviter).catch((err) => {
              logger.warn("Failed to send org added email", { error: err, userId: existingUser.id });
            });
          }
        }

        logger.info("Invite accepted - user added to additional org", {
          orgId: invite.orgId,
          userId: existingUser.id,
          email: existingUser.email,
          role: invite.role,
        });

        res.json({
          success: true,
          message: "Invite accepted successfully. You can switch organizations in your profile.",
          organization: {
            id: invite.organization.id,
            name: invite.organization.name,
          },
          role: invite.role,
        });
        return;
      }

      // Create new user in the organization
      // Use the invite's email (not cognitoUser.email which isn't in access tokens)
      const newUser = userRepo.create({
        cognitoId: cognitoUser.sub,
        email: invite.email.toLowerCase(),
        orgId: null, // UserOrganization is source of truth
        role: "member", // Default role, UserOrganization has actual role
        status: "active",
        tosAcceptedAt: tosAccepted ? new Date() : null,
        tosVersion: tosAccepted ? TOS_VERSION : null,
      });

      await userRepo.save(newUser);

      // Create UserOrganization junction record for multi-org support
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const membership = userOrgRepo.create({
        userId: newUser.id,
        orgId: invite.orgId,
        role: invite.role as "admin" | "member" | "viewer",
        isDefault: true,
        invitedBy: invite.invitedBy,
      });
      await userOrgRepo.save(membership);

      // Mark invite as accepted and delete it
      await inviteRepo.remove(invite);

      // Send welcome email to new user (async, don't block response)
      sendWelcomeEmail(newUser, invite.organization, true).catch((err) => {
        logger.warn("Failed to send welcome email", { error: err, userId: newUser.id });
      });

      if (tosAccepted) {
        logTosAccepted(
          { organizationId: invite.orgId, userId: newUser.id, ipAddress: req.ip || null },
          TOS_VERSION,
          "invite-acceptance",
        ).catch(() => {});
      }

      logger.info("Organization invite accepted", {
        orgId: invite.orgId,
        userId: newUser.id,
        email: newUser.email,
        role: invite.role,
      });

      res.json({
        success: true,
        message: "Invite accepted successfully",
        organization: {
          id: invite.organization.id,
          name: invite.organization.name,
        },
        role: invite.role,
      });
    } catch (error) {
      logger.error("Error accepting invite", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ error: "Failed to accept invite" });
    }
  }
);

/**
 * POST /api/organizations/complete-setup
 * Called when user finishes the setup wizard
 * Currently a no-op but can be used for analytics or triggers
 */
router.post("/complete-setup", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    logger.info("Setup wizard completed", {
      orgId: org.id,
      userId: user.id,
      orgName: org.name,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Error completing setup", { error });
    res.status(500).json({ error: "Failed to complete setup" });
  }
});

export default router;
