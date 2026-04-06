import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { loadConfig, type CliConfig } from "./config.js";

type DoctorSeverity = "high" | "medium" | "low";
type ModuleHealthStatus = "functioning" | "trouble" | "dead" | "unknown";
type ConfidenceLevel = "high" | "medium" | "low";

export interface DoctorRuntimeConfig {
  maxHighRiskModules: number;
  riskTroubleThreshold: number;
  healthFunctioningThreshold: number;
  healthTroubleThreshold: number;
  deadCodeEnabled: boolean;
  deadCodeMinDays: number;
  deadCodeMaxCandidates: number;
}

const DEFAULT_DOCTOR_CONFIG: DoctorRuntimeConfig = {
  maxHighRiskModules: 5,
  riskTroubleThreshold: 55,
  healthFunctioningThreshold: 72,
  healthTroubleThreshold: 45,
  deadCodeEnabled: true,
  deadCodeMinDays: 45,
  deadCodeMaxCandidates: 6,
};

export interface DoctorCommandEvidence {
  command: string;
  status: "passed" | "failed" | "skipped";
  output: string;
}

export interface DoctorGap {
  id: string;
  severity: DoctorSeverity;
  title: string;
  problemClass?: "failing_quality" | "ci_regression" | "coverage_risk" | "dead_code" | "baseline";
  targetFiles?: string[];
  evidence: string[];
  prescription: string;
  buildTask: string;
  verificationCommands?: string[];
  successCriteria?: string[];
  cureStatus?: "open" | "stale";
  riskScore?: number;
  priority?: number;
  dependsOn?: string[];
}

interface DoctorDelta {
  newGaps: number;
  resolvedGaps: number;
  persistingGaps: number;
}

interface FileCoverageMetrics {
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  linePercent: number;
  branchPercent: number | null;
}

export interface CoverageSnapshot {
  source: "lcov" | "cobertura" | "none";
  reportPath: string | null;
  linePercent: number | null;
  branchPercent: number | null;
  fileCount: number;
}

export interface HealthSnapshot {
  totalModules: number;
  functioning: number;
  trouble: number;
  dead: number;
  unknown: number;
}

export interface HealthDelta {
  improved: number;
  regressed: number;
  unchanged: number;
  newModules: number;
}

export interface HighRiskModule {
  filePath: string;
  lineCount: number;
  complexityScore: number;
  churn30d: number;
  lineCoveragePercent: number;
  branchCoveragePercent: number | null;
  riskScore: number;
  coverageConfidence: "measured" | "inferred";
  reasons: string[];
}

export interface DeadCodeCandidate {
  filePath: string;
  reason: string;
  lastTouchedDays: number | null;
  inboundReferences: number;
  lineCoveragePercent: number | null;
  confidence: ConfidenceLevel;
}

export interface ModuleHealth {
  filePath: string;
  status: ModuleHealthStatus;
  confidence: ConfidenceLevel;
  healthScore: number;
  riskScore: number;
  lineCoveragePercent: number | null;
  branchCoveragePercent: number | null;
  coverageConfidence: "measured" | "inferred";
  lineCount: number;
  complexityScore: number;
  churn30d: number;
  lastTouchedDays: number | null;
  inboundReferences: number;
  referencedByTests: boolean;
  ciRegressionHits: number;
  evidence: string[];
}

export interface CiFailureSignal {
  runId: number;
  workflow: string;
  createdAt: string;
  signature: string;
  classification: "regression" | "flake" | "unknown";
  filePaths: string[];
  details: string;
}

export interface DoctorReport {
  generatedAt: string;
  workingDir: string;
  issueRef?: string;
  languages: string[];
  frameworks: string[];
  testFileCount: number;
  e2eFileCount: number;
  integrationFileCount: number;
  unitFileCount: number;
  coverageSnapshot: CoverageSnapshot;
  healthSnapshot: HealthSnapshot;
  healthDelta: HealthDelta;
  moduleHealth: ModuleHealth[];
  highRiskUntestedModules: HighRiskModule[];
  deadCodeCandidates: DeadCodeCandidate[];
  ciFailureSignals: CiFailureSignal[];
  gaps: DoctorGap[];
  qualityEvidence: DoctorCommandEvidence[];
  appliedPrescriptionIds: string[];
  delta: DoctorDelta;
  summary: string[];
  artifactPath: string;
}

interface ScanSummary {
  filePaths: string[];
  unitTestPaths: string[];
  integrationTestPaths: string[];
  e2eTestPaths: string[];
  manifests: string[];
}

interface CoverageParseResult {
  snapshot: CoverageSnapshot;
  fileMetrics: Map<string, FileCoverageMetrics>;
}

interface GhRunListItem {
  databaseId?: number;
  workflowName?: string;
  name?: string;
  conclusion?: string;
  status?: string;
  createdAt?: string;
  headSha?: string;
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".workermill",
  "coverage",
]);

const SOURCE_FILE_REGEX = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|cs|php|rb|swift|kt)$/i;
const TEST_FILE_REGEX = /(^|\/)(__tests__\/|tests?\/.*|.*\.(test|spec)\.|.*_test\.|test_.*\.|\be2e\b|\bete\b)/i;

function normalizeCommandOutput(raw: string): string {
  return raw
    .replace(/\x1B\[[0-9;]*[mK]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function normalizeRelPath(input: string, cwd: string): string {
  const cleaned = input.replace(/\\/g, "/").trim();
  const resolved = path.isAbsolute(cleaned)
    ? path.relative(cwd, cleaned)
    : cleaned.startsWith("./")
      ? cleaned.slice(2)
      : cleaned;
  return resolved.replace(/\\/g, "/");
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function tryReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadProjectCliConfig(cwd: string): Partial<CliConfig> | null {
  try {
    const projectConfigPath = path.join(cwd, ".workermill", "config.json");
    if (!fs.existsSync(projectConfigPath)) return null;
    return tryReadJson<Partial<CliConfig>>(projectConfigPath);
  } catch {
    return null;
  }
}

function resolveDoctorRuntimeConfig(cwd: string): DoctorRuntimeConfig {
  const global = loadConfig();
  const project = loadProjectCliConfig(cwd);
  const globalDoctor = (global as CliConfig | null)?.doctor || {};
  const projectDoctor = (project as Partial<CliConfig> | null)?.doctor || {};
  const merged = { ...DEFAULT_DOCTOR_CONFIG, ...globalDoctor, ...projectDoctor };
  return {
    maxHighRiskModules: Math.max(1, Math.min(20, merged.maxHighRiskModules || DEFAULT_DOCTOR_CONFIG.maxHighRiskModules)),
    riskTroubleThreshold: Math.max(20, Math.min(95, merged.riskTroubleThreshold || DEFAULT_DOCTOR_CONFIG.riskTroubleThreshold)),
    healthFunctioningThreshold: Math.max(40, Math.min(95, merged.healthFunctioningThreshold || DEFAULT_DOCTOR_CONFIG.healthFunctioningThreshold)),
    healthTroubleThreshold: Math.max(5, Math.min(80, merged.healthTroubleThreshold || DEFAULT_DOCTOR_CONFIG.healthTroubleThreshold)),
    deadCodeEnabled: merged.deadCodeEnabled !== false,
    deadCodeMinDays: Math.max(7, Math.min(3650, merged.deadCodeMinDays || DEFAULT_DOCTOR_CONFIG.deadCodeMinDays)),
    deadCodeMaxCandidates: Math.max(0, Math.min(20, merged.deadCodeMaxCandidates || DEFAULT_DOCTOR_CONFIG.deadCodeMaxCandidates)),
  };
}

function safeExec(command: string, cwd: string, timeout = 12_000): string {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      shell: "/bin/bash",
    }).trim();
  } catch {
    return "";
  }
}

function collectFiles(cwd: string, maxFiles = 10_000): string[] {
  const out: string[] = [];
  const stack = [cwd];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(cwd, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) out.push(rel);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}

function detectLanguages(filePaths: string[], manifests: string[]): string[] {
  const langs = new Set<string>();
  if (manifests.includes("package.json")) langs.add("javascript/typescript");
  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) langs.add("python");
  if (manifests.includes("go.mod")) langs.add("go");
  if (manifests.includes("Cargo.toml")) langs.add("rust");
  if (manifests.includes("pom.xml") || manifests.includes("build.gradle")) langs.add("java");

  for (const rel of filePaths) {
    if (/\.(ts|tsx)$/.test(rel)) langs.add("typescript");
    if (/\.(js|jsx|mjs|cjs)$/.test(rel)) langs.add("javascript");
    if (/\.py$/.test(rel)) langs.add("python");
    if (/\.go$/.test(rel)) langs.add("go");
    if (/\.rs$/.test(rel)) langs.add("rust");
    if (/\.java$/.test(rel)) langs.add("java");
    if (/\.cs$/.test(rel)) langs.add("dotnet");
  }
  return [...langs];
}

function detectPackageRunner(cwd: string): "npm" | "pnpm" | "yarn" {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function buildRunScriptCommand(runner: "npm" | "pnpm" | "yarn", script: string): string {
  if (runner === "pnpm") return `pnpm run ${script}`;
  if (runner === "yarn") return `yarn ${script}`;
  return `npm run ${script}`;
}

function detectFrameworks(cwd: string, manifests: string[], filePaths: string[]): string[] {
  const frameworks = new Set<string>();

  if (manifests.includes("package.json")) {
    const pkg = tryReadJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(cwd, "package.json"));
    const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
    const depNames = new Set(Object.keys(deps));
    if (depNames.has("vitest")) frameworks.add("vitest");
    if (depNames.has("jest")) frameworks.add("jest");
    if (depNames.has("playwright") || depNames.has("@playwright/test")) frameworks.add("playwright");
    if (depNames.has("cypress")) frameworks.add("cypress");
    if (depNames.has("mocha")) frameworks.add("mocha");
  }

  if (manifests.includes("pyproject.toml") || manifests.includes("requirements.txt")) {
    const pyprojectPath = path.join(cwd, "pyproject.toml");
    const pyproject = fs.existsSync(pyprojectPath) ? fs.readFileSync(pyprojectPath, "utf-8") : "";
    if (/pytest/i.test(pyproject)) frameworks.add("pytest");
    if (/playwright/i.test(pyproject)) frameworks.add("playwright");
  }

  if (manifests.includes("go.mod")) frameworks.add("go test");
  if (filePaths.some((p) => /(^|\/)(e2e|ete|workflows?)\//i.test(p))) frameworks.add("e2e-suite");

  return [...frameworks];
}

function classifyTests(filePaths: string[]): ScanSummary {
  const manifests = filePaths.filter((p) =>
    /(^|\/)(package\.json|pyproject\.toml|requirements\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle)$/i.test(p),
  );

  const unitTestPaths = filePaths.filter((p) =>
    /(^|\/)(__tests__\/|tests?\/.*(unit|spec)|.*\.(test|spec)\.(ts|tsx|js|jsx|py)|.*_test\.go$|test_.*\.py$|.*Test\.java$|.*Tests\.cs$)/i.test(p),
  );
  const integrationTestPaths = filePaths.filter((p) =>
    /(^|\/)(integration|it|contract|api)[/_-].*|(^|\/)tests?\/integration\//i.test(p),
  );
  const e2eTestPaths = filePaths.filter((p) =>
    /(^|\/)(e2e|ete|end-to-end|workflows?)\//i.test(p) ||
    /(^|\/)tests?\/.*(e2e|ete|workflow)/i.test(p),
  );

  return {
    filePaths,
    manifests,
    unitTestPaths,
    integrationTestPaths,
    e2eTestPaths,
  };
}

function detectQualityCommands(cwd: string, scan: ScanSummary, languages: string[]): string[] {
  const commands: string[] = [];
  const runner = detectPackageRunner(cwd);

  if (scan.manifests.includes("package.json")) {
    const pkg = tryReadJson<{ scripts?: Record<string, string> }>(path.join(cwd, "package.json"));
    const scripts = pkg?.scripts || {};

    if (scripts["test:ci"]) commands.push(buildRunScriptCommand(runner, "test:ci"));
    else if (scripts.test && !/watch|dev|serve|start/.test(scripts.test.toLowerCase())) {
      commands.push(buildRunScriptCommand(runner, "test"));
    }

    if (scripts["test:e2e"]) commands.push(buildRunScriptCommand(runner, "test:e2e"));
    else if (scripts.e2e) commands.push(buildRunScriptCommand(runner, "e2e"));
  }

  if (commands.length === 0 && languages.includes("python")) commands.push("pytest -q");
  if (commands.length === 0 && languages.includes("go")) commands.push("go test ./...");
  if (commands.length === 0 && languages.includes("rust")) commands.push("cargo test --quiet");

  return commands.slice(0, 2);
}

function runQualityCommands(cwd: string, commands: string[]): DoctorCommandEvidence[] {
  if (commands.length === 0) {
    return [{
      command: "none",
      status: "skipped",
      output: "No deterministic quality/test commands detected.",
    }];
  }

  return commands.map((command) => {
    try {
      const output = execSync(command, {
        cwd,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        shell: "/bin/bash",
      });
      return {
        command,
        status: "passed" as const,
        output: normalizeCommandOutput(output || "passed"),
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
      return {
        command,
        status: "failed" as const,
        output: normalizeCommandOutput(detail || "command failed"),
      };
    }
  });
}

function parseLcov(content: string, cwd: string): CoverageParseResult {
  const fileMetrics = new Map<string, FileCoverageMetrics>();

  let currentFile = "";
  let lf = 0;
  let lh = 0;
  let brf = 0;
  let brh = 0;

  let totalLf = 0;
  let totalLh = 0;
  let totalBrf = 0;
  let totalBrh = 0;

  const flushRecord = (): void => {
    if (!currentFile) return;
    const linePercent = lf > 0 ? (lh / lf) * 100 : 0;
    const branchPercent = brf > 0 ? (brh / brf) * 100 : null;
    const key = normalizeRelPath(currentFile, cwd);
    fileMetrics.set(key, {
      linesFound: lf,
      linesHit: lh,
      branchesFound: brf,
      branchesHit: brh,
      linePercent: clampPercent(linePercent),
      branchPercent: branchPercent == null ? null : clampPercent(branchPercent),
    });
    totalLf += lf;
    totalLh += lh;
    totalBrf += brf;
    totalBrh += brh;

    currentFile = "";
    lf = 0;
    lh = 0;
    brf = 0;
    brh = 0;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) currentFile = line.slice(3).trim();
    else if (line.startsWith("LF:")) lf = Number.parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith("LH:")) lh = Number.parseInt(line.slice(3), 10) || 0;
    else if (line.startsWith("BRF:")) brf = Number.parseInt(line.slice(4), 10) || 0;
    else if (line.startsWith("BRH:")) brh = Number.parseInt(line.slice(4), 10) || 0;
    else if (line === "end_of_record") flushRecord();
  }
  flushRecord();

  return {
    snapshot: {
      source: "lcov",
      reportPath: null,
      linePercent: totalLf > 0 ? clampPercent((totalLh / totalLf) * 100) : 0,
      branchPercent: totalBrf > 0 ? clampPercent((totalBrh / totalBrf) * 100) : null,
      fileCount: fileMetrics.size,
    },
    fileMetrics,
  };
}

function parseCoverageXml(content: string, cwd: string): CoverageParseResult {
  const fileMetrics = new Map<string, FileCoverageMetrics>();

  const classRegex = /<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/gi;
  let classMatch: RegExpExecArray | null;
  while ((classMatch = classRegex.exec(content)) !== null) {
    const file = normalizeRelPath(classMatch[1], cwd);
    const classBody = classMatch[2];

    let linesFound = 0;
    let linesHit = 0;
    const lineRegex = /<line\b[^>]*hits="(\d+)"[^>]*>/gi;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(classBody)) !== null) {
      linesFound += 1;
      if ((Number.parseInt(lineMatch[1], 10) || 0) > 0) linesHit += 1;
    }

    const linePercent = linesFound > 0 ? (linesHit / linesFound) * 100 : 0;
    fileMetrics.set(file, {
      linesFound,
      linesHit,
      branchesFound: 0,
      branchesHit: 0,
      linePercent: clampPercent(linePercent),
      branchPercent: null,
    });
  }

  const lineRate = content.match(/line-rate="([0-9.]+)"/i);
  const branchRate = content.match(/branch-rate="([0-9.]+)"/i);

  return {
    snapshot: {
      source: "cobertura",
      reportPath: null,
      linePercent: lineRate ? clampPercent(Number.parseFloat(lineRate[1]) * 100) : null,
      branchPercent: branchRate ? clampPercent(Number.parseFloat(branchRate[1]) * 100) : null,
      fileCount: fileMetrics.size,
    },
    fileMetrics,
  };
}

function detectCoverage(cwd: string): CoverageParseResult {
  const candidates: Array<{ source: "lcov" | "cobertura"; relPath: string }> = [
    { source: "lcov", relPath: "coverage/lcov.info" },
    { source: "lcov", relPath: "lcov.info" },
    { source: "cobertura", relPath: "coverage.xml" },
    { source: "cobertura", relPath: "coverage/coverage.xml" },
    { source: "cobertura", relPath: "coverage/cobertura-coverage.xml" },
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(cwd, candidate.relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf-8");
    const parsed = candidate.source === "lcov" ? parseLcov(content, cwd) : parseCoverageXml(content, cwd);
    parsed.snapshot.reportPath = candidate.relPath;
    return parsed;
  }

  return {
    snapshot: {
      source: "none",
      reportPath: null,
      linePercent: null,
      branchPercent: null,
      fileCount: 0,
    },
    fileMetrics: new Map<string, FileCoverageMetrics>(),
  };
}

function inferHasRelatedTests(filePath: string, tests: string[]): boolean {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const dir = path.dirname(filePath);
  return tests.some((testPath) => {
    const lower = testPath.toLowerCase();
    return lower.includes(base) || path.dirname(lower).startsWith(dir.toLowerCase());
  });
}

function readFileContent(cwd: string, relPath: string): string {
  try {
    return fs.readFileSync(path.join(cwd, relPath), "utf-8");
  } catch {
    return "";
  }
}

function computeComplexityScore(content: string): number {
  if (!content) return 0;
  const keywords = (content.match(/\b(if|for|while|switch|catch|case|throw|await|Promise)\b/g) || []).length;
  const operators = (content.match(/&&|\|\||\?/g) || []).length;
  return keywords + operators;
}

function detectRiskReasons(filePath: string, content: string): { reasons: string[]; weight: number } {
  const lower = `${filePath}\n${content}`.toLowerCase();
  const reasons: string[] = [];
  let weight = 0;

  const push = (reason: string, score: number): void => {
    reasons.push(reason);
    weight += score;
  };

  if (/stripe|payment|webhook|invoice|billing/.test(lower)) push("handles payments/webhooks", 18);
  if (/auth|jwt|token|password|session|oauth|cognito/.test(lower)) push("contains authentication/security logic", 14);
  if (/prisma|typeorm|sequelize|sql|mongodb|redis|database|query/.test(lower)) push("touches persistence/database boundaries", 12);
  if (/axios|fetch\(|http|https|request|api client|external service/.test(lower)) push("calls external APIs/services", 8);
  if (/queue|worker|cron|scheduler|job/.test(lower)) push("contains async/background processing", 7);
  if (/child_process|exec\(|spawn\(|fs\./.test(lower)) push("uses process/filesystem side effects", 6);

  return { reasons, weight };
}

function getChurn30d(cwd: string, relPath: string): number {
  const output = safeExec(
    `git log --since='30 days ago' --pretty=format:%H -- '${relPath.replace(/'/g, "'\\''")}' | wc -l`,
    cwd,
    8_000,
  );
  const parsed = Number.parseInt(output, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildHighRiskUntestedModules(
  cwd: string,
  scan: ScanSummary,
  coverage: CoverageParseResult,
): HighRiskModule[] {
  const sourceModules = scan.filePaths.filter((relPath) => SOURCE_FILE_REGEX.test(relPath) && !TEST_FILE_REGEX.test(relPath));
  if (sourceModules.length === 0) return [];

  const allTests = [...scan.unitTestPaths, ...scan.integrationTestPaths, ...scan.e2eTestPaths];
  const preliminary: Array<Omit<HighRiskModule, "churn30d" | "riskScore"> & { preliminaryScore: number }> = [];

  for (const filePath of sourceModules) {
    const content = readFileContent(cwd, filePath);
    if (!content) continue;

    const lineCount = Math.max(1, content.split(/\r?\n/).length);
    const complexityScore = computeComplexityScore(content);
    const riskHints = detectRiskReasons(filePath, content);

    const coverageEntry = coverage.fileMetrics.get(normalizeRelPath(filePath, cwd));
    const hasMeasuredCoverage = coverage.snapshot.source !== "none";

    let lineCoveragePercent = 0;
    let branchCoveragePercent: number | null = null;
    let coverageConfidence: "measured" | "inferred" = "inferred";
    let qualifiesAsUntested = false;

    if (hasMeasuredCoverage) {
      lineCoveragePercent = coverageEntry ? coverageEntry.linePercent : 0;
      branchCoveragePercent = coverageEntry?.branchPercent ?? null;
      coverageConfidence = "measured";
      qualifiesAsUntested = lineCoveragePercent <= 0;
    } else {
      const hasRelatedTests = inferHasRelatedTests(filePath, allTests);
      lineCoveragePercent = hasRelatedTests ? 15 : 0;
      qualifiesAsUntested = !hasRelatedTests;
    }

    if (!qualifiesAsUntested) continue;

    const lineWeight = Math.min(25, lineCount * 0.03);
    const complexityWeight = Math.min(35, complexityScore * 0.12);
    const coverageWeight = hasMeasuredCoverage ? 20 : 12;

    preliminary.push({
      filePath,
      lineCount,
      complexityScore,
      lineCoveragePercent,
      branchCoveragePercent,
      coverageConfidence,
      reasons: riskHints.reasons,
      preliminaryScore: lineWeight + complexityWeight + riskHints.weight + coverageWeight,
    });
  }

  if (preliminary.length === 0) return [];

  const topCandidates = preliminary
    .sort((a, b) => b.preliminaryScore - a.preliminaryScore)
    .slice(0, 30);

  const enriched: HighRiskModule[] = topCandidates.map((candidate) => {
    const churn30d = getChurn30d(cwd, candidate.filePath);
    const churnWeight = Math.min(20, churn30d * 2.5);
    const riskScore = clampPercent(candidate.preliminaryScore + churnWeight);
    return {
      filePath: candidate.filePath,
      lineCount: candidate.lineCount,
      complexityScore: candidate.complexityScore,
      churn30d,
      lineCoveragePercent: candidate.lineCoveragePercent,
      branchCoveragePercent: candidate.branchCoveragePercent,
      riskScore,
      coverageConfidence: candidate.coverageConfidence,
      reasons: candidate.reasons,
    };
  });

  return enriched.sort((a, b) => b.riskScore - a.riskScore).slice(0, 5);
}

function buildEntryPointSet(cwd: string, sourceModules: string[]): Set<string> {
  const entry = new Set<string>();
  const sourceSet = new Set(sourceModules);

  for (const relPath of sourceModules) {
    const base = path.basename(relPath, path.extname(relPath)).toLowerCase();
    const lower = relPath.toLowerCase();
    if (/^(index|main|app|server|cli|__main__)$/.test(base)) entry.add(relPath);
    if (/(^|\/)(bin|scripts?|cmd)\//.test(lower)) entry.add(relPath);
    if (/frontend\/src\/main\./.test(lower)) entry.add(relPath);
  }

  if (fs.existsSync(path.join(cwd, "package.json"))) {
    const pkg = tryReadJson<{ scripts?: Record<string, string> }>(path.join(cwd, "package.json"));
    const scripts = pkg?.scripts || {};
    const pathTokenRegex = /(?:^|\s)([./A-Za-z0-9_-]+\/[^\s'"`]+?\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|cs|php|rb|swift|kt))/g;
    for (const command of Object.values(scripts)) {
      let match: RegExpExecArray | null;
      while ((match = pathTokenRegex.exec(command)) !== null) {
        const token = match[1].replace(/^\.?\//, "").replace(/\\/g, "/");
        if (sourceSet.has(token)) entry.add(token);
      }
    }
  }

  return entry;
}

function resolveSpecifierToSource(
  sourceSet: Set<string>,
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier) return null;
  if (specifier.startsWith("node:")) return null;
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    // best-effort Python-style package imports (e.g. "api.services.user")
    const pyPath = `${specifier.replace(/\./g, "/")}.py`;
    if (sourceSet.has(pyPath)) return pyPath;
    const pyInit = `${specifier.replace(/\./g, "/")}/__init__.py`;
    if (sourceSet.has(pyInit)) return pyInit;
    return null;
  }

  const fromDir = path.dirname(fromFile);
  const normalized = path.posix.normalize(path.posix.join(fromDir, specifier));
  const candidates = [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}.py`,
    `${normalized}.go`,
    `${normalized}.java`,
    `${normalized}.rs`,
    `${normalized}.cs`,
    `${normalized}.php`,
    `${normalized}.rb`,
    `${normalized}.swift`,
    `${normalized}.kt`,
    path.posix.join(normalized, "index.ts"),
    path.posix.join(normalized, "index.tsx"),
    path.posix.join(normalized, "index.js"),
    path.posix.join(normalized, "index.py"),
    path.posix.join(normalized, "__init__.py"),
  ];
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (sourceSet.has(normalizedCandidate)) return normalizedCandidate;
  }
  return null;
}

function extractImportSpecifiers(relPath: string, content: string): string[] {
  const ext = path.extname(relPath).toLowerCase();
  const specs = new Set<string>();

  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    const fromRegex = /\b(?:import|export)\s+(?:[\w*\s{},$]+\s+from\s+)?["'`]([^"'`]+)["'`]/g;
    const requireRegex = /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
    const dynamicRegex = /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
    for (const regex of [fromRegex, requireRegex, dynamicRegex]) {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) specs.add(match[1]);
    }
  } else if (ext === ".py") {
    const fromRegex = /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm;
    const importRegex = /^\s*import\s+([A-Za-z0-9_\.]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(content)) !== null) specs.add(match[1]);
    while ((match = importRegex.exec(content)) !== null) specs.add(match[1]);
  }

  return [...specs];
}

function buildReferenceStats(cwd: string, scan: ScanSummary): {
  sourceModules: string[];
  inboundRefs: Map<string, number>;
  inboundFromTests: Map<string, number>;
  entryPoints: Set<string>;
} {
  const sourceModules = scan.filePaths.filter((relPath) => SOURCE_FILE_REGEX.test(relPath) && !TEST_FILE_REGEX.test(relPath));
  const sourceSet = new Set(sourceModules);
  const inboundRefs = new Map<string, number>();
  const inboundFromTests = new Map<string, number>();

  const filesToParse = [...sourceModules, ...scan.unitTestPaths, ...scan.integrationTestPaths, ...scan.e2eTestPaths];
  const testSet = new Set([...scan.unitTestPaths, ...scan.integrationTestPaths, ...scan.e2eTestPaths]);

  for (const relPath of filesToParse) {
    const content = readFileContent(cwd, relPath);
    if (!content) continue;
    const specs = extractImportSpecifiers(relPath, content);
    for (const spec of specs) {
      const resolved = resolveSpecifierToSource(sourceSet, relPath, spec);
      if (!resolved || resolved === relPath) continue;
      inboundRefs.set(resolved, (inboundRefs.get(resolved) || 0) + 1);
      if (testSet.has(relPath)) {
        inboundFromTests.set(resolved, (inboundFromTests.get(resolved) || 0) + 1);
      }
    }
  }

  const entryPoints = buildEntryPointSet(cwd, sourceModules);
  return { sourceModules, inboundRefs, inboundFromTests, entryPoints };
}

function getLastTouchedDays(cwd: string, relPath: string): number | null {
  const escaped = relPath.replace(/'/g, "'\\''");
  const timestampRaw = safeExec(`git log -1 --format=%ct -- '${escaped}'`, cwd, 8_000);
  if (!timestampRaw) return null;
  const ts = Number.parseInt(timestampRaw, 10);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const diffMs = Date.now() - ts * 1000;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function isLikelyIntentionalStandaloneFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (/(^|\/)(scripts?|bin|cmd|tools)\//.test(lower)) return true;
  if (/(^|\/)(migrations?|seed|fixtures?|examples?|docs?)\//.test(lower)) return true;
  if (/(\.|\/)(config|settings)\./.test(lower)) return true;
  return false;
}

function deriveDeadCodeCandidates(
  modules: ModuleHealth[],
  runtimeConfig: DoctorRuntimeConfig,
): DeadCodeCandidate[] {
  if (!runtimeConfig.deadCodeEnabled || runtimeConfig.deadCodeMaxCandidates <= 0) return [];
  const candidates = modules
    .filter((module) => module.status === "dead")
    .sort((a, b) => {
      const aDays = a.lastTouchedDays ?? -1;
      const bDays = b.lastTouchedDays ?? -1;
      if (aDays !== bDays) return bDays - aDays;
      return b.riskScore - a.riskScore;
    })
    .slice(0, runtimeConfig.deadCodeMaxCandidates)
    .map((module) => ({
      filePath: module.filePath,
      reason: module.evidence[0] || "Unreferenced and stale candidate.",
      lastTouchedDays: module.lastTouchedDays,
      inboundReferences: module.inboundReferences,
      lineCoveragePercent: module.lineCoveragePercent,
      confidence: module.confidence,
    }));
  return candidates;
}

function computeHealthSnapshot(moduleHealth: ModuleHealth[]): HealthSnapshot {
  const snapshot: HealthSnapshot = { totalModules: moduleHealth.length, functioning: 0, trouble: 0, dead: 0, unknown: 0 };
  for (const module of moduleHealth) {
    snapshot[module.status] += 1;
  }
  return snapshot;
}

function computeHealthDelta(previous: ModuleHealth[] | undefined, current: ModuleHealth[]): HealthDelta {
  if (!previous || previous.length === 0) {
    return { improved: 0, regressed: 0, unchanged: 0, newModules: current.length };
  }
  const rank: Record<ModuleHealthStatus, number> = {
    dead: 0,
    trouble: 1,
    unknown: 2,
    functioning: 3,
  };
  const prevMap = new Map(previous.map((module) => [module.filePath, module.status]));
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  let newModules = 0;
  for (const module of current) {
    const prevStatus = prevMap.get(module.filePath);
    if (!prevStatus) {
      newModules += 1;
      continue;
    }
    const prevRank = rank[prevStatus];
    const currentRank = rank[module.status];
    if (currentRank > prevRank) improved += 1;
    else if (currentRank < prevRank) regressed += 1;
    else unchanged += 1;
  }
  return { improved, regressed, unchanged, newModules };
}

function buildModuleHealth(
  cwd: string,
  scan: ScanSummary,
  coverage: CoverageParseResult,
  ciFailureSignals: CiFailureSignal[],
  qualityEvidence: DoctorCommandEvidence[],
  runtimeConfig: DoctorRuntimeConfig,
): ModuleHealth[] {
  const { sourceModules, inboundRefs, inboundFromTests, entryPoints } = buildReferenceStats(cwd, scan);
  const allTests = [...scan.unitTestPaths, ...scan.integrationTestPaths, ...scan.e2eTestPaths];
  const ciRegressionFiles = new Set(
    ciFailureSignals
      .filter((signal) => signal.classification === "regression")
      .flatMap((signal) => signal.filePaths || []),
  );
  const qualityFailed = qualityEvidence.some((entry) => entry.status === "failed");

  const modules: ModuleHealth[] = [];
  for (const filePath of sourceModules) {
    const content = readFileContent(cwd, filePath);
    if (!content) continue;

    const lineCount = Math.max(1, content.split(/\r?\n/).length);
    const complexityScore = computeComplexityScore(content);
    const churn30d = getChurn30d(cwd, filePath);
    const lastTouchedDays = getLastTouchedDays(cwd, filePath);
    const inboundReferences = inboundRefs.get(filePath) || 0;
    const testReferences = inboundFromTests.get(filePath) || 0;
    const referencedByTests = testReferences > 0 || inferHasRelatedTests(filePath, allTests);
    const entryPoint = entryPoints.has(filePath);
    const riskHints = detectRiskReasons(filePath, content);

    const coverageEntry = coverage.fileMetrics.get(normalizeRelPath(filePath, cwd));
    const hasMeasuredCoverage = coverage.snapshot.source !== "none";
    const lineCoveragePercent = hasMeasuredCoverage ? (coverageEntry?.linePercent ?? 0) : (referencedByTests ? 15 : 0);
    const branchCoveragePercent = hasMeasuredCoverage ? (coverageEntry?.branchPercent ?? null) : null;
    const coverageConfidence: "measured" | "inferred" = hasMeasuredCoverage ? "measured" : "inferred";

    const lineWeight = Math.min(25, lineCount * 0.03);
    const complexityWeight = Math.min(35, complexityScore * 0.12);
    const coverageWeight = hasMeasuredCoverage ? 20 : 12;
    const churnWeight = Math.min(20, churn30d * 2.5);
    const riskScore = clampPercent(lineWeight + complexityWeight + riskHints.weight + coverageWeight + churnWeight);

    const ciRegressionHits = ciRegressionFiles.has(filePath) ? 1 : 0;

    let healthScore = 50;
    if (hasMeasuredCoverage) {
      healthScore += Math.round((lineCoveragePercent / 100) * 35);
      if (lineCoveragePercent < 15) healthScore -= 20;
    } else if (referencedByTests) {
      healthScore += 8;
    } else {
      healthScore -= 12;
    }
    healthScore -= Math.min(18, complexityScore * 0.05);
    healthScore -= Math.min(14, Math.max(0, churn30d - 2) * 1.2);
    healthScore -= ciRegressionHits * 25;
    if (qualityFailed) healthScore -= 4;
    if (riskScore >= runtimeConfig.riskTroubleThreshold) healthScore -= 8;
    healthScore = clampPercent(healthScore);

    const deadCandidate =
      runtimeConfig.deadCodeEnabled &&
      !entryPoint &&
      !isLikelyIntentionalStandaloneFile(filePath) &&
      inboundReferences === 0 &&
      !referencedByTests &&
      lineCoveragePercent <= 0 &&
      churn30d === 0 &&
      lastTouchedDays !== null &&
      lastTouchedDays >= runtimeConfig.deadCodeMinDays;

    let status: ModuleHealthStatus = "unknown";
    const measuredZeroCoverageTrouble =
      hasMeasuredCoverage &&
      lineCoveragePercent <= 0 &&
      riskScore >= Math.max(25, runtimeConfig.riskTroubleThreshold - 25);
    if (deadCandidate) status = "dead";
    else if (
      ciRegressionHits > 0 ||
      measuredZeroCoverageTrouble ||
      (lineCoveragePercent <= 0 && riskScore >= runtimeConfig.riskTroubleThreshold) ||
      (healthScore <= runtimeConfig.healthTroubleThreshold && riskScore >= runtimeConfig.riskTroubleThreshold - 10)
    ) {
      status = "trouble";
    } else if (
      healthScore >= runtimeConfig.healthFunctioningThreshold &&
      (lineCoveragePercent >= 55 || (!hasMeasuredCoverage && referencedByTests))
    ) {
      status = "functioning";
    }

    let confidence: ConfidenceLevel = "low";
    if (status === "dead") confidence = "high";
    else if (hasMeasuredCoverage || ciRegressionHits > 0) confidence = "high";
    else if (referencedByTests || riskHints.reasons.length > 0) confidence = "medium";

    const evidence: string[] = [];
    evidence.push(`coverage ${lineCoveragePercent}%${branchCoveragePercent == null ? "" : ` (branches ${branchCoveragePercent}%)`}`);
    evidence.push(`complexity ${complexityScore}, churn ${churn30d}/30d, inbound refs ${inboundReferences}`);
    if (lastTouchedDays != null) evidence.push(`last touched ${lastTouchedDays} days ago`);
    if (riskHints.reasons.length > 0) evidence.push(`risk signals: ${riskHints.reasons.join(", ")}`);
    if (ciRegressionHits > 0) evidence.push("implicated in recurring CI regression");
    if (!hasMeasuredCoverage) evidence.push("coverage inferred from test references (no lcov/xml report)");

    if (deadCandidate) {
      evidence.unshift(
        `unreferenced for ${lastTouchedDays ?? "?"}+ days, no test references, zero coverage, and zero recent churn`,
      );
    }

    modules.push({
      filePath,
      status,
      confidence,
      healthScore,
      riskScore,
      lineCoveragePercent,
      branchCoveragePercent,
      coverageConfidence,
      lineCount,
      complexityScore,
      churn30d,
      lastTouchedDays,
      inboundReferences,
      referencedByTests,
      ciRegressionHits,
      evidence,
    });
  }

  return modules.sort((a, b) => b.riskScore - a.riskScore);
}

function deriveHighRiskUntestedModules(
  moduleHealth: ModuleHealth[],
  runtimeConfig: DoctorRuntimeConfig,
): HighRiskModule[] {
  const strict = moduleHealth
    .filter((module) => module.status === "trouble" && (module.lineCoveragePercent ?? 0) <= 0)
    .sort((a, b) => b.riskScore - a.riskScore);

  const fallback = moduleHealth
    .filter(
      (module) =>
        (module.status === "unknown" || module.status === "trouble") &&
        (module.lineCoveragePercent ?? 0) <= 0,
    )
    .sort((a, b) => b.riskScore - a.riskScore);

  const merged = [...strict, ...fallback].filter(
    (module, index, all) => all.findIndex((candidate) => candidate.filePath === module.filePath) === index,
  );

  return merged.slice(0, runtimeConfig.maxHighRiskModules).map((module) => ({
      filePath: module.filePath,
      lineCount: module.lineCount,
      complexityScore: module.complexityScore,
      churn30d: module.churn30d,
      lineCoveragePercent: module.lineCoveragePercent ?? 0,
      branchCoveragePercent: module.branchCoveragePercent,
      riskScore: module.riskScore,
      coverageConfidence: module.coverageConfidence,
      reasons: module.evidence.filter((item) => item.startsWith("risk signals:")).map((item) => item.replace("risk signals: ", "")),
    }));
}

function extractFailureSignature(rawLog: string): string {
  const cleaned = rawLog.replace(/\x1B\[[0-9;]*[mK]/g, "");
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = lines.find((line) => /error|failed|exception|assertion|cannot find|panic|traceback/i.test(line));
  return normalizeCommandOutput(preferred || lines[0] || "unknown failure");
}

function isGenericFailureSignature(signature: string): boolean {
  const value = signature.trim().toLowerCase();
  return (
    value === "" ||
    value === "failure" ||
    value === "unknown failure" ||
    value === "job failed" ||
    value === "process completed with exit code 1"
  );
}

function extractFailureFilePaths(rawLog: string): string[] {
  if (!rawLog) return [];
  const cleaned = rawLog.replace(/\x1B\[[0-9;]*[mK]/g, "");
  const matches = cleaned.match(/(?:^|[\s"'`])((?:src|app|api|server|backend|frontend|packages|tests?)\/[^\s"'`]+?\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|cs|php|rb|swift|kt))/gm) || [];
  const normalized = matches
    .map((entry) => {
      const value = entry.trim().replace(/^[\s"'`]+/, "");
      return value;
    })
    .filter(Boolean)
    .map((value) => value.replace(/[:),;]+$/, ""))
    .map((value) => value.replace(/\\/g, "/"));
  return [...new Set(normalized)].slice(0, 5);
}

function collectCiFailureSignals(cwd: string): CiFailureSignal[] {
  const listRaw = safeExec(
    "gh run list --limit 60 --json databaseId,workflowName,name,conclusion,status,createdAt,headSha",
    cwd,
    15_000,
  );
  if (!listRaw) return [];

  let runs: GhRunListItem[] = [];
  try {
    runs = JSON.parse(listRaw) as GhRunListItem[];
  } catch {
    return [];
  }

  if (!Array.isArray(runs) || runs.length === 0) return [];

  const failed = runs.filter((run) => run.conclusion === "failure" && typeof run.databaseId === "number").slice(0, 8);
  if (failed.length === 0) return [];

  const signatureStats = new Map<string, { count: number; shas: Set<string> }>();
  const signals: Array<Omit<CiFailureSignal, "classification"> & { headSha?: string; workflow: string }> = [];

  for (const run of failed) {
    const runId = run.databaseId!;
    const workflow = run.workflowName || run.name || "unknown workflow";
    const failedLog = safeExec(`gh run view ${runId} --log-failed`, cwd, 20_000);
    const signature = extractFailureSignature(failedLog || run.conclusion || "failure");
    const stat = signatureStats.get(signature) || { count: 0, shas: new Set<string>() };
    stat.count += 1;
    if (run.headSha) stat.shas.add(run.headSha);
    signatureStats.set(signature, stat);
    const filePaths = extractFailureFilePaths(failedLog || "");

    signals.push({
      runId,
      workflow,
      createdAt: run.createdAt || "unknown",
      signature,
      filePaths,
      details: failedLog ? normalizeCommandOutput(failedLog) : "No failed log output available.",
      headSha: run.headSha,
    });
  }

  const successRuns = runs.filter((run) => run.conclusion === "success");

  return signals.map((signal) => {
    const hasRecoverySuccess = successRuns.some((success) => {
      if (!success.headSha || !signal.headSha) return false;
      return success.workflowName === signal.workflow && success.headSha === signal.headSha;
    });

    const stat = signatureStats.get(signal.signature);
    const signatureCount = stat?.count || 0;
    const distinctShas = stat?.shas.size || 0;
    const signatureIsGeneric = isGenericFailureSignature(signal.signature);
    const hasActionableSignal = signal.filePaths.length > 0 || !signatureIsGeneric;

    let classification: "regression" | "flake" | "unknown" = "unknown";
    if (hasActionableSignal) {
      if (hasRecoverySuccess && distinctShas <= 1 && signatureCount <= 2) classification = "flake";
      else if ((signatureCount >= 2 && distinctShas >= 2) || signatureCount >= 3) classification = "regression";
    }

    return {
      runId: signal.runId,
      workflow: signal.workflow,
      createdAt: signal.createdAt,
      signature: signal.signature,
      classification,
      filePaths: signal.filePaths,
      details: signal.details,
    };
  });
}

function sortGaps(gaps: DoctorGap[]): DoctorGap[] {
  const rank: Record<DoctorSeverity, number> = { high: 0, medium: 1, low: 2 };
  return [...gaps].sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    const aPriority = a.priority ?? a.riskScore ?? 0;
    const bPriority = b.priority ?? b.riskScore ?? 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return a.title.localeCompare(b.title);
  });
}

function computeDelta(previousGapIds: string[], currentGapIds: string[]): DoctorDelta {
  const prev = new Set(previousGapIds);
  const curr = new Set(currentGapIds);
  let newGaps = 0;
  let persistingGaps = 0;
  for (const id of curr) {
    if (prev.has(id)) persistingGaps++;
    else newGaps++;
  }
  let resolvedGaps = 0;
  for (const id of prev) {
    if (!curr.has(id)) resolvedGaps++;
  }
  return { newGaps, resolvedGaps, persistingGaps };
}

function slugifyForGapId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function buildVerificationCommands(qualityEvidence: DoctorCommandEvidence[]): string[] {
  const commands = qualityEvidence
    .map((entry) => entry.command)
    .filter((command): command is string => typeof command === "string" && command !== "none");
  return commands.length > 0 ? [...new Set(commands)] : [];
}

function inferCoverageVerificationCommand(languages: string[]): string | null {
  if (languages.some((lang) => lang.includes("javascript") || lang.includes("typescript"))) {
    return "npm run test:coverage";
  }
  if (languages.includes("python")) return "pytest --cov";
  if (languages.includes("go")) return "go test ./... -cover";
  if (languages.includes("rust")) return "cargo test";
  return null;
}

function createGaps(
  scan: ScanSummary,
  languages: string[],
  frameworks: string[],
  qualityEvidence: DoctorCommandEvidence[],
  moduleHealth: ModuleHealth[],
  highRiskUntestedModules: HighRiskModule[],
  deadCodeCandidates: DeadCodeCandidate[],
  ciFailureSignals: CiFailureSignal[],
  coverage: CoverageParseResult,
  previousAppliedIds: Set<string>,
): DoctorGap[] {
  const gaps: DoctorGap[] = [];
  const hasBackendSignal = scan.filePaths.some((p) => /(^|\/)(api|server|backend|services?)\//i.test(p));
  const hasUiSignal = scan.filePaths.some((p) => /(^|\/)(web|app|frontend|client|ui)\//i.test(p));
  const failedQualityCommands = qualityEvidence.filter((entry) => entry.status === "failed");
  const ciRegressions = ciFailureSignals.filter((signal) => signal.classification === "regression");
  const verificationCommands = buildVerificationCommands(qualityEvidence);
  const coverageVerification = inferCoverageVerificationCommand(languages);
  const markCureStatus = (id: string): "open" | "stale" => (previousAppliedIds.has(id) ? "stale" : "open");

  if (failedQualityCommands.length > 0) {
    const id = "failing-quality-commands";
    gaps.push({
      id,
      severity: "high",
      problemClass: "failing_quality",
      targetFiles: [],
      title: "Detected failing quality/test commands",
      evidence: failedQualityCommands.map((entry) => `${entry.command}: ${entry.output}`),
      prescription: "Stabilize baseline test/quality command failures before expanding coverage work.",
      buildTask: "Fix current failing tests/quality commands so baseline suite passes reliably.",
      verificationCommands: failedQualityCommands.map((entry) => entry.command).filter((command) => command && command !== "none"),
      successCriteria: ["All previously failing baseline quality/test commands pass."],
      cureStatus: markCureStatus(id),
      priority: 110,
    });
  }

  if (ciRegressions.length > 0) {
    const top = ciRegressions[0];
    const id = `ci-regression-${slugifyForGapId(top.workflow)}`;
    gaps.push({
      id,
      severity: "high",
      problemClass: "ci_regression",
      targetFiles: top.filePaths || [],
      title: `Recurring CI regression in ${top.workflow}`,
      evidence: ciRegressions.slice(0, 3).map((signal) => {
        const files = signal.filePaths.length > 0 ? ` [files: ${signal.filePaths.join(", ")}]` : "";
        return `run ${signal.runId}: ${signal.signature}${files}`;
      }),
      prescription: "Investigate recurring CI failures and eliminate the root cause before adding new feature work.",
      buildTask:
        `Fix recurring CI regression in ${top.workflow}. Reproduce failure signature "${top.signature}"` +
        `${top.filePaths.length > 0 ? ` focusing on ${top.filePaths.join(", ")}` : ""} and make CI green.`,
      verificationCommands: [
        ...(verificationCommands.slice(0, 2)),
        `gh run view ${top.runId} --log-failed`,
      ].filter(Boolean),
      successCriteria: [
        `Failure signature "${top.signature}" no longer appears in the next successful CI run.`,
        "No new regression-classified CI signals for the same workflow.",
      ],
      cureStatus: markCureStatus(id),
      priority: 100,
    });
  }

  highRiskUntestedModules.forEach((module, index) => {
    const severity: DoctorSeverity = index < 3 ? "high" : "medium";
    const reasonText = module.reasons.length > 0 ? module.reasons.join(", ") : "high complexity/churn";
    const coverageLabel = module.coverageConfidence === "measured" ? "zero measured coverage" : "no inferred test coverage";
    const id = `module-zero-coverage-${slugifyForGapId(module.filePath)}`;
    gaps.push({
      id,
      severity,
      problemClass: "coverage_risk",
      targetFiles: [module.filePath],
      title: `High-risk module lacks coverage: ${module.filePath}`,
      evidence: [
        `${coverageLabel}; ${module.lineCount} lines; complexity ${module.complexityScore}; modified ${module.churn30d} times in last 30 days; risk score ${module.riskScore}.`,
      ],
      prescription: "Add targeted tests around failure-prone code paths and critical side effects for this module.",
      buildTask:
        `Add tests for ${module.filePath} — ${reasonText}, ` +
        `${coverageLabel}, ${module.lineCount} lines, modified ${module.churn30d} times in last 30 days.`,
      riskScore: module.riskScore,
      priority: module.riskScore,
      verificationCommands: [
        ...verificationCommands.slice(0, 2),
        ...(coverageVerification ? [coverageVerification] : []),
      ],
      successCriteria: [
        `Increase coverage for ${module.filePath} above 30% as an initial stabilization target.`,
        "Baseline deterministic quality commands pass after coverage additions.",
      ],
      cureStatus: markCureStatus(id),
    });
  });

  deadCodeCandidates.forEach((candidate, idx) => {
    const id = `dead-code-${slugifyForGapId(candidate.filePath)}`;
    gaps.push({
      id,
      severity: idx < 2 ? "high" : "medium",
      problemClass: "dead_code",
      targetFiles: [candidate.filePath],
      title: `Dead-code candidate: ${candidate.filePath}`,
      evidence: [
        candidate.reason,
        `inbound references: ${candidate.inboundReferences}; coverage: ${candidate.lineCoveragePercent ?? "n/a"}%; last touched: ${candidate.lastTouchedDays ?? "unknown"} days`,
      ],
      prescription: "Confirm reachability, then remove/archive dead code or wire required references with tests if still needed.",
      buildTask:
        `Audit dead-code candidate ${candidate.filePath}. If unreachable, remove it and update imports/tests; ` +
        `if required, add explicit references and tests proving runtime usage.`,
      verificationCommands: [
        ...verificationCommands.slice(0, 2),
        ...(coverageVerification ? [coverageVerification] : []),
      ],
      successCriteria: [
        "No unresolved imports/runtime errors after removal or reintegration.",
        "File is either removed or covered by a concrete runtime test path.",
      ],
      cureStatus: markCureStatus(id),
      priority: 88 - idx,
    });
  });

  if (coverage.snapshot.source === "none") {
    const id = "missing-coverage-report";
    gaps.push({
      id,
      severity: "medium",
      problemClass: "baseline",
      targetFiles: [],
      title: "No machine-readable coverage report found",
      evidence: ["Expected coverage/lcov.info or coverage.xml but neither exists."],
      prescription: "Enable deterministic coverage artifact generation so doctor can measure real module risk.",
      buildTask: "Add a coverage command that emits coverage/lcov.info or coverage.xml and wire it into CI.",
      verificationCommands: [...verificationCommands.slice(0, 2), ...(coverageVerification ? [coverageVerification] : [])],
      successCriteria: ["Coverage artifact exists at coverage/lcov.info or coverage.xml after running test coverage command."],
      cureStatus: markCureStatus(id),
      priority: 72,
    });
  }

  if (qualityEvidence.every((entry) => entry.status === "skipped")) {
    const id = "no-runnable-quality-command";
    gaps.push({
      id,
      severity: "medium",
      problemClass: "baseline",
      targetFiles: [],
      title: "No deterministic test command detected",
      evidence: ["Could not identify a safe, non-interactive test command to execute."],
      prescription: "Define at least one deterministic test command (`test` or `test:ci`) and wire it to CI.",
      buildTask: "Add deterministic project test command and ensure it runs non-interactively in CI.",
      verificationCommands: ["npm run test || pnpm test || yarn test"],
      successCriteria: ["A deterministic test command is available and exits non-zero on failure."],
      cureStatus: markCureStatus(id),
      priority: 65,
    });
  }

  if (highRiskUntestedModules.length === 0) {
    if (scan.unitTestPaths.length === 0) {
      const id = "missing-unit-tests";
      gaps.push({
        id,
        severity: "high",
        problemClass: "baseline",
        targetFiles: [],
        title: "No unit test baseline detected",
        evidence: ["No common unit test file patterns found in repository."],
        prescription: "Bootstrap a minimal unit test harness aligned to detected language/framework and add first critical unit tests.",
        buildTask: "Add a minimal unit test baseline for core domain logic and critical utility modules.",
        verificationCommands: [...verificationCommands.slice(0, 2)],
        successCriteria: ["At least one deterministic unit test suite runs in CI."],
        cureStatus: markCureStatus(id),
        priority: 84,
      });
    }

    if (scan.e2eTestPaths.length === 0 && (hasBackendSignal || hasUiSignal)) {
      const id = "missing-ete";
      gaps.push({
        id,
        severity: "high",
        problemClass: "baseline",
        targetFiles: [],
        title: "No E2E/ETE coverage for critical workflows",
        evidence: ["No e2e/ete/workflow test directories or files detected."],
        prescription: "Add ETE tests for core business flows (auth, create/update, failure handling) reusing existing test stack.",
        buildTask: "Add E2E/ETE coverage for top user workflows and failure paths using existing stack.",
        verificationCommands: [...verificationCommands.slice(0, 2)],
        successCriteria: ["Critical workflow E2E/ETE tests exist and pass in deterministic mode."],
        cureStatus: markCureStatus(id),
        priority: 82,
      });
    }
  }

  if (scan.integrationTestPaths.length === 0 && hasBackendSignal) {
    const id = "missing-integration";
    gaps.push({
      id,
      severity: "medium",
      problemClass: "baseline",
      targetFiles: [],
      title: "No integration/contract tests detected",
      evidence: ["Backend-like folders exist but no integration or contract tests were found."],
      prescription: "Add API contract/integration tests for high-risk endpoints and data boundaries.",
      buildTask: "Add integration/API contract tests for highest-risk endpoints and data boundaries.",
      verificationCommands: [...verificationCommands.slice(0, 2)],
      successCriteria: ["Integration/API contract tests run and pass deterministically."],
      cureStatus: markCureStatus(id),
      priority: 68,
    });
  }

  if (languages.some((l) => l.includes("javascript") || l.includes("typescript")) && frameworks.length === 0) {
    const id = "unknown-js-test-framework";
    gaps.push({
      id,
      severity: "medium",
      problemClass: "baseline",
      targetFiles: [],
      title: "JavaScript/TypeScript repo without detected test framework",
      evidence: ["package.json present but no known test framework dependency detected."],
      prescription: "Introduce a minimal default test stack (vitest + optional playwright for ETE) without replacing existing architecture.",
      buildTask: "Introduce a lightweight JS/TS test framework aligned with the existing codebase and CI.",
      verificationCommands: ["npm run test"],
      successCriteria: ["Test framework dependency installed and deterministic test command available."],
      cureStatus: markCureStatus(id),
      priority: 62,
    });
  }

  // If many modules remain in trouble even after prescriptions, surface a root-cause bundle
  const troubledModules = moduleHealth.filter((module) => module.status === "trouble");
  if (troubledModules.length >= 8) {
    const id = "trouble-cluster-root-cause";
    gaps.push({
      id,
      severity: "high",
      problemClass: "coverage_risk",
      targetFiles: troubledModules.slice(0, 8).map((module) => module.filePath),
      title: "Large cluster of troubled modules indicates systemic test-health debt",
      evidence: [
        `${troubledModules.length} modules currently marked as trouble.`,
        `Top affected: ${troubledModules.slice(0, 5).map((module) => module.filePath).join(", ")}`,
      ],
      prescription: "Prioritize shared test infrastructure and harness fixes before module-by-module patching.",
      buildTask:
        "Stabilize core testing infrastructure (fixtures, deterministic setup, shared helpers) then cover the top troubled modules in descending risk order.",
      verificationCommands: [...verificationCommands.slice(0, 2), ...(coverageVerification ? [coverageVerification] : [])],
      successCriteria: [
        "Trouble module count decreases by at least 30% in the next doctor run.",
        "No baseline quality command failures remain.",
      ],
      cureStatus: markCureStatus(id),
      priority: 95,
    });
  }

  return sortGaps(gaps);
}

function writeDoctorArtifact(cwd: string, issueRef: string | undefined, report: Omit<DoctorReport, "artifactPath">): string {
  const issueKey = (issueRef || "local").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(cwd, ".workermill", "doctor", issueKey);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "latest.json");
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + "\n", "utf-8");
  return filePath;
}

export async function runDoctorAssessment(
  cwd: string,
  issueRef?: string,
  onProgress?: (step: string) => void,
): Promise<DoctorReport> {
  const emit = onProgress || (() => {});

  const runtimeConfig = resolveDoctorRuntimeConfig(cwd);
  const previousPath = path.join(
    cwd,
    ".workermill",
    "doctor",
    (issueRef || "local").replace(/[^a-zA-Z0-9_-]/g, "_"),
    "latest.json",
  );
  const previous = tryReadJson<{
    gaps?: Array<{ id?: string }>;
    appliedPrescriptionIds?: string[];
    moduleHealth?: ModuleHealth[];
  }>(previousPath);
  const previousAppliedSet = new Set((previous?.appliedPrescriptionIds || []).filter(Boolean));

  emit("Scanning files...");
  const filePaths = collectFiles(cwd);
  emit(`Found ${filePaths.length} files — detecting languages and frameworks...`);
  const scan = classifyTests(filePaths);
  const languages = detectLanguages(scan.filePaths, scan.manifests);
  const frameworks = detectFrameworks(cwd, scan.manifests, scan.filePaths);

  const qualityCommands = detectQualityCommands(cwd, scan, languages);
  if (qualityCommands.length > 0) {
    emit(`Running quality commands: ${qualityCommands.join(", ")}...`);
  }
  // Yield to event loop so progress renders before blocking execSync
  await new Promise((r) => setTimeout(r, 0));
  const qualityEvidence = runQualityCommands(cwd, qualityCommands);

  emit("Analyzing coverage and CI signals...");
  const coverage = detectCoverage(cwd);
  const ciFailureSignals = collectCiFailureSignals(cwd);

  emit("Building module health map...");
  const moduleHealth = buildModuleHealth(
    cwd,
    scan,
    coverage,
    ciFailureSignals,
    qualityEvidence,
    runtimeConfig,
  );
  const healthSnapshot = computeHealthSnapshot(moduleHealth);
  const healthDelta = computeHealthDelta(previous?.moduleHealth, moduleHealth);
  const highRiskUntestedModules = deriveHighRiskUntestedModules(moduleHealth, runtimeConfig);
  const deadCodeCandidates = deriveDeadCodeCandidates(moduleHealth, runtimeConfig);

  emit("Generating prescriptions...");
  const gaps = createGaps(
    scan,
    languages,
    frameworks,
    qualityEvidence,
    moduleHealth,
    highRiskUntestedModules,
    deadCodeCandidates,
    ciFailureSignals,
    coverage,
    previousAppliedSet,
  );

  const delta = computeDelta(
    (previous?.gaps || []).map((gap) => gap.id || "").filter(Boolean),
    gaps.map((gap) => gap.id),
  );
  const appliedPrescriptionIds = [...previousAppliedSet].filter((id) => gaps.some((gap) => gap.id === id));
  const staleApplied = gaps.filter((gap) => gap.cureStatus === "stale").length;

  const ciRegressionCount = ciFailureSignals.filter((signal) => signal.classification === "regression").length;
  const ciFlakeCount = ciFailureSignals.filter((signal) => signal.classification === "flake").length;

  const reportNoPath: Omit<DoctorReport, "artifactPath"> = {
    generatedAt: new Date().toISOString(),
    workingDir: cwd,
    issueRef,
    languages,
    frameworks,
    testFileCount: scan.unitTestPaths.length + scan.integrationTestPaths.length + scan.e2eTestPaths.length,
    e2eFileCount: scan.e2eTestPaths.length,
    integrationFileCount: scan.integrationTestPaths.length,
    unitFileCount: scan.unitTestPaths.length,
    coverageSnapshot: coverage.snapshot,
    healthSnapshot,
    healthDelta,
    moduleHealth: moduleHealth
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 200),
    highRiskUntestedModules,
    deadCodeCandidates,
    ciFailureSignals,
    gaps,
    qualityEvidence,
    appliedPrescriptionIds,
    delta,
    summary: [
      `Languages: ${languages.length > 0 ? languages.join(", ") : "unknown"}`,
      `Frameworks: ${frameworks.length > 0 ? frameworks.join(", ") : "none detected"}`,
      `Tests: ${scan.unitTestPaths.length} unit-like, ${scan.integrationTestPaths.length} integration-like, ${scan.e2eTestPaths.length} E2E/ETE`,
      `Coverage: ${coverage.snapshot.source === "none" ? "not found" : `${coverage.snapshot.source} @ ${coverage.snapshot.reportPath || "unknown path"}`}`,
      `Coverage metrics: lines ${coverage.snapshot.linePercent ?? "n/a"}% · branches ${coverage.snapshot.branchPercent ?? "n/a"}% · files ${coverage.snapshot.fileCount}`,
      `Quality commands: ${qualityEvidence.map((entry) => `${entry.status}:${entry.command}`).join(", ")}`,
      `Thresholds: trouble risk >= ${runtimeConfig.riskTroubleThreshold}, health trouble <= ${runtimeConfig.healthTroubleThreshold}, health functioning >= ${runtimeConfig.healthFunctioningThreshold}`,
      `Module health: ${healthSnapshot.functioning} functioning · ${healthSnapshot.trouble} trouble · ${healthSnapshot.dead} dead · ${healthSnapshot.unknown} unknown`,
      `Health delta: +${healthDelta.improved} improved · ${healthDelta.regressed} regressed · ${healthDelta.unchanged} unchanged · ${healthDelta.newModules} new modules`,
      `High-risk untested modules: ${highRiskUntestedModules.length}`,
      `Dead-code candidates: ${deadCodeCandidates.length}`,
      `CI failures analyzed: ${ciFailureSignals.length} (${ciRegressionCount} regressions · ${ciFlakeCount} flakes)`,
      `Gaps identified: ${gaps.length}`,
      `Gap delta: +${delta.newGaps} new · ${delta.persistingGaps} persisting · ${delta.resolvedGaps} resolved`,
      `Previously applied prescriptions still relevant: ${appliedPrescriptionIds.length}`,
      `Applied prescriptions now stale: ${staleApplied}`,
    ],
  };

  const artifactPath = writeDoctorArtifact(cwd, issueRef, reportNoPath);
  return { ...reportNoPath, artifactPath };
}
