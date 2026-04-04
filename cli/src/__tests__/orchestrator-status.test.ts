import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_STATUS_THROTTLE_MS,
  shouldCommitStatusUpdate,
} from "../ui/orchestrator-status.js";

describe("orchestrator status update policy", () => {
  it("allows first non-empty status immediately", () => {
    expect(shouldCommitStatusUpdate("", "Planner reading repository...", 0)).toBe(true);
  });

  it("suppresses identical status text updates", () => {
    expect(shouldCommitStatusUpdate("planner: working...", "planner: working...", 5000)).toBe(false);
  });

  it("throttles non-empty status churn under threshold", () => {
    expect(
      shouldCommitStatusUpdate(
        "Planner working... (1s)",
        "Planner working... (2s)",
        ORCHESTRATOR_STATUS_THROTTLE_MS - 1,
      ),
    ).toBe(false);
  });

  it("allows non-empty status changes once threshold is reached", () => {
    expect(
      shouldCommitStatusUpdate(
        "Planner working... (1s)",
        "Planner working... (3s)",
        ORCHESTRATOR_STATUS_THROTTLE_MS,
      ),
    ).toBe(true);
  });

  it("always allows clear-to-empty to avoid stale status", () => {
    expect(shouldCommitStatusUpdate("Reviewer checking...", "", 100)).toBe(true);
  });
});
