import { Router, Request, Response } from "express";
import {
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { body, validationResult } from "express-validator";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { AppDataSource } from "../../db/connection.js";
import { User, Organization, OrgInvite, UserOrganization } from "../../models/index.js";
import { applyReferralCode } from "../../services/referral.js";
import { notifyNewSignup } from "../../services/admin-notifications.js";
import { sendWelcomeEmail } from "../../services/email/index.js";
import { getDefaultOrganization } from "../../services/user-organizations.js";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { TOS_VERSION } from "../../constants/tos.js";
import { logTosAccepted } from "../../services/audit.js";
import { cognitoClient } from "./helpers.js";

const router = Router();

/**
 * POST /api/auth/signup
 * Register a new user with email and password via Cognito
 * Creates Organization and User records in the database
 */
router.post(
  "/signup",
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 8 })
      .withMessage("Password must be at least 8 characters")
      .matches(/[A-Z]/)
      .withMessage("Password must contain at least one uppercase letter")
      .matches(/[a-z]/)
      .withMessage("Password must contain at least one lowercase letter")
      .matches(/[0-9]/)
      .withMessage("Password must contain at least one number"),
    body("name")
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Name is required (max 255 characters)"),
    body("organizationName")
      .optional() // Optional - not required if user has a pending invite
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Organization name must be max 255 characters"),
    body("referralCode")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Referral code must be max 50 characters"),
    body("tosAccepted")
      .optional()
      .isBoolean()
      .withMessage("tosAccepted must be a boolean"),
  ],
  async (req: Request, res: Response) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { email, password, name, organizationName, referralCode, tosAccepted } = req.body;

      // Check if email already exists in our database
      const userRepo = AppDataSource.getRepository(User);
      const existingUser = await userRepo.findOne({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists" });
      }

      // Create user in Cognito (email verification required)
      const signUpCommand = new SignUpCommand({
        ClientId: config.cognito.clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          {
            Name: "email",
            Value: email,
          },
          {
            Name: "name",
            Value: name,
          },
        ],
      });

      let cognitoResponse;
      try {
        cognitoResponse = await cognitoClient.send(signUpCommand);
      } catch (cognitoError: any) {
        logger.error("Cognito signup error", { error: cognitoError.message, email });

        if (cognitoError.name === "UsernameExistsException") {
          return res.status(409).json({ error: "An account with this email already exists" });
        }

        if (cognitoError.name === "InvalidPasswordException") {
          return res.status(400).json({
            error: "Password does not meet requirements",
            details: cognitoError.message,
          });
        }

        if (cognitoError.name === "InvalidParameterException") {
          return res.status(400).json({
            error: "Invalid registration parameters",
            details: cognitoError.message,
          });
        }

        // Pre-signup Lambda validation failed (e.g., invite-only access)
        if (cognitoError.name === "UserLambdaValidationException") {
          // Extract the actual error message from Lambda
          // Cognito wraps it as: "PreSignUp failed with error <message>."
          const match = cognitoError.message?.match(/PreSignUp failed with error (.+?)\.?$/);
          let lambdaMessage = match ? match[1] : cognitoError.message;
          // Remove trailing period if present (Cognito adds one)
          if (lambdaMessage?.endsWith('.')) {
            lambdaMessage = lambdaMessage.slice(0, -1);
          }

          return res.status(403).json({
            error: lambdaMessage || "Registration not allowed",
            code: "INVITE_REQUIRED",
          });
        }

        throw cognitoError;
      }

      const cognitoUserId = cognitoResponse.UserSub;
      const userConfirmed = cognitoResponse.UserConfirmed ?? false;

      if (!cognitoUserId) {
        logger.error("Cognito signup did not return UserSub", { email });
        return res.status(500).json({ error: "Registration failed - no user ID returned" });
      }

      logger.info("Cognito signup response", { email, cognitoUserId, userConfirmed });

      // Check if there's a pending valid invite for this email
      // If so, don't create a new org - the user will join the invited org via invite acceptance
      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const pendingInvite = await inviteRepo.findOne({
        where: { email: email.toLowerCase(), accepted: false },
      });
      const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

      // Validate organizationName is provided if user doesn't have a pending invite
      if (!hasValidInvite && (!organizationName || organizationName.trim().length === 0)) {
        return res.status(400).json({
          error: "Organization name is required",
          details: "Please provide an organization name to create your account",
        });
      }

      let org: Organization | null = null;
      let user: User;

      if (hasValidInvite) {
        // User has a pending invite - create user WITHOUT an org
        // They will join the invited org via /api/invites/:token/accept
        logger.info("User has pending invite, skipping org creation", {
          email,
          inviteOrgId: pendingInvite.orgId,
        });

        user = userRepo.create({
          cognitoId: cognitoUserId,
          email,
          fullName: name,
          role: "member", // Will be set by invite acceptance
          status: userConfirmed ? "active" : "pending",
          orgId: null, // No org yet - will be assigned on invite acceptance
          tosAcceptedAt: tosAccepted ? new Date() : null,
          tosVersion: tosAccepted ? TOS_VERSION : null,
        });
        await userRepo.save(user);

        logger.info("User registered (pending invite acceptance)", {
          userId: user.id,
          email,
          cognitoUserId,
          inviteOrgId: pendingInvite.orgId,
        });
      } else {
        // No invite - create new Organization
        const orgRepo = AppDataSource.getRepository(Organization);

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

        const signupRawKey = `org_${randomUUID().replace(/-/g, "")}`;
        org = orgRepo.create({
          name: organizationName,
          slug,
          plan: "pro",
          taskQuota: 0, // Unlimited tasks (feature-gated, not quota-based)
          trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),

          apiKeyHash: await bcrypt.hash(signupRawKey, 10),
          apiKeyPrefix: signupRawKey.substring(0, 12),
        });
        await orgRepo.save(org);

        // Create User record linked to the organization
        // If user was auto-confirmed (e.g., via invite flow), they're already active
        user = userRepo.create({
          cognitoId: cognitoUserId,
          email,
          fullName: name,
          role: "admin", // First user is admin of their org
          status: userConfirmed ? "active" : "pending", // Active if auto-confirmed, else pending verification
          orgId: null, // UserOrganization is source of truth
          tosAcceptedAt: tosAccepted ? new Date() : null,
          tosVersion: tosAccepted ? TOS_VERSION : null,
        });
        await userRepo.save(user);

        // Create UserOrganization record (single source of truth for membership)
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const membership = userOrgRepo.create({
          userId: user.id,
          orgId: org.id,
          role: "admin",
          isDefault: true,
        });
        await userOrgRepo.save(membership);

        logger.info("User registered successfully", {
          userId: user.id,
          orgId: org.id,
          email,
          cognitoUserId,
        });

        if (tosAccepted) {
          logTosAccepted(
            { organizationId: org.id, userId: user.id, ipAddress: req.ip || null },
            TOS_VERSION,
            "signup",
          ).catch(() => {});
        }
      }

      // Apply referral code if provided (only if user has an org)
      let referralApplied = false;
      let referralDiscount: { percent: number; months: number } | undefined;

      if (referralCode && org) {
        try {
          const referralResult = await applyReferralCode(
            referralCode,
            user.id,
            org.id,
            email,
            req.ip || req.headers["x-forwarded-for"]?.toString()
          );

          if (referralResult.success) {
            referralApplied = true;
            referralDiscount = {
              percent: referralResult.discountPercent!,
              months: referralResult.discountMonths!,
            };
            logger.info("Referral code applied during signup", {
              userId: user.id,
              orgId: null, // UserOrganization is source of truth
              referralCode,
            });
          } else {
            logger.warn("Failed to apply referral code during signup", {
              userId: user.id,
              referralCode,
              error: referralResult.error,
            });
          }
        } catch (referralError) {
          logger.error("Error applying referral code", { referralCode, error: referralError });
          // Don't fail signup if referral fails
        }
      }

      // Notify admin of new signup (async, don't block response)
      notifyNewSignup({
        email: user.email,
        fullName: user.fullName || "Unknown",
        organizationName: org?.name || "(pending invite acceptance)",
        referralCode: referralCode ? String(referralCode) : undefined,
      }).catch((err) => {
        logger.warn("Failed to send admin signup notification", { error: err });
      });

      // Send welcome email if user is auto-confirmed AND has an org (async, don't block response)
      // For invited users, welcome email is sent after invite acceptance
      if (userConfirmed && org) {
        sendWelcomeEmail(user, org, false).catch((err) => {
          logger.warn("Failed to send welcome email", { error: err, userId: user.id });
        });
      }

      res.status(201).json({
        message: hasValidInvite
          ? userConfirmed
            ? "Registration successful. Please accept your invitation to complete setup."
            : "Registration successful. Please verify your email, then accept your invitation."
          : userConfirmed
            ? "Registration successful. Your account is ready."
            : "Registration successful. Please check your email to verify your account.",
        user: {
          id: user.id,
          email: user.email,
          name: user.fullName,
        },
        organization: org
          ? {
              id: org.id,
              name: org.name,
            }
          : null,
        referralApplied,
        referralDiscount,
        // If user was auto-confirmed (e.g., had valid invite), no email verification needed
        userConfirmed,
        // Let frontend know user needs to accept an invite
        pendingInvite: hasValidInvite,
        // Include invite token so frontend can redirect to acceptance page
        inviteToken: hasValidInvite ? pendingInvite.token : undefined,
      });
    } catch (error: any) {
      logger.error("Signup error", { error: error.message });
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  }
);

/**
 * POST /api/auth/confirm
 * Confirm user email with verification code from Cognito
 */
router.post(
  "/confirm",
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("code")
      .isString()
      .isLength({ min: 6, max: 6 })
      .withMessage("Verification code must be 6 digits"),
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

      const { email, code } = req.body;

      const confirmCommand = new ConfirmSignUpCommand({
        ClientId: config.cognito.clientId,
        Username: email,
        ConfirmationCode: code,
      });

      await cognitoClient.send(confirmCommand);

      // Update user status to active
      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const user = await userRepo.findOne({ where: { email } });
      if (user && user.status === "pending") {
        user.status = "active";
        await userRepo.save(user);

        // Send welcome email now that user is active (async, don't block response)
        const defaultOrg = await getDefaultOrganization(user.id);
        if (defaultOrg) {
          sendWelcomeEmail(user, defaultOrg, false).catch((err) => {
            logger.warn("Failed to send welcome email", { error: err, userId: user.id });
          });
        }
      }

      logger.info("User email confirmed", { email });

      res.json({
        message: "Email verified successfully. You can now log in.",
      });
    } catch (error: any) {
      logger.error("Email confirmation error", { error: error.message });

      if (error.name === "CodeMismatchException") {
        return res.status(400).json({ error: "Invalid verification code" });
      }

      if (error.name === "ExpiredCodeException") {
        return res.status(400).json({
          error: "Verification code has expired. Please request a new one.",
        });
      }

      if (error.name === "UserNotFoundException") {
        return res.status(400).json({ error: "User not found" });
      }

      if (error.name === "NotAuthorizedException") {
        return res.status(400).json({ error: "User is already confirmed" });
      }

      res.status(500).json({ error: "Failed to verify email" });
    }
  }
);

/**
 * POST /api/auth/resend-code
 * Resend verification code to user's email
 */
router.post(
  "/resend-code",
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: "Validation failed",
          details: errors.array(),
        });
      }

      const { email } = req.body;

      const resendCommand = new ResendConfirmationCodeCommand({
        ClientId: config.cognito.clientId,
        Username: email,
      });

      await cognitoClient.send(resendCommand);

      logger.info("Verification code resent", { email });

      res.json({
        message: "Verification code sent. Please check your email.",
      });
    } catch (error: any) {
      logger.error("Resend code error", { error: error.message });

      if (error.name === "UserNotFoundException") {
        // Don't reveal if user exists
        return res.json({
          message: "If an account exists, a verification code has been sent.",
        });
      }

      if (error.name === "LimitExceededException") {
        return res.status(429).json({
          error: "Too many requests. Please wait before requesting another code.",
        });
      }

      res.status(500).json({ error: "Failed to send verification code" });
    }
  },
);

export default router;
