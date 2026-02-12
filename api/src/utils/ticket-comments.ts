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

export async function postTicketComment(
  orgId: string,
  issueKey: string,
  comment: string,
): Promise<boolean> {
  const org = await AppDataSource.getRepository(Organization).findOne({
    where: { id: orgId },
    select: ["issueTrackerProvider"],
  });
  const system = org?.issueTrackerProvider || "jira";

  switch (system) {
    case "linear":
      return postLinearComment(orgId, issueKey, comment);
    case "jira":
      return postJiraComment(orgId, issueKey, comment);
    case "internal": {
      try {
        // Find the WorkerTask by jiraIssueKey, then find the KbCard linked to it
        const task = await AppDataSource.getRepository(WorkerTask).findOne({
          where: { jiraIssueKey: issueKey, orgId },
          select: ["id"],
        });
        if (!task) {
          logger.warn("No WorkerTask found for internal comment", { orgId, issueKey });
          return false;
        }

        const card = await AppDataSource.getRepository(KbCard).findOne({
          where: { workerTaskId: task.id },
          select: ["id"],
        });
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
    default:
      logger.warn("Unsupported issue tracker provider for comments", {
        orgId,
        system,
      });
      return false;
  }
}
