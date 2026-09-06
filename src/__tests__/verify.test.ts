import { describe, expect, it } from "vitest";
import { execute } from "../engine/tools/verify.js";

describe("verify process adapter", () => {
  it("does not trust passing prose when the command exits nonzero", async () => {
    const result = await execute({ command: "printf '10 passed'; exit 3" });

    expect(result.passed).toBe(false);
    expect(result.passCount).toBe(10);
    expect(result.summary).toContain("exit code 3");
  });

  it("reports timeout as a failed verification", async () => {
    const result = await execute({ command: "sleep 30", timeout: 50, terminationGraceMs: 20 });

    expect(result.success).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("reports caller cancellation as a failed verification", async () => {
    const controller = new AbortController();
    const running = execute({ command: "sleep 30", signal: controller.signal, timeout: 5_000, terminationGraceMs: 20 });
    controller.abort();
    const result = await running;

    expect(result.success).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("cancelled");
  });

  it("reports spawn failures as failed verification", async () => {
    const result = await execute({ command: "printf should-not-run", cwd: "/definitely/not-a-real-directory" });

    expect(result.success).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("execute command");
  });
});
