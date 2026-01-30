import { EventEmitter } from "events";

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
    this.emit(`cost:${event.orgId}`, event);
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
