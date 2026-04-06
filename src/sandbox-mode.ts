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
    return {
      supported: true,
      errors: deps.errors ?? [],
      warnings: deps.warnings ?? [],
    };
  } catch (err) {
    return {
      supported: true,
      errors: [err instanceof Error ? err.message : String(err)],
      warnings: [],
    };
  }
}

export function resolveSandboxMode(
  requestedInput: SandboxSetting | undefined,
  fullDisk = false,
): SandboxResolution {
  if (fullDisk) return { requested: false, effective: false };

  const requested: SandboxSetting = requestedInput ?? true;
  if (requested !== "os") return { requested, effective: requested };

  const status = getOSSandboxDependencyStatus();
  if (!status.supported) {
    return {
      requested,
      effective: true,
      warning: "OS sandbox requested but unsupported on this platform. Falling back to path sandbox.",
    };
  }
  if (status.errors.length > 0) {
    return {
      requested,
      effective: true,
      warning: `OS sandbox requested but dependencies are missing (${status.errors.join(", ")}). Falling back to path sandbox.`,
    };
  }
  if (status.warnings.length > 0) {
    return {
      requested,
      effective: "os",
      warning: `OS sandbox enabled with warnings: ${status.warnings.join(", ")}`,
    };
  }

  return { requested, effective: "os" };
}

