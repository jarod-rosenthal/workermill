/**
 * Execution Mode Gate
 *
 * Determines whether a task should execute via local workers (user's machine),
 * BYOK (cloud workers with user's API key), or cloud (WorkerMill's resources).
 *
 * Called when a user starts execution from the build page.
 */

import { AppDataSource } from "../db/connection.js";
import { WorkerCheckIn } from "../models/WorkerCheckIn.js";
import type { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";

export type ExecutionMode = "local" | "byok" | "cloud" | "prompt";

export interface ExecutionModeResult {
  mode: ExecutionMode;
  reason: string;
}

const WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Check if an org has active local workers by looking at recent heartbeats.
 */
async function hasActiveLocalWorkers(orgId: string): Promise<boolean> {
  const checkInRepo = AppDataSource.getRepository(WorkerCheckIn);
  const cutoff = new Date(Date.now() - WORKER_HEARTBEAT_STALE_MS);

  const activeCount = await checkInRepo
    .createQueryBuilder("ci")
    .where("ci.org_id = :orgId", { orgId })
    .andWhere("ci.heartbeat_at > :cutoff", { cutoff })
    .andWhere("ci.status IN (:...statuses)", { statuses: ["idle", "running"] })
    .getCount();

  return activeCount > 0;
}

/**
 * Check if an org has an active subscription or credit balance for cloud execution.
 */
function hasCloudCredits(org: Organization): boolean {
  const activeStatuses = ["active", "trialing"];
  if (org.stripeSubscriptionStatus && activeStatuses.includes(org.stripeSubscriptionStatus)) {
    return true;
  }
  if (org.creditBalanceCents > 0) {
    return true;
  }
  return false;
}

/**
 * Check if an org has a BYOK API key configured for their primary provider.
 */
function hasByokApiKey(org: Organization): boolean {
  const settings = org.providerSettings ?? {};
  const provider = org.primaryProvider || "anthropic";

  // Check provider-specific API key in providerSettings
  const providerConfig = settings[provider] as Record<string, unknown> | undefined;
  if (providerConfig?.apiKey) return true;

  // Check legacy anthropic key field
  if (provider === "anthropic" && org.providerSettings?.anthropicApiKey) return true;

  return false;
}

/**
 * Resolve execution mode for a task based on org configuration and user choice.
 *
 * Priority:
 * 1. Explicit user choice (if valid for this org)
 * 2. Active local workers → "local"
 * 3. BYOK API key configured → "byok"
 * 4. Fallback → "cloud"
 */
export async function resolveExecutionMode(
  org: Organization,
  userChoice?: string,
): Promise<ExecutionModeResult> {
  // If user explicitly chose a mode, validate it
  if (userChoice === "local") {
    const hasWorkers = await hasActiveLocalWorkers(org.id);
    if (hasWorkers) {
      return { mode: "local", reason: "User selected local mode with active workers" };
    }
    logger.warn("User selected local mode but no active workers found", { orgId: org.id });
    return {
      mode: "local",
      reason: "User selected local mode — task will queue until workers connect",
    };
  }

  if (userChoice === "byok") {
    if (hasByokApiKey(org)) {
      return { mode: "byok", reason: "User selected BYOK with API key configured" };
    }
    return { mode: "byok", reason: "User selected BYOK — requires API key in Settings" };
  }

  if (userChoice === "cloud") {
    if (hasCloudCredits(org)) {
      return { mode: "cloud", reason: "User selected cloud execution" };
    }
    return { mode: "cloud", reason: "User selected cloud — requires subscription or credits" };
  }

  // Auto-detect: check for active local workers first
  const hasWorkers = await hasActiveLocalWorkers(org.id);
  if (hasWorkers) {
    return { mode: "local", reason: "Active local workers detected" };
  }

  // Check for BYOK key
  if (hasByokApiKey(org)) {
    return { mode: "byok", reason: "BYOK API key configured, no local workers" };
  }

  // Check for cloud credits/subscription
  if (hasCloudCredits(org)) {
    return { mode: "cloud", reason: "Active subscription or credits available" };
  }

  // No viable mode detected — prompt user to choose
  return { mode: "prompt", reason: "No local workers, BYOK key, or cloud credits — user must choose" };
}
