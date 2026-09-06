import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    isSupportedPlatform: vi.fn(() => true),
    checkDependencies: vi.fn(() => ({ errors: [], warnings: [] })),
  },
}));

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import {
  getOSSandboxDependencyStatus,
  OSSandboxUnavailableError,
  resolveAutomaticSandboxUpgrade,
  resolveSandboxMode,
} from "../sandbox-mode.js";

describe("sandbox-mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SandboxManager.isSupportedPlatform).mockReturnValue(true);
    vi.mocked(SandboxManager.checkDependencies).mockReturnValue({ errors: [], warnings: [] });
  });

  it("defaults to path sandbox when unset", () => {
    const result = resolveSandboxMode(undefined, false);
    expect(result.effective).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("keeps full-disk mode when requested", () => {
    const result = resolveSandboxMode("os", true);
    expect(result.effective).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it("fails closed when an explicit os sandbox is unsupported", () => {
    vi.mocked(SandboxManager.isSupportedPlatform).mockReturnValue(false);
    expect(() => resolveSandboxMode("os", false)).toThrow(OSSandboxUnavailableError);
  });

  it("fails closed when explicit os sandbox dependencies are missing", () => {
    vi.mocked(SandboxManager.checkDependencies).mockReturnValue({
      errors: ["socat not installed"],
      warnings: [],
    });
    expect(() => resolveSandboxMode("os", false)).toThrow("socat not installed");
  });

  it("makes the automatic upgrade fallback explicit and visible", () => {
    vi.mocked(SandboxManager.checkDependencies).mockReturnValue({
      errors: ["socat not installed"],
      warnings: [],
    });
    const result = resolveAutomaticSandboxUpgrade();
    expect(result.effective).toBe(true);
    expect(result.warning).toContain("automatic upgrade unavailable");
  });

  it("returns warnings while keeping os sandbox when deps are available", () => {
    vi.mocked(SandboxManager.checkDependencies).mockReturnValue({
      errors: [],
      warnings: ["glob patterns are limited on linux"],
    });
    const result = resolveSandboxMode("os", false);
    expect(result.effective).toBe("os");
    expect(result.warning).toContain("warnings");
  });

  it("reports unsupported status cleanly", () => {
    vi.mocked(SandboxManager.isSupportedPlatform).mockReturnValue(false);
    const status = getOSSandboxDependencyStatus();
    expect(status.supported).toBe(false);
    expect(status.errors.length).toBeGreaterThan(0);
  });
});
