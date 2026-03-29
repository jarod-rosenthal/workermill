import crypto from "crypto";
import { AppDataSource } from "../../db/connection.js";
import { logger } from "../../utils/logger.js";

/**
 * Normalize repository string to include owner if missing
 * If repo doesn't contain "/", prepend the owner from defaultGithubRepo
 */
export function normalizeRepoWithOwner(
  repo: string | null,
  defaultGithubRepo: string | null
): string {
  if (!repo) {
    return defaultGithubRepo || "";
  }

  // If repo already has owner/repo format, return as-is
  if (repo.includes("/")) {
    return repo;
  }

  // Extract owner from defaultGithubRepo (format: "owner/repo")
  if (defaultGithubRepo && defaultGithubRepo.includes("/")) {
    const owner = defaultGithubRepo.split("/")[0];
    return `${owner}/${repo}`;
  }

  // Fallback: return repo as-is (will likely fail to clone, but that's expected)
  return repo;
}

/**
 * Check if a webhook delivery has already been processed (idempotency)
 * Returns true if this is a duplicate that should be skipped
 */
export async function isDuplicateWebhook(
  deliveryId: string,
  source:
    | "jira"
    | "github"
    | "linear"
    | "github-issues"
    | "email"
    | "gitlab"
    | "bitbucket",
  orgId?: string,
  eventType?: string
): Promise<boolean> {
  if (!deliveryId) {
    // No delivery ID means we can't check for duplicates - allow processing
    return false;
  }

  try {
    // Check if already processed
    const existing = await AppDataSource.query(
      `SELECT id FROM webhook_deliveries WHERE delivery_id = $1 AND source = $2 LIMIT 1`,
      [deliveryId, source]
    );

    if (existing.length > 0) {
      logger.info("Duplicate webhook detected, skipping", {
        deliveryId,
        source,
      });
      return true;
    }

    // Record this delivery (use INSERT ... ON CONFLICT for race condition safety)
    await AppDataSource.query(
      `INSERT INTO webhook_deliveries (delivery_id, source, org_id, event_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (delivery_id, source) DO NOTHING`,
      [deliveryId, source, orgId || null, eventType || null]
    );

    return false;
  } catch (error) {
    // Don't block webhook processing if idempotency check fails
    logger.warn("Failed to check webhook idempotency", {
      error,
      deliveryId,
      source,
    });
    return false;
  }
}

/**
 * Cleanup old webhook deliveries (run periodically)
 * Keeps deliveries for 24 hours to handle delayed retries
 */
export async function cleanupOldWebhookDeliveries(): Promise<number> {
  try {
    const result = await AppDataSource.query(
      `DELETE FROM webhook_deliveries WHERE created_at < NOW() - INTERVAL '24 hours' RETURNING id`
    );
    const count = result.length;
    if (count > 0) {
      logger.info("Cleaned up old webhook deliveries", { count });
    }
    return count;
  } catch (error) {
    logger.error("Failed to cleanup webhook deliveries", { error });
    return 0;
  }
}

/**
 * Verify Jira webhook signature
 * Jira sends signature in x-atlassian-webhook-signature header with sha256= prefix
 */
export function verifyJiraSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  // Jira webhook signature format: sha256=<hex_digest>
  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  // Handle both formats: with or without sha256= prefix for backwards compatibility
  const normalizedSignature = signature.startsWith("sha256=")
    ? signature
    : `sha256=${signature}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(normalizedSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Verify GitHub webhook signature
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Verify Linear webhook signature
 */
export function verifyLinearSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Verify email webhook signature from Lambda
 */
export function verifyEmailSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Extract labels from email subject
 * Format: [label1, label2] or [label1][label2]
 * Example: "[backend, deploy] Fix login bug" -> ["backend", "deploy"]
 */
export function extractLabelsFromSubject(subject: string): string[] {
  const labels: string[] = [];

  // Match [label1, label2, ...] format
  const bracketMatch = subject.match(/\[([^\]]{1,200})\]/g);
  if (bracketMatch) {
    for (const match of bracketMatch) {
      // Remove brackets and split by comma or space
      const content = match.slice(1, -1);
      const parts = content.split(/[,\s]+/).filter(Boolean);
      labels.push(...parts.map((p) => p.toLowerCase().trim()));
    }
  }

  return [...new Set(labels)]; // Dedupe
}

/**
 * Parse recipient email to determine action
 * Patterns:
 * - task@domain -> create_task
 * - task+{taskId}@domain -> reply_to_task (with taskId)
 * - backend@domain -> create_task with persona
 * - frontend@domain -> create_task with persona
 * - {anything}+{taskId}@domain -> reply_to_task
 */
export function parseRecipientAction(recipient: string): {
  action: "create_task" | "reply_to_task";
  persona?: string;
  taskId?: string;
} {
  const atIndex = recipient.indexOf("@");
  if (atIndex === -1) {
    return { action: "create_task" };
  }

  const localPart = recipient.substring(0, atIndex).toLowerCase();

  // Check for +taskId pattern (e.g., task+abc123@domain or backend+abc123@domain)
  const plusIndex = localPart.indexOf("+");
  if (plusIndex !== -1) {
    const taskId = localPart.substring(plusIndex + 1);
    const prefix = localPart.substring(0, plusIndex);

    // If taskId looks like a UUID, it's a reply
    if (taskId && taskId.length > 8) {
      return { action: "reply_to_task", taskId };
    }

    // Otherwise treat the part after + as a suffix hint
    return { action: "create_task", persona: prefix };
  }

  // Known persona addresses
  const personaMap: Record<string, string> = {
    backend: "backend_developer",
    frontend: "frontend_developer",
    devops: "devops_engineer",
    qa: "qa_engineer",
    security: "security_engineer",
    docs: "tech_writer",
    pm: "project_manager",
  };

  if (personaMap[localPart]) {
    return { action: "create_task", persona: personaMap[localPart] };
  }

  return { action: "create_task" };
}
