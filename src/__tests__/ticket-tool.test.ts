import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({ ticketSystem: "github" })),
}));

const listTickets = vi.fn();
const isSystemAvailable = vi.fn();

vi.mock("../ticket-ops.js", () => ({
  TicketOps: class {
    static listTickets = listTickets;
    static isSystemAvailable = isSystemAvailable;

    constructor(private ticketKey: string, private ticketSystem: string) {}

    isAvailable(): boolean {
      return true;
    }

    async fetchTicket() {
      return { title: `Title ${this.ticketKey}`, body: "Body", labels: ["bug"] };
    }

    async postComment(comment: string) {
      return comment;
    }

    async transitionTo(status: string) {
      return status;
    }
  },
}));

import { loadConfig } from "../config.js";
import * as ticketTool from "../engine/tools/ticket.js";

const loadConfigMock = vi.mocked(loadConfig);

describe("ticket tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSystemAvailable.mockReturnValue(true);
  });

  it("formats tracker list output consistently", async () => {
    listTickets.mockResolvedValue([
      { key: "TEAM-42", title: "Unify memory backend", status: "Backlog", labels: ["memory"] },
      { key: "TEAM-43", title: "Improve runs UI", status: "In Progress", labels: [] },
    ]);

    const result = await ticketTool.execute({ action: "list", query: "memory" });

    expect(result).toEqual({
      success: true,
      content: "- TEAM-42 [Backlog] Unify memory backend — labels: memory\n- TEAM-43 [In Progress] Improve runs UI",
    });
    expect(listTickets).toHaveBeenCalledWith("github", "memory", 10);
  });

  it("fails cleanly when system credentials are unavailable for list", async () => {
    isSystemAvailable.mockReturnValue(false);

    const result = await ticketTool.execute({ action: "list" });

    expect(result).toEqual({
      success: false,
      error: "Cannot connect to github — credentials not found.",
    });
  });

  it("fails cleanly when ticket integration is disabled", async () => {
    loadConfigMock.mockReturnValue({ ticketSystem: "none" } as any);

    const result = await ticketTool.execute({ action: "list" });

    expect(result).toEqual({
      success: false,
      error: "Ticket integration is disabled. Configure GitHub, Jira, or Linear in /settings.",
    });
  });
});
