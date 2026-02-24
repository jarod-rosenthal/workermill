import { EventEmitter } from "events";
import { redis } from "./redis-client.js";

/**
 * Real-time cost update events for SSE streaming.
 * Enables immediate cost updates on the dashboard as workers report partial token usage.
 */

export interface CostUpdateEvent {
  taskId: string;
  orgId: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: string;
  perTaskCostCeilingUsd?: number | null;
  costCeilingPercent?: number;
}

/**
 * Singleton event emitter for broadcasting cost updates across endpoints.
 * - Workers POST to /api/tasks/:id/usage/partial
 * - This emitter broadcasts to SSE clients subscribed to the org
 */
class CostEventEmitter extends EventEmitter {
  private static instance: CostEventEmitter;

  private constructor() {
    super();
    // Increase max listeners for many concurrent SSE connections
    this.setMaxListeners(100);
  }

  /**
   * Initialize Redis subscription for cross-instance delivery.
   * Call once after Redis connects.
   */
  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:cost", (msg) => {
      const orgId = msg.orgId as string;
      if (orgId) {
        // Deliver to local SSE listeners without re-publishing to Redis
        super.emit(`cost:${orgId}`, msg);
      }
    });
  }

  public static getInstance(): CostEventEmitter {
    if (!CostEventEmitter.instance) {
      CostEventEmitter.instance = new CostEventEmitter();
    }
    return CostEventEmitter.instance;
  }

  /**
   * Emit a cost update event for a specific organization.
   * SSE handlers subscribe by orgId to receive updates for their org's tasks.
   */
  public emitCostUpdate(event: CostUpdateEvent): void {
    // Local delivery
    this.emit(`cost:${event.orgId}`, event);
    // Cross-instance delivery via Redis
    redis.publish("events:cost", event as unknown as Record<string, unknown>);
  }

  /**
   * Subscribe to cost updates for a specific organization.
   * Returns an unsubscribe function for cleanup.
   */
  public subscribeToCostUpdates(
    orgId: string,
    callback: (event: CostUpdateEvent) => void
  ): () => void {
    const eventName = `cost:${orgId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const costEvents = CostEventEmitter.getInstance();
