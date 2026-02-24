import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { redis } from "./redis-client.js";

/**
 * Real-time planning progress events for SSE streaming.
 * In-memory only — never written to database. Follows the cost-events.ts pattern.
 */

export type PlanningPhase =
  | "initializing"
  | "reading_repo"
  | "analyzing"
  | "generating_plan"
  | "validating"
  | "complete";

export interface PlanningProgressEvent {
  phase: PlanningPhase;
  elapsedSeconds: number;
  detail: string;
  charsGenerated: number;
  toolCallCount: number;
}

class PlanningProgressEmitter extends EventEmitter {
  private static instance: PlanningProgressEmitter;
  private instanceId = randomUUID();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:planning", (msg) => {
      if (msg._instanceId === this.instanceId) return; // Skip own messages
      const taskId = msg.taskId as string;
      if (taskId) {
        super.emit(`planning:${taskId}`, msg);
      }
    });
  }

  public static getInstance(): PlanningProgressEmitter {
    if (!PlanningProgressEmitter.instance) {
      PlanningProgressEmitter.instance = new PlanningProgressEmitter();
    }
    return PlanningProgressEmitter.instance;
  }

  public emitProgress(taskId: string, event: PlanningProgressEvent): void {
    this.emit(`planning:${taskId}`, event);
    redis.publish("events:planning", {
      taskId,
      ...(event as unknown as Record<string, unknown>),
      _instanceId: this.instanceId,
    });
  }

  public subscribeToProgress(
    taskId: string,
    callback: (event: PlanningProgressEvent) => void,
  ): () => void {
    const eventName = `planning:${taskId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const planningProgressEmitter =
  PlanningProgressEmitter.getInstance();
