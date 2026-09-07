import { afterEach, describe, expect, it, vi } from "vitest";
import { runProcess } from "../engine/process-runner.js";
import { autoDetectMCPServersForRun } from "../mcp-client.js";

vi.mock("../engine/process-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine/process-runner.js")>();
  return { ...actual, runProcess: vi.fn(actual.runProcess) };
});

afterEach(() => vi.mocked(runProcess).mockReset());

describe("run-owned MCP discovery", () => {
  it("does not probe for an explicit Docker configuration or pre-aborted run", async () => {
    const controller = new AbortController();
    const context = { runId: "discovery-explicit", workspace: process.cwd(), signal: controller.signal };
    const config = { docker: { command: "custom-docker", args: [] } };
    expect(await autoDetectMCPServersForRun(config, context)).toBe(config);
    controller.abort(new Error("cancelled before discovery"));
    await expect(autoDetectMCPServersForRun({}, context)).rejects.toThrow("cancelled before discovery");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("preserves ownership and only accepts complete successful probe output", async () => {
    const controller = new AbortController();
    const result = { reason: "exited" as const, exitCode: 0, stdout: "enabled", stderr: "", outputTruncated: false };
    vi.mocked(runProcess)
      .mockResolvedValueOnce({ ...result, exitCode: 1 })
      .mockResolvedValueOnce({ ...result, outputTruncated: true })
      .mockResolvedValueOnce(result);
    const existing = { example: { command: "local-server" } };
    expect(await autoDetectMCPServersForRun(existing, {
      runId: "discovery", workspace: process.cwd(), signal: controller.signal,
    })).toEqual({ ...existing, docker: { command: "docker", args: ["mcp", "gateway", "run"] } });
    expect(runProcess).toHaveBeenCalledTimes(3);
    for (const [request] of vi.mocked(runProcess).mock.calls) {
      expect(request).toMatchObject({ runId: "discovery", cwd: process.cwd(), signal: controller.signal, timeoutMs: 5_000, maxOutputBytes: 65_536 });
    }
  });

  it("cancels a started real probe while the event loop stays responsive, without probing again", async () => {
    const actual = await vi.importActual<typeof import("../engine/process-runner.js")>("../engine/process-runner.js");
    const controller = new AbortController();
    let heartbeat = false;
    let started = false;
    // Substitute a dependency-free local executable, not the process lifecycle.
    vi.mocked(runProcess).mockImplementation((request) => actual.runProcess({
      ...request,
      command: `"${process.execPath}" -e 'process.stdout.write("ready"); setInterval(() => {}, 1000)'`,
      onOutput: () => {
        if (started) return;
        started = true;
        setTimeout(() => { heartbeat = true; controller.abort(new Error("cancelled active discovery")); }, 10);
      },
    }));
    await expect(autoDetectMCPServersForRun({}, {
      runId: "discovery-real", workspace: process.cwd(), signal: controller.signal,
    })).rejects.toThrow("cancelled active discovery");
    expect(started).toBe(true);
    expect(heartbeat).toBe(true);
    expect(runProcess).toHaveBeenCalledTimes(1);
  });
});
