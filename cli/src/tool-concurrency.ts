/**
 * Tool concurrency wrapper — allows concurrency-safe tools to run in parallel
 * when the model requests multiple tool calls in a single step.
 *
 * Uses a simple mutex for non-concurrent tools: they acquire a lock before
 * executing and release it after. Concurrent-safe tools skip the lock entirely.
 */

import { getToolMeta } from "../../packages/engine/src/tools/tool-metadata.js";

/** Simple async mutex for serializing non-concurrent tool calls */
class ToolMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const mutex = new ToolMutex();

/**
 * Wrap a tool's execute function with concurrency control.
 * Concurrency-safe tools run freely in parallel.
 * Non-safe tools acquire a mutex to run one at a time.
 */
export function withConcurrencyControl<TInput, TOutput>(
  toolName: string,
  execute: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  const meta = getToolMeta(toolName);

  if (meta.concurrencySafe) {
    // Safe to run in parallel — no wrapping needed
    return execute;
  }

  // Non-safe: serialize through mutex
  return async (input: TInput): Promise<TOutput> => {
    await mutex.acquire();
    try {
      return await execute(input);
    } finally {
      mutex.release();
    }
  };
}
