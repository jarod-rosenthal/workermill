import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  ListIdentityProvidersCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { body, validationResult } from "express-validator";
import { authenticateUser, authenticateApiKey } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { User, Organization, OrgInvite, UserOrganization, UserApiKey } from "../models/index.js";
import { applyReferralCode, validateReferralCode } from "../services/referral.js";
import { notifyNewSignup } from "../services/admin-notifications.js";
import { sendWelcomeEmail } from "../services/email/index.js";
import {
  getDefaultOrganization,
  getUserOrganizations,
  hasOrgAccess,
} from "../services/user-organizations.js";
import { randomBytes, randomUUID, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { authenticateUserAllowNoOrg } from "../middleware/auth.js";
import axios from "axios";
import rateLimit from "express-rate-limit";
import { createStore } from "../middleware/rate-limit.js";
import { saveOrgSecret } from "./settings/helpers.js";
import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminInitiateAuthCommand,
  AdminSetUserMFAPreferenceCommand,
  AuthFlowType as AdminAuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { TOS_VERSION } from "../constants/tos.js";
import { logTosAccepted } from "../services/audit.js";
import { redis } from "../services/redis-client.js";

const router = Router();

// Cognito client
const cognitoClient = new CognitoIdentityProviderClient({
  region: config.cognito.region,
});

/**
 * Decode JWT payload without verification (for extracting claims)
 */
function decodeJwtPayload(token: string): Record<string, any> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  const payload = Buffer.from(parts[1], "base64url").toString("utf8");
  return JSON.parse(payload);
}

/**
 * POST /api/auth/login
 * Login with email and password via Cognito
 * Returns MFA challenge info if MFA is enabled
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const command = new InitiateAuthCommand({
      AuthFlow: AdminAuthFlowType.USER_PASSWORD_AUTH,
      ClientId: config.cognito.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

    // Check if MFA challenge is required
    if (response.ChallengeName === "SOFTWARE_TOKEN_MFA") {
      logger.info("MFA challenge required for login", { email });
      return res.json({
        challengeRequired: true,
        challengeName: response.ChallengeName,
        session: response.Session,
        email,
      });
    }

    if (!response.AuthenticationResult) {
      return res.status(401).json({ error: "Authentication failed" });
    }

    const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
      response.AuthenticationResult;

    // Auto-provision user if not exists (without org - they'll complete setup on first visit)
    if (IdToken) {
      try {
        const idPayload = decodeJwtPayload(IdToken);
        const cognitoId = idPayload.sub;
        const userEmail = idPayload.email;

        const userRepo = AppDataSource.getRepository(User);

        let user = await userRepo.findOne({ where: { cognitoId } });

        if (!user) {
          // Check for pending invite before auto-provisioning
          const inviteRepo = AppDataSource.getRepository(OrgInvite);
          const pendingInvite = await inviteRepo.findOne({
            where: { email: userEmail.toLowerCase(), accepted: false },
          });
          const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

          logger.info("Auto-provisioning new user (pending setup)", {
            email: userEmail,
            cognitoId,
            hasValidInvite,
            inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
          });

          // Create user WITHOUT org - they'll complete setup via invite acceptance or onboarding
          user = userRepo.create({
            cognitoId,
            email: userEmail.toLowerCase(), // Normalize email
            fullName: userEmail.split("@")[0],
            role: hasValidInvite ? "member" : "admin", // Member if invited, admin if creating own org
            status: "active",
            orgId: null, // No org yet - requires invite acceptance or onboarding
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("User provisioned (pending org setup)", { userId: user.id, hasValidInvite });
        }
      } catch (provisionError) {
        logger.error("Failed to auto-provision user", { error: provisionError });
        // Continue anyway - login succeeded, provisioning is best-effort
      }
    }

    res.json({
      tokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        idToken: IdToken,
        expiresIn: ExpiresIn,
      },
    });
  } catch (error: any) {
    logger.error("Login error", { error: error.message });

    if (error.name === "NotAuthorizedException") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (error.name === "UserNotFoundException") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (error.name === "UserNotConfirmedException") {
      return res.status(401).json({ error: "Please confirm your email first" });
    }

    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /api/auth/mfa-challenge
 * Complete MFA login challenge with TOTP code
 */
router.post("/mfa-challenge", async (req: Request, res: Response) => {
  try {
    const { email, session, code } = req.body;

    if (!email || !session || !code) {
      return res.status(400).json({ error: "Email, session, and verification code are required" });
    }

    if (typeof code !== "string" || code.length !== 6) {
      return res.status(400).json({ error: "Verification code must be 6 digits" });
    }

    const command = new RespondToAuthChallengeCommand({
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      ClientId: config.cognito.clientId,
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    });

    const response = await cognitoClient.send(command);

    if (!response.AuthenticationResult) {
      return res.status(401).json({ error: "MFA verification failed" });
    }

    const { AccessToken, RefreshToken, IdToken, ExpiresIn } =
      response.AuthenticationResult;

    // Auto-provision user if not exists (without org - they'll complete setup on first visit)
    if (IdToken) {
      try {
        const idPayload = decodeJwtPayload(IdToken);
        const cognitoId = idPayload.sub;
        const userEmail = idPayload.email;

        const userRepo = AppDataSource.getRepository(User);

        let user = await userRepo.findOne({ where: { cognitoId } });

        if (!user) {
          // Check for pending invite before auto-provisioning
          const inviteRepo = AppDataSource.getRepository(OrgInvite);
          const pendingInvite = await inviteRepo.findOne({
            where: { email: userEmail.toLowerCase(), accepted: false },
          });
          const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

          logger.info("Auto-provisioning new user (pending setup)", {
            email: userEmail,
            cognitoId,
            hasValidInvite,
            inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
          });

          // Create user WITHOUT org - they'll complete setup via invite acceptance or onboarding
          user = userRepo.create({
            cognitoId,
            email: userEmail.toLowerCase(), // Normalize email
            fullName: userEmail.split("@")[0],
            role: hasValidInvite ? "member" : "admin", // Member if invited, admin if creating own org
            status: "active",
            orgId: null, // No org yet - requires invite acceptance or onboarding
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("User provisioned (pending org setup)", { userId: user.id, hasValidInvite });
        }
      } catch (provisionError) {
        logger.error("Failed to auto-provision user", { error: provisionError });
      }
    }

    logger.info("MFA challenge completed successfully", { email });

    res.json({
      tokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        idToken: IdToken,
        expiresIn: ExpiresIn,
      },
    });
  } catch (error: any) {
    logger.error("MFA challenge error", { error: error.message });

    if (error.name === "CodeMismatchException") {
      return res.status(400).json({ error: "Invalid verification code. Please try again." });
    }

    if (error.name === "ExpiredCodeException" || error.name === "NotAuthorizedException") {
      return res.status(400).json({ error: "Session expired. Please start the login process again." });
    }

    res.status(500).json({ error: "MFA verification failed" });
  }
});

/**
 * POST /api/auth/mfa/recover
 * Recover account using a backup code when MFA device is lost.
 * Accepts { email, backupCode }, verifies against stored hashed codes,
 * disables MFA on the Cognito account, and removes the used code.
 * User can then log in normally and re-setup MFA if desired.
 */
router.post("/mfa/recover", async (req: Request, res: Response) => {
  try {
    const { email, backupCode } = req.body;

    if (!email || !backupCode) {
      return res.status(400).json({ error: "Email and backup code are required" });
    }

    if (typeof backupCode !== "string" || backupCode.length !== 8) {
      return res.status(400).json({ error: "Backup code must be an 8-character string" });
    }

    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      // Return generic error to prevent email enumeration
      return res.status(400).json({ error: "Invalid email or backup code" });
    }

    if (!user.mfaBackupCodes || user.mfaBackupCodes.length === 0) {
      return res.status(400).json({ error: "No backup codes available for this account" });
    }

    // Check each hashed backup code
    let matchedIndex = -1;
    for (let i = 0; i < user.mfaBackupCodes.length; i++) {
      const isMatch = await bcrypt.compare(backupCode, user.mfaBackupCodes[i]);
      if (isMatch) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      return res.status(400).json({ error: "Invalid email or backup code" });
    }

    // Remove the used backup code
    const updatedCodes = [...user.mfaBackupCodes];
    updatedCodes.splice(matchedIndex, 1);

    // Disable MFA on Cognito using admin API (no access token needed)
    try {
      const disableMfaCommand = new AdminSetUserMFAPreferenceCommand({
        UserPoolId: config.cognito.userPoolId,
        Username: user.email,
        SoftwareTokenMfaSettings: {
          Enabled: false,
          PreferredMfa: false,
        },
      });

      await cognitoClient.send(disableMfaCommand);
    } catch (cognitoError: any) {
      logger.error("Failed to disable MFA in Cognito during recovery", {
        userId: user.id,
        error: cognitoError.message,
      });
      return res.status(500).json({ error: "Failed to disable MFA. Please contact support." });
    }

    // Update user: clear backup codes array with used code removed
    await userRepo.update({ id: user.id }, { mfaBackupCodes: updatedCodes });

    logger.info("MFA recovered via backup code", {
      userId: user.id,
      remainingCodes: updatedCodes.length,
    });

    res.json({
      success: true,
      message: "MFA has been disabled. You can now log in with your email and password. You may re-enable MFA from your profile settings.",
      remainingBackupCodes: updatedCodes.length,
    });
  } catch (error) {
    logger.error("Error during MFA recovery", { error });
    res.status(500).json({ error: "MFA recovery failed" });
  }
});

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

// =============================================================================
// Password Reset (Cognito Forgot Password flow)
// =============================================================================

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per 15 min per IP
  message: { error: "Too many password reset attempts. Please try again later." },
  ...createStore("rl:pwreset:"),
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset verification code via Cognito
 * Always returns 200 to prevent email enumeration
 */
router.post(
  "/forgot-password",
  passwordResetLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
    }

    const { email } = req.body;

    try {
      const command = new ForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email,
      });
      await cognitoClient.send(command);
    } catch (error: any) {
      // Don't leak whether email exists — always return success
      logger.info("Forgot password request", { email, error: error.name });
    }

    // Always return 200 to prevent email enumeration
    res.json({
      message: "If an account exists with that email, a verification code has been sent.",
    });
  },
);

/**
 * POST /api/auth/reset-password
 * Reset password using Cognito verification code
 */
router.post(
  "/reset-password",
  passwordResetLimiter,
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("code").isString().notEmpty().isLength({ min: 1, max: 10 }).withMessage("Verification code is required"),
    body("newPassword")
      .isString()
      .isLength({ min: 8, max: 128 })
      .withMessage("Password must be between 8 and 128 characters"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: "Validation failed",
        details: errors.array(),
      });
    }

    const { email, code, newPassword } = req.body;

    try {
      const command = new ConfirmForgotPasswordCommand({
        ClientId: config.cognito.clientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      });
      await cognitoClient.send(command);

      logger.info("Password reset successful", { email });
      res.json({ message: "Password has been reset successfully." });
    } catch (error: any) {
      logger.warn("Password reset failed", { email, error: error.name });

      if (error.name === "CodeMismatchException") {
        return res.status(400).json({ error: "Invalid or expired verification code." });
      }
      if (error.name === "ExpiredCodeException") {
        return res.status(400).json({
          error: "Verification code has expired. Please request a new one.",
        });
      }
      if (error.name === "InvalidPasswordException") {
        return res.status(400).json({
          error: "Password does not meet requirements. Must be at least 8 characters.",
        });
      }
      if (error.name === "LimitExceededException") {
        return res.status(429).json({ error: "Too many attempts. Please try again later." });
      }

      res.status(400).json({ error: "Unable to reset password. Please try again." });
    }
  },
);

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
      const { isPlatformAdmin: checkPlatformAdmin } = await import("../middleware/platform-auth.js");
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

/**
 * POST /api/auth/logout
 * Logout endpoint (client-side token invalidation)
 * Note: Actual token invalidation happens client-side with Cognito
 */
router.post("/logout", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Logout successful. Please clear tokens client-side.",
  });
});

/**
 * GET /api/auth/sso-config
 * Get SSO configuration for the frontend
 * Returns available identity providers and OAuth URLs
 */
router.get("/sso-config", async (_req: Request, res: Response) => {
  try {
    // Get list of identity providers from Cognito
    const command = new ListIdentityProvidersCommand({
      UserPoolId: config.cognito.userPoolId,
      MaxResults: 10,
    });

    const response = await cognitoClient.send(command);
    const providers = response.Providers || [];

    // Build list of enabled providers
    const enabledProviders: { name: string; displayName: string }[] = [];

    for (const provider of providers) {
      if (provider.ProviderName === "Google") {
        enabledProviders.push({ name: "Google", displayName: "Google" });
      } else if (provider.ProviderName === "Microsoft") {
        enabledProviders.push({ name: "Microsoft", displayName: "Microsoft" });
      } else if (provider.ProviderName === "Facebook") {
        enabledProviders.push({ name: "Facebook", displayName: "Facebook" });
      } else if (provider.ProviderName === "SignInWithApple") {
        enabledProviders.push({ name: "SignInWithApple", displayName: "Apple" });
      }
    }

    // Also add Microsoft if direct OAuth is configured (independent of Cognito)
    // This supports the work account SSO flow at /api/auth/microsoft/authorize
    const hasMicrosoftDirect = process.env.MICROSOFT_CLIENT_ID && !enabledProviders.some(p => p.name === "Microsoft");
    if (hasMicrosoftDirect) {
      enabledProviders.push({ name: "Microsoft", displayName: "Microsoft" });
    }

    // Also add GitHub if direct OAuth is configured
    const hasGitHubDirect = process.env.GITHUB_CLIENT_ID && !enabledProviders.some(p => p.name === "GitHub");
    if (hasGitHubDirect) {
      enabledProviders.push({ name: "GitHub", displayName: "GitHub" });
    }

    // Build Cognito hosted UI base URL
    // Custom domains (auth.workermill.com) contain dots, prefix domains don't
    const cognitoDomain = config.cognito.domain;
    const region = config.cognito.region;
    const isCustomDomain = cognitoDomain.includes(".");
    const hostedUiBaseUrl = isCustomDomain
      ? `https://${cognitoDomain}`
      : `https://${cognitoDomain}.auth.${region}.amazoncognito.com`;

    res.json({
      enabled: enabledProviders.length > 0,
      providers: enabledProviders,
      clientId: config.cognito.clientId,
      hostedUiBaseUrl,
      // Frontend uses this to build the OAuth authorize URL
      // e.g., {hostedUiBaseUrl}/oauth2/authorize?identity_provider=Google&...
    });
  } catch (error) {
    logger.error("Error fetching SSO config", { error });
    res.status(500).json({ error: "Failed to get SSO configuration" });
  }
});

/**
 * POST /api/auth/sso-callback
 * Exchange OAuth authorization code for tokens
 * Called by frontend after user returns from SSO provider
 */
router.post(
  "/sso-callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
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

      const { code, redirectUri } = req.body;

      // Exchange authorization code for tokens via Cognito token endpoint
      // Custom domains (auth.workermill.com) contain dots, prefix domains don't
      const cognitoDomain = config.cognito.domain;
      const region = config.cognito.region;
      const isCustomDomain = cognitoDomain.includes(".");
      const tokenUrl = isCustomDomain
        ? `https://${cognitoDomain}/oauth2/token`
        : `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;

      const tokenResponse = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.cognito.clientId,
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      const { access_token, refresh_token, id_token, expires_in } = tokenResponse.data;

      // Auto-provision user if not exists
      if (id_token) {
        try {
          const idPayload = decodeJwtPayload(id_token);
          const cognitoId = idPayload.sub;
          const userEmail = idPayload.email;

          const userRepo = AppDataSource.getRepository(User);

          let user = await userRepo.findOne({ where: { cognitoId } });

          if (!user) {
            // Check if user exists by email (could have been invited)
            user = await userRepo.findOne({ where: { email: userEmail.toLowerCase() } });

            if (user) {
              // Link existing user to Cognito
              user.cognitoId = cognitoId;
              user.status = "active";
              if (user.tosVersion !== TOS_VERSION) {
                user.tosAcceptedAt = new Date();
                user.tosVersion = TOS_VERSION;
              }
              await userRepo.save(user);
              logger.info("Linked SSO user to existing account", { email: userEmail, cognitoId });
            } else {
              // Check for pending invite before auto-provisioning
              const inviteRepo = AppDataSource.getRepository(OrgInvite);
              const pendingInvite = await inviteRepo.findOne({
                where: { email: userEmail.toLowerCase(), accepted: false },
              });
              const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

              // Create new user without org - they'll complete setup via invite or onboarding
              logger.info("Auto-provisioning new SSO user (pending setup)", {
                email: userEmail,
                cognitoId,
                hasValidInvite,
                inviteOrgId: hasValidInvite ? pendingInvite.orgId : null,
              });

              user = userRepo.create({
                cognitoId,
                email: userEmail.toLowerCase(), // Normalize email
                fullName: idPayload.name || userEmail.split("@")[0],
                role: hasValidInvite ? "member" : "admin",
                status: "active",
                orgId: null, // No org yet - requires invite acceptance or onboarding
                tosAcceptedAt: new Date(),
                tosVersion: TOS_VERSION,
              });
              await userRepo.save(user);

              logger.info("SSO user provisioned (pending org setup)", { userId: user.id, hasValidInvite });

              // Return invite token so frontend can redirect to invite acceptance
              if (hasValidInvite) {
                return res.json({
                  tokens: {
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    idToken: id_token,
                    expiresIn: expires_in,
                  },
                  pendingInvite: true,
                  inviteToken: pendingInvite.token,
                });
              }
            }
          }
        } catch (provisionError) {
          logger.error("Failed to auto-provision SSO user", { error: provisionError });
          // Continue anyway - SSO succeeded, provisioning is best-effort
        }
      }

      res.json({
        tokens: {
          accessToken: access_token,
          refreshToken: refresh_token,
          idToken: id_token,
          expiresIn: expires_in,
        },
      });
    } catch (error: any) {
      logger.error("SSO callback error", {
        error: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 400) {
        return res.status(400).json({
          error: "Invalid authorization code or it has expired",
        });
      }

      res.status(500).json({ error: "SSO authentication failed" });
    }
  }
);

// =============================================================================
// Microsoft Work Account SSO (Direct OAuth, not via Cognito)
// Supports any Azure AD tenant for B2B scenarios with auto-org creation/joining
// =============================================================================

// OAuth PKCE state stored in Redis with 10-minute TTL.
// Falls back to in-memory Map for local dev without Redis.
const microsoftOAuthStatesFallback = new Map<
  string,
  { codeVerifier: string; expiresAt: number; inviteToken?: string }
>();

async function setMicrosoftOAuthState(
  state: string,
  data: { codeVerifier: string; expiresAt: number; inviteToken?: string },
): Promise<void> {
  const stored = await redis.set(`oauth:microsoft:${state}`, JSON.stringify(data), 600);
  if (!stored) microsoftOAuthStatesFallback.set(state, data);
}

async function getMicrosoftOAuthState(
  state: string,
): Promise<{ codeVerifier: string; expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:microsoft:${state}`);
  if (raw) {
    await redis.del(`oauth:microsoft:${state}`);
    return JSON.parse(raw);
  }
  const fallback = microsoftOAuthStatesFallback.get(state);
  if (fallback) microsoftOAuthStatesFallback.delete(state);
  return fallback;
}

/**
 * GET /api/auth/microsoft/config
 * Returns Microsoft OAuth configuration for frontend
 */
router.get("/microsoft/config", (_req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;

  if (!clientId) {
    return res.status(503).json({
      error: "Microsoft SSO not configured",
      enabled: false,
    });
  }

  res.json({
    enabled: true,
    clientId,
    // Use "organizations" endpoint for work accounts only (any Azure AD tenant)
    authorizeUrl: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
    scopes: "openid profile email",
  });
});

/**
 * GET /api/auth/microsoft/authorize
 * Generates Microsoft OAuth URL with state parameter
 * Returns the URL for frontend to redirect to
 */
router.get("/microsoft/authorize", async (req: Request, res: Response) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const inviteToken = req.query.inviteToken as string | undefined;

  if (!clientId) {
    return res.status(503).json({ error: "Microsoft SSO not configured" });
  }

  // Generate state and PKCE code verifier
  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(32).toString("base64url");

  // Store state with 10-minute expiration
  await setMicrosoftOAuthState(state, {
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
    inviteToken,
  });

  // Build redirect URI - use the requesting origin if available
  const origin = req.headers.origin || config.apiBaseUrl.replace("/api", "");
  const redirectUri = `${origin}/auth/microsoft/callback`;

  // Build authorize URL
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email User.Read",
    state,
    response_mode: "query",
    // PKCE with S256: code_challenge = BASE64URL(SHA256(code_verifier))
    code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    code_challenge_method: "S256",
  });

  const authorizeUrl = `https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?${params.toString()}`;

  res.json({
    authorizeUrl,
    state,
    redirectUri,
  });
});

/**
 * POST /api/auth/microsoft/callback
 * Handles Microsoft OAuth callback - exchanges code for tokens
 * Creates/joins organization based on Azure tenant ID
 */
router.post(
  "/microsoft/callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
    body("state").isString().notEmpty().withMessage("State parameter is required"),
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

      const { code, redirectUri, state } = req.body;

      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: "Microsoft SSO not configured" });
      }

      // Verify state (required for CSRF protection)
      const stateData = await getMicrosoftOAuthState(state);
      if (!stateData) {
        return res.status(400).json({ error: "Invalid or expired state parameter" });
      }
      if (stateData.expiresAt < Date.now()) {
        return res.status(400).json({ error: "State parameter expired" });
      }
      const { codeVerifier, inviteToken } = stateData;

      // Exchange code for tokens with Microsoft
      const tokenParams: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      };

      const tokenResponse = await axios.post(
        "https://login.microsoftonline.com/organizations/oauth2/v2.0/token",
        new URLSearchParams(tokenParams),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const { id_token, access_token } = tokenResponse.data;

      if (!id_token) {
        return res.status(400).json({ error: "No ID token received from Microsoft" });
      }

      // Decode and validate ID token
      const idPayload = decodeJwtPayload(id_token);

      // Validate issuer - accept any Microsoft tenant
      const issuer = idPayload.iss;
      if (!issuer || !issuer.match(/^https:\/\/login\.microsoftonline\.com\/[a-f0-9-]+\/v2\.0$/)) {
        logger.error("Invalid Microsoft token issuer", { issuer });
        return res.status(400).json({ error: "Invalid token issuer" });
      }

      // Extract tenant ID and user info
      const tenantId = idPayload.tid;
      const email = idPayload.email || idPayload.preferred_username;
      const name = idPayload.name || email?.split("@")[0];

      if (!tenantId || !email) {
        logger.error("Missing required claims from Microsoft token", { tenantId, email });
        return res.status(400).json({ error: "Missing required claims from token" });
      }

      logger.info("Microsoft SSO: Processing user", { email, tenantId: tenantId.slice(0, 8) + "...", hasInviteToken: !!inviteToken });

      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);

      // Check if there's a pending valid invite for this email
      // If so, don't create/assign to Azure tenant org - user will join invited org via invite acceptance
      const pendingInvite = await inviteRepo.findOne({
        where: { email: email.toLowerCase(), accepted: false },
      });
      const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

      if (hasValidInvite) {
        logger.info("Microsoft SSO: User has pending invite, skipping Azure tenant org assignment", {
          email,
          inviteOrgId: pendingInvite.orgId,
          inviteToken: inviteToken ? "provided" : "not provided",
        });
      }

      // Find or create organization by Azure tenant ID (only if no valid invite)
      let org: Organization | null = hasValidInvite ? null : await orgRepo.findOne({ where: { azureTenantId: tenantId } });
      let isNewOrg = false;

      if (!hasValidInvite && !org) {
        // Try to get organization name from Microsoft Graph API
        let orgName = `Organization ${tenantId.slice(0, 8)}`;
        if (access_token) {
          try {
            const graphResponse = await axios.get("https://graph.microsoft.com/v1.0/organization", {
              headers: { Authorization: `Bearer ${access_token}` },
            });
            orgName = graphResponse.data.value?.[0]?.displayName || orgName;
          } catch (graphError) {
            logger.debug("Could not fetch org name from Microsoft Graph", { error: graphError });
          }
        }

        // Generate slug from organization name
        const baseSlug = orgName
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

        // Create new organization linked to Azure tenant
        const msRawKey = `org_${randomUUID().replace(/-/g, "")}`;
        org = orgRepo.create({
          name: orgName,
          slug,
          azureTenantId: tenantId,
          plan: "pro",
          taskQuota: 0, // Unlimited tasks (feature-gated, not quota-based)
          trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),

          apiKeyHash: await bcrypt.hash(msRawKey, 10),
          apiKeyPrefix: msRawKey.substring(0, 12),
        });
        await orgRepo.save(org);
        isNewOrg = true;

        logger.info("Microsoft SSO: Created new organization", { orgId: org.id, orgName, slug, tenantId: tenantId.slice(0, 8) + "..." });
      }

      // Find or create user
      let user = await userRepo.findOne({ where: { email } });
      let isNewUser = false;

      if (!user) {
        // Create Cognito user for this Microsoft-authenticated user
        const tempPassword = randomBytes(16).toString("base64") + "!A1";
        const cognitoId = await createCognitoUserForMicrosoft(email, name, tempPassword);

        if (hasValidInvite) {
          // User has a pending invite - create user WITHOUT an org
          // They will join the invited org via /api/invites/:token/accept
          user = userRepo.create({
            cognitoId,
            email,
            fullName: name,
            role: "member", // Will be set by invite acceptance
            status: "active",
            orgId: null, // No org yet - will be assigned on invite acceptance
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);
          isNewUser = true;

          logger.info("Microsoft SSO: Created new user (pending invite acceptance)", {
            userId: user.id,
            email,
            inviteOrgId: pendingInvite.orgId,
          });
        } else {
          // No invite - assign to Azure tenant org
          // Determine role - first user in org is admin
          const existingUsers = await userRepo.count({ where: { orgId: org!.id } });
          const role = existingUsers === 0 || isNewOrg ? "admin" : "member";

          user = userRepo.create({
            cognitoId,
            email,
            fullName: name,
            role,
            status: "active",
            orgId: null, // UserOrganization is source of truth
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);
          isNewUser = true;

          // Create UserOrganization record for multi-org support
          const userOrgRepo = AppDataSource.getRepository(UserOrganization);
          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org!.id,
            role: role as "admin" | "member" | "viewer",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          logger.info("Microsoft SSO: Created new user", { userId: user.id, email, role, orgId: org!.id });
        }
      } else {
        // Existing user — auto-accept TOS on SSO login
        if (user.tosVersion !== TOS_VERSION) {
          await userRepo.update(
            { id: user.id },
            { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
          );
          user.tosVersion = TOS_VERSION;
        }

        // Existing user - check their org memberships
        const userOrgRepo = AppDataSource.getRepository(UserOrganization);
        const userMemberships = await userOrgRepo.find({ where: { userId: user.id } });

        if (userMemberships.length === 0 && !hasValidInvite && org) {
          // User has no org memberships - link to Azure tenant org
          const existingMembers = await userOrgRepo.count({ where: { orgId: org.id } });
          const assignedRole = existingMembers === 0 || isNewOrg ? "admin" : "member";

          user.status = "active";
          await userRepo.save(user);

          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org.id,
            role: assignedRole as "admin" | "member" | "viewer",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          logger.info("Microsoft SSO: Linked existing user to org", { userId: user.id, orgId: org.id });
        } else if (org) {
          // User has existing memberships - check if they're in the Azure tenant org
          const azureOrgMembership = userMemberships.find(m => m.orgId === org.id);
          if (!azureOrgMembership) {
            // User belongs to different org(s) - log but allow login
            logger.warn("Microsoft SSO: User already belongs to different org(s)", {
              userId: user.id,
              existingOrgIds: userMemberships.map(m => m.orgId),
              azureOrgId: org.id,
            });
          }
        }
      }

      // Get user's role from UserOrganization for response
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const defaultMembership = await userOrgRepo.findOne({
        where: { userId: user.id, isDefault: true },
      }) || await userOrgRepo.findOne({
        where: { userId: user.id },
        order: { joinedAt: "ASC" },
      });
      const userRole = defaultMembership?.role || "member";

      // Generate Cognito tokens for the user
      const tokens = await getCognitoTokensForUser(user.cognitoId, user.email);

      res.json({
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          expiresIn: tokens.expiresIn,
        },
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: userRole,
          status: user.status,
        },
        organization: org ? {
          id: org.id,
          name: org.name,
          plan: org.plan,
          trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null,
          stripeSubscriptionStatus: org.stripeSubscriptionStatus,
        } : null,
        isNewUser,
        isNewOrg,
        // Let frontend know user needs to accept an invite
        pendingInvite: hasValidInvite,
        // Pass invite token if frontend needs to redirect to accept
        inviteToken: hasValidInvite ? inviteToken : undefined,
      });
    } catch (error: any) {
      logger.error("Microsoft SSO callback error", {
        error: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 400) {
        return res.status(400).json({
          error: "Invalid authorization code or it has expired",
        });
      }

      res.status(500).json({ error: "Microsoft SSO authentication failed" });
    }
  }
);

/**
 * Create a Cognito user for Microsoft-authenticated user
 * This creates a user that can be managed in Cognito without requiring password login
 */
async function createCognitoUserForMicrosoft(email: string, name: string, tempPassword: string): Promise<string> {
  try {
    // Create user in Cognito
    const createCommand = new AdminCreateUserCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: name },
      ],
      TemporaryPassword: tempPassword,
      MessageAction: "SUPPRESS", // Don't send welcome email
    });

    const createResponse = await cognitoClient.send(createCommand);
    const cognitoId = createResponse.User?.Username;

    if (!cognitoId) {
      throw new Error("Failed to create Cognito user - no username returned");
    }

    // Set a permanent password immediately
    const permanentPassword = randomBytes(32).toString("base64") + "!A1";
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      Password: permanentPassword,
      Permanent: true,
    });
    await cognitoClient.send(setPasswordCommand);

    // Get the actual Cognito sub (user ID) from the attributes
    const subAttr = createResponse.User?.Attributes?.find(a => a.Name === "sub");
    return subAttr?.Value || cognitoId;
  } catch (error: any) {
    // If user already exists, that's fine - return their info
    if (error.name === "UsernameExistsException") {
      logger.info("Cognito user already exists for Microsoft user", { email });
      // The user exists, so we need to look them up to get the sub
      // For now, just return the email as identifier - it will match
      return email;
    }
    throw error;
  }
}

/**
 * Get Cognito tokens for a user (for Microsoft SSO users who are in Cognito)
 * Uses admin auth flow since we don't have the user's password
 */
async function getCognitoTokensForUser(
  cognitoId: string,
  email: string
): Promise<{ accessToken: string; refreshToken: string; idToken: string; expiresIn: number }> {
  try {
    // Use admin-initiated auth with a custom auth flow
    // Since Microsoft users don't have a Cognito password, we use ADMIN_NO_SRP_AUTH
    // with a system-generated password

    // First, generate a new secure password for this auth
    const authPassword = randomBytes(32).toString("base64") + "!A1";

    // Set the password
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: config.cognito.userPoolId,
      Username: email,
      Password: authPassword,
      Permanent: true,
    });
    await cognitoClient.send(setPasswordCommand);

    // Now authenticate with that password
    const authCommand = new AdminInitiateAuthCommand({
      UserPoolId: config.cognito.userPoolId,
      ClientId: config.cognito.clientId,
      AuthFlow: AdminAuthFlowType.ADMIN_USER_PASSWORD_AUTH,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: authPassword,
      },
    });

    const authResponse = await cognitoClient.send(authCommand);

    if (!authResponse.AuthenticationResult) {
      throw new Error("Failed to get Cognito tokens");
    }

    return {
      accessToken: authResponse.AuthenticationResult.AccessToken!,
      refreshToken: authResponse.AuthenticationResult.RefreshToken!,
      idToken: authResponse.AuthenticationResult.IdToken!,
      expiresIn: authResponse.AuthenticationResult.ExpiresIn || 3600,
    };
  } catch (error) {
    logger.error("Failed to get Cognito tokens for Microsoft user", { cognitoId, error });
    throw error;
  }
}

// =============================================================================
// GitHub OAuth SSO (Web Login — Direct OAuth, not via Cognito)
// =============================================================================

// OAuth state stored in Redis with 10-minute TTL.
// Falls back to in-memory Map for local dev without Redis.
const githubOAuthStatesFallback = new Map<string, { expiresAt: number; inviteToken?: string }>();

async function setGithubOAuthState(
  state: string,
  data: { expiresAt: number; inviteToken?: string },
): Promise<void> {
  const stored = await redis.set(`oauth:github:${state}`, JSON.stringify(data), 600);
  if (!stored) githubOAuthStatesFallback.set(state, data);
}

async function getGithubOAuthState(
  state: string,
): Promise<{ expiresAt: number; inviteToken?: string } | undefined> {
  const raw = await redis.get(`oauth:github:${state}`);
  if (raw) {
    await redis.del(`oauth:github:${state}`);
    return JSON.parse(raw);
  }
  const fallback = githubOAuthStatesFallback.get(state);
  if (fallback) githubOAuthStatesFallback.delete(state);
  return fallback;
}

/**
 * GET /api/auth/github/config
 * Returns GitHub OAuth configuration for frontend
 */
router.get("/github/config", (_req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;

  if (!clientId) {
    return res.json({ enabled: false });
  }

  res.json({ enabled: true, clientId });
});

/**
 * GET /api/auth/github/authorize
 * Generates GitHub OAuth URL with state parameter
 */
router.get("/github/authorize", async (req: Request, res: Response) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const inviteToken = req.query.inviteToken as string | undefined;

  if (!clientId) {
    return res.status(503).json({ error: "GitHub SSO not configured" });
  }

  const state = randomBytes(32).toString("hex");
  await setGithubOAuthState(state, {
    expiresAt: Date.now() + 10 * 60 * 1000,
    inviteToken,
  });

  const origin = req.headers.origin || config.apiBaseUrl.replace("/api", "");
  const redirectUri = `${origin}/auth/github/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email repo",
    state,
  });

  const authorizeUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;

  res.json({ authorizeUrl, state, redirectUri });
});

/**
 * POST /api/auth/github/callback
 * Handles GitHub OAuth callback — exchanges code for tokens, creates/finds user
 */
router.post(
  "/github/callback",
  [
    body("code").isString().notEmpty().withMessage("Authorization code is required"),
    body("redirectUri").isString().notEmpty().withMessage("Redirect URI is required"),
    body("state").isString().notEmpty().withMessage("State parameter is required"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: "Validation failed", details: errors.array() });
      }

      const { code, redirectUri, state } = req.body;
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(503).json({ error: "GitHub SSO not configured" });
      }

      // Verify state (required for CSRF protection)
      const stateData = await getGithubOAuthState(state);
      if (!stateData) {
        return res.status(400).json({ error: "Invalid or expired state parameter" });
      }
      if (stateData.expiresAt < Date.now()) {
        return res.status(400).json({ error: "State parameter expired" });
      }
      const inviteToken = stateData.inviteToken;

      // Exchange code for access token
      const tokenResponse = await axios.post(
        "https://github.com/login/oauth/access_token",
        { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri },
        { headers: { Accept: "application/json" } },
      );

      const githubToken = tokenResponse.data.access_token;
      if (!githubToken) {
        return res.status(400).json({ error: "Failed to get access token from GitHub" });
      }

      // Get user info and email from GitHub
      let githubUser: { login: string; name: string | null; id: number };
      let primaryEmail: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        githubUser = userResponse.data;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      const name = githubUser.name || githubUser.login;
      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);

      // Check for pending invite
      const pendingInvite = await inviteRepo.findOne({
        where: { email: primaryEmail.toLowerCase(), accepted: false },
      });
      const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

      let user = await userRepo.findOne({ where: { email: primaryEmail } });
      let org: Organization | null = null;
      let isNewUser = false;
      let isNewOrg = false;

      if (!user) {
        // New user — create Cognito account + org
        isNewUser = true;

        const tempPassword = randomBytes(32).toString("base64") + "!A1";
        const cognitoId = await createCognitoUserForMicrosoft(primaryEmail, name, tempPassword);

        if (hasValidInvite) {
          // User has invite — create without org, they'll accept invite after
          user = userRepo.create({
            cognitoId,
            email: primaryEmail.toLowerCase(),
            fullName: name,
            role: "member",
            status: "active",
            orgId: null,
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          logger.info("GitHub SSO: Created new user (pending invite)", { userId: user.id, email: primaryEmail });
        } else {
          // No invite — create org linked to GitHub
          isNewOrg = true;
          const login = githubUser.login;
          const baseSlug = login.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          let slug = baseSlug;
          let slugSuffix = 0;
          while (await orgRepo.findOne({ where: { slug } })) {
            slugSuffix++;
            slug = `${baseSlug}-${slugSuffix}`;
          }

          const rawKey = `org_${randomUUID().replace(/-/g, "")}`;
          org = orgRepo.create({
            name: `${login}'s org`,
            slug,
            plan: "pro",
            taskQuota: 0,
            scmProvider: "github",
            trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            apiKeyHash: await bcrypt.hash(rawKey, 10),
            apiKeyPrefix: rawKey.substring(0, 12),
          });
          await orgRepo.save(org);

          user = userRepo.create({
            cognitoId,
            email: primaryEmail.toLowerCase(),
            fullName: name,
            role: "admin",
            status: "active",
            orgId: null,
            tosAcceptedAt: new Date(),
            tosVersion: TOS_VERSION,
          });
          await userRepo.save(user);

          const membership = userOrgRepo.create({
            userId: user.id,
            orgId: org.id,
            role: "admin",
            isDefault: true,
          });
          await userOrgRepo.save(membership);

          // Store GitHub token in Secrets Manager
          const secretPrefix = `workermill/${config.environment}`;
          await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via web SSO)");

          notifyNewSignup({ email: primaryEmail, fullName: name, organizationName: org.name }).catch(() => {});
          sendWelcomeEmail(user, org, false).catch(() => {});

          logger.info("GitHub SSO: Created new user + org", { userId: user.id, orgId: org.id, email: primaryEmail });
        }
      } else {
        // Existing user — find their org
        const defaultMembership = await userOrgRepo.findOne({
          where: { userId: user.id, isDefault: true },
        }) || await userOrgRepo.findOne({
          where: { userId: user.id },
          order: { joinedAt: "ASC" },
        });

        if (defaultMembership) {
          org = await orgRepo.findOne({ where: { id: defaultMembership.orgId } }) || null;

          // Update GitHub token in Secrets Manager (refresh on each login)
          if (org) {
            const secretPrefix = `workermill/${config.environment}`;
            await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via web SSO signin)");
          }
        }

        // Auto-accept TOS on SSO login (user already accepted via GitHub OAuth consent)
        if (user.tosVersion !== TOS_VERSION) {
          await userRepo.update(
            { id: user.id },
            { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
          );
          user.tosVersion = TOS_VERSION;
        }

        logger.info("GitHub SSO: Existing user login", { userId: user.id, email: primaryEmail });
      }

      // Get Cognito tokens for web auth
      const tokens = await getCognitoTokensForUser(user.cognitoId, user.email);

      // Get user role
      const membership = await userOrgRepo.findOne({
        where: { userId: user.id, isDefault: true },
      }) || await userOrgRepo.findOne({
        where: { userId: user.id },
        order: { joinedAt: "ASC" },
      });
      const userRole = membership?.role || "member";

      res.json({
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
          expiresIn: tokens.expiresIn,
        },
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: userRole,
          status: user.status,
        },
        organization: org ? { id: org.id, name: org.name, plan: org.plan, trialExpiresAt: org.trialExpiresAt ? org.trialExpiresAt.toISOString() : null, stripeSubscriptionStatus: org.stripeSubscriptionStatus } : null,
        isNewUser,
        isNewOrg,
        pendingInvite: hasValidInvite,
        inviteToken: hasValidInvite ? inviteToken : undefined,
      });
    } catch (error: any) {
      logger.error("GitHub SSO callback error", { error: error.message, response: error.response?.data });

      if (error.response?.status === 400) {
        return res.status(400).json({ error: "Invalid authorization code or it has expired" });
      }

      res.status(500).json({ error: "GitHub SSO authentication failed" });
    }
  },
);

// =============================================================================
// GitHub Onboarding (VS Code Extension)
// =============================================================================

const githubOnboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many signup attempts" },
  ...createStore("rl:ghonboard:"),
});

/**
 * POST /api/auth/github-onboard
 * Zero-friction signup via GitHub token (VS Code extension onboarding)
 */
router.post(
  "/github-onboard",
  githubOnboardLimiter,
  [
    body("githubToken").isString().notEmpty().withMessage("githubToken is required"),
    body("githubUsername").isString().notEmpty().withMessage("githubUsername is required"),
    body("tosAccepted").isBoolean().equals("true").withMessage("Terms of Service must be accepted"),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { githubToken, githubUsername, tosAccepted } = req.body;

      // Validate GitHub token and get user info
      let githubUser: { login: string; name: string | null; id: number };
      let primaryEmail: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        githubUser = userResponse.data;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      // Check for duplicate email
      const userRepo = AppDataSource.getRepository(User);
      const existingUser = await userRepo.findOne({ where: { email: primaryEmail } });
      if (existingUser) {
        return res.status(409).json({ error: "An account with this email already exists. Use /github-signin instead." });
      }

      // Create Cognito user
      const tempPassword = randomBytes(32).toString("base64") + "!A1";
      const name = githubUser.name || githubUsername;
      const cognitoId = await createCognitoUserForMicrosoft(primaryEmail, name, tempPassword);

      // Create Organization
      const orgRepo = AppDataSource.getRepository(Organization);
      // Use validated GitHub login for slug (not client-provided username)
      const login = githubUser.login;
      const baseSlug = login
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      let slug = baseSlug;
      let slugSuffix = 0;
      while (await orgRepo.findOne({ where: { slug } })) {
        slugSuffix++;
        slug = `${baseSlug}-${slugSuffix}`;
      }

      const rawKey = `org_${randomUUID().replace(/-/g, "")}`;
      const org = orgRepo.create({
        name: `${login}'s org`,
        slug,
        plan: "pro",
        taskQuota: 0,
        scmProvider: "github",
        trialExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        apiKeyHash: await bcrypt.hash(rawKey, 10),
        apiKeyPrefix: rawKey.substring(0, 12),
      });
      await orgRepo.save(org);

      // Create User
      const user = userRepo.create({
        cognitoId,
        email: primaryEmail,
        fullName: name,
        role: "admin",
        status: "active",
        orgId: null,
        tosAcceptedAt: tosAccepted ? new Date() : null,
        tosVersion: tosAccepted ? TOS_VERSION : null,
      });
      await userRepo.save(user);

      // Create UserOrganization
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);
      const membership = userOrgRepo.create({
        userId: user.id,
        orgId: org.id,
        role: "admin",
        isDefault: true,
      });
      await userOrgRepo.save(membership);

      // Store GitHub token in Secrets Manager
      const secretPrefix = `workermill/${config.environment}`;
      await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via extension onboarding)");

      // Create a user API key (per-user, auditable) instead of exposing the org key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      // Fire notifications (non-blocking)
      notifyNewSignup({ email: primaryEmail, fullName: name, organizationName: org.name }).catch(() => {});
      sendWelcomeEmail(user, org, false).catch(() => {});

      if (tosAccepted) {
        logTosAccepted(
          { organizationId: org.id, userId: user.id, ipAddress: req.ip || null },
          TOS_VERSION,
          "github-onboard",
        ).catch(() => {});
      }

      logger.info("GitHub onboard completed", { userId: user.id, orgId: org.id, email: primaryEmail });

      res.status(201).json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: primaryEmail,
        name,
        organizations: [{ id: org.id, name: org.name, slug, role: "admin" }],
      });
    } catch (error) {
      logger.error("GitHub onboard failed", { error });
      res.status(500).json({ error: "GitHub onboarding failed" });
    }
  },
);

/**
 * POST /api/auth/github-signin
 * Existing account setup via GitHub token (VS Code extension)
 */
router.post(
  "/github-signin",
  githubOnboardLimiter,
  [body("githubToken").isString().notEmpty().withMessage("githubToken is required")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { githubToken, orgId: requestedOrgId } = req.body;

      // Validate GitHub token and get user info
      let primaryEmail: string;
      let name: string;
      try {
        const [userResponse, emailsResponse] = await Promise.all([
          axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
          axios.get("https://api.github.com/user/emails", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github+json" },
          }),
        ]);

        name = userResponse.data.name || userResponse.data.login;
        const emails = emailsResponse.data as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) {
          return res.status(400).json({ error: "No verified primary email found on GitHub account" });
        }
        primaryEmail = primary.email;
      } catch (err: any) {
        logger.warn("GitHub token validation failed", { error: err.message });
        return res.status(401).json({ error: "Invalid GitHub token" });
      }

      // Find existing user
      const userRepo = AppDataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { email: primaryEmail } });
      if (!user) {
        return res.status(404).json({ error: "No account found with this email. Use /github-onboard to create one." });
      }

      // Get all user organizations
      const userOrgs = await getUserOrganizations(user.id);

      // Determine target org: use requested orgId if provided and user is a member, else default
      let org: Organization | null;
      if (requestedOrgId) {
        const isMember = await hasOrgAccess(user.id, requestedOrgId);
        if (!isMember) {
          return res.status(403).json({ error: "You are not a member of the requested organization" });
        }
        const orgRepo = AppDataSource.getRepository(Organization);
        org = await orgRepo.findOneBy({ id: requestedOrgId });
      } else {
        org = await getDefaultOrganization(user.id);
      }
      if (!org) {
        return res.status(404).json({ error: "No organization found for this account" });
      }

      // Create a user API key (per-user, auditable) instead of rotating the shared org key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      // Update GitHub tokens in Secrets Manager
      const secretPrefix = `workermill/${config.environment}`;
      await saveOrgSecret(org.id, "github-token", githubToken, secretPrefix, "GitHub token (via extension signin)");

      // Auto-accept TOS on SSO login
      if (user.tosVersion !== TOS_VERSION) {
        await userRepo.update(
          { id: user.id },
          { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
        );
      }

      logger.info("GitHub signin completed", { userId: user.id, orgId: org.id, email: primaryEmail });

      res.json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: org.slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: primaryEmail,
        name,
        organizations: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      });
    } catch (error) {
      logger.error("GitHub signin failed", { error });
      res.status(500).json({ error: "GitHub signin failed" });
    }
  },
);

/**
 * POST /api/auth/switch-org-key
 * Generate a new API key for a different organization (VS Code org switching)
 */
router.post(
  "/switch-org-key",
  githubOnboardLimiter,
  authenticateApiKey,
  [body("orgId").isUUID().withMessage("orgId must be a valid UUID")],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User API key required (not org key)" });
      }

      const { orgId } = req.body;

      // Verify user is a member of the target org
      const isMember = await hasOrgAccess(user.id, orgId);
      if (!isMember) {
        return res.status(403).json({ error: "You are not a member of the requested organization" });
      }

      // Load the target org
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOneBy({ id: orgId });
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }

      // Create a new user API key for the target org
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      logger.info("Org switch key created", { userId: user.id, orgId: org.id });

      res.json({
        apiKey: userToken,
        orgId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
      });
    } catch (error) {
      logger.error("Switch org key failed", { error });
      res.status(500).json({ error: "Failed to switch organization" });
    }
  },
);

/**
 * POST /api/auth/vscode-exchange
 * Exchange a Cognito JWT for a VS Code API key.
 * Bridges JWT-based auth flows (email/password, Google SSO) to the usr_ API key the agent needs.
 */
router.post(
  "/vscode-exchange",
  githubOnboardLimiter,
  authenticateUserAllowNoOrg,
  async (req: Request, res: Response) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      // Get all user organizations
      const userOrgs = await getUserOrganizations(user.id);

      // Get default org
      const org = await getDefaultOrganization(user.id);
      if (!org) {
        return res
          .status(404)
          .json({ error: "No organization found. Complete onboarding at workermill.com first." });
      }

      // Create a user API key
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
      const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
      const userKeyPrefix = userToken.substring(0, 12);
      const userKeyHash = await bcrypt.hash(userToken, 10);
      const userApiKey = userApiKeyRepo.create({
        userId: user.id,
        orgId: org.id,
        name: "VS Code Extension",
        keyHash: userKeyHash,
        keyPrefix: userKeyPrefix,
        scopes: ["*"],
      });
      await userApiKeyRepo.save(userApiKey);

      logger.info("VS Code exchange completed", { userId: user.id, orgId: org.id, email: user.email });

      res.json({
        apiKey: userToken,
        apiUrl: config.apiBaseUrl,
        orgSlug: org.slug,
        orgId: org.id,
        orgName: org.name,
        userId: user.id,
        email: user.email,
        name: user.fullName,
        organizations: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      });
    } catch (error) {
      logger.error("VS Code exchange failed", { error });
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

/**
 * GET /api/auth/vscode-sso-callback
 * Server-side callback for VS Code Google SSO flow.
 * After Cognito redirects here with an auth code:
 * 1. Exchange code for Cognito tokens
 * 2. Auto-provision user if needed
 * 3. Generate usr_ API key
 * 4. Redirect to vscode://workermill.workermill/auth-callback?apiKey=...
 */
router.get("/vscode-sso-callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== "string") {
      return res.status(400).send("Missing authorization code");
    }

    // Exchange authorization code for tokens via Cognito token endpoint
    const cognitoDomain = config.cognito.domain;
    const region = config.cognito.region;
    const isCustomDomain = cognitoDomain.includes(".");
    const tokenUrl = isCustomDomain
      ? `https://${cognitoDomain}/oauth2/token`
      : `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/token`;

    const redirectUri = `${config.apiBaseUrl}/api/auth/vscode-sso-callback`;

    const tokenResponse = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.cognito.clientId,
        code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const { id_token } = tokenResponse.data;

    if (!id_token) {
      return res.status(400).send("No ID token received from SSO provider");
    }

    // Decode ID token to get user info
    const idPayload = decodeJwtPayload(id_token);
    const cognitoId = idPayload.sub;
    const userEmail = idPayload.email;
    const userName = idPayload.name || userEmail.split("@")[0];

    // Find or auto-provision user
    const userRepo = AppDataSource.getRepository(User);
    let user = await userRepo.findOne({ where: { cognitoId } });

    if (!user) {
      user = await userRepo.findOne({ where: { email: userEmail.toLowerCase() } });

      if (user) {
        // Link existing user to Cognito
        user.cognitoId = cognitoId;
        user.status = "active";
        if (user.tosVersion !== TOS_VERSION) {
          user.tosAcceptedAt = new Date();
          user.tosVersion = TOS_VERSION;
        }
        await userRepo.save(user);
        logger.info("Linked SSO user to existing account (VS Code)", { email: userEmail, cognitoId });
      } else {
        // Auto-provision new user
        const inviteRepo = AppDataSource.getRepository(OrgInvite);
        const pendingInvite = await inviteRepo.findOne({
          where: { email: userEmail.toLowerCase(), accepted: false },
        });
        const hasValidInvite = pendingInvite && !pendingInvite.isExpired();

        user = userRepo.create({
          cognitoId,
          email: userEmail.toLowerCase(),
          fullName: userName,
          role: hasValidInvite ? "member" : "admin",
          status: "active",
          orgId: null,
          tosAcceptedAt: new Date(),
          tosVersion: TOS_VERSION,
        });
        await userRepo.save(user);
        logger.info("SSO user provisioned via VS Code", { userId: user.id, hasValidInvite });
      }
    }

    // Auto-accept TOS on SSO login
    if (user.tosVersion !== TOS_VERSION) {
      await userRepo.update(
        { id: user.id },
        { tosAcceptedAt: new Date(), tosVersion: TOS_VERSION },
      );
    }

    // Get default org
    const org = await getDefaultOrganization(user.id);
    if (!org) {
      const errorUrl = `vscode://workermill.workermill/auth-callback?error=${encodeURIComponent("No organization found. Complete onboarding at workermill.com first.")}`;
      return res.redirect(errorUrl);
    }

    // Create user API key
    const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);
    const userToken = `usr_${randomUUID().replace(/-/g, "")}`;
    const userKeyPrefix = userToken.substring(0, 12);
    const userKeyHash = await bcrypt.hash(userToken, 10);
    const userApiKey = userApiKeyRepo.create({
      userId: user.id,
      orgId: org.id,
      name: "VS Code Extension",
      keyHash: userKeyHash,
      keyPrefix: userKeyPrefix,
      scopes: ["*"],
    });
    await userApiKeyRepo.save(userApiKey);

    logger.info("VS Code SSO callback completed", { userId: user.id, orgId: org.id });

    // Redirect to VS Code with credentials
    const params = new URLSearchParams({
      apiKey: userToken,
      orgId: org.id,
      orgName: org.name,
      orgSlug: org.slug || "",
      email: user.email,
      name: user.fullName || userName,
      ...(typeof state === "string" ? { state } : {}),
    });
    res.redirect(`vscode://workermill.workermill/auth-callback?${params.toString()}`);
  } catch (error: any) {
    logger.error("VS Code SSO callback error", {
      error: error.message,
      response: error.response?.data,
    });

    if (error.response?.status === 400) {
      return res.status(400).send("Invalid or expired authorization code. Please try signing in again.");
    }

    res.status(500).send("SSO authentication failed. Please try again.");
  }
});

export default router;
