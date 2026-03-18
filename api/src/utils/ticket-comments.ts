/**
 * Ticket Comment Router
 *
 * Routes comments to the correct issue tracker (Jira, Linear, GitHub Issues)
 * based on the organization's issueTrackerProvider setting.
 */

import { postJiraComment } from "./jira.js";
import { postLinearComment } from "./linear.js";
import { AppDataSource } from "../db/connection.js";
import { Organization, WorkerTask, KbCard, KbComment } from "../models/index.js";
import { logger } from "./logger.js";
import { getOrgCredentials } from "../services/org-credentials.js";

export async function postTicketComment(
  orgId: string,
  issueKey: string,
  comment: string,
): Promise<boolean> {
  const org = await AppDataSource.getRepository(Organization).findOne({
    where: { id: orgId },
    select: ["issueTrackerProvider", "defaultGithubRepo"],
  });
  const system = org?.issueTrackerProvider || "internal";

  switch (system) {
    case "linear":
      return postLinearComment(orgId, issueKey, comment);
    case "jira":
      return postJiraComment(orgId, issueKey, comment);
    case "internal": {
      try {
        // Find the WorkerTask by jiraIssueKey, then find the KbCard linked to it
        const taskRepo = AppDataSource.getRepository(WorkerTask);
        const task = await taskRepo.findOne({
          where: { jiraIssueKey: issueKey, orgId },
          select: ["id", "parentTaskId"],
        });
        if (!task) {
          logger.warn("No WorkerTask found for internal comment", { orgId, issueKey });
          return false;
        }

        const cardRepo = AppDataSource.getRepository(KbCard);
        let card = await cardRepo.findOne({
          where: { workerTaskId: task.id },
          select: ["id"],
        });

        // Fallback: child stories link to parent task's card
        if (!card && task.parentTaskId) {
          card = await cardRepo.findOne({
            where: { workerTaskId: task.parentTaskId },
            select: ["id"],
          });
        }

        if (!card) {
          logger.warn("No KbCard found for internal comment", { orgId, issueKey, taskId: task.id });
          return false;
        }

        const commentRepo = AppDataSource.getRepository(KbComment);
        await commentRepo.save(commentRepo.create({
          cardId: card.id,
          authorId: null,
          content: comment,
        }));
        return true;
      } catch (err) {
        logger.error("Failed to post internal board comment", {
          orgId,
          issueKey,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }
    case "github-issues": {
      try {
        const credentials = await getOrgCredentials(orgId);
        const token = credentials.githubToken || credentials.scmToken;
        const repo = org?.defaultGithubRepo;
        if (!token || !repo) {
          logger.warn("Missing GitHub credentials for issue comment", { orgId });
          return false;
        }
        const issueNumber = issueKey.replace(/^(GH-|#)/, "");
        const response = await fetch(
          `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "Content-Type": "application/json",
              "User-Agent": "WorkerMill-API",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({ body: comment }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok) {
          logger.warn("Failed to post GitHub issue comment", {
            orgId, issueKey, status: response.status,
          });
          return false;
        }
        return true;
      } catch (err) {
        logger.error("Error posting GitHub issue comment", {
          orgId, issueKey, error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    }
    default:
      logger.warn("Unsupported issue tracker provider for comments", {
        orgId,
        system,
      });
      return false;
  }
}
