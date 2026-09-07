import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { stopProcessGroup } from "../browser/process-group.js";

const child = { pid: 12345 } as ChildProcess;
const denied = () => Object.assign(new Error("kill EPERM"), { code: "EPERM" });

describe("browser process ownership", () => {
  it("finishes a zombie-only group only after independently confirming no live members", async () => {
    let killed = false;
    const kill = vi.fn((_pid: number, signal?: string | number) => {
      if (signal === "SIGKILL") killed = true;
      if (killed && signal === 0) throw denied();
      return true;
    });
    const inspect = vi.fn(async () => killed ? [] : [12346]);
    await expect(stopProcessGroup(child, kill, 0, inspect)).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
    expect(inspect).toHaveBeenCalledWith(12345);
  });

  it.each([null, [12346]])("rejects EPERM when live membership is unknown or nonempty: %j", async (members) => {
    const kill = vi.fn(() => { throw denied(); });
    await expect(stopProcessGroup(child, kill, 0, async () => members)).rejects.toThrow("EPERM");
  });

  it("accepts EPERM signals only for a confirmed empty live group", async () => {
    await expect(stopProcessGroup(child, () => { throw denied(); }, 0, async () => [])).resolves.toBeUndefined();
  });

  it("reports surviving descendants after the kill deadline", async () => {
    const kill = vi.fn(() => true);
    await expect(stopProcessGroup(child, kill, 0, async () => [12346])).rejects.toThrow("did not exit");
    expect(kill).toHaveBeenCalledWith(12346, "SIGKILL");
  });
});
