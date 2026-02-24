import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { redis } from "./redis-client.js";

/**
 * Real-time code events for SSE streaming (Live Code Viewer).
 * In-memory only — never written to database. Follows the planning-progress-events.ts pattern.
 */

export interface CodeEvent {
  taskId: string;
  toolName: "Write" | "Edit";
  filePath: string;
  content?: string; // Full content (Write)
  oldStr?: string; // Edit old
  newStr?: string; // Edit new
  expert?: string; // Persona name
  timestamp: string;
}

class CodeEventEmitter extends EventEmitter {
  private static instance: CodeEventEmitter;
  private instanceId = randomUUID();

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  public initRedisSubscription(): void {
    redis.subscribeToChannel("events:code", (msg) => {
      if (msg._instanceId === this.instanceId) return; // Skip own messages
      const taskId = msg.taskId as string;
      if (taskId) {
        super.emit(`code:${taskId}`, msg);
      }
    });
  }

  public static getInstance(): CodeEventEmitter {
    if (!CodeEventEmitter.instance) {
      CodeEventEmitter.instance = new CodeEventEmitter();
    }
    return CodeEventEmitter.instance;
  }

  public emitCodeEvent(taskId: string, event: CodeEvent): void {
    this.emit(`code:${taskId}`, event);
    redis.publish("events:code", {
      ...(event as unknown as Record<string, unknown>),
      _instanceId: this.instanceId,
    });
  }

  public subscribeToCodeEvents(
    taskId: string,
    callback: (event: CodeEvent) => void,
  ): () => void {
    const eventName = `code:${taskId}`;
    this.on(eventName, callback);
    return () => {
      this.off(eventName, callback);
    };
  }
}

export const codeEventEmitter = CodeEventEmitter.getInstance();
