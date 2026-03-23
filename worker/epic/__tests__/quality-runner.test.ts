import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(""),
  readdirSync: vi.fn().mockReturnValue([]),
}));

// Mock gate-utils
vi.mock("../gate-utils.js", () => ({
  isDockerDaemonReachable: vi.fn().mockReturnValue(false),
}));

// Mock language-profile
vi.mock("../../lib/dist/language-profile.js", () => ({
  detectLanguageWithTestRunner: vi.fn().mockReturnValue({
    id: "typescript",
    displayName: "TypeScript",
    typecheck: "npx tsc --noEmit",
    lint: "npx eslint .",
    test: "npm test",
    parseTypecheck: vi.fn().mockReturnValue({ passed: true, errors: 0 }),
    parseLint: vi.fn().mockReturnValue({ errors: 0, warnings: 0 }),
    parseTest: vi.fn().mockReturnValue({ passed: true, total: 10, failures: 0, skipped: 0 }),
  }),
  findGoModDirs: vi.fn().mockReturnValue([]),
}));

// Mock http/https for postQualityMetrics
vi.mock("https", () => ({
  request: vi.fn(),
}));
vi.mock("http", () => ({
  request: vi.fn(),
}));

import * as http from "http";
import * as https from "https";
import {
  findBoardGateCommand,
  postQualityMetrics,
  generateCoverageReport,
  generateSecuritySummary,
  generateQualityMetricsPrSection,
  getChangedFiles,
  getChangedFileCoverage,
  type QualityMetrics,
} from "../quality-runner.js";
import { execSync } from "child_process";

const mockExecSync = vi.mocked(execSync);

function makeMetrics(overrides?: Partial<QualityMetrics>): QualityMetrics {
  return {
    qualityScore: 85,
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

describe("quality-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // findBoardGateCommand
  // ==========================================================================

  describe("findBoardGateCommand", () => {
    const gates = [
      { name: "typecheck", trigger: "pre-commit", commands: ["npx tsc --noEmit"] },
      { name: "lint", trigger: "pre-commit", commands: ["npx eslint ."] },
      { name: "test", trigger: "pre-commit", commands: ["npm test"] },
      { name: "test-e2e", trigger: "pre-commit", commands: ["npx playwright test"] },
    ];

    it("finds typecheck gate by name", () => {
      const cmd = findBoardGateCommand(gates, "typecheck");
      expect(cmd).toBe("npx tsc --noEmit");
    });

    it("finds lint gate by name", () => {
      const cmd = findBoardGateCommand(gates, "lint");
      expect(cmd).toBe("npx eslint .");
    });

    it("finds test gate by name", () => {
      const cmd = findBoardGateCommand(gates, "test");
      expect(cmd).toBe("npm test");
    });

    it("finds test-e2e gate by name", () => {
      const cmd = findBoardGateCommand(gates, "test-e2e");
      expect(cmd).toBe("npx playwright test");
    });

    it("returns undefined for unmatched category", () => {
      const cmd = findBoardGateCommand([], "typecheck");
      expect(cmd).toBeUndefined();
    });

    it("joins multiple commands with &&", () => {
      const multiGates = [
        { name: "lint", trigger: "pre-commit", commands: ["npm run lint:fix", "npm run lint:check"] },
      ];
      const cmd = findBoardGateCommand(multiGates, "lint");
      expect(cmd).toBe("npm run lint:fix && npm run lint:check");
    });

    it("matches by command content when name does not match", () => {
      const customGates = [
        { name: "my-checks", trigger: "pre-commit", commands: ["npx eslint src/"] },
      ];
      const cmd = findBoardGateCommand(customGates, "lint");
      expect(cmd).toBe("npx eslint src/");
    });

    it("excludes e2e tests from unit test command match", () => {
      const mixedGates = [
        { name: "all-tests", trigger: "pre-commit", commands: ["npm run test_e2e_workflows"] },
      ];
      const cmd = findBoardGateCommand(mixedGates, "test");
      expect(cmd).toBeUndefined();
    });

    it("matches test gate by command content (pytest)", () => {
      const pyGates = [
        { name: "run-checks", trigger: "pre-commit", commands: ["pytest tests/"] },
      ];
      const cmd = findBoardGateCommand(pyGates, "test");
      expect(cmd).toBe("pytest tests/");
    });

    it("matches typecheck by command content (mypy)", () => {
      const pyGates = [
        { name: "quality", trigger: "pre-commit", commands: ["mypy src/"] },
      ];
      const cmd = findBoardGateCommand(pyGates, "typecheck");
      expect(cmd).toBe("mypy src/");
    });

    it("handles name variations (type_check, type-check)", () => {
      const variations = [
        { name: "type-check", trigger: "pre-commit", commands: ["tsc --noEmit"] },
      ];
      const cmd = findBoardGateCommand(variations, "typecheck");
      expect(cmd).toBe("tsc --noEmit");
    });
  });

  // ==========================================================================
  // postQualityMetrics
  // ==========================================================================

  describe("postQualityMetrics", () => {
    it("sends metrics via http for http URLs", async () => {
      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(http.request).mockImplementation((_url: any, _opts: any, cb: any) => {
        // Simulate successful response
        setTimeout(() => cb({ statusCode: 200 }), 0);
        return mockReq as any;
      });

      const metrics = makeMetrics();
      const result = await postQualityMetrics(
        "http://localhost:3001",
        "test-key",
        "task-1",
        metrics
      );

      expect(result).toBe(true);
      expect(http.request).toHaveBeenCalledWith(
        "http://localhost:3001/api/tasks/task-1/quality-metrics",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-API-Key": "test-key",
          }),
        }),
        expect.any(Function)
      );
      expect(mockReq.write).toHaveBeenCalled();
      expect(mockReq.end).toHaveBeenCalled();
    });

    it("sends metrics via https for https URLs", async () => {
      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(https.request).mockImplementation((_url: any, _opts: any, cb: any) => {
        setTimeout(() => cb({ statusCode: 200 }), 0);
        return mockReq as any;
      });

      const metrics = makeMetrics();
      const result = await postQualityMetrics(
        "https://api.example.com",
        "test-key",
        "task-1",
        metrics
      );

      expect(result).toBe(true);
      expect(https.request).toHaveBeenCalled();
    });

    it("returns false on non-2xx status", async () => {
      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(http.request).mockImplementation((_url: any, _opts: any, cb: any) => {
        setTimeout(() => cb({ statusCode: 500 }), 0);
        return mockReq as any;
      });

      const result = await postQualityMetrics(
        "http://localhost:3001",
        "test-key",
        "task-1",
        makeMetrics()
      );

      expect(result).toBe(false);
    });

    it("returns false on request error", async () => {
      const mockReq = {
        on: vi.fn((event: string, cb: Function) => {
          if (event === "error") {
            setTimeout(() => cb(new Error("Connection refused")), 0);
          }
        }),
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(http.request).mockImplementation((_url: any, _opts: any, _cb: any) => {
        return mockReq as any;
      });

      const result = await postQualityMetrics(
        "http://localhost:3001",
        "test-key",
        "task-1",
        makeMetrics()
      );

      expect(result).toBe(false);
    });

    it("includes all metric fields in the request body", async () => {
      let writtenBody = "";
      const mockReq = {
        on: vi.fn(),
        write: vi.fn((data: string) => { writtenBody = data; }),
        end: vi.fn(),
      };
      vi.mocked(http.request).mockImplementation((_url: any, _opts: any, cb: any) => {
        setTimeout(() => cb({ statusCode: 200 }), 0);
        return mockReq as any;
      });

      const metrics = makeMetrics({ qualityScore: 92, typeErrors: 3, testsFailed: 1 });
      await postQualityMetrics("http://localhost:3001", "key", "t1", metrics);

      const parsed = JSON.parse(writtenBody);
      expect(parsed.qualityMetrics.qualityScore).toBe(92);
      expect(parsed.qualityMetrics.typeErrors).toBe(3);
      expect(parsed.qualityMetrics.testsFailed).toBe(1);
      expect(parsed.qualityMetrics.analysisJson).toBeDefined();
    });
  });

  // ==========================================================================
  // generateCoverageReport
  // ==========================================================================

  describe("generateCoverageReport", () => {
    it("generates coverage report with high coverage", () => {
      const report = generateCoverageReport(makeMetrics({ coverageLines: 85, coverageBranches: 80 }));
      expect(report).toContain("Test Coverage");
      expect(report).toContain("85.0%");
    });

    it("includes changed file coverage when available", () => {
      const metrics = makeMetrics({
        changedFiles: ["src/index.ts"],
        changedFileCoverage: 90,
        changedFileCoverageDetails: [
          { file: "src/index.ts", lines: 90, branches: 85, covered: true },
        ],
      });
      const report = generateCoverageReport(metrics);
      expect(report).toContain("Changed Files");
      expect(report).toContain("90%");
    });

    it("shows no source files changed message", () => {
      const metrics = makeMetrics({ changedFiles: [] });
      const report = generateCoverageReport(metrics);
      expect(report).toContain("No source files changed");
    });
  });

  // ==========================================================================
  // generateSecuritySummary
  // ==========================================================================

  describe("generateSecuritySummary", () => {
    it("shows no vulnerabilities when clean", () => {
      const summary = generateSecuritySummary(makeMetrics());
      expect(summary).toContain("No vulnerabilities detected");
    });

    it("shows vulnerability counts when present", () => {
      const metrics = makeMetrics({
        securityScore: 60,
        securityHigh: 2,
        securityMedium: 3,
        securityLow: 1,
      });
      const summary = generateSecuritySummary(metrics);
      expect(summary).toContain("Critical/High");
      expect(summary).toContain("2");
      expect(summary).toContain("Medium");
      expect(summary).toContain("3");
      expect(summary).toContain("Action Required");
    });

    it("omits action required when no high severity vulns", () => {
      const metrics = makeMetrics({
        securityScore: 90,
        securityHigh: 0,
        securityMedium: 1,
        securityLow: 2,
      });
      const summary = generateSecuritySummary(metrics);
      expect(summary).not.toContain("Action Required");
    });
  });

  // ==========================================================================
  // generateQualityMetricsPrSection
  // ==========================================================================

  describe("generateQualityMetricsPrSection", () => {
    it("generates full quality metrics table", () => {
      const section = generateQualityMetricsPrSection(makeMetrics({ qualityScore: 92 }));
      expect(section).toContain("Quality Metrics");
      expect(section).toContain("92/100");
      expect(section).toContain("Grade: A");
    });

    it("marks unavailable checks as N/A", () => {
      const metrics = makeMetrics({
        typecheckAvailable: false,
        testsAvailable: false,
        coverageAvailable: false,
      });
      const section = generateQualityMetricsPrSection(metrics);
      // Should show N/A for each unavailable
      const naCount = (section.match(/N\/A/g) || []).length;
      expect(naCount).toBe(3);
    });

    it("includes changed file coverage when present", () => {
      const metrics = makeMetrics({
        changedFiles: ["a.ts", "b.ts"],
        changedFileCoverage: 75,
      });
      const section = generateQualityMetricsPrSection(metrics);
      expect(section).toContain("Changed Files");
      expect(section).toContain("75%");
      expect(section).toContain("2 files");
    });

    it("assigns correct grades", () => {
      expect(generateQualityMetricsPrSection(makeMetrics({ qualityScore: 95 }))).toContain("Grade: A");
      expect(generateQualityMetricsPrSection(makeMetrics({ qualityScore: 85 }))).toContain("Grade: B");
      expect(generateQualityMetricsPrSection(makeMetrics({ qualityScore: 75 }))).toContain("Grade: C");
      expect(generateQualityMetricsPrSection(makeMetrics({ qualityScore: 65 }))).toContain("Grade: D");
      expect(generateQualityMetricsPrSection(makeMetrics({ qualityScore: 55 }))).toContain("Grade: F");
    });
  });

  // ==========================================================================
  // getChangedFiles
  // ==========================================================================

  describe("getChangedFiles", () => {
    it("returns source files from git diff", () => {
      mockExecSync.mockReturnValueOnce("src/index.ts\nsrc/app.tsx\nREADME.md\n" as any);

      const files = getChangedFiles("/tmp/repo");

      expect(files).toEqual(["src/index.ts", "src/app.tsx"]);
      expect(files).not.toContain("README.md");
    });

    it("returns empty array when no source files changed", () => {
      mockExecSync.mockReturnValueOnce("README.md\npackage.json\n" as any);

      const files = getChangedFiles("/tmp/repo");

      expect(files).toEqual([]);
    });

    it("returns empty array on git error", () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error("not a git repo");
      });

      const files = getChangedFiles("/tmp/repo");

      expect(files).toEqual([]);
    });

    it("filters for multiple language extensions", () => {
      mockExecSync.mockReturnValueOnce("main.py\napp.go\nlib.rs\nstyle.css\n" as any);

      const files = getChangedFiles("/tmp/repo");

      expect(files).toEqual(["main.py", "app.go", "lib.rs"]);
    });
  });
});
