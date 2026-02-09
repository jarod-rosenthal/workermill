/**
 * Task Relationship Sync
 *
 * After a WorkerTask is created from a webhook, this service fetches
 * issue relationships (blocks/blocked-by) from the source tracker
 * (Jira or Linear) and creates TaskRelationship records so the
 * orchestrator can respect cross-ticket dependencies.
 *
 * Works with both Jira (REST API) and Linear (GraphQL).
 * Runs asynchronously — failures are logged but don't block task creation.
 */

import axios from "axios";
import { AppDataSource } from "../db/connection.js";
import { WorkerTask } from "../models/WorkerTask.js";
import {
  TaskRelationship,
  type TaskRelationshipType,
  type RelationshipSource,
} from "../models/TaskRelationship.js";
import { Organization } from "../models/Organization.js";
import { logger } from "../utils/logger.js";

interface IssueLink {
  /** The issue key of the related issue (e.g., "OCS-123" or "LIN-45") */
  relatedIssueKey: string;
  /** Relationship type normalized to TaskRelationshipType */
  relationshipType: TaskRelationshipType;
}

/**
 * Fetch issue links from Jira REST API.
 * Jira includes issuelinks in the issue fields when fetched with ?fields=issuelinks.
 */
async function fetchJiraIssueLinks(
  issueKey: string,
  org: Organization,
): Promise<IssueLink[]> {
  const providerSettings = org.providerSettings as Record<string, unknown>;
  const jiraBaseUrl =
    (providerSettings?.jiraBaseUrl as string) ||
    process.env.JIRA_BASE_URL;
  const jiraEmail =
    (providerSettings?.jiraEmail as string) ||
    process.env.JIRA_EMAIL;
  const jiraApiToken =
    (providerSettings?.jiraApiToken as string) ||
    process.env.JIRA_API_TOKEN;

  if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
    logger.debug("Jira credentials not configured — skipping relationship sync", {
      issueKey,
      orgId: org.id,
    });
    return [];
  }

  const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}?fields=issuelinks`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64")}`,
      Accept: "application/json",
    },
    timeout: 10_000,
  });

  const issuelinks = response.data?.fields?.issuelinks || [];
  const links: IssueLink[] = [];

  for (const link of issuelinks) {
    const linkTypeName = (link.type?.name || "").toLowerCase();

    if (link.outwardIssue) {
      // "this issue blocks outwardIssue"
      const relatedKey = link.outwardIssue.key;
      if (linkTypeName.includes("block")) {
        links.push({ relatedIssueKey: relatedKey, relationshipType: "blocks" });
      } else {
        links.push({ relatedIssueKey: relatedKey, relationshipType: "related_to" });
      }
    }

    if (link.inwardIssue) {
      // "this issue is blocked by inwardIssue" → inwardIssue blocks this
      const relatedKey = link.inwardIssue.key;
      if (linkTypeName.includes("block")) {
        links.push({ relatedIssueKey: relatedKey, relationshipType: "depends_on" });
      } else {
        links.push({ relatedIssueKey: relatedKey, relationshipType: "related_to" });
      }
    }
  }

  return links;
}

/**
 * Fetch issue relations from Linear GraphQL API.
 * Linear exposes relations via the `relations` field on issues.
 */
async function fetchLinearIssueRelations(
  issueId: string,
  org: Organization,
): Promise<IssueLink[]> {
  const providerSettings = org.providerSettings as Record<string, unknown>;
  const linearApiKey =
    (providerSettings?.linearApiKey as string) ||
    process.env.LINEAR_API_KEY;

  if (!linearApiKey) {
    logger.debug("Linear API key not configured — skipping relationship sync", {
      issueId,
      orgId: org.id,
    });
    return [];
  }

  const query = `
    query IssueRelations($issueId: String!) {
      issue(id: $issueId) {
        relations {
          nodes {
            type
            relatedIssue {
              identifier
            }
          }
        }
      }
    }
  `;

  const response = await axios.post(
    "https://api.linear.app/graphql",
    { query, variables: { issueId } },
    {
      headers: {
        Authorization: linearApiKey,
        "Content-Type": "application/json",
      },
      timeout: 10_000,
    },
  );

  const relations = response.data?.data?.issue?.relations?.nodes || [];
  const links: IssueLink[] = [];

  for (const rel of relations) {
    const relatedKey = rel.relatedIssue?.identifier;
    if (!relatedKey) continue;

    // Linear relation types: "blocks", "blocked", "related", "duplicate"
    const relType = (rel.type || "").toLowerCase();
    if (relType === "blocks") {
      links.push({ relatedIssueKey: relatedKey, relationshipType: "blocks" });
    } else if (relType === "blocked") {
      links.push({ relatedIssueKey: relatedKey, relationshipType: "depends_on" });
    } else if (relType === "duplicate") {
      links.push({ relatedIssueKey: relatedKey, relationshipType: "duplicates" });
    } else {
      links.push({ relatedIssueKey: relatedKey, relationshipType: "related_to" });
    }
  }

  return links;
}

/**
 * Sync issue relationships from the source tracker into TaskRelationship records.
 * Call this after creating a WorkerTask from a Jira or Linear webhook.
 *
 * This is fire-and-forget — errors are logged but don't propagate.
 *
 * @param task - The newly created WorkerTask
 * @param org - The organization (with credentials)
 * @param source - The issue tracker source ("jira" or "linear")
 * @param issueId - The issue ID (Jira issue key like "OCS-123", or Linear issue UUID)
 */
export async function syncIssueRelationships(
  task: WorkerTask,
  org: Organization,
  source: "jira" | "linear",
  issueId: string,
): Promise<void> {
  try {
    let links: IssueLink[];

    if (source === "jira") {
      links = await fetchJiraIssueLinks(issueId, org);
    } else {
      links = await fetchLinearIssueRelations(issueId, org);
    }

    if (links.length === 0) {
      return;
    }

    const taskRepo = AppDataSource.getRepository(WorkerTask);
    const relRepo = AppDataSource.getRepository(TaskRelationship);
    const relSource: RelationshipSource = source;

    let created = 0;

    for (const link of links) {
      // Find the WorkerTask for the related issue
      const relatedTask = await taskRepo.findOne({
        where: { jiraIssueKey: link.relatedIssueKey, orgId: org.id },
      });

      if (!relatedTask) {
        // Related issue doesn't have a WorkerTask yet — skip
        logger.debug("Related issue has no WorkerTask — skipping relationship", {
          taskId: task.id,
          relatedIssueKey: link.relatedIssueKey,
          relationshipType: link.relationshipType,
        });
        continue;
      }

      // Determine source/target based on relationship direction
      let sourceTaskId: string;
      let targetTaskId: string;

      if (link.relationshipType === "depends_on") {
        // "task depends_on relatedTask" → relatedTask is the source (blocker)
        sourceTaskId = relatedTask.id;
        targetTaskId = task.id;
      } else if (link.relationshipType === "blocks") {
        // "task blocks relatedTask" → task is the source (blocker)
        sourceTaskId = task.id;
        targetTaskId = relatedTask.id;
      } else {
        // Symmetric relationships — use consistent ordering
        sourceTaskId = task.id;
        targetTaskId = relatedTask.id;
      }

      // Upsert: skip if relationship already exists
      const existing = await relRepo.findOne({
        where: {
          sourceTaskId,
          targetTaskId,
          relationshipType: link.relationshipType,
        },
      });

      if (existing) continue;

      const relationship = relRepo.create({
        orgId: org.id,
        sourceTaskId,
        targetTaskId,
        relationshipType: link.relationshipType,
        source: relSource,
        strength: 1.0,
        confidence: 1.0,
        metadata: {
          jiraLinkType: link.relationshipType,
          reason: `Auto-synced from ${source} issue links`,
        },
      });

      await relRepo.save(relationship);
      created++;
    }

    if (created > 0) {
      logger.info("Synced issue relationships to TaskRelationship", {
        taskId: task.id,
        issueKey: issueId,
        source,
        linksFound: links.length,
        relationshipsCreated: created,
      });
    }
  } catch (error) {
    // Fire-and-forget — log but don't propagate
    logger.warn("Failed to sync issue relationships (non-fatal)", {
      taskId: task.id,
      issueId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
