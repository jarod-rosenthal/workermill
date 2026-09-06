import { describe, expect, it } from "vitest";
import { fixture, validateFixture } from "../../evals/tasks/r20-bugfix-batch-config.mjs";
import { fixture as pagination, validateFixture as validatePagination } from "../../evals/tasks/r20-bugfix-pagination.mjs";
import { fixture as deepConfig, validateFixture as validateDeepConfig } from "../../evals/tasks/r20-bugfix-deep-config.mjs";
import { fixture as queueRecovery, validateFixture as validateQueueRecovery } from "../../evals/tasks/r20-bugfix-queue-recovery.mjs";
import { fixture as retryBackoff, validateFixture as validateRetryBackoff } from "../../evals/tasks/r20-bugfix-retry-backoff.mjs";

describe("R20a offline fixture", () => {
  it("distinguishes baseline, reference, and incomplete solutions", async () => {
    const result = await validateFixture();
    expect(result.baselineFails).toBe(true);
    expect(result.referencePasses).toBe(true);
    expect(result.incompleteFails).toBe(true);
    // Rejection must exercise the duplicate-key acceptance check, not fail
    // merely because a fixture has a syntax error or cannot start.
    expect(result.outcomes.baseline.code).toBe(3);
    expect(result.outcomes.incomplete.code).toBe(3);
    expect(result.initialRevision).toBe("sha256:355014f38206f2051f1cb2a88a4d4fd88f76114d985e2e6a5233d9515eb26c4f");
    expect(fixture.workspace.network).toBe(false);
    expect(fixture.workspace.writableFiles).toEqual(["src/config.mjs"]);
  });
});

describe("R20b offline bug-fix fixtures", () => {
  it("has five distinct bug-fix tasks with semantic incomplete failures", async () => {
    const fixtures = [fixture, pagination, deepConfig, queueRecovery, retryBackoff];
    expect(new Set(fixtures.map((item) => item.taskId)).size).toBe(5);
    expect(fixtures.every((item) => item.category === "bugfix" && item.workspace.network === false)).toBe(true);
    for (const item of fixtures) {
      expect(item.initialRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(item.workspace.toolchain).toContain("22.12");
    }
    const results = await Promise.all([validateFixture(), validatePagination(), validateDeepConfig(), validateQueueRecovery(), validateRetryBackoff()]);
    for (const result of results) {
      expect(result.baselineFails).toBe(true);
      expect(result.referencePasses).toBe(true);
      expect(result.incompleteFails).toBe(true);
      expect(result.outcomes.baseline.code).toBe(3);
      expect(result.outcomes.incomplete.code).toBe(3);
    }
  });
});
