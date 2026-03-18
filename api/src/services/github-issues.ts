import { getOrgCredentials } from "./org-credentials.js";
import { logger } from "../utils/logger.js";

const GITHUB_API_TIMEOUT_MS = 15000;
const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubIssueResult {
  number: number;
  id: number;
  html_url: string;
}

interface CreateIssueOptions {
  repo: string;
  token: string;
  title: string;
  body: string;
  labels?: string[];
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "WorkerMill-API",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

export async function ensureWorkermillLabel(
  repo: string,
  token: string,
): Promise<void> {
  try {
    await fetch(`https://api.github.com/repos/${repo}/labels`, {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({
        name: "workermill",
        color: "7C3AED",
        description: "Managed by WorkerMill",
      }),
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    });
  } catch {
    // Best effort — 201 created or 422 already exists are both fine
  }
}

export async function createGithubIssue(
  options: CreateIssueOptions,
): Promise<GitHubIssueResult> {
  const response = await fetch(
    `https://api.github.com/repos/${options.repo}/issues`,
    {
      method: "POST",
      headers: githubHeaders(options.token),
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        labels: options.labels || ["workermill"],
      }),
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`GitHub API error ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as { number: number; id: number; html_url: string };
  return { number: data.number, id: data.id, html_url: data.html_url };
}

export async function addSubIssue(
  repo: string,
  token: string,
  parentIssueNumber: number,
  childIssueId: number,
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${parentIssueNumber}/sub_issues`,
    {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ sub_issue_id: childIssueId }),
      signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    logger.warn("Failed to link sub-issue", {
      repo, parentIssueNumber, childIssueId, status: response.status, error: errorBody,
    });
  }
}

export async function closeGithubIssue(
  repo: string,
  token: string,
  issueNumber: number,
): Promise<void> {
  try {
    await fetch(
      `https://api.github.com/repos/${repo}/issues/${issueNumber}`,
      {
        method: "PATCH",
        headers: githubHeaders(token),
        body: JSON.stringify({ state: "closed", state_reason: "not_planned" }),
        signal: AbortSignal.timeout(GITHUB_API_TIMEOUT_MS),
      },
    );
  } catch {
    logger.warn("Failed to close orphaned GitHub Issue during cleanup", { repo, issueNumber });
  }
}

export async function createGithubIssueForTask(
  orgId: string,
  repo: string,
  title: string,
  body: string,
): Promise<GitHubIssueResult> {
  const credentials = await getOrgCredentials(orgId);
  const token = credentials.githubToken || credentials.scmToken;
  if (!token) {
    throw new Error("No GitHub token configured for organization");
  }

  await ensureWorkermillLabel(repo, token);
  return createGithubIssue({ repo, token, title, body, labels: ["workermill"] });
}

export async function createGithubParentIssue(
  orgId: string,
  repo: string,
  title: string,
  prdContent: string,
): Promise<GitHubIssueResult> {
  const credentials = await getOrgCredentials(orgId);
  const token = credentials.githubToken || credentials.scmToken;
  if (!token) {
    throw new Error("No GitHub token configured for organization");
  }

  await ensureWorkermillLabel(repo, token);
  const body = `## PRD\n\n${prdContent.substring(0, 60000)}\n\n---\n*Managed by WorkerMill*`;
  return createGithubIssue({ repo, token, title, body, labels: ["workermill"] });
}

export async function createGithubChildIssues(
  orgId: string,
  repo: string,
  parentIssueNumber: number,
  stories: Array<{ title: string; description: string }>,
): Promise<GitHubIssueResult[]> {
  const credentials = await getOrgCredentials(orgId);
  const token = credentials.githubToken || credentials.scmToken;
  if (!token) {
    throw new Error("No GitHub token configured for organization");
  }

  const childIssues: GitHubIssueResult[] = [];

  try {
    for (const story of stories) {
      const childIssue = await createGithubIssue({
        repo, token, title: story.title, body: story.description, labels: ["workermill"],
      });
      childIssues.push(childIssue);
      await addSubIssue(repo, token, parentIssueNumber, childIssue.id);
    }
  } catch (err) {
    logger.error("Failed creating child GitHub Issues, attempting cleanup", {
      orgId, repo, parentIssueNumber,
      createdCount: childIssues.length, totalStories: stories.length,
      error: err instanceof Error ? err.message : String(err),
    });

    for (const issue of childIssues) {
      await closeGithubIssue(repo, token, issue.number);
    }

    throw new Error(
      `Failed to create all GitHub Issues: created ${childIssues.length}/${stories.length}. ` +
      `Orphans closed. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return childIssues;
}
