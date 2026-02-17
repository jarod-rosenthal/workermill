import { Request, Response, NextFunction } from "express";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import bcrypt from "bcrypt";
import { config } from "../config/index.js";
import { AppDataSource } from "../db/connection.js";
import { User, Organization, UserApiKey } from "../models/index.js";
import { type OrgMemberRole } from "../models/UserOrganization.js";
import { logger } from "../utils/logger.js";
import { getDefaultOrganizationWithRole } from "../services/user-organizations.js";

// Extend Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      organization?: Organization;
      /** User's role in the current organization (from UserOrganization, not legacy User.role) */
      orgRole?: OrgMemberRole;
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
    // LOCAL MODE: Auto-authenticate for local development
    if (process.env.EXECUTION_MODE === "local") {
      const userRepo = AppDataSource.getRepository(User);
      // Find any admin user for local development
      const localUser = await userRepo.findOne({
        where: { email: "admin@localhost" },
      });

      if (localUser) {
        const orgWithRole = await getDefaultOrganizationWithRole(localUser.id);
        if (orgWithRole) {
          req.user = localUser;
          req.organization = orgWithRole.organization;
          req.orgRole = orgWithRole.role;
          next();
          return;
        }
      }
      // Fall through to normal auth if local user not found
    }

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
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    // Get user's default organization and role from user_organizations table
    // This is the single source of truth for org membership
    const orgWithRole = await getDefaultOrganizationWithRole(user.id);
    if (!orgWithRole) {
      res.status(403).json({ error: "User is not a member of any organization" });
      return;
    }

    req.user = user;
    req.organization = orgWithRole.organization;
    req.orgRole = orgWithRole.role;

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
    // LOCAL MODE: Auto-authenticate for local development
    if (process.env.EXECUTION_MODE === "local") {
      const userRepo = AppDataSource.getRepository(User);
      const localUser = await userRepo.findOne({
        where: { email: "admin@localhost" },
      });

      if (localUser) {
        const orgWithRole = await getDefaultOrganizationWithRole(localUser.id);
        req.user = localUser;
        if (orgWithRole) {
          req.organization = orgWithRole.organization;
          req.orgRole = orgWithRole.role;
        }
        next();
        return;
      }
    }

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
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    // Get user's default organization and role from user_organizations table
    // May be undefined if user has no org (that's OK for this middleware)
    const orgWithRole = await getDefaultOrganizationWithRole(user.id);

    req.user = user;
    req.organization = orgWithRole?.organization;
    req.orgRole = orgWithRole?.role;

    next();
  } catch (error) {
    logger.error("Authentication error", { error });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Authenticate via Organization API key or User API key (for webhooks, integrations, and MCP)
 *
 * Supports two types of API keys:
 * 1. Organization API keys (wm_... or org_...) - stored plaintext in organizations.api_key
 * 2. User API keys (usr_...) - stored hashed in user_api_keys table
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

    // First, try Organization API key (prefix + bcrypt verification)
    const orgRepo = AppDataSource.getRepository(Organization);
    const orgKeyPrefix = apiKey.substring(0, 12);
    const orgs = await orgRepo.find({
      where: { apiKeyPrefix: orgKeyPrefix },
    });

    for (const org of orgs) {
      if (org.apiKeyHash && (await bcrypt.compare(apiKey, org.apiKeyHash))) {
        req.organization = org;
        next();
        return;
      }
    }

    // If not an org key, try User API key (usr_... prefix)
    if (apiKey.startsWith("usr_")) {
      const keyPrefix = apiKey.substring(0, 12);
      const userApiKeyRepo = AppDataSource.getRepository(UserApiKey);

      // Find by prefix (indexed for fast lookup)
      const userApiKey = await userApiKeyRepo.findOne({
        where: { keyPrefix },
        relations: ["organization"],
      });

      if (userApiKey) {
        // Verify the full key against the hash
        const isValid = await bcrypt.compare(apiKey, userApiKey.keyHash);

        if (isValid) {
          // Check if key has expired
          if (userApiKey.expiresAt && userApiKey.expiresAt < new Date()) {
            res.status(401).json({ error: "API key has expired" });
            return;
          }

          // Update last used timestamp (fire and forget)
          userApiKeyRepo
            .update({ id: userApiKey.id }, { lastUsedAt: new Date() })
            .catch((err) => logger.warn("Failed to update API key lastUsedAt", { err }));

          req.organization = userApiKey.organization;
          next();
          return;
        }
      }
    }

    res.status(401).json({ error: "Invalid API key" });
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
  // LOCAL MODE: Auto-authenticate for local development
  if (process.env.EXECUTION_MODE === "local") {
    const userRepo = AppDataSource.getRepository(User);
    const localUser = await userRepo.findOne({
      where: { email: "admin@localhost" },
    });

    if (localUser) {
      const orgWithRole = await getDefaultOrganizationWithRole(localUser.id);
      if (orgWithRole) {
        req.user = localUser;
        req.organization = orgWithRole.organization;
        req.orgRole = orgWithRole.role;
        next();
        return;
      }
    }
    // Fall through to normal auth if local user not found
  }

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
 * Require admin or owner role in the current organization
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use orgRole from UserOrganization (single source of truth)
  const role = req.orgRole;
  if (!req.user || !role || (role !== "admin" && role !== "owner")) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/**
 * Authenticate via Cognito JWT only - does NOT require user to exist in database
 * Used for invite acceptance where user may be new (Cognito account exists, but no DB record yet)
 */
export async function authenticateCognitoOnly(
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

    // Optionally look up user if they exist (for existing users accepting invites to new orgs)
    const userRepo = AppDataSource.getRepository(User);
    const user = await userRepo.findOne({
      where: { cognitoId: payload.sub },
    });

    if (user) {
      req.user = user;
      // Get user's default organization and role from user_organizations table
      const orgWithRole = await getDefaultOrganizationWithRole(user.id);
      req.organization = orgWithRole?.organization;
      req.orgRole = orgWithRole?.role;
    }
    // Note: req.user may be undefined for new users - that's OK for invite acceptance

    next();
  } catch (error) {
    logger.error("Cognito-only authentication error", { error });
    res.status(401).json({ error: "Invalid or expired token" });
  }
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
    // LOCAL MODE: Auto-authenticate for local development
    if (process.env.EXECUTION_MODE === "local") {
      const userRepo = AppDataSource.getRepository(User);
      // Find any admin user for local development
      const localUser = await userRepo.findOne({
        where: { email: "admin@localhost" },
      });

      if (localUser) {
        const orgWithRole = await getDefaultOrganizationWithRole(localUser.id);
        if (orgWithRole) {
          req.user = localUser;
          req.organization = orgWithRole.organization;
          req.orgRole = orgWithRole.role;
          next();
          return;
        }
      }
      // Fall through to normal auth if local user not found
    }

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
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    if (user.status !== "active") {
      res.status(403).json({ error: "User account is not active" });
      return;
    }

    // Get user's default organization and role from user_organizations table
    // This is the single source of truth for org membership
    const orgWithRole = await getDefaultOrganizationWithRole(user.id);
    if (!orgWithRole) {
      res.status(403).json({ error: "User is not a member of any organization" });
      return;
    }

    req.user = user;
    req.organization = orgWithRole.organization;
    req.orgRole = orgWithRole.role;

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
