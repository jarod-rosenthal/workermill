import { Router, Request, Response } from "express";
import { body, param, validationResult } from "express-validator";
import { randomBytes } from "crypto";
import { AppDataSource } from "../db/connection.js";
import { Organization, User, OrgInvite, type InviteRole } from "../models/index.js";
import { authenticateUser, requireAdmin } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "crypto";
import { sendInviteEmail } from "../services/email.js";

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
      defaultGithubRepo: org.defaultGithubRepo,
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
      const { name, defaultGithubRepo } = req.body;

      const orgRepo = AppDataSource.getRepository(Organization);

      if (name) org.name = name;
      if (defaultGithubRepo !== undefined) org.defaultGithubRepo = defaultGithubRepo;

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

      org.apiKey = `org_${randomUUID().replace(/-/g, "")}`;
      await orgRepo.save(org);

      logger.info("Organization API key rotated", { orgId: org.id });
      res.json({
        apiKey: org.apiKey,
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
      const user = req.user!;
      const { email, role } = req.body as { email: string; role: InviteRole };

      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userRepo = AppDataSource.getRepository(User);

      // Check if user is already a member of this org
      const existingUser = await userRepo.findOne({
        where: { email: email.toLowerCase(), orgId: org.id },
      });
      if (existingUser) {
        res.status(400).json({ error: "User is already a member of this organization" });
        return;
      }

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
        invitedBy: user.id,
        accepted: false,
      });

      await inviteRepo.save(invite);

      logger.info("Organization invite created", {
        orgId: org.id,
        inviteId: invite.id,
        email: invite.email,
        role: invite.role,
        invitedBy: user.id,
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
      let inviterEmail: string | null = null;
      if (invite.invitedBy) {
        const userRepo = AppDataSource.getRepository(User);
        const inviter = await userRepo.findOne({ where: { id: invite.invitedBy } });
        inviterEmail = inviter?.email || null;
      }

      res.json({
        organizationName: invite.organization.name,
        inviterEmail,
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
 * Accept an organization invite (requires authentication)
 */
inviteRouter.post(
  "/:token/accept",
  authenticateUser,
  [param("token").isString().isLength({ min: 64, max: 64 }).withMessage("Invalid invite token")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const token = req.params.token as string;
      const cognitoUser = req.cognitoUser!;

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

      // Check if invite email matches authenticated user's email
      if (invite.email.toLowerCase() !== cognitoUser.email.toLowerCase()) {
        res.status(403).json({
          error: "This invite was sent to a different email address",
        });
        return;
      }

      // Check if user already belongs to an organization
      const existingUser = await userRepo.findOne({
        where: { cognitoId: cognitoUser.sub },
      });

      if (existingUser) {
        // User already has an account - update their org membership
        // For now, prevent users from being in multiple orgs
        if (existingUser.orgId !== invite.orgId) {
          res.status(400).json({
            error:
              "You already belong to an organization. Please contact support to transfer organizations.",
          });
          return;
        }
        // User is already in this org
        res.status(400).json({ error: "You are already a member of this organization" });
        return;
      }

      // Create new user in the organization
      const newUser = userRepo.create({
        cognitoId: cognitoUser.sub,
        email: cognitoUser.email.toLowerCase(),
        orgId: invite.orgId,
        role: invite.role,
        status: "active",
      });

      await userRepo.save(newUser);

      // Mark invite as accepted and delete it
      await inviteRepo.remove(invite);

      logger.info("Organization invite accepted", {
        orgId: invite.orgId,
        userId: newUser.id,
        email: newUser.email,
        role: newUser.role,
      });

      res.json({
        success: true,
        message: "Invite accepted successfully",
        organization: {
          id: invite.organization.id,
          name: invite.organization.name,
        },
        role: newUser.role,
      });
    } catch (error) {
      logger.error("Error accepting invite", { error });
      res.status(500).json({ error: "Failed to accept invite" });
    }
  }
);

export default router;
