import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();

vi.mock("child_process", async () => {
  const actual = await vi.importActual<typeof import("child_process")>("child_process");
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

describe("execGh", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("passes arguments directly without shell parsing", async () => {
    execFileSyncMock.mockReturnValue("https://github.com/jarod-rosenthal/workermill/issues/123\n");
    const { execGh } = await import("../git-ops.js");

    const title = "[Review] Featcli first class wm: src/index.ts: accepts `--model <prov";
    const body = "review body";
    const result = execGh(["issue", "create", "--title", title, "--body-file", "-"], {
      cwd: "/tmp/workermill",
      input: body,
      timeout: 15_000,
    });

    expect(result).toBe("https://github.com/jarod-rosenthal/workermill/issues/123");
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "gh",
      ["issue", "create", "--title", title, "--body-file", "-"],
      expect.objectContaining({
        cwd: "/tmp/workermill",
        input: body,
        timeout: 15_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });
});
