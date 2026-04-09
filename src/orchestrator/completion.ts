import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { CliConfig, HooksConfig } from "../config.js";
import * as logger from "../logger.js";
import { execGh, shellArg } from "../git-ops.js";
import { extractGithubIssueNumber } from "../ticket-ops.js";
import { runLifecycleHooks } from "../hooks.js";
import { clearShipRun } from "../ship-state.js";
import { stopAllMCPServers } from "../mcp-client.js";
import type { CostTracker } from "../cost-tracker.js";
import type { LiveViewServer } from "../live-view-server.js";
import { extractExecErrorDetail, clipLogText } from "./utils.js";
import { extractReviewFeedback, parseRequiredReviewOutcome } from "./review.js";
import type { OrchestrationOutput, Story, OrchestrationResult } from "./types.js";

export interface TicketOpsLike {
  postComment(comment: string): Promise<void>;
  transitionTo(state: string): Promise<void>;
}

export function shouldTransitionTicketOnPrOpen(ticketSystem: string | undefined): boolean {
  return (ticketSystem || "").toLowerCase() !== "github";
}

/**
 * Handles the completion phase of orchestration:
 * - Shows branch summary and commits remaining changes
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
}): Promise<OrchestrationResult> {
  const {
    config, output, sorted, completedStoryIds, featureBranch, mainBranch,
    workingDir, userTask, costTracker, finalReviewText, ticketKey,
    ticketOps, resolvedTicketSystem, liveViewServer, hooks,
  } = args;

  // --- Completion Summary ---
  try {
    if (featureBranch) {
      // Show branch summary
      const commitCount = execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();

      output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

      // Commit any remaining uncommitted changes
      try {
        execSync("git add .", { cwd: workingDir, stdio: "pipe" });
        const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
        if (status) {
          execSync('git commit --no-verify -m "chore: uncommitted changes from /build session"', { cwd: workingDir, stdio: "pipe" });
        }
      } catch { /* nothing to commit */ }

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
          try {
            output.status("Pushing branch...");
            let pushOutput = "";
            try {
              pushOutput = execSync(`git push -u origin ${shellArg(featureBranch)} 2>&1`, {
                cwd: workingDir,
                encoding: "utf-8",
                stdio: "pipe",
              }).trim();
            } catch (pushErr) {
              const msg = String(pushErr);
              const isDiverged = msg.includes("non-fast-forward") || msg.includes("Updates were rejected");
              if (isDiverged) {
                output.statusDone();
                output.log("system", `Push failed — remote branch \`${featureBranch}\` has divergent history from a previous run.`);
                const force = await output.confirm("Force-push with --force-with-lease? (safe if you reset the branch yourself)");
                const confirmed = typeof force === "object" ? force.allowed : force;
                if (confirmed) {
                  try {
                    pushOutput = execSync(`git push --force-with-lease -u origin ${shellArg(featureBranch)} 2>&1`, {
                      cwd: workingDir,
                      encoding: "utf-8",
                      stdio: "pipe",
                    }).trim();
                    output.statusDone();
                  } catch (forceErr) {
                    output.statusDone();
                    output.log("system", `Force-push also failed: ${String(forceErr)}`);
                    output.log("system", `Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                    return { stories: sorted, completedStoryIds, featureBranch, userTask };
                  }
                } else {
                  output.statusDone();
                  output.log("system", `Branch is local. Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
                  return { stories: sorted, completedStoryIds, featureBranch, userTask };
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
                  const parsedPrReview = parseRequiredReviewOutcome(finalReviewText);
                  const reviewScore = parsedPrReview.score;
                  const feedback = extractReviewFeedback(finalReviewText, parsedPrReview.decision);
                  const emoji = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "✅" : "🔄";
                  const reviewBody = `## ${emoji} Tech Lead Review\n\n**Code Quality Score:** ${reviewScore}/10\n\n${feedback}`;
                  const reviewFlag = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "--approve" : "--request-changes";
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
      // No feature branch — old behavior, commit uncommitted changes
      const diff = execSync("git diff --stat 2>/dev/null || true", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
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

  // On full success: clear retry state. Stay on the feature branch so the
  // developer can review, test, and push when ready.
  if (featureBranch && completedStoryIds.length === sorted.length) {
    clearShipRun(featureBranch);
  }

  runLifecycleHooks("ship_complete", hooks, workingDir, {
    WORKERMILL_COST: costTracker.getTotalCost().toFixed(4),
  });

  // Post final completion to ticket — matches worker/epic/coordinator-review.ts
  if (ticketOps) {
    try {
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

  // Clean up temp review diff file
  try { fs.unlinkSync(path.join(workingDir, ".workermill-review-diff.tmp")); } catch { /* may not exist */ }

  // Emit run complete event
  if (liveViewServer) {
    const commitCount = featureBranch ? parseInt(execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim()) : 0;
    liveViewServer.emitRunComplete(featureBranch || "main", commitCount);
  }

  // Stop MCP servers and language server
  stopAllMCPServers();
  const { shutdown: shutdownLSP } = await import("../engine/tools/lsp.js");
  shutdownLSP();

  // Keep live view server alive for the current CLI session so users can
  // keep the same browser tab open across multiple /build runs.

  return { stories: sorted, completedStoryIds, featureBranch, userTask, mainBranch };
}
