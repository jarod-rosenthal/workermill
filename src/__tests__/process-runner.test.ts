import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cancelAndWaitForRunProcesses, cancelRunProcesses, runProcess } from "../engine/process-runner.js";

const request = (overrides: Partial<Parameters<typeof runProcess>[0]> = {}) => ({
  runId: "test-run",
  command: "printf ok",
  cwd: process.cwd(),
  signal: new AbortController().signal,
  timeoutMs: 2_000,
  maxOutputBytes: 10_000,
  terminationGraceMs: 100,
  ...overrides,
});

describe("process runner", () => {
  it("awaits owned process cleanup without cancelling another run", async () => {
    const controller = new AbortController();
    const owned = runProcess(request({ runId: "awaited-owner", command: "sleep 30", signal: controller.signal }));
    const other = runProcess(request({ runId: "unrelated-owner", command: "sleep 0.1; printf alive" }));
    controller.abort();
    await Promise.all([
      cancelAndWaitForRunProcesses("awaited-owner"),
      cancelAndWaitForRunProcesses("awaited-owner"),
    ]);
    await expect(owned).resolves.toMatchObject({ reason: "cancelled" });
    await expect(other).resolves.toMatchObject({ reason: "exited", exitCode: 0, stdout: "alive" });
    await expect(cancelAndWaitForRunProcesses("awaited-owner")).resolves.toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])("rejects invalid timeout %s before spawning", async (timeoutMs) => {
    const result = await runProcess(request({ timeoutMs, command: "printf should-not-run" }));
    expect(result.reason).toBe("spawn_failed");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Process limits");
  });

  it("does not block the event loop while a child is running", async () => {
    let heartbeats = 0;
    const heartbeat = setInterval(() => heartbeats++, 10);
    const result = await runProcess(request({ command: "sleep 0.15" }));
    clearInterval(heartbeat);

    expect(result.reason).toBe("exited");
    expect(heartbeats).toBeGreaterThan(3);
  });

  it("cancels an active process promptly", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const running = runProcess(request({ command: "sleep 30", signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);

    const result = await running;
    expect(result.reason).toBe("cancelled");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("kills a TERM-ignoring process group after the grace period", async () => {
    const result = await runProcess(request({
      command: "trap '' TERM; (trap '' TERM; sleep 30) & wait",
      timeoutMs: 100,
      terminationGraceMs: 100,
    }));

    expect(result.reason).toBe("timed_out");
    expect(result.exitCode).not.toBe(0);
  });

  it("cleans a background descendant when the shell exits before inherited pipes close", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "wm-r02-descendant-"));
    const pidFile = path.join(fixture, "child.pid");
    try {
      const result = await runProcess(request({
        command: `sleep 30 & printf '%s' "$!" > ${pidFile}; printf parent`,
        timeoutMs: 2_000,
        terminationGraceMs: 100,
      }));
      const childPid = Number(fs.readFileSync(pidFile, "utf8"));

      expect(result.reason).toBe("cancelled");
      expect(result.stdout).toContain("parent");
      expect(Number.isInteger(childPid)).toBe(true);
      let childRunning = true;
      try {
        const stat = execFileSync("ps", ["-o", "stat=", "-p", String(childPid)], { encoding: "utf8" }).trim();
        childRunning = stat.length > 0 && !stat.startsWith("Z");
      } catch (error) {
        // ps exits 1 when the PID no longer exists. Other failures must not
        // masquerade as successful cleanup (including on hosts without /proc).
        if (!(error && typeof error === "object" && "status" in error && error.status === 1)) throw error;
        childRunning = false;
      }
      expect(childRunning).toBe(false);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("reports spawn failures distinctly", async () => {
    const result = await runProcess(request({ cwd: "/definitely/not-a-real-directory" }));

    expect(result.reason).toBe("spawn_failed");
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });

  it("bounds combined stdout and stderr output", async () => {
    const result = await runProcess(request({
      command: "printf '%10000s' x",
      maxOutputBytes: 100,
    }));

    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBe(100);
    expect(result.outputTruncated).toBe(true);
  });

  it("keeps concurrent run output and cancellation separate", async () => {
    const first = runProcess(request({
      runId: "first",
      command: "sleep 30; printf first",
    }));
    const second = runProcess(request({
      runId: "second",
      command: "sleep 0.1; printf second",
    }));

    setTimeout(() => cancelRunProcesses("first"), 50);
    const [cancelled, completed] = await Promise.all([first, second]);

    expect(cancelled.reason).toBe("cancelled");
    expect(completed.reason).toBe("exited");
    expect(completed.stdout).toBe("second");
  });
});
