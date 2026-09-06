import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { runGate, runGateCommand } from "../gate-runner.js";

describe("runGate", () => {
  it("runs all commands in a gate sequentially", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-"));
    try {
      const markerFile = path.join(cwd, "marker.txt");
      const result = await runGate({
        name: "multi-step",
        commands: [
          "printf 'first' > marker.txt",
          "test -f marker.txt",
        ],
      }, cwd);

      expect(result.passed).toBe(true);
      expect(result.status).toBe("passed");
      expect(fs.readFileSync(markerFile, "utf8")).toBe("first");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("fails when a command exits nonzero despite passing prose and skips later commands", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-failure-"));
    try {
      const result = await runGate({
        name: "failure",
        commands: [
          "printf '10 passed'; exit 7",
          "touch should-not-run",
        ],
      }, cwd);

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.output).toContain("10 passed");
      expect(fs.existsSync(path.join(cwd, "should-not-run"))).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reports timeout and cancellation as typed command failures", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-lifecycle-"));
    try {
      await expect(runGateCommand("sleep 30", cwd, 50, { terminationGraceMs: 20 }))
        .rejects.toMatchObject({ reason: "timed_out", code: null });

      const controller = new AbortController();
      const running = runGateCommand("sleep 30", cwd, 5_000, {
        signal: controller.signal,
        terminationGraceMs: 20,
      });
      controller.abort();
      await expect(running).rejects.toMatchObject({ reason: "cancelled" });
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("does not start later commands after cancellation", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-cancel-order-"));
    try {
      const controller = new AbortController();
      const started = path.join(cwd, "started");
      const result = await runGate({
        name: "cancelled",
        commands: [
          "first command",
          "touch should-not-run",
        ],
      }, cwd, { signal: controller.signal, runProcess: async (request) => {
        // This deterministic runner models a command that has started and then
        // cancels the run before the next configured command can launch.
        fs.writeFileSync(started, "started");
        controller.abort();
        return { reason: "cancelled", exitCode: null, stdout: "", stderr: "", outputTruncated: false };
      } });

      expect(result).toMatchObject({ passed: false, status: "cancelled" });
      expect(fs.existsSync(started)).toBe(true);
      expect(fs.existsSync(path.join(cwd, "should-not-run"))).toBe(false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("treats a forced watch-mode termination as failure", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wm-gate-watch-"));
    try {
      const started = Date.now();
      await expect(runGateCommand(
        "printf 'waiting for file changes'; while :; do sleep 1; done",
        cwd,
        10_000,
        { terminationGraceMs: 20 },
      )).rejects.toMatchObject({ reason: "watch_killed" });
      expect(Date.now() - started).toBeLessThan(8_000);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
