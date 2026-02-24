import { logger } from "../utils/logger.js";

/**
 * Per-org SSE connection limiter.
 * Tracks active connections per org and rejects new ones when limit exceeded.
 * Per-instance tracking is sufficient — ALB distributes connections across instances.
 */
const orgConnections = new Map<string, number>();

export function acquireSSESlot(orgId: string, limit: number): boolean {
  const current = orgConnections.get(orgId) || 0;
  if (current >= limit) {
    logger.warn("SSE connection limit reached", { orgId, current, limit });
    return false;
  }
  orgConnections.set(orgId, current + 1);
  return true;
}

export function releaseSSESlot(orgId: string): void {
  const current = orgConnections.get(orgId) || 0;
  if (current <= 1) {
    orgConnections.delete(orgId);
  } else {
    orgConnections.set(orgId, current - 1);
  }
}
