import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { runDoctorAssessment } from "../doctor.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wm-doctor-test-"));
}

function writeFile(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

function makeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf-8");
  fs.chmodSync(filePath, 0o755);
}

describe("runDoctorAssessment", () => {
  it("produces actionable prescriptions with build tasks", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, "api/server.ts", "export const ping = () => 'pong';\n");
      const report = await runDoctorAssessment(cwd);

      expect(report.gaps.length).toBeGreaterThan(0);
      expect(report.gaps.every((gap) => typeof gap.buildTask === "string" && gap.buildTask.length > 0)).toBe(true);
      expect(report.qualityEvidence.length).toBeGreaterThan(0);
      expect(report.qualityEvidence[0].status).toBe("skipped");
      expect(report.delta.newGaps).toBe(report.gaps.length);
      expect(fs.existsSync(report.artifactPath)).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("tracks gap delta across reruns", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, "api/server.ts", "export const ping = () => 'pong';\n");
      const first = await runDoctorAssessment(cwd, "#77");
      expect(first.gaps.length).toBeGreaterThan(0);

      writeFile(cwd, "__tests__/server.test.ts", "import { describe, it, expect } from 'vitest'; describe('x',()=>it('y',()=>expect(1).toBe(1)));\n");
      writeFile(cwd, "tests/integration/server.integration.test.ts", "describe('integration', () => {});\n");
      writeFile(cwd, "e2e/server.e2e.test.ts", "describe('e2e', () => {});\n");

      const second = await runDoctorAssessment(cwd, "#77");
      expect(second.delta.resolvedGaps).toBeGreaterThan(0);
      expect(second.delta.persistingGaps + second.delta.newGaps).toBe(second.gaps.length);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("parses lcov coverage and ranks high-risk zero-coverage modules", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, "package.json", JSON.stringify({ name: "doctor-test", version: "1.0.0" }, null, 2));
      writeFile(
        cwd,
        "src/services/payment.ts",
        [
          "export async function handleStripeWebhook(payload: unknown) {",
          "  if (!payload) throw new Error('missing payload');",
          "  const eventType = (payload as { type?: string }).type;",
          "  if (eventType === 'payment_intent.succeeded') return 'ok';",
          "  if (eventType === 'payment_intent.failed') return 'retry';",
          "  return 'ignored';",
          "}",
          "",
        ].join("\n"),
      );
      writeFile(
        cwd,
        "coverage/lcov.info",
        [
          "TN:",
          "SF:src/utils/covered.ts",
          "LF:10",
          "LH:10",
          "BRF:2",
          "BRH:2",
          "end_of_record",
          "",
        ].join("\n"),
      );

      const report = await runDoctorAssessment(cwd);

      expect(report.coverageSnapshot.source).toBe("lcov");
      expect(report.coverageSnapshot.linePercent).toBe(100);
      expect(report.highRiskUntestedModules.length).toBeGreaterThan(0);
      expect(report.highRiskUntestedModules[0].filePath).toContain("src/services/payment.ts");
      expect(report.highRiskUntestedModules[0].coverageConfidence).toBe("measured");
      expect(report.gaps.some((gap) => gap.buildTask.includes("src/services/payment.ts"))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("ignores virtualenv directories when ranking risky modules", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, ".venv/lib/python3.12/site-packages/vendor_pkg/core.py", "def x():\n  return 1\n");
      writeFile(
        cwd,
        "src/services/auth.ts",
        [
          "export function validateToken(token?: string) {",
          "  if (!token) throw new Error('missing token');",
          "  return token.startsWith('wm_');",
          "}",
          "",
        ].join("\n"),
      );

      const report = await runDoctorAssessment(cwd);

      expect(report.highRiskUntestedModules.length).toBeGreaterThan(0);
      expect(report.highRiskUntestedModules.every((module) => !module.filePath.startsWith(".venv/"))).toBe(true);
      expect(report.gaps.every((gap) => !gap.buildTask.includes(".venv/"))).toBe(true);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("classifies CI failures without actionable logs as unknown, not regression", async () => {
    const cwd = makeTempDir();
    const fakeBin = makeTempDir();
    const ghPath = path.join(fakeBin, "gh");
    const originalPath = process.env.PATH || "";
    try {
      writeFile(cwd, "src/index.ts", "export const v = 1;\n");
      makeExecutable(
        ghPath,
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat <<'JSON'
[{"databaseId":101,"workflowName":"CI","conclusion":"failure","status":"completed","createdAt":"2026-04-06T01:00:00Z","headSha":"sha-one"},{"databaseId":102,"workflowName":"CI","conclusion":"failure","status":"completed","createdAt":"2026-04-06T02:00:00Z","headSha":"sha-two"}]
JSON
  exit 0
fi
if [[ "$1" == "run" && "$2" == "view" ]]; then
  exit 0
fi
exit 0
`,
      );

      process.env.PATH = `${fakeBin}:${originalPath}`;
      const report = await runDoctorAssessment(cwd);

      expect(report.ciFailureSignals.length).toBe(2);
      expect(report.ciFailureSignals.every((signal) => signal.classification === "unknown")).toBe(true);
      expect(report.gaps.some((gap) => gap.id.startsWith("ci-regression-"))).toBe(false);
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("produces module health states for functioning and trouble modules", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, "package.json", JSON.stringify({ name: "doctor-health-test", version: "1.0.0" }, null, 2));
      writeFile(cwd, "src/covered.ts", "export const covered = () => 1;\n");
      writeFile(
        cwd,
        "src/auth.ts",
        [
          "export function validateToken(token?: string) {",
          "  if (!token) throw new Error('missing token');",
          "  return token.startsWith('wm_');",
          "}",
          "",
        ].join("\n"),
      );
      writeFile(
        cwd,
        "coverage/lcov.info",
        [
          "TN:",
          "SF:src/covered.ts",
          "LF:5",
          "LH:5",
          "BRF:0",
          "BRH:0",
          "end_of_record",
          "TN:",
          "SF:src/auth.ts",
          "LF:6",
          "LH:0",
          "BRF:0",
          "BRH:0",
          "end_of_record",
          "",
        ].join("\n"),
      );

      const report = await runDoctorAssessment(cwd);
      const covered = report.moduleHealth.find((module) => module.filePath === "src/covered.ts");
      const auth = report.moduleHealth.find((module) => module.filePath === "src/auth.ts");

      expect(covered?.status).toBe("functioning");
      expect(auth?.status).toBe("trouble");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("flags stale unreferenced modules as dead-code candidates", async () => {
    const cwd = makeTempDir();
    try {
      writeFile(cwd, "src/main.ts", "export const main = () => 'ok';\n");
      writeFile(cwd, "src/unused.ts", "export const unused = () => 42;\n");

      execSync("git init", { cwd, stdio: "pipe" });
      execSync("git config user.email doctor@test.local", { cwd, stdio: "pipe" });
      execSync("git config user.name doctor-test", { cwd, stdio: "pipe" });
      execSync("git add .", { cwd, stdio: "pipe" });
      execSync("git commit -m 'init'", {
        cwd,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2025-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2025-01-01T00:00:00Z",
        },
      });

      const report = await runDoctorAssessment(cwd);
      expect(report.deadCodeCandidates.some((candidate) => candidate.filePath === "src/unused.ts")).toBe(true);
      const unused = report.moduleHealth.find((module) => module.filePath === "src/unused.ts");
      expect(unused?.status).toBe("dead");
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
