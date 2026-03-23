import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractGithubIssueNumber, TicketOps } from "../ticket-ops.js";

describe("extractGithubIssueNumber", () => {
  it("should extract numeric issue number from GH- prefix", () => {
    expect(extractGithubIssueNumber("GH-42")).toBe("42");
    expect(extractGithubIssueNumber("GH-1")).toBe("1");
    expect(extractGithubIssueNumber("#42")).toBe("42");
    expect(extractGithubIssueNumber("42")).toBe("42");
  });

  it("handles large issue numbers", () => {
    expect(extractGithubIssueNumber("GH-99999")).toBe("99999");
    expect(extractGithubIssueNumber("#100000")).toBe("100000");
  });

  it("preserves non-matching prefixes", () => {
    // Only GH- and # are stripped
    expect(extractGithubIssueNumber("PROJ-42")).toBe("PROJ-42");
    expect(extractGithubIssueNumber("ABC-123")).toBe("ABC-123");
  });

  it("handles empty and edge cases", () => {
    expect(extractGithubIssueNumber("")).toBe("");
    expect(extractGithubIssueNumber("GH-")).toBe("");
    expect(extractGithubIssueNumber("#")).toBe("");
  });
});

// ─── TicketOps constructor ──────────────────────────────────────

describe("TicketOps constructor", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("defaults to jira ticket system when none specified", () => {
    const ops = new TicketOps("PROJ-1");
    // Without Jira env vars, should not be available
    expect(ops.isAvailable()).toBe(false);
  });

  it("detects jira credentials when all env vars present", () => {
    process.env.JIRA_BASE_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "test@test.com";
    process.env.JIRA_API_TOKEN = "token123";
    const ops = new TicketOps("PROJ-1", "jira");
    expect(ops.isAvailable()).toBe(true);
  });

  it("detects github credentials", () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPO = "owner/repo";
    const ops = new TicketOps("GH-42", "github");
    expect(ops.isAvailable()).toBe(true);
  });

  it("github requires ticket key", () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPO = "owner/repo";
    const ops = new TicketOps("", "github");
    expect(ops.isAvailable()).toBe(false);
  });

  it("detects linear credentials", () => {
    process.env.LINEAR_API_KEY = "lin_test";
    const ops = new TicketOps("LIN-42", "linear");
    expect(ops.isAvailable()).toBe(true);
  });

  it("linear requires ticket key", () => {
    process.env.LINEAR_API_KEY = "lin_test";
    const ops = new TicketOps("", "linear");
    expect(ops.isAvailable()).toBe(false);
  });

  it("detects internal credentials", () => {
    process.env.API_BASE_URL = "http://localhost:3001";
    process.env.TASK_ID = "task-1";
    process.env.ORG_API_KEY = "key-1";
    const ops = new TicketOps("card-123", "internal");
    expect(ops.isAvailable()).toBe(true);
  });

  it("internal requires all env vars", () => {
    process.env.API_BASE_URL = "http://localhost:3001";
    // Missing TASK_ID and ORG_API_KEY
    const ops = new TicketOps("card-123", "internal");
    expect(ops.isAvailable()).toBe(false);
  });

  it("handles undefined ticket key", () => {
    const ops = new TicketOps(undefined, "jira");
    expect(ops.isAvailable()).toBe(false);
  });
});
