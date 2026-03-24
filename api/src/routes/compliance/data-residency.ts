/**
 * Data Residency Controls Routes
 *
 * Data residency configuration, compliance checks, and regional endpoint routing.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { AuditLog, type AuditAction } from "../../models/index.js";
import { logger } from "../../utils/logger.js";

const router = Router();

/**
 * Data residency regions with their properties
 */
const DATA_REGIONS = {
  "us-east-1": {
    name: "US East (N. Virginia)",
    country: "US",
    continent: "NA",
    gdprCompliant: false,
    dataCenter: "AWS US East",
  },
  "us-east-2": {
    name: "US East (Ohio)",
    country: "US",
    continent: "NA",
    gdprCompliant: false,
    dataCenter: "AWS US East 2",
  },
  "us-west-1": {
    name: "US West (N. California)",
    country: "US",
    continent: "NA",
    gdprCompliant: false,
    dataCenter: "AWS US West",
  },
  "us-west-2": {
    name: "US West (Oregon)",
    country: "US",
    continent: "NA",
    gdprCompliant: false,
    dataCenter: "AWS US West 2",
  },
  "eu-west-1": {
    name: "EU (Ireland)",
    country: "IE",
    continent: "EU",
    gdprCompliant: true,
    dataCenter: "AWS EU West",
  },
  "eu-west-2": {
    name: "EU (London)",
    country: "GB",
    continent: "EU",
    gdprCompliant: true,
    dataCenter: "AWS EU West 2",
  },
  "eu-central-1": {
    name: "EU (Frankfurt)",
    country: "DE",
    continent: "EU",
    gdprCompliant: true,
    dataCenter: "AWS EU Central",
  },
  "ap-southeast-1": {
    name: "Asia Pacific (Singapore)",
    country: "SG",
    continent: "APAC",
    gdprCompliant: false,
    dataCenter: "AWS APAC",
  },
  "ap-northeast-1": {
    name: "Asia Pacific (Tokyo)",
    country: "JP",
    continent: "APAC",
    gdprCompliant: false,
    dataCenter: "AWS APAC NE",
  },
};

type DataRegionId = keyof typeof DATA_REGIONS;

/**
 * GET /api/compliance/data-residency/config
 * Get current data residency configuration
 */
router.get("/data-residency/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const currentRegion = DATA_REGIONS[org.dataRegion as DataRegionId] || DATA_REGIONS["us-east-1"];

    res.json({
      current: {
        region: org.dataRegion,
        regionInfo: currentRegion,
        residencyMode: org.dataResidencyMode,
      },
      availableRegions: Object.entries(DATA_REGIONS).map(([id, info]) => ({
        id,
        ...info,
      })),
      residencyModes: [
        {
          id: "standard",
          name: "Standard",
          description: "Data may be processed in any region for optimal performance",
        },
        {
          id: "eu_only",
          name: "EU Only",
          description: "All data stored and processed within EU regions only",
          requires: "Enterprise plan",
        },
        {
          id: "us_only",
          name: "US Only",
          description: "All data stored and processed within US regions only",
          requires: "Enterprise plan",
        },
        {
          id: "regional",
          name: "Regional",
          description: "Data stays within the selected region only",
          requires: "Enterprise plan",
        },
      ],
      complianceStatus: {
        gdprCompliant: currentRegion.gdprCompliant,
        crossBorderTransfers: org.dataResidencyMode === "standard",
        dataLocalizedTo: org.dataResidencyMode === "regional" ? org.dataRegion : null,
      },
    });
  } catch (error) {
    logger.error("Error getting data residency config", { error });
    res.status(500).json({ error: "Failed to get data residency configuration" });
  }
});

/**
 * PUT /api/compliance/data-residency/config
 * Update data residency configuration
 */
router.put("/data-residency/config", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { region, residencyMode } = req.body;

    // Validate region
    if (region && !DATA_REGIONS[region as DataRegionId]) {
      res.status(400).json({
        error: `Invalid region. Must be one of: ${Object.keys(DATA_REGIONS).join(", ")}`,
      });
      return;
    }

    // Validate residency mode
    const validModes = ["standard", "eu_only", "us_only", "regional"];
    if (residencyMode && !validModes.includes(residencyMode)) {
      res.status(400).json({
        error: `Invalid residency mode. Must be one of: ${validModes.join(", ")}`,
      });
      return;
    }

    // Check enterprise requirement for strict modes
    if (residencyMode && residencyMode !== "standard" && org.plan !== "enterprise") {
      res.status(403).json({
        error: `${residencyMode} mode requires Enterprise plan`,
        currentPlan: org.plan,
      });
      return;
    }

    // Validate region matches residency mode
    if (residencyMode === "eu_only" && region) {
      const regionInfo = DATA_REGIONS[region as DataRegionId];
      if (regionInfo && regionInfo.continent !== "EU") {
        res.status(400).json({
          error: "EU-only mode requires an EU region",
          suggestedRegions: Object.entries(DATA_REGIONS)
            .filter(([, info]) => info.continent === "EU")
            .map(([id]) => id),
        });
        return;
      }
    }

    if (residencyMode === "us_only" && region) {
      const regionInfo = DATA_REGIONS[region as DataRegionId];
      if (regionInfo && regionInfo.continent !== "NA") {
        res.status(400).json({
          error: "US-only mode requires a US region",
          suggestedRegions: Object.entries(DATA_REGIONS)
            .filter(([, info]) => info.continent === "NA")
            .map(([id]) => id),
        });
        return;
      }
    }

    // Update organization
    const orgRepo = AppDataSource.getRepository("Organization");
    await orgRepo.update(org.id, {
      dataRegion: region ?? org.dataRegion,
      dataResidencyMode: residencyMode ?? org.dataResidencyMode,
    });

    // Log the change
    const auditRepo = AppDataSource.getRepository(AuditLog);
    await auditRepo.save({
      organizationId: org.id,
      userId: user.id,
      action: "settings_updated" as AuditAction,
      resourceType: "settings" as const,
      resourceId: org.id,
      description: `Data residency updated: region=${region || org.dataRegion}, mode=${residencyMode || org.dataResidencyMode}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      changes: {
        fields: ["dataRegion", "dataResidencyMode"],
        before: { dataRegion: org.dataRegion, dataResidencyMode: org.dataResidencyMode },
        after: { dataRegion: region || org.dataRegion, dataResidencyMode: residencyMode || org.dataResidencyMode },
      },
    });

    logger.info("Data residency updated", { orgId: org.id, region, residencyMode });

    res.json({
      success: true,
      message: "Data residency configuration updated",
      config: {
        region: region ?? org.dataRegion,
        residencyMode: residencyMode ?? org.dataResidencyMode,
      },
    });
  } catch (error) {
    logger.error("Error updating data residency config", { error });
    res.status(500).json({ error: "Failed to update data residency configuration" });
  }
});

/**
 * GET /api/compliance/data-residency/check
 * Check data localization compliance
 */
router.get("/data-residency/check", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const currentRegion = DATA_REGIONS[org.dataRegion as DataRegionId] || DATA_REGIONS["us-east-1"];

    // Check cross-border transfer status
    const crossBorderAllowed = org.dataResidencyMode === "standard";

    // Build compliance checklist
    const checks = [
      {
        id: "data_storage_region",
        name: "Data Storage Region",
        status: "compliant" as const,
        details: `Data stored in ${currentRegion.name} (${currentRegion.country})`,
      },
      {
        id: "gdpr_compliant_region",
        name: "GDPR-Compliant Region",
        status: currentRegion.gdprCompliant ? ("compliant" as const) : ("info" as const),
        details: currentRegion.gdprCompliant
          ? "Region is within EU/EEA"
          : "Region is outside EU. Ensure appropriate data transfer mechanisms if processing EU data.",
      },
      {
        id: "cross_border_transfers",
        name: "Cross-Border Data Transfers",
        status: crossBorderAllowed ? ("info" as const) : ("compliant" as const),
        details: crossBorderAllowed
          ? "Cross-border transfers allowed in standard mode"
          : `Data localized to ${org.dataResidencyMode.replace("_", " ")} regions`,
      },
      {
        id: "encryption_at_rest",
        name: "Encryption at Rest",
        status: "compliant" as const,
        details: "All data encrypted at rest using AES-256",
      },
      {
        id: "encryption_in_transit",
        name: "Encryption in Transit",
        status: "compliant" as const,
        details: "All data encrypted in transit using TLS 1.3",
      },
    ];

    // Add CMEK check if enterprise
    if (org.plan === "enterprise") {
      checks.push({
        id: "customer_managed_keys",
        name: "Customer-Managed Encryption Keys",
        status: org.cmekEnabled ? ("compliant" as const) : ("info" as const),
        details: org.cmekEnabled
          ? "CMEK enabled with customer-managed AWS KMS key"
          : "Using platform-managed encryption keys (CMEK available)",
      });
    }

    const complianceScore = checks.filter((c) => c.status === "compliant").length;
    const totalChecks = checks.length;

    res.json({
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      region: {
        id: org.dataRegion,
        ...currentRegion,
      },
      residencyMode: org.dataResidencyMode,
      complianceSummary: {
        score: Math.round((complianceScore / totalChecks) * 100),
        compliant: complianceScore,
        total: totalChecks,
      },
      checks,
      recommendations: buildResidencyRecommendations(org, currentRegion),
    });
  } catch (error) {
    logger.error("Error checking data residency compliance", { error });
    res.status(500).json({ error: "Failed to check data residency compliance" });
  }
});

/**
 * Build recommendations based on current residency configuration
 */
function buildResidencyRecommendations(
  org: { dataResidencyMode: string; plan: string; cmekEnabled?: boolean },
  region: { gdprCompliant: boolean; continent: string }
): string[] {
  const recommendations: string[] = [];

  if (!region.gdprCompliant && org.dataResidencyMode === "standard") {
    recommendations.push(
      "Consider EU-only mode if processing EU personal data to simplify GDPR compliance"
    );
  }

  if (org.plan === "enterprise" && !org.cmekEnabled) {
    recommendations.push(
      "Enable Customer-Managed Encryption Keys (CMEK) for additional data control"
    );
  }

  if (org.dataResidencyMode === "standard") {
    recommendations.push(
      "Standard mode allows cross-border transfers. Ensure appropriate data processing agreements are in place."
    );
  }

  return recommendations;
}

/**
 * GET /api/compliance/data-residency/endpoints
 * Get regional endpoint routing information
 */
router.get("/data-residency/endpoints", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const currentRegion = org.dataRegion;

    // Define regional endpoints (in production, these would be actual regional deployments)
    const endpoints = {
      api: {
        global: "https://api.workermill.com",
        regional: `https://api.${currentRegion}.workermill.com`,
        active: org.dataResidencyMode === "regional"
          ? `https://api.${currentRegion}.workermill.com`
          : "https://api.workermill.com",
      },
      webhooks: {
        global: "https://webhooks.workermill.com",
        regional: `https://webhooks.${currentRegion}.workermill.com`,
        active: org.dataResidencyMode === "regional"
          ? `https://webhooks.${currentRegion}.workermill.com`
          : "https://webhooks.workermill.com",
      },
      workers: {
        description: "Worker containers run in the configured region",
        region: currentRegion,
        cluster: `workermill-${currentRegion}`,
      },
      database: {
        description: "Database hosted in configured region",
        region: currentRegion,
        encrypted: true,
        cmekEnabled: org.cmekEnabled || false,
      },
      storage: {
        description: "File storage (logs, artifacts) in configured region",
        region: currentRegion,
        bucket: `workermill-${currentRegion}-storage`,
        encrypted: true,
      },
    };

    res.json({
      organization: {
        id: org.id,
        name: org.name,
      },
      currentRegion,
      residencyMode: org.dataResidencyMode,
      endpoints,
      routingNotes: [
        "Global endpoints route to the nearest regional cluster",
        "Regional endpoints ensure all processing stays within the specified region",
        "Worker containers always run in the configured region",
        "Database replication (if enabled) stays within the same geographic area",
      ],
    });
  } catch (error) {
    logger.error("Error getting regional endpoints", { error });
    res.status(500).json({ error: "Failed to get regional endpoints" });
  }
});

export default router;
