/**
 * Ticket Comment Router
 *
 * Routes comments to the correct issue tracker (Jira, Linear, GitHub Issues)
 * based on the organization's issueTrackerProvider setting.
 */

import { postJiraComment } from "./jira.js";
import { postLinearComment } from "./linear.js";
import { AppDataSource } from "../db/connection.js";
import { Organization } from "../models/index.js";
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
    default:
      logger.warn("Unsupported issue tracker provider for comments", {
        orgId,
        system,
      });
      return false;
  }
}
