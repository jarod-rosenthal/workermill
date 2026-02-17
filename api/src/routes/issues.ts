/**
 * Issues API Routes
 *
 * Provides Jira issue search and project listing endpoints.
 * Uses org credentials from Secrets Manager for Jira API authentication.
 */

import { Router, type Request, type Response } from "express";
import { query, validationResult } from "express-validator";
import { authenticateRequest } from "../middleware/auth.js";
import { getOrgCredentials } from "../services/org-credentials.js";
import { logger } from "../utils/logger.js";

const router = Router();

// All issue routes require authentication
router.use(authenticateRequest);

/**
 * GET /api/issues
 *
 * Search Jira issues with optional filters.
 * Query params:
 *   - q: search text (optional)
 *   - project: project key filter (optional)
 *   - status: status filter (optional)
 *   - assignee: "currentUser" or specific account ID (optional)
 *   - maxResults: number of results, default 20, max 50 (optional)
 */
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

    try {
      const creds = await getOrgCredentials(orgId);

      if (!creds.jiraBaseUrl || !creds.jiraEmail || !creds.jiraApiToken) {
        res.status(400).json({
          error: "Jira credentials not configured. Please configure Jira in Settings > Integrations.",
        });
        return;
      }

      const { q, project, status, assignee } = req.query;
      const maxResults = Math.min(Number(req.query.maxResults) || 20, 50);

      // Build JQL query
      const jqlParts: string[] = [];

      if (q && typeof q === "string") {
        jqlParts.push(`text ~ "${q.replace(/"/g, '\\"')}"`);
      }

      if (project && typeof project === "string") {
        jqlParts.push(`project = "${project.replace(/"/g, '\\"')}"`);
      }

      if (status && typeof status === "string") {
        jqlParts.push(`status = "${status.replace(/"/g, '\\"')}"`);
      }

      if (assignee && typeof assignee === "string") {
        if (assignee === "currentUser") {
          jqlParts.push("assignee = currentUser()");
        } else {
          jqlParts.push(`assignee = "${assignee.replace(/"/g, '\\"')}"`);
        }
      }

      const jql =
        jqlParts.length > 0
          ? `${jqlParts.join(" AND ")} ORDER BY updated DESC`
          : "ORDER BY updated DESC";

      const fields = "summary,status,assignee,issuetype,priority,labels,project";
      const url = `${creds.jiraBaseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${fields}`;

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
          res.status(response.status === 401 ? 401 : 502).json({
            error:
              response.status === 401
                ? "Jira authentication failed. Check your credentials in Settings."
                : "Failed to search Jira issues",
          });
          return;
        }

        interface JiraIssue {
          key: string;
          fields: {
            summary: string;
            status?: { name: string };
            assignee?: { displayName: string; accountId: string };
            issuetype?: { name: string };
            priority?: { name: string };
            labels?: string[];
            project?: { key: string; name: string };
          };
        }

        const data = (await response.json()) as { issues?: JiraIssue[] };

        const issues = (data.issues || []).map((issue) => ({
            key: issue.key,
            summary: issue.fields.summary,
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
          }),
        );

        res.json({ issues });
      } catch (fetchError: unknown) {
        clearTimeout(timeout);
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          logger.warn("Jira search request timed out", { orgId });
          res.status(504).json({ error: "Jira request timed out" });
          return;
        }
        throw fetchError;
      }
    } catch (error) {
      logger.error("Error searching Jira issues", { error, orgId });
      res.status(500).json({ error: "Failed to search issues" });
    }
  },
);

/**
 * GET /api/issues/projects
 *
 * List available Jira projects for the organization.
 */
router.get("/projects", async (req: Request, res: Response) => {
  const orgId = req.organization?.id;
  if (!orgId) {
    res.status(401).json({ error: "Organization not found" });
    return;
  }

  try {
    const creds = await getOrgCredentials(orgId);

    if (!creds.jiraBaseUrl || !creds.jiraEmail || !creds.jiraApiToken) {
      res.status(400).json({
        error: "Jira credentials not configured. Please configure Jira in Settings > Integrations.",
      });
      return;
    }

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
        res.status(response.status === 401 ? 401 : 502).json({
          error:
            response.status === 401
              ? "Jira authentication failed. Check your credentials in Settings."
              : "Failed to fetch Jira projects",
        });
        return;
      }

      const data = (await response.json()) as {
        values?: Array<{ key: string; name: string }>;
      };

      const projects = (data.values || []).map((project) => ({
        key: project.key,
        name: project.name,
      }));

      res.json({ projects });
    } catch (fetchError: unknown) {
      clearTimeout(timeout);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        logger.warn("Jira projects request timed out", { orgId });
        res.status(504).json({ error: "Jira request timed out" });
        return;
      }
      throw fetchError;
    }
  } catch (error) {
    logger.error("Error fetching Jira projects", { error, orgId });
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

export default router;
