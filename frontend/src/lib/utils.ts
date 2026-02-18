import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Issue tracker configuration for building ticket URLs
 */
export interface IssueTrackerConfig {
  provider: "jira" | "linear" | "github-issues" | "internal";
  jiraBaseUrl?: string;  // e.g., "https://mycompany.atlassian.net" or "mycompany.atlassian.net"
  linearWorkspace?: string;  // e.g., "mycompany"
  githubRepo?: string;  // e.g., "owner/repo"
}

/**
 * Build a URL to view an issue/ticket in the configured issue tracker.
 * Respects the organization's default issue tracker provider.
 *
 * @param issueKey - The issue key (e.g., "PROJ-123", "APP-19", "123")
 * @param config - Issue tracker configuration from org settings
 * @returns The full URL to view the issue, or null if unable to build URL
 */
export function buildTicketUrl(
  issueKey: string | null | undefined,
  config?: IssueTrackerConfig,
  boardContext?: { boardId: string; cardId: string } | null,
): string | null {
  if (!issueKey) return null;

  // Internal board cards: direct link if we have board context
  if (boardContext?.boardId) {
    return `/boards/${boardContext.boardId}?card=${boardContext.cardId}`;
  }

  if (!config) return null;

  const { provider, jiraBaseUrl, linearWorkspace, githubRepo } = config;

  switch (provider) {
    case "jira": {
      if (!jiraBaseUrl) return null;
      // Normalize base URL (add https:// if missing, remove trailing slash)
      let baseUrl = jiraBaseUrl.trim();
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        baseUrl = `https://${baseUrl}`;
      }
      baseUrl = baseUrl.replace(/\/$/, "");
      return `${baseUrl}/browse/${issueKey}`;
    }
    case "linear": {
      if (!linearWorkspace) {
        // Fallback: Linear issues can be accessed without workspace in URL
        return `https://linear.app/issue/${issueKey}`;
      }
      return `https://linear.app/${linearWorkspace}/issue/${issueKey}`;
    }
    case "github-issues": {
      if (!githubRepo) return null;
      // Extract issue number from key (e.g., "PROJ-123" -> "123" or just "123")
      const issueNumber = issueKey.includes("-") ? issueKey.split("-").pop() : issueKey;
      return `https://github.com/${githubRepo}/issues/${issueNumber}`;
    }
    case "internal": {
      // Internal tasks link to the boards page with the task key as a query param
      // The key format is "PROJ-123" — link to /boards so user can find the card
      return `/boards?task=${encodeURIComponent(issueKey)}`;
    }
    default:
      return null;
  }
}

export function formatCost(cost: number | string): string {
  return `$${Number(cost).toFixed(4)}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function formatRelativeTime(date: string | null): string {
  if (!date) return "-";
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
