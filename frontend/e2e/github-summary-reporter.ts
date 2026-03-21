import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import * as fs from "fs";

/**
 * Custom Playwright reporter that writes a rich GitHub Actions Job Summary.
 *
 * Produces a Markdown table with per-file pass/fail/skip counts, timing,
 * and an overall summary badge. Written to $GITHUB_STEP_SUMMARY if available,
 * otherwise to playwright-report/summary.md.
 */
class GitHubSummaryReporter implements Reporter {
  private suites: Map<
    string,
    { passed: number; failed: number; skipped: number; flaky: number; duration: number; tests: { name: string; status: string; duration: number; error?: string }[] }
  > = new Map();
  private startTime = 0;
  private config!: FullConfig;

  onBegin(config: FullConfig, _suite: Suite) {
    this.config = config;
    this.startTime = Date.now();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Get the file path relative to testDir
    const filePath = test.location.file
      .replace(this.config.rootDir + "/", "")
      .replace("e2e/tests/", "");

    if (!this.suites.has(filePath)) {
      this.suites.set(filePath, { passed: 0, failed: 0, skipped: 0, flaky: 0, duration: 0, tests: [] });
    }
    const suite = this.suites.get(filePath)!;

    const status = test.outcome();
    const duration = result.duration;

    suite.duration += duration;

    if (status === "expected") {
      suite.passed++;
      suite.tests.push({ name: test.title, status: "passed", duration });
    } else if (status === "unexpected") {
      suite.failed++;
      const error = result.errors?.[0]?.message?.split("\n")[0] || "Unknown error";
      suite.tests.push({ name: test.title, status: "failed", duration, error });
    } else if (status === "skipped") {
      suite.skipped++;
      suite.tests.push({ name: test.title, status: "skipped", duration: 0 });
    } else if (status === "flaky") {
      suite.flaky++;
      suite.tests.push({ name: test.title, status: "flaky", duration });
    }
  }

  async onEnd(result: FullResult) {
    const totalDuration = Date.now() - this.startTime;
    const target = process.env.BASE_URL?.includes("workermill.com") ? "Production" : "Local";

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalFlaky = 0;

    for (const suite of this.suites.values()) {
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalSkipped += suite.skipped;
      totalFlaky += suite.flaky;
    }

    const totalTests = totalPassed + totalFailed + totalSkipped + totalFlaky;
    const passRate = totalTests - totalSkipped > 0
      ? Math.round((totalPassed + totalFlaky) / (totalTests - totalSkipped) * 100)
      : 100;

    const statusEmoji = result.status === "passed" ? "&#x2705;" : "&#x274C;";
    const statusText = result.status === "passed" ? "All Tests Passed" : "Some Tests Failed";

    // Build markdown
    const lines: string[] = [];

    lines.push(`## ${statusEmoji} E2E Test Report — ${target}`);
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| **Status** | **${statusText}** |`);
    lines.push(`| Total Tests | ${totalTests} |`);
    lines.push(`| Passed | ${totalPassed} |`);
    if (totalFlaky > 0) lines.push(`| Flaky (passed on retry) | ${totalFlaky} |`);
    lines.push(`| Failed | ${totalFailed} |`);
    lines.push(`| Skipped | ${totalSkipped} |`);
    lines.push(`| Pass Rate | ${passRate}% |`);
    lines.push(`| Duration | ${formatDuration(totalDuration)} |`);
    lines.push(`| Target | ${process.env.BASE_URL || "http://localhost:5173"} |`);
    lines.push(`| Retries | ${this.config.projects[0]?.retries ?? 0} |`);
    lines.push("");

    // Per-file breakdown
    lines.push(`### Test Files`);
    lines.push("");
    lines.push(`| File | Passed | Failed | Skipped | Duration |`);
    lines.push(`|------|--------|--------|---------|----------|`);

    // Sort: failed files first, then by name
    const sortedSuites = [...this.suites.entries()].sort((a, b) => {
      if (a[1].failed > 0 && b[1].failed === 0) return -1;
      if (a[1].failed === 0 && b[1].failed > 0) return 1;
      return a[0].localeCompare(b[0]);
    });

    for (const [file, suite] of sortedSuites) {
      const fileStatus = suite.failed > 0 ? "&#x274C;" : suite.skipped === suite.passed + suite.failed + suite.skipped ? "&#x23ED;" : "&#x2705;";
      lines.push(
        `| ${fileStatus} ${file} | ${suite.passed} | ${suite.failed} | ${suite.skipped} | ${formatDuration(suite.duration)} |`
      );
    }

    lines.push("");

    // Failed test details
    if (totalFailed > 0) {
      lines.push(`### Failed Tests`);
      lines.push("");
      for (const [file, suite] of sortedSuites) {
        const failedTests = suite.tests.filter((t) => t.status === "failed");
        if (failedTests.length > 0) {
          for (const test of failedTests) {
            lines.push(`- **${file}** — ${test.name}`);
            if (test.error) {
              lines.push(`  \`\`\``);
              lines.push(`  ${test.error}`);
              lines.push(`  \`\`\``);
            }
          }
        }
      }
      lines.push("");
    }

    // Skipped test summary
    if (totalSkipped > 0) {
      lines.push(`<details>`);
      lines.push(`<summary>Skipped Tests (${totalSkipped}) — require mock workers / local stack</summary>`);
      lines.push(``);
      for (const [file, suite] of sortedSuites) {
        const skippedTests = suite.tests.filter((t) => t.status === "skipped");
        if (skippedTests.length > 0) {
          lines.push(`**${file}**`);
          for (const test of skippedTests) {
            lines.push(`- ${test.name}`);
          }
          lines.push(``);
        }
      }
      lines.push(`</details>`);
      lines.push("");
    }

    lines.push(`---`);
    lines.push(`*Generated by WorkerMill E2E Reporter — Playwright ${this.config.version}*`);

    const markdown = lines.join("\n");

    // Write to GitHub Actions Job Summary
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      fs.appendFileSync(summaryFile, markdown + "\n");
    }

    // Also write to file for artifact upload
    const reportDir = "playwright-report";
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(`${reportDir}/summary.md`, markdown);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default GitHubSummaryReporter;
