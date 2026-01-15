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
import { User, Organization, PLAN_QUOTAS } from "../models/index.js";
import { randomBytes } from "crypto";

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

    // Auto-provision user if not exists
    if (IdToken) {
      try {
        const idPayload = decodeJwtPayload(IdToken);
        const cognitoId = idPayload.sub;
        const userEmail = idPayload.email;

        const userRepo = AppDataSource.getRepository(User);
        const orgRepo = AppDataSource.getRepository(Organization);

        let user = await userRepo.findOne({ where: { cognitoId } });

        if (!user) {
          logger.info("Auto-provisioning new user", { email: userEmail, cognitoId });

          // Create default organization for this user
          const org = orgRepo.create({
            name: `${userEmail.split("@")[0]}'s Organization`,
            plan: "free",
          });
          await orgRepo.save(org);

          // Create user
          user = userRepo.create({
            cognitoId,
            email: userEmail,
            fullName: userEmail.split("@")[0],
            role: "admin", // First user is admin
            status: "active",
            orgId: org.id,
          });
          await userRepo.save(user);

          logger.info("User provisioned successfully", { userId: user.id, orgId: org.id });
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
 */
router.get("/me", authenticateUser, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const org = req.organization!;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
      },
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
    });
  } catch (error) {
    logger.error("Error getting user info", { error });
    res.status(500).json({ error: "Failed to get user info" });
  }
});

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
