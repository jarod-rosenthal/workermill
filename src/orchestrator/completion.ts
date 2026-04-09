import { execSync } from "child_process";
import type { CliConfig } from "../config.js";
import * as logger from "../logger.js";
import { execGh, shellArg } from "../git-ops.js";
import { extractGithubIssueNumber } from "../ticket-ops.js";
import { extractExecErrorDetail, clipLogText } from "./utils.js";
import { extractReviewFeedback, parseRequiredReviewOutcome } from "./review.js";
import type { OrchestrationOutput, Story } from "./types.js";

export interface TicketOpsLike {
  postComment(comment: string): Promise<void>;
  transitionTo(state: string): Promise<void>;
}

export function shouldTransitionTicketOnPrOpen(ticketSystem: string | undefined): boolean {
  return (ticketSystem || "").toLowerCase() !== "github";
}

export async function completeFeatureBranchFlow(args: {
  featureBranch: string;
  mainBranch: string;
  workingDir: string;
  output: OrchestrationOutput;
  stories: Story[];
  userTask: string;
  finalReviewText: string;
  config: CliConfig;
  ticketOps: TicketOpsLike | null;
  resolvedTicketSystem: string;
  ticketKey?: string;
}): Promise<void> {
  const {
    featureBranch,
    mainBranch,
    workingDir,
    output,
    stories,
    userTask,
    finalReviewText,
    config,
    ticketOps,
    resolvedTicketSystem,
    ticketKey,
  } = args;

  const commitCount = execSync(`git rev-list --count ${mainBranch}..HEAD 2>/dev/null || echo 0`, {
    cwd: workingDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  output.log("system", `Branch: ${featureBranch} (${commitCount} commits)`);

  try {
    execSync("git add .", { cwd: workingDir, stdio: "pipe" });
    const status = execSync("git status --porcelain", { cwd: workingDir, encoding: "utf-8", stdio: "pipe" }).trim();
    if (status) {
      execSync('git commit --no-verify -m "chore: uncommitted changes from /build session"', { cwd: workingDir, stdio: "pipe" });
    }
  } catch {
    // nothing to commit
  }

  let hasRemote = false;
  try {
    const remote = execSync("git remote get-url origin 2>/dev/null", {
      cwd: workingDir,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim();
    hasRemote = !!remote;
  } catch {
    // no remote
  }

  if (!hasRemote) {
    output.log("system", `No remote configured. Branch: \`${featureBranch}\``);
    return;
  }

  output.log("system", `To review the full diff first, say no and run: \`!git diff ${mainBranch}..HEAD\``);
  const promptResult = await output.confirm("Push branch and open a pull request?");
  const confirmed = typeof promptResult === "object" ? promptResult.allowed : promptResult;
  logger.info("PR prompt answered", { confirmed, featureBranch, mainBranch });
  if (!confirmed) {
    logger.info("PR prompt declined", { featureBranch, mainBranch });
    output.log("system", `Branch is local: \`${featureBranch}\``);
    output.log("system", `To push later: git push -u origin ${featureBranch}`);
    output.log("system", `To create a PR: gh pr create --head ${featureBranch}`);
    return;
  }

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
      if (!isDiverged) throw pushErr;

      output.statusDone();
      output.log("system", `Push failed — remote branch \`${featureBranch}\` has divergent history from a previous run.`);
      const force = await output.confirm("Force-push with --force-with-lease? (safe if you reset the branch yourself)");
      const forceConfirmed = typeof force === "object" ? force.allowed : force;
      if (!forceConfirmed) {
        output.log("system", `Branch is local. Push manually: \`git push --force-with-lease -u origin ${featureBranch}\``);
        return;
      }
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
        return;
      }
    }
    logger.info("Branch push completed", {
      featureBranch,
      output: clipLogText(pushOutput),
    });
    output.statusDone();

    await createPullRequest({
      featureBranch,
      mainBranch,
      workingDir,
      output,
      stories,
      userTask,
      finalReviewText,
      config,
      ticketOps,
      resolvedTicketSystem,
      ticketKey,
    });
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
}

async function createPullRequest(args: {
  featureBranch: string;
  mainBranch: string;
  workingDir: string;
  output: OrchestrationOutput;
  stories: Story[];
  userTask: string;
  finalReviewText: string;
  config: CliConfig;
  ticketOps: TicketOpsLike | null;
  resolvedTicketSystem: string;
  ticketKey?: string;
}): Promise<void> {
  const {
    featureBranch,
    mainBranch,
    workingDir,
    output,
    stories,
    userTask,
    finalReviewText,
    config,
    ticketOps,
    resolvedTicketSystem,
    ticketKey,
  } = args;

  try {
    const storyTitles = stories.map((story) => story.title).join(", ");
    const prTitle = storyTitles.length > 70 ? `${storyTitles.slice(0, 67)}...` : storyTitles;
    logger.info("Creating pull request", { featureBranch, mainBranch, prTitle });

    const prParts: string[] = [];
    prParts.push("## Task\n");
    prParts.push(userTask);
    prParts.push("\n## Stories\n");
    prParts.push(stories.map((story, index) => `- **Story ${index + 1}** (${story.persona}): ${story.title}`).join("\n"));
    if (finalReviewText) {
      const feedbackMatch = finalReviewText.match(/FEEDBACK:\s*([\s\S]*?)(?=AFFECTED_|REVIEW_DECISION|CODE_QUALITY|$)/i);
      const feedback = feedbackMatch
        ? feedbackMatch[1].trim()
        : finalReviewText
            .split("\n")
            .filter((line: string) => !line.includes("REVIEW_DECISION") && !line.includes("CODE_QUALITY_SCORE") && !line.includes("AFFECTED_"))
            .join("\n")
            .trim();
      if (feedback) {
        prParts.push("\n## Tech Lead Review\n");
        prParts.push(feedback);
      }
    }
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

    if (ticketOps && shouldTransitionTicketOnPrOpen(resolvedTicketSystem)) {
      try {
        await ticketOps.transitionTo("done");
        output.log("system", `Closed ${ticketKey}`);
      } catch {
        // Non-critical
      }
    }

    if (finalReviewText) {
      try {
        const parsedPrReview = parseRequiredReviewOutcome(finalReviewText);
        const reviewScore = parsedPrReview.score;
        const feedback = extractReviewFeedback(finalReviewText, parsedPrReview.decision);
        const emoji = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "✅" : "🔄";
        const reviewBody = `## ${emoji} Tech Lead Review\n\n**Code Quality Score:** ${reviewScore}/10\n\n${feedback}`;
        const reviewFlag = reviewScore >= (config.review?.approvalThreshold ?? 9) ? "--approve" : "--request-changes";
        execSync("gh pr review --body-file - " + reviewFlag + " 2>&1", {
          cwd: workingDir,
          encoding: "utf-8",
          input: reviewBody,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 15_000,
        });
      } catch (reviewCommentErr) {
        logger.warn("Failed to post structured PR review comment", {
          error: reviewCommentErr instanceof Error ? reviewCommentErr.message : String(reviewCommentErr),
        });
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
}

export async function postCompletionSummaryToTicket(args: {
  ticketOps: TicketOpsLike | null;
  stories: Story[];
  completedStoryIds: string[];
}): Promise<void> {
  const { ticketOps, stories, completedStoryIds } = args;
  if (!ticketOps) return;

  try {
    const { GitHubCommentFormat } = await import("../ticket-ops.js");
    const completedCount = stories.filter((story) => completedStoryIds.includes(story.id)).length;
    const storyList = stories
      .map((story, index) => {
        const done = completedStoryIds.includes(story.id);
        return `${done ? "✅" : "❌"} **Story ${index + 1}** (${story.persona}): ${story.title}`;
      })
      .join("\n");
    const summary = `${completedCount}/${stories.length} stories completed.\n\n${storyList}`;
    await ticketOps.postComment(GitHubCommentFormat.completed(summary));
  } catch {
    // Soft failure
  }
}
