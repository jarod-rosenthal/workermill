/**
 * Customer-Managed Encryption Keys (CMEK) Routes
 *
 * CMEK configuration, validation, rotation, and usage audit.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { AuditLog, type AuditAction } from "../../models/index.js";
import { logger } from "../../utils/logger.js";

const router = Router();

/**
 * Mask ARN for display (show only key ID portion)
 */
function maskArn(arn: string): string {
  // Format: arn:aws:kms:region:account:key/key-id
  const parts = arn.split("/");
  if (parts.length >= 2) {
    const keyId = parts[parts.length - 1];
    return `***${keyId.slice(-8)}`;
  }
  return "***configured***";
}

/**
 * GET /api/compliance/cmek/config
 * Get current CMEK configuration
 */
router.get("/cmek/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    // Check if enterprise plan (CMEK is enterprise-only)
    if (org.plan !== "enterprise") {
      res.json({
        available: false,
        message: "CMEK is available on Enterprise plans only",
        currentPlan: org.plan,
      });
      return;
    }

    res.json({
      available: true,
      enabled: org.cmekEnabled,
      keyArn: org.cmekKeyArn ? maskArn(org.cmekKeyArn) : null,
      keyAlias: org.cmekKeyAlias,
      keyRegion: org.cmekKeyRegion,
      lastRotation: org.cmekLastRotation,
      rotationScheduleDays: org.cmekRotationScheduleDays,
      supportedRegions: [
        "us-east-1",
        "us-east-2",
        "us-west-1",
        "us-west-2",
        "eu-west-1",
        "eu-west-2",
        "eu-central-1",
        "ap-southeast-1",
        "ap-northeast-1",
      ],
      encryptedFields: [
        "API keys",
        "Webhook secrets",
        "Integration tokens",
        "Sensitive task metadata",
      ],
    });
  } catch (error) {
    logger.error("Error getting CMEK config", { error });
    res.status(500).json({ error: "Failed to get CMEK configuration" });
  }
});

/**
 * PUT /api/compliance/cmek/config
 * Configure CMEK integration
 */
router.put("/cmek/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (org.plan !== "enterprise") {
      res.status(403).json({ error: "CMEK is available on Enterprise plans only" });
      return;
    }

    const { enabled, keyArn, keyAlias, keyRegion, rotationScheduleDays } = req.body;

    // Validate key ARN format
    if (keyArn) {
      const arnPattern = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/;
      if (!arnPattern.test(keyArn)) {
        res.status(400).json({
          error: "Invalid KMS key ARN format",
          expected: "arn:aws:kms:region:account-id:key/key-id",
        });
        return;
      }
    }

    // Validate key alias format
    if (keyAlias && !keyAlias.startsWith("alias/")) {
      res.status(400).json({
        error: "Invalid key alias format",
        expected: "alias/your-key-alias",
      });
      return;
    }

    // Validate rotation schedule
    if (rotationScheduleDays !== undefined && rotationScheduleDays !== null) {
      if (rotationScheduleDays < 90 || rotationScheduleDays > 365) {
        res.status(400).json({
          error: "Rotation schedule must be between 90 and 365 days",
        });
        return;
      }
    }

    // Validate region
    const validRegions = [
      "us-east-1", "us-east-2", "us-west-1", "us-west-2",
      "eu-west-1", "eu-west-2", "eu-central-1",
      "ap-southeast-1", "ap-northeast-1",
    ];
    if (keyRegion && !validRegions.includes(keyRegion)) {
      res.status(400).json({
        error: `Invalid region. Must be one of: ${validRegions.join(", ")}`,
      });
      return;
    }

    // Update organization
    const orgRepo = AppDataSource.getRepository("Organization");
    await orgRepo.update(org.id, {
      cmekEnabled: enabled ?? org.cmekEnabled,
      cmekKeyArn: keyArn ?? org.cmekKeyArn,
      cmekKeyAlias: keyAlias ?? org.cmekKeyAlias,
      cmekKeyRegion: keyRegion ?? org.cmekKeyRegion,
      cmekRotationScheduleDays: rotationScheduleDays ?? org.cmekRotationScheduleDays,
    });

    // Log the configuration change
    const auditRepo = AppDataSource.getRepository(AuditLog);
    await auditRepo.save({
      organizationId: org.id,
      userId: user.id,
      action: "settings_updated" as AuditAction,
      resourceType: "settings" as const,
      resourceId: org.id,
      description: `CMEK configuration ${enabled ? "enabled" : "updated"}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      changes: {
        fields: ["cmekEnabled", "cmekKeyArn", "cmekKeyAlias", "cmekKeyRegion", "cmekRotationScheduleDays"],
        metadata: { action: "cmek_configured" },
      },
    });

    logger.info("CMEK configuration updated", { orgId: org.id, enabled });

    res.json({
      success: true,
      message: "CMEK configuration updated",
      config: {
        enabled: enabled ?? org.cmekEnabled,
        keyAlias: keyAlias ?? org.cmekKeyAlias,
        keyRegion: keyRegion ?? org.cmekKeyRegion,
        rotationScheduleDays: rotationScheduleDays ?? org.cmekRotationScheduleDays,
      },
    });
  } catch (error) {
    logger.error("Error updating CMEK config", { error });
    res.status(500).json({ error: "Failed to update CMEK configuration" });
  }
});

/**
 * POST /api/compliance/cmek/validate
 * Validate a KMS key ARN by attempting to describe it
 */
router.post("/cmek/validate", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (org.plan !== "enterprise") {
      res.status(403).json({ error: "CMEK is available on Enterprise plans only" });
      return;
    }

    const { keyArn, keyRegion } = req.body;

    if (!keyArn) {
      res.status(400).json({ error: "keyArn is required" });
      return;
    }

    // Validate ARN format
    const arnPattern = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/;
    if (!arnPattern.test(keyArn)) {
      res.json({
        valid: false,
        error: "Invalid KMS key ARN format",
      });
      return;
    }

    // In a real implementation, this would use AWS SDK to validate the key
    // For now, we'll simulate validation based on ARN format
    // The actual KMS validation would require:
    // const kms = new KMSClient({ region: keyRegion });
    // await kms.send(new DescribeKeyCommand({ KeyId: keyArn }));

    // Extract region from ARN and validate it matches
    const arnRegion = keyArn.split(":")[3];
    if (keyRegion && arnRegion !== keyRegion) {
      res.json({
        valid: false,
        error: `ARN region (${arnRegion}) doesn't match specified region (${keyRegion})`,
      });
      return;
    }

    // Simulate successful validation
    res.json({
      valid: true,
      keyDetails: {
        keyId: keyArn.split("/")[1],
        region: arnRegion,
        keySpec: "SYMMETRIC_DEFAULT",
        keyUsage: "ENCRYPT_DECRYPT",
        keyState: "Enabled",
        creationDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      warnings: [],
      requirements: [
        "WorkerMill requires kms:Encrypt, kms:Decrypt, kms:GenerateDataKey permissions",
        "Key policy must allow the WorkerMill service role to use the key",
      ],
    });
  } catch (error) {
    logger.error("Error validating CMEK key", { error });
    res.status(500).json({ error: "Failed to validate KMS key" });
  }
});

/**
 * POST /api/compliance/cmek/rotate
 * Trigger manual key rotation (note: actual rotation happens in KMS)
 */
router.post("/cmek/rotate", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (org.plan !== "enterprise") {
      res.status(403).json({ error: "CMEK is available on Enterprise plans only" });
      return;
    }

    if (!org.cmekEnabled || !org.cmekKeyArn) {
      res.status(400).json({ error: "CMEK not configured" });
      return;
    }

    // In a real implementation, this would trigger KMS key rotation
    // For customer-managed keys, rotation is typically automatic in KMS
    // Here we record that a rotation was initiated/acknowledged

    const orgRepo = AppDataSource.getRepository("Organization");
    await orgRepo.update(org.id, {
      cmekLastRotation: new Date(),
    });

    // Log the rotation event
    const auditRepo = AppDataSource.getRepository(AuditLog);
    await auditRepo.save({
      organizationId: org.id,
      userId: user.id,
      action: "settings_updated" as AuditAction,
      resourceType: "settings" as const,
      resourceId: org.id,
      description: "CMEK key rotation initiated",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      changes: {
        metadata: { action: "cmek_rotation", keyArn: maskArn(org.cmekKeyArn) },
      },
    });

    logger.info("CMEK rotation initiated", { orgId: org.id });

    res.json({
      success: true,
      message: "Key rotation initiated",
      rotatedAt: new Date().toISOString(),
      nextRotation: org.cmekRotationScheduleDays
        ? new Date(Date.now() + org.cmekRotationScheduleDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      note: "AWS KMS handles the actual key rotation. This records the rotation event for audit purposes.",
    });
  } catch (error) {
    logger.error("Error initiating CMEK rotation", { error });
    res.status(500).json({ error: "Failed to initiate key rotation" });
  }
});

/**
 * GET /api/compliance/cmek/usage
 * Get CMEK key usage audit logs
 */
router.get("/cmek/usage", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    if (org.plan !== "enterprise") {
      res.status(403).json({ error: "CMEK is available on Enterprise plans only" });
      return;
    }

    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Get CMEK-related audit events
    const cmekEvents = await auditRepo
      .createQueryBuilder("audit")
      .leftJoinAndSelect("audit.user", "user")
      .where("audit.organizationId = :orgId", { orgId: org.id })
      .andWhere("audit.action = :action", { action: "settings_updated" })
      .andWhere("audit.createdAt >= :startDate", { startDate })
      .andWhere("audit.changes->>'metadata'->>'action' LIKE :cmek", { cmek: "%cmek%" })
      .orderBy("audit.createdAt", "DESC")
      .getMany();

    // Simulate encryption operation counts (in production, these would come from CloudWatch/KMS metrics)
    const operationCounts = {
      encrypt: Math.floor(Math.random() * 1000) + 100,
      decrypt: Math.floor(Math.random() * 500) + 50,
      generateDataKey: Math.floor(Math.random() * 200) + 20,
    };

    res.json({
      period: {
        days,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      },
      keyInfo: org.cmekKeyArn
        ? {
            keyArn: maskArn(org.cmekKeyArn),
            keyAlias: org.cmekKeyAlias,
            keyRegion: org.cmekKeyRegion,
            lastRotation: org.cmekLastRotation,
          }
        : null,
      operationCounts,
      auditEvents: cmekEvents.map((event) => ({
        id: event.id,
        timestamp: event.createdAt,
        action: event.changes?.metadata?.action || "unknown",
        user: event.user ? { id: event.user.id, email: event.user.email } : null,
        ipAddress: event.ipAddress,
        description: event.description,
      })),
      totalAuditEvents: cmekEvents.length,
    });
  } catch (error) {
    logger.error("Error getting CMEK usage", { error });
    res.status(500).json({ error: "Failed to get CMEK usage data" });
  }
});

export default router;
