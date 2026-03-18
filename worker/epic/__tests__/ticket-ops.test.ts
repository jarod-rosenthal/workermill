import { describe, it, expect } from "vitest";
import { extractGithubIssueNumber } from "../ticket-ops.js";

describe("extractGithubIssueNumber", () => {
  it("should extract numeric issue number from GH- prefix", () => {
    expect(extractGithubIssueNumber("GH-42")).toBe("42");
    expect(extractGithubIssueNumber("GH-1")).toBe("1");
    expect(extractGithubIssueNumber("#42")).toBe("42");
    expect(extractGithubIssueNumber("42")).toBe("42");
  });
});
