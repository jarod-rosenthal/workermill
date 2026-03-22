import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { redis } from "./redis-client.js";

/**
 * Real-time decomposition progress events for SSE streaming.
 * In-memory only — never written to database. Follows the planning-progress-events.ts pattern.
 */

export type DecompositionPhase =
  | "resolving_content"
  | "calling_llm"
  | "streaming"
  | "parsing"
  | "creating_board"
  | "complete"
  | "error"
  // Spec validation gate phases
  | "validating_spec"
  | "spec_review"
  | "repairing_spec"
  | "repair_complete";

export interface DecompositionEvent {
  phase: DecompositionPhase;
  text?: string;
  detail?: string;
  charsGenerated?: number;
  boardId?: string;
  error?: string;
  // Spec validation gate fields
  warnings?: Array<{
    severity: "error" | "warning";
    category: string;
    message: string;
    suggestion: string;
    affectedPackages: string[];
  }>;
  fixedPrd?: string;
  diff?: string;
}

class DecompositionEventEmitter extends EventEmitter {
  private static instance: DecompositionEventEmitter;
  private instanceId = randomUUID();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:decomposition", (msg) => {
      if (msg._instanceId === this.instanceId) return; // Skip own messages
      const decompositionId = msg.decompositionId as string;
      if (decompositionId) {
        super.emit(`decomposition:${decompositionId}`, msg);
      }
    });
  }

  public static getInstance(): DecompositionEventEmitter {
    if (!DecompositionEventEmitter.instance) {
      DecompositionEventEmitter.instance = new DecompositionEventEmitter();
    }
    return DecompositionEventEmitter.instance;
  }

  public emitEvent(decompositionId: string, event: DecompositionEvent): void {
    this.emit(`decomposition:${decompositionId}`, event);
    redis.publish("events:decomposition", {
      decompositionId,
      ...(event as unknown as Record<string, unknown>),
      _instanceId: this.instanceId,
    });
  }

  public subscribeToEvents(
    decompositionId: string,
    callback: (event: DecompositionEvent) => void,
  ): () => void {
    const eventName = `decomposition:${decompositionId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const decompositionEmitter = DecompositionEventEmitter.getInstance();
