import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { materialize, runNode } from "../../evals/tasks/r20-helper.mjs";
import { fixture, validateFixture } from "../../evals/tasks/r20-bugfix-batch-config.mjs";
import { fixture as pagination, validateFixture as validatePagination } from "../../evals/tasks/r20-bugfix-pagination.mjs";
import { fixture as deepConfig, validateFixture as validateDeepConfig } from "../../evals/tasks/r20-bugfix-deep-config.mjs";
import { fixture as queueRecovery, validateFixture as validateQueueRecovery } from "../../evals/tasks/r20-bugfix-queue-recovery.mjs";
import { fixture as retryBackoff, validateFixture as validateRetryBackoff } from "../../evals/tasks/r20-bugfix-retry-backoff.mjs";
import { fixture as releaseNotes, validateFixture as validateReleaseNotes } from "../../evals/tasks/r20-feature-release-notes-v1.mjs";
import { fixture as webhookRecovery, validateFixture as validateWebhookRecovery } from "../../evals/tasks/r20-feature-webhook-recovery-v1.mjs";
import { fixture as tagFilter, validateFixture as validateTagFilter } from "../../evals/tasks/r20-feature-tag-filter-v1.mjs";
import { fixture as expiringCache, validateFixture as validateExpiringCache } from "../../evals/tasks/r20-feature-expiring-cache-v1.mjs";
import { fixture as dailySummary, validateFixture as validateDailySummary } from "../../evals/tasks/r20-feature-daily-summary-v1.mjs";
import { fixture as recipientIndex, validateFixture as validateRecipientIndex } from "../../evals/tasks/r20-refactor-recipient-index-v1.mjs";
import { fixture as retryPolicy, validateFixture as validateRetryPolicy } from "../../evals/tasks/r20-refactor-retry-policy-v1.mjs";
import { fixture as reportProjection, validateFixture as validateReportProjection } from "../../evals/tasks/r20-refactor-report-projection-v1.mjs";
import { fixture as cursorCodec, validateFixture as validateCursorCodec } from "../../evals/tasks/r20-refactor-cursor-codec-v1.mjs";
import { fixture as asyncChecks, validateFixture as validateAsyncChecks } from "../../evals/tasks/r20-maintenance-async-checks-v1.mjs";
import { fixture as tempCleanup, validateFixture as validateTempCleanup } from "../../evals/tasks/r20-maintenance-temp-cleanup-v1.mjs";
import { fixture as stableReport, validateFixture as validateStableReport } from "../../evals/tasks/r20-maintenance-stable-report-v1.mjs";
import { fixture as pathBoundary, validateFixture as validatePathBoundary } from "../../evals/tasks/r20-security-path-boundary-v1.mjs";
import { fixture as jobSchema, validateFixture as validateJobSchema } from "../../evals/tasks/r20-security-job-schema-v1.mjs";
import { fixture as prototypeConfig, validateFixture as validatePrototypeConfig } from "../../evals/tasks/r20-security-prototype-config-v1.mjs";

it("keeps the evaluation inventory at 20 unique tasks with the declared category mix", () => {
  const inventory = [fixture, pagination, deepConfig, queueRecovery, retryBackoff,
    releaseNotes, webhookRecovery, tagFilter, expiringCache, dailySummary,
    recipientIndex, retryPolicy, reportProjection, cursorCodec,
    asyncChecks, tempCleanup, stableReport, pathBoundary, jobSchema, prototypeConfig];
  expect(new Set(inventory.map((task) => task.taskId)).size).toBe(20);
  const counts: Record<string, number> = {};
  for (const task of inventory) counts[task.category] = (counts[task.category] ?? 0) + 1;
  expect(counts).toEqual({ bugfix: 5, feature: 5, refactor: 4, maintenance: 3, security: 3 });
});

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
  it("rejects workspace traversal before writing the escaped file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "wm-eval-path-"));
    try {
      await expect(materialize(path.join(root, "workspace"), { "../escape": "bad" })).rejects.toThrow("escapes workspace");
      await expect(fs.stat(path.join(root, "escape"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns a failing CLI exit status when a fixture does not qualify", async () => {
    const helper = pathToFileURL(path.resolve("evals/tasks/r20-helper.mjs")).href;
    const result = await runNode(process.cwd(), `import { printValidation } from ${JSON.stringify(helper)}; printValidation({baselineFails:true,referencePasses:false,incompleteFails:true});`);
    expect(result.code).toBe(1);
  });

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

describe("R20c offline feature fixtures", () => {
  it("has five distinct dependency-free feature tasks with semantic incomplete failures", async () => {
    const fixtures = [releaseNotes, webhookRecovery, tagFilter, expiringCache, dailySummary];
    expect(new Set(fixtures.map((item) => item.taskId)).size).toBe(5);
    expect(fixtures.every((item) => item.category === "feature" && item.workspace.network === false)).toBe(true);
    expect(fixtures.every((item) => item.workspace.toolchain.includes("22.12"))).toBe(true);
    expect(expiringCache.workspace.writableFiles).toEqual(["src/cache.mjs", "src/main.mjs"]);
    for (const item of fixtures) {
      const material = Object.entries(item.workspace.files).sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, contents]) => `${filePath}\0${contents}`).join("\0");
      const independentlyComputed = `sha256:${createHash("sha256").update(material).digest("hex")}`;
      expect(item.initialRevision).toBe(independentlyComputed);
    }
    const results = await Promise.all([
      validateReleaseNotes(), validateWebhookRecovery(), validateTagFilter(), validateExpiringCache(), validateDailySummary(),
    ]);
    for (const result of results) {
      expect(result.baselineFails).toBe(true);
      expect(result.referencePasses).toBe(true);
      expect(result.incompleteFails).toBe(true);
      expect(result.outcomes.baseline.code).toBe(3);
      expect(result.outcomes.incomplete.code).toBe(3);
    }
  });
});

describe("R20d offline refactor fixtures", () => {
  it("has four distinct API-boundary refactors with semantic incomplete failures", async () => {
    const fixtures = [recipientIndex, retryPolicy, reportProjection, cursorCodec];
    expect(new Set(fixtures.map((item) => item.taskId)).size).toBe(4);
    expect(fixtures.every((item) => item.category === "refactor" && item.workspace.network === false)).toBe(true);
    expect(fixtures.every((item) => item.workspace.toolchain.includes("22.12"))).toBe(true);
    expect(retryPolicy.workspace.writableFiles).toEqual(["src/main.mjs", "src/retry-policy.mjs"]);

    for (const item of fixtures) {
      const material = Object.entries(item.workspace.files).sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, contents]) => `${filePath}\0${contents}`).join("\0");
      const independentlyComputed = `sha256:${createHash("sha256").update(material).digest("hex")}`;
      expect(item.initialRevision).toBe(independentlyComputed);
    }

    const results = await Promise.all([
      validateRecipientIndex(),
      validateRetryPolicy(),
      validateReportProjection(),
      validateCursorCodec(),
    ]);
    for (const result of results) {
      expect(result.baselineFails).toBe(true);
      expect(result.referencePasses).toBe(true);
      expect(result.incompleteFails).toBe(true);
      expect(result.outcomes.baseline.code).toBe(3);
      expect(result.outcomes.incomplete.code).toBe(3);
    }
  });
});

describe("R20e offline maintenance and security fixtures", () => {
  it("has three maintenance and three security tasks with semantic incomplete failures", async () => {
    const maintenance = [asyncChecks, tempCleanup, stableReport];
    const security = [pathBoundary, jobSchema, prototypeConfig];
    const fixtures = [...maintenance, ...security];
    expect(new Set(fixtures.map((item) => item.taskId)).size).toBe(6);
    expect(maintenance.every((item) => item.category === "maintenance")).toBe(true);
    expect(security.every((item) => item.category === "security")).toBe(true);
    expect(fixtures.every((item) => item.workspace.network === false)).toBe(true);
    expect(fixtures.every((item) => item.workspace.toolchain.includes("22.12"))).toBe(true);
    for (const item of fixtures) {
      const material = Object.entries(item.workspace.files).sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, contents]) => `${filePath}\0${contents}`).join("\0");
      const independentlyComputed = `sha256:${createHash("sha256").update(material).digest("hex")}`;
      expect(item.initialRevision).toBe(independentlyComputed);
    }
    const results = await Promise.all([
      validateAsyncChecks(), validateTempCleanup(), validateStableReport(),
      validatePathBoundary(), validateJobSchema(), validatePrototypeConfig(),
    ]);
    for (const result of results) {
      expect(result.baselineFails).toBe(true);
      expect(result.referencePasses).toBe(true);
      expect(result.incompleteFails).toBe(true);
      expect(result.outcomes.baseline.code).toBe(3);
      expect(result.outcomes.incomplete.code).toBe(3);
    }
  });
});
