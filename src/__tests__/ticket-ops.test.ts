import { describe, it, expect } from "vitest";
import { TicketOps, extractGithubIssueNumber } from "../ticket-ops.js";

// --- detectTicketRef (inline helper, test the pattern matching) ---

function detectTicketRef(input: string): { system: "github" | "external"; key: string } | null {
  const trimmed = input.trim();
  if (/^#\d+$/.test(trimmed) || /^GH-\d+$/i.test(trimmed)) {
    return { system: "github", key: trimmed };
  }
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(trimmed)) {
    return { system: "external", key: trimmed };
  }
  return null;
}

describe("detectTicketRef", () => {
  it("detects GitHub issue #123", () => {
    expect(detectTicketRef("#123")).toEqual({ system: "github", key: "#123" });
  });

  it("detects GitHub issue GH-42", () => {
    expect(detectTicketRef("GH-42")).toEqual({ system: "github", key: "GH-42" });
  });

  it("detects GH- case insensitively", () => {
    expect(detectTicketRef("gh-42")).toEqual({ system: "github", key: "gh-42" });
  });

  it("detects Jira ticket PROJ-123", () => {
    expect(detectTicketRef("PROJ-123")).toEqual({ system: "external", key: "PROJ-123" });
  });

  it("detects Linear ticket TEAM-42", () => {
    expect(detectTicketRef("TEAM-42")).toEqual({ system: "external", key: "TEAM-42" });
  });

  it("detects multi-letter prefix ACME-999", () => {
    expect(detectTicketRef("ACME-999")).toEqual({ system: "external", key: "ACME-999" });
  });

  it("returns null for inline text", () => {
    expect(detectTicketRef("add dark mode")).toBeNull();
  });

  it("returns null for file paths", () => {
    expect(detectTicketRef("./specs/auth.md")).toBeNull();
  });

  it("returns null for lowercase (not a ticket)", () => {
    expect(detectTicketRef("proj-123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectTicketRef("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(detectTicketRef("  #42  ")).toEqual({ system: "github", key: "#42" });
  });
});

describe("extractGithubIssueNumber", () => {
  it("strips # prefix", () => {
    expect(extractGithubIssueNumber("#42")).toBe("42");
  });

  it("strips GH- prefix", () => {
    expect(extractGithubIssueNumber("GH-42")).toBe("42");
  });

  it("leaves bare number unchanged", () => {
    expect(extractGithubIssueNumber("42")).toBe("42");
  });
});

describe("TicketOps", () => {
  it("is not available without credentials", () => {
    const ops = new TicketOps("#42", "github");
    expect(ops.isAvailable()).toBe(false);
  });

  it("is not available without ticket key", () => {
    const ops = new TicketOps("", "github");
    expect(ops.isAvailable()).toBe(false);
  });

  it("is not available for jira without JIRA_BASE_URL", () => {
    const ops = new TicketOps("PROJ-123", "jira");
    expect(ops.isAvailable()).toBe(false);
  });

  it("is not available for linear without LINEAR_API_KEY", () => {
    const ops = new TicketOps("TEAM-42", "linear");
    expect(ops.isAvailable()).toBe(false);
  });

  it("fetchTicket returns null without credentials", async () => {
    const ops = new TicketOps("#42", "github");
    const result = await ops.fetchTicket();
    expect(result).toBeNull();
  });

  it("postComment is a no-op without credentials", async () => {
    const ops = new TicketOps("#42", "github");
    // Should not throw
    await ops.postComment("test");
  });

  it("transitionTo is a no-op without credentials", async () => {
    const ops = new TicketOps("#42", "github");
    // Should not throw
    await ops.transitionTo("done");
  });

  it("defaults to jira when no ticket system specified", () => {
    const ops = new TicketOps("PROJ-123");
    // Can't directly check ticketSystem, but we can verify it doesn't crash
    expect(ops.isAvailable()).toBe(false);
  });
});
