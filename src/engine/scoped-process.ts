import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { getStateRoot } from "../state-root.js";
import { getOSSandboxDependencyStatus } from "../sandbox-mode.js";
import type { SandboxCapabilities } from "../config.js";
import { createPathScope, type PathGrant, type PathScope } from "./path-policy.js";
import { runProcess, type ProcessRequest, type ProcessResult } from "./process-runner.js";

export type { SandboxCapabilities } from "../config.js";

export interface ScopedProcessOptions {
  sandbox: boolean | "os";
  scope: PathScope;
  capabilities?: SandboxCapabilities;
}

export interface ScopedProcessDependencies {
  runProcess: (request: ProcessRequest) => Promise<ProcessResult>;
  sandboxManager: Pick<typeof SandboxManager,
    "initialize" | "wrapWithSandbox" | "cleanupAfterCommand" | "reset">;
  platform: NodeJS.Platform;
}

const DEFAULT_NETWORK_DOMAINS = [
  "pypi.org", "files.pythonhosted.org", "registry.npmjs.org", "registry.yarnpkg.com",
  "github.com", "api.github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
];

const defaultDependencies: ScopedProcessDependencies = {
  runProcess,
  sandboxManager: SandboxManager,
  platform: process.platform,
};

function failed(stderr: string): ProcessResult {
  return { reason: "spawn_failed", exitCode: null, stdout: "", stderr, outputTruncated: false };
}

function cancelled(): ProcessResult {
  return { reason: "cancelled", exitCode: null, stdout: "", stderr: "", outputTruncated: false };
}

/** A FIFO lease for the singleton sandbox manager, cancellable while waiting. */
class SandboxLease {
  private tail = Promise.resolve();

  acquire(signal: AbortSignal): Promise<() => void> {
    let releaseTurn!: () => void;
    const turn = new Promise<void>((resolve) => { releaseTurn = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => turn);

    return new Promise((resolve, reject) => {
      let settled = false;
      const cancel = (): void => {
        if (settled) return;
        settled = true;
        void previous.then(releaseTurn);
        reject(new Error("OS sandbox command cancelled while waiting for the sandbox lease"));
      };
      if (signal.aborted) { cancel(); return; }
      const onAbort = (): void => cancel();
      signal.addEventListener("abort", onAbort, { once: true });
      previous.then(() => {
        signal.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        let released = false;
        resolve(() => {
          if (!released) { released = true; releaseTurn(); }
        });
      });
    });
  }
}

const sandboxLease = new SandboxLease();

function writableGrants(scope: PathScope, capabilities: SandboxCapabilities | undefined): string[] {
  const grants = [...scope.extraGrants, ...(capabilities?.extraPathGrants ?? [])];
  return grants.filter((grant) => grant.access === "read_write").map((grant) => grant.root);
}

function runtimeConfig(
  scope: PathScope,
  capabilities: SandboxCapabilities | undefined,
  tempDir: string,
  platform: NodeJS.Platform,
): SandboxRuntimeConfig {
  if (capabilities?.allowDockerSocket && platform !== "darwin") {
    throw new Error("Docker socket capability is unsupported on this OS sandbox platform: Linux cannot enforce a path-specific Unix socket allowlist. Do not run Docker through this sandbox.");
  }
  const stateRoot = getStateRoot();
  return {
    network: {
      allowedDomains: [...(capabilities?.allowedNetworkDomains ?? DEFAULT_NETWORK_DOMAINS)],
      deniedDomains: [],
      allowLocalBinding: capabilities?.allowLocalBinding ?? false,
      ...(capabilities?.allowDockerSocket ? { allowUnixSockets: ["/var/run/docker.sock"] } : {}),
    },
    filesystem: {
      // Reads are runtime-default allow except for these sensitive locations.
      // This intentionally does not claim that every host read is confined.
      denyRead: [path.join(os.homedir(), ".ssh"), stateRoot],
      allowWrite: [scope.workspace, ...writableGrants(scope, capabilities), tempDir],
      denyWrite: [],
    },
  };
}

/**
 * Runs a process through the selected boundary. OS setup/wrapping failures
 * never delegate the original command to the raw process runner.
 */
export async function runScopedProcess(
  request: ProcessRequest,
  options: ScopedProcessOptions,
): Promise<ProcessResult> {
  return createScopedProcessRunner()(request, options);
}

/** Exported for deterministic adapter tests; production callers use runScopedProcess. */
export function createScopedProcessRunner(
  dependencies: ScopedProcessDependencies = defaultDependencies,
): (request: ProcessRequest, options: ScopedProcessOptions) => Promise<ProcessResult> {
  return async (request, options) => {
    if (options.sandbox !== "os") return dependencies.runProcess(request);
    if (request.signal.aborted) return cancelled();

    const status = getOSSandboxDependencyStatus();
    if (!status.supported || status.errors.length > 0) {
      return failed(`OS sandbox unavailable: ${status.errors.join(", ")}`);
    }

    let release: (() => void) | undefined;
    let tempDir: string | undefined;
    try {
      try {
        release = await sandboxLease.acquire(request.signal);
      } catch {
        return cancelled();
      }
      if (request.signal.aborted) return cancelled();

      // Canonicalize every explicit capability root before it reaches runtime.
      const scope = createPathScope(options.scope.workspace, [
        ...options.scope.extraGrants,
        ...(options.capabilities?.extraPathGrants ?? []),
      ]);
      tempDir = await mkdtemp(path.join(os.tmpdir(), "workermill-sandbox-"));
      if (request.signal.aborted) return cancelled();
      await dependencies.sandboxManager.initialize(runtimeConfig(scope, options.capabilities, tempDir, dependencies.platform));
      if (request.signal.aborted) return cancelled();
      const command = await dependencies.sandboxManager.wrapWithSandbox(request.command, undefined, undefined, request.signal);
      if (request.signal.aborted) return cancelled();
      return await dependencies.runProcess({
        ...request,
        env: { ...request.env, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir },
        command,
      });
    } catch (error) {
      return failed(`OS sandbox setup failed; command was not executed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (release) {
        try { dependencies.sandboxManager.cleanupAfterCommand(); } catch { /* best effort */ }
        try { await dependencies.sandboxManager.reset(); } catch { /* retained lease prevents concurrent reset */ }
        try {
          if (tempDir) await rm(tempDir, { recursive: true, force: true });
        } finally {
          release();
        }
      }
    }
  };
}

export { DEFAULT_NETWORK_DOMAINS };
