import { describe, expect, it } from "vitest";
import { parseProgramEpicsFromIssueBody } from "../program-queue.js";

describe("parseProgramEpicsFromIssueBody", () => {
  it("parses epic headings and ordered GitHub issue refs", () => {
    const body = `
# Epic A
- #10
- GH-11

## Epic B
- #12
`;
    expect(parseProgramEpicsFromIssueBody(body)).toEqual([
      { title: "Epic A", issueKeys: ["#10", "#11"] },
      { title: "Epic B", issueKeys: ["#12"] },
    ]);
  });

  it("de-dupes duplicate issue refs globally", () => {
    const body = `
# Epic A
- #10
- GH-10

# Epic B
- #10
- #11
`;
    expect(parseProgramEpicsFromIssueBody(body)).toEqual([
      { title: "Epic A", issueKeys: ["#10"] },
      { title: "Epic B", issueKeys: ["#11"] },
    ]);
  });

  it("supports refs before any heading", () => {
    const body = `
- #5
- #6
`;
    expect(parseProgramEpicsFromIssueBody(body)).toEqual([
      { title: "Epic 1", issueKeys: ["#5", "#6"] },
    ]);
  });

  it("returns empty when no refs are present", () => {
    const body = `
# Epic A
No issue links here.
`;
    expect(parseProgramEpicsFromIssueBody(body)).toEqual([]);
  });
});

