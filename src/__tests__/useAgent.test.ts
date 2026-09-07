import { describe, expect, it, vi } from "vitest";
import { getLiveViewChangeTargets, shouldBlockUnverifiedImageAnswer, trackAbortCost } from "../ui/useAgent.js";

describe("trackAbortCost", () => {
  it("records observed partial tokens through the production helper", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0.0018) };

    trackAbortCost(1200, 600, "agent", "anthropic", "claude-sonnet-4-6", tracker, setCost);

    expect(addUsage).toHaveBeenCalledWith("agent", "anthropic", "claude-sonnet-4-6", 1200, 600);
    expect(setCost).toHaveBeenCalledWith(0.0018);
  });

  it("does not record an unobserved abort", () => {
    const addUsage = vi.fn();
    const setCost = vi.fn();
    const tracker = { addUsage, getTotalCost: vi.fn(() => 0) };

    trackAbortCost(0, 0, "agent", "anthropic", "claude-sonnet-4-6", tracker, setCost);

    expect(addUsage).not.toHaveBeenCalled();
    expect(setCost).not.toHaveBeenCalled();
  });
});

describe("getLiveViewChangeTargets", () => {
  it("extracts patch targets and normalizes write paths", () => {
    const patch = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b";
    expect(getLiveViewChangeTargets("patch", { patch_text: patch }, {}, "/repo"))
      .toContainEqual({ filePath: "src/a.ts", tool: "edited" });
    expect(getLiveViewChangeTargets("write_file", { path: "/repo/src/new.ts" }, {}, "/repo"))
      .toEqual([{ filePath: "src/new.ts", tool: "created" }]);
  });
});

describe("shouldBlockUnverifiedImageAnswer", () => {
  it("requires image evidence for image claims", () => {
    expect(shouldBlockUnverifiedImageAnswer(
      "what does this screenshot show?", "The screenshot shows a red error banner.",
      { turnHadInlineImages: false, toolCalls: [] },
    )).toBe(true);
    expect(shouldBlockUnverifiedImageAnswer(
      "what does this screenshot show?", "The screenshot shows a red error banner.",
      { turnHadInlineImages: true, toolCalls: [] },
    )).toBe(false);
  });

  it("accepts a completed image-tool observation", () => {
    expect(shouldBlockUnverifiedImageAnswer(
      "check this png", "The image shows a missing import.",
      { turnHadInlineImages: false, toolCalls: [{ id: "1", name: "view_image", input: { path: "/tmp/a.png" }, status: "done", result: "ok" }] },
    )).toBe(false);
  });
});
