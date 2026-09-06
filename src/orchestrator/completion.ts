import { execSync, spawnSync } from "child_process";
import type { CliConfig, HooksConfig } from "../config.js";
import * as logger from "../logger.js";
import { execGh } from "../git-ops.js";

/**
 * Run `git` with an argument array, returning combined stdout+stderr.
 * Throws an Error whose message contains the combined output so callers
 * that inspect `String(err)` for patterns like "non-fast-forward" keep working.
 * Replaces `execSync(\`git ... 2>&1\`)` patterns without invoking a shell.
 */
function gitCombined(args: string[], cwd: string): string {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  const combined = ((result.stdout || "") + (result.stderr || "")).trim();
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error(combined || `git ${args[0]} failed (exit ${result.status})`);
    (err as unknown as { stdout?: string; stderr?: string; status: number | null }).stdout = result.stdout || undefined;
    (err as unknown as { stdout?: string; stderr?: string; status: number | null }).stderr = result.stderr || undefined;
    (err as unknown as { stdout?: string; stderr?: string; status: number | null }).status = result.status;
    throw err;
  }
  return combined;
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
 * - Cleans up temp files, MCP servers, LSP
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
  abortSignal?: AbortSignal;
}): Promise<OrchestrationResult> {
  const {
    config, output, sorted, completedStoryIds, featureBranch, mainBranch,
    workingDir, userTask, costTracker, finalReviewText, ticketKey,
    ticketOps, resolvedTicketSystem, liveViewServer, hooks, evidence, abortSignal,
  } = args;

  const strict = config.review?.strict === true;
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
        const checkedOut = gitCombined(["branch", "--show-current"], workingDir);
        const branchHead = gitCombined(["rev-parse", "--verify", "--end-of-options", `refs/heads/${featureBranch}`], workingDir);
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
      const commitCount = gitCombined(["rev-list", "--count", `refs/heads/${mainBranch}..HEAD`, "--"], workingDir);

      output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

      // Check if remote exists for PR
      let hasRemote = false;
      try {
        const remote = execSync("git remote get-url origin 2>/dev/null", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
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
              pushOutput = gitCombined(["push", "-u", "origin", featureBranch], workingDir);
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
                    pushOutput = gitCombined(["push", "--force-with-lease", "-u", "origin", featureBranch], workingDir);
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
              const prUrl = execGh(
                ["pr", "create", "--title", prTitle, "--body-file", "-", "--head", featureBranch, "--base", mainBranch],
                { cwd: workingDir, input: prBody },
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
                  execSync(
                    `gh pr review --body-file - ${reviewFlag} 2>&1`,
                    { cwd: workingDir, encoding: "utf-8", input: reviewBody, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 },
                  );
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
      const diff = gitCombined(["diff", "--stat", "--no-ext-diff", "--no-textconv"], workingDir);
      const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
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
    const commitCount = featureBranch ? parseInt(gitCombined(["rev-list", "--count", `refs/heads/${mainBranch}..HEAD`, "--"], workingDir), 10) : 0;
    liveViewServer.emitRunComplete(featureBranch || "main", commitCount);
  }

  // Keep live view server alive for the current CLI session so users can
  // keep the same browser tab open across multiple /build runs.

  return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch, completionInvalidated: shipCompleteChangedSource };
}
