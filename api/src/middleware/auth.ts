import { Request, Response, NextFunction } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "../config/index.js";
import { AppDataSource } from "../db/connection.js";
import { User, Organization } from "../models/index.js";
import { logger } from "../utils/logger.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: User;
      organization?: Organization;
      cognitoUser?: {
        sub: string;
        email: string;
        email_verified: boolean;
      };
    }
  }
}

// Create Cognito JWT verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: config.cognito.userPoolId,
  tokenUse: "access",
  clientId: config.cognito.clientId,
});

/**
 * Authenticate user via Cognito JWT
 */
export async function authenticateUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.slice(7);

    // Verify JWT with Cognito
    const payload = await verifier.verify(token);

    req.cognitoUser = {
      sub: payload.sub,
      email: payload["email"] as string,
      email_verified: payload["email_verified"] as boolean,
    };

    // Look up user in database
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { cognitoId: payload.sub },
      relations: ["organization"],
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    req.user = user;
    req.organization = user.organization;

    next();
  } catch (error) {
    logger.error("Authentication error", { error });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Authenticate user via Cognito JWT - allows users without an organization
 * Used for onboarding flows where user needs to create/join an org
 */
export async function authenticateUserAllowNoOrg(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid authorization header" });
      return;
    }

    const token = authHeader.slice(7);

    // Verify JWT with Cognito
    const payload = await verifier.verify(token);

    req.cognitoUser = {
      sub: payload.sub,
      email: payload["email"] as string,
      email_verified: payload["email_verified"] as boolean,
    };

    // Look up user in database
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { cognitoId: payload.sub },
      relations: ["organization"],
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    req.user = user;
    req.organization = user.organization || undefined; // May be undefined if user has no org

    next();
  } catch (error) {
    logger.error("Authentication error", { error });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Authenticate via Organization API key (for webhooks and integrations)
 */
export async function authenticateApiKey(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = req.headers["x-api-key"] as string;

    if (!apiKey) {
      res.status(401).json({ error: "Missing API key" });
      return;
    }

    const orgRepo = AppDataSource.getRepository(Organization);
    const org = await orgRepo.findOne({
      where: { apiKey },
    });

    if (!org) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    req.organization = org;
    next();
  } catch (error) {
    logger.error("API key authentication error", { error });
    res.status(401).json({ error: "Authentication failed" });
  }
}

/**
 * Authenticate via either JWT or API key
 */
export async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];

  if (authHeader?.startsWith("Bearer ")) {
    return authenticateUser(req, res, next);
  }

  if (apiKey) {
    return authenticateApiKey(req, res, next);
  }

  res.status(401).json({ error: "No authentication provided" });
}

/**
 * Require admin role
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/**
 * Authenticate user via query parameter (for SSE connections)
 * EventSource doesn't support custom headers, so we pass token as query param
 */
export async function authenticateSSE(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Try header first, then query param
    let token = "";
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else if (req.query.token && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({ error: "Missing authentication token" });
      return;
    }

    // Verify JWT with Cognito
    const payload = await verifier.verify(token);

    req.cognitoUser = {
      sub: payload.sub,
      email: payload["email"] as string,
      email_verified: payload["email_verified"] as boolean,
    };

    // Look up user in database
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { cognitoId: payload.sub },
      relations: ["organization"],
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    req.user = user;
    req.organization = user.organization;

    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : "Unknown";
    logger.error("SSE authentication error", {
      errorMessage,
      errorName,
      hasToken: !!req.query.token,
      tokenLength: typeof req.query.token === "string" ? req.query.token.length : 0
    });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
