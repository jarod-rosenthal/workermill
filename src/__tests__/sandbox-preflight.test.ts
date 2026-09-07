import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@anthropic-ai/sandbox-runtime", () => ({ SandboxManager: {
  isSupportedPlatform: () => true,
  checkDependencies: () => ({ errors: [], warnings: [] }),
} }));
vi.mock("../engine/scoped-process.js", () => ({ runScopedProcess: vi.fn() }));
import { runScopedProcess } from "../engine/scoped-process.js";
import { assertOSSandboxReady, OSSandboxUnavailableError } from "../sandbox-mode.js";

describe("complete OS sandbox preflight", () => {
  beforeEach(() => { vi.mocked(runScopedProcess).mockReset(); });

  it("requires the harmless command to complete inside the actual scoped runner", async () => {
    vi.mocked(runScopedProcess).mockImplementation(async (request, options) => {
      expect(options.sandbox).toBe("os");
      expect(request.command).toBe(`printf '%s' '${request.runId}'`);
      expect(request.timeoutMs).toBeLessThanOrEqual(5000);
      return { reason: "exited", exitCode: 0, stdout: request.runId, stderr: "", outputTruncated: false };
    });
    await expect(assertOSSandboxReady(process.cwd())).resolves.toBeUndefined();
    expect(runScopedProcess).toHaveBeenCalledTimes(1);
  });

  it.each([
    { reason: "exited" as const, exitCode: 1, stderr: "apply-seccomp: write /proc/self/setgroups: Permission denied" },
    { reason: "timed_out" as const, exitCode: null, stderr: "" },
    { reason: "exited" as const, exitCode: 0, stderr: "" },
  ])("rejects incomplete startup: $reason / $exitCode / $stderr", async (result) => {
    vi.mocked(runScopedProcess).mockResolvedValue({ ...result, stdout: "", outputTruncated: false });
    await expect(assertOSSandboxReady(process.cwd())).rejects.toBeInstanceOf(OSSandboxUnavailableError);
    expect(runScopedProcess).toHaveBeenCalledTimes(1);
  });

  it("preserves cleanup failures instead of allowing automatic fallback", async () => {
    vi.mocked(runScopedProcess).mockRejectedValue(new Error("OS sandbox cleanup failed"));
    await expect(assertOSSandboxReady(process.cwd())).rejects.toThrow("cleanup failed");
  });

  it("does not launch a probe after cancellation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancel startup"));
    await expect(assertOSSandboxReady(process.cwd(), undefined, controller.signal)).rejects.toThrow("cancel startup");
    expect(runScopedProcess).not.toHaveBeenCalled();
  });
});
