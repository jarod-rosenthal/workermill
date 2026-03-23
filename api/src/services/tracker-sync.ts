/**
 * External Tracker Sync
 *
 * Creates issues on external trackers (Jira, GitHub Issues, Linear)
 * mirroring the cards on a KbBoard. Used after PRD decomposition to
 * push implementation cards into the team's existing issue tracker.
 *
 * Each synced issue gets the "workermill" label so the webhook dedup
 * logic (prdSourceId) can prevent duplicate task creation when the
 * tracker fires webhooks back.
 */

import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbBoard } from "../models/KbBoard.js";
import { Organization } from "../models/Organization.js";
import { getOrgCredentials } from "./org-credentials.js";
import { logger } from "../utils/logger.js";

// Timeout for external API calls (30 seconds)
const TRACKER_API_TIMEOUT_MS = 30_000;

export interface SyncResult {
  synced: number;
  failed: number;
  tracker: string;
  issueKeys: string[];
}

/**
 * Sync all cards on a board to the org's configured external issue tracker.
 * Returns null if no external tracker is configured (internal-only).
 */
export async function syncBoardToTracker(
  boardId: string,
  orgId: string,
): Promise<SyncResult | null> {
  const org = await AppDataSource.getRepository(Organization).findOneBy({ id: orgId });
  if (!org) throw new Error("Organization not found");

  const tracker = org.issueTrackerProvider;
  if (!tracker || tracker === "internal") return null;

  const board = await AppDataSource.getRepository(KbBoard).findOneBy({ id: boardId });
  if (!board) throw new Error("Board not found");

  const cards = await AppDataSource.getRepository(KbCard).find({
    where: { boardId },
    order: { position: "ASC" },
  });

  if (cards.length === 0) {
    logger.info("No cards to sync", { boardId, tracker });
    return { synced: 0, failed: 0, tracker, issueKeys: [] };
  }

  const result: SyncResult = { synced: 0, failed: 0, tracker, issueKeys: [] };

  if (tracker === "jira") {
    await syncToJira(org, board, cards, result);
  } else if (tracker === "github-issues") {
    await syncToGitHub(org, board, cards, result);
  } else if (tracker === "linear") {
    await syncToLinear(org, board, cards, result);
  } else {
    logger.warn("Unknown tracker provider — skipping sync", { tracker, boardId });
    return null;
  }

  logger.info("Tracker sync completed", {
    boardId,
    boardName: board.name,
    tracker,
    synced: result.synced,
    failed: result.failed,
  });

  return result;
}

// =============================================================================
// Jira
// =============================================================================

/**
 * Convert plain text / markdown to Atlassian Document Format (ADF).
 * Splits on double-newlines for paragraphs, preserves single newlines as hardBreaks.
 */
function textToAdf(text: string): object {
  const paragraphs = text.split("\n\n").filter((p) => p.trim().length > 0);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, idx, arr) => {
        const textNode = { type: "text" as const, text: line };
        return idx < arr.length - 1
          ? [textNode, { type: "hardBreak" as const }]
          : [textNode];
      }),
    })),
  };
}

async function syncToJira(
  org: Organization,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const credentials = await getOrgCredentials(org.id);

  if (!credentials.jiraBaseUrl || !credentials.jiraEmail || !credentials.jiraApiToken) {
    logger.warn("Jira credentials not configured — cannot sync", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  const auth = Buffer.from(
    `${credentials.jiraEmail}:${credentials.jiraApiToken}`,
  ).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // Discover the default project by fetching the first accessible project
  const projectKey = await getJiraDefaultProjectKey(credentials.jiraBaseUrl, headers);
  if (!projectKey) {
    logger.warn("Could not determine Jira project — cannot sync", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  // Discover the Story issue type for this project
  const storyTypeId = await getJiraStoryTypeId(
    credentials.jiraBaseUrl,
    headers,
    projectKey,
  );

  for (const card of cards) {
    try {
      const description = card.description || card.title;
      const issueBody: Record<string, unknown> = {
        fields: {
          project: { key: projectKey },
          summary: card.title,
          description: textToAdf(description),
          labels: ["workermill"],
          ...(storyTypeId ? { issuetype: { id: storyTypeId } } : {}),
        },
      };

      const response = await fetch(
        `${credentials.jiraBaseUrl}/rest/api/3/issue`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(issueBody),
          signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn("Failed to create Jira issue", {
          cardId: card.id,
          status: response.status,
          error: errorText,
        });
        result.failed++;
        continue;
      }

      const created = (await response.json()) as { key: string; id: string };
      result.synced++;
      result.issueKeys.push(created.key);

      // Save the external issue key on the card so workers can post comments
      await AppDataSource.getRepository(KbCard).update(card.id, { ticketKey: created.key });

      logger.info("Created Jira issue from card", {
        cardId: card.id,
        issueKey: created.key,
        boardId: board.id,
      });
    } catch (err) {
      logger.warn("Error creating Jira issue for card", {
        cardId: card.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.failed++;
    }
  }
}

/**
 * Get the first accessible Jira project key.
 * Used as the default project when no explicit project is configured.
 */
async function getJiraDefaultProjectKey(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string | null> {
  try {
    const response = await fetch(
      `${baseUrl}/rest/api/3/project/search?maxResults=1&orderBy=key`,
      {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
      },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      values?: Array<{ key: string }>;
    };

    return data.values?.[0]?.key || null;
  } catch (err) {
    console.error("[tracker-sync] Jira project key fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Get the Story issue type ID for a Jira project.
 * Falls back to null (let Jira use its default).
 */
async function getJiraStoryTypeId(
  baseUrl: string,
  headers: Record<string, string>,
  projectKey: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/rest/api/3/project/${projectKey}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
    };

    const storyType = data.issueTypes?.find(
      (t) => t.name === "Story" && !t.subtask,
    );
    return storyType?.id || null;
  } catch (err) {
    console.error("[tracker-sync] Jira story type fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// =============================================================================
// GitHub Issues
// =============================================================================

async function syncToGitHub(
  org: Organization,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const credentials = await getOrgCredentials(org.id);
  const token = credentials.scmProvider === "github" ? credentials.githubToken : null;

  if (!token) {
    logger.warn("GitHub token not configured — cannot sync issues", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  // Use the board's repo, org's default repo, or fail
  const repo = board.githubRepo || org.getDefaultRepo();
  if (!repo) {
    logger.warn("No GitHub repo configured — cannot sync issues", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "WorkerMill-API",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Ensure the "workermill" label exists on the repo
  await ensureGitHubLabel(repo, headers);

  for (const card of cards) {
    try {
      const body = card.description || "";
      const issueBody = {
        title: card.title,
        body,
        labels: ["workermill"],
      };

      const response = await fetch(
        `https://api.github.com/repos/${repo}/issues`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(issueBody),
          signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn("Failed to create GitHub issue", {
          cardId: card.id,
          repo,
          status: response.status,
          error: errorText,
        });
        result.failed++;
        continue;
      }

      const created = (await response.json()) as { number: number };
      const issueKey = `GH-${created.number}`;
      result.synced++;
      result.issueKeys.push(issueKey);

      // Save the external issue key on the card so workers can post comments
      await AppDataSource.getRepository(KbCard).update(card.id, { ticketKey: issueKey });

      logger.info("Created GitHub issue from card", {
        cardId: card.id,
        issueKey,
        issueNumber: created.number,
        repo,
        boardId: board.id,
      });
    } catch (err) {
      logger.warn("Error creating GitHub issue for card", {
        cardId: card.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.failed++;
    }
  }
}

/**
 * Ensure the "workermill" label exists on the GitHub repo.
 * No-op if it already exists (409 Conflict is fine).
 */
async function ensureGitHubLabel(
  repo: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    await fetch(`https://api.github.com/repos/${repo}/labels`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "workermill",
        color: "7C3AED",
        description: "Managed by WorkerMill",
      }),
      signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
    });
    // 201 = created, 422 = already exists — both fine
  } catch {
    // Best effort
  }
}

// =============================================================================
// Linear
// =============================================================================

async function syncToLinear(
  org: Organization,
  board: KbBoard,
  cards: KbCard[],
  result: SyncResult,
): Promise<void> {
  const credentials = await getOrgCredentials(org.id);
  const apiKey = credentials.linearApiKey;

  if (!apiKey) {
    logger.warn("Linear API key not configured — cannot sync issues", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  // Discover the first team
  const teamId = await getLinearDefaultTeamId(apiKey);
  if (!teamId) {
    logger.warn("Could not determine Linear team — cannot sync", { orgId: org.id });
    result.failed = cards.length;
    return;
  }

  // Find or create the "workermill" label
  const workermillLabelId = await ensureLinearLabel(apiKey, teamId);

  for (const card of cards) {
    try {
      const mutation = `
        mutation CreateIssue($teamId: String!, $title: String!, $description: String, $labelIds: [String!]) {
          issueCreate(input: { teamId: $teamId, title: $title, description: $description, labelIds: $labelIds }) {
            success
            issue {
              id
              identifier
              title
              url
            }
          }
        }
      `;

      const variables: Record<string, unknown> = {
        teamId,
        title: card.title,
        description: card.description || undefined,
      };

      if (workermillLabelId) {
        variables.labelIds = [workermillLabelId];
      }

      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: mutation, variables }),
        signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn("Failed to create Linear issue — HTTP error", {
          cardId: card.id,
          status: response.status,
        });
        result.failed++;
        continue;
      }

      const data = (await response.json()) as {
        data?: {
          issueCreate?: {
            success: boolean;
            issue?: { identifier: string };
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (data.errors?.length) {
        logger.warn("Linear GraphQL errors creating issue", {
          cardId: card.id,
          errors: data.errors,
        });
        result.failed++;
        continue;
      }

      const issueResult = data.data?.issueCreate;
      if (!issueResult?.success || !issueResult.issue) {
        logger.warn("Linear issue creation unsuccessful", { cardId: card.id });
        result.failed++;
        continue;
      }

      result.synced++;
      result.issueKeys.push(issueResult.issue.identifier);

      // Save the external issue key on the card so workers can post comments
      await AppDataSource.getRepository(KbCard).update(card.id, { ticketKey: issueResult.issue.identifier });

      logger.info("Created Linear issue from card", {
        cardId: card.id,
        identifier: issueResult.issue.identifier,
        boardId: board.id,
      });
    } catch (err) {
      logger.warn("Error creating Linear issue for card", {
        cardId: card.id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.failed++;
    }
  }
}

/**
 * Get the first Linear team ID.
 */
async function getLinearDefaultTeamId(apiKey: string): Promise<string | null> {
  try {
    const query = `query { teams { nodes { id } } }`;
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      data?: { teams?: { nodes?: Array<{ id: string }> } };
    };

    return data.data?.teams?.nodes?.[0]?.id || null;
  } catch (err) {
    console.error("[tracker-sync] Linear team ID fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Ensure the "workermill" label exists on the Linear team.
 * Returns the label ID or null.
 */
async function ensureLinearLabel(
  apiKey: string,
  teamId: string,
): Promise<string | null> {
  try {
    // Check if label already exists
    const query = `
      query GetTeamLabels($teamId: String!) {
        team(id: $teamId) {
          labels { nodes { id name } }
        }
      }
    `;

    const labelsResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { teamId } }),
      signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
    });

    if (labelsResponse.ok) {
      const labelsData = (await labelsResponse.json()) as {
        data?: {
          team?: { labels?: { nodes?: Array<{ id: string; name: string }> } };
        };
      };

      const existing = labelsData.data?.team?.labels?.nodes?.find(
        (l) => l.name.toLowerCase() === "workermill",
      );

      if (existing) return existing.id;
    }

    // Create the label
    const createMutation = `
      mutation CreateLabel($teamId: String!, $name: String!, $color: String) {
        issueLabelCreate(input: { teamId: $teamId, name: $name, color: $color }) {
          success
          issueLabel { id }
        }
      }
    `;

    const createResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: createMutation,
        variables: { teamId, name: "workermill", color: "#7C3AED" },
      }),
      signal: AbortSignal.timeout(TRACKER_API_TIMEOUT_MS),
    });

    if (createResponse.ok) {
      const createData = (await createResponse.json()) as {
        data?: {
          issueLabelCreate?: {
            success: boolean;
            issueLabel?: { id: string };
          };
        };
      };

      return createData.data?.issueLabelCreate?.issueLabel?.id || null;
    }

    return null;
  } catch (err) {
    console.error("[tracker-sync] Linear label ensure failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
