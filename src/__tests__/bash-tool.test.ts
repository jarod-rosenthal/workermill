import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    isSupportedPlatform: vi.fn(() => true),
    checkDependencies: vi.fn(() => ({ errors: [], warnings: [] })),
    initialize: vi.fn(async () => {}),
    wrapWithSandbox: vi.fn(async (command: string) => `wrapped:${command}`),
    cleanupAfterCommand: vi.fn(),
    annotateStderrWithSandboxFailures: vi.fn((_command: string, stderr: string) => stderr),
    reset: vi.fn(async () => {}),
  },
}));

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { commandUsesDocker, execute, killActiveProcess } from "../engine/tools/bash.js";
import { createToolDefinitions } from "../engine/tools/index.js";

describe("bash tool scoped sandbox handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(SandboxManager.isSupportedPlatform).mockReturnValue(true);
    vi.mocked(SandboxManager.checkDependencies).mockReturnValue({ errors: [], warnings: [] });
    vi.mocked(SandboxManager.wrapWithSandbox).mockImplementation(async (command: string) => command);
  });

  it("detects docker commands across common forms", () => {
    expect(commandUsesDocker("docker compose up -d")).toBe(true);
    expect(commandUsesDocker("DATABASE_URL=test docker run --rm postgres:16")).toBe(true);
    expect(commandUsesDocker("docker-compose up -d")).toBe(true);
    expect(commandUsesDocker("npm test")).toBe(false);
    expect(commandUsesDocker("echo docker compose up -d")).toBe(false);
  });

  it("does not let docker commands bypass explicit OS sandbox wrapping", async () => {
    const result = await execute({
      command: "docker || true",
      osSandbox: true,
      cwd: process.cwd(),
      timeout: 5_000,
    });

    expect(vi.mocked(SandboxManager.wrapWithSandbox)).toHaveBeenCalledWith("docker || true", undefined, undefined, expect.any(AbortSignal));
    expect(result.success).toBe(true);
  });

  it("still wraps non-docker commands in OS sandbox mode", async () => {
    const result = await execute({
      command: "printf ok",
      osSandbox: true,
      cwd: process.cwd(),
      timeout: 5_000,
    });

    expect(vi.mocked(SandboxManager.wrapWithSandbox)).toHaveBeenCalledWith("printf ok", undefined, undefined, expect.any(AbortSignal));
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("ok");
  });

  it("passes scoped cancellation to the asynchronous process runner", async () => {
    const controller = new AbortController();
    const running = execute({
      command: "sleep 30",
      cwd: process.cwd(),
      timeout: 5_000,
      signal: controller.signal,
      runId: "bash-scoped-test",
    });
    setTimeout(() => controller.abort(), 25);

    const result = await running;
    expect(result.success).toBe(false);
    expect(result.error).toBe("Command cancelled");
  });

  it("keeps legacy cancellation isolated from scoped bash calls", async () => {
    const legacy = execute({ command: "sleep 30", timeout: 5_000 });
    const scoped = execute({ command: "sleep 0.1; printf scoped", timeout: 5_000, runId: "scoped-test" });
    setTimeout(() => killActiveProcess(), 25);

    const [legacyResult, scopedResult] = await Promise.all([legacy, scoped]);
    expect(legacyResult.error).toBe("Command cancelled");
    expect(scopedResult.success).toBe(true);
    expect(scopedResult.stdout).toBe("scoped");
  });

  it("surfaces bounded-output truncation to the bash caller", async () => {
    const result = await execute({ command: "yes x | head -c 11000000", timeout: 5_000 });

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("[output truncated: command output exceeded 10 MiB]");
  });

  it("turns a scoped teardown failure into a direct bash failure", async () => {
    vi.mocked(SandboxManager.reset).mockRejectedValueOnce(new Error("sandbox reset failed"));
    const result = await execute({ command: "printf ok", osSandbox: true, cwd: process.cwd(), timeout: 5_000 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("sandbox cleanup failed");
  });

  it("turns a scoped teardown failure into a registered verify failure", async () => {
    vi.mocked(SandboxManager.reset).mockRejectedValueOnce(new Error("sandbox reset failed"));
    const tools = createToolDefinitions(process.cwd(), undefined, "os") as Record<string, { execute: (input: { command: string }) => Promise<string> }>;
    await expect(tools.verify.execute({ command: "printf ok" })).resolves.toContain("Failed to execute command");
  });
});
