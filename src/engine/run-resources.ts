import { cancelAndWaitForRunProcesses } from "./process-runner.js";
import { cleanupScopedBackgroundProcesses } from "./tools/bash-background.js";
import { shutdownLSPRun } from "./tools/lsp.js";

export class ResourceCleanupError extends Error {
  constructor(readonly failures: unknown[]) {
    super(`Run resource cleanup failed: ${failures.map((error) => error instanceof Error ? error.message : String(error)).join("; ")}`);
    this.name = "ResourceCleanupError";
  }
}

/** Ownership only: adapters retain their own prompts, policy and outcomes. */
export function createAttemptResources(runId: string, abort: () => void, extraCleanup: Array<() => unknown | Promise<unknown>> = []) {
  const pending = new Set<Promise<unknown>>();
  let closing: Promise<void> | undefined;
  const drain = async (throwToolErrors: boolean): Promise<void> => {
    const failures: unknown[] = [];
    while (pending.size > 0) {
      const settled = await Promise.allSettled([...pending]);
      for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
    }
    if (throwToolErrors && failures.length > 0) throw failures[0];
  };
  return {
    track<T>(promise: Promise<T>): Promise<T> {
      pending.add(promise);
      const remove = () => { pending.delete(promise); };
      void promise.then(remove, remove);
      return promise;
    },
    settleTools: () => drain(true),
    close(): Promise<void> {
      if (!closing) closing = (async () => {
        abort();
        await drain(false);
        const cleanup = await Promise.allSettled([
          () => cancelAndWaitForRunProcesses(runId),
          () => cleanupScopedBackgroundProcesses(runId),
          () => shutdownLSPRun(runId),
          ...extraCleanup,
        ].map((close) => Promise.resolve().then(close)));
        const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failures.length > 0) throw new ResourceCleanupError(failures.map((result) => result.reason));
      })();
      return closing;
    },
  };
}

export type AttemptResources = ReturnType<typeof createAttemptResources>;
