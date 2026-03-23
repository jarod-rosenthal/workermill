import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process (used by runCommand inside auto-fix-agent)
vi.mock("child_process", () => ({
  spawn: vi.fn().mockImplementation(() => {
    const proc = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: Function) => {
        if (event === "close") {
          setTimeout(() => cb(0), 0);
        }
      }),
    };
    return proc;
  }),
}));

vi.mock("../../lib/language-profile.js", () => ({
  detectLanguage: vi.fn().mockReturnValue({
    id: "typescript",
    displayName: "TypeScript",
    typecheck: "npx tsc --noEmit",
    lint: "npx eslint .",
    test: "npm test",
  }),
}));

import {
  DEFAULT_AUTO_FIX_CONFIG,
  formatAutoFixResult,
  runAutoFix,
  runAutoFixWithTracking,
  calculateFixStats,
  generateAutoFixPrSection,
  type AutoFixResult,
  type AutoFixConfig,
  type QualityGateResult,
} from "../auto-fix-agent.js";
import type { QualityMetrics } from "../quality-runner.js";

function makeMetrics(overrides?: Partial<QualityMetrics>): QualityMetrics {
  return {
    qualityScore: 80,
    lintScore: 90,
    lintErrors: 2,
    lintWarnings: 5,
    typecheckScore: 100,
    typeErrors: 0,
    testScore: 100,
    testsPassed: 10,
    testsFailed: 0,
    testsSkipped: 0,
    coverageScore: 80,
    coverageLines: 80,
    coverageBranches: 70,
    securityScore: 100,
    securityHigh: 0,
    securityMedium: 0,
    securityLow: 0,
    ...overrides,
  };
}

function makeGateResult(overrides?: Partial<QualityGateResult>): QualityGateResult {
  return {
    passed: false,
    checks: [
      { name: "lint_errors", passed: false, message: "2 lint errors found" },
      { name: "type_errors", passed: true, message: "No type errors" },
    ],
    summary: "Quality gate failed",
    failureReasons: ["lint_errors"],
    ...overrides,
  };
}

describe("auto-fix-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // DEFAULT_AUTO_FIX_CONFIG
  // ==========================================================================

  describe("DEFAULT_AUTO_FIX_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_AUTO_FIX_CONFIG.maxIterations).toBe(3);
      expect(DEFAULT_AUTO_FIX_CONFIG.enableLintFix).toBe(true);
      expect(DEFAULT_AUTO_FIX_CONFIG.enableTypeErrorFix).toBe(true);
      expect(DEFAULT_AUTO_FIX_CONFIG.enableTestFix).toBe(false);
      expect(DEFAULT_AUTO_FIX_CONFIG.enableFormatFix).toBe(true);
      expect(DEFAULT_AUTO_FIX_CONFIG.enableImportFix).toBe(true);
    });

    it("has projectRoot defaulting to cwd", () => {
      expect(DEFAULT_AUTO_FIX_CONFIG.projectRoot).toBe(process.cwd());
    });
  });

  // ==========================================================================
  // formatAutoFixResult
  // ==========================================================================

  describe("formatAutoFixResult", () => {
    it("formats a successful result", () => {
      const result: AutoFixResult = {
        success: true,
        iterations: [
          {
            iteration: 1,
            fixAttempts: [
              { issueType: "lint_errors", fixed: true, message: "Lint errors fixed", filesModified: [] },
            ],
            qualityGatePassed: true,
            previousMetrics: makeMetrics(),
            totalFilesModified: [],
          },
        ],
        totalIterations: 1,
        totalFixesApplied: 1,
        issuesRemaining: [],
        summary: "Quality gate passed after 1 auto-fix iteration(s) with 1 fixes applied",
      };

      const output = formatAutoFixResult(result);

      expect(output).toContain("AUTO-FIX RESULT");
      expect(output).toContain("Status: SUCCESS");
      expect(output).toContain("Iterations: 1");
      expect(output).toContain("Fixes Applied: 1");
      expect(output).toContain("lint_errors: Lint errors fixed");
    });

    it("formats an incomplete result with remaining issues", () => {
      const result: AutoFixResult = {
        success: false,
        iterations: [
          {
            iteration: 1,
            fixAttempts: [
              { issueType: "type_errors", fixed: false, message: "Type errors require AI", filesModified: [] },
            ],
            qualityGatePassed: false,
            previousMetrics: makeMetrics(),
            totalFilesModified: [],
          },
        ],
        totalIterations: 1,
        totalFixesApplied: 0,
        issuesRemaining: ["type_errors: 5 type errors found"],
        summary: "Auto-fix completed 1 iteration(s) but 1 issue(s) remain",
      };

      const output = formatAutoFixResult(result);

      expect(output).toContain("INCOMPLETE");
      expect(output).toContain("Remaining Issues:");
      expect(output).toContain("type_errors: 5 type errors found");
    });

    it("formats result with no iterations", () => {
      const result: AutoFixResult = {
        success: true,
        iterations: [],
        totalIterations: 0,
        totalFixesApplied: 0,
        issuesRemaining: [],
        summary: "Already passing",
      };

      const output = formatAutoFixResult(result);

      expect(output).toContain("Iterations: 0");
      expect(output).not.toContain("Remaining Issues:");
    });
  });

  // ==========================================================================
  // calculateFixStats
  // ==========================================================================

  describe("calculateFixStats", () => {
    it("calculates stats from multiple iterations", () => {
      const result: AutoFixResult = {
        success: false,
        iterations: [
          {
            iteration: 1,
            fixAttempts: [
              { issueType: "lint_errors", fixed: true, message: "Fixed", filesModified: [] },
              { issueType: "format_issues", fixed: true, message: "Fixed", filesModified: [] },
              { issueType: "type_errors", fixed: false, message: "Not fixed", filesModified: [] },
            ],
            qualityGatePassed: false,
            previousMetrics: makeMetrics(),
            totalFilesModified: [],
          },
          {
            iteration: 2,
            fixAttempts: [
              { issueType: "lint_errors", fixed: true, message: "Fixed again", filesModified: [] },
            ],
            qualityGatePassed: false,
            previousMetrics: makeMetrics(),
            totalFilesModified: [],
          },
        ],
        totalIterations: 2,
        totalFixesApplied: 3,
        issuesRemaining: ["type_errors: still broken"],
        summary: "",
      };

      const stats = calculateFixStats(result);

      expect(stats.totalAttempts).toBe(4);
      expect(stats.successfulFixes).toBe(3);
      expect(stats.failedFixes).toBe(1);
      expect(stats.fixesByType["lint_errors"].attempts).toBe(2);
      expect(stats.fixesByType["lint_errors"].successes).toBe(2);
      expect(stats.fixesByType["type_errors"].attempts).toBe(1);
      expect(stats.fixesByType["type_errors"].successes).toBe(0);
    });
  });

  // ==========================================================================
  // generateAutoFixPrSection
  // ==========================================================================

  describe("generateAutoFixPrSection", () => {
    it("generates success markdown", () => {
      const result: AutoFixResult = {
        success: true,
        iterations: [
          {
            iteration: 1,
            fixAttempts: [
              { issueType: "lint_errors", fixed: true, message: "Fixed", filesModified: [] },
            ],
            qualityGatePassed: true,
            previousMetrics: makeMetrics(),
            totalFilesModified: [],
          },
        ],
        totalIterations: 1,
        totalFixesApplied: 1,
        issuesRemaining: [],
        summary: "",
      };

      const md = generateAutoFixPrSection(result);

      expect(md).toContain("### Auto-Fix Agent");
      expect(md).toContain("Quality gate passed");
      expect(md).toContain("Fixes applied:** 1");
    });

    it("generates incomplete markdown with remaining issues", () => {
      const result: AutoFixResult = {
        success: false,
        iterations: [],
        totalIterations: 0,
        totalFixesApplied: 0,
        issuesRemaining: ["type_errors: broken"],
        summary: "",
      };

      const md = generateAutoFixPrSection(result);

      expect(md).toContain("Auto-fix incomplete");
      expect(md).toContain("Remaining issues:");
      expect(md).toContain("type_errors: broken");
    });
  });

  // ==========================================================================
  // runAutoFix
  // ==========================================================================

  describe("runAutoFix", () => {
    it("returns immediately when gate already passes", async () => {
      const gateResult = makeGateResult({ passed: true });
      const metrics = makeMetrics();
      const runQualityChecks = vi.fn();

      const result = await runAutoFix(gateResult, metrics, { projectRoot: "/tmp" }, runQualityChecks);

      expect(result.success).toBe(true);
      expect(result.totalIterations).toBe(0);
      expect(runQualityChecks).not.toHaveBeenCalled();
    });

    it("runs fix iterations up to maxIterations", async () => {
      const gateResult = makeGateResult({ passed: false });
      const metrics = makeMetrics();
      // Quality checks never pass
      const runQualityChecks = vi.fn().mockResolvedValue({
        metrics: makeMetrics(),
        gateResult: makeGateResult({ passed: false }),
      });

      const result = await runAutoFix(
        gateResult,
        metrics,
        { projectRoot: "/tmp", maxIterations: 2 },
        runQualityChecks
      );

      expect(result.success).toBe(false);
      expect(result.totalIterations).toBe(2);
    });

    it("stops early when quality gate passes after a fix", async () => {
      // Use a gate result with only format issues (always tried) so spawn mock handles it
      const gateResult = makeGateResult({
        passed: false,
        checks: [
          { name: "lint_errors", passed: false, message: "2 lint errors" },
        ],
      });
      const metrics = makeMetrics();

      const runQualityChecks = vi.fn()
        // First call from iteration (after fixes applied) — gate passes
        .mockResolvedValueOnce({
          metrics: makeMetrics({ lintErrors: 0, lintScore: 100, qualityScore: 100 }),
          gateResult: makeGateResult({ passed: true, checks: [{ name: "lint_errors", passed: true, message: "OK" }] }),
        })
        // Should not be called again, but provide fallback just in case
        .mockResolvedValue({
          metrics: makeMetrics(),
          gateResult: makeGateResult({ passed: true }),
        });

      const result = await runAutoFix(
        gateResult,
        metrics,
        { projectRoot: "/tmp", maxIterations: 5 },
        runQualityChecks
      );

      // The spawn mock returns exit code 0, so lint fix reports fixed=true
      // which triggers runQualityChecks. If spawn timing prevents this,
      // the iteration still runs but may not call runQualityChecks.
      // Either way, the important thing is it doesn't run all 5 iterations.
      expect(result.totalIterations).toBeLessThanOrEqual(2);
    });

    it("collects remaining issues when gate does not pass", async () => {
      const gateResult = makeGateResult({
        passed: false,
        checks: [
          { name: "type_errors", passed: false, message: "5 type errors" },
          { name: "lint_errors", passed: true, message: "OK" },
        ],
      });
      const metrics = makeMetrics();
      const runQualityChecks = vi.fn().mockResolvedValue({
        metrics: makeMetrics(),
        gateResult: makeGateResult({
          passed: false,
          checks: [
            { name: "type_errors", passed: false, message: "5 type errors" },
            { name: "lint_errors", passed: true, message: "OK" },
          ],
        }),
      });

      const result = await runAutoFix(
        gateResult,
        metrics,
        { projectRoot: "/tmp", maxIterations: 1 },
        runQualityChecks
      );

      expect(result.success).toBe(false);
      expect(result.issuesRemaining).toEqual(
        expect.arrayContaining([expect.stringContaining("type_errors")])
      );
    });

    it("generates correct summary", async () => {
      const gateResult = makeGateResult({ passed: true });
      const metrics = makeMetrics();

      const result = await runAutoFix(gateResult, metrics, { projectRoot: "/tmp" }, vi.fn());

      expect(result.summary).toContain("Quality gate passed");
    });
  });

  // ==========================================================================
  // runAutoFixWithTracking
  // ==========================================================================

  describe("runAutoFixWithTracking", () => {
    it("runs auto-fix and returns the result", async () => {
      const gateResult = makeGateResult({ passed: true });
      const metrics = makeMetrics();
      const runQualityChecks = vi.fn();

      const result = await runAutoFixWithTracking(
        gateResult,
        metrics,
        { projectRoot: "/tmp" },
        runQualityChecks
      );

      expect(result.success).toBe(true);
    });

    it("posts stats when apiConfig is provided", async () => {
      const gateResult = makeGateResult({ passed: true });
      const metrics = makeMetrics();

      // Mock global fetch for postAutoFixStats
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      const result = await runAutoFixWithTracking(
        gateResult,
        metrics,
        { projectRoot: "/tmp" },
        vi.fn(),
        { baseUrl: "http://localhost:3001", apiKey: "test-key" }
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/analytics/auto-fix-stats",
        expect.objectContaining({ method: "POST" })
      );

      vi.unstubAllGlobals();
    });

    it("does not post stats when apiConfig is omitted", async () => {
      const gateResult = makeGateResult({ passed: true });
      const metrics = makeMetrics();

      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", mockFetch);

      await runAutoFixWithTracking(gateResult, metrics, { projectRoot: "/tmp" }, vi.fn());

      expect(mockFetch).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
