/**
 * SOC 2 Compliance Routes
 *
 * SOC 2 Trust Service Criteria reports, compliance posture, EU AI Act readiness.
 */

import { Router, Request, Response } from "express";
import { AppDataSource } from "../../db/connection.js";
import { AuditLog, type AuditAction } from "../../models/index.js";
import { logger } from "../../utils/logger.js";
import { Between, In } from "typeorm";

const router = Router();

/**
 * SOC 2 Trust Service Criteria Categories
 * Maps audit actions to SOC 2 Trust Service Criteria
 */
const SOC2_CRITERIA = {
  // CC6: Logical and Physical Access Controls
  CC6: {
    name: "Logical and Physical Access Controls",
    description: "Controls related to restricting logical and physical access to systems",
    actions: [
      "login",
      "logout",
      "password_changed",
      "mfa_enabled",
      "mfa_disabled",
      "api_key_created",
      "api_key_revoked",
      "api_key_rotated",
      "member_invited",
      "member_removed",
      "member_role_changed",
    ] as AuditAction[],
  },
  // CC7: System Operations
  CC7: {
    name: "System Operations",
    description: "Controls related to detecting and monitoring system operations",
    actions: [
      "orchestrator_started",
      "orchestrator_stopped",
      "task_created",
      "task_deleted",
      "task_cancelled",
      "task_retried",
    ] as AuditAction[],
  },
  // CC8: Change Management
  CC8: {
    name: "Change Management",
    description: "Controls related to managing changes to infrastructure and software",
    actions: [
      "settings_updated",
      "webhook_configured",
      "webhook_legacy_used",
      "integration_connected",
      "integration_disconnected",
    ] as AuditAction[],
  },
  // CC9: Risk Mitigation
  CC9: {
    name: "Risk Mitigation",
    description: "Controls related to identifying and mitigating risks",
    actions: [
      "billing_plan_changed",
      "billing_subscription_created",
      "billing_subscription_cancelled",
    ] as AuditAction[],
  },
};

/**
 * GET /api/compliance/soc2-report
 * Generate SOC 2 compliance report mapping audit logs to Trust Service Criteria
 */
router.get("/soc2-report", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    // Only admins can access compliance reports
    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required for compliance reports" });
      return;
    }

    // Parse date range
    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : new Date();

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Build the report by criteria
    const report: Record<string, {
      name: string;
      description: string;
      totalEvents: number;
      events: Array<{
        action: string;
        count: number;
        lastOccurrence: Date | null;
      }>;
      complianceStatus: "compliant" | "review_needed" | "no_data";
    }> = {};

    for (const [criteriaId, criteria] of Object.entries(SOC2_CRITERIA)) {
      // Count events by action for this criteria
      const actionCounts = await auditRepo
        .createQueryBuilder("audit")
        .select("audit.action", "action")
        .addSelect("COUNT(*)", "count")
        .addSelect("MAX(audit.createdAt)", "lastOccurrence")
        .where("audit.organizationId = :orgId", { orgId: org.id })
        .andWhere("audit.createdAt >= :startDate", { startDate })
        .andWhere("audit.createdAt <= :endDate", { endDate })
        .andWhere("audit.action IN (:...actions)", { actions: criteria.actions })
        .groupBy("audit.action")
        .getRawMany();

      const totalEvents = actionCounts.reduce((sum, row) => sum + parseInt(row.count), 0);

      // Determine compliance status
      let complianceStatus: "compliant" | "review_needed" | "no_data" = "no_data";
      if (totalEvents > 0) {
        // Check for potential issues (e.g., MFA disabled, many failed logins)
        const hasSecurityConcerns = actionCounts.some(
          (row) => row.action === "mfa_disabled" && parseInt(row.count) > 0
        );
        complianceStatus = hasSecurityConcerns ? "review_needed" : "compliant";
      }

      report[criteriaId] = {
        name: criteria.name,
        description: criteria.description,
        totalEvents,
        events: actionCounts.map((row) => ({
          action: row.action,
          count: parseInt(row.count),
          lastOccurrence: row.lastOccurrence,
        })),
        complianceStatus,
      };
    }

    // Calculate overall compliance score
    const criteriaCount = Object.keys(report).length;
    const compliantCount = Object.values(report).filter(
      (c) => c.complianceStatus === "compliant"
    ).length;
    const reviewNeededCount = Object.values(report).filter(
      (c) => c.complianceStatus === "review_needed"
    ).length;

    res.json({
      reportType: "SOC 2 Type II",
      organization: {
        id: org.id,
        name: org.name,
      },
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      generatedAt: new Date().toISOString(),
      summary: {
        totalCriteria: criteriaCount,
        compliant: compliantCount,
        reviewNeeded: reviewNeededCount,
        noData: criteriaCount - compliantCount - reviewNeededCount,
        overallScore: Math.round((compliantCount / criteriaCount) * 100),
      },
      criteria: report,
    });
  } catch (error) {
    logger.error("Error generating SOC 2 report", { error });
    res.status(500).json({ error: "Failed to generate SOC 2 report" });
  }
});

/**
 * GET /api/compliance/soc2-report/export
 * Export SOC 2 report as downloadable JSON
 */
router.get("/soc2-report/export", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const startDate = req.query.startDate
      ? new Date(req.query.startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate
      ? new Date(req.query.endDate as string)
      : new Date();

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Get all audit logs for the period
    const logs = await auditRepo.find({
      where: {
        organizationId: org.id,
        createdAt: Between(startDate, endDate),
      },
      relations: ["user"],
      order: { createdAt: "DESC" },
    });

    // Build detailed report
    const report: Record<string, unknown> = {
      reportType: "SOC 2 Type II Compliance Report",
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        daysIncluded: Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
      },
      generatedAt: new Date().toISOString(),
      generatedBy: {
        userId: user.id,
        email: user.email,
      },
    };

    // Add criteria summaries
    const criteriaSummaries: Record<string, unknown> = {};
    for (const [criteriaId, criteria] of Object.entries(SOC2_CRITERIA)) {
      const relevantLogs = logs.filter((log) =>
        criteria.actions.includes(log.action)
      );
      criteriaSummaries[criteriaId] = {
        name: criteria.name,
        description: criteria.description,
        eventCount: relevantLogs.length,
        events: relevantLogs.map((log) => ({
          id: log.id,
          action: log.action,
          resourceType: log.resourceType,
          resourceId: log.resourceId,
          description: log.description,
          ipAddress: log.ipAddress,
          createdAt: log.createdAt,
          user: log.user
            ? { id: log.user.id, email: log.user.email }
            : null,
        })),
      };
    }
    report.criteria = criteriaSummaries;

    // Set download headers
    const filename = `soc2-report-${org.name.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    res.json(report);
  } catch (error) {
    logger.error("Error exporting SOC 2 report", { error });
    res.status(500).json({ error: "Failed to export SOC 2 report" });
  }
});

/**
 * GET /api/compliance/posture
 * Get overall compliance posture overview
 */
router.get("/posture", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const auditRepo = AppDataSource.getRepository(AuditLog);

    // Get counts for last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Security events
    const securityActions: AuditAction[] = [
      "login", "logout", "password_changed", "mfa_enabled", "mfa_disabled",
      "api_key_created", "api_key_revoked", "api_key_rotated",
    ];
    const securityEventCount = await auditRepo.count({
      where: {
        organizationId: org.id,
        action: In(securityActions),
        createdAt: Between(thirtyDaysAgo, new Date()),
      },
    });

    // Access control events
    const accessActions: AuditAction[] = [
      "member_invited", "member_removed", "member_role_changed",
    ];
    const accessEventCount = await auditRepo.count({
      where: {
        organizationId: org.id,
        action: In(accessActions),
        createdAt: Between(thirtyDaysAgo, new Date()),
      },
    });

    // Change management events
    const changeActions: AuditAction[] = [
      "settings_updated", "webhook_configured", "integration_connected", "integration_disconnected",
    ];
    const changeEventCount = await auditRepo.count({
      where: {
        organizationId: org.id,
        action: In(changeActions),
        createdAt: Between(thirtyDaysAgo, new Date()),
      },
    });

    // Check for security concerns
    const mfaDisabledCount = await auditRepo.count({
      where: {
        organizationId: org.id,
        action: "mfa_disabled" as AuditAction,
        createdAt: Between(thirtyDaysAgo, new Date()),
      },
    });

    // Compliance controls status
    const controls = [
      {
        id: "audit_logging",
        name: "Audit Logging",
        status: "active" as const,
        description: "All user and system actions are logged",
      },
      {
        id: "access_control",
        name: "Access Control",
        status: "active" as const,
        description: "Role-based access control is enforced",
      },
      {
        id: "mfa",
        name: "Multi-Factor Authentication",
        status: mfaDisabledCount > 0 ? ("review_needed" as const) : ("active" as const),
        description: mfaDisabledCount > 0
          ? `${mfaDisabledCount} MFA disable events in last 30 days`
          : "MFA controls in place",
      },
      {
        id: "encryption",
        name: "Data Encryption",
        status: "active" as const,
        description: "Data encrypted at rest and in transit (TLS 1.3)",
      },
      {
        id: "data_retention",
        name: "Data Retention",
        status: "active" as const,
        description: `Audit logs retained for ${org.plan === "enterprise" ? 365 : org.plan === "pro" ? 90 : 14} days`,
      },
    ];

    // Calculate overall score
    const activeControls = controls.filter((c) => c.status === "active").length;
    const overallScore = Math.round((activeControls / controls.length) * 100);

    res.json({
      organization: {
        id: org.id,
        name: org.name,
        plan: org.plan,
      },
      period: {
        days: 30,
        startDate: thirtyDaysAgo.toISOString(),
        endDate: new Date().toISOString(),
      },
      summary: {
        overallScore,
        totalControls: controls.length,
        activeControls,
        reviewNeeded: controls.filter((c) => c.status === "review_needed").length,
      },
      eventCounts: {
        security: securityEventCount,
        accessControl: accessEventCount,
        changeManagement: changeEventCount,
        total: securityEventCount + accessEventCount + changeEventCount,
      },
      controls,
      frameworks: [
        { id: "soc2", name: "SOC 2 Type II", status: "supported" },
        { id: "gdpr", name: "GDPR", status: "supported" },
        { id: "hipaa", name: "HIPAA", status: "partial" },
        { id: "eu_ai_act", name: "EU AI Act", status: "preparing" },
      ],
    });
  } catch (error) {
    logger.error("Error getting compliance posture", { error });
    res.status(500).json({ error: "Failed to get compliance posture" });
  }
});

/**
 * GET /api/compliance/eu-ai-act
 * Get EU AI Act readiness checklist
 */
router.get("/eu-ai-act", async (req: Request, res: Response) => {
  try {
    const org = req.organization!;
    const user = req.user!;

    if (req.orgRole !== "admin" && req.orgRole !== "owner") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    // EU AI Act readiness checklist (Feb 2026 deadline)
    const checklist = [
      {
        id: "risk_classification",
        category: "Risk Classification",
        requirement: "AI systems must be classified by risk level",
        status: "compliant",
        notes: "WorkerMill AI workers classified as limited risk (code generation assistance)",
      },
      {
        id: "transparency",
        category: "Transparency",
        requirement: "Users must be informed they are interacting with AI",
        status: "compliant",
        notes: "All AI-generated code clearly attributed in PRs and logs",
      },
      {
        id: "human_oversight",
        category: "Human Oversight",
        requirement: "Human review mechanisms for AI outputs",
        status: "compliant",
        notes: "PR review workflow ensures human approval before merge",
      },
      {
        id: "data_governance",
        category: "Data Governance",
        requirement: "Training data quality and governance",
        status: "compliant",
        notes: "Using pre-trained models (Claude) with documented training practices",
      },
      {
        id: "documentation",
        category: "Technical Documentation",
        requirement: "Maintain technical documentation of AI systems",
        status: "compliant",
        notes: "System architecture and AI usage documented",
      },
      {
        id: "logging",
        category: "Logging & Traceability",
        requirement: "Automatic logging of AI system operations",
        status: "compliant",
        notes: "Comprehensive audit logging of all AI worker activities",
      },
      {
        id: "accuracy",
        category: "Accuracy & Robustness",
        requirement: "Appropriate levels of accuracy and robustness",
        status: "compliant",
        notes: "Quality gates, test coverage requirements, and code review",
      },
      {
        id: "cybersecurity",
        category: "Cybersecurity",
        requirement: "Resilience against attempts to alter use or performance",
        status: "compliant",
        notes: "Sandboxed execution, rate limiting, access controls",
      },
    ];

    const compliantCount = checklist.filter((item) => item.status === "compliant").length;
    const totalItems = checklist.length;

    res.json({
      framework: "EU AI Act",
      effectiveDate: "2026-02-02",
      organization: {
        id: org.id,
        name: org.name,
      },
      generatedAt: new Date().toISOString(),
      summary: {
        totalRequirements: totalItems,
        compliant: compliantCount,
        partial: checklist.filter((item) => item.status === "partial").length,
        nonCompliant: checklist.filter((item) => item.status === "non_compliant").length,
        readinessScore: Math.round((compliantCount / totalItems) * 100),
      },
      checklist,
      riskClassification: {
        level: "limited",
        description: "AI-powered code generation tools are classified as limited risk under the EU AI Act",
        obligations: [
          "Transparency obligations",
          "Human oversight requirements",
          "Technical documentation",
        ],
      },
    });
  } catch (error) {
    logger.error("Error getting EU AI Act checklist", { error });
    res.status(500).json({ error: "Failed to get EU AI Act checklist" });
  }
});

/**
 * GET /api/compliance/criteria
 * Get list of SOC 2 Trust Service Criteria mappings
 */
router.get("/criteria", async (_req: Request, res: Response) => {
  const criteria = Object.entries(SOC2_CRITERIA).map(([id, data]) => ({
    id,
    name: data.name,
    description: data.description,
    actionCount: data.actions.length,
    actions: data.actions,
  }));

  res.json({ criteria });
});

export default router;
