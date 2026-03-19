/**
 * Coordinator Review Module
 *
 * Handles the Tech Lead review flow, AI SDK review, deployment,
 * revision triggering, and escalation/rejection handling.
 */

import axios from "axios";
import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import type {
  ExpertPersona,
  ExpertState,
  ReadyStory,
  EpicConfig,
  ResilienceConfig,
} from "./types.js";
import { getAvailableExperts } from "./experts.js";
import type { CoordinationClient } from "./coordination-client.js";
import type { DecisionClient } from "./decision-client.js";
import type { GitOps } from "./git-ops.js";
import { TicketOps, GitHubCommentFormat } from "./ticket-ops.js";
import { InlineReviewer, type InlineReviewResult } from "./inline-reviewer.js";
import { InlineDeployer } from "./inline-deployer.js";
import type { QualityMetrics } from "./quality-runner.js";
import { mergeWithCIVerification } from "./coordinator-ci.js";
import { postLog, postProgressUpdate, updateTaskStatus } from "./coordinator-utils.js";

/**
 * Run inline Tech Lead review with revision loop.
 * Returns "continue" if a revision was triggered (stories need to re-run).
 * Returns "done" if review completed (approved, rejected, or escalated).
 */
export async function runInlineReview(
  config: EpicConfig,
  resilience: ResilienceConfig,
  coordination: CoordinationClient,
  decisionClient: DecisionClient,
  gitOps: GitOps,
  ticketOps: TicketOps,
  prUrl: string,
  prNumber: number,
  storyCompletions: Array<{ storyIndex: number; title: string; filesModified: string[] }>,
  summaryParts: string[],
  // Mutable state
  revisionCount: number,
  maxRevisions: number,
  lastReviewFeedback: string | undefined,
  serverPromptTemplates: { techLeadReviewPrompt?: string; devopsPhase1Prompt?: string; devopsDeployAutoPrompt?: string; devopsDeployManualPrompt?: string; devopsCreatePrompt?: string } | undefined,
  callbacks: {
    setRevisionCount: (count: number) => void;
    setLastReviewFeedback: (feedback: string | undefined) => void;
    setReviewSkipped: () => void;
    setDeploymentSucceeded: () => void;
    setMergeFailed: () => void;
    setMissionActive: (active: boolean) => void;
    triggerRevision: (feedback: string, affectedStories?: number[], affectedReasons?: Record<number, string>) => Promise<void>;
  },
  qualityMetrics?: QualityMetrics,
  ciStatus?: { passed: boolean; fixed: boolean; log?: string }
): Promise<"continue" | "done"> {
  console.log(`[Epic] Running inline Tech Lead review (attempt ${revisionCount + 1}/${maxRevisions})`);
  postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Starting Tech Lead review...");
  await coordination.postContext(
    "progress",
    `Starting Tech Lead review (attempt ${revisionCount + 1}/${maxRevisions})`,
    "tech_lead"
  ).catch(() => {});

  // Ensure repo is on the PR's head branch so the tech lead reads correct files.
  await gitOps.checkoutForReview(prNumber);
  postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Checked out PR branch, launching reviewer...");

  // Check manager provider to decide which reviewer to use
  const managerProvider = process.env.MANAGER_PROVIDER || "anthropic";
  const managerModel = process.env.MANAGER_MODEL || "";
  console.log(`[Epic] Manager provider: ${managerProvider}, model: ${managerModel}`);

  let reviewResult: InlineReviewResult;

  if (managerProvider === "anthropic") {
    const reviewer = new InlineReviewer(config, gitOps.getRepoPath(), serverPromptTemplates?.techLeadReviewPrompt);
    reviewResult = await reviewer.review(
      prUrl,
      prNumber,
      revisionCount,
      lastReviewFeedback,
      qualityMetrics,
      storyCompletions,
      undefined,
      ciStatus
    );
  } else {
    console.log(`[Epic] Using AI SDK reviewer for ${managerProvider}/${managerModel}`);
    reviewResult = await runAiSdkReview(
      config,
      decisionClient,
      gitOps,
      prUrl,
      prNumber,
      managerProvider,
      managerModel,
      revisionCount,
      maxRevisions,
      lastReviewFeedback,
      qualityMetrics,
      ciStatus
    );
  }

  if (!reviewResult.success) {
    console.error("[Epic] Inline review failed:", reviewResult.error);
    callbacks.setReviewSkipped();
    console.log("[Epic] Skipping review due to failure — PR will need human review");
    await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "Tech Lead review failed — PR created for human review");
    await ticketOps.postComment(
      `⚠️ Tech Lead review could not complete (${reviewResult.error}). PR is ready for human review.`
    );
    return "done";
  }

  console.log(`[Epic] Review decision: ${reviewResult.decision}, score: ${reviewResult.codeQualityScore}`);

  // Ensure the review is posted to the GitHub PR
  await ensureGitHubReviewPosted(config, prNumber, reviewResult);

  switch (reviewResult.decision) {
    case "approved":
      console.log("[Epic] PR approved by Tech Lead!");
      await ticketOps.postComment(
        `✅ PR approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`
      );
      await coordination.postContext(
        "decision",
        `✅ PR approved (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`,
        "tech_lead"
      ).catch(() => {});

      // If deployment enabled, trigger DevOps Engineer to merge and deploy
      if (config.deploymentEnabled) {
        const deployResult = await runInlineDeployment(
          config, resilience, gitOps, ticketOps, prUrl, prNumber, summaryParts, serverPromptTemplates,
          callbacks
        );
        if (!deployResult) {
          callbacks.setMissionActive(false);
          return "done";
        }
        if (config.jiraIssueKey) {
          await gitOps.postMergeCleanup(config.jiraIssueKey);
        }
      } else {
        // Default: merge the PR after Tech Lead approval (with CI verification)
        const mergeLabel = config.prdChildTask ? "PRD auto-run" : "Tech Lead approved";
        console.log(`[Epic] ${mergeLabel} — auto-merging PR #${prNumber} with CI verification`);
        const mergeResult = await mergeWithCIVerification(config, resilience, gitOps, prUrl, prNumber, mergeLabel);
        if (mergeResult.merged) {
          console.log(`[Epic] PR #${prNumber} merged successfully`);
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `PR #${prNumber} merged successfully`);
          const mergeComment = process.env.TICKET_SYSTEM === "github"
            ? GitHubCommentFormat.completed(`PR #${prNumber} auto-merged (${mergeLabel}).`, prUrl)
            : `🔀 PR #${prNumber} auto-merged (${mergeLabel})`;
          await ticketOps.postComment(mergeComment);
          if (config.jiraIssueKey) {
            await gitOps.postMergeCleanup(config.jiraIssueKey);
          }
        } else {
          console.warn(`[Epic] PR #${prNumber} merge failed after CI retries`);
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `❌ PR #${prNumber} merge failed — CI checks did not pass after all retry attempts`);
          await ticketOps.postComment(
            `❌ PR #${prNumber} could not be merged — CI checks failed after all retry attempts.\n\nPR: ${prUrl}\n\n*Manual intervention required.*`
          );
          callbacks.setMergeFailed();
        }
      }
      return "done";

    case "revision_needed": {
      const newRevisionCount = revisionCount + 1;
      callbacks.setRevisionCount(newRevisionCount);
      callbacks.setLastReviewFeedback(reviewResult.feedback);
      // Update revision count on dashboard in real-time
      await postProgressUpdate(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "reviewing", prUrl, prNumber, newRevisionCount);

      if (newRevisionCount >= maxRevisions) {
        console.log(`[Epic] Max revisions (${maxRevisions}) reached. Escalating.`);
        await handleEscalation(
          config, ticketOps,
          prUrl,
          summaryParts,
          `Max revisions reached. Final feedback: ${reviewResult.feedback}`
        );
        callbacks.setMissionActive(false);
        return "done";
      }

      // Log selective revision info
      const selectiveInfo = reviewResult.affectedStories?.length
        ? ` (selective: stories ${reviewResult.affectedStories.join(", ")})`
        : " (full revision)";
      console.log(`[Epic] Revision needed (${newRevisionCount}/${maxRevisions})${selectiveInfo}. Re-running stories...`);

      await ticketOps.postComment(
        `🔄 Revision ${newRevisionCount}/${maxRevisions} requested by Tech Lead:\n\n${reviewResult.feedback}`
      );

      // Trigger revision with optional selective story targeting
      await callbacks.triggerRevision(
        reviewResult.feedback,
        reviewResult.affectedStories,
        reviewResult.affectedReasons
      );
      return "continue";
    }

    case "rejected":
      console.log("[Epic] PR rejected by Tech Lead.");
      await coordination.postContext(
        "decision",
        `❌ PR rejected by Tech Lead\n\n${reviewResult.feedback}`,
        "tech_lead"
      ).catch(() => {});
      await handleRejection(config, ticketOps, prUrl, summaryParts, reviewResult.feedback);
      callbacks.setMissionActive(false);
      return "done";

    default:
      console.error(`[Epic] Unknown review decision: ${reviewResult.decision}`);
      await handleEscalation(config, ticketOps, prUrl, summaryParts, `Unknown review decision: ${reviewResult.decision}`);
      callbacks.setMissionActive(false);
      return "done";
  }
}

/**
 * Ensure the Tech Lead review is posted to the SCM PR.
 */
export async function ensureGitHubReviewPosted(
  config: EpicConfig,
  prNumber: number,
  reviewResult: InlineReviewResult
): Promise<void> {
  if (config.scmProvider && config.scmProvider !== "github") {
    return;
  }

  const token = config.githubReviewerToken || config.githubToken;
  if (!token || !config.targetRepo) return;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const [commentsRes, reviewsRes] = await Promise.all([
      axios.get(
        `https://api.github.com/repos/${config.targetRepo}/issues/${prNumber}/comments`,
        { headers, params: { per_page: 10, sort: "created", direction: "desc" }, timeout: 10000 }
      ).catch(() => ({ data: [] })),
      axios.get(
        `https://api.github.com/repos/${config.targetRepo}/pulls/${prNumber}/reviews`,
        { headers, params: { per_page: 10 }, timeout: 10000 }
      ).catch(() => ({ data: [] })),
    ]);

    const cutoff = Date.now() - 10 * 60 * 1000;
    const hasSubstantiveComment = (commentsRes.data as Array<{ created_at: string; body: string }>).some(
      (c) =>
        new Date(c.created_at).getTime() > cutoff &&
        c.body.length > 200 &&
        /code review|review complete|approved|revision needed|request.changes/i.test(c.body)
    );
    const hasSubstantiveReview = (reviewsRes.data as Array<{ submitted_at: string; body: string }>).some(
      (r) => new Date(r.submitted_at).getTime() > cutoff && (r.body || "").length > 200
    );

    if (hasSubstantiveComment || hasSubstantiveReview) {
      console.log("[Epic] Substantive review already posted to PR by agent — skipping programmatic post");
      return;
    }

    const emoji = reviewResult.decision === "approved" ? "✅"
      : reviewResult.decision === "revision_needed" ? "🔄" : "❌";
    const body = `## ${emoji} Tech Lead Review — ${reviewResult.decision.replace("_", " ").toUpperCase()}\n\n` +
      `**Code Quality Score:** ${reviewResult.codeQualityScore}/10\n\n` +
      `${reviewResult.feedback || "No detailed feedback."}`;

    const event = reviewResult.decision === "approved" ? "APPROVE"
      : reviewResult.decision === "revision_needed" ? "REQUEST_CHANGES"
      : "COMMENT";

    try {
      await axios.post(
        `https://api.github.com/repos/${config.targetRepo}/pulls/${prNumber}/reviews`,
        { body, event },
        { headers, timeout: 10000 }
      );
      console.log(`[Epic] Posted formal PR review (${event}) to PR #${prNumber}`);
    } catch (reviewErr: unknown) {
      const msg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
      console.log(`[Epic] Formal PR review failed (${msg}) — posting as comment`);
      await axios.post(
        `https://api.github.com/repos/${config.targetRepo}/issues/${prNumber}/comments`,
        { body },
        { headers, timeout: 10000 }
      );
      console.log(`[Epic] Posted review as issue comment on PR #${prNumber}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Epic] Failed to ensure GitHub review posted: ${msg}`);
  }
}

/**
 * Run AI SDK based review for non-Anthropic providers.
 */
export async function runAiSdkReview(
  config: EpicConfig,
  decisionClient: DecisionClient,
  gitOps: GitOps,
  prUrl: string,
  prNumber: number,
  provider: string,
  model: string,
  revisionCount: number,
  maxRevisions: number,
  lastReviewFeedback: string | undefined,
  qualityMetrics?: QualityMetrics,
  ciStatus?: { passed: boolean; fixed: boolean; log?: string }
): Promise<InlineReviewResult> {
  const prompt = buildAiSdkReviewPrompt(config, prUrl, prNumber, revisionCount, maxRevisions, lastReviewFeedback, qualityMetrics, ciStatus);

  const promptFile = `/tmp/epic-review-prompt-${Date.now()}.txt`;
  writeFileSync(promptFile, prompt);

  let allOutput = "";

  return new Promise((resolve) => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      AGENT_WORKING_DIR: gitOps.getRepoPath(),
      AGENT_MAX_STEPS: "50",
      AGENT_VERBOSE: "false",
    };

    if (config.githubReviewerToken) {
      env.GH_TOKEN = config.githubReviewerToken;
      env.GITHUB_TOKEN = config.githubReviewerToken;
      console.log("[Epic] Using separate reviewer token for PR approval");
    }

    if (provider === "google" || provider === "gemini") {
      env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";
      env.GOOGLE_API_KEY = env.GOOGLE_GENERATIVE_AI_API_KEY;
    } else if (provider === "openai") {
      env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    } else if (provider === "ollama") {
      env.OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
    }

    const args = [
      "/app/agents/ai-sdk-executor.js",
      "--provider", provider,
      "--model", model,
      "--persona", "tech_lead",
      "--prompt-file", promptFile,
    ];

    console.log(`[Epic] Spawning AI SDK executor: ${provider}/${model}`);

    const child = spawn("node", args, {
      cwd: "/app",
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      for (const line of text.split("\n")) {
        if (line.trim()) {
          console.log(line);
          allOutput += line + "\n";
          axios.post(`${config.apiBaseUrl}/api/control-center/logs`, {
            taskId: config.parentTaskId,
            type: "manager",
            message: line,
            severity: "info",
          }, {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config.orgApiKey,
            },
            timeout: 5000,
          }).catch(() => {});
        }
      }
    });

    child.stderr.on("data", (data) => {
      const stderrText = data.toString().trim();
      if (stderrText && (stderrText.includes("Error") || stderrText.includes("error:"))) {
        console.error(stderrText);
        axios.post(`${config.apiBaseUrl}/api/control-center/logs`, {
          taskId: config.parentTaskId,
          type: "error",
          message: stderrText,
          severity: "error",
        }, {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.orgApiKey,
          },
          timeout: 5000,
        }).catch(() => {});
      }
    });

    child.on("close", (code) => {
      try {
        unlinkSync(promptFile);
      } catch {
        // Ignore cleanup errors
      }

      const reportTokensFromOutput = () => {
        const inputTokensMatch = allOutput.match(/::input_tokens::(\d+)/);
        const outputTokensMatch = allOutput.match(/::output_tokens::(\d+)/);
        const inputToks = inputTokensMatch ? parseInt(inputTokensMatch[1], 10) : 0;
        const outputToks = outputTokensMatch ? parseInt(outputTokensMatch[1], 10) : 0;

        if (inputToks > 0 || outputToks > 0) {
          const usageUrl = `${config.apiBaseUrl}/api/tasks/${config.parentTaskId}/usage/partial`;
          axios.post(usageUrl, {
            inputTokens: inputToks,
            outputTokens: outputToks,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            mode: "add",
            model,
          }, {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": config.orgApiKey,
            },
          }).then(() => {
            console.log(`[Epic] Reported manager review tokens: input=${inputToks}, output=${outputToks}`);
          }).catch((err) => {
            console.warn(`[Epic] Failed to report manager review tokens: ${err.message}`);
          });
        }
      };

      if (code !== 0) {
        reportTokensFromOutput();
        resolve({
          success: false,
          decision: "rejected",
          feedback: `AI SDK executor exited with code ${code}`,
          codeQualityScore: 0,
          error: `AI SDK executor exited with code ${code}`,
        });
        return;
      }

      decisionClient.parseReviewOutcome({
        reviewOutput: allOutput,
        reviewerPersona: "tech_lead",
        revisionNumber: revisionCount,
      }).then((reviewOutcome) => {
        reportTokensFromOutput();

        const decision = reviewOutcome.decision === "rejected"
          ? "rejected" as const
          : reviewOutcome.decision === "revision_needed"
            ? "revision_needed" as const
            : "approved" as const;

        console.log(`[Epic] Decision API parsed review: ${decision} (score: ${reviewOutcome.score ?? "N/A"})`);

        resolve({
          success: true,
          decision,
          feedback: reviewOutcome.feedback || "No feedback provided",
          codeQualityScore: reviewOutcome.score
            ? Math.min(10, Math.max(1, reviewOutcome.score))
            : 5,
        });
      }).catch((parseErr) => {
        console.error("[Epic] Decision API review parsing failed, using fallback:", parseErr);
        reportTokensFromOutput();

        resolve({
          success: true,
          decision: "approved",
          feedback: "Decision API unavailable — auto-approving",
          codeQualityScore: 5,
        });
      });
    });

    child.on("error", (err) => {
      resolve({
        success: false,
        decision: "rejected",
        feedback: `Failed to spawn AI SDK executor: ${err.message}`,
        codeQualityScore: 0,
        error: `Failed to spawn AI SDK executor: ${err.message}`,
      });
    });
  });
}

/**
 * Build review prompt for AI SDK executor.
 */
export function buildAiSdkReviewPrompt(
  config: EpicConfig,
  prUrl: string,
  prNumber: number,
  revisionCount: number,
  maxRevisions: number,
  lastReviewFeedback: string | undefined,
  qualityMetrics?: QualityMetrics,
  ciStatus?: { passed: boolean; fixed: boolean; log?: string }
): string {
  const revisionSection = lastReviewFeedback
    ? `## Previous Review Feedback (Revision ${revisionCount}/${maxRevisions})
This is a revision attempt. The previous code was reviewed and these issues were identified:

${lastReviewFeedback}

**IMPORTANT: Check if ALL issues above have been addressed, not just some of them.**
- The developer was instructed to fix every item
- If ANY issue remains unaddressed, request another revision
- Be specific about which items are still outstanding

---

`
    : "";

  // Build quality metrics section if available — use org thresholds, not hardcoded values
  let qualitySection = "";
  if (qualityMetrics) {
    const thresholds = config.qualityThresholds;
    const blockOnTypeErrors = thresholds?.blockOnTypeErrors ?? false;
    const blockOnTestFailures = thresholds?.blockOnTestFailures ?? true;
    const blockOnLintErrors = thresholds?.blockOnLintErrors ?? false;
    const blockOnE2EFailures = thresholds?.blockOnE2EFailures ?? false;
    const minQualityScore = thresholds?.minQualityScore ?? null;
    const maxSecurityHigh = thresholds?.maxSecurityHighVulns ?? null;

    const hasLintIssues = qualityMetrics.lintErrors > 0;
    const hasTypeErrors = qualityMetrics.typeErrors > 0;
    const hasTestFailures = qualityMetrics.testsFailed > 0;
    const hasSecurityIssues = maxSecurityHigh !== null ? qualityMetrics.securityHigh > maxSecurityHigh : qualityMetrics.securityHigh > 0;
    const qualityBelowThreshold = minQualityScore !== null && qualityMetrics.qualityScore < minQualityScore;

    qualitySection = `## Automated Quality Metrics

| Metric | Result | Status |
|--------|--------|--------|
| **Overall Score** | ${qualityMetrics.qualityScore}% | ${qualityBelowThreshold ? `⚠️ Below ${minQualityScore}% threshold` : '✅'} |
| TypeCheck | ${qualityMetrics.typeErrors} errors | ${hasTypeErrors ? (blockOnTypeErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Lint | ${qualityMetrics.lintErrors} errors, ${qualityMetrics.lintWarnings} warnings | ${hasLintIssues ? (blockOnLintErrors ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Tests | ${qualityMetrics.testsPassed} passed, ${qualityMetrics.testsFailed} failed | ${hasTestFailures ? (blockOnTestFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| E2E Tests | ${qualityMetrics.e2ePassed ?? 0} passed, ${qualityMetrics.e2eFailed ?? 0} failed | ${(qualityMetrics.e2eFailed ?? 0) > 0 ? (blockOnE2EFailures ? '❌ Blocking' : '⚠️ Non-blocking') : '✅'} |
| Security | ${qualityMetrics.securityHigh} high, ${qualityMetrics.securityMedium} medium | ${hasSecurityIssues ? '🔴 Blocking' : '✅'} |

### Quality Gate Rules (from Organization Settings)
${qualityBelowThreshold ? `**⚠️ QUALITY SCORE BELOW ${minQualityScore}% - Consider requesting revision.**\n` : ''}${hasTypeErrors && blockOnTypeErrors ? '**❌ TYPE ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}${hasTypeErrors && !blockOnTypeErrors ? '**ℹ️ Type errors detected but blocking is DISABLED in org settings — do NOT request revision for type errors alone.**\n' : ''}${hasLintIssues && blockOnLintErrors ? '**❌ LINT ERRORS DETECTED - Organization requires these to be fixed.**\n' : ''}${hasLintIssues && !blockOnLintErrors ? '**ℹ️ Lint errors detected but blocking is DISABLED in org settings — do NOT request revision for lint errors alone.**\n' : ''}${(qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures ? '**❌ E2E TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}${(qualityMetrics.e2eFailed ?? 0) > 0 && !blockOnE2EFailures ? '**ℹ️ E2E test failures detected but blocking is DISABLED in org settings — do NOT request revision for E2E failures alone.**\n' : ''}${hasTestFailures && blockOnTestFailures ? '**❌ TEST FAILURES DETECTED - Organization requires these to be fixed.**\n' : ''}${hasTestFailures && !blockOnTestFailures ? '**ℹ️ Test failures detected but blocking is DISABLED in org settings — do NOT request revision for test failures alone.**\n' : ''}${hasSecurityIssues ? '**🔴 HIGH SEVERITY SECURITY ISSUES - These must be fixed.**\n' : ''}${!qualityBelowThreshold && !hasSecurityIssues && !(hasTypeErrors && blockOnTypeErrors) && !(hasTestFailures && blockOnTestFailures) && !(hasLintIssues && blockOnLintErrors) && !((qualityMetrics.e2eFailed ?? 0) > 0 && blockOnE2EFailures) ? '**✅ All quality gates pass per organization settings — bias toward approval.**\n' : ''}
---

`;
  }

  const qualityNote = qualityMetrics ? "- **Do the automated quality metrics pass? (See above)**" : "";
  const qualityGateNote = qualityMetrics
    ? "\n   **NOTE: Review the quality metrics above. Only request REVISION_NEEDED for metrics marked as ❌ Blocking per organization settings. Metrics marked ⚠️ Non-blocking or ℹ️ Informational should be noted in feedback but are NOT grounds for revision.**"
    : "";

  // Build CI status section if available
  let ciSection = "";
  if (ciStatus) {
    const ciProviderLabel = (process.env.SCM_PROVIDER || "github") === "bitbucket"
      ? "Bitbucket Pipelines"
      : (process.env.SCM_PROVIDER || "github") === "gitlab"
      ? "GitLab CI"
      : "GitHub Actions";
    if (ciStatus.passed) {
      ciSection = `## CI Pipeline Status

| Check | Status |
|-------|--------|
| **${ciProviderLabel}** | ${ciStatus.fixed ? '✅ Passing (fixed by CI Fix Agent)' : '✅ Passing'} |

---

`;
    } else {
      ciSection = `## CI Pipeline Status

| Check | Status |
|-------|--------|
| **${ciProviderLabel}** | ❌ Failing |

${ciStatus.log ? `**CI Failure Details:**\n\`\`\`\n${ciStatus.log.substring(0, 1000)}\n\`\`\`\n` : ''}
**CI Fix Agent was unable to resolve this issue.**

**⛔ MANDATORY: You MUST request REVISION_NEEDED when CI is failing.** Investigate the CI failure by reading the failure details above and the relevant source files. Identify the root cause and provide specific fix instructions in your revision request. Do NOT approve a PR with failing CI.

---

`;
    }
  }

  // Build SCM-aware instructions
  const scmProvider = process.env.SCM_PROVIDER || "github";
  const isGitHub = scmProvider === "github";
  const isBitbucket = scmProvider === "bitbucket";
  const targetRepo = process.env.TARGET_REPO || process.env.GITHUB_REPO || "";

  // Build SCM-specific diff instructions
  let diffInstructions: string;
  let reviewSubmitInstructions: string;

  if (isGitHub) {
    diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo} --name-only
   \`\`\`

   Then review the diff (for small PRs) or read specific files (for large PRs):
   \`\`\`bash
   gh pr diff ${prNumber} -R ${targetRepo}  # Full diff - use for small PRs (<10 files)
   \`\`\`
   For large PRs with many files, read individual files directly instead of loading the full diff.`;

    reviewSubmitInstructions = `4. **Submit your review to GitHub** (REQUIRED):

   Your review body MUST be substantive — include files reviewed, quality gate results, CI status, key findings, and decision rationale. Do NOT write generic one-liners.

   **If APPROVE:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --approve --body "Your substantive review"
   \`\`\`

   **If REVISION_NEEDED or REJECT:**
   \`\`\`bash
   gh pr review ${prNumber} -R ${targetRepo} --request-changes --body "Your detailed feedback with specific issues"
   \`\`\`

5.`;
  } else if (isBitbucket) {
    diffInstructions = `1. **First, list the changed files to understand the scope**:

   **Option A - Use git diff (if branch is checked out locally):**
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   **Option B - Use Bitbucket API (if you have the PR details):**
   \`\`\`bash
   # List files changed in PR
   curl -s -u "\${BITBUCKET_EMAIL}:\${SCM_TOKEN}" \\
     "https://api.bitbucket.org/2.0/repositories/${targetRepo}/pullrequests/${prNumber}/diffstat" | \\
     jq -r '.values[].new.path // .values[].old.path' 2>/dev/null || echo "Use git diff instead"
   \`\`\`

   Then review the diff:
   - **Small PRs (<10 files)**: Get the full diff
     \`\`\`bash
     git diff origin/main...HEAD
     \`\`\`
   - **Large PRs (10+ files)**: Read individual important files directly instead of loading the entire diff.

   **IMPORTANT:** Do NOT use \`gh\` commands - this is a Bitbucket repository, not GitHub.`;

    reviewSubmitInstructions = `4. **(Bitbucket: Review submission is handled automatically based on your decision markers)**

   Your REVIEW_DECISION and FEEDBACK markers will be used to update the PR status.

5.`;
  } else {
    diffInstructions = `1. **First, list the changed files to understand the scope**:
   \`\`\`bash
   git diff --name-only origin/main...HEAD
   \`\`\`

   Then review selectively based on scope:
   - **Small PRs (<10 files)**: \`git diff origin/main...HEAD\`
   - **Large PRs (10+ files)**: Read individual important files directly.`;

    reviewSubmitInstructions = `4. **(GitLab: Review submission is handled automatically)**

5.`;
  }

  const scmNotice = isBitbucket
    ? `**IMPORTANT:** This is a Bitbucket repository. Do NOT use \`gh\` (GitHub CLI) commands.
Use \`git diff\` commands or Bitbucket API via curl as shown below.`
    : isGitHub
    ? `This is a GitHub repository. Use \`gh\` CLI commands for PR operations.`
    : `This is a ${scmProvider} repository. Use git commands for diff operations.`;

  return `# PR Code Review Task

${revisionSection}${qualitySection}${ciSection}## Task Details
- **Jira Issue**: ${config.jiraIssueKey}
- **PR URL**: ${prUrl}
- **PR Number**: ${prNumber}
- **SCM Provider**: ${scmProvider}
- **Repository**: ${targetRepo}

${scmNotice}

## Instructions

${diffInstructions}

2. **Review the code** against these criteria:
   - Does it correctly implement the Jira requirements?
   - Is the code quality acceptable?
   - Are there security vulnerabilities?
   - Are there test coverage gaps?
   - Does it follow project coding standards?
   ${qualityNote}
   ${lastReviewFeedback ? "- **Have the previous review issues been addressed?**" : ""}

3. **Make your decision**: APPROVE, REVISION_NEEDED, or REJECT${qualityGateNote}

${reviewSubmitInstructions} **Output your decision** using these exact markers:
   \`\`\`
   REVIEW_DECISION: approved
   CODE_QUALITY_SCORE: 8
   FEEDBACK: Your detailed feedback here
   \`\`\`

Begin your review now. Start by fetching the code changes.`;
}

/**
 * Run inline DevOps deployment after Tech Lead approval.
 */
export async function runInlineDeployment(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  ticketOps: TicketOps,
  prUrl: string,
  prNumber: number,
  summaryParts: string[],
  serverPromptTemplates: { devopsPhase1Prompt?: string; devopsDeployAutoPrompt?: string; devopsDeployManualPrompt?: string; devopsCreatePrompt?: string } | undefined,
  callbacks: {
    setDeploymentSucceeded: () => void;
    setMissionActive: (active: boolean) => void;
  }
): Promise<boolean> {
  console.log("[Epic] Running inline DevOps deployment...");
  await postProgressUpdate(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, "deploying", prUrl, prNumber);

  const deployer = new InlineDeployer(config, gitOps.getRepoPath(), serverPromptTemplates ? {
    phase1: serverPromptTemplates.devopsPhase1Prompt,
    deployAuto: serverPromptTemplates.devopsDeployAutoPrompt,
    deployManual: serverPromptTemplates.devopsDeployManualPrompt,
    create: serverPromptTemplates.devopsCreatePrompt,
  } : undefined);
  const deployResult = await deployer.deploy(prUrl, prNumber);

  if (!deployResult.success) {
    console.error("[Epic] Deployment failed:", deployResult.summary);
    await ticketOps.postComment(
      `❌ Deployment failed:\n\n${deployResult.summary}\n\nPR: ${prUrl}\n\n*Requires human intervention.*`
    );
    await handleEscalation(config, ticketOps, prUrl, summaryParts, `Deployment failed: ${deployResult.summary}`);
    return false;
  }

  console.log("[Epic] Deployment succeeded!");
  callbacks.setDeploymentSucceeded();

  let deployMessage = `🚀 Deployed successfully!\n\n${deployResult.summary}`;
  if (deployResult.workflowRunUrl) {
    deployMessage += `\n\nWorkflow: ${deployResult.workflowRunUrl}`;
  }
  deployMessage += `\n\nPR: ${prUrl}`;

  await ticketOps.postComment(deployMessage);
  await ticketOps.transitionTo("Done");

  return true;
}

/**
 * Deployment-only fast path.
 */
export async function runDeploymentOnly(
  config: EpicConfig,
  resilience: ResilienceConfig,
  gitOps: GitOps,
  ticketOps: TicketOps,
  prUrl: string,
  prNumber: number,
  serverPromptTemplates: { devopsPhase1Prompt?: string; devopsDeployAutoPrompt?: string; devopsDeployManualPrompt?: string; devopsCreatePrompt?: string } | undefined,
  callbacks: {
    setDeploymentSucceeded: () => void;
    setMissionActive: (active: boolean) => void;
  }
): Promise<void> {
  console.log(`[Epic] Starting deployment-only run for PR #${prNumber}: ${prUrl}`);

  await ticketOps.postComment(
    `🚀 **Deployment-only run** — merging and deploying PR #${prNumber}.\n\nPR: ${prUrl}`
  );

  await updateTaskStatus(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0, "running", `Deploying PR #${prNumber}`);

  const deployResult = await runInlineDeployment(
    config, resilience, gitOps, ticketOps, prUrl, prNumber, ["Deployment-only run"], serverPromptTemplates, callbacks
  );

  if (deployResult) {
    await updateTaskStatus(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0, "deployed", `Deployed: PR #${prNumber} merged and deployed`, undefined, prUrl);
  }

  callbacks.setMissionActive(false);
}

/**
 * Review-only fast path.
 * Returns true if revision is needed (caller should fall through to full coordination loop).
 */
export async function runReviewOnly(
  config: EpicConfig,
  resilience: ResilienceConfig,
  coordination: CoordinationClient,
  decisionClient: DecisionClient,
  gitOps: GitOps,
  ticketOps: TicketOps,
  prUrl: string,
  prNumber: number,
  serverPromptTemplates: { techLeadReviewPrompt?: string } | undefined,
  callbacks: {
    setRevisionCount: (count: number) => void;
    setLastReviewFeedback: (feedback: string | undefined) => void;
    setMissionActive: (active: boolean) => void;
    setReviewFeedback: (feedback: string) => void;
  }
): Promise<boolean> {
  console.log(`[Epic] Starting review-only run for PR #${prNumber}: ${prUrl}`);

  await ticketOps.postComment(
    `🔍 **Review-only run** — running Tech Lead review on PR #${prNumber}.\n\nPR: ${prUrl}`
  );
  await coordination.postContext(
    "progress",
    `Starting review-only Tech Lead review on PR #${prNumber}`,
    "tech_lead"
  ).catch(() => {});
  await updateTaskStatus(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0, "running", `Reviewing PR #${prNumber}`);

  await gitOps.checkoutForReview(prNumber);

  const managerProvider = process.env.MANAGER_PROVIDER || "anthropic";
  const managerModel = process.env.MANAGER_MODEL || "";
  let reviewResult: InlineReviewResult;

  if (managerProvider === "anthropic") {
    const reviewer = new InlineReviewer(config, gitOps.getRepoPath(), serverPromptTemplates?.techLeadReviewPrompt);
    reviewResult = await reviewer.review(prUrl, prNumber);
  } else {
    reviewResult = await runAiSdkReview(config, decisionClient, gitOps, prUrl, prNumber, managerProvider, managerModel, 0, 0, undefined);
  }

  if (!reviewResult.success) {
    await handleEscalation(config, ticketOps, prUrl, ["Review-only run"], `Review failed: ${reviewResult.error}`);
    callbacks.setMissionActive(false);
    return false;
  }

  switch (reviewResult.decision) {
    case "approved":
      await ticketOps.postComment(
        `✅ PR approved by Tech Lead (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`
      );
      await coordination.postContext(
        "decision",
        `✅ PR #${prNumber} approved (score: ${reviewResult.codeQualityScore}/10)\n\n${reviewResult.feedback}`,
        "tech_lead"
      ).catch(() => {});
      // PRD auto-run: merge the PR
      if (config.prdChildTask) {
        console.log(`[Epic] PRD child task — auto-merging PR #${prNumber} with CI verification`);
        const mergeResult = await mergeWithCIVerification(config, resilience, gitOps, prUrl, prNumber, "PRD auto-run");
        if (mergeResult.merged) {
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `PR #${prNumber} merged successfully`);
          const prdMergeComment = process.env.TICKET_SYSTEM === "github"
            ? GitHubCommentFormat.completed(`PR #${prNumber} auto-merged (PRD workflow).`, prUrl)
            : `🔀 PR #${prNumber} auto-merged (PRD workflow)`;
          await ticketOps.postComment(prdMergeComment);
          if (config.jiraIssueKey) {
            await gitOps.postMergeCleanup(config.jiraIssueKey);
          }
        } else {
          await postLog(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, `❌ PR #${prNumber} merge failed — CI checks did not pass after all retry attempts`);
          await ticketOps.postComment(
            `❌ PR #${prNumber} could not be merged — CI checks failed after all retry attempts.\n\nPR: ${prUrl}\n\n*Manual intervention required.*`
          );
          await updateTaskStatus(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0, "failed", `PR #${prNumber} CI failed — merge blocked`, `CI checks did not pass after all retry attempts`, prUrl);
          callbacks.setMissionActive(false);
          return false;
        }
      }
      await updateTaskStatus(config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0, "pr_approved", `PR #${prNumber} approved by Tech Lead`, undefined, prUrl);
      callbacks.setMissionActive(false);
      return false;

    case "revision_needed":
      await ticketOps.postComment(
        `🔄 Review: Revision needed for PR #${prNumber}\n\n${reviewResult.feedback}`
      );
      await coordination.postContext(
        "revision_requested",
        `🔄 Revision needed for PR #${prNumber}\n\n${reviewResult.feedback}`,
        "tech_lead"
      ).catch(() => {});
      callbacks.setReviewFeedback(reviewResult.feedback);
      callbacks.setLastReviewFeedback(reviewResult.feedback);
      callbacks.setRevisionCount(1);
      return true;

    case "rejected":
      await coordination.postContext(
        "decision",
        `❌ PR #${prNumber} rejected\n\n${reviewResult.feedback}`,
        "tech_lead"
      ).catch(() => {});
      await handleRejection(config, ticketOps, prUrl, ["Review-only run"], reviewResult.feedback);
      callbacks.setMissionActive(false);
      return false;

    default:
      await handleEscalation(config, ticketOps, prUrl, ["Review-only run"], `Unknown review decision: ${reviewResult.decision}`);
      callbacks.setMissionActive(false);
      return false;
  }
}

/**
 * Compute the transitive closure of affected stories.
 */
export function computeAffectedStoryClosure(
  directlyAffected: number[],
  allStories: ReadyStory[]
): Set<number> {
  const toRevise = new Set(directlyAffected);

  const dependents = new Map<number, number[]>();
  for (const story of allStories) {
    for (const dep of story.dependencies) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(story.storyIndex);
    }
  }

  const queue = [...directlyAffected];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const downstreamStories = dependents.get(current) || [];
    for (const downstream of downstreamStories) {
      if (!toRevise.has(downstream)) {
        toRevise.add(downstream);
        queue.push(downstream);
      }
    }
  }

  return toRevise;
}

/**
 * Trigger a revision by resetting story states and injecting feedback.
 */
export async function triggerRevision(
  config: EpicConfig,
  coordination: CoordinationClient,
  gitOps: GitOps,
  expertStates: Map<ExpertPersona, ExpertState>,
  completedStoryIndices: Set<number>,
  locallyCompletedStoryIndices: Set<number>,
  loggedBlockedStories: Set<number>,
  revisionStoriesQueued: ReadyStory[],
  revisionCount: number,
  feedback: string,
  affectedStories?: number[],
  affectedReasons?: Record<number, string>
): Promise<ReadyStory[]> {
  console.log("[Epic] Triggering revision with feedback injection...");

  // Update config with review feedback for story executors to see
  config.reviewFeedback = feedback;
  config.revisionReasons = affectedReasons
    ? Object.fromEntries(
        Object.entries(affectedReasons).map(([k, v]) => [Number(k), v])
      )
    : undefined;

  // Reset all expert states to idle
  for (const expert of getAvailableExperts()) {
    expertStates.set(expert, {
      persona: expert,
      status: "idle",
    });
  }

  // Post revision request to coordination feed for tracking
  await coordination.postRevisionRequest(revisionCount, feedback);

  // Get all stories
  const allStories = await coordination.getReadyStories();

  // Compute which stories need revision
  let storiesToRevise: Set<number>;
  if (affectedStories && affectedStories.length > 0) {
    storiesToRevise = new Set(affectedStories);
    console.log(`[Epic] Selective revision: re-running ${storiesToRevise.size} directly affected stories only (no dependency closure)`);

    if (affectedReasons) {
      for (const [idx, reason] of Object.entries(affectedReasons)) {
        console.log(`[Epic]   Story ${idx}: ${reason}`);
      }
    }
  } else {
    storiesToRevise = new Set(allStories.map(s => s.storyIndex));
    console.log(`[Epic] Full revision: all ${storiesToRevise.size} stories will be re-executed`);
  }

  // Capture prior work context from story branches BEFORE deleting them.
  const priorWorkMap: Record<number, string> = {};
  try {
    const branchSummaries = await gitOps.captureStoryBranchSummaries(
      config.jiraIssueKey,
      storiesToRevise
    );
    for (const [idx, summary] of Object.entries(branchSummaries)) {
      priorWorkMap[Number(idx)] = summary;
    }
    if (Object.keys(priorWorkMap).length > 0) {
      console.log(`[Epic] Captured prior work context for ${Object.keys(priorWorkMap).length} stories`);
    }
  } catch (e) {
    console.warn(`[Epic] Could not capture prior work context: ${e}`);
  }
  config.revisionPriorWork = priorWorkMap;

  // Delete story branches ONLY for stories being revised
  try {
    await gitOps.deleteStoryBranches(config.jiraIssueKey, storiesToRevise);
  } catch (e) {
    console.warn(`[Epic] Could not delete story branches: ${e}`);
  }

  // Archive old claims and completions for affected stories only
  const storyIndicesToArchive = Array.from(storiesToRevise);
  await coordination.archiveStoryClaims(storyIndicesToArchive);

  // Clear completion state for affected stories only
  for (const idx of storiesToRevise) {
    completedStoryIndices.delete(idx);
    locallyCompletedStoryIndices.delete(idx);
  }

  // Clear blocked-story log suppression so revision progress is visible
  for (const idx of storiesToRevise) {
    loggedBlockedStories.delete(idx);
  }

  // Queue only affected stories for re-execution, sorted by index
  const newRevisionQueue = allStories
    .filter(s => storiesToRevise.has(s.storyIndex))
    .sort((a, b) => a.storyIndex - b.storyIndex);

  console.log(`[Epic] Revision triggered. ${newRevisionQueue.length} stories queued for re-execution.`);

  return newRevisionQueue;
}

/**
 * Handle escalation (max revisions reached or review failure).
 */
export async function handleEscalation(
  config: EpicConfig,
  ticketOps: TicketOps,
  prUrl: string,
  summaryParts: string[],
  reason: string
): Promise<void> {
  const jiraComment = `⚠️ Epic escalated for human review:\n\n${reason}\n\nPR: ${prUrl}\n\n*Requires human intervention.*`;
  await ticketOps.postComment(jiraComment);

  await updateTaskStatus(
    config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0,
    "failed",
    `Epic escalated: ${summaryParts.join(", ")} - ${reason}`,
    reason,
    prUrl
  );
}

/**
 * Handle PR rejection.
 */
export async function handleRejection(
  config: EpicConfig,
  ticketOps: TicketOps,
  prUrl: string,
  summaryParts: string[],
  reason: string
): Promise<void> {
  const jiraComment = `❌ Epic rejected by Tech Lead:\n\n${reason}\n\nPR: ${prUrl}\n\n*Implementation approach needs fundamental changes.*`;
  await ticketOps.postComment(jiraComment);

  await updateTaskStatus(
    config.apiBaseUrl, config.orgApiKey, config.parentTaskId, 0,
    "failed",
    `Epic rejected: ${summaryParts.join(", ")} - ${reason}`,
    `Rejected by Tech Lead: ${reason}`,
    prUrl
  );
}
