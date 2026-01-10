/**
 * Authentication Middleware
 *
 * Pluggable authentication for WorkerMill API.
 * Supports API keys and JWT tokens through configurable providers.
 */

import { Request, Response, NextFunction } from "express";

// Extend Express Request with auth fields
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
      userRole?: string;
      authMethod?: "api_key" | "jwt";
    }
  }
}

/**
 * Authentication provider interface
 * Implement this to integrate with your auth system
 */
export interface AuthProvider {
  /**
   * Validate an API key and return tenant info
   */
  validateApiKey(apiKey: string): Promise<{
    tenantId: string;
    userId?: string;
    role?: string;
  } | null>;

  /**
   * Validate a JWT token and return user info
   */
  validateJwt?(token: string): Promise<{
    tenantId: string;
    userId: string;
    role: string;
  } | null>;
}

/**
 * Simple in-memory API key provider for development
 */
export class SimpleApiKeyProvider implements AuthProvider {
  private apiKeys: Map<string, { tenantId: string; userId?: string; role?: string }> =
    new Map();

  addApiKey(
    key: string,
    tenantId: string,
    userId?: string,
    role?: string
  ): void {
    this.apiKeys.set(key, { tenantId, userId, role });
  }

  async validateApiKey(apiKey: string) {
    return this.apiKeys.get(apiKey) || null;
  }
}

let authProvider: AuthProvider | null = null;

/**
 * Configure the auth provider
 */
export function setAuthProvider(provider: AuthProvider): void {
  authProvider = provider;
}

/**
 * Get the current auth provider
 */
export function getAuthProvider(): AuthProvider | null {
  return authProvider;
}

/**
 * Authentication middleware
 * Validates API keys (X-API-Key header or Bearer token) and JWT tokens
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!authProvider) {
    res.status(500).json({ error: "Auth provider not configured" });
    return;
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

  // Try X-API-Key header first
  if (apiKeyHeader) {
    const result = await authProvider.validateApiKey(apiKeyHeader);
    if (result) {
      req.tenantId = result.tenantId;
      req.userId = result.userId;
      req.userRole = result.role;
      req.authMethod = "api_key";
      return next();
    }
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Try Bearer token (could be API key or JWT)
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Check if it's an API key format (e.g., wm_xxx or org_xxx)
    if (token.startsWith("wm_") || token.startsWith("org_")) {
      const result = await authProvider.validateApiKey(token);
      if (result) {
        req.tenantId = result.tenantId;
        req.userId = result.userId;
        req.userRole = result.role;
        req.authMethod = "api_key";
        return next();
      }
    }

    // Try JWT if provider supports it
    if (authProvider.validateJwt) {
      const result = await authProvider.validateJwt(token);
      if (result) {
        req.tenantId = result.tenantId;
        req.userId = result.userId;
        req.userRole = result.role;
        req.authMethod = "jwt";
        return next();
      }
    }

    res.status(401).json({ error: "Invalid token" });
    return;
  }

  res.status(401).json({ error: "Authentication required" });
}

/**
 * Require admin role middleware
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (req.userRole !== "admin" && req.userRole !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
