/**
 * Trial Reminder Service
 *
 * Checks Pro plan orgs approaching trial expiration and sends reminder emails.
 * Called hourly from the orchestrator poll loop.
 */

import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
import type { OrganizationPlan } from "../models/Organization.js";
import { IsNull, Not } from "typeorm";
import { logger } from "../utils/logger.js";
import { sendTrialReminderEmail } from "./email/trial-emails.js";

const REMINDER_THRESHOLDS = [
  { key: "7d", days: 7 },
  { key: "3d", days: 3 },
  { key: "1d", days: 1 },
  { key: "expired", days: 0 },
];

export async function checkTrialReminders(): Promise<void> {
  const orgRepo = AppDataSource.getRepository(Organization);

  // Find Pro orgs with trial that haven't fully converted (no active subscription)
  const orgs = await orgRepo.find({
    where: {
      plan: "pro" as OrganizationPlan,
      trialExpiresAt: Not(IsNull()),
      stripeSubscriptionStatus: IsNull(),
    },
  });

  for (const org of orgs) {
    if (!org.trialExpiresAt) continue;

    const now = new Date();
    const daysRemaining = Math.ceil(
      (org.trialExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const reminders = org.trialRemindersSent || {};

    for (const threshold of REMINDER_THRESHOLDS) {
      if (daysRemaining <= threshold.days && !reminders[threshold.key]) {
        try {
          await sendTrialReminderEmail(org, daysRemaining);
          reminders[threshold.key] = true;
          await orgRepo.update(org.id, {
            trialRemindersSent: reminders,
          });
          logger.info("Trial reminder sent", {
            orgId: org.id,
            reminder: threshold.key,
            daysRemaining,
          });
        } catch (error) {
          logger.error("Failed to send trial reminder", {
            orgId: org.id,
            reminder: threshold.key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break; // Only send one reminder per check
      }
    }
  }
}
