/**
 * Platform Admin Authentication Middleware
 *
 * Provides authentication for platform management routes.
 * Requires BOTH:
 * - user.supportAdmin = true (user-level permission)
 * - user is member of the platform org (org-level access)
 *
 * This dual-check ensures only explicitly authorized users
 * can access platform management features.
 */

import { Request, Response, NextFunction } from "express";
import { AppDataSource } from "../db/connection.js";
import { Organization, UserOrganization } from "../models/index.js";
import { logger } from "../utils/logger.js";

/**
 * Require platform admin access.
 * User must be:
 * 1. Authenticated (req.user must exist)
 * 2. Have supportAdmin = true
 * 3. Be a member of the platform organization
 */
export async function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Must be authenticated
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Must have supportAdmin flag
    if (!req.user.supportAdmin) {
      logger.warn("Platform admin access denied - not a support admin", {
        userId: req.user.id,
        email: req.user.email,
      });
      res.status(403).json({ error: "Platform admin access required" });
      return;
    }

    // Must be a member of the platform org
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      logger.error("Platform org not configured - platform admin access denied");
      res.status(503).json({ error: "Platform organization not configured" });
      return;
    }

    // Check membership in platform org
    const userOrgRepo = AppDataSource.getRepository(UserOrganization);
    const membership = await userOrgRepo.findOne({
      where: {
        userId: req.user.id,
        orgId: platformOrg.id,
      },
    });

    if (!membership) {
      logger.warn("Platform admin access denied - not a platform org member", {
        userId: req.user.id,
        email: req.user.email,
        platformOrgId: platformOrg.id,
      });
      res.status(403).json({ error: "Platform organization membership required" });
      return;
    }

    // Store platform org on request for use in handlers
    (req as Request & { platformOrg?: Organization }).platformOrg = platformOrg;

    logger.debug("Platform admin access granted", {
      userId: req.user.id,
      email: req.user.email,
      platformOrgId: platformOrg.id,
    });

    next();
  } catch (error) {
    logger.error("Platform admin auth error", { error });
    res.status(500).json({ error: "Authentication check failed" });
  }
}

/**
 * Check if current user is a platform admin (without blocking)
 * Useful for conditional UI elements
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const platformOrg = await Organization.getPlatformOrg();
    if (!platformOrg) {
      return false;
    }

    const userOrgRepo = AppDataSource.getRepository(UserOrganization);
    const membership = await userOrgRepo.findOne({
      where: {
        userId,
        orgId: platformOrg.id,
      },
    });

    return !!membership;
  } catch (error) {
    logger.error("isPlatformAdmin check failed", { error, userId });
    return false;
  }
}
