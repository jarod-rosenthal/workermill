import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  ResendConfirmationCodeCommand,
  ListIdentityProvidersCommand,
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
import axios from "axios";

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
      const user = await userRepo.findOne({ where: { email } });
      if (user && user.status === "pending") {
        user.status = "active";
        await userRepo.save(user);
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
            user = await userRepo.findOne({ where: { email: userEmail } });

            if (user) {
              // Link existing user to Cognito
              user.cognitoId = cognitoId;
              user.status = "active";
              await userRepo.save(user);
              logger.info("Linked SSO user to existing account", { email: userEmail, cognitoId });
            } else {
              // Create new user without org - they'll complete setup on first visit
              logger.info("Auto-provisioning new SSO user (pending setup)", { email: userEmail, cognitoId });

              user = userRepo.create({
                cognitoId,
                email: userEmail,
                fullName: idPayload.name || userEmail.split("@")[0],
                role: "admin",
                status: "active",
                orgId: null, // No org yet - requires onboarding
              });
              await userRepo.save(user);

              logger.info("SSO user provisioned (pending org setup)", { userId: user.id });
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

export default router;
