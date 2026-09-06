import crypto from "crypto";
import type { CliConfig, HooksConfig } from "../config.js";
import * as logger from "../logger.js";
import { runProcess } from "../engine/process-runner.js";

/**
 * Runs publication commands through the run-scoped async process runner.
 * Dynamic values are single-quoted before crossing its shell boundary.
 */
function shellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function completionProcess(
  runId: string,
  executable: "git" | "gh",
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const command = [executable, ...args].map(shellArg).join(" ");
  const result = await runProcess({
    runId,
    command,
    cwd,
    signal,
    timeoutMs,
    maxOutputBytes: 1024 * 1024,
    terminationGraceMs: 1_000,
  });
  const combined = `${result.stdout}${result.stderr}`.trim();
  if (result.reason !== "exited" || result.exitCode !== 0 || result.outputTruncated) {
    const reason = result.outputTruncated
      ? "output truncated"
      : result.reason === "timed_out"
        ? "timed out"
        : result.reason === "cancelled"
          ? "cancelled"
          : result.reason === "spawn_failed"
            ? "failed to start"
            : `exit ${result.exitCode}`;
    const error = new Error(combined || `${executable} ${args[0] ?? ""} ${reason}`);
    Object.assign(error, {
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined,
      status: result.exitCode,
      publicationReason: reason,
    });
    throw error;
  }
  return combined;
}

function completionSignal(abortSignal: AbortSignal | undefined): AbortSignal {
  if (abortSignal) return abortSignal;
  return new AbortController().signal;
}
import { extractGithubIssueNumber } from "../ticket-ops.js";
import { runLifecycleHooks } from "../hooks.js";
import { clearShipRun } from "../ship-state.js";
import type { CostTracker } from "../cost-tracker.js";
import type { LiveViewServer } from "../live-view-server.js";
import { extractExecErrorDetail, clipLogText } from "./utils.js";
import { captureRepositoryFingerprint } from "../repository-fingerprint.js";
export { prepareCandidate } from "./candidate.js";
import type { OrchestrationOutput, Story, OrchestrationResult, CompletionEvidence } from "./types.js";
import { fingerprintsMatch } from "./types.js";

export interface TicketOpsLike {
  postComment(comment: string): Promise<void>;
  transitionTo(state: string): Promise<void>;
}

export function shouldTransitionTicketOnPrOpen(ticketSystem: string | undefined): boolean {
  return (ticketSystem || "").toLowerCase() !== "github";
}

/** Typed policy is authoritative; review prose is only presentation. */
function hasBlockingGateFailure(evidence: CompletionEvidence, strict: boolean): boolean {
  return evidence.gateResults.some((gate) => gate.status !== "passed" && (strict || gate.required));
}

/**
 * Handles the completion phase of orchestration:
 * - Checks final evidence and shows the prepared branch summary
 * - Prompts to push and create PR (with force-push for diverged branches)
 * - Posts PR review comment
 * - Closes ticket for non-GitHub trackers
 * - Posts final completion to ticket
 * - Clears retry state only after the final evidence check
 */
export async function runCompletion(args: {
  config: CliConfig;
  output: OrchestrationOutput;
  sorted: Story[];
  completedStoryIds: string[];
  featureBranch: string | null;
  mainBranch: string;
  workingDir: string;
  userTask: string;
  costTracker: CostTracker;
  finalReviewText: string;
  ticketKey?: string;
  ticketOps: TicketOpsLike | null;
  resolvedTicketSystem: string;
  liveViewServer?: LiveViewServer;
  hooks: HooksConfig | undefined;
  evidence: CompletionEvidence;
  /** Parent run identity for publication subprocess ownership. */
  runId?: string;
  abortSignal?: AbortSignal;
}): Promise<OrchestrationResult> {
  const {
    config, output, sorted, completedStoryIds, featureBranch, mainBranch,
    workingDir, userTask, costTracker, finalReviewText, ticketKey,
    ticketOps, resolvedTicketSystem, liveViewServer, hooks, evidence, abortSignal,
  } = args;

  const strict = config.review?.strict === true;
  const runId = args.runId ?? `completion-${crypto.randomUUID()}`;
  const signal = completionSignal(abortSignal);
  const gitRead = (gitArgs: string[]): Promise<string> =>
    completionProcess(runId, "git", ["-c", "core.fsmonitor=false", ...gitArgs], workingDir, signal, 10_000);
  const gitPublish = (gitArgs: string[]): Promise<string> =>
    completionProcess(runId, "git", ["-c", "core.fsmonitor=false", ...gitArgs], workingDir, signal, 120_000);
  const ghPublish = (ghArgs: string[]): Promise<string> =>
    completionProcess(runId, "gh", ghArgs, workingDir, signal, 120_000);
  const publicationAllowed = async (): Promise<boolean> => {
    if (abortSignal?.aborted) {
      output.coordinatorLog("Publication blocked: build cancelled.");
      return false;
    }
    if (hasBlockingGateFailure(evidence, strict)) {
      output.error("Publication blocked: required quality gates are not passing.");
      return false;
    }
    if (strict && config.review?.enabled !== false && !evidence.reviewOutcome.approved) {
      output.error(`Publication blocked: strict mode requires reviewer approval (review: ${evidence.reviewOutcome.kind}).`);
      return false;
    }
    const current = await captureRepositoryFingerprint(workingDir, abortSignal);
    if (!fingerprintsMatch(evidence.fingerprint, current)) {
      output.error(`Publication blocked: final evidence is stale${current.verified ? "." : ` (${current.reason})`}`);
      return false;
    }
    if (featureBranch) {
      try {
        const checkedOut = await gitRead(["branch", "--show-current"]);
        const branchHead = await gitRead(["rev-parse", "--verify", "--end-of-options", `refs/heads/${featureBranch}`]);
        if (checkedOut !== featureBranch || branchHead !== evidence.fingerprint.head) {
          output.error("Publication blocked: the expected feature branch no longer points at the verified candidate.");
          return false;
        }
      } catch {
        output.error("Publication blocked: could not verify the checked-out feature branch.");
        return false;
      }
    }
    return true;
  };

  if (!await publicationAllowed()) {
    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
  }

  // --- Completion Summary ---
  try {
    if (featureBranch) {
      // Show branch summary
      const commitCount = await gitRead(["rev-list", "--count", `refs/heads/${mainBranch}..HEAD`, "--"]);

      output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

      // Check if remote exists for PR
      let hasRemote = false;
      try {
        const remote = await gitRead(["remote", "get-url", "origin"]);
        hasRemote = !!remote;
      } catch { /* no remote */ }

      if (hasRemote) {
        output.log("system", `To review the full diff first, say no and run: \`!git diff ${mainBranch}..HEAD\``);
        const cr = await output.confirm("Push branch and open a pull request?");
        const confirmed = typeof cr === "object" ? cr.allowed : cr;
        logger.info("PR prompt answered", { confirmed, featureBranch, mainBranch });
        if (confirmed) {
          // A human prompt is an arbitrary pause. Recheck evidence immediately
          // afterwards, before any remote or ticket side effect.
          if (!await publicationAllowed()) {
            return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
          }
          try {
            output.status("Pushing branch...");
            let pushOutput = "";
            try {
              pushOutput = await gitPublish(["push", "-u", "origin", featureBranch]);
            } catch (pushErr) {
              const msg = String(pushErr);
              const isDiverged = msg.includes("non-fast-forward") || msg.includes("Updates were rejected");
              if (isDiverged) {
                output.statusDone();
                output.log("system", `Push failed — remote branch \`${featureBranch}\` has divergent history from a previous run.`);
                const force = await output.confirm("Force-push with --force-with-lease? (safe if you reset the branch yourself)");
                const confirmed = typeof force === "object" ? force.allowed : force;
                if (confirmed) {
                  if (!await publicationAllowed()) {
                    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
                  }
                  try {
                    pushOutput = await gitPublish(["push", "--force-with-lease", "-u", "origin", featureBranch]);
                    output.statusDone();
                  } catch (forceErr) {
                    output.statusDone();
                    output.log("system", `Force-push also failed: ${String(forceErr)}`);
                    output.log("system", `Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
                  }
                } else {
                  output.statusDone();
                  output.log("system", `Branch is local. Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                  return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
                }
              } else {
                throw pushErr;
              }
            }
            logger.info("Branch push completed", {
              featureBranch,
              output: clipLogText(pushOutput),
            });
            output.statusDone();

            // Try to create PR with gh CLI
            try {
              if (!await publicationAllowed()) {
                return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
              }
              const storyTitles = sorted.map(s => s.title).join(", ");
              const prTitle = storyTitles.length > 70 ? storyTitles.slice(0, 67) + "..." : storyTitles;
              logger.info("Creating pull request", { featureBranch, mainBranch, prTitle });

              // Build PR body: task overview + stories + tech lead review
              const prParts: string[] = [];
              prParts.push("## Task\n");
              prParts.push(userTask);
              prParts.push("\n## Stories\n");
              prParts.push(sorted.map((s, i) => `- **Story ${i + 1}** (${s.persona}): ${s.title}`).join("\n"));
              if (finalReviewText) {
                // Extract just the FEEDBACK section from the review, not the markers
                const feedbackMatch = finalReviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|$)/i);
                const feedback = feedbackMatch ? feedbackMatch[1].trim() : finalReviewText.split("\n").filter((l: string) => !l.includes("REVIEW_DECISION") && !l.includes("CODE_QUALITY_SCORE") && !l.includes("AFFECTED_")).join("\n").trim();
                if (feedback) {
                  prParts.push("\n## Tech Lead Review\n");
                  prParts.push(feedback);
                }
              }
              // Link PR to source issue in body so GitHub can auto-close on merge.
              if (ticketKey && resolvedTicketSystem === "github") {
                const issueNum = extractGithubIssueNumber(ticketKey);
                prParts.push(`\nCloses #${issueNum}`);
              }
              prParts.push("\n---\nShipped by [WorkerMill CLI](https://workermill.com)");
              const prBody = prParts.join("\n");
              const prUrl = await ghPublish(
                ["pr", "create", "--title", prTitle, "--body", prBody, "--head", featureBranch, "--base", mainBranch],
              );
              logger.info("Pull request created", { prUrl, featureBranch, mainBranch });
              output.log("system", `Pull request created: ${prUrl}`);

              // Close source ticket for non-GitHub trackers. GitHub issues should
              // close on merge via PR keywords (e.g. "Closes #123"), not on PR open.
              if (ticketOps && shouldTransitionTicketOnPrOpen(resolvedTicketSystem)) {
                try {
                  if (!await publicationAllowed()) {
                    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
                  }
                  await ticketOps.transitionTo("done");
                  output.log("system", `Closed ${ticketKey}`);
                } catch {
                  // Non-critical — don't block on ticket system errors
                }
              }

              // Post the tech lead review as a proper GitHub PR review
              // Matches worker/epic/coordinator-review.ts ensureGitHubReviewPosted()
              if (finalReviewText) {
                try {
                  if (!await publicationAllowed()) return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
                  const reviewScore = evidence.reviewOutcome.score;
                  const decision = evidence.reviewOutcome.decision;
                  const feedback = evidence.reviewOutcome.feedback;
                  if (reviewScore === undefined || !decision || !feedback) throw new Error("No structured review decision available for PR comment");
                  const emoji = evidence.reviewOutcome.approved ? "✅" : "🔄";
                  const reviewBody = `## ${emoji} Tech Lead Review\n\n**Code Quality Score:** ${reviewScore}/10\n\n${feedback}`;
                  const reviewFlag = evidence.reviewOutcome.approved ? "--approve" : "--request-changes";
                  await ghPublish(["pr", "review", "--body", reviewBody, reviewFlag]);
                } catch (reviewCommentErr) {
                  logger.warn("Failed to post structured PR review comment", {
                    error: reviewCommentErr instanceof Error ? reviewCommentErr.message : String(reviewCommentErr),
                  });
                  // Non-critical — review comment is best-effort
                }
              }
            } catch (prErr) {
              const prDetail = extractExecErrorDetail(prErr);
              logger.error("Pull request creation failed", {
                featureBranch,
                mainBranch,
                summary: prDetail.summary,
                stdout: clipLogText(prDetail.stdout),
                stderr: clipLogText(prDetail.stderr),
              });
              output.log("system", `Branch pushed. Create a PR manually (gh CLI error: ${prDetail.summary})`);
            }
          } catch (pushErr) {
            output.statusDone();
            const pushDetail = extractExecErrorDetail(pushErr);
            logger.error("Branch push failed", {
              featureBranch,
              summary: pushDetail.summary,
              stdout: clipLogText(pushDetail.stdout),
              stderr: clipLogText(pushDetail.stderr),
            });
            output.log("system", `Push failed: ${pushDetail.summary}`);
            output.log("system", `Branch is local: \`${featureBranch}\`. Push manually with: git push -u origin ${featureBranch}`);
          }
        } else {
          logger.info("PR prompt declined", { featureBranch, mainBranch });
          output.log("system", `Branch is local: \`${featureBranch}\``);
          output.log("system", `To push later: git push -u origin ${featureBranch}`);
          output.log("system", `To create a PR: gh pr create --head ${featureBranch}`);
        }
      } else {
        output.log("system", `No remote configured. Branch: \`${featureBranch}\``);
      }
    } else {
      // No feature branch: show local changes without mutating verified state.
      const diff = await gitRead(["diff", "--stat", "--no-ext-diff", "--no-textconv"]);
      let untracked = "";
      try {
        untracked = await gitRead(["ls-files", "--others", "--exclude-standard"]);
      } catch {
        // A summary probe is best-effort; it must not be mistaken for publish success.
      }
      if (diff || untracked) {
        output.coordinatorLog(`${diff ? diff.split("\n").length : 0} modified, ${untracked ? untracked.split("\n").filter(Boolean).length : 0} new files`);
      }
    }
  } catch (err) {
    logger.debug("Completion summary failed", { error: err instanceof Error ? err.message : String(err) });
  }

  // Final cost update
  output.updateCost?.(costTracker.getTotalCost());
  output.updateUsageSummary?.(costTracker.getUsageSummary());

  const beforeShipComplete = await captureRepositoryFingerprint(workingDir, abortSignal);
  if (abortSignal?.aborted || !fingerprintsMatch(evidence.fingerprint, beforeShipComplete)) {
    output.error("Completion blocked: final evidence changed before ship_complete.");
    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
  }
  runLifecycleHooks("ship_complete", hooks, workingDir, {
    WORKERMILL_COST: costTracker.getTotalCost().toFixed(4),
  });
  const afterShipComplete = await captureRepositoryFingerprint(workingDir, abortSignal);
  const shipCompleteChangedSource = abortSignal?.aborted === true
    || !fingerprintsMatch(evidence.fingerprint, beforeShipComplete)
    || !fingerprintsMatch(beforeShipComplete, afterShipComplete);
  if (shipCompleteChangedSource) {
    output.error("ship_complete changed local source or invalidated final evidence; the changed state is not verified.");
  }

  // Post final completion to ticket — matches worker/epic/coordinator-review.ts
  if (ticketOps && !shipCompleteChangedSource) {
    try {
      if (!await publicationAllowed()) {
        return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
      }
      const { GitHubCommentFormat } = await import("../ticket-ops.js");
      const completedCount = sorted.filter((s) => completedStoryIds.includes(s.id)).length;
      const storyList = sorted.map((s, i) => {
        const done = completedStoryIds.includes(s.id);
        return `${done ? "✅" : "❌"} **Story ${i + 1}** (${s.persona}): ${s.title}`;
      }).join("\n");
      const summary = `${completedCount}/${sorted.length} stories completed.\n\n${storyList}`;
      // prUrl is captured earlier if PR was created
      await ticketOps.postComment(GitHubCommentFormat.completed(summary));
    } catch {
      // Soft failure — don't crash on post-back errors
    }
  }

  // Keep recovery until every awaited completion step has finished and the
  // final local state still matches its evidence.
  if (!shipCompleteChangedSource && !await publicationAllowed()) {
    return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: true };
  }
  if (!shipCompleteChangedSource && featureBranch && completedStoryIds.length === sorted.length) clearShipRun(featureBranch);

  // Emit run complete event
  if (liveViewServer && !shipCompleteChangedSource) {
    const commitCount = featureBranch ? parseInt(await gitRead(["rev-list", "--count", `refs/heads/${mainBranch}..HEAD`, "--"]), 10) : 0;
    liveViewServer.emitRunComplete(featureBranch || "main", commitCount);
  }

  // Keep live view server alive for the current CLI session so users can
  // keep the same browser tab open across multiple /build runs.

  return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: shipCompleteChangedSource };
}
