#!/usr/bin/env npx ts-node

/**
 * Transition a ticket to a new status (supports Jira, GitHub Issues)
 *
 * Inputs (environment variables):
 * - TICKET_KEY: Required. The ticket key (e.g., "PROJ-123")
 * - TRANSITION_NAME: Required. Target status name (e.g., "Done", "In Progress")
 * - TICKET_SYSTEM: Optional. "jira" (default) or "github"
 *
 * For Jira:
 * - JIRA_BASE_URL: Required. Jira instance URL
 * - JIRA_EMAIL: Required. Jira user email
 * - JIRA_API_TOKEN: Required. Jira API token
 *
 * For GitHub:
 * - GITHUB_REPO: Required. "owner/repo" format
 * - GITHUB_TOKEN: Required. GitHub token
 *
 * Outputs (JSON to stdout):
 * - success: boolean
 * - previousStatus: string
 * - newStatus: string
 * - error?: string
 */

import * as https from "https";
import * as http from "http";

interface Output {
  success: boolean;
  previousStatus?: string;
  newStatus?: string;
  availableTransitions?: string[];
  error?: string;
}

function makeRequest(
  url: string,
  options: https.RequestOptions,
  body?: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    const req = protocol.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode || 0, body: data });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
  };
}

async function transitionJiraIssue(
  ticketKey: string,
  transitionName: string
): Promise<Output> {
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;

  if (!jiraBaseUrl) throw new Error("JIRA_BASE_URL is required");
  if (!jiraEmail) throw new Error("JIRA_EMAIL is required");
  if (!jiraApiToken) throw new Error("JIRA_API_TOKEN is required");

  const authString = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");
  const headers = {
    Authorization: `Basic ${authString}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Get current issue status
  const issueUrl = `${jiraBaseUrl}/rest/api/3/issue/${ticketKey}?fields=status`;
  const issueResponse = await makeRequest(issueUrl, { method: "GET", headers });

  if (issueResponse.statusCode !== 200) {
    throw new Error(`Failed to get issue: ${issueResponse.body.slice(0, 200)}`);
  }

  const issue = JSON.parse(issueResponse.body);
  const previousStatus = issue.fields?.status?.name || "Unknown";

  // Get available transitions
  const transitionsUrl = `${jiraBaseUrl}/rest/api/3/issue/${ticketKey}/transitions`;
  const transitionsResponse = await makeRequest(transitionsUrl, { method: "GET", headers });

  if (transitionsResponse.statusCode !== 200) {
    throw new Error(`Failed to get transitions: ${transitionsResponse.body.slice(0, 200)}`);
  }

  const transitionsData = JSON.parse(transitionsResponse.body);
  const transitions: JiraTransition[] = transitionsData.transitions || [];

  // Find matching transition (case-insensitive)
  const targetTransition = transitions.find(
    (t) => t.name.toLowerCase() === transitionName.toLowerCase() ||
           t.to.name.toLowerCase() === transitionName.toLowerCase()
  );

  if (!targetTransition) {
    return {
      success: false,
      previousStatus,
      availableTransitions: transitions.map((t) => t.name),
      error: `Transition "${transitionName}" not available. Available: ${transitions.map((t) => t.name).join(", ")}`,
    };
  }

  // Perform the transition
  const requestBody = JSON.stringify({ transition: { id: targetTransition.id } });
  const transitionResponse = await makeRequest(
    transitionsUrl,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Length": String(Buffer.byteLength(requestBody)),
      },
    },
    requestBody
  );

  if (transitionResponse.statusCode === 204 || transitionResponse.statusCode === 200) {
    return {
      success: true,
      previousStatus,
      newStatus: targetTransition.to.name,
    };
  }

  throw new Error(`Failed to transition: ${transitionResponse.body.slice(0, 200)}`);
}

async function updateGithubIssueState(
  issueNumber: string,
  state: string
): Promise<Output> {
  const githubRepo = process.env.GITHUB_REPO;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubRepo) throw new Error("GITHUB_REPO is required");
  if (!githubToken) throw new Error("GITHUB_TOKEN is required");

  // Map common status names to GitHub states
  const stateMap: Record<string, string> = {
    done: "closed",
    closed: "closed",
    resolved: "closed",
    open: "open",
    reopened: "open",
    "in progress": "open",
  };

  const targetState = stateMap[state.toLowerCase()] || state.toLowerCase();

  if (!["open", "closed"].includes(targetState)) {
    throw new Error(`Invalid GitHub state: ${targetState}. Use "open" or "closed"`);
  }

  const apiUrl = `https://api.github.com/repos/${githubRepo}/issues/${issueNumber}`;

  // Get current state
  const getResponse = await makeRequest(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "WorkerMill-AI-Worker",
    },
  });

  if (getResponse.statusCode !== 200) {
    throw new Error(`Failed to get issue: ${getResponse.body.slice(0, 200)}`);
  }

  const issue = JSON.parse(getResponse.body);
  const previousStatus = issue.state;

  // Update state
  const requestBody = JSON.stringify({ state: targetState });
  const updateResponse = await makeRequest(
    apiUrl,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
        "User-Agent": "WorkerMill-AI-Worker",
        "Content-Length": String(Buffer.byteLength(requestBody)),
      },
    },
    requestBody
  );

  if (updateResponse.statusCode === 200) {
    return {
      success: true,
      previousStatus,
      newStatus: targetState,
    };
  }

  throw new Error(`Failed to update issue: ${updateResponse.body.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const output: Output = { success: false };

  try {
    const ticketKey = process.env.TICKET_KEY;
    const transitionName = process.env.TRANSITION_NAME;
    const ticketSystem = process.env.TICKET_SYSTEM || "jira";

    if (!ticketKey) throw new Error("TICKET_KEY is required");
    if (!transitionName) throw new Error("TRANSITION_NAME is required");

    let result: Output;

    switch (ticketSystem.toLowerCase()) {
      case "jira":
        result = await transitionJiraIssue(ticketKey, transitionName);
        break;
      case "github":
        const issueNumber = ticketKey.replace(/^#/, "");
        result = await updateGithubIssueState(issueNumber, transitionName);
        break;
      default:
        throw new Error(`Unsupported ticket system: ${ticketSystem}`);
    }

    Object.assign(output, result);
  } catch (error: unknown) {
    output.error = error instanceof Error ? error.message : String(error);
    output.success = false;
  }

  console.log(JSON.stringify(output));

  // Output markers for orchestrator
  if (output.success) {
    console.error(`::transition::${output.previousStatus} -> ${output.newStatus}`);
  }

  process.exit(output.success ? 0 : 1);
}

main();
