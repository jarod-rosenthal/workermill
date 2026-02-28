/**
 * Local Event Bus for Standalone Mode
 *
 * In-process EventEmitter that replaces Redis pub/sub.
 * Uses the same wire format as the SSE multiplexer: { ch, t, p }
 *
 * When LocalBackend writes data (logs, coordination, code events),
 * it also emits here. The agent's SSE endpoints listen and forward
 * to connected VS Code clients.
 */

import { EventEmitter } from "events";
import type { StreamEvent } from "../types.js";

const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Emit a stream event to all listeners. */
export function emitStreamEvent(channel: string, type: string, payload: unknown): void {
  const event: StreamEvent = { ch: channel, t: type, p: payload };
  bus.emit("stream-event", event);
}

/** Subscribe to all stream events. */
export function onStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.on("stream-event", handler);
}

/** Unsubscribe from stream events. */
export function offStreamEvent(handler: (event: StreamEvent) => void): void {
  bus.off("stream-event", handler);
}

/** Get the underlying EventEmitter (for testing or direct access). */
export function getEventBus(): EventEmitter {
  return bus;
}
