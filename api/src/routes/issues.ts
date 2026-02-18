/**
 * Issues API Routes
 *
 * Multi-source issue search dispatched by org.issueTrackerProvider:
 *   "internal" → KbBoard/KbCard tables
 *   "jira"     → Jira REST API
 *   "linear"   → Linear GraphQL API
 */

import { Router, type Request, type Response } from "express";
import { query, validationResult } from "express-validator";
import { authenticateRequest } from "../middleware/auth.js";
import { getOrgCredentials } from "../services/org-credentials.js";
import { AppDataSource } from "../db/connection.js";
import { KbCard } from "../models/KbCard.js";
import { KbBoard } from "../models/KbBoard.js";
import { getLinearTeams } from "../utils/linear.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All issue routes require authentication
router.use(authenticateRequest);

// ─── Shared types ────────────────────────────────────────────────────────

interface IssueInfo {
  key: string;
  summary: string;
  description: string | null;
  status: string | null;
  assignee: { displayName: string; accountId: string } | null;
  issueType: string | null;
  priority: string | null;
  labels: string[];
  project: { key: string; name: string } | null;
}

interface IssueFilters {
  q?: string;
  project?: string;
  status?: string;
  assignee?: string;
  maxResults: number;
}

// ─── Internal boards fetcher ─────────────────────────────────────────────

const DONE_COLUMN_NAMES = ["done", "closed", "archived", "completed"];

async function searchBoardCards(
  orgId: string,
  filters: IssueFilters,
): Promise<IssueInfo[]> {
  const cardRepo = AppDataSource.getRepository(KbCard);

  const qb = cardRepo
    .createQueryBuilder("card")
    .innerJoinAndSelect("card.column", "col")
    .innerJoinAndSelect("card.board", "board")
    .leftJoinAndSelect("card.assignee", "assignee")
    .leftJoinAndSelect("card.cardLabels", "cl")
    .leftJoinAndSelect("cl.label", "label")
    .where("board.orgId = :orgId", { orgId })
    .andWhere("LOWER(col.name) NOT IN (:...doneNames)", {
      doneNames: DONE_COLUMN_NAMES,
    })
    .orderBy("card.updatedAt", "DESC")
    .take(filters.maxResults);

  if (filters.q) {
    qb.andWhere("card.title ILIKE :q", { q: `%${filters.q}%` });
  }

  if (filters.project) {
    qb.andWhere("board.prefix = :prefix", { prefix: filters.project });
  }

  if (filters.status) {
    qb.andWhere("LOWER(col.name) = LOWER(:status)", {
      status: filters.status,
    });
  }

  const cards = await qb.getMany();

  return cards.map((card) => ({
    key: card.cardNumber ? `${card.board.prefix}-${card.cardNumber}` : `${card.board.prefix}-${card.id.slice(0, 8)}`,
    summary: card.title,
    description: card.description,
    status: card.column.name,
    assignee: card.assignee
      ? { displayName: card.assignee.fullName || card.assignee.email, accountId: card.assignee.id }
      : null,
    issueType: "Card",
    priority: card.priority,
    labels: (card.cardLabels || []).map((cl) => cl.label?.name).filter(Boolean) as string[],
    project: { key: card.board.prefix, name: card.board.name },
  }));
}

// ─── Jira fetcher ────────────────────────────────────────────────────────

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: unknown;
    status?: { name: string };
    assignee?: { displayName: string; accountId: string };
    issuetype?: { name: string };
    priority?: { name: string };
    labels?: string[];
    project?: { key: string; name: string };
  };
}

async function searchJiraIssues(
  orgId: string,
  creds: { jiraBaseUrl: string; jiraEmail: string; jiraApiToken: string },
  filters: IssueFilters,
): Promise<IssueInfo[]> {
  const jqlParts: string[] = [];

  if (filters.q) {
    jqlParts.push(`text ~ "${filters.q.replace(/"/g, '\\"')}"`);
  }
  if (filters.project) {
    jqlParts.push(`project = "${filters.project.replace(/"/g, '\\"')}"`);
  }
  if (filters.status) {
    jqlParts.push(`status = "${filters.status.replace(/"/g, '\\"')}"`);
  }
  if (filters.assignee) {
    if (filters.assignee === "currentUser") {
      jqlParts.push("assignee = currentUser()");
    } else {
      jqlParts.push(`assignee = "${filters.assignee.replace(/"/g, '\\"')}"`);
    }
  }

  const jql =
    jqlParts.length > 0
      ? `${jqlParts.join(" AND ")} ORDER BY updated DESC`
      : "ORDER BY updated DESC";

  const fields = "summary,description,status,assignee,issuetype,priority,labels,project";
  const url = `${creds.jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${filters.maxResults}&fields=${fields}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.jiraEmail}:${creds.jiraApiToken}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.warn("Jira search API error", {
        status: response.status,
        orgId,
        errorText: errorText.substring(0, 500),
      });
      const status = response.status === 401 ? 401 : 502;
      const error =
        response.status === 401
          ? "Jira authentication failed. Check your credentials in Settings."
          : "Failed to search Jira issues";
      throw Object.assign(new Error(error), { statusCode: status });
    }

    const data = (await response.json()) as { issues?: JiraIssue[] };

    return (data.issues || []).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      description: typeof issue.fields.description === "string" ? issue.fields.description : null,
      status: issue.fields.status?.name || null,
      assignee: issue.fields.assignee
        ? {
            displayName: issue.fields.assignee.displayName,
            accountId: issue.fields.assignee.accountId,
          }
        : null,
      issueType: issue.fields.issuetype?.name || null,
      priority: issue.fields.priority?.name || null,
      labels: issue.fields.labels || [],
      project: issue.fields.project
        ? { key: issue.fields.project.key, name: issue.fields.project.name }
        : null,
    }));
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw Object.assign(new Error("Jira request timed out"), { statusCode: 504 });
    }
    throw err;
  }
}

async function listJiraProjects(
  creds: { jiraBaseUrl: string; jiraEmail: string; jiraApiToken: string },
  orgId: string,
): Promise<{ key: string; name: string }[]> {
  const url = `${creds.jiraBaseUrl}/rest/api/3/project/search?maxResults=50`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.jiraEmail}:${creds.jiraApiToken}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.warn("Jira project search API error", {
        status: response.status,
        orgId,
        errorText: errorText.substring(0, 500),
      });
      const status = response.status === 401 ? 401 : 502;
      const error =
        response.status === 401
          ? "Jira authentication failed. Check your credentials in Settings."
          : "Failed to fetch Jira projects";
      throw Object.assign(new Error(error), { statusCode: status });
    }

    const data = (await response.json()) as {
      values?: Array<{ key: string; name: string }>;
    };

    return (data.values || []).map((project) => ({
      key: project.key,
      name: project.name,
    }));
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw Object.assign(new Error("Jira request timed out"), { statusCode: 504 });
    }
    throw err;
  }
}

// ─── Linear fetcher ──────────────────────────────────────────────────────

const LINEAR_PRIORITY_NAMES: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

interface LinearIssueNode {
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  assignee?: { displayName: string; id: string } | null;
  labels: { nodes: Array<{ name: string }> };
  priority: number;
  team?: { key: string; name: string } | null;
}

async function searchLinearIssues(
  linearApiKey: string,
  filters: IssueFilters,
): Promise<IssueInfo[]> {
  // Build filter object
  const filterParts: Record<string, unknown> = {
    state: { type: { nin: ["completed", "canceled"] } },
  };

  if (filters.q) {
    filterParts.title = { containsIgnoreCase: filters.q };
  }
  if (filters.project) {
    filterParts.team = { key: { eq: filters.project } };
  }
  if (filters.status) {
    filterParts.state = { name: { eqIgnoreCase: filters.status } };
  }

  const graphqlQuery = `
    query SearchIssues($filter: IssueFilter, $first: Int) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes {
          identifier
          title
          description
          state { name }
          assignee { displayName id }
          labels { nodes { name } }
          priority
          team { key name }
        }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: linearApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: {
        filter: filterParts,
        first: filters.maxResults,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    logger.warn("Linear search API error", {
      status: response.status,
      errorText: errorText.substring(0, 500),
    });
    const status = response.status === 401 ? 401 : 502;
    const error =
      response.status === 401
        ? "Linear authentication failed. Check your API key in Settings."
        : "Failed to search Linear issues";
    throw Object.assign(new Error(error), { statusCode: status });
  }

  const data = (await response.json()) as {
    data?: { issues?: { nodes?: LinearIssueNode[] } };
  };

  return (data.data?.issues?.nodes || []).map((issue) => ({
    key: issue.identifier,
    summary: issue.title,
    description: issue.description || null,
    status: issue.state?.name || null,
    assignee: issue.assignee
      ? { displayName: issue.assignee.displayName, accountId: issue.assignee.id }
      : null,
    issueType: "Issue",
    priority: LINEAR_PRIORITY_NAMES[issue.priority] ?? null,
    labels: issue.labels?.nodes?.map((l) => l.name) || [],
    project: issue.team ? { key: issue.team.key, name: issue.team.name } : null,
  }));
}

// ─── Route: GET /api/issues ──────────────────────────────────────────────

router.get(
  "/",
  [
    query("q").optional().isString().trim(),
    query("project").optional().isString().trim(),
    query("status").optional().isString().trim(),
    query("assignee").optional().isString().trim(),
    query("maxResults")
      .optional()
      .isInt({ min: 1, max: 50 })
      .toInt()
      .withMessage("maxResults must be between 1 and 50"),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    const orgId = req.organization?.id;
    if (!orgId) {
      res.status(401).json({ error: "Organization not found" });
      return;
    }

    const filters: IssueFilters = {
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      project: typeof req.query.project === "string" ? req.query.project : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      assignee: typeof req.query.assignee === "string" ? req.query.assignee : undefined,
      maxResults: Math.min(Number(req.query.maxResults) || 20, 50),
    };

    const provider = req.organization?.issueTrackerProvider || "jira";

    try {
      let issues: IssueInfo[];

      switch (provider) {
        case "internal": {
          issues = await searchBoardCards(orgId, filters);
          break;
        }

        case "linear": {
          const creds = await getOrgCredentials(orgId);
          if (!creds.linearApiKey) {
            res.status(400).json({
              error: "Linear credentials not configured. Please configure Linear in Settings > Integrations.",
            });
            return;
          }
          issues = await searchLinearIssues(creds.linearApiKey, filters);
          break;
        }

        case "jira":
        default: {
          const creds = await getOrgCredentials(orgId);
          if (!creds.jiraBaseUrl || !creds.jiraEmail || !creds.jiraApiToken) {
            // Fallback: if Jira isn't configured, try internal boards
            issues = await searchBoardCards(orgId, filters);
            break;
          }
          issues = await searchJiraIssues(
            orgId,
            { jiraBaseUrl: creds.jiraBaseUrl, jiraEmail: creds.jiraEmail, jiraApiToken: creds.jiraApiToken },
            filters,
          );
          break;
        }
      }

      res.json({ issues });
    } catch (error: unknown) {
      const err = error as Error & { statusCode?: number };
      if (err.statusCode) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error("Error searching issues", { error, orgId, provider });
      res.status(500).json({ error: "Failed to search issues" });
    }
  },
);

// ─── Route: GET /api/issues/projects ─────────────────────────────────────

router.get("/projects", async (req: Request, res: Response) => {
  const orgId = req.organization?.id;
  if (!orgId) {
    res.status(401).json({ error: "Organization not found" });
    return;
  }

  const provider = req.organization?.issueTrackerProvider || "jira";

  try {
    let projects: { key: string; name: string }[];

    switch (provider) {
      case "internal": {
        const boardRepo = AppDataSource.getRepository(KbBoard);
        const boards = await boardRepo.find({
          where: { orgId },
          order: { name: "ASC" },
        });
        projects = boards.map((b) => ({ key: b.prefix, name: b.name }));
        break;
      }

      case "linear": {
        const teams = await getLinearTeams(orgId);
        if (!teams) {
          res.status(400).json({
            error: "Linear credentials not configured. Please configure Linear in Settings > Integrations.",
          });
          return;
        }
        projects = teams.map((t) => ({ key: t.key, name: t.name }));
        break;
      }

      case "jira":
      default: {
        const creds = await getOrgCredentials(orgId);
        if (!creds.jiraBaseUrl || !creds.jiraEmail || !creds.jiraApiToken) {
          // Fallback: if Jira isn't configured, try internal boards
          const boardRepo = AppDataSource.getRepository(KbBoard);
          const boards = await boardRepo.find({
            where: { orgId },
            order: { name: "ASC" },
          });
          projects = boards.map((b) => ({ key: b.prefix, name: b.name }));
          break;
        }
        projects = await listJiraProjects(
          { jiraBaseUrl: creds.jiraBaseUrl, jiraEmail: creds.jiraEmail, jiraApiToken: creds.jiraApiToken },
          orgId,
        );
        break;
      }
    }

    res.json({ projects });
  } catch (error: unknown) {
    const err = error as Error & { statusCode?: number };
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error("Error fetching projects", { error, orgId, provider });
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

export default router;
