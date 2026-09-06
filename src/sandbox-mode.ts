import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

export type SandboxSetting = boolean | "os";

export interface SandboxResolution {
  requested: SandboxSetting;
  effective: SandboxSetting;
  warning?: string;
}

export interface OSSandboxDependencyStatus {
  supported: boolean;
  errors: string[];
  warnings: string[];
}

/** An explicit OS sandbox request cannot be silently weakened to path mode. */
export class OSSandboxUnavailableError extends Error {
  readonly code = "os_sandbox_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "OSSandboxUnavailableError";
  }
}

export function getOSSandboxDependencyStatus(): OSSandboxDependencyStatus {
  if (!SandboxManager.isSupportedPlatform()) {
    return {
      supported: false,
      errors: ["Unsupported platform (OS sandbox requires macOS or Linux/WSL2)"],
      warnings: [],
    };
  }
  try {
    const deps = SandboxManager.checkDependencies();
    return { supported: true, errors: deps.errors ?? [], warnings: deps.warnings ?? [] };
  } catch (err) {
    return {
      supported: true,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

function unavailableMessage(status: OSSandboxDependencyStatus): string {
  return `OS sandbox requested but unavailable: ${status.errors.join(", ")}. Install the required runtime dependencies or select sandbox: true for path-only restrictions.`;
}

/** Resolve a user-selected mode. An explicit `"os"` request fails closed. */
export function resolveSandboxMode(
  requestedInput: SandboxSetting | undefined,
  fullDisk = false,
): SandboxResolution {
  if (fullDisk) return { requested: false, effective: false };
  const requested = requestedInput ?? true;
  if (requested !== "os") return { requested, effective: requested };

  const status = getOSSandboxDependencyStatus();
  if (!status.supported || status.errors.length > 0) {
    throw new OSSandboxUnavailableError(unavailableMessage(status));
  }
  return {
    requested,
    effective: "os",
    warning: status.warnings.length > 0
      ? `OS sandbox enabled with warnings: ${status.warnings.join(", ")}`
      : undefined,
  };
}

/**
 * `/build` may opportunistically upgrade its default path mode. This is the
 * only fallback policy: callers must surface the returned warning to users.
 */
export function resolveAutomaticSandboxUpgrade(): SandboxResolution {
  const status = getOSSandboxDependencyStatus();
  if (!status.supported || status.errors.length > 0) {
    return {
      requested: "os",
      effective: true,
      warning: `OS sandbox automatic upgrade unavailable (${status.errors.join(", ")}); continuing with path-only restrictions.`,
    };
  }
  return {
    requested: "os",
    effective: "os",
    warning: status.warnings.length > 0
      ? `OS sandbox enabled with warnings: ${status.warnings.join(", ")}`
      : undefined,
  };
}
