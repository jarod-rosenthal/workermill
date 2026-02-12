import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { Organization } from "../../models/index.js";
import { RemoteAgent } from "../../models/RemoteAgent.js";
import { requireAdmin } from "../../middleware/auth.js";
import { body, validateRequest } from "../../middleware/validation.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import {
  getValidPersonasForOrg,
  inferPersonaFromJiraIssue,
  SYSTEM_PERSONAS,
  PERSONA_KEYWORDS,
} from "../../services/persona-inference.js";
import {
  getUserOrganizations,
  setDefaultOrganization,
  hasOrgAccess,
} from "../../services/user-organizations.js";
import { ListSecretsCommand } from "@aws-sdk/client-secrets-manager";
import { secretsClient } from "./helpers.js";

const router = Router();

// =============================================================================
// Persona Management
// =============================================================================

/**
 * GET /api/settings/personas
 * List all valid personas for this organization (system + custom)
 */
router.get("/personas", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const personas = await getValidPersonasForOrg(org.id);

    res.json({
      personas,
      inferenceRules: org.personaInferenceRules || {},
    });
  } catch (error) {
    logger.error("Error getting personas", { error });
    res.status(500).json({ error: "Failed to get personas" });
  }
});

/**
 * GET /api/settings/persona-inference-rules
 * Get org-specific persona inference rules
 */
router.get("/persona-inference-rules", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;

    res.json({
      // Org-specific rules
      rules: org.personaInferenceRules || {},
      // System defaults for reference
      defaults: {
        labelMappings: {
          backend: "backend_developer",
          frontend: "frontend_developer",
          api: "api_engineer",
          devops: "devops_engineer",
          infra: "devops_engineer",
          security: "security_engineer",
          qa: "qa_engineer",
          test: "qa_engineer",
          docs: "tech_writer",
          documentation: "tech_writer",
        },
        keywordPatterns: PERSONA_KEYWORDS,
        availableSystemPersonas: SYSTEM_PERSONAS,
      },
    });
  } catch (error) {
    logger.error("Error getting persona inference rules", { error });
    res.status(500).json({ error: "Failed to get persona inference rules" });
  }
});

/**
 * PUT /api/settings/persona-inference-rules
 * Update org-specific persona inference rules
 */
router.put(
  "/persona-inference-rules",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const orgRepo = AppDataSource.getRepository(Organization);

      const { labelMappings, keywordPatterns, defaultPersona } = req.body;

      // Validate structure
      const rules: Record<string, unknown> = {};

      if (labelMappings !== undefined) {
        if (typeof labelMappings !== "object" || labelMappings === null) {
          res.status(400).json({ error: "labelMappings must be an object" });
          return;
        }
        // Validate all values are strings (persona slugs)
        for (const [label, persona] of Object.entries(labelMappings)) {
          if (typeof persona !== "string") {
            res.status(400).json({
              error: `labelMappings["${label}"] must be a string (persona slug)`,
            });
            return;
          }
        }
        rules.labelMappings = labelMappings;
      }

      if (keywordPatterns !== undefined) {
        if (typeof keywordPatterns !== "object" || keywordPatterns === null) {
          res.status(400).json({ error: "keywordPatterns must be an object" });
          return;
        }
        // Validate all values are valid regex strings
        for (const [persona, pattern] of Object.entries(keywordPatterns)) {
          if (typeof pattern !== "string") {
            res.status(400).json({
              error: `keywordPatterns["${persona}"] must be a string (regex pattern)`,
            });
            return;
          }
          try {
            new RegExp(pattern, "i"); // Test if valid regex
          } catch {
            res.status(400).json({
              error: `keywordPatterns["${persona}"] is not a valid regex: ${pattern}`,
            });
            return;
          }
        }
        rules.keywordPatterns = keywordPatterns;
      }

      if (defaultPersona !== undefined) {
        if (typeof defaultPersona !== "string") {
          res.status(400).json({ error: "defaultPersona must be a string" });
          return;
        }
        rules.defaultPersona = defaultPersona;
      }

      // Merge with existing rules (don't replace, merge)
      org.personaInferenceRules = {
        ...org.personaInferenceRules,
        ...rules,
      };

      await orgRepo.save(org);

      logger.info("Updated persona inference rules", {
        orgId: org.id,
        rules: org.personaInferenceRules,
      });

      res.json({
        message: "Persona inference rules updated",
        rules: org.personaInferenceRules,
      });
    } catch (error) {
      logger.error("Error updating persona inference rules", { error });
      res.status(500).json({
        error: "Failed to update persona inference rules",
      });
    }
  },
);

/**
 * DELETE /api/settings/persona-inference-rules
 * Reset org-specific persona inference rules to defaults
 */
router.delete(
  "/persona-inference-rules",
  requireAdmin,
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const orgRepo = AppDataSource.getRepository(Organization);

      org.personaInferenceRules = {};
      await orgRepo.save(org);

      logger.info("Reset persona inference rules to defaults", {
        orgId: org.id,
      });

      res.json({
        message: "Persona inference rules reset to defaults",
      });
    } catch (error) {
      logger.error("Error resetting persona inference rules", { error });
      res.status(500).json({
        error: "Failed to reset persona inference rules",
      });
    }
  },
);

/**
 * POST /api/settings/test-persona-inference
 * Test which persona would be inferred for given content
 */
router.post(
  "/test-persona-inference",
  async (req: Request, res: Response) => {
    try {
      const org = req.organization!;
      const { summary, description, labels } = req.body;

      if (!summary && !description && !labels) {
        res.status(400).json({
          error:
            "At least one of summary, description, or labels is required",
        });
        return;
      }

      const inferredPersona = await inferPersonaFromJiraIssue(
        {
          summary: summary || "",
          description: description || "",
          labels: labels || [],
          fields: { labels: labels || [] },
        },
        undefined,
        org.id,
      );

      res.json({
        inferredPersona,
        input: { summary, description, labels },
        orgRules: org.personaInferenceRules || {},
      });
    } catch (error) {
      logger.error("Error testing persona inference", { error });
      res.status(500).json({ error: "Failed to test persona inference" });
    }
  },
);

// =============================================================================
// Multi-Organization Support
// =============================================================================

/**
 * GET /api/settings/organizations
 * List all organizations the current user belongs to
 */
router.get("/organizations", async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const orgs = await getUserOrganizations(user.id);

    res.json({
      organizations: orgs,
      currentOrgId: req.organization?.id,
    });
  } catch (error) {
    logger.error("Error fetching user organizations", { error });
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

/**
 * POST /api/settings/organizations/switch
 * Switch to a different organization
 */
router.post(
  "/organizations/switch",
  body("orgId").isUUID().withMessage("orgId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { orgId } = req.body;

      // Verify user has access to this org
      const hasAccess = await hasOrgAccess(user.id, orgId);
      if (!hasAccess) {
        res.status(403).json({
          error: "You do not have access to this organization",
        });
        return;
      }

      // Update user's default org
      await setDefaultOrganization(user.id, orgId);

      // Get the new org details
      const orgRepo = AppDataSource.getRepository(Organization);
      const newOrg = await orgRepo.findOne({ where: { id: orgId } });

      res.json({
        message: "Switched to organization successfully",
        organization: {
          id: newOrg?.id,
          name: newOrg?.name,
          slug: newOrg?.slug,
        },
      });
    } catch (error) {
      logger.error("Error switching organization", { error });
      res.status(500).json({ error: "Failed to switch organization" });
    }
  },
);

/**
 * PUT /api/settings/organizations/default
 * Set the default organization (same as switch but explicitly named)
 */
router.put(
  "/organizations/default",
  body("orgId").isUUID().withMessage("orgId must be a valid UUID"),
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const { orgId } = req.body;

      // Verify user has access to this org
      const hasAccess = await hasOrgAccess(user.id, orgId);
      if (!hasAccess) {
        res.status(403).json({
          error: "You do not have access to this organization",
        });
        return;
      }

      await setDefaultOrganization(user.id, orgId);

      res.json({
        message: "Default organization updated",
        defaultOrgId: orgId,
      });
    } catch (error) {
      logger.error("Error setting default organization", { error });
      res.status(500).json({
        error: "Failed to set default organization",
      });
    }
  },
);

// =============================================================================
// Budget Override
// =============================================================================

/**
 * POST /api/settings/budget-override
 * Set a temporary budget override to bypass budget limits
 */
router.post(
  "/budget-override",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const org = req.organization!;
      const user = req.user!;
      const { durationMinutes, reason } = req.body;

      // Validate duration (max 24 hours)
      const duration = parseInt(durationMinutes, 10);
      if (isNaN(duration) || duration < 1 || duration > 1440) {
        res.status(400).json({
          error: "durationMinutes must be between 1 and 1440 (24 hours)",
        });
        return;
      }

      // Validate reason
      if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
        res.status(400).json({
          error: "reason is required and must be at least 5 characters",
        });
        return;
      }

      const orgRepo = AppDataSource.getRepository(Organization);

      // Set override
      const overrideUntil = new Date(Date.now() + duration * 60 * 1000);
      org.budgetOverrideUntil = overrideUntil;
      org.budgetOverrideReason = reason.trim();

      await orgRepo.save(org);

      logger.info("Budget override set", {
        orgId: org.id,
        userId: user.id,
        durationMinutes: duration,
        overrideUntil,
        reason: org.budgetOverrideReason,
      });

      res.json({
        success: true,
        budgetOverrideUntil: overrideUntil,
        budgetOverrideReason: org.budgetOverrideReason,
        durationMinutes: duration,
      });
    } catch (error) {
      logger.error("Error setting budget override", { error });
      res.status(500).json({ error: "Failed to set budget override" });
    }
  },
);

/**
 * DELETE /api/settings/budget-override
 * Clear an active budget override
 */
router.delete(
  "/budget-override",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const org = req.organization!;
      const user = req.user!;

      const orgRepo = AppDataSource.getRepository(Organization);

      // Clear override
      org.budgetOverrideUntil = null;
      org.budgetOverrideReason = null;

      await orgRepo.save(org);

      logger.info("Budget override cleared", {
        orgId: org.id,
        userId: user.id,
      });

      res.json({ success: true });
    } catch (error) {
      logger.error("Error clearing budget override", { error });
      res.status(500).json({ error: "Failed to clear budget override" });
    }
  },
);

/**
 * GET /api/settings/budget-override
 * Get current budget override status
 */
router.get(
  "/budget-override",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const org = req.organization!;

      const isActive =
        org.budgetOverrideUntil &&
        new Date() < new Date(org.budgetOverrideUntil);

      res.json({
        isActive,
        budgetOverrideUntil: org.budgetOverrideUntil,
        budgetOverrideReason: org.budgetOverrideReason,
        remainingMinutes: isActive
          ? Math.max(
              0,
              Math.ceil(
                (new Date(org.budgetOverrideUntil!).getTime() - Date.now()) /
                  60000,
              ),
            )
          : 0,
      });
    } catch (error) {
      logger.error("Error getting budget override status", { error });
      res.status(500).json({
        error: "Failed to get budget override status",
      });
    }
  },
);

// =============================================================================
// Support Diagnostics
// =============================================================================

/**
 * GET /api/settings/support/diagnose/:orgName
 * Support admin diagnostic endpoint - shows tenant state
 * Requires supportAdmin flag on user
 */
router.get(
  "/support/diagnose/:orgName",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;

      // Only allow support admins - NEVER relax this check
      if (!user.supportAdmin) {
        res.status(403).json({ error: "Support admin access required" });
        return;
      }

      const { orgName } = req.params;
      const orgRepo = AppDataSource.getRepository(Organization);
      const { User, OrgInvite, UserOrganization } = await import(
        "../../models/index.js"
      );
      const userRepo = AppDataSource.getRepository(User);
      const inviteRepo = AppDataSource.getRepository(OrgInvite);
      const userOrgRepo = AppDataSource.getRepository(UserOrganization);

      // Find org by name or slug
      const org = await orgRepo
        .createQueryBuilder("org")
        .where("LOWER(org.name) LIKE LOWER(:name)", {
          name: `%${orgName}%`,
        })
        .orWhere("LOWER(org.slug) = LOWER(:slug)", { slug: orgName })
        .getOne();

      if (!org) {
        res.status(404).json({
          error: `Organization not found: ${orgName}`,
        });
        return;
      }

      // Get users via legacy orgId
      const usersViaOrgId = await userRepo.find({
        where: { orgId: org.id },
        select: ["id", "email", "role", "createdAt", "cognitoId"],
      });

      // Get UserOrganization memberships
      const memberships = await userOrgRepo.find({
        where: { orgId: org.id },
        relations: ["user"],
      });

      // Get pending invites
      const invites = await inviteRepo.find({
        where: { orgId: org.id },
      });

      // Check if invited users exist elsewhere
      const inviteAnalysis = [];
      for (const invite of invites) {
        const existingUser = await userRepo.findOne({
          where: { email: invite.email.toLowerCase() },
          select: ["id", "email", "orgId", "cognitoId"],
        });
        inviteAnalysis.push({
          email: invite.email,
          role: invite.role,
          accepted: invite.accepted,
          expired: invite.isExpired(),
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          userExists: !!existingUser,
          userOrgId: existingUser?.orgId || null,
          userInThisOrg: existingUser?.orgId === org.id,
          hasCognitoId: !!existingUser?.cognitoId,
        });
      }

      // Check secrets in AWS
      const secretsPrefix = `workermill/${config.environment}/orgs/${org.id}/`;
      let secrets: string[] = [];
      try {
        const listResult = await secretsClient.send(
          new ListSecretsCommand({
            Filters: [{ Key: "name", Values: [secretsPrefix] }],
          }),
        );
        secrets = (listResult.SecretList || []).map(
          (s) => s.Name?.replace(secretsPrefix, "") || "unknown",
        );
      } catch (e) {
        secrets = [`Error listing secrets: ${e}`];
      }

      res.json({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          createdAt: org.createdAt,
        },
        usersViaOrgId: usersViaOrgId.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role,
          hasCognitoId: !!u.cognitoId,
        })),
        userOrganizationRecords: memberships.map((m) => ({
          userId: m.userId,
          email: m.user?.email,
          role: m.role,
          isDefault: m.isDefault,
          joinedAt: m.joinedAt,
        })),
        invites: inviteAnalysis,
        secrets,
        issues: [
          ...inviteAnalysis
            .filter((i) => !i.accepted && i.userExists && i.userInThisOrg)
            .map(
              (i) =>
                `ORPHAN_INVITE: ${i.email} already member but invite exists`,
            ),
          ...inviteAnalysis
            .filter(
              (i) =>
                !i.accepted &&
                i.userExists &&
                !i.userInThisOrg &&
                i.hasCognitoId,
            )
            .map(
              (i) =>
                `USER_WRONG_ORG: ${i.email} exists with different org`,
            ),
          ...usersViaOrgId
            .filter((u) => !memberships.some((m) => m.userId === u.id))
            .map(
              (u) =>
                `MISSING_JUNCTION: ${u.email} has orgId but no UserOrganization record`,
            ),
        ],
      });
    } catch (error) {
      logger.error("Error in support diagnose", { error });
      res.status(500).json({ error: "Diagnostic failed" });
    }
  },
);

// =============================================================================
// Remote Agents
// =============================================================================

/**
 * GET /api/settings/remote-agents
 * Get connected remote agents for the organization
 */
router.get("/remote-agents", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const agentRepo = AppDataSource.getRepository(RemoteAgent);

    const agents = await agentRepo.find({
      where: { orgId: org.id },
      order: { lastHeartbeatAt: "DESC" },
    });

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    res.json({
      agents: agents.map((a) => ({
        agentId: a.agentId,
        hostname: a.hostname,
        platform: a.platform,
        nodeVersion: a.nodeVersion,
        dockerVersion: a.dockerVersion,
        claudeVersion: a.claudeVersion,
        maxWorkers: a.maxWorkers,
        activeTasks: a.activeTasks,
        status: a.lastHeartbeatAt > twoMinutesAgo ? "online" : "offline",
        lastHeartbeatAt: a.lastHeartbeatAt,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Error fetching remote agents", { error });
    res.status(500).json({ error: "Failed to fetch remote agents" });
  }
});

export default router;
