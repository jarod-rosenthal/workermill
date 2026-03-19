/**
 * Coordinator CI Module
 *
 * Handles CI gate polling, CI fix agent loop, quality fix agent,
 * and CI-verified merge flow.
 */

import axios from "axios";
import { execSync } from "child_process";
import type { EpicConfig, ResilienceConfig } from "./types.js";
import type { DecisionClient, EvaluateQualityResponse } from "./decision-client.js";
import type { GitOps } from "./git-ops.js";
import { InlineCIFixer } from "./inline-ci-fixer.js";
import { runQualityVerification, findBoardGateCommand, type QualityMetrics } from "./quality-runner.js";
import { runAgent, type AgentResult } from "./agent-sdk.js";
import { detectLanguage } from "../lib/language-profile.js";
import { loadRepoContext } from "./gate-utils.js";
import { postLog } from "./coordinator-utils.js";

/**
 * Run CI gate: poll + fix loop without merging.
 * Returns CI status so the tech_lead can review with full context.
 */
export async function runCIGate(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  prNumber: number,
  maxFixRetries: number | undefined,
): Promise<{ passed: boolean; fixed: boolean; log?: string }> {
  let ciResult = await pollPrCI(config, resilience, gitOps, prNumber);

  if (ciResult.passed) {
    return { passed: true, fixed: false };
  }

  // CI failed — try fix loop
  const maxRetries = maxFixRetries ?? 5;
  let ciFixRetryCount = 0;

  while (ciFixRetryCount < maxRetries) {
    ciFixRetryCount++;
    await postLog(
      config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
      `[CI Gate] CI failed on PR #${prNumber} — launching CI Fix Agent (attempt ${ciFixRetryCount}/${maxRetries})`
    );

    const fixer = new InlineCIFixer(config, gitOps.getRepoPath());
    const fixResult = await fixer.fix(prNumber, ciResult.log || "No detailed failure log available");

    if (fixResult.decision === "unfixable") {
      await postLog(
        config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
        `[CI Gate] CI Fix Agent reports issue is unfixable: ${fixResult.summary}`
      );
      return { passed: false, fixed: false, log: ciResult.log };
    }

    if (fixResult.success) {
      await postLog(
        config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
        `[CI Gate] CI Fix Agent applied fix: ${fixResult.summary} — waiting for CI re-run...`
      );
      await new Promise(r => setTimeout(r, 10000));

      ciResult = await pollPrCI(config, resilience, gitOps, prNumber);
      if (ciResult.passed) {
        await postLog(
          config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
          `[CI Gate] CI now passing after fix`
        );
        return { passed: true, fixed: true };
      }
    } else {
      await postLog(
        config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
        `[CI Gate] CI Fix Agent failed: ${fixResult.summary}`
      );
      return { passed: false, fixed: false, log: ciResult.log };
    }
  }

  await postLog(
    config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
    `❌ CI still failing after ${ciFixRetryCount} fix attempt(s)`
  );
  return { passed: false, fixed: false, log: ciResult.log };
}

/**
 * Poll CI check-runs on a PR's head commit.
 * For GitHub: uses the GitHub Check Runs API via `gh` CLI.
 * For BitBucket/GitLab: uses the WorkerMill API's ci-status endpoint.
 */
export async function pollPrCI(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  prNumber: number
): Promise<{ passed: boolean; pending: boolean; log?: string }> {
  const scmProvider = process.env.SCM_PROVIDER || "github";

  if (scmProvider === "github") {
    return pollPrCIGitHub(config, resilience, prNumber);
  }

  // For BitBucket and GitLab, poll CI via the WorkerMill API
  return pollPrCIViaApi(config, resilience, gitOps, prNumber, scmProvider);
}

/**
 * Poll CI via GitHub Check Runs API (gh CLI).
 */
async function pollPrCIGitHub(
  config: EpicConfig,
  resilience: ResilienceConfig,
  prNumber: number
): Promise<{ passed: boolean; pending: boolean; log?: string }> {
  const [owner, repo] = config.targetRepo.split("/");
  const token = config.githubToken;

  try {
    // Get PR head SHA
    const prRes = execSync(
      `gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.head.sha'`,
      { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
    ).trim();
    const headSha = prRes;
    if (!headSha) {
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "[CI Gate] Could not determine PR head SHA — treating as failed");
      return { passed: false, pending: false, log: "Could not determine PR head SHA" };
    }

    // Poll check-runs using org's blockerWaitTimeout setting
    const maxWaitMs = resilience.blockerWaitTimeoutMs;
    const pollIntervalMs = 30 * 1000;
    const noChecksGraceMs = 3 * 60 * 1000;
    const startTime = Date.now();

    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] Polling CI checks on PR #${prNumber} (SHA: ${headSha.substring(0, 7)})...`);

    while (Date.now() - startTime < maxWaitMs) {
      let checks: { total: number; runs: Array<{ name: string; status: string; conclusion: string; url: string }> };
      try {
        const checksJson = execSync(
          `gh api repos/${owner}/${repo}/commits/${headSha}/check-runs --jq '{total: .total_count, runs: [.check_runs[] | {name: .name, status: .status, conclusion: .conclusion, url: .html_url}]}'`,
          { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
        ).trim();
        checks = JSON.parse(checksJson);
      } catch (parseError) {
        const msg = parseError instanceof Error ? parseError.message : String(parseError);
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] Failed to fetch/parse CI checks: ${msg.slice(0, 200)} — retrying...`);
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }

      if (checks.total === 0) {
        if (Date.now() - startTime > noChecksGraceMs) {
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "[CI Gate] No CI checks found after 3 minutes — treating as failed");
          return { passed: false, pending: false, log: "No CI checks found after 3 minute grace period" };
        }
        // Wait for checks to appear
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }

      const pending = checks.runs.some((r: { status: string }) => r.status !== "completed");
      if (pending) {
        const completedCount = checks.runs.filter((r: { status: string }) => r.status === "completed").length;
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] ${completedCount}/${checks.total} checks completed — waiting...`);
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }

      // All checks completed
      const failed = checks.runs.filter((r: { conclusion: string }) =>
        r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== "neutral"
      );

      if (failed.length === 0) {
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] All ${checks.total} CI checks passed`);
        return { passed: true, pending: false };
      }

      // Collect failure details
      const failureLog = failed.map((r: { name: string; conclusion: string; url: string }) =>
        `${r.name}: ${r.conclusion} (${r.url})`
      ).join("\n");

      // Try to get detailed failure output from the first failed check
      let detailedLog = failureLog;
      try {
        const failedRun = failed[0];
        const runId = failedRun.url?.match(/\/runs\/(\d+)/)?.[1];
        if (runId) {
          const logOutput = execSync(
            `gh api repos/${owner}/${repo}/actions/runs/${runId}/jobs --jq '[.jobs[] | select(.conclusion != "success") | .steps[] | select(.conclusion == "failure") | "Step: " + .name + "\\nConclusion: " + .conclusion] | join("\\n---\\n")'`,
            { env: { ...process.env, GH_TOKEN: token }, encoding: "utf-8", timeout: 15000 }
          ).trim();
          if (logOutput) {
            detailedLog = `${failureLog}\n\nFailed steps:\n${logOutput}`;
          }
        }
      } catch {
        // Detailed log fetch is best-effort
      }

      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] ${failed.length} CI check(s) failed:\n${failureLog}`);
      return { passed: false, pending: false, log: detailedLog };
    }

    // Timeout with still-pending checks — treat as failure
    const waitMinutes = Math.round(maxWaitMs / 60_000);
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] CI checks still pending after ${waitMinutes} minutes — treating as failed`);
    return { passed: false, pending: true, log: `CI checks did not complete within ${waitMinutes} minutes` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] Error polling CI: ${msg} — treating as failed`);
    return { passed: false, pending: false, log: `CI polling error: ${msg}` };
  }
}

/**
 * Poll CI via WorkerMill API ci-status endpoint.
 * Works for BitBucket Pipelines, GitLab CI, and any other SCM provider.
 */
async function pollPrCIViaApi(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  prNumber: number,
  scmProvider: string
): Promise<{ passed: boolean; pending: boolean; log?: string }> {
  try {
    // Get the PR head SHA from the SCM provider via git
    const headSha = gitOps.getHeadSha();
    if (!headSha) {
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "[CI Gate] Could not determine HEAD SHA — treating as failed");
      return { passed: false, pending: false, log: "Could not determine HEAD SHA" };
    }

    const maxWaitMs = resilience.blockerWaitTimeoutMs;
    const pollIntervalMs = 30 * 1000;
    const noChecksGraceMs = 3 * 60 * 1000;
    const startTime = Date.now();
    const providerLabel = scmProvider === "bitbucket" ? "Bitbucket Pipelines" : scmProvider === "gitlab" ? "GitLab CI" : `${scmProvider} CI`;

    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] Polling ${providerLabel} on PR #${prNumber} (SHA: ${headSha.substring(0, 7)})...`);

    while (Date.now() - startTime < maxWaitMs) {
      // Call WorkerMill API to get CI statuses
      const response = await axios.post(
        `${config.apiBaseUrl}/api/worker-decisions/ci-status`,
        {
          repo: config.targetRepo,
          commitSha: headSha,
        },
        {
          headers: {
            "x-api-key": config.orgApiKey,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      const { statuses, total } = response.data as {
        statuses: Array<{ state: "passed" | "failed" | "pending"; name: string; url?: string; rawState: string }>;
        total: number;
      };

      if (total === 0) {
        if (Date.now() - startTime > noChecksGraceMs) {
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] No ${providerLabel} checks found after 3 minutes — treating as failed`);
          return { passed: false, pending: false, log: `No ${providerLabel} checks found after 3 minute grace period` };
        }
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }

      const pendingChecks = statuses.filter((s: { state: string }) => s.state === "pending");
      if (pendingChecks.length > 0) {
        const completedCount = total - pendingChecks.length;
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] ${completedCount}/${total} checks completed — waiting...`);
        await new Promise(r => setTimeout(r, pollIntervalMs));
        continue;
      }

      // All checks completed
      const failed = statuses.filter((s: { state: string }) => s.state === "failed");

      if (failed.length === 0) {
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] All ${total} ${providerLabel} checks passed`);
        return { passed: true, pending: false };
      }

      // Collect failure details
      const failureLog = failed.map((s: { name: string; rawState: string; url?: string }) =>
        `${s.name}: ${s.rawState}${s.url ? ` (${s.url})` : ""}`
      ).join("\n");

      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] ${failed.length} ${providerLabel} check(s) failed:\n${failureLog}`);
      return { passed: false, pending: false, log: failureLog };
    }

    // Timeout
    const waitMinutes = Math.round(maxWaitMs / 60_000);
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] ${providerLabel} checks still pending after ${waitMinutes} minutes — treating as failed`);
    return { passed: false, pending: true, log: `${providerLabel} checks did not complete within ${waitMinutes} minutes` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] Error polling CI: ${msg} — treating as failed`);
    return { passed: false, pending: false, log: `CI polling error: ${msg}` };
  }
}

/**
 * Merge a PR with CI verification and automatic fix attempts.
 * Polls PR CI, launches CI Fix Agent on failures, retries up to config.maxFixRetries.
 * Blocks merge if CI fails and cannot be fixed.
 */
export async function mergeWithCIVerification(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  prUrl: string,
  prNumber: number,
  mergeLabel: string
): Promise<{ merged: boolean }> {
  // If no quality gate commands configured, merge directly — no CI polling needed
  if ((config.qualityGateCommands?.length ?? 0) === 0) {
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `Merging PR #${prNumber} (${mergeLabel}, no quality gates configured)...`);
    const merged = await gitOps.mergePR(prUrl, prNumber);
    return { merged };
  }

  // Initial CI check
  let ciResult = await pollPrCI(config, resilience, gitOps, prNumber);

  if (ciResult.passed) {
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `Merging PR #${prNumber} (${mergeLabel})...`);
    const merged = await gitOps.mergePR(prUrl, prNumber);
    return { merged };
  }

  // CI failed — enter fix loop
  const maxRetries = config.maxFixRetries ?? 5;
  let ciFixRetryCount = 0;
  while (ciFixRetryCount < maxRetries) {
    ciFixRetryCount++;
    await postLog(
      config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
      `[CI Gate] CI failed on PR #${prNumber} — launching CI Fix Agent (attempt ${ciFixRetryCount}/${maxRetries})`
    );

    const fixer = new InlineCIFixer(config, gitOps.getRepoPath());
    const fixResult = await fixer.fix(prNumber, ciResult.log || "No detailed failure log available");

    if (fixResult.decision === "unfixable") {
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] CI Fix Agent reports issue is unfixable: ${fixResult.summary}`);
      break;
    }

    if (fixResult.success) {
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] CI Fix Agent applied fix: ${fixResult.summary} — waiting for CI re-run...`);

      // Wait a moment for CI to trigger on new push
      await new Promise(r => setTimeout(r, 10000));

      // Re-poll CI
      ciResult = await pollPrCI(config, resilience, gitOps, prNumber);

      if (ciResult.passed) {
        await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] CI now passing after fix — merging PR #${prNumber}`);
        const merged = await gitOps.mergePR(prUrl, prNumber);
        return { merged };
      }
      // Still failing — loop continues
    } else {
      await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `[CI Gate] CI Fix Agent failed: ${fixResult.summary}`);
      break;
    }
  }

  // All retries exhausted or unfixable — do NOT merge broken code
  await postLog(
    config.apiBaseUrl, config.orgApiKey, config.parentTaskId,
    `❌ CI still failing after ${ciFixRetryCount} fix attempt(s) — blocking merge of PR #${prNumber}`
  );
  return { merged: false };
}

/**
 * Spawn a Claude agent to fix quality gate failures that shell commands couldn't resolve.
 * Uses the same agent SDK as InlineIntegrationFixer / InlineCIFixer.
 */
export async function runQualityFixAgent(
  config: EpicConfig,
  decisionClient: DecisionClient,
  repoPath: string,
  issuesRemaining: string[]
): Promise<boolean> {
  // Capture fresh quality gate output so the agent sees ALL errors.
  let errorOutput = "";

  const profile = detectLanguage(repoPath);
  const boardGates = config.qualityGateCommands;
  const execEnv = { ...process.env, CI: "true", PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` };

  // Resolve commands: board gate commands take priority, then language profile defaults
  const typecheckCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "typecheck") : undefined) || profile.typecheck;
  const lintCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "lint") : undefined) || profile.lint;
  const testCmd = (boardGates?.length ? findBoardGateCommand(boardGates, "test") : undefined) || profile.test;

  // 1. Typecheck errors
  if (typecheckCmd) {
    try {
      execSync(typecheckCmd, { cwd: repoPath, encoding: "utf-8", timeout: 120_000, env: execEnv, shell: "/bin/bash" });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      errorOutput += "=== TYPECHECK ERRORS ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
    }
  }

  // 2. Lint errors
  if (lintCmd) {
    try {
      execSync(lintCmd, { cwd: repoPath, encoding: "utf-8", timeout: 120_000, env: execEnv, shell: "/bin/bash" });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      errorOutput += "\n=== LINT ERRORS ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
    }
  }

  // 3. Test failures
  if (testCmd) {
    try {
      execSync(testCmd, { cwd: repoPath, encoding: "utf-8", timeout: 300_000, env: execEnv, shell: "/bin/bash" });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      errorOutput += "\n=== TEST FAILURES ===\n" + (err.stdout || "") + "\n" + (err.stderr || "");
    }
  }

  if (!errorOutput.trim()) {
    errorOutput = issuesRemaining.join("\n");
  }

  const maxLen = 12 * 1024;
  const truncated = errorOutput.length > maxLen
    ? errorOutput.substring(errorOutput.length - maxLen)
    : errorOutput;

  const repoContext = loadRepoContext(repoPath);
  const repoContextSection = repoContext
    ? `\n### Repository Context\n\n${repoContext}\n`
    : "";

  // Build verification instructions using the same commands the quality runner will use
  const verifySteps = [
    typecheckCmd ? `Run \`${typecheckCmd}\` to verify type errors are resolved` : null,
    lintCmd ? `Run \`${lintCmd}\` to verify lint errors are resolved` : null,
    testCmd ? `Run \`${testCmd}\` to verify test failures are resolved` : null,
  ].filter(Boolean);

  const prompt = `## Quality Gate Failures

**Repository:** ${config.targetRepo}
**Language:** ${profile.displayName}
${repoContextSection}
### Error Output

\`\`\`
${truncated}
\`\`\`

### Instructions

The code has quality gate failures that need fixing.

1. Read ALL the errors carefully and fix ALL of them — typecheck, lint, AND tests
${verifySteps.map((s, i) => `${i + 2}. ${s}`).join("\n")}
${verifySteps.length + 2}. Do NOT refactor beyond what's needed to pass quality gates
${verifySteps.length + 3}. Do NOT change language versions, framework versions, or dependency versions
${verifySteps.length + 4}. Commit with message "fix: resolve quality gate issues"`;

  const systemPrompt = `You are a Quality Fix Agent. Fix ALL quality gate failures in the codebase. You have full access to read and edit files.

## Rules
- Fix EVERY error, not just the first
- Run verification commands after fixing to confirm
- Do NOT refactor beyond what's needed
- Do NOT change language or dependency versions
- **NEVER change framework or dependency major versions**

## Communication Style
Write in a professional, direct tone. Do NOT open with filler words or pleasantries.`;

  const model = process.env.MANAGER_MODEL || config.model || "";

  try {
    const result: AgentResult = await runAgent(config, {
      prompt,
      expertConfig: {
        persona: "qa_engineer" as const,
        description: "Quality fix specialist",
        systemPrompt,
        tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
        model,
        specialties: ["testing", "quality"],
        maxTurns: config.maxAgentTurns,
      },
      repoPath,
      storyId: `quality-fix-${config.parentTaskId}`,
      onMessage: (msg) => {
        if (msg.type === "text" && msg.content && msg.content.length > 20) {
          postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, msg.content);
        } else if (msg.type === "tool_use" && msg.toolName) {
          const input = msg.toolInput;
          let toolMsg = `Tool: ${msg.toolName}`;
          if (input?.command) toolMsg += ` -> ${String(input.command).substring(0, 500)}`;
          else if (input?.file_path) toolMsg += ` -> ${input.file_path}`;
          postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, toolMsg);
        }
      },
    });

    if (!result.success) {
      console.log(`[Epic] Quality fix agent failed: ${result.error}`);
      return false;
    }

    // Verify quality actually passes now
    const metrics = await runQualityVerification(repoPath, config.qualityGateCommands);
    const evalResult = await decisionClient.evaluateQuality({
      metrics: {
        qualityScore: metrics.qualityScore,
        typeErrors: metrics.typeErrors > 0,
        testFailures: metrics.testsFailed > 0,
        e2eFailures: (metrics.e2eFailed ?? 0) > 0,
        testCoveragePercent: metrics.coverageLines || undefined,
        securityVulnsHigh: metrics.securityHigh,
      },
      qualityGateEnabled: true,
      storyDescription: config.jiraRequirements || undefined,
    });

    if (evalResult.pass) {
      console.log("[Epic] Quality fix agent resolved all issues");
      postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Claude fix agent resolved all quality issues");
      return true;
    }

    console.log(`[Epic] Quality fix agent ran but gate still fails: ${evalResult.blockers.join(", ")}`);
    return false;
  } catch (error) {
    console.error("[Epic] Quality fix agent error:", error instanceof Error ? error.message : error);
    return false;
  }
}
