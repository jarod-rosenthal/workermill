import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  AuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { body, validationResult } from "express-validator";
import { authenticateUser } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { User, Organization, OrgInvite, PLAN_QUOTAS } from "../models/index.js";
import { randomBytes } from "crypto";
import { authenticateUserAllowNoOrg } from "../middleware/auth.js";

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
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const command = new InitiateAuthCommand({
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: config.cognito.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

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
          logger.info("Auto-provisioning new user (pending setup)", { email: userEmail, cognitoId });

          // Create user WITHOUT org - they'll complete setup on first dashboard visit
          user = userRepo.create({
            cognitoId,
            email: userEmail,
            fullName: userEmail.split("@")[0],
            role: "admin", // Will be admin of their org once they create/join one
            status: "active",
            orgId: null, // No org yet - requires onboarding
          });
          await userRepo.save(user);

          logger.info("User provisioned (pending org setup)", { userId: user.id });
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
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage("Organization name is required (max 255 characters)"),
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

      const { email, password, name, organizationName } = req.body;

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

        throw cognitoError;
      }

      const cognitoUserId = cognitoResponse.UserSub;

      if (!cognitoUserId) {
        logger.error("Cognito signup did not return UserSub", { email });
        return res.status(500).json({ error: "Registration failed - no user ID returned" });
      }

      // Create Organization
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = orgRepo.create({
        name: organizationName,
        plan: "free",
        taskQuota: PLAN_QUOTAS.free,
        apiKey: randomBytes(32).toString("hex"), // Generate API key for org
      });
      await orgRepo.save(org);

      // Create User record linked to the organization
      const user = userRepo.create({
        cognitoId: cognitoUserId,
        email,
        fullName: name,
        role: "admin", // First user is admin of their org
        status: "pending", // Will become active after email verification
        orgId: org.id,
      });
      await userRepo.save(user);

      logger.info("User registered successfully", {
        userId: user.id,
        orgId: org.id,
        email,
        cognitoUserId,
      });

      res.status(201).json({
        message: "Registration successful. Please check your email to verify your account.",
        user: {
          id: user.id,
          email: user.email,
          name: user.fullName,
        },
        organization: {
          id: org.id,
          name: org.name,
        },
      });
    } catch (error: any) {
      logger.error("Signup error", { error: error.message });
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  }
);

/**
 * GET /api/auth/me
 * Get current authenticated user info
 * Returns needsSetup: true if user doesn't have an organization yet
 */
router.get("/me", authenticateUserAllowNoOrg, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const org = req.organization;

    // User needs to complete onboarding if they don't have an org
    const needsSetup = !user.orgId;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
      },
      organization: org ? {
        id: org.id,
        name: org.name,
        plan: org.plan,
      } : null,
      needsSetup,
    });
  } catch (error) {
    logger.error("Error getting user info", { error });
    res.status(500).json({ error: "Failed to get user info" });
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
      if (user.orgId) {
        return res.status(400).json({
          error: "User already belongs to an organization",
        });
      }

      const { action, organizationName, inviteToken } = req.body;
      const userRepo = AppDataSource.getRepository(User);
      const orgRepo = AppDataSource.getRepository(Organization);

      if (action === "create") {
        // Create new organization
        const org = orgRepo.create({
          name: organizationName,
          plan: "free",
          taskQuota: PLAN_QUOTAS.free,
          apiKey: randomBytes(32).toString("hex"),
        });
        await orgRepo.save(org);

        // Update user with org
        user.orgId = org.id;
        user.role = "admin"; // Creator is admin
        await userRepo.save(user);

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

        // Update user with org and role from invite
        user.orgId = invite.orgId;
        user.role = invite.role;
        await userRepo.save(user);

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

export default router;
