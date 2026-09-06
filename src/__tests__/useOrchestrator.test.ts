import { describe, expect, it, vi } from "vitest";
import {
  addSessionSummaryDivider,
  SESSION_SUMMARY_DIVIDER,
} from "../ui/useOrchestrator.js";

describe("session summary divider", () => {
  it("inserts the production divider when operational output exists", () => {
    const addMessage = vi.fn();
    addSessionSummaryDivider(addMessage, true);
    expect(addMessage).toHaveBeenCalledWith(SESSION_SUMMARY_DIVIDER);
  });

  it("skips the divider when there was no operational output", () => {
    const addMessage = vi.fn();
    addSessionSummaryDivider(addMessage, false);
    expect(addMessage).not.toHaveBeenCalled();
  });
});
