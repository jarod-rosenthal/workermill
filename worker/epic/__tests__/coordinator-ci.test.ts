import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heavy dependencies
vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
  spawn: vi.fn(),
}));

vi.mock("../coordinator-utils.js", () => ({
  postLog: vi.fn().mockResolvedValue(undefined),
}));

const _mockFixFn = vi.fn().mockResolvedValue({ success: false, summary: "mock", decision: "unfixable" });
vi.mock("../inline-ci-fixer.js", () => {
  return {
    InlineCIFixer: class {
      fix = _mockFixFn;
    },
  };
});

vi.mock("../quality-runner.js", () => ({
  runQualityVerification: vi.fn().mockResolvedValue({
    qualityScore: 100,
    lintScore: 100,
    lintErrors: 0,
    lintWarnings: 0,
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
  }),
  findBoardGateCommand: vi.fn(),
}));

vi.mock("../agent-sdk.js", () => ({
  runAgent: vi.fn().mockResolvedValue({ success: true, messages: [] }),
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

vi.mock("../gate-utils.js", () => ({
  loadRepoContext: vi.fn().mockReturnValue(null),
}));

vi.mock("axios", () => {
  const post = vi.fn();
  return { default: { post }, post };
});

import axios from "axios";
import { execSync } from "child_process";
import { runCIGate, pollPrCI } from "../coordinator-ci.js";
import { makeConfig, makeResilience } from "./helpers/factories.js";
import { mockGitOps } from "./helpers/mocks.js";

const mockExecSync = vi.mocked(execSync);
const mockAxiosPost = vi.mocked(axios.post);

describe("coordinator-ci", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SCM_PROVIDER;
  });

  // ==========================================================================
  // pollPrCI — GitHub path
  // ==========================================================================

  describe("pollPrCI (GitHub)", () => {
    const config = makeConfig({ targetRepo: "owner/repo", githubToken: "ghp_test" });
    const resilience = makeResilience({ blockerWaitTimeoutMs: 60_000 });
    const gitOps = mockGitOps();

    it("returns passed when all checks succeed", async () => {
      // First call: get PR head SHA
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      // Second call: get check runs — all completed and successful
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 2,
          runs: [
            { name: "build", status: "completed", conclusion: "success", url: "" },
            { name: "test", status: "completed", conclusion: "success", url: "" },
          ],
        }) as any
      );

      const result = await pollPrCI(config, resilience, gitOps as any, 42);

      expect(result.passed).toBe(true);
      expect(result.pending).toBe(false);
    });

    it("returns failed when a check fails", async () => {
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 2,
          runs: [
            { name: "build", status: "completed", conclusion: "success", url: "" },
            { name: "test", status: "completed", conclusion: "failure", url: "https://github.com/owner/repo/runs/999" },
          ],
        }) as any
      );
      // Detailed log fetch (best-effort)
      mockExecSync.mockReturnValueOnce("Step: Run tests\nConclusion: failure" as any);

      const result = await pollPrCI(config, resilience, gitOps as any, 42);

      expect(result.passed).toBe(false);
      expect(result.pending).toBe(false);
      expect(result.log).toContain("test: failure");
    });

    it("returns failed when head SHA cannot be determined", async () => {
      mockExecSync.mockReturnValueOnce("" as any);

      const result = await pollPrCI(config, resilience, gitOps as any, 42);

      expect(result.passed).toBe(false);
      expect(result.log).toContain("Could not determine PR head SHA");
    });

    it("returns failed on execSync error", async () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("Command failed");
      });

      const result = await pollPrCI(config, resilience, gitOps as any, 42);

      expect(result.passed).toBe(false);
      expect(result.log).toContain("CI polling error");
    });

    it("treats skipped and neutral conclusions as passing", async () => {
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 3,
          runs: [
            { name: "build", status: "completed", conclusion: "success", url: "" },
            { name: "optional", status: "completed", conclusion: "skipped", url: "" },
            { name: "info", status: "completed", conclusion: "neutral", url: "" },
          ],
        }) as any
      );

      const result = await pollPrCI(config, resilience, gitOps as any, 42);

      expect(result.passed).toBe(true);
      expect(result.pending).toBe(false);
    });
  });

  // ==========================================================================
  // pollPrCI — API path (BitBucket/GitLab)
  // ==========================================================================

  describe("pollPrCI (API — non-GitHub)", () => {
    const config = makeConfig({ targetRepo: "owner/repo" });
    const resilience = makeResilience({ blockerWaitTimeoutMs: 60_000 });
    const gitOps = {
      ...mockGitOps(),
      getHeadSha: vi.fn().mockReturnValue("def5678"),
    };

    beforeEach(() => {
      process.env.SCM_PROVIDER = "bitbucket";
    });

    it("returns passed when all API-reported checks pass", async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          statuses: [
            { state: "passed", name: "pipeline", rawState: "SUCCESSFUL" },
          ],
          total: 1,
        },
      });

      const result = await pollPrCI(config, resilience, gitOps as any, 10);

      expect(result.passed).toBe(true);
      expect(result.pending).toBe(false);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining("/api/worker-decisions/ci-status"),
        expect.objectContaining({ repo: "owner/repo", commitSha: "def5678" }),
        expect.any(Object)
      );
    });

    it("returns failed when API-reported checks fail", async () => {
      mockAxiosPost.mockResolvedValueOnce({
        data: {
          statuses: [
            { state: "failed", name: "pipeline", rawState: "FAILED", url: "https://bb.example.com" },
          ],
          total: 1,
        },
      });

      const result = await pollPrCI(config, resilience, gitOps as any, 10);

      expect(result.passed).toBe(false);
      expect(result.log).toContain("pipeline: FAILED");
    });

    it("returns failed when HEAD SHA is empty", async () => {
      gitOps.getHeadSha.mockReturnValue("");

      const result = await pollPrCI(config, resilience, gitOps as any, 10);

      expect(result.passed).toBe(false);
      expect(result.log).toContain("Could not determine HEAD SHA");
    });

    it("returns failed on API error", async () => {
      gitOps.getHeadSha.mockReturnValue("def5678");
      mockAxiosPost.mockRejectedValueOnce(new Error("Network error"));

      const result = await pollPrCI(config, resilience, gitOps as any, 10);

      expect(result.passed).toBe(false);
      expect(result.log).toContain("CI polling error");
    });
  });

  // ==========================================================================
  // runCIGate
  // ==========================================================================

  describe("runCIGate", () => {
    const config = makeConfig({ targetRepo: "owner/repo", githubToken: "ghp_test" });
    const resilience = makeResilience({ blockerWaitTimeoutMs: 60_000 });
    const gitOps = {
      ...mockGitOps(),
      getRepoPath: vi.fn().mockReturnValue("/tmp/repo"),
    };

    it("returns passed immediately if CI passes on first poll", async () => {
      // pollPrCI will use GitHub path (no SCM_PROVIDER set)
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "success", url: "" }],
        }) as any
      );

      const result = await runCIGate(config, resilience, gitOps as any, 1, 3);

      expect(result.passed).toBe(true);
      expect(result.fixed).toBe(false);
    });

    it("returns not passed with unfixable fix result", async () => {
      // First poll: CI fails
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }],
        }) as any
      );

      // InlineCIFixer returns unfixable
      _mockFixFn.mockResolvedValueOnce({ success: false, decision: "unfixable", summary: "Cannot fix" });

      const result = await runCIGate(config, resilience, gitOps as any, 1, 3);

      expect(result.passed).toBe(false);
      expect(result.fixed).toBe(false);
    });

    it("respects maxFixRetries parameter", async () => {
      vi.useFakeTimers();

      // First poll: CI fails
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }],
        }) as any
      );

      // Fixer succeeds but CI still fails on repoll — loop should exhaust retries
      _mockFixFn.mockResolvedValue({ success: true, summary: "Fixed lint" });

      // Each retry: re-polls CI (2 calls each), all fail
      for (let i = 0; i < 2; i++) {
        mockExecSync.mockReturnValueOnce("abc1234" as any);
        mockExecSync.mockReturnValueOnce(
          JSON.stringify({
            total: 1,
            runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }],
          }) as any
        );
      }

      const promise = runCIGate(config, resilience, gitOps as any, 1, 2);
      // Advance past the 10-second delays between fix + repoll
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;

      expect(result.passed).toBe(false);
      expect(result.fixed).toBe(false);

      vi.useRealTimers();
    });

    it("defaults maxFixRetries to 5 when undefined", async () => {
      // First poll: CI fails
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }],
        }) as any
      );

      // Fixer fails on first attempt
      _mockFixFn.mockResolvedValueOnce({ success: false, summary: "Could not fix" });

      const result = await runCIGate(config, resilience, gitOps as any, 1, undefined);

      expect(result.passed).toBe(false);
      // Only one fixer call because fixer.success is false (breaks out)
      expect(_mockFixFn).toHaveBeenCalledTimes(1);
    });

    it("returns passed + fixed when fixer succeeds and repoll passes", async () => {
      vi.useFakeTimers();

      // First poll: CI fails
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "failure", url: "" }],
        }) as any
      );

      // Fixer succeeds
      _mockFixFn.mockResolvedValueOnce({ success: true, summary: "Fixed lint" });

      // Re-poll: CI passes
      mockExecSync.mockReturnValueOnce("abc1234" as any);
      mockExecSync.mockReturnValueOnce(
        JSON.stringify({
          total: 1,
          runs: [{ name: "ci", status: "completed", conclusion: "success", url: "" }],
        }) as any
      );

      const promise = runCIGate(config, resilience, gitOps as any, 1, 3);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;

      expect(result.passed).toBe(true);
      expect(result.fixed).toBe(true);

      vi.useRealTimers();
    });
  });
});
