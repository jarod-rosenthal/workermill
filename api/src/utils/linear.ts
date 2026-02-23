import { logger } from "./logger.js";
import { getOrgSecretFromDb } from "./org-secret-store.js";

// Default timeout for external API calls (30 seconds)
const LINEAR_API_TIMEOUT_MS = 30000;

// Per-org cache for Linear credentials (5 minutes)
const linearCredentialsCache = new Map<string, {
  apiKey: string;
  expiresAt: number;
}>();

/**
 * Get Linear credentials from Secrets Manager (with per-org caching)
 *
 * Secret path: workermill/${env}/orgs/${orgId}/integrations/linear-credentials
 */
async function getLinearCredentials(orgId: string): Promise<{
  apiKey: string;
} | null> {
  const now = Date.now();

  // Return cached credentials if still valid
  const cached = linearCredentialsCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const secretString = await getOrgSecretFromDb(orgId, "linear-credentials");

  if (!secretString) {
    logger.warn("Linear credentials not configured for organization", { orgId });
    return null;
  }

  try {
    const creds = JSON.parse(secretString);

    if (!creds.api_key) {
      logger.warn("Incomplete Linear credentials in Secrets Manager", { orgId });
      return null;
    }

    const credentials = {
      apiKey: creds.api_key,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes
    };

    linearCredentialsCache.set(orgId, credentials);
    return credentials;
  } catch (error) {
    logger.warn("Failed to fetch Linear credentials", { orgId, error });
    return null;
  }
}

/**
 * Fetch Linear issue details by identifier
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueIdentifier - Linear issue identifier (e.g., "PROJ-19")
 */
export async function fetchLinearIssue(orgId: string, issueIdentifier: string): Promise<{
  summary: string;
  description: string;
  labels: string[];
} | null> {
  const creds = await getLinearCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot fetch Linear issue - no credentials available", { orgId, issueIdentifier });
    return null;
  }

  try {
    // Linear GraphQL API
    const query = `
      query GetIssue($identifier: String!) {
        issue(id: $identifier) {
          title
          description
          labels {
            nodes {
              name
            }
          }
        }
      }
    `;

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { identifier: issueIdentifier },
      }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn("Failed to fetch Linear issue - HTTP error", {
        issueIdentifier,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as {
      data?: {
        issue?: {
          title?: string;
          description?: string;
          labels?: {
            nodes?: Array<{ name: string }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      logger.warn("Linear GraphQL errors", { issueIdentifier, errors: data.errors });
      return null;
    }

    const issue = data.data?.issue;
    if (!issue) {
      logger.warn("Linear issue not found", { issueIdentifier });
      return null;
    }

    const labels = issue.labels?.nodes?.map((l) => l.name) || [];

    logger.info("Fetched Linear issue details", {
      issueIdentifier,
      title: issue.title,
      descriptionLength: issue.description?.length || 0,
      labels,
    });

    return {
      summary: issue.title || issueIdentifier,
      description: issue.description || "",
      labels,
    };
  } catch (error) {
    logger.error("Failed to fetch Linear issue", { issueIdentifier, error });
    return null;
  }
}

/**
 * Post a comment to a Linear issue
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueIdentifier - Linear issue identifier (e.g., "PROJ-19")
 * @param body - Comment body (markdown supported)
 */
/**
 * Create a new Linear issue
 *
 * @param orgId - Organization ID for credential lookup
 * @param teamId - Linear team ID
 * @param title - Issue title
 * @param description - Issue description (markdown supported)
 * @param labelIds - Optional array of label IDs
 */
export async function createLinearIssue(
  orgId: string,
  teamId: string,
  title: string,
  description?: string,
  labelIds?: string[]
): Promise<{
  id: string;
  identifier: string;
  title: string;
  url: string;
} | null> {
  const creds = await getLinearCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot create Linear issue - no credentials available", { orgId });
    return null;
  }

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

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: mutation,
        variables: { teamId, title, description, labelIds },
      }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn("Failed to create Linear issue - HTTP error", {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as {
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: {
            id: string;
            identifier: string;
            title: string;
            url: string;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      logger.warn("Linear GraphQL errors", { errors: data.errors });
      return null;
    }

    const result = data.data?.issueCreate;
    if (!result?.success || !result.issue) {
      logger.warn("Linear issue creation failed");
      return null;
    }

    logger.info("Created Linear issue", {
      identifier: result.issue.identifier,
      title: result.issue.title,
    });

    return result.issue;
  } catch (error) {
    logger.error("Failed to create Linear issue", { error });
    return null;
  }
}

/**
 * Get Linear teams for the organization
 */
export async function getLinearTeams(orgId: string): Promise<Array<{
  id: string;
  name: string;
  key: string;
}> | null> {
  const creds = await getLinearCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot get Linear teams - no credentials available", { orgId });
    return null;
  }

  try {
    const query = `
      query {
        teams {
          nodes {
            id
            name
            key
          }
        }
      }
    `;

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data?: { teams?: { nodes?: Array<{ id: string; name: string; key: string }> } };
    };

    return data.data?.teams?.nodes || null;
  } catch (error) {
    logger.error("Failed to get Linear teams", { error });
    return null;
  }
}

/**
 * Get Linear labels for a team
 */
export async function getLinearLabels(orgId: string, teamId?: string): Promise<Array<{
  id: string;
  name: string;
}> | null> {
  const creds = await getLinearCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot get Linear labels - no credentials available", { orgId });
    return null;
  }

  try {
    const query = teamId
      ? `
        query GetTeamLabels($teamId: String!) {
          team(id: $teamId) {
            labels {
              nodes {
                id
                name
              }
            }
          }
        }
      `
      : `
        query {
          issueLabels {
            nodes {
              id
              name
            }
          }
        }
      `;

    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: teamId ? { teamId } : undefined,
      }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data?: {
        team?: { labels?: { nodes?: Array<{ id: string; name: string }> } };
        issueLabels?: { nodes?: Array<{ id: string; name: string }> };
      };
    };

    return data.data?.team?.labels?.nodes || data.data?.issueLabels?.nodes || null;
  } catch (error) {
    logger.error("Failed to get Linear labels", { error });
    return null;
  }
}

export async function postLinearComment(
  orgId: string,
  issueIdentifier: string,
  body: string
): Promise<boolean> {
  const creds = await getLinearCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot post Linear comment - no credentials available", { orgId, issueIdentifier });
    return false;
  }

  try {
    // First, get the issue ID from the identifier
    const issueIdQuery = `
      query GetIssueId($identifier: String!) {
        issue(id: $identifier) {
          id
        }
      }
    `;

    const issueResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: issueIdQuery,
        variables: { identifier: issueIdentifier },
      }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!issueResponse.ok) {
      logger.warn("Failed to get Linear issue ID", { issueIdentifier });
      return false;
    }

    const issueData = await issueResponse.json() as {
      data?: { issue?: { id: string } };
    };

    const issueId = issueData.data?.issue?.id;
    if (!issueId) {
      logger.warn("Linear issue not found for comment", { issueIdentifier });
      return false;
    }

    // Now create the comment
    const commentMutation = `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
          comment {
            id
          }
        }
      }
    `;

    const commentResponse = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: creds.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: commentMutation,
        variables: { issueId, body },
      }),
      signal: AbortSignal.timeout(LINEAR_API_TIMEOUT_MS),
    });

    if (!commentResponse.ok) {
      logger.warn("Failed to post Linear comment", { issueIdentifier });
      return false;
    }

    const commentData = await commentResponse.json() as {
      data?: { commentCreate?: { success: boolean } };
    };

    if (commentData.data?.commentCreate?.success) {
      logger.info("Posted comment to Linear issue", { issueIdentifier });
      return true;
    }

    return false;
  } catch (error) {
    logger.error("Failed to post Linear comment", { issueIdentifier, error });
    return false;
  }
}
