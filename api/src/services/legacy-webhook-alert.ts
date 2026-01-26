import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/Organization.js";
import { AuditLog } from "../models/AuditLog.js";
import { logger } from "../utils/logger.js";
import { sendSlackNotification } from "./slack.js";

interface LegacyWebhookUsage {
  integrationType: "jira" | "linear" | "github" | "github-issues" | "email";
  orgId?: string;
  orgName?: string;
  sourceIp?: string;
  userAgent?: string;
}

// Track usage counts in memory (resets on restart)
const usageCounts: Record<string, { count: number; lastAlertAt: number }> = {};

// Alert throttle: don't send more than one alert per org/integration per hour
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Track and alert on legacy webhook endpoint usage
 *
 * Called when deprecated webhook endpoints (without org slug) are used.
 * Logs to audit trail, increments counters, and sends Slack alerts.
 */
export async function trackLegacyWebhookUsage(usage: LegacyWebhookUsage): Promise<void> {
  const { integrationType, orgId, orgName, sourceIp, userAgent } = usage;
  const key = `${orgId || "unknown"}:${integrationType}`;

  // Initialize counter if needed
  if (!usageCounts[key]) {
    usageCounts[key] = { count: 0, lastAlertAt: 0 };
  }
  usageCounts[key].count++;

  // Log warning with details
  logger.warn("Legacy webhook endpoint used", {
    integrationType,
    orgId,
    orgName,
    sourceIp,
    userAgent,
    usageCount: usageCounts[key].count,
    newEndpoint: orgId ? `/api/webhooks/{org-slug}/${integrationType}` : undefined,
  });

  // Create audit log entry if we have an org
  if (orgId) {
    try {
      const auditRepo = AppDataSource.getRepository(AuditLog);
      const auditLog = auditRepo.create({
        organizationId: orgId,
        action: "webhook_legacy_used",
        resourceType: "webhook",
        resourceId: integrationType,
        ipAddress: sourceIp || null,
        userAgent: userAgent || null,
        description: `Legacy /${integrationType} webhook endpoint used. Migrate to /api/webhooks/{slug}/${integrationType}`,
        changes: {
          metadata: {
            integrationType,
            usageCount: usageCounts[key].count,
          },
        },
      });
      await auditRepo.save(auditLog);
    } catch (err) {
      logger.error("Failed to create audit log for legacy webhook", { err });
    }
  }

  // Send Slack alert if configured (throttled)
  const now = Date.now();
  const shouldAlert = now - usageCounts[key].lastAlertAt > ALERT_THROTTLE_MS;

  if (shouldAlert && orgId) {
    usageCounts[key].lastAlertAt = now;

    try {
      const orgRepo = AppDataSource.getRepository(Organization);
      const org = await orgRepo.findOne({ where: { id: orgId } });

      if (org?.slackWebhookUrl) {
        const webhookBaseUrl = org.slug
          ? `https://workermill.com/api/webhooks/${org.slug}`
          : "https://workermill.com/api/webhooks/{your-slug}";

        await sendSlackNotification(org.slackWebhookUrl, {
          text: `:warning: *Deprecated Webhook Endpoint Used*`,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "Deprecated Webhook Endpoint Used",
                emoji: true,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `The legacy \`/api/webhooks/${integrationType}\` endpoint was called.\n\nThis endpoint lacks proper multi-tenant isolation and will be removed in a future release.`,
              },
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*Integration:*\n${integrationType.toUpperCase()}`,
                },
                {
                  type: "mrkdwn",
                  text: `*Times Used Today:*\n${usageCounts[key].count}`,
                },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Action Required:*\nUpdate your ${integrationType} webhook URL to:\n\`${webhookBaseUrl}/${integrationType}\``,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Settings → Integrations → ${integrationType.charAt(0).toUpperCase() + integrationType.slice(1)} for setup instructions`,
                },
              ],
            },
          ],
        });

        logger.info("Sent Slack alert for legacy webhook usage", {
          orgId,
          integrationType,
        });
      }
    } catch (err) {
      logger.error("Failed to send Slack alert for legacy webhook", { err });
    }
  }
}

/**
 * Get current legacy webhook usage stats for an org
 */
export function getLegacyWebhookStats(orgId: string): Record<string, number> {
  const stats: Record<string, number> = {};
  const integrationTypes = ["jira", "linear", "github", "github-issues", "email"];

  for (const type of integrationTypes) {
    const key = `${orgId}:${type}`;
    stats[type] = usageCounts[key]?.count || 0;
  }

  return stats;
}

/**
 * Reset legacy webhook usage counters (e.g., daily reset)
 */
export function resetLegacyWebhookStats(): void {
  for (const key of Object.keys(usageCounts)) {
    usageCounts[key].count = 0;
  }
  logger.info("Reset legacy webhook usage counters");
}
