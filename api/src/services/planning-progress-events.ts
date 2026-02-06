import { EventEmitter } from "events";

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

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public static getInstance(): PlanningProgressEmitter {
    if (!PlanningProgressEmitter.instance) {
      PlanningProgressEmitter.instance = new PlanningProgressEmitter();
    }
    return PlanningProgressEmitter.instance;
  }

  public emitProgress(taskId: string, event: PlanningProgressEvent): void {
    this.emit(`planning:${taskId}`, event);
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
