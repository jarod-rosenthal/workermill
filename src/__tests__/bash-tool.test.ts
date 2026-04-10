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
import { commandUsesDocker, execute } from "../engine/tools/bash.js";

describe("bash tool docker sandbox handling", () => {
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

  it("bypasses OS sandbox wrapping for docker commands", async () => {
    const result = await execute({
      command: "docker || true",
      osSandbox: true,
      cwd: process.cwd(),
      timeout: 5_000,
    });

    expect(vi.mocked(SandboxManager.wrapWithSandbox)).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("still wraps non-docker commands in OS sandbox mode", async () => {
    const result = await execute({
      command: "printf ok",
      osSandbox: true,
      cwd: process.cwd(),
      timeout: 5_000,
    });

    expect(vi.mocked(SandboxManager.wrapWithSandbox)).toHaveBeenCalledWith("printf ok");
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("ok");
  });
});
