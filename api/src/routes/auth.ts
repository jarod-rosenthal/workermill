import { Router, Request, Response } from "express";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from "@aws-sdk/client-cognito-identity-provider";
import { authenticateUser } from "../middleware/auth.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { AppDataSource } from "../db/connection.js";
import { User, Organization } from "../models/index.js";

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
