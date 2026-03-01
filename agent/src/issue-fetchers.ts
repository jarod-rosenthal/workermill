/**
 * Issue Fetchers — Standalone Mode
 *
 * Pure HTTP fetchers for Jira, Linear, and GitHub Issues.
 * Ported from api/src/routes/issues.ts (Jira + Linear) with a new GitHub Issues fetcher.
 * No database dependencies — suitable for the standalone agent binary.
 */

// ── Shared types ──────────────────────────────────────────────────────

export interface IssueInfo {
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

export interface IssueFilters {
  q?: string;
  project?: string;
  status?: string;
  maxResults: number;
}

// ── Jira ──────────────────────────────────────────────────────────────

interface JiraCreds {
  baseUrl: string;
  email: string;
  apiToken: string;
}

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

export async function searchJiraIssues(
  creds: JiraCreds,
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

  const jql =
    jqlParts.length > 0
      ? `${jqlParts.join(" AND ")} ORDER BY updated DESC`
      : "ORDER BY updated DESC";

  const fields =
    "summary,description,status,assignee,issuetype,priority,labels,project";
  const url = `${creds.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${filters.maxResults}&fields=${fields}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    const msg =
      response.status === 401
        ? "Jira authentication failed. Check your credentials in Settings."
        : `Failed to search Jira issues (HTTP ${response.status}): ${errorText.substring(0, 200)}`;
    throw new Error(msg);
  }

  const data = (await response.json()) as { issues?: JiraIssue[] };

  return (data.issues || []).map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    description:
      typeof issue.fields.description === "string"
        ? issue.fields.description
        : null,
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
      ? {
          key: issue.fields.project.key,
          name: issue.fields.project.name,
        }
      : null,
  }));
}

export async function listJiraProjects(
  creds: JiraCreds,
): Promise<{ key: string; name: string }[]> {
  const url = `${creds.baseUrl}/rest/api/3/project/search?maxResults=50`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const msg =
      response.status === 401
        ? "Jira authentication failed. Check your credentials in Settings."
        : "Failed to fetch Jira projects";
    throw new Error(msg);
  }

  const data = (await response.json()) as {
    values?: Array<{ key: string; name: string }>;
  };

  return (data.values || []).map((project) => ({
    key: project.key,
    name: project.name,
  }));
}

export async function testJiraConnection(
  creds: JiraCreds,
): Promise<{ displayName: string }> {
  const url = `${creds.baseUrl}/rest/api/3/myself`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64")}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const msg =
      response.status === 401
        ? "Jira authentication failed. Check your credentials."
        : `Jira connection failed (HTTP ${response.status})`;
    throw new Error(msg);
  }

  const data = (await response.json()) as { displayName?: string };
  return { displayName: data.displayName || "unknown" };
}

// ── Linear ────────────────────────────────────────────────────────────

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

export async function searchLinearIssues(
  apiKey: string,
  filters: IssueFilters,
): Promise<IssueInfo[]> {
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
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: graphqlQuery,
      variables: { filter: filterParts, first: filters.maxResults },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const msg =
      response.status === 401
        ? "Linear authentication failed. Check your API key in Settings."
        : "Failed to search Linear issues";
    throw new Error(msg);
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
      ? {
          displayName: issue.assignee.displayName,
          accountId: issue.assignee.id,
        }
      : null,
    issueType: "Issue",
    priority: LINEAR_PRIORITY_NAMES[issue.priority] ?? null,
    labels: issue.labels?.nodes?.map((l) => l.name) || [],
    project: issue.team
      ? { key: issue.team.key, name: issue.team.name }
      : null,
  }));
}

export async function listLinearTeams(
  apiKey: string,
): Promise<{ key: string; name: string }[]> {
  const query = `
    query {
      teams {
        nodes { id name key }
      }
    }
  `;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Linear teams");
  }

  const data = (await response.json()) as {
    data?: {
      teams?: { nodes?: Array<{ id: string; name: string; key: string }> };
    };
  };

  return (data.data?.teams?.nodes || []).map((t) => ({
    key: t.key,
    name: t.name,
  }));
}

// ── GitHub Issues ─────────────────────────────────────────────────────

interface GitHubIssueResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  user?: { login: string; id: number };
  assignee?: { login: string; id: number } | null;
  labels: Array<{ name: string }>;
  milestone?: { title: string } | null;
}

export async function searchGitHubIssues(
  token: string,
  repo: string,
  filters: IssueFilters,
): Promise<IssueInfo[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(
      "Invalid repo format — expected owner/repo (e.g. acme/my-app)",
    );
  }

  const params = new URLSearchParams();
  params.set("per_page", String(filters.maxResults));
  params.set("state", filters.status === "closed" ? "closed" : "open");
  if (filters.q) params.set("labels", filters.q); // use q as label filter

  const url = `https://api.github.com/repos/${owner}/${name}/issues?${params}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const msg =
      response.status === 401
        ? "GitHub authentication failed. Check your token in Settings."
        : `Failed to fetch GitHub issues (HTTP ${response.status})`;
    throw new Error(msg);
  }

  const issues = (await response.json()) as GitHubIssueResponse[];

  // GitHub's issues endpoint also returns pull requests — filter them out
  return issues
    .filter((i) => !(i as unknown as { pull_request?: unknown }).pull_request)
    .map((issue) => ({
      key: `***REMOVED***${issue.number}`,
      summary: issue.title,
      description: issue.body,
      status: issue.state,
      assignee: issue.assignee
        ? {
            displayName: issue.assignee.login,
            accountId: String(issue.assignee.id),
          }
        : null,
      issueType: "Issue",
      priority: null,
      labels: issue.labels.map((l) => l.name),
      project: { key: name, name: repo },
    }));
}

export async function listGitHubRepos(
  token: string,
): Promise<{ key: string; name: string }[]> {
  const url =
    "https://api.github.com/user/repos?per_page=30&sort=updated&affiliation=owner,collaborator,organization_member";

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch GitHub repos");
  }

  const repos = (await response.json()) as Array<{
    full_name: string;
    name: string;
  }>;

  return repos.map((r) => ({ key: r.full_name, name: r.full_name }));
}
