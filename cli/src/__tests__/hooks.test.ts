import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../logger.js", () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import * as logger from "../logger.js";
import { runHooks } from "../hooks.js";
import type { HooksConfig } from "../config.js";

const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockLoggerError = logger.error as ReturnType<typeof vi.fn>;

describe("runHooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns immediately when hooks is undefined", () => {
    runHooks("pre", "bash", undefined, "/some/dir");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("returns immediately when phase has no hooks (post phase not defined)", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo pre" }],
    };
    runHooks("post", "bash", hooks, "/some/dir");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("returns immediately when phase has no hooks (pre phase not defined)", () => {
    const hooks: HooksConfig = {
      post: [{ command: "echo post" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("runs matching hook command for a tool", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo hello", tools: ["bash"] }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledOnce();
    expect(mockExecSync).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({ cwd: "/some/dir" }),
    );
  });

  it("skips hooks when tool does not match the hook's tools array", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo restricted", tools: ["write_file"] }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("runs hooks with wildcard '*' tool match", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo wildcard", tools: ["*"] }],
    };
    runHooks("pre", "any_tool", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledOnce();
    expect(mockExecSync).toHaveBeenCalledWith(
      "echo wildcard",
      expect.objectContaining({ cwd: "/some/dir" }),
    );
  });

  it("runs hooks with empty tools array (matches all tools)", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo all tools", tools: [] }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledOnce();
  });

  it("runs hooks with no tools property (matches all tools)", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo no tools filter" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledOnce();
  });

  it("sets WORKERMILL_TOOL and WORKERMILL_PHASE env vars", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo env check" }],
    };
    runHooks("pre", "write_file", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledWith(
      "echo env check",
      expect.objectContaining({
        env: expect.objectContaining({
          WORKERMILL_TOOL: "write_file",
          WORKERMILL_PHASE: "pre",
        }),
      }),
    );
  });

  it("sets WORKERMILL_PHASE to 'post' for post hooks", () => {
    const hooks: HooksConfig = {
      post: [{ command: "echo post env" }],
    };
    runHooks("post", "bash", hooks, "/workspace");
    expect(mockExecSync).toHaveBeenCalledWith(
      "echo post env",
      expect.objectContaining({
        env: expect.objectContaining({
          WORKERMILL_TOOL: "bash",
          WORKERMILL_PHASE: "post",
        }),
      }),
    );
  });

  it("logs error when hook command fails (execSync throws)", () => {
    const error = new Error("command not found: bad-cmd");
    mockExecSync.mockImplementationOnce(() => {
      throw error;
    });
    const hooks: HooksConfig = {
      pre: [{ command: "bad-cmd" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("Hook failed (pre bash)"),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("command not found: bad-cmd"),
    );
  });

  it("continues running subsequent hooks after one fails", () => {
    const error = new Error("first hook failed");
    mockExecSync
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementationOnce(() => "ok");

    const hooks: HooksConfig = {
      pre: [{ command: "bad-cmd" }, { command: "good-cmd" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it("uses correct cwd from workingDir parameter", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo cwd check" }],
    };
    runHooks("pre", "bash", hooks, "/project/workspace");
    expect(mockExecSync).toHaveBeenCalledWith(
      "echo cwd check",
      expect.objectContaining({ cwd: "/project/workspace" }),
    );
  });

  it("passes correct execSync options (encoding, stdio, timeout)", () => {
    const hooks: HooksConfig = {
      pre: [{ command: "echo options" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockExecSync).toHaveBeenCalledWith("echo options", {
      cwd: "/some/dir",
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
      env: expect.objectContaining({
        WORKERMILL_TOOL: "bash",
        WORKERMILL_PHASE: "pre",
      }),
    });
  });

  it("logs error string message when non-Error is thrown", () => {
    mockExecSync.mockImplementationOnce(() => {
      throw "string error";
    });
    const hooks: HooksConfig = {
      pre: [{ command: "throw-string" }],
    };
    runHooks("pre", "bash", hooks, "/some/dir");
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining("string error"),
    );
  });
});
