import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

const secretsClient = new SecretsManagerClient({ region: config.aws.region });

// Default timeout for external API calls (30 seconds)
// Prevents cascading failures if Jira is slow or unresponsive
const JIRA_API_TIMEOUT_MS = 30000;

// Per-org cache for Jira credentials (5 minutes)
const jiraCredentialsCache = new Map<string, {
  baseUrl: string;
  email: string;
  apiToken: string;
  expiresAt: number;
}>();

/**
 * Extract text from Jira ADF (Atlassian Document Format)
 */
export function extractTextFromADF(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";

  const node = adf as { type?: string; text?: string; content?: unknown[] };

  if (node.type === "text" && node.text) {
    return node.text;
  }

  if (Array.isArray(node.content)) {
    return node.content.map(extractTextFromADF).join(" ");
  }

  return "";
}

/**
 * Get Jira credentials from Secrets Manager (with per-org caching)
 *
 * SECURITY: Only fetches org-specific credentials. NO global/platform fallback.
 * Each organization must configure their own Jira credentials in Settings.
 *
 * Secret path: workermill/${env}/orgs/${orgId}/integrations/jira-credentials
 *              or workermill/${env}/orgs/${orgId}/jira-credentials (legacy)
 */
async function getJiraCredentials(orgId: string): Promise<{
  baseUrl: string;
  email: string;
  apiToken: string;
} | null> {
  const now = Date.now();

  // Return cached credentials if still valid
  const cached = jiraCredentialsCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const env = config.environment;
  const basePath = `workermill/${env}/orgs/${orgId}`;

  // Try integrations/ path first (new structure)
  let secretString: string | null = null;
  try {
    const secret = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: `${basePath}/integrations/jira-credentials` })
    );
    secretString = secret.SecretString || null;
  } catch {
    // Not found in integrations/
  }

  // Try root path (legacy structure)
  if (!secretString) {
    try {
      const secret = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: `${basePath}/jira-credentials` })
      );
      secretString = secret.SecretString || null;
    } catch {
      // Not found at root either
    }
  }

  if (!secretString) {
    logger.warn("Jira credentials not configured for organization", { orgId });
    return null; // NO platform fallback - return null if not configured for this org
  }

  try {
    const creds = JSON.parse(secretString);

    // Handle both 'base_url' (full URL) and 'domain' (just domain) formats
    let baseUrl = "";
    if (creds.base_url) {
      baseUrl = creds.base_url;
    } else if (creds.domain) {
      baseUrl = creds.domain.startsWith("http") ? creds.domain : `https://${creds.domain}`;
    }

    if (!baseUrl || !creds.email || !creds.api_token) {
      logger.warn("Incomplete Jira credentials in Secrets Manager", { orgId });
      return null;
    }

    const credentials = {
      baseUrl,
      email: creds.email,
      apiToken: creds.api_token,
      expiresAt: now + 5 * 60 * 1000, // 5 minutes
    };

    jiraCredentialsCache.set(orgId, credentials);
    return credentials;
  } catch (error) {
    logger.error("Failed to parse Jira credentials JSON", { error, orgId });
    return null;
  }
}

/**
 * Fetch Jira issue details by key
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueKey - Jira issue key (e.g., "OCS-123")
 */
export async function fetchJiraIssue(orgId: string, issueKey: string): Promise<{
  summary: string;
  description: string;
  labels: string[];
} | null> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot fetch Jira issue - no credentials available", { orgId, issueKey });
    return null;
  }

  try {
    const url = `${creds.baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,labels`;
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn("Failed to fetch Jira issue", {
        issueKey,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as {
      fields?: {
        summary?: string;
        description?: unknown;
        labels?: string[];
      };
    };

    return {
      summary: data.fields?.summary || "",
      description: extractTextFromADF(data.fields?.description),
      labels: data.fields?.labels || [],
    };
  } catch (error) {
    logger.error("Error fetching Jira issue", { issueKey, error });
    return null;
  }
}

/**
 * Post a comment to a Jira issue
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueKey - Jira issue key
 * @param comment - Comment text
 */
export async function postJiraComment(
  orgId: string,
  issueKey: string,
  comment: string
): Promise<boolean> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot post Jira comment - no credentials available", { orgId, issueKey });
    return false;
  }

  try {
    const url = `${creds.baseUrl}/rest/api/3/issue/${issueKey}/comment`;
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

    // Convert plain text to ADF (Atlassian Document Format)
    const adfBody = {
      body: {
        type: "doc",
        version: 1,
        content: comment.split("\n\n").map((paragraph) => ({
          type: "paragraph",
          content: paragraph.split("\n").flatMap((line, idx, arr) => {
            const textNode = { type: "text", text: line };
            // Add hard break between lines within a paragraph (but not after the last line)
            return idx < arr.length - 1
              ? [textNode, { type: "hardBreak" }]
              : [textNode];
          }),
        })),
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(adfBody),
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("Failed to post Jira comment", {
        issueKey,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return false;
    }

    logger.info("Posted comment to Jira issue", { issueKey });
    return true;
  } catch (error) {
    logger.error("Error posting Jira comment", { issueKey, error });
    return false;
  }
}

/**
 * Transition a Jira issue to a new status
 * Returns true on success, false on failure
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueKey - Jira issue key
 * @param transitionName - Target status name (e.g., "In Progress", "Done")
 */
export async function transitionJiraIssue(
  orgId: string,
  issueKey: string,
  transitionName: string
): Promise<boolean> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot transition Jira issue - no credentials available", { orgId, issueKey });
    return false;
  }

  try {
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    // Get available transitions
    const transitionsUrl = `${creds.baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
    const transitionsResponse = await fetch(transitionsUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!transitionsResponse.ok) {
      logger.warn("Failed to get Jira transitions", {
        issueKey,
        status: transitionsResponse.status,
      });
      return false;
    }

    const transitionsData = await transitionsResponse.json() as {
      transitions?: Array<{ id: string; name: string; to: { name: string } }>;
    };
    const transitions = transitionsData.transitions || [];

    // Find matching transition (case-insensitive)
    const targetTransition = transitions.find(
      (t) =>
        t.name.toLowerCase() === transitionName.toLowerCase() ||
        t.to.name.toLowerCase() === transitionName.toLowerCase()
    );

    if (!targetTransition) {
      logger.warn("Transition not available", {
        issueKey,
        transitionName,
        available: transitions.map((t) => t.name),
      });
      return false;
    }

    // Perform the transition
    const transitionResponse = await fetch(transitionsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ transition: { id: targetTransition.id } }),
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (transitionResponse.ok || transitionResponse.status === 204) {
      logger.info("Transitioned Jira issue", {
        issueKey,
        from: "current",
        to: targetTransition.to.name,
      });
      return true;
    }

    const errorText = await transitionResponse.text();
    logger.warn("Failed to transition Jira issue", {
      issueKey,
      status: transitionResponse.status,
      error: errorText,
    });
    return false;
  } catch (error) {
    logger.error("Error transitioning Jira issue", { issueKey, error });
    return false;
  }
}

/**
 * Convert a Jira issue to an Epic (changes issue type)
 * Returns true on success, false on failure
 *
 * @param orgId - Organization ID for credential lookup
 * @param issueKey - Jira issue key
 */
export async function convertToEpic(orgId: string, issueKey: string): Promise<boolean> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot convert to Epic - no credentials available", { orgId, issueKey });
    return false;
  }

  try {
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

    // Get the issue to find project
    const issueUrl = `${creds.baseUrl}/rest/api/3/issue/${issueKey}?fields=project,issuetype`;
    const issueResponse = await fetch(issueUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!issueResponse.ok) {
      logger.warn("Failed to fetch issue for Epic conversion", { issueKey });
      return false;
    }

    const issueData = await issueResponse.json() as {
      fields?: {
        project?: { key: string };
        issuetype?: { name: string };
      };
    };

    // Check if already an Epic
    if (issueData.fields?.issuetype?.name === "Epic") {
      logger.info("Issue is already an Epic", { issueKey });
      return true;
    }

    const projectKey = issueData.fields?.project?.key;
    if (!projectKey) {
      logger.warn("Could not determine project from issue", { issueKey });
      return false;
    }

    // Get Epic issue type ID for this project
    const projectUrl = `${creds.baseUrl}/rest/api/3/project/${projectKey}`;
    const projectResponse = await fetch(projectUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!projectResponse.ok) {
      logger.warn("Failed to fetch project for Epic type", { projectKey });
      return false;
    }

    const projectData = await projectResponse.json() as {
      issueTypes?: Array<{ id: string; name: string }>;
    };

    const epicType = projectData.issueTypes?.find((t) => t.name === "Epic");
    if (!epicType) {
      logger.warn("No Epic issue type found in project", { projectKey });
      return false;
    }

    // Update the issue type to Epic
    const updateUrl = `${creds.baseUrl}/rest/api/3/issue/${issueKey}`;
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
      body: JSON.stringify({
        fields: {
          issuetype: { id: epicType.id },
        },
      }),
    });

    if (updateResponse.ok || updateResponse.status === 204) {
      logger.info("Converted issue to Epic", { issueKey });
      return true;
    }

    const errorText = await updateResponse.text();
    logger.warn("Failed to convert issue to Epic", {
      issueKey,
      status: updateResponse.status,
      error: errorText,
    });
    return false;
  } catch (error) {
    logger.error("Error converting to Epic", { issueKey, error });
    return false;
  }
}

/**
 * Create a Jira Story linked to an Epic
 * Returns the created story key (e.g., "OCS-410") or null on failure
 *
 * @param orgId - Organization ID for credential lookup
 * @param epicKey - Parent Epic key
 * @param summary - Story summary
 * @param description - Story description
 */
export async function createJiraStory(
  orgId: string,
  epicKey: string,
  summary: string,
  description: string
): Promise<{ key: string; id: string } | null> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot create Jira story - no credentials available", { orgId, epicKey });
    return null;
  }

  try {
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

    // Get the Epic to find project
    const epicUrl = `${creds.baseUrl}/rest/api/3/issue/${epicKey}?fields=project`;
    const epicResponse = await fetch(epicUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!epicResponse.ok) {
      logger.warn("Failed to fetch Epic for story creation", { epicKey });
      return null;
    }

    const epicData = await epicResponse.json() as {
      id: string;
      fields?: { project?: { key: string } };
    };

    const projectKey = epicData.fields?.project?.key;
    if (!projectKey) {
      logger.warn("Could not determine project from Epic", { epicKey });
      return null;
    }

    // Get Story issue type ID for this project
    const projectUrl = `${creds.baseUrl}/rest/api/3/project/${projectKey}`;
    const projectResponse = await fetch(projectUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!projectResponse.ok) {
      logger.warn("Failed to fetch project for Story type", { projectKey });
      return null;
    }

    const projectData = await projectResponse.json() as {
      issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
    };

    const storyType = projectData.issueTypes?.find(
      (t) => t.name === "Story" && !t.subtask
    );
    if (!storyType) {
      logger.warn("No Story issue type found in project", { projectKey });
      return null;
    }

    // Convert description to ADF
    const adfDescription = {
      type: "doc",
      version: 1,
      content: description.split("\n\n").map((paragraph) => ({
        type: "paragraph",
        content: paragraph.split("\n").flatMap((line, idx, arr) => {
          const textNode = { type: "text", text: line };
          return idx < arr.length - 1
            ? [textNode, { type: "hardBreak" }]
            : [textNode];
        }),
      })),
    };

    // Create the Story with Epic link (using parent field for next-gen projects)
    const createUrl = `${creds.baseUrl}/rest/api/3/issue`;
    const createBody = {
      fields: {
        project: { key: projectKey },
        parent: { key: epicKey }, // Links to Epic in next-gen/team-managed projects
        issuetype: { id: storyType.id },
        summary,
        description: adfDescription,
      },
    };

    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createBody),
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logger.warn("Failed to create Jira story with parent link", {
        epicKey,
        status: createResponse.status,
        error: errorText,
      });

      // Try without parent link (for classic projects, use customfield)
      // Note: Epic Link custom field ID varies by Jira instance
      return null;
    }

    const created = await createResponse.json() as { id: string; key: string };

    logger.info("Created Jira story linked to Epic", {
      epicKey,
      storyKey: created.key,
      storyId: created.id,
      summary,
    });

    return { key: created.key, id: created.id };
  } catch (error) {
    logger.error("Error creating Jira story", { epicKey, error });
    return null;
  }
}

/**
 * Create a Jira sub-task under a parent issue
 * Returns the created sub-task key (e.g., "OCS-410") or null on failure
 *
 * @param orgId - Organization ID for credential lookup
 * @param parentIssueKey - Parent issue key
 * @param summary - Sub-task summary
 * @param description - Sub-task description
 */
export async function createJiraSubtask(
  orgId: string,
  parentIssueKey: string,
  summary: string,
  description: string
): Promise<{ key: string; id: string } | null> {
  const creds = await getJiraCredentials(orgId);
  if (!creds) {
    logger.warn("Cannot create Jira sub-task - no credentials available", { orgId, parentIssueKey });
    return null;
  }

  try {
    // First, get the parent issue to determine project
    const parentUrl = `${creds.baseUrl}/rest/api/3/issue/${parentIssueKey}?fields=project`;
    const auth = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");

    const parentResponse = await fetch(parentUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!parentResponse.ok) {
      logger.warn("Failed to fetch parent issue for sub-task creation", {
        parentIssueKey,
        status: parentResponse.status,
      });
      return null;
    }

    const parentData = await parentResponse.json() as {
      id: string;
      fields?: { project?: { id: string; key: string } };
    };

    const projectKey = parentData.fields?.project?.key;
    if (!projectKey) {
      logger.warn("Could not determine project from parent issue", { parentIssueKey });
      return null;
    }

    // Get sub-task issue type ID for this project
    const projectUrl = `${creds.baseUrl}/rest/api/3/project/${projectKey}`;
    const projectResponse = await fetch(projectUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!projectResponse.ok) {
      logger.warn("Failed to fetch project for issue types", { projectKey });
      return null;
    }

    const projectData = await projectResponse.json() as {
      issueTypes?: Array<{ id: string; name: string; subtask: boolean }>;
    };

    const subtaskType = projectData.issueTypes?.find((t) => t.subtask === true);
    if (!subtaskType) {
      logger.warn("No sub-task issue type found in project", { projectKey });
      return null;
    }

    // Convert description to ADF
    const adfDescription = {
      type: "doc",
      version: 1,
      content: description.split("\n\n").map((paragraph) => ({
        type: "paragraph",
        content: paragraph.split("\n").flatMap((line, idx, arr) => {
          const textNode = { type: "text", text: line };
          return idx < arr.length - 1
            ? [textNode, { type: "hardBreak" }]
            : [textNode];
        }),
      })),
    };

    // Create the sub-task
    const createUrl = `${creds.baseUrl}/rest/api/3/issue`;
    const createBody = {
      fields: {
        project: { key: projectKey },
        parent: { key: parentIssueKey },
        issuetype: { id: subtaskType.id },
        summary,
        description: adfDescription,
      },
    };

    const createResponse = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(createBody),
      signal: AbortSignal.timeout(JIRA_API_TIMEOUT_MS),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      logger.warn("Failed to create Jira sub-task", {
        parentIssueKey,
        status: createResponse.status,
        error: errorText,
      });
      return null;
    }

    const created = await createResponse.json() as { id: string; key: string };

    logger.info("Created Jira sub-task", {
      parentIssueKey,
      subtaskKey: created.key,
      subtaskId: created.id,
      summary,
    });

    return { key: created.key, id: created.id };
  } catch (error) {
    logger.error("Error creating Jira sub-task", { parentIssueKey, error });
    return null;
  }
}
